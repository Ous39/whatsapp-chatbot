import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { db } from "@oceanbrown/db";
import { findStrandedWork, markSendExhausted, processWebhookEvent, sendQueuedMessage, aiConfigFromEnv } from "./processor.js";

const QUEUE_NAME = "oceanbrown-events";

function connection(): ConnectionOptions {
  const u = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname !== "/" ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

const log = {
  info: (o: object, m: string) => console.log(JSON.stringify({ level: "info", msg: m, ...o })),
  warn: (o: object, m: string) => console.warn(JSON.stringify({ level: "warn", msg: m, ...o })),
  error: (o: object, m: string) => console.error(JSON.stringify({ level: "error", msg: m, ...o })),
};

const queue = new Queue(QUEUE_NAME, {
  connection: connection(),
  defaultJobOptions: { attempts: 6, backoff: { type: "exponential", delay: 3000 }, removeOnComplete: 2000, removeOnFail: 5000 },
});
const enqueue = (name: "send-message" | "process-webhook", data: Record<string, string>, jobId: string) => queue.add(name, data, { jobId });

const worker = new Worker(
  QUEUE_NAME,
  async job => {
    switch (job.name) {
      case "process-webhook":
        return processWebhookEvent(String(job.data.eventId), (n, d, id) => enqueue(n, d, id), log);
      case "send-message":
        return sendQueuedMessage(String(job.data.messageId), log);
      case "recover-stranded": {
        const { eventIds, messageIds } = await findStrandedWork();
        // Same deterministic job ids as the API, so a job that is already queued is not duplicated.
        await Promise.all([...eventIds.map(id => enqueue("process-webhook", { eventId: id }, `webhook-${id}`)), ...messageIds.map(id => enqueue("send-message", { messageId: id }, `send-${id}`))]);
        return { eventIds: eventIds.length, messageIds: messageIds.length };
      }
      default:
        log.warn({ name: job.name }, "Unknown job ignored");
        return { ignored: true };
    }
  },
  { connection: connection(), concurrency: Number(process.env.WORKER_CONCURRENCY ?? 10) },
);

worker.on("failed", async (job, error) => {
  log.error({ jobId: job?.id, name: job?.name, attempts: job?.attemptsMade, reason: error.message }, "Job failed");
  if (job?.name === "send-message" && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await markSendExhausted(String(job.data.messageId), error.message).catch(() => undefined);
  }
  if (job?.name === "process-webhook" && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await db.webhookEvent.update({ where: { id: String(job.data.eventId) }, data: { status: "FAILED" } }).catch(() => undefined);
  }
});
worker.on("stalled", id => log.warn({ jobId: id }, "Job stalled"));

await queue.upsertJobScheduler("recover-stranded", { every: 60_000 }, { name: "recover-stranded", data: {}, opts: { attempts: 1, removeOnComplete: 10, removeOnFail: 10 } });

log.info({ ai: aiConfigFromEnv().provider, live: process.env.WHATSAPP_LIVE_ENABLED === "true" }, "Worker ready");

const stop = async () => {
  await worker.close();
  await queue.close();
  await db.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
