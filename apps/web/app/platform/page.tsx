"use client";
import { useCallback, useEffect, useState } from "react";
import { StatusChecks } from "../../components/ConnectWhatsApp";
import { Guard } from "../../components/Guard";
import { Shell } from "../../components/Shell";
import { api } from "../../lib/api";
import { WHATSAPP_LABEL, WHATSAPP_TONE, type Onboarding } from "../../lib/onboarding";

/**
 * Provider admin for OceanBrown staff. The API refuses every /platform route to anyone who is not
 * SUPER_ADMIN, and every change is written to the affected business's audit log.
 */

type Overview = { businesses: number; suspended: number; connectionsError: number; openHelp: number; failedWebhooks24h: number; unmatchedWebhooks24h: number; stuckOutbound: number; failedOnboardingAttempts7d: number };
type BusinessRow = {
  id: string; name: string; slug: string; industry: string | null; plan: string; planStatus: string; monthlyMessageLimit: number; createdAt: string; onboardingCompletedAt: string | null; automationEnabled: boolean;
  ownerEmail: string | null; whatsapp: { status: string; displayPhone: string | null; lastWebhookAt: string | null; lastError: string | null; ownershipVerifiedAt: string | null } | null;
  _count: { users: number; customers: number; campaigns: number; supportRequests: number };
};
type HelpRow = { id: string; topic: string; message: string; contactPhone: string | null; status: string; staffNote: string | null; createdAt: string; business?: { id: string; name: string } };
type Connection = { id: string; displayPhone: string | null; verifiedName: string | null; status: string; ownershipVerified: boolean; lastWebhookAt: string | null; lastError: string | null; lastCheckedAt: string | null; metaStatus: Record<string, unknown> | null; onboardingMethod: string | null; phoneNumberId?: string; wabaId?: string | null; hasAccessToken?: boolean; hasRegistrationPin?: boolean };
type Detail = {
  business: { id: string; name: string; slug: string; industry: string | null; plan: string; planStatus: string; suspendedReason: string | null; monthlyMessageLimit: number; createdAt: string; onboardingCompletedAt: string | null; automationEnabled: boolean };
  status: Onboarding; users: { id: string; name: string; email: string; role: string; active: boolean }[]; connection: Connection | null; helpRequests: HelpRow[];
  activity: { action: string; entityType: string; createdAt: string; metadata: unknown }[]; template: { industry: string; version: number } | null;
};
type Attempt = { at: string; business: { id: string; name: string } | null; action: string; details: unknown };
type TemplateRow = { key: string; label: string; sensitive: boolean; latestVersion: number; customVersions: number; installations: { version: number; businesses: number }[] };

const TABS = [["customers", "Customers"], ["help", "Help requests"], ["attempts", "Failed connections"], ["templates", "Industry templates"]] as const;
type Tab = (typeof TABS)[number][0];
const when = (v: string | null | undefined) => (v ? new Date(v).toLocaleString() : "—");

export default function Platform() {
  const [tab, setTab] = useState<Tab>("customers");
  const [overview, setOverview] = useState<Overview>();
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const loadOverview = useCallback(() => { api<Overview>("/platform/overview").then(setOverview).catch(e => setError(e.message)); }, []);
  useEffect(loadOverview, [loadOverview]);

  const cards: [string, number | undefined, boolean][] = [
    ["Customers", overview?.businesses, false],
    ["Open help requests", overview?.openHelp, (overview?.openHelp ?? 0) > 0],
    ["Connections with errors", overview?.connectionsError, (overview?.connectionsError ?? 0) > 0],
    ["Failed connection attempts (7 days)", overview?.failedOnboardingAttempts7d, false],
    ["Failed webhooks (24 h)", overview?.failedWebhooks24h, (overview?.failedWebhooks24h ?? 0) > 0],
    ["Unmatched webhooks (24 h)", overview?.unmatchedWebhooks24h, false],
    ["Replies stuck in queue", overview?.stuckOutbound, (overview?.stuckOutbound ?? 0) > 0],
    ["Suspended", overview?.suspended, false],
  ];

  return (
    <Guard>
      <Shell title="Provider admin" subtitle="OceanBrown staff only. Every change here is recorded in the customer's activity log.">
        {error && <p className="error" role="alert">{error}</p>}
        <div className="grid admin-metrics">
          {cards.map(([label, value, alert]) => (
            <div className={`card metric${alert ? " alert" : ""}`} key={label}>
              <span className="label">{label}</span>
              <strong>{value ?? "—"}</strong>
            </div>
          ))}
        </div>
        <div className="tabs" role="tablist">
          {TABS.map(([key, label]) => (
            <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "tab active" : "tab"} onClick={() => { setTab(key); setSelected(null); }}>{label}</button>
          ))}
        </div>
        {tab === "customers" && (selected ? <BusinessDetail id={selected} onBack={() => setSelected(null)} onChanged={loadOverview} /> : <Customers onOpen={setSelected} />)}
        {tab === "help" && <HelpQueue onChanged={loadOverview} />}
        {tab === "attempts" && <Attempts />}
        {tab === "templates" && <Templates />}
      </Shell>
    </Guard>
  );
}

function Customers({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<BusinessRow[]>();
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { api<BusinessRow[]>("/platform/businesses").then(setRows).catch(e => setError(e.message)); }, []);
  const needle = q.trim().toLowerCase();
  const shown = (rows ?? []).filter(r => !needle || [r.name, r.slug, r.ownerEmail, r.whatsapp?.displayPhone].some(v => v?.toLowerCase().includes(needle)));
  const wa = (r: BusinessRow) => {
    if (!r.whatsapp) return ["Not connected", "neutral"];
    if (r.whatsapp.status === "ERROR") return ["Needs attention", "bad"];
    if (r.whatsapp.status === "CONNECTED" && r.whatsapp.lastWebhookAt) return ["Receiving", "good"];
    if (r.whatsapp.status === "CONNECTED") return ["Connected", "warn"];
    return [r.whatsapp.status.toLowerCase(), "warn"];
  };
  return (
    <div className="card">
      {error && <p className="error">{error}</p>}
      <input className="input" type="search" placeholder="Search by business, email or number" value={q} onChange={e => setQ(e.target.value)} aria-label="Search customers" />
      {!rows ? <div className="empty">Loading…</div> : shown.length === 0 ? <div className="empty">No customers found.</div> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Business</th><th>Setup</th><th>WhatsApp</th><th>Plan</th><th>Help</th><th>Joined</th></tr></thead>
            <tbody>
              {shown.map(r => {
                const [label, tone] = wa(r);
                return (
                  <tr key={r.id} className="clickable" onClick={() => onOpen(r.id)}>
                    <td><button className="link-button" onClick={() => onOpen(r.id)}><strong>{r.name}</strong></button><br /><span className="muted small">{r.ownerEmail ?? r.slug}</span></td>
                    <td>{r.onboardingCompletedAt ? <span className="pill">Done</span> : <span className="pill gray">In progress</span>}</td>
                    <td><span className={`state-pill ${tone}`}>{label}</span>{r.whatsapp?.displayPhone && <><br /><span className="muted small">{r.whatsapp.displayPhone}</span></>}</td>
                    <td>{r.plan}{r.planStatus !== "ACTIVE" && <><br /><span className="pill red">{r.planStatus}</span></>}</td>
                    <td>{r._count.supportRequests > 0 ? <span className="pill blue">{r._count.supportRequests} open</span> : "—"}</td>
                    <td className="small">{new Date(r.createdAt).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BusinessDetail({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail>();
  const [note, setNote] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Detail>(`/platform/businesses/${id}`).then(setD).catch(e => setNote({ kind: "error", text: e.message })); }, [id]);
  useEffect(load, [load]);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setNote(null);
    try { await fn(); setNote({ kind: "success", text: ok }); load(); onChanged(); }
    catch (e) { setNote({ kind: "error", text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  if (!d) return <div className="card"><button className="btn secondary" onClick={onBack}>← All customers</button>{note && <p className="error">{note.text}</p>}<div className="empty">Loading…</div></div>;
  const b = d.business;
  const w = d.status.whatsapp;
  const post = (path: string, body: unknown = {}) => api(`/platform/businesses/${id}${path}`, { method: "POST", body: JSON.stringify(body) });
  const suspend = () => {
    const reason = prompt("Why is this workspace being suspended? The owner will see this reason.");
    if (reason && reason.trim().length >= 3) run(() => post("/suspend", { reason: reason.trim() }), "Workspace suspended. Automatic replies and sending are stopped.");
  };

  return (
    <>
      <div className="actions" style={{ marginBottom: 12 }}><button className="btn secondary" onClick={onBack}>← All customers</button></div>
      {note && <p className={note.kind} role={note.kind === "error" ? "alert" : "status"}>{note.text}</p>}
      <div className="split">
        <div className="card">
          <h2>{b.name}</h2>
          <div className="statline"><span>Industry</span><strong>{d.status.business.industryLabel ?? "Not chosen"}{d.template ? ` · template v${d.template.version}` : ""}</strong></div>
          <div className="statline"><span>Setup</span><strong>{b.onboardingCompletedAt ? `Completed ${when(b.onboardingCompletedAt)}` : `Step: ${d.status.currentStep}`}</strong></div>
          <div className="statline"><span>Published answers / drafts</span><strong>{d.status.business.publishedFaqs} / {d.status.business.draftFaqs}</strong></div>
          <div className="statline"><span>AI replies</span><strong>{b.automationEnabled ? "On" : "Off"}</strong></div>
          <div className="statline"><span>Workspace</span><strong>{b.planStatus}{b.suspendedReason ? ` — ${b.suspendedReason}` : ""}</strong></div>
          <label className="search-label">Plan
            <select className="input" value={b.plan} disabled={busy} onChange={e => run(() => api(`/platform/businesses/${id}/plan`, { method: "PATCH", body: JSON.stringify({ plan: e.target.value }) }), "Plan updated.")}>
              {["FREE", "STARTER", "GROWTH", "PRO"].map(p => <option key={p}>{p}</option>)}
            </select>
          </label>
          <p className="muted small">Message limit {b.monthlyMessageLimit.toLocaleString()} per month. Prices are not set here.</p>
          <div className="actions">
            {b.planStatus === "ACTIVE"
              ? <button className="btn secondary danger" disabled={busy} onClick={suspend}>Suspend workspace</button>
              : <button className="btn" disabled={busy} onClick={() => run(() => post("/reactivate"), "Workspace reactivated.")}>Reactivate</button>}
          </div>
          <h3>Team</h3>
          <ul className="plain-list">{d.users.map(u => <li key={u.id}>{u.name} · {u.email} · {u.role}{u.active ? "" : " (inactive)"}</li>)}</ul>
        </div>
        <div className="card">
          <h2>WhatsApp</h2>
          <div className={`state-banner ${WHATSAPP_TONE[w.state]}`}>
            <span className={`state-pill ${WHATSAPP_TONE[w.state]}`}>{WHATSAPP_LABEL[w.state]}</span>
            <div className="grow"><strong>{w.headline}</strong><p>{w.detail}</p></div>
          </div>
          <StatusChecks checks={w.checks} />
          {w.actions.length > 0 && <ul className="plain-list">{w.actions.map(a => <li key={a.code}><strong>{a.owner === "oceanbrown" ? "OceanBrown" : "Customer"}:</strong> {a.text}</li>)}</ul>}
          {d.connection && (
            <>
              <div className="statline"><span>Phone number ID</span><code>{d.connection.phoneNumberId}</code></div>
              <div className="statline"><span>WABA ID</span><code>{d.connection.wabaId ?? "—"}</code></div>
              <div className="statline"><span>Connected by</span><span>{d.connection.onboardingMethod ?? "—"}</span></div>
              <div className="statline"><span>Token / registration PIN</span><span>{d.connection.hasAccessToken ? "✓" : "✗"} / {d.connection.hasRegistrationPin ? "✓" : "✗"}</span></div>
              <div className="statline"><span>Last checked / last webhook</span><span className="small">{when(d.connection.lastCheckedAt)} / {when(d.connection.lastWebhookAt)}</span></div>
              {d.connection.lastError && <p className="error">{d.connection.lastError}</p>}
              <div className="actions">
                <button className="btn secondary" disabled={busy} onClick={() => run(() => post("/whatsapp/check"), "Status refreshed from Meta.")}>Check with Meta</button>
                <button className="btn secondary" disabled={busy} onClick={() => run(() => post("/whatsapp/test"), "Ownership verified and connected.")}>Test connection</button>
                <button className="btn secondary" disabled={busy} onClick={() => run(() => post("/whatsapp/register"), "Number registered with the Cloud API.")}>Register number</button>
              </div>
            </>
          )}
          <AssistedSetup id={id} connection={d.connection} busy={busy} run={run} />
        </div>
      </div>
      <div className="split">
        <div className="card">
          <h2>Help requests</h2>
          {d.helpRequests.length === 0 ? <p className="muted">None.</p> : d.helpRequests.map(h => <HelpItem key={h.id} row={h} onChanged={() => { load(); onChanged(); }} />)}
        </div>
        <div className="card">
          <h2>Activity</h2>
          <ul className="activity">
            {d.activity.map((a, i) => <li key={i}><span className="small muted">{when(a.createdAt)}</span> <code>{a.action}</code></li>)}
          </ul>
        </div>
      </div>
    </>
  );
}

/** Staff-only fallback when the customer can't use Embedded Signup. The token is write-only. */
function AssistedSetup({ id, connection, busy, run }: { id: string; connection: Connection | null; busy: boolean; run: (fn: () => Promise<unknown>, ok: string) => void }) {
  const [form, setForm] = useState({ phoneNumberId: connection?.phoneNumberId ?? "", wabaId: connection?.wabaId ?? "", displayPhone: connection?.displayPhone ?? "", accessToken: "" });
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, string> = { phoneNumberId: form.phoneNumberId.trim(), wabaId: form.wabaId.trim(), displayPhone: form.displayPhone.trim() };
    if (form.accessToken.trim()) body.accessToken = form.accessToken.trim();
    setForm(f => ({ ...f, accessToken: "" }));
    run(() => api(`/platform/businesses/${id}/whatsapp`, { method: "PUT", body: JSON.stringify(body) }), "Saved. Run “Test connection” next — it stays unverified until Meta confirms the number belongs to this account.");
  };
  return (
    <details className="staff-panel">
      <summary><strong>Assisted setup</strong> <span className="muted small">(enter details from the customer's Meta account)</span></summary>
      <form className="integration-form" onSubmit={save}>
        <label>Phone number ID<input className="input" required inputMode="numeric" value={form.phoneNumberId} onChange={e => setForm({ ...form, phoneNumberId: e.target.value })} /></label>
        <label>WhatsApp Business Account ID<input className="input" required inputMode="numeric" value={form.wabaId} onChange={e => setForm({ ...form, wabaId: e.target.value })} /></label>
        <label>Display phone<input className="input" value={form.displayPhone} onChange={e => setForm({ ...form, displayPhone: e.target.value })} /></label>
        <label>Access token<input className="input" type="password" autoComplete="off" value={form.accessToken} onChange={e => setForm({ ...form, accessToken: e.target.value })} placeholder={connection?.hasAccessToken ? "Saved — leave blank to keep" : "System-user token"} /></label>
        <div className="actions integration-span"><button className="btn" disabled={busy}>Save</button></div>
      </form>
    </details>
  );
}

function HelpItem({ row, onChanged }: { row: HelpRow; onChanged: () => void }) {
  const [staffNote, setStaffNote] = useState(row.staffNote ?? "");
  const [error, setError] = useState("");
  const update = async (status: string) => {
    setError("");
    try { await api(`/platform/support-requests/${row.id}`, { method: "PATCH", body: JSON.stringify({ status, staffNote }) }); onChanged(); }
    catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="help-item">
      <div className="row">
        <div className="grow">
          <strong>{row.business ? `${row.business.name} · ` : ""}{row.topic.replace("_", " ").toLowerCase()}</strong>
          <p>{row.message}</p>
          <p className="small muted">{when(row.createdAt)}{row.contactPhone ? ` · call ${row.contactPhone}` : ""}</p>
        </div>
        <span className={row.status === "RESOLVED" ? "pill" : "pill blue"}>{row.status.replace("_", " ")}</span>
      </div>
      <label className="small">Note to the customer<textarea className="input" rows={2} maxLength={2000} value={staffNote} onChange={e => setStaffNote(e.target.value)} /></label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        {row.status !== "IN_PROGRESS" && row.status !== "RESOLVED" && <button className="btn secondary" onClick={() => update("IN_PROGRESS")}>Start</button>}
        {row.status !== "RESOLVED" ? <button className="btn" onClick={() => update("RESOLVED")}>Resolve</button> : <button className="btn secondary" onClick={() => update("OPEN")}>Reopen</button>}
      </div>
    </div>
  );
}

function HelpQueue({ onChanged }: { onChanged: () => void }) {
  const [filter, setFilter] = useState("");
  const [rows, setRows] = useState<HelpRow[]>();
  const load = useCallback(() => { api<HelpRow[]>(`/platform/support-requests${filter ? `?status=${filter}` : ""}`).then(setRows).catch(() => setRows([])); }, [filter]);
  useEffect(load, [load]);
  return (
    <div className="card">
      <label className="search-label">Show
        <select className="input" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="">Not yet resolved</option><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="RESOLVED">Resolved</option>
        </select>
      </label>
      {!rows ? <div className="empty">Loading…</div> : rows.length === 0 ? <div className="empty">Nothing here.</div> : rows.map(r => <HelpItem key={r.id} row={r} onChanged={() => { load(); onChanged(); }} />)}
    </div>
  );
}

function Attempts() {
  const [rows, setRows] = useState<Attempt[]>();
  useEffect(() => { api<Attempt[]>("/platform/onboarding-attempts").then(setRows).catch(() => setRows([])); }, []);
  const describe = (d: unknown) => {
    const x = (d ?? {}) as Record<string, unknown>;
    return [x.step && `at step ${x.step}`, x.code && `code ${x.code}`, x.kind, x.message ?? x.reason].filter(Boolean).join(" · ") || "—";
  };
  return (
    <div className="card">
      <p className="muted small">Abandoned or failed “Connect with Facebook” attempts in the last 30 days. Reach out to these customers and offer assisted setup.</p>
      {!rows ? <div className="empty">Loading…</div> : rows.length === 0 ? <div className="empty">No failed attempts.</div> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>When</th><th>Business</th><th>What happened</th><th>Details</th></tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}><td className="small">{when(r.at)}</td><td>{r.business?.name ?? "—"}</td><td>{r.action.endsWith("cancelled") ? "Closed Meta window" : "Error"}</td><td className="small">{describe(r.details)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Templates() {
  const [rows, setRows] = useState<TemplateRow[]>();
  const [editing, setEditing] = useState<string | null>(null);
  const load = useCallback(() => { api<TemplateRow[]>("/platform/templates").then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  if (editing) return <TemplateEditor id={editing} onClose={() => { setEditing(null); load(); }} />;
  return (
    <div className="card">
      <p className="muted small">Publishing a new version never changes a customer's answers. Each owner sees the update in Settings and chooses what to accept; answers they edited are always kept.</p>
      {!rows ? <div className="empty">Loading…</div> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Industry</th><th>Latest</th><th>In use</th><th></th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.key}>
                <td><strong>{r.label}</strong>{r.sensitive && <> <span className="pill red">Sensitive — never auto-published</span></>}</td>
                <td>v{r.latestVersion}{r.customVersions ? "" : <span className="muted small"> (built-in)</span>}</td>
                <td className="small">{r.installations.length ? r.installations.map(i => `v${i.version}: ${i.businesses}`).join(", ") : "—"}</td>
                <td><button className="btn secondary" onClick={() => setEditing(r.key)}>Edit</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TemplateEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [history, setHistory] = useState<{ version: number; notes: string | null; createdAt: string }[]>([]);
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  useEffect(() => {
    api<{ template: { version: number } & Record<string, unknown>; history: typeof history }>(`/platform/templates/${id}`)
      .then(r => { setVersion(r.template.version); setHistory(r.history); const { key: _k, version: _v, ...rest } = r.template; setText(JSON.stringify(rest, null, 2)); })
      .catch(e => setMsg({ kind: "error", text: e.message }));
  }, [id]);
  const publish = async () => {
    setMsg(null);
    let definition: unknown;
    try { definition = JSON.parse(text); } catch { setMsg({ kind: "error", text: "That isn't valid JSON." }); return; }
    try {
      const r = await api<{ version: number }>(`/platform/templates/${id}`, { method: "POST", body: JSON.stringify({ definition, notes: notes || undefined }) });
      setMsg({ kind: "success", text: `Published version ${r.version}.` });
      setVersion(r.version);
    } catch (e) {
      const err = e as Error & { details?: string[] };
      setMsg({ kind: "error", text: err.details?.join("; ") ?? err.message });
    }
  };
  return (
    <div className="card">
      <div className="actions"><button className="btn secondary" onClick={onClose}>← All templates</button></div>
      <h2>{id} · current v{version}</h2>
      <p className="muted small">Use <code>{"{{fieldKey}}"}</code> for facts the owner fills in. An answer is published only when every placeholder in it is filled and the industry is not sensitive; otherwise it is saved as a draft.</p>
      <textarea className="input code-editor" rows={24} spellCheck={false} value={text} onChange={e => setText(e.target.value)} aria-label="Template definition (JSON)" />
      <label>What changed (shown in history)<input className="input" maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} /></label>
      {msg && <p className={msg.kind} role={msg.kind === "error" ? "alert" : "status"}>{msg.text}</p>}
      <div className="actions"><button className="btn" onClick={publish}>Publish as v{version + 1}</button></div>
      {history.length > 0 && (<><h3>History</h3><ul className="plain-list">{history.map(h => <li key={h.version}>v{h.version} · {when(h.createdAt)}{h.notes ? ` — ${h.notes}` : ""}</li>)}</ul></>)}
    </div>
  );
}
