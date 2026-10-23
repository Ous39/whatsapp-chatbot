import type { FastifyInstance } from "fastify";
import { db } from "@oceanbrown/db";
import {
  canSpeak,
  detectTextLanguage,
  downloadMedia,
  generateReply,
  normalizeLang,
  sttConfigFromEnv,
  synthesize,
  transcribe,
  ttsConfigFromEnv,
  voiceStatus,
  VERIFIED_CONNECTION,
  WhatsAppApiError,
  type Lang,
} from "@oceanbrown/shared";
import { requirePermission, tenantId } from "./auth.js";
import { aiConfig, config } from "./config.js";
import { whatsAppTokenFor } from "./whatsapp-routes.js";

const MAX_UPLOAD = 10 * 1024 * 1024;

async function playgroundReply(businessId: string, message: string, language: Lang, speak: boolean) {
  const [knowledge, business] = await Promise.all([
    db.knowledgeSource.findMany({ where: { businessId, status: "PUBLISHED" }, select: { id: true, title: true, content: true } }),
    db.business.findUnique({ where: { id: businessId }, select: { name: true, industry: true, timezone: true } }),
  ]);
  const tts = ttsConfigFromEnv(process.env);
  const spoken = speak && canSpeak(tts, language);
  const reply = await generateReply(aiConfig(), { businessName: business?.name ?? "this business", industry: business?.industry, timezone: business?.timezone, knowledge, history: [], message, language, spoken });
  let audio: { base64: string; mime: string } | null = null;
  let voiceError: string | null = null;
  if (spoken) {
    try {
      const speech = await synthesize(tts, reply.text, language);
      audio = { base64: Buffer.from(speech.audio).toString("base64"), mime: speech.mime };
    } catch (err) {
      voiceError = (err as Error).message;
    }
  } else if (speak) {
    voiceError = `No voice is configured for this language (${language}).`;
  }
  return { text: reply.text, action: reply.action, sources: reply.sources, provider: reply.provider, language, audio, voiceError, simulated: true };
}

export async function registerVoiceRoutes(app: FastifyInstance) {
  // Raw audio uploads from the dashboard microphone (webm/ogg/mp4/mpeg).
  app.addContentTypeParser(/^audio\/.+/, { parseAs: "buffer", bodyLimit: MAX_UPLOAD }, (_req, body, done) => done(null, body));

  app.get("/voice/status", { preHandler: requirePermission("conversation:read") }, async () => voiceStatus(process.env));

  // Playground by voice: transcribe → grounded reply in the same language → spoken answer. Never sends to WhatsApp.
  app.post("/simulator/voice", { preHandler: requirePermission("conversation:reply"), bodyLimit: MAX_UPLOAD, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = req.body as Buffer;
    const mime = String(req.headers["content-type"] ?? "");
    if (!Buffer.isBuffer(body) || body.length < 200 || !mime.startsWith("audio/")) return reply.code(400).send({ error: "Send the recording as an audio/* request body" });
    const stt = sttConfigFromEnv(process.env);
    if (stt.provider === "none") return reply.code(422).send({ error: "Speech-to-text is not configured (set STT_PROVIDER)" });
    const hint = normalizeLang((req.query as { language?: string }).language);
    let transcript;
    try {
      transcript = await transcribe(stt, new Uint8Array(body), mime, hint);
    } catch (err) {
      req.log.warn({ err }, "Playground transcription failed");
      return reply.code(502).send({ error: `Transcription failed: ${(err as Error).message}` });
    }
    if (!transcript.text) return reply.code(422).send({ error: "No speech was recognised in the recording" });
    const language = transcript.language ?? hint ?? detectTextLanguage(transcript.text) ?? "en";
    return { transcript: transcript.text, detectedLanguage: transcript.rawLanguage ?? null, ...(await playgroundReply(tenantId(req), transcript.text, language, true)) };
  });

  // Text playground with an optional spoken answer and explicit language.
  app.post("/simulator/speak", { preHandler: requirePermission("conversation:reply"), config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { message, language } = (req.body ?? {}) as { message?: unknown; language?: unknown };
    if (typeof message !== "string" || !message.trim() || message.length > 4096) return reply.code(400).send({ error: "Message is required" });
    const lang = normalizeLang(typeof language === "string" ? language : null) ?? detectTextLanguage(message) ?? "en";
    return playgroundReply(tenantId(req), message, lang, true);
  });

  // Streams a voice note (inbound from a customer or a sent AI voice reply) from Meta for playback in the inbox.
  app.get("/messages/:id/media", { preHandler: requirePermission("conversation:read") }, async (req, reply) => {
    const businessId = tenantId(req);
    const message = await db.message.findFirst({ where: { id: String((req.params as { id: string }).id), businessId }, select: { metadata: true } });
    const meta = (message?.metadata as Record<string, any> | null) ?? {};
    const mediaId = meta.media?.id ?? meta.mediaId;
    if (!message || !mediaId) return reply.code(404).send({ error: "No media for this message" });
    const connection = await db.whatsAppConnection.findFirst({ where: { businessId, ...VERIFIED_CONNECTION }, orderBy: { createdAt: "asc" } });
    if (!connection) return reply.code(404).send({ error: "No verified WhatsApp connection" });
    // Same rule as sending: the workspace's own token, or the env token only for its designated workspace.
    const accessToken = await whatsAppTokenFor(connection);
    try {
      const media = await downloadMedia({ accessToken, phoneNumberId: connection.phoneNumberId, apiVersion: config.whatsapp.graphVersion }, String(mediaId));
      return reply.header("Content-Type", media.mime).header("Cache-Control", "private, max-age=3600").header("Content-Disposition", "inline").send(Buffer.from(media.data));
    } catch (err) {
      // Meta keeps media for a limited time; expired media is a 404 for the dashboard.
      const status = err instanceof WhatsAppApiError && err.httpStatus === 404 ? 404 : 502;
      return reply.code(status).send({ error: "Voice note is no longer available from WhatsApp" });
    }
  });
}
