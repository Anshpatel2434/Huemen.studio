/**
 * Platform rules (client spec, file 07). System level: the same for every user.
 *
 * The spec is explicit that these numbers change and must live in CONFIG, not
 * in feature code — so they live here, in one table, and nowhere else. Working
 * values as of September 2026; re-check before launch and quarterly after.
 *
 * Order of precedence when writing (spec 07, plus our answer to question 17):
 *   hard limits  >  user guardrails  >  universal anti-AI rules
 *                >  the user's own platform habits (contexts.md)
 *                >  platform norms (below)
 * A personal habit overrides the anti-AI list only when the corpus PROVES it:
 * a count, not a claim. That is what lets Richa keep her ellipsis while Rohan
 * bans his.
 */

export interface PlatformRule {
  key: string;
  label: string;
  /** Hard character limit. null = no practical limit. */
  maxChars: number | null;
  /** Characters visible before the platform truncates. null = no cut. */
  visibleChars: number | null;
  maxHashtags: number | null;
  /** Formatting the platform actually understands. */
  formatting: "plain" | "markdown" | "whatsapp" | "slack";
  norms: string[];
}

export const PLATFORM_RULES: Record<string, PlatformRule> = {
  linkedin: {
    key: "linkedin",
    label: "LinkedIn post",
    maxChars: 3000,
    visibleChars: 210,
    maxHashtags: 5,
    formatting: "plain",
    norms: [
      "The hook has to land in the first two or three lines, before 'see more'.",
      "Short paragraphs and white space.",
      "External links cut reach, so they usually go in the first comment.",
    ],
  },
  linkedin_comment: {
    key: "linkedin_comment",
    label: "LinkedIn comment",
    maxChars: 1250,
    visibleChars: null,
    maxHashtags: 0,
    formatting: "plain",
    norms: ["Short. One thought. Responds to the post rather than restating it."],
  },
  instagram: {
    key: "instagram",
    label: "Instagram caption",
    maxChars: 2200,
    visibleChars: 125,
    maxHashtags: 30,
    formatting: "plain",
    norms: ["Only the first line or so shows before the cut.", "Hashtags in the caption or the first comment."],
  },
  x: {
    key: "x",
    label: "X",
    maxChars: 280,
    visibleChars: null,
    maxHashtags: 2,
    formatting: "plain",
    norms: ["One idea per post. Longer arguments become a thread."],
  },
  threads: {
    key: "threads",
    label: "Threads",
    maxChars: 500,
    visibleChars: null,
    maxHashtags: 1,
    formatting: "plain",
    norms: ["Conversational. Lighter than LinkedIn."],
  },
  newsletter: {
    key: "newsletter",
    label: "Newsletter or blog",
    maxChars: null,
    visibleChars: null,
    maxHashtags: null,
    formatting: "markdown",
    norms: ["Headline and subheads. Scannable sections."],
  },
  email: {
    key: "email",
    label: "Email",
    maxChars: null,
    visibleChars: 60,
    maxHashtags: 0,
    formatting: "plain",
    norms: ["The subject says what it is about.", "One ask per email where possible."],
  },
  whatsapp: {
    key: "whatsapp",
    label: "WhatsApp",
    maxChars: null,
    visibleChars: null,
    maxHashtags: 0,
    formatting: "whatsapp",
    norms: ["Formatting is *bold*, _italic_, ~strike~ only. No markdown headers."],
  },
  slack: {
    key: "slack",
    label: "Slack or Teams",
    maxChars: null,
    visibleChars: null,
    maxHashtags: 0,
    formatting: "slack",
    norms: ["Short messages. Threads rather than long posts."],
  },
  spoken: {
    key: "spoken",
    label: "Spoken script",
    maxChars: null,
    visibleChars: null,
    maxHashtags: 0,
    formatting: "plain",
    norms: [
      "Written for the ear: shorter sentences, repetition allowed.",
      "No parentheses or punctuation that only works on the page.",
    ],
  },
  bio: {
    key: "bio",
    label: "Bio or About",
    maxChars: 2600,
    visibleChars: 220,
    maxHashtags: 0,
    formatting: "plain",
    norms: ["Leads with the thing they want to be known for."],
  },
};

export const PLATFORM_KEYS = Object.keys(PLATFORM_RULES);

export function platformRule(key: string | undefined): PlatformRule | null {
  if (!key) return null;
  return PLATFORM_RULES[key] ?? null;
}

/**
 * The universal anti-AI list (spec 01 §3: "lives ONCE at platform level,
 * maintained by us, applied to every user"). A user's red-pen holds only their
 * personal layer and their proven exceptions to this one.
 */
export const ANTI_AI_PHRASES = [
  "delve", "tapestry", "in today's fast-paced world", "in the ever-evolving",
  "it's not just", "let's dive in", "unlock the power", "game-changer",
  "navigate the landscape", "at the end of the day", "testament to",
  "a myriad of", "seamlessly", "robust solution", "leverage synergies",
  "embark on a journey", "in conclusion", "the bottom line is",
];
