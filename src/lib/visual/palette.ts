/**
 * A palette suggested from a logo. Pure and client-safe: the browser draws the
 * image to a canvas and hands over its pixels; nothing is uploaded to do it.
 *
 * Colours are bucketed (4 bits a channel), transparent and near-white pixels
 * are ignored (a logo's background isn't its colour), then the most common
 * buckets are kept, merging any two that look alike. Ordered so the darkest
 * comes first: the first two colours become ground and accent.
 */

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const luminance = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function paletteFromPixels(data: ArrayLike<number>, max = 4): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 128) continue;
    if (r > 240 && g > 240 && b > 240) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    cur.n++;
    cur.r += r;
    cur.g += g;
    cur.b += b;
    buckets.set(key, cur);
  }
  const ranked = [...buckets.values()]
    .map((c) => ({ n: c.n, rgb: [c.r / c.n, c.g / c.n, c.b / c.n] }))
    .sort((a, b) => b.n - a.n);
  const kept: { n: number; rgb: number[] }[] = [];
  for (const c of ranked) {
    if (kept.length >= max) break;
    // A pixel or two of anti-aliasing isn't a brand colour.
    if (kept.length && c.n < ranked[0].n * 0.02) break;
    if (kept.some((k) => dist(k.rgb, c.rgb) < 48)) continue;
    kept.push(c);
  }
  return kept.sort((a, b) => luminance(a.rgb) - luminance(b.rgb)).map((c) => hex(c.rgb[0], c.rgb[1], c.rgb[2]));
}
