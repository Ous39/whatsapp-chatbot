import { z } from "zod";

export const roles = ["SUPER_ADMIN", "OWNER", "ADMIN", "SUPERVISOR", "AGENT"] as const;
export const roleSchema = z.enum(roles);
export type Role = z.infer<typeof roleSchema>;

export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
export const businessSchema = z.object({
  name: z.string().min(2).max(120), industry: z.string().max(80), timezone: z.string().default("Africa/Banjul"),
  phone: z.string().max(30).optional(), email: z.string().email().optional(), brandColor: z.string().regex(/^#[0-9a-f]{6}$/i).default("#8b5e3c")
});
export const customerSchema = z.object({ name: z.string().min(1).max(120), phone: z.string().regex(/^\+[1-9]\d{6,14}$/), email: z.string().email().optional(), consent: z.boolean().default(false) });
export const messageSchema = z.object({ conversationId: z.string().cuid(), body: z.string().min(1).max(4096), clientId: z.string().min(8).max(100) });
export const bookingSchema = z.object({ customerId: z.string().cuid(), startsAt: z.string().datetime(), endsAt: z.string().datetime(), service: z.string().min(2).max(120), notes: z.string().max(1000).optional() }).refine(v => new Date(v.endsAt) > new Date(v.startsAt), {message:"End time must be after start time"});
export const knowledgeSchema = z.object({ title: z.string().min(2).max(160), content: z.string().min(2).max(50000), status: z.enum(["DRAFT","APPROVED","PUBLISHED"]).default("DRAFT") });
export type SessionUser = { id: string; businessId: string | null; role: Role; email: string; name: string };

export const permissions: Record<Role, string[]> = {
  SUPER_ADMIN: ["*"], OWNER: ["business:*","team:*","conversation:*","customer:*","booking:*","knowledge:*"],
  ADMIN: ["team:read","conversation:*","customer:*","booking:*","knowledge:*"],
  SUPERVISOR: ["conversation:*","customer:*","booking:*","knowledge:read"],
  AGENT: ["conversation:read","conversation:reply","customer:read","booking:read"]
};
export function can(role: Role, permission: string) { const p=permissions[role]; return p.includes("*") || p.includes(permission) || p.some(x=>x.endsWith(":*")&&permission.startsWith(x.slice(0,-1))); }
