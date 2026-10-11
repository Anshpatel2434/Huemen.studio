/**
 * Voice Pack → the shape the ONE context builder takes (INV-2).
 *
 * Pure. This is the only place a pack is turned into prompt text, so the voice
 * reads the same in every module — which is the whole reason INV-2 exists.
 *
 * The measured numbers are rendered as short English lines rather than dumped
 * as JSON. A model hits "sentences average 13 words, and about one in eight is
 * three words or fewer" far more reliably than it hits `{"mean":13,...}`, and a
 * user can read it back and tell us we got them wrong.
 */
import type { VoicePackInput } from "@/lib/context/context-builder";
import { DIAL_KEYS, DIAL_LABELS, LANGUAGES, type VoiceContext, type VoicePack, type VoiceSample } from "./types";
import { deriveHardRules, deriveSelfCheck } from "./derive";

const pctWord = (n: number): string => `${Math.round(n)}%`;

/** The measured fingerprint, as lines a model can actually aim at. */
export function mechanicsLines(pack: VoicePack): string[] {
  const m = pack.mechanics;
  const out: string[] = [];

  const s = m.sentences?.value;
  if (s?.mean) {
    const bits = [`Sentences average ${s.mean} words (median ${s.median})`];
    if (s.shortPct) bits.push(`${pctWord(s.shortPct)} are four words or fewer`);
    if (s.longPct) bits.push(`${pctWord(s.longPct)} run past eighteen`);
    out.push(`${bits.join("; ")}.`);
    if (s.fragmentRate >= 0.08)
      out.push(`About one sentence in ${Math.round(1 / s.fragmentRate)} is a fragment. Keep that.`);
  }

  const p = m.paragraphs?.value;
  if (p?.sentencesPerParagraph)
    out.push(
      `Paragraphs run about ${p.sentencesPerParagraph} sentence${p.sentencesPerParagraph === 1 ? "" : "s"}, with white space between them.`,
    );

  // Only the marks that are actually part of this voice, in their words.
  const punct = m.punctuation?.value;
  if (punct) {
    const NAMES: [keyof typeof punct, string][] = [
      ["ellipsis", "ellipsis"], ["emDash", "em dash"], ["exclamation", "exclamation mark"],
      ["semicolon", "semicolon"], ["parentheses", "parentheses"], ["emoji", "emoji"],
    ];
    const used = NAMES.filter(([k]) => (punct[k] ?? 0) >= 0.3)
      .map(([k, name]) => `${name} about ${punct[k]} a piece`);
    const unused = NAMES.filter(([k]) => (punct[k] ?? 0) === 0).map(([, name]) => name);
    if (used.length) out.push(`Punctuation they use: ${used.join(", ")}.`);
    if (unused.length) out.push(`Punctuation they never use: ${unused.join(", ")}.`);
  }

  const pr = m.pronouns?.value;
  if (pr && pr.i + pr.we + pr.you + pr.they > 0)
    out.push(`Pronouns: I ${pctWord(pr.i)}, we ${pctWord(pr.we)}, you ${pctWord(pr.you)}, they ${pctWord(pr.they)}.`);

  const contractions = m.contractions?.value;
  if (typeof contractions === "number")
    out.push(
      contractions >= 0.6
        ? "Contracts almost everything they can."
        : contractions <= 0.2
          ? "Rarely contracts — writes it out."
          : `Contracts about ${pctWord(contractions * 100)} of the time.`,
    );

  const initials = (m.sentenceInitial?.value ?? []).filter((w) => ["and", "but", "so", "which"].includes(w.word));
  if (initials.length)
    out.push(`Starts sentences with ${initials.map((w) => `"${w.word}"`).join(", ")} more than most people do.`);

  const openers = (m.openers?.value ?? []).slice(0, 3);
  if (openers.length) {
    out.push("Opens like this (patterns, not text to reuse):");
    openers.forEach((o) => out.push(`  · ${o.pattern} — "${o.example}"`));
  }

  const closers = (m.closers?.value ?? []).slice(0, 3);
  if (closers.length) {
    out.push("Closes like this:");
    closers.forEach((cl) => out.push(`  · ${cl.pattern} — "${cl.example}"`));
  }

  if (m.bodyArc?.value) out.push(`A piece usually moves: ${m.bodyArc.value}`);

  const lex = (m.lexicon?.value ?? []).slice(0, 12);
  if (lex.length) out.push(`Words they reach for: ${lex.join(", ")}.`);

  // The ones they confirmed come first: a phrase they use across email, posts
  // and talks is theirs whether or not this scan counted it.
  const sigs = [...new Set([...(pack.onboarding.patterns?.kept ?? []), ...(m.signaturePhrases?.value ?? []).map((s2) => s2.phrase)])].slice(0, 5);
  if (sigs.length)
    out.push(
      `Signature phrases (at most ${pack.index.signaturePhraseMaxPerPiece} per piece, rotate them): ${sigs.map((s2) => `"${s2}"`).join(", ")}.`,
    );

  const emphasis = m.emphasis?.value ?? [];
  if (emphasis.length && emphasis[0] !== "none") out.push(`Emphasis: ${emphasis.join(", ")}.`);

  return out;
}

function contextLines(ctx: VoiceContext): string[] {
  return [
    ctx.register && `Register: ${ctx.register}`,
    ctx.firstLine && `First line: ${ctx.firstLine}`,
    ctx.structure && `Structure: ${ctx.structure}`,
    ctx.length && `Length: ${ctx.length}`,
    ctx.opener && `Opens: ${ctx.opener}`,
    ctx.closer && `Closes: ${ctx.closer}`,
    ctx.differsBy && `Differs from their default voice by: ${ctx.differsBy}`,
    ctx.notes,
  ].filter((x): x is string => Boolean(x));
}

/**
 * Flatten a pack for the builder.
 *
 * `samples` must already be the capped, public-only set from
 * `fewShotSamples` — this function does not fetch, and deliberately does not
 * filter, so there is exactly one place that decides what may be shown.
 */
export function packToContextInput(
  pack: VoicePack,
  samples: VoiceSample[],
  channel?: string,
): VoicePackInput {
  const ctx = channel ? pack.contexts[channel] : undefined;
  return {
    voiceLine: pack.voiceLine,
    // Their own three rules, or derived ones; the facts rule is always one (VOICE.md).
    hardRules: deriveHardRules(pack),
    toneDescriptors: pack.identity.toneDescriptors?.value ?? [],
    personalityWords: pack.identity.personalityWords?.value ?? [],
    reader: pack.identity.reader?.value ?? null,
    carries: pack.identity.carries?.value ?? null,
    humour: pack.identity.humour?.value ?? null,
    readingLevel: pack.mechanics.readingLevel?.value ?? null,
    guardrails: pack.guardrails.map((g) => ({ rule: g.rule, why: g.why, instead: g.instead })),
    neverWords: pack.index.neverWords?.length
      ? pack.index.neverWords
      : (pack.redPen.neverList?.value ?? []),
    mustHaves: (pack.redPen.mustHaves?.value ?? pack.index.mustHaves ?? []).map(mustHaveLabel),
    mechanicsLines: mechanicsLines(pack),
    context: ctx ? { channel: ctx.channel, tag: ctx.tag, lines: contextLines(ctx) } : null,
    samples: samples.map((s) => ({ channel: s.channel, body: s.body, note: s.kind === "benchmark" ? s.note : undefined })),
    corpusPieces: pack.corpusStats.pieces,
    stories: pack.identity.stories?.value ?? [],
    proofs: pack.identity.proofs?.value ?? [],
    influences: pack.identity.influences?.value ?? null,
    languages: pack.identity.languages?.value
      ? {
          primary: languageLabel(pack.identity.languages.value.primary),
          also: pack.identity.languages.value.also.map(languageLabel),
          when: pack.identity.languages.value.when,
        }
      : null,
    preferences: (pack.identity.preferences?.value ?? []).map((p) => ({ chosen: p.chosen, over: p.over })),
    ...identityInput(pack),
    exceptions: (pack.redPen.exceptions?.value ?? []).map((e) => `${e.item} (${e.evidence})`),
    selfCheck: pack.redPen.selfCheck?.value?.length ? pack.redPen.selfCheck.value : deriveSelfCheck(pack),
    antiSample: pack.onboarding.antiSample ?? null,
  };
}

/** Readable names for the must-have keys the scan derives (red-pen.md). */
const MUST_HAVE_LABELS: Record<string, string> = {
  closing_question: "a closing question",
  one_fragment: "at least one short fragment",
};
export const mustHaveLabel = (k: string) => MUST_HAVE_LABELS[k] ?? k.replace(/_/g, " ");

const QUADRANT_LABELS: Record<string, string> = {
  reserved_expert: "Reserved Expert (formal, calm)",
  dynamic_leader: "Dynamic Leader (formal, energetic)",
  friendly_guide: "Friendly Guide (casual, calm)",
  enthusiastic_friend: "Enthusiastic Friend (casual, energetic)",
};

/** The labelled answers that have no field of their own (A5, A6, B2, B4). */
const NOTE_LABELS: Record<string, string> = {
  A5: "How a stranger would read them",
  A6: "What people say about how they write",
  B2: "Voices they admire, and why",
  B4: "At their best on the page they become",
};

/** Everything identity.md holds, for the prompt (01 §3). */
function identityInput(pack: VoicePack): Partial<VoicePackInput> {
  const id = pack.identity;
  const answers = id.answers ?? {};
  const pick = (prefix: string) =>
    Object.entries(answers)
      .filter(([k, v]) => k.startsWith(`${prefix} · `) && v.trim())
      .map(([k, v]) => ({ key: k.slice(prefix.length + 3), value: v.trim() }));
  const dials = id.dials?.value ?? {};
  return {
    whatTheyDo: id.voiceParagraph?.value ?? null,
    personaRoles: id.personaRoles?.value ?? [],
    quadrant: id.quadrant?.value ? QUADRANT_LABELS[id.quadrant.value] ?? id.quadrant.value : null,
    dials: DIAL_KEYS.filter((k) => typeof dials[k] === "number").map((k) => ({
      left: DIAL_LABELS[k][0], right: DIAL_LABELS[k][1], value: dials[k] as number,
    })),
    dialsAspiration: id.dials?.confidence === "aspiration",
    guarded: id.guarded?.value ?? null,
    unguarded: id.unguarded?.value ?? null,
    feelings: id.feeling30s || id.feeling5m || id.feeling20m
      ? { skim: id.feeling30s?.value, read: id.feeling5m?.value, talk: id.feeling20m?.value }
      : null,
    roots: id.roots?.value ?? null,
    languageNote: id.language?.value ?? null,
    notes: Object.entries(NOTE_LABELS).filter(([q]) => answers[q]?.trim()).map(([q, label]) => ({ label, text: answers[q] })),
    situations: pick("F3").map((s) => ({ moment: s.key, how: s.value })),
    signOffs: pick("F5").map((s) => ({ place: s.key, text: s.value })),
  };
}

const languageLabel = (k: string) => LANGUAGES.find((l) => l.key === k)?.label.split(" (")[0] ?? k;
