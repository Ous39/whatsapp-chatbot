import { Queue, type ConnectionOptions } from "bullmq";
import { config } from "./config.js";

export const QUEUE_NAME = "oceanbrown-events";

export function redisConnection(url: string, role: "producer" | "worker" = "producer"): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname !== "/" ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === "rediss:" ? {} : undefined,
    // Workers must block indefinitely; producers fail fast so HTTP requests never hang on Redis.
    ...(role === "worker" ? { maxRetriesPerRequest: null } : { enableOfflineQueue: false, maxRetriesPerRequest: 1 }),
  };
}

let queue: Queue | undefined;
function getQueue() {
  queue ??= new Queue(QUEUE_NAME, {
    connection: redisConnection(config.redisUrl),
    defaultJobOptions: { attempts: 6, backoff: { type: "exponential", delay: 3000 }, removeOnComplete: 2000, removeOnFail: 5000 },
  });
  return queue;
}

/**
 * Enqueue work for the worker. Failures are logged and swallowed: every job
 * source is persisted first, and the worker's recovery sweep re-enqueues
 * anything left behind, so an unavailable Redis never loses data.
 */
export async function enqueue(name: "process-webhook" | "send-message" | "send-campaign-recipient" | "start-campaign", data: Record<string, string>, jobId: string, log?: { warn: (o: object, m: string) => void }, delay = 0) {
  try {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Queue timeout")), 3000); });
    try {
      await Promise.race([getQueue().add(name, data, { jobId, ...(delay > 0 ? { delay } : {}) }), timeout]);
    } finally {
      clearTimeout(timer);
    }
    return true;
  } catch (err) {
    log?.warn({ err, name, jobId }, "Could not enqueue job; recovery sweep will retry");
    return false;
  }
}

export async function closeQueue() {
  await queue?.close();
}
