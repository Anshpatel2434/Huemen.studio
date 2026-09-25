/**
 * Voice Pack shapes (client spec v2, file 01). Pure types — client-safe.
 *
 * A voice belongs to a PERSON. One pack per user; a brand points at one.
 *
 * The spec's rule "every trait carries evidence" is enforced by the type
 * system here: a trait is a `Tagged<T>`, and a Tagged value cannot exist
 * without saying where it came from. A number with no evidence behind it is
 * exactly what made Rohan's file weaker than Richa's.
 */

/** Where a value came from (spec 01 §3). Stored with every value. */
export type SourceTag = "scan" | "ask" | "derived" | "edit";

/**
 * How much weight a value carries.
 *  - measured: computed from the corpus, with a count behind it
 *  - inferred: derived from the general voice, or simply claimed by the user
 *  - aspiration: the user overrode the measurement on purpose (H1). The voice
 *    check scores against this, not against what the corpus says (question 16).
 */
export type Confidence = "measured" | "inferred" | "aspiration";

export interface Evidence {
  /** A short quote from the user's own writing. 1–3 per trait. */
  quote: string;
  /** The voice_samples row it came from, so the UI can link to the piece. */
  sampleId?: string;
}

export interface Tagged<T> {
  value: T;
  source: SourceTag;
  confidence: Confidence;
  /** How many pieces in the corpus support this. Absent for `ask` values. */
  count?: number;
  evidence?: Evidence[];
  /** Kept when an aspiration replaces a measurement, so the diff can show both. */
  measuredValue?: T;
}

export const tagged = <T>(
  value: T,
  source: SourceTag,
  confidence: Confidence = "inferred",
  extra: Partial<Tagged<T>> = {},
): Tagged<T> => ({ value, source, confidence, ...extra });

// ---- identity.md ------------------------------------------------------------

export const DIAL_KEYS = [
  "fun_serious",
  "casual_formal",
  "cheeky_respectful",
  "enthusiastic_practical",
  "traditional_innovative",
  "accessible_exclusive",
  "adventurous_conservative",
  "youthful_mature",
] as const;
export type DialKey = (typeof DIAL_KEYS)[number];

/** The 1–10 labels, left to right, as the spec's C4 table names them. */
export const DIAL_LABELS: Record<DialKey, [string, string]> = {
  fun_serious: ["Fun", "Serious"],
  casual_formal: ["Casual", "Formal"],
  cheeky_respectful: ["Cheeky", "Respectful"],
  enthusiastic_practical: ["Enthusiastic", "Practical"],
  traditional_innovative: ["Traditional", "Innovative"],
  accessible_exclusive: ["Accessible", "Exclusive"],
  adventurous_conservative: ["Adventurous", "Conservative"],
  youthful_mature: ["Youthful", "Mature"],
};

export type Quadrant =
  | "reserved_expert"
  | "dynamic_leader"
  | "friendly_guide"
  | "enthusiastic_friend";

export interface PersonalityWord {
  word: string;
  /** "On the page, being Curious means I…" (C7). */
  meaning: string;
}

export interface Identity {
  voiceParagraph?: Tagged<string>;
  personaRoles?: Tagged<string[]>;
  personalityWords?: Tagged<PersonalityWord[]>;
  /** The longlist from C5, kept but not shown in the pack. */
  personalityLonglist?: Tagged<string[]>;
  dials?: Tagged<Partial<Record<DialKey, number>>>;
  quadrant?: Tagged<Quadrant>;
  guarded?: Tagged<string>;
  unguarded?: Tagged<string>;
  feeling30s?: Tagged<string>;
  feeling5m?: Tagged<string>;
  feeling20m?: Tagged<string>;
  reader?: Tagged<string>;
  /** The one idea every piece quietly carries (A4). */
  carries?: Tagged<string>;
  roots?: Tagged<string>;
  humour?: Tagged<string>;
  language?: Tagged<string>;
  /** Carried over from the old brief voice step. Not one of the spec's fields. */
  toneDescriptors?: Tagged<string[]>;
}

// ---- guardrails.md ----------------------------------------------------------

/** A rule that beats every other instruction. The WHY is what lets it generalise. */
export interface Guardrail {
  id: string;
  name: string;
  rule: string;
  why: string;
  instead: string;
  source: SourceTag;
}

// ---- mechanics.md -----------------------------------------------------------

export interface PunctuationRates {
  emDash: number;
  enDash: number;
  spacedHyphen: number;
  ellipsis: number;
  parentheses: number;
  brackets: number;
  question: number;
  stackedQuestion: number;
  exclamation: number;
  colon: number;
  semicolon: number;
  quotes: number;
  emoji: number;
}

export interface SentenceStats {
  mean: number;
  median: number;
  shortPct: number;
  midPct: number;
  longPct: number;
  fragmentRate: number;
}

export interface PatternExample {
  pattern: string;
  example: string;
  sampleId?: string;
}

export interface Mechanics {
  readingLevel?: Tagged<string>;
  lengthByFormat?: Tagged<Record<string, [number, number]>>;
  sentences?: Tagged<SentenceStats>;
  paragraphs?: Tagged<{ sentencesPerParagraph: number; singleLinePct: number }>;
  punctuation?: Tagged<PunctuationRates>;
  pronouns?: Tagged<{ i: number; we: number; you: number; they: number }>;
  contractions?: Tagged<number>;
  emphasis?: Tagged<string[]>;
  sentenceInitial?: Tagged<{ word: string; count: number }[]>;
  openers?: Tagged<PatternExample[]>;
  closers?: Tagged<PatternExample[]>;
  bodyArc?: Tagged<string>;
  lexicon?: Tagged<string[]>;
  signaturePhrases?: Tagged<{ phrase: string; count: number }[]>;
  hashtags?: Tagged<{ count: number; casing: string; tags: string[] }>;
  fillInTemplate?: Tagged<string>;
}

// ---- contexts.md ------------------------------------------------------------

/**
 * A context is `measured` only with >= 5 real pieces on that platform
 * (spec 06 §3). Below that it is `inferred` and the UI says so.
 */
export const MEASURED_CONTEXT_MINIMUM = 5;

export interface VoiceContext {
  channel: string;
  tag: "measured" | "inferred";
  pieceCount: number;
  register?: string;
  firstLine?: string;
  structure?: string;
  length?: string;
  opener?: string;
  closer?: string;
  notes?: string;
  differsBy?: string;
}

// ---- red-pen.md -------------------------------------------------------------

export interface RedPen {
  neverList?: Tagged<string[]>;
  /** Where a proven personal habit overrides the universal anti-AI list. */
  exceptions?: Tagged<{ item: string; evidence: string }[]>;
  mustHaves?: Tagged<string[]>;
  selfCheck?: Tagged<string[]>;
}

// ---- voice.json -------------------------------------------------------------

export interface PunctuationRule {
  allowed: boolean | null;
  perPostTarget?: number | null;
  perPostMax?: number | null;
}

/**
 * The machine index. Drives the DETERMINISTIC half of the voice check — no
 * model call, instant, and always right. See lib/voice/check.
 */
export interface VoiceIndex {
  version: number;
  punctuation: Partial<Record<keyof PunctuationRates, PunctuationRule>>;
  sentenceLength: Partial<SentenceStats>;
  neverWords: string[];
  allowedExceptions: string[];
  mustHaves: string[];
  dials: Partial<Record<DialKey, number>>;
  lengthByFormat: Record<string, [number, number]>;
  signaturePhrases: string[];
  signaturePhraseMaxPerPiece: number;
  lastOpeners: string[];
}

/**
 * A fresh, empty index. Always call this rather than spreading a shared
 * constant: `{...SHARED}` copies the REFERENCES to the nested objects, so two
 * people's indexes end up writing into the same `punctuation` and `mustHaves`.
 * That bug quietly gives one person another person's voice.
 */
export function emptyIndex(): VoiceIndex {
  return {
    version: 1,
    punctuation: {},
    sentenceLength: {},
    neverWords: [],
    allowedExceptions: [],
    mustHaves: [],
    dials: {},
    lengthByFormat: {},
    signaturePhrases: [],
    signaturePhraseMaxPerPiece: 1,
    lastOpeners: [],
  };
}

/** Read-only empty index. Deep-frozen, so the mistake above throws instead of corrupting. */
export const EMPTY_INDEX: VoiceIndex = Object.freeze({
  ...emptyIndex(),
  punctuation: Object.freeze({}),
  sentenceLength: Object.freeze({}),
  neverWords: Object.freeze([]) as unknown as string[],
  allowedExceptions: Object.freeze([]) as unknown as string[],
  mustHaves: Object.freeze([]) as unknown as string[],
  dials: Object.freeze({}),
  lengthByFormat: Object.freeze({}) as VoiceIndex["lengthByFormat"],
  signaturePhrases: Object.freeze([]) as unknown as string[],
  lastOpeners: Object.freeze([]) as unknown as string[],
});

// ---- the pack ---------------------------------------------------------------

export type PackStatus = "provisional" | "active" | "archived";

export interface VoicePack {
  id: string;
  userId: string;
  slug: string;
  displayName: string;
  status: PackStatus;
  version: number;
  voiceLine: string;
  hardRules: string[];
  identity: Identity;
  guardrails: Guardrail[];
  mechanics: Mechanics;
  contexts: Record<string, VoiceContext>;
  redPen: RedPen;
  index: VoiceIndex;
  corpusStats: CorpusStats;
  scannedAt: string | null;
}

export interface CorpusStats {
  pieces: number;
  words: number;
  sentences: number;
  channels: string[];
  /** Oldest and newest published_at we know about. */
  from?: string;
  to?: string;
}

/** A corpus piece. `private` pieces never become few-shot samples (question 12). */
export type SampleKind = "corpus" | "benchmark" | "anti_sample" | "unguarded" | "spoken";
export type SampleSource =
  | "paste" | "upload" | "export" | "url" | "voice_note" | "intake" | "connection";

export interface VoiceSample {
  id: string;
  channel: string;
  kind: SampleKind;
  source: SampleSource;
  visibility: "public" | "private";
  body: string;
  wordCount: number;
  note?: string;
  excluded: boolean;
  exclusionReason?: string;
  publishedAt?: string;
}

/** Corpus thresholds (spec 06 §3). */
export const CORPUS_MINIMUM_PIECES = 10;
export const CORPUS_MINIMUM_WORDS = 1000;
export const CORPUS_GOOD_PIECES = 30;

export function corpusLevel(stats: CorpusStats): "empty" | "thin" | "minimum" | "good" {
  if (stats.pieces === 0) return "empty";
  if (stats.pieces >= CORPUS_GOOD_PIECES) return "good";
  if (stats.pieces >= CORPUS_MINIMUM_PIECES || stats.words >= CORPUS_MINIMUM_WORDS)
    return "minimum";
  return "thin";
}
