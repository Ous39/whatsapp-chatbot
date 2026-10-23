// Industry starter templates.
//
// A template never states a fact about a business that the owner did not give us. FAQ text uses
// {{placeholders}} filled from the owner's answers in onboarding step 2. An FAQ is published only when
// every placeholder it uses was answered AND the industry is not sensitive; everything else is installed
// as a DRAFT for the owner to complete. Sensitive industries (health, finance, government) never
// auto-publish and never switch AI replies on, so official information is always reviewed by a person.
//
// These definitions are the version-1 defaults. Platform administrators can publish newer versions
// from the provider admin area (stored in the IndustryTemplate table); each business keeps its own copy.

export type IndustryKey =
  | "RETAIL" | "RESTAURANT" | "HOSPITALITY" | "HEALTHCARE" | "EDUCATION" | "FINANCE" | "TELECOM" | "REAL_ESTATE"
  | "LOGISTICS" | "PROFESSIONAL" | "RECRUITMENT" | "MEDIA" | "GOVERNMENT" | "NONPROFIT" | "OTHER";

export type TemplateField = { key: string; label: string; placeholder?: string; help?: string; required?: boolean; multiline?: boolean };
export type TemplateFaq = { key: string; title: string; content: string };

export interface IndustryTemplate {
  key: IndustryKey;
  label: string;
  description: string;
  version: number;
  /** Sensitive industries: nothing is published automatically and AI replies stay off until reviewed. */
  sensitive: boolean;
  /** Shown to the owner on the review screen. */
  notes?: string;
  welcomeMessage: string;
  fallbackMessage: string;
  handoverMessage: string;
  afterHoursMessage: string;
  /** Topics customers can ask about; shown in the welcome message and as preview suggestions. */
  menuOptions: string[];
  /** What the owner is asked in step 2. Only these values ever reach published answers. */
  fields: TemplateField[];
  faqs: TemplateFaq[];
  languages: string[];
}

// ---------- Common questions asked in step 2 ----------
const F = {
  hours: { key: "openingHours", label: "Opening hours", placeholder: "Mon–Sat 9:00–18:00, closed Sunday" },
  location: { key: "location", label: "Address or area", placeholder: "Kairaba Avenue, Serrekunda" },
  phone: { key: "contactPhone", label: "Phone number for calls", placeholder: "+220 …" },
  website: { key: "website", label: "Website or social page", placeholder: "https://…" },
  payment: { key: "paymentMethods", label: "Ways customers can pay", placeholder: "Cash, Wave, Afrimoney, bank transfer" },
  services: { key: "services", label: "Main products or services", placeholder: "List what you offer", multiline: true },
} satisfies Record<string, TemplateField>;

const req = (field: TemplateField): TemplateField => ({ ...field, required: true });

const HANDOVER = "Thanks for your patience. A member of our team will reply here shortly.";
const FALLBACK = "I don't have that information yet. Could you rephrase, or reply \"agent\" to talk to a member of our team?";
const AFTER_HOURS = "Thanks for your message. We're closed right now ({{openingHours}}). We'll reply as soon as we open.";
const AFTER_HOURS_GENERIC = "Thanks for your message. Our team is away right now and will reply as soon as we're back.";

const base = (t: Omit<IndustryTemplate, "version" | "languages" | "fallbackMessage" | "handoverMessage" | "afterHoursMessage"> & Partial<IndustryTemplate>): IndustryTemplate => ({
  version: 1,
  languages: ["en"],
  fallbackMessage: FALLBACK,
  handoverMessage: HANDOVER,
  // Only mention opening hours when the template actually asks for them.
  afterHoursMessage: t.fields.some(f => f.key === "openingHours") ? AFTER_HOURS : AFTER_HOURS_GENERIC,
  ...t,
});

export const INDUSTRIES: Record<IndustryKey, IndustryTemplate> = {
  RETAIL: base({
    key: "RETAIL", label: "Retail and e-commerce", description: "Shops, online stores and product sellers", sensitive: false,
    welcomeMessage: "Welcome to {{businessName}}! Ask about products, prices, delivery or your order. Reply \"agent\" any time to talk to our team.",
    menuOptions: ["Product enquiries", "Opening hours", "Order status", "Delivery", "Talk to our team"],
    fields: [req(F.services), req(F.hours), req(F.location), F.payment, { key: "deliveryInfo", label: "Delivery areas and fees", placeholder: "Greater Banjul, D100 within Kanifing" }, { key: "orderStatusInfo", label: "How customers check an order", placeholder: "Send your order number and we'll check it" }],
    faqs: [
      { key: "products", title: "What do you sell?", content: "We offer: {{services}}." },
      { key: "hours", title: "What are your opening hours?", content: "Our opening hours are {{openingHours}}." },
      { key: "location", title: "Where are you located?", content: "You can find us at {{location}}." },
      { key: "payment", title: "How can I pay?", content: "You can pay by {{paymentMethods}}." },
      { key: "delivery", title: "Do you deliver?", content: "Delivery: {{deliveryInfo}}." },
      { key: "order-status", title: "How do I check my order?", content: "{{orderStatusInfo}}." },
    ],
  }),
  RESTAURANT: base({
    key: "RESTAURANT", label: "Restaurants and food services", description: "Restaurants, cafés, takeaways and caterers", sensitive: false,
    welcomeMessage: "Welcome to {{businessName}}! Ask about our menu, opening hours, reservations or directions. Reply \"agent\" to talk to our team.",
    menuOptions: ["Menu", "Opening hours", "Reservations", "Location and directions", "Talk to our team"],
    fields: [req(F.hours), req(F.location), { key: "menuInfo", label: "Menu link or what you serve", placeholder: "https://… or 'Gambian and continental dishes'", required: true }, { key: "bookingInfo", label: "How to reserve a table", placeholder: "Send the date, time and number of guests" }, { key: "directions", label: "Directions or landmarks", placeholder: "Opposite the Total station" }, F.payment],
    faqs: [
      { key: "menu", title: "What is on the menu?", content: "Our menu: {{menuInfo}}." },
      { key: "hours", title: "When are you open?", content: "We are open {{openingHours}}." },
      { key: "reservations", title: "Can I book a table?", content: "{{bookingInfo}}. A member of our team will confirm your booking." },
      { key: "location", title: "Where are you?", content: "We are at {{location}}." },
      { key: "directions", title: "How do I find you?", content: "{{directions}}." },
      { key: "payment", title: "How can I pay?", content: "You can pay by {{paymentMethods}}." },
    ],
  }),
  HOSPITALITY: base({
    key: "HOSPITALITY", label: "Hotels and hospitality", description: "Hotels, lodges, guesthouses and tour operators", sensitive: false,
    welcomeMessage: "Welcome to {{businessName}}! Ask about rooms, rates, availability or directions. Reply \"agent\" to talk to reception.",
    menuOptions: ["Rooms and rates", "Book a stay", "Facilities", "Location", "Talk to reception"],
    fields: [req(F.location), { key: "rooms", label: "Room types and rates", placeholder: "Standard D3,500 per night, Deluxe D5,000", multiline: true, required: true }, { key: "facilities", label: "Facilities", placeholder: "Pool, Wi-Fi, breakfast, airport pickup" }, { key: "checkTimes", label: "Check-in and check-out times", placeholder: "Check-in 14:00, check-out 11:00" }, { key: "bookingInfo", label: "How to book", placeholder: "Send your dates and number of guests" }, F.payment],
    faqs: [
      { key: "rooms", title: "What rooms do you have and what do they cost?", content: "Our rooms: {{rooms}}. Availability is confirmed by our team." },
      { key: "booking", title: "How do I book?", content: "{{bookingInfo}}. Reception will confirm availability." },
      { key: "facilities", title: "What facilities do you have?", content: "Facilities: {{facilities}}." },
      { key: "check-times", title: "What are check-in and check-out times?", content: "{{checkTimes}}." },
      { key: "location", title: "Where are you located?", content: "We are at {{location}}." },
    ],
  }),
  HEALTHCARE: base({
    key: "HEALTHCARE", label: "Healthcare and clinics", description: "Clinics, pharmacies and health services", sensitive: true,
    notes: "Health information must be reviewed by authorised staff. The assistant only shares opening hours, location and how to book; it never gives medical advice.",
    welcomeMessage: "Welcome to {{businessName}}. We can help with opening hours, location and appointments. For emergencies, call the emergency services or go to the nearest hospital. Reply \"agent\" to talk to our staff.",
    menuOptions: ["Opening hours", "Book an appointment", "Location", "Talk to our staff"],
    fields: [req(F.hours), req(F.location), F.phone, { key: "appointmentInfo", label: "How to book an appointment", placeholder: "Send your name and preferred day" }],
    faqs: [
      { key: "hours", title: "What are your opening hours?", content: "We are open {{openingHours}}." },
      { key: "location", title: "Where are you located?", content: "We are at {{location}}." },
      { key: "appointments", title: "How do I book an appointment?", content: "{{appointmentInfo}}. Our staff will confirm the time." },
      { key: "contact", title: "Can I call you?", content: "Yes, call us on {{contactPhone}}." },
    ],
  }),
  EDUCATION: base({
    key: "EDUCATION", label: "Education and training", description: "Schools, training centres and tutors", sensitive: false,
    welcomeMessage: "Welcome to {{businessName}}! Ask about courses, fees, admissions or term dates. Reply \"agent\" to talk to our office.",
    menuOptions: ["Courses", "Fees", "Admissions", "Term dates", "Talk to our office"],
    fields: [{ key: "courses", label: "Courses or classes offered", multiline: true, required: true }, { key: "fees", label: "Fees", placeholder: "D2,500 per term" }, { key: "admissions", label: "How to apply or enrol" }, { key: "termDates", label: "Term or intake dates" }, req(F.location), F.hours],
    faqs: [
      { key: "courses", title: "What courses do you offer?", content: "We offer: {{courses}}." },
      { key: "fees", title: "How much are the fees?", content: "Fees: {{fees}}." },
      { key: "admissions", title: "How do I apply?", content: "{{admissions}}." },
      { key: "terms", title: "When does the next term or intake start?", content: "{{termDates}}." },
      { key: "location", title: "Where are you?", content: "We are at {{location}}." },
    ],
  }),
  FINANCE: base({
    key: "FINANCE", label: "Financial services", description: "Banks, microfinance, insurance and money transfer", sensitive: true,
    notes: "Financial information must be approved by authorised staff before it is published. The assistant must never ask customers for PINs, passwords or full card numbers.",
    welcomeMessage: "Welcome to {{businessName}}. We will never ask for your PIN or password on WhatsApp. Ask about our services, branches or opening hours, or reply \"agent\" to talk to our team.",
    menuOptions: ["Services", "Branches and hours", "Talk to our team"],
    fields: [req(F.services), req(F.hours), { key: "branches", label: "Branches", multiline: true }, F.phone],
    faqs: [
      { key: "services", title: "What services do you offer?", content: "Our services: {{services}}." },
      { key: "hours", title: "What are your opening hours?", content: "We are open {{openingHours}}." },
      { key: "branches", title: "Where are your branches?", content: "Our branches: {{branches}}." },
      { key: "security", title: "Will you ask for my PIN?", content: "No. We will never ask for your PIN, password or full card number on WhatsApp. If someone does, do not share it and call us on {{contactPhone}}." },
    ],
  }),
  TELECOM: base({
    key: "TELECOM", label: "Telecommunications", description: "Mobile operators, internet providers and resellers", sensitive: false,
    welcomeMessage: "Welcome to {{businessName}} support! Ask about bundles, coverage, SIM services or our shops. Reply \"agent\" to talk to customer care.",
    menuOptions: ["Bundles", "SIM and registration", "Shops", "Talk to customer care"],
    fields: [{ key: "bundles", label: "Main bundles and how to buy them", multiline: true, required: true }, { key: "simInfo", label: "SIM registration or replacement requirements" }, { key: "shops", label: "Shop locations", multiline: true }, F.hours, { key: "careNumber", label: "Customer care short code or number" }],
    faqs: [
      { key: "bundles", title: "What bundles do you have?", content: "{{bundles}}." },
      { key: "sim", title: "How do I register or replace a SIM?", content: "{{simInfo}}." },
      { key: "shops", title: "Where are your shops?", content: "Our shops: {{shops}}. Opening hours: {{openingHours}}." },
      { key: "care", title: "How do I contact customer care?", content: "Call {{careNumber}}, or reply \"agent\" here." },
    ],
  }),
  REAL_ESTATE: base({
    key: "REAL_ESTATE", label: "Real estate", description: "Agents, developers and property managers", sensitive: false,
    welcomeMessage: "Welcome to {{businessName}}! Tell us whether you want to rent, buy or sell, and your preferred area. Reply \"agent\" to talk to our team.",
    menuOptions: ["Rent", "Buy", "Sell or list a property", "Book a viewing", "Talk to an agent"],
    fields: [{ key: "listingsLink", label: "Where customers see listings", placeholder: "https://… or 'ask us for current listings'" }, { key: "areas", label: "Areas you cover", required: true }, { key: "viewingInfo", label: "How to book a viewing" }, F.hours, F.location],
    faqs: [
      { key: "areas", title: "Which areas do you cover?", content: "We cover {{areas}}." },
      { key: "listings", title: "Where can I see available properties?", content: "{{listingsLink}}." },
      { key: "viewing", title: "How do I book a viewing?", content: "{{viewingInfo}}. An agent will confirm." },
      { key: "office", title: "Where is your office?", content: "Our office is at {{location}}, open {{openingHours}}." },
    ],
  }),
  LOGISTICS: base({
    key: "LOGISTICS", label: "Transportation and logistics", description: "Delivery, courier, shipping and transport", sensitive: false,
    welcomeMessage: "Welcome to {{businessName}}! Ask for a quote, track a delivery or check our routes. Reply \"agent\" to talk to our team.",
    menuOptions: ["Get a quote", "Track a delivery", "Routes", "Talk to our team"],
    fields: [{ key: "routes", label: "Routes or areas served", required: true }, { key: "quoteInfo", label: "What customers send for a quote", placeholder: "Pickup, drop-off, size and weight" }, { key: "trackingInfo", label: "How customers track a delivery" }, F.hours, F.payment],
    faqs: [
      { key: "routes", title: "Where do you deliver?", content: "We serve {{routes}}." },
      { key: "quote", title: "How do I get a quote?", content: "Send us: {{quoteInfo}}. Our team will reply with a price." },
      { key: "tracking", title: "How do I track my delivery?", content: "{{trackingInfo}}." },
      { key: "payment", title: "How can I pay?", content: "You can pay by {{paymentMethods}}." },
    ],
  }),
  PROFESSIONAL: base({
    key: "PROFESSIONAL", label: "Professional services", description: "Consultants, accountants, lawyers, agencies and IT services", sensitive: false,
    welcomeMessage: "Welcome to {{businessName}}! Tell us what you need help with, or ask about our services and how to book a consultation. Reply \"agent\" to talk to our team.",
    menuOptions: ["Services", "Book a consultation", "Office hours", "Talk to our team"],
    fields: [req(F.services), { key: "consultationInfo", label: "How to book a consultation" }, F.hours, F.location, F.website],
    faqs: [
      { key: "services", title: "What services do you offer?", content: "Our services: {{services}}." },
      { key: "consultation", title: "How do I book a consultation?", content: "{{consultationInfo}}." },
      { key: "hours", title: "What are your office hours?", content: "We are open {{openingHours}}." },
      { key: "website", title: "Where can I learn more?", content: "Visit {{website}}." },
    ],
  }),
  RECRUITMENT: base({
    key: "RECRUITMENT", label: "Recruitment and jobs", description: "Job boards, recruiters and HR services", sensitive: false,
    welcomeMessage: "Welcome to {{businessName}}! Ask about current vacancies, job categories or how to apply. We only share vacancies from our official listings. Reply \"agent\" to talk to our team.",
    menuOptions: ["Job categories", "Current vacancies", "How to apply", "Closing dates", "Talk to our team"],
    fields: [{ key: "vacanciesLink", label: "Official vacancies link", placeholder: "https://…", required: true }, { key: "jobCategories", label: "Job categories", placeholder: "Banking, NGO, IT, sales" }, { key: "applyInfo", label: "How candidates apply", required: true }, { key: "closingDatesInfo", label: "Where closing dates are shown", placeholder: "Each vacancy shows its closing date" }],
    faqs: [
      { key: "vacancies", title: "Where can I see current vacancies?", content: "All current vacancies are listed at {{vacanciesLink}}." },
      { key: "categories", title: "What kinds of jobs do you post?", content: "We post jobs in: {{jobCategories}}." },
      { key: "apply", title: "How do I apply?", content: "{{applyInfo}}." },
      { key: "closing", title: "When do applications close?", content: "{{closingDatesInfo}}. Always check the official listing at {{vacanciesLink}}." },
      { key: "fees", title: "Do I have to pay to apply?", content: "Applying through our official listings is described at {{vacanciesLink}}. Never send money to anyone promising a job on WhatsApp." },
    ],
  }),
  MEDIA: base({
    key: "MEDIA", label: "News and media", description: "News outlets, radio, TV and publishers", sensitive: false,
    notes: "News updates are sent only to people who opted in, using approved templates. Corrections and unsubscribing must always be easy.",
    welcomeMessage: "Welcome to {{businessName}}! Reply with a topic to get links to our latest stories. Reply STOP at any time to unsubscribe, or \"agent\" to talk to our newsroom.",
    menuOptions: ["Latest stories", "News topics", "Subscribe to updates", "Report a correction", "Unsubscribe"],
    fields: [{ key: "website", label: "Website for articles", placeholder: "https://…", required: true }, { key: "newsTopics", label: "News topics", placeholder: "Politics, business, sport" }, { key: "correctionsContact", label: "How readers report corrections", required: true }],
    faqs: [
      { key: "latest", title: "Where can I read the latest news?", content: "Read our latest stories at {{website}}." },
      { key: "topics", title: "What topics do you cover?", content: "We cover: {{newsTopics}}." },
      { key: "subscribe", title: "How do I get news updates on WhatsApp?", content: "Reply \"subscribe\" and our team will add you to updates. You can reply STOP at any time to unsubscribe." },
      { key: "corrections", title: "How do I report a mistake in a story?", content: "{{correctionsContact}}." },
      { key: "unsubscribe", title: "How do I stop updates?", content: "Reply STOP at any time and you will not receive further updates." },
    ],
  }),
  GOVERNMENT: base({
    key: "GOVERNMENT", label: "Government and public services", description: "Ministries, agencies and public information offices", sensitive: true,
    notes: "Official information must be approved by an authorised officer before it is published. Every answer should point to an official source, and unanswered questions go to the right department.",
    welcomeMessage: "Welcome to the official {{businessName}} WhatsApp service. Ask about our services or announcements. Answers link to official sources. Reply \"agent\" to reach the right department.",
    menuOptions: ["Services", "Official announcements", "Office hours and locations", "Contact a department"],
    fields: [{ key: "officialWebsite", label: "Official website", placeholder: "https://….gov.gm", required: true }, { key: "announcementsLink", label: "Official announcements page" }, { key: "departments", label: "Departments and what they handle", multiline: true }, F.hours, F.location],
    faqs: [
      { key: "services", title: "What services do you provide?", content: "Information about our services is on our official website: {{officialWebsite}}." },
      { key: "announcements", title: "Where can I see official announcements?", content: "Official announcements are published at {{announcementsLink}}." },
      { key: "departments", title: "Which department handles my request?", content: "{{departments}}. Reply \"agent\" and we will forward your message to the right department." },
      { key: "hours", title: "When and where can I visit?", content: "Our office is at {{location}}, open {{openingHours}}." },
    ],
  }),
  NONPROFIT: base({
    key: "NONPROFIT", label: "Non-profit organisations", description: "NGOs, charities and community groups", sensitive: false,
    welcomeMessage: "Welcome to {{businessName}}! Ask about our programmes, volunteering or how to get support. Reply \"agent\" to talk to our team.",
    menuOptions: ["Our programmes", "Get support", "Volunteer", "Donate", "Talk to our team"],
    fields: [{ key: "programmes", label: "Programmes", multiline: true, required: true }, { key: "supportInfo", label: "How people get support" }, { key: "volunteerInfo", label: "How to volunteer" }, { key: "donateInfo", label: "How to donate (official channels only)" }, F.website],
    faqs: [
      { key: "programmes", title: "What do you do?", content: "Our programmes: {{programmes}}." },
      { key: "support", title: "How can I get support?", content: "{{supportInfo}}." },
      { key: "volunteer", title: "How can I volunteer?", content: "{{volunteerInfo}}." },
      { key: "donate", title: "How can I donate?", content: "{{donateInfo}}. Only use our official channels listed at {{website}}." },
    ],
  }),
  OTHER: base({
    key: "OTHER", label: "Other", description: "Any other business", sensitive: false,
    welcomeMessage: "Welcome to {{businessName}}! How can we help you today? Reply \"agent\" any time to talk to our team.",
    menuOptions: ["Our services", "Opening hours", "Location", "Talk to our team"],
    fields: [req(F.services), F.hours, F.location, F.phone, F.website],
    faqs: [
      { key: "services", title: "What do you offer?", content: "We offer: {{services}}." },
      { key: "hours", title: "What are your opening hours?", content: "We are open {{openingHours}}." },
      { key: "location", title: "Where are you located?", content: "We are at {{location}}." },
      { key: "contact", title: "How can I contact you?", content: "Call us on {{contactPhone}} or message us here." },
      { key: "website", title: "Do you have a website?", content: "Yes: {{website}}." },
    ],
  }),
};

export const INDUSTRY_KEYS = Object.keys(INDUSTRIES) as IndustryKey[];
export const isIndustryKey = (value: unknown): value is IndustryKey => typeof value === "string" && value in INDUSTRIES;

export const INDUSTRY_OPTIONS = Object.values(INDUSTRIES).map(industry => ({
  value: industry.key,
  label: industry.label,
  description: industry.description,
  sensitive: industry.sensitive,
}));

// ---------- Provisioning (pure; used by the API and tested in isolation) ----------

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Small stable hash (FNV-1a) so we can tell whether a customer edited a provisioned answer. */
export function contentHash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export type Facts = Record<string, string | undefined | null>;

/** Fills {{placeholders}}. Missing values become a visible "[Add …]" marker and are reported. */
export function fillTemplate(text: string, facts: Facts, fields: TemplateField[] = []): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(PLACEHOLDER, (_m, key: string) => {
    const value = String(facts[key] ?? "").trim();
    if (value) return value.replace(/[.\s]+$/, "");
    missing.push(key);
    const label = fields.find(f => f.key === key)?.label ?? key;
    return `[Add ${label.toLowerCase()}]`;
  });
  return { text: out.replace(/\.\./g, ".").trim(), missing: [...new Set(missing)] };
}

export type PlannedFaq = { key: string; title: string; content: string; status: "PUBLISHED" | "DRAFT"; missing: string[]; hash: string };
export type ProvisioningPlan = {
  industry: IndustryKey;
  version: number;
  welcomeMessage: string;
  handoverMessage: string;
  afterHoursMessage: string;
  faqs: PlannedFaq[];
  /** AI replies may only be offered once something is published; sensitive industries never auto-enable. */
  aiCanBeEnabled: boolean;
  missingRequired: string[];
};

export function planProvisioning(template: IndustryTemplate, facts: Facts, businessName: string): ProvisioningPlan {
  const allFacts = { ...facts, businessName };
  const faqs = template.faqs.map(faq => {
    const { text, missing } = fillTemplate(faq.content, allFacts, template.fields);
    const status: PlannedFaq["status"] = !template.sensitive && missing.length === 0 ? "PUBLISHED" : "DRAFT";
    return { key: faq.key, title: faq.title, content: text, status, missing, hash: contentHash(`${faq.title}\n${text}`) };
  });
  const welcome = fillTemplate(template.welcomeMessage, allFacts).text;
  const afterHours = fillTemplate(template.afterHoursMessage, allFacts).missing.length ? "" : fillTemplate(template.afterHoursMessage, allFacts).text;
  return {
    industry: template.key,
    version: template.version,
    welcomeMessage: welcome,
    handoverMessage: template.handoverMessage,
    afterHoursMessage: afterHours,
    faqs,
    aiCanBeEnabled: !template.sensitive && faqs.some(f => f.status === "PUBLISHED"),
    missingRequired: template.fields.filter(f => f.required && !String(facts[f.key] ?? "").trim()).map(f => f.key),
  };
}

export type InstalledFaq = { id: string; templateKey: string | null; templateHash: string | null; title: string; content: string };
export type TemplateUpdatePlan = {
  fromVersion: number;
  toVersion: number;
  /** FAQs in the new version the customer does not have. Added as drafts if accepted. */
  additions: PlannedFaq[];
  /** FAQs the customer never edited; safe to replace with the new wording if accepted. */
  replacements: (PlannedFaq & { id: string })[];
  /** FAQs the customer customised; never touched. */
  keptCustomised: { id: string; key: string; title: string }[];
};

/** Compares a newer master version with a customer's installed copy. Never overwrites customisations. */
export function planTemplateUpdate(template: IndustryTemplate, installedVersion: number, installed: InstalledFaq[], facts: Facts, businessName: string): TemplateUpdatePlan {
  const next = planProvisioning(template, facts, businessName).faqs;
  const byKey = new Map(installed.filter(i => i.templateKey).map(i => [i.templateKey!, i]));
  const plan: TemplateUpdatePlan = { fromVersion: installedVersion, toVersion: template.version, additions: [], replacements: [], keptCustomised: [] };
  if (template.version <= installedVersion) return plan;
  for (const faq of next) {
    const current = byKey.get(faq.key);
    if (!current) {
      plan.additions.push({ ...faq, status: "DRAFT" });
      continue;
    }
    const untouched = current.templateHash === contentHash(`${current.title}\n${current.content}`);
    if (!untouched) plan.keptCustomised.push({ id: current.id, key: faq.key, title: current.title });
    else if (current.templateHash !== faq.hash) plan.replacements.push({ ...faq, id: current.id });
  }
  return plan;
}

// ---------- Validation of admin-edited template definitions ----------

export function validateTemplateDefinition(value: unknown): { ok: true; template: IndustryTemplate } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const t = value as IndustryTemplate;
  if (!t || typeof t !== "object") return { ok: false, errors: ["Template must be an object"] };
  if (!isIndustryKey(t.key)) errors.push("key must be one of the supported industries");
  for (const k of ["label", "description", "welcomeMessage", "fallbackMessage", "handoverMessage", "afterHoursMessage"] as const) {
    if (typeof t[k] !== "string" || !t[k].trim()) errors.push(`${k} is required`);
    else if (t[k].length > 2000) errors.push(`${k} is too long`);
  }
  if (typeof t.sensitive !== "boolean") errors.push("sensitive must be true or false");
  if (!Array.isArray(t.menuOptions) || t.menuOptions.some(o => typeof o !== "string")) errors.push("menuOptions must be a list of text");
  if (!Array.isArray(t.fields) || t.fields.some(f => !f || typeof f.key !== "string" || typeof f.label !== "string" || !/^[a-zA-Z0-9_]+$/.test(f.key))) errors.push("fields must have a key (letters/numbers) and a label");
  if (!Array.isArray(t.faqs) || !t.faqs.length) errors.push("faqs must contain at least one question");
  else {
    const keys = new Set<string>();
    for (const f of t.faqs) {
      if (!f || typeof f.key !== "string" || typeof f.title !== "string" || typeof f.content !== "string" || !f.title.trim() || !f.content.trim()) errors.push("each FAQ needs key, title and content");
      else if (keys.has(f.key)) errors.push(`duplicate FAQ key ${f.key}`);
      else keys.add(f.key);
    }
  }
  const fieldKeys = new Set([...(Array.isArray(t.fields) ? t.fields.map(f => f.key) : []), "businessName"]);
  const texts = [t.welcomeMessage, t.afterHoursMessage, ...(Array.isArray(t.faqs) ? t.faqs.map(f => f.content) : [])].filter((s): s is string => typeof s === "string");
  for (const text of texts) for (const m of text.matchAll(PLACEHOLDER)) if (!fieldKeys.has(m[1]!)) errors.push(`placeholder {{${m[1]}}} has no matching field`);
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  return { ok: true, template: { ...t, languages: Array.isArray(t.languages) && t.languages.length ? t.languages : ["en"], version: Number(t.version) || 1 } };
}
