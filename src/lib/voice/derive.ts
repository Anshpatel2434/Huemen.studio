/**
 * What can be worked out from a pack and its writing without asking anyone.
 * Pure — no I/O, no model, no clock.
 *
 *   confidence      how much the core can be trusted, out of 100 (§15.1)
 *   estimateDials   three of the eight dials, read off the measurements (C4)
 *   confirmCards    the H1–H5 cards a scan raises (file 05, section H)
 *   benchmarkPicks  the 6–8 pieces most typical of the voice (G2)
 *   removedWords    what an edit took out of a draft (edits are training)
 */
import { measurePiece, words } from "./measure";
import type { DialKey, PunctuationRates, VoicePack, VoiceSample } from "./types";
import { DIAL_LABELS } from "./types";

// ---- confidence (§15.1) -----------------------------------------------------

export interface Confidence {
  /** 0–100, floored. Never rounded up (§15.1). */
  score: number;
  /** Trained means 70+ AND measured from real writing. Below that: provisional. */
  trained: boolean;
  /** What would raise it, most valuable first. Plain English, for the UI. */
  missing: string[];
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Tied to the spec's own definition of a ready pack (file 01 §7), weighted by
 * what carries "sounds like me": real writing first. A pack can't reach 70
 * without ten pieces (or 1,000 words) of measured writing, however many
 * questions were answered — answers shape a voice, writing proves it.
 */
export function confidence(pack: VoicePack): Confidence {
  const missing: string[] = [];
  const { pieces, words: wordCount } = pack.corpusStats;

  // Real writing: 45. Reaching the minimum earns 35; the next 20 pieces, 10 more.
  const corpus = clamp01(Math.max(pieces / 10, wordCount / 1000)) * 35 + clamp01((pieces - 10) / 20) * 10;
  if (pieces < 10 && wordCount < 1000) missing.push(`Add ${10 - pieces} more pieces of your writing`);
  else if (pieces < 30) missing.push("Around 30 pieces makes the rarer habits reliable");

  // Measured mechanics: 15.
  const measured = pack.scannedAt && pack.mechanics.sentences?.confidence === "measured" ? 15 : 0;
  if (!measured) missing.push("Measure your writing");

  // Guardrails: 10. The facts rule is always on; this is what the person added.
  const guarded = pack.guardrails.length > 0 || pack.index.neverWords.length > 0 ? 10 : 0;
  if (!guarded) missing.push("Say what you'd never write");

  // Identity: 15 — the four words, the dials, the feeling targets.
  const id = pack.identity;
  const fourWords = (id.personalityWords?.value?.length ?? 0) >= 4 ? 5 : 0;
  const dials = Object.keys(id.dials?.value ?? {}).length >= 4 ? 5 : 0;
  const feelings = id.feeling30s?.value || id.feeling5m?.value || id.feeling20m?.value ? 5 : 0;
  if (!fourWords) missing.push("Pick your four words");
  if (!dials) missing.push("Set your dials");

  // Every platform they write for has a block: 10. Measured counts in full.
  const writeFor = pack.onboarding.writeFor ?? [];
  const blocks = writeFor.length
    ? writeFor.reduce((n, p) => n + (pack.contexts[p]?.tag === "measured" ? 1 : pack.contexts[p] ? 0.5 : 0), 0) / writeFor.length
    : 0;
  const contexts = Math.round(blocks * 10);
  if (writeFor.length && blocks < 1) missing.push("Add writing from each platform you post on");

  // One draft they said is them: 5.
  const approved = pack.onboarding.completedAt ? 5 : 0;

  const score = Math.floor(corpus + measured + guarded + fourWords + dials + feelings + contexts + approved);
  return {
    score: Math.min(100, score),
    trained: score >= 70 && pack.status === "active" && pieces > 0,
    missing,
  };
}

// ---- dials (C4: "pre-set from your writing") --------------------------------

/**
 * Three dials the measurements genuinely speak to. The other five (traditional,
 * accessible, adventurous, youthful, cheeky) are about intent, not punctuation,
 * so they are left for the person rather than guessed from counts.
 */
export function estimateDials(pack: VoicePack): Partial<Record<DialKey, number>> {
  const p = pack.mechanics.punctuation?.value as PunctuationRates | undefined;
  const contractions = pack.mechanics.contractions?.value;
  if (!p || typeof contractions !== "number") return {};
  const round = (n: number) => Math.max(1, Math.min(10, Math.round(n)));
  return {
    // 1 casual … 10 formal: people who contract everything read casual.
    casual_formal: round(9 - 7 * contractions - Math.min(2, p.emoji)),
    // 1 fun … 10 serious: exclamation and emoji pull toward fun.
    fun_serious: round(8 - Math.min(6, 3 * (p.exclamation + p.emoji))),
    // 1 enthusiastic … 10 practical: exclamation marks are the tell.
    enthusiastic_practical: round(8 - Math.min(6, 4 * p.exclamation)),
  };
}

// ---- confirm cards (file 05, section H) -------------------------------------

export interface ConfirmCard {
  id: string;
  kind: "H1" | "H2" | "H3" | "H4" | "H5";
  title: string;
  body: string;
  options: { key: string; label: string }[];
  /** Sample ids for H3, opener/closer texts for H4. */
  items?: { id: string; text: string }[];
}

const MARKS: [keyof PunctuationRates, string, string][] = [
  ["ellipsis", "…", "ellipsis"],
  ["emDash", "—", "em dash"],
  ["exclamation", "!", "exclamation mark"],
  ["emoji", "emoji", "emoji"],
  ["semicolon", ";", "semicolon"],
];

/**
 * Every card the current state raises, minus the ones already resolved. The
 * caller decides how many to show: three during onboarding (file 05: "Show a
 * maximum of 3 H cards in Core. Queue the rest for later").
 */
export function confirmCards(pack: VoicePack, samples: VoiceSample[]): ConfirmCard[] {
  const resolved = new Set(pack.onboarding.resolvedCards ?? []);
  const cards: ConfirmCard[] = [];

  // H3 — pieces that read unlike the rest. First: they change every number.
  const suspect = samples.filter((s) => s.suspectReason && !s.excluded);
  if (suspect.length && !resolved.has("H3")) {
    cards.push({
      id: "H3", kind: "H3",
      title: `${suspect.length} ${suspect.length === 1 ? "piece reads" : "pieces read"} differently from the rest`,
      body: "Did you write them yourself? If someone else did, they'll stop shaping your voice.",
      options: [{ key: "mine", label: "Yes, mine" }, { key: "remove", label: "No, remove them" }],
      items: suspect.map((s) => ({ id: s.id, text: s.body.split("\n")[0].slice(0, 120) })),
    });
  }

  // H1 — a dial moved 3+ points away from what the writing says.
  const dials = pack.identity.dials;
  const measuredDials = (dials?.measuredValue ?? {}) as Partial<Record<DialKey, number>>;
  for (const [key, measured] of Object.entries(measuredDials) as [DialKey, number][]) {
    const set = dials?.value?.[key];
    const id = `H1:${key}`;
    if (set == null || resolved.has(id) || Math.abs(set - measured) < 3) continue;
    const [left, right] = DIAL_LABELS[key];
    cards.push({
      id, kind: "H1",
      title: `You set ${left} ↔ ${right} to ${set}. Your writing reads closer to ${measured}.`,
      body: "Which should we write like?",
      options: [{ key: "now", label: "How I write now" }, { key: "want", label: "How I want to write" }],
    });
  }

  // H5 — a never-word that is in their own writing.
  for (const w of pack.index.neverWords) {
    const id = `H5:${w.toLowerCase()}`;
    if (resolved.has(id)) continue;
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const n = samples.filter((s) => !s.excluded && re.test(s.body)).length;
    if (n === 0) continue;
    cards.push({
      id, kind: "H5",
      title: `You said you'd never use "${w}", but it's in ${n} of your pieces.`,
      body: "Ban it from now on?",
      options: [{ key: "ban", label: "Ban it" }, { key: "allow", label: "It's fine, allow it" }],
    });
  }

  // H2 — a strong punctuation habit.
  const p = pack.mechanics.punctuation?.value as PunctuationRates | undefined;
  for (const [key, glyph, name] of MARKS) {
    const rate = p?.[key] ?? 0;
    const id = `H2:${key}`;
    if (rate < 1 || resolved.has(id)) continue;
    cards.push({
      id, kind: "H2",
      title: `You use ${glyph === name ? name : `“${glyph}”`} about ${rate} times a piece.`,
      body: "Keep it as part of your voice?",
      options: [{ key: "keep", label: "Keep it" }, { key: "drop", label: "Drop it" }],
    });
  }

  // H4 — openers and closers.
  const openers = pack.mechanics.openers?.value ?? [];
  const closers = pack.mechanics.closers?.value ?? [];
  if ((openers.length || closers.length) && !resolved.has("H4")) {
    cards.push({
      id: "H4", kind: "H4",
      title: "Here's how you usually start and end.",
      body: "Tick any you're tired of. They won't be used as a pattern again.",
      options: [{ key: "save", label: "Save" }],
      // A short piece opens and closes on the same line: show it once, and let
      // one tick drop it from both lists (ids are comma-joined).
      items: [...[
        ...openers.slice(0, 4).map((o, i) => ({ id: `o${i}`, text: o.example })),
        ...closers.slice(0, 3).map((c, i) => ({ id: `c${i}`, text: c.example })),
      ].reduce((m, it) => m.set(it.text, m.has(it.text) ? `${m.get(it.text)},${it.id}` : it.id), new Map<string, string>())]
        .map(([text, id]) => ({ id, text })),
    });
  }

  return cards;
}

// ---- benchmarks (G2) --------------------------------------------------------

/**
 * The 6–8 pieces most typical of the voice: closest to the corpus median on
 * length and sentence rhythm. Not the most liked; the spec is explicit that
 * typical beats popular. Public pieces only: a benchmark is quoted in prompts.
 */
export function benchmarkPicks(samples: VoiceSample[], max = 8): VoiceSample[] {
  const pool = samples.filter((s) => s.visibility === "public" && !s.excluded && s.wordCount >= 15);
  if (pool.length <= 3) return pool;
  const stats = pool.map((s) => {
    const m = measurePiece(s.body);
    const lens = m.sentenceLengths;
    return { s, words: m.wordCount, mean: lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0 };
  });
  const median = (xs: number[]) => {
    const a = [...xs].sort((x, y) => x - y);
    return a[Math.floor(a.length / 2)];
  };
  const mw = median(stats.map((x) => x.words)) || 1;
  const ms = median(stats.map((x) => x.mean)) || 1;
  return stats
    .map((x) => ({ s: x.s, d: Math.abs(x.words - mw) / mw + Math.abs(x.mean - ms) / ms }))
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.min(max, Math.max(6, Math.ceil(pool.length / 2))))
    .map((x) => x.s);
}

// ---- edits are training (file 01 §4) ----------------------------------------

const STOP = new Set(
  "the and that this with from have your just they them their what when where which would could should about there been were into than then also very really more most some much".split(" "),
);

/** Distinct content words an edit removed. A word moved elsewhere doesn't count. */
export function removedWords(before: string, after: string): string[] {
  const norm = (t: string) => new Set(words(t.toLowerCase()).filter((w) => w.length >= 4 && !STOP.has(w)));
  const a = norm(after);
  return [...norm(before)].filter((w) => !a.has(w)).sort();
}

/** Repetitions before an edit pattern becomes a proposal card. */
export const EDIT_THRESHOLD = 4;

// ---- re-scan diff (file 06 §6) -------------------------------------------------

/**
 * What a re-scan changed, in the person's terms. Only movements big enough to
 * notice are reported, so a re-scan that changed nothing says so.
 */
export function scanChanges(
  before: { mechanics: VoicePack["mechanics"]; corpusStats: VoicePack["corpusStats"] },
  after: { mechanics: VoicePack["mechanics"]; corpusStats: VoicePack["corpusStats"] },
): string[] {
  const out: string[] = [];
  const b = before.corpusStats, a = after.corpusStats;
  if (a.pieces !== b.pieces) out.push(`Pieces measured: ${b.pieces} → ${a.pieces}.`);
  const avg = (s: typeof a) => (s.pieces ? Math.round(s.words / s.pieces) : 0);
  if (b.pieces && a.pieces && Math.abs(avg(a) - avg(b)) >= Math.max(15, avg(b) * 0.15)) {
    out.push(`Your pieces got ${avg(a) < avg(b) ? "shorter" : "longer"}: about ${avg(b)} → ${avg(a)} words.`);
  }
  const sb = before.mechanics.sentences?.value?.mean, sa = after.mechanics.sentences?.value?.mean;
  if (sb && sa && Math.abs(sa - sb) >= 2) out.push(`Average sentence: ${sb} → ${sa} words.`);
  const cb = before.mechanics.contractions?.value, ca = after.mechanics.contractions?.value;
  if (typeof cb === "number" && typeof ca === "number" && Math.abs(ca - cb) >= 0.15) {
    out.push(`You contract ${ca > cb ? "more" : "less"} often: ${Math.round(cb * 100)}% → ${Math.round(ca * 100)}%.`);
  }
  const pb = before.mechanics.punctuation?.value, pa = after.mechanics.punctuation?.value;
  for (const [k, name] of [["ellipsis", "Ellipses"], ["emDash", "Em dashes"], ["exclamation", "Exclamation marks"], ["emoji", "Emoji"]] as const) {
    const x = pb?.[k] ?? 0, y = pa?.[k] ?? 0;
    if (Math.abs(y - x) >= 0.5) out.push(`${name} per piece: ${x} → ${y}.`);
  }
  return out;
}
