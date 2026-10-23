"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusChecks } from "../components/ConnectWhatsApp";
import { Guard } from "../components/Guard";
import { Shell } from "../components/Shell";
import { api } from "../lib/api";
import { WHATSAPP_LABEL, type Onboarding } from "../lib/onboarding";

type Overview = { customers: number; openConversations: number; activeLeads: number; upcomingBookings: number; messages: number };

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

export default function Home() {
  const [d, setD] = useState<Overview>();
  const [s, setS] = useState<Onboarding>();
  const [title, setTitle] = useState("Welcome");
  useEffect(() => {
    setTitle(greeting());
    api<Overview>("/overview").then(setD).catch(() => {});
    api<Onboarding>("/onboarding").then(setS).catch(() => {});
  }, []);
  const metrics: [string, number | undefined, string][] = [
    ["Open conversations", d?.openConversations, "/inbox"],
    ["Customers", d?.customers, "/customers"],
    ["Active leads", d?.activeLeads, "/leads"],
    ["Upcoming bookings", d?.upcomingBookings, "/bookings"],
  ];
  return (
    <Guard>
      <Shell title={title} subtitle="Here's what's happening across your customer conversations.">
        <div className="grid">
          {metrics.map(([label, value, href]) => (
            <Link className="card metric" href={href} key={label}>
              <span className="label">{label}</span>
              <strong>{value ?? "—"}</strong>
              <small>Open {label.toLowerCase()}</small>
            </Link>
          ))}
        </div>
        {s && (
          <div className="split">
            <div className="card">
              <h2>WhatsApp: {WHATSAPP_LABEL[s.whatsapp.state]}</h2>
              <p className="muted">{s.whatsapp.detail}</p>
              <StatusChecks checks={s.whatsapp.checks} />
              {!s.live && <Link className="btn" href="/onboarding">Continue setup</Link>}
            </div>
            <div className="card">
              <h2>Your assistant</h2>
              <div className="statline"><span>Industry starter</span><strong>{s.business.industryLabel ?? "Not chosen yet"}</strong></div>
              <div className="statline"><span>Published answers</span><strong>{s.business.publishedFaqs}</strong></div>
              <div className="statline"><span>Drafts to complete</span><strong>{s.business.draftFaqs}</strong></div>
              <div className="statline"><span>AI replies</span><strong>{s.business.aiEnabled ? "On" : "Off"}</strong></div>
              <div className="actions" style={{ marginTop: 14 }}>
                <Link className="btn secondary" href="/knowledge">Edit answers</Link>
                <Link className="btn secondary" href="/agent">Test the assistant</Link>
              </div>
            </div>
          </div>
        )}
      </Shell>
    </Guard>
  );
}
