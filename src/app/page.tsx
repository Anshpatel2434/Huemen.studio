import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDown, ArrowRight } from "lucide-react";
import { getSession } from "@/lib/auth";
import { LogoMark } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { StageChips } from "@/components/stage-chips";
import { ThemeToggle } from "@/components/theme";
import { BrandCoreCard, HueStrip, ScoreMeter } from "@/components/composites";

/**
 * The front page (design system §15, §16). Editorial, not a marketing site:
 * one claim, one action, and the product itself as the picture, built from
 * the same components the studio uses so it never drifts from the real thing.
 */
const STEPS = [
  {
    n: "01",
    title: "Define it once",
    body: "Your story, voice and visual identity become one stored brief, measured from your own writing rather than guessed from adjectives.",
  },
  {
    n: "02",
    title: "Write in your voice",
    body: "Every post, carousel and quote card is generated from that brief. Nobody re-briefs an AI from scratch, ever again.",
  },
  {
    n: "03",
    title: "Check anything",
    body: "Paste a draft from anywhere and see how close it is to how you sound, line by line, with the fix in your words. It never stops you publishing.",
  },
];

export default async function Home() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <main className="flex-1 flex flex-col bg-ground">
      <header className="sticky top-0 z-10 bg-ground/85 backdrop-blur border-b border-hairline">
        <div className="max-w-[1180px] mx-auto flex items-center justify-between gap-3 px-5 min-h-16">
          <Link href="/" className="flex items-center gap-2.5 min-h-11">
            <LogoMark size={28} />
            <span className="text-base font-medium tracking-tight">Huemen<span className="text-ink-faint">.studio</span></span>
          </Link>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <Link href="/login" className={btnClass("secondary", "sm")}>Sign in</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* The spectrum the product is named after, as light behind the work. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-40 right-[-20%] w-[900px] h-[700px] rounded-full opacity-[0.22] blur-3xl"
          style={{ background: "conic-gradient(from 200deg, var(--hue-magenta), var(--hue-coral), var(--hue-orange), var(--hue-yellow), var(--hue-green), var(--hue-teal), var(--hue-blue), var(--hue-violet), var(--hue-magenta))" }}
        />
        <div className="relative max-w-[1180px] mx-auto px-5 pt-16 pb-20 lg:pt-24 lg:pb-28 grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-14 items-center">
          <div className="fade-up">
            <p className="label-mono text-ink-faint">Personal-brand studio · invite only</p>
            <h1 className="mt-6 text-display leading-[1.02]">
              Define your brand once.
              <br />
              <span className="serif-accent">Everything else follows.</span>
            </h1>
            <p className="mt-6 text-lg text-ink-muted max-w-[46ch] leading-relaxed">
              Your story, voice and visual identity become one stored brief. Every post, carousel
              and quote card is written from it, so you never re-brief an AI from scratch.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-2">
              <Link href="/login" className={btnClass("primary", "lg")}>Open the studio <ArrowRight size={17} aria-hidden="true" /></Link>
              <a href="#how" className={btnClass("ghost", "lg")}>How it works <ArrowDown size={17} aria-hidden="true" /></a>
            </div>
            <p className="mt-6 text-sm text-ink-faint">Accounts are set up by your coach. There is no public sign-up.</p>
          </div>

          {/* The product, as the picture: the real components with a sample core. */}
          <div className="relative fade-up" aria-label="A brand core and a checked draft, as they appear in the studio" role="img">
            <div className="relative z-[1] max-w-[440px] lg:ml-auto shadow-[var(--shadow-overlay)] rounded-md" aria-hidden="true">
              <BrandCoreCard
                name="Jane Okonkwo"
                seed="jane-okonkwo-sample"
                subtitle="Operations consultant · core v4"
                trained
                state="trained"
                attributes={["Direct", "Plain-spoken", "Dry humour", "Evidence-led"]}
                confidence={88}
                stats={[{ label: "Samples", value: "11" }, { label: "Words read", value: "14.2k" }, { label: "Channels", value: "2" }]}
              />
            </div>
            <div className="relative z-[2] -mt-3 mr-auto lg:-ml-10 max-w-[360px] bg-paper border border-hairline rounded-md p-5 shadow-[var(--shadow-overlay)]" aria-hidden="true">
              <p className="label-mono text-ink-faint">Draft · LinkedIn</p>
              <p className="mt-3 text-base leading-relaxed">
                I have run this twice now and it failed both times for the same boring reason. Here is the reason.
              </p>
              <div className="mt-5"><ScoreMeter score={91} /></div>
            </div>
          </div>
        </div>
        <HueStrip count={8} className="!rounded-none" />
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-16 bg-paper">
        <div className="max-w-[1180px] mx-auto px-5 py-20 lg:py-28">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <h2 className="text-3xl max-w-[18ch]">One brief. <span className="serif-accent">Every piece.</span></h2>
            <StageChips active="brief" />
          </div>
          <ol className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-px bg-[var(--hairline)] border border-hairline rounded-md overflow-hidden">
            {STEPS.map((s) => (
              <li key={s.n} className="bg-paper p-7 flex flex-col gap-4">
                <span className="font-mono text-sm text-accent-ink">{s.n}</span>
                <h3 className="text-xl">{s.title}</h3>
                <p className="text-ink-muted leading-relaxed">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Close */}
      <section className="border-t border-hairline">
        <div className="max-w-[1180px] mx-auto px-5 py-20 flex flex-col items-start gap-6">
          <h2 className="text-3xl max-w-[22ch]">Your coach has set up your studio. <span className="serif-accent">Step in.</span></h2>
          <Link href="/login" className={btnClass("primary", "lg")}>Sign in <ArrowRight size={17} aria-hidden="true" /></Link>
        </div>
      </section>

      <footer className="border-t border-hairline">
        <div className="max-w-[1180px] mx-auto px-5 py-8 flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm"><LogoMark size={22} /> Huemen.studio</span>
          <span className="label-mono text-ink-faint">Invite only · accounts are set up by your coach</span>
        </div>
      </footer>
    </main>
  );
}
