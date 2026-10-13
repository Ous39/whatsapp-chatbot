import type { FastifyInstance } from "fastify";
import { db } from "@oceanbrown/db";
import {
  assignableRoles,
  bookingSchema,
  businessUpdateSchema,
  customerSchema,
  knowledgeSchema,
  messageSchema,
  noteSchema,
  teamCreateSchema,
  ticketCreateSchema,
  ticketUpdateSchema,
} from "@oceanbrown/shared";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { audit, requireAuth, requirePermission, tenantId } from "./auth.js";
import { aiConfig, config } from "./config.js";
import { assertCanMessage, queueOutbound } from "./outbound.js";
import { simulateReply } from "./simulator.js";

const idParam = (req: { params: unknown }) => String((req.params as { id?: string }).id ?? "");
const bad = (reply: any, error: string, details?: unknown) => reply.code(400).send({ error, ...(details ? { details } : {}) });
const isUniqueViolation = (err: any) => err?.code === "P2002";

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    let database = "ok";
    try {
      await db.$queryRaw`SELECT 1`;
    } catch {
      database = "unavailable";
    }
    return { status: database === "ok" ? "ok" : "degraded", database, aiProvider: aiConfig().provider, liveWhatsApp: config.whatsapp.liveEnabled, time: new Date().toISOString() };
  });

  app.get("/overview", { preHandler: requireAuth }, async req => {
    const businessId = tenantId(req);
    const [customers, open, leads, bookings, messages, business] = await Promise.all([
      db.customer.count({ where: { businessId } }),
      db.conversation.count({ where: { businessId, status: "OPEN" } }),
      db.lead.count({ where: { businessId, stage: { notIn: ["WON", "LOST"] } } }),
      db.booking.count({ where: { businessId, startsAt: { gte: new Date() }, status: { in: ["REQUESTED", "CONFIRMED"] } } }),
      db.message.count({ where: { businessId } }),
      db.business.findUnique({ where: { id: businessId }, select: { automationEnabled: true } }),
    ]);
    return { customers, openConversations: open, activeLeads: leads, upcomingBookings: bookings, messages, aiProvider: aiConfig().provider, automationEnabled: business?.automationEnabled ?? false, liveWhatsApp: config.whatsapp.liveEnabled };
  });

  app.get("/business", { preHandler: requireAuth }, async req =>
    db.business.findUniqueOrThrow({
      where: { id: tenantId(req) },
      select: { id: true, name: true, slug: true, industry: true, timezone: true, phone: true, email: true, brandColor: true, automationEnabled: true, aiProvider: true, welcomeMessage: true, handoverMessage: true, createdAt: true },
    }),
  );

  app.patch("/business", { preHandler: requirePermission("business:*") }, async (req, reply) => {
    const parsed = businessUpdateSchema.extend({ welcomeMessage: z.string().max(1000).nullable().optional(), handoverMessage: z.string().max(1000).nullable().optional() }).safeParse(req.body);
    if (!parsed.success) return bad(reply, "Invalid business details", parsed.error.flatten());
    const data = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v === "" ? null : v]));
    if (!Object.keys(data).length) return bad(reply, "No supported fields supplied");
    const row = await db.business.update({ where: { id: tenantId(req) }, data: data as any });
    await audit("business.update", "Business", row.id, req, { fields: Object.keys(data) });
    return row;
  });

  // ---------- Team ----------
  app.get("/team", { preHandler: requirePermission("team:read") }, async req =>
    db.user.findMany({ where: { businessId: tenantId(req) }, select: { id: true, name: true, email: true, role: true, active: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
  );

  app.post("/team", { preHandler: requirePermission("team:*") }, async (req, reply) => {
    const parsed = teamCreateSchema.safeParse(req.body);
    if (!parsed.success) return bad(reply, "Name, email, role and a 10-character temporary password are required", parsed.error.flatten());
    try {
      const row = await db.user.create({
        data: { businessId: tenantId(req), name: parsed.data.name, email: parsed.data.email, passwordHash: await bcrypt.hash(parsed.data.password, 12), role: parsed.data.role },
        select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
      });
      await audit("team.create", "User", row.id, req, { role: row.role });
      return reply.code(201).send(row);
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: "A user with that email already exists" });
      throw err;
    }
  });

  app.patch("/team/:id", { preHandler: requirePermission("team:*") }, async (req, reply) => {
    const businessId = tenantId(req);
    const id = idParam(req);
    const parsed = z.object({ role: z.enum(assignableRoles).optional(), active: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) return bad(reply, "Invalid role or status");
    if (id === req.user.id) return reply.code(400).send({ error: "You cannot change your own role or deactivate yourself" });
    const found = await db.user.findFirst({ where: { id, businessId } });
    if (!found) return reply.code(404).send({ error: "Team member not found" });
    if (found.role === "OWNER" || found.role === "SUPER_ADMIN") return reply.code(403).send({ error: "Owners can only be changed by platform support" });
    const row = await db.user.update({ where: { id }, data: parsed.data, select: { id: true, name: true, email: true, role: true, active: true } });
    await audit("team.update", "User", id, req, parsed.data);
    return row;
  });

  // ---------- Conversations ----------
  app.get("/conversations", { preHandler: requirePermission("conversation:read") }, async req => {
    const q = req.query as { status?: string; mine?: string };
    const status = ["OPEN", "PENDING", "RESOLVED"].includes(q.status ?? "") ? (q.status as "OPEN") : undefined;
    return db.conversation.findMany({
      where: { businessId: tenantId(req), ...(status ? { status } : {}), ...(q.mine === "true" ? { assignedToId: req.user.id } : {}) },
      include: { customer: true, assignedTo: { select: { id: true, name: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { lastMessageAt: "desc" },
      take: 100,
    });
  });

  app.get("/conversations/:id", { preHandler: requirePermission("conversation:read") }, async (req, reply) => {
    const row = await db.conversation.findFirst({
      where: { id: idParam(req), businessId: tenantId(req) },
      include: {
        customer: true,
        assignedTo: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: "asc" }, take: 500 },
        notes: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!row) return reply.code(404).send({ error: "Conversation not found" });
    return { ...row, serviceWindowOpen: !!row.customer.lastInboundAt && Date.now() - row.customer.lastInboundAt.getTime() < 86_400_000 };
  });

  app.post("/conversations/:id/messages", { preHandler: requirePermission("conversation:reply") }, async (req, reply) => {
    const businessId = tenantId(req);
    const parsed = messageSchema.safeParse({ ...(req.body as Record<string, unknown>), conversationId: idParam(req) });
    if (!parsed.success) return bad(reply, "Invalid message", parsed.error.flatten());
    const convo = await db.conversation.findFirst({ where: { id: parsed.data.conversationId, businessId }, include: { customer: true } });
    if (!convo) return reply.code(404).send({ error: "Conversation not found" });
    const { transport } = await assertCanMessage(businessId, convo.customer);
    // A human replying takes the conversation over so the AI does not talk over them.
    if (convo.mode === "AI") await db.conversation.update({ where: { id: convo.id }, data: { mode: "HUMAN", humanTakenAt: new Date(), assignedToId: convo.assignedToId ?? req.user.id } });
    const message = await queueOutbound({ businessId, conversationId: convo.id, body: parsed.data.body, clientId: parsed.data.clientId, authorId: req.user.id, transport, log: req.log });
    await audit("message.create", "Message", message.id, req, { transport });
    return reply.code(201).send(message);
  });

  app.post("/conversations/:id/notes", { preHandler: requirePermission("conversation:reply") }, async (req, reply) => {
    const businessId = tenantId(req);
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) return bad(reply, "Note text is required");
    const convo = await db.conversation.findFirst({ where: { id: idParam(req), businessId }, select: { id: true } });
    if (!convo) return reply.code(404).send({ error: "Conversation not found" });
    const note = await db.internalNote.create({ data: { businessId, conversationId: convo.id, authorId: req.user.id, body: parsed.data.body }, include: { author: { select: { name: true } } } });
    return reply.code(201).send(note);
  });

  app.patch("/conversations/:id/mode", { preHandler: requirePermission("conversation:*") }, async (req, reply) => {
    const businessId = tenantId(req);
    const mode = (req.body as { mode?: string })?.mode;
    if (!["AI", "HUMAN", "PAUSED"].includes(mode ?? "")) return bad(reply, "Invalid mode");
    const updated = await db.conversation.updateMany({ where: { id: idParam(req), businessId }, data: { mode: mode as "AI" | "HUMAN" | "PAUSED", humanTakenAt: mode === "HUMAN" ? new Date() : null } });
    if (!updated.count) return reply.code(404).send({ error: "Conversation not found" });
    await audit("conversation.mode", "Conversation", idParam(req), req, { mode });
    return { ok: true };
  });

  app.patch("/conversations/:id", { preHandler: requirePermission("conversation:reply") }, async (req, reply) => {
    const businessId = tenantId(req);
    const parsed = z.object({ status: z.enum(["OPEN", "PENDING", "RESOLVED"]).optional(), assignedToId: z.string().cuid().nullable().optional() }).safeParse(req.body);
    if (!parsed.success) return bad(reply, "Invalid conversation update");
    if (parsed.data.assignedToId && !(await db.user.findFirst({ where: { id: parsed.data.assignedToId, businessId, active: true }, select: { id: true } }))) {
      return reply.code(404).send({ error: "Team member not found" });
    }
    const data: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.status) data.resolvedAt = parsed.data.status === "RESOLVED" ? new Date() : null;
    const updated = await db.conversation.updateMany({ where: { id: idParam(req), businessId }, data: data as any });
    if (!updated.count) return reply.code(404).send({ error: "Conversation not found" });
    await audit("conversation.update", "Conversation", idParam(req), req, parsed.data);
    return { ok: true };
  });

  // ---------- CRM ----------
  app.get("/customers", { preHandler: requirePermission("customer:read") }, async req =>
    db.customer.findMany({ where: { businessId: tenantId(req) }, include: { leads: true }, orderBy: { createdAt: "desc" }, take: 200 }),
  );

  app.post("/customers", { preHandler: requirePermission("customer:*") }, async (req, reply) => {
    const parsed = customerSchema.safeParse(req.body);
    if (!parsed.success) return bad(reply, "Invalid customer", parsed.error.flatten());
    try {
      return reply.code(201).send(await db.customer.create({ data: { ...parsed.data, businessId: tenantId(req), tags: [] } }));
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: "A customer with that phone number already exists" });
      throw err;
    }
  });

  app.get("/leads", { preHandler: requirePermission("customer:read") }, async req =>
    db.lead.findMany({ where: { businessId: tenantId(req) }, include: { customer: true }, orderBy: { updatedAt: "desc" }, take: 500 }),
  );

  app.post("/leads", { preHandler: requirePermission("customer:*") }, async (req, reply) => {
    const businessId = tenantId(req);
    const s = z.string().trim().max(500).optional();
    const parsed = z.object({ customerId: z.string().cuid(), requestedService: s, businessNeed: z.string().trim().max(2000).optional(), preferredContact: s, budgetRange: s, desiredTimeline: s, nextAction: s }).safeParse(req.body);
    if (!parsed.success) return bad(reply, "Customer is required", parsed.error.flatten());
    if (!(await db.customer.findFirst({ where: { id: parsed.data.customerId, businessId } }))) return reply.code(404).send({ error: "Customer not found" });
    return reply.code(201).send(await db.lead.create({ data: { ...parsed.data, businessId } }));
  });

  app.patch("/leads/:id", { preHandler: requirePermission("customer:*") }, async (req, reply) => {
    const businessId = tenantId(req);
    const id = idParam(req);
    const parsed = z.object({ stage: z.enum(["NEW", "QUALIFYING", "QUALIFIED", "WON", "LOST"]).optional(), nextAction: z.string().max(500).optional() }).safeParse(req.body);
    if (!parsed.success) return bad(reply, "Invalid stage");
    if (!(await db.lead.findFirst({ where: { id, businessId } }))) return reply.code(404).send({ error: "Lead not found" });
    return db.lead.update({ where: { id }, data: parsed.data });
  });

  // ---------- Bookings ----------
  app.get("/bookings", { preHandler: requirePermission("booking:read") }, async req =>
    db.booking.findMany({ where: { businessId: tenantId(req) }, include: { customer: true }, orderBy: { startsAt: "asc" }, take: 500 }),
  );

  app.post("/bookings", { preHandler: requirePermission("booking:*") }, async (req, reply) => {
    const parsed = bookingSchema.safeParse(req.body);
    if (!parsed.success) return bad(reply, "Invalid booking", parsed.error.flatten());
    const businessId = tenantId(req);
    const startsAt = new Date(parsed.data.startsAt);
    const endsAt = new Date(parsed.data.endsAt);
    const header = req.headers["idempotency-key"];
    const key = (typeof header === "string" && header.length <= 100 ? header : undefined) ?? `${parsed.data.customerId}-${startsAt.toISOString()}`;
    const customer = await db.customer.findFirst({ where: { id: parsed.data.customerId, businessId } });
    if (!customer) return reply.code(404).send({ error: "Customer not found" });
    const result = await db.$transaction(async tx => {
      // Serialize booking creation per business so two requests cannot both pass the conflict check.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"booking:" + businessId}))`;
      // An idempotent retry returns the original booking instead of conflicting with itself.
      const existing = await tx.booking.findUnique({ where: { businessId_idempotencyKey: { businessId, idempotencyKey: key } } });
      if (existing) return { row: existing, created: false };
      const conflict = await tx.booking.findFirst({ where: { businessId, status: { in: ["REQUESTED", "CONFIRMED"] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } });
      if (conflict) return { conflict: true as const };
      const row = await tx.booking.create({ data: { ...parsed.data, startsAt, endsAt, businessId, idempotencyKey: key, timezone: "Africa/Banjul" } });
      return { row, created: true };
    });
    if ("conflict" in result) return reply.code(409).send({ error: "Time slot is unavailable" });
    if (result.created) await audit("booking.create", "Booking", result.row.id, req);
    return reply.code(result.created ? 201 : 200).send(result.row);
  });

  app.patch("/bookings/:id", { preHandler: requirePermission("booking:*") }, async (req, reply) => {
    const businessId = tenantId(req);
    const id = idParam(req);
    const parsed = z.object({ status: z.enum(["REQUESTED", "CONFIRMED", "CANCELLED", "COMPLETED"]) }).safeParse(req.body);
    if (!parsed.success) return bad(reply, "Invalid status");
    if (!(await db.booking.findFirst({ where: { id, businessId } }))) return reply.code(404).send({ error: "Booking not found" });
    const row = await db.booking.update({ where: { id }, data: { status: parsed.data.status } });
    await audit("booking.status", "Booking", id, req, parsed.data);
    return row;
  });

  // ---------- Knowledge ----------
  app.get("/knowledge", { preHandler: requirePermission("knowledge:read") }, async req =>
    db.knowledgeSource.findMany({ where: { businessId: tenantId(req) }, orderBy: { updatedAt: "desc" } }),
  );

  app.post("/knowledge", { preHandler: requirePermission("knowledge:*") }, async (req, reply) => {
    const parsed = knowledgeSchema.safeParse(req.body);
    if (!parsed.success) return bad(reply, "Invalid source", parsed.error.flatten());
    const row = await db.knowledgeSource.create({ data: { ...parsed.data, businessId: tenantId(req) } });
    await audit("knowledge.create", "KnowledgeSource", row.id, req, { status: row.status });
    return reply.code(201).send(row);
  });

  app.patch("/knowledge/:id", { preHandler: requirePermission("knowledge:*") }, async (req, reply) => {
    const businessId = tenantId(req);
    const id = idParam(req);
    const parsed = knowledgeSchema.partial().safeParse(req.body);
    if (!parsed.success) return bad(reply, "Invalid source", parsed.error.flatten());
    if (!(await db.knowledgeSource.findFirst({ where: { id, businessId } }))) return reply.code(404).send({ error: "Knowledge source not found" });
    const row = await db.knowledgeSource.update({ where: { id }, data: { ...parsed.data, version: { increment: 1 } } });
    await audit("knowledge.update", "KnowledgeSource", id, req, { status: row.status, version: row.version });
    return row;
  });

  app.delete("/knowledge/:id", { preHandler: requirePermission("knowledge:*") }, async (req, reply) => {
    const removed = await db.knowledgeSource.deleteMany({ where: { id: idParam(req), businessId: tenantId(req) } });
    if (!removed.count) return reply.code(404).send({ error: "Knowledge source not found" });
    await audit("knowledge.delete", "KnowledgeSource", idParam(req), req);
    return reply.code(204).send();
  });

  // ---------- Tickets ----------
  app.get("/tickets", { preHandler: requirePermission("conversation:read") }, async req =>
    db.ticket.findMany({ where: { businessId: tenantId(req) }, include: { customer: true }, orderBy: { updatedAt: "desc" }, take: 500 }),
  );

  app.post("/tickets", { preHandler: requirePermission("conversation:*") }, async (req, reply) => {
    const businessId = tenantId(req);
    const parsed = ticketCreateSchema.safeParse(req.body);
    if (!parsed.success) return bad(reply, "Customer, title, and description are required", parsed.error.flatten());
    if (!(await db.customer.findFirst({ where: { id: parsed.data.customerId, businessId } }))) return reply.code(404).send({ error: "Customer not found" });
    return reply.code(201).send(await db.ticket.create({ data: { ...parsed.data, businessId } }));
  });

  app.patch("/tickets/:id", { preHandler: requirePermission("conversation:*") }, async (req, reply) => {
    const businessId = tenantId(req);
    const id = idParam(req);
    const parsed = ticketUpdateSchema.safeParse(req.body);
    if (!parsed.success) return bad(reply, "Invalid status or priority");
    if (!(await db.ticket.findFirst({ where: { id, businessId } }))) return reply.code(404).send({ error: "Ticket not found" });
    return db.ticket.update({ where: { id }, data: parsed.data });
  });

  // ---------- Automations, campaigns, saved replies ----------
  app.get("/automations", { preHandler: requirePermission("business:*") }, async req => db.automation.findMany({ where: { businessId: tenantId(req) }, orderBy: { updatedAt: "desc" } }));

  app.post("/automations", { preHandler: requirePermission("business:*") }, async (req, reply) => {
    const parsed = z.object({ name: z.string().trim().min(1).max(120), trigger: z.enum(["CUSTOMER_CREATED", "AFTER_HOURS", "LEAD_FOLLOW_UP", "BOOKING_REMINDER"]), message: z.string().trim().min(1).max(1000) }).safeParse(req.body);
    if (!parsed.success) return bad(reply, "Name, trigger, and message are required");
    return reply.code(201).send(await db.automation.create({ data: { businessId: tenantId(req), name: parsed.data.name, trigger: parsed.data.trigger, actions: { type: "send_message", message: parsed.data.message } } }));
  });

  app.patch("/automations/:id", { preHandler: requirePermission("business:*") }, async (req, reply) => {
    const businessId = tenantId(req);
    const id = idParam(req);
    const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return bad(reply, "enabled must be true or false");
    if (!(await db.automation.findFirst({ where: { id, businessId } }))) return reply.code(404).send({ error: "Automation not found" });
    const row = await db.automation.update({ where: { id }, data: parsed.data });
    await audit("automation.update", "Automation", id, req, parsed.data);
    return row;
  });

  app.get("/campaigns", { preHandler: requirePermission("business:*") }, async req => db.campaign.findMany({ where: { businessId: tenantId(req) }, orderBy: { updatedAt: "desc" } }));

  app.post("/campaigns", { preHandler: requirePermission("business:*") }, async (req, reply) => {
    const parsed = z.object({ name: z.string().trim().min(1).max(120), templateName: z.string().trim().max(512).regex(/^[a-z0-9_]*$/, "Template names use lowercase letters, numbers and underscores").optional().or(z.literal("")) }).safeParse(req.body);
    if (!parsed.success) return bad(reply, "Campaign name is required", parsed.error.flatten());
    return reply.code(201).send(await db.campaign.create({ data: { businessId: tenantId(req), name: parsed.data.name, templateName: parsed.data.templateName || null, audience: { consent: true, optedOut: false }, status: "DRAFT" } }));
  });

  app.get("/saved-replies", { preHandler: requirePermission("conversation:read") }, async req => db.savedReply.findMany({ where: { businessId: tenantId(req) }, orderBy: { title: "asc" } }));

  app.post("/saved-replies", { preHandler: requirePermission("conversation:*") }, async (req, reply) => {
    const parsed = z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(4096), shortcut: z.string().trim().min(1).max(40) }).safeParse(req.body);
    if (!parsed.success) return bad(reply, "Title, body, and shortcut are required");
    try {
      return reply.code(201).send(await db.savedReply.create({ data: { businessId: tenantId(req), ...parsed.data } }));
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: "That shortcut is already in use" });
      throw err;
    }
  });

  app.get("/audit", { preHandler: requirePermission("business:*") }, async req => db.auditLog.findMany({ where: { businessId: tenantId(req) }, orderBy: { createdAt: "desc" }, take: 200 }));

  app.get("/analytics", { preHandler: requireAuth }, async req => {
    const businessId = tenantId(req);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [messages, delivered, failed, inbound, aiReplies, open, resolved, human, leads, won, bookings] = await Promise.all([
      db.message.count({ where: { businessId, direction: "OUTBOUND" } }),
      db.message.count({ where: { businessId, direction: "OUTBOUND", status: { in: ["DELIVERED", "READ"] } } }),
      db.message.count({ where: { businessId, status: "FAILED" } }),
      db.message.count({ where: { businessId, direction: "INBOUND", createdAt: { gte: since } } }),
      db.message.count({ where: { businessId, direction: "OUTBOUND", createdAt: { gte: since }, metadata: { path: ["source"], equals: "ai" } } }),
      db.conversation.count({ where: { businessId, status: "OPEN" } }),
      db.conversation.count({ where: { businessId, status: "RESOLVED" } }),
      db.conversation.count({ where: { businessId, mode: "HUMAN" } }),
      db.lead.count({ where: { businessId } }),
      db.lead.count({ where: { businessId, stage: "WON" } }),
      db.booking.count({ where: { businessId, status: "CONFIRMED" } }),
    ]);
    return {
      outboundMessages: messages,
      delivered,
      failed,
      deliveryRate: messages ? Math.round((delivered / messages) * 100) : 0,
      inboundLast30Days: inbound,
      aiRepliesLast30Days: aiReplies,
      openConversations: open,
      resolvedConversations: resolved,
      handoverCount: human,
      leadConversionRate: leads ? Math.round((won / leads) * 100) : 0,
      confirmedBookings: bookings,
      estimatedAiCost: 0,
      estimates: true,
    };
  });

  // Playground: uses the configured AI provider but never sends anything to a customer.
  app.post("/simulator", { preHandler: requirePermission("conversation:reply"), config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const input = (req.body as { message?: unknown })?.message;
    if (typeof input !== "string" || !input.trim() || input.length > 4096) return bad(reply, "Message is required");
    return simulateReply(tenantId(req), input);
  });

  app.get("/settings/status", { preHandler: requireAuth }, async req => {
    const businessId = tenantId(req);
    const connection = await db.whatsAppConnection.findFirst({ where: { businessId }, select: { status: true, displayPhone: true, verifiedName: true, webhookHealthy: true, lastWebhookAt: true, lastError: true } });
    const ai = aiConfig();
    return {
      ai: { provider: ai.provider, model: ai.provider === "simulator" ? null : ai.model ?? "default", live: ai.provider !== "simulator", label: ai.provider === "simulator" ? "LOCAL SIMULATOR — keyword retrieval only" : `${ai.provider} (grounded in published knowledge)` },
      whatsapp: { ...(connection ?? { status: "DISCONNECTED", webhookHealthy: false }), liveEnabled: config.whatsapp.liveEnabled },
      requirements: { metaAppSecret: !!config.whatsapp.appSecret, metaVerifyToken: !!config.whatsapp.verifyToken, encryptionKey: !!config.encryptionKey },
    };
  });
}
