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
  /** Lines visible before "see more", where the platform cuts by line too. */
  visibleLines?: number;
  /** Email: the subject shows roughly this many characters [min, max]. */
  subjectChars?: [number, number];
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
    visibleLines: 3,
    maxHashtags: null,
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
    maxHashtags: null,
    formatting: "plain",
    norms: ["One idea per post. Longer arguments become a thread."],
  },
  threads: {
    key: "threads",
    label: "Threads",
    maxChars: 500,
    visibleChars: null,
    maxHashtags: null,
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
    visibleChars: null,
    subjectChars: [40, 60],
    maxHashtags: 0,
    formatting: "plain",
    norms: ["The subject says what it is about.", "One ask per email where possible."],
  },
  // Working values, less settled than the others: re-check before launch.
  facebook: {
    key: "facebook",
    label: "Facebook post",
    maxChars: 63206,
    visibleChars: 480,
    maxHashtags: 3,
    formatting: "plain",
    norms: ["The first few lines show before 'See more'; land the point there.", "Conversational. Questions that invite a reply do well."],
  },
  youtube_community: {
    key: "youtube_community",
    label: "YouTube community post",
    maxChars: null,
    visibleChars: null,
    maxHashtags: 3,
    formatting: "plain",
    norms: ["Short and direct: an update, a question or a poll for people who already watch.", "Talks to the audience the way the videos do."],
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

/**
 * Spec 07: "keep these numbers in config, because platforms change them". Any
 * rule can be overridden without a code change through PLATFORM_RULES_OVERRIDES,
 * a JSON object keyed by platform, e.g. {"x":{"maxChars":25000}}. Read on the
 * server only (the variable is not exposed to the browser), where every limit
 * that matters is enforced.
 */
function applyOverrides(): void {
  const raw = typeof process !== "undefined" ? process.env?.PLATFORM_RULES_OVERRIDES : undefined;
  if (!raw) return;
  try {
    const o = JSON.parse(raw) as Record<string, Partial<PlatformRule>>;
    for (const [k, v] of Object.entries(o)) {
      if (PLATFORM_RULES[k] && v && typeof v === "object") PLATFORM_RULES[k] = { ...PLATFORM_RULES[k], ...v, key: k };
    }
  } catch {
    console.error("[platforms] PLATFORM_RULES_OVERRIDES is not valid JSON; using the built-in rules.");
  }
}
applyOverrides();

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
  // The launch-announcement register. Each spelling is listed in full, because
  // a finding quotes the phrase back and a stem would read as a typo.
  "thrilled to announce", "excited to announce", "game-changing",
  "revolutionise", "revolutionize", "revolutionary", "unlock your",
  "elevate your", "take it to the next level", "true potential",
];

/**
 * A platform's rules as plain lines for the prompt. Numbers stay numbers, so
 * the model can hit them; the same numbers drive the deterministic check, so
 * what a draft is told and what it is checked against can never disagree.
 */
export function platformLines(rule: PlatformRule): string[] {
  const out: string[] = [];
  if (rule.maxChars != null) out.push(`At most ${rule.maxChars} characters in total.`);
  if (rule.visibleChars != null)
    out.push(`Only the first ${rule.visibleChars} characters${rule.visibleLines ? ` (about ${rule.visibleLines} lines)` : ""} show before the cut; the opening has to land inside them.`);
  if (rule.subjectChars)
    out.push(`Start with a subject line of ${rule.subjectChars[0]}–${rule.subjectChars[1]} characters that says what it is about, then a blank line, then the email.`);
  if (rule.maxHashtags === 0) out.push("No hashtags.");
  else if (rule.maxHashtags != null) out.push(`At most ${rule.maxHashtags} hashtags.`);
  if (rule.formatting === "whatsapp") out.push("Formatting: *bold*, _italic_, ~strike~ only. No markdown headers.");
  else if (rule.formatting === "slack") out.push("Formatting: Slack mrkdwn only.");
  else if (rule.formatting === "plain") out.push("Plain text. No markdown.");
  out.push(...rule.norms);
  return out;
}
