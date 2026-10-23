// One place that decides which WhatsApp access token a workspace may use.
// Used by the API (connection test, media playback, template sync) and by the worker (sending).
import { decryptSecret } from "./secrets.js";

export class WhatsAppTokenUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppTokenUnavailable";
  }
}

export type TokenEnv = {
  /** ENCRYPTION_KEY (64 hex characters) */
  encryptionKey?: string;
  /** META_ACCESS_TOKEN: a system-user token for OceanBrown's own number */
  envAccessToken?: string;
  /** META_ACCESS_TOKEN_BUSINESS_ID: the only workspace allowed to use META_ACCESS_TOKEN */
  envTokenBusinessId?: string;
};

export function tokenEnvFrom(env: Record<string, string | undefined>): TokenEnv {
  return {
    encryptionKey: env.ENCRYPTION_KEY || undefined,
    envAccessToken: env.META_ACCESS_TOKEN || undefined,
    envTokenBusinessId: env.META_ACCESS_TOKEN_BUSINESS_ID || undefined,
  };
}

/** True when this workspace may fall back to the shared environment token. */
export function mayUseEnvToken(businessId: string, env: TokenEnv): boolean {
  return !!env.envAccessToken && !!env.envTokenBusinessId && env.envTokenBusinessId === businessId;
}

/**
 * Returns the access token for a connection. A workspace's own encrypted token always wins.
 * The environment token is used only by the single workspace named in META_ACCESS_TOKEN_BUSINESS_ID;
 * previously any workspace without a token silently used it, which let one tenant operate
 * another organization's number.
 */
export async function resolveWhatsAppToken(connection: { businessId: string; encryptedAccessToken: string | null }, env: TokenEnv): Promise<string> {
  if (connection.encryptedAccessToken) {
    if (!env.encryptionKey) throw new WhatsAppTokenUnavailable("ENCRYPTION_KEY is not configured on the server");
    return decryptSecret(connection.encryptedAccessToken, env.encryptionKey);
  }
  if (mayUseEnvToken(connection.businessId, env)) return env.envAccessToken!;
  throw new WhatsAppTokenUnavailable("No access token saved for this WhatsApp number. Save the workspace's own token in Integrations.");
}

/** Prisma filter for connections that may receive webhooks and send messages. */
export const VERIFIED_CONNECTION = { status: "CONNECTED", ownershipVerifiedAt: { not: null } } as const;
