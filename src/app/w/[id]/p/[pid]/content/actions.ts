"use server";

import { revalidatePath } from "next/cache";
import { actionProjectScope } from "@/lib/auth/workspace";
import { getSession } from "@/lib/auth";
import { learnFromApproval } from "@/lib/data/learning";
import { getProject, unlockStage } from "@/lib/data/projects";
import {
  deleteContent, generateContent, regenerateWithSteer, updateContent, ContentConflictError, ContentNotFoundError, applyVariant, patchContent,
  listContent, rewritePartOf, stampContentItem, keepCurrentVersion, recordRewrite,
} from "@/lib/data/content";
import { judgeText, rewriteTextStamped, scoreContentItem, scoreProject } from "@/lib/data/check";
import type { LineFinding } from "@/lib/ai/tasks";
import { applyFinding, blockedRewriteMessage, UnsupportedRewriteError } from "@/lib/voice/judge";
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
  // The angle is read here, from the piece as it was set up at Ideate, not sent by the browser.
  const id = await generateContent(scope, { ...input, angle: await angleOf(scope) });
  await unlockStage(scope, "content").catch(() => undefined); // only moves on from Pillars
  await settle(scope, tenantId, projectId);
  return id;
}

/** A refusal (monthly cap, rate limit, provider) comes back as words to show; a thrown message never reaches the browser in production. */
export async function steerAction(tenantId: string, projectId: string, itemId: string, steer: string): Promise<{ error?: string }> {
  const scope = await actionProjectScope(tenantId, projectId);
  try {
    await regenerateWithSteer(scope, itemId, steer);
  } catch (e) {
    // A steer that adds a claim the brand context does not back is not saved; the message says what it adds.
    if (e instanceof UnsupportedRewriteError) return { error: e.message };
    return { error: e instanceof ContentNotFoundError ? e.message : userMessage(e) };
  }
  await settle(scope, tenantId, projectId);
  return {};
}

export async function applyVariantAction(tenantId: string, projectId: string, itemId: string, generationId: string): Promise<{ error?: string }> {
  const scope = await actionProjectScope(tenantId, projectId);
  try {
    await applyVariant(scope, itemId, generationId);
  } catch (e) {
    // A version or piece that isn't here (deleted in another tab, a bad id) is said plainly, not thrown.
    if (e instanceof ContentNotFoundError) return { error: "That version isn't here any more. Reload to see what is." };
    throw e;
  }
  await settle(scope, tenantId, projectId);
  return {};
}

export async function saveContentAction(
  tenantId: string,
  projectId: string,
  itemId: string,
  patch: { hook: string; body: string; cta: string; pillarId: string | null; status: "draft" | "edited" | "approved" },
  base?: { hook: string; body: string; cta: string } | null,
): Promise<{ learned: boolean; why: string; remeasured: boolean } | { conflict: string } | null> {
  const scope = await actionProjectScope(tenantId, projectId);
  try {
    await learnFromEdit(scope, itemId, () => updateContent(scope, itemId, patch, base));
  } catch (e) {
    if (e instanceof ContentConflictError) return { conflict: e.message };
    throw e;
  }
  // Approval is where the voice learns: the owner's own words teach it, the
  // model's words don't (lib/voice/learn). Best effort, like edit learning.
  let learned: { learned: boolean; why: string; remeasured: boolean } | null = null;
  if (patch.status === "approved") {
    const session = await getSession();
    if (session) {
      const out = await learnFromApproval(scope, { userId: session.userId, role: session.role }, itemId).catch(() => null);
      if (out) learned = { learned: out.learn, why: out.why, remeasured: out.remeasured };
    }
  }
  await settle(scope, tenantId, projectId);
  return learned;
}

/** Inline canvas edits (Content and Visual boards). */
export async function patchContentAction(
  tenantId: string,
  projectId: string,
  itemId: string,
  patch: { hook?: string; body?: string; cta?: string; pillarId?: string | null },
  opts: {
    learn?: boolean;
    base?: { hook?: string; body?: string; cta?: string } | null;
    /** The patch is a model rewrite the person asked for, in these words: the history says so. */
    rewrite?: string;
  } = {},
): Promise<{ conflict: string } | void> {
  const scope = await actionProjectScope(tenantId, projectId);
  const rewrite = typeof opts.rewrite === "string" ? opts.rewrite.trim().slice(0, 120) : "";
  try {
    if (rewrite) {
      // Whatever was typed since the last version is kept before the rewrite
      // replaces it, and the rewrite is listed as one, not as "Edited by you".
      await keepCurrentVersion(scope, itemId);
      await patchContent(scope, itemId, patch, opts.base);
      await recordRewrite(scope, itemId, rewrite, null);
    } else if (opts.learn === false) await patchContent(scope, itemId, patch, opts.base);
    else await learnFromEdit(scope, itemId, () => patchContent(scope, itemId, patch, opts.base));
  } catch (e) {
    if (!(e instanceof ContentConflictError)) throw e;
    await settle(scope, tenantId, projectId);
    return { conflict: e.message };
  }
  await settle(scope, tenantId, projectId);
}

/**
 * Select and instruct: one part of a piece (a hook, the body, a slide, the
 * call to action), rewritten the way the person asked, in their voice. Only
 * RETURNS the new text: the canvas commits it through the same edit path as
 * typing (patchContentAction), so undo, the "edited" status and learning
 * from edits all behave exactly as if they had typed it. The words are the
 * model's, though, so the canvas marks the commit as not-to-learn-from.
 */
export async function askRewriteAction(
  tenantId: string,
  projectId: string,
  itemId: string,
  ask: { part: string; text: string; instruction: string },
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const scope = await actionProjectScope(tenantId, projectId);
  const instruction = ask.instruction.trim().slice(0, 300);
  if (!instruction) return { ok: false, error: "Say what to change first." };
  try {
    const text = await rewritePartOf(scope, itemId, { part: ask.part.slice(0, 40), text: ask.text.slice(0, 4000), instruction });
    return text ? { ok: true, text } : { ok: false, error: "That piece is gone." };
  } catch (e) {
    // The canvas commits only an ok rewrite, so a blocked one leaves the piece as it was.
    if (e instanceof UnsupportedRewriteError) return { ok: false, error: e.message };
    return { ok: false, error: userMessage(e) };
  }
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

/** The angle picked at Ideate: binding on every draft of this piece (lib/ai/prompt). */
async function angleOf(scope: ProjectScope): Promise<string | null> {
  return (await getProject(scope, scope.projectId))?.angle ?? null;
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
    const project = await getProject(scope, scope.projectId);
    const id = await generateContent(scope, { ...input, pillarId: project?.pillarId ?? null, angle: project?.angle ?? null });
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
): Promise<{ ok: true; findings: LineFinding[] } | { ok: false; error: string }> {
  const scope = await actionProjectScope(tenantId, projectId);
  const item = (await listContent(scope)).find((i) => i.id === itemId);
  if (!item) return { ok: false, error: "That piece is gone." };
  try {
    // Logged against the piece it reads (generation_logs.content_item_id).
    return { ok: true, findings: await judgeText(scope, draftOf(item), formatByKey(item.format).platform, itemId, item.topic) };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}

export type AppliedFix = { ok: true; field: "hook" | "body" | "cta"; before: string; after: string } | { ok: false };

/**
 * Apply one suggested fix where the line stands (or cut the line, when that
 * is the suggestion). The person chose it, but the words are the model's, so
 * it is not counted as an edit to learn from. Returns the field as it was
 * and as it is now, so the canvas can put it on its undo history.
 */
export async function applyFixAction(
  tenantId: string, projectId: string, itemId: string, finding: { line: string; fix: string; remove: boolean },
): Promise<AppliedFix> {
  const scope = await actionProjectScope(tenantId, projectId);
  const item = (await listContent(scope)).find((i) => i.id === itemId);
  if (!item) return { ok: false };
  const f = { line: String(finding.line ?? ""), fix: String(finding.fix ?? "").slice(0, 4000), remove: finding.remove === true };
  for (const field of ["hook", "body", "cta"] as const) {
    const after = applyFinding(item[field], f);
    // A hook can't be cut to nothing: that finding is for the person to handle.
    if (after === null || (field === "hook" && !after.trim())) continue;
    await keepCurrentVersion(scope, itemId);
    await patchContent(scope, itemId, { [field]: after });
    await recordRewrite(scope, itemId, f.remove ? "a line cut" : "a line fix", null);
    await settle(scope, tenantId, projectId);
    return { ok: true, field, before: item[field], after };
  }
  return { ok: false };
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
    // The piece's brief goes with it: its topic and angle are binding on a rewrite too (M4).
    const { text, template, model, unsupported } = await rewriteTextStamped(
      scope, draftOf({ ...item, cta: null }), formatByKey(item.format).platform, itemId,
      { topic: item.topic, angle: await angleOf(scope) },
    );
    // A rewrite that adds a claim the brand context does not back is not saved: the piece keeps its text (C2).
    if (unsupported.length) return { ok: false, error: blockedRewriteMessage(unsupported) };
    const lines = text.trim().split("\n");
    const hook = (lines.shift() ?? "").trim();
    if (!hook) return { ok: false, error: "The rewrite came back empty. Nothing was changed." };
    // What is there now (typed edits included) stays in History; the rewrite
    // is then listed as a rewrite, with the model that wrote it.
    await keepCurrentVersion(scope, itemId);
    await patchContent(scope, itemId, { hook, body: lines.join("\n").trim(), cta: item.cta });
    await stampContentItem(scope, itemId, { templateId: template.id, version: template.version });
    await recordRewrite(scope, itemId, "in my voice", model);
    await settle(scope, tenantId, projectId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}
