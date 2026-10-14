"use client";

import { useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { IconButton } from "@/components/ui";

/**
 * Right-hand inspector column (Figma "Design" panel), used by canvas steps.
 *
 * From 900px it is a floating card on the canvas's right edge (Relume). On a phone a column would
 * leave no canvas, so it sits behind a "Details" button and opens over the
 * canvas, with a close button; nothing in it is dropped.
 */
export function StepPanel({ eyebrow, title, children }: {
  /** What sits before the title in the header, e.g. "Step 2 of 3". Omit on workspace pages. */
  eyebrow?: string; title: string; children: ReactNode;
}) {
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
        aria-label={eyebrow ? `${eyebrow}: ${title}` : title}
        className={`${open ? "flex" : "hidden"} min-[900px]:flex absolute top-0 right-0 bottom-0 z-30 min-[900px]:z-10 w-[min(320px,100%)] min-[900px]:w-[300px] min-[900px]:top-1 min-[900px]:right-3 min-[900px]:bottom-3 min-[900px]:rounded-2xl min-[900px]:border min-[900px]:shadow-[var(--shadow)] overflow-hidden bg-paper border-l border-hairline flex-col shadow-[var(--shadow-overlay)]`}
      >
        <div className="min-h-12 shrink-0 flex items-center pl-5 pr-1 border-b border-hairline">
          <span className="label-mono text-ink-faint flex-1">{eyebrow ? `${eyebrow} · ${title}` : title}</span>
          <span className="min-[900px]:hidden"><IconButton label="Close details" onClick={() => setOpen(false)}><X size={17} /></IconButton></span>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">{children}</div>
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
