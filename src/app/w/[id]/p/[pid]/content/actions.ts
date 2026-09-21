"use server";

import { revalidatePath } from "next/cache";
import { actionProjectScope } from "@/lib/auth/workspace";
import { unlockStage } from "@/lib/data/projects";
import { deleteContent, generateContent, regenerateWithSteer, updateContent, applyVariant, patchContent } from "@/lib/data/content";

const refresh = (tenantId: string, projectId: string) => revalidatePath(`/w/${tenantId}/p/${projectId}`, "layout");

/** Generate 2 variants from the brief; returns the new content_item id. */
export async function draftAction(tenantId: string, projectId: string, input: { format: string; topic: string; pillarId: string | null }) {
  const scope = await actionProjectScope(tenantId, projectId);
  const id = await generateContent(scope, input);
  await unlockStage(scope, "content").catch(() => undefined); // only moves on from Pillars
  refresh(tenantId, projectId);
  return id;
}

export async function steerAction(tenantId: string, projectId: string, itemId: string, steer: string) {
  const scope = await actionProjectScope(tenantId, projectId);
  await regenerateWithSteer(scope, itemId, steer);
  refresh(tenantId, projectId);
}

export async function applyVariantAction(tenantId: string, projectId: string, itemId: string, generationId: string) {
  const scope = await actionProjectScope(tenantId, projectId);
  await applyVariant(scope, itemId, generationId);
  refresh(tenantId, projectId);
}

export async function saveContentAction(
  tenantId: string,
  projectId: string,
  itemId: string,
  patch: { hook: string; body: string; cta: string; pillarId: string | null; status: "draft" | "edited" | "approved" },
) {
  const scope = await actionProjectScope(tenantId, projectId);
  await updateContent(scope, itemId, patch);
  refresh(tenantId, projectId);
}

/** Inline canvas edits (Content and Visual boards). */
export async function patchContentAction(
  tenantId: string,
  projectId: string,
  itemId: string,
  patch: { hook?: string; body?: string; cta?: string; pillarId?: string | null },
) {
  const scope = await actionProjectScope(tenantId, projectId);
  await patchContent(scope, itemId, patch);
  refresh(tenantId, projectId);
}

export async function deleteContentAction(tenantId: string, projectId: string, itemId: string) {
  const scope = await actionProjectScope(tenantId, projectId);
  await deleteContent(scope, itemId);
  refresh(tenantId, projectId);
}
