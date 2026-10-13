/**
 * Every prompt template the app resolves, with its built-in default body.
 * Pure: the admin page (client) and the template store (server) both read it.
 *
 * Templates are DATA (brief §05): a row in `prompt_templates` wins over the
 * default here, a workspace's row wins over the global one, and the version
 * used is stamped on what it wrote. The defaults exist so a fresh database
 * writes sensibly before anyone has edited anything, and so the admin page
 * can show what it is editing. The OUTPUT CONTRACT is never in a template
 * (lib/ai/prompt): an edit here can change how the model writes, not what
 * shape the code reads back.
 */
import { FORMATS } from "@/lib/content/formats";
import { TASKS } from "./tasks";

export type TemplateGroup = "format" | "brand" | "task";

export interface TemplateEntry {
  key: string;
  label: string;
  group: TemplateGroup;
  /** What this template is for, in one line, for the admin page. */
  about: string;
  defaultBody: string;
}

const FORMAT_BODIES: Record<string, string> = {
  linkedin_post: "You write LinkedIn posts in the person's voice: one idea, an opening line that earns the click on \"see more\", short paragraphs, and an ask that fits them. Obey the guardrails in the brand context.",
  linkedin_hook_set: "You write five opening lines for a LinkedIn post on the topic, each a different angle: a confession, a number, a contrast, a question, a scene. In the person's voice, never clickbait they would not say.",
  ig_caption: "You write Instagram captions in the person's voice: the first line stands alone, the body breathes, hashtags only if their writing uses them.",
  ig_carousel: "You write Instagram carousel copy, one line per slide. The first slide is the hook, the last is the ask, and every slide between carries one idea in the person's voice.",
  newsletter_section: "You write one section of a newsletter in the person's voice: a heading they would write, then the argument, with room to think.",
  pitch_email: "You write a short, specific pitch email in the person's voice. Lead with the reader's problem, offer one thing, ask for one small next step. Use their offers from the brand context where they fit.",
  talk_abstract: "You write a conference talk abstract in the person's voice, for the ear: the promise of the talk in the first sentence, what the audience leaves with, who it is for.",
  x_post: "You write one X post in the person's voice: one idea, within the character limit. If the idea needs more room, write a short thread with each part numbered 1/, 2/ and every part within the limit.",
  threads_post: "You write one Threads post in the person's voice: conversational, lighter than LinkedIn, within the character limit.",
  linkedin_comment: "You write a LinkedIn comment in the person's voice: one thought that responds to the post rather than restating it.",
  whatsapp_message: "You write a WhatsApp message in the person's voice. Use only *bold*, _italic_ and ~strike~ formatting, never markdown headers.",
  slack_message: "You write a Slack or Teams message in the person's voice: short, using Slack formatting only.",
  bio: "You write a bio or About section in the person's voice. Lead with what they want to be known for. Never invent a credential.",
};

const FORMAT_ABOUT: Record<string, string> = {
  linkedin_post: "Every LinkedIn post drafted in the studio.",
  linkedin_hook_set: "The five-opener hook set (the cheap route).",
  ig_caption: "Instagram captions.",
  ig_carousel: "Carousel copy, slide by slide.",
  newsletter_section: "One newsletter section.",
  pitch_email: "Pitch emails; saved offers are in the context.",
  talk_abstract: "Talk abstracts, written for the ear.",
  x_post: "X posts and short threads.",
  threads_post: "Threads posts.",
  linkedin_comment: "Comments: the reply context, not the full voice.",
  whatsapp_message: "WhatsApp messages.",
  slack_message: "Slack and Teams messages.",
  bio: "Bios and About sections.",
};

const TASK_META: Record<string, { label: string; about: string }> = {
  topic_proposals: { label: "Topic suggestions", about: "The three topics Create opens on, from the pillars." },
  calendar_plan: { label: "90-day calendar", about: "Fills each planned slot with a topic, hook angle and ask." },
  voice_judge: { label: "Voice check findings", about: "The line-by-line findings beside the deterministic score." },
  rewrite_in_voice: { label: "Rewrite in my voice", about: "The rewrite offered when a draft is off brand." },
  cowrite_outline: { label: "Co-write outline", about: "A hook and the beats, for pieces the person writes themselves." },
  extract_answers: { label: "Onboarding pre-fill", about: "Proposes Core answers from their writing for one-tap confirm." },
  dial_pairs: { label: "This or that", about: "Paired lines for the voice dials in onboarding." },
  voice_preview: { label: "Live voice preview", about: "The paragraph that changes as answers are saved." },
};

/** The catalogue, in the order the admin page shows it. */
export const TEMPLATE_CATALOG: TemplateEntry[] = [
  ...Array.from(new Map(FORMATS.map((f) => [f.templateKey, f])).values()).map((f) => ({
    key: f.templateKey,
    label: f.label,
    group: "format" as const,
    about: FORMAT_ABOUT[f.templateKey] ?? `${f.label} drafts.`,
    defaultBody: FORMAT_BODIES[f.templateKey] ?? `You write a ${f.label.toLowerCase()} in the person's voice.`,
  })),
  {
    key: "pillar_set",
    label: "Content pillars",
    group: "brand",
    about: "Proposes the workspace's pillars from the brief and the strategy answers.",
    defaultBody:
      "You are a personal-brand strategist. From the brand context and the strategy answers, propose 3-5 distinct content pillars. Output one per line as: Name :: one-line description. No other text.",
  },
  {
    key: "image_brief",
    label: "Image brief",
    group: "brand",
    about: "Turns a post into a brand-aware image brief (reserved for an image model).",
    defaultBody: "You turn a post into a brand-aware image brief: subject, mood, composition, palette from the brand context, and what to avoid.",
  },
  ...Object.values(TASKS).map((t) => ({
    key: t.key,
    label: TASK_META[t.key]?.label ?? t.key,
    group: "task" as const,
    about: TASK_META[t.key]?.about ?? "",
    defaultBody: t.template,
  })),
];

export const templateDefault = (key: string): string | null => TEMPLATE_CATALOG.find((t) => t.key === key)?.defaultBody ?? null;

export const TEMPLATE_GROUP_LABEL: Record<TemplateGroup, string> = {
  format: "Writing formats",
  brand: "Brand core",
  task: "Studio tasks",
};
