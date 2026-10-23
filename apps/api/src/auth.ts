import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@oceanbrown/db";
import { can, loginSchema, passwordResetRequestSchema, passwordResetSchema, registerSchema, type Role, type SessionUser } from "@oceanbrown/shared";
import { config } from "./config.js";
import { sendTransactionalEmail } from "./email.js";
import { provisionIndustryTemplate } from "./templates.js";
import { isIndustryKey } from "@oceanbrown/shared";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: SessionUser;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    /** Plan status of the user's workspace (ACTIVE, PAST_DUE, SUSPENDED, CANCELLED), loaded with the session. */
    workspaceStatus?: string | null;
  }
}

const BLOCKED_WORKSPACE = new Set(["SUSPENDED", "CANCELLED"]);

export class HttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

const COOKIE = "ob_session";
// Hash of a random string, compared against for unknown emails so login timing does not reveal which emails exist.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash(crypto.randomUUID(), 12));

/**
 * Verifies the session token AND re-loads the user, so deactivated accounts
 * and role changes take effect immediately instead of after the token expires.
 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  let sub: string;
  let issuedAt = 0;
  try {
    const decoded = await req.jwtVerify<{ sub?: string; id?: string; iat?: number }>();
    sub = decoded.sub ?? decoded.id ?? "";
    issuedAt = decoded.iat ?? 0;
  } catch {
    return reply.code(401).send({ error: "Authentication required" });
  }
  const user = sub ? await db.user.findUnique({ where: { id: sub }, select: { id: true, businessId: true, role: true, email: true, name: true, active: true, passwordChangedAt: true, business: { select: { planStatus: true } } } }) : null;
  if (!user?.active || (user.passwordChangedAt && issuedAt * 1000 < user.passwordChangedAt.getTime())) {
    reply.clearCookie(COOKIE, { path: "/" });
    return reply.code(401).send({ error: "Authentication required" });
  }
  req.user = { id: user.id, businessId: user.businessId, role: user.role as Role, email: user.email, name: user.name };
  req.workspaceStatus = user.business?.planStatus ?? null;
}

export function requirePermission(permission: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(req, reply);
    if (reply.sent) return;
    if (!can(req.user.role, permission)) return reply.code(403).send({ error: "Permission denied" });
    // A suspended workspace can still sign in and read its data, but cannot act until OceanBrown reactivates it.
    if (req.user.role !== "SUPER_ADMIN" && req.workspaceStatus && BLOCKED_WORKSPACE.has(req.workspaceStatus)) {
      return reply.code(403).send({ error: "This workspace is suspended. Contact OceanBrown support to reactivate it." });
    }
  };
}

/** OceanBrown staff only. Every action through this guard is audited against the business it touches. */
export async function requirePlatformAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireAuth(req, reply);
  if (reply.sent) return;
  if (req.user.role !== "SUPER_ADMIN") return reply.code(403).send({ error: "Platform administrator access required" });
}

export async function platformAudit(req: FastifyRequest, action: string, businessId: string | null, entityType: string, entityId?: string, metadata?: Record<string, unknown>) {
  try {
    await db.auditLog.create({ data: { businessId, actorId: req.user.id, action, entityType, entityId, metadata: { ...(metadata ?? {}), platform: true, actorEmail: req.user.email } as any } });
  } catch (err) {
    req.log.error({ err, action }, "Failed to write platform audit log");
  }
}

export function tenantId(req: FastifyRequest) {
  if (!req.user.businessId) throw new HttpError(403, "A business workspace is required");
  return req.user.businessId;
}

export async function audit(action: string, entityType: string, entityId: string | undefined, req: FastifyRequest, metadata?: Record<string, unknown>) {
  try {
    await db.auditLog.create({ data: { businessId: req.user.businessId, actorId: req.user.id, action, entityType, entityId, metadata: metadata as any } });
  } catch (err) {
    req.log.error({ err, action }, "Failed to write audit log");
  }
}

async function startSession(reply: FastifyReply, user: { id: string; businessId: string | null; role: string; email: string; name: string }) {
  const token = await reply.jwtSign({ sub: user.id }, { expiresIn: `${config.sessionHours}h` });
  reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: !config.isDevOrTest, path: "/", maxAge: config.sessionHours * 3600 });
  const session: SessionUser = { id: user.id, businessId: user.businessId, role: user.role as Role, email: user.email, name: user.name };
  return session;
}

const authRateLimit = { rateLimit: { max: 10, timeWindow: "1 minute" } };
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MINUTES = 15;
const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function registerAuth(app: FastifyInstance) {
  app.post("/auth/register", { config: authRateLimit }, async (req, reply) => {
    if (!config.allowSignup) return reply.code(403).send({ error: "Self-service registration is disabled" });
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Name, email, business name and a 10-character password are required", details: parsed.error.flatten() });
    const body = parsed.data;
    if (await db.user.findUnique({ where: { email: body.email }, select: { id: true } })) return reply.code(409).send({ error: "Email is already registered" });
    // Industry is chosen in onboarding step 2; an industry sent at signup (older clients) is still honoured.
    const industryKey = isIndustryKey(body.industry) ? body.industry : null;
    const base = body.businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 45) || "business";
    const slug = `${base}-${crypto.randomUUID().slice(0, 8)}`;
    const passwordHash = await bcrypt.hash(body.password, 12);
    try {
      const user = await db.$transaction(async tx => {
        const business = await tx.business.create({ data: { name: body.businessName, slug, industry: industryKey ?? "", timezone: "Africa/Banjul" } });
        return tx.user.create({ data: { businessId: business.id, email: body.email, name: body.name, passwordHash, role: "OWNER" } });
      });
      if (industryKey) {
        await provisionIndustryTemplate(user.businessId!, industryKey).catch(err => req.log.error({ err, businessId: user.businessId }, "Template provisioning failed"));
      }
      await db.auditLog.create({ data: { businessId: user.businessId, actorId: user.id, action: "onboarding.account_created", entityType: "Business", entityId: user.businessId ?? undefined } }).catch(() => undefined);
      return reply.code(201).send({ user: await startSession(reply, user), next: "/onboarding" });
    } catch (err: any) {
      if (err?.code === "P2002") return reply.code(409).send({ error: "Email is already registered" });
      throw err;
    }
  });

  app.post("/auth/login", { config: authRateLimit }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Email and password are required" });
    const { email, password } = parsed.data;
    const user = await db.user.findUnique({ where: { email } });
    // Always run bcrypt so response time does not reveal whether the email exists.
    const ok = await bcrypt.compare(password, user?.passwordHash ?? (await getDummyHash()));
    const now = new Date();
    const locked = !!user?.lockedUntil && user.lockedUntil > now;
    if (!user || !user.active || !ok || locked) {
      // Per-account lockout complements the per-IP rate limit, which a botnet can spread across addresses.
      if (user && !ok && !locked) {
        const failures = user.failedLoginCount + 1;
        await db.user.update({
          where: { id: user.id },
          data: failures >= MAX_FAILED_LOGINS ? { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) } : { failedLoginCount: failures },
        });
      }
      req.log.warn({ userId: user?.id ?? null, locked }, "Failed login");
      // One message for every failure, so it never reveals whether an account exists or is locked.
      return reply.code(401).send({ error: `Invalid email or password. After ${MAX_FAILED_LOGINS} failed attempts, sign-in is paused for ${LOCKOUT_MINUTES} minutes.` });
    }
    if (user.failedLoginCount || user.lockedUntil) await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    return { user: await startSession(reply, user) };
  });

  app.post("/auth/password/forgot", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const parsed = passwordResetRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "A valid email is required" });
    const user = await db.user.findUnique({ where: { email: parsed.data.email }, select: { id: true, businessId: true, active: true } });
    let rawToken: string | undefined;
    if (user?.active) {
      rawToken = randomBytes(32).toString("hex");
      await db.$transaction([
        db.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
        db.passwordResetToken.create({ data: { userId: user.id, businessId: user.businessId, tokenHash: tokenHash(rawToken), expiresAt: new Date(Date.now() + 30 * 60_000) } }),
      ]);
      const resetUrl = `${(config.appUrl.split(",")[0]?.trim() || "http://localhost:3000").replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(rawToken)}`;
      const delivery = await sendTransactionalEmail({ to: parsed.data.email, subject: "Reset your OceanBrown password", text: `Reset your password within 30 minutes: ${resetUrl}`, html: `<p>Reset your OceanBrown password within 30 minutes:</p><p><a href="${resetUrl}">Reset password</a></p>` }).catch(err => { req.log.error({ err, userId: user.id }, "Password reset email failed"); return { delivered: false as const }; });
      req.log.info({ userId: user.id, delivered: delivery.delivered }, "Password reset requested");
    }
    return {
      ok: true,
      message: "If that account exists, password reset instructions have been prepared.",
      ...(config.devExposeTokens && rawToken ? { resetToken: rawToken } : {}),
    };
  });

  app.post("/auth/password/reset", { config: authRateLimit }, async (req, reply) => {
    const parsed = passwordResetSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "A valid reset token and 10-character password are required" });
    const now = new Date();
    const reset = await db.passwordResetToken.findUnique({ where: { tokenHash: tokenHash(parsed.data.token) }, include: { user: true } });
    if (!reset || reset.usedAt || reset.expiresAt <= now || !reset.user.active) return reply.code(400).send({ error: "This reset link is invalid or has expired" });
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    await db.$transaction([
      db.user.update({ where: { id: reset.userId }, data: { passwordHash, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null } }),
      db.passwordResetToken.update({ where: { id: reset.id }, data: { usedAt: now } }),
      db.passwordResetToken.updateMany({ where: { userId: reset.userId, id: { not: reset.id }, usedAt: null }, data: { usedAt: now } }),
    ]);
    return { ok: true };
  });

  app.post("/auth/logout", async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", { preHandler: requireAuth }, async req => ({ user: req.user, workspaceStatus: req.workspaceStatus ?? null }));
}
