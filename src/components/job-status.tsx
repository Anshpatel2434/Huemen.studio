"use client";

/**
 * A queued job, in the flow of the page that started it: what it is doing,
 * what it has made so far, why it stopped, and Try again. Polls the job's
 * status route every two seconds while it runs; the poll also keeps a worker
 * going (app/w/[id]/jobs/[jobId]/route.ts). Nothing is lost when it stops:
 * the pieces already made stay, and Try again carries on from them.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Alert, AgentDots } from "@/components/ui";
import { btnClass } from "@/components/btn";
import type { JobView } from "@/lib/jobs/types";
import { cancelJobAction, retryJobAction } from "@/app/w/[id]/jobs/actions";

type Item = { pillarId: string; name: string; projectId: string | null; drafted: boolean };

const ACTIVE = new Set(["queued", "running"]);

/** Under the text, not beside it: the panel this sits in can be narrow. */
const Actions = ({ children }: { children: React.ReactNode }) => <div className="mt-2.5 flex gap-2">{children}</div>;

function waitText(runAfter: string): string {
  const s = Math.round((new Date(runAfter).getTime() - Date.now()) / 1000);
  if (s <= 5) return "Starting again now.";
  if (s < 90) return `Trying again in ${s} seconds.`;
  return `Trying again in about ${Math.round(s / 60)} minutes.`;
}

export function JobStatus({ tenantId, initial, onDone }: { tenantId: string; initial: JobView; onDone?: "refresh" | "none" }) {
  const router = useRouter();
  const [job, setJob] = useState(initial);
  const [hidden, setHidden] = useState(false);
  const [pending, start] = useTransition();
  const was = useRef(initial.status);

  // A new job remounts this (key={job.id} on the page); the polled state is fresher than a re-render's props.
  useEffect(() => {
    if (!ACTIVE.has(job.status)) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/w/${tenantId}/jobs/${job.id}`, { cache: "no-store" });
        if (res.ok && !stop) setJob((await res.json()) as JobView);
      } catch {
        // Offline for a moment: the next tick tries again.
      }
    };
    const t = setInterval(tick, 2000);
    void tick();
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [tenantId, job.id, job.status]);

  // Fresh pieces and slots appear on the page as soon as the job finishes.
  useEffect(() => {
    if (ACTIVE.has(was.current) && !ACTIVE.has(job.status) && onDone !== "none") router.refresh();
    was.current = job.status;
  }, [job.status, onDone, router]);

  if (hidden) return null;

  const items = Array.isArray(job.progress.items) ? (job.progress.items as Item[]) : null;
  const made = items?.filter((i) => i.drafted && i.projectId) ?? [];
  const pieces = made.length > 0 && (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {made.map((i) => (
        <li key={i.pillarId}>
          <Link href={`/w/${tenantId}/p/${i.projectId}/content`}>{i.name}</Link>
        </li>
      ))}
    </ul>
  );
  const count = items ? `${made.length} of ${items.length}` : "";

  if (ACTIVE.has(job.status)) {
    const retrying = job.status === "queued" && job.attempts > 0;
    return (
      <Alert
        tone="info"
        title={<span className="inline-flex items-center gap-2"><AgentDots /> {job.label}{count && `: ${count} done`}</span>}
      >
        {retrying ? <>That didn&apos;t go through: {job.error} {waitText(job.runAfter)}</> : "This runs on its own. You can leave the page and come back."}
        {pieces}
        <Actions>
          <button type="button" className={btnClass("ghost", "sm")} disabled={pending} onClick={() => start(async () => { await cancelJobAction(tenantId, job.id); router.refresh(); })}>
            Stop
          </button>
        </Actions>
      </Alert>
    );
  }

  if (job.status === "succeeded") {
    const r = (job.result ?? {}) as { drafted?: number; planned?: number; skipped?: number };
    const done =
      typeof r.drafted === "number"
        ? `${r.drafted} piece${r.drafted === 1 ? "" : "s"} drafted, one per pillar.`
        : typeof r.planned === "number"
          ? r.planned
            ? `${r.planned} slots planned${r.skipped ? `, ${r.skipped} days already had one` : ""}.`
            : "Every planned day already has a slot. Nothing added."
          : "Done.";
    return (
      <Alert tone="success" title={done}>
        {pieces}
        <Actions>
          <button type="button" className={btnClass("ghost", "sm")} onClick={() => setHidden(true)}>Dismiss</button>
        </Actions>
      </Alert>
    );
  }

  return (
    <Alert tone="warning" title={`${job.label} stopped${count ? ` at ${count}` : ""}`}>
      {job.error ?? "It didn't finish."} {made.length > 0 && "The pieces already drafted are kept; Try again carries on from the next one."}
      {pieces}
      <Actions>
        <button
          type="button"
          className={btnClass("secondary", "sm")}
          disabled={pending}
          onClick={() =>
            start(async () => {
              if (await retryJobAction(tenantId, job.id)) setJob({ ...job, status: "queued", attempts: 0, error: null, runAfter: new Date().toISOString() });
            })
          }
        >
          {pending ? "Starting…" : "Try again"}
        </button>
      </Actions>
    </Alert>
  );
}
