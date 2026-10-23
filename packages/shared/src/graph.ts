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
  | { type: "audio"; to: string; mediaId: string; voice?: boolean }
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
      : msg.type === "audio"
        ? { ...base, type: "audio", audio: { id: msg.mediaId, ...(msg.voice ? { voice: true } : {}) } }
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

export type PhoneNumberInfo = {
  displayPhone?: string;
  verifiedName?: string;
  qualityRating?: string;
  /** VERIFIED | NOT_VERIFIED */
  codeVerificationStatus?: string;
  /** APPROVED | DECLINED | EXPIRED | PENDING_REVIEW | NONE */
  nameStatus?: string;
  /** CLOUD_API once registered for messaging */
  platformType?: string;
};

/** Verifies a token + phone number id pair and returns the number's public details and review states. */
export async function getPhoneNumberInfo(cfg: GraphConfig): Promise<PhoneNumberInfo> {
  const json = await call(cfg, `${encodeURIComponent(cfg.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,name_status,platform_type`, { method: "GET" });
  return {
    displayPhone: json.display_phone_number,
    verifiedName: json.verified_name,
    qualityRating: json.quality_rating,
    codeVerificationStatus: json.code_verification_status,
    nameStatus: json.name_status,
    platformType: json.platform_type,
  };
}

/**
 * Registers a number for Cloud API messaging (required after Embedded Signup, within 14 days).
 * The 6-digit PIN becomes the number's two-step verification PIN; OceanBrown stores it encrypted.
 */
export async function registerPhoneNumber(cfg: GraphConfig, pin: string): Promise<void> {
  if (!/^\d{6}$/.test(pin)) throw new WhatsAppApiError("Registration PIN must be 6 digits", 0, undefined, false);
  const json = await call(cfg, `${encodeURIComponent(cfg.phoneNumberId)}/register`, { method: "POST", body: { messaging_product: "whatsapp", pin } });
  if (json?.success === false) throw new WhatsAppApiError("Meta did not confirm the registration", 200, undefined, false);
}

export type WhatsAppTemplate = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "PAUSED" | "DISABLED";
  components: unknown[];
  qualityScore?: string;
};

/** Subscribes this Meta app to a customer's WABA so its webhooks reach us (required after Embedded Signup). */
export async function subscribeAppToWaba(cfg: GraphConfig, wabaId: string): Promise<void> {
  const json = await call(cfg, `${encodeURIComponent(wabaId)}/subscribed_apps`, { method: "POST" });
  if (json?.success === false) throw new WhatsAppApiError("Meta did not confirm the webhook subscription", 200, undefined, false);
}

/**
 * Lists the phone number ids that belong to a WhatsApp Business Account, using the caller's token.
 * Used to prove a workspace owns a number before any message is routed to it.
 */
export async function listWabaPhoneNumberIds(cfg: GraphConfig, wabaId: string, maxPages = 5): Promise<string[]> {
  const ids: string[] = [];
  let path = `${encodeURIComponent(wabaId)}/phone_numbers?fields=id&limit=100`;
  for (let page = 0; page < maxPages && path; page += 1) {
    const json = await call(cfg, path, { method: "GET" });
    for (const item of Array.isArray(json?.data) ? json.data : []) if (item?.id) ids.push(String(item.id));
    const next = json?.paging?.next;
    if (!next) break;
    const url = new URL(String(next));
    path = `${url.pathname.replace(/^\/v\d+(?:\.\d+)?\//, "")}${url.search}`;
  }
  return ids;
}

/** Fetches every template for a WhatsApp Business Account, following Meta pagination. */
export async function listMessageTemplates(cfg: GraphConfig, wabaId: string, maxPages = 20): Promise<WhatsAppTemplate[]> {
  const rows: WhatsAppTemplate[] = [];
  let path = `${encodeURIComponent(wabaId)}/message_templates?fields=id,name,language,category,status,components,quality_score&limit=100`;
  for (let page = 0; page < maxPages && path; page += 1) {
    const json = await call(cfg, path, { method: "GET" });
    for (const item of Array.isArray(json?.data) ? json.data : []) {
      if (!item?.id || !item?.name || !item?.language) continue;
      const status = ["PENDING", "APPROVED", "REJECTED", "PAUSED", "DISABLED"].includes(item.status) ? item.status : "PENDING";
      rows.push({
        id: String(item.id),
        name: String(item.name),
        language: String(item.language),
        category: String(item.category ?? "UTILITY"),
        status,
        components: Array.isArray(item.components) ? item.components : [],
        qualityScore: item.quality_score?.score ? String(item.quality_score.score) : undefined,
      });
    }
    const next = json?.paging?.next;
    if (!next) break;
    const url = new URL(String(next));
    path = `${url.pathname.replace(/^\/v\d+(?:\.\d+)?\//, "")}${url.search}`;
  }
  return rows;
}

/** Uploads audio (or other media) and returns the WhatsApp media id. */
export async function uploadMedia(cfg: GraphConfig, data: Uint8Array<ArrayBuffer>, mime: string, filename: string): Promise<string> {
  if (!cfg.accessToken) throw new WhatsAppApiError("WhatsApp access token is not configured", 0, undefined, false);
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([data], { type: mime }), filename);
  const f = cfg.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(endpoint(cfg, `${encodeURIComponent(cfg.phoneNumberId)}/media`), { method: "POST", headers: { Authorization: `Bearer ${cfg.accessToken}` }, body: form });
  } catch (err) {
    throw new WhatsAppApiError(`Network error uploading media: ${(err as Error).message}`, 0, undefined, true);
  }
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json?.id) {
    const e = json?.error ?? {};
    throw new WhatsAppApiError(e.message ?? `Media upload failed (${res.status})`, res.status, e.code, res.status === 429 || res.status >= 500);
  }
  return String(json.id);
}

/** Downloads media sent by a customer (voice notes, images). Max 16 MB for audio. */
export async function downloadMedia(cfg: GraphConfig, mediaId: string, maxBytes = 16 * 1024 * 1024): Promise<{ data: Uint8Array<ArrayBuffer>; mime: string }> {
  const meta = await call(cfg, encodeURIComponent(mediaId), { method: "GET" });
  if (!meta?.url) throw new WhatsAppApiError("Media URL missing", 200, undefined, false);
  if (Number(meta.file_size) > maxBytes) throw new WhatsAppApiError("Media file is too large", 413, undefined, false);
  // The URL is short-lived and must be fetched with the same bearer token.
  const host = new URL(meta.url).hostname;
  if (!/(^|\.)(fbsbx\.com|facebook\.com|whatsapp\.net|fbcdn\.net)$/.test(host) && !cfg.baseUrl) throw new WhatsAppApiError(`Unexpected media host ${host}`, 0, undefined, false);
  const f = cfg.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(meta.url, { headers: { Authorization: `Bearer ${cfg.accessToken}` }, signal: AbortSignal.timeout(cfg.timeoutMs ?? 30_000) });
  } catch (err) {
    throw new WhatsAppApiError(`Network error downloading media: ${(err as Error).message}`, 0, undefined, true);
  }
  if (!res.ok) throw new WhatsAppApiError(`Media download failed (${res.status})`, res.status, undefined, res.status >= 500);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new WhatsAppApiError("Media file is too large", 413, undefined, false);
  return { data: buf, mime: String(meta.mime_type ?? res.headers.get("content-type") ?? "application/octet-stream") };
}
