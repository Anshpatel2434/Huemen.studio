"use server";

/**
 * Onboarding actions (Flow 1). Each one is small and saves immediately, so a
 * person can leave at any point and come back to exactly where they were.
 */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { actionActor } from "@/lib/auth/workspace";
import {
  answer, completeOnboarding, dropOpener, finishIngest, ingestPieces, markIngesting, requirePack, resolveCard, resumeStep,
  saveAbout, saveDials, setBenchmarks, setGuardrailRule, setNeverWords, setSources, setWorkMode, setWriteFor,
  updateOnboarding, type About,
} from "@/lib/data/onboarding";
import { LATER_COOKIE } from "./gate";
import { addSamples } from "@/lib/data/voice-pack";
import { generatePillars } from "@/lib/data/pipeline";
import { proposeTopics, startPiece, ownDraft, coWrite } from "@/lib/data/create";
import { generateContent, listContent } from "@/lib/data/content";
import { firstPieceStale } from "@/lib/voice/lifecycle";
import { getProject, unlockStage } from "@/lib/data/projects";
import { formatByKey, FORMATS } from "@/lib/content/formats";
import { saveBriefAnswers } from "@/lib/data/foundation";
import type { IngestedPiece } from "@/lib/voice/ingest";
import type { Answer } from "@/lib/voice/answers";
import type { DialKey, LanguageMix, Proof, Story, WorkMode } from "@/lib/voice/types";
import {
  pairsFor, previewFor, saveInfluences, saveLanguages, savePicks, saveProofs, saveStories, suggestAnswers, type DialPick,
} from "@/lib/data/enrich";
import { importFromUrl, WebImportError } from "@/lib/integrations/web";
import { userMessage } from "@/lib/ai/errors";

const refresh = (t: string) => revalidatePath(`/w/${t}`, "layout");

// ---- step 0: about you --------------------------------------------------------

/** Saves "About you" and opens the step they'd reached before (step 1 the first time). */
export async function aboutAction(tenantId: string, about: About) {
  const { scope, actor } = await actionActor(tenantId);
  await saveAbout(scope, actor, await requirePack(scope), about);
  refresh(tenantId);
  redirect(`/w/${tenantId}/onboarding?step=${resumeStep((await requirePack(scope)).onboarding)}`);
}

/**
 * "Finish later": the studio opens for the rest of this sitting. The next
 * sign-in brings them back to the step they reached, so later never becomes never.
 */
export async function finishLaterAction(tenantId: string) {
  await actionActor(tenantId);
  (await cookies()).set(LATER_COOKIE, tenantId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 8 * 60 * 60 });
  redirect(`/w/${tenantId}`);
}

// ---- step 1: add samples ------------------------------------------------------

export async function saveSourcesAction(tenantId: string, sources: string[], writeFor: string[]) {
  const { scope, actor } = await actionActor(tenantId);
  const pack = await requirePack(scope);
  await setSources(scope, pack, sources);
  await setWriteFor(scope, actor, await requirePack(scope), writeFor);
  refresh(tenantId);
}

/**
 * One file or paste at a time, so the browser can show real per-file progress
 * (design system §15.2: "Determinate progress, per file").
 */
export async function ingestAction(tenantId: string, pieces: IngestedPiece[], source: "paste" | "upload" | "export") {
  const { scope } = await actionActor(tenantId);
  const pack = await requirePack(scope);
  // Bounded per call: a mailbox export is sampled, never hoarded (file 06 §1).
  const added = await ingestPieces(scope, pack, pieces.slice(0, 400), source);
  // The heartbeat: a batch that stops arriving was interrupted (lifecycle `ingestStalled`).
  await markIngesting(scope, await requirePack(scope));
  return added;
}

/**
 * A batch cut off by a reload or a closed tab: what arrived is saved but not
 * measured. Measure it now, so the checkpoint is "everything that landed".
 */
export async function resumeIngestAction(tenantId: string) {
  const { scope } = await actionActor(tenantId);
  const pack = await requirePack(scope);
  if (pack.onboarding.scan?.state !== "ingesting") return null;
  const result = await finishIngest(scope, pack);
  refresh(tenantId);
  return { pieces: result.stats.pieces };
}

/** "Learning": re-measure everything once the batch is in. */
export async function finishIngestAction(tenantId: string) {
  const { scope } = await actionActor(tenantId);
  const result = await finishIngest(scope, await requirePack(scope));
  refresh(tenantId);
  return { pieces: result.stats.pieces, words: result.stats.words, changes: result.changes };
}

/** G5: not much writing yet. Three spoken answers, typed or transcribed. */
export async function voiceNotesAction(tenantId: string, notes: string[]) {
  const { scope } = await actionActor(tenantId);
  const pack = await requirePack(scope);
  const bodies = notes.map((n) => n.trim()).filter((n) => n.split(/\s+/).length >= 10);
  await addSamples(scope, pack.id, bodies.map((body) => ({ body, channel: "spoken", kind: "spoken" as const, source: "voice_note" as const })));
  await finishIngest(scope, await requirePack(scope));
  refresh(tenantId);
  return bodies.length;
}

// ---- step 2: confirm your voice ----------------------------------------------

export async function answerAction(tenantId: string, questionId: string, value: Answer) {
  const { scope, actor } = await actionActor(tenantId);
  await answer(scope, actor, await requirePack(scope), questionId, value);
  refresh(tenantId);
}

export async function dialsAction(tenantId: string, dials: Partial<Record<DialKey, number>>) {
  const { scope, actor } = await actionActor(tenantId);
  await saveDials(scope, actor, await requirePack(scope), dials);
  refresh(tenantId);
}

export async function cardAction(tenantId: string, cardId: string, option: string, dropItems: string[] = []) {
  const { scope, actor } = await actionActor(tenantId);
  await resolveCard(scope, actor, await requirePack(scope), cardId, option, dropItems);
  refresh(tenantId);
}

export async function benchmarksAction(tenantId: string, sampleIds: string[]) {
  const { scope } = await actionActor(tenantId);
  await setBenchmarks(scope, await requirePack(scope), sampleIds);
  refresh(tenantId);
}

export async function goToStepAction(tenantId: string, step: number) {
  const { scope } = await actionActor(tenantId);
  await updateOnboarding(scope, await requirePack(scope), { step });
  refresh(tenantId);
  redirect(`/w/${tenantId}/onboarding?step=${step}`);
}

// ---- step 3: set your hue ----------------------------------------------------

/**
 * Pillars from the brief and the strategy answers. `intent=next` saves the
 * answers and moves on to the payoff, so Continue never drops what was typed.
 */
export async function hueAction(fd: FormData) {
  const tenantId = String(fd.get("tenantId"));
  const { scope } = await actionActor(tenantId);
  const answers = (["known_for", "contrarian", "questions"] as const)
    .map((key) => ({ key, question: key, answer: String(fd.get(key) ?? "").trim() }))
    .filter((a) => a.answer);
  if (answers.length) await saveBriefAnswers(scope, answers);
  const intent = fd.get("intent");
  if (intent === "pillars") await generatePillars(scope);
  if (intent === "next") await updateOnboarding(scope, await requirePack(scope), { step: 4 });
  refresh(tenantId);
  redirect(`/w/${tenantId}/onboarding?step=${intent === "next" ? 4 : 3}${intent === "pillars" ? "&pillars=1" : ""}`);
}

// ---- step 4: the payoff --------------------------------------------------------

/**
 * The first piece: on a topic from their own core, for the first platform they
 * chose, written the way they chose to work. It becomes their first project.
 * Made once: a reload shows the same piece rather than making another.
 */
export async function firstPieceAction(tenantId: string): Promise<string> {
  const { scope } = await actionActor(tenantId);
  let pack = await requirePack(scope);
  const o = pack.onboarding;
  if (o.firstProjectId) {
    // Being written by a request that's still alive (a reload mid-write lands
    // here): the same piece, never a second one.
    if (o.firstPiece?.state === "writing" && !firstPieceStale(o.firstPiece, Date.now())) return o.firstProjectId;
    // Already written, or theirs to write: nothing to do.
    const hasDraft = (await listContent({ ...scope, projectId: o.firstProjectId })).length > 0;
    if (hasDraft || pack.workMode === "check") return o.firstProjectId;
    // Otherwise the write failed or died: try again, into the same project.
  }

  const platform = o.writeFor?.[0] ?? "linkedin";
  const format = FORMATS.find((f) => f.platform === platform)?.key ?? "linkedin_post";
  let projectId = o.firstProjectId ?? null;
  let topicTitle = projectId ? (await getProject(scope, projectId))?.name ?? "" : "";
  if (!projectId) {
    const [topic] = await proposeTopics(scope);
    topicTitle = topic?.title ?? "What I'd tell myself starting out";
    projectId = await startPiece(scope, { topic: topicTitle, format, pillarName: topic?.pillar });
    await unlockStage({ ...scope, projectId }, "content");
  }
  // The checkpoint goes down before the slow part.
  await updateOnboarding(scope, pack, { firstProjectId: projectId, step: 4, firstPiece: { state: "writing", at: new Date().toISOString() } });
  pack = await requirePack(scope);

  const p = { ...scope, projectId };
  const pillarId = (await getProject(p, projectId))?.pillarId ?? null;
  try {
    if (pack.workMode === "cowrite") {
      await coWrite(p, { format, topic: topicTitle, pillarId });
    } else if (pack.workMode === "ghostwrite") {
      await generateContent(p, { format, topic: topicTitle, pillarId });
    }
    // "Check mine" makes no draft: the person writes, and the check reads it.
    await updateOnboarding(scope, await requirePack(scope), { firstPiece: { state: "done", at: new Date().toISOString() } });
  } catch (e) {
    await updateOnboarding(scope, await requirePack(scope), { firstPiece: { state: "failed", at: new Date().toISOString() } });
    refresh(tenantId);
    throw e;
  }
  refresh(tenantId);
  return projectId;
}

export async function workModeAction(tenantId: string, mode: WorkMode) {
  const { scope, actor } = await actionActor(tenantId);
  await setWorkMode(scope, actor, await requirePack(scope), mode);
  refresh(tenantId);
}

/**
 * "Yes, that's me": the last item on the spec's definition of done, and the
 * end of the flow. They land in their studio, with their first piece in it.
 */
export async function finishOnboardingAction(fd: FormData) {
  const tenantId = String(fd.get("tenantId"));
  const { scope } = await actionActor(tenantId);
  const pack = await requirePack(scope);
  await completeOnboarding(scope, pack);
  (await cookies()).delete(LATER_COOKIE);
  refresh(tenantId);
  redirect(`/w/${tenantId}?ready=1`);
}

/** Their own writing, checked: shown on the payoff screen. */
export async function ownDraftForFirstPieceAction(tenantId: string, text: string) {
  const { scope } = await actionActor(tenantId);
  const pack = await requirePack(scope);
  const projectId = pack.onboarding.firstProjectId;
  if (!projectId || !text.trim()) return;
  const format = FORMATS.find((f) => f.platform === (pack.onboarding.writeFor?.[0] ?? "linkedin"))?.key ?? "linkedin_post";
  await ownDraft({ ...scope, projectId }, { format: formatByKey(format).key, topic: "", text });
  refresh(tenantId);
}

// ---- training state, and the Voice Mirror edited in place ---------------------

/** §15.2 "Ingesting": set when the browser starts reading files. */
export async function markIngestingAction(tenantId: string) {
  const { scope } = await actionActor(tenantId);
  await markIngesting(scope, await requirePack(scope));
}

export async function neverWordsAction(tenantId: string, words: string[]) {
  const { scope, actor } = await actionActor(tenantId);
  await setNeverWords(scope, actor, await requirePack(scope), words);
  refresh(tenantId);
}

export async function dropOpenerAction(tenantId: string, example: string) {
  const { scope, actor } = await actionActor(tenantId);
  await dropOpener(scope, actor, await requirePack(scope), example);
  refresh(tenantId);
}

export async function guardrailAction(tenantId: string, id: string, rule: string) {
  const { scope, actor } = await actionActor(tenantId);
  await setGuardrailRule(scope, actor, await requirePack(scope), id, rule);
  refresh(tenantId);
}

// ---- asking less, learning more ------------------------------------------------

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof WebImportError ? e.message : userMessage(e) };
  }
}

/** Core answers proposed from their writing and brief, as one-tap confirms. */
export async function suggestionsAction(tenantId: string, force = false) {
  const { scope } = await actionActor(tenantId);
  const r = await attempt(async () => suggestAnswers(scope, await requirePack(scope), { force }));
  refresh(tenantId);
  return r;
}

export async function pairsAction(tenantId: string) {
  const { scope } = await actionActor(tenantId);
  return attempt(async () => pairsFor(scope, await requirePack(scope)));
}

export async function picksAction(tenantId: string, picks: DialPick[]) {
  const { scope, actor } = await actionActor(tenantId);
  await savePicks(scope, actor, await requirePack(scope), picks);
  refresh(tenantId);
}

/** The live preview: one paragraph in their voice as it stands right now. */
export async function previewAction(tenantId: string) {
  const { scope } = await actionActor(tenantId);
  return attempt(async () => previewFor(scope, await requirePack(scope)));
}

export async function storiesAction(tenantId: string, stories: Story[]) {
  const { scope, actor } = await actionActor(tenantId);
  await saveStories(scope, actor, await requirePack(scope), stories);
  refresh(tenantId);
}

export async function proofsAction(tenantId: string, proofs: Proof[]) {
  const { scope, actor } = await actionActor(tenantId);
  await saveProofs(scope, actor, await requirePack(scope), proofs);
  refresh(tenantId);
}

export async function influencesAction(tenantId: string, v: { admire: string[]; avoid: string[] }) {
  const { scope, actor } = await actionActor(tenantId);
  await saveInfluences(scope, actor, await requirePack(scope), v);
  refresh(tenantId);
}

export async function languagesAction(tenantId: string, v: LanguageMix) {
  const { scope, actor } = await actionActor(tenantId);
  await saveLanguages(scope, actor, await requirePack(scope), v);
  refresh(tenantId);
}

/**
 * Their own writing from links: a website, blog, Substack, Medium or a podcast
 * feed with transcripts. One link at a time so the page can show progress.
 */
export async function importUrlAction(tenantId: string, url: string) {
  const { scope } = await actionActor(tenantId);
  return attempt(async () => {
    const pack = await requirePack(scope);
    const { pieces, note } = await importFromUrl(url);
    const added = await addSamples(
      scope,
      pack.id,
      pieces.map((p) => ({ body: p.body, channel: p.channel, visibility: "public" as const, source: "url" as const, publishedAt: p.publishedAt, externalId: p.externalId, note: p.title })),
    );
    return { added, found: pieces.length, note };
  });
}
