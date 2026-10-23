import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomInt } from "node:crypto";
import { db } from "@oceanbrown/db";
import {
  decryptSecret,
  encryptSecret,
  getPhoneNumberInfo,
  listWabaPhoneNumberIds,
  mapMetaError,
  mayUseEnvToken,
  registerPhoneNumber,
  resolveWhatsAppToken,
  subscribeAppToWaba,
  whatsappConnectionSchema,
  WhatsAppApiError,
  WhatsAppTokenUnavailable,
  type PhoneNumberInfo,
  type TokenEnv,
} from "@oceanbrown/shared";
import { audit, HttpError, platformAudit, requirePermission, tenantId } from "./auth.js";
import { config } from "./config.js";
import { z } from "zod";

// ---------------------------------------------------------------------------------------------
// Connection service. Shared by the customer routes below and the provider-admin routes, so a
// number becomes CONNECTED in exactly one way: Meta confirms, with the business's own token, that
// the number belongs to its WhatsApp Business Account.
// ---------------------------------------------------------------------------------------------

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

type ConnectionRow = {
  id: string; businessId: string; phoneNumberId: string; wabaId: string | null; displayPhone: string | null; verifiedName: string | null; status: string;
  webhookHealthy: boolean; lastWebhookAt: Date | null; lastError: string | null; encryptedAccessToken: string | null; ownershipVerifiedAt: Date | null;
  metaStatus?: unknown; lastCheckedAt?: Date | null; onboardingMethod?: string | null; encryptedRegistrationPin?: string | null;
};

/** Customer-safe view. Technical identifiers are only included for OceanBrown staff. */
export function connectionView(c: ConnectionRow, staff = false) {
  return {
    id: c.id,
    displayPhone: c.displayPhone,
    verifiedName: c.verifiedName,
    status: c.status,
    ownershipVerified: !!c.ownershipVerifiedAt,
    lastWebhookAt: c.lastWebhookAt,
    lastError: c.lastError,
    lastCheckedAt: c.lastCheckedAt ?? null,
    metaStatus: c.metaStatus ?? null,
    onboardingMethod: c.onboardingMethod ?? null,
    ...(staff
      ? { phoneNumberId: c.phoneNumberId, wabaId: c.wabaId, webhookHealthy: c.webhookHealthy, hasAccessToken: !!c.encryptedAccessToken || mayUseEnvToken(c.businessId, tokenEnv()), hasRegistrationPin: !!c.encryptedRegistrationPin }
      : {}),
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
  await platformAudit(req, "whatsapp.connection.unverified_claim_released", taken.businessId, "WhatsAppConnection", taken.id, { phoneNumberId, newBusinessId: businessId });
}

/** Proves, with the workspace's own token, that the number belongs to the WABA that token manages. */
async function assertOwnsNumber(graph: { accessToken: string; phoneNumberId: string; apiVersion?: string }, wabaId: string) {
  const ids = await listWabaPhoneNumberIds(graph, wabaId);
  if (!ids.includes(graph.phoneNumberId)) {
    throw new HttpError(403, "This phone number is not part of that WhatsApp Business Account, or the token cannot access it.");
  }
}

const metaSnapshot = (info: PhoneNumberInfo) => ({
  codeVerificationStatus: info.codeVerificationStatus ?? null,
  nameStatus: info.nameStatus ?? null,
  platformType: info.platformType ?? null,
  qualityRating: info.qualityRating ?? null,
});

/** Reads the number's review states from Meta and stores them. Auth/permission failures mark the connection ERROR. */
export async function refreshConnection(connectionId: string) {
  const connection = await db.whatsAppConnection.findUniqueOrThrow({ where: { id: connectionId } });
  try {
    const graph = { accessToken: await whatsAppTokenFor(connection), phoneNumberId: connection.phoneNumberId, apiVersion: config.whatsapp.graphVersion };
    const info = await getPhoneNumberInfo(graph);
    return await db.whatsAppConnection.update({
      where: { id: connection.id },
      data: { metaStatus: metaSnapshot(info), lastCheckedAt: new Date(), displayPhone: info.displayPhone ?? connection.displayPhone, verifiedName: info.verifiedName ?? connection.verifiedName, ...(connection.status === "ERROR" && connection.ownershipVerifiedAt ? { status: "CONNECTED", lastError: null } : {}) },
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return db.whatsAppConnection.update({ where: { id: connection.id }, data: { status: "ERROR", lastError: err.message, lastCheckedAt: new Date() } });
    }
    const mapped = mapMetaError(err instanceof WhatsAppApiError ? { code: err.code, httpStatus: err.httpStatus, message: err.message } : { message: (err as Error).message, httpStatus: 0 });
    // Temporary problems (rate limits, Meta outages) never downgrade a working connection.
    const permanent = ["AUTH", "PERMISSION", "BLOCKED"].includes(mapped.kind);
    return db.whatsAppConnection.update({ where: { id: connection.id }, data: { lastCheckedAt: new Date(), ...(permanent ? { status: "ERROR", lastError: mapped.message } : {}) } });
  }
}

/** Registers the number for Cloud API messaging with a PIN OceanBrown keeps (encrypted). */
export async function registerNumber(connectionId: string) {
  const connection = await db.whatsAppConnection.findUniqueOrThrow({ where: { id: connectionId } });
  if (!config.encryptionKey) throw new HttpError(503, "ENCRYPTION_KEY is not configured on the server");
  const pin = connection.encryptedRegistrationPin ? await decryptSecret(connection.encryptedRegistrationPin, config.encryptionKey) : String(randomInt(0, 1_000_000)).padStart(6, "0");
  const graph = { accessToken: await whatsAppTokenFor(connection), phoneNumberId: connection.phoneNumberId, apiVersion: config.whatsapp.graphVersion };
  try {
    await registerPhoneNumber(graph, pin);
    await db.whatsAppConnection.update({ where: { id: connection.id }, data: { encryptedRegistrationPin: await encryptSecret(pin, config.encryptionKey), lastError: null } });
    return { ok: true as const };
  } catch (err) {
    const mapped = mapMetaError(err instanceof WhatsAppApiError ? { code: err.code, httpStatus: err.httpStatus, message: err.message } : { message: (err as Error).message, httpStatus: 0 });
    await db.whatsAppConnection.update({ where: { id: connection.id }, data: { lastError: `${mapped.message} [${mapped.staffHint}]`.slice(0, 500) } });
    return { ok: false as const, error: mapped };
  }
}

/** OceanBrown-assisted setup: staff enter the technical details for a customer. Never available to customers. */
export async function saveAssistedConnection(businessId: string, body: unknown, req: FastifyRequest) {
  const parsed = whatsappConnectionSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "Invalid connection details");
  const { phoneNumberId, wabaId, displayPhone, accessToken } = parsed.data;
  if (!wabaId) throw new HttpError(400, "The WhatsApp Business Account ID is required so the number's ownership can be verified");
  if (accessToken && !config.encryptionKey) throw new HttpError(500, "Set ENCRYPTION_KEY on the server before saving access tokens");
  await claimNumber(phoneNumberId, businessId, req);
  const existing = await db.whatsAppConnection.findFirst({ where: { businessId }, orderBy: { createdAt: "asc" } });
  const data = {
    phoneNumberId,
    wabaId,
    displayPhone: displayPhone || null,
    status: "PENDING",
    ownershipVerifiedAt: null,
    lastError: null,
    onboardingMethod: "ASSISTED",
    ...(accessToken ? { encryptedAccessToken: await encryptSecret(accessToken, config.encryptionKey!) } : {}),
  };
  const row = existing ? await db.whatsAppConnection.update({ where: { id: existing.id }, data }) : await db.whatsAppConnection.create({ data: { ...data, businessId } });
  await platformAudit(req, "whatsapp.connection.assisted_save", businessId, "WhatsAppConnection", row.id, { phoneNumberId, wabaId, tokenUpdated: !!accessToken });
  return row;
}

/** Proves ownership with Meta and marks the number CONNECTED; stores Meta's review states. */
export async function testConnection(businessId: string, req: FastifyRequest) {
  const connection = await db.whatsAppConnection.findFirst({ where: { businessId }, orderBy: { createdAt: "asc" } });
  if (!connection) throw new HttpError(404, "No WhatsApp number saved for this workspace");
  if (!connection.wabaId) throw new HttpError(422, "Add the WhatsApp Business Account ID and save again before testing");
  const fail = async (status: number, message: string) => {
    await db.whatsAppConnection.update({ where: { id: connection.id }, data: { status: "ERROR", ownershipVerifiedAt: null, lastError: message.slice(0, 500) } });
    await platformAudit(req, "whatsapp.connection.test", businessId, "WhatsAppConnection", connection.id, { ok: false });
    throw new HttpError(status, message);
  };
  let graph;
  try {
    graph = { accessToken: await whatsAppTokenFor(connection), phoneNumberId: connection.phoneNumberId, apiVersion: config.whatsapp.graphVersion };
    await assertOwnsNumber(graph, connection.wabaId);
  } catch (err) {
    if (err instanceof HttpError) return fail(err.statusCode, err.message);
    const mapped = mapMetaError(err instanceof WhatsAppApiError ? { code: err.code, httpStatus: err.httpStatus, message: err.message } : { message: (err as Error).message, httpStatus: 0 });
    return fail(502, mapped.message);
  }
  try {
    const info = await getPhoneNumberInfo(graph);
    const row = await db.whatsAppConnection.update({
      where: { id: connection.id },
      data: { status: "CONNECTED", ownershipVerifiedAt: new Date(), displayPhone: info.displayPhone ?? connection.displayPhone, verifiedName: info.verifiedName ?? null, lastError: null, metaStatus: metaSnapshot(info), lastCheckedAt: new Date() },
    });
    await platformAudit(req, "whatsapp.connection.test", businessId, "WhatsAppConnection", row.id, { ok: true });
    return row;
  } catch (err) {
    const mapped = mapMetaError(err instanceof WhatsAppApiError ? { code: err.code, httpStatus: err.httpStatus, message: err.message } : { message: (err as Error).message, httpStatus: 0 });
    return fail(502, mapped.message);
  }
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

export async function registerWhatsAppRoutes(app: FastifyInstance) {
  app.get("/whatsapp/embedded/config", { preHandler: requirePermission("business:*") }, async () => ({
    enabled: !!(config.whatsapp.appId && config.whatsapp.appSecret && config.whatsapp.embeddedSignupConfigId && config.encryptionKey),
    appId: config.whatsapp.appId ?? null,
    configId: config.whatsapp.embeddedSignupConfigId ?? null,
    graphVersion: config.whatsapp.graphVersion ?? "v23.0",
  }));

  /**
   * Finishes Meta Embedded Signup server-side: code exchange (valid ~30 s), ownership proof, webhook
   * subscription, phone registration (skipped for WhatsApp Business App coexistence), then a status read.
   * The customer never sees or types a token or an ID.
   */
  app.post("/whatsapp/embedded/complete", { preHandler: requirePermission("business:*"), config: { rateLimit: { max: 5, timeWindow: "5 minutes" } } }, async (req, reply) => {
    const parsed = z.object({ code: z.string().min(10).max(4000), phoneNumberId: z.string().regex(/^\d{5,30}$/), wabaId: z.string().regex(/^\d{5,30}$/), event: z.string().max(60).optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Meta did not return complete signup details. Please try again." });
    if (!config.whatsapp.appId || !config.whatsapp.appSecret || !config.encryptionKey) return reply.code(503).send({ error: "Online WhatsApp connection is not available yet. Ask OceanBrown to connect your number for you." });
    const businessId = tenantId(req);
    const failAttempt = async (message: string, staffHint?: string) => {
      await audit("onboarding.whatsapp.error", "Business", businessId, req, { message, staffHint, step: "complete" });
      return reply.code(502).send({ error: message });
    };
    const params = new URLSearchParams({ client_id: config.whatsapp.appId, client_secret: config.whatsapp.appSecret, code: parsed.data.code });
    const exchange = await fetch(`https://graph.facebook.com/${config.whatsapp.graphVersion ?? "v23.0"}/oauth/access_token?${params}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    const tokenBody: any = exchange ? await exchange.json().catch(() => ({})) : {};
    if (!exchange?.ok || !tokenBody.access_token) return failAttempt("Meta couldn't confirm the connection (the sign-up code may have expired). Please connect again.", tokenBody?.error?.message);
    const graph = { accessToken: String(tokenBody.access_token), phoneNumberId: parsed.data.phoneNumberId, apiVersion: config.whatsapp.graphVersion };
    try {
      await assertOwnsNumber(graph, parsed.data.wabaId);
    } catch (err) {
      if (err instanceof HttpError) return failAttempt(err.message);
      const mapped = mapMetaError(err instanceof WhatsAppApiError ? { code: err.code, httpStatus: err.httpStatus, message: err.message } : { message: (err as Error).message });
      return failAttempt(mapped.message, mapped.staffHint);
    }
    await claimNumber(parsed.data.phoneNumberId, businessId, req);
    const encryptedAccessToken = await encryptSecret(String(tokenBody.access_token), config.encryptionKey);
    let subscribeError: string | null = null;
    try {
      await subscribeAppToWaba(graph, parsed.data.wabaId);
    } catch (err) {
      subscribeError = mapMetaError(err instanceof WhatsAppApiError ? { code: err.code, httpStatus: err.httpStatus, message: err.message } : { message: (err as Error).message }).message;
    }
    const existing = await db.whatsAppConnection.findFirst({ where: { businessId }, orderBy: { createdAt: "asc" } });
    const coexistence = parsed.data.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";
    const data = {
      phoneNumberId: parsed.data.phoneNumberId,
      wabaId: parsed.data.wabaId,
      encryptedAccessToken,
      status: subscribeError ? "ERROR" : "CONNECTED",
      ownershipVerifiedAt: new Date(),
      lastError: subscribeError ? `Webhook subscription failed: ${subscribeError}` : null,
      onboardingMethod: coexistence ? "EMBEDDED_COEXISTENCE" : "EMBEDDED",
    };
    let row = existing ? await db.whatsAppConnection.update({ where: { id: existing.id }, data }) : await db.whatsAppConnection.create({ data: { ...data, businessId } });
    let registration: Awaited<ReturnType<typeof registerNumber>> | null = null;
    if (!coexistence && !subscribeError) registration = await registerNumber(row.id);
    row = await refreshConnection(row.id);
    await audit("whatsapp.embedded_signup", "WhatsAppConnection", row.id, req, { phoneNumberId: row.phoneNumberId, wabaId: row.wabaId, subscribed: !subscribeError, registered: registration?.ok ?? null, coexistence });
    await audit("onboarding.whatsapp.connected", "Business", businessId, req, { registered: registration?.ok ?? null });
    return { ok: !subscribeError, connection: connectionView(row), ...(registration && !registration.ok ? { pending: registration.error.message } : {}) };
  });

  app.get("/whatsapp/connection", { preHandler: requirePermission("business:*") }, async req => {
    const staff = req.user.role === "SUPER_ADMIN";
    const connection = await db.whatsAppConnection.findFirst({ where: { businessId: tenantId(req) }, orderBy: { createdAt: "asc" } });
    return {
      connection: connection ? connectionView(connection, staff) : null,
      liveEnabled: config.whatsapp.liveEnabled,
      // Server details are for OceanBrown staff only; customers never see infrastructure configuration.
      ...(staff ? { webhookUrl: `${config.publicApiUrl.replace(/\/$/, "")}/webhooks/meta`, server: { appSecret: !!config.whatsapp.appSecret, verifyToken: !!config.whatsapp.verifyToken, encryptionKey: !!config.encryptionKey } } : {}),
    };
  });

  /** Re-reads the number's states from Meta. Customers use it as "Check again". */
  app.post("/whatsapp/connection/check", { preHandler: requirePermission("business:*"), config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const connection = await db.whatsAppConnection.findFirst({ where: { businessId: tenantId(req) }, orderBy: { createdAt: "asc" } });
    if (!connection) return reply.code(404).send({ error: "No WhatsApp number is connected yet" });
    const row = await refreshConnection(connection.id);
    return { connection: connectionView(row, req.user.role === "SUPER_ADMIN") };
  });

  // Manual technical setup is restricted to OceanBrown staff (customers connect through Meta's sign-up).
  const staffOnly = async (req: FastifyRequest) => {
    if (req.user.role !== "SUPER_ADMIN") throw new HttpError(403, "Connecting a number with technical details is done by OceanBrown. Use Connect with Facebook, or request help.");
  };

  app.put("/whatsapp/connection", { preHandler: requirePermission("business:*") }, async req => {
    await staffOnly(req);
    const row = await saveAssistedConnection(tenantId(req), req.body, req);
    return connectionView(row, true);
  });

  app.post("/whatsapp/connection/test", { preHandler: requirePermission("business:*"), config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async req => {
    await staffOnly(req);
    const row = await testConnection(tenantId(req), req);
    return { ok: true, connection: connectionView(row, true) };
  });

  app.delete("/whatsapp/connection", { preHandler: requirePermission("business:*") }, async (req, reply) => {
    const businessId = tenantId(req);
    const removed = await db.whatsAppConnection.deleteMany({ where: { businessId } });
    await audit("whatsapp.connection.delete", "WhatsAppConnection", undefined, req, { count: removed.count });
    return reply.code(204).send();
  });
}
