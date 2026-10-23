"use client";
import { useState } from "react";
import { api } from "../lib/api";

type Topic = "WHATSAPP_SETUP" | "TEMPLATES" | "BILLING" | "OTHER";

/** "Ask OceanBrown" form. Requests land in the provider admin's Help requests list. */
export function HelpRequest({ topic = "OTHER", prompt, onSent, compact = false }: { topic?: Topic; prompt?: string; onSent?: () => void; compact?: boolean }) {
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setState("sending");
    try {
      await api("/support-requests", { method: "POST", body: JSON.stringify({ topic, message, ...(phone.trim() ? { contactPhone: phone.trim() } : {}) }) });
      setState("sent");
      onSent?.();
    } catch (cause) {
      setError((cause as Error).message);
      setState("idle");
    }
  };
  if (state === "sent") return <p className="success" role="status">Thanks — OceanBrown has your request and will contact you. You can follow it under Help.</p>;
  return (
    <form className={compact ? "help-form compact" : "help-form"} onSubmit={submit}>
      <label>
        {prompt ?? "What do you need help with?"}
        <textarea className="input" required minLength={5} maxLength={2000} rows={compact ? 2 : 3} value={message} onChange={e => setMessage(e.target.value)} placeholder={topic === "WHATSAPP_SETUP" ? "e.g. Please connect +220 … — I don't have a Facebook business account yet." : "Describe what you need"} />
      </label>
      <label>
        Phone number we can call (optional)
        <input className="input" inputMode="tel" maxLength={30} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+220 …" />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button className="btn secondary" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Ask OceanBrown for help"}</button>
      </div>
    </form>
  );
}
