import { db } from "@oceanbrown/db";
import { prepareVoiceNote } from "./audio.js";
import {
  canSpeak,
  detectIntent,
  detectTextLanguage,
  downloadMedia,
  handoverText,
  normalizeLang,
  sttConfigFromEnv,
  synthesize,
  transcribe,
  ttsConfigFromEnv,
  uploadMedia,
  type Lang,
  generateReply,
  isWithinServiceWindow,
  markAsRead,
  parseWebhookPayload,
  resolveAiProvider,
  resolveWhatsAppToken,
  sendMessage,
  shouldApplyStatus,
  tokenEnvFrom,
  VERIFIED_CONNECTION,
  WhatsAppApiError,
  WhatsAppTokenUnavailable,
  type AiConfig,
  type InboundMessage,
  type StatusUpdate,
} from "@oceanbrown/shared";

export type Enqueue = (name: "send-message", data: { messageId: string }, jobId: string) => Promise<unknown>;

const env = {
  live: () => process.env.WHATSAPP_LIVE_ENABLED === "true",
  graphVersion: () => process.env.META_GRAPH_VERSION || undefined,
  voice: () => process.env.VOICE_ENABLED !== "false",
  voiceAlsoText: () => process.env.VOICE_ALSO_TEXT !== "false",
};

export function aiConfigFromEnv(): AiConfig {
  const provider = resolveAiProvider(process.env.AI_PROVIDER);
  const apiKey = provider === "openai" ? process.env.OPENAI_API_KEY : provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : undefined;
  return { provider: apiKey ? provider : "simulator", apiKey: apiKey || undefined, model: process.env.AI_MODEL || undefined };
}

// Wolof texts should be reviewed by a native speaker before launch (Settings lets each business override handover text).
const OPT_OUT_REPLY: Record<Lang, string> = {
  en: "You have been unsubscribed and will not receive further messages from us. Reply START at any time to opt back in.",
  fr: "Vous êtes désabonné et ne recevrez plus de messages de notre part. Répondez START à tout moment pour vous réabonner.",
  wo: "Dindi nanu la ci sunu lim, doo jot ay message yu bees. Bind START su nga bëggee dellu.",
};
const OPT_IN_REPLY: Record<Lang, string> = {
  en: "Welcome back! You are subscribed to messages from us again.",
  fr: "Bon retour ! Vous recevez à nouveau nos messages.",
  wo: "Dalal ak jàmm! Dinga jot sunu message yi ba pare.",
};
const VOICE_FAILED_REPLY: Record<Lang, string> = {
  en: "Sorry, I couldn't understand your voice note. Could you send it again or type your message?",
  fr: "Désolé, je n'ai pas pu comprendre votre message vocal. Pouvez-vous le renvoyer ou l'écrire ?",
  wo: "Baal ma, dégguma sa message bu baat bi. Mën nga ko yónnewaat walla nga bind ko?",
};

export class PermanentJobError extends Error {}

/** The workspace's own token, or META_ACCESS_TOKEN only for the workspace in META_ACCESS_TOKEN_BUSINESS_ID. */
async function accessTokenFor(conn: { businessId: string; encryptedAccessToken: string | null }) {
  try {
    return await resolveWhatsAppToken(conn, tokenEnvFrom(process.env));
  } catch (err) {
    if (err instanceof WhatsAppTokenUnavailable) throw new PermanentJobError(err.message);
    throw err;
  }
}

/** Only verified, connected numbers receive traffic; the webhook's WABA must match the saved one. */
async function verifiedConnection(item: { phoneNumberId: string; wabaId?: string }) {
  const connection = await db.whatsAppConnection.findFirst({ where: { phoneNumberId: item.phoneNumberId, ...VERIFIED_CONNECTION } });
  if (!connection) return null;
  if (connection.wabaId && item.wabaId && connection.wabaId !== item.wabaId) return null;
  return connection;
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
  const connection = await verifiedConnection(item);
  if (!connection) return log.warn({ phoneNumberId: item.phoneNumberId }, "Inbound message for an unknown or unverified number");
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

  if (await db.message.findUnique({ where: { businessId_externalId: { businessId, externalId: item.messageId } }, select: { id: true } })) {
    return log.info({ messageId: item.messageId }, "Duplicate inbound message ignored");
  }

  const graph = { accessToken: "", phoneNumberId: connection.phoneNumberId, apiVersion: env.graphVersion() };
  try {
    graph.accessToken = await accessTokenFor(connection);
  } catch {
    /* no token: we can still store text messages */
  }

  // Voice notes: download from Meta and transcribe (English, French or Wolof).
  const isVoice = item.type === "audio" && !!item.media?.id;
  let text = item.text;
  let transcriptOk = !isVoice;
  let language: Lang | null = null;
  const voiceMeta: Record<string, unknown> = {};
  if (isVoice && env.voice()) {
    const stt = sttConfigFromEnv(process.env);
    try {
      if (stt.provider === "none") throw new Error("Speech-to-text is not configured");
      if (!graph.accessToken) throw new Error("No WhatsApp access token to download the voice note");
      const media = await downloadMedia(graph, item.media!.id);
      const t = await transcribe(stt, media.data, media.mime, normalizeLang(customer.language));
      if (!t.text) throw new Error("Empty transcript");
      text = t.text;
      language = t.language;
      transcriptOk = true;
      Object.assign(voiceMeta, { transcript: true, sttProvider: t.provider, sttLanguage: t.rawLanguage ?? null, durationHint: media.data.byteLength });
    } catch (err) {
      voiceMeta.transcriptError = (err as Error).message.slice(0, 300);
      log.warn({ messageId: item.messageId, err: voiceMeta.transcriptError }, "Voice note not transcribed");
    }
  }
  language ??= detectTextLanguage(text) ?? normalizeLang(customer.language);
  if (language && language !== customer.language) await db.customer.update({ where: { id: customer.id }, data: { language } });
  const replyLang: Lang = language ?? (normalizeLang((await db.business.findUnique({ where: { id: businessId }, select: { defaultLanguage: true } }))?.defaultLanguage) ?? "en");

  try {
    await db.message.create({
      data: {
        businessId,
        conversationId: conversation.id,
        externalId: item.messageId,
        direction: "INBOUND",
        type: item.type,
        body: (isVoice ? (transcriptOk ? text : "[voice note — not transcribed]") : text).slice(0, 10000) || `[${item.type}]`,
        status: "RECEIVED",
        createdAt: item.timestamp,
        metadata: { media: item.media ?? null, replyToId: item.replyToId ?? null, language, voice: isVoice, ...voiceMeta } as any,
      },
    });
  } catch (err: any) {
    if (err?.code === "P2002") return log.info({ messageId: item.messageId }, "Duplicate inbound message ignored");
    throw err;
  }
  await db.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

  if (env.live() && connection.status === "CONNECTED" && graph.accessToken) {
    await markAsRead(graph, item.messageId).catch(err => log.warn({ err: (err as Error).message }, "Could not mark message as read"));
  }

  const intent = transcriptOk ? detectIntent(text) : null;
  if (intent === "OPT_OUT") {
    await db.customer.update({ where: { id: customer.id }, data: { optedOutAt: new Date(), consent: false } });
    const m = await createOutbound(businessId, conversation.id, OPT_OUT_REPLY[replyLang], `optout-${item.messageId}`, "system", { optOutConfirmation: true, language: replyLang });
    return enqueue("send-message", { messageId: m.id }, `send-${m.id}`);
  }
  if (intent === "OPT_IN") {
    await db.customer.update({ where: { id: customer.id }, data: { optedOutAt: null } });
    const m = await createOutbound(businessId, conversation.id, OPT_IN_REPLY[replyLang], `optin-${item.messageId}`, "system", { language: replyLang });
    return enqueue("send-message", { messageId: m.id }, `send-${m.id}`);
  }
  if (customer.optedOutAt) return;

  const business = await db.business.findUniqueOrThrow({ where: { id: businessId } });
  // Suspended workspaces keep receiving (nothing is lost) but no automatic replies are sent.
  if (business.planStatus !== "ACTIVE" || !business.automationEnabled || conversation.mode !== "AI") return;

  if (isNewCustomer && business.welcomeMessage) {
    const w = await createOutbound(businessId, conversation.id, business.welcomeMessage, `welcome-${customer.id}`, "system");
    await enqueue("send-message", { messageId: w.id }, `send-${w.id}`);
  }

  // Answer once per burst: only reply if this is still the newest inbound message.
  const newest = await db.message.findFirst({ where: { conversationId: conversation.id, direction: "INBOUND" }, orderBy: { createdAt: "desc" }, select: { externalId: true } });
  if (newest?.externalId !== item.messageId) return;

  if (!transcriptOk) {
    const m = await createOutbound(businessId, conversation.id, VOICE_FAILED_REPLY[replyLang], `ai-${item.messageId}`, "ai", { action: "CLARIFY", language: replyLang });
    return enqueue("send-message", { messageId: m.id }, `send-${m.id}`);
  }

  // Reply by voice when the customer used voice (MIRROR) or always (ALWAYS), if we have a voice for that language.
  const tts = ttsConfigFromEnv(process.env);
  const speak = env.voice() && canSpeak(tts, replyLang) && (business.voiceReplies === "ALWAYS" || (business.voiceReplies === "MIRROR" && isVoice));

  const [knowledge, history] = await Promise.all([
    db.knowledgeSource.findMany({ where: { businessId, status: "PUBLISHED" }, select: { id: true, title: true, content: true } }),
    db.message.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "desc" }, take: 13, select: { direction: true, body: true, externalId: true } }),
  ]);
  const turns = history
    .reverse()
    .filter(m => m.externalId !== item.messageId)
    .map(m => ({ role: m.direction === "INBOUND" ? ("customer" as const) : ("agent" as const), text: m.body }));

  let reply: Awaited<ReturnType<typeof generateReply>>;
  try {
    reply = await generateReply(aiConfigFromEnv(), { businessName: business.name, industry: business.industry, timezone: business.timezone, knowledge, history: turns, message: text, language: replyLang, spoken: speak });
  } catch (err) {
    // The inbound message is already stored, so a retry of this job would see a duplicate and stay silent.
    // Hand the conversation to staff instead of leaving the customer without an answer.
    log.error({ conversationId: conversation.id, err: (err as Error).message }, "AI provider failed; handing over to staff");
    reply = { text: "", action: "HANDOVER", sources: [], provider: aiConfigFromEnv().provider, simulated: false };
  }

  if (reply.action === "HANDOVER") {
    await db.conversation.update({ where: { id: conversation.id }, data: { mode: "HUMAN", humanTakenAt: new Date() } });
    await db.auditLog.create({ data: { businessId, action: "conversation.handover", entityType: "Conversation", entityId: conversation.id, metadata: { reason: reply.text ? "agent" : "ai_error", provider: reply.provider } } });
  }
  const replyText = reply.action === "HANDOVER" ? business.handoverMessage || handoverText(replyLang) : reply.text;
  const meta = { action: reply.action, provider: reply.provider, sources: reply.sources, usage: reply.usage ?? null, language: replyLang };

  if (!speak) {
    const m = await createOutbound(businessId, conversation.id, replyText, `ai-${item.messageId}`, "ai", meta);
    return enqueue("send-message", { messageId: m.id }, `send-${m.id}`);
  }
  // Voice note first, then (optionally) the same answer as text. The text is chained so it arrives after the audio.
  const textMsg = env.voiceAlsoText() ? await createOutbound(businessId, conversation.id, replyText, `ai-${item.messageId}`, "ai", { ...meta, after: "voice" }) : null;
  const voiceMsg = await db.message.upsert({
    where: { businessId_clientId: { businessId, clientId: `ai-voice-${item.messageId}` } },
    update: {},
    create: { businessId, conversationId: conversation.id, clientId: `ai-voice-${item.messageId}`, direction: "OUTBOUND", type: "audio", body: replyText, status: "QUEUED", metadata: { transport: "whatsapp", source: "ai", ...meta, tts: true, thenSend: textMsg?.id ?? null } as any },
  });
  await enqueue("send-message", { messageId: voiceMsg.id }, `send-${voiceMsg.id}`);
}

async function handleStatus(item: StatusUpdate, log: Logger) {
  const connection = await verifiedConnection(item);
  if (!connection) return;
  const message = await db.message.findUnique({ where: { businessId_externalId: { businessId: connection.businessId, externalId: item.messageId } } });
  if (!message) {
    const recipient = await db.campaignRecipient.findFirst({ where: { businessId: connection.businessId, externalId: item.messageId } });
    if (!recipient) return log.info({ messageId: item.messageId }, "Status for unknown message");
    const status = item.status.toUpperCase();
    const rank: Record<string, number> = { PENDING: 0, QUEUED: 1, SENT: 2, DELIVERED: 3, READ: 4, FAILED: 5 };
    if (["SENT", "DELIVERED", "READ", "FAILED"].includes(status) && (rank[status] ?? 0) > (rank[recipient.status] ?? 0)) {
      await db.campaignRecipient.update({ where: { id: recipient.id }, data: { status: status as "SENT" | "DELIVERED" | "READ" | "FAILED", ...(status === "FAILED" ? { error: item.errors?.map(e => e.details ? `${e.title}: ${e.details}` : e.title).filter(Boolean).join("; ").slice(0, 500) || "Meta reported delivery failure" } : {}) } });
      await refreshCampaignCounters(recipient.campaignId);
    }
    return;
  }
  const next = item.status.toUpperCase();
  if (!shouldApplyStatus(message.status, next)) return;
  const metadata = { ...((message.metadata as object | null) ?? {}), ...(item.errors?.length ? { errors: item.errors } : {}), [`${item.status}At`]: item.timestamp.toISOString() };
  // Conditional update guards against a concurrent status job applying an older state.
  await db.message.updateMany({ where: { id: message.id, status: message.status }, data: { status: next as any, metadata: metadata as any } });
}

type CampaignEnqueue = (name: "send-campaign-recipient", data: { recipientId: string }, jobId: string, delay?: number) => Promise<unknown>;

async function refreshCampaignCounters(campaignId: string) {
  const [campaign, grouped] = await Promise.all([
    db.campaign.findUnique({ where: { id: campaignId }, select: { id: true, status: true } }),
    db.campaignRecipient.groupBy({ by: ["status"], where: { campaignId }, _count: { _all: true } }),
  ]);
  if (!campaign) return;
  const counts = Object.fromEntries(grouped.map(row => [row.status, row._count._all])) as Record<string, number>;
  const outstanding = (counts.PENDING ?? 0) + (counts.QUEUED ?? 0);
  await db.campaign.update({
    where: { id: campaignId },
    data: {
      sentCount: (counts.SENT ?? 0) + (counts.DELIVERED ?? 0) + (counts.READ ?? 0),
      deliveredCount: (counts.DELIVERED ?? 0) + (counts.READ ?? 0),
      readCount: counts.READ ?? 0,
      failedCount: counts.FAILED ?? 0,
      skippedCount: counts.SKIPPED ?? 0,
      ...(outstanding === 0 && campaign.status === "RUNNING" ? { status: "COMPLETED", completedAt: new Date() } : {}),
    },
  });
}

/** Expands a consent-aware campaign into durable recipients and queues each send. */
export async function startCampaign(campaignId: string, enqueue: CampaignEnqueue, log: Logger) {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status === "CANCELLED" || campaign.status === "COMPLETED") return { skipped: true };
  if (campaign.scheduledAt && campaign.scheduledAt > new Date()) return { early: true };
  const template = await db.messageTemplate.findFirst({ where: { businessId: campaign.businessId, name: campaign.templateName ?? "", language: campaign.language, status: "APPROVED" } });
  if (!template) {
    await db.campaign.update({ where: { id: campaign.id }, data: { status: "FAILED", lastError: "Approved template is no longer available", completedAt: new Date() } });
    return { failed: "template" };
  }
  const customers = await db.customer.findMany({
    where: { businessId: campaign.businessId, consent: true, optedOutAt: null, ...(campaign.audienceTag ? { tags: { has: campaign.audienceTag } } : {}) },
    select: { id: true },
    take: 50_000,
  });
  await db.campaignRecipient.createMany({ data: customers.map(customer => ({ businessId: campaign.businessId, campaignId: campaign.id, customerId: customer.id })), skipDuplicates: true });
  const recipients = await db.campaignRecipient.findMany({ where: { campaignId: campaign.id, status: "PENDING" }, select: { id: true }, take: 50_000 });
  await db.campaign.update({ where: { id: campaign.id }, data: { status: "RUNNING", startedAt: campaign.startedAt ?? new Date(), totalCount: customers.length, lastError: null } });
  // A small delay between jobs smooths bursts. BullMQ still retries transient Meta failures.
  for (let index = 0; index < recipients.length; index += 1) {
    const recipient = recipients[index];
    if (!recipient) continue;
    await db.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "QUEUED" } });
    await enqueue("send-campaign-recipient", { recipientId: recipient.id }, `campaign-recipient-${recipient.id}`, index * 100);
  }
  if (!recipients.length) await refreshCampaignCounters(campaign.id);
  log.info({ campaignId, recipients: recipients.length }, "Campaign recipients queued");
  return { recipients: recipients.length };
}

/** Sends an approved template. Template messages are allowed outside the 24-hour service window. */
export async function sendCampaignRecipient(recipientId: string, log: Logger) {
  const recipient = await db.campaignRecipient.findUnique({ where: { id: recipientId }, include: { customer: true, campaign: true } });
  if (!recipient || !["PENDING", "QUEUED"].includes(recipient.status)) return { skipped: true };
  if (recipient.campaign.status === "CANCELLED") {
    await db.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "SKIPPED", error: "Campaign cancelled" } });
    await refreshCampaignCounters(recipient.campaignId);
    return { skipped: "cancelled" };
  }
  if (!recipient.customer.consent || recipient.customer.optedOutAt) {
    await db.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "SKIPPED", error: "Customer has not consented or opted out" } });
    await refreshCampaignCounters(recipient.campaignId);
    return { skipped: "consent" };
  }
  if (!env.live()) {
    await db.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "FAILED", error: "WHATSAPP_LIVE_ENABLED is false" } });
    await refreshCampaignCounters(recipient.campaignId);
    return { failed: "live_disabled" };
  }
  const connection = await db.whatsAppConnection.findFirst({ where: { businessId: recipient.businessId, ...VERIFIED_CONNECTION } });
  if (!connection) {
    await db.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "FAILED", error: "No connected WhatsApp number", attempts: { increment: 1 } } });
    await refreshCampaignCounters(recipient.campaignId);
    return { failed: "connection" };
  }
  try {
    const graph = { accessToken: await accessTokenFor(connection), phoneNumberId: connection.phoneNumberId, apiVersion: env.graphVersion() };
    const { messageId } = await sendMessage(graph, { type: "template", to: recipient.customer.phone, name: recipient.campaign.templateName!, language: recipient.campaign.language });
    await db.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "SENT", externalId: messageId, sentAt: new Date(), attempts: { increment: 1 }, error: null } });
    await refreshCampaignCounters(recipient.campaignId);
    return { sent: messageId };
  } catch (err) {
    if (err instanceof WhatsAppApiError && err.retryable) {
      await db.campaignRecipient.update({ where: { id: recipient.id }, data: { attempts: { increment: 1 }, error: err.message.slice(0, 500) } });
      throw err;
    }
    const reason = err instanceof Error ? err.message : "Unknown campaign send error";
    await db.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "FAILED", attempts: { increment: 1 }, error: reason.slice(0, 500) } });
    await refreshCampaignCounters(recipient.campaignId);
    log.warn({ recipientId, reason }, "Campaign message failed");
    return { failed: reason };
  }
}

export async function markCampaignRecipientExhausted(recipientId: string, reason: string) {
  const row = await db.campaignRecipient.update({ where: { id: recipientId }, data: { status: "FAILED", error: reason.slice(0, 500) } }).catch(() => null);
  if (row) await refreshCampaignCounters(row.campaignId);
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

/** Sends one queued outbound message (text or voice note) through the Cloud API, enforcing Meta's rules at send time. */
export async function sendQueuedMessage(messageId: string, log: Logger, enqueue?: Enqueue) {
  const message = await db.message.findUnique({ where: { id: messageId }, include: { conversation: { include: { customer: true, business: { select: { planStatus: true } } } } } });
  if (!message || message.direction !== "OUTBOUND" || message.status !== "QUEUED") return { skipped: true };
  const meta = (message.metadata as Record<string, unknown> | null) ?? {};
  // A voice note can carry a follow-up text message that must go out after it, whatever happens to the audio.
  const next = typeof meta.thenSend === "string" ? meta.thenSend : null;
  const chain = async () => {
    if (next && enqueue) await enqueue("send-message", { messageId: next }, `send-${next}`);
  };
  const fail = async (reason: string) => {
    await db.message.update({ where: { id: message.id }, data: { status: "FAILED", metadata: { ...meta, error: reason } as any } });
    log.warn({ messageId, reason }, "Outbound message not sent");
    await chain();
    return { failed: reason };
  };

  if (!env.live()) {
    await db.message.update({ where: { id: message.id }, data: { metadata: { ...meta, transport: "simulator", note: "WHATSAPP_LIVE_ENABLED is false; nothing was sent" } as any } });
    await chain();
    return { simulated: true };
  }
  const customer = message.conversation.customer;
  const planStatus = (message.conversation as { business?: { planStatus: string } | null }).business?.planStatus;
  if (planStatus && planStatus !== "ACTIVE" && !meta.optOutConfirmation) return fail("Workspace suspended");
  if (customer.optedOutAt && !meta.optOutConfirmation) return fail("Customer opted out");
  if (!isWithinServiceWindow(customer.lastInboundAt)) return fail("Outside the 24-hour customer service window; an approved template is required");
  const connection = await db.whatsAppConnection.findFirst({ where: { businessId: message.businessId, ...VERIFIED_CONNECTION } });
  if (!connection) return fail("No connected WhatsApp number");

  try {
    const graph = { accessToken: await accessTokenFor(connection), phoneNumberId: connection.phoneNumberId, apiVersion: env.graphVersion() };

    if (message.type === "audio") {
      const lang = normalizeLang(meta.language as string | undefined) ?? "en";
      let note: Awaited<ReturnType<typeof prepareVoiceNote>> | null = null;
      let ttsProvider = "none";
      try {
        const speech = await synthesize(ttsConfigFromEnv(process.env), message.body, lang);
        ttsProvider = speech.provider;
        note = await prepareVoiceNote(speech.audio, speech.mime);
      } catch (err) {
        const reason = `Voice note not generated: ${(err as Error).message}`.slice(0, 300);
        // No follow-up text queued: deliver the answer as text instead of dropping it.
        if (!next) {
          const { messageId: wamid } = await sendMessage(graph, { type: "text", to: customer.phone, body: message.body });
          await db.message.update({ where: { id: message.id }, data: { status: "SENT", type: "text", externalId: wamid, metadata: { ...meta, voiceError: reason, sentAt: new Date().toISOString() } as any } });
          return { sent: wamid, fallback: "text" };
        }
        return fail(reason);
      }
      const mediaId = await uploadMedia(graph, note.data, note.mime, note.filename);
      const { messageId: wamid } = await sendMessage(graph, { type: "audio", to: customer.phone, mediaId, voice: note.voice });
      await db.message.update({ where: { id: message.id }, data: { status: "SENT", externalId: wamid, metadata: { ...meta, mediaId, mime: note.mime, ttsProvider, sentAt: new Date().toISOString() } as any } });
      await chain();
      return { sent: wamid, voice: true };
    }

    const { messageId: wamid } = await sendMessage(graph, { type: "text", to: customer.phone, body: message.body });
    await db.message.update({ where: { id: message.id }, data: { status: "SENT", externalId: wamid, metadata: { ...meta, sentAt: new Date().toISOString() } as any } });
    await chain();
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
export async function findStrandedWork(olderThanMs = 5 * 60_000) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const [events, messages] = await Promise.all([
    db.webhookEvent.findMany({ where: { status: "RECEIVED", receivedAt: { lt: cutoff } }, select: { id: true }, take: 200 }),
    db.message.findMany({ where: { direction: "OUTBOUND", status: "QUEUED", createdAt: { lt: cutoff, gt: new Date(Date.now() - 86_400_000) } }, select: { id: true, metadata: true }, take: 200 }),
  ]);
  return { eventIds: events.map(e => e.id), messageIds: messages.filter(m => (m.metadata as any)?.transport === "whatsapp").map(m => m.id) };
}
