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
import type { VoiceContext, VoicePack, VoiceSample } from "./types";

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

  const sigs = (m.signaturePhrases?.value ?? []).slice(0, 5);
  if (sigs.length)
    out.push(
      `Signature phrases (at most ${pack.index.signaturePhraseMaxPerPiece} per piece, rotate them): ${sigs.map((s2) => `"${s2.phrase}"`).join(", ")}.`,
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
    hardRules: pack.hardRules,
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
    mustHaves: pack.redPen.mustHaves?.value ?? pack.index.mustHaves ?? [],
    mechanicsLines: mechanicsLines(pack),
    context: ctx ? { channel: ctx.channel, tag: ctx.tag, lines: contextLines(ctx) } : null,
    samples: samples.map((s) => ({ channel: s.channel, body: s.body })),
    corpusPieces: pack.corpusStats.pieces,
  };
}
