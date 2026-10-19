import { describe, expect, it } from "vitest";
import { detectIntent, isWithinServiceWindow, parseWebhookPayload, shouldApplyStatus, toE164, toWaRecipient } from "./whatsapp";
import { listMessageTemplates, sendMessage, WhatsAppApiError } from "./graph";
import { decryptSecret, encryptSecret, maskSecret } from "./secrets";
import { buildTurns, generateReply, parseModelOutput, rankKnowledge } from "./ai";

const payload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "2203000000", phone_number_id: "1234567890" },
            contacts: [{ profile: { name: "Awa" }, wa_id: "2207001111" }],
            messages: [
              { from: "2207001111", id: "wamid.A", timestamp: "1760000000", type: "text", text: { body: "Hello" } },
              { from: "2207001111", id: "wamid.B", timestamp: "1760000001", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "yes", title: "Yes please" } } },
            ],
          },
        },
        {
          field: "messages",
          value: { metadata: { phone_number_id: "1234567890" }, statuses: [{ id: "wamid.OUT", status: "read", timestamp: "1760000002", recipient_id: "2207001111" }] },
        },
      ],
    },
    { id: "WABA2", changes: [{ field: "messages", value: { metadata: { phone_number_id: "999" }, messages: [{ from: "2209", id: "wamid.C", type: "image", image: { id: "media1", mime_type: "image/jpeg" } }] } }] },
  ],
};

describe("webhook parsing", () => {
  it("processes every entry, change, message and status in a batch", () => {
    const items = parseWebhookPayload(payload);
    expect(items.length).toBe(4);
    const [a, b, status, image] = items as any[];
    expect(a.kind).toBe("message");
    expect(a.phone).toBe("+2207001111");
    expect(a.profileName).toBe("Awa");
    expect(a.text).toBe("Hello");
    expect(b.text).toBe("Yes please");
    expect(status.kind).toBe("status");
    expect(status.status).toBe("read");
    expect(image.phoneNumberId).toBe("999");
    expect(image.media.id).toBe("media1");
  });
  it("ignores foreign or malformed payloads", () => {
    expect(parseWebhookPayload({ object: "page", entry: [] }).length).toBe(0);
    expect(parseWebhookPayload(null).length).toBe(0);
  });
});

describe("whatsapp rules", () => {
  it("formats numbers", () => {
    expect(toE164("2207001111")).toBe("+2207001111");
    expect(toWaRecipient("+220 700 1111")).toBe("2207001111");
  });
  it("enforces the 24h customer service window", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    expect(isWithinServiceWindow(new Date("2026-10-12T13:00:00Z"), now)).toBe(true);
    expect(isWithinServiceWindow(new Date("2026-10-12T11:59:00Z"), now)).toBe(false);
    expect(isWithinServiceWindow(null, now)).toBe(false);
  });
  it("never downgrades delivery status", () => {
    expect(shouldApplyStatus("SENT", "DELIVERED")).toBe(true);
    expect(shouldApplyStatus("READ", "DELIVERED")).toBe(false);
    expect(shouldApplyStatus("SENT", "FAILED")).toBe(true);
    expect(shouldApplyStatus("READ", "FAILED")).toBe(false);
  });
  it("detects opt-out, opt-in and handover", () => {
    expect(detectIntent("STOP")).toBe("OPT_OUT");
    expect(detectIntent("start")).toBe("OPT_IN");
    expect(detectIntent("I want to speak to someone")).toBe("HANDOVER");
    expect(detectIntent("please stop by the shop")).toBe(null);
  });
});

describe("graph client", () => {
  it("sends a text message and returns the wamid", async () => {
    let captured: any;
    const fetchImpl = (async (url: string, init: any) => {
      captured = { url, init };
      return new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await sendMessage({ accessToken: "token-123456789012345", phoneNumberId: "111", fetchImpl }, { type: "text", to: "+2207001111", body: "Hi" });
    expect(r.messageId).toBe("wamid.X");
    expect(captured.url).toContain("/111/messages");
    const body = JSON.parse(captured.init.body);
    expect(body.to).toBe("2207001111");
    expect(body.text.body).toBe("Hi");
  });
  it("classifies throttling as retryable and window errors as permanent", async () => {
    const mk = (status: number, code: number) => (async () => new Response(JSON.stringify({ error: { message: "x", code } }), { status })) as unknown as typeof fetch;
    const send = (f: typeof fetch) => sendMessage({ accessToken: "t".repeat(20), phoneNumberId: "1", fetchImpl: f }, { type: "text", to: "+1", body: "x" }).catch(e => e);
    const throttled = await send(mk(429, 130429));
    expect(throttled instanceof WhatsAppApiError && throttled.retryable).toBe(true);
    const window = await send(mk(400, 131047));
    expect(window instanceof WhatsAppApiError && window.retryable).toBe(false);
  });
  it("syncs approved templates across Meta pagination", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(JSON.stringify(calls === 1
        ? { data: [{ id: "1", name: "order_update", language: "en_US", category: "UTILITY", status: "APPROVED", components: [] }], paging: { next: "https://graph.facebook.com/v23.0/WABA/message_templates?after=next" } }
        : { data: [{ id: "2", name: "sale", language: "fr", category: "MARKETING", status: "PENDING", components: [] }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const rows = await listMessageTemplates({ accessToken: "t".repeat(20), phoneNumberId: "1", fetchImpl }, "WABA");
    expect(rows.map(row => row.name)).toEqual(["order_update", "sale"]);
    expect(rows[0]?.status).toBe("APPROVED");
    expect(calls).toBe(2);
  });
});

describe("secrets", () => {
  const key = "a".repeat(64);
  it("round-trips with AES-GCM and uses a fresh IV", async () => {
    const a = await encryptSecret("EAAG-secret", key);
    const b = await encryptSecret("EAAG-secret", key);
    expect(a === b).toBe(false);
    expect(await decryptSecret(a, key)).toBe("EAAG-secret");
  });
  it("rejects a wrong key", async () => {
    const a = await encryptSecret("x", key);
    let failed = false;
    await decryptSecret(a, "b".repeat(64)).catch(() => (failed = true));
    expect(failed).toBe(true);
  });
  it("masks secrets", () => {
    expect(maskSecret("abcdefgh")).toBe("••••efgh");
  });
});

describe("ai helpers", () => {
  const docs = [
    { id: "1", title: "Opening hours", content: "We are open Monday to Friday 9am to 5pm." },
    { id: "2", title: "Delivery", content: "We deliver across Kanifing and Banjul." },
  ];
  it("ranks knowledge by keyword overlap", () => {
    expect(rankKnowledge("what are your opening hours", docs)[0]?.doc.id).toBe("1");
    expect(rankKnowledge("delivery to banjul?", docs)[0]?.doc.id).toBe("2");
  });
  it("builds alternating turns that start with the customer", () => {
    const turns = buildTurns([{ role: "agent", text: "Welcome" }, { role: "customer", text: "Hi" }, { role: "customer", text: "Hours?" }], "And Sunday?");
    expect(turns.length).toBe(1);
    expect(turns[0]?.role).toBe("user");
    expect(turns[0]?.content).toBe("Hi\nHours?\nAnd Sunday?");
  });
  it("parses model JSON and tolerates plain text", () => {
    expect(parseModelOutput('{"reply":"Hi","action":"CLARIFY","sources":[1]}').action).toBe("CLARIFY");
    expect(parseModelOutput("Just text").reply).toBe("Just text");
  });
  it("calls Anthropic and maps sources", async () => {
    let sent: any;
    const fetchImpl = (async (_url: string, init: any) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ content: [{ type: "text", text: '{"reply":"Mon-Fri 9-5","action":"ANSWER","sources":[1]}' }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await generateReply({ provider: "anthropic", apiKey: "k", fetchImpl }, { businessName: "Demo", knowledge: docs, history: [], message: "opening hours?" });
    expect(r.text).toBe("Mon-Fri 9-5");
    expect(r.sources[0]?.title).toBe("Opening hours");
    expect(sent.messages[0].role).toBe("user");
    expect(sent.system).toContain("Opening hours");
  });
  it("hands over without calling the model", async () => {
    const fetchImpl = (async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch;
    const r = await generateReply({ provider: "openai", apiKey: "k", fetchImpl }, { businessName: "Demo", knowledge: docs, history: [], message: "I want a refund" });
    expect(r.action).toBe("HANDOVER");
  });
});
