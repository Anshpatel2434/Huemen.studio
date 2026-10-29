"use client";

/**
 * Getting started on the home page (Obello-style): a window with five tabs
 * that opens itself once, right after onboarding, and a card that keeps the
 * count afterwards. Each tab says what it sets, ticks what's done, and opens
 * the real editor at /setup.
 */
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui";
import { btnClass } from "@/components/btn";
import type { GuideSection } from "@/lib/data/getting-started";
import { guideSeenAction } from "../onboarding/actions";

export function GettingStarted({ tenantId, sections, open: openAtFirst }: { tenantId: string; sections: GuideSection[]; open: boolean }) {
  const [open, setOpen] = useState(openAtFirst);
  const [tab, setTab] = useState(sections.find((s) => !s.done)?.key ?? sections[0].key);
  const at = sections.find((s) => s.key === tab) ?? sections[0];
  const done = sections.filter((s) => s.done).length;
  const close = () => { setOpen(false); void guideSeenAction(tenantId); };
  if (done === sections.length && !openAtFirst) return null;

  return (
    <>
      <section className="bg-paper border border-hairline rounded-xl p-5 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[16rem]">
          <p className="label-mono text-ink-faint">Getting started · {done} of {sections.length}</p>
          <p className="text-base mt-1">Make every draft sound more like you.</p>
        </div>
        <ol className="flex gap-1.5" aria-label={`${done} of ${sections.length} done`}>
          {sections.map((s) => <li key={s.key} title={s.tab} className={`w-8 h-1.5 rounded-full ${s.done ? "bg-ink" : "bg-line"}`} />)}
        </ol>
        <button type="button" onClick={() => setOpen(true)} className={btnClass("secondary", "sm")}>Open the guide</button>
        <Link href={`/w/${tenantId}/setup`} className={btnClass("primary", "sm")}>Carry on <ArrowRight size={14} aria-hidden="true" /></Link>
      </section>

      <Modal open={open} onClose={close} width={1040}>
        <div className="flex flex-col items-center text-center gap-2 px-2 sm:px-6">
          <h2 className="text-[2rem] leading-tight tracking-[-0.02em]">Getting started</h2>
          <p className="text-ink-muted">A few recommended steps to bring every draft closer to you.</p>
        </div>

        <div className="flex flex-wrap justify-center gap-2 mt-6 px-2" role="tablist" aria-label="Getting started">
          {sections.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={s.key === tab}
              onClick={() => setTab(s.key)}
              className={`inline-flex items-center gap-1.5 min-h-11 px-5 rounded-full text-sm transition-colors ${s.key === tab ? "bg-ink text-on-ink" : "bg-field text-ink-muted hover:text-ink"}`}
            >
              {s.done && <Check size={14} aria-label="done" />} {s.tab}
            </button>
          ))}
        </div>

        <div role="tabpanel" className="mt-6 mx-1 sm:mx-4 bg-field rounded-[24px] p-6 sm:p-10 grid grid-cols-1 md:grid-cols-[1fr_1.1fr] gap-8 items-center text-left fade-up" key={at.key}>
          <div className="flex flex-col gap-3 items-start">
            <h3 className="text-[1.6rem] leading-tight tracking-[-0.015em]">{at.title}</h3>
            <p className="text-ink-muted leading-relaxed">{at.body}</p>
            <Link href={`/w/${tenantId}/setup?tab=${at.key}`} onClick={close} className={`${btnClass("primary", "sm")} mt-2`}>
              {at.done ? "Review it" : "Start"} <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
          <ul className="bg-paper border border-hairline rounded-2xl p-5 flex flex-col">
            {at.items.map((i) => (
              <li key={i.label} className="flex items-center justify-between gap-3 min-h-12 border-b border-hairline last:border-0">
                <span className={i.done ? "text-ink" : "text-ink-muted"}>{i.label}</span>
                {i.done
                  ? <CheckCircle2 size={20} className="text-ok shrink-0" aria-label="done" />
                  : <span className="w-5 h-5 rounded-full border border-line shrink-0" aria-label="not yet" />}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-center mt-6 mb-2">
          <button type="button" onClick={close} className={`${btnClass("primary", "md")} min-w-[12rem]`}>Got it</button>
        </div>
      </Modal>
    </>
  );
}
