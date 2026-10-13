import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { db } from "@oceanbrown/db";
import { parseWebhookPayload } from "@oceanbrown/shared";
import { config } from "./config.js";
import { enqueue } from "./queue.js";

export function validMetaSignature(raw: Buffer, signature: string | string[] | undefined, secret: string | undefined) {
  if (typeof signature !== "string" || !secret) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export async function registerWebhook(app: FastifyInstance) {
  // Meta subscription handshake.
  app.get("/webhooks/meta", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const expected = config.whatsapp.verifyToken;
    // Previously an unset META_VERIFY_TOKEN matched a request with no token (undefined === undefined).
    if (expected && q["hub.mode"] === "subscribe" && typeof q["hub.verify_token"] === "string" && safeEqual(q["hub.verify_token"], expected) && q["hub.challenge"]) {
      return reply.type("text/plain").send(String(q["hub.challenge"]).slice(0, 200));
    }
    return reply.code(403).send("Verification failed");
  });

  // Event delivery: authenticate the raw body, persist, acknowledge fast, process in the worker.
  app.post("/webhooks/meta", { config: { rateLimit: { max: 3000, timeWindow: "1 minute" } } }, async (req, reply) => {
    const raw = (req as typeof req & { rawBody?: Buffer }).rawBody;
    if (!raw || !validMetaSignature(raw, req.headers["x-hub-signature-256"], config.whatsapp.appSecret)) {
      req.log.warn("Rejected webhook with invalid signature");
      return reply.code(401).send({ error: "Invalid signature" });
    }
    const payload = req.body as any;
    const items = parseWebhookPayload(payload);
    const phoneNumberIds = [...new Set(items.map(i => i.phoneNumberId))];
    const connections = phoneNumberIds.length ? await db.whatsAppConnection.findMany({ where: { phoneNumberId: { in: phoneNumberIds } }, select: { id: true, businessId: true } }) : [];
    // One delivery = one event row, keyed by the body hash so Meta retries are idempotent.
    const externalId = "sha256:" + crypto.createHash("sha256").update(raw).digest("hex");
    const businessId = connections.length === 1 ? connections[0]!.businessId : null;
    const status = !items.length ? "IGNORED" : connections.length ? "RECEIVED" : "UNMATCHED";
    const event = await db.webhookEvent.upsert({ where: { externalId }, update: {}, create: { externalId, businessId, payload, status } });
    if (connections.length) {
      await db.whatsAppConnection.updateMany({ where: { id: { in: connections.map(c => c.id) } }, data: { lastWebhookAt: new Date(), webhookHealthy: true } });
    }
    if (event.status === "RECEIVED") await enqueue("process-webhook", { eventId: event.id }, `webhook-${event.id}`, req.log);
    return reply.code(200).send({ received: true });
  });
}
