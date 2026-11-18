/**
 * Plain-words colour names for the style guide ("Deep green", "Cream", "Ink").
 * Pure maths, no React, so it can be tested on its own.
 */

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Hue (degrees), saturation and lightness (0..1), plus chroma: max - min of the channels (0..1). */
export function hsl(h: string): { h: number; s: number; l: number; c: number } {
  const [r, g, b] = rgb(h).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l, c: 0 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: hue * 60, s, l, c: d };
}

/**
 * A plain-words name for a colour: "Deep green", "Cream", "Ink".
 *
 * Near-whites are named by how they read, not by their hue. HSL saturation
 * swells near white (#F5F1E8 is 40% "saturated" with almost no colour in it),
 * so a very light colour with little chroma is a white, an ivory, a cream or
 * an off-white, never "Soft gold" (2026-11-18 run, Harrow Lane Growth).
 */
export function colourName(h: string): string {
  const { h: hue, s, l, c } = hsl(h);
  if (s < 0.12) return l > 0.94 ? "White" : l > 0.8 ? "Mist" : l > 0.55 ? "Stone" : l > 0.25 ? "Graphite" : "Ink";
  if (l > 0.85 && c < 0.12) {
    const warm = hue >= 20 && hue < 75;
    if (warm) return l > 0.95 ? "Ivory" : "Cream";
    return "Off-white";
  }
  const names: [number, string][] = [[15, "Red"], [40, "Orange"], [55, "Gold"], [70, "Yellow"], [160, "Green"], [190, "Teal"], [250, "Blue"], [290, "Violet"], [335, "Magenta"], [360, "Red"]];
  let base = names.find(([max]) => hue < max)?.[1] ?? "Red";
  if ((base === "Orange" || base === "Gold") && l > 0.8) base = "Cream";
  if (base === "Yellow" && l > 0.85) base = "Cream";
  const tone = l > 0.85 ? "Soft" : l > 0.65 ? "Light" : l < 0.25 ? "Deep" : s > 0.7 ? "Bright" : "";
  return tone ? `${tone} ${base.toLowerCase()}` : base;
}
