/**
 * Uploaded images are re-encoded before they are stored, never kept as sent.
 *
 * A photo straight off a phone carries EXIF: where it was taken (GPS), when,
 * on what device, sometimes a thumbnail of the uncropped original. A file can
 * also be built to hurt whoever opens it: a few kilobytes that decode to
 * billions of pixels (a decompression bomb), or bytes past the image that a
 * viewer might act on. Decoding to pixels and writing a fresh file drops all
 * of that.
 *
 * What comes out:
 *   - turned the right way up from the EXIF orientation, then every piece of
 *     metadata removed (EXIF, GPS, XMP, IPTC, comments, ICC);
 *   - colour converted to sRGB (which is how browsers show an untagged image),
 *     so a CMYK or wide-gamut file still looks right without its profile;
 *   - no larger than MAX_SIDE on its longest side (smaller ones are not scaled up);
 *   - in the format it came in: PNG stays PNG (lossless, alpha kept), JPEG
 *     stays JPEG, WebP stays WebP. An animated WebP keeps its first frame.
 *
 * Anything over MAX_INPUT_PIXELS is refused before it is decoded, and so is
 * anything the decoder can't read; both with a message for the uploader.
 *
 * Uses sharp (libvips). Next keeps sharp out of the server bundle by default
 * (it is on Next's built-in serverExternalPackages list), and Vercel installs
 * the Linux build from the lockfile, so no next.config change is needed.
 *
 * Server-only.
 */
import "server-only";
import sharp from "sharp";

/** Longest side, in pixels, of a stored image. Larger uploads are scaled down to fit. */
export const MAX_SIDE = 4096;
/** Most pixels an upload may decode to (width x height): a 48 MP phone photo fits, a bomb doesn't. */
export const MAX_INPUT_PIXELS = 50_000_000;

/** The raster types re-encoded here. SVG is text and is checked separately (./sniff svgProblem). */
export const REENCODED_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type ReencodedType = (typeof REENCODED_TYPES)[number];

export function isReencodedType(mime: string): mime is ReencodedType {
  return (REENCODED_TYPES as readonly string[]).includes(mime);
}

/** An image refused while re-encoding, worded for the person who chose it. */
export class ImageRefused extends Error {
  constructor(
    message: string,
    readonly reason: "too_large" | "unreadable",
  ) {
    super(message);
    this.name = "ImageRefused";
  }
}

export interface ReencodedImage {
  data: Uint8Array;
  mime: ReencodedType;
  width: number;
  height: number;
}

// A serverless instance handles one upload at a time and then idles: libvips'
// operation cache would only hold memory.
sharp.cache(false);

/**
 * Decode, orient, strip, cap and re-encode one image. `mime` is the type read
 * from the bytes (./sniff sniffType), not the name or what the browser said.
 */
export async function reencodeImage(
  bytes: Uint8Array,
  mime: ReencodedType,
  limits: { maxInputPixels?: number; maxSide?: number } = {},
): Promise<ReencodedImage> {
  const maxInputPixels = limits.maxInputPixels ?? MAX_INPUT_PIXELS;
  const maxSide = limits.maxSide ?? MAX_SIDE;
  try {
    const pipeline = sharp(bytes, {
      limitInputPixels: maxInputPixels,
      // Refuse a truncated or corrupt file instead of storing what decoded of it.
      failOn: "error",
      animated: false,
    })
      .autoOrient()
      .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true });
    // No keepMetadata/withMetadata call: sharp writes none, and converts to sRGB.
    const encoded =
      mime === "image/png" ? pipeline.png({ compressionLevel: 9 })
      : mime === "image/jpeg" ? pipeline.jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
      : pipeline.webp({ quality: 90 });
    const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
    return { data: new Uint8Array(data), mime, width: info.width, height: info.height };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/pixel limit/i.test(message)) {
      throw new ImageRefused(
        `That image is too big to process: over ${Math.round(maxInputPixels / 1_000_000)} megapixels. Export it at a smaller size and upload it again.`,
        "too_large",
      );
    }
    throw new ImageRefused(
      "That file couldn't be read as an image. It may be damaged, or not really the type its name says. Export it again as a PNG or JPEG.",
      "unreadable",
    );
  }
}
