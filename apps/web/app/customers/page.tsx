"use client";
import { useEffect, useMemo, useState } from "react";
import { Guard } from "../../components/Guard";
import { Shell } from "../../components/Shell";
import { api } from "../../lib/api";

type Customer = { id: string; name: string; phone: string; email?: string; consent: boolean; optedOutAt?: string; tags: string[] };
function csvRows(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const parse = (line: string) => { const values: string[] = []; let value = "", quoted = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"' && quoted && line[i + 1] === '"') { value += '"'; i++; } else if (c === '"') quoted = !quoted; else if (c === "," && !quoted) { values.push(value.trim()); value = ""; } else value += c; } values.push(value.trim()); return values; };
  const headerLine = lines[0];
  if (!headerLine) return [];
  const headers = parse(headerLine).map(value => value.toLowerCase());
  return lines.slice(1).map(line => Object.fromEntries(parse(line).map((value, index) => [headers[index] ?? `column${index}`, value])));
}

export default function Customers() {
  const [rows, setRows] = useState<Customer[]>([]), [query, setQuery] = useState(""), [showAdd, setShowAdd] = useState(false), [showImport, setShowImport] = useState(false), [csv, setCsv] = useState("name,phone,email,consent,tags\n"), [form, setForm] = useState({ name: "", phone: "+220", email: "", consent: false }), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const load = () => api<Customer[]>("/customers").then(setRows);
  useEffect(() => { load().catch(e => setError(e.message)); }, []);
  const filtered = useMemo(() => rows.filter(row => `${row.name} ${row.phone} ${row.email ?? ""} ${row.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase())), [rows, query]);
  const create = async (event: React.FormEvent) => { event.preventDefault(); setError(""); try { await api("/customers", { method: "POST", body: JSON.stringify(form) }); setForm({ name: "", phone: "+220", email: "", consent: false }); setShowAdd(false); await load(); } catch (e) { setError((e as Error).message); } };
  const importCsv = async (event: React.FormEvent) => { event.preventDefault(); setError(""); try { const customers = csvRows(csv).map(row => ({ name: row.name, phone: row.phone, email: row.email || undefined, consent: ["true", "yes", "1"].includes((row.consent || "").toLowerCase()), tags: (row.tags || "").split(/[;|]/).map((tag: string) => tag.trim()).filter(Boolean) })); const result = await api<any>("/customers/import", { method: "POST", body: JSON.stringify({ customers, updateExisting: true }) }); setNotice(`Imported ${result.created} new and updated ${result.updated} customers.`); setShowImport(false); await load(); } catch (e) { setError((e as Error).message); } };
  return <Guard><Shell title="Customers" subtitle="Profiles, consent, tags and campaign-ready contact imports."><div className="toolbar"><input className="input" placeholder="Search customers…" value={query} onChange={e => setQuery(e.target.value)} /><button className="btn" onClick={() => setShowAdd(value => !value)}>Add customer</button><button className="btn secondary" onClick={() => setShowImport(value => !value)}>Import CSV</button></div>
    {error && <p className="error">{error}</p>}{notice && <p className="success">{notice}</p>}
    {showAdd && <form className="card form-grid" onSubmit={create}><h2 style={{ gridColumn: "1/-1" }}>Add customer</h2><label>Name<input className="input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label><label>Phone in E.164 format<input className="input" required value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label><label>Email<input className="input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label><label><span>Marketing consent</span><input type="checkbox" checked={form.consent} onChange={e => setForm({ ...form, consent: e.target.checked })} /></label><button className="btn">Save customer</button></form>}
    {showImport && <form className="card" onSubmit={importCsv} style={{ marginBottom: 16 }}><h2>Import contacts</h2><p className="muted small">CSV columns: name, phone, email, consent and tags. Use semicolons between tags. Only mark consent when the customer explicitly agreed.</p><input type="file" accept=".csv,text/csv" onChange={async e => { const file = e.target.files?.[0]; if (file) setCsv(await file.text()); }} /><textarea className="input" rows={9} value={csv} onChange={e => setCsv(e.target.value)} style={{ margin: "12px 0" }} /><button className="btn">Validate and import</button></form>}
    <div className="card">{filtered.length ? <table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Tags</th><th>Consent</th><th>Status</th></tr></thead><tbody>{filtered.map(row => <tr key={row.id}><td>{row.name}</td><td>{row.phone}</td><td>{row.email || "—"}</td><td>{row.tags.join(", ") || "—"}</td><td>{row.consent ? "Yes" : "No"}</td><td><span className={row.optedOutAt ? "pill gray" : "pill"}>{row.optedOutAt ? "Opted out" : "Active"}</span></td></tr>)}</tbody></table> : <div className="empty">No customers found.</div>}</div>
  </Shell></Guard>;
}
