import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function Home() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <main className="flex-1 flex flex-col">
      <header className="flex items-center justify-between px-8 py-6 max-w-6xl mx-auto w-full">
        <span className="text-lg font-semibold tracking-tight">Huemen<span className="text-accent">.</span>studio</span>
        <Link href="/dashboard" className="text-sm font-medium text-ink-muted hover:text-ink transition-colors">Enter studio ↗</Link>
      </header>

      <div className="flex-1 flex flex-col justify-center max-w-4xl mx-auto px-8 py-16 w-full">
        <p className="eyebrow mb-6 fade-up">Personal-brand OS</p>
        <h1 className="text-5xl sm:text-7xl font-semibold leading-[0.98] tracking-tight fade-up">
          Your brand, defined once.
          <br />
          <span className="serif-accent font-normal">Generated everywhere.</span>
        </h1>
        <p className="mt-7 text-lg text-ink-muted max-w-xl leading-relaxed fade-up">
          Fill your brand foundation once. Every post and image is generated from that stored
          context — on-brand, every time, without re-briefing an AI from scratch.
        </p>
        <div className="mt-10 flex items-center gap-3 fade-up">
          <Link href="/dashboard" className="inline-flex items-center gap-2 bg-ink text-white rounded-btn px-6 py-3.5 text-sm font-medium hover:bg-accent transition-colors shadow-sm">
            Open the studio <span aria-hidden>↗</span>
          </Link>
          <Link href="/login" className="inline-flex items-center gap-2 rounded-btn px-6 py-3.5 text-sm font-medium border border-line bg-paper hover:border-ink transition-colors">
            Sign in
          </Link>
        </div>

        <div className="mt-16 grid sm:grid-cols-3 gap-4 fade-up">
          {[
            ["Brand Foundation", "Story, voice and visual identity — captured once."],
            ["Content & Visual Studio", "On-brand posts and images, generated together."],
            ["Plan & repurpose", "A 90-day calendar and an idea inbox that never runs dry."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-card border border-hairline bg-paper p-5 shadow-sm">
              <p className="font-medium">{t}</p>
              <p className="text-sm text-ink-muted mt-1.5 leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
