// Pure helpers for the WhatsApp Cloud API. No database or framework imports so
// they can be unit-tested and shared by the API and the worker.

export type InboundMessage = {
  kind: "message";
  phoneNumberId: string;
  /** WhatsApp Business Account id from the webhook entry (entry.id). */
  wabaId?: string;
  displayPhone?: string;
  waId: string;
  phone: string;
  profileName?: string;
  messageId: string;
  timestamp: Date;
  type: string;
  text: string;
  replyToId?: string;
  media?: { id: string; mimeType?: string; caption?: string; filename?: string };
};

export type StatusUpdate = {
  kind: "status";
  phoneNumberId: string;
  wabaId?: string;
  messageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  recipientId?: string;
  timestamp: Date;
  errors?: { code: number; title: string; details?: string }[];
};

export type WebhookItem = InboundMessage | StatusUpdate;

const STATUS_VALUES = new Set(["sent", "delivered", "read", "failed"]);

/** Convert a WhatsApp wa_id (digits only) to E.164. */
export function toE164(waId: string): string {
  const digits = String(waId).replace(/\D/g, "");
  return `+${digits}`;
}

/** WhatsApp wants recipient numbers without the leading "+". */
export function toWaRecipient(phone: string): string {
  return String(phone).replace(/\D/g, "");
}

function toDate(seconds: unknown): Date {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

function extractText(m: any): { type: string; text: string; media?: InboundMessage["media"] } {
  const type = typeof m?.type === "string" ? m.type : "unknown";
  switch (type) {
    case "text":
      return { type, text: String(m.text?.body ?? "") };
    case "interactive": {
      const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
      return { type, text: String(r?.title ?? r?.id ?? "") };
    }
    case "button":
      return { type, text: String(m.button?.text ?? m.button?.payload ?? "") };
    case "image":
    case "video":
    case "audio":
    case "sticker":
    case "document": {
      const media = m[type] ?? {};
      const caption = typeof media.caption === "string" ? media.caption : undefined;
      return {
        type,
        text: caption ?? `[${type}${media.filename ? `: ${media.filename}` : ""}]`,
        media: { id: String(media.id ?? ""), mimeType: media.mime_type, caption, filename: media.filename },
      };
    }
    case "location": {
      const l = m.location ?? {};
      const label = [l.name, l.address].filter(Boolean).join(", ");
      return { type, text: `[location${label ? `: ${label}` : ""} ${l.latitude ?? "?"},${l.longitude ?? "?"}]` };
    }
    case "reaction":
      return { type, text: String(m.reaction?.emoji ?? "") };
    case "contacts":
      return { type, text: `[contact card${m.contacts?.[0]?.name?.formatted_name ? `: ${m.contacts[0].name.formatted_name}` : ""}]` };
    default:
      return { type, text: `[unsupported message type: ${type}]` };
  }
}

/**
 * Flatten a Meta webhook delivery into individual message/status items.
 * Meta can batch several entries and changes in one POST, so every
 * entry/change/message is processed, not just the first one.
 */
export function parseWebhookPayload(payload: unknown): WebhookItem[] {
  const out: WebhookItem[] = [];
  const p = payload as any;
  if (!p || p.object !== "whatsapp_business_account" || !Array.isArray(p.entry)) return out;
  for (const entry of p.entry) {
    const wabaId = entry?.id ? String(entry.id) : undefined;
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field !== "messages") continue;
      const value = change.value ?? {};
      const phoneNumberId = String(value.metadata?.phone_number_id ?? "");
      if (!phoneNumberId) continue;
      const displayPhone = value.metadata?.display_phone_number;
      const contacts: any[] = Array.isArray(value.contacts) ? value.contacts : [];
      for (const m of Array.isArray(value.messages) ? value.messages : []) {
        if (!m?.id || !m?.from) continue;
        const contact = contacts.find(c => c?.wa_id === m.from) ?? contacts[0];
        const { type, text, media } = extractText(m);
        out.push({
          kind: "message",
          phoneNumberId,
          wabaId,
          displayPhone,
          waId: String(m.from),
          phone: toE164(m.from),
          profileName: contact?.profile?.name,
          messageId: String(m.id),
          timestamp: toDate(m.timestamp),
          type,
          text,
          replyToId: m.context?.id,
          media,
        });
      }
      for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
        if (!s?.id || !STATUS_VALUES.has(s.status)) continue;
        out.push({
          kind: "status",
          phoneNumberId,
          wabaId,
          messageId: String(s.id),
          status: s.status,
          recipientId: s.recipient_id,
          timestamp: toDate(s.timestamp),
          errors: Array.isArray(s.errors)
            ? s.errors.map((e: any) => ({ code: Number(e.code), title: String(e.title ?? e.message ?? ""), details: e.error_data?.details }))
            : undefined,
        });
      }
    }
  }
  return out;
}

/** Customer-service window: free-form replies are allowed for 24h after the customer's last message. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
export function isWithinServiceWindow(lastInboundAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!lastInboundAt) return false;
  const delta = now.getTime() - new Date(lastInboundAt).getTime();
  return delta >= 0 && delta < SERVICE_WINDOW_MS;
}

/** Status precedence so out-of-order callbacks never downgrade a message (read must not become delivered). */
const STATUS_RANK: Record<string, number> = { RECEIVED: 0, QUEUED: 1, UNCERTAIN: 1, SENT: 2, DELIVERED: 3, READ: 4, FAILED: 5 };
export function shouldApplyStatus(current: string, next: string): boolean {
  if (current === next) return false;
  if (next === "FAILED") return current !== "READ" && current !== "DELIVERED";
  return (STATUS_RANK[next] ?? 0) > (STATUS_RANK[current] ?? 0) && current !== "FAILED";
}

// English, French and Wolof keywords. Opt-out/in must be the whole message to avoid false positives.
export const OPT_OUT_PATTERN = /^\s*(stop|stop all|unsubscribe|opt[\s-]?out|cancel messages|arr[êe]t|arr[êe]ter|d[ée]sabonner|d[ée]sinscrire)\s*[.!]*\s*$/i;
export const OPT_IN_PATTERN = /^\s*(start|unstop|subscribe|opt[\s-]?in|d[ée]marrer|abonner)\s*[.!]*\s*$/i;
export const HANDOVER_PATTERN = new RegExp(
  [
    // English
    "\\b(human|real person|a person|speak to (someone|staff|a manager)|talk to (someone|staff|a manager)|manager|complaint|complain|angry|refund|customer service)\\b",
    // French
    "(un humain|une vraie personne|parler [àa] (quelqu'un|une personne|un humain|un agent|un conseiller|un responsable)|le responsable|r[ée]clamation|plainte|rembourse)",
    // Wolof: "wax ak nit" (talk with a person), "nit ku dund" (a real person), "jëkkër/boroom" (owner/boss)
    "(wax ak (benn )?nit|nit ku dund|boroom bi|dama mere|xaalis bi delloo|delloo xaalis)",
  ].join("|"),
  "i",
);

export function detectIntent(text: string): "OPT_OUT" | "OPT_IN" | "HANDOVER" | null {
  if (OPT_OUT_PATTERN.test(text)) return "OPT_OUT";
  if (OPT_IN_PATTERN.test(text)) return "OPT_IN";
  if (HANDOVER_PATTERN.test(text)) return "HANDOVER";
  return null;
}
