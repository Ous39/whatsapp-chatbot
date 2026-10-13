import { db } from "@oceanbrown/db";
import { isWithinServiceWindow } from "@oceanbrown/shared";
import { config } from "./config.js";
import { HttpError } from "./auth.js";
import { enqueue } from "./queue.js";

/**
 * Checks Meta's sending rules before an agent reply is accepted, so staff get
 * an immediate, clear error instead of a silent failure later.
 */
export async function assertCanMessage(businessId: string, customer: { optedOutAt: Date | null; lastInboundAt: Date | null }) {
  if (customer.optedOutAt) throw new HttpError(422, "This customer opted out of WhatsApp messages (sent STOP). They must message you again or send START first.");
  if (!config.whatsapp.liveEnabled) return { transport: "simulator" as const };
  const connection = await db.whatsAppConnection.findFirst({ where: { businessId, status: "CONNECTED" }, select: { id: true } });
  if (!connection) return { transport: "simulator" as const };
  if (!isWithinServiceWindow(customer.lastInboundAt)) {
    throw new HttpError(422, "The 24-hour customer service window has closed. WhatsApp only allows an approved template message until the customer replies.");
  }
  return { transport: "whatsapp" as const };
}

export async function queueOutbound(params: { businessId: string; conversationId: string; body: string; clientId: string; authorId?: string; transport: "whatsapp" | "simulator"; log?: any }) {
  const message = await db.message.upsert({
    where: { businessId_clientId: { businessId: params.businessId, clientId: params.clientId } },
    update: {},
    create: {
      businessId: params.businessId,
      conversationId: params.conversationId,
      clientId: params.clientId,
      direction: "OUTBOUND",
      body: params.body,
      status: "QUEUED",
      metadata: { transport: params.transport, authorId: params.authorId ?? null, source: params.authorId ? "agent" : "ai" },
    },
  });
  if (message.conversationId !== params.conversationId) throw new HttpError(409, "clientId was already used for a different conversation");
  await db.conversation.update({ where: { id: params.conversationId }, data: { lastMessageAt: new Date() } });
  if (params.transport === "whatsapp" && message.status === "QUEUED") {
    await enqueue("send-message", { messageId: message.id }, `send-${message.id}`, params.log);
  }
  return message;
}
