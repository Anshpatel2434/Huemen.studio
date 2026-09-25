"use server";

import { revalidatePath } from "next/cache";
import { actionProjectScope } from "@/lib/auth/workspace";
import { unlockStage } from "@/lib/data/projects";
import { deleteContent, generateContent, regenerateWithSteer, updateContent, applyVariant, patchContent, listContent } from "@/lib/data/content";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { checkDraft, type VoiceIssue, type ScoreBand } from "@/lib/voice/check";
import { EMPTY_INDEX } from "@/lib/voice/types";

export interface BrandCheckResult { score: number; band: ScoreBand; issues: VoiceIssue[] }

/**
 * On-brand check for a content item (design system §15.3/§15.4). Runs the draft
 * against the workspace voice index and returns the score, band and line-level
 * issues — publishing is never blocked, the band only decides what the UI leads
 * with.
 */
export async function checkContentItemAction(tenantId: string, projectId: string, itemId: string): Promise<BrandCheckResult> {
  const scope = await actionProjectScope(tenantId, projectId);
  const item = (await listContent(scope)).find((i) => i.id === itemId);
  if (!item) throw new Error("Content item not found");
  const text = [item.hook, item.body, item.cta].filter(Boolean).join("\n\n");
  const pack = await loadPackForWorkspace(scope);
  const r = checkDraft(text, pack?.index ?? EMPTY_INDEX, { corpusPieces: pack?.corpusStats.pieces ?? 0 });
  return { score: r.score, band: r.band, issues: r.issues };
}

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
