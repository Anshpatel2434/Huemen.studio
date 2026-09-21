"use client";

import Link from "next/link";
import { useState } from "react";
import { Search, Plus, Lock, Lightbulb, CalendarDays, Package } from "lucide-react";
import { FORMATS, type FormatDef } from "@/lib/content/formats";
import { DraftModal } from "@/components/draft-modal";

/** A tiny wireframe per format, like Relume's section thumbnails. */
function FormatThumb({ f }: { f: FormatDef }) {
  const tall = f.frame.h > f.frame.w;
  const square = f.frame.h === f.frame.w;
  return (
    <span className={`shrink-0 rounded-[4px] border border-line bg-paper p-1 flex flex-col gap-[3px] ${tall ? "w-7 h-9" : square ? "w-8 h-8" : "w-10 h-7"}`}>
      {f.key === "ig_carousel" ? (
        <span className="flex gap-[2px] flex-1">{[0, 1, 2].map((i) => <span key={i} className="flex-1 rounded-[1px] bg-[var(--wf)]" />)}</span>
      ) : (
        <>
          <span className="h-[3px] w-3/4 rounded-full bg-ink/60" />
          <span className="h-[2px] w-full rounded-full bg-[var(--wf)]" />
          <span className="h-[2px] w-5/6 rounded-full bg-[var(--wf)]" />
          {tall && <span className="flex-1 rounded-[1px] bg-[var(--wf)]" />}
        </>
      )}
    </span>
  );
}

export function AddPanel({ tenantId, projectId, base, canDraft, pillars }: {
  tenantId: string; projectId: string; base: string; canDraft: boolean; pillars: { id: string; name: string }[];
}) {
  const [q, setQ] = useState("");
  const [format, setFormat] = useState<string | null>(null);
  const shown = FORMATS.filter((f) => `${f.label} ${f.channel}`.toLowerCase().includes(q.toLowerCase()));
  const groups = Array.from(new Set(shown.map((f) => f.channel)));
  const channelLabel: Record<string, string> = { linkedin: "LinkedIn", instagram: "Instagram", newsletter: "Newsletter", email: "Email", talk: "Speaking" };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="p-2.5 border-b border-hairline">
        <label className="flex items-center gap-2 h-8 px-2.5 rounded-[7px] bg-field text-ink-faint">
          <Search size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search formats" className="bg-transparent outline-none text-[0.78rem] text-ink flex-1 min-w-0 placeholder:text-ink-faint" />
        </label>
      </div>
      <div className="flex-1 overflow-y-auto p-2.5">
        {!canDraft && (
          <p className="flex items-start gap-2 text-[0.74rem] text-ink-muted bg-panel border border-hairline rounded-[8px] px-2.5 py-2 mb-3">
            <Lock size={13} className="shrink-0 mt-px" /> Formats unlock with Pillars. Content is drafted from them.
          </p>
        )}
        {groups.map((g) => (
          <div key={g} className="mb-3">
            <p className="text-[0.7rem] text-ink-faint mb-1.5 px-0.5">{channelLabel[g] ?? g}</p>
            <div className="flex flex-col gap-1.5">
              {shown.filter((f) => f.channel === g).map((f) => (
                <button
                  key={f.key}
                  disabled={!canDraft}
                  onClick={() => setFormat(f.key)}
                  className="group flex items-center gap-2.5 rounded-[9px] border border-hairline bg-paper px-2 py-1.5 text-left hover:border-line disabled:opacity-50 disabled:pointer-events-none"
                >
                  <FormatThumb f={f} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[0.78rem] font-medium truncate">{f.label}</span>
                    <span className="block text-[0.66rem] text-ink-faint">{f.frame.label}</span>
                  </span>
                  <Plus size={14} className="text-ink-faint group-hover:text-ink" />
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="text-[0.7rem] text-ink-faint mb-1.5 px-0.5 mt-4">Planning</p>
        <div className="flex flex-col gap-1.5">
          {[{ href: "ideas", label: "Idea", icon: Lightbulb }, { href: "calendar", label: "Calendar slot", icon: CalendarDays }, { href: "offers", label: "Offer", icon: Package }].map((i) => {
            const Icon = i.icon;
            return (
              <Link key={i.href} href={`${base}/${i.href}`} className="flex items-center gap-2.5 rounded-[9px] border border-hairline bg-paper px-2 py-2 hover:border-line text-[0.78rem]">
                <span className="w-8 h-8 rounded-[6px] bg-field flex items-center justify-center"><Icon size={14} /></span>
                <span className="flex-1">{i.label}</span>
                <Plus size={14} className="text-ink-faint" />
              </Link>
            );
          })}
        </div>
      </div>
      {format && <DraftModal open onClose={() => setFormat(null)} tenantId={tenantId} projectId={projectId} pillars={pillars} defaultFormat={format} />}
    </div>
  );
}
