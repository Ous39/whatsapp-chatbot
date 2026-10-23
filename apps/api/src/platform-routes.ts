// Provider administration for OceanBrown staff (SUPER_ADMIN). Customers never reach these routes.
// Every change is written to the audit log of the business it affects, so customers can see it too.
import type { FastifyInstance } from "fastify";
import { db } from "@oceanbrown/db";
import { INDUSTRIES, INDUSTRY_KEYS, isIndustryKey, validateTemplateDefinition } from "@oceanbrown/shared";
import { z } from "zod";
import { platformAudit, requirePlatformAdmin } from "./auth.js";
import { onboardingFor } from "./onboarding-routes.js";
import { currentTemplate } from "./templates.js";
import { connectionView, refreshConnection, registerNumber, saveAssistedConnection, testConnection } from "./whatsapp-routes.js";

const PLAN_LIMITS = { FREE: 250, STARTER: 2_500, GROWTH: 10_000, PRO: 50_000 } as const;
const idParam = (req: { params: unknown }) => String((req.params as { id?: string }).id ?? "");

export async function registerPlatformRoutes(app: FastifyInstance) {
  const admin = { preHandler: requirePlatformAdmin };

  /** One screen of operational health. */
  app.get("/platform/overview", admin, async () => {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
    const [businesses, suspended, connectionsError, openHelp, failedWebhooks, unmatchedWebhooks, stuckMessages, failedAttempts] = await Promise.all([
      db.business.count(),
      db.business.count({ where: { planStatus: { in: ["SUSPENDED", "CANCELLED"] } } }),
      db.whatsAppConnection.count({ where: { status: "ERROR" } }),
      db.supportRequest.count({ where: { status: { not: "RESOLVED" } } }),
      db.webhookEvent.count({ where: { status: "FAILED", receivedAt: { gte: dayAgo } } }),
      db.webhookEvent.count({ where: { status: "UNMATCHED", receivedAt: { gte: dayAgo } } }),
      db.message.count({ where: { direction: "OUTBOUND", status: "QUEUED", createdAt: { lt: tenMinutesAgo, gte: dayAgo } } }),
      db.auditLog.count({ where: { action: { in: ["onboarding.whatsapp.cancelled", "onboarding.whatsapp.error"] }, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
    ]);
    return { businesses, suspended, connectionsError, openHelp, failedWebhooks24h: failedWebhooks, unmatchedWebhooks24h: unmatchedWebhooks, stuckOutbound: stuckMessages, failedOnboardingAttempts7d: failedAttempts };
  });

  /** All customer organisations with onboarding and connection state. */
  app.get("/platform/businesses", admin, async () => {
    const rows = await db.business.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true, name: true, slug: true, industry: true, plan: true, planStatus: true, monthlyMessageLimit: true, createdAt: true, onboardingCompletedAt: true, automationEnabled: true,
        users: { where: { role: { in: ["OWNER", "SUPER_ADMIN"] } }, select: { email: true }, take: 1 },
        whatsappConnections: { select: { status: true, displayPhone: true, lastWebhookAt: true, lastError: true, ownershipVerifiedAt: true }, take: 1 },
        _count: { select: { users: true, customers: true, campaigns: true, supportRequests: { where: { status: { not: "RESOLVED" } } } } },
      },
    });
    return rows.map(({ users, whatsappConnections, ...b }) => ({ ...b, ownerEmail: users[0]?.email ?? null, whatsapp: whatsappConnections[0] ?? null }));
  });

  app.get("/platform/businesses/:id", admin, async (req, reply) => {
    const id = idParam(req);
    const business = await db.business.findUnique({ where: { id }, select: { id: true, name: true, slug: true, industry: true, plan: true, planStatus: true, suspendedReason: true, monthlyMessageLimit: true, createdAt: true, onboardingCompletedAt: true, automationEnabled: true, businessFacts: true } });
    if (!business) return reply.code(404).send({ error: "Business not found" });
    const [status, users, connection, help, activity, installation] = await Promise.all([
      onboardingFor(id),
      db.user.findMany({ where: { businessId: id }, select: { id: true, name: true, email: true, role: true, active: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
      db.whatsAppConnection.findFirst({ where: { businessId: id }, orderBy: { createdAt: "asc" } }),
      db.supportRequest.findMany({ where: { businessId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
      db.auditLog.findMany({ where: { businessId: id }, orderBy: { createdAt: "desc" }, take: 60, select: { action: true, entityType: true, createdAt: true, metadata: true, actorId: true } }),
      db.templateInstallation.findFirst({ where: { businessId: id }, orderBy: { updatedAt: "desc" } }),
    ]);
    return { business, status, users, connection: connection ? connectionView(connection, true) : null, helpRequests: help, activity, template: installation };
  });

  app.patch("/platform/businesses/:id/plan", admin, async (req, reply) => {
    const parsed = z.object({ plan: z.enum(["FREE", "STARTER", "GROWTH", "PRO"]), monthlyMessageLimit: z.number().int().positive().max(10_000_000).optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid plan configuration" });
    const id = idParam(req);
    const limit = parsed.data.monthlyMessageLimit ?? PLAN_LIMITS[parsed.data.plan];
    const row = await db.business.update({ where: { id }, data: { plan: parsed.data.plan, monthlyMessageLimit: limit, currentPeriodStart: new Date() }, select: { id: true, plan: true, monthlyMessageLimit: true } });
    await platformAudit(req, "platform.plan_changed", id, "Business", id, { plan: row.plan, limit });
    return row;
  });

  app.post("/platform/businesses/:id/suspend", admin, async (req, reply) => {
    const parsed = z.object({ reason: z.string().trim().min(3).max(500) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Give a reason for the suspension" });
    const id = idParam(req);
    await db.business.update({ where: { id }, data: { planStatus: "SUSPENDED", suspendedReason: parsed.data.reason } });
    await platformAudit(req, "platform.suspended", id, "Business", id, { reason: parsed.data.reason });
    return { ok: true };
  });

  app.post("/platform/businesses/:id/reactivate", admin, async req => {
    const id = idParam(req);
    await db.business.update({ where: { id }, data: { planStatus: "ACTIVE", suspendedReason: null } });
    await platformAudit(req, "platform.reactivated", id, "Business", id);
    return { ok: true };
  });

  // ---------- Assisted WhatsApp setup ----------
  app.put("/platform/businesses/:id/whatsapp", admin, async req => {
    const row = await saveAssistedConnection(idParam(req), req.body, req);
    return connectionView(row, true);
  });

  app.post("/platform/businesses/:id/whatsapp/test", admin, async req => {
    const row = await testConnection(idParam(req), req);
    return { ok: true, connection: connectionView(row, true) };
  });

  app.post("/platform/businesses/:id/whatsapp/register", admin, async (req, reply) => {
    const id = idParam(req);
    const connection = await db.whatsAppConnection.findFirst({ where: { businessId: id }, orderBy: { createdAt: "asc" } });
    if (!connection) return reply.code(404).send({ error: "No WhatsApp number saved for this business" });
    const result = await registerNumber(connection.id);
    const row = await refreshConnection(connection.id);
    await platformAudit(req, "whatsapp.registered", id, "WhatsAppConnection", connection.id, { ok: result.ok, error: result.ok ? null : result.error.staffHint });
    return result.ok ? { ok: true, connection: connectionView(row, true) } : reply.code(502).send({ error: result.error.message, staffHint: result.error.staffHint });
  });

  app.post("/platform/businesses/:id/whatsapp/check", admin, async (req, reply) => {
    const id = idParam(req);
    const connection = await db.whatsAppConnection.findFirst({ where: { businessId: id }, orderBy: { createdAt: "asc" } });
    if (!connection) return reply.code(404).send({ error: "No WhatsApp number saved for this business" });
    return { connection: connectionView(await refreshConnection(connection.id), true) };
  });

  // ---------- Help requests ----------
  app.get("/platform/support-requests", admin, async req => {
    const status = (req.query as { status?: string }).status;
    return db.supportRequest.findMany({
      where: status && ["OPEN", "IN_PROGRESS", "RESOLVED"].includes(status) ? { status } : { status: { not: "RESOLVED" } },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { business: { select: { id: true, name: true } } },
    });
  });

  app.patch("/platform/support-requests/:id", admin, async (req, reply) => {
    const parsed = z.object({ status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]), staffNote: z.string().trim().max(2000).optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid update" });
    const id = idParam(req);
    const row = await db.supportRequest.update({ where: { id }, data: { status: parsed.data.status, ...(parsed.data.staffNote !== undefined ? { staffNote: parsed.data.staffNote } : {}), resolvedAt: parsed.data.status === "RESOLVED" ? new Date() : null } });
    await platformAudit(req, "support.updated", row.businessId, "SupportRequest", row.id, { status: row.status });
    return row;
  });

  /** Recent failed or abandoned WhatsApp connection attempts, with the friendly reason shown to the customer. */
  app.get("/platform/onboarding-attempts", admin, async () => {
    const rows = await db.auditLog.findMany({
      where: { action: { in: ["onboarding.whatsapp.cancelled", "onboarding.whatsapp.error"] }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { business: { select: { id: true, name: true } } },
    });
    return rows.map(r => ({ at: r.createdAt, business: r.business, action: r.action, details: r.metadata }));
  });

  // ---------- Industry templates ----------
  app.get("/platform/templates", admin, async () => {
    const versions = await db.industryTemplate.groupBy({ by: ["key"], _max: { version: true }, _count: { _all: true } });
    const installs = await db.templateInstallation.groupBy({ by: ["industry", "version"], _count: { _all: true } });
    return INDUSTRY_KEYS.map(key => {
      const v = versions.find(x => x.key === key);
      return {
        key,
        label: INDUSTRIES[key].label,
        sensitive: INDUSTRIES[key].sensitive,
        latestVersion: v?._max.version ?? INDUSTRIES[key].version,
        customVersions: v?._count._all ?? 0,
        installations: installs.filter(i => i.industry === key).map(i => ({ version: i.version, businesses: i._count._all })),
      };
    });
  });

  app.get("/platform/templates/:id", admin, async (req, reply) => {
    const key = idParam(req);
    if (!isIndustryKey(key)) return reply.code(404).send({ error: "Unknown industry" });
    const history = await db.industryTemplate.findMany({ where: { key }, orderBy: { version: "desc" }, take: 20, select: { version: true, notes: true, createdAt: true, createdById: true } });
    return { template: await currentTemplate(key), history };
  });

  /** Publishes a new version of a master template. Existing businesses keep their copy until they review the update. */
  app.post("/platform/templates/:id", admin, async (req, reply) => {
    const key = idParam(req);
    if (!isIndustryKey(key)) return reply.code(404).send({ error: "Unknown industry" });
    const parsed = z.object({ definition: z.unknown(), notes: z.string().trim().max(500).optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Send the template definition" });
    const current = await currentTemplate(key);
    const version = current.version + 1;
    const checked = validateTemplateDefinition({ ...(parsed.data.definition as object), key, version });
    if (!checked.ok) return reply.code(400).send({ error: "The template is not valid", details: checked.errors });
    const row = await db.industryTemplate.create({ data: { key, version, definition: checked.template as any, notes: parsed.data.notes, createdById: req.user.id } });
    await platformAudit(req, "platform.template_published", null, "IndustryTemplate", row.id, { key, version, notes: parsed.data.notes });
    return reply.code(201).send({ key, version });
  });
}
