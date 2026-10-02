/**
 * Onboarding that asks less and learns more:
 *
 *   suggestAnswers  one pass over what they've already given us (their public
 *                   writing, spoken answers, the brief and the pre-workshop
 *                   questionnaire) proposes Core answers as one-tap confirms.
 *   pairsFor        "this or that": twin lines per dial, generated once.
 *   savePicks       their picks set the dials and become paired examples.
 *   previewFor      one paragraph rewritten in their voice, refreshed as the
 *                   pack changes: the reason to keep answering.
 *   saveStories / saveProofs / saveInfluences / saveLanguages
 *                   what a draft needs and can't invent.
 *
 * Private writing never goes into the pre-fill pass: suggestions are stored on
 * the pack, and a pack's onboarding state is visible to the coach.
 *
 * Server-only.
 */
import "server-only";
import { runTask } from "@/lib/ai";
import { dialPairs, extractAnswers, PREFILL_IDS, previewSource, voicePreview } from "@/lib/ai/tasks";
import { loadBrandContext } from "@/lib/context/context-loader";
import { loadFoundation } from "./foundation";
import { listSamples } from "./voice-pack";
import { updateOnboarding } from "./onboarding";
import { writePack, type Actor } from "./training";
import type { WorkspaceScope } from "./projects";
import { applyDials } from "@/lib/voice/answers";
import { estimateDials } from "@/lib/voice/derive";
import {
  DIAL_KEYS, DIAL_LABELS, tagged,
  type DialKey, type LanguageMix, type Preference, type Proof, type Story, type VoicePack,
} from "@/lib/voice/types";

const words = (s: string, n: number) => s.split(/\s+/).slice(0, n).join(" ");

/** What the pre-fill and the pairs were made from. New writing or a changed brief earns a fresh pass. */
export function basisFrom(pieces: number, f: { niche: string; audience: string; positioning: string; offers: string }): string {
  const brief = [f.niche, f.audience, f.positioning, f.offers].join("|");
  let h = 0;
  for (const ch of brief) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `${pieces}:${h}`;
}

async function basisOf(scope: WorkspaceScope, pack: VoicePack) {
  const f = await loadFoundation(scope);
  return { basis: basisFrom(pack.corpusStats.pieces, f), foundation: f };
}

// ---- pre-fill ---------------------------------------------------------------------

export async function suggestAnswers(scope: WorkspaceScope, pack: VoicePack, opts: { force?: boolean } = {}) {
  const { basis, foundation: f } = await basisOf(scope, pack);
  const cached = pack.onboarding.suggestions;
  if (!opts.force && cached?.basis === basis) return cached.answers;

  const samples = (await listSamples(scope, pack.id)).filter((s) => s.visibility === "public").slice(0, 12);
  const story = f.chapters.filter((c) => c.body.trim()).map((c) => `${c.title}: ${c.body}`).join(" / ");
  const brief = [
    f.niche ? `Niche: ${f.niche}` : "",
    f.audience ? `Audience: ${f.audience}` : "",
    f.positioning ? `Positioning: ${f.positioning}` : "",
    f.offers ? `Offers: ${f.offers}` : "",
    story ? `Story: ${story}` : "",
  ].filter(Boolean);
  const taskInput = [
    "Brief:",
    ...brief,
    "",
    "Writing:",
    ...samples.map((s, i) => `[${i + 1}] (${s.channel}) ${words(s.body, 300)}`),
  ].join("\n");

  const { answers } = await runTask(scope, extractAnswers, { context: await loadBrandContext(scope), taskInput, route: "cheap" });
  const out: Record<string, { value: string | string[]; evidence?: string }> = {};
  for (const a of answers) {
    if (!(PREFILL_IDS as readonly string[]).includes(a.id) || !a.value.trim()) continue;
    out[a.id] = { value: a.id === "E1" ? a.value.split(",").map((w) => w.trim()).filter(Boolean) : a.value.trim(), evidence: a.evidence };
  }
  await updateOnboarding(scope, pack, { suggestions: { basis, at: new Date().toISOString(), answers: out } });
  return out;
}

// ---- this or that -----------------------------------------------------------------

export async function pairsFor(scope: WorkspaceScope, pack: VoicePack) {
  const { basis, foundation: f } = await basisOf(scope, pack);
  if (pack.onboarding.pairs?.basis === basis && pack.onboarding.pairs.list.length) return pack.onboarding.pairs.list;
  const taskInput = [
    `About: ${f.niche || "their work"}${f.audience ? `, for ${f.audience}` : ""}`,
    ...DIAL_KEYS.map((d) => `Dial: ${d} (${DIAL_LABELS[d][0]} to ${DIAL_LABELS[d][1]})`),
  ].join("\n");
  const { pairs } = await runTask(scope, dialPairs, { context: await loadBrandContext(scope), taskInput, route: "cheap" });
  const list = pairs
    .filter((p): p is typeof p & { dial: DialKey } => (DIAL_KEYS as readonly string[]).includes(p.dial) && !!p.left.trim() && !!p.right.trim())
    .map((p) => ({ dial: p.dial, left: p.left.trim(), right: p.right.trim() }));
  await updateOnboarding(scope, pack, { pairs: { basis, list } });
  return list;
}

export type DialPick = { dial: DialKey; side: "left" | "right" | "neither" };

/** Where a pick puts the dial: a clear lean, not the end stop. "Neither" is the middle. */
export const DIAL_FOR: Record<DialPick["side"], number> = { left: 3, neither: 5, right: 8 };

export function picksToDials(picks: DialPick[]): Partial<Record<DialKey, number>> {
  return Object.fromEntries(picks.map((p) => [p.dial, DIAL_FOR[p.side]])) as Partial<Record<DialKey, number>>;
}

/**
 * Their picks set the dials (kept dials they didn't play stay as they were)
 * and the chosen lines become paired examples for drafting.
 */
export async function savePicks(scope: WorkspaceScope, actor: Actor, pack: VoicePack, picks: DialPick[]) {
  const list = pack.onboarding.pairs?.list ?? [];
  const dials = { ...(pack.identity.dials?.value ?? {}), ...picksToDials(picks) };
  const prefs: Preference[] = picks
    .filter((p) => p.side !== "neither")
    .flatMap((p) => {
      const pair = list.find((x) => x.dial === p.dial);
      return pair ? [{ dial: p.dial, chosen: p.side === "left" ? pair.left : pair.right, over: p.side === "left" ? pair.right : pair.left }] : [];
    });
  const patch = applyDials(pack, dials, estimateDials(pack));
  await writePack(
    scope, actor, pack,
    { ...patch, identity: { ...patch.identity!, preferences: tagged(prefs.slice(0, 8), "ask") } },
    `Played "this or that" (${picks.length} pairs).`,
  );
  await updateOnboarding(scope, pack, { answered: ["C4"] });
}

// ---- the live preview -----------------------------------------------------------------

/** The hints the stand-in reads; the real model reads the whole voice from the context. */
export function previewInput(pack: VoicePack, niche: string): string {
  const dials = pack.identity.dials?.value ?? {};
  const exclam = pack.index.punctuation.exclamation;
  const q = pack.index.punctuation.question;
  return [
    "Paragraph:",
    previewSource(niche),
    "",
    pack.index.neverWords.length ? `Never use: ${pack.index.neverWords.join(", ")}` : "",
    dials.casual_formal ? `Casual to formal: ${dials.casual_formal}` : "",
    exclam?.allowed === false ? "Exclamation marks: never" : "",
    pack.index.sentenceLength.mean ? `Average sentence words: ${Math.round(pack.index.sentenceLength.mean)}` : "",
    q?.allowed && (q.perPostTarget ?? 0) >= 1 ? "Asks questions: often" : "",
    (pack.identity.personalityWords?.value ?? []).length ? `Four words: ${pack.identity.personalityWords!.value.map((w) => w.word).join(", ")}` : "",
  ].filter((l, i) => l !== "" || i === 2).join("\n");
}

/** One paragraph in their voice, made once per pack version. */
export async function previewFor(scope: WorkspaceScope, pack: VoicePack): Promise<{ text: string; source: string }> {
  const f = await loadFoundation(scope);
  const source = previewSource(f.niche);
  if (pack.onboarding.preview?.version === pack.version) return { text: pack.onboarding.preview.text, source };
  const { text } = await runTask(scope, voicePreview, {
    context: await loadBrandContext(scope),
    taskInput: previewInput(pack, f.niche),
    route: "cheap",
  });
  await updateOnboarding(scope, pack, { preview: { version: pack.version, text: text.trim() } });
  return { text: text.trim(), source };
}

// ---- what a draft needs and can't invent ---------------------------------------------------

const clean = (s: string | undefined, n = 600) => (s ?? "").trim().slice(0, n);

export async function saveStories(scope: WorkspaceScope, actor: Actor, pack: VoicePack, stories: Story[]) {
  const list = stories
    .map((s) => ({ title: clean(s.title, 120), body: clean(s.body, 1500), lesson: clean(s.lesson, 200) || undefined }))
    .filter((s) => s.title && s.body)
    .slice(0, 8);
  await writePack(scope, actor, pack, { identity: { ...pack.identity, stories: tagged(list, "ask") } }, `Saved ${list.length} ${list.length === 1 ? "story" : "stories"}.`);
}

export async function saveProofs(scope: WorkspaceScope, actor: Actor, pack: VoicePack, proofs: Proof[]) {
  const list = proofs
    .map((p) => ({ claim: clean(p.claim, 300), source: clean(p.source, 160) || undefined }))
    .filter((p) => p.claim)
    .slice(0, 20);
  await writePack(scope, actor, pack, { identity: { ...pack.identity, proofs: tagged(list, "ask") } }, `Saved ${list.length} ${list.length === 1 ? "fact" : "facts"} you can stand behind.`);
}

export async function saveInfluences(scope: WorkspaceScope, actor: Actor, pack: VoicePack, v: { admire: string[]; avoid: string[] }) {
  const tidy = (xs: string[]) => [...new Set(xs.map((x) => clean(x, 160)).filter(Boolean))].slice(0, 8);
  await writePack(
    scope, actor, pack,
    { identity: { ...pack.identity, influences: tagged({ admire: tidy(v.admire), avoid: tidy(v.avoid) }, "ask") } },
    "Saved the voices you admire and avoid.",
  );
}

export async function saveLanguages(scope: WorkspaceScope, actor: Actor, pack: VoicePack, v: LanguageMix) {
  const mix: LanguageMix = { primary: v.primary, also: [...new Set(v.also.filter((l) => l !== v.primary))], when: clean(v.when, 200) || undefined };
  await writePack(scope, actor, pack, { identity: { ...pack.identity, languages: tagged(mix, "ask") } }, "Saved how you mix languages.");
}
