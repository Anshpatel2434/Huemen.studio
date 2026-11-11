/**
 * The job queue (lib/jobs, TASKS P2-4): a batch over ~10 seconds is queued,
 * shows progress, keeps its partial results when it stops, retries what a
 * later attempt could fix (with backoff), dead-letters after max_attempts,
 * takes back a job whose worker died, and never shows one workspace's job to
 * another (INV-1). Runs against the local database with the stand-in writer.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { withTenantSession, type SessionScope } from "@/db/session";
import { appPool } from "@/db/pool";
import { createPillar } from "@/lib/data/planning";
import { listProjects } from "@/lib/data/projects";
import { setUsageCaps } from "@/lib/data/admin";
import { backoffSeconds, classify, drainJobs, enqueueJob, getJob, latestJob, retryJob, cancelJob, JobStop, type JobKind } from "@/lib/jobs";
import { JOB_HANDLERS } from "@/lib/jobs/handlers";
import { ProviderError, RateLimitError, UsageCapError } from "@/lib/ai/errors";
import type { Session } from "@/lib/auth/types";

const ADMIN: SessionScope = { tenantId: null, userId: null, isPlatformAdmin: true };
let dbReachable = false;
let A: SessionScope & { tenantId: string };
let B: SessionScope & { tenantId: string };
let owner: Session;
const tenants: string[] = [];

const admin = <T,>(sql: string, params: unknown[] = []) =>
  withTenantSession(ADMIN, async (c) => (await c.query(sql, params)).rows as T[]);

async function mkTenant(name: string, email: string, role = "client") {
  const [t] = await admin<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name]);
  const [u] = await admin<{ id: string }>(
    "INSERT INTO users (tenant_id, email, role, status) VALUES ($1, $2, $3, 'active') RETURNING id",
    [t.id, email, role],
  );
  tenants.push(t.id);
  return { tenantId: t.id, userId: u.id, isPlatformAdmin: false };
}

/** Makes a waiting retry due now, as if its backoff had run out. */
const makeDue = (id: string) => admin("UPDATE jobs SET run_after = now() WHERE id = $1", [id]);

beforeAll(async () => {
  try {
    const probe = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await probe.query("SELECT 1");
    await probe.end();
    dbReachable = true;
  } catch {
    return;
  }
  A = await mkTenant("Jobs A (test)", "jobs-a@test.local");
  B = await mkTenant("Jobs B (test)", "jobs-b@test.local");
  const o = await mkTenant("Jobs owner (test)", "jobs-owner@test.local", "owner_admin");
  owner = { userId: o.userId!, tenantId: o.tenantId, role: "owner_admin", email: "jobs-owner@test.local" };
  for (const name of ["Hiring", "Pricing", "Delegation"]) await createPillar(A, name, `What I know about ${name.toLowerCase()}`);
});

afterAll(async () => {
  if (!dbReachable) return;
  await admin("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [tenants]);
  await appPool().end();
});

describe("job queue", () => {
  it("drafts one piece per pillar in the background, with progress and a result", async () => {
    if (!dbReachable) return;
    const id = await enqueueJob(A, "pillar_drafts", { format: "linkedin_post" }, { label: "Drafting from your pillars" });
    expect((await getJob(A, id))?.status).toBe("queued");
    expect((await latestJob(A, "pillar_drafts"))?.id).toBe(id);

    await drainJobs({ budgetMs: 60_000, onlyTenants: tenants });
    const job = await getJob(A, id);
    expect(job?.status).toBe("succeeded");
    expect(job?.result).toMatchObject({ drafted: 3 });
    const items = job?.progress.items as { drafted: boolean; projectId: string }[];
    expect(items.every((i) => i.drafted && i.projectId)).toBe(true);
    expect((await listProjects(A)).length).toBe(3);
  });

  it("keeps the pieces already made when it stops, and Try again carries on without making them twice", async () => {
    if (!dbReachable) return;
    const before = (await listProjects(A)).length;
    // Room for exactly one more draft this month: the second stops the run.
    const used = Number((await admin<{ n: string }>(
      "SELECT count(*) AS n FROM generation_logs WHERE tenant_id = $1 AND status = 'ok' AND kind = 'text'", [A.tenantId],
    ))[0]?.n ?? 0);
    await setUsageCaps(owner, A.tenantId, { textSoft: null, textHard: used + 1, imageSoft: null, imageHard: null });

    const id = await enqueueJob(A, "pillar_drafts", { format: "linkedin_post" }, { label: "Drafting from your pillars" });
    await drainJobs({ budgetMs: 60_000, onlyTenants: tenants });
    const stopped = await getJob(A, id);
    // The monthly cap is not something a retry fixes: it stops at once.
    expect(stopped?.status).toBe("failed");
    expect(stopped?.error).toMatch(/used its/);
    const items = stopped?.progress.items as { drafted: boolean; projectId: string | null }[];
    expect(items.filter((i) => i.drafted).length).toBe(1);
    // The piece it was working on exists (at Ideate) and is remembered.
    expect(items[1].projectId).toBeTruthy();
    expect((await listProjects(A)).length).toBe(before + 2);

    await setUsageCaps(owner, A.tenantId, { textSoft: null, textHard: null, imageSoft: null, imageHard: null });
    expect(await retryJob(A, id)).toBe(true);
    await drainJobs({ budgetMs: 60_000, onlyTenants: tenants });
    const done = await getJob(A, id);
    expect(done?.status).toBe("succeeded");
    expect(done?.result).toMatchObject({ drafted: 3 });
    // Three pieces for three pillars: the stopped one was finished, not started again.
    expect((await listProjects(A)).length).toBe(before + 3);
  });

  it("retries what a later attempt could fix, with backoff, then dead-letters", async () => {
    if (!dbReachable) return;
    let calls = 0;
    (JOB_HANDLERS as Record<string, unknown>).test_flaky = async () => {
      calls++;
      throw new ProviderError("timeout", "slow", false);
    };
    try {
      const id = await enqueueJob(A, "test_flaky" as JobKind, {}, { label: "Flaky", maxAttempts: 2 });
      await drainJobs({ budgetMs: 10_000, onlyTenants: tenants });
      const waiting = await getJob(A, id);
      expect(waiting?.status).toBe("queued");
      expect(waiting?.attempts).toBe(1);
      expect(new Date(waiting!.runAfter).getTime()).toBeGreaterThan(Date.now() + 20_000);
      // Not due yet: a worker leaves it alone.
      await drainJobs({ budgetMs: 10_000, onlyTenants: tenants });
      expect(calls).toBe(1);

      await makeDue(id);
      await drainJobs({ budgetMs: 10_000, onlyTenants: tenants });
      const dead = await getJob(A, id);
      expect(calls).toBe(2);
      expect(dead?.status).toBe("dead");
      expect(dead?.error).toBeTruthy();
      expect(dead?.finishedAt).toBeTruthy();
    } finally {
      delete (JOB_HANDLERS as Record<string, unknown>).test_flaky;
    }
  });

  it("runs long work in slices, and takes back a job whose worker died", async () => {
    if (!dbReachable) return;
    let slices = 0;
    (JOB_HANDLERS as Record<string, unknown>).test_sliced = async ({ progress, save }: { progress: { n?: number }; save: (p: object) => Promise<void> }) => {
      slices++;
      const n = (progress.n ?? 0) + 1;
      await save({ n });
      return n < 3 ? { done: false } : { done: true, result: { n } };
    };
    try {
      const id = await enqueueJob(A, "test_sliced" as JobKind, {}, { label: "Sliced" });
      // A worker that died mid-run: running, lease long gone.
      await admin("UPDATE jobs SET status = 'running', locked_until = now() - interval '1 minute' WHERE id = $1", [id]);
      expect((await getJob(A, id))?.needsWorker).toBe(true);
      await drainJobs({ budgetMs: 10_000, onlyTenants: tenants });
      const job = await getJob(A, id);
      expect(job?.status).toBe("succeeded");
      expect(job?.result).toEqual({ n: 3 });
      expect(slices).toBe(3);
      // Slices are not failures: no attempt was counted.
      expect(job?.attempts).toBe(0);
    } finally {
      delete (JOB_HANDLERS as Record<string, unknown>).test_sliced;
    }
  });

  it("stops a job whose starter lost access", async () => {
    if (!dbReachable) return;
    const id = await enqueueJob(A, "calendar_plan", { start: "2030-01-07", perWeek: 2, channels: ["linkedin"] }, { label: "Planning" });
    await admin("UPDATE users SET status = 'disabled' WHERE id = $1", [A.userId]);
    try {
      await drainJobs({ budgetMs: 10_000, onlyTenants: tenants });
      const job = await getJob(A, id);
      expect(job?.status).toBe("failed");
      expect(job?.error).toMatch(/no longer has access/);
    } finally {
      await admin("UPDATE users SET status = 'active' WHERE id = $1", [A.userId]);
    }
  });

  it("plans the calendar in the background", async () => {
    if (!dbReachable) return;
    const id = await enqueueJob(A, "calendar_plan", { start: "2030-01-07", perWeek: 2, channels: ["linkedin"] }, { label: "Planning" });
    await drainJobs({ budgetMs: 60_000, onlyTenants: tenants });
    const job = await getJob(A, id);
    expect(job?.status).toBe("succeeded");
    expect((job?.result as { planned: number }).planned).toBeGreaterThan(0);
  });

  it("never shows, retries or stops another workspace's job", async () => {
    if (!dbReachable) return;
    const id = await enqueueJob(A, "calendar_plan", { start: "bad" }, { label: "Planning" });
    await drainJobs({ budgetMs: 10_000, onlyTenants: tenants });
    expect((await getJob(A, id))?.status).toBe("failed");
    expect(await getJob(B, id)).toBeNull();
    expect(await latestJob(B, "calendar_plan")).toBeNull();
    expect(await retryJob(B, id)).toBe(false);
    expect(await cancelJob(B, id)).toBe(false);
    expect((await getJob(A, id))?.status).toBe("failed");
    // A's own Try again works.
    expect(await retryJob(A, id)).toBe(true);
    expect(await cancelJob(A, id)).toBe(true);
  });
});

describe("retry policy", () => {
  it("backs off 30s, 2 min, 8 min, capped at 30 min", () => {
    expect([1, 2, 3, 4, 9].map(backoffSeconds)).toEqual([30, 120, 480, 1800, 1800]);
  });
  it("retries transient failures and stops on the rest", () => {
    expect(classify(new ProviderError("timeout", "x"), 1).retry).toBe(true);
    expect(classify(new ProviderError("refusal", "x"), 1).retry).toBe(false);
    expect(classify(new UsageCapError("text", 5, 5), 1).retry).toBe(false);
    expect(classify(new JobStop("no"), 1).retry).toBe(false);
    expect(classify(new RateLimitError("text", "user", 40), 1)).toEqual({ retry: true, afterSeconds: 40 });
  });
});
