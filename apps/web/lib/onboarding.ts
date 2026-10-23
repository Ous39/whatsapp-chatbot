// Types for the onboarding API (mirrors packages/shared/src/onboarding.ts; the web app talks to the API only).

export type CheckState = "ok" | "pending" | "failed" | "unknown";
export type WhatsAppState = "NOT_STARTED" | "IN_PROGRESS" | "ACTION_REQUIRED" | "PENDING_META" | "CONNECTED" | "LIVE";
export type Action = { code: string; text: string; owner: "customer" | "oceanbrown" };

export type Onboarding = {
  complete: boolean;
  live: boolean;
  suspended: boolean;
  currentStep: "whatsapp" | "business" | "review";
  steps: { id: "whatsapp" | "business" | "review"; title: string; state: "done" | "attention" | "todo" }[];
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
  businessName?: string;
  facts?: Record<string, string>;
  embeddedSignupAvailable?: boolean;
};

export type IndustryOption = {
  key: string;
  label: string;
  description: string;
  sensitive: boolean;
  notes: string | null;
  version: number;
  menuOptions: string[];
  fields: { key: string; label: string; placeholder?: string; help?: string; required?: boolean; multiline?: boolean }[];
  faqTitles: string[];
};

export const WHATSAPP_LABEL: Record<WhatsAppState, string> = {
  NOT_STARTED: "Not connected",
  IN_PROGRESS: "Setting up",
  ACTION_REQUIRED: "Needs attention",
  PENDING_META: "Waiting for Meta",
  CONNECTED: "Connected",
  LIVE: "Live",
};

export const WHATSAPP_TONE: Record<WhatsAppState, "good" | "warn" | "bad" | "neutral"> = {
  NOT_STARTED: "neutral",
  IN_PROGRESS: "warn",
  ACTION_REQUIRED: "bad",
  PENDING_META: "warn",
  CONNECTED: "warn",
  LIVE: "good",
};
