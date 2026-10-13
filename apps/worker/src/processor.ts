import { db } from "@oceanbrown/db";
import {
  decryptSecret,
  detectIntent,
  generateReply,
  isWithinServiceWindow,
  markAsRead,
  parseWebhookPayload,
  resolveAiProvider,
  sendMessage,
  shouldApplyStatus,
  WhatsAppApiError,
  type AiConfig,
  type InboundMessage,
  type StatusUpdate,
} from "@oceanbrown/shared";

export type Enqueue = (name: "send-message", data: { messageId: string }, jobId: string) => Promise<unknown>;

const env = {
  live: () => process.env.WHATSAPP_LIVE_ENABLED === "true",
  encryptionKey: () => process.env.ENCRYPTION_KEY,
  envToken: () => process.env.META_ACCESS_TOKEN || undefined,
  graphVersion: () => process.env.META_GRAPH_VERSION || undefined,
};

export function aiConfigFromEnv(): AiConfig {
  const provider = resolveAiProvider(process.env.AI_PROVIDER);
  const apiKey = provider === "openai" ? process.env.OPENAI_API_KEY : provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : undefined;
  return { provider: apiKey ? provider : "simulator", apiKey: apiKey || undefined, model: process.env.AI_MODEL || undefined };
}

const OPT_OUT_REPLY = "You have been unsubscribed and will not receive further messages from us. Reply START at any time to opt back in.";
const OPT_IN_REPLY = "Welcome back! You are subscribed to messages from us again.";
const DEFAULT_HANDOVER = "Thanks — I've passed this to a member of our team. Someone will reply here shortly.";

export class PermanentJobError extends Error {}

async function accessTokenFor(conn: { encryptedAccessToken: string | null }) {
  if (conn.encryptedAccessToken) {
    const key = env.encryptionKey();
    if (!key) throw new PermanentJobError("ENCRYPTION_KEY is not configured on the worker");
    return decryptSecret(conn.encryptedAccessToken, key);
  }
  const t = env.envToken();
  if (!t) throw new PermanentJobError("No WhatsApp access token configured");
  return t;
}

async function createOutbound(businessId: string, conversationId: string, body: string, clientId: string, source: "ai" | "system", extra: Record<string, unknown> = {}) {
  return db.message.upsert({
    where: { businessId_clientId: { businessId, clientId } },
    update: {},
    create: { businessId, conversationId, clientId, direction: "OUTBOUND", body, status: "QUEUED", metadata: { transport: "whatsapp", source, ...extra } as any },
  });
}

/** Store one inbound message and decide whether the agent should reply. */
async function handleInbound(item: InboundMessage, enqueue: Enqueue, log: Logger) {
  const connection = await db.whatsAppConnection.findUnique({ where: { phoneNumberId: item.phoneNumberId } });
  if (!connection) return log.warn({ phoneNumberId: item.phoneNumberId }, "Inbound message for unknown number");
  const businessId = connection.businessId;

  const customer = await db.customer.upsert({
    where: { businessId_phone: { businessId, phone: item.phone } },
    update: { lastInboundAt: item.timestamp },
    // Starting a conversation counts as opting in to replies; marketing consent stays a separate, explicit flag.
    create: { businessId, phone: item.phone, name: item.profileName?.slice(0, 120) || item.phone, tags: ["whatsapp"], lastInboundAt: item.timestamp },
  });
  const isNewCustomer = Date.now() - customer.createdAt.getTime() < 60_000;

  let conversation = await db.conversation.findFirst({ where: { businessId, customerId: customer.id, status: { in: ["OPEN", "PENDING"] } }, orderBy: { lastMessageAt: "desc" } });
  if (!conversation) {
    // Reopen the most recent resolved conversation instead of scattering history.
    const last = await db.conversation.findFirst({ where: { businessId, customerId: customer.id }, orderBy: { lastMessageAt: "desc" } });
    conversation = last
      ? await db.conversation.update({ where: { id: last.id }, data: { status: "OPEN", resolvedAt: null } })
      : await db.conversation.create({ data: { businessId, customerId: customer.id, subject: "WhatsApp" } });
  }

  try {
    await db.message.create({
      data: {
        businessId,
        conversationId: conversation.id,
        externalId: item.messageId,
        direction: "INBOUND",
        type: item.type,
        body: item.text.slice(0, 10000) || `[${item.type}]`,
        status: "RECEIVED",
        createdAt: item.timestamp,
        metadata: { media: item.media ?? null, replyToId: item.replyToId ?? null } as any,
      },
    });
  } catch (err: any) {
    if (err?.code === "P2002") return log.info({ messageId: item.messageId }, "Duplicate inbound message ignored");
    throw err;
  }
  await db.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

  const cfg = { accessToken: "", phoneNumberId: connection.phoneNumberId, apiVersion: env.graphVersion() };
  if (env.live() && connection.status === "CONNECTED") {
    try {
      cfg.accessToken = await accessTokenFor(connection);
      await markAsRead(cfg, item.messageId);
    } catch (err) {
      log.warn({ err: (err as Error).message }, "Could not mark message as read");
    }
  }

  const intent = detectIntent(item.text);
  if (intent === "OPT_OUT") {
    await db.customer.update({ where: { id: customer.id }, data: { optedOutAt: new Date(), consent: false } });
    const m = await createOutbound(businessId, conversation.id, OPT_OUT_REPLY, `optout-${item.messageId}`, "system", { optOutConfirmation: true });
    return enqueue("send-message", { messageId: m.id }, `send-${m.id}`);
  }
  if (intent === "OPT_IN") {
    await db.customer.update({ where: { id: customer.id }, data: { optedOutAt: null } });
    const m = await createOutbound(businessId, conversation.id, OPT_IN_REPLY, `optin-${item.messageId}`, "system");
    return enqueue("send-message", { messageId: m.id }, `send-${m.id}`);
  }
  if (customer.optedOutAt) return;

  const business = await db.business.findUniqueOrThrow({ where: { id: businessId } });
  if (!business.automationEnabled || conversation.mode !== "AI") return;

  if (isNewCustomer && business.welcomeMessage) {
    const w = await createOutbound(businessId, conversation.id, business.welcomeMessage, `welcome-${customer.id}`, "system");
    await enqueue("send-message", { messageId: w.id }, `send-${w.id}`);
  }

  // Answer once per burst: only reply if this is still the newest inbound message.
  const newest = await db.message.findFirst({ where: { conversationId: conversation.id, direction: "INBOUND" }, orderBy: { createdAt: "desc" }, select: { externalId: true } });
  if (newest?.externalId !== item.messageId) return;

  const [knowledge, history] = await Promise.all([
    db.knowledgeSource.findMany({ where: { businessId, status: "PUBLISHED" }, select: { id: true, title: true, content: true } }),
    db.message.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "desc" }, take: 13, select: { direction: true, body: true, externalId: true } }),
  ]);
  const turns = history
    .reverse()
    .filter(m => m.externalId !== item.messageId)
    .map(m => ({ role: m.direction === "INBOUND" ? ("customer" as const) : ("agent" as const), text: m.body }));

  const reply = await generateReply(aiConfigFromEnv(), { businessName: business.name, industry: business.industry, timezone: business.timezone, knowledge, history: turns, message: item.text });

  if (reply.action === "HANDOVER") {
    await db.conversation.update({ where: { id: conversation.id }, data: { mode: "HUMAN", humanTakenAt: new Date() } });
    await db.auditLog.create({ data: { businessId, action: "conversation.handover", entityType: "Conversation", entityId: conversation.id, metadata: { reason: "agent", provider: reply.provider } } });
  }
  const text = reply.action === "HANDOVER" ? business.handoverMessage || DEFAULT_HANDOVER : reply.text;
  const m = await createOutbound(businessId, conversation.id, text, `ai-${item.messageId}`, "ai", { action: reply.action, provider: reply.provider, sources: reply.sources, usage: reply.usage ?? null });
  await enqueue("send-message", { messageId: m.id }, `send-${m.id}`);
}

async function handleStatus(item: StatusUpdate, log: Logger) {
  const connection = await db.whatsAppConnection.findUnique({ where: { phoneNumberId: item.phoneNumberId }, select: { businessId: true } });
  if (!connection) return;
  const message = await db.message.findUnique({ where: { businessId_externalId: { businessId: connection.businessId, externalId: item.messageId } } });
  if (!message) return log.info({ messageId: item.messageId }, "Status for unknown message");
  const next = item.status.toUpperCase();
  if (!shouldApplyStatus(message.status, next)) return;
  const metadata = { ...((message.metadata as object | null) ?? {}), ...(item.errors?.length ? { errors: item.errors } : {}), [`${item.status}At`]: item.timestamp.toISOString() };
  // Conditional update guards against a concurrent status job applying an older state.
  await db.message.updateMany({ where: { id: message.id, status: message.status }, data: { status: next as any, metadata: metadata as any } });
}

type Logger = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void };

export async function processWebhookEvent(eventId: string, enqueue: Enqueue, log: Logger) {
  const event = await db.webhookEvent.findUnique({ where: { id: eventId } });
  if (!event || event.status === "PROCESSED") return { skipped: true };
  try {
    const items = parseWebhookPayload(event.payload);
    // Statuses first is not required for correctness (status updates are monotonic), but messages must keep order.
    for (const item of items) {
      if (item.kind === "message") await handleInbound(item, enqueue, log);
      else await handleStatus(item, log);
    }
    await db.webhookEvent.update({ where: { id: event.id }, data: { status: "PROCESSED", processedAt: new Date(), error: null } });
    return { items: items.length };
  } catch (err) {
    await db.webhookEvent.update({ where: { id: event.id }, data: { error: String((err as Error).message).slice(0, 1000) } });
    throw err;
  }
}

/** Sends one queued outbound message through the Cloud API, enforcing Meta's rules at send time. */
export async function sendQueuedMessage(messageId: string, log: Logger) {
  const message = await db.message.findUnique({ where: { id: messageId }, include: { conversation: { include: { customer: true } } } });
  if (!message || message.direction !== "OUTBOUND" || message.status !== "QUEUED") return { skipped: true };
  const meta = (message.metadata as Record<string, unknown> | null) ?? {};
  const fail = async (reason: string) => {
    await db.message.update({ where: { id: message.id }, data: { status: "FAILED", metadata: { ...meta, error: reason } as any } });
    log.warn({ messageId, reason }, "Outbound message not sent");
    return { failed: reason };
  };

  if (!env.live()) {
    await db.message.update({ where: { id: message.id }, data: { metadata: { ...meta, transport: "simulator", note: "WHATSAPP_LIVE_ENABLED is false; nothing was sent" } as any } });
    return { simulated: true };
  }
  const customer = message.conversation.customer;
  if (customer.optedOutAt && !meta.optOutConfirmation) return fail("Customer opted out");
  if (!isWithinServiceWindow(customer.lastInboundAt)) return fail("Outside the 24-hour customer service window; an approved template is required");
  const connection = await db.whatsAppConnection.findFirst({ where: { businessId: message.businessId, status: "CONNECTED" } });
  if (!connection) return fail("No connected WhatsApp number");

  try {
    const accessToken = await accessTokenFor(connection);
    const { messageId: wamid } = await sendMessage({ accessToken, phoneNumberId: connection.phoneNumberId, apiVersion: env.graphVersion() }, { type: "text", to: customer.phone, body: message.body });
    await db.message.update({ where: { id: message.id }, data: { status: "SENT", externalId: wamid, metadata: { ...meta, sentAt: new Date().toISOString() } as any } });
    return { sent: wamid };
  } catch (err) {
    if (err instanceof WhatsAppApiError && err.retryable) throw err; // BullMQ retries with backoff
    if (err instanceof WhatsAppApiError && (err.code === 190 || err.httpStatus === 401)) {
      await db.whatsAppConnection.update({ where: { id: connection.id }, data: { status: "ERROR", lastError: `Access token rejected: ${err.message}` } });
    }
    return fail(err instanceof Error ? err.message : "Unknown error");
  }
}

/** Marks messages that exhausted all retries as failed so they don't stay QUEUED forever. */
export async function markSendExhausted(messageId: string, reason: string) {
  await db.message.updateMany({ where: { id: messageId, status: "QUEUED" }, data: { status: "UNCERTAIN" } });
  const m = await db.message.findUnique({ where: { id: messageId }, select: { metadata: true } });
  if (m) await db.message.update({ where: { id: messageId }, data: { metadata: { ...((m.metadata as object | null) ?? {}), error: reason } as any } });
}

/** Recovery sweep: re-enqueue work whose original enqueue failed (e.g. Redis was briefly down). */
export async function findStrandedWork(olderThanMs = 60_000) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const [events, messages] = await Promise.all([
    db.webhookEvent.findMany({ where: { status: "RECEIVED", receivedAt: { lt: cutoff } }, select: { id: true }, take: 200 }),
    db.message.findMany({ where: { direction: "OUTBOUND", status: "QUEUED", createdAt: { lt: cutoff, gt: new Date(Date.now() - 86_400_000) } }, select: { id: true, metadata: true }, take: 200 }),
  ]);
  return { eventIds: events.map(e => e.id), messageIds: messages.filter(m => (m.metadata as any)?.transport === "whatsapp").map(m => m.id) };
}
