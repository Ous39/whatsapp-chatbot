"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConnectWhatsApp } from "../../components/ConnectWhatsApp";
import { Guard } from "../../components/Guard";
import { Shell } from "../../components/Shell";
import { api } from "../../lib/api";
import { WHATSAPP_LABEL, type IndustryOption, type Onboarding } from "../../lib/onboarding";

type StepId = Onboarding["currentStep"];
type InstallResult = { created: number; refreshed: number; keptCustomised: number; published: number; drafts: number; missingRequired: string[]; aiCanBeEnabled: boolean; version: number };

export default function OnboardingPage() {
  const [status, setStatus] = useState<Onboarding>();
  const [industries, setIndustries] = useState<IndustryOption[]>([]);
  const [step, setStep] = useState<StepId>();
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const s = await api<Onboarding>("/onboarding");
      setStatus(s);
      setStep(current => current ?? s.currentStep);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    api<IndustryOption[]>("/onboarding/industries").then(setIndustries).catch(() => undefined);
  }, [load]);

  // While a number is being set up, refresh quietly so the page moves on by itself.
  useEffect(() => {
    if (!status || status.live) return;
    if (!["IN_PROGRESS", "PENDING_META", "CONNECTED"].includes(status.whatsapp.state)) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") load(); }, 10_000);
    return () => clearInterval(timer);
  }, [status, load]);

  const doneCount = status?.steps.filter(s => s.state === "done").length ?? 0;

  return (
    <Guard>
      <Shell title="Set up your WhatsApp service" subtitle="Three steps. OceanBrown handles the technical work behind them.">
        {error && <p className="error" role="alert">{error}</p>}
        {!status ? <div className="empty">Loading your setup…</div> : (
          <>
            {status.suspended && <div className="notice"><strong>This workspace is suspended.</strong> Contact OceanBrown to reactivate it.</div>}
            <nav className="stepper" aria-label="Setup steps">
              {status.steps.map((s, index) => (
                <button key={s.id} type="button" className={`stepper-item ${s.state} ${step === s.id ? "current" : ""}`} aria-current={step === s.id ? "step" : undefined} onClick={() => setStep(s.id)}>
                  <span className="stepper-number" aria-hidden="true">{s.state === "done" ? "✓" : s.state === "attention" ? "!" : index + 1}</span>
                  <span className="stepper-label">{s.title}<small>{s.state === "done" ? "Done" : s.state === "attention" ? "Needs attention" : "To do"}</small></span>
                </button>
              ))}
            </nav>
            <p className="muted small" aria-live="polite">{doneCount} of 3 steps done{status.live ? " · Live on WhatsApp" : ""}</p>

            {step === "whatsapp" && (
              <section className="card wizard-card" aria-labelledby="step1">
                <h2 id="step1">1. Connect your WhatsApp number</h2>
                <ConnectWhatsApp status={status} available={!!status.embeddedSignupAvailable} onChanged={load} />
                <div className="wizard-nav">
                  <span />
                  <button className="btn secondary" onClick={() => setStep("business")}>{status.steps[0]?.state === "done" ? "Next: your business" : "Continue — finish this later"}</button>
                </div>
              </section>
            )}

            {step === "business" && <BusinessStep status={status} industries={industries} onSaved={async () => { await load(); setStep("review"); }} onBack={() => setStep("whatsapp")} />}

            {step === "review" && <ReviewStep status={status} industries={industries} onChanged={load} goTo={setStep} />}
          </>
        )}
      </Shell>
    </Guard>
  );
}

function BusinessStep({ status, industries, onSaved, onBack }: { status: Onboarding; industries: IndustryOption[]; onSaved: () => void; onBack: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(status.business.industry || null);
  const [facts, setFacts] = useState<Record<string, string>>(status.facts ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<InstallResult | null>(null);
  const filtered = useMemo(() => industries.filter(i => `${i.label} ${i.description}`.toLowerCase().includes(query.trim().toLowerCase())), [industries, query]);
  const industry = industries.find(i => i.key === selected);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!industry) return;
    setBusy(true);
    setError("");
    try {
      const answers = Object.fromEntries(industry.fields.map(f => [f.key, (facts[f.key] ?? "").trim()]).filter(([, v]) => v));
      const response = await api<{ result: InstallResult }>("/onboarding/industry", { method: "POST", body: JSON.stringify({ industry: industry.key, facts: answers }) });
      setResult(response.result);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (result && industry) {
    return (
      <section className="card wizard-card" aria-labelledby="step2done">
        <h2 id="step2done">2. Your {industry.label.toLowerCase()} starter is ready</h2>
        <ul className="summary-list">
          <li><strong>{result.published}</strong> answers published from what you told us</li>
          <li><strong>{result.drafts}</strong> answers saved as drafts for you to complete{industry.sensitive ? " and approve" : ""}</li>
          {result.keptCustomised > 0 && <li><strong>{result.keptCustomised}</strong> answers you had edited were kept as they are</li>}
        </ul>
        {industry.sensitive && <div className="notice">{industry.notes ?? "This industry needs a person to approve answers before they are published."}</div>}
        {result.missingRequired.length > 0 && <p className="muted">Some important details are still missing. You can add them later in Knowledge, or go back and fill them in now.</p>}
        <div className="wizard-nav">
          <button className="btn secondary" onClick={() => setResult(null)}>Change answers</button>
          <button className="btn" onClick={onSaved}>Next: review and start</button>
        </div>
      </section>
    );
  }

  return (
    <section className="card wizard-card" aria-labelledby="step2">
      <h2 id="step2">2. Tell us about your business</h2>
      <p className="muted">Pick your industry and answer a few questions. We prepare a welcome message and answers from what you write — we never make up prices, hours or policies.</p>
      {!industry ? (
        <>
          <label className="search-label">
            Search industries
            <input className="input" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="e.g. restaurant, jobs, clinic" autoFocus />
          </label>
          <div className="industry-grid" role="radiogroup" aria-label="Industry">
            {filtered.map(option => (
              <button key={option.key} type="button" role="radio" aria-checked={selected === option.key} className={`industry-option ${selected === option.key ? "selected" : ""}`} onClick={() => setSelected(option.key)}>
                <strong>{option.label}</strong>
                <span>{option.description}</span>
                {option.sensitive && <em>Answers are approved before publishing</em>}
              </button>
            ))}
            {!filtered.length && <p className="muted">No industry matches. Choose "Other".</p>}
          </div>
          <div className="wizard-nav">
            <button className="btn secondary" onClick={onBack}>Back</button>
            <span />
          </div>
        </>
      ) : (
        <form onSubmit={save}>
          <div className="chosen-industry">
            <div className="grow"><strong>{industry.label}</strong><p className="muted small">Includes: {industry.menuOptions.join(" · ")}</p></div>
            <button type="button" className="btn secondary" onClick={() => setSelected(null)}>Change</button>
          </div>
          {industry.notes && <div className="notice">{industry.notes}</div>}
          <div className="form-grid">
            {industry.fields.map(field => (
              <label key={field.key} className={field.multiline ? "span-2" : undefined}>
                {field.label}{field.required ? " *" : " (optional)"}
                {field.multiline
                  ? <textarea className="input" rows={3} maxLength={1000} value={facts[field.key] ?? ""} placeholder={field.placeholder} onChange={e => setFacts({ ...facts, [field.key]: e.target.value })} />
                  : <input className="input" maxLength={1000} value={facts[field.key] ?? ""} placeholder={field.placeholder} onChange={e => setFacts({ ...facts, [field.key]: e.target.value })} />}
              </label>
            ))}
          </div>
          <p className="muted small">Answers you leave empty are saved as drafts, so the assistant never guesses them.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="wizard-nav">
            <button type="button" className="btn secondary" onClick={onBack}>Back</button>
            <button className="btn" disabled={busy}>{busy ? "Preparing…" : "Prepare my starter"}</button>
          </div>
        </form>
      )}
    </section>
  );
}

function ReviewStep({ status, industries, onChanged, goTo }: { status: Onboarding; industries: IndustryOption[]; onChanged: () => void; goTo: (s: StepId) => void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const industry = industries.find(i => i.key === status.business.industry);
  const w = status.whatsapp;
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError("");
    try { await fn(); onChanged(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(""); }
  };
  return (
    <section className="card wizard-card" aria-labelledby="step3">
      <h2 id="step3">3. Review and start</h2>
      <div className="review-grid">
        <dl className="review-list">
          <div><dt>Business</dt><dd>{status.businessName}</dd></div>
          <div><dt>WhatsApp number</dt><dd>{w.number ?? "Not connected yet"} <span className={`state-pill ${status.live ? "good" : "warn"}`}>{WHATSAPP_LABEL[w.state]}</span></dd></div>
          <div><dt>Industry</dt><dd>{status.business.industryLabel ?? <button className="link" onClick={() => goTo("business")}>Choose your industry</button>}</dd></div>
          <div><dt>Starter template</dt><dd>{status.business.templateVersion ? `${status.business.industryLabel} v${status.business.templateVersion} · ${status.business.publishedFaqs} published, ${status.business.draftFaqs} drafts` : "Not installed yet"}</dd></div>
          <div><dt>AI replies</dt><dd>{status.business.aiEnabled ? "On — answering from published answers" : "Off — your team replies"}</dd></div>
        </dl>
        <Preview suggestions={industry?.menuOptions ?? []} />
      </div>

      {!status.live && (
        <div className="notice">
          <strong>Not live yet: {w.headline.toLowerCase()}.</strong> {w.detail}{" "}
          <button className="link" onClick={() => goTo("whatsapp")}>See WhatsApp status</button>
        </div>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <Link className="btn" href="/inbox">Open inbox</Link>
        <Link className="btn secondary" href="/knowledge">Edit answers</Link>
        {!status.business.aiEnabled && status.business.publishedFaqs > 0 && !status.business.sensitive && (
          <button className="btn secondary" disabled={!!busy} onClick={() => run("ai", () => api("/business", { method: "PATCH", body: JSON.stringify({ automationEnabled: true }) }))}>{busy === "ai" ? "Switching on…" : "Switch on AI replies"}</button>
        )}
        {status.steps[2]?.state !== "done" && (
          <button className="btn secondary" disabled={!!busy} onClick={() => run("done", () => api("/onboarding/complete", { method: "POST", body: "{}" }))}>{busy === "done" ? "Saving…" : "I've reviewed my setup"}</button>
        )}
      </div>
    </section>
  );
}

/** Test conversation using the same answers as live WhatsApp. Never sends anything to customers. */
function Preview({ suggestions }: { suggestions: string[] }) {
  const [log, setLog] = useState<{ from: "customer" | "agent"; text: string }[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ask = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true);
    setLog(l => [...l, { from: "customer", text: question }]);
    setText("");
    try {
      const reply = await api<{ text: string }>("/simulator", { method: "POST", body: JSON.stringify({ message: question }) });
      setLog(l => [...l, { from: "agent", text: reply.text }]);
    } catch (cause) {
      setLog(l => [...l, { from: "agent", text: `(${(cause as Error).message})` }]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="preview">
      <h3>Try it <small className="muted">— preview only, nothing is sent</small></h3>
      <div className="preview-log" aria-live="polite">
        {log.length === 0 && <p className="muted small">Ask a question a customer might send.</p>}
        {log.map((m, i) => <div key={i} className={m.from === "agent" ? "bubble out" : "bubble"}>{m.text}</div>)}
      </div>
      <div className="chips">{suggestions.slice(0, 4).map(s => <button key={s} type="button" className="chip" disabled={busy} onClick={() => ask(s)}>{s}</button>)}</div>
      <form className="compose" onSubmit={e => { e.preventDefault(); ask(text); }}>
        <input className="input" value={text} onChange={e => setText(e.target.value)} placeholder="Type a customer question" aria-label="Test question" />
        <button className="btn" disabled={busy || !text.trim()}>Ask</button>
      </form>
    </div>
  );
}
