import type { FastifyInstance } from "fastify";
import { db } from "@oceanbrown/db";
import { computeOnboarding, INDUSTRY_KEYS, isIndustryKey, mapSignupError, type MetaPhoneStatus, type OnboardingAttempt } from "@oceanbrown/shared";
import { z } from "zod";
import { audit, requireAuth, requirePermission, tenantId } from "./auth.js";
import { config } from "./config.js";
import { sendTransactionalEmail } from "./email.js";
import { applyTemplateUpdate, currentTemplate, installIndustryTemplate, templateUpdateFor } from "./templates.js";

const ATTEMPT_ACTIONS = ["onboarding.whatsapp.started", "onboarding.whatsapp.cancelled", "onboarding.whatsapp.error", "onboarding.whatsapp.connected"];

/** Builds the onboarding status for one business from stored facts. Used by the dashboard and the provider admin. */
export async function onboardingFor(businessId: string) {
  const [business, connection, installation, published, drafts, lastAttemptLog, openHelpRequests] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, industry: true, planStatus: true, onboardingCompletedAt: true, automationEnabled: true } }),
    db.whatsAppConnection.findFirst({ where: { businessId }, orderBy: { createdAt: "asc" } }),
    db.templateInstallation.findFirst({ where: { businessId }, orderBy: { updatedAt: "desc" }, select: { industry: true, version: true } }),
    db.knowledgeSource.count({ where: { businessId, status: "PUBLISHED" } }),
    db.knowledgeSource.count({ where: { businessId, status: { not: "PUBLISHED" } } }),
    db.auditLog.findFirst({ where: { businessId, action: { in: ATTEMPT_ACTIONS } }, orderBy: { createdAt: "desc" }, select: { action: true, createdAt: true, metadata: true } }),
    db.supportRequest.count({ where: { businessId, status: { not: "RESOLVED" } } }),
  ]);
  const event = lastAttemptLog?.action.split(".").pop();
  const lastAttempt: OnboardingAttempt | null =
    lastAttemptLog && event && event !== "connected"
      ? { event: event as OnboardingAttempt["event"], at: lastAttemptLog.createdAt, detail: ((lastAttemptLog.metadata as Record<string, unknown> | null)?.message as string | undefined) ?? null }
      : null;
  return computeOnboarding({
    business,
    template: installation,
    publishedFaqs: published,
    draftFaqs: drafts,
    connection: connection
      ? { status: connection.status, ownershipVerifiedAt: connection.ownershipVerifiedAt, lastWebhookAt: connection.lastWebhookAt, lastError: connection.lastError, displayPhone: connection.displayPhone, verifiedName: connection.verifiedName, metaStatus: (connection.metaStatus as MetaPhoneStatus | null) ?? null, lastCheckedAt: connection.lastCheckedAt }
      : null,
    liveDeliveryEnabled: config.whatsapp.liveEnabled,
    lastAttempt,
    openHelpRequests,
  });
}

const factsSchema = z.record(z.string().regex(/^[a-zA-Z0-9_]{1,40}$/), z.string().max(1000)).refine(v => Object.keys(v).length <= 30, "Too many answers");

export async function registerOnboardingRoutes(app: FastifyInstance) {
  app.get("/onboarding", { preHandler: requireAuth }, async req => {
    const businessId = tenantId(req);
    const [status, business] = await Promise.all([
      onboardingFor(businessId),
      db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, businessFacts: true } }),
    ]);
    return { ...status, businessName: business.name, facts: business.businessFacts ?? {}, embeddedSignupAvailable: !!(config.whatsapp.appId && config.whatsapp.appSecret && config.whatsapp.embeddedSignupConfigId && config.encryptionKey) };
  });

  /** Industry choices with the questions each one asks. Uses the latest master versions. */
  app.get("/onboarding/industries", { preHandler: requireAuth }, async () => {
    const templates = await Promise.all(INDUSTRY_KEYS.map(key => currentTemplate(key)));
    return templates.map(t => ({ key: t.key, label: t.label, description: t.description, sensitive: t.sensitive, notes: t.notes ?? null, version: t.version, menuOptions: t.menuOptions, fields: t.fields, faqTitles: t.faqs.map(f => f.title) }));
  });

  /** Step 2: choose an industry and answer a few questions. Installs this business's own copy of the starter. */
  app.post("/onboarding/industry", { preHandler: requirePermission("business:*"), config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = z.object({ industry: z.string(), facts: factsSchema.default({}) }).safeParse(req.body);
    if (!parsed.success || !isIndustryKey(parsed.data.industry)) return reply.code(400).send({ error: "Choose an industry from the list" });
    const businessId = tenantId(req);
    const result = await installIndustryTemplate(businessId, parsed.data.industry, parsed.data.facts);
    await audit("onboarding.industry", "Business", businessId, req, { industry: result.industry, version: result.version, created: result.created, refreshed: result.refreshed, keptCustomised: result.keptCustomised });
    return { result, status: await onboardingFor(businessId) };
  });

  /** The dashboard reports what happened in Meta's sign-up window so OceanBrown can see failed attempts. */
  app.post("/onboarding/whatsapp/event", { preHandler: requirePermission("business:*"), config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = z.object({ event: z.enum(["started", "cancelled", "error"]), step: z.string().max(80).optional(), code: z.union([z.string().max(20), z.number()]).optional(), message: z.string().max(500).optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid event" });
    const friendly = parsed.data.event === "error" ? mapSignupError(parsed.data.code, parsed.data.message) : parsed.data.event === "cancelled" ? `The Meta window was closed${parsed.data.step ? ` at "${parsed.data.step}"` : ""} before it finished. Nothing was lost; connect again when you're ready.` : undefined;
    await audit(`onboarding.whatsapp.${parsed.data.event}`, "Business", tenantId(req), req, { step: parsed.data.step, code: parsed.data.code, metaMessage: parsed.data.message, message: friendly });
    return { ok: true, message: friendly ?? null };
  });

  /** Step 3: the owner has reviewed the setup. Going live still depends on the WhatsApp checks. */
  app.post("/onboarding/complete", { preHandler: requirePermission("business:*") }, async req => {
    const businessId = tenantId(req);
    await db.business.update({ where: { id: businessId }, data: { onboardingCompletedAt: new Date() } });
    await audit("onboarding.completed", "Business", businessId, req);
    return onboardingFor(businessId);
  });

  // ---------- Help requests ("Ask OceanBrown") ----------
  app.post("/support-requests", { preHandler: requireAuth, config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req, reply) => {
    const parsed = z.object({ topic: z.enum(["WHATSAPP_SETUP", "TEMPLATES", "BILLING", "OTHER"]), message: z.string().trim().min(5).max(2000), contactPhone: z.string().trim().max(30).optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Tell us briefly what you need help with" });
    const businessId = tenantId(req);
    const row = await db.supportRequest.create({ data: { businessId, createdById: req.user.id, ...parsed.data } });
    await audit("support.request", "SupportRequest", row.id, req, { topic: row.topic });
    const supportEmail = process.env.SUPPORT_EMAIL;
    if (supportEmail) {
      const business = await db.business.findUnique({ where: { id: businessId }, select: { name: true } });
      // Business name and topic only; the message stays in the provider admin, behind authentication.
      await sendTransactionalEmail({ to: supportEmail, subject: `Help request: ${row.topic} — ${business?.name ?? businessId}`, text: `A customer asked for help (${row.topic}). Open the provider admin to read and answer it.`, html: `<p>A customer asked for help (<strong>${row.topic}</strong>). Open the provider admin to read and answer it.</p>` }).catch(err => req.log.warn({ err }, "Support notification email failed"));
    }
    return reply.code(201).send({ id: row.id, status: row.status, createdAt: row.createdAt });
  });

  app.get("/support-requests", { preHandler: requireAuth }, async req =>
    db.supportRequest.findMany({ where: { businessId: tenantId(req) }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, topic: true, message: true, status: true, staffNote: true, createdAt: true, resolvedAt: true } }),
  );

  // ---------- Starter template updates ----------
  app.get("/templates/starter", { preHandler: requirePermission("knowledge:read") }, async req => (await templateUpdateFor(tenantId(req))) ?? { industry: null });

  app.post("/templates/starter/apply", { preHandler: requirePermission("knowledge:*") }, async (req, reply) => {
    const parsed = z.object({ add: z.array(z.string().max(80)).max(100).default([]), replace: z.array(z.string().max(80)).max(100).default([]) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid selection" });
    const businessId = tenantId(req);
    const result = await applyTemplateUpdate(businessId, parsed.data);
    await audit("template.update_applied", "TemplateInstallation", businessId, req, result);
    return result;
  });
}
