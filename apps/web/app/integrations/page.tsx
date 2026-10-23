"use client";
import { useCallback, useEffect, useState } from "react";
import { ConnectWhatsApp } from "../../components/ConnectWhatsApp";
import { Guard } from "../../components/Guard";
import { Shell } from "../../components/Shell";
import { api } from "../../lib/api";
import type { Onboarding } from "../../lib/onboarding";

type StaffConnection = { phoneNumberId?: string; wabaId?: string | null; displayPhone: string | null; hasAccessToken?: boolean; onboardingMethod?: string | null; lastError: string | null };
type ConnectionState = { connection: StaffConnection | null; liveEnabled: boolean; webhookUrl?: string; server?: { appSecret: boolean; verifyToken: boolean; encryptionKey: boolean } };

export default function Integrations() {
  const [status, setStatus] = useState<Onboarding>();
  const [conn, setConn] = useState<ConnectionState>();
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api<Onboarding>("/onboarding").then(setStatus).catch(e => setError(e.message));
    api<ConnectionState>("/whatsapp/connection").then(setConn).catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    api<{ user: { role: string } }>("/auth/me").then(r => setRole(r.user.role)).catch(() => undefined);
  }, [load]);
  const staff = role === "SUPER_ADMIN";
  const disconnect = async () => {
    if (!confirm("Disconnect this WhatsApp number? New customer messages will stop arriving until it is connected again.")) return;
    try { await api("/whatsapp/connection", { method: "DELETE" }); load(); } catch (e) { setError((e as Error).message); }
  };

  return (
    <Guard>
      <Shell title="WhatsApp connection" subtitle="Your business number and its status. OceanBrown looks after the technical setup.">
        {error && <p className="error" role="alert">{error}</p>}
        <div className="integration-layout">
          <div className="card">
            <h2>Your number</h2>
            {status ? <ConnectWhatsApp status={status} available={!!status.embeddedSignupAvailable} onChanged={load} /> : <div className="empty">Loading…</div>}
            {conn?.connection && (
              <div className="actions" style={{ marginTop: 16 }}>
                <button className="btn secondary" onClick={disconnect}>Disconnect this number</button>
              </div>
            )}
          </div>
          <div className="card">
            <h2>Good to know</h2>
            <ul className="plain-list">
              <li>Customers message your number as usual; conversations appear in the Inbox.</li>
              <li>You can reply freely within 24 hours of a customer's last message. After that, WhatsApp only allows approved templates.</li>
              <li>Meta may review your display name and, for higher limits, verify your business. We show these as they happen.</li>
              <li>Meta bills message charges to the payment method on your WhatsApp account. Add one in WhatsApp Manager if Meta asks.</li>
            </ul>
          </div>
        </div>
        {staff && conn && <StaffPanel conn={conn} onChanged={load} />}
      </Shell>
    </Guard>
  );
}

/** Technical connection details. Visible to OceanBrown staff only; customers never handle tokens or IDs. */
function StaffPanel({ conn, onChanged }: { conn: ConnectionState; onChanged: () => void }) {
  const c = conn.connection;
  const [form, setForm] = useState({ phoneNumberId: c?.phoneNumberId ?? "", wabaId: c?.wabaId ?? "", displayPhone: c?.displayPhone ?? "", accessToken: "" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setNote("");
    try { await fn(); setNote(ok); onChanged(); } catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  };
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, string> = { phoneNumberId: form.phoneNumberId.trim(), wabaId: form.wabaId.trim(), displayPhone: form.displayPhone.trim() };
    if (form.accessToken.trim()) body.accessToken = form.accessToken.trim();
    run(() => api("/whatsapp/connection", { method: "PUT", body: JSON.stringify(body) }), "Saved. Now run the connection test.").then(() => setForm(f => ({ ...f, accessToken: "" })));
  };
  return (
    <details className="card staff-panel">
      <summary><strong>OceanBrown staff: technical connection</strong> <span className="muted small">(not shown to customers)</span></summary>
      <form className="integration-form" onSubmit={save}>
        <label>Phone number ID<input className="input" required inputMode="numeric" value={form.phoneNumberId} onChange={e => setForm({ ...form, phoneNumberId: e.target.value })} /></label>
        <label>WhatsApp Business Account ID<input className="input" required inputMode="numeric" value={form.wabaId} onChange={e => setForm({ ...form, wabaId: e.target.value })} /></label>
        <label>Display phone<input className="input" value={form.displayPhone} onChange={e => setForm({ ...form, displayPhone: e.target.value })} /></label>
        <label>Access token<input className="input" type="password" autoComplete="off" value={form.accessToken} onChange={e => setForm({ ...form, accessToken: e.target.value })} placeholder={c?.hasAccessToken ? "Saved — leave blank to keep" : "System-user token"} /></label>
        <div className="actions integration-span">
          <button className="btn" disabled={busy}>Save</button>
          {c && <button type="button" className="btn secondary" disabled={busy} onClick={() => run(() => api("/whatsapp/connection/test", { method: "POST", body: "{}" }), "Ownership verified and connected.")}>Test connection</button>}
        </div>
      </form>
      {note && <p className="small">{note}</p>}
      <div className="statline"><span>Webhook URL</span><code>{conn.webhookUrl}</code></div>
      <div className="statline"><span>Connected by</span><span>{c?.onboardingMethod ?? "—"}</span></div>
      <div className="statline"><span>Server: app secret / verify token / encryption key / live delivery</span><span>{[conn.server?.appSecret, conn.server?.verifyToken, conn.server?.encryptionKey, conn.liveEnabled].map(v => (v ? "✓" : "✗")).join(" ")}</span></div>
    </details>
  );
}
