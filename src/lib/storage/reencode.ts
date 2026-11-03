/**
 * Re-encode uploaded raster images (TASKS P4-1, rest of).
 *
 * Sniffing a file's real type catches a .exe named .png. It does not catch a
 * file that genuinely IS a valid PNG and also something else — a polyglot, or
 * a PNG with a payload in a chunk no decoder reads but some other parser does.
 * Decoding the pixels and encoding them again produces a file built from the
 * image and nothing else: anything that was not pixels does not survive.
 *
 * It also drops metadata, which matters more than the exotic case. A client
 * uploading a headshot from a phone is uploading its EXIF too — the GPS tag
 * on a photo taken at home, the device, the timestamp. Nobody asked for that
 * and this product has no use for it, so it does not get stored.
 *
 * SVG is not re-encoded. It is markup, not pixels; `svgProblem` already
 * refuses the ones with active content, and rasterising someone's logo would
 * destroy the thing they uploaded it for.
 *
 * Server-only. sharp is the image library Next.js already uses for its own
 * image optimisation, so this adds no binary the deployment did not carry.
 */
import "server-only";
import sharp, { type Metadata, type Sharp } from "sharp";

/** Types whose pixels we decode and re-encode. SVG is deliberately absent. */
const RASTER = new Set(["image/png", "image/jpeg", "image/webp"]);

export function isReencodable(mime: string): boolean {
  return RASTER.has(mime);
}

/**
 * A decode bomb is a small file that expands to an enormous bitmap. sharp
 * reads the header first, so this is checked before any pixels are allocated.
 */
const MAX_PIXELS = 50_000_000; // ~50MP: larger than any real brand asset.

export class ImageError extends Error {}

/**
 * Decode and re-encode, keeping the format and dropping everything that is
 * not pixels. Returns the new bytes. Throws `ImageError` with a sentence fit
 * to show someone when the file cannot be decoded — which, after `sniffType`
 * has already approved the header, means it is damaged or not really an
 * image, and either way is not something to store.
 */
export async function reencodeImage(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  if (!isReencodable(mime)) return bytes;

  let pipeline: Sharp;
  let meta: Metadata;
  try {
    // `limitInputPixels` makes an oversized bitmap a refusal rather than a
    // process that runs out of memory and takes the instance with it.
    pipeline = sharp(bytes, { limitInputPixels: MAX_PIXELS, animated: mime === "image/webp" });
    meta = await pipeline.metadata();
  } catch {
    throw new ImageError("that image couldn't be read");
  }
  if (!meta.width || !meta.height) throw new ImageError("that image has no size we can read");

  try {
    // No metadata is carried over: sharp drops EXIF, ICC, XMP and every other
    // chunk unless asked to keep them, which is exactly what we want.
    const out =
      mime === "image/jpeg"
        ? await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer()
        : mime === "image/png"
          ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
          : await pipeline.webp({ quality: 90 }).toBuffer();
    return new Uint8Array(out);
  } catch {
    throw new ImageError("that image couldn't be processed");
  }
}
