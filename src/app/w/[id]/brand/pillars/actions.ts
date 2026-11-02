"use server";

/**
 * Pillars belong to the workspace (build step 3). Every piece draws on them;
 * none of them belongs to one piece.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionScope } from "@/lib/auth/workspace";
import { createPillar, deletePillar, listPillars, reorderPillars, updatePillar } from "@/lib/data/planning";
import { generatePillars } from "@/lib/data/pipeline";
import { generateContent } from "@/lib/data/content";
import { unlockStage } from "@/lib/data/projects";
import { startPiece } from "@/lib/data/create";
import { scoreProject } from "@/lib/data/check";
import { userMessage } from "@/lib/ai/errors";

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
  await generatePillars(scope, {
    count: Math.min(5, Math.max(1, Number(fd.get("count") ?? 3))),
    focus: String(fd.get("focus") ?? ""),
  });
  refresh(tenantId);
  redirect(`/w/${tenantId}/brand/pillars?generated=1`);
}

/**
 * One drafted piece per pillar. Each output is its own project (the client's
 * rule), so this creates one project per pillar rather than filling one.
 */
export async function draftFromPillarsAction(fd: FormData): Promise<void> {
  const tenantId = String(fd.get("tenantId"));
  const scope = await actionScope(tenantId);
  const format = String(fd.get("format") ?? "linkedin_post");
  const pillars = await listPillars(scope);
  // Sequential on purpose: each call is logged, and a failure (a cap, a rate
  // limit, the provider) stops the run but keeps the pieces already made;
  // the page says how many and why it stopped. There is no job queue yet.
  let drafted = 0;
  let stopped: string | null = null;
  for (const p of pillars) {
    const projectId = await startPiece(scope, { topic: `${p.name}: ${p.description ?? "what I've learned"}`, format, pillarName: p.name });
    const ps = { ...scope, projectId };
    try {
      await generateContent(ps, { format, topic: p.name, pillarId: p.id });
    } catch (e) {
      // The piece stays, at Ideate with its topic, ready to draft later.
      stopped = userMessage(e);
      break;
    }
    await scoreProject(ps).catch(() => undefined);
    await unlockStage(ps, "content");
    drafted++;
  }
  refresh(tenantId);
  redirect(`/w/${tenantId}/brand/pillars?${new URLSearchParams({ drafted: String(drafted), ...(stopped ? { stopped } : {}) })}`);
}

/** Start one piece from a pillar, at Ideate. */
export async function startFromPillarAction(tenantId: string, pillarName: string): Promise<string> {
  const scope = await actionScope(tenantId);
  const projectId = await startPiece(scope, { topic: pillarName, pillarName });
  refresh(tenantId);
  return `/w/${tenantId}/p/${projectId}/ideate`;
}
