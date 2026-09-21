"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { dismissWhatsNewAction } from "../project-actions";

/** One-time announcement, Relume-style: copy on the left, product collage on the right. */
export function WhatsNew({ onStart }: { onStart: () => void }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const close = () => { setOpen(false); dismissWhatsNewAction(); };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--scrim)] fade-in" onClick={close}>
      <div className="w-full max-w-[720px] grid grid-cols-1 md:grid-cols-[1fr_1fr] rounded-[14px] overflow-hidden bg-paper shadow-[var(--shadow-lg)] pop" onClick={(e) => e.stopPropagation()}>
        <div className="p-7 flex flex-col">
          <span className="self-start h-6 px-2 rounded-[6px] bg-accent-soft text-accent-ink label-mono !text-[0.62rem] flex items-center">New</span>
          <h2 className="text-[1.55rem] leading-tight mt-3">Projects are here, <span className="serif-accent">and your brand comes with you.</span></h2>
          <p className="text-[0.88rem] text-ink-muted mt-4 leading-relaxed">Every push is now its own project: Brief, then Pillars, then Content, then Visual. Each step is generated from the one before.</p>
          <p className="text-[0.88rem] text-ink-muted mt-3 leading-relaxed">Start a new project from an existing brief and skip straight to the questions. No re-briefing.</p>
          <div className="mt-auto pt-7 flex flex-col gap-2">
            <button onClick={() => { close(); onStart(); }} className="h-10 rounded-[9px] bg-ink text-on-ink text-[0.85rem] font-medium flex items-center justify-center gap-2 hover:opacity-90"><Sparkles size={14} /> Start a project</button>
            <button onClick={close} className="h-10 rounded-[9px] border border-line text-[0.85rem] hover:border-ink">Later</button>
          </div>
        </div>
        <div
          className="relative hidden md:block min-h-[380px] bg-field border-l border-hairline"
        >
          <button onClick={close} className="absolute top-3 right-3 z-10 w-8 h-8 rounded-[8px] bg-white/80 flex items-center justify-center text-[#0b0b0b] hover:bg-white" aria-label="Close"><X size={15} /></button>
          <div className="theme-light absolute inset-0">
            <span className="absolute left-1/2 top-0 bottom-0 w-px bg-line" />
            <span className="absolute top-1/2 left-0 right-0 h-px bg-line" />
            <div className="absolute left-[8%] top-[10%] w-[40%] bg-paper rounded-[5px] p-2.5 shadow-[var(--shadow)]">
              <p className="label-mono text-ink-faint !text-[0.55rem]">Brief</p>
              <div className="mt-1.5 flex flex-col gap-1"><span className="wf-bar h-1.5" /><span className="wf-bar h-1.5 w-4/5" /><span className="wf-bar h-1.5 w-3/5" /></div>
            </div>
            <div className="absolute right-[8%] top-[14%] w-[38%] bg-paper rounded-[5px] p-2.5 shadow-[var(--shadow)]">
              <p className="label-mono text-ink-faint !text-[0.55rem]">Pillars</p>
              {[0, 1, 2].map((i) => <div key={i} className="mt-1 h-4 rounded-[3px] border border-hairline" />)}
            </div>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-[18px] bg-ink flex items-center justify-center shadow-[var(--shadow)]">
              <span className="serif-accent text-[2.4rem] text-on-ink -mt-1">h</span>
            </div>
            <div className="absolute left-[10%] bottom-[10%] w-[38%] bg-paper rounded-[5px] p-2.5 shadow-[var(--shadow)]">
              <p className="text-[0.6rem] font-semibold leading-tight">The mistake most first-time managers make.</p>
              <div className="mt-1.5 flex flex-col gap-1"><span className="wf-bar h-1" /><span className="wf-bar h-1 w-4/5" /></div>
            </div>
            <div className="absolute right-[10%] bottom-[9%] w-[30%] aspect-square rounded-[5px] p-2.5 flex flex-col justify-between shadow-[var(--shadow)]" style={{ background: "#0b0b0b" }}>
              <span className="w-4 h-[3px] rounded-full bg-white" />
              <p className="serif-accent text-[0.7rem] leading-tight text-white">“Clarity beats charisma.”</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
