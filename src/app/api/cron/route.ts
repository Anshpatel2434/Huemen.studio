/**
 * GET /api/cron — housekeeping on a schedule: runs queued jobs that are due
 * (retries waiting out their backoff, jobs nobody is watching), and removes
 * abandoned uploads.
 *
 * Protected by CRON_SECRET, sent as `Authorization: Bearer <secret>` (what
 * Vercel Cron sends). Without the secret set, the route refuses every call.
 * See README "Background jobs" for scheduling it.
 */
import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { drainJobs } from "@/lib/jobs";
import { sweepAbandonedUploads } from "@/lib/storage/sweep";
import { reportError } from "@/lib/observability/report";

export const maxDuration = 300;

function authorisedCron(req: Request): boolean {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return false;
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  return want.length === got.length && timingSafeEqual(want, got);
}

export async function GET(req: Request) {
  if (!authorisedCron(req)) return Response.json({ error: "Not found" }, { status: 404 });
  // Uploads sent to storage and never used, older than a day (lib/storage/sweep).
  const swept = await sweepAbandonedUploads().catch((e) => {
    void reportError(e, { route: "/api/cron" });
    return { removed: 0 };
  });
  const jobs = await drainJobs({ budgetMs: 220_000 });
  return Response.json({ ok: true, jobs, uploadsRemoved: swept.removed }, { headers: { "Cache-Control": "no-store" } });
}
