import { db } from "@oceanbrown/db";
import { generateReply } from "@oceanbrown/shared";
import { aiConfig } from "./config.js";

export type SimulationResult = {
  text: string;
  sources: { id: string; title: string }[];
  action: "ANSWER" | "CLARIFY" | "HANDOVER";
  provider: string;
  simulated: true;
};

/**
 * Agent playground. Runs the same grounded reply logic the worker uses for
 * live conversations, against PUBLISHED knowledge only, and never sends anything.
 */
export async function simulateReply(businessId: string, input: string): Promise<SimulationResult> {
  const cfg = aiConfig();
  const knowledge = await db.knowledgeSource.findMany({ where: { businessId, status: "PUBLISHED" }, select: { id: true, title: true, content: true } });
  const business = cfg.provider === "simulator" ? null : await db.business.findUnique({ where: { id: businessId }, select: { name: true, industry: true, timezone: true } });
  const reply = await generateReply(cfg, { businessName: business?.name ?? "this business", industry: business?.industry, timezone: business?.timezone, knowledge, history: [], message: input });
  return { text: reply.text, sources: reply.sources, action: reply.action, provider: reply.provider, simulated: true };
}
