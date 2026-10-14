/**
 * The measurement engine (client spec, file 06 §4).
 *
 * PURE. No I/O, no model call, no randomness — the same corpus must always
 * produce the same numbers, because those numbers are what the voice check
 * scores against and what the user is shown as evidence.
 *
 * This is the file that makes the difference between the two sample voices in
 * the spec: Richa's traits were MEASURED from ~375 sentences, Rohan's were
 * estimated by a generic tool ("burstiness ~0.6, estimated") and so could never
 * be tested against anything. Every number produced here carries its count and
 * a quote from the writing it came from.
 *
 * Deliberately not clever: no model, no embedding, no third-party NLP. Counting
 * is something we can explain to a user line by line, and explaining it is the
 * product.
 */
import {
  tagged,
  type CorpusStats,
  type Evidence,
  type Mechanics,
  type PatternExample,
  type PunctuationRates,
  type SentenceStats,
  type VoiceContext,
  type VoiceIndex,
  emptyIndex,
  MEASURED_CONTEXT_MINIMUM,
} from "./types";

export interface MeasurableSample {
  id?: string;
  channel?: string;
  body: string;
  publishedAt?: string;
  /**
   * From a private source (sent email, chat). Private pieces are COUNTED — they
   * are often a person's most natural writing and the numbers are the point —
   * but nothing verbatim is ever taken from them: no openers, no closers, no
   * phrases, no evidence quotes. Anything carrying their actual words would
   * carry their facts with it, straight into a prompt.
   */
  private?: boolean;
}

// ---- text splitting ---------------------------------------------------------

/**
 * An ellipsis is a voice habit, not necessarily a full stop — that is the whole
 * point of Richa's file. So "…" ends a sentence only when the next thing is a
 * capital or the end of the piece; mid-sentence it is left alone.
 */
const SENTENCE_END = /([.!?]+|\.{3,}|…)(\s+|$)/g;

export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const m of text.matchAll(SENTENCE_END)) {
    const end = m.index! + m[0].length;
    const isEllipsis = m[1] === "…" || /^\.{3,}$/.test(m[1]);
    if (isEllipsis) {
      const next = text.slice(end).trimStart().charAt(0);
      // Mid-sentence ellipsis: keep reading.
      if (next && next !== next.toUpperCase()) continue;
      if (!next && end < text.length) continue;
    }
    const piece = text.slice(start, end).trim();
    if (piece) out.push(piece);
    start = end;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

export function words(text: string): string[] {
  return text.match(WORD) ?? [];
}

export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

// ---- per-piece measurement --------------------------------------------------

export interface PieceMetrics {
  wordCount: number;
  sentenceLengths: number[];
  paragraphCount: number;
  singleSentenceParagraphs: number;
  punctuation: PunctuationRates;
  firstLine: string;
  lastLine: string;
  closingLines: string[];
  endsWithQuestion: boolean;
  sentenceInitials: string[];
  pronouns: { i: number; we: number; you: number; they: number };
  contractionsUsed: number;
  contractionOpportunities: number;
  hashtags: string[];
  capsWords: number;
  markdownEmphasis: number;
  unicodeEmphasis: number;
  nonLatinTokens: number;
  emojis: string[];
  emojiAtEnd: boolean;
}

const EMOJI = /\p{Extended_Pictographic}/gu;
// Mathematical alphanumerics — the "unicode bold" people paste into LinkedIn.
const UNICODE_EMPHASIS = /[\u{1D400}-\u{1D7FF}]/gu;
const NON_LATIN = /[^\p{Script=Latin}\p{N}\p{P}\p{Z}\p{C}\p{S}]/u;

/** Contractible pairs, used to report contractions as a RATE, not a raw count. */
const EXPANDED = [
  "do not", "does not", "did not", "is not", "are not", "was not", "were not",
  "cannot", "can not", "could not", "would not", "should not", "have not",
  "has not", "had not", "will not", "it is", "it has", "that is", "there is",
  "they are", "we are", "you are", "i am", "i will", "i have", "let us",
];

const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length;

/**
 * The clean step (spec 06 §4): what is not their prose comes out before
 * anything is counted. Links, @mentions and hashtags (counted on their own),
 * and platform boilerplate ("Repost", "Celebrating 5 years at…"). Line breaks
 * stay: they are part of the voice.
 */
// Each takes its line break with it, so a removed line leaves no stray paragraph.
const AUTO_LINES = [
  /^[ \t]*repost(ed)?\b.*(\n|$)/gim,
  /^[ \t]*(celebrating|i'?m happy to share|i'?m excited to share|starting a new position)\b.*\b(years?|position|role|at)\b.*(\n|$)/gim,
  /^[ \t]*(see more|show more|…see more|translate|see translation)[ \t]*(\n|$)/gim,
  /^[ \t]*(sent from my \w+.*|get outlook for \w+.*)(\n|$)/gim,
];
export function cleanForMeasure(text: string): string {
  let t = text.replace(/\r\n/g, "\n");
  for (const re of AUTO_LINES) t = t.replace(re, "");
  return t
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/(^|\s)@[\p{L}\p{N}_.]+/gu, "$1")
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function measurePiece(text: string): PieceMetrics {
  const raw = text.replace(/\r\n/g, "\n").trim();
  const body = cleanForMeasure(raw);
  const sentences = splitSentences(body);
  const paras = paragraphs(body);
  const lower = body.toLowerCase();
  const allWords = words(body);

  const pronounCount = (re: RegExp) => count(lower, re);
  const contractionsUsed = count(body, /\b\w+['’](s|t|re|ve|ll|d|m)\b/gi);
  // "It is not" overlaps two phrases ("it is" and "is not") but offers only ONE
  // contraction, so matches are consumed longest-first rather than counted
  // independently. Counting both would understate how often they contract.
  let remaining = lower;
  let expandedUsed = 0;
  for (const phrase of EXPANDED) {
    remaining = remaining.replace(new RegExp(`\\b${phrase}\\b`, "g"), () => {
      expandedUsed++;
      return "\u0000";
    });
  }

  return {
    wordCount: allWords.length,
    sentenceLengths: sentences.map((s) => words(s).length),
    paragraphCount: paras.length,
    singleSentenceParagraphs: paras.filter((p) => splitSentences(p).length <= 1).length,
    punctuation: {
      emDash: count(body, /—/g),
      enDash: count(body, /–/g),
      spacedHyphen: count(body, / - /g),
      ellipsis: count(body, /…|\.{3,}/g),
      parentheses: count(body, /\(/g),
      brackets: count(body, /\[/g),
      question: count(body, /\?/g),
      stackedQuestion: count(body, /\?{2,}/g),
      exclamation: count(body, /!/g),
      colon: count(body, /:/g),
      semicolon: count(body, /;/g),
      quotes: count(body, /["“”]/g),
      emoji: count(body, EMOJI),
    },
    firstLine: (body.split("\n")[0] ?? "").trim(),
    lastLine: (body.split("\n").filter((l) => l.trim()).pop() ?? "").trim(),
    // An email ends "Best,\nRiya": the sign-off is the line before the name.
    closingLines: body.split("\n").map((l) => l.trim()).filter(Boolean).slice(-3),
    endsWithQuestion: /\?\s*$/.test(body),
    sentenceInitials: sentences
      .map((s) => (words(s)[0] ?? "").toLowerCase())
      .filter(Boolean),
    pronouns: {
      i: pronounCount(/\bi\b|\bme\b|\bmy\b|\bmine\b/g),
      we: pronounCount(/\bwe\b|\bus\b|\bour\b|\bours\b/g),
      you: pronounCount(/\byou\b|\byour\b|\byours\b/g),
      they: pronounCount(/\bthey\b|\bthem\b|\btheir\b|\btheirs\b/g),
    },
    contractionsUsed,
    contractionOpportunities: contractionsUsed + expandedUsed,
    // Counted from the raw text: the clean step lifts them out of the prose.
    hashtags: raw.match(/#[\p{L}\p{N}_]+/gu) ?? [],
    emojis: body.match(EMOJI) ?? [],
    emojiAtEnd: /\p{Extended_Pictographic}/u.test(body.slice(-8)),
    capsWords: allWords.filter((w) => w.length > 1 && w === w.toUpperCase() && /\p{L}/u.test(w)).length,
    markdownEmphasis: count(body, /\*\*|__|\*\w|_\w/g),
    unicodeEmphasis: count(body, UNICODE_EMPHASIS),
    nonLatinTokens: allWords.filter((w) => NON_LATIN.test(w)).length,
  };
}

// ---- corpus measurement -----------------------------------------------------

export interface CorpusMeasurement {
  stats: CorpusStats;
  mechanics: Mechanics;
  index: VoiceIndex;
  /** Phrases repeated across >= 3 pieces — the candidates for intake E4. */
  signatureCandidates: { phrase: string; count: number }[];
  /** Per-channel piece counts, so contexts can be tagged measured vs inferred. */
  piecesByChannel: Record<string, number>;
  /** Pieces that read unlike the rest. Never auto-excluded; the user confirms. */
  suspected: { id?: string; reason: string }[];
  /**
   * How they write on each platform with enough pieces to measure (contexts.md,
   * spec 06 §4 "per piece and per channel"). Private channels describe patterns
   * only, never quote: an email block says "opens with 'Hi [name],'", not who.
   */
  channelBlocks: Record<string, Partial<VoiceContext>>;
}

/**
 * The overall fingerprint is measured from a balanced, recent slice: at most
 * this many pieces per channel, newest first. Otherwise 2,000 emails would set
 * the rhythm of their LinkedIn posts, and a voice from five years ago would
 * outvote last month's (spec 06 §3: weight the last 12–18 months higher).
 */
export const CHANNEL_BALANCE_CAP = 40;

const quotableHashtags = (per: PieceMetrics[], samples: MeasurableSample[]): string[] =>
  per.flatMap((p, i) => (samples[i].private ? [] : p.hashtags));

const mean = (xs: number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const pct = (n: number, total: number): number =>
  total ? Math.round((n / total) * 1000) / 10 : 0;

const round = (n: number, dp = 2): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** 2–6 word phrases that appear in at least `minPieces` different pieces. */
function repeatedPhrases(
  bodies: string[],
  minPieces = 3,
): { phrase: string; count: number }[] {
  const seen = new Map<string, Set<number>>();
  bodies.forEach((body, i) => {
    const w = words(body.toLowerCase());
    for (let n = 2; n <= 6; n++) {
      for (let j = 0; j + n <= w.length; j++) {
        const phrase = w.slice(j, j + n).join(" ");
        if (!seen.has(phrase)) seen.set(phrase, new Set());
        seen.get(phrase)!.add(i);
      }
    }
  });
  const hits = [...seen.entries()]
    .filter(([, pieces]) => pieces.size >= minPieces)
    .map(([phrase, pieces]) => ({ phrase, count: pieces.size }));
  // Keep the longest form of any phrase: "the thing is that" beats "the thing".
  const kept = hits.filter(
    (h) => !hits.some((o) => o !== h && o.count >= h.count && o.phrase.includes(h.phrase)),
  );
  return kept
    .sort((a, b) => b.count - a.count || b.phrase.length - a.phrase.length)
    .slice(0, 20);
}

/**
 * Words this person reaches for more than ordinary English does. A real TF-IDF
 * needs a reference corpus we do not have yet, so this is the honest version:
 * drop the commonest English words, then rank by how many separate pieces use
 * the word. Appearing in many pieces is what makes a word part of a voice.
 */
export const STOPWORDS = new Set(
  ("a about after all also an and any are as at be because been before but by can could did do does " +
   "down for from get go had has have he her here him his how i if in into is it its just like make " +
   "me more most my no not now of on one only or other our out over own really same see she so some " +
   "still such take than that the their them then there these they thing this those to too up us use " +
   "very was way we well were what when where which while who why will with would you your it's i'm " +
   "don't that's there's you're we're didn't doesn't isn't can't won't").split(" "),
);

function distinctiveWords(bodies: string[], limit = 20): string[] {
  const inPieces = new Map<string, number>();
  bodies.forEach((body) => {
    const uniq = new Set(words(body.toLowerCase()).filter((w) => w.length > 3 && !STOPWORDS.has(w)));
    uniq.forEach((w) => inPieces.set(w, (inPieces.get(w) ?? 0) + 1));
  });
  return [...inPieces.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w]) => w);
}

/** Name the shape of an opening line so the model has a pattern, not just text. */
function openerPattern(line: string): string {
  const w = words(line);
  if (/\?\s*$/.test(line)) return "Opens with a question";
  if (w.length <= 5) return "Opens with a short statement";
  if (/^(i|we|my|our)\b/i.test(line)) return "Opens from their own experience";
  if (/^\d|^\w+\s+(years|months|days|weeks)\b/i.test(line)) return "Opens on a number or a span of time";
  if (/^(when|after|before|last|yesterday|this morning)\b/i.test(line)) return "Opens on a scene";
  if (/^(most|everyone|nobody|people|they)\b/i.test(line)) return "Opens by naming what everyone thinks";
  return "Opens with a statement";
}

function closerPattern(line: string): string {
  if (/\?\s*$/.test(line)) return "Ends on a question";
  if (/\b(dm|message|comment|link in bio|book a call|reach out)\b/i.test(line)) return "Ends with an ask";
  if (words(line).length <= 4) return "Ends on a short line";
  return "Ends on a statement";
}

/** Two short quotes, enough to show the user why we believe a trait. */
function evidenceFrom(samples: MeasurableSample[], test: (t: string) => boolean): Evidence[] {
  const out: Evidence[] = [];
  for (const s of samples) {
    if (out.length >= 2) break;
    const line = splitSentences(s.body).find(test);
    if (line) out.push({ quote: line.slice(0, 160), sampleId: s.id });
  }
  return out;
}

export function measureCorpus(samples: MeasurableSample[]): CorpusMeasurement {
  const usable = samples.filter((s) => s.body.trim().length > 0);
  const per = usable.map((s) => measurePiece(s.body));
  const n = per.length;
  const publicBodies = usable.filter((s) => !s.private).map((s) => cleanForMeasure(s.body));

  const piecesByChannel: Record<string, number> = {};
  usable.forEach((s) => {
    const ch = s.channel ?? "unknown";
    piecesByChannel[ch] = (piecesByChannel[ch] ?? 0) + 1;
  });

  const allLengths = per.flatMap((p) => p.sentenceLengths);
  const stats: CorpusStats = {
    pieces: n,
    words: per.reduce((a, p) => a + p.wordCount, 0),
    sentences: allLengths.length,
    channels: Object.keys(piecesByChannel).sort(),
    from: usable.map((s) => s.publishedAt).filter(Boolean).sort()[0],
    to: usable.map((s) => s.publishedAt).filter(Boolean).sort().at(-1),
  };

  if (n === 0) {
    return {
      stats,
      mechanics: {},
      index: emptyIndex(),
      signatureCandidates: [],
      piecesByChannel,
      suspected: [],
      channelBlocks: {},
    };
  }

  // The balanced, recent slice the overall fingerprint is measured from.
  const byChannel = new Map<string, number[]>();
  usable.forEach((s, i) => {
    const ch = s.channel ?? "unknown";
    byChannel.set(ch, [...(byChannel.get(ch) ?? []), i]);
  });
  const balanced: number[] = [];
  for (const idx of byChannel.values()) {
    const newestFirst = [...idx].sort((a, b) => (usable[b].publishedAt ?? "").localeCompare(usable[a].publishedAt ?? ""));
    balanced.push(...newestFirst.slice(0, CHANNEL_BALANCE_CAP));
  }
  balanced.sort((a, b) => a - b);
  const bp = balanced.map((i) => per[i]);
  const bs = balanced.map((i) => usable[i]);
  const bn = bp.length;

  const lengths = bp.flatMap((p) => p.sentenceLengths);
  const sentenceStats = sentenceStatsOf(lengths);

  // Punctuation as a rate PER PIECE — the unit the user thinks in ("you use an
  // ellipsis about 1.6 times a post").
  const punctuation = {} as PunctuationRates;
  for (const k of Object.keys(bp[0].punctuation) as (keyof PunctuationRates)[]) {
    punctuation[k] = round(mean(bp.map((p) => p.punctuation[k])), 2);
  }

  const pronounTotals = bp.reduce(
    (acc, p) => ({
      i: acc.i + p.pronouns.i, we: acc.we + p.pronouns.we,
      you: acc.you + p.pronouns.you, they: acc.they + p.pronouns.they,
    }),
    { i: 0, we: 0, you: 0, they: 0 },
  );
  const pronounSum = pronounTotals.i + pronounTotals.we + pronounTotals.you + pronounTotals.they;

  // Public pieces only: in an email the first word is often a name ("Rahul,
  // can you…"), and names never go into the voice files (spec 06 §1).
  const initials = new Map<string, number>();
  bp.forEach((p, i) => {
    if (bs[i].private) return;
    p.sentenceInitials.forEach((w) => initials.set(w, (initials.get(w) ?? 0) + 1));
  });
  const sentenceInitial = [...initials.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([word, c]) => ({ word, count: c }));

  // Verbatim banks: public pieces only (see MeasurableSample.private), newest first.
  const quotable = bp.map((p, i) => ({ p, sample: bs[i] })).filter((x) => !x.sample.private).reverse();
  const openers = patternBank(quotable.map(({ p, sample }) => ({ pattern: openerPattern(p.firstLine), example: p.firstLine, sampleId: sample.id })));
  const closers = patternBank(quotable.map(({ p, sample }) => ({ pattern: closerPattern(p.lastLine), example: p.lastLine, sampleId: sample.id })));

  const contractionRate = round(
    bp.reduce((a, p) => a + p.contractionsUsed, 0) / (bp.reduce((a, p) => a + p.contractionOpportunities, 0) || 1),
    2,
  );

  const emphasis: string[] = [];
  const share = (f: (p: PieceMetrics) => boolean) => Math.round((bp.filter(f).length / bn) * 100);
  if (bp.some((p) => p.unicodeEmphasis > 0)) emphasis.push(`unicode bold (${share((p) => p.unicodeEmphasis > 0)}% of pieces)`);
  if (bp.some((p) => p.markdownEmphasis > 0)) emphasis.push(`markdown (${share((p) => p.markdownEmphasis > 0)}% of pieces)`);
  if (mean(bp.map((p) => p.capsWords)) >= 1) emphasis.push(`caps (about ${round(mean(bp.map((p) => p.capsWords)), 1)} words a piece)`);
  if (!emphasis.length) emphasis.push("none");

  const hashtagsAll = quotableHashtags(per, usable);
  const signatureCandidates = repeatedPhrases(publicBodies);

  const lengthsByChannel: Record<string, [number, number]> = {};
  for (const [ch, idx] of byChannel) {
    const lens = idx.map((i) => per[i].wordCount).sort((a, b) => a - b);
    lengthsByChannel[ch] = [lens[Math.floor(lens.length * 0.1)], lens[Math.min(lens.length - 1, Math.floor(lens.length * 0.9))]];
  }

  // Emoji: which (public only), how often, and where.
  const publicEmojis = bp.flatMap((p, i) => (bs[i].private ? [] : p.emojis));
  const emojiCounts = new Map<string, number>();
  publicEmojis.forEach((e) => emojiCounts.set(e, (emojiCounts.get(e) ?? 0) + 1));
  const withEmoji = bp.filter((p) => p.emojis.length);
  const emojiPosition = !withEmoji.length ? "none" : withEmoji.filter((p) => p.emojiAtEnd).length / withEmoji.length >= 0.6 ? "end" : "inline";

  // Language mixing: the share of words in a non-Latin script, and where.
  const totalWords = bp.reduce((a, p) => a + p.wordCount, 0) || 1;
  const nonLatin = bp.reduce((a, p) => a + p.nonLatinTokens, 0);
  const mixedChannels = [...new Set(bp.flatMap((p, i) => (p.nonLatinTokens > 0 ? [bs[i].channel ?? "unknown"] : [])))];

  const ev = (test: (t: string) => boolean) => evidenceFrom(bs.filter((s) => !s.private), test);
  const measured = <T>(value: T, evidence: Evidence[] = [], c = bn) =>
    tagged(value, "scan" as const, "measured" as const, { count: c, evidence });
  const endsQuestionPct = pct(bp.filter((p) => p.endsWithQuestion).length, bn);

  const mechanics: Mechanics = {
    sentences: measured(sentenceStats, ev((t) => words(t).length <= 3)),
    paragraphs: measured({
      sentencesPerParagraph: round(mean(bp.map((p) => (p.paragraphCount ? p.sentenceLengths.length / p.paragraphCount : 0))), 1),
      singleLinePct: pct(bp.reduce((a, p) => a + p.singleSentenceParagraphs, 0), bp.reduce((a, p) => a + p.paragraphCount, 0)),
    }, ev((t) => words(t).length <= 6)),
    punctuation: measured(punctuation, ev((t) => /…|\.{3,}|—|!|;/.test(t))),
    pronouns: measured({
      i: pct(pronounTotals.i, pronounSum), we: pct(pronounTotals.we, pronounSum),
      you: pct(pronounTotals.you, pronounSum), they: pct(pronounTotals.they, pronounSum),
    }, ev((t) => /\b(i|you)\b/i.test(t))),
    contractions: measured(contractionRate, ev((t) => /\b\w+['’](s|t|re|ve|ll|d|m)\b/i.test(t))),
    emphasis: measured(emphasis),
    sentenceInitial: measured(sentenceInitial, ev((t) => /^(and|but|so)\b/i.test(t.trim()))),
    openers: measured(openers, openers.slice(0, 2).map((o) => ({ quote: o.example, sampleId: o.sampleId })), openers.length),
    closers: measured(closers, closers.slice(0, 2).map((o) => ({ quote: o.example, sampleId: o.sampleId })), closers.length),
    closingQuestionPct: measured(endsQuestionPct),
    lexicon: measured(distinctiveWords(publicBodies)),
    signaturePhrases: measured(signatureCandidates, [], signatureCandidates.length),
    lengthByFormat: measured(lengthsByChannel),
    hashtags: measured({
      count: round(hashtagsAll.length / n, 1),
      casing: hashtagsAll.some((h) => /[A-Z]/.test(h.slice(1))) ? "mixed" : "lower",
      tags: [...new Set(hashtagsAll)].slice(0, 15),
    }),
    emoji: measured({
      perPiece: round(mean(bp.map((p) => p.emojis.length)), 2),
      top: [...emojiCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([e]) => e),
      position: emojiPosition,
    }),
    languageMix: measured({ nonLatinPct: pct(nonLatin, totalWords), channels: mixedChannels }),
  };

  return {
    stats,
    mechanics,
    index: deriveIndex(punctuation, sentenceStats, bp, signatureCandidates, lengthsByChannel),
    signatureCandidates,
    piecesByChannel,
    suspected: suspectedPieces(per, usable, contractionRate),
    channelBlocks: channelBlocks(byChannel, per, usable, sentenceStats),
  };
}

function sentenceStatsOf(lengths: number[]): SentenceStats {
  return {
    mean: round(mean(lengths), 1),
    median: median(lengths),
    shortPct: pct(lengths.filter((l) => l <= 4).length, lengths.length),
    midPct: pct(lengths.filter((l) => l > 4 && l <= 18).length, lengths.length),
    longPct: pct(lengths.filter((l) => l > 18).length, lengths.length),
    fragmentRate: round(lengths.filter((l) => l <= 3).length / (lengths.length || 1), 3),
  };
}

/** Openers or closers grouped by pattern, two real examples each (spec 06 §4 "Read"). */
function patternBank(xs: PatternExample[]): PatternExample[] {
  const seen = new Set<string>();
  const perPattern = new Map<string, number>();
  const out: PatternExample[] = [];
  for (const x of xs) {
    if (!x.example || seen.has(x.example)) continue;
    seen.add(x.example);
    const k = perPattern.get(x.pattern) ?? 0;
    if (k >= 2) continue;
    perPattern.set(x.pattern, k + 1);
    out.push(x);
  }
  return out.slice(0, 10);
}

/** The generic words that give machine-written text away (spec 06 §4 filter). */
const AI_LEXICON = [
  "delve", "tapestry", "fast-paced world", "ever-evolving", "navigate the complexities", "it's important to note",
  "in conclusion", "game-changer", "unlock the power", "leverage", "elevate", "seamlessly", "in today's",
  "embark", "testament to", "realm", "furthermore", "moreover",
];

/** Suspected not-them (spec 06 §4). Flagged for the user to confirm, never cut. */
function suspectedPieces(per: PieceMetrics[], usable: MeasurableSample[], corpusContractions: number) {
  const medianEmDash = median(per.map((p) => p.punctuation.emDash));
  return per
    .map((p, i) => {
      const reasons: string[] = [];
      if (p.punctuation.emDash >= 3 && p.punctuation.emDash > medianEmDash + 2)
        reasons.push("far more em dashes than the rest of your writing");
      const lens = p.sentenceLengths;
      if (lens.length >= 5) {
        const spread = Math.max(...lens) - Math.min(...lens);
        if (spread <= 4) reasons.push("every sentence is nearly the same length");
      }
      const lower = usable[i].body.toLowerCase();
      const aiHits = AI_LEXICON.filter((w) => lower.includes(w)).length;
      if (aiHits >= 2) reasons.push("uses several stock phrases that read machine-written");
      // A register shift: someone who contracts almost everything, writing fully formally.
      if (corpusContractions >= 0.6 && p.contractionOpportunities >= 5 && p.contractionsUsed / p.contractionOpportunities <= 0.1)
        reasons.push("far more formal than the rest of your writing");
      if (!reasons.length) return null;
      const flagged: { id?: string; reason: string } = { reason: reasons.join("; ") };
      if (usable[i].id !== undefined) flagged.id = usable[i].id;
      return flagged;
    })
    .filter((x): x is { id?: string; reason: string } => x !== null);
}

const GREETING = /^(hi|hey|hello|dear|good (morning|afternoon|evening)|hii+|namaste)\b/i;
const SIGNOFF = /^(thanks|thank you|best|regards|warm regards|kind regards|cheers|talk soon|take care|love|best wishes|sincerely)\b[,!.]?/i;

/**
 * One block per platform with at least MEASURED_CONTEXT_MINIMUM pieces
 * (contexts.md). Built from that platform's own pieces only. Private channels
 * get patterns, never quotes.
 */
function channelBlocks(
  byChannel: Map<string, number[]>,
  per: PieceMetrics[],
  usable: MeasurableSample[],
  overall: SentenceStats,
): Record<string, Partial<VoiceContext>> {
  const out: Record<string, Partial<VoiceContext>> = {};
  for (const [ch, idx] of byChannel) {
    if (ch === "unknown" || idx.length < MEASURED_CONTEXT_MINIMUM) continue;
    const ps = idx.map((i) => per[i]);
    const isPrivate = idx.every((i) => usable[i].private);
    const st = sentenceStatsOf(ps.flatMap((p) => p.sentenceLengths));
    const wc = ps.map((p) => p.wordCount).sort((a, b) => a - b);
    const typical = median(wc);
    const contr = ps.reduce((a, p) => a + p.contractionsUsed, 0) / (ps.reduce((a, p) => a + p.contractionOpportunities, 0) || 1);
    const single = pct(ps.reduce((a, p) => a + p.singleSentenceParagraphs, 0), ps.reduce((a, p) => a + p.paragraphCount, 0));
    const q = pct(ps.filter((p) => p.endsWithQuestion).length, ps.length);
    const tags = mean(ps.map((p) => p.hashtags.length));
    const emoji = mean(ps.map((p) => p.emojis.length));

    const firstPatterns = topOf(ps.map((p) => openerPattern(p.firstLine)));
    const lastPatterns = topOf(ps.map((p) => closerPattern(p.lastLine)));
    const greeting = topOf(ps.map((p) => p.firstLine.match(GREETING)?.[0]?.toLowerCase()).filter(Boolean) as string[]);
    const signOff = topOf(ps.map((p) => {
      const hit = p.closingLines.map((l) => l.match(SIGNOFF)?.[0]).find(Boolean);
      return hit?.replace(/[,!.]$/, "").toLowerCase();
    }).filter(Boolean) as string[]);
    const quote = (k: number, line: (p: PieceMetrics) => string) => {
      if (isPrivate) return "";
      const i = idx.find((j) => line(per[j]));
      return i === undefined ? "" : ` (e.g. "${line(per[i]).slice(0, 120)}")`;
    };

    const shorter = st.mean && overall.mean ? st.mean - overall.mean : 0;
    out[ch] = {
      register: [
        `Sentences average ${st.mean} words`,
        contr >= 0.6 ? "contracts almost everything" : contr <= 0.2 ? "rarely contracts" : `contracts about ${Math.round(contr * 100)}% of the time`,
      ].join("; "),
      length: `Typically ${typical} words (range ${wc[Math.floor(wc.length * 0.1)]}–${wc[Math.min(wc.length - 1, Math.floor(wc.length * 0.9))]})`,
      structure: single >= 60 ? `Mostly one-sentence paragraphs (${single}%), lots of white space` : `Paragraphs of a few sentences (${single}% are single lines)`,
      firstLine: greeting
        ? `Opens with "${capitalise(greeting)} [name],"`
        : firstPatterns ? `${firstPatterns}${quote(0, (p) => p.firstLine)}` : undefined,
      opener: firstPatterns,
      closer: [
        signOff ? `Signs off "${capitalise(signOff)},"` : lastPatterns ? `${lastPatterns}${quote(0, (p) => p.lastLine)}` : "",
        q >= 30 ? `${q}% end on a question` : "",
      ].filter(Boolean).join("; "),
      notes: [
        tags >= 0.5 ? `About ${round(tags, 1)} hashtags a piece` : "",
        emoji >= 0.3 ? `About ${round(emoji, 1)} emoji a piece` : "",
      ].filter(Boolean).join("; ") || undefined,
      differsBy: Math.abs(shorter) >= 3
        ? `${shorter < 0 ? "Shorter" : "Longer"} sentences than their default (${st.mean} vs ${overall.mean} words)`
        : undefined,
    };
  }
  return out;
}

function topOf(xs: string[]): string | undefined {
  const c = new Map<string, number>();
  xs.forEach((x) => c.set(x, (c.get(x) ?? 0) + 1));
  const best = [...c.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= Math.max(2, Math.ceil(xs.length * 0.3)) ? best[0] : undefined;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Turn the measurements into voice.json — the deterministic check index.
 *
 * "Allowed" means the habit is really theirs: the mark has to appear in at
 * least 15% of their pieces. One stray semicolon in forty posts is not a habit,
 * and treating it as one is how a voice file starts permitting everything.
 */
function deriveIndex(
  punctuation: PunctuationRates,
  sentences: SentenceStats,
  per: PieceMetrics[],
  signatures: { phrase: string; count: number }[],
  lengthByFormat: Record<string, [number, number]>,
): VoiceIndex {
  const n = per.length;
  const index: VoiceIndex = { ...emptyIndex(), lengthByFormat, sentenceLength: sentences };

  const marks: (keyof PunctuationRates)[] = [
    "emDash", "ellipsis", "exclamation", "semicolon", "emoji", "parentheses", "question",
  ];
  for (const mark of marks) {
    const used = per.filter((p) => p.punctuation[mark] > 0).length;
    const share = n ? used / n : 0;
    const allowed = share >= 0.15;
    const perPiece = per.map((p) => p.punctuation[mark]).sort((a, b) => a - b);
    index.punctuation[mark] = {
      allowed,
      perPostTarget: allowed ? punctuation[mark] : null,
      perPostMax: allowed ? Math.max(1, perPiece[Math.floor(perPiece.length * 0.9)] ?? 1) : 0,
    };
  }

  const endsQuestion = per.filter((p) => p.endsWithQuestion).length;
  if (n && endsQuestion / n >= 0.5) index.mustHaves.push("closing_question");
  if (sentences.fragmentRate >= 0.08) index.mustHaves.push("one_fragment");

  index.signaturePhrases = signatures.slice(0, 8).map((s) => s.phrase);
  return index;
}
