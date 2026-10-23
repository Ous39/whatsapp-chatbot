"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { WHATSAPP_LABEL, WHATSAPP_TONE, type Onboarding } from "../lib/onboarding";
import { HelpRequest } from "./HelpRequest";

declare global {
  interface Window {
    FB?: { init: (config: Record<string, unknown>) => void; login: (callback: (response: any) => void, options: Record<string, unknown>) => void };
    fbAsyncInit?: () => void;
  }
}

type SignupConfig = { enabled: boolean; appId: string | null; configId: string | null; graphVersion: string };
type SignupResult = { phoneNumberId?: string; wabaId?: string; event?: string; cancelledAt?: string; errorCode?: string; errorMessage?: string };

const ICON: Record<string, string> = { ok: "✓", pending: "…", failed: "!", unknown: "?" };

export function StatusChecks({ checks }: { checks: Onboarding["whatsapp"]["checks"] }) {
  return (
    <ul className="checks">
      {checks.map(check => (
        <li key={check.id} className={`check ${check.state}`}>
          <span className="check-icon" aria-hidden="true">{ICON[check.state]}</span>
          <span className="grow">
            {check.label}
            {check.hint && <small> · {check.hint}</small>}
          </span>
          <span className="sr-only">{check.state === "ok" ? "done" : check.state}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Connecting a number, the customer's way: Meta's own sign-up window (Embedded Signup). The customer never
 * types a token, an ID or a webhook URL. OceanBrown finishes registration server-side and the status only
 * becomes "Live" after Meta has actually delivered a message.
 */
export function ConnectWhatsApp({ status, available, onChanged }: { status: Onboarding; available: boolean; onChanged: () => void }) {
  const [config, setConfig] = useState<SignupConfig | null>(null);
  const [busy, setBusy] = useState<"" | "connecting" | "checking">("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const result = useRef<SignupResult>({});
  const w = status.whatsapp;
  const hasConnection = w.state !== "NOT_STARTED" && !(w.state === "ACTION_REQUIRED" && !w.number);

  useEffect(() => {
    if (!available) return;
    api<SignupConfig>("/whatsapp/embedded/config")
      .then(cfg => {
        setConfig(cfg);
        if (!cfg.enabled || !cfg.appId) return;
        window.fbAsyncInit = () => window.FB?.init({ appId: cfg.appId, cookie: true, xfbml: false, version: cfg.graphVersion });
        if (!document.getElementById("facebook-jssdk")) {
          const script = document.createElement("script");
          script.id = "facebook-jssdk";
          script.async = true;
          script.defer = true;
          script.crossOrigin = "anonymous";
          script.src = "https://connect.facebook.net/en_US/sdk.js";
          document.body.appendChild(script);
        } else if (window.FB) window.fbAsyncInit();
      })
      .catch(() => setConfig(null));
    // Meta's window reports progress with postMessage. Only messages from Facebook are trusted.
    const listener = (event: MessageEvent) => {
      let host = "";
      try { host = new URL(event.origin).hostname; } catch { return; }
      if (!/(^|\.)facebook\.com$|(^|\.)facebook\.net$/.test(host)) return;
      let data: any = event.data;
      try { if (typeof data === "string") data = JSON.parse(data); } catch { return; }
      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
      const d = data.data ?? {};
      if (typeof data.event === "string" && data.event.startsWith("FINISH")) {
        result.current = { ...result.current, event: data.event, phoneNumberId: d.phone_number_id ? String(d.phone_number_id) : undefined, wabaId: d.waba_id ? String(d.waba_id) : undefined };
      } else if (data.event === "CANCEL" || data.event === "ERROR") {
        if (d.error_message || d.error_code) result.current = { ...result.current, errorCode: d.error_code ? String(d.error_code) : undefined, errorMessage: d.error_message ? String(d.error_message) : undefined };
        else result.current = { ...result.current, cancelledAt: d.current_step ? String(d.current_step) : "unknown step" };
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [available]);

  const report = (body: Record<string, unknown>) => api<{ message: string | null }>("/onboarding/whatsapp/event", { method: "POST", body: JSON.stringify(body) }).catch(() => ({ message: null }));

  const connect = async () => {
    setMessage(null);
    result.current = {};
    if (!config?.enabled || !config.configId || !window.FB) {
      setMessage({ kind: "error", text: "Meta's sign-up is still loading. Wait a moment and try again." });
      return;
    }
    setBusy("connecting");
    await report({ event: "started" });
    window.FB.login(
      async response => {
        const code = response?.authResponse?.code;
        try {
          if (!code) {
            const r = result.current;
            const reported = r.errorCode || r.errorMessage
              ? await report({ event: "error", code: r.errorCode, message: r.errorMessage })
              : await report({ event: "cancelled", step: r.cancelledAt });
            setMessage({ kind: "error", text: reported.message ?? "The Meta sign-up was closed before it finished. Nothing was lost — connect again when you're ready." });
            return;
          }
          // The code expires after about 30 seconds; Meta's details usually arrive just before the callback.
          for (let i = 0; i < 20 && !result.current.phoneNumberId; i++) await new Promise(resolve => setTimeout(resolve, 250));
          const r = result.current;
          if (!r.phoneNumberId || !r.wabaId) {
            await report({ event: "error", message: "Meta did not return the number details" });
            setMessage({ kind: "error", text: "Meta didn't send the number details. Please go through every step in the Meta window and try again." });
            return;
          }
          const done = await api<{ ok: boolean; pending?: string }>("/whatsapp/embedded/complete", { method: "POST", body: JSON.stringify({ code: String(code), phoneNumberId: r.phoneNumberId, wabaId: r.wabaId, event: r.event }) });
          setMessage({ kind: "success", text: done.pending ? `Your number is connected. One step is still finishing: ${done.pending}` : "Your number is connected. Send a WhatsApp message to it from another phone to finish." });
        } catch (cause) {
          setMessage({ kind: "error", text: (cause as Error).message });
        } finally {
          setBusy("");
          onChanged();
        }
      },
      { config_id: config.configId, response_type: "code", override_default_response_type: true, extras: { setup: {} } },
    );
  };

  const checkAgain = async () => {
    setBusy("checking");
    setMessage(null);
    try {
      await api("/whatsapp/connection/check", { method: "POST", body: "{}" });
    } catch (cause) {
      setMessage({ kind: "error", text: (cause as Error).message });
    } finally {
      setBusy("");
      onChanged();
    }
  };

  const canConnect = available && !!config?.enabled;
  const customerActions = w.actions.filter(a => a.owner === "customer" && a.code !== "PUBLISH_FAQS");
  const ourActions = w.actions.filter(a => a.owner === "oceanbrown");

  return (
    <div className="connect">
      <div className={`state-banner ${WHATSAPP_TONE[w.state]}`}>
        <span className={`state-pill ${WHATSAPP_TONE[w.state]}`}>{WHATSAPP_LABEL[w.state]}</span>
        <div className="grow">
          <strong>{w.headline}</strong>
          <p>{w.detail}</p>
          {w.number && <p className="muted small">{w.name ? `${w.name} · ` : ""}{w.number}</p>}
        </div>
      </div>

      {hasConnection && <StatusChecks checks={w.checks} />}

      {(customerActions.length > 0 || ourActions.length > 0) && (
        <div className="next-actions">
          {customerActions.length > 0 && <><h3>What to do next</h3><ul>{customerActions.map(a => <li key={a.code}>{a.text}</li>)}</ul></>}
          {ourActions.length > 0 && <><h3>OceanBrown is handling</h3><ul>{ourActions.map(a => <li key={a.code}>{a.text}</li>)}</ul></>}
        </div>
      )}

      {!hasConnection && canConnect && (
        <div className="prereqs">
          <h3>Before you start (about 5 minutes)</h3>
          <ul>
            <li>A Facebook account. Meta will let you choose or create your business.</li>
            <li>The phone number you want customers to message, able to receive an SMS or call for a code.</li>
            <li>Use a number that isn't on WhatsApp yet. If Meta offers to connect your existing WhatsApp Business app, you can keep using the app (past chats are not imported).</li>
            <li>OceanBrown never sees your Facebook password.</li>
          </ul>
        </div>
      )}

      {!canConnect && w.state !== "LIVE" && !hasConnection && (
        <div className="notice">
          <strong>OceanBrown will connect your number for you.</strong> Online connection with Facebook isn't switched on for this service yet. Tell us the number and the best time to call, and we'll set it up with you.
        </div>
      )}

      {message && <p className={message.kind === "error" ? "error" : "success"} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>}

      <div className="actions">
        {canConnect && w.state !== "LIVE" && w.state !== "CONNECTED" && (
          <button className="btn" onClick={connect} disabled={!!busy}>{busy === "connecting" ? "Waiting for Meta…" : hasConnection ? "Reconnect with Facebook" : "Connect with Facebook"}</button>
        )}
        {hasConnection && <button className="btn secondary" onClick={checkAgain} disabled={!!busy}>{busy === "checking" ? "Checking…" : "Check again"}</button>}
        {(canConnect || hasConnection) && <button className="btn secondary" type="button" onClick={() => setShowHelp(v => !v)}>{showHelp ? "Hide help" : "Get help from OceanBrown"}</button>}
      </div>

      {(showHelp || (!canConnect && !hasConnection)) && <HelpRequest topic="WHATSAPP_SETUP" prompt="Which number should we connect, and anything we should know?" compact />}
    </div>
  );
}
