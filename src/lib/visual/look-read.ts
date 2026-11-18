/**
 * The pixels side of reading a person's reference designs (look_read):
 *
 *   - measureColours: each design's dominant colours, MEASURED (never asked
 *     of the model): a small copy of the image, colours bucketed, the biggest
 *     buckets averaged, near-duplicates dropped, at most five hex values.
 *   - forVision: the copy the vision model sees, at most 768 px on its long
 *     edge, JPEG at quality 80, so a reading costs a few hundred tokens a
 *     picture instead of thousands.
 *   - imageFromPage: the picture a Pinterest pin (or any page) shares, from
 *     its og:image / twitter:image tags. Pure, so it is tested on its own.
 *
 * Server-only (sharp).
 */
import "server-only";
import sharp from "sharp";
import type { TextImage } from "@/lib/ai/types";

/** The long edge, in pixels, of the copy a vision model is sent. */
export const VISION_MAX_SIDE = 768;
const VISION_QUALITY = 80;
/** The most colours kept per design. */
export const MAX_MEASURED = 5;

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/** Two colours closer than this (straight-line distance in RGB) count as one. */
const SAME_COLOUR = 42;
const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * A design's dominant colours, biggest share first. The image is shrunk to
 * 64 px by sampling (nearest pixel, so edges don't blend into colours that
 * aren't there; enough to see what covers it, cheap to count), transparency is laid
 * on white, and each pixel falls into a bucket of 16 levels per channel. A
 * bucket's colour is the average of its pixels, not the bucket's corner, so
 * the hex is a colour that is really there. Buckets under 1.5% of the image
 * are noise (anti-aliasing, a stray pixel of a photo) and are dropped.
 */
export async function measureColours(bytes: Uint8Array, max = MAX_MEASURED): Promise<string[]> {
  const { data, info } = await sharp(bytes, { limitInputPixels: 50_000_000, animated: false })
    .flatten({ background: "#ffffff" })
    .resize(64, 64, { fit: "inside", kernel: "nearest" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  const ch = info.channels;
  for (let i = 0; i + 2 < data.length; i += ch) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const k = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    k.n++; k.r += r; k.g += g; k.b += b;
    buckets.set(key, k);
  }
  const total = info.width * info.height || 1;
  const ranked = [...buckets.values()]
    .filter((k) => k.n / total >= 0.015)
    .sort((a, b) => b.n - a.n)
    .map((k) => [k.r / k.n, k.g / k.n, k.b / k.n]);
  const kept: number[][] = [];
  for (const c of ranked) {
    if (kept.some((k) => distance(k, c) < SAME_COLOUR)) continue;
    kept.push(c);
    if (kept.length >= max) break;
  }
  return kept.map(([r, g, b]) => toHex(r, g, b));
}

/** The copy a vision model looks at: upright, at most `maxSide` px (768 by default), JPEG 80, no metadata. */
export async function forVision(bytes: Uint8Array, maxSide = VISION_MAX_SIDE): Promise<TextImage> {
  const side = Math.max(64, Math.min(VISION_MAX_SIDE, Math.round(maxSide)));
  const data = await sharp(bytes, { limitInputPixels: 50_000_000, animated: false })
    .autoOrient()
    .flatten({ background: "#ffffff" })
    .resize({ width: side, height: side, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: VISION_QUALITY })
    .toBuffer();
  return { mime: "image/jpeg", data: new Uint8Array(data) };
}

/**
 * Several designs as ONE picture: side by side on white, each in its own cell
 * with its number in the corner, left to right in the order given. Groq counts
 * every image at a fixed ~1,800 input tokens whatever its size (measured
 * 2026-11-18: 320 px and 768 px both 1,813), and its free tier takes 7,000 a
 * minute for qwen/qwen3.8-27b, brand context included: three separate images
 * never fit, one sheet does. On Claude a sheet also costs less than three
 * images. Each cell is 512 x 640 (designs are mostly portrait posts).
 */
export async function contactSheet(designs: Uint8Array[]): Promise<TextImage> {
  const CELL_W = 512, CELL_H = 640, GAP = 24, TAG = 44;
  const n = Math.max(1, designs.length);
  const width = n * CELL_W + (n + 1) * GAP;
  const height = CELL_H + 2 * GAP;
  const cells = await Promise.all(
    designs.map(async (bytes, i) => {
      const img = await sharp(bytes, { limitInputPixels: 50_000_000, animated: false })
        .autoOrient()
        .flatten({ background: "#ffffff" })
        .resize({ width: CELL_W, height: CELL_H, fit: "contain", background: "#ffffff" })
        .png()
        .toBuffer();
      const left = GAP + i * (CELL_W + GAP);
      const tag = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${TAG}" height="${TAG}"><rect width="${TAG}" height="${TAG}" fill="#000000"/>` +
          `<text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" fill="#ffffff">${i + 1}</text></svg>`,
      );
      return [
        { input: img, left, top: GAP },
        { input: tag, left, top: GAP },
      ];
    }),
  );
  const data = await sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .composite(cells.flat())
    .jpeg({ quality: VISION_QUALITY })
    .toBuffer();
  return { mime: "image/jpeg", data: new Uint8Array(data) };
}

// ---- a picture from a link --------------------------------------------------

/** pinterest.com (any country domain) or a pin.it short link. */
export function isPinterestUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    return host === "pin.it" || /(^|\.)pinterest\.[a-z.]{2,6}$/.test(host);
  } catch {
    return false;
  }
}

const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(1).find((x) => x !== undefined) ?? "";

const unescape = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&#47;/g, "/").trim();

/**
 * The picture a page shares: og:image (and its :secure_url / :url forms),
 * then twitter:image, then <link rel="image_src">. Relative values are read
 * against the page's own address. Pinterest pages carry the pin's image on
 * i.pinimg.com in og:image. Null when the page shares none.
 */
export function imageFromPage(html: string, pageUrl: string): string | null {
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const key = (t: string) => (attr(t, "property") || attr(t, "name")).toLowerCase();
  const pick = (...names: string[]) => {
    for (const n of names) {
      const tag = metas.find((t) => key(t) === n && attr(t, "content"));
      if (tag) return unescape(attr(tag, "content"));
    }
    return "";
  };
  const link = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((t) => /(^|\s)image_src(\s|$)/i.test(attr(t, "rel")));
  const raw = pick("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src") || (link ? unescape(attr(link, "href")) : "");
  if (!raw || raw.startsWith("data:")) return null;
  try {
    const u = new URL(raw, pageUrl);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
