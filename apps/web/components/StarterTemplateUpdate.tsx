"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

type Faq = { key: string; title: string; content: string; status: string; missing?: string[]; id?: string };
type Update = { industry: string | null; label?: string; installedVersion?: number; latestVersion?: number; plan?: { additions: Faq[]; replacements: Faq[]; keptCustomised: { id: string; key: string; title: string }[] } };

/**
 * Owner-controlled updates to the industry starter. Nothing changes until the owner picks what to accept;
 * new answers arrive as drafts and answers the owner edited are never overwritten.
 */
export function StarterTemplateUpdate() {
  const [u, setU] = useState<Update>();
  const [add, setAdd] = useState<string[]>([]);
  const [replace, setReplace] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api<Update>("/templates/starter").then(r => { setU(r); setAdd(r.plan?.additions.map(f => f.key) ?? []); setReplace(r.plan?.replacements.map(f => f.key) ?? []); }).catch(() => undefined);
  }, []);
  useEffect(load, [load]);
  if (!u?.industry || !u.plan) return null;
  const hasUpdate = (u.latestVersion ?? 0) > (u.installedVersion ?? 0) && (u.plan.additions.length > 0 || u.plan.replacements.length > 0);
  const toggle = (list: string[], set: (v: string[]) => void, key: string) => set(list.includes(key) ? list.filter(k => k !== key) : [...list, key]);
  const apply = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ added: number; replaced: number; version: number }>("/templates/starter/apply", { method: "POST", body: JSON.stringify({ add, replace }) });
      setMsg({ kind: "success", text: `Updated to version ${r.version}: ${r.added} new draft answer(s), ${r.replaced} answer(s) refreshed. Review drafts in Knowledge before publishing.` });
      load();
    } catch (e) { setMsg({ kind: "error", text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  return (
    <div className="card">
      <h2>Industry starter: {u.label}</h2>
      <p className="muted small">You're on version {u.installedVersion}{hasUpdate ? `. Version ${u.latestVersion} is available.` : " — up to date."}</p>
      {msg && <p className={msg.kind} role={msg.kind === "error" ? "alert" : "status"}>{msg.text}</p>}
      {hasUpdate && (
        <>
          {u.plan.additions.length > 0 && <><h3>New answers (added as drafts)</h3>{u.plan.additions.map(f => (
            <label className="row" key={f.key}><input type="checkbox" checked={add.includes(f.key)} onChange={() => toggle(add, setAdd, f.key)} /><span className="grow"><strong>{f.title}</strong><p>{f.content}</p></span></label>
          ))}</>}
          {u.plan.replacements.length > 0 && <><h3>Improved wording for answers you haven't changed</h3>{u.plan.replacements.map(f => (
            <label className="row" key={f.key}><input type="checkbox" checked={replace.includes(f.key)} onChange={() => toggle(replace, setReplace, f.key)} /><span className="grow"><strong>{f.title}</strong><p>{f.content}</p></span></label>
          ))}</>}
          {u.plan.keptCustomised.length > 0 && <p className="muted small">Kept as you wrote them: {u.plan.keptCustomised.map(k => k.title).join(", ")}.</p>}
          <div className="actions"><button className="btn" disabled={busy || (add.length === 0 && replace.length === 0)} onClick={apply}>{busy ? "Updating…" : "Apply selected"}</button></div>
        </>
      )}
    </div>
  );
}
