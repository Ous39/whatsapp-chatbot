import { isValidEncryptionKey, resolveAiProvider } from "@oceanbrown/shared";

const isProd = process.env.NODE_ENV === "production";
// Development conveniences (fallback secret, tokens echoed in API responses) need an explicit
// development or test environment. An unset or misspelled NODE_ENV is treated like production.
const isDevOrTest = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
const DEV_JWT_SECRET = "local-development-secret-change-before-deploy";
const PLACEHOLDERS = new Set(["", "replace-with-at-least-32-random-characters", "replace-with-64-hex-characters", "change-me"]);

function fail(message: string): never {
  throw new Error(`Configuration error: ${message}`);
}

function jwtSecret() {
  const value = process.env.JWT_SECRET ?? "";
  if (value.length >= 32 && !PLACEHOLDERS.has(value) && value !== DEV_JWT_SECRET) return value;
  if (!isDevOrTest) fail("JWT_SECRET must be set to at least 32 random characters (NODE_ENV is not development or test)");
  return DEV_JWT_SECRET;
}

/** Accepts "false", "true", a hop count ("1") or a comma-separated list of proxy IPs/CIDRs. */
function trustProxy(): boolean | number | string[] {
  const value = (process.env.TRUST_PROXY ?? "").trim();
  if (!value || value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  // "true" trusts every X-Forwarded-For hop, so a client can spoof its IP and dodge rate limits.
  // One reverse proxy in front of the API should use TRUST_PROXY=1.
  if (value === "true") return isDevOrTest ? true : 1;
  return value.split(",").map(s => s.trim()).filter(Boolean);
}

function encryptionKey() {
  const value = process.env.ENCRYPTION_KEY;
  if (isValidEncryptionKey(value)) return value;
  if (!isDevOrTest) fail("ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32) unless NODE_ENV is development or test");
  return undefined;
}

export const config = {
  isProd,
  isDevOrTest,
  port: Number(process.env.PORT ?? 4000),
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  publicApiUrl: process.env.API_URL ?? "http://localhost:4000",
  jwtSecret: jwtSecret(),
  encryptionKey: encryptionKey(),
  trustProxy: trustProxy(),
  allowSignup: process.env.ALLOW_SIGNUP ? process.env.ALLOW_SIGNUP === "true" : isDevOrTest,
  // Returns password-reset and invitation tokens in API responses so they can be tested without email.
  // Only honoured in development or test, and only when explicitly enabled.
  devExposeTokens: isDevOrTest && process.env.DEV_EXPOSE_TOKENS === "true",
  sessionHours: 8,
  email: {
    resendApiKey: process.env.RESEND_API_KEY || undefined,
    from: process.env.EMAIL_FROM || "OceanBrown <noreply@example.com>",
  },
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  whatsapp: {
    liveEnabled: process.env.WHATSAPP_LIVE_ENABLED === "true",
    appSecret: process.env.META_APP_SECRET || undefined,
    verifyToken: process.env.META_VERIFY_TOKEN || undefined,
    accessToken: process.env.META_ACCESS_TOKEN || undefined,
    // The environment token may only be used by this one workspace (OceanBrown's own number).
    accessTokenBusinessId: process.env.META_ACCESS_TOKEN_BUSINESS_ID || undefined,
    phoneNumberId: process.env.META_PHONE_NUMBER_ID || undefined,
    graphVersion: process.env.META_GRAPH_VERSION || undefined,
    appId: process.env.META_APP_ID || undefined,
    embeddedSignupConfigId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || undefined,
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
