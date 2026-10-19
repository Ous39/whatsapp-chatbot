import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { registerAuth } from "./auth.js";
import { registerRoutes } from "./routes.js";
import { registerWebhook } from "./webhook.js";
import { registerWhatsAppRoutes } from "./whatsapp-routes.js";
import { registerVoiceRoutes } from "./voice-routes.js";
import { registerCommercialRoutes } from "./commercial-routes.js";

export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.authorization", "req.headers.cookie", "*.accessToken", "*.password", "*.passwordHash", "*.encryptedAccessToken"] },
    bodyLimit: 1024 * 1024,
    trustProxy: config.trustProxy,
  });

  await app.register(cors, { origin: config.appUrl.split(",").map(s => s.trim()), credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] });
  await app.register(cookie);
  await app.register(jwt, { secret: config.jwtSecret, cookie: { cookieName: "ob_session", signed: false }, sign: { algorithm: "HS256" }, verify: { algorithms: ["HS256"] } });
  // same-site (not same-origin) so the dashboard on app.<domain> can play voice notes served by api.<domain>.
  await app.register(helmet, { crossOriginResourcePolicy: { policy: "same-site" } });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  // Keep the raw bytes for Meta signature verification; treat an empty JSON body as {} (e.g. POST /auth/logout).
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    const raw = body as Buffer;
    (req as typeof req & { rawBody: Buffer }).rawBody = raw;
    if (!raw.length) return done(null, {});
    try {
      done(null, JSON.parse(raw.toString("utf8")));
    } catch {
      const err = new Error("Request body is not valid JSON") as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  await registerAuth(app);
  await registerRoutes(app);
  await registerWebhook(app);
  await registerWhatsAppRoutes(app);
  await registerVoiceRoutes(app);
  await registerCommercialRoutes(app);

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "Not found" }));
  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & { statusCode?: number; code?: string };
    // Prisma "record not found" should be a 404, not a 500.
    if (err.code === "P2025") return reply.code(404).send({ error: "Not found" });
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, "Unhandled error");
    return reply.code(status).send({ error: status < 500 ? err.message : "Internal server error" });
  });
  return app;
}
