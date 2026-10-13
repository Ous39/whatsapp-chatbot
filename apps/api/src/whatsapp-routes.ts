import type { FastifyInstance } from "fastify";
import { db } from "@oceanbrown/db";
import { decryptSecret, encryptSecret, getPhoneNumberInfo, maskSecret, whatsappConnectionSchema, WhatsAppApiError } from "@oceanbrown/shared";
import { audit, HttpError, requirePermission, tenantId } from "./auth.js";
import { config } from "./config.js";

async function tokenFor(connection: { encryptedAccessToken: string | null }) {
  if (connection.encryptedAccessToken) {
    if (!config.encryptionKey) throw new HttpError(500, "ENCRYPTION_KEY is not configured on the server");
    return decryptSecret(connection.encryptedAccessToken, config.encryptionKey);
  }
  // Single-tenant fallback: a system-user token supplied through the environment.
  if (config.whatsapp.accessToken) return config.whatsapp.accessToken;
  throw new HttpError(422, "No access token saved for this WhatsApp number");
}

function view(c: { id: string; phoneNumberId: string; wabaId: string | null; displayPhone: string | null; verifiedName: string | null; status: string; webhookHealthy: boolean; lastWebhookAt: Date | null; lastError: string | null; encryptedAccessToken: string | null }) {
  return {
    id: c.id,
    phoneNumberId: c.phoneNumberId,
    wabaId: c.wabaId,
    displayPhone: c.displayPhone,
    verifiedName: c.verifiedName,
    status: c.status,
    webhookHealthy: c.webhookHealthy,
    lastWebhookAt: c.lastWebhookAt,
    lastError: c.lastError,
    hasAccessToken: !!c.encryptedAccessToken || !!config.whatsapp.accessToken,
  };
}

export async function registerWhatsAppRoutes(app: FastifyInstance) {
  app.get("/whatsapp/connection", { preHandler: requirePermission("business:*") }, async req => {
    const connection = await db.whatsAppConnection.findFirst({ where: { businessId: tenantId(req) }, orderBy: { createdAt: "asc" } });
    return {
      connection: connection ? view(connection) : null,
      webhookUrl: `${config.publicApiUrl.replace(/\/$/, "")}/webhooks/meta`,
      liveEnabled: config.whatsapp.liveEnabled,
      server: { appSecret: !!config.whatsapp.appSecret, verifyToken: !!config.whatsapp.verifyToken, encryptionKey: !!config.encryptionKey, envAccessToken: maskSecret(config.whatsapp.accessToken) },
    };
  });

  // Create or update the tenant's WhatsApp number. Tokens are encrypted at rest and never returned.
  app.put("/whatsapp/connection", { preHandler: requirePermission("business:*") }, async (req, reply) => {
    const businessId = tenantId(req);
    const parsed = whatsappConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid connection details", details: parsed.error.flatten() });
    const { phoneNumberId, wabaId, displayPhone, accessToken } = parsed.data;
    if (accessToken && !config.encryptionKey) return reply.code(500).send({ error: "Set ENCRYPTION_KEY on the server before saving access tokens" });
    const taken = await db.whatsAppConnection.findUnique({ where: { phoneNumberId }, select: { businessId: true } });
    if (taken && taken.businessId !== businessId) return reply.code(409).send({ error: "This phone number ID is already connected to another workspace" });
    const existing = await db.whatsAppConnection.findFirst({ where: { businessId }, orderBy: { createdAt: "asc" } });
    const data = {
      phoneNumberId,
      wabaId: wabaId || null,
      displayPhone: displayPhone || null,
      status: "PENDING",
      lastError: null,
      ...(accessToken ? { encryptedAccessToken: await encryptSecret(accessToken, config.encryptionKey!) } : {}),
    };
    const row = existing ? await db.whatsAppConnection.update({ where: { id: existing.id }, data }) : await db.whatsAppConnection.create({ data: { ...data, businessId } });
    await audit("whatsapp.connection.save", "WhatsAppConnection", row.id, req, { phoneNumberId, tokenUpdated: !!accessToken });
    return view(row);
  });

  // Calls Meta with the saved token. On success the number is marked CONNECTED.
  app.post("/whatsapp/connection/test", { preHandler: requirePermission("business:*"), config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const businessId = tenantId(req);
    const connection = await db.whatsAppConnection.findFirst({ where: { businessId }, orderBy: { createdAt: "asc" } });
    if (!connection) return reply.code(404).send({ error: "Save a WhatsApp number first" });
    try {
      const info = await getPhoneNumberInfo({ accessToken: await tokenFor(connection), phoneNumberId: connection.phoneNumberId, apiVersion: config.whatsapp.graphVersion });
      const row = await db.whatsAppConnection.update({
        where: { id: connection.id },
        data: { status: "CONNECTED", displayPhone: info.displayPhone ?? connection.displayPhone, verifiedName: info.verifiedName ?? null, lastError: null },
      });
      await audit("whatsapp.connection.test", "WhatsAppConnection", row.id, req, { ok: true });
      return { ok: true, qualityRating: info.qualityRating, connection: view(row) };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const message = err instanceof WhatsAppApiError ? `${err.message}${err.code ? ` (code ${err.code})` : ""}` : "Could not reach WhatsApp";
      await db.whatsAppConnection.update({ where: { id: connection.id }, data: { status: "ERROR", lastError: message.slice(0, 500) } });
      return reply.code(502).send({ error: message });
    }
  });

  app.delete("/whatsapp/connection", { preHandler: requirePermission("business:*") }, async (req, reply) => {
    const businessId = tenantId(req);
    const removed = await db.whatsAppConnection.deleteMany({ where: { businessId } });
    await audit("whatsapp.connection.delete", "WhatsAppConnection", undefined, req, { count: removed.count });
    return reply.code(204).send();
  });
}
