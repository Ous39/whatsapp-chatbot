// Onboarding status model shared by the API, the dashboard and the provider admin.
// The status is always derived from stored facts (connection checks, webhooks received, installed
// template), never from a flag a user can set, so the dashboard cannot claim "live" by mistake.

import { INDUSTRIES, isIndustryKey } from "./industries.js";

export type CheckState = "ok" | "pending" | "failed" | "unknown";
export type WhatsAppState = "NOT_STARTED" | "IN_PROGRESS" | "ACTION_REQUIRED" | "PENDING_META" | "CONNECTED" | "LIVE";
export type StepState = "done" | "attention" | "todo";

export type MetaPhoneStatus = {
  codeVerificationStatus?: string | null; // VERIFIED | NOT_VERIFIED
  nameStatus?: string | null; // APPROVED | DECLINED | EXPIRED | PENDING_REVIEW | NONE
  platformType?: string | null; // CLOUD_API | ON_PREMISE | NOT_APPLICABLE
  accountMode?: string | null; // SANDBOX | LIVE
  qualityRating?: string | null;
};

export type OnboardingAttempt = { event: "started" | "cancelled" | "error"; at: string | Date; detail?: string | null };

export type OnboardingInput = {
  business: { name: string; industry: string | null; planStatus: string; onboardingCompletedAt: Date | string | null; automationEnabled: boolean };
  template: { industry: string; version: number } | null;
  publishedFaqs: number;
  draftFaqs: number;
  connection: null | {
    status: string;
    ownershipVerifiedAt: Date | string | null;
    lastWebhookAt: Date | string | null;
    lastError: string | null;
    displayPhone: string | null;
    verifiedName: string | null;
    metaStatus: MetaPhoneStatus | null;
    lastCheckedAt: Date | string | null;
  };
  liveDeliveryEnabled: boolean;
  lastAttempt?: OnboardingAttempt | null;
  openHelpRequests?: number;
  now?: Date;
};

export type Action = { code: string; text: string; owner: "customer" | "oceanbrown" };

export type OnboardingStatus = {
  complete: boolean;
  live: boolean;
  suspended: boolean;
  currentStep: "whatsapp" | "business" | "review";
  steps: { id: "whatsapp" | "business" | "review"; title: string; state: StepState }[];
  whatsapp: {
    state: WhatsAppState;
    headline: string;
    detail: string;
    number: string | null;
    name: string | null;
    checks: { id: string; label: string; state: CheckState; hint?: string }[];
    actions: Action[];
  };
  business: { industry: string | null; industryLabel: string | null; templateVersion: number | null; publishedFaqs: number; draftFaqs: number; aiEnabled: boolean; sensitive: boolean };
  openHelpRequests: number;
};

const minutes = (ms: number) => ms / 60_000;

export function computeOnboarding(input: OnboardingInput): OnboardingStatus {
  const now = input.now ?? new Date();
  const c = input.connection;
  const meta = c?.metaStatus ?? {};
  const actions: Action[] = [];
  let state: WhatsAppState;
  let headline: string;
  let detail: string;

  const verified = !!c?.ownershipVerifiedAt && c.status === "CONNECTED";
  const numberCheck: CheckState = meta.codeVerificationStatus === "VERIFIED" ? "ok" : meta.codeVerificationStatus === "NOT_VERIFIED" ? "pending" : verified ? "ok" : c ? "unknown" : "pending";
  const nameCheck: CheckState = meta.nameStatus === "APPROVED" ? "ok" : meta.nameStatus === "DECLINED" || meta.nameStatus === "EXPIRED" ? "failed" : meta.nameStatus === "PENDING_REVIEW" ? "pending" : c ? "unknown" : "pending";
  const registeredCheck: CheckState = meta.platformType ? (meta.platformType === "CLOUD_API" ? "ok" : "pending") : verified ? "ok" : "pending";
  const connectedCheck: CheckState = verified ? "ok" : c?.status === "ERROR" ? "failed" : "pending";
  const receivingCheck: CheckState = verified && c?.lastWebhookAt ? "ok" : "pending";
  const deliveryCheck: CheckState = input.liveDeliveryEnabled ? "ok" : "pending";

  if (!c) {
    const attempt = input.lastAttempt;
    const recent = attempt && minutes(now.getTime() - new Date(attempt.at).getTime()) < 24 * 60;
    if (attempt && recent && attempt.event !== "started") {
      state = "ACTION_REQUIRED";
      headline = "WhatsApp connection didn't finish";
      detail = attempt.detail || "The Meta sign-up window was closed before it finished. Nothing was lost; start again when you're ready.";
      actions.push({ code: "RETRY_SIGNUP", text: "Connect with Facebook again, or ask OceanBrown to help.", owner: "customer" });
    } else if (attempt?.event === "started" && minutes(now.getTime() - new Date(attempt.at).getTime()) < 30) {
      state = "IN_PROGRESS";
      headline = "Finishing your connection";
      detail = "Complete the steps in the Meta window. If you closed it, start again — nothing was saved yet.";
    } else {
      state = "NOT_STARTED";
      headline = "Connect your WhatsApp number";
      detail = "Sign in with Facebook, choose your business and verify your number with a code. It usually takes a few minutes.";
      actions.push({ code: "START_SIGNUP", text: "Connect your WhatsApp Business number.", owner: "customer" });
    }
  } else if (c.status === "ERROR") {
    state = "ACTION_REQUIRED";
    headline = "Your WhatsApp connection needs attention";
    detail = c.lastError || "Meta reported a problem with this number.";
    actions.push({ code: "RECONNECT", text: "Reconnect with Facebook, or ask OceanBrown to fix it for you.", owner: "customer" });
  } else if (!verified) {
    state = "IN_PROGRESS";
    headline = "OceanBrown is finishing your setup";
    detail = "Your number was received. Our team is completing the technical checks; you don't need to do anything.";
    actions.push({ code: "VERIFY_OWNERSHIP", text: "Run the connection test for this number.", owner: "oceanbrown" });
  } else if (nameCheck === "failed") {
    state = "ACTION_REQUIRED";
    headline = "Meta didn't approve your display name";
    detail = "Your business name on WhatsApp must match your business. Change it in WhatsApp Manager, or ask OceanBrown to help. You can still reply to customers, with lower limits.";
    actions.push({ code: "DISPLAY_NAME", text: "Submit a display name that matches your business.", owner: "customer" });
  } else if (registeredCheck === "pending") {
    state = "PENDING_META";
    headline = "Meta is still registering your number";
    detail = "The number is verified but not yet active for messaging. This usually completes within minutes; if it takes longer, OceanBrown will finish it.";
    actions.push({ code: "REGISTER_NUMBER", text: "Finish phone number registration.", owner: "oceanbrown" });
  } else if (!c.lastWebhookAt) {
    state = "CONNECTED";
    headline = "Connected — send a test message";
    detail = "Send any WhatsApp message to your number from another phone. When it appears in your inbox, you're live.";
    actions.push({ code: "SEND_TEST", text: `Send a WhatsApp message to ${c.displayPhone ?? "your number"} from another phone.`, owner: "customer" });
  } else if (!input.liveDeliveryEnabled) {
    state = "CONNECTED";
    headline = "Receiving messages; replies not switched on yet";
    detail = "Messages arrive in your inbox. OceanBrown will switch on delivery of replies.";
    actions.push({ code: "ENABLE_DELIVERY", text: "Switch on live delivery on the server.", owner: "oceanbrown" });
  } else {
    state = "LIVE";
    headline = "Live on WhatsApp";
    detail = "Customers' messages arrive in your inbox and replies are delivered.";
  }
  if (state === "LIVE" && nameCheck === "pending") detail += " Meta is still reviewing your display name; messaging limits are lower until it's approved.";

  const industryKnown = !!input.template && isIndustryKey(input.template.industry);
  const tpl = industryKnown ? INDUSTRIES[input.template!.industry as keyof typeof INDUSTRIES] : null;
  const businessDone = !!input.template;
  if (businessDone && input.publishedFaqs === 0) actions.push({ code: "PUBLISH_FAQS", text: "Complete and publish at least one answer in Knowledge before switching on AI replies.", owner: "customer" });

  const whatsappStep: StepState = state === "LIVE" ? "done" : state === "ACTION_REQUIRED" ? "attention" : "todo";
  const reviewDone = !!input.business.onboardingCompletedAt;
  const steps: OnboardingStatus["steps"] = [
    { id: "whatsapp", title: "Connect WhatsApp", state: whatsappStep },
    { id: "business", title: "About your business", state: businessDone ? "done" : "todo" },
    { id: "review", title: "Review and start", state: reviewDone ? "done" : "todo" },
  ];
  const currentStep = steps.find(s => s.state !== "done")?.id ?? "review";

  return {
    complete: steps.every(s => s.state === "done"),
    live: state === "LIVE",
    suspended: input.business.planStatus !== "ACTIVE",
    currentStep,
    steps,
    whatsapp: {
      state,
      headline,
      detail,
      number: c?.displayPhone ?? null,
      name: c?.verifiedName ?? null,
      checks: [
        { id: "number_verified", label: "Number verified with a code", state: numberCheck },
        { id: "display_name", label: "Display name approved by Meta", state: nameCheck, hint: nameCheck === "pending" ? "Usually instant, sometimes 24–48 hours" : undefined },
        { id: "registered", label: "Number registered for messaging", state: registeredCheck },
        { id: "connected", label: "Connected to OceanBrown", state: connectedCheck },
        { id: "receiving", label: "Receiving customer messages", state: receivingCheck },
        { id: "delivery", label: "Replies delivered", state: deliveryCheck },
      ],
      actions,
    },
    business: {
      industry: input.template?.industry ?? input.business.industry,
      industryLabel: tpl?.label ?? null,
      templateVersion: input.template?.version ?? null,
      publishedFaqs: input.publishedFaqs,
      draftFaqs: input.draftFaqs,
      aiEnabled: input.business.automationEnabled,
      sensitive: tpl?.sensitive ?? false,
    },
    openHelpRequests: input.openHelpRequests ?? 0,
  };
}

// ---------- Meta API errors → plain explanations ----------

export type MappedError = { kind: "AUTH" | "PERMISSION" | "REGISTRATION" | "RATE_LIMIT" | "TEMPORARY" | "BLOCKED" | "INVALID" | "UNKNOWN"; retryable: boolean; message: string; staffHint: string };

/** Turns a Graph API error into something a business owner can act on, plus a hint for OceanBrown staff. */
export function mapMetaError(err: { code?: number; httpStatus?: number; message?: string }): MappedError {
  const code = err.code;
  const raw = `${err.message ?? "Unknown error"}${code ? ` (code ${code})` : ""}`;
  const r = (kind: MappedError["kind"], retryable: boolean, message: string): MappedError => ({ kind, retryable, message, staffHint: raw });
  if (code === 190 || err.httpStatus === 401) return r("AUTH", false, "Access to your WhatsApp account has expired or was removed. Reconnect with Facebook to restore it.");
  if (code === 10 || code === 200 || (code !== undefined && code >= 200 && code <= 299) || code === 3 || err.httpStatus === 403) return r("PERMISSION", false, "OceanBrown doesn't have permission to manage this WhatsApp number. Reconnect with Facebook and allow access, or ask OceanBrown to help.");
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80007 || code === 130429 || code === 131056 || err.httpStatus === 429) return r("RATE_LIMIT", true, "Meta is limiting requests right now. Try again in a few minutes.");
  if (code === 133005) return r("REGISTRATION", false, "The number has a two-step verification PIN that doesn't match. OceanBrown can reset it with you.");
  if (code === 133006) return r("REGISTRATION", false, "The number must be verified with a code before it can be activated. Reconnect with Facebook and complete the code step.");
  if (code === 133008 || code === 133009) return r("REGISTRATION", true, "Too many PIN attempts. Meta asks to wait before trying again; OceanBrown will retry for you.");
  if (code === 133010) return r("REGISTRATION", false, "The number isn't registered for messaging yet. OceanBrown will finish the registration.");
  if (code === 133000) return r("REGISTRATION", false, "A previous removal of this number didn't finish. OceanBrown will complete it and retry.");
  if (code === 131031 || code === 368) return r("BLOCKED", false, "Meta has restricted this WhatsApp account. Check WhatsApp Manager for alerts, or ask OceanBrown to help you appeal.");
  if (code === 100) return r("INVALID", false, "Meta didn't accept the number details. Reconnect with Facebook, or ask OceanBrown to check them.");
  if (code === 1 || code === 2 || code === 131000 || code === 133004 || (err.httpStatus ?? 0) >= 500 || err.httpStatus === 0) return r("TEMPORARY", true, "Meta's service had a temporary problem. Try again in a few minutes.");
  return r("UNKNOWN", false, "Something went wrong while talking to WhatsApp. OceanBrown has been notified; you can also request help.");
}

// ---------- Embedded Signup flow errors (reported by Meta's window) → plain explanations ----------

const SIGNUP_ERRORS: [number[], string][] = [
  [[3441030, 3441049, 2655094, 2655093, 2655049, 2494028], "This number is already connected to WhatsApp or another provider. Remove it from the other account (or disconnect the other provider), wait 15 minutes and try again, or use a new number."],
  [[2494158, 2388367, 2388091, 2388093, 2593037, 2593039], "Meta couldn't send or check the verification code, or too many codes were requested. Wait a few hours (up to 12), then try again, or choose a voice call instead of SMS."],
  [[2388098, 2494067], "Your Meta business needs to be verified before it can add more WhatsApp accounts. OceanBrown can guide you through business verification."],
  [[2859009, 4612001], "Meta requires two-factor authentication on your Facebook account. Turn it on in Facebook settings, then try again."],
  [[2859030, 2859043, 2136001], "Meta paused the sign-up for a security check on a new device. Wait a few minutes, refresh, and try again."],
  [[3441033, 3441046, 1675004, 1390008, 1390006, 1675030, 1675012, 1752224], "Meta is busy or limiting requests. Wait a few minutes and try again."],
  [[2655089, 3441040, 2388107, 1357053, 2859015], "Your WhatsApp or Meta business account has a restriction. Check Business Support Home, or ask OceanBrown to help."],
  [[3441045, 3441042, 4563015, 2655095, 2655048], "This WhatsApp Business App number can't be connected alongside the app yet (activity, region or app version). Update the app and keep using it, or use a new number."],
  [[3441051, 2655011, 2388002], "Meta didn't accept this phone number. Use a number that can receive SMS or calls (not an IVR line)."],
  [[1690089, 1690062, 1690091, 1690090, 2593010], "Meta didn't accept the business or display name. Use your real business name, then try again."],
];

export function mapSignupError(code: number | string | null | undefined, metaMessage?: string | null): string {
  const n = Number(code);
  for (const [codes, text] of SIGNUP_ERRORS) if (codes.includes(n)) return text;
  return metaMessage ? `Meta reported: ${metaMessage}. Try again, or ask OceanBrown to help.` : "The Meta sign-up didn't finish. Try again, or ask OceanBrown to help.";
}
