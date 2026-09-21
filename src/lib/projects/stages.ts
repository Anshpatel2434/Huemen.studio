/** Stepwise pipeline — pure, client-safe. Each step unlocks the next; none are skipped. */
export const STAGES = ["brief", "pillars", "content", "visual"] as const;
export type Stage = (typeof STAGES)[number];
export const stageIndex = (s: Stage) => STAGES.indexOf(s);
export const STAGE_LABEL: Record<Stage, string> = { brief: "Brief", pillars: "Pillars", content: "Content", visual: "Visual" };
