"use client";
import { useCallback, useEffect, useState } from "react";
import { Guard } from "../../components/Guard";
import { Shell } from "../../components/Shell";
import { api } from "../../lib/api";

type Status = "DRAFT" | "APPROVED" | "PUBLISHED";
type Source = { id: string; title: string; content: string; status: Status; version: number; updatedAt: string; templateKey?: string | null };
type Draft = { title: string; content: string; status: Status };

const LABEL: Record<Status, string> = { DRAFT: "Draft", APPROVED: "Approved", PUBLISHED: "Published" };
const PILL: Record<Status, string> = { DRAFT: "pill gray", APPROVED: "pill blue", PUBLISHED: "pill" };
const FILTERS = [["ALL", "All"], ["PUBLISHED", "Published"], ["DRAFT", "Drafts"], ["APPROVED", "Approved"]] as const;
/** Template text the owner still has to fill in, e.g. "[Add opening hours]". */
const needsFacts = (text: string) => /\[Add [^\]]+\]|\{\{\w+\}\}/.test(text);

/**
 * Knowledge: the only facts the AI assistant may use. Only Published answers are used in replies.
 * Owners can add, edit, publish, unpublish and delete answers here.
 */
export default function Knowledge() {
  const [rows, setRows] = useState<Source[]>();
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("ALL");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null); // row id, or "new"
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    api<Source[]>("/knowledge").then(setRows).catch(e => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const save = async (id: string | null, data: Partial<Draft>, done: string) => {
    setError(""); setNote("");
    try {
      if (id) await api(`/knowledge/${id}`, { method: "PATCH", body: JSON.stringify(data) });
      else await api("/knowledge", { method: "POST", body: JSON.stringify(data) });
      setNote(done);
      setEditing(null);
      load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const remove = async (row: Source) => {
    if (!confirm(`Delete "${row.title}"? The assistant will stop using it. This can't be undone.`)) return;
    setError(""); setNote("");
    try { await api(`/knowledge/${row.id}`, { method: "DELETE" }); setNote("Answer deleted."); load(); }
    catch (e) { setError((e as Error).message); }
  };

  const q = query.trim().toLowerCase();
  const shown = (rows ?? []).filter(r => (filter === "ALL" || r.status === filter) && (!q || r.title.toLowerCase().includes(q) || r.content.toLowerCase().includes(q)));
  const published = rows?.filter(r => r.status === "PUBLISHED").length ?? 0;
  const drafts = rows?.filter(r => r.status !== "PUBLISHED").length ?? 0;

  return (
    <Guard>
      <Shell title="Knowledge" subtitle="The facts your assistant may use. Only published answers are used in WhatsApp replies.">
        {rows && (
          <div className="notice">
            <strong>{published} published</strong>, {drafts} not published. The assistant only answers from published answers and never makes up prices, hours or policies. Check each draft, put in your real details, then publish it.
          </div>
        )}
        <div className="toolbar knowledge-toolbar">
          <input className="input" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search answers…" aria-label="Search answers" />
          <button className="btn" onClick={() => { setEditing("new"); setNote(""); }}>Add answer</button>
        </div>
        <div className="tabs" role="tablist" aria-label="Filter by status">
          {FILTERS.map(([key, label]) => <button key={key} role="tab" aria-selected={filter === key} className={filter === key ? "tab active" : "tab"} onClick={() => setFilter(key)}>{label}</button>)}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {note && <p className="success" role="status">{note}</p>}
        {editing === "new" && <Editor initial={{ title: "", content: "", status: "DRAFT" }} onCancel={() => setEditing(null)} onSave={d => save(null, d, d.status === "PUBLISHED" ? "Answer added and published." : "Answer added as a draft.")} />}
        <div className="knowledge-list">
          {!rows ? <div className="card empty">Loading…</div> : shown.length === 0 ? (
            <div className="card empty"><h2>{q || filter !== "ALL" ? "No matching answers" : "No answers yet"}</h2><p>{q || filter !== "ALL" ? "Try another search or filter." : "Add what customers usually ask: hours, location, prices, delivery."}</p></div>
          ) : shown.map(row => editing === row.id ? (
            <Editor key={row.id} initial={{ title: row.title, content: row.content, status: row.status }} onCancel={() => setEditing(null)} onSave={d => save(row.id, d, "Changes saved.")} />
          ) : (
            <article className="card knowledge-item" key={row.id}>
              <div className="knowledge-head">
                <h3>{row.title}</h3>
                <span className={PILL[row.status]}>{LABEL[row.status]}</span>
              </div>
              <p className="knowledge-content">{row.content}</p>
              {needsFacts(row.content) && <p className="small warn-text">Has details to fill in before it can be published.</p>}
              <p className="small muted">Version {row.version} · updated {new Date(row.updatedAt).toLocaleString()}</p>
              <div className="actions">
                <button className="btn secondary" onClick={() => { setEditing(row.id); setNote(""); }}>Edit</button>
                {row.status === "PUBLISHED"
                  ? <button className="btn secondary" onClick={() => save(row.id, { status: "DRAFT" }, `"${row.title}" unpublished. The assistant no longer uses it.`)}>Unpublish</button>
                  : <button className="btn" disabled={needsFacts(row.content)} title={needsFacts(row.content) ? "Fill in the missing details first" : undefined} onClick={() => save(row.id, { status: "PUBLISHED" }, `"${row.title}" published. The assistant can use it now.`)}>Publish</button>}
                <button className="btn secondary danger" onClick={() => remove(row)}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      </Shell>
    </Guard>
  );
}

function Editor({ initial, onSave, onCancel }: { initial: Draft; onSave: (d: Draft) => Promise<boolean>; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const missing = needsFacts(d.content);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await onSave({ title: d.title.trim(), content: d.content.trim(), status: d.status });
    setBusy(false);
  };
  return (
    <form className="card knowledge-editor" onSubmit={submit}>
      <label>Customer question or topic
        <input className="input" required minLength={2} maxLength={160} value={d.title} onChange={e => setD({ ...d, title: e.target.value })} placeholder="e.g. What are your opening hours?" />
      </label>
      <label>Approved answer
        <textarea className="input" required minLength={2} maxLength={50000} rows={6} value={d.content} onChange={e => setD({ ...d, content: e.target.value })} placeholder="Write the real facts, e.g. We are open Monday to Friday, 9:00 to 17:00, and Saturday 10:00 to 14:00." />
      </label>
      {missing && <p className="small warn-text">Replace the parts in [brackets] with your real details before publishing.</p>}
      <label>Status
        <select className="input" value={d.status} onChange={e => setD({ ...d, status: e.target.value as Status })}>
          <option value="DRAFT">Draft (not used by the assistant)</option>
          <option value="APPROVED">Approved (not used yet)</option>
          <option value="PUBLISHED" disabled={missing}>Published (used in replies)</option>
        </select>
      </label>
      <div className="actions">
        <button className="btn" disabled={busy || (missing && d.status === "PUBLISHED")}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
