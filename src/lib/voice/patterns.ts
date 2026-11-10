/**
 * Patterns hidden across sources. Counting only: no model, no cost, and every
 * result can be traced to how many pieces it came from.
 *
 *   everywhere   A phrase they use in several pieces AND on more than one
 *                channel, at least one of them public: email and LinkedIn, a
 *                podcast and a newsletter. A habit that survives a change of
 *                audience is the strongest evidence of a real verbal signature.
 *
 * Private writing helps a phrase count, but never decides what is shown: a
 * phrase is named only when they have also said it publicly. Spec 06 §1: private
 * sources teach rhythm and register only, so nothing found only in email
 * (topics, names, details) is ever surfaced. An earlier "explained in email but
 * never posted" list did that and was removed for the same reason.
 *
 * Pure: the caller decides where results are shown and what is remembered.
 */
import { cleanForMeasure, STOPWORDS, words } from "./measure";

export interface PatternSample {
  body: string;
  channel: string;
  visibility: "public" | "private";
}

export interface EverywherePattern {
  phrase: string;
  pieces: number;
  channels: string[];
}

export interface Patterns {
  everywhere: EverywherePattern[];
}

/** Long pieces are read up to here: a 5,000-word report shouldn't outweigh a hundred emails. */
const MAX_WORDS_PER_PIECE = 600;

export function findPatterns(samples: PatternSample[], opts: { skip?: Iterable<string> } = {}): Patterns {
  const skip = new Set([...(opts.skip ?? [])].map((s) => s.toLowerCase()));
  const pieces = samples.map((s) => ({ ...s, lower: words(cleanForMeasure(s.body)).slice(0, MAX_WORDS_PER_PIECE).map((w) => w.toLowerCase()) }));
  return { everywhere: everywhere(pieces).filter((p) => !skip.has(p.phrase)) };
}

type Tok = PatternSample & { lower: string[] };

function everywhere(pieces: Tok[]): EverywherePattern[] {
  const seen = new Map<string, { pieces: Set<number>; channels: Set<string>; publicHit: boolean }>();
  pieces.forEach((p, i) => {
    const w = p.lower;
    for (let n = 2; n <= 5; n++) {
      for (let j = 0; j + n <= w.length; j++) {
        const gram = w.slice(j, j + n);
        // A phrase, not glue: "of the" is everyone's. Needs a word with meaning,
        // or enough length to be a turn of phrase ("at the end of").
        if (n < 4 && gram.every((g) => STOPWORDS.has(g))) continue;
        // Nor a topic: two words with meaning and nothing joining them ("term
        // insurance") is a subject they cover, not a way of saying things.
        if (n === 2 && gram.every((g) => !STOPWORDS.has(g))) continue;
        const phrase = gram.join(" ");
        let e = seen.get(phrase);
        if (!e) seen.set(phrase, (e = { pieces: new Set(), channels: new Set(), publicHit: false }));
        e.pieces.add(i);
        e.channels.add(p.channel);
        if (p.visibility === "public") e.publicHit = true;
      }
    }
  });
  const hits = [...seen.entries()]
    // Said publicly at least once, so naming it never exposes private writing.
    .filter(([, e]) => e.pieces.size >= 3 && e.channels.size >= 2 && e.publicHit)
    .map(([phrase, e]) => ({ phrase, pieces: e.pieces.size, channels: [...e.channels].sort() }));
  // Keep the longest form: "at the end of the day" beats "end of the day".
  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.pieces >= h.pieces && o.phrase.includes(h.phrase)));
  return kept
    .sort((a, b) => b.channels.length - a.channels.length || b.pieces - a.pieces || b.phrase.length - a.phrase.length)
    .slice(0, 8);
}

/** Bump when the rules above change, so cached results are found again. */
const PATTERNS_VERSION = 3;

/** What the patterns were found from: new writing (or new rules) earns a fresh look, nothing else does. */
export const patternsBasis = (stats: { pieces: number; words: number }) => `v${PATTERNS_VERSION}:${stats.pieces}:${stats.words}`;
