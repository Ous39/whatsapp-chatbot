"use client";
import { useCallback, useEffect, useState } from "react";
import { Guard } from "../../components/Guard";
import { HelpRequest } from "../../components/HelpRequest";
import { Shell } from "../../components/Shell";
import { api } from "../../lib/api";

type Request = { id: string; topic: string; message: string; status: string; staffNote: string | null; createdAt: string; resolvedAt: string | null };
const TOPICS = [["WHATSAPP_SETUP", "WhatsApp connection"], ["TEMPLATES", "Answers and templates"], ["BILLING", "Plan and billing"], ["OTHER", "Something else"]] as const;
const STATUS: Record<string, string> = { OPEN: "Received", IN_PROGRESS: "In progress", RESOLVED: "Resolved" };

export default function Help() {
  const [rows, setRows] = useState<Request[]>([]);
  const [topic, setTopic] = useState<(typeof TOPICS)[number][0]>("OTHER");
  const [formKey, setFormKey] = useState(0);
  const load = useCallback(() => { api<Request[]>("/support-requests").then(setRows).catch(() => undefined); }, []);
  useEffect(load, [load]);
  return (
    <Guard>
      <Shell title="Help and support" subtitle="Ask OceanBrown anything — we handle the technical side for you.">
        <div className="split">
          <div className="card">
            <h2>Ask for help</h2>
            <label className="search-label">
              Topic
              <select className="input" value={topic} onChange={e => { setTopic(e.target.value as typeof topic); setFormKey(k => k + 1); }}>
                {TOPICS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <HelpRequest key={formKey} topic={topic} onSent={load} />
          </div>
          <div className="card">
            <h2>Your requests</h2>
            {rows.length === 0 ? <p className="muted">No requests yet.</p> : rows.map(r => (
              <div className="row" key={r.id}>
                <div className="grow">
                  <strong>{TOPICS.find(t => t[0] === r.topic)?.[1] ?? r.topic}</strong>
                  <p>{r.message}</p>
                  {r.staffNote && <p><em>OceanBrown: {r.staffNote}</em></p>}
                  <p className="small muted">{new Date(r.createdAt).toLocaleString()}</p>
                </div>
                <span className={r.status === "RESOLVED" ? "pill" : "pill blue"}>{STATUS[r.status] ?? r.status}</span>
              </div>
            ))}
          </div>
        </div>
      </Shell>
    </Guard>
  );
}
