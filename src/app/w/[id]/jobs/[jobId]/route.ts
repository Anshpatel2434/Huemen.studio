/**
 * GET /w/[id]/jobs/[jobId] — a queued job's status, for the page that shows it
 * (components/job-status). Same access rules as every workspace page; another
 * workspace's job is "not found" (RLS).
 *
 * A job that is due, or whose worker has gone, gets a worker started after
 * this response, so a job keeps moving while someone is watching it even
 * without the cron route.
 */
import { getSession } from "@/lib/auth";
import { resolveScope } from "@/lib/auth/scope";
import { getJob, startWorker } from "@/lib/jobs";

export const maxDuration = 300;

export async function GET(_req: Request, ctx: RouteContext<"/w/[id]/jobs/[jobId]">) {
  const { id, jobId } = await ctx.params;
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in again." }, { status: 401 });
  let scope;
  try {
    scope = { ...(await resolveScope(session, id)), tenantId: id, isPlatformAdmin: false };
  } catch {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const job = await getJob(scope, jobId);
  if (!job) return Response.json({ error: "Not found" }, { status: 404 });
  if (job.needsWorker) startWorker();
  return Response.json(job, { headers: { "Cache-Control": "no-store" } });
}
