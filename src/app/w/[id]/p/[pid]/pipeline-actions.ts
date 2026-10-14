"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionProjectScope } from "@/lib/auth/workspace";
import { deleteVisuals, generateContentFromPillars, generatePillars, generateVisuals, saveDesign } from "@/lib/data/pipeline";
import type { Design } from "@/lib/visual/design";
import { getProject } from "@/lib/data/projects";
import { stageIndex } from "@/lib/projects/stages";

async function ctx(fd: FormData) {
  const t = String(fd.get("tenantId"));
  const p = String(fd.get("projectId"));
  const scope = await actionProjectScope(t, p);
  const project = await getProject(scope, p);
  return { scope, project, base: `/w/${t}/p/${p}` };
}

/** Step 2 (again): add pillars with an optional focus, like Relume's "Generate sitemap" panel. */
export async function regeneratePillarsAction(fd: FormData): Promise<void> {
  const { scope, project, base } = await ctx(fd);
  if (!project) redirect(`${base}/brief/questions`);
  const n = await generatePillars(scope, {
    count: Math.min(5, Math.max(1, Number(fd.get("count") ?? 3))),
    focus: String(fd.get("focus") ?? ""),
  });
  revalidatePath(base, "layout");
  redirect(`${base}/pillars?added=${n}`);
}

/** Step 2 → 3: draft content from every pillar. */
export async function generateContentAction(fd: FormData): Promise<void> {
  const { scope, project, base } = await ctx(fd);
  if (!project) redirect(`${base}/brief/questions`);
  const perPillar = Math.min(3, Math.max(1, Number(fd.get("perPillar") ?? 1)));
  const n = await generateContentFromPillars(scope, {
    perPillar,
    format: String(fd.get("format") ?? "linkedin_post"),
    onlyEmpty: fd.get("onlyEmpty") === "on",
  });
  revalidatePath(base, "layout");
  redirect(`${base}/content?generated=${n}`);
}

/** Layout choice and live tweaks for one piece's visuals (and its scheme, when given). */
export async function saveDesignAction(tenantId: string, projectId: string, contentItemId: string, design: Design, scheme?: number): Promise<boolean> {
  const scope = await actionProjectScope(tenantId, projectId);
  const ok = await saveDesign(scope, contentItemId, design, scheme);
  revalidatePath(`/w/${tenantId}/p/${projectId}/visual`);
  return ok;
}

/** Remove one piece's visuals from the Visual step. Its copy is untouched. */
export async function deleteVisualsAction(tenantId: string, projectId: string, contentItemId: string): Promise<void> {
  const scope = await actionProjectScope(tenantId, projectId);
  await deleteVisuals(scope, contentItemId);
  revalidatePath(`/w/${tenantId}/p/${projectId}`, "layout");
}

/** Visuals: build the visual set from the drafts. */
export async function generateVisualsAction(fd: FormData): Promise<void> {
  const { scope, project, base } = await ctx(fd);
  if (!project || stageIndex(project.stage) < stageIndex("content")) redirect(`${base}/pillars`);
  const n = await generateVisuals(scope, {
    scheme: Math.max(0, Number(fd.get("scheme") ?? 0)),
    approvedOnly: fd.get("approvedOnly") === "on",
  });
  revalidatePath(base, "layout");
  redirect(`${base}/visual?generated=${n}`);
}
