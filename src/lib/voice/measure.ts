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
  type VoiceIndex,
  emptyIndex,
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

export function measurePiece(text: string): PieceMetrics {
  const body = text.replace(/\r\n/g, "\n").trim();
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
    hashtags: body.match(/#[\p{L}\p{N}_]+/gu) ?? [],
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
}

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
const STOPWORDS = new Set(
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
  const bodies = usable.map((s) => s.body);
  const publicBodies = usable.filter((s) => !s.private).map((s) => s.body);

  const piecesByChannel: Record<string, number> = {};
  usable.forEach((s) => {
    const ch = s.channel ?? "unknown";
    piecesByChannel[ch] = (piecesByChannel[ch] ?? 0) + 1;
  });

  const allSentenceLengths = per.flatMap((p) => p.sentenceLengths);
  const stats: CorpusStats = {
    pieces: n,
    words: per.reduce((a, p) => a + p.wordCount, 0),
    sentences: allSentenceLengths.length,
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
    };
  }

  const sentenceStats: SentenceStats = {
    mean: round(mean(allSentenceLengths), 1),
    median: median(allSentenceLengths),
    shortPct: pct(allSentenceLengths.filter((l) => l <= 4).length, allSentenceLengths.length),
    midPct: pct(allSentenceLengths.filter((l) => l > 4 && l <= 18).length, allSentenceLengths.length),
    longPct: pct(allSentenceLengths.filter((l) => l > 18).length, allSentenceLengths.length),
    fragmentRate: round(
      allSentenceLengths.filter((l) => l <= 3).length / (allSentenceLengths.length || 1),
      3,
    ),
  };

  // Punctuation as a rate PER PIECE — the unit the user thinks in ("you use an
  // ellipsis about 1.6 times a post").
  const punctuation = {} as PunctuationRates;
  const punctuationKeys = Object.keys(per[0].punctuation) as (keyof PunctuationRates)[];
  for (const k of punctuationKeys) {
    punctuation[k] = round(mean(per.map((p) => p.punctuation[k])), 2);
  }

  const pronounTotals = per.reduce(
    (acc, p) => ({
      i: acc.i + p.pronouns.i, we: acc.we + p.pronouns.we,
      you: acc.you + p.pronouns.you, they: acc.they + p.pronouns.they,
    }),
    { i: 0, we: 0, you: 0, they: 0 },
  );
  const pronounSum = pronounTotals.i + pronounTotals.we + pronounTotals.you + pronounTotals.they;

  const initials = new Map<string, number>();
  per.flatMap((p) => p.sentenceInitials).forEach((w) => initials.set(w, (initials.get(w) ?? 0) + 1));
  const sentenceInitial = [...initials.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([word, c]) => ({ word, count: c }));

  const dedupe = (xs: PatternExample[]) => {
    const seen = new Set<string>();
    return xs.filter((x) => !seen.has(x.example) && seen.add(x.example));
  };
  // Verbatim banks: public pieces only (see MeasurableSample.private).
  const quotable = per
    .map((p, i) => ({ p, sample: usable[i] }))
    .filter((x) => !x.sample.private);
  const openers = dedupe(
    quotable.map(({ p, sample }) => ({
      pattern: openerPattern(p.firstLine),
      example: p.firstLine,
      sampleId: sample.id,
    })).filter((o) => o.example),
  ).slice(0, 10);
  const closers = dedupe(
    quotable.map(({ p, sample }) => ({
      pattern: closerPattern(p.lastLine),
      example: p.lastLine,
      sampleId: sample.id,
    })).filter((c) => c.example),
  ).slice(0, 10);

  const contractionRate = round(
    per.reduce((a, p) => a + p.contractionsUsed, 0) /
      (per.reduce((a, p) => a + p.contractionOpportunities, 0) || 1),
    2,
  );

  const emphasis: string[] = [];
  if (per.some((p) => p.unicodeEmphasis > 0)) emphasis.push("unicode bold");
  if (per.some((p) => p.markdownEmphasis > 0)) emphasis.push("markdown");
  if (mean(per.map((p) => p.capsWords)) >= 1) emphasis.push("caps");
  if (!emphasis.length) emphasis.push("none");

  const hashtagsAll = quotableHashtags(per, usable);
  const signatureCandidates = repeatedPhrases(publicBodies);

  const lengthsByChannel: Record<string, [number, number]> = {};
  for (const ch of stats.channels) {
    const lens = usable
      .map((s, i) => ({ ch: s.channel ?? "unknown", w: per[i].wordCount }))
      .filter((x) => x.ch === ch)
      .map((x) => x.w)
      .sort((a, b) => a - b);
    if (lens.length) {
      lengthsByChannel[ch] = [
        lens[Math.floor(lens.length * 0.1)],
        lens[Math.min(lens.length - 1, Math.floor(lens.length * 0.9))],
      ];
    }
  }

  const ev = (test: (t: string) => boolean) =>
    evidenceFrom(usable.filter((s) => !s.private), test);
  const measured = <T>(value: T, evidence: Evidence[] = [], c = n) =>
    tagged(value, "scan" as const, "measured" as const, { count: c, evidence });

  const mechanics: Mechanics = {
    sentences: measured(sentenceStats, ev((t) => words(t).length <= 3)),
    paragraphs: measured({
      sentencesPerParagraph: round(
        mean(per.map((p) => (p.paragraphCount ? p.sentenceLengths.length / p.paragraphCount : 0))),
        1,
      ),
      singleLinePct: pct(
        per.reduce((a, p) => a + p.singleSentenceParagraphs, 0),
        per.reduce((a, p) => a + p.paragraphCount, 0),
      ),
    }),
    punctuation: measured(punctuation, ev((t) => /…|\.{3,}|—/.test(t))),
    pronouns: measured({
      i: pct(pronounTotals.i, pronounSum), we: pct(pronounTotals.we, pronounSum),
      you: pct(pronounTotals.you, pronounSum), they: pct(pronounTotals.they, pronounSum),
    }),
    contractions: measured(contractionRate),
    emphasis: measured(emphasis),
    sentenceInitial: measured(sentenceInitial),
    openers: measured(openers, [], openers.length),
    closers: measured(closers, [], closers.length),
    lexicon: measured(distinctiveWords(publicBodies)),
    signaturePhrases: measured(signatureCandidates, [], signatureCandidates.length),
    lengthByFormat: measured(lengthsByChannel),
    hashtags: measured({
      count: round(hashtagsAll.length / n, 1),
      casing: hashtagsAll.some((h) => /[A-Z]/.test(h.slice(1))) ? "mixed" : "lower",
      tags: [...new Set(hashtagsAll)].slice(0, 15),
    }),
  };

  // Suspected not-them (spec 06 §4). Flagged for the user to confirm, never cut.
  const medianEmDash = median(per.map((p) => p.punctuation.emDash));
  const suspected = per
    .map((p, i) => {
      const reasons: string[] = [];
      if (p.punctuation.emDash >= 3 && p.punctuation.emDash > medianEmDash + 2)
        reasons.push("far more em dashes than the rest of your writing");
      const lens = p.sentenceLengths;
      if (lens.length >= 5) {
        const spread = Math.max(...lens) - Math.min(...lens);
        if (spread <= 4) reasons.push("every sentence is nearly the same length");
      }
      if (!reasons.length) return null;
      const flagged: { id?: string; reason: string } = { reason: reasons.join("; ") };
      if (usable[i].id !== undefined) flagged.id = usable[i].id;
      return flagged;
    })
    .filter((x): x is { id?: string; reason: string } => x !== null);

  return {
    stats,
    mechanics,
    index: deriveIndex(punctuation, sentenceStats, per, signatureCandidates, lengthsByChannel),
    signatureCandidates,
    piecesByChannel,
    suspected,
  };
}

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
