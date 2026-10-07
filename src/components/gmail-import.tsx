"use client";

/**
 * Read the whole sent folder: page after page from the browser, with a real
 * count, then measure and withdraw the connection. Used in Settings and in
 * onboarding's "Add samples", where it starts by itself on the way back from
 * Google, so connecting is the only click.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2 } from "lucide-react";
import { btnClass } from "@/components/btn";
import { AgentDots } from "@/components/ui";
import { gmailFinishAction, gmailPageAction } from "@/app/settings/connections/actions";

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; scanned: number; added: number; estimate: number }
  | { kind: "measuring"; scanned: number; added: number }
  | { kind: "done"; scanned: number; pieces: number; disconnected: boolean }
  | { kind: "failed"; error: string; scanned: number };

export function GmailImport({ tenantId, autoStart = false }: { tenantId: string; autoStart?: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const started = useRef(false);

  const run = async () => {
    if (started.current) return;
    started.current = true;
    let cursor = { pageToken: null as string | null, scanned: 0, added: 0 };
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
      cursor = { pageToken: r.value.nextPageToken, scanned: r.value.scanned, added: r.value.added };
      setPhase({ kind: "reading", scanned: r.value.scanned, added: r.value.added, estimate: r.value.estimate });
      if (r.value.done) break;
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

  useEffect(() => {
    if (autoStart) void run();
    // Once, on arrival from Google.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  if (phase.kind === "idle") {
    return (
      <button type="button" onClick={() => void run()} className={`${btnClass("secondary", "sm")} self-start`}>
        Read my sent email
      </button>
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
          aria-label="Sent email read"
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
          {phase.scanned.toLocaleString("en-IN")}
          {phase.kind === "reading" && phase.estimate > phase.scanned ? ` of about ${phase.estimate.toLocaleString("en-IN")}` : ""} emails read ·{" "}
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
          {phase.scanned ? ` ${phase.scanned.toLocaleString("en-IN")} emails were read before it stopped, and those are kept.` : ""}
        </p>
        <button type="button" onClick={() => void run()} className={`${btnClass("secondary", "sm")} self-start`}>Try again</button>
      </div>
    );
  }

  return (
    <div role="status" className="flex flex-col gap-1.5 bg-ok-soft rounded-[10px] px-4 py-3">
      <p className="text-[0.88rem] font-medium text-ok flex items-center gap-2">
        <CheckCircle2 size={15} aria-hidden="true" /> Read {phase.scanned.toLocaleString("en-IN")} sent {phase.scanned === 1 ? "email" : "emails"}
      </p>
      <p className="text-[0.8rem] text-ink-muted flex items-start gap-1.5">
        <Check size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        {phase.pieces.toLocaleString("en-IN")} kept to learn from. Short replies, quoted text and signatures were left out, and none of it is ever quoted in a draft.
      </p>
      <p className="text-[0.8rem] text-ink-muted flex items-start gap-1.5">
        <Check size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        {phase.disconnected
          ? "Done with Gmail: we've withdrawn our access, so nothing can read your email again."
          : "Your Google connection stays on for the other things you switched on. Disconnect it any time in Settings."}
      </p>
      <a href={`/w/${tenantId}/brand/voice#noticed`} className="text-[0.8rem] text-accent underline underline-offset-2 self-start">
        See what we noticed across your writing
      </a>
    </div>
  );
}
