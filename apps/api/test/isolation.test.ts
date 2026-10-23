import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tenant isolation. The database is replaced by an in-memory store that filters ONLY by the `where` the
 * route passes in. Two workspaces hold data; every bizB row carries the marker "SECRET-B". If a route forgets
 * its businessId filter, bizB rows come back (or get changed) and these tests fail.
 */

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
  delete process.env.DEV_EXPOSE_TOKENS;
});

const store = vi.hoisted(() => {
  const s = {
    rows: {} as Record<string, any[]>,
    touchedB: [] as string[],
    reset() {
      const a = "bizA", b = "bizB";
      const pair = (model: string, extra: Record<string, unknown> = {}) => [
        { id: `${model}-a`, businessId: a, name: "Alpha row", title: "Alpha row", content: "alpha", ...extra },
        { id: `${model}-b`, businessId: b, name: "SECRET-B", title: "SECRET-B", content: "SECRET-B", ...extra },
      ];
      s.touchedB = [];
      s.rows = {
        business: [
          { id: a, name: "Alpha", slug: "alpha", planStatus: "ACTIVE", plan: "FREE", monthlyMessageLimit: 250, currentPeriodStart: new Date(), automationEnabled: false },
          { id: b, name: "SECRET-B", slug: "secret-b", planStatus: "ACTIVE", plan: "FREE", monthlyMessageLimit: 250, currentPeriodStart: new Date(), automationEnabled: false },
        ],
        user: [
          { id: "owner-a", businessId: a, email: "a@example.gm", name: "Owner A", role: "OWNER", active: true, passwordChangedAt: null, business: { planStatus: "ACTIVE" } },
          { id: "owner-b", businessId: b, email: "SECRET-B@example.gm", name: "SECRET-B", role: "OWNER", active: true, passwordChangedAt: null, business: { planStatus: "ACTIVE" } },
        ],
        customer: pair("customer", { waId: "2200000000", phone: "+2200000000", tags: [] }),
        conversation: pair("conversation", { mode: "AI", status: "OPEN" }),
        message: pair("message", { direction: "INBOUND", body: "hello", metadata: {} }),
        knowledgeSource: pair("knowledgeSource", { status: "PUBLISHED" }),
        lead: pair("lead", { stage: "NEW" }),
        booking: pair("booking", { status: "REQUESTED" }),
        ticket: pair("ticket", { status: "OPEN", priority: "NORMAL" }),
        campaign: pair("campaign", { status: "DRAFT" }),
        automation: pair("automation", { enabled: false }),
        savedReply: pair("savedReply"),
        supportRequest: pair("supportRequest", { topic: "OTHER", message: "SECRET-B", status: "OPEN" }),
        whatsAppConnection: pair("whatsAppConnection", { phoneNumberId: "1111", status: "CONNECTED" }),
        templateInstallation: [],
        auditLog: [],
        invite: [],
      };
    },
  };
  return s;
});

vi.mock("@oceanbrown/db", () => {
  const matches = (row: any, where: any): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([key, value]) => {
      if (key === "AND") return (value as any[]).every(w => matches(row, w));
      if (key === "OR") return (value as any[]).some(w => matches(row, w));
      if (key === "NOT") return true;
      if (value === undefined) return true;
      if (value === null || typeof value !== "object" || value instanceof Date) return row[key] === value;
      const v = value as Record<string, unknown>;
      if ("equals" in v) return row[key] === v.equals;
      if ("in" in v && Array.isArray(v.in)) return v.in.includes(row[key]);
      if (key in row && typeof row[key] !== "object") return true; // other operators (not, gte, contains…) are not modelled
      return true; // relation filters: lenient
    });
  };
  const rowsOf = (model: string) => (store.rows[model] ??= []);
  const markB = (model: string, rows: any[]) => rows.filter(r => r.businessId === "bizB" || r.id === "bizB").forEach(r => store.touchedB.push(`${model}:${r.id}`));
  const modelApi = (model: string) => ({
    findUnique: async (a: any = {}) => rowsOf(model).find(r => matches(r, a.where)) ?? null,
    findFirst: async (a: any = {}) => rowsOf(model).find(r => matches(r, a.where)) ?? null,
    findUniqueOrThrow: async (a: any = {}) => { const r = rowsOf(model).find(x => matches(x, a.where)); if (!r) throw Object.assign(new Error("not found"), { code: "P2025" }); return r; },
    findFirstOrThrow: async (a: any = {}) => { const r = rowsOf(model).find(x => matches(x, a.where)); if (!r) throw Object.assign(new Error("not found"), { code: "P2025" }); return r; },
    findMany: async (a: any = {}) => rowsOf(model).filter(r => matches(r, a.where)),
    count: async (a: any = {}) => rowsOf(model).filter(r => matches(r, a.where)).length,
    aggregate: async () => ({ _count: { _all: 0 }, _sum: {}, _max: {}, _min: {} }),
    groupBy: async () => [],
    create: async (a: any) => { const row = { id: `${model}-new`, ...a.data }; rowsOf(model).push(row); return row; },
    createMany: async (a: any) => ({ count: Array.isArray(a.data) ? a.data.length : 1 }),
    update: async (a: any) => { const hit = rowsOf(model).filter(r => matches(r, a.where)); if (!hit.length) throw Object.assign(new Error("not found"), { code: "P2025" }); markB(model, hit); Object.assign(hit[0], a.data); return hit[0]; },
    updateMany: async (a: any) => { const hit = rowsOf(model).filter(r => matches(r, a.where)); markB(model, hit); return { count: hit.length }; },
    upsert: async (a: any) => { const hit = rowsOf(model).filter(r => matches(r, a.where)); markB(model, hit); return hit[0] ?? { id: `${model}-new`, ...a.create }; },
    delete: async (a: any) => { const hit = rowsOf(model).filter(r => matches(r, a.where)); if (!hit.length) throw Object.assign(new Error("not found"), { code: "P2025" }); markB(model, hit); return hit[0]; },
    deleteMany: async (a: any) => { const hit = rowsOf(model).filter(r => matches(r, a.where)); markB(model, hit); return { count: hit.length }; },
  });
  const apis: Record<string, ReturnType<typeof modelApi>> = {};
  const db: any = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === "$transaction") return async (arg: any) => (typeof arg === "function" ? arg(db) : Promise.all(arg));
      if (prop === "$queryRaw" || prop === "$executeRaw" || prop === "$queryRawUnsafe") return async () => [];
      if (prop === "$connect" || prop === "$disconnect") return async () => {};
      if (prop === "then") return undefined;
      return (apis[prop] ??= modelApi(prop));
    },
  });
  return { db };
});
vi.mock("../src/queue", () => ({ enqueue: vi.fn(async () => true), closeQueue: async () => {} }));

import { buildApp } from "../src/app";

let app: Awaited<ReturnType<typeof buildApp>>;
let cookieA = "";
let cookieSuper = "";
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  cookieA = `ob_session=${app.jwt.sign({ sub: "owner-a" })}`;
  cookieSuper = `ob_session=${app.jwt.sign({ sub: "staff" })}`;
});
beforeEach(() => store.reset());

const call = (method: string, url: string, payload?: unknown, cookie = cookieA) =>
  app.inject({ method: method as any, url, headers: { cookie, ...(payload !== undefined ? { "content-type": "application/json" } : {}) }, ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}) });

describe("lists only ever show the caller's own workspace", () => {
  const lists = ["/customers", "/conversations", "/knowledge", "/leads", "/bookings", "/tickets", "/campaigns", "/automations", "/saved-replies", "/support-requests", "/team", "/audit", "/overview", "/business", "/onboarding", "/whatsapp/connection", "/templates/starter"];
  for (const url of lists) {
    it(`GET ${url}`, async () => {
      const res = await call("GET", url);
      expect(res.statusCode, res.body).toBeLessThan(500);
      expect(res.body).not.toContain("SECRET-B");
    });
  }
});

describe("another workspace's records cannot be read or changed by id", () => {
  const cases: [string, string, unknown?][] = [
    ["GET", "/conversations/conversation-b"],
    ["PATCH", "/conversations/conversation-b/mode", { mode: "HUMAN" }],
    ["POST", "/conversations/conversation-b/notes", { body: "note" }],
    ["PATCH", "/knowledge/knowledgeSource-b", { title: "Changed" }],
    ["DELETE", "/knowledge/knowledgeSource-b"],
    ["PATCH", "/leads/lead-b", { stage: "WON" }],
    ["PATCH", "/bookings/booking-b", { status: "CANCELLED" }],
    ["PATCH", "/tickets/ticket-b", { status: "CLOSED" }],
    ["PATCH", "/automations/automation-b", { enabled: true }],
    ["PATCH", "/customers/customer-b/preferences", { consent: false }],
    ["GET", "/campaigns/campaign-b/preview"],
    ["GET", "/messages/message-b/media"],
  ];
  for (const [method, url, body] of cases) {
    it(`${method} ${url}`, async () => {
      const res = await call(method, url, body);
      expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
      expect(res.statusCode, res.body).toBeLessThan(500);
      expect(res.body).not.toContain("SECRET-B");
      expect(store.touchedB).toEqual([]);
    });
  }
});

describe("provider admin is staff-only", () => {
  const routes: [string, string, unknown?][] = [
    ["GET", "/platform/overview"],
    ["GET", "/platform/businesses"],
    ["GET", "/platform/businesses/bizB"],
    ["PATCH", "/platform/businesses/bizB/plan", { plan: "PRO" }],
    ["POST", "/platform/businesses/bizB/suspend", { reason: "testing" }],
    ["POST", "/platform/businesses/bizB/reactivate", {}],
    ["PUT", "/platform/businesses/bizB/whatsapp", { phoneNumberId: "12345", wabaId: "12345" }],
    ["GET", "/platform/support-requests"],
    ["PATCH", "/platform/support-requests/supportRequest-b", { status: "RESOLVED" }],
    ["GET", "/platform/onboarding-attempts"],
    ["GET", "/platform/templates"],
    ["POST", "/platform/templates/RESTAURANT", { definition: {} }],
  ];
  for (const [method, url, body] of routes) {
    it(`${method} ${url} is refused to a business owner`, async () => {
      const res = await call(method, url, body);
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain("SECRET-B");
      expect(store.touchedB).toEqual([]);
    });
  }

  it("is refused without a session", async () => {
    const res = await call("GET", "/platform/businesses", undefined, "");
    expect(res.statusCode).toBe(401);
  });

  it("is available to OceanBrown staff", async () => {
    store.rows.user.push({ id: "staff", businessId: "bizA", email: "staff@oceanbrown.gm", name: "Staff", role: "SUPER_ADMIN", active: true, passwordChangedAt: null, business: { planStatus: "ACTIVE" } });
    const res = await call("GET", "/platform/businesses", undefined, cookieSuper);
    expect(res.statusCode).toBe(200);
  });
});

describe("customers never handle technical WhatsApp details", () => {
  it("cannot save tokens or IDs directly", async () => {
    const res = await call("PUT", "/whatsapp/connection", { phoneNumberId: "123456", wabaId: "123456", accessToken: "x".repeat(40) });
    expect(res.statusCode).toBe(403);
  });

  it("cannot run the staff connection test", async () => {
    const res = await call("POST", "/whatsapp/connection/test", {});
    expect(res.statusCode).toBe(403);
  });

  it("does not see phone number IDs, WABA IDs or token state", async () => {
    const res = await call("GET", "/whatsapp/connection");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.connection?.phoneNumberId).toBeUndefined();
    expect(body.connection?.wabaId).toBeUndefined();
    expect(body.connection?.hasAccessToken).toBeUndefined();
    expect(body.webhookUrl).toBeUndefined();
  });
});

describe("suspended workspaces", () => {
  it("can read but cannot change settings", async () => {
    const owner = store.rows.user.find(u => u.id === "owner-a");
    owner.business = { planStatus: "SUSPENDED" };
    expect((await call("GET", "/business")).statusCode).toBe(200);
    expect((await call("PATCH", "/business", { welcomeMessage: "Hi" })).statusCode).toBe(403);
  });
});
