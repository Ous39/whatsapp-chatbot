import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { db } from "@oceanbrown/db";
import { can, loginSchema, registerSchema, type Role, type SessionUser } from "@oceanbrown/shared";
import { config } from "./config.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: SessionUser;
  }
}

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
  try {
    const decoded = await req.jwtVerify<{ sub?: string; id?: string }>();
    sub = decoded.sub ?? decoded.id ?? "";
  } catch {
    return reply.code(401).send({ error: "Authentication required" });
  }
  const user = sub ? await db.user.findUnique({ where: { id: sub }, select: { id: true, businessId: true, role: true, email: true, name: true, active: true } }) : null;
  if (!user?.active) {
    reply.clearCookie(COOKIE, { path: "/" });
    return reply.code(401).send({ error: "Authentication required" });
  }
  req.user = { id: user.id, businessId: user.businessId, role: user.role as Role, email: user.email, name: user.name };
}

export function requirePermission(permission: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(req, reply);
    if (reply.sent) return;
    if (!can(req.user.role, permission)) return reply.code(403).send({ error: "Permission denied" });
  };
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
  reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: config.isProd, path: "/", maxAge: config.sessionHours * 3600 });
  const session: SessionUser = { id: user.id, businessId: user.businessId, role: user.role as Role, email: user.email, name: user.name };
  return session;
}

const authRateLimit = { rateLimit: { max: 10, timeWindow: "1 minute" } };

export async function registerAuth(app: FastifyInstance) {
  app.post("/auth/register", { config: authRateLimit }, async (req, reply) => {
    if (!config.allowSignup) return reply.code(403).send({ error: "Self-service registration is disabled" });
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Name, email, business name and a 10-character password are required", details: parsed.error.flatten() });
    const body = parsed.data;
    if (await db.user.findUnique({ where: { email: body.email }, select: { id: true } })) return reply.code(409).send({ error: "Email is already registered" });
    const base = body.businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 45) || "business";
    const slug = `${base}-${crypto.randomUUID().slice(0, 8)}`;
    const passwordHash = await bcrypt.hash(body.password, 12);
    try {
      const user = await db.$transaction(async tx => {
        const business = await tx.business.create({ data: { name: body.businessName, slug, industry: body.industry ?? "Other", timezone: "Africa/Banjul" } });
        return tx.user.create({ data: { businessId: business.id, email: body.email, name: body.name, passwordHash, role: "OWNER" } });
      });
      return reply.code(201).send({ user: await startSession(reply, user) });
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
    if (!user || !user.active || !ok) {
      req.log.warn({ email }, "Failed login");
      return reply.code(401).send({ error: "Invalid credentials" });
    }
    return { user: await startSession(reply, user) };
  });

  app.post("/auth/logout", async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", { preHandler: requireAuth }, async req => ({ user: req.user }));
}
