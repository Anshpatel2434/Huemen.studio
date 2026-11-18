/**
 * Prompt assembly (INV-2, brief §05). Pure — no I/O, no clock.
 *
 * Every prompt is: system template + brand context block + task input. This is
 * the ONE place that order is applied, and every provider receives the result.
 *
 * Two splits matter here, and both are deliberate:
 *
 *   system  = the template and the brand context. Stable for a workspace and a
 *             format, so a provider can cache it. Nothing in it may vary per
 *             request (no timestamps, no ids), or every call pays for it again.
 *   user    = the task and the output contract. Changes every call.
 *
 * The OUTPUT CONTRACT is code-owned on purpose. Templates are data an admin can
 * edit (brief §05); the parsers that read the model's reply are code. If the
 * shape the parser needs lived in the editable template, one well-meant edit
 * would silently break every draft. So the template says how to write, and the
 * contract — appended here, not editable — says what shape to hand back.
 */
import type { BrandContext } from "@/lib/context/context-builder";
import { platformRule } from "@/lib/voice/platforms";

export interface AssembledPrompt {
  system: string;
  user: string;
}

/**
 * Between versions in a STREAMED draft. Structured output can't be shown as
 * it is written (half a JSON string is not a draft), so a streamed draft is
 * plain text with this line between versions; `splitStreamed` reads it back.
 */
export const STREAM_SEPARATOR = "=====";

export function splitStreamed(text: string): string[] {
  return text
    .split(new RegExp(`^\\s*${STREAM_SEPARATOR}\\s*$`, "m"))
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * What each template's reply must look like, matched to the code that parses
 * it. `variants` is how many distinct versions to write; the provider returns
 * them as separate strings, and each string must satisfy the contract alone.
 */
/** The hook set is five openers, not a post: no body, no call to action, no labels. */
const HOOK_SET_SHAPE = [
  "Each version is exactly five opening lines, one per line: a confession, a number, a contrast, a question, a scene.",
  "No labels, no numbering, no headings such as \"First version\", no body and no call to action.",
];

/** The measured facts the contract states as numbers (BrandContext.writing). */
type Writing = BrandContext["writing"] | undefined;

/**
 * Where a fact may come from. Stated once and reused by every contract that
 * lets a model write copy, so "never invent" means the same thing in a draft,
 * a steer, a rewrite and an outline.
 */
const FACT_SOURCES =
  'the brand context (the "Facts they can stand behind", their stories, their offers under "What they sell", and their brief and strategy answers) and the task above';

const FACTS_RULE = [
  `Never invent a fact. The only facts you may use are in ${FACT_SOURCES}.`,
  'Every first-person claim that something happened ("a client told me", "last quarter we", "five of my clients said") and every number, percentage, price, date, timespan, client, company, person, result or credential must come from there, as given. If it is not there, do not write it. An unnamed "a founder", "a client" or "one team" who did a particular thing is still an invented event.',
  "When a sentence needs a fact you do not have, rewrite the sentence so it does not: make the point as their opinion, as what usually happens (present tense, nobody in particular), or as a question. Only when it cannot work any other way, write [placeholder] where the fact goes. No placeholder is better than one.",
];

const ASK_RULE =
  'The call to action asks only for something real, and most pieces need no offer. Name an offer only when the Topic is about the very problem that offer promises to solve; a story, an opinion, a lesson or an origin piece does not pitch. When you do name one, write its name exactly as it appears under "What they sell": never shortened, renamed or given extra words. Never invite a call, a chat or a DM, and never promise a download, a template, a link, a reply in the comments, a discount or anything free, unless the brand context lists it. When no offer fits, close the way their own pieces close (the brand context shows how), or leave the call to action out.';

const BRIEF_RULE =
  "The Topic, and the Pillar and Angle when the task gives them, are already decided and are binding. Write about that topic, from that pillar, in the shape the angle describes. Do not swap in an easier angle.";

function lengthRule(w: Writing): string {
  const r = w?.lengthWords;
  if (!r) return "Length: nothing measured for this platform yet. Keep it as short as the idea allows and inside the platform's limits in the brand context. Never pad.";
  // Drafts overshoot, so the aim is the middle of their range and the top is a limit.
  const aim = Math.round((r[0] + r[1]) / 2);
  return `Length: ${r[0]} to ${r[1]} words for the whole piece, hook and call to action included; aim for about ${aim}. That is how long their own pieces for this platform run. Drafts run long: count the words before you finish, and while there are more than ${r[1]}, cut a sentence. If the task carries a steer that asks for a different length, the steer wins.`;
}

function charsRule(w: Writing): string {
  return `Plain characters only: the ordinary hyphen (-) and ordinary spaces, never non-breaking hyphens or non-breaking spaces.${w?.noEmDash ? " No em dashes: they do not use them. Use a comma, a full stop or a new sentence." : ""} When a punctuation mark they do not use would be needed, rebuild the sentence so it reads correctly without it; never drop the mark and leave the words ("The result churn spikes" is broken, "Churn spikes at renewal" is not).`;
}

/** The numbered hard rules for a draft, most important first. */
function draftRules(w: Writing, hookSet: boolean): string[] {
  const rules: string[][] = [
    FACTS_RULE,
    ...(hookSet ? [] : [[ASK_RULE]]),
    [BRIEF_RULE],
    ...(hookSet ? [] : [[lengthRule(w)]]),
    [charsRule(w)],
  ];
  return [
    "Hard rules, most important first. A draft that breaks one is wrong, however well it reads:",
    ...rules.flatMap((r, i) => r.map((line, j) => (j === 0 ? `${i + 1}. ${line}` : `   ${line}`))),
  ];
}

/** Rules a task (lib/ai/tasks) can ask to have appended to its own contract. */
export type TaskRule = "facts" | "brief" | "ask" | "length" | "chars";

/**
 * The shared rules as plain lines, for the tasks that write or rewrite copy
 * (a rewrite in their voice, one part changed, an outline). Same wording as a
 * draft, and the same measured numbers, read from the one context (INV-2).
 */
export function taskRules(rules: readonly TaskRule[] | undefined, context: BrandContext): string[] {
  const w = context.writing as Writing;
  return (rules ?? []).flatMap((r) => {
    switch (r) {
      case "facts":
        return FACTS_RULE.map((l) => l.replace(/the task above/g, "the text you were given"));
      // The same binding wording as the draft contract: a rewrite keeps the brief too (M4).
      case "brief":
        return [BRIEF_RULE];
      case "ask":
        return [ASK_RULE];
      case "length": {
        const range = w?.lengthWords;
        return range
          ? [`Length: their own pieces for this platform run ${range[0]} to ${range[1]} words. If the text is longer than ${range[1]}, cut it to fit: keep the strongest point and drop the rest. Never make it longer than it was unless it is under ${range[0]}.`]
          : ["Length: never make it longer than it was."];
      }
      case "chars":
        return [charsRule(w)];
    }
  });
}

/** The X post limit (lib/voice/platforms): the contract states the number the check enforces. */
const X_LIMIT = () => platformRule("x")?.maxChars ?? 280;

/**
 * What one version looks like, for the formats whose shape is not the
 * hook-body-call-to-action post. null for the rest (the default shape below).
 * Each is read by splitDraft / the check the same way, so the shape is the
 * contract, not a style note.
 */
function shapeFor(templateKey: string, hookSet: boolean): string[] | null {
  if (hookSet) return HOOK_SET_SHAPE;
  if (templateKey === "x_post") {
    return [
      "Each version is one X post: plain text, one idea, no labels, no headings, no hook-body-CTA lines.",
      `Hard limit: at most ${X_LIMIT()} characters for the whole post, spaces and punctuation included. Count them before you finish and cut until it fits. A post over the limit is wrong, however well it reads.`,
      'If the idea needs more room, write a short thread instead: each part numbered "1/", "2/" and so on, every part within the limit.',
    ];
  }
  if (templateKey === "linkedin_comment") {
    return [
      "Each version is a comment on someone else's LinkedIn post, not a post of your own: one short paragraph of two or three sentences, on one line. No headline, no hook and body, no call to action, no hashtags.",
      "It answers a point: it agrees with it, adds one thing to it, or pushes back on it, in the person's voice. It never restates or summarises a post, and never opens with a title.",
      "You are not given the other person's post, so reply in general terms that fit the topic. Do not invent what they said, a name or a number.",
    ];
  }
  if (templateKey === "whatsapp_message") {
    return [
      "Each version is the message itself, the way the person would type it to one person in WhatsApp: first person (I, we, my), plain sentences, one to four short lines, no headline and no sign-off.",
      'Never narrate it: no description of the message or of who it is for ("The founder says...", "Here is a message...", "They should..."). Write the words only.',
      "Formatting: *bold* for at most one word, and no other markup.",
    ];
  }
  return null;
}

function contractFor(templateKey: string, variants: number, stream = false, writing?: Writing): string {
  const hookSet = templateKey === "linkedin_hook_set";
  const shape = shapeFor(templateKey, hookSet);
  const versions = `Write ${variants} distinct ${variants === 1 ? "version" : "versions"}.${variants === 1 ? "" : " Make them genuinely different in how they open and what they lead with, not rewordings of one another. Every version keeps to the same topic, pillar and angle."}`;
  const voice = "Write in the person's voice as described in the brand context. Never copy a sentence from their samples.";
  if (stream) {
    // Read by splitStreamed, then splitDraft per version.
    return [
      versions,
      `Write them one after another as plain text. Between two versions, put a line containing only ${STREAM_SEPARATOR}. No JSON, no headings, no numbering, nothing before the first version.`,
      ...(shape ?? ["Each version: the first line is the hook, then the body, and the last line is the call to action starting with \"CTA: \" (leave that line out when the piece needs no ask: see rule 2)."]),
      voice,
      "",
      ...draftRules(writing, hookSet),
    ].join("\n");
  }
  if (templateKey === "pillar_set") {
    // Read by parsePillarLines (lib/data/pipeline).
    return [
      "Return exactly one variant.",
      "Write each pillar on its own line as: Name :: one-line description",
      "No numbering, no headings, no other text.",
    ].join("\n");
  }
  // Every content format is read by splitDraft (lib/content/formats): the first
  // line is the hook, the last line is the call to action, the rest is body.
  return [
    versions,
    ...(shape ?? [
      "Each version is a complete piece on its own:",
      "- The first line is the hook.",
      "- Then the body.",
      '- The last line is the call to action, starting with "CTA: ". Leave that line out when the piece needs no ask (rule 2).',
    ]),
    voice,
    "",
    ...draftRules(writing, hookSet),
  ].join("\n");
}

export function assemblePrompt(
  systemTemplate: string,
  context: BrandContext,
  taskInput: string,
  opts: {
    templateKey: string;
    variants?: number;
    contract?: string;
    stream?: boolean;
    /**
     * A long, fixed output spec (the agent's component language). It sits in
     * the system part, between the template and the brand context, so it is
     * cached with them instead of being paid for on every call.
     */
    systemContract?: string;
  },
): AssembledPrompt {
  const system = [
    systemTemplate.trim(),
    ...(opts.systemContract ? ["", "<output_language>", opts.systemContract.trim(), "</output_language>"] : []),
    "",
    "<brand_context>",
    context.serialized,
    "</brand_context>",
  ].join("\n");

  const user = [
    "<task>",
    taskInput.trim(),
    "</task>",
    "",
    "<output>",
    opts.contract ?? contractFor(opts.templateKey, Math.max(1, opts.variants ?? 1), opts.stream, context.writing),
    "</output>",
  ].join("\n");

  return { system, user };
}
