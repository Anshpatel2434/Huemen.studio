"use server";

import { revalidatePath } from "next/cache";
import { actionProjectScope } from "@/lib/auth/workspace";
import { getProject, unlockStage } from "@/lib/data/projects";
import { deleteContent, generateContent, regenerateWithSteer, updateContent, applyVariant, patchContent, listContent } from "@/lib/data/content";
import { judgeText, rewriteText, scoreContentItem, scoreProject } from "@/lib/data/check";
import type { JudgeResult } from "@/lib/ai/tasks";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { recordEdit } from "@/lib/data/training";
import { coWrite, ownDraft } from "@/lib/data/create";
import { userMessage } from "@/lib/ai/errors";
import type { ProjectScope } from "@/lib/data/projects";
import { formatByKey } from "@/lib/content/formats";
import type { VoiceIssue, ScoreBand } from "@/lib/voice/check";

export interface BrandCheckResult { score: number; band: ScoreBand; issues: VoiceIssue[] }

/**
 * On-brand check for a content item (design system §15.3/§15.4). Runs the draft
 * against the workspace voice index and returns the score, band and line-level
 * issues — publishing is never blocked, the band only decides what the UI leads
 * with.
 */
export async function checkContentItemAction(tenantId: string, projectId: string, itemId: string): Promise<BrandCheckResult> {
  const scope = await actionProjectScope(tenantId, projectId);
  // Checked against the format's platform, and remembered on the piece (0012).
  const r = await scoreContentItem(scope, itemId);
  if (!r) throw new Error("Content item not found");
  return { score: r.score, band: r.band, issues: r.issues };
}

const refresh = (tenantId: string, projectId: string) => revalidatePath(`/w/${tenantId}/p/${projectId}`, "layout");

/**
 * After the copy changes: re-score it (0012) so the Library's band filter stays
 * true, then refresh. Best effort: a failed score never loses the change.
 */
async function settle(scope: ProjectScope, tenantId: string, projectId: string) {
  await scoreProject(scope).catch(() => undefined);
  refresh(tenantId, projectId);
}

const draftText = (i: { hook: string | null; body: string | null; cta: string | null }) =>
  [i.hook, i.body, i.cta].filter(Boolean).join("\n");

/**
 * Edits are training (spec file 01 §4): count what the person took out of a
 * draft. Best effort — a failure here must never lose the edit itself.
 */
async function learnFromEdit(scope: ProjectScope, itemId: string, save: () => Promise<void>) {
  const before = (await listContent(scope)).find((i) => i.id === itemId);
  await save();
  if (!before) return;
  try {
    const after = (await listContent(scope)).find((i) => i.id === itemId);
    const pack = await loadPackForWorkspace(scope);
    if (after && pack) await recordEdit(scope, pack, draftText(before), draftText(after));
  } catch {
    /* training is a side effect; the edit has already been saved */
  }
}

/** Generate 2 variants from the brief; returns the new content_item id. */
export async function draftAction(tenantId: string, projectId: string, input: { format: string; topic: string; pillarId: string | null }) {
  const scope = await actionProjectScope(tenantId, projectId);
  const id = await generateContent(scope, input);
  await unlockStage(scope, "content").catch(() => undefined); // only moves on from Pillars
  await settle(scope, tenantId, projectId);
  return id;
}

export async function steerAction(tenantId: string, projectId: string, itemId: string, steer: string) {
  const scope = await actionProjectScope(tenantId, projectId);
  await regenerateWithSteer(scope, itemId, steer);
  await settle(scope, tenantId, projectId);
}

export async function applyVariantAction(tenantId: string, projectId: string, itemId: string, generationId: string) {
  const scope = await actionProjectScope(tenantId, projectId);
  await applyVariant(scope, itemId, generationId);
  await settle(scope, tenantId, projectId);
}

export async function saveContentAction(
  tenantId: string,
  projectId: string,
  itemId: string,
  patch: { hook: string; body: string; cta: string; pillarId: string | null; status: "draft" | "edited" | "approved" },
) {
  const scope = await actionProjectScope(tenantId, projectId);
  await learnFromEdit(scope, itemId, () => updateContent(scope, itemId, patch));
  await settle(scope, tenantId, projectId);
}

/** Inline canvas edits (Content and Visual boards). */
export async function patchContentAction(
  tenantId: string,
  projectId: string,
  itemId: string,
  patch: { hook?: string; body?: string; cta?: string; pillarId?: string | null },
) {
  const scope = await actionProjectScope(tenantId, projectId);
  await learnFromEdit(scope, itemId, () => patchContent(scope, itemId, patch));
  await settle(scope, tenantId, projectId);
}

export async function deleteContentAction(tenantId: string, projectId: string, itemId: string) {
  const scope = await actionProjectScope(tenantId, projectId);
  await deleteContent(scope, itemId);
  refresh(tenantId, projectId);
}

// ---- F2: the three ways to write a piece (spec file 05, F2) -------------------

type Outcome = { ok: true; id: string } | { ok: false; error: string };

/** The pillar picked at Ideate: the draft sits under it from the start. */
async function pillarOf(scope: ProjectScope): Promise<string | null> {
  return (await getProject(scope, scope.projectId))?.pillarId ?? null;
}

async function attempt(fn: () => Promise<string>): Promise<Outcome> {
  try {
    return { ok: true, id: await fn() };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}

/** Ghostwrite: a full draft in their voice. */
export async function ghostwriteAction(tenantId: string, projectId: string, input: { format: string; topic: string }): Promise<Outcome> {
  const scope = await actionProjectScope(tenantId, projectId);
  const r = await attempt(async () => {
    const id = await generateContent(scope, { ...input, pillarId: await pillarOf(scope) });
    await unlockStage(scope, "content").catch(() => undefined);
    return id;
  });
  await settle(scope, tenantId, projectId);
  return r;
}

/** Co-write: a hook and the beats; the sentences are theirs. */
export async function coWriteAction(tenantId: string, projectId: string, input: { format: string; topic: string; angle: string | null }): Promise<Outcome> {
  const scope = await actionProjectScope(tenantId, projectId);
  const r = await attempt(async () => coWrite(scope, { ...input, pillarId: await pillarOf(scope) }));
  await settle(scope, tenantId, projectId);
  return r;
}

/** Check mine: their own writing, stored unchanged, then checked. */
export async function ownDraftAction(tenantId: string, projectId: string, input: { format: string; topic: string; text: string }): Promise<Outcome> {
  const scope = await actionProjectScope(tenantId, projectId);
  if (!input.text.trim()) return { ok: false, error: "Paste or write the piece first." };
  const r = await attempt(async () => ownDraft(scope, { ...input, pillarId: await pillarOf(scope) }));
  await settle(scope, tenantId, projectId);
  return r;
}

// ---- the judgement half of the in-project check (§15.4) -----------------------

const draftOf = (i: { hook: string | null; body: string | null; cta: string | null }) =>
  [i.hook, i.body, i.cta].filter(Boolean).join("\n\n");

/** Line findings with a fix in their voice, for one piece. A model call. */
export async function judgeContentItemAction(
  tenantId: string, projectId: string, itemId: string,
): Promise<{ ok: true; findings: JudgeResult["findings"] } | { ok: false; error: string }> {
  const scope = await actionProjectScope(tenantId, projectId);
  const item = (await listContent(scope)).find((i) => i.id === itemId);
  if (!item) return { ok: false, error: "That piece is gone." };
  try {
    return { ok: true, findings: await judgeText(scope, draftOf(item), formatByKey(item.format).platform) };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}

/**
 * Apply one suggested fix where the line stands. The person chose it, but the
 * words are the model's, so it is not counted as an edit to learn from.
 */
export async function applyFixAction(tenantId: string, projectId: string, itemId: string, line: string, fix: string): Promise<boolean> {
  const scope = await actionProjectScope(tenantId, projectId);
  const item = (await listContent(scope)).find((i) => i.id === itemId);
  if (!item) return false;
  const patch: { hook?: string; body?: string; cta?: string } = {};
  for (const k of ["hook", "body", "cta"] as const) {
    if (!patch.hook && !patch.body && !patch.cta && item[k]?.includes(line)) patch[k] = item[k]!.replace(line, fix);
  }
  if (!Object.keys(patch).length) return false;
  await patchContent(scope, itemId, patch);
  await settle(scope, tenantId, projectId);
  return true;
}

/** Off brand: the whole piece rewritten in their voice, in place. */
export async function rewriteContentItemAction(
  tenantId: string, projectId: string, itemId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const scope = await actionProjectScope(tenantId, projectId);
  const item = (await listContent(scope)).find((i) => i.id === itemId);
  if (!item) return { ok: false, error: "That piece is gone." };
  try {
    // Hook and body only: the call to action is a separate field and stays theirs.
    const text = await rewriteText(scope, draftOf({ ...item, cta: null }), formatByKey(item.format).platform);
    const lines = text.split("\n");
    const hook = (lines.shift() ?? "").trim();
    await patchContent(scope, itemId, { hook, body: lines.join("\n").trim(), cta: item.cta });
    await settle(scope, tenantId, projectId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}
