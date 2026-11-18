"use client";

import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { dismissWhatsNewAction } from "../project-actions";
import { btnClass } from "@/components/btn";
import { Modal } from "@/components/ui";

/** Remembered in the browser the moment the note is shown, so it is shown once. */
const SEEN_KEY = "huemen_seen_projects";
const seenBefore = () => {
  try { return window.localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
};

/**
 * One-time announcement, Relume-style: copy on the left, product collage on
 * the right. A real dialog (name, focus held inside, Escape closes).
 *
 * Shown once: seeing it is enough. The cookie the server reads is only set on
 * close (setting it re-renders the page, which would take the note away while
 * it is being read), and a page the router already holds can still say "show
 * it", so the browser keeps its own mark from the first moment it appears.
 * Another page, or this one again, then stays quiet.
 */
export function WhatsNew({ onStart }: { onStart: () => void }) {
  // Decided once per visit to the page. The server renders nothing either way
  // (the dialog is a portal), so reading the browser here cannot mismatch.
  const [open, setOpen] = useState(() => typeof window !== "undefined" && !seenBefore());
  useEffect(() => {
    if (!open) return;
    try { window.localStorage.setItem(SEEN_KEY, "1"); } catch { /* private mode: the cookie still covers it */ }
  }, [open]);
  const close = () => { setOpen(false); void dismissWhatsNewAction(); };

  return (
    <Modal open={open} onClose={close} label="New: your voice, set once" bare width={720}>
      <div className="relative grid grid-cols-1 md:grid-cols-[1fr_1fr] bg-paper">
        <div className="absolute top-3 right-3 z-10">
          <button type="button" onClick={close} className="hu-hit w-9 h-9 rounded-sm bg-paper border border-hairline flex items-center justify-center text-ink hover:border-line-strong" aria-label="Close"><X size={15} aria-hidden="true" /></button>
        </div>
        <div className="p-7 flex flex-col">
          <span className="self-start h-6 px-2 rounded-sm bg-accent-soft text-accent-ink label-mono flex items-center">New</span>
          <h2 className="text-xl leading-tight mt-3 text-ink">Your voice, set once. <span className="serif-accent">Every piece its own project.</span></h2>
          <p className="text-sm text-ink-muted mt-4 leading-relaxed">Your brief, pillars and voice are set up once, in onboarding, and every piece reads them. Nothing to re-brief.</p>
          <p className="text-sm text-ink-muted mt-3 leading-relaxed">Each LinkedIn post or Instagram carousel becomes its own project: Ideate, then Content, then Visual. Check scores anything you paste against your voice.</p>
          <div className="mt-auto pt-7 flex flex-col gap-2">
            <button type="button" onClick={() => { close(); onStart(); }} className={`w-full ${btnClass("primary")}`}><Sparkles size={14} aria-hidden="true" /> Start a project</button>
            <button type="button" onClick={close} className={`w-full ${btnClass("secondary")}`}>Later</button>
          </div>
        </div>
        <div className="relative hidden md:block min-h-[380px] bg-field border-l border-hairline" aria-hidden="true">
          {/* A picture of the product, always in the light theme's own tokens. */}
          <div className="theme-light absolute inset-0">
            <span className="absolute left-1/2 top-0 bottom-0 w-px bg-line" />
            <span className="absolute top-1/2 left-0 right-0 h-px bg-line" />
            <div className="absolute left-[8%] top-[10%] w-[40%] bg-paper rounded-sm p-2.5 shadow-[var(--shadow)]">
              <p className="label-mono text-ink-faint !text-[0.55rem]">Voice</p>
              <div className="mt-1.5 flex flex-col gap-1"><span className="wf-bar h-1.5" /><span className="wf-bar h-1.5 w-4/5" /><span className="wf-bar h-1.5 w-3/5" /></div>
            </div>
            <div className="absolute right-[8%] top-[14%] w-[38%] bg-paper rounded-sm p-2.5 shadow-[var(--shadow)]">
              <p className="label-mono text-ink-faint !text-[0.55rem]">Ideate</p>
              {[0, 1, 2].map((i) => <div key={i} className="mt-1 h-4 rounded-xs border border-hairline" />)}
            </div>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-lg bg-ink flex items-center justify-center shadow-[var(--shadow)]">
              <span className="serif-accent text-[2.4rem] text-on-ink -mt-1">h</span>
            </div>
            <div className="absolute left-[10%] bottom-[10%] w-[38%] bg-paper rounded-sm p-2.5 shadow-[var(--shadow)]">
              <p className="text-[0.6rem] font-semibold leading-tight text-ink">The mistake most first-time managers make.</p>
              <div className="mt-1.5 flex flex-col gap-1"><span className="wf-bar h-1" /><span className="wf-bar h-1 w-4/5" /></div>
            </div>
            <div className="absolute right-[10%] bottom-[9%] w-[30%] aspect-square rounded-sm p-2.5 flex flex-col justify-between bg-ink shadow-[var(--shadow)]">
              <span className="w-4 h-[3px] rounded-full bg-on-ink" />
              <p className="serif-accent text-[0.7rem] leading-tight text-on-ink">“Clarity beats charisma.”</p>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
