/**
 * Brief follow-up questions (step 1 → 2). Pure and deterministic.
 *
 * Two kinds:
 *   - GAP questions: asked only when a brief field is missing. The answer is
 *     written INTO the brief (so it reaches every prompt via the one context
 *     builder, INV-2).
 *   - STRATEGY questions: always asked. Their answers are the seeds the pillar
 *     step works from (stored on the project, passed as task input).
 */
import type { FoundationForm } from "@/lib/data/foundation-types";

export type QuestionTarget = keyof Pick<FoundationForm, "niche" | "positioning" | "audience" | "tone" | "dontWords" | "samplePosts" | "palette"> | "seed";

export interface BriefQuestion {
  key: string;
  question: string;
  why: string;
  placeholder: string;
  target: QuestionTarget;
  rows: number;
}

const GAPS: { field: Exclude<QuestionTarget, "seed">; empty: (f: FoundationForm) => boolean; q: Omit<BriefQuestion, "target"> }[] = [
  { field: "niche", empty: (f) => !f.niche.trim(), q: { key: "niche", question: "In one line, what's the niche?", why: "Every draft is framed by it.", placeholder: "e.g. Leadership coaching for first-time managers", rows: 1 } },
  { field: "audience", empty: (f) => !f.audience.trim(), q: { key: "audience", question: "Who exactly should stop scrolling for this?", why: "Pillars and hooks are aimed at them.", placeholder: "Role, stage, the problem keeping them up", rows: 2 } },
  { field: "positioning", empty: (f) => !f.positioning.trim(), q: { key: "positioning", question: "Finish the sentence: I help ___ do ___ so they can ___.", why: "This becomes the positioning line.", placeholder: "I help…", rows: 2 } },
  { field: "tone", empty: (f) => !f.tone.trim(), q: { key: "tone", question: "Three words for how you sound?", why: "Sets the voice on every draft.", placeholder: "direct, warm, a little cheeky", rows: 1 } },
  { field: "dontWords", empty: (f) => !f.dontWords.trim(), q: { key: "dontWords", question: "Which words would you never be caught using?", why: "They become guardrails, flagged in every draft.", placeholder: "synergy, hustle, leverage", rows: 1 } },
  { field: "samplePosts", empty: (f) => f.samplePosts.split("\n").filter((s) => s.trim()).length < 3, q: { key: "samplePosts", question: "Paste a few posts that sound like you (one per line).", why: "Voice matching needs real examples.", placeholder: "One post per line", rows: 4 } },
  { field: "palette", empty: (f) => !f.palette.trim(), q: { key: "palette", question: "Any brand colours? Hex codes are fine.", why: "Used by every visual.", placeholder: "#0A0A0A, #FFFFFF", rows: 1 } },
];

export const STRATEGY: Omit<BriefQuestion, "target">[] = [
  { key: "known_for", question: "Twelve months from now, what do you want to be known for?", why: "Your signature pillar.", placeholder: "The one idea people tag you in", rows: 2 },
  { key: "contrarian", question: "What do you believe that most people in your field would argue with?", why: "Contrarian takes travel furthest.", placeholder: "A hill you'd defend", rows: 2 },
  { key: "questions", question: "What do clients ask you over and over?", why: "Ready-made content your audience already wants.", placeholder: "The questions you're tired of answering in DMs", rows: 2 },
  { key: "proof", question: "Which result or story can you talk about publicly?", why: "Proof builds authority.", placeholder: "A client win, a number, a turnaround", rows: 2 },
  { key: "behind", question: "What part of your work do people never get to see?", why: "Behind-the-scenes builds trust.", placeholder: "Your process, your tools, your bad days", rows: 2 },
];

export function buildQuestions(f: FoundationForm): BriefQuestion[] {
  return [
    ...GAPS.filter((g) => g.empty(f)).map((g) => ({ ...g.q, target: g.field })),
    ...STRATEGY.map((q) => ({ ...q, target: "seed" as const })),
  ];
}

/** Apply gap answers onto the brief; seeds are returned for the project row. */
export function applyAnswers(
  f: FoundationForm,
  questions: BriefQuestion[],
  answers: Record<string, string>,
): { foundation: FoundationForm; seeds: { key: string; question: string; answer: string }[] } {
  const next = { ...f };
  const seeds: { key: string; question: string; answer: string }[] = [];
  for (const q of questions) {
    const a = (answers[q.key] ?? "").trim();
    if (!a) continue;
    if (q.target === "seed") seeds.push({ key: q.key, question: q.question, answer: a });
    else next[q.target] = a;
  }
  return { foundation: next, seeds };
}

/** Strategy answers needed before pillars can be generated. */
export const MIN_SEEDS = 2;
