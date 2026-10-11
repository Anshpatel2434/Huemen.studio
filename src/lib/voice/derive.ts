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

/** A quote cut to `max` characters at a word boundary, with an ellipsis when cut. */
export function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

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
      body: suspect.length === 1
        ? "Did you write it yourself? If someone else did, it'll stop shaping your voice."
        : "Did you write them yourself? If someone else did, they'll stop shaping your voice.",
      options: [{ key: "mine", label: "Yes, mine" }, { key: "remove", label: suspect.length === 1 ? "No, remove it" : "No, remove them" }],
      items: suspect.map((s) => ({ id: s.id, text: clip(s.body.split("\n")[0], 120) })),
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

// ---- the voice meter (05, Part 1 rule 5) ---------------------------------------

/** The Core flow (05, Part 2), each worth an equal share of 70. */
const CORE_ITEMS: { id: string; done: (p: VoicePack) => boolean }[] = [
  { id: "G1", done: (p) => (p.onboarding.sources ?? []).length > 0 && p.corpusStats.pieces > 0 },
  { id: "A2", done: (p) => !!p.identity.reader?.value },
  { id: "A3", done: (p) => (p.identity.personaRoles?.value ?? []).length > 0 },
  { id: "A4", done: (p) => !!p.identity.carries?.value || (p.onboarding.answered ?? []).includes("A4") },
  { id: "C1", done: (p) => !!p.identity.guarded?.value },
  { id: "C2", done: (p) => !!p.identity.unguarded?.value },
  { id: "C4", done: (p) => Object.keys(p.identity.dials?.value ?? {}).length > 0 },
  { id: "C5", done: (p) => (p.identity.personalityLonglist?.value ?? []).length > 0 },
  { id: "C6", done: (p) => (p.identity.personalityWords?.value ?? []).length >= 4 },
  { id: "D", done: (p) => p.guardrails.some((g) => ["self-label", "off-limits", "never-write"].includes(g.id)) },
  { id: "E1", done: (p) => p.index.neverWords.length > 0 },
  { id: "F1", done: (p) => (p.onboarding.writeFor ?? []).length > 0 },
  { id: "F2", done: (p) => (p.onboarding.answered ?? []).includes("F2") },
  { id: "G2", done: (p) => (p.onboarding.answered ?? []).includes("G2") },
];

/**
 * The meter that fills as they answer: Core complete is 70%, the Deep
 * questions fill the rest (05, Part 1 rule 5). Separate from `confidence`,
 * which also asks whether there is enough real writing to trust.
 */
export function voiceMeter(pack: VoicePack, deepTotal: number): { score: number; coreDone: number; coreTotal: number } {
  const coreDone = CORE_ITEMS.filter((c) => c.done(pack)).length;
  const answered = new Set(pack.onboarding.answered ?? []);
  const deepDone = [...answered].filter((id) => !CORE_ITEMS.some((c) => c.id === id) && /^[A-G]\d/.test(id)).length;
  const score = Math.floor((coreDone / CORE_ITEMS.length) * 70 + (deepTotal ? Math.min(1, deepDone / deepTotal) * 30 : 0));
  return { score: Math.min(100, score), coreDone, coreTotal: CORE_ITEMS.length };
}

// ---- red-pen self-check, derived (01 §3 red-pen.md) -------------------------------

/**
 * 5–8 yes/no questions from their own measurements and lines, ending with the
 * spec's own: "Could anyone else have written this line?" Derived, so it is
 * always there; the person can edit it on the Voice page.
 */
export function deriveSelfCheck(pack: VoicePack): string[] {
  const out: string[] = [];
  const s = pack.mechanics.sentences?.value;
  if (s?.mean) out.push(`Do sentences average about ${Math.round(s.mean)} words, with a short one dropped in?`);
  const c = pack.mechanics.contractions?.value;
  if (typeof c === "number") out.push(c >= 0.6 ? "Does it contract the way they talk (it's, don't, I'm)?" : c <= 0.2 ? "Are words written out, not contracted?" : "Are contractions used about as often as they use them?");
  const p = pack.index.punctuation;
  const banned = (["emDash", "exclamation", "semicolon", "emoji"] as const).filter((k) => p[k]?.allowed === false);
  if (banned.length) out.push(`Is it free of ${banned.map((k) => ({ emDash: "em dashes", exclamation: "exclamation marks", semicolon: "semicolons", emoji: "emoji" })[k]).join(", ")}?`);
  if (pack.index.neverWords.length) out.push("Is every word on their never-list gone?");
  if (pack.index.mustHaves.includes("closing_question")) out.push("Does it end on a question?");
  if (pack.guardrails.length) out.push("Does it keep every one of their lines, including how they'd frame a sensitive topic?");
  if (pack.identity.carries?.value) out.push("Does it quietly carry their one idea?");
  out.push("Is every number, name and result one they gave us, not invented?");
  return [...out.slice(0, 7), `Could anyone else have written this line? If yes, rewrite it until only ${pack.displayName || "they"} could have.`];
}

/**
 * The three hard rules (VOICE.md) when the person hasn't written their own:
 * their strongest guardrail, their strongest mechanical habit, and the facts
 * rule, which is always rule 3 (templates/VOICE.md).
 */
export function deriveHardRules(pack: VoicePack): string[] {
  const facts = "Never invent a fact, name, number or credential. Use a [placeholder].";
  const own = pack.hardRules.filter((r) => r.trim());
  if (own.length) return own.some((r) => /invent/i.test(r)) ? own.slice(0, 3) : [...own.slice(0, 2), facts];
  const out: string[] = [];
  const g = pack.guardrails.find((x) => x.id === "self-label") ?? pack.guardrails[0];
  if (g) out.push(g.rule);
  const p = pack.index.punctuation;
  const banned = (["emDash", "exclamation", "semicolon"] as const).filter((k) => p[k]?.allowed === false);
  if (banned.length) out.push(`No ${banned.map((k) => ({ emDash: "em dashes", exclamation: "exclamation marks", semicolon: "semicolons" })[k]).join(", ")}.`);
  else if (pack.index.neverWords.length) out.push(`Never use: ${pack.index.neverWords.slice(0, 5).join(", ")}.`);
  return [...out.slice(0, 2), facts];
}

// ---- benchmarks (G2) --------------------------------------------------------

/**
 * How far a piece sits from the corpus median, over every habit we measure:
 * length, sentence rhythm, short and long sentences, punctuation density,
 * contractions, single-line paragraphs and question endings (06 §4: "closest
 * to the median on all metrics, not highest engagement"). Lower is more typical.
 */
export function typicality(pool: { body: string }[]): number[] {
  const rows = pool.map((s) => {
    const m = measurePiece(s.body);
    const lens = m.sentenceLengths;
    const n = lens.length || 1;
    const punct = Object.values(m.punctuation).reduce((a, b) => a + b, 0);
    return [
      m.wordCount,
      lens.reduce((a, b) => a + b, 0) / n,
      lens.filter((l) => l <= 4).length / n,
      lens.filter((l) => l > 18).length / n,
      (punct / Math.max(1, m.wordCount)) * 100,
      m.contractionOpportunities ? m.contractionsUsed / m.contractionOpportunities : 0,
      m.paragraphCount ? m.singleSentenceParagraphs / m.paragraphCount : 0,
      m.endsWithQuestion ? 1 : 0,
    ];
  });
  if (!rows.length) return [];
  const med = rows[0].map((_, j) => {
    const col = rows.map((r) => r[j]).sort((a, b) => a - b);
    return col[Math.floor(col.length / 2)];
  });
  const spread = rows[0].map((_, j) => {
    const col = rows.map((r) => r[j]);
    return Math.max(...col) - Math.min(...col) || 1;
  });
  return rows.map((r) => r.reduce((d, v, j) => d + Math.abs(v - med[j]) / spread[j], 0));
}

/**
 * The 6–8 pieces most typical of the voice. Not the most liked; the spec is
 * explicit that typical beats popular. Public pieces only: a benchmark is
 * quoted in prompts.
 */
export function benchmarkPicks(samples: VoiceSample[], max = 8): VoiceSample[] {
  const pool = samples.filter((s) => s.visibility === "public" && !s.excluded && s.wordCount >= 15);
  if (pool.length <= 3) return pool;
  const d = typicality(pool);
  return pool
    .map((s, i) => ({ s, d: d[i] }))
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
