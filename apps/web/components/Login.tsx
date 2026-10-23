"use client";
import { useState } from "react";
import { api } from "../lib/api";

type Mode = "login" | "register" | "forgot" | "reset";

export function Login({ onDone }: { onDone: () => void }) {
  const demo = process.env.NODE_ENV === "development";
  const [mode, setMode] = useState<Mode>("login");
  const [form, setForm] = useState<Record<string, string>>({ email: demo ? "owner@oceanbrown.local" : "", password: demo ? "OceanBrown123!" : "" });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const set = (name: string, value: string) => setForm(current => ({ ...current, [name]: value }));
  const switchMode = (next: Mode) => { setMode(next); setError(""); setMessage(""); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(""); setMessage("");
    try {
      if (mode === "login") {
        await api("/auth/login", { method: "POST", body: JSON.stringify({ email: form.email, password: form.password }) });
        return onDone();
      }
      if (mode === "register") {
        await api("/auth/register", { method: "POST", body: JSON.stringify({ name: form.name, email: form.email, password: form.password, businessName: form.businessName }) });
        // New workspaces go straight to the three-step setup.
        location.href = "/onboarding";
        return;
      }
      if (mode === "forgot") {
        const result = await api<{ message: string; resetToken?: string }>("/auth/password/forgot", { method: "POST", body: JSON.stringify({ email: form.email }) });
        setMessage(result.message);
        if (result.resetToken) { set("token", result.resetToken); setMode("reset"); }
        return;
      }
      await api("/auth/password/reset", { method: "POST", body: JSON.stringify({ token: form.token, password: form.password }) });
      setMessage("Password updated. You can now sign in."); setMode("login"); set("password", "");
    } catch (cause) { setError((cause as Error).message); }
  };
  const title = mode === "login" ? "Welcome back" : mode === "register" ? "Create your free workspace" : mode === "forgot" ? "Reset your password" : "Choose a new password";
  return <div className="auth-wrap"><div className="card auth-card"><div className="logo" style={{ color: "var(--ink)", marginLeft: 0 }}><span className="mark">O</span>OceanBrown</div><h2>{title}</h2>
    <p className="muted">{mode === "register" ? "Four details now. Next you'll connect WhatsApp and tell us about your business." : mode === "login" ? "Sign in to your business workspace." : "Use a secure, time-limited reset link."}</p>
    <form onSubmit={submit} className="auth-form">
      {mode === "register" && <><label>Full name<input className="input" required value={form.name ?? ""} onChange={e => set("name", e.target.value)} /></label><label>Business name<input className="input" required value={form.businessName ?? ""} onChange={e => set("businessName", e.target.value)} /></label></>}
      {mode !== "reset" && <label>Email<input className="input" type="email" autoComplete="username" required value={form.email ?? ""} onChange={e => set("email", e.target.value)} /></label>}
      {mode === "reset" && <label>Reset token<input className="input" required value={form.token ?? ""} onChange={e => set("token", e.target.value)} /></label>}
      {(mode === "login" || mode === "register" || mode === "reset") && <label>Password<input className="input" type="password" minLength={mode === "login" ? 1 : 10} autoComplete={mode === "login" ? "current-password" : "new-password"} required value={form.password ?? ""} onChange={e => set("password", e.target.value)} /></label>}
      {error && <p className="error">{error}</p>}{message && <p className="success">{message}</p>}
      <button className="btn" style={{ width: "100%" }}>{mode === "login" ? "Sign in" : mode === "register" ? "Create free account" : mode === "forgot" ? "Request reset" : "Update password"}</button>
    </form>
    <div className="auth-links">{mode === "login" ? <><button onClick={() => switchMode("forgot")}>Forgot password?</button><button onClick={() => switchMode("register")}>Create an account</button></> : <button onClick={() => switchMode("login")}>Back to sign in</button>}</div>
    {demo && mode === "login" && <p className="muted small">Local demo account. Change the password before deployment.</p>}
  </div></div>;
}
