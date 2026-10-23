import { z } from "zod";

export * from "./whatsapp.js";
export * from "./graph.js";
export * from "./ai.js";
export * from "./secrets.js";
export * from "./voice.js";

export const roles = ["SUPER_ADMIN", "OWNER", "ADMIN", "SUPERVISOR", "AGENT"] as const;
export const roleSchema = z.enum(roles);
export type Role = z.infer<typeof roleSchema>;
export const assignableRoles = ["ADMIN", "SUPERVISOR", "AGENT"] as const;

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(10, "Password must be at least 10 characters").max(200);
const e164 = z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "Phone must be in E.164 format, e.g. +2203001234");

export function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const loginSchema = z.object({ email, password: z.string().min(1).max(200) });
export const registerSchema = z.object({ name: z.string().trim().min(1).max(120), email, password, businessName: z.string().trim().min(2).max(120), industry: z.string().trim().max(80).optional() });
export const passwordResetRequestSchema = z.object({ email });
export const passwordResetSchema = z.object({ token: z.string().min(32).max(256), password });
export const businessSchema = z.object({
  name: z.string().trim().min(2).max(120),
  industry: z.string().trim().max(80),
  timezone: z.string().refine(isValidTimezone, "Unknown timezone").default("Africa/Banjul"),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  email: email.optional().or(z.literal("")),
  brandColor: z.string().regex(/^#[0-9a-f]{6}$/i).default("#8b5e3c"),
});
export const businessUpdateSchema = businessSchema.partial().extend({ automationEnabled: z.boolean().optional(), defaultLanguage: z.enum(["en", "fr", "wo"]).optional(), voiceReplies: z.enum(["MIRROR", "ALWAYS", "NEVER"]).optional() });
export const customerSchema = z.object({ name: z.string().trim().min(1).max(120), phone: e164, email: email.optional().or(z.literal("")).transform(v => v || undefined), consent: z.boolean().default(false) });
export const customerImportSchema = z.object({
  customers: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    phone: e164,
    email: email.optional().or(z.literal("")).transform(v => v || undefined),
    consent: z.boolean().default(false),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  })).min(1).max(5000),
  updateExisting: z.boolean().default(true),
});
export const messageSchema = z.object({ conversationId: z.string().cuid(), body: z.string().trim().min(1).max(4096), clientId: z.string().min(8).max(100) });
export const noteSchema = z.object({ body: z.string().trim().min(1).max(4000) });
export const bookingSchema = z
  .object({ customerId: z.string().cuid(), startsAt: z.string().datetime(), endsAt: z.string().datetime(), service: z.string().trim().min(2).max(120), notes: z.string().max(1000).optional() })
  .refine(v => new Date(v.endsAt) > new Date(v.startsAt), { message: "End time must be after start time" });
export const knowledgeSchema = z.object({ title: z.string().trim().min(2).max(160), content: z.string().trim().min(2).max(50000), status: z.enum(["DRAFT", "APPROVED", "PUBLISHED"]).default("DRAFT") });
export const teamCreateSchema = z.object({ name: z.string().trim().min(1).max(120), email, password, role: z.enum(assignableRoles) });
export const teamInviteSchema = z.object({ name: z.string().trim().min(1).max(120), email, role: z.enum(assignableRoles) });
export const ticketStatuses = ["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED"] as const;
export const ticketPriorities = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const ticketCreateSchema = z.object({ customerId: z.string().cuid(), title: z.string().trim().min(2).max(200), body: z.string().trim().min(1).max(5000), priority: z.enum(ticketPriorities).default("NORMAL") });
export const ticketUpdateSchema = z.object({ status: z.enum(ticketStatuses).optional(), priority: z.enum(ticketPriorities).optional() });
export const whatsappConnectionSchema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, "Phone number ID is the numeric ID from Meta, not the phone number"),
  wabaId: z.string().trim().regex(/^\d{5,30}$/).optional().or(z.literal("")),
  displayPhone: z.string().trim().max(30).optional(),
  accessToken: z.string().trim().min(20).max(1000).optional(),
});
export const campaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  templateName: z.string().trim().min(1).max(512).regex(/^[a-z0-9_]+$/, "Template names use lowercase letters, numbers and underscores"),
  language: z.string().trim().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/).default("en_US"),
  audienceTag: z.string().trim().min(1).max(40).optional().or(z.literal("")).transform(v => v || undefined),
  scheduledAt: z.string().datetime().optional(),
});

export type SessionUser = { id: string; businessId: string | null; role: Role; email: string; name: string };

export const permissions: Record<Role, string[]> = {
  SUPER_ADMIN: ["*"],
  OWNER: ["business:*", "team:*", "conversation:*", "customer:*", "booking:*", "knowledge:*"],
  ADMIN: ["team:read", "conversation:*", "customer:*", "booking:*", "knowledge:*"],
  SUPERVISOR: ["conversation:*", "customer:*", "booking:*", "knowledge:read"],
  AGENT: ["conversation:read", "conversation:reply", "customer:read", "booking:read"],
};
export function can(role: Role, permission: string) {
  const p = permissions[role];
  if (!p) return false;
  return p.includes("*") || p.includes(permission) || p.some(x => x.endsWith(":*") && permission.startsWith(x.slice(0, -1)));
}
export * from "./industries.js";
