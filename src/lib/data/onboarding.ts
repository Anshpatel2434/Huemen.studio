/**
 * Onboarding (Flow 1): the steps that take a person from zero to their studio.
 *
 *   0 About you           their name and the brief's basics (what they do, who
 *                         for, what they offer), asked inline, never a detour
 *   1 Add samples         sources (G1), platforms (F1), ingest, the scan
 *   2 Confirm your voice  confirm cards (H), dials (C4), words (C5–C6), the
 *                         Core questions, benchmarks (G2)
 *   3 Set your hue        brief, pillars, visual identity (existing pages)
 *   4 First draft         the payoff: mirror, first piece, a voice check
 *
 * Every write goes through `writePack`, so a coach setting someone up proposes
 * and the owner approves, exactly as on the Voice page.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession } from "@/db/session";
import type { WorkspaceScope } from "./projects";
import { addSamples, listSamples, loadPackForWorkspace, rescan, type NewSample } from "./voice-pack";
import { writePack, type Actor } from "./training";
import { loadFoundation, saveFoundation } from "./foundation";
import { applyAnswer, applyDials, type Answer } from "@/lib/voice/answers";
import { confirmCards, estimateDials } from "@/lib/voice/derive";
import type { IngestedPiece } from "@/lib/voice/ingest";
import { tagged } from "@/lib/voice/types";
import {
  MEASURED_CONTEXT_MINIMUM,
  type DialKey,
  type Onboarding,
  type VoiceContext,
  type VoicePack,
  type WorkMode,
} from "@/lib/voice/types";

export async function requirePack(scope: WorkspaceScope): Promise<VoicePack> {
  const pack = await loadPackForWorkspace(scope);
  if (!pack) throw new Error("No voice pack for this workspace yet.");
  return pack;
}

/** Merge into onboarding state. Lists are unioned, never replaced. */
export async function updateOnboarding(scope: WorkspaceScope, pack: VoicePack, patch: Onboarding): Promise<void> {
  const cur = pack.onboarding;
  const union = (a?: string[], b?: string[]) => (b ? [...new Set([...(a ?? []), ...b])] : a);
  const next: Onboarding = {
    ...cur,
    ...patch,
    answered: union(cur.answered, patch.answered),
    resolvedCards: union(cur.resolvedCards, patch.resolvedCards),
    // Never move the stepper backwards by accident.
    step: Math.max(cur.step ?? 1, patch.step ?? 1),
  };
  await withTenantSession(scope, (c) =>
    c.query(`UPDATE voice_packs SET onboarding = $1 WHERE id = $2`, [JSON.stringify(next), pack.id]),
  );
}

/**
 * Where onboarding opens: "About you" until it's saved, then the furthest step
 * reached. One rule, shared by the stepper and the dashboard's gate. Someone
 * who finished before "About you" existed is not sent back to it.
 */
export const resumeStep = (o: Onboarding): number =>
  o.welcomedAt || o.completedAt ? Math.min(4, Math.max(1, o.step ?? 1)) : 0;

export interface About {
  name: string;
  niche: string;
  audience: string;
  offers: string;
  positioning: string;
}

/**
 * Step 0, "About you". The name goes on their voice; the rest is the brief's
 * basics, saved as the brand only (`voice: false`), so it never overwrites a
 * voice field. A blank field keeps what the brief already had.
 */
export async function saveAbout(scope: WorkspaceScope, actor: Actor, pack: VoicePack, about: About): Promise<void> {
  const name = about.name.trim().slice(0, 80);
  if (name && name !== pack.displayName) await writePack(scope, actor, pack, { displayName: name }, "Set your name.");
  const f = await loadFoundation(scope);
  const keep = (next: string, cur: string) => next.trim() || cur;
  await saveFoundation(
    scope,
    {
      ...f,
      niche: keep(about.niche, f.niche),
      audience: keep(about.audience, f.audience),
      offers: keep(about.offers, f.offers),
      positioning: keep(about.positioning, f.positioning),
    },
    { voice: false },
  );
  await updateOnboarding(scope, (await loadPackForWorkspace(scope)) ?? pack, {
    welcomedAt: pack.onboarding.welcomedAt ?? new Date().toISOString(),
  });
}

export async function setSources(scope: WorkspaceScope, pack: VoicePack, sources: string[]): Promise<void> {
  await updateOnboarding(scope, pack, { sources: [...new Set(sources)] });
}

/**
 * F1: the platforms we write for. Each gets a context block straight away,
 * tagged inferred until five real pieces from it exist (file 06 §3).
 */
export async function setWriteFor(scope: WorkspaceScope, actor: Actor, pack: VoicePack, platforms: string[]): Promise<void> {
  const writeFor = [...new Set(platforms)];
  const contexts: Record<string, VoiceContext> = { ...pack.contexts };
  for (const p of writeFor) {
    if (!contexts[p]) contexts[p] = { channel: p, tag: "inferred", pieceCount: 0 };
  }
  await updateOnboarding(scope, pack, { writeFor });
  await writePack(scope, actor, pack, { contexts }, `Writing for: ${writeFor.join(", ") || "nothing yet"}.`);
}

/** Store ingested pieces. The caller re-measures once at the end of a batch. */
export async function ingestPieces(scope: WorkspaceScope, pack: VoicePack, pieces: IngestedPiece[], source: NewSample["source"]): Promise<number> {
  return addSamples(
    scope,
    pack.id,
    pieces.map((p) => ({
      body: p.body,
      channel: p.channel,
      visibility: p.visibility,
      kind: p.kind,
      source,
      publishedAt: p.publishedAt ?? null,
    })),
  );
}

/** Re-measure, and move the stepper on once there is writing to confirm. */
/**
 * "Learning" (§15.2): the re-measure after a batch. Its state is stored before
 * it starts and after it ends, so a refresh mid-way still shows it running and
 * the page can tell the person when it is done. A scan that dies leaves
 * "learning" behind, which goes stale after ten minutes (lib/voice/lifecycle).
 */
export async function finishIngest(scope: WorkspaceScope, pack: VoicePack) {
  await updateOnboarding(scope, pack, { scan: { state: "learning", at: new Date().toISOString() } });
  const result = await rescan(scope, pack.id);
  const after = (await loadPackForWorkspace(scope)) ?? pack;
  await updateOnboarding(scope, after, {
    scan: { state: "done", at: new Date().toISOString(), pieces: result.stats.pieces },
    ...(result.stats.pieces > 0 ? { step: 2 } : {}),
  });
  return result;
}

/** "Ingesting" (§15.2): files are being read, one at a time, in the browser. */
export async function markIngesting(scope: WorkspaceScope, pack: VoicePack): Promise<void> {
  await updateOnboarding(scope, pack, { scan: { state: "ingesting", at: new Date().toISOString() } });
}

// ---- the Voice Mirror, edited in place (step 4) -------------------------------

/** The never-list as the person now wants it: replaced, not merged. */
export async function setNeverWords(scope: WorkspaceScope, actor: Actor, pack: VoicePack, words: string[]): Promise<void> {
  const never = [...new Set(words.map((w) => w.trim().toLowerCase()).filter(Boolean))];
  await writePack(
    scope, actor, pack,
    { redPen: { ...pack.redPen, neverList: tagged(never, "edit") }, index: { ...pack.index, neverWords: never } },
    "Edited the never-list.",
  );
}

/** An opener they're tired of stops being used as a pattern (H4). */
export async function dropOpener(scope: WorkspaceScope, actor: Actor, pack: VoicePack, example: string): Promise<void> {
  const openers = pack.mechanics.openers;
  if (!openers) return;
  await writePack(
    scope, actor, pack,
    { mechanics: { ...pack.mechanics, openers: { ...openers, value: openers.value.filter((o) => o.example !== example) } } },
    "Dropped an opener.",
  );
}

/** One of their lines, reworded. An empty rule removes it. */
export async function setGuardrailRule(scope: WorkspaceScope, actor: Actor, pack: VoicePack, id: string, rule: string): Promise<void> {
  const r = rule.trim();
  const guardrails = r
    ? pack.guardrails.map((g) => (g.id === id ? { ...g, rule: r, source: "edit" as const } : g))
    : pack.guardrails.filter((g) => g.id !== id);
  await writePack(scope, actor, pack, { guardrails }, r ? "Reworded a line." : "Removed a line.");
}

export async function answer(
  scope: WorkspaceScope,
  actor: Actor,
  pack: VoicePack,
  questionId: string,
  value: Answer,
): Promise<void> {
  const { patch, spokenSample } = applyAnswer(pack, questionId, value);
  if (Object.keys(patch).length) await writePack(scope, actor, pack, patch, `Answered ${questionId}.`);
  if (spokenSample) {
    // A spoken answer is also how they sound (file 05, Part 1, rule 3).
    await addSamples(scope, pack.id, [{ body: spokenSample, channel: "spoken", kind: "spoken", source: "voice_note", visibility: "public" }]);
  }
  await updateOnboarding(scope, pack, { answered: [questionId] });
}

export async function saveDials(scope: WorkspaceScope, actor: Actor, pack: VoicePack, dials: Partial<Record<DialKey, number>>): Promise<void> {
  await writePack(scope, actor, pack, applyDials(pack, dials, estimateDials(pack)), "Set the dials.");
  await updateOnboarding(scope, pack, { answered: ["C4"] });
}

/**
 * Resolve a confirm card (file 05, section H). Each option's effect is the
 * one the spec describes for that card.
 */
export async function resolveCard(
  scope: WorkspaceScope,
  actor: Actor,
  pack: VoicePack,
  cardId: string,
  option: string,
  dropItems: string[] = [],
): Promise<void> {
  const samples = await listSamples(scope, pack.id, { includeExcluded: true });
  const card = confirmCards(pack, samples).find((c) => c.id === cardId);
  if (!card) return;

  if (card.kind === "H3") {
    const ids = (card.items ?? []).map((i) => i.id);
    await withTenantSession(scope, (c) =>
      option === "remove"
        ? c.query(`UPDATE voice_samples SET excluded = true, exclusion_reason = 'Not mine', suspect_reason = NULL WHERE id = ANY($1::uuid[])`, [ids])
        : c.query(`UPDATE voice_samples SET suspect_reason = NULL, note = 'confirmed-mine' WHERE id = ANY($1::uuid[])`, [ids]),
    );
    if (option === "remove") await rescan(scope, pack.id);
  } else if (card.kind === "H1") {
    // "How I want to write" is an aspiration: the check scores toward it.
    const key = cardId.split(":")[1] as DialKey;
    const dials = pack.identity.dials;
    if (dials && option === "now") {
      const measured = (dials.measuredValue as Partial<Record<DialKey, number>> | undefined)?.[key];
      const value = { ...(dials.value ?? {}), ...(measured != null ? { [key]: measured } : {}) };
      await writePack(scope, actor, pack, { identity: { ...pack.identity, dials: { ...dials, value } }, index: { ...pack.index, dials: value } }, `Kept ${key} as measured.`);
    } else if (dials) {
      await writePack(scope, actor, pack, { identity: { ...pack.identity, dials: { ...dials, confidence: "aspiration" } } }, `Set ${key} as an aspiration.`);
    }
  } else if (card.kind === "H5" && option === "allow") {
    const word = cardId.slice(3);
    const never = pack.index.neverWords.filter((w) => w.toLowerCase() !== word);
    await writePack(scope, actor, pack, { index: { ...pack.index, neverWords: never } }, `Allowed "${word}" again.`);
  } else if (card.kind === "H2") {
    const mark = cardId.slice(3) as keyof VoicePack["index"]["punctuation"];
    const rule = pack.index.punctuation[mark];
    if (option === "drop") {
      await writePack(scope, actor, pack, { index: { ...pack.index, punctuation: { ...pack.index.punctuation, [mark]: { ...rule, allowed: false } } } }, `Dropped the ${mark} habit.`);
    } else if (mark === "ellipsis" || mark === "emDash") {
      // Kept: a proven habit beats the universal watch-list for this person.
      await writePack(scope, actor, pack, { index: { ...pack.index, punctuation: { ...pack.index.punctuation, [mark]: { ...rule, allowed: true } } } }, `Kept the ${mark} habit.`);
    }
  } else if (card.kind === "H4" && dropItems.length) {
    const drop = new Set(dropItems.flatMap((d) => d.split(",")));
    const mech = pack.mechanics;
    const openers = (mech.openers?.value ?? []).filter((_, i) => !drop.has(`o${i}`));
    const closers = (mech.closers?.value ?? []).filter((_, i) => !drop.has(`c${i}`));
    await writePack(
      scope,
      actor,
      pack,
      {
        mechanics: {
          ...mech,
          ...(mech.openers ? { openers: { ...mech.openers, value: openers } } : {}),
          ...(mech.closers ? { closers: { ...mech.closers, value: closers } } : {}),
        },
      },
      `Dropped ${dropItems.length} openers and closers.`,
    );
  }
  await updateOnboarding(scope, pack, { resolvedCards: [cardId] });
}

/** G2: exactly the pieces picked become benchmarks; any earlier pick reverts. */
export async function setBenchmarks(scope: WorkspaceScope, pack: VoicePack, sampleIds: string[]): Promise<void> {
  await withTenantSession(scope, async (c) => {
    await c.query(`UPDATE voice_samples SET kind = 'corpus' WHERE pack_id = $1 AND kind = 'benchmark'`, [pack.id]);
    await c.query(
      `UPDATE voice_samples SET kind = 'benchmark' WHERE pack_id = $1 AND id = ANY($2::uuid[]) AND visibility = 'public'`,
      [pack.id, sampleIds.slice(0, 3)],
    );
  });
  await updateOnboarding(scope, pack, { answered: ["G2"] });
}

export async function setWorkMode(scope: WorkspaceScope, actor: Actor, pack: VoicePack, mode: WorkMode): Promise<void> {
  await writePack(scope, actor, pack, { workMode: mode }, `Way of working: ${mode}.`);
  await updateOnboarding(scope, pack, { answered: ["F2"] });
}

export async function completeOnboarding(scope: WorkspaceScope, pack: VoicePack): Promise<void> {
  await updateOnboarding(scope, pack, { step: 4, completedAt: new Date().toISOString() });
}

/** How many measured context blocks the person has; used by the stepper. */
export const measuredBlocks = (pack: VoicePack) =>
  Object.values(pack.contexts).filter((c) => c.tag === "measured" && c.pieceCount >= MEASURED_CONTEXT_MINIMUM).length;
