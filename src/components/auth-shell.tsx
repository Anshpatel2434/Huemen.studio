import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, FileText, Network, PenLine, Palette } from "lucide-react";
import { LogoMark } from "@/components/ui";
import { ThemeToggle } from "@/components/theme";

/**
 * Shared frame for every auth page (sign in, check email, invite, signed out,
 * link expired, disabled, 404/error). Relume-style: a centred card inside a
 * crosshair grid, logo + light/dark toggle on top, and optionally the product
 * showcase on the right.
 */
export function AuthShell({ children, showcase = false, width = 340 }: { children: ReactNode; showcase?: boolean; width?: number }) {
  return (
    <main className="flex-1 flex min-h-screen">
      <section className="flex-1 relative flex flex-col">
        <header className="h-14 flex items-center justify-between px-4">
          <Link href="/" aria-label="Huemen.studio home"><LogoMark size={26} /></Link>
          <ThemeToggle />
        </header>
        <div className="flex-1 flex items-center justify-center px-5 pb-16">
          <div className="relative w-full" style={{ maxWidth: width }}>
            {/* Crosshair frame (the Relume auth signature) */}
            <span aria-hidden className="pointer-events-none absolute -inset-x-[140px] top-0 h-px bg-line" />
            <span aria-hidden className="pointer-events-none absolute -inset-x-[140px] bottom-0 h-px bg-line" />
            <span aria-hidden className="pointer-events-none absolute -inset-y-[110px] left-0 w-px bg-line" />
            <span aria-hidden className="pointer-events-none absolute -inset-y-[110px] right-0 w-px bg-line" />
            {["-top-[3px] -left-[3px]", "-top-[3px] -right-[3px]", "-bottom-[3px] -left-[3px]", "-bottom-[3px] -right-[3px]"].map((pos) => (
              <span key={pos} aria-hidden className={`absolute ${pos} w-[7px] h-[7px] rounded-full bg-paper border border-line`} />
            ))}
            <div className="px-5 py-9 fade-up">{children}</div>
          </div>
        </div>
      </section>
      {showcase && <Showcase />}
    </main>
  );
}

/** Round icon badge above an auth page title. */
export function AuthIcon({ children }: { children: ReactNode }) {
  return <span className="mx-auto mb-5 w-11 h-11 rounded-full bg-field text-ink flex items-center justify-center">{children}</span>;
}

export function AuthTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <>
      <h1 className="text-center text-[1.4rem]">{children}</h1>
      {sub && <p className="text-center text-[0.86rem] text-ink-muted mt-2 leading-relaxed">{sub}</p>}
    </>
  );
}

export function AuthNotice({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "strong" }) {
  return <p className={`mt-5 text-[0.8rem] rounded-[8px] px-3 py-2 leading-relaxed ${tone === "strong" ? "bg-ink text-on-ink" : "bg-accent-soft text-accent-ink"}`}>{children}</p>;
}

export function AuthFoot({ children }: { children: ReactNode }) {
  return <p className="mt-6 text-center text-[0.74rem] text-ink-faint leading-relaxed">{children}</p>;
}

/** Right panel: the product itself — the four steps as light artboards on a grid. */
function Showcase() {
  const steps = [
    { icon: FileText, label: "Brief" },
    { icon: Network, label: "Pillars" },
    { icon: PenLine, label: "Content" },
    { icon: Palette, label: "Visual" },
  ];
  return (
    <aside className="hidden lg:flex w-[42%] max-w-[640px] relative overflow-hidden flex-col bg-panel border-l border-hairline">
      <div className="theme-light flex-1 relative">
        <div className="absolute left-[9%] top-[12%] w-[46%] bg-paper rounded-[6px] shadow-[0_24px_60px_-20px_rgba(0,0,0,.45)] p-4">
          <p className="label-mono text-ink-faint">Brief</p>
          <p className="text-[1rem] font-medium mt-1 leading-tight">Leadership coaching for first-time managers</p>
          <div className="mt-3 flex flex-col gap-1.5"><span className="wf-bar h-1.5 w-full" /><span className="wf-bar h-1.5 w-5/6" /><span className="wf-bar h-1.5 w-2/3" /></div>
          <div className="mt-3 h-1 rounded-full bg-field overflow-hidden"><div className="h-full w-[85%] bg-accent" /></div>
        </div>
        <div className="absolute right-[8%] top-[20%] w-[40%] bg-paper rounded-[6px] shadow-[0_24px_60px_-20px_rgba(0,0,0,.45)] p-3">
          <p className="label-mono text-ink-faint">Pillars</p>
          {["Signature point of view", "Contrarian takes", "Proof & case stories"].map((p) => (
            <div key={p} className="mt-1.5 h-7 rounded-[5px] border border-hairline flex items-center px-2 text-[0.72rem]">{p}</div>
          ))}
        </div>
        <div className="absolute left-[14%] top-[47%] w-[44%] bg-paper rounded-[6px] shadow-[0_24px_60px_-20px_rgba(0,0,0,.45)] p-3.5">
          <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-field" /><span className="wf-bar h-1.5 w-20" /></div>
          <p className="text-[0.8rem] font-semibold mt-2 leading-snug">Stop being the best engineer on the team. Start being the reason the team is good.</p>
          <div className="mt-2 flex flex-col gap-1"><span className="wf-bar h-1 w-full" /><span className="wf-bar h-1 w-4/5" /></div>
        </div>
        <div className="absolute right-[10%] top-[52%] w-[32%] aspect-square rounded-[6px] shadow-[0_24px_60px_-20px_rgba(0,0,0,.5)] p-4 flex flex-col justify-between" style={{ background: "#0a0a0a" }}>
          <span className="w-6 h-1 rounded-full bg-white" />
          <p className="serif-accent text-[0.95rem] leading-snug text-white">“Your first 90 days decide the next three years.”</p>
        </div>
      </div>
      <div className="theme-light m-5 bg-paper/95 backdrop-blur rounded-[10px] p-4 shadow-[var(--shadow)]">
        <div className="flex items-center gap-1.5 flex-wrap">
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <span key={s.label} className="flex items-center gap-1.5 text-[0.76rem] font-medium">
                {i > 0 && <ArrowRight size={12} className="text-ink-faint" />}
                <span className="w-6 h-6 rounded-[6px] bg-field flex items-center justify-center"><Icon size={12} /></span>{s.label}
              </span>
            );
          })}
        </div>
        <p className="text-[0.8rem] text-ink-muted mt-2.5 leading-relaxed">Each step is generated from the one before, from one stored brief, so nobody re-briefs an AI from scratch.</p>
      </div>
    </aside>
  );
}
