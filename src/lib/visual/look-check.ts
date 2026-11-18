/**
 * Hue Check, "On-brand look?" (Layer 2, M5). Pure.
 *
 * Two questions, both measured rather than guessed:
 *
 *   Is it sound?   text readable on its ground, a headline that fits, no
 *                  colour from outside the palette, nothing cut off.
 *   Is it yours?   one of the brand's own colours actually in use, the brand's
 *                  font actually rendering, the logo on the sign-off, a picture.
 *
 * A sound visual that carries nothing of the brand is not "on brand": a plain
 * card of text on black is what any brand could post, so it tops out at
 * Drifting and says what is missing and where to add it. With no palette set,
 * black and white stand in and the check says so; they never count as "yours".
 *
 * Each finding names what it measured and how to fix it. The score uses the
 * same bands as the voice check (85 on brand, 60 drifting), and like it,
 * never blocks a download.
 */
import { contrast, isNeutral, paint } from "./schemes";

export type LookVerdict = "on" | "drift" | "off";
export interface LookFinding { verdict: LookVerdict; text: string }
export interface LookResult { score: number; band: LookVerdict; findings: LookFinding[] }

export interface LookInput {
  palette: string[];
  fonts: string[];
  scheme: { bg: string; fg: string; accent: string };
  tweaks: { scale: number; background: "scheme" | "inverse" | "tint"; accent: "none" | "subtle" | "bold" };
  headline: string;
  /** Whether the brand's font is really rendering (measured in the browser). Left out: taken as rendering when one is set. */
  fontRendering?: boolean;
  /** Where the page loads the brand's heading font from (lib/visual/fonts): its uploaded file, Google Fonts, or nowhere. */
  fontSource?: "upload" | "google" | "none";
  /** A logo image shows in the sign-off. */
  logo?: boolean;
  /** The workspace has a logo, but this piece's design hides it. */
  logoHidden?: boolean;
  /** The piece carries a picture on at least one of its visuals. */
  picture?: boolean;
  /**
   * The heading is drawn into a picture on one of its visuals ("with_text"). Its
   * spelling is not checked here (no OCR), so it is never On brand on its own.
   */
  drawnIn?: boolean;
  /** How the text fitted its frames, measured in the browser. "clamped": some text was cut off with an ellipsis. */
  fit?: "ok" | "shrunk" | "clamped";
}

export const contrastRatio = contrast;

/** Longest comfortable headline for a post image, in words, at the template's own size. */
const MAX_WORDS = 22;

/** What each sign of the brand is worth. Colour, font and logo together are the full 35; a picture can stand in for one. */
const OWN = { colour: 15, font: 12, logo: 8, picture: 8 } as const;
const OWN_FULL = 35;
const COST = { off: 40, drift: 12 } as const;

export function lookCheck(input: LookInput): LookResult {
  const f: LookFinding[] = [];
  let cost = 0;
  const flag = (verdict: "off" | "drift", text: string) => { f.push({ verdict, text }); cost += COST[verdict]; };

  const own = new Set(input.palette.map((c) => c.toUpperCase()));
  const p = paint({ name: "", ...input.scheme }, input.tweaks, "normal");
  const drawn = [p.bg, p.fg, ...(p.showMarks ? [p.accent] : []), ...(p.words !== p.fg ? [p.words] : []), ...(input.tweaks.background === "tint" ? [input.scheme.accent] : [])];
  const yours = [...new Set(drawn.map((c) => c.toUpperCase()).filter((c) => own.has(c) && !isNeutral(c)))];

  // ---- is it yours: colour ----
  const strangers = [...new Set([input.scheme.bg, input.scheme.fg, input.scheme.accent].map((c) => c.toUpperCase()).filter((c) => !own.has(c) && !isNeutral(c)))];
  if (!input.palette.length) {
    f.push({ verdict: "drift", text: "No brand colours set, so black and white stand in. Add yours in Brand core, Visual." });
  } else if (strangers.length) {
    flag("drift", `${strangers.join(", ")} isn't in your palette. Pick a scheme made from your colours.`);
  } else if (yours.length) {
    f.push({ verdict: "on", text: `Your colour ${yours.slice(0, 2).join(" and ")} is in use.` });
  } else if (input.palette.every(isNeutral)) {
    f.push({ verdict: "drift", text: "Your palette is black, white and grey, which any brand could be using. Your font, your logo or a picture is what makes this yours." });
  } else {
    f.push({ verdict: "drift", text: "None of your brand colours shows here, only black, white or grey. Turn the accent on, or pick a scheme that uses them." });
  }

  // ---- is it sound ----
  const c = contrast(p.fg, p.bg);
  if (c < 3) flag("off", `Text is hard to read on this ground (${c.toFixed(1)}:1). Try another scheme or the inverse background.`);
  else if (c < 4.5) flag("drift", `Text contrast is ${c.toFixed(1)}:1; 4.5:1 reads comfortably on a phone.`);
  else f.push({ verdict: "on", text: `Text reads clearly (${c.toFixed(1)}:1).` });

  if (input.tweaks.accent === "bold" && contrast(input.scheme.accent, p.bg) < 3) {
    flag("drift", "The accent is too faint on this ground to carry the words, so the words stay in your ink colour.");
  }

  const words = input.headline.trim().split(/\s+/).filter(Boolean).length;
  if (input.fit === "clamped") flag("off", "The text doesn't fit its frame, so the end is cut off with an ellipsis. Shorten it, or lower the type size.");
  else if (words > MAX_WORDS * 1.5 || (words > MAX_WORDS && input.tweaks.scale >= 1.2)) flag("off", `${words} words is a lot for one image; it will be small on a phone. Shorten the headline or lower the type size.`);
  else if (words > MAX_WORDS) flag("drift", `${words} words is long for a post image. Under ${MAX_WORDS} reads at a glance.`);

  // ---- is it yours: font, logo, picture ----
  // A heading drawn into the picture is not set in the brand font, whatever is installed.
  const font = !input.drawnIn && input.fonts.length > 0 && input.fontRendering !== false;
  if (input.drawnIn) {
    f.push({ verdict: "drift", text: "The heading is drawn into the picture, so your font does not set it." });
    f.push({ verdict: "drift", text: "The heading drawn into the picture may not be spelled right. Check it: redraw the picture with the heading, or switch to live text." });
  } else if (font) f.push({ verdict: "on", text: `Set in your font, ${input.fonts[0]}${input.fontSource === "upload" ? ", loaded from your uploaded file" : input.fontSource === "google" ? ", loaded from Google Fonts" : ""}.` });
  else if (!input.fonts.length) f.push({ verdict: "drift", text: "No brand fonts set, so the house font stands in. Add yours in Brand core, Visual." });
  else if (input.fontSource === "none") f.push({ verdict: "drift", text: `${input.fonts[0]} isn't loading here: it isn't a Google font and no file for it is uploaded, so the house font stands in. Upload its WOFF2, WOFF, TTF or OTF file in Brand core, Visual.` });
  else f.push({ verdict: "drift", text: `${input.fonts[0]} isn't loading here, so the house font stands in. Check the font in Brand core, Visual.` });

  if (input.logo) f.push({ verdict: "on", text: "Your logo signs it off." });
  else if (input.logoHidden) f.push({ verdict: "drift", text: "Your logo is hidden on this piece, so only the name signs it off." });
  else f.push({ verdict: "drift", text: "No logo on the sign-off, only the name. Add your logo in Brand core." });

  if (input.picture) f.push({ verdict: "on", text: "It carries a picture." });

  const earned = (yours.length ? OWN.colour : 0) + (font ? OWN.font : 0) + (input.logo ? OWN.logo : 0) + (input.picture ? OWN.picture : 0);
  if (earned === 0) {
    f.push({ verdict: "drift", text: "Nothing here is yours yet: neutral colours, the house font, no logo, no picture. Any brand could post it. Add your colours, font and logo in Brand core, or put a picture on it." });
  }

  let score = Math.max(0, 100 - cost - (OWN_FULL - Math.min(OWN_FULL, earned)));
  // Never "on brand" with nothing of the brand on it, with text cut off, or with a heading in the picture nobody has checked.
  if (earned === 0 || input.fit === "clamped" || input.drawnIn) score = Math.min(score, 84);
  return { score, band: score >= 85 ? "on" : score >= 60 ? "drift" : "off", findings: f };
}
