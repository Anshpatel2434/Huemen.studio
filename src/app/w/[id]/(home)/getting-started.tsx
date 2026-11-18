"use client";

/**
 * Getting started on the home page: a window with five steps that opens
 * itself once, right after onboarding, and a card that keeps the count
 * afterwards. Each step says what it sets, ticks what's done, and opens the
 * real editor at /setup.
 *
 * The steps are one column, each with its tick beside it: a list never wraps
 * raggedly the way a row of pills did. From 768px the list sits beside the
 * step it describes; below that it sits above it, at the window's full width.
 */
import Link from "next/link";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, CheckCircle2, Circle, X } from "lucide-react";
import { IconButton, Modal } from "@/components/ui";
import { btnClass } from "@/components/btn";
import type { GuideSection } from "@/lib/data/getting-started";
import { guideSeenAction } from "../onboarding/actions";
import { guideClosedKey, shouldShowGuide, type GuideOpen } from "./guide-open";

const subscribeNever = () => () => {};

export function GettingStarted({ tenantId, sections, open: openAtFirst }: { tenantId: string; sections: GuideSection[]; open: boolean }) {
  // Opens itself only until it is dismissed. The server keeps that (the pack's
  // guideSeenAt); this tab keeps it too, so a page the router had cached from
  // before the dismissal (Back, a cached Home) can't open it again (./guide-open).
  const [state, setState] = useState<GuideOpen>(openAtFirst ? "auto" : "closed");
  const dismissed = useSyncExternalStore(subscribeNever, () => readClosed(tenantId), () => false);
  const open = shouldShowGuide(state, dismissed);
  const setOpen = (on: boolean) => setState(on ? "open" : "closed");
  const [tab, setTab] = useState(sections.find((s) => !s.done)?.key ?? sections[0].key);
  const at = sections.find((s) => s.key === tab) ?? sections[0];
  const done = sections.filter((s) => s.done).length;
  const close = () => {
    setOpen(false);
    try { sessionStorage.setItem(guideClosedKey(tenantId), "1"); } catch { /* private window: the server flag still holds */ }
    void guideSeenAction(tenantId);
  };
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  if (done === sections.length && !openAtFirst) return null;

  // Arrow keys move through the steps, as in any tab list.
  const onKey = (e: React.KeyboardEvent) => {
    const i = sections.findIndex((s) => s.key === tab);
    const next = e.key === "ArrowDown" || e.key === "ArrowRight" ? i + 1
      : e.key === "ArrowUp" || e.key === "ArrowLeft" ? i - 1
      : e.key === "Home" ? 0
      : e.key === "End" ? sections.length - 1
      : -1;
    if (next < 0 || next >= sections.length || next === i) return;
    e.preventDefault();
    setTab(sections[next].key);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <>
      <section className="bg-paper border border-hairline rounded-xl p-5 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[16rem]">
          <p className="label-mono text-ink-faint">Getting started · {done} of {sections.length}</p>
          <p className="text-base mt-1">Make every draft sound more like you.</p>
        </div>
        {/* Each bar names its step for a screen reader; there is nothing to hover for. */}
        <ol className="flex gap-1.5">
          {sections.map((s) => (
            <li key={s.key} className={`w-8 h-1.5 rounded-full ${s.done ? "bg-ink" : "bg-line"}`}>
              <span className="sr-only">{s.tab}: {s.done ? "done" : "to do"}</span>
            </li>
          ))}
        </ol>
        <button type="button" onClick={() => setOpen(true)} className={btnClass("secondary", "sm")}>Open the guide</button>
        <Link href={`/w/${tenantId}/setup`} className={btnClass("primary", "sm")}>Carry on <ArrowRight size={14} aria-hidden="true" /></Link>
      </section>

      <Modal open={open} onClose={close} label="Getting started" bare width={920}>
        <div className="p-5 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <h2 className="text-2xl leading-tight tracking-[-0.02em] text-ink">Getting started</h2>
              <p className="text-ink-muted mt-1.5">A few recommended steps to bring every draft closer to you. {done} of {sections.length} done.</p>
            </div>
            <IconButton label="Close" onClick={close} className="-mt-1 -mr-2"><X size={18} /></IconButton>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-[232px_minmax(0,1fr)] gap-5 md:gap-8 items-start">
            <div ref={list} role="tablist" aria-label="Steps" aria-orientation="vertical" onKeyDown={onKey} className="flex flex-col border-y border-hairline divide-y divide-[var(--hairline)] md:border-y-0 md:divide-y-0 md:gap-1">
              {sections.map((s) => {
                const on = s.key === tab;
                return (
                  <button
                    key={s.key}
                    type="button"
                    role="tab"
                    id={`${id}-tab-${s.key}`}
                    aria-selected={on}
                    aria-controls={`${id}-panel`}
                    tabIndex={on ? 0 : -1}
                    onClick={() => setTab(s.key)}
                    className={`flex items-center gap-3 min-h-11 px-3 text-left text-sm md:rounded-sm transition-colors ${on ? "bg-field text-ink font-medium" : "text-ink-muted hover:text-ink hover:bg-hover"}`}
                  >
                    {s.done
                      ? <CheckCircle2 size={18} className="text-ok shrink-0" aria-hidden="true" />
                      : <Circle size={18} className="text-ink-faint shrink-0" aria-hidden="true" />}
                    <span className="flex-1 min-w-0 truncate">{s.tab}</span>
                    <span className="sr-only">{s.done ? "(done)" : "(to do)"}</span>
                  </button>
                );
              })}
            </div>

            <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${at.key}`} className="min-w-0 flex flex-col gap-5 text-left fade-up" key={at.key}>
              <div className="flex flex-col gap-2.5 items-start">
                <h3 className="text-xl leading-tight tracking-[-0.015em] text-ink">{at.title}</h3>
                <p className="text-ink-muted leading-relaxed max-w-[60ch]">{at.body}</p>
                <Link href={`/w/${tenantId}/setup?tab=${at.key}`} onClick={close} className={`${btnClass("primary", "sm")} mt-1.5`}>
                  {at.done ? "Review it" : "Start"} <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
              <ul className="border border-hairline rounded-md px-4 flex flex-col">
                {at.items.map((i) => (
                  <li key={i.label} className="flex items-center justify-between gap-3 min-h-12 py-2 border-b border-hairline last:border-0">
                    <span className={i.done ? "text-ink" : "text-ink-muted"}>{i.label}</span>
                    {i.done
                      ? <CheckCircle2 size={20} className="text-ok shrink-0" aria-hidden="true" />
                      : <Circle size={20} className="text-ink-faint shrink-0" aria-hidden="true" />}
                    <span className="sr-only">{i.done ? "Done" : "Not yet"}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex justify-end mt-7">
            <button type="button" onClick={close} className={`${btnClass("primary", "sm")} min-w-[9rem]`}>Got it</button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function readClosed(tenantId: string): boolean {
  try { return sessionStorage.getItem(guideClosedKey(tenantId)) === "1"; } catch { return false; }
}
