/** The angles a piece can take: Ideate offers them, and every pillar can be written from each. */
export const ANGLES = [
  "The mistake most people make",
  "A story from the work",
  "A simple framework",
  "What I'd do differently",
  "Where I disagree with the field",
  "What the work has taught me",
] as const;

/**
 * What each angle asks of the draft, in one line. An angle is a decision the
 * person made at Ideate; a bare label ("A story from the work") was read as
 * a mood, and the draft came back as an opinion piece. The line says what the
 * shape is and, where it matters, what to do when the brand context has no
 * material for it, so the model never fills the gap with an invented event.
 */
const ANGLE_SHAPE: Record<(typeof ANGLES)[number], string> = {
  "The mistake most people make":
    "name one specific mistake early, show why it is tempting, then say what to do instead.",
  "A story from the work":
    "tell it as a story in order: the situation, what happens, what it shows. Use a story from the brand context only if one fits the topic, with its facts as told. If none does, do not make one up: tell the situation as it typically goes, in the present tense, about \"you\" or founders in general, never about one founder or client it happened to, and without claiming a particular client, date or number.",
  "A simple framework":
    "give a small named structure of two to four parts the reader can use the same day, one line for each part.",
  "What I'd do differently":
    "write in hindsight: what they would change now and why, as their own view. Do not invent the past event it refers to.",
  "Where I disagree with the field":
    "state the common view fairly in a line, then argue their disagreement from their beliefs in the brand context.",
  "What the work has taught me":
    "one lesson from doing the work, shown through what they notice in it, not through a claim about a named client.",
};

/** The task-input line for an angle: the label and what it binds the draft to. */
export function angleLine(angle: string | null | undefined): string {
  const a = (angle ?? "").replace(/\s+/g, " ").trim();
  if (!a) return "";
  const shape = ANGLE_SHAPE[a as (typeof ANGLES)[number]];
  return shape ? `Angle: ${a} (${shape})` : `Angle: ${a}`;
}
