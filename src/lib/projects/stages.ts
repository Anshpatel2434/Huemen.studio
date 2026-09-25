/**
 * The steps a PIECE goes through — pure, client-safe.
 *
 * Migration 0007 moved the brand up to the workspace: the brief, voice, visual
 * identity and pillars are set once in onboarding and do not change from one
 * piece to the next. What is left per piece is the work itself:
 *
 *   Ideate  — what is this one about, and from which angle
 *   Content — the copy
 *   Visual  — what it looks like
 *
 * Each step unlocks the next; none are skipped.
 */
export const STAGES = ["ideate", "content", "visual"] as const;
export type Stage = (typeof STAGES)[number];
export const stageIndex = (s: Stage) => STAGES.indexOf(s);
export const STAGE_LABEL: Record<Stage, string> = {
  ideate: "Ideate",
  content: "Content",
  visual: "Visual",
};
