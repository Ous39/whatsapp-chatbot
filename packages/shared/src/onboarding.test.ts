import { describe, expect, it } from "vitest";
import { computeOnboarding, mapMetaError, mapSignupError, type OnboardingInput } from "./onboarding";
import { contentHash, fillTemplate, INDUSTRIES, INDUSTRY_KEYS, planProvisioning, planTemplateUpdate, validateTemplateDefinition } from "./industries";

const now = new Date("2026-10-23T12:00:00Z");
const baseInput = (over: Partial<OnboardingInput> = {}): OnboardingInput => ({
  business: { name: "Awa's Shop", industry: null, planStatus: "ACTIVE", onboardingCompletedAt: null, automationEnabled: false },
  template: null,
  publishedFaqs: 0,
  draftFaqs: 0,
  connection: null,
  liveDeliveryEnabled: true,
  now,
  ...over,
});
const connected = (over: Partial<NonNullable<OnboardingInput["connection"]>> = {}): NonNullable<OnboardingInput["connection"]> => ({
  status: "CONNECTED",
  ownershipVerifiedAt: now,
  lastWebhookAt: now,
  lastError: null,
  displayPhone: "+220 363 1776",
  verifiedName: "Awa's Shop",
  metaStatus: { codeVerificationStatus: "VERIFIED", nameStatus: "APPROVED", platformType: "CLOUD_API" },
  lastCheckedAt: now,
  ...over,
});

describe("onboarding status", () => {
  it("starts at step 1 with nothing connected", () => {
    const s = computeOnboarding(baseInput());
    expect(s.whatsapp.state).toBe("NOT_STARTED");
    expect(s.currentStep).toBe("whatsapp");
    expect(s.live).toBe(false);
    expect(s.complete).toBe(false);
  });

  it("is live only when connected, verified, registered, receiving and delivering", () => {
    const s = computeOnboarding(baseInput({ connection: connected() }));
    expect(s.whatsapp.state).toBe("LIVE");
    expect(s.live).toBe(true);
    expect(s.whatsapp.checks.every(c => c.state === "ok")).toBe(true);
  });

  it("never reports live before Meta has delivered a webhook", () => {
    const s = computeOnboarding(baseInput({ connection: connected({ lastWebhookAt: null }) }));
    expect(s.whatsapp.state).toBe("CONNECTED");
    expect(s.live).toBe(false);
    expect(s.whatsapp.actions[0]?.code).toBe("SEND_TEST");
  });

  it("never reports live when replies cannot be delivered", () => {
    const s = computeOnboarding(baseInput({ connection: connected(), liveDeliveryEnabled: false }));
    expect(s.live).toBe(false);
    expect(s.whatsapp.actions.some(a => a.code === "ENABLE_DELIVERY" && a.owner === "oceanbrown")).toBe(true);
  });

  it("treats an unverified saved number as OceanBrown's job, not the customer's", () => {
    const s = computeOnboarding(baseInput({ connection: connected({ status: "PENDING", ownershipVerifiedAt: null, lastWebhookAt: null, metaStatus: null }) }));
    expect(s.whatsapp.state).toBe("IN_PROGRESS");
    expect(s.whatsapp.actions[0]?.owner).toBe("oceanbrown");
  });

  it("distinguishes number verification from registration", () => {
    const s = computeOnboarding(baseInput({ connection: connected({ lastWebhookAt: null, metaStatus: { codeVerificationStatus: "VERIFIED", nameStatus: "APPROVED", platformType: "NOT_APPLICABLE" } }) }));
    expect(s.whatsapp.state).toBe("PENDING_META");
    expect(s.whatsapp.checks.find(c => c.id === "number_verified")?.state).toBe("ok");
    expect(s.whatsapp.checks.find(c => c.id === "registered")?.state).toBe("pending");
  });

  it("asks for action when the display name was declined", () => {
    const s = computeOnboarding(baseInput({ connection: connected({ metaStatus: { codeVerificationStatus: "VERIFIED", nameStatus: "DECLINED", platformType: "CLOUD_API" } }) }));
    expect(s.whatsapp.state).toBe("ACTION_REQUIRED");
    expect(s.steps[0]?.state).toBe("attention");
  });

  it("stays live while a display name is under review, and says so", () => {
    const s = computeOnboarding(baseInput({ connection: connected({ metaStatus: { codeVerificationStatus: "VERIFIED", nameStatus: "PENDING_REVIEW", platformType: "CLOUD_API" } }) }));
    expect(s.live).toBe(true);
    expect(s.whatsapp.detail).toMatch(/reviewing your display name/);
  });

  it("shows a friendly retry after the customer closed Meta's window", () => {
    const s = computeOnboarding(baseInput({ lastAttempt: { event: "cancelled", at: new Date(now.getTime() - 60_000), detail: "The Meta window was closed" } }));
    expect(s.whatsapp.state).toBe("ACTION_REQUIRED");
    expect(s.whatsapp.detail).toContain("closed");
  });

  it("marks an errored connection as needing attention with Meta's explanation", () => {
    const s = computeOnboarding(baseInput({ connection: connected({ status: "ERROR", lastError: "Access expired" }) }));
    expect(s.whatsapp.state).toBe("ACTION_REQUIRED");
    expect(s.whatsapp.detail).toBe("Access expired");
  });

  it("completes only when all three steps are done", () => {
    const s = computeOnboarding(baseInput({ connection: connected(), template: { industry: "RETAIL", version: 1 }, publishedFaqs: 3, business: { name: "x", industry: "RETAIL", planStatus: "ACTIVE", onboardingCompletedAt: now, automationEnabled: false } }));
    expect(s.complete).toBe(true);
    expect(s.business.industryLabel).toBe(INDUSTRIES.RETAIL.label);
  });

  it("reports suspension", () => {
    expect(computeOnboarding(baseInput({ business: { name: "x", industry: null, planStatus: "SUSPENDED", onboardingCompletedAt: null, automationEnabled: false } })).suspended).toBe(true);
  });
});

describe("Meta error explanations", () => {
  it("maps expired tokens, permissions, rate limits and outages", () => {
    expect(mapMetaError({ code: 190 }).kind).toBe("AUTH");
    expect(mapMetaError({ code: 200 }).kind).toBe("PERMISSION");
    expect(mapMetaError({ code: 130429, httpStatus: 400 }).retryable).toBe(true);
    expect(mapMetaError({ httpStatus: 503 }).kind).toBe("TEMPORARY");
    expect(mapMetaError({ code: 133005 }).kind).toBe("REGISTRATION");
  });
  it("keeps Meta's raw message for staff only", () => {
    const m = mapMetaError({ code: 190, message: "Error validating access token" });
    expect(m.message).not.toContain("validating");
    expect(m.staffHint).toContain("code 190");
  });
  it("explains signup flow errors in plain words", () => {
    expect(mapSignupError(3441030)).toMatch(/already connected/);
    expect(mapSignupError(2388367)).toMatch(/code/);
    expect(mapSignupError(999, "Something odd")).toContain("Something odd");
  });
});

describe("industry templates", () => {
  it("defines every industry with fields for each placeholder", () => {
    for (const key of INDUSTRY_KEYS) expect(validateTemplateDefinition(INDUSTRIES[key])).toEqual({ ok: true, template: expect.anything() });
  });

  it("never publishes an answer with a missing fact", () => {
    const plan = planProvisioning(INDUSTRIES.RETAIL, { services: "Phones and accessories", openingHours: "Mon–Sat 9:00–18:00" }, "Awa's Shop");
    const products = plan.faqs.find(f => f.key === "products")!;
    const delivery = plan.faqs.find(f => f.key === "delivery")!;
    expect(products.status).toBe("PUBLISHED");
    expect(products.content).toBe("We offer: Phones and accessories.");
    expect(delivery.status).toBe("DRAFT");
    expect(delivery.content).toContain("[Add delivery areas and fees]");
    expect(plan.missingRequired).toContain("location");
  });

  it("never publishes anything for sensitive industries", () => {
    const facts = Object.fromEntries(INDUSTRIES.GOVERNMENT.fields.map(f => [f.key, "Answer"]));
    const plan = planProvisioning(INDUSTRIES.GOVERNMENT, facts, "Ministry");
    expect(plan.faqs.every(f => f.status === "DRAFT")).toBe(true);
    expect(plan.aiCanBeEnabled).toBe(false);
  });

  it("fills the business name into the welcome message", () => {
    expect(planProvisioning(INDUSTRIES.RESTAURANT, {}, "Ndey's Kitchen").welcomeMessage).toContain("Ndey's Kitchen");
  });

  it("does not double full stops", () => {
    expect(fillTemplate("Open {{h}}.", { h: "9 to 5." }).text).toBe("Open 9 to 5.");
  });

  it("updates never overwrite an answer the business edited", () => {
    const facts = { services: "Phones", openingHours: "9–5", location: "Serrekunda" };
    const v1 = planProvisioning(INDUSTRIES.RETAIL, facts, "Shop");
    const installed = v1.faqs.map((f, i) => ({ id: `k${i}`, templateKey: f.key, templateHash: f.hash, title: f.title, content: f.content }));
    installed[0]!.content = "We sell phones, chargers and repairs."; // customised by the owner
    const v2 = { ...INDUSTRIES.RETAIL, version: 2, faqs: [...INDUSTRIES.RETAIL.faqs.map(f => (f.key === "hours" ? { ...f, content: "Opening hours: {{openingHours}}." } : f)), { key: "returns", title: "Can I return an item?", content: "Ask our team about returns." }] };
    const plan = planTemplateUpdate(v2, 1, installed, facts, "Shop");
    expect(plan.keptCustomised.map(k => k.key)).toEqual(["products"]);
    expect(plan.replacements.map(r => r.key)).toEqual(["hours"]);
    expect(plan.additions.map(a => a.key)).toEqual(["returns"]);
    expect(plan.additions[0]!.status).toBe("DRAFT");
  });

  it("offers nothing when the installed version is current", () => {
    const plan = planTemplateUpdate(INDUSTRIES.RETAIL, 1, [], {}, "Shop");
    expect(plan.additions.length + plan.replacements.length).toBe(0);
  });

  it("rejects admin templates with unknown placeholders", () => {
    const bad = { ...INDUSTRIES.OTHER, faqs: [{ key: "x", title: "X?", content: "{{nope}}" }] };
    const result = validateTemplateDefinition(bad);
    expect(result.ok).toBe(false);
  });

  it("hashes are stable", () => {
    expect(contentHash("abc")).toBe(contentHash("abc"));
    expect(contentHash("abc")).not.toBe(contentHash("abd"));
  });
});
