import Link from "next/link";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return <main className="legal-page">
    <header className="legal-header">
      <Link className="legal-brand" href="/"><span className="mark">O</span>OceanBrown</Link>
      <Link href="/">Return to the platform</Link>
    </header>
    <article className="legal-card">
      <p className="legal-kicker">OceanBrown Connect</p>
      <h1>{title}</h1>
      <p className="muted">Last updated: {updated}</p>
      {children}
    </article>
    <footer className="legal-footer">
      <Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/data-deletion">Data deletion</Link>
    </footer>
  </main>;
}
