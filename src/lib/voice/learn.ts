/**
 * Learning from use: which approved pieces may teach a person's voice.
 * Pure: no I/O, no model, no clock.
 *
 * The rule that keeps a voice from drifting toward the model: a piece teaches
 * the voice only when the words are the person's own. A draft approved as the
 * model wrote it would teach the voice the model's habits, and the next draft
 * would lean further that way (a feedback loop). So an approved piece counts
 * when the owner wrote it, or rewrote enough of it to make it theirs; and only
 * the voice's owner can teach it, never a coach writing on their behalf.
 */
import { words } from "./measure";

/** Share of an approved piece that must be the person's own to teach the voice. */
export const LEARN_MIN_EDIT = 0.25;

/** Pieces learned since the last measure before the voice re-measures itself. */
export const RELEARN_EVERY = 3;

/** Shortest piece worth learning from, in words: a one-liner says little about rhythm. */
export const LEARN_MIN_WORDS = 25;

const bag = (t: string) => {
  const m = new Map<string, number>();
  for (const w of words(t.toLowerCase())) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
};

/** Word overlap of two texts, 0 (nothing shared) to 1 (same words). */
export function similarity(a: string, b: string): number {
  const x = bag(a), y = bag(b);
  let shared = 0, total = 0;
  for (const [w, n] of x) { shared += Math.min(n, y.get(w) ?? 0); total += n; }
  for (const n of y.values()) total += n;
  return total ? (2 * shared) / total : 1;
}

/**
 * How much of the final text is the person's: 1 minus its closest match to
 * any version the model wrote. With no model versions at all, it is all theirs.
 */
export function ownShare(final: string, generated: string[]): number {
  if (!generated.length) return 1;
  return 1 - Math.max(...generated.map((g) => similarity(final, g)));
}

export type LearnDecision =
  | { learn: true; share: number; why: string }
  | { learn: false; share: number; why: string };

export function learnDecision(input: {
  final: string;
  generated: string[];
  /** Whether the person approving owns this voice. */
  owner: boolean;
}): LearnDecision {
  const share = ownShare(input.final, input.generated);
  const pct = Math.round(share * 100);
  if (!input.owner) return { learn: false, share, why: "Approved by someone else, so these aren't the owner's own words." };
  if (words(input.final).length < LEARN_MIN_WORDS) return { learn: false, share, why: "Too short to say much about how you write." };
  if (!input.generated.length) return { learn: true, share, why: "Written by you." };
  if (share >= LEARN_MIN_EDIT) return { learn: true, share, why: `You rewrote about ${pct}% of it.` };
  return { learn: false, share, why: `Mostly the draft as written (${pct}% yours), so it would only teach the voice its own habits.` };
}

/** Whether enough has been learned since the last measure to measure again. */
export const relearnDue = (learnedSinceScan: number): boolean => learnedSinceScan >= RELEARN_EVERY;
