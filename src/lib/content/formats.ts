import { angleLine } from "./angles";
/**
 * Content Studio formats (brief §4.2) + helpers shared by server and client.
 * Pure — safe to import from client components.
 */
export interface FormatDef {
  key: string;
  label: string;
  channel: "linkedin" | "instagram" | "newsletter" | "email" | "talk" | "x" | "threads" | "chat" | "bio";
  /** A short reply or message: loads the reply context (spec 01 §3), not the full writing context. */
  reply?: boolean;
  templateKey: string;
  /**
   * The platform whose rules and whose voice block apply (lib/voice/platforms,
   * the person's contexts). Distinct from `channel`, which is the coarser
   * grouping stored on content rows: a talk abstract is channel "talk" but is
   * written for the ear, so it reads the spoken-script rules.
   */
  platform: string;
  /** Export frame for the templated visual (brief §4.3 export dimensions). */
  frame: { w: number; h: number; label: string };
  /**
   * The copy runs to several frames (a carousel, or a long post read slide by
   * slide). Only these get carousel frames: see formatUsesCarousel.
   */
  carousel?: boolean;
}

export const FORMATS: FormatDef[] = [
  { key: "linkedin_post", label: "LinkedIn post", channel: "linkedin", platform: "linkedin", templateKey: "linkedin_post", carousel: true, frame: { w: 1080, h: 1350, label: "4:5 · 1080×1350" } },
  { key: "hook_set", label: "LinkedIn hook set", channel: "linkedin", platform: "linkedin", templateKey: "linkedin_hook_set", frame: { w: 1080, h: 1080, label: "1:1 · 1080×1080" } },
  { key: "ig_caption", label: "Instagram caption", channel: "instagram", platform: "instagram", templateKey: "ig_caption", frame: { w: 1080, h: 1350, label: "4:5 · 1080×1350" } },
  { key: "ig_carousel", label: "Instagram carousel", channel: "instagram", platform: "instagram", templateKey: "ig_carousel", carousel: true, frame: { w: 1080, h: 1350, label: "4:5 frames · 1080×1350" } },
  { key: "newsletter_section", label: "Newsletter section", channel: "newsletter", platform: "newsletter", templateKey: "newsletter_section", frame: { w: 1200, h: 628, label: "Header · 1200×628" } },
  { key: "pitch_email", label: "Pitch email", channel: "email", platform: "email", templateKey: "pitch_email", frame: { w: 1200, h: 628, label: "Header · 1200×628" } },
  { key: "talk_abstract", label: "Talk abstract", channel: "talk", platform: "spoken", templateKey: "talk_abstract", frame: { w: 1920, h: 1080, label: "16:9 · 1920×1080" } },
  { key: "x_post", label: "X post", channel: "x", platform: "x", templateKey: "x_post", frame: { w: 1600, h: 900, label: "16:9 · 1600×900" } },
  { key: "threads_post", label: "Threads post", channel: "threads", platform: "threads", templateKey: "threads_post", frame: { w: 1080, h: 1350, label: "4:5 · 1080×1350" } },
  { key: "linkedin_comment", label: "LinkedIn comment", channel: "linkedin", platform: "linkedin_comment", templateKey: "linkedin_comment", reply: true, frame: { w: 1080, h: 1080, label: "1:1 · 1080×1080" } },
  { key: "whatsapp_message", label: "WhatsApp message", channel: "chat", platform: "whatsapp", templateKey: "whatsapp_message", reply: true, frame: { w: 1080, h: 1080, label: "1:1 · 1080×1080" } },
  { key: "slack_message", label: "Slack or Teams message", channel: "chat", platform: "slack", templateKey: "slack_message", reply: true, frame: { w: 1080, h: 1080, label: "1:1 · 1080×1080" } },
  { key: "bio", label: "Bio or About", channel: "bio", platform: "bio", templateKey: "bio", frame: { w: 1584, h: 396, label: "Banner · 1584×396" } },
];

export const formatByKey = (k: string): FormatDef => FORMATS.find((f) => f.key === k) ?? FORMATS[0];

/**
 * A format that does one job its topic states: a bio, a reply, a message. It is
 * not a post with a point of view, so a post angle ("The mistake most people
 * make") does not apply to it and its pillar is background, never the subject.
 * The one place this is decided: Ideate (which hides the angles) and every
 * task that writes or rewrites a piece ask it.
 */
export const formatIsUtility = (formatKey: string | null | undefined): boolean => {
  const f = FORMATS.find((x) => x.key === formatKey);
  return !!f && (!!f.reply || f.key === "bio");
};

/**
 * What THIS piece is, as task-input lines: the format, the topic, the pillar by
 * name (what it means is in the brand context, INV-2) and the angle with what
 * it asks of the draft. For a utility format the topic is the whole job: no
 * angle, and the pillar is named as background only (2026-11-19 QA: with an
 * angle picked, a conference bio came back as an opinion post about rebrands
 * and a WhatsApp note to a client as a lecture on the pillar).
 */
export function pieceTaskLines(formatKey: string, topic: string | null | undefined, pillar: string | null | undefined, angle: string | null | undefined): string[] {
  const fmt = formatByKey(formatKey);
  const t = (topic ?? "").trim();
  if (formatIsUtility(fmt.key)) {
    return [
      `Format: ${fmt.label}`,
      t ? `Topic: ${t}` : "",
      `This is a ${fmt.label}, not a post. Write exactly what the topic asks for, as that kind of text, in their voice. No hook, no opinion piece, no lesson drawn from it, nothing argued.`,
      pillar ? `Pillar (background only: it is not the subject, and nothing is argued from it): ${pillar}` : "",
    ].filter(Boolean);
  }
  return [`Format: ${fmt.label}`, t ? `Topic: ${t}` : "", pillar ? `Pillar: ${pillar}` : "", angleLine(angle)].filter(Boolean);
}

/**
 * Whether a piece of this format gets carousel frames (the visual set's
 * "carousel" artboard). The one place this is decided: generation, the visual
 * board and the export all ask it. A format without the flag (an X post, a
 * WhatsApp message, a LinkedIn comment) gets the post image and the quote card.
 */
export const formatUsesCarousel = (formatKey: string | null | undefined): boolean => !!FORMATS.find((f) => f.key === formatKey)?.carousel;

export const STEERS = ["Shorter", "More contrarian", "Less corporate", "Warmer", "Punchier hook"];

/**
 * Split a generated draft into hook / body / CTA (first line / middle / the
 * "CTA:" or "→" line). A model sometimes returns the whole piece as ONE
 * paragraph, call to action included; that used to land entirely in the hook
 * with an empty body, which onboarding read as "no piece yet" and left the
 * person stuck (2026-11-17 round-two test). So a one-line draft is split too:
 * an inline "CTA:" comes off the end, and the first sentence is the hook.
 */
export function splitDraft(text: string): { hook: string; body: string; cta: string } {
  let lines = text.split("\n").map((l) => l.trimEnd());
  let nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length === 0) return { hook: "", body: "", cta: "" };
  if (nonEmpty.length === 1) {
    let rest = nonEmpty[0].trim();
    let tail = "";
    const at = rest.search(/\s(?:CTA:|→)\s*\S/);
    if (at > 0) {
      tail = rest.slice(at).trim();
      rest = rest.slice(0, at).trim();
    }
    const end = rest.search(/[.!?]["”’)]?\s+\S/);
    const parts = end > 0 ? [rest.slice(0, end + 1).trim(), rest.slice(end + 1).trim()] : [rest];
    lines = tail ? [...parts, tail] : parts;
    nonEmpty = lines;
  }
  const hook = nonEmpty[0].trim();
  const last = nonEmpty[nonEmpty.length - 1].trim();
  const hasCta = nonEmpty.length > 1 && /^(→|cta:)/i.test(last);
  const cta = hasCta ? last.replace(/^(→|cta:)\s*/i, "") : "";
  const bodyLines = lines.slice(lines.indexOf(nonEmpty[0]) + 1);
  if (hasCta) bodyLines.splice(bodyLines.lastIndexOf(nonEmpty[nonEmpty.length - 1]), 1);
  return { hook, body: bodyLines.join("\n").trim(), cta };
}

/**
 * Voice guardrail check (brief §4.2): returns every don't-word found in the
 * text. The UI FLAGS these — it never silently rewrites.
 */
export function findViolations(text: string, dontWords: string[]): string[] {
  const hay = text.toLowerCase();
  return dontWords.filter((w) => {
    const word = w.trim().toLowerCase();
    if (!word) return false;
    const re = new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
    return re.test(hay);
  });
}

/**
 * A fact the draft did not have, left as "[placeholder]" (the draft contract,
 * lib/ai/prompt). Matched whatever the case, with a currency sign in front
 * ("$[placeholder]") or a note inside ("[placeholder: client name]"). Code,
 * not a model: a placeholder that reaches a published post is the one mistake
 * nobody forgives, so it is found the same way every time.
 */
const PLACEHOLDER = /[$£€₹]?\[\s*placeholder(?:[\s:,-][^\]\n]{0,80})?\]/gi;

/** Every placeholder still in the text, as written. */
export function findPlaceholders(text: string): string[] {
  return text.match(PLACEHOLDER) ?? [];
}

/** A finished piece as plain text, the way it is pasted into the platform. */
export function pieceText(p: { hook: string; body: string; cta: string }): string {
  return [p.hook, p.body, p.cta].map((s) => s.trim()).filter(Boolean).join("\n\n");
}

/** The format is five opening lines, not a post: its labels and its ask differ. */
export const isHookSet = (formatKey: string | null | undefined): boolean => formatKey === "hook_set";
