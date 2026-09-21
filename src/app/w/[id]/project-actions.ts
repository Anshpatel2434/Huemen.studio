"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { actionProjectScope, actionScope } from "@/lib/auth/workspace";
import { archiveProject, createProject, deleteProject, duplicateProjectBrief, renameProject, restoreProject, setProjectStar } from "@/lib/data/projects";
import { loadFoundation, saveFoundation } from "@/lib/data/foundation";
import { mergeIntake, parseIntake } from "@/lib/intake/parse";

/** New project → straight into its intake (the brief is step one). */
export async function createProjectAction(fd: FormData): Promise<void> {
  const tenantId = String(fd.get("tenantId"));
  const name = String(fd.get("name") ?? "").trim() || "Untitled project";
  const from = String(fd.get("fromProject") ?? "");
  if (from) {
    // Same person, new push: reuse a brief instead of re-briefing (the product's core idea).
    const id = await duplicateProjectBrief(await actionProjectScope(tenantId, from), name);
    revalidatePath(`/w/${tenantId}`);
    redirect(`/w/${tenantId}/p/${id}/brief/questions`);
  }
  const id = await createProject(await actionScope(tenantId), name, String(fd.get("description") ?? ""));
  revalidatePath(`/w/${tenantId}`);
  redirect(`/w/${tenantId}/p/${id}/intake`);
}

export async function renameProjectAction(tenantId: string, projectId: string, name: string) {
  if (!name.trim()) return;
  await renameProject(await actionProjectScope(tenantId, projectId), name.trim());
  revalidatePath(`/w/${tenantId}`, "layout");
}

export async function duplicateProjectAction(tenantId: string, projectId: string): Promise<string> {
  const scope = await actionProjectScope(tenantId, projectId);
  const id = await duplicateProjectBrief(scope, "New project (from brief)");
  revalidatePath(`/w/${tenantId}`, "layout");
  return id;
}

export async function archiveProjectAction(tenantId: string, projectId: string) {
  await archiveProject(await actionProjectScope(tenantId, projectId));
  revalidatePath(`/w/${tenantId}`, "layout");
}

/** Permanent: the project and everything in it. The UI asks the user to type the name first. */
export async function deleteProjectAction(tenantId: string, projectId: string) {
  await deleteProject(await actionProjectScope(tenantId, projectId));
  revalidatePath(`/w/${tenantId}`, "layout");
}

/**
 * The home hero: "describe your brand" → a new project whose brief is started
 * from the description. Labelled lines are parsed as in intake; a free-form
 * description becomes the positioning (and its first sentence the niche) so
 * nothing typed is lost. The questions step then fills the gaps.
 */
export async function createFromPromptAction(fd: FormData): Promise<void> {
  const tenantId = String(fd.get("tenantId"));
  const text = String(fd.get("prompt") ?? "").trim();
  if (!text) redirect(`/w/${tenantId}`);
  const parsed = parseIntake(text);
  const firstSentence = text.split(/(?<=[.!?])\s|\n/)[0].trim().slice(0, 80);
  if (parsed.placedCount === 0 || !parsed.fields.positioning) {
    if (!parsed.fields.niche) parsed.fields.niche = firstSentence;
    if (!parsed.fields.positioning) parsed.fields.positioning = parsed.unplaced || text;
    parsed.placedCount = Object.keys(parsed.fields).length;
  }
  const name = (parsed.fields.niche ?? firstSentence).slice(0, 60) || "Untitled project";
  const ws = await actionScope(tenantId);
  const id = await createProject(ws, name);
  const scope = { ...ws, projectId: id };
  await saveFoundation(scope, mergeIntake(await loadFoundation(scope), parsed));
  revalidatePath(`/w/${tenantId}`);
  redirect(`/w/${tenantId}/p/${id}/brief/questions?placed=${parsed.placedCount}`);
}

export async function starProjectAction(tenantId: string, projectId: string, starred: boolean) {
  await setProjectStar(await actionProjectScope(tenantId, projectId), starred);
  revalidatePath(`/w/${tenantId}`, "layout");
}

export async function restoreProjectAction(tenantId: string, projectId: string) {
  await restoreProject(await actionProjectScope(tenantId, projectId));
  revalidatePath(`/w/${tenantId}`, "layout");
}

/** Hide the "describe your brand" banner for this browser (a UI preference only). */
export async function dismissHeroAction(tenantId: string) {
  (await cookies()).set("huemen_hero", "0", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  revalidatePath(`/w/${tenantId}`);
}

/** The one-time "Projects are here" announcement (UI preference, per browser). */
export async function dismissWhatsNewAction() {
  (await cookies()).set("huemen_seen_projects", "1", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
}
