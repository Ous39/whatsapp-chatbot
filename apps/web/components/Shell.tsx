"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3, Bot, Building2, CalendarDays, Contact, CreditCard, LayoutDashboard,
  ListChecks, LogOut, Menu, MessageCircle, Moon, Plug, Settings, ShieldCheck,
  Sun, Ticket, Users, Workflow, X, BookOpen, Megaphone
} from "lucide-react";
import { api } from "../lib/api";

const items = [
  ["Workspace", [["/", "Overview", LayoutDashboard], ["/onboarding", "Setup guide", ListChecks], ["/inbox", "Inbox", MessageCircle], ["/customers", "Customers", Users], ["/leads", "Leads", Contact], ["/bookings", "Bookings", CalendarDays], ["/tickets", "Support tickets", Ticket]]],
  ["Agent", [["/knowledge", "Knowledge", BookOpen], ["/agent", "Agent & playground", Bot], ["/automations", "Automations", Workflow], ["/campaigns", "Campaigns", Megaphone]]],
  ["Manage", [["/team", "Team & permissions", ShieldCheck], ["/integrations", "Integrations", Plug], ["/analytics", "Analytics", BarChart3], ["/billing", "Plan & usage", CreditCard], ["/settings", "Settings", Settings]]]
] as const;

export function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  const path = usePathname();
  const [dark, setDark] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [health, setHealth] = useState<{ liveWhatsApp?: boolean; aiProvider?: string }>({});
  const [role, setRole] = useState("");

  useEffect(() => {
    const value = localStorage.getItem("ob_theme") === "dark";
    setDark(value);
    document.documentElement.dataset.theme = value ? "dark" : "light";
  }, []);

  useEffect(() => {
    setNavOpen(false);
  }, [path]);

  useEffect(() => {
    api<{ liveWhatsApp: boolean; aiProvider: string }>("/health").then(setHealth).catch(() => {});
    api<{ user: { role: string } }>("/auth/me").then(result => setRole(result.user.role)).catch(() => {});
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem("ob_theme", next ? "dark" : "light");
    document.documentElement.dataset.theme = next ? "dark" : "light";
  };

  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    location.href = "/";
  };

  return <div className="shell">
    <header className="mobile-bar">
      <div className="logo"><span className="mark">O</span>OceanBrown</div>
      <button className="mobile-menu-button" type="button" aria-label={navOpen ? "Close navigation" : "Open navigation"} aria-expanded={navOpen} onClick={() => setNavOpen(value => !value)}>
        {navOpen ? <X size={20} /> : <Menu size={20} />}<span>Menu</span>
      </button>
    </header>

    <aside className={navOpen ? "sidebar open" : "sidebar"}>
      <div className="logo desktop-logo"><span className="mark">O</span>OceanBrown</div>
      <nav className="nav" aria-label="Workspace navigation">
        {items.map(([group, links]) => <div key={group} style={{ display: "contents" }}>
          <div className="group">{group}</div>
          {links.map(([href, label, Icon]) => <Link className={path === href ? "active" : ""} href={href} key={href}><Icon size={17} />{label}</Link>)}
        </div>)}
        {role === "SUPER_ADMIN" && <>
          <div className="group">Platform</div>
          <Link className={path === "/platform" ? "active" : ""} href="/platform"><Building2 size={17} />Businesses & plans</Link>
        </>}
      </nav>
      <div className="sidebar-actions">
        <button onClick={toggleTheme}>{dark ? <Sun size={16} /> : <Moon size={16} />} {dark ? "Light mode" : "Dark mode"}</button>
        <button onClick={logout}><LogOut size={16} /> Sign out</button>
      </div>
    </aside>

    {navOpen && <button className="nav-backdrop" type="button" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}

    <main className="main">
      <header className="top">
        <div><h1>{title}</h1><p>{subtitle}</p></div>
        <span className="badge"><span className="dot" style={health.liveWhatsApp ? { background: "var(--green)" } : undefined} />{health.liveWhatsApp ? "WHATSAPP LIVE" : "WHATSAPP OFF"} · AI: {(health.aiProvider ?? "simulator").toUpperCase()}</span>
      </header>
      {children}
    </main>
  </div>;
}
