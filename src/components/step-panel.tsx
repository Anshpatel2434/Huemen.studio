"use client";

import { useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { IconButton } from "@/components/ui";

/**
 * Right-hand inspector column (Figma "Design" panel), used by canvas steps.
 *
 * From 900px it is a fixed column beside the canvas. On a phone a column would
 * leave no canvas, so it sits behind a "Details" button and opens over the
 * canvas, with a close button; nothing in it is dropped.
 */
export function StepPanel({ step, title, children }: { step: number; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        className="min-[900px]:hidden absolute top-[4.25rem] right-3 z-20 inline-flex items-center gap-2 min-h-11 px-4 rounded-full bg-paper border border-hairline shadow-[var(--shadow)] text-sm font-medium"
      >
        <SlidersHorizontal size={15} aria-hidden="true" /> Details
      </button>
      <aside
        aria-label={`Step ${step}: ${title}`}
        className={`${open ? "flex" : "hidden"} min-[900px]:flex absolute top-0 right-0 bottom-0 z-30 min-[900px]:z-10 w-[min(320px,100%)] min-[900px]:w-[280px] bg-paper border-l border-hairline flex-col shadow-[var(--shadow-overlay)] min-[900px]:shadow-none`}
      >
        <div className="min-h-10 shrink-0 flex items-center pl-3 pr-1 border-b border-hairline">
          <span className="label-mono text-ink-faint flex-1">Step {step} · {title}</span>
          <span className="min-[900px]:hidden"><IconButton label="Close details" onClick={() => setOpen(false)}><X size={17} /></IconButton></span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">{children}</div>
      </aside>
    </>
  );
}

export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <p className="text-xs font-medium mb-2">{title}</p>
      {children}
    </section>
  );
}
