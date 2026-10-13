// Minimal WhatsApp Cloud API client built on fetch (Node 18+ / browsers).
import { toWaRecipient } from "./whatsapp.js";

export type GraphConfig = {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type OutboundPayload =
  | { type: "text"; to: string; body: string; previewUrl?: boolean; replyToId?: string }
  | { type: "template"; to: string; name: string; language: string; components?: unknown[] };

// Error codes Meta documents as transient (throttling / temporary failures).
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 80007, 130429, 131000, 131016, 131056, 133004]);

export class WhatsAppApiError extends Error {
  constructor(message: string, readonly httpStatus: number, readonly code?: number, readonly retryable = false, readonly details?: string) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

export const DEFAULT_GRAPH_VERSION = "v23.0";

function endpoint(cfg: GraphConfig, path: string) {
  const base = (cfg.baseUrl ?? "https://graph.facebook.com").replace(/\/$/, "");
  return `${base}/${cfg.apiVersion ?? DEFAULT_GRAPH_VERSION}/${path}`;
}

async function call(cfg: GraphConfig, path: string, init: { method: "GET" | "POST"; body?: unknown }) {
  if (!cfg.accessToken) throw new WhatsAppApiError("WhatsApp access token is not configured", 0, undefined, false);
  const f = cfg.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 15000);
  let res: Response;
  try {
    res = await f(endpoint(cfg, path), {
      method: init.method,
      headers: { Authorization: `Bearer ${cfg.accessToken}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    // Network failure or timeout: the request may or may not have reached Meta.
    throw new WhatsAppApiError(`Network error calling WhatsApp: ${(err as Error).message}`, 0, undefined, true);
  } finally {
    clearTimeout(timer);
  }
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    const e = json?.error ?? {};
    const code = typeof e.code === "number" ? e.code : undefined;
    const retryable = res.status === 429 || res.status >= 500 || (code !== undefined && RETRYABLE_CODES.has(code));
    throw new WhatsAppApiError(e.message ?? `WhatsApp API error (${res.status})`, res.status, code, retryable, e.error_data?.details);
  }
  return json;
}

export async function sendMessage(cfg: GraphConfig, msg: OutboundPayload): Promise<{ messageId: string }> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to: toWaRecipient(msg.to) };
  const body =
    msg.type === "text"
      ? { ...base, type: "text", text: { body: msg.body, preview_url: msg.previewUrl ?? false }, ...(msg.replyToId ? { context: { message_id: msg.replyToId } } : {}) }
      : { ...base, type: "template", template: { name: msg.name, language: { code: msg.language }, ...(msg.components ? { components: msg.components } : {}) } };
  const json = await call(cfg, `${encodeURIComponent(cfg.phoneNumberId)}/messages`, { method: "POST", body });
  const id = json?.messages?.[0]?.id;
  if (!id) throw new WhatsAppApiError("WhatsApp accepted the request but returned no message id", 200, undefined, false);
  return { messageId: String(id) };
}

/** Marks an inbound message as read (blue ticks). Best effort. */
export async function markAsRead(cfg: GraphConfig, messageId: string): Promise<void> {
  await call(cfg, `${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
    method: "POST",
    body: { messaging_product: "whatsapp", status: "read", message_id: messageId },
  });
}

/** Verifies a token + phone number id pair and returns the number's public details. */
export async function getPhoneNumberInfo(cfg: GraphConfig): Promise<{ displayPhone?: string; verifiedName?: string; qualityRating?: string }> {
  const json = await call(cfg, `${encodeURIComponent(cfg.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`, { method: "GET" });
  return { displayPhone: json.display_phone_number, verifiedName: json.verified_name, qualityRating: json.quality_rating };
}
