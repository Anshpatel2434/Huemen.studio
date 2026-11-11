/**
 * The job queue (brief §05, TASKS P2-4): anything a person would wait more than
 * ~10 seconds for runs here instead of inside their request.
 *
 *   enqueueJob   a workspace action puts a job in (RLS: the workspace's own row)
 *   drainJobs    a worker claims due jobs one at a time and runs them; called
 *                after the response (next/server `after`), from the status
 *                route a page polls, and from the cron route
 *   getJob       what a page shows: status, progress, the error, the result
 *
 * Claiming: one UPDATE ... FOR UPDATE SKIP LOCKED sets status 'running' and a
 * lease (locked_until). Two workers never take the same job; a job whose worker
 * died is taken back when the lease runs out.
 *
 * Failures: an error a later attempt could fix (the provider timing out, a rate
 * limit) puts the job back in the queue with backoff; anything else (the
 * monthly cap, a bad setup, no access) stops it at once. After max_attempts it
 * is 'dead' (the dead-letter state). Either way the progress so far is kept, so
 * the pieces already made stay, and Try again carries on from there.
 *
 * Long jobs run in slices: a handler does what fits in the time it is given,
 * saves its progress and says "more"; the job goes straight back in the queue
 * without counting an attempt.
 *
 * Server-only.
 */
import "server-only";
import { after } from "next/server";
import { withTenantSession, type SessionScope } from "@/db/session";
import { AiConfigError, ProviderError, RateLimitError, UsageCapError, userMessage } from "@/lib/ai/errors";
import { JOB_HANDLERS, JOB_ON_STOP, type JobKind } from "./handlers";
import { JobStop, type JobRecord, type JobView } from "./types";

export { JobStop } from "./types";
export type { JobKind } from "./handlers";
export type { JobRecord, JobStatus, JobView } from "./types";

const ADMIN: SessionScope = { tenantId: null, userId: null, isPlatformAdmin: true };

/** How long a worker holds a job before another may take it back. */
const LEASE_SECONDS = 330;
/** A worker stops taking new work after this long (the function limit is 300s on Vercel). */
const DEFAULT_BUDGET_MS = 240_000;

export interface EnqueueOptions {
  label: string;
  maxAttempts?: number;
}

export async function enqueueJob(scope: SessionScope, kind: JobKind, payload: Record<string, unknown>, opts: EnqueueOptions): Promise<string> {
  if (!scope.tenantId) throw new Error("A job belongs to a workspace.");
  return withTenantSession(scope, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO jobs (tenant_id, kind, payload, label, max_attempts, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [scope.tenantId, kind, JSON.stringify(payload), opts.label, opts.maxAttempts ?? 4, scope.userId],
    );
    return rows[0].id;
  });
}

function view(r: JobRecord): JobView {
  return {
    id: r.id,
    kind: r.kind,
    label: r.label,
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    progress: r.progress ?? {},
    result: r.result,
    error: r.last_error,
    runAfter: r.run_after.toISOString(),
    createdAt: r.created_at.toISOString(),
    finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
    /** Due, or held by a worker that has gone: a poll should start a worker. */
    needsWorker:
      (r.status === "queued" && r.run_after.getTime() <= Date.now()) ||
      (r.status === "running" && (!r.locked_until || r.locked_until.getTime() < Date.now())),
  };
}

/** One job of this workspace, or null (RLS: another workspace's job does not exist). */
export async function getJob(scope: SessionScope, id: string): Promise<JobView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await withTenantSession(scope, async (c) =>
    (await c.query<JobRecord>("SELECT * FROM jobs WHERE id = $1", [id])).rows[0],
  );
  return row ? view(row) : null;
}

/**
 * The latest job of a kind for this workspace, if it is still worth showing:
 * waiting, running, stopped, or finished in the last ten minutes.
 */
export async function latestJob(scope: SessionScope, kind: JobKind): Promise<JobView | null> {
  const row = await withTenantSession(scope, async (c) =>
    (await c.query<JobRecord>(
      `SELECT * FROM jobs WHERE kind = $1
         AND (status <> 'succeeded' OR finished_at > now() - interval '10 minutes')
       ORDER BY created_at DESC LIMIT 1`,
      [kind],
    )).rows[0],
  );
  return row ? view(row) : null;
}

/** This project's jobs of these kinds that are still waiting or running (the visual board shows them). */
export async function activeJobsFor(scope: SessionScope, kinds: JobKind[], projectId: string): Promise<(JobView & { payload: Record<string, unknown> })[]> {
  const rows = await withTenantSession(scope, async (c) =>
    (await c.query<JobRecord>(
      `SELECT * FROM jobs WHERE kind = ANY($1) AND status IN ('queued', 'running') AND payload->>'projectId' = $2
        ORDER BY created_at`,
      [kinds, projectId],
    )).rows,
  );
  return rows.map((r) => ({ ...view(r), payload: r.payload ?? {} }));
}

/** Try again: a stopped job goes back in the queue and carries on from its progress. */
export async function retryJob(scope: SessionScope, id: string): Promise<boolean> {
  return withTenantSession(scope, async (c) => {
    const { rowCount } = await c.query(
      `UPDATE jobs SET status = 'queued', attempts = 0, run_after = now(), locked_until = NULL,
              last_error = NULL, finished_at = NULL
        WHERE id = $1 AND status IN ('failed', 'dead')`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  });
}

/** Stop a job that is waiting. A running slice finishes what it is doing; nothing after it starts. */
export async function cancelJob(scope: SessionScope, id: string): Promise<boolean> {
  return withTenantSession(scope, async (c) => {
    const { rowCount } = await c.query(
      `UPDATE jobs SET status = 'failed', last_error = 'Stopped.', finished_at = now(), locked_until = NULL
        WHERE id = $1 AND status IN ('queued', 'running')`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  });
}

async function claim(onlyTenants: string[] | null): Promise<JobRecord | null> {
  return withTenantSession(ADMIN, async (c) => {
    const { rows } = await c.query<JobRecord>(
      `UPDATE jobs SET status = 'running', locked_until = now() + make_interval(secs => $1)
        WHERE id = (
          SELECT id FROM jobs
           WHERE ((status = 'queued' AND run_after <= now())
              OR (status = 'running' AND (locked_until IS NULL OR locked_until < now())))
             AND ($2::uuid[] IS NULL OR tenant_id = ANY($2::uuid[]))
           ORDER BY run_after
           LIMIT 1
           FOR UPDATE SKIP LOCKED)
        RETURNING *`,
      [LEASE_SECONDS, onlyTenants],
    );
    return rows[0] ?? null;
  });
}

/** Seconds before attempt n+1: 30s, 2 min, 8 min, capped at 30 min. */
export function backoffSeconds(attempt: number): number {
  return Math.min(1800, 30 * 4 ** Math.max(0, attempt - 1));
}

/** Whether a later attempt could succeed, and when to make it. */
export function classify(err: unknown, attempt: number): { retry: boolean; afterSeconds: number } {
  if (err instanceof JobStop || err instanceof UsageCapError || err instanceof AiConfigError) return { retry: false, afterSeconds: 0 };
  if (err instanceof RateLimitError) return { retry: true, afterSeconds: Math.max(5, err.retryAfterSeconds) };
  if (err instanceof ProviderError) {
    const transient = ["timeout", "rate_limit", "server", "unknown", "unparseable", "truncated"].includes(err.kind);
    return { retry: transient, afterSeconds: backoffSeconds(attempt) };
  }
  return { retry: true, afterSeconds: backoffSeconds(attempt) };
}

/** The person who started the job, if they still have access to the workspace. */
async function actorScope(job: JobRecord): Promise<SessionScope & { tenantId: string }> {
  if (!job.created_by) throw new JobStop("The person who started this no longer has an account.");
  const ok = await withTenantSession(ADMIN, async (c) =>
    (await c.query(
      `SELECT 1 FROM users u JOIN tenants t ON t.id = $2
        WHERE u.id = $1 AND u.status = 'active' AND t.status = 'active'
          AND (u.tenant_id = $2 OR u.role = 'owner_admin'
               OR EXISTS (SELECT 1 FROM coach_assignments a WHERE a.coach_user_id = u.id AND a.tenant_id = $2))`,
      [job.created_by, job.tenant_id],
    )).rowCount,
  );
  if (!ok) throw new JobStop("The person who started this no longer has access to this workspace.");
  return { tenantId: job.tenant_id, userId: job.created_by, isPlatformAdmin: false };
}

/** Run one claimed job for one slice. Never throws. */
async function runOne(job: JobRecord, deadline: number): Promise<void> {
  const handler = JOB_HANDLERS[job.kind as JobKind];
  const attempt = job.attempts + 1;
  let progress: Record<string, unknown> = job.progress ?? {};
  let scope: (SessionScope & { tenantId: string }) | null = null;
  const save = async (p: Record<string, unknown>) => {
    progress = p;
    await withTenantSession(ADMIN, (c) =>
      c.query("UPDATE jobs SET progress = $2, locked_until = now() + make_interval(secs => $3) WHERE id = $1", [job.id, JSON.stringify(p), LEASE_SECONDS]),
    );
  };
  try {
    if (!handler) throw new JobStop(`Nothing runs jobs of kind "${job.kind}".`);
    scope = await actorScope(job);
    const out = await handler({ scope, payload: job.payload ?? {}, progress, save, deadline });
    if (out.done) {
      await withTenantSession(ADMIN, (c) =>
        c.query(
          `UPDATE jobs SET status = 'succeeded', result = $2, progress = $3, last_error = NULL,
                  locked_until = NULL, finished_at = now()
            WHERE id = $1 AND status = 'running'`,
          [job.id, JSON.stringify(out.result ?? null), JSON.stringify(progress)],
        ),
      );
    } else {
      // More to do: back in the queue now, without counting an attempt.
      await withTenantSession(ADMIN, (c) =>
        c.query(
          `UPDATE jobs SET status = 'queued', run_after = now(), locked_until = NULL, progress = $2
            WHERE id = $1 AND status = 'running'`,
          [job.id, JSON.stringify(progress)],
        ),
      );
    }
  } catch (err) {
    const { retry, afterSeconds } = classify(err, attempt);
    const message = err instanceof JobStop ? err.message : userMessage(err);
    const final = !retry || attempt >= job.max_attempts;
    await withTenantSession(ADMIN, (c) =>
      c.query(
        `UPDATE jobs SET attempts = $2, last_error = $3, progress = $4, locked_until = NULL,
                status = $5, run_after = now() + make_interval(secs => $6),
                finished_at = CASE WHEN $5 IN ('failed', 'dead') THEN now() ELSE NULL END
          WHERE id = $1 AND status = 'running'`,
        [job.id, attempt, message, JSON.stringify(progress), final ? (retry ? "dead" : "failed") : "queued", final ? 0 : afterSeconds],
      ),
    ).catch(() => undefined);
    // A job that has stopped for good tells whatever was waiting on it (a comment's pin, say).
    const onStop = JOB_ON_STOP[job.kind as JobKind];
    if (final && onStop && scope) await onStop(scope, job.payload ?? {}, message).catch(() => undefined);
  }
}

/**
 * Claim and run due jobs until none are due or the time budget is spent.
 * Returns how many slices ran. Never throws: it runs after responses.
 */
export async function drainJobs(opts: {
  budgetMs?: number;
  maxJobs?: number;
  /**
   * Only these workspaces' jobs. For tests, which share one database and run
   * side by side: a test's worker must never run another test's jobs.
   * Production workers leave it out and run every workspace's.
   */
  onlyTenants?: string[];
} = {}): Promise<number> {
  const start = Date.now();
  const deadline = start + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
  let ran = 0;
  while (Date.now() < deadline - 5_000 && ran < (opts.maxJobs ?? 50)) {
    let job: JobRecord | null;
    try {
      job = await claim(opts.onlyTenants?.length ? opts.onlyTenants : null);
    } catch {
      break;
    }
    if (!job) break;
    await runOne(job, deadline);
    ran++;
  }
  return ran;
}


/**
 * Run due jobs after this response is sent (next/server `after`), within the
 * route's maxDuration. Call it wherever a job was queued or a page asks about
 * one: the queue needs no always-on worker, and the cron route catches the
 * retries nobody is watching.
 */
export function startWorker(): void {
  after(async () => {
    await drainJobs();
  });
}
