import type { FastifyInstance } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@oceanbrown/db";
import { campaignSchema, customerImportSchema, listMessageTemplates, passwordResetSchema, teamInviteSchema, VERIFIED_CONNECTION } from "@oceanbrown/shared";
import { z } from "zod";
import { audit, requireAuth, requirePermission, tenantId } from "./auth.js";
import { config } from "./config.js";
import { enqueue } from "./queue.js";
import { whatsAppTokenFor } from "./whatsapp-routes.js";
import { sendTransactionalEmail } from "./email.js";

const idParam = (req: { params: unknown }) => String((req.params as { id?: string }).id ?? "");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const bad = (reply: any, error: string, details?: unknown) => reply.code(400).send({ error, ...(details ? { details } : {}) });
const PLAN_LIMITS = { FREE: 250, STARTER: 2_500, GROWTH: 10_000, PRO: 50_000 } as const;

function campaignAudience(businessId: string, tag?: string | null) {
  return { businessId, consent: true, optedOutAt: null, ...(tag ? { tags: { has: tag } } : {}) };
}

export async function registerCommercialRoutes(app: FastifyInstance) {
  // ---------- Contact import and reusable audiences ----------
  app.post("/customers/import", { preHandler: requirePermission("customer:*") }, async (req, reply) => {
    const parsed = customerImportSchema.safeParse(req.body);
    if (!parsed.success) return bad(reply, "Import contains invalid customer records", parsed.error.flatten());
    const businessId = tenantId(req);
    const unique = new Map(parsed.data.customers.map(row => [row.phone, row]));
    const rows = [...unique.values()];
    const existing = await db.customer.findMany({ where: { businessId, phone: { in: rows.map(row => row.phone) } }, select: { phone: true } });
    const existingPhones = new Set(existing.map(row => row.phone));
    await db.$transaction(async tx => {
      for (const row of rows) {
        if (existingPhones.has(row.phone) && !parsed.data.updateExisting) continue;
        await tx.customer.upsert({
          where: { businessId_phone: { businessId, phone: row.phone } },
          create: { ...row, businessId },
          update: { name: row.name, email: row.email, consent: row.consent, tags: row.tags },
        });
      }
    });
    const skipped = parsed.data.updateExisting ? 0 : existingPhones.size;
    const result = { received: parsed.data.customers.length, unique: rows.length, created: rows.filter(row => !existingPhones.has(row.phone)).length, updated: parsed.data.updateExisting ? existingPhones.size : 0, skipped };
    await audit("customer.import", "Customer", undefined, req, result);
    return reply.code(201).send(result);
  });

  app.patch("/customers/:id/preferences", { preHandler: requirePermission("customer:*") }, async (req, reply) => {
    const parsed = z.object({ consent: z.boolean().optional(), tags: z.array(z.string().trim().min(1).max(40)).max(20).optional() }).safeParse(req.body);
    if (!parsed.success || (!parsed.data.tags && parsed.data.consent === undefined)) return bad(reply, "Consent or tags are required");
    const businessId = tenantId(req);
    const found = await db.customer.findFirst({ where: { id: idParam(req), businessId }, select: { id: true } });
    if (!found) return reply.code(404).send({ error: "Customer not found" });
    return db.customer.update({ where: { id: found.id }, data: parsed.data });
  });

  app.get("/segments", { preHandler: requirePermission("customer:read") }, async req => {
    const businessId = tenantId(req);
    const rows = await db.customer.findMany({ where: { businessId }, select: { tags: true, consent: true, optedOutAt: true } });
    const counts = new Map<string, number>();
    for (const row of rows) if (row.consent && !row.optedOutAt) for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  });

  // ---------- Meta template synchronization ----------
  app.get("/templates", { preHandler: requirePermission("business:*") }, async req =>
    db.messageTemplate.findMany({ where: { businessId: tenantId(req) }, orderBy: [{ status: "asc" }, { name: "asc" }, { language: "asc" }] }),
  );

  app.post("/templates/sync", { preHandler: requirePermission("business:*"), config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const businessId = tenantId(req);
    const connection = await db.whatsAppConnection.findFirst({ where: { businessId, ...VERIFIED_CONNECTION } });
    if (!connection?.wabaId) return reply.code(422).send({ error: "Connect WhatsApp and save the WABA ID before syncing templates" });
    const templates = await listMessageTemplates({ accessToken: await whatsAppTokenFor(connection), phoneNumberId: connection.phoneNumberId, apiVersion: config.whatsapp.graphVersion }, connection.wabaId);
    const now = new Date();
    await db.$transaction(templates.map(template => db.messageTemplate.upsert({
      where: { businessId_externalId: { businessId, externalId: template.id } },
      create: { businessId, externalId: template.id, name: template.name, language: template.language, category: template.category, status: template.status, components: template.components as any, qualityScore: template.qualityScore, lastSyncedAt: now },
      update: { name: template.name, language: template.language, category: template.category, status: template.status, components: template.components as any, qualityScore: template.qualityScore, lastSyncedAt: now },
    })));
    await audit("template.sync", "MessageTemplate", undefined, req, { count: templates.length });
    return { count: templates.length, approved: templates.filter(row => row.status === "APPROVED").length };
  });

  // ---------- Campaign execution ----------
  app.get("/campaigns", { preHandler: requirePermission("business:*") }, async req => {
    const businessId = tenantId(req);
    return db.campaign.findMany({ where: { businessId }, orderBy: { updatedAt: "desc" }, take: 200 });
  });

  app.post("/campaigns", { preHandler: requirePermission("business:*") }, async (req, reply) => {
    const parsed = campaignSchema.safeParse(req.body);
    if (!parsed.success) return bad(reply, "Campaign name and an approved template are required", parsed.error.flatten());
    const businessId = tenantId(req);
    const template = await db.messageTemplate.findFirst({ where: { businessId, name: parsed.data.templateName, language: parsed.data.language, status: "APPROVED" } });
    if (!template) return reply.code(422).send({ error: "That approved template and language are not available. Sync templates first." });
    const scheduledAt = parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null;
    const row = await db.campaign.create({ data: { businessId, name: parsed.data.name, templateName: parsed.data.templateName, language: parsed.data.language, audienceTag: parsed.data.audienceTag, audience: { consent: true, optedOut: false, tag: parsed.data.audienceTag ?? null }, scheduledAt } });
    await audit("campaign.create", "Campaign", row.id, req, { templateName: row.templateName });
    return reply.code(201).send(row);
  });

  app.get("/campaigns/:id/preview", { preHandler: requirePermission("business:*") }, async (req, reply) => {
    const businessId = tenantId(req);
    const campaign = await db.campaign.findFirst({ where: { id: idParam(req), businessId } });
    if (!campaign) return reply.code(404).send({ error: "Campaign not found" });
    const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { plan: true, monthlyMessageLimit: true, currentPeriodStart: true } });
    const [audienceCount, used] = await Promise.all([
      db.customer.count({ where: campaignAudience(businessId, campaign.audienceTag) }),
      db.campaignRecipient.count({ where: { businessId, status: { in: ["SENT", "DELIVERED", "READ"] }, sentAt: { gte: business.currentPeriodStart } } }),
    ]);
    return { audienceCount, plan: business.plan, monthlyLimit: business.monthlyMessageLimit, used, available: Math.max(0, business.monthlyMessageLimit - used), canStart: audienceCount > 0 && used + audienceCount <= business.monthlyMessageLimit };
  });

  app.post("/campaigns/:id/start", { preHandler: requirePermission("business:*"), config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const businessId = tenantId(req);
    const campaign = await db.campaign.findFirst({ where: { id: idParam(req), businessId } });
    if (!campaign) return reply.code(404).send({ error: "Campaign not found" });
    if (!["DRAFT", "SCHEDULED"].includes(campaign.status)) return reply.code(409).send({ error: `Campaign cannot start from ${campaign.status}` });
    if (!config.whatsapp.liveEnabled) return reply.code(422).send({ error: "Live WhatsApp delivery is disabled on the server" });
    const business = await db.business.findUniqueOrThrow({ where: { id: businessId } });
    if (business.planStatus !== "ACTIVE") return reply.code(402).send({ error: "The workspace plan is not active" });
    const [audienceCount, used, reservedRecipients, scheduled] = await Promise.all([
      db.customer.count({ where: campaignAudience(businessId, campaign.audienceTag) }),
      db.campaignRecipient.count({ where: { businessId, status: { in: ["SENT", "DELIVERED", "READ"] }, sentAt: { gte: business.currentPeriodStart } } }),
      db.campaignRecipient.count({ where: { businessId, status: { in: ["PENDING", "QUEUED"] }, createdAt: { gte: business.currentPeriodStart } } }),
      db.campaign.aggregate({ where: { businessId, id: { not: campaign.id }, status: "SCHEDULED", createdAt: { gte: business.currentPeriodStart } }, _sum: { totalCount: true } }),
    ]);
    if (!audienceCount) return reply.code(422).send({ error: "No consented customers match this audience" });
    const reserved = reservedRecipients + (scheduled._sum.totalCount ?? 0);
    const committed = used + reserved;
    if (committed + audienceCount > business.monthlyMessageLimit) return reply.code(402).send({ error: "This campaign exceeds the workspace monthly message allowance", used, reserved, audienceCount, limit: business.monthlyMessageLimit });
    const scheduledAt = campaign.scheduledAt && campaign.scheduledAt > new Date() ? campaign.scheduledAt : null;
    await db.campaign.update({ where: { id: campaign.id }, data: { status: scheduledAt ? "SCHEDULED" : "RUNNING", totalCount: audienceCount, lastError: null } });
    const delay = scheduledAt ? scheduledAt.getTime() - Date.now() : 0;
    await enqueue("start-campaign", { campaignId: campaign.id }, `campaign-${campaign.id}`, req.log, delay);
    await audit("campaign.start", "Campaign", campaign.id, req, { audienceCount, scheduledAt });
    return reply.code(202).send({ ok: true, audienceCount, scheduledAt });
  });

  app.post("/campaigns/:id/cancel", { preHandler: requirePermission("business:*") }, async (req, reply) => {
    const businessId = tenantId(req);
    const row = await db.campaign.findFirst({ where: { id: idParam(req), businessId } });
    if (!row) return reply.code(404).send({ error: "Campaign not found" });
    if (["COMPLETED", "CANCELLED"].includes(row.status)) return reply.code(409).send({ error: `Campaign is already ${row.status.toLowerCase()}` });
    await db.campaign.update({ where: { id: row.id }, data: { status: "CANCELLED", completedAt: new Date() } });
    await db.campaignRecipient.updateMany({ where: { campaignId: row.id, status: { in: ["PENDING", "QUEUED"] } }, data: { status: "SKIPPED", error: "Campaign cancelled" } });
    await audit("campaign.cancel", "Campaign", row.id, req);
    return { ok: true };
  });

  // ---------- Plans and onboarding ----------
  app.get("/billing/usage", { preHandler: requireAuth }, async req => {
    const businessId = tenantId(req);
    const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { plan: true, planStatus: true, monthlyMessageLimit: true, currentPeriodStart: true, currentPeriodEnd: true } });
    const used = await db.campaignRecipient.count({ where: { businessId, status: { in: ["SENT", "DELIVERED", "READ"] }, sentAt: { gte: business.currentPeriodStart } } });
    return { ...business, used, remaining: Math.max(0, business.monthlyMessageLimit - used), plans: Object.entries(PLAN_LIMITS).map(([name, limit]) => ({ name, limit })) };
  });

  app.patch("/business/onboarding", { preHandler: requirePermission("business:*") }, async req => {
    const body = z.object({ completed: z.boolean() }).parse(req.body);
    return db.business.update({ where: { id: tenantId(req) }, data: { onboardingCompletedAt: body.completed ? new Date() : null }, select: { onboardingCompletedAt: true } });
  });

  // Platform administration remains inaccessible to tenant owners.
  app.get("/platform/businesses", { preHandler: requireAuth }, async (req, reply) => {
    if (req.user.role !== "SUPER_ADMIN") return reply.code(403).send({ error: "Platform administrator access required" });
    return db.business.findMany({ select: { id: true, name: true, slug: true, plan: true, planStatus: true, monthlyMessageLimit: true, createdAt: true, _count: { select: { users: true, customers: true, campaigns: true } } }, orderBy: { createdAt: "desc" } });
  });

  app.patch("/platform/businesses/:id/plan", { preHandler: requireAuth }, async (req, reply) => {
    if (req.user.role !== "SUPER_ADMIN") return reply.code(403).send({ error: "Platform administrator access required" });
    const parsed = z.object({ plan: z.enum(["FREE", "STARTER", "GROWTH", "PRO"]), status: z.enum(["ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"]).default("ACTIVE"), monthlyMessageLimit: z.number().int().positive().max(10_000_000).optional() }).safeParse(req.body);
    if (!parsed.success) return bad(reply, "Invalid plan configuration");
    const limit = parsed.data.monthlyMessageLimit ?? PLAN_LIMITS[parsed.data.plan];
    return db.business.update({ where: { id: idParam(req) }, data: { plan: parsed.data.plan, planStatus: parsed.data.status, monthlyMessageLimit: limit, currentPeriodStart: new Date() } });
  });

  // ---------- Secure team invitations ----------
  app.get("/team/invites", { preHandler: requirePermission("team:*") }, async req =>
    db.teamInvite.findMany({ where: { businessId: tenantId(req), acceptedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, email: true, name: true, role: true, expiresAt: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
  );

  app.post("/team/invites", { preHandler: requirePermission("team:*") }, async (req, reply) => {
    const parsed = teamInviteSchema.safeParse(req.body);
    if (!parsed.success) return bad(reply, "Name, email and role are required", parsed.error.flatten());
    if (!config.isDevOrTest && !config.email.resendApiKey) return reply.code(503).send({ error: "Transactional email is not configured" });
    if (await db.user.findUnique({ where: { email: parsed.data.email }, select: { id: true } })) return reply.code(409).send({ error: "That email already belongs to an account" });
    const rawToken = randomBytes(32).toString("hex");
    const row = await db.teamInvite.create({ data: { businessId: tenantId(req), invitedById: req.user.id, ...parsed.data, tokenHash: hash(rawToken), expiresAt: new Date(Date.now() + 7 * 86_400_000) }, select: { id: true, email: true, name: true, role: true, expiresAt: true } });
    const inviteUrl = `${(config.appUrl.split(",")[0]?.trim() || "http://localhost:3000").replace(/\/$/, "")}/accept-invite?token=${encodeURIComponent(rawToken)}`;
    const delivery = await sendTransactionalEmail({ to: row.email, subject: "Join your OceanBrown workspace", text: `Accept your invitation within 7 days: ${inviteUrl}`, html: `<p>You have been invited to an OceanBrown workspace.</p><p><a href="${inviteUrl}">Accept invitation</a></p>` }).catch(err => { req.log.error({ err, inviteId: row.id }, "Team invitation email failed"); return { delivered: false as const }; });
    req.log.info({ inviteId: row.id, delivered: delivery.delivered }, "Team invitation created");
    return reply.code(201).send({ ...row, ...(config.devExposeTokens ? { inviteToken: rawToken } : {}) });
  });

  app.get("/team/invites/accept/:token", async (req, reply) => {
    const token = String((req.params as { token?: string }).token ?? "");
    const invite = await db.teamInvite.findUnique({ where: { tokenHash: hash(token) }, include: { business: { select: { name: true } } } });
    if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) return reply.code(404).send({ error: "Invitation is invalid or expired" });
    return { name: invite.name, email: invite.email, role: invite.role, businessName: invite.business.name, expiresAt: invite.expiresAt };
  });

  app.post("/team/invites/accept", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = passwordResetSchema.safeParse(req.body);
    if (!parsed.success) return bad(reply, "A valid invitation token and 10-character password are required");
    const invite = await db.teamInvite.findUnique({ where: { tokenHash: hash(parsed.data.token) } });
    if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) return reply.code(400).send({ error: "Invitation is invalid or expired" });
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const user = await db.$transaction(async tx => {
      const created = await tx.user.create({ data: { businessId: invite.businessId, email: invite.email, name: invite.name, role: invite.role, passwordHash } });
      await tx.teamInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
      return created;
    });
    return reply.code(201).send({ ok: true, userId: user.id });
  });
}
