/**
 * The voice question bank (client spec v2, file 05). Pure, client-safe.
 *
 * Wording, options and follow-ups are the spec's own, so what a person is asked
 * is what the client signed off. Each question names the field it FILLS; the
 * one place that writes an answer into the pack (lib/data/onboarding) switches
 * on that, so a question can never quietly save somewhere new.
 *
 * Tiers (file 05, Part 1):
 *   core — asked in onboarding, before anything is written.
 *   deep — drip-fed later, two or three at a time, never mid-draft.
 */

export type QuestionFormat = "open" | "short" | "mcq" | "multi" | "chips" | "shorts";

export interface Question {
  id: string;
  ask: string;
  format: QuestionFormat;
  tier: "core" | "deep";
  /** Where the answer goes. See lib/data/onboarding `applyAnswer`. */
  fills: string;
  options?: string[];
  /** For `shorts`: one labelled line per prompt. */
  prompts?: string[];
  example?: string;
  followUp?: string;
  /** Voice notes encouraged: the answer is also a spoken sample. */
  spoken?: boolean;
}

/** The default follow-up for a generic answer (file 05, Part 1, rule 4). */
export const DEFAULT_FOLLOW_UP =
  "That's a solid start. What's the version of that answer that only you could give?";

const GENERIC_WORDS = new Set(
  ["professional", "approachable", "passionate", "innovative", "authentic", "helpful", "quality"],
);

/** Under 8 words, or built only from generic words (file 05, Part 1, rule 4). */
export function isGeneric(answer: string): boolean {
  const words = answer.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length === 0) return false;
  if (words.length < 8) return true;
  const content = words.filter((w) => w.length > 3);
  return content.length > 0 && content.every((w) => GENERIC_WORDS.has(w));
}

export const QUESTIONS: Question[] = [
  // ---- A. Who you are on the page ------------------------------------------
  {
    id: "A1", tier: "deep", format: "open", fills: "identity.voiceParagraph",
    ask: "What do you actually do? Say it the way you would at a dinner party. No jargon, no titles.",
    followUp: "Now say it to someone's grandmother.",
  },
  {
    id: "A2", tier: "core", format: "open", fills: "identity.reader",
    ask: "When you write, who's the one person you picture reading it? Describe them. Where are they, what are they doing, what's on their mind?",
    followUp: "Picture one of them. Give them a name and a Tuesday afternoon. What are they doing when they read you?",
  },
  {
    id: "A3", tier: "core", format: "mcq", fills: "identity.personaRoles",
    ask: "And what are you to that person when they read you?",
    options: [
      "A teacher: I explain how things work",
      "A friend: I talk to them like we're having coffee",
      "A peer: we're at the same level, trading notes",
      "A mentor: I've been where they are",
      "A guide: I show them the way, step by step",
      "A provocateur: I challenge how they think",
      "A storyteller: I share what I've seen and let them draw the lesson",
    ],
  },
  {
    id: "A4", tier: "core", format: "short", fills: "identity.carries",
    ask: "If every piece you ever wrote quietly carried one idea, what would it be? One sentence.",
    example: "Most brand problems are not brand problems. They are clarity problems.",
    followUp: "Say it as something you believe, not something you sell.",
  },
  {
    id: "A5", tier: "deep", format: "open", fills: "identity.answers",
    ask: "If a stranger read three of your posts today, what would they think of you? Be honest.",
  },
  {
    id: "A6", tier: "deep", format: "open", fills: "identity.answers",
    ask: "What do people say about how you write or talk? The compliments, and the things that annoy them.",
  },
  // ---- B. Where your voice comes from --------------------------------------
  {
    id: "B1", tier: "deep", format: "open", fills: "identity.roots", spoken: true,
    ask: "What in your life or work shaped the way you talk? A job, a person, a place, a hard moment. Tell us the story.",
    followUp: "What did that teach you about how to talk to people?",
  },
  {
    id: "B2", tier: "deep", format: "open", fills: "identity.answers",
    ask: "Whose writing or speaking do you admire? What exactly do they do that you like?",
    followUp: "What's one thing they do on the page that you'd steal?",
  },
  {
    id: "B3", tier: "deep", format: "open", fills: "guardrails.against",
    ask: "What drives you mad about how people in your field communicate?",
  },
  {
    id: "B4", tier: "deep", format: "open", fills: "identity.answers",
    ask: "When your writing is at its best, who do you become? Describe that version of you.",
  },
  // ---- C. The feel -----------------------------------------------------------
  {
    id: "C1", tier: "core", format: "open", fills: "identity.guarded", spoken: true,
    ask: "Picture a party. Your top competitors are there, and ten people you'd love to work with. You're completely sober. How do you behave? What do you talk about? How do you come across?",
  },
  {
    id: "C2", tier: "core", format: "open", fills: "identity.unguarded", spoken: true,
    ask: "Same party. You've had a couple of drinks and your guard is down. Now what do you really say? What jokes do you make? How do people react to you?",
  },
  {
    id: "C4", tier: "core", format: "open", fills: "identity.dials",
    ask: "Slide each one to where you are. We've pre-set them from your writing. Move anything that feels wrong.",
  },
  {
    id: "C5", tier: "core", format: "multi", fills: "identity.personalityLonglist",
    ask: "Tap every word that sounds like you. Pick 12 to 15.",
  },
  {
    id: "C6", tier: "core", format: "mcq", fills: "identity.personalityWords",
    ask: "We've grouped your words into families. Keep the one strongest word from each.",
  },
  {
    id: "C7", tier: "deep", format: "shorts", fills: "identity.personalityMeanings",
    ask: "Finish the sentence for each of your four words: On the page, being [word] means I…",
    example: "On the page, being Curious means I ask the question before I give the answer.",
  },
  {
    id: "C8", tier: "deep", format: "shorts", fills: "identity.feelings",
    ask: "What should someone feel after…",
    prompts: ["…skimming your post for 30 seconds?", "…reading you properly for 5 minutes?", "…a 20-minute conversation with you?"],
    example: "30 seconds: this person sees what others miss. 5 minutes: I'd trust their judgement. 20 minutes: I want them in the room.",
  },
  {
    id: "C9", tier: "deep", format: "mcq", fills: "identity.humour",
    ask: "What kind of funny are you?",
    options: [
      "Dry: I say it straight and let you catch it",
      "Wordplay and puns",
      "Pop culture references",
      "Self-deprecating: I laugh at myself first",
      "Story-funny: the humour is in what happened",
      "Sarcastic, aimed at bad systems, never at people",
      "Not funny on purpose: I keep it serious",
    ],
  },
  {
    id: "C10", tier: "deep", format: "multi", fills: "identity.language",
    ask: "Which languages do you write or think in? Do you mix them?",
    options: ["English", "Hindi", "Hinglish", "Punjabi", "Gujarati", "Marathi", "Tamil", "Bengali"],
  },
  // ---- D. The lines you don't cross -----------------------------------------
  {
    id: "D1", tier: "core", format: "open", fills: "guardrails.selfLabel",
    ask: "Is there anything you'd never say about yourself, even if it's true? A title, a label, a claim.",
    example: "I'd never call myself a thought leader. If people think it, fine. I won't say it.",
  },
  {
    id: "D2", tier: "core", format: "open", fills: "guardrails.offLimits",
    ask: "What's off-limits? Clients, employers, topics, stories or anything confidential that should never appear in your writing.",
    followUp: "Anything that's fine to mention, but only in a certain way?",
  },
  {
    id: "D3", tier: "deep", format: "mcq", fills: "guardrails.stance",
    ask: "When you take a stand, how hard do you push?",
    options: [
      "Quiet and measured: I raise the question and let people get there",
      "Clear and firm: I say what I think and back it up",
      "Loud and provocative: I say the thing people are afraid to say",
      "Depends on the topic",
    ],
  },
  {
    id: "D5", tier: "deep", format: "mcq", fills: "guardrails.toneMix",
    ask: "What mix of stories do you want to tell?",
    options: [
      "Mostly wins and lessons",
      "A mix of wins, ordinary moments and failures",
      "Mostly the hard stuff: failures and what they taught me",
      "I don't tell personal stories",
    ],
  },
  {
    id: "D6", tier: "deep", format: "multi", fills: "redPen.pushy",
    ask: "When you want someone to contact you, which endings feel pushy to you?",
    options: ["DM me", "Reach out", "Let's connect", "Book a call", "Link in bio", "Comment below", "Follow for more", "Get in touch"],
  },
  {
    id: "D7", tier: "core", format: "open", fills: "guardrails.never",
    ask: "Anything else that would make you say 'I would never write that'?",
  },
  // ---- E. Your words --------------------------------------------------------
  {
    id: "E1", tier: "core", format: "chips", fills: "redPen.neverList",
    ask: "Name 3 words or phrases you'd never use. The ones that make you wince.",
    options: ["synergy", "leverage", "unlock", "game-changer", "deep dive", "circle back", "hustle", "guru", "empower", "let's dive in", "at the end of the day", "in today's fast-paced world"],
  },
  {
    id: "E2", tier: "deep", format: "short", fills: "mechanics.lexicon",
    ask: "What 5 to 8 words or ideas do you keep coming back to? Separate them with commas.",
  },
  {
    id: "E3", tier: "deep", format: "short", fills: "mechanics.signature",
    ask: "Is there a phrase only you would say? Write it.",
    example: "clarity → Clarity is sustainability.",
  },
  {
    id: "E5", tier: "deep", format: "short", fills: "mechanics.opener",
    ask: "Write the first line of a post you'd be proud of. Just the first line.",
  },
  // ---- F. Your rooms --------------------------------------------------------
  {
    id: "F3", tier: "deep", format: "shorts", fills: "contexts.situations",
    ask: "How does your tone change in each of these moments? One line each, or skip any.",
    prompts: ["Announcing something new", "Someone complains or is upset", "Disagreeing with someone", "Pitching to a partner", "A quick social reply", "Selling or making an offer"],
    example: "Someone complains: I drop the jokes, own it fast, and say what happens next.",
  },
  {
    id: "F5", tier: "deep", format: "shorts", fills: "contexts.signoffs",
    ask: "How do you sign off?",
    prompts: ["Emails", "Chat"],
  },
];

export const questionById = (id: string): Question | undefined => QUESTIONS.find((q) => q.id === id);

/**
 * The next Deep questions to offer: two or three unanswered ones, in bank
 * order. Unlocked by approved pieces, one batch per five (our answer to the
 * spec's open "drip-fed later"): enough writing to be worth refining, never
 * an interruption mid-draft.
 */
export function nextDeepQuestions(answered: string[], approvedPieces: number, size = 3): Question[] {
  const batches = Math.floor(approvedPieces / 5);
  if (batches === 0) return [];
  const done = new Set(answered);
  const open = QUESTIONS.filter((q) => q.tier === "deep" && !done.has(q.id));
  const offered = QUESTIONS.filter((q) => q.tier === "deep" && done.has(q.id)).length;
  const allowance = batches * size - offered;
  return allowance > 0 ? open.slice(0, Math.min(size, allowance)) : [];
}
