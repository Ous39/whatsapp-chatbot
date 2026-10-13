import crypto from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.META_VERIFY_TOKEN = "verify-me-please";
  process.env.META_APP_SECRET = "app-secret";
  process.env.LOG_LEVEL = "silent";
});

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(async (args: any) => ({ id: "evt1", status: args.create.status })),
  findMany: vi.fn(async () => [{ id: "conn1", businessId: "biz1" }]),
  updateMany: vi.fn(async () => ({ count: 1 })),
  enqueue: vi.fn(async () => true),
  userFindUnique: vi.fn(async () => null),
}));

vi.mock("@oceanbrown/db", () => ({
  db: {
    webhookEvent: { upsert: mocks.upsert },
    whatsAppConnection: { findMany: mocks.findMany, updateMany: mocks.updateMany },
    user: { findUnique: mocks.userFindUnique },
  },
}));
vi.mock("../src/queue", () => ({ enqueue: mocks.enqueue, closeQueue: async () => {} }));

import { buildApp } from "../src/app";

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  app = await buildApp();
});
beforeEach(() => vi.clearAllMocks());

const body = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "123456" }, messages: [{ from: "2207001111", id: "wamid.1", type: "text", text: { body: "Hi" } }] } }] }],
});
const sign = (raw: string, secret = "app-secret") => "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");

describe("Meta webhook", () => {
  it("completes the verification handshake only with the right token", async () => {
    const ok = await app.inject({ method: "GET", url: "/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify-me-please&hub.challenge=42" });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("42");
    const missing = await app.inject({ method: "GET", url: "/webhooks/meta?hub.mode=subscribe&hub.challenge=42" });
    expect(missing.statusCode).toBe(403);
    const wrong = await app.inject({ method: "GET", url: "/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42" });
    expect(wrong.statusCode).toBe(403);
  });

  it("rejects unsigned or tampered payloads without storing them", async () => {
    const unsigned = await app.inject({ method: "POST", url: "/webhooks/meta", headers: { "content-type": "application/json" }, payload: body });
    expect(unsigned.statusCode).toBe(401);
    const tampered = await app.inject({ method: "POST", url: "/webhooks/meta", headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) }, payload: body.replace("Hi", "Ho") });
    expect(tampered.statusCode).toBe(401);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("stores a signed delivery once and queues it for the worker", async () => {
    const res = await app.inject({ method: "POST", url: "/webhooks/meta", headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) }, payload: body });
    expect(res.statusCode).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const args = (mocks.upsert.mock.calls[0] as any[])[0];
    expect(args.where.externalId).toMatch(/^sha256:/);
    expect(args.create.businessId).toBe("biz1");
    expect(mocks.enqueue).toHaveBeenCalledWith("process-webhook", { eventId: "evt1" }, "webhook-evt1", expect.anything());
  });
});

describe("API hardening", () => {
  it("returns 400 (not 500) for malformed JSON", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/login", headers: { "content-type": "application/json" }, payload: "{not json" });
    expect(res.statusCode).toBe(400);
  });
  it("logout works with an empty JSON body", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/logout", headers: { "content-type": "application/json" } });
    expect(res.statusCode).toBe(200);
  });
  it("rejects unauthenticated access", async () => {
    const res = await app.inject({ method: "GET", url: "/conversations" });
    expect(res.statusCode).toBe(401);
  });
  it("rejects a token for a user that no longer exists or is deactivated", async () => {
    const token = app.jwt.sign({ sub: "ghost" });
    const res = await app.inject({ method: "GET", url: "/auth/me", cookies: { ob_session: token } });
    expect(res.statusCode).toBe(401);
    expect(mocks.userFindUnique).toHaveBeenCalled();
  });
});
