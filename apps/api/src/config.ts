import { isValidEncryptionKey, resolveAiProvider } from "@oceanbrown/shared";

const isProd = process.env.NODE_ENV === "production";
const DEV_JWT_SECRET = "local-development-secret-change-before-deploy";
const PLACEHOLDERS = new Set(["", "replace-with-at-least-32-random-characters", "replace-with-64-hex-characters", "change-me"]);

function fail(message: string): never {
  throw new Error(`Configuration error: ${message}`);
}

function jwtSecret() {
  const value = process.env.JWT_SECRET ?? "";
  if (value.length >= 32 && !PLACEHOLDERS.has(value)) return value;
  if (isProd) fail("JWT_SECRET must be set to at least 32 random characters in production");
  return DEV_JWT_SECRET;
}

function encryptionKey() {
  const value = process.env.ENCRYPTION_KEY;
  if (isValidEncryptionKey(value)) return value;
  if (isProd) fail("ENCRYPTION_KEY must be 64 hex characters in production (openssl rand -hex 32)");
  return undefined;
}

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  publicApiUrl: process.env.API_URL ?? "http://localhost:4000",
  jwtSecret: jwtSecret(),
  encryptionKey: encryptionKey(),
  trustProxy: process.env.TRUST_PROXY === "true",
  allowSignup: process.env.ALLOW_SIGNUP ? process.env.ALLOW_SIGNUP === "true" : !isProd,
  sessionHours: 8,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  whatsapp: {
    liveEnabled: process.env.WHATSAPP_LIVE_ENABLED === "true",
    appSecret: process.env.META_APP_SECRET || undefined,
    verifyToken: process.env.META_VERIFY_TOKEN || undefined,
    accessToken: process.env.META_ACCESS_TOKEN || undefined,
    phoneNumberId: process.env.META_PHONE_NUMBER_ID || undefined,
    graphVersion: process.env.META_GRAPH_VERSION || undefined,
  },
  ai: {
    provider: resolveAiProvider(process.env.AI_PROVIDER),
    apiKey: process.env.AI_PROVIDER === "openai" ? process.env.OPENAI_API_KEY || undefined : process.env.ANTHROPIC_API_KEY || undefined,
    model: process.env.AI_MODEL || undefined,
  },
};

export function aiConfig() {
  return { provider: config.ai.apiKey ? config.ai.provider : ("simulator" as const), apiKey: config.ai.apiKey, model: config.ai.model };
}
