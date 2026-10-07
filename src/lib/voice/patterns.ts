/**
 * Patterns hidden across sources. Counting only: no model, no cost, and every
 * result can be traced to how many pieces it came from.
 *
 *   everywhere   A phrase they use in several pieces AND on more than one
 *                channel, at least one of them public: email and LinkedIn, a
 *                podcast and a newsletter. A habit that survives a change of
 *                audience is the strongest evidence of a real verbal signature.
 *   privateOnly  What they keep explaining in private writing (mostly email)
 *                but have never posted about. Ideas waiting to be written.
 *                Topics only, never a quote: single words and two-word terms,
 *                with likely names (never written in lower case) left out, so
 *                nothing private is repeated back.
 *
 * Pure: the caller decides where results are shown and what is remembered.
 */
import { STOPWORDS, words } from "./measure";

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

export interface PrivateTopic {
  term: string;
  pieces: number;
  /** Share of their private pieces it appears in, 0..1. */
  share: number;
}

export interface Patterns {
  everywhere: EverywherePattern[];
  privateOnly: PrivateTopic[];
}

/** Email and chat housekeeping: frequent in private writing, never a topic. */
const FILLER = new Set(
  ("thanks thank regards best attached attachment please hope meeting call email mail emails " +
   "tomorrow today yesterday week weeks next know sure great okay kindly find below above dear hello team " +
   "available schedule confirm reply sent send forward forwarded cheers warm wishes sorry happy glad " +
   "monday tuesday wednesday thursday friday saturday sunday morning evening afternoon " +
   "january february march april june july august september october november december").split(" "),
);

/** Long pieces are read up to here: a 5,000-word report shouldn't outweigh a hundred emails. */
const MAX_WORDS_PER_PIECE = 600;

const isContent = (w: string) => w.length > 3 && !STOPWORDS.has(w) && !FILLER.has(w) && !/^\d/.test(w);

/** Tokens in lower case, and which of them were ever written in lower case (names never are). */
function tokens(body: string): { lower: string[]; seenLower: Set<string> } {
  const raw = words(body).slice(0, MAX_WORDS_PER_PIECE);
  return {
    lower: raw.map((w) => w.toLowerCase()),
    seenLower: new Set(raw.filter((w) => w === w.toLowerCase())),
  };
}

export function findPatterns(samples: PatternSample[], opts: { skip?: Iterable<string> } = {}): Patterns {
  const skip = new Set([...(opts.skip ?? [])].map((s) => s.toLowerCase()));
  const pieces = samples.map((s) => ({ ...s, ...tokens(s.body) }));
  return {
    everywhere: everywhere(pieces).filter((p) => !skip.has(p.phrase)),
    privateOnly: privateOnly(pieces).filter((t) => !skip.has(t.term)),
  };
}

type Tok = PatternSample & { lower: string[]; seenLower: Set<string> };

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

function privateOnly(pieces: Tok[]): PrivateTopic[] {
  const priv = pieces.filter((p) => p.visibility === "private");
  const pub = pieces.filter((p) => p.visibility === "public");
  // "Never posted" needs something posted to compare with.
  if (pub.length < 3 || priv.length < 3) return [];

  const terms = (p: Tok): Set<string> => {
    const out = new Set<string>();
    p.lower.forEach((w, i) => {
      if (!isContent(w)) return;
      out.add(w);
      const next = p.lower[i + 1];
      if (next && isContent(next)) out.add(`${w} ${next}`);
    });
    return out;
  };

  const inPublic = new Set<string>();
  for (const p of pub) {
    for (const t of terms(p)) inPublic.add(t);
    // A word posted in any form counts as posted.
    for (const w of p.lower) inPublic.add(w);
  }

  const count = new Map<string, number>();
  const lowerSomewhere = new Set<string>();
  for (const p of priv) {
    for (const t of terms(p)) count.set(t, (count.get(t) ?? 0) + 1);
    p.seenLower.forEach((w) => lowerSomewhere.add(w));
  }

  // A single word has to recur more than a two-word term to mean anything:
  // "plan" in three emails is noise, "term insurance" in three is a subject.
  const floor = (t: string) =>
    t.includes(" ") ? Math.max(3, Math.ceil(priv.length * 0.05)) : Math.max(5, Math.ceil(priv.length * 0.1));
  const hits = [...count.entries()]
    .filter(([t, n]) => n >= floor(t))
    // Never posted: a word never used publicly in any form, or a two-word term
    // never used publicly as a pair. And no names: every word was written in
    // lower case somewhere.
    .filter(([t]) => !inPublic.has(t) && t.split(" ").every((w) => lowerSomewhere.has(w)))
    .map(([term, n]) => ({ term, pieces: n, share: Math.round((n / priv.length) * 100) / 100 }));
  // A two-word term that carries most of a word's uses says it better: "term insurance" over "insurance".
  const kept = hits.filter(
    (h) => h.term.includes(" ") || !hits.some((o) => o.term.includes(" ") && o.term.split(" ").includes(h.term) && o.pieces >= h.pieces * 0.8),
  );
  return kept.sort((a, b) => b.pieces - a.pieces || a.term.localeCompare(b.term)).slice(0, 8);
}

/** Bump when the rules above change, so cached results are found again. */
const PATTERNS_VERSION = 2;

/** What the patterns were found from: new writing (or new rules) earns a fresh look, nothing else does. */
export const patternsBasis = (stats: { pieces: number; words: number }) => `v${PATTERNS_VERSION}:${stats.pieces}:${stats.words}`;
