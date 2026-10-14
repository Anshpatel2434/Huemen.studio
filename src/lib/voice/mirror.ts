/**
 * Perception Mirror (Layer 1, M2): a light "seen vs intended" read. Pure.
 *
 * Intended is what the person told us: the dials they set, and what they say
 * they stand for (the one idea every piece carries, their beliefs, their niche).
 * Seen is what their public writing shows: the dials read off its punctuation
 * and contractions (derive.estimateDials), and how often a piece actually
 * touches what they stand for. Deliberately a handful of rows with a sentence
 * each, not a 150-dimension report: a gap worth acting on, or none.
 */
import { estimateDials } from "./derive";
import { words } from "./measure";
import { DIAL_LABELS, type DialKey, type VoicePack } from "./types";

export interface MirrorRow {
  label: string;
  intended: string;
  seen: string;
  gap: "none" | "small" | "wide";
  note: string;
}

const STOP = new Set("the and for with that this your you are was were from have has into about what when where which who will would their them they then than there here more most less very just like over under only also such been being does doing done make makes made help helps".split(" "));

const keyTerms = (texts: string[]) =>
  [...new Set(texts.flatMap((t) => words(t.toLowerCase())).filter((w) => w.length >= 5 && !STOP.has(w)))];

export function perceptionMirror(pack: VoicePack, publicWriting: string[], niche = ""): MirrorRow[] {
  const rows: MirrorRow[] = [];
  const intended = pack.identity.dials?.value ?? pack.index.dials ?? {};
  const seen = estimateDials(pack);
  for (const key of Object.keys(seen) as DialKey[]) {
    const s = seen[key]!;
    const i = intended[key];
    if (typeof i !== "number") continue;
    const [lo, hi] = DIAL_LABELS[key];
    const side = (n: number) => (n <= 4 ? lo.toLowerCase() : n >= 7 ? hi.toLowerCase() : "in between");
    const d = Math.abs(s - i);
    rows.push({
      label: `${lo} or ${hi.toLowerCase()}`,
      intended: `${i}/10, ${side(i)}`,
      seen: `${s}/10, ${side(s)}`,
      gap: d >= 4 ? "wide" : d >= 2 ? "small" : "none",
      note: d >= 4
        ? `You want to read ${side(i)}; your writing reads ${side(s)}.`
        : d >= 2 ? "Close, with a little drift." : "Your writing reads the way you intend.",
    });
  }

  const stands = [pack.identity.carries?.value ?? "", ...(pack.identity.beliefs?.value ?? []), niche].filter(Boolean);
  const terms = keyTerms(stands);
  if (terms.length && publicWriting.length) {
    const hits = publicWriting.filter((t) => { const w = new Set(words(t.toLowerCase())); return terms.some((k) => w.has(k)); }).length;
    const pct = Math.round((hits / publicWriting.length) * 100);
    rows.push({
      label: "On your position",
      intended: "Every piece carries what you stand for",
      seen: `${pct}% of ${publicWriting.length} public pieces touch it`,
      gap: pct >= 60 ? "none" : pct >= 30 ? "small" : "wide",
      note: pct >= 60 ? "Your writing keeps coming back to your position." : pct >= 30 ? "Some pieces wander from what you stand for." : "Most of your writing doesn't touch what you say you stand for yet.",
    });
  }
  return rows;
}
