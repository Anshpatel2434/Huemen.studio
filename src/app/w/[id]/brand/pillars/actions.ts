"use server";

/**
 * Pillars belong to the workspace (build step 3). Every piece draws on them;
 * none of them belongs to one piece.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionScope } from "@/lib/auth/workspace";
import { createPillar, deletePillar, listPillars, reorderPillars, updatePillar } from "@/lib/data/planning";
import { tryGeneratePillars } from "@/lib/data/pipeline";
import { startPiece } from "@/lib/data/create";
import { enqueueJob, latestJob, startWorker } from "@/lib/jobs";

const refresh = (tenantId: string) => revalidatePath(`/w/${tenantId}`, "layout");

export async function createPillarAction(tenantId: string, name: string, description: string): Promise<string | null> {
  const scope = await actionScope(tenantId);
  if (!name.trim()) return null;
  const id = await createPillar(scope, name.trim(), description.trim());
  refresh(tenantId);
  return id;
}

export async function reorderPillarsAction(tenantId: string, ids: string[]) {
  const scope = await actionScope(tenantId);
  await reorderPillars(scope, ids.slice(0, 200));
  refresh(tenantId);
}

export async function updatePillarAction(tenantId: string, id: string, name: string, description: string) {
  const scope = await actionScope(tenantId);
  if (!name.trim()) return;
  await updatePillar(scope, id, name.trim(), description.trim());
  refresh(tenantId);
}

export async function deletePillarAction(tenantId: string, id: string) {
  const scope = await actionScope(tenantId);
  await deletePillar(scope, id);
  refresh(tenantId);
}

/** More pillars from the brief, with an optional focus. */
export async function regeneratePillarsAction(fd: FormData): Promise<void> {
  const tenantId = String(fd.get("tenantId"));
  const scope = await actionScope(tenantId);
  const count = Math.min(5, Math.max(1, Number(fd.get("count") ?? 3)));
  const focus = String(fd.get("focus") ?? "").slice(0, 500);
  const failed = await tryGeneratePillars(scope, { count, focus });
  refresh(tenantId);
  if (failed) redirect(`/w/${tenantId}/brand/pillars?${failedQuery(failed, { focus, count: String(count) })}`);
  redirect(`/w/${tenantId}/brand/pillars?generated=1`);
}

/**
 * Pillar generation that fails comes back to the page it started on, with
 * the reason, the person's input kept, and Try again (components/
 * generation-failed), instead of an error page (P2-3).
 */
function failedQuery(message: string, keep: Record<string, string> = {}, base = ""): string {
  const q = new URLSearchParams(base);
  q.set("failed", message.slice(0, 300));
  for (const [k, v] of Object.entries(keep)) if (v) q.set(k, v);
  return q.toString();
}

/** Try again, from any page's failure notice. Returns to that page with its success flag. */
export async function retryPillarsAction(fd: FormData): Promise<void> {
  const tenantId = String(fd.get("tenantId"));
  const scope = await actionScope(tenantId);
  const back = String(fd.get("back") ?? "");
  const ok = String(fd.get("ok") ?? "");
  // Only back into this workspace, and only a plain flag: never an open redirect.
  const home = `/w/${tenantId}/brand/pillars`;
  const path = back.startsWith(`/w/${tenantId}/`) && /^[\w/-]+$/.test(back) ? back : home;
  const flag = /^[a-z]+=[\w-]+(&[a-z]+=[\w-]+)*$/.test(ok) ? ok : "";
  const focus = String(fd.get("focus") ?? "").slice(0, 500);
  const count = fd.get("count") ? Math.min(5, Math.max(1, Number(fd.get("count")))) : undefined;
  const failed = await tryGeneratePillars(scope, count || focus ? { count: count ?? 3, focus } : undefined);
  refresh(tenantId);
  const keepBase = String(fd.get("keep") ?? "");
  const keep = /^[a-z]+=[\w-]+(&[a-z]+=[\w-]+)*$/.test(keepBase) ? keepBase : "";
  if (failed) redirect(`${path}?${failedQuery(failed, { focus, count: count ? String(count) : "" }, keep)}`);
  redirect(`${path}${flag ? `?${flag}` : ""}`);
}

/**
 * One drafted piece per pillar, each its own project (the client's rule). A
 * batch is well over the ~10 seconds a person should wait in a request, so it
 * is queued (lib/jobs, kind pillar_drafts): the page shows its progress, the
 * pieces already made are kept if it stops, and Try again carries on. A second
 * click while one is running shows that one instead of starting another.
 */
export async function draftFromPillarsAction(fd: FormData): Promise<void> {
  const tenantId = String(fd.get("tenantId"));
  const scope = await actionScope(tenantId);
  const format = String(fd.get("format") ?? "linkedin_post");
  const running = await latestJob(scope, "pillar_drafts");
  if (!running || !["queued", "running"].includes(running.status)) {
    const pillars = await listPillars(scope);
    if (pillars.length > 0) {
      await enqueueJob(scope, "pillar_drafts", { format, pillarIds: pillars.map((p) => p.id) }, { label: "Drafting from your pillars" });
      startWorker();
    }
  }
  refresh(tenantId);
  redirect(`/w/${tenantId}/brand/pillars`);
}

/** Start one piece from a pillar, at Ideate. */
export async function startFromPillarAction(tenantId: string, pillarName: string): Promise<string> {
  const scope = await actionScope(tenantId);
  const projectId = await startPiece(scope, { topic: pillarName, pillarName });
  refresh(tenantId);
  return `/w/${tenantId}/p/${projectId}/ideate`;
}
