import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Vitest runs with NODE_ENV=test. DEV_EXPOSE_TOKENS is deliberately NOT set: tokens must not be echoed.
vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
  process.env.WHATSAPP_LIVE_ENABLED = "true";
  delete process.env.DEV_EXPOSE_TOKENS;
  delete process.env.RESEND_API_KEY;
});

const state = vi.hoisted(() => ({ user: null as any, connection: null as any, updates: [] as any[] }));

vi.mock("@oceanbrown/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async () => state.user),
      update: vi.fn(async (args: any) => {
        state.updates.push(args);
        return { ...state.user, ...args.data };
      }),
    },
    passwordResetToken: { deleteMany: vi.fn(() => ({})), create: vi.fn(() => ({})) },
    whatsAppConnection: { findFirst: vi.fn(async () => state.connection) },
    $transaction: vi.fn(async () => []),
  },
}));
vi.mock("../src/queue", () => ({ enqueue: vi.fn(async () => true), closeQueue: async () => {} }));

import { buildApp } from "../src/app";
import { assertCanMessage } from "../src/outbound";

let app: Awaited<ReturnType<typeof buildApp>>;
let hash: string;
beforeAll(async () => {
  app = await buildApp();
  hash = await bcrypt.hash("correct-password-123", 4);
});
beforeEach(() => {
  state.updates = [];
  state.connection = null;
  state.user = { id: "u1", businessId: "b1", email: "owner@example.gm", name: "Owner", role: "OWNER", active: true, passwordHash: hash, failedLoginCount: 0, lockedUntil: null, passwordChangedAt: null };
});

const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) });

describe("C1: tokens are never returned unless explicitly enabled in development", () => {
  it("forgot-password does not echo the reset token", async () => {
    const res = await post("/auth/password/forgot", { email: "owner@example.gm" });
    expect(res.statusCode).toBe(200);
    expect(res.json().resetToken).toBeUndefined();
  });
});

describe("Per-account login lockout", () => {
  it("counts a failed password", async () => {
    const res = await post("/auth/login", { email: "owner@example.gm", password: "wrong-password" });
    expect(res.statusCode).toBe(401);
    expect(state.updates[0].data).toEqual({ failedLoginCount: 1 });
  });

  it("locks the account on the 10th failure", async () => {
    state.user.failedLoginCount = 9;
    await post("/auth/login", { email: "owner@example.gm", password: "wrong-password" });
    expect(state.updates[0].data.failedLoginCount).toBe(0);
    expect(state.updates[0].data.lockedUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses the correct password while locked, with the same message", async () => {
    state.user.lockedUntil = new Date(Date.now() + 60_000);
    const locked = await post("/auth/login", { email: "owner@example.gm", password: "correct-password-123" });
    state.user.lockedUntil = null;
    const wrong = await post("/auth/login", { email: "owner@example.gm", password: "wrong-password" });
    expect(locked.statusCode).toBe(401);
    expect(locked.json().error).toBe(wrong.json().error);
  });

  it("clears the counter after a successful login", async () => {
    state.user.failedLoginCount = 3;
    const res = await post("/auth/login", { email: "owner@example.gm", password: "correct-password-123" });
    expect(res.statusCode).toBe(200);
    expect(state.updates.at(-1).data).toEqual({ failedLoginCount: 0, lockedUntil: null });
  });
});

describe("C4: replies are refused instead of silently queued", () => {
  const customer = { optedOutAt: null, lastInboundAt: new Date(Date.now() - 60_000) };

  it("refuses when the workspace has no verified, connected number", async () => {
    await expect(assertCanMessage("b1", customer)).rejects.toMatchObject({ statusCode: 422 });
  });

  it("allows WhatsApp delivery with a verified connection inside the 24-hour window", async () => {
    state.connection = { id: "c1" };
    await expect(assertCanMessage("b1", customer)).resolves.toEqual({ transport: "whatsapp" });
  });

  it("still enforces the 24-hour window", async () => {
    state.connection = { id: "c1" };
    await expect(assertCanMessage("b1", { optedOutAt: null, lastInboundAt: new Date(Date.now() - 2 * 86_400_000) })).rejects.toMatchObject({ statusCode: 422 });
  });
});
