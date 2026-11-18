/**
 * The brief's status as the agent shows it (audit H5, 2026-11-18). The score
 * and the open items come from the brief itself: the completeness score and
 * the gaps the context builder found. The model never writes a number or a
 * done / not-done mark; it places a BriefStatus() component where the status
 * belongs, and the panel draws these values.
 *
 * React-free and pure, so the stream route can send it and a test can check it.
 */

export interface BriefStatus {
  /** 0-100: the brief's own completeness, rounded and clamped. */
  score: number;
  /** The brief's own gaps, in its words. Every one of them is still open. */
  open: string[];
}

/** Where the open items are fixed (the Getting started page). */
export const STATUS_FIX_PAGE = "setup" as const;

export function briefStatus(completeness: number, warnings: string[]): BriefStatus {
  const score = Number.isFinite(completeness) ? Math.max(0, Math.min(100, Math.round(completeness))) : 0;
  const open = warnings.map((w) => w.trim()).filter(Boolean);
  return { score, open };
}
