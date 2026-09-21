/**
 * Content Studio formats (brief §4.2) + helpers shared by server and client.
 * Pure — safe to import from client components.
 */
export interface FormatDef {
  key: string;
  label: string;
  channel: "linkedin" | "instagram" | "newsletter" | "email" | "talk";
  templateKey: string;
  /** Export frame for the templated visual (brief §4.3 export dimensions). */
  frame: { w: number; h: number; label: string };
}

export const FORMATS: FormatDef[] = [
  { key: "linkedin_post", label: "LinkedIn post", channel: "linkedin", templateKey: "linkedin_post", frame: { w: 1080, h: 1350, label: "4:5 · 1080×1350" } },
  { key: "hook_set", label: "LinkedIn hook set", channel: "linkedin", templateKey: "linkedin_hook_set", frame: { w: 1080, h: 1080, label: "1:1 · 1080×1080" } },
  { key: "ig_caption", label: "Instagram caption", channel: "instagram", templateKey: "ig_caption", frame: { w: 1080, h: 1350, label: "4:5 · 1080×1350" } },
  { key: "ig_carousel", label: "Instagram carousel", channel: "instagram", templateKey: "ig_carousel", frame: { w: 1080, h: 1350, label: "4:5 frames · 1080×1350" } },
  { key: "newsletter_section", label: "Newsletter section", channel: "newsletter", templateKey: "newsletter_section", frame: { w: 1200, h: 628, label: "Header · 1200×628" } },
  { key: "pitch_email", label: "Pitch email", channel: "email", templateKey: "pitch_email", frame: { w: 1200, h: 628, label: "Header · 1200×628" } },
  { key: "talk_abstract", label: "Talk abstract", channel: "talk", templateKey: "talk_abstract", frame: { w: 1920, h: 1080, label: "16:9 · 1920×1080" } },
];

export const formatByKey = (k: string): FormatDef => FORMATS.find((f) => f.key === k) ?? FORMATS[0];

export const STEERS = ["Shorter", "More contrarian", "Less corporate", "Warmer", "Punchier hook"];

/** Split a generated draft into hook / body / CTA (first line / middle / "→" line). */
export function splitDraft(text: string): { hook: string; body: string; cta: string } {
  const lines = text.split("\n").map((l) => l.trimEnd());
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length === 0) return { hook: "", body: "", cta: "" };
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
