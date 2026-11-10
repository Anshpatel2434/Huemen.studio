/**
 * Perception Mirror (Layer 1, M2): a light "seen vs intended" read. Pure.
 *
 * Intended is the tone the person set (their dials); seen is the tone their
 * writing shows (dials read off its punctuation and contractions,
 * derive.estimateDials). Deliberately a handful of rows with a sentence each,
 * not a 150-dimension report.
 *
 * It reads tone only, never positioning. Positioning is an explicit non-goal
 * (design system, "the product does not decide anyone's positioning"): the
 * product holds a voice and checks against it; it does not judge what someone
 * stands for, so nothing here scores "on your position".
 */
import { estimateDials } from "./derive";
import { DIAL_LABELS, type DialKey, type VoicePack } from "./types";

export interface MirrorRow {
  label: string;
  intended: string;
  seen: string;
  gap: "none" | "small" | "wide";
  note: string;
}

export function perceptionMirror(pack: VoicePack): MirrorRow[] {
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

  return rows;
}
