/**
 * The model tasks whose answer is data rather than a draft. Pure — no I/O.
 *
 * Each task is defined ONCE here, with everything that has to agree:
 *
 *   schema    what the code will read. Enforced by the provider as structured
 *             output and validated again before anything uses it.
 *   contract  the output instructions appended to the prompt. Code-owned for
 *             the same reason as the draft contract (lib/ai/prompt): the
 *             editable template says how to think, this says what to return.
 *   template  the default system template, used until an admin saves one.
 *   mock      the stand-in answer, built only from the task input so it is
 *             deterministic. It exists so every flow runs end to end with no
 *             key; it is not a judgement of anyone's writing.
 *
 * Adding a task: add it here, and the facade (runTask), both providers and
 * the template store pick it up. Nothing else changes.
 */
import { z } from "zod";
import { ANTI_AI_PHRASES } from "@/lib/voice/platforms";

export interface TaskDef<T> {
  key: string;
  schema: z.ZodType<T>;
  contract: string;
  template: string;
  mock: (taskInput: string) => T;
}

/** Read "Label: value" lines out of a task input. */
export const field = (input: string, label: string): string =>
  input.match(new RegExp(`^${label}: (.+)$`, "m"))?.[1]?.trim() ?? "";
export const fields = (input: string, label: string): string[] =>
  [...input.matchAll(new RegExp(`^${label}: (.+)$`, "gm"))].map((m) => m[1].trim());
/** The block after "Label:" up to the next blank-line-then-Label, or the end. */
export const block = (input: string, label: string): string => {
  const i = input.indexOf(`${label}:\n`);
  if (i < 0) return "";
  const rest = input.slice(i + label.length + 2);
  const end = rest.search(/\n\n[A-Z][a-z ]+:\n/);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
};

// ---- topic proposals (design system §12: Create never opens blank) ----------

const Topics = z.object({
  topics: z.array(
    z.object({
      title: z.string(),
      why: z.string(),
      pillar: z.string(),
    }),
  ),
});
export type TopicProposals = z.infer<typeof Topics>;

const MOCK_ANGLES = [
  "The mistake I see most often in",
  "What changed my mind about",
  "A small moment that explains",
];

/**
 * Subjects the stand-in openings attach to. Crossed with MOCK_TOPICS they give
 * enough distinct lines to fill a quarter without repeating, which is what a
 * real plan has to do.
 */
const MOCK_SUBJECTS = [
  "the first ninety days",
  "hiring your replacement",
  "the meeting nobody needed",
  "saying no to good work",
  "the feedback that landed",
  "being the newest person in the room",
  "what the numbers left out",
];

export const topicProposals: TaskDef<TopicProposals> = {
  key: "topic_proposals",
  schema: Topics,
  template:
    "You suggest what a person should write about next. You have read how they sound and what they care about. Suggest topics they would actually have an opinion on, drawn from their own pillars and their own writing. Never suggest a topic that needs a fact they have not given.",
  contract: [
    "Return exactly three topics.",
    "Each has: title (one line, in their words, not a headline formula), why (one sentence naming what in their writing or pillars suggests it), pillar (the pillar name it belongs to, exactly as given, or an empty string).",
    "Do not repeat any topic listed under Recent.",
  ].join("\n"),
  mock(input) {
    const pillars = fields(input, "Pillar");
    const picked = (pillars.length ? pillars : ["your work"]).slice(0, 3);
    while (picked.length < 3) picked.push(picked[picked.length - 1]);
    return {
      topics: picked.map((p, i) => ({
        // A pillar name is a label, not a noun phrase: "…explains Origin story"
        // reads as a bug. Keep the pillar beside the line, not inside it.
        title: `${MOCK_ANGLES[i]} ${MOCK_SUBJECTS[i % MOCK_SUBJECTS.length]}`,
        why: `Stand-in suggestion from your "${p}" pillar.`,
        pillar: pillars.length ? p : "",
      })),
    };
  },
};

// ---- the judgement half of Check (§15.4) -----------------------------------

const Judge = z.object({
  findings: z.array(
    z.object({
      line: z.string(),
      verdict: z.enum(["on", "drift", "off"]),
      attribute: z.string(),
      why: z.string(),
      fix: z.string(),
    }),
  ),
});
export type JudgeResult = z.infer<typeof Judge>;

export const voiceJudge: TaskDef<JudgeResult> = {
  key: "voice_judge",
  schema: Judge,
  template:
    "You check whether a draft sounds like a specific person, against the measured voice and guardrails in the brand context. You judge their voice, never the quality of the writing in general, and never whether it sounds machine-written.",
  contract: [
    "Return the lines that matter: every line that drifts from their voice or breaks a guardrail, and at most two lines that are most like them.",
    "For each: line (quoted exactly from the draft), verdict (on | drift | off), attribute (the named trait or guardrail from the brand context it is measured against), why (one sentence citing their own writing or a measured number, never a generic rule), fix (the line rewritten in their voice; for an 'on' line, repeat it unchanged).",
    'Never say a line sounds like AI, sounds robotic, or sounds generic. Say what in their writing it differs from.',
  ].join("\n"),
  mock(input) {
    const draft = block(input, "Draft");
    const never = field(input, "Never use")
      .split(",")
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    const lines = draft.split("\n").map((l) => l.trim()).filter(Boolean);
    const findings: JudgeResult["findings"] = [];
    for (const line of lines) {
      const hit = never.find((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(line));
      if (hit) {
        findings.push({
          line,
          verdict: "off",
          attribute: "Never-list",
          why: `"${hit}" is on your never-list.`,
          fix: line.replace(new RegExp(`\\b${hit}\\b`, "ig"), "").replace(/\s{2,}/g, " ").trim(),
        });
      } else if (line.split(/\s+/).length > 32) {
        findings.push({
          line,
          verdict: "drift",
          attribute: "Sentence rhythm",
          why: "Much longer than the sentences you usually write.",
          fix: line.split(/,\s+/).slice(0, 2).join(". ").replace(/\.\.$/, "."),
        });
      }
    }
    return { findings: findings.slice(0, 8) };
  },
};

// ---- rewrite in their voice (Check: "rewrite" when off brand) --------------

const Rewrite = z.object({ text: z.string() });
export type RewriteResult = z.infer<typeof Rewrite>;

export const rewriteInVoice: TaskDef<RewriteResult> = {
  key: "rewrite_in_voice",
  schema: Rewrite,
  template:
    "You rewrite a draft so it sounds like the person in the brand context. Keep their meaning, their facts and their structure where it already works. Change only what drifts from their measured voice and guardrails.",
  contract: [
    "Return text: the full rewritten draft, keeping its line breaks.",
    "Do not add a fact, name, number or claim that is not in the draft or the brand context.",
  ].join("\n"),
  mock(input) {
    const draft = block(input, "Draft");
    const never = field(input, "Never use")
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);
    // The stand-in can't write, but it can take out what the check flags:
    // their never-words, the stock phrases, and stacked exclamation marks.
    let text = draft;
    const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const w of [...never, ...ANTI_AI_PHRASES]) text = text.replace(new RegExp(`\\b${esc(w)}\\b[,!]?`, "ig"), "");
    text = text.replace(/!{2,}/g, ".");
    return {
      text: text
        .replace(/[ \t]{2,}/g, " ")
        .replace(/ +([,.!?])/g, "$1")
        .replace(/(^|[.!?]\s+|\n)([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())
        .replace(/^[ \t]+/gm, "")
        .trim(),
    };
  },
};

// ---- co-write outline (F2: "we write it together") --------------------------

const Outline = z.object({
  hook: z.string(),
  points: z.array(z.string()),
  cta: z.string(),
});
export type OutlineResult = z.infer<typeof Outline>;

export const coWriteOutline: TaskDef<OutlineResult> = {
  key: "cowrite_outline",
  schema: Outline,
  template:
    "You set up a piece for the person to write themselves. Give them a hook in their voice and the beats of the argument, but leave the writing to them.",
  contract: [
    "Return hook (one line in their voice), points (three to five short beats, each a phrase not a paragraph), cta (one line, or an empty string if the format has no ask).",
  ].join("\n"),
  mock(input) {
    const topic = field(input, "Topic") || "this";
    const angle = field(input, "Angle");
    return {
      hook: angle ? `${angle}: ${topic}.` : `Here is what I think about ${topic}.`,
      points: [
        "The moment it happened, in one line",
        "What most people assume",
        "What you saw instead",
        "The one thing you'd tell someone starting out",
      ],
      cta: "What would you add?",
    };
  },
};

// ---- pre-fill: Core answers proposed from what they've given us ------------

/** The Core questions a pass over their writing and brief may propose answers to. */
export const PREFILL_IDS = ["A2", "A3", "A4", "C1", "C2", "D1", "D2", "D7", "E1"] as const;

const Prefill = z.object({
  answers: z.array(
    z.object({
      id: z.enum(PREFILL_IDS),
      /** For E1 (never-words): a comma-separated list. Otherwise the answer, in their words. */
      value: z.string(),
      /** A short quote or reason from the material, so they can see why. */
      evidence: z.string(),
    }),
  ),
});
export type PrefillResult = z.infer<typeof Prefill>;

export const extractAnswers: TaskDef<PrefillResult> = {
  key: "extract_answers",
  schema: Prefill,
  template:
    "You read a person's own writing, their brand brief and their pre-workshop answers, and propose answers to their onboarding questions so they only have to confirm. Answer in their voice, first person, as they would. Propose an answer only where the material clearly supports it; leave a question out rather than guess. Never invent facts, names or numbers.",
  contract: [
    "Return answers: one entry per question you can support, with id, value and evidence.",
    "Question ids: A2 the one reader they picture; A3 what they are to that reader (teacher, friend, peer, mentor, guide, provocateur or storyteller, with a few words); A4 the one idea every piece carries; C1 how they behave guarded; C2 how they talk unguarded; D1 what they'd never claim about themselves; D2 what's off-limits; D7 anything they'd never write; E1 words or phrases they'd never use (comma-separated).",
    "evidence: a short quote from the material, or one line saying what in it supports the answer.",
  ].join("\n"),
  mock(input) {
    const answers: PrefillResult["answers"] = [];
    const audience = field(input, "Audience");
    if (audience) answers.push({ id: "A2", value: audience, evidence: "From your brief." });
    const writing = block(input, "Writing").toLowerCase();
    const pieces = (writing.match(/^\[\d+\]/gm) ?? []).length;
    if (pieces) {
      const never = ANTI_AI_PHRASES.filter((p) => !writing.includes(p)).slice(0, 4);
      answers.push({ id: "E1", value: never.join(", "), evidence: `None of these appear in your ${pieces} ${pieces === 1 ? "piece" : "pieces"}.` });
      const questions = (writing.match(/\?/g) ?? []).length;
      answers.push({
        id: "A3",
        value: questions >= pieces ? "A mentor: I've been where they are" : "A peer: we're at the same level, trading notes",
        evidence: questions >= pieces ? "You ask your reader a lot of questions." : "You write level with your reader.",
      });
    }
    return { answers };
  },
};

// ---- "this or that": dials from paired lines --------------------------------

const Pairs = z.object({
  pairs: z.array(
    z.object({
      dial: z.string(),
      /** The line leaning to the dial's LEFT label (Fun, Casual, Cheeky…). */
      left: z.string(),
      /** The same line leaning RIGHT (Serious, Formal, Respectful…). */
      right: z.string(),
    }),
  ),
});
export type PairsResult = z.infer<typeof Pairs>;

/** Hand-made twins for the stand-in: same point, leaning each way. */
const MOCK_PAIRS: Record<string, [string, string]> = {
  fun_serious: [
    "Delegation is like handing someone your car keys and then hiding in the back seat. Get out of the car.",
    "Delegation only works when you step back far enough for the other person to own the outcome.",
  ],
  casual_formal: [
    "Honestly? Most first-time managers just need to stop fixing everything themselves.",
    "In my experience, most first-time managers benefit most from no longer resolving every issue personally.",
  ],
  cheeky_respectful: [
    "Your team doesn't need another all-hands. They need you to stop talking for ten minutes.",
    "Your team may get more from ten minutes of listening than from another all-hands.",
  ],
  enthusiastic_practical: [
    "This one change transformed how my whole team works, and it can do the same for yours!",
    "One change helped my team: a written decision log. Here's how to start one this week.",
  ],
  traditional_innovative: [
    "The basics still win: weekly one-to-ones, clear goals, honest feedback.",
    "Weekly one-to-ones are a 1970s ritual. Here's what I run instead.",
  ],
  accessible_exclusive: [
    "If you manage even one person, this is for you.",
    "This is for leaders already running teams of twenty or more.",
  ],
  adventurous_conservative: [
    "I scrapped every recurring meeting for a month. Here's what broke, and what didn't.",
    "Before you cut meetings, audit which ones actually produce decisions.",
  ],
  youthful_mature: [
    "Nobody tells you the first promotion feels like starting a new job with no training. It does.",
    "Twenty years in, the lesson holds: a first promotion is a new job, and deserves training as one.",
  ],
};

export const dialPairs: TaskDef<PairsResult> = {
  key: "dial_pairs",
  schema: Pairs,
  template:
    "You write pairs of short lines for a 'which sounds more like you?' game. Each pair says the same thing, on a topic from the person's own work, in their voice, and differs only on one dial: one line leans to the dial's left end, its twin to the right. Keep both believable for them; the difference should be clear but not a caricature.",
  contract: [
    "Return pairs: one per dial listed in the input, in the same order, with dial (the key as given), left and right.",
    "Each line: one or two sentences, under 30 words, no hashtags, no emoji unless their writing uses them.",
  ].join("\n"),
  mock(input) {
    const dials = fields(input, "Dial").map((d) => d.split(" ")[0]);
    return { pairs: dials.filter((d) => MOCK_PAIRS[d]).map((d) => ({ dial: d, left: MOCK_PAIRS[d][0], right: MOCK_PAIRS[d][1] })) };
  },
};

// ---- the live preview: one paragraph in their voice -------------------------

const Preview = z.object({ text: z.string() });

/** The paragraph every person's preview starts from. Plain on purpose, so their voice is what changes it. */
export function previewSource(niche: string): string {
  const topic = niche.trim() || "doing good work";
  return `Most people think getting better at ${topic} is about working harder. It is not. It is about deciding what you will stop doing. Here is what I would tell anyone starting out: pick one thing, do it properly, and let the rest wait!`;
}

/** The stand-in's casual register: contractions, the cheapest visible tell. */
const contract = (t: string) =>
  t
    .replace(/\b(It|it|That|that|There|there|What|what|Here|here) is\b/g, (_m, w: string) => `${w}'s`)
    .replace(/\bwill not\b/g, "won't")
    .replace(/\bdo not\b/g, "don't")
    .replace(/\bI would\b/g, "I'd");

export const voicePreview: TaskDef<{ text: string }> = {
  key: "voice_preview",
  schema: Preview,
  template:
    "You rewrite one short paragraph so it sounds exactly like the person in the brand context: their rhythm, their words, their punctuation, their way of addressing the reader. Keep the meaning. Add no facts. It is a preview of their voice, so make their habits visible.",
  contract: "Return text: the rewritten paragraph, at most 90 words, no heading.",
  mock(input) {
    // The paragraph is the first block; the lines after it are hints about the voice.
    let text = block(input, "Paragraph").split(/\n\s*\n/)[0].trim() || previewSource("");
    const never = field(input, "Never use").split(",").map((w) => w.trim()).filter(Boolean);
    for (const w of never) {
      text = text.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "").replace(/ {2,}/g, " ");
    }
    if (Number(field(input, "Casual to formal") || 5) <= 5) text = contract(text);
    if (field(input, "Exclamation marks") === "never") text = text.replace(/!/g, ".");
    const avg = Number(field(input, "Average sentence words") || 0);
    if (avg && avg < 12) text = text.replace(/: /g, ". ").replace(/, and /g, ". And ");
    if (field(input, "Asks questions") === "often") text = `${text.replace(/[.!]\s*$/, ".")} What would you stop first?`;
    return { text: text.replace(/\s+([,.!?])/g, "$1").trim() };
  },
};

// ---- select and instruct: one part of a piece, rewritten on request --------

const Part = z.object({ text: z.string() });
export type PartResult = z.infer<typeof Part>;

const FILLER = /\b(really|very|just|actually|basically|simply|truly|quite|incredibly)\s+/gi;
const firstUpper = (t: string) => t.replace(/^(\s*)([a-z])/, (_, a: string, b: string) => a + b.toUpperCase());
const tidy = (t: string) => t.replace(/[ \t]{2,}/g, " ").replace(/ +([,.!?])/g, "$1").trim();

/** The stand-in's rewrites: deterministic, and visibly what was asked for. */
export function mockRewritePart(text: string, instruction: string, never: string[] = []): string {
  const ask = instruction.toLowerCase();
  let t = text.trim();
  const sentences = (x: string) => x.match(/[^.!?\n]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [x];
  if (/short|tight|cut|trim|brief|concise/.test(ask)) {
    const ss = sentences(t);
    t = ss.length > 1 ? ss[0] : t.split(/\s+/).slice(0, Math.max(4, Math.ceil(t.split(/\s+/).length * 0.6))).join(" ").replace(/[,;:]$/, "") + ".";
  }
  if (/punch|bold|strong|sharp/.test(ask)) {
    t = sentences(t.replace(FILLER, ""))[0].replace(/[,;:]\s.*$/, "").replace(/[.!?]*$/, ".");
  }
  if (/contrarian|provocative|spicy|disagree/.test(ask)) t = `Unpopular opinion: ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  if (/warm|friendl|kind|human/.test(ask)) t = `Honestly? ${t}`;
  if (/question/.test(ask)) t = `${t.replace(/[.!?]+$/, "")}?`;
  if (/formal|professional/.test(ask)) t = t.replace(/\b(\w+)'re\b/g, "$1 are").replace(/\bdon't\b/gi, "do not").replace(/\bit's\b/gi, "it is").replace(/\bI'm\b/g, "I am");
  if (/casual|relaxed|conversational/.test(ask))
    t = t.replace(/\bdo not\b/gi, (m) => (m[0] === "D" ? "Don't" : "don't")).replace(/\bit is\b/gi, (m) => (m[0] === "I" ? "It's" : "it's")).replace(/\bI am\b/g, "I'm");
  if (/emoji/.test(ask) && !/no emoji/.test(ask)) t = `${t} ✨`;
  if (/upper|caps/.test(ask)) t = t.toUpperCase();
  // Anything else: a tighter, plainer version, so the change is always visible.
  if (t === text.trim()) {
    const first = sentences(t.replace(FILLER, ""))[0].replace(/^(so|well|okay|ok),?\s+/i, "");
    const cut = first.split(/\s+(?:because|which|so that|and then)\s+|,\s+/i)[0].replace(/[.!?]*$/, ".");
    const words = first.split(/\s+/);
    t = cut !== first ? cut : words.length > 6 ? `${words.slice(0, Math.ceil(words.length * 0.7)).join(" ").replace(/[,;:]$/, "")}.` : `${first.replace(/[.!?]*$/, "")}!`;
  }
  for (const w of never) t = t.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[,!]?`, "gi"), "");
  return firstUpper(tidy(t)) || text;
}

export const rewritePart: TaskDef<PartResult> = {
  key: "rewrite_part",
  schema: Part,
  template:
    "You change one part of a piece the person is editing, the way they asked, in their voice. Change only that part. Keep their meaning and their facts unless the instruction says otherwise, and keep the rest of the piece in mind so the part still fits it.",
  contract: [
    "Return text: the new version of the part only, with no quotes, labels or commentary.",
    "Keep it the same kind of thing: a hook stays one line, a slide stays one idea, a call to action stays one ask.",
    "Do not add a fact, name, number or claim that is not in the piece or the brand context.",
  ].join("\n"),
  mock(input) {
    const never = field(input, "Never use").split(",").map((w) => w.trim()).filter(Boolean);
    return { text: mockRewritePart(block(input, "Part"), field(input, "Instruction"), never) };
  },
};

// ---- the 90-day calendar (brief §4.2, P3-1) ---------------------------------

const Calendar = z.object({
  slots: z.array(
    z.object({
      /** The slot number from the input; the date and channel stay code-owned. */
      slot: z.number().int(),
      /** A pillar name exactly as listed, or an empty string. */
      pillar: z.string(),
      topic: z.string(),
      hookAngle: z.string(),
      cta: z.string(),
    }),
  ),
});
export type CalendarPlan = z.infer<typeof Calendar>;

const MOCK_HOOKS = [
  "Open on the moment it went wrong",
  "Start with the number nobody expects",
  "A question the reader is already asking",
  "Contrast what people assume with what happens",
  "One line of the story, then the lesson",
];
const MOCK_CTAS = ["What would you add?", "Reply if this is you.", "Save this for the next time it comes up.", "Tell me where I'm wrong.", "Forward this to the one person who needs it."];
const MOCK_TOPICS = [
  "The mistake I see most often with",
  "What nobody tells you about",
  "A small moment that explains",
  "The one rule I keep about",
  "What changed my mind about",
  "Why the obvious advice fails on",
];

export const calendarPlan: TaskDef<CalendarPlan> = {
  key: "calendar_plan",
  schema: Calendar,
  template:
    "You plan what a person publishes over the next three months, in their voice and from their own pillars. Each slot is one piece on a named day and channel. Rotate the pillars so none is forgotten, vary the angles so no two neighbouring slots feel alike, and keep every topic something they have an opinion on. Never plan a topic that needs a fact they have not given.",
  contract: [
    "Return slots: one entry per slot number listed in the input, in order, none missing and none invented.",
    "Each has: slot (the number as given), pillar (a pillar name exactly as listed, or an empty string if none fits), topic (one line, in their words, not a headline formula), hookAngle (how the piece opens, under 12 words), cta (one line, or an empty string for a channel with no ask).",
    "Fit the channel: a newsletter slot can carry a bigger idea than an X slot.",
    "Every topic must be different from every other one in the plan. A quarter of repeats is not a plan, so do not reuse a topic, and do not reach the same idea twice by rewording it.",
  ].join("\n"),
  mock(input) {
    const pillars = fields(input, "Pillar").map((p) => p.split(" (")[0].trim());
    const slots = fields(input, "Slot").map((s) => Number(s.split("|")[0]));
    return {
      slots: slots.map((slot, i) => {
        const pillar = pillars.length ? pillars[i % pillars.length] : "";
        // Pair each opening with a different subject rather than cycling one
        // list, so a stand-in plan reads like 38 pieces and not six on repeat.
        const opener = MOCK_TOPICS[i % MOCK_TOPICS.length];
        const subject = MOCK_SUBJECTS[Math.floor(i / MOCK_TOPICS.length) % MOCK_SUBJECTS.length];
        return {
          slot,
          pillar,
          topic: `${opener} ${subject}${pillar ? ` (${pillar})` : ""}`,
          hookAngle: MOCK_HOOKS[i % MOCK_HOOKS.length],
          cta: MOCK_CTAS[i % MOCK_CTAS.length],
        };
      }),
    };
  },
};

export const TASKS = {
  [topicProposals.key]: topicProposals,
  [calendarPlan.key]: calendarPlan,
  [rewritePart.key]: rewritePart,
  [voiceJudge.key]: voiceJudge,
  [rewriteInVoice.key]: rewriteInVoice,
  [coWriteOutline.key]: coWriteOutline,
  [extractAnswers.key]: extractAnswers,
  [dialPairs.key]: dialPairs,
  [voicePreview.key]: voicePreview,
} as Record<string, TaskDef<unknown>>;

