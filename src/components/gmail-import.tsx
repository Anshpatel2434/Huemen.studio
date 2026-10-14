"use client";

/**
 * Read sent email once: the person picks how far back (default 12 months),
 * we look through that range page by page from the browser with a real count,
 * keep an even sample of about 200 (spec 06 §1: "sample, don't hoard"), then
 * measure and withdraw the connection. Used in Settings and in onboarding's
 * "Add samples".
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Check, CheckCircle2 } from "lucide-react";
import { btnClass } from "@/components/btn";
import { AgentDots } from "@/components/ui";
import { gmailFinishAction, gmailPageAction, type GmailCursor } from "@/app/settings/connections/actions";

type Range = GmailCursor["months"];
const RANGES: { months: Range; label: string }[] = [
  { months: 6, label: "Last 6 months" },
  { months: 12, label: "Last 12 months" },
  { months: 24, label: "Last 2 years" },
];

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; scanned: number; added: number; estimate: number }
  | { kind: "measuring"; scanned: number; added: number }
  | { kind: "done"; scanned: number; pieces: number; disconnected: boolean }
  | { kind: "failed"; error: string; scanned: number };

export function GmailImport({ tenantId, prompted = false }: { tenantId: string; prompted?: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [months, setMonths] = useState<Range>(12);
  const started = useRef(false);

  const run = async () => {
    if (started.current) return;
    started.current = true;
    let cursor: GmailCursor = { pageToken: null, scanned: 0, added: 0, months };
    setPhase({ kind: "reading", scanned: 0, added: 0, estimate: 0 });
    for (;;) {
      const r = await gmailPageAction(tenantId, cursor);
      if (!r.ok) {
        started.current = false;
        // What arrived is kept, and the connection stays so "Try again" can
        // carry on; already-read email is skipped by its Gmail id. A read that
        // simply stops is measured on the next visit (lifecycle `ingestStalled`).
        setPhase({ kind: "failed", error: r.error, scanned: cursor.scanned });
        router.refresh();
        return;
      }
      const v = r.value;
      cursor = { pageToken: v.nextPageToken, scanned: v.scanned, added: v.added, months: v.months, every: v.every };
      setPhase({ kind: "reading", scanned: v.scanned, added: v.added, estimate: v.estimate });
      if (v.done) break;
    }
    setPhase({ kind: "measuring", scanned: cursor.scanned, added: cursor.added });
    const f = await gmailFinishAction(tenantId, { scanned: cursor.scanned });
    started.current = false;
    setPhase(
      f.ok
        ? { kind: "done", scanned: cursor.scanned, pieces: f.value.pieces, disconnected: f.value.disconnected }
        : { kind: "failed", error: f.error, scanned: cursor.scanned },
    );
    router.refresh();
  };

  if (phase.kind === "idle") {
    return (
      <div className="flex flex-col gap-3">
        {prompted && <p className="text-[0.85rem] text-ok flex items-center gap-1.5"><Check size={14} aria-hidden="true" /> Google is connected. One last choice:</p>}
        <div role="radiogroup" aria-label="How far back to read" className="flex flex-wrap gap-2">
          {RANGES.map((r) => (
            <button
              key={r.months}
              type="button"
              role="radio"
              aria-checked={months === r.months}
              onClick={() => setMonths(r.months)}
              className={`min-h-11 px-4 rounded-full border text-[0.85rem] transition-colors ${
                months === r.months ? "bg-ink text-on-ink border-ink" : "border-line text-ink-muted hover:border-ink"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <p className="text-[0.78rem] text-ink-faint">We look through that range and keep an even sample of about 200 emails. That&apos;s plenty to learn how you write.</p>
        <button type="button" onClick={() => void run()} className={`${btnClass("primary", "sm")} self-start`}>
          Read my sent email
        </button>
      </div>
    );
  }

  if (phase.kind === "reading" || phase.kind === "measuring") {
    const total = phase.kind === "reading" ? Math.max(phase.estimate, phase.scanned, 1) : 1;
    const done = phase.kind === "reading" ? phase.scanned : 1;
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-2 bg-field rounded-[10px] px-4 py-3">
        <p className="text-[0.88rem] font-medium flex items-center gap-2">
          <AgentDots /> {phase.kind === "reading" ? "Reading your sent email" : "Building your core from it"}
        </p>
        <div
          className="h-1.5 rounded-full bg-paper overflow-hidden"
          role="progressbar"
          aria-label="Sent email looked through"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={phase.kind === "reading" ? done : undefined}
        >
          <div
            className={`h-full bg-ink transition-all duration-300 ${phase.kind === "measuring" ? "w-full animate-pulse" : ""}`}
            style={phase.kind === "reading" ? { width: `${(done / total) * 100}%` } : undefined}
          />
        </div>
        <p className="text-[0.78rem] text-ink-muted tabular-nums">
          Looked through {phase.scanned.toLocaleString("en-IN")}
          {phase.kind === "reading" && phase.estimate > phase.scanned ? ` of about ${phase.estimate.toLocaleString("en-IN")}` : ""} ·{" "}
          {phase.added.toLocaleString("en-IN")} kept. Keep this page open until it finishes.
        </p>
      </div>
    );
  }

  if (phase.kind === "failed") {
    return (
      <div className="flex flex-col gap-2">
        <p role="alert" className="text-[0.82rem] text-danger">
          {phase.error}
          {phase.scanned ? ` What was read before it stopped is kept.` : ""}
        </p>
        <button type="button" onClick={() => void run()} className={`${btnClass("secondary", "sm")} self-start`}>Try again</button>
      </div>
    );
  }

  return (
    <div role="status" className="flex flex-col gap-1.5 bg-ok-soft rounded-[10px] px-4 py-3">
      <p className="text-[0.88rem] font-medium text-ok flex items-center gap-2">
        <CheckCircle2 size={15} aria-hidden="true" /> Looked through {phase.scanned.toLocaleString("en-IN")} sent {phase.scanned === 1 ? "email" : "emails"}
      </p>
      <p className="text-[0.8rem] text-ink-muted flex items-start gap-1.5">
        <Check size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        {phase.pieces.toLocaleString("en-IN")} kept to learn your rhythm from. Short replies, quoted text, signatures and footers were left out, and none of it is ever quoted in a draft.
      </p>
      <p className="text-[0.8rem] text-ink-muted flex items-start gap-1.5">
        <Check size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        {phase.disconnected
          ? "Done with Gmail: we've withdrawn our access, so nothing can read your email again."
          : "Your Google connection stays on for the other things you switched on. Disconnect it any time in Settings."}
      </p>
    </div>
  );
}
