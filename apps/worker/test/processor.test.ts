import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state: { message: any; connection: any; updates: any[] } = { message: null, connection: null, updates: [] };

vi.mock("@oceanbrown/db", () => ({
  db: {
    message: {
      findUnique: vi.fn(async () => state.message),
      update: vi.fn(async (args: any) => {
        state.updates.push(args);
        return args;
      }),
    },
    whatsAppConnection: { findFirst: vi.fn(async () => state.connection), update: vi.fn(async () => ({})) },
  },
}));

import { sendQueuedMessage } from "../src/processor";

const log = { info: () => {}, warn: () => {}, error: () => {} };
const recent = () => new Date(Date.now() - 60_000);

function queued(customer: Record<string, unknown> = {}, metadata: Record<string, unknown> = { transport: "whatsapp" }) {
  return {
    id: "m1",
    businessId: "b1",
    direction: "OUTBOUND",
    status: "QUEUED",
    body: "Hello",
    metadata,
    conversation: { customer: { phone: "+2207001111", optedOutAt: null, lastInboundAt: recent(), ...customer } },
  };
}

describe("sendQueuedMessage", () => {
  beforeEach(() => {
    state.updates = [];
    state.connection = { id: "c1", phoneNumberId: "111", encryptedAccessToken: null, status: "CONNECTED" };
    process.env.WHATSAPP_LIVE_ENABLED = "true";
    process.env.META_ACCESS_TOKEN = "test-token-1234567890";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WHATSAPP_LIVE_ENABLED;
  });

  it("never sends while live mode is off", async () => {
    process.env.WHATSAPP_LIVE_ENABLED = "false";
    state.message = queued();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await sendQueuedMessage("m1", log)).toEqual({ simulated: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses customers who opted out", async () => {
    state.message = queued({ optedOutAt: new Date() });
    const r = await sendQueuedMessage("m1", log);
    expect(r).toEqual({ failed: "Customer opted out" });
    expect(state.updates[0].data.status).toBe("FAILED");
  });

  it("refuses free-form messages outside the 24h window", async () => {
    state.message = queued({ lastInboundAt: new Date(Date.now() - 2 * 86_400_000) });
    const r: any = await sendQueuedMessage("m1", log);
    expect(r.failed).toContain("24-hour");
  });

  it("sends through the Cloud API and stores the wamid", async () => {
    state.message = queued();
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.OK" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await sendQueuedMessage("m1", log)).toEqual({ sent: "wamid.OK" });
    expect(state.updates[0].data.status).toBe("SENT");
    expect(state.updates[0].data.externalId).toBe("wamid.OK");
  });

  it("rethrows throttling errors so the job is retried", async () => {
    state.message = queued();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "slow down", code: 130429 } }), { status: 429 })));
    await expect(sendQueuedMessage("m1", log)).rejects.toThrow("slow down");
    expect(state.updates.length).toBe(0);
  });

  it("sends a Wolof voice note, then the chained text", async () => {
    process.env.TTS_WO = "http";
    process.env.TTS_WO_URL = "http://tts-wolof:8000/synthesize";
    state.message = { ...queued({}, { transport: "whatsapp", language: "wo", thenSend: "m2" }), type: "audio", body: "Jërëjëf" };
    const bodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      if (url.startsWith("http://tts-wolof")) return new Response(new Uint8Array([79, 103, 103, 83]), { status: 200, headers: { "content-type": "audio/ogg" } });
      if (url.endsWith("/media")) return new Response(JSON.stringify({ id: "media1" }), { status: 200 });
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ messages: [{ id: "wamid.VOICE" }] }), { status: 200 });
    }));
    const chained: string[] = [];
    const r: any = await sendQueuedMessage("m1", log, async (_n, d) => {
      chained.push(d.messageId);
    });
    expect(r.voice).toBe(true);
    expect(bodies[0].audio).toEqual({ id: "media1", voice: true });
    expect(chained).toEqual(["m2"]);
  });
});
