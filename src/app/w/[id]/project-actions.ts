"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { actionProjectScope, actionScope } from "@/lib/auth/workspace";
import { archiveProject, createProject, deleteProject, duplicateProject, renameProject, restoreProject, setProjectStar } from "@/lib/data/projects";
import { loadFoundation, saveFoundation } from "@/lib/data/foundation";
import { fillIntake, parseIntake } from "@/lib/intake/parse";

/**
 * New project → straight to Ideate. The brief is the workspace's and every
 * project writes from it, so there is nothing to fill in first. "Like a past
 * project" copies that one's format, platform, angle and pillar.
 */
export async function createProjectAction(fd: FormData): Promise<void> {
  const tenantId = String(fd.get("tenantId"));
  const name = String(fd.get("name") ?? "").trim() || "Untitled project";
  const from = String(fd.get("fromProject") ?? "");
  const id = from
    ? await duplicateProject(await actionProjectScope(tenantId, from), name)
    : await createProject(await actionScope(tenantId), name, String(fd.get("description") ?? ""));
  revalidatePath(`/w/${tenantId}`);
  redirect(`/w/${tenantId}/p/${id}/ideate`);
}

export async function renameProjectAction(tenantId: string, projectId: string, name: string) {
  if (!name.trim()) return;
  await renameProject(await actionProjectScope(tenantId, projectId), name.trim());
  revalidatePath(`/w/${tenantId}`, "layout");
}

export async function duplicateProjectAction(tenantId: string, projectId: string, name?: string): Promise<string> {
  const scope = await actionProjectScope(tenantId, projectId);
  const id = await duplicateProject(scope, name?.trim() || "New project");
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
 * The home hero: "describe your brand" → the workspace brief is started from
 * the description. Labelled lines are parsed as in intake; a free-form
 * description becomes the positioning (and its first sentence the niche) so
 * nothing typed is lost. It only FILLS what is empty: a brief already written
 * is never overwritten from here (the brief's own Paste notes page can). The
 * questions step then fills the gaps.
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
  const ws = await actionScope(tenantId);
  const { form, filled } = fillIntake(await loadFoundation(ws), parsed);
  if (filled > 0) await saveFoundation(ws, form);
  revalidatePath(`/w/${tenantId}`, "layout");
  redirect(`/w/${tenantId}/brand/questions?placed=${filled}`);
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
