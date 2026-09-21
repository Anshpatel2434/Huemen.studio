"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionProjectScope } from "@/lib/auth/workspace";
import { generateContentFromPillars, generatePillars, generateVisuals } from "@/lib/data/pipeline";
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
  if (!project || stageIndex(project.stage) < stageIndex("pillars")) redirect(`${base}/brief/questions`);
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
  if (!project || stageIndex(project.stage) < stageIndex("pillars")) redirect(`${base}/brief/questions`);
  const perPillar = Math.min(3, Math.max(1, Number(fd.get("perPillar") ?? 1)));
  const n = await generateContentFromPillars(scope, {
    perPillar,
    format: String(fd.get("format") ?? "linkedin_post"),
    onlyEmpty: fd.get("onlyEmpty") === "on",
  });
  revalidatePath(base, "layout");
  redirect(`${base}/content?generated=${n}`);
}

/** Step 3 → 4: build the visual set from the drafts. */
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
