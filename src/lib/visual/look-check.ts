/**
 * Hue Check, "On-brand look?" (Layer 2, M5). Pure.
 *
 * Visuals here are templates drawn from the Visual Core, so the look can be
 * measured rather than guessed: are the colours the brand's, is the text
 * readable on its ground, does the headline fit the frame, are the brand's own
 * fonts in use. Each finding names what it measured and how to fix it; the
 * score uses the same bands as the voice check (85 on brand, 60 drifting), and
 * like it, never blocks a download.
 */

export type LookVerdict = "on" | "drift" | "off";
export interface LookFinding { verdict: LookVerdict; text: string }
export interface LookResult { score: number; band: LookVerdict; findings: LookFinding[] }

/** House neutrals stand in when a brand has no palette, so they never count against it. */
const NEUTRALS = ["#0A0A0A", "#FFFFFF", "#6B6B6B"];

function luminance(hex: string): number {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((x) => x + x).join("") : m.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(x: string, y: string): number {
  if (!/^#[0-9a-f]{3,8}$/i.test(x) || !/^#[0-9a-f]{3,8}$/i.test(y)) return 1;
  const [a, b] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (a + 0.05) / (b + 0.05);
}

/** Longest comfortable headline per artboard kind, in words, at the template's own size. */
const MAX_WORDS = { post: 22, quote: 30 } as const;

export function lookCheck(input: {
  palette: string[];
  fonts: string[];
  scheme: { bg: string; fg: string; accent: string };
  tweaks: { scale: number; background: "scheme" | "inverse" | "tint"; accent: "none" | "subtle" | "bold" };
  headline: string;
}): LookResult {
  const f: LookFinding[] = [];
  const own = new Set([...input.palette, ...(input.palette.length ? [] : NEUTRALS)].map((c) => c.toUpperCase()));
  const { bg, fg, accent } = input.scheme;
  const ground = input.tweaks.background === "inverse" ? fg : bg;
  const ink = input.tweaks.background === "inverse" ? bg : fg;

  const strangers = [bg, fg, accent].map((c) => c.toUpperCase()).filter((c) => !own.has(c) && !NEUTRALS.includes(c));
  if (strangers.length) f.push({ verdict: "drift", text: `${[...new Set(strangers)].join(", ")} isn't in your palette. Pick a scheme made from your colours.` });
  else f.push({ verdict: "on", text: "Every colour is one of yours." });

  const c = contrastRatio(ink, ground);
  if (c < 3) f.push({ verdict: "off", text: `Text is hard to read on this ground (${c.toFixed(1)}:1). Try another scheme or the inverse background.` });
  else if (c < 4.5) f.push({ verdict: "drift", text: `Text contrast is ${c.toFixed(1)}:1; 4.5:1 reads comfortably on a phone.` });
  else f.push({ verdict: "on", text: `Text reads clearly (${c.toFixed(1)}:1).` });

  if (input.tweaks.accent === "bold" && contrastRatio(accent, ground) < 3) {
    f.push({ verdict: "drift", text: "The accent is too faint on this ground to carry the words, so the words stay in your ink colour." });
  }

  const words = input.headline.trim().split(/\s+/).filter(Boolean).length;
  const limit = MAX_WORDS.post;
  if (words > limit * 1.5 || (words > limit && input.tweaks.scale >= 1.2)) f.push({ verdict: "off", text: `${words} words is a lot for one image; it will be small on a phone. Shorten the headline or lower the type size.` });
  else if (words > limit) f.push({ verdict: "drift", text: `${words} words is long for a post image. Under ${limit} reads at a glance.` });

  if (!input.fonts.length) f.push({ verdict: "drift", text: "No brand fonts set, so the house font stands in. Add yours in Brand core, Visual." });

  const score = Math.max(0, 100 - f.filter((x) => x.verdict === "off").length * 40 - f.filter((x) => x.verdict === "drift").length * 12);
  return { score, band: score >= 85 ? "on" : score >= 60 ? "drift" : "off", findings: f };
}
