/**
 * The brand core card's facts (design system §15.1), worked out once so every
 * place that shows the core (Brand home, Brand core › Voice, the composer
 * aside in Check) says the same thing about it. Pure: no I/O.
 */
import { confidence } from "./derive";
import { coreState } from "./lifecycle";
import type { VoicePack } from "./types";

export interface CoreCardFacts {
  name: string;
  seed: string;
  subtitle: string;
  trained: boolean;
  state: ReturnType<typeof coreState>;
  attributes: string[];
  /** Never rounded up, never hidden once trained (§15.1). */
  confidence: number;
  /** What would raise the confidence, most useful first. */
  missing: string[];
  stats: { label: string; value: string }[];
}

export function coreCardFacts(pack: VoicePack, now: number): CoreCardFacts {
  const conf = confidence(pack);
  const words = pack.corpusStats.words;
  const channels = pack.corpusStats.channels;
  const measured = pack.scannedAt
    ? ` · measured ${new Date(pack.scannedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
    : "";
  return {
    name: pack.displayName || "Your voice",
    seed: pack.id,
    subtitle: `${channels[0] ? channels.join(", ") + " · " : ""}core v${pack.version}${measured}`,
    trained: conf.trained,
    state: coreState(pack, now),
    attributes: (pack.identity.toneDescriptors?.value ?? []).slice(0, 5),
    confidence: conf.score,
    missing: conf.missing,
    stats: [
      { label: "Samples", value: String(pack.corpusStats.pieces) },
      { label: "Words read", value: words >= 1000 ? `${(words / 1000).toFixed(1)}k` : String(words) },
      { label: "Channels", value: String(channels.length) },
    ],
  };
}
