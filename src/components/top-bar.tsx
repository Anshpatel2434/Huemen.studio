"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, ArrowRight } from "lucide-react";

const LABELS: Record<string, string> = {
  dashboard: "Overview", studio: "Content Studio", visual: "Visual Studio",
  calendar: "Calendar", ideas: "Idea Inbox", strategy: "Strategy",
  foundation: "Brand Foundation", offers: "Offers",
};

const COMMANDS: { href: string; label: string; hint: string }[] = [
  { href: "/dashboard", label: "Overview", hint: "01" },
  { href: "/dashboard/studio", label: "Content Studio", hint: "02" },
  { href: "/dashboard/visual", label: "Visual Studio", hint: "03" },
  { href: "/dashboard/calendar", label: "Calendar", hint: "04" },
  { href: "/dashboard/ideas", label: "Idea Inbox", hint: "05" },
  { href: "/dashboard/strategy", label: "Strategy", hint: "06" },
  { href: "/dashboard/foundation", label: "Brand Foundation", hint: "07" },
  { href: "/dashboard/offers", label: "Offers", hint: "08" },
];

export function TopBar() {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const section = LABELS[path.split("/")[2] ?? "dashboard"] ?? "Overview";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => COMMANDS.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())), [q]);
  const go = (href: string) => { setOpen(false); setQ(""); router.push(href); };

  return (
    <>
      <header className="sticky top-0 z-30 h-12 flex items-center gap-4 px-8 sm:px-16 bg-ground/85 backdrop-blur-md border-b border-hairline">
        <p className="label-mono text-ink-muted">
          <span className="text-ink-faint">Alex Rivera</span>
          <span className="mx-2 text-ink-faint">/</span>
          <span className="text-ink">{section}</span>
        </p>
        <button onClick={() => setOpen(true)} className="ml-auto flex items-center gap-2 label-mono text-ink-faint hover:text-ink transition-colors">
          <Search size={13} /> <span className="hidden sm:inline">Jump to</span>
          <kbd className="ml-1 text-[0.6rem] border border-hairline rounded px-1 py-0.5">⌘K</kbd>
        </button>
        <span className="label-mono text-ink-faint hidden sm:block">London · 41.4°N</span>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[13vh] px-4 fade-in" style={{ background: "rgba(14,14,14,0.45)", backdropFilter: "blur(5px)" }} onClick={() => setOpen(false)}>
          <div className="bg-paper border border-hairline shadow-[var(--shadow-lg)] w-full max-w-lg pop overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-4 border-b border-hairline">
              <Search size={16} className="text-ink-faint" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or jump to…" className="flex-1 py-3.5 text-sm bg-transparent focus:outline-none placeholder:text-ink-faint" />
              <kbd className="label-mono text-ink-faint border border-hairline rounded px-1.5 py-0.5">ESC</kbd>
            </div>
            <div className="p-1.5 max-h-80 overflow-y-auto">
              {results.length === 0 && <p className="px-3 py-6 text-sm text-ink-faint text-center">No matches.</p>}
              {results.map((c) => (
                <button key={c.href} onClick={() => go(c.href)} className="group flex items-baseline gap-3 w-full px-3 py-2.5 text-left hover:bg-muted-surface transition-colors">
                  <span className="num-display text-xs text-ink-faint w-5">{c.hint}</span>
                  <span className="text-sm flex-1">{c.label}</span>
                  <ArrowRight size={14} className="text-ink-faint opacity-0 group-hover:opacity-100 transition-opacity self-center" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
