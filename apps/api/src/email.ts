import { config } from "./config.js";

export async function sendTransactionalEmail(input: { to: string; subject: string; text: string; html: string }) {
  if (!config.email.resendApiKey) return { delivered: false as const, reason: "not_configured" as const };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.email.resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: config.email.from, to: [input.to], subject: input.subject, text: input.text, html: input.html }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Transactional email failed (${response.status})`);
  return { delivered: true as const };
}
