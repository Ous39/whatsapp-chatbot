import type { FastifyInstance, FastifyRequest } from "fastify";
import { db } from "@oceanbrown/db";
import {
  encryptSecret,
  getPhoneNumberInfo,
  listWabaPhoneNumberIds,
  mayUseEnvToken,
  resolveWhatsAppToken,
  subscribeAppToWaba,
  whatsappConnectionSchema,
  WhatsAppApiError,
  WhatsAppTokenUnavailable,
  type TokenEnv,
} from "@oceanbrown/shared";
import { audit, HttpError, requirePermission, tenantId } from "./auth.js";
import { config } from "./config.js";
import { z } from "zod";

export function tokenEnv(): TokenEnv {
  return { encryptionKey: config.encryptionKey, envAccessToken: config.whatsapp.accessToken, envTokenBusinessId: config.whatsapp.accessTokenBusinessId };
}

export async function whatsAppTokenFor(connection: { businessId: string; encryptedAccessToken: string | null }) {
  try {
    return await resolveWhatsAppToken(connection, tokenEnv());
  } catch (err) {
    if (err instanceof WhatsAppTokenUnavailable) throw new HttpError(422, err.message);
    throw err;
  }
}

type ConnectionRow = { id: string; businessId: string; phoneNumberId: string; wabaId: string | null; displayPhone: string | null; verifiedName: string | null; status: string; webhookHealthy: boolean; lastWebhookAt: Date | null; lastError: string | null; encryptedAccessToken: string | null; ownershipVerifiedAt: Date | null };

function view(c: ConnectionRow) {
  return {
    id: c.id,
    phoneNumberId: c.phoneNumberId,
    wabaId: c.wabaId,
    displayPhone: c.displayPhone,
    verifiedName: c.verifiedName,
    status: c.status,
    ownershipVerified: !!c.ownershipVerifiedAt,
    webhookHealthy: c.webhookHealthy,
    lastWebhookAt: c.lastWebhookAt,
    lastError: c.lastError,
    hasAccessToken: !!c.encryptedAccessToken || mayUseEnvToken(c.businessId, tokenEnv()),
  };
}

/**
 * A phone number id can be held by one workspace. A claim that was never verified carries no messages
 * and cannot send, so another workspace may take it over; this stops squatters blocking the real owner.
 */
async function claimNumber(phoneNumberId: string, businessId: string, req: FastifyRequest) {
  const taken = await db.whatsAppConnection.findUnique({ where: { phoneNumberId }, select: { id: true, businessId: true, ownershipVerifiedAt: true } });
  if (!taken || taken.businessId === businessId) return;
  if (taken.ownershipVerifiedAt) throw new HttpError(409, "This WhatsApp number is already connected to another workspace. Contact OceanBrown support if it belongs to you.");
  await db.whatsAppConnection.delete({ where: { id: taken.id } });
  await audit("whatsapp.connection.unverified_claim_released", "WhatsAppConnection", taken.id, req, { phoneNumberId, previousBusinessId: taken.businessId });
}

/** Proves, with the workspace's own token, that the number belongs to the WABA that token manages. */
async function assertOwnsNumber(graph: { accessToken: string; phoneNumberId: string; apiVersion?: string }, wabaId: string) {
  const ids = await listWabaPhoneNumberIds(graph, wabaId);
  if (!ids.includes(graph.phoneNumberId)) {
    throw new HttpError(403, "This phone number ID is not part of that WhatsApp Business Account, or the token cannot access it. Check the WABA ID, phone number ID and token permissions.");
  }
}

const metaMessage = (err: unknown) => (err instanceof WhatsAppApiError ? `${err.message}${err.code ? ` (code ${err.code})` : ""}` : "Could not reach WhatsApp");

export async function registerWhatsAppRoutes(app: FastifyInstance) {
  app.get("/whatsapp/embedded/config", { preHandler: requirePermission("business:*") }, async () => ({
    enabled: !!(config.whatsapp.appId && config.whatsapp.appSecret && config.whatsapp.embeddedSignupConfigId && config.encryptionKey),
    appId: config.whatsapp.appId ?? null,
    configId: config.whatsapp.embeddedSignupConfigId ?? null,
    graphVersion: config.whatsapp.graphVersion ?? "v23.0",
  }));

  app.post("/whatsapp/embedded/complete", { preHandler: requirePermission("business:*"), config: { rateLimit: { max: 5, timeWindow: "5 minutes" } } }, async (req, reply) => {
    const parsed = z.object({ code: z.string().min(10).max(4000), phoneNumberId: z.string().regex(/^\d{5,30}$/), wabaId: z.string().regex(/^\d{5,30}$/) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Meta did not return complete signup details" });
    if (!config.whatsapp.appId || !config.whatsapp.appSecret || !config.encryptionKey) return reply.code(503).send({ error: "Embedded Signup is not configured on the server" });
    const params = new URLSearchParams({ client_id: config.whatsapp.appId, client_secret: config.whatsapp.appSecret, code: parsed.data.code });
    const exchange = await fetch(`https://graph.facebook.com/${config.whatsapp.graphVersion ?? "v23.0"}/oauth/access_token?${params}`, { signal: AbortSignal.timeout(15_000) });
    const tokenBody: any = await exchange.json().catch(() => ({}));
    if (!exchange.ok || !tokenBody.access_token) return reply.code(502).send({ error: tokenBody?.error?.message ?? "Meta authorization-code exchange failed" });
    const businessId = tenantId(req);
    const graph = { accessToken: String(tokenBody.access_token), phoneNumberId: parsed.data.phoneNumberId, apiVersion: config.whatsapp.graphVersion };
    try {
      await assertOwnsNumber(graph, parsed.data.wabaId);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      return reply.code(502).send({ error: metaMessage(err) });
    }
    await claimNumber(parsed.data.phoneNumberId, businessId, req);
    const info = await getPhoneNumberInfo(graph);
    const encryptedAccessToken = await encryptSecret(String(tokenBody.access_token), config.encryptionKey);
    // Webhooks only reach us once our app is subscribed to the customer's WABA.
    let subscribeError: string | null = null;
    try {
      await subscribeAppToWaba(graph, parsed.data.wabaId);
    } catch (err) {
      subscribeError = `Webhook subscription failed: ${metaMessage(err)}`;
    }
    // NOTE: Meta also requires POST /<PHONE_NUMBER_ID>/register (with a 6-digit PIN) for new numbers.
    // That step is on the P1 roadmap; until then register the number in WhatsApp Manager if Meta asks.
    const existing = await db.whatsAppConnection.findFirst({ where: { businessId }, orderBy: { createdAt: "asc" } });
    const data = {
      phoneNumberId: parsed.data.phoneNumberId,
      wabaId: parsed.data.wabaId,
      encryptedAccessToken,
      displayPhone: info.displayPhone ?? null,
      verifiedName: info.verifiedName ?? null,
      status: subscribeError ? "ERROR" : "CONNECTED",
      ownershipVerifiedAt: new Date(),
      lastError: subscribeError,
    };
    const row = existing ? await db.whatsAppConnection.update({ where: { id: existing.id }, data }) : await db.whatsAppConnection.create({ data: { ...data, businessId } });
    await audit("whatsapp.embedded_signup", "WhatsAppConnection", row.id, req, { phoneNumberId: row.phoneNumberId, wabaId: row.wabaId, subscribed: !subscribeError });
    if (subscribeError) return reply.code(502).send({ error: subscribeError, connection: view(row) });
    return { ok: true, qualityRating: info.qualityRating, connection: view(row) };
  });

  app.get("/whatsapp/connection", { preHandler: requirePermission("business:*") }, async req => {
    const connection = await db.whatsAppConnection.findFirst({ where: { businessId: tenantId(req) }, orderBy: { createdAt: "asc" } });
    return {
      connection: connection ? view(connection) : null,
      webhookUrl: `${config.publicApiUrl.replace(/\/$/, "")}/webhooks/meta`,
      liveEnabled: config.whatsapp.liveEnabled,
      // Presence only; no part of any secret is returned to tenants.
      server: { appSecret: !!config.whatsapp.appSecret, verifyToken: !!config.whatsapp.verifyToken, encryptionKey: !!config.encryptionKey },
    };
  });

  // Create or update the tenant's WhatsApp number. Tokens are encrypted at rest and never returned.
  // Saving never makes a number live: "Test connection" must first prove ownership with Meta.
  app.put("/whatsapp/connection", { preHandler: requirePermission("business:*") }, async (req, reply) => {
    const businessId = tenantId(req);
    const parsed = whatsappConnectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid connection details", details: parsed.error.flatten() });
    const { phoneNumberId, wabaId, displayPhone, accessToken } = parsed.data;
    if (!wabaId) return reply.code(400).send({ error: "The WhatsApp Business Account ID is required so the number's ownership can be verified" });
    if (accessToken && !config.encryptionKey) return reply.code(500).send({ error: "Set ENCRYPTION_KEY on the server before saving access tokens" });
    await claimNumber(phoneNumberId, businessId, req);
    const existing = await db.whatsAppConnection.findFirst({ where: { businessId }, orderBy: { createdAt: "asc" } });
    const data = {
      phoneNumberId,
      wabaId,
      displayPhone: displayPhone || null,
      status: "PENDING",
      ownershipVerifiedAt: null,
      lastError: null,
      ...(accessToken ? { encryptedAccessToken: await encryptSecret(accessToken, config.encryptionKey!) } : {}),
    };
    const row = existing ? await db.whatsAppConnection.update({ where: { id: existing.id }, data }) : await db.whatsAppConnection.create({ data: { ...data, businessId } });
    await audit("whatsapp.connection.save", "WhatsAppConnection", row.id, req, { phoneNumberId, wabaId, tokenUpdated: !!accessToken });
    return view(row);
  });

  // Calls Meta with the workspace's token, proves the number belongs to its WABA, then marks it CONNECTED.
  app.post("/whatsapp/connection/test", { preHandler: requirePermission("business:*"), config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const businessId = tenantId(req);
    const connection = await db.whatsAppConnection.findFirst({ where: { businessId }, orderBy: { createdAt: "asc" } });
    if (!connection) return reply.code(404).send({ error: "Save a WhatsApp number first" });
    if (!connection.wabaId) return reply.code(422).send({ error: "Add the WhatsApp Business Account ID and save again before testing" });
    const fail = async (status: number, message: string) => {
      await db.whatsAppConnection.update({ where: { id: connection.id }, data: { status: "ERROR", ownershipVerifiedAt: null, lastError: message.slice(0, 500) } });
      await audit("whatsapp.connection.test", "WhatsAppConnection", connection.id, req, { ok: false });
      return reply.code(status).send({ error: message });
    };
    let graph;
    try {
      graph = { accessToken: await whatsAppTokenFor(connection), phoneNumberId: connection.phoneNumberId, apiVersion: config.whatsapp.graphVersion };
      await assertOwnsNumber(graph, connection.wabaId);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.statusCode, err.message);
      return fail(502, metaMessage(err));
    }
    try {
      const info = await getPhoneNumberInfo(graph);
      const row = await db.whatsAppConnection.update({
        where: { id: connection.id },
        data: { status: "CONNECTED", ownershipVerifiedAt: new Date(), displayPhone: info.displayPhone ?? connection.displayPhone, verifiedName: info.verifiedName ?? null, lastError: null },
      });
      await audit("whatsapp.connection.test", "WhatsAppConnection", row.id, req, { ok: true });
      return { ok: true, qualityRating: info.qualityRating, connection: view(row) };
    } catch (err) {
      return fail(502, metaMessage(err));
    }
  });

  app.delete("/whatsapp/connection", { preHandler: requirePermission("business:*") }, async (req, reply) => {
    const businessId = tenantId(req);
    const removed = await db.whatsAppConnection.deleteMany({ where: { businessId } });
    await audit("whatsapp.connection.delete", "WhatsAppConnection", undefined, req, { count: removed.count });
    return reply.code(204).send();
  });
}
