/**
 * Uploaded images are rebuilt from their own pixels (TASKS P4-1, rest of).
 *
 * Sniffing the type catches a file pretending to be a PNG. It does not catch
 * a file that really is a valid PNG and also carries something else. These
 * tests prove the two things re-encoding is for: the pixels survive, and
 * everything that is not pixels does not.
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { crc32 } from "node:zlib";
import { isReencodable, reencodeImage, ImageError } from "@/lib/storage/reencode";

/** A small image with real content, so a comparison means something. */
async function png(width = 40, height = 30): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 40 } } }).png().toBuffer(),
  );
}

describe("re-encoding uploads", () => {
  it("keeps the image: same format, same dimensions, same pixels", async () => {
    const original = await png(40, 30);
    const out = await reencodeImage(original, "image/png");

    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("png");
    expect([meta.width, meta.height]).toEqual([40, 30]);

    // The corner pixel is still the colour it was.
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]]).toEqual([200, 30, 40]);
  });

  it("drops EXIF, so a headshot's GPS tag is not stored with it", async () => {
    const withExif = new Uint8Array(
      await sharp({ create: { width: 20, height: 20, channels: 3, background: "#fff" } })
        .withExif({ IFD0: { Copyright: "A Person", Software: "Camera 9000" } })
        .jpeg()
        .toBuffer(),
    );
    // Guard: the fixture really does carry metadata, or the test proves nothing.
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const out = await reencodeImage(withExif, "image/jpeg");
    expect((await sharp(out).metadata()).exif).toBeUndefined();
  });

  // A valid PNG can carry arbitrary bytes in a chunk no image decoder reads.
  // Re-encoding writes a new file from the pixels, so the chunk is not in it.
  it("does not carry over a payload smuggled in a trailing chunk", async () => {
    const base = await png(20, 20);
    const marker = Buffer.from("<?php echo 'payload'; ?>");
    const smuggled = new Uint8Array(Buffer.concat([Buffer.from(base), marker]));

    // Guard: the fixture is still a readable PNG, and the payload is in it.
    expect(Buffer.from(smuggled).includes(marker)).toBe(true);
    expect((await sharp(smuggled).metadata()).format).toBe("png");

    const out = await reencodeImage(smuggled, "image/png");
    expect(Buffer.from(out).includes(marker)).toBe(false);
  });

  it("leaves SVG alone — it is markup, and rasterising a logo would ruin it", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
    expect(isReencodable("image/svg+xml")).toBe(false);
    expect(await reencodeImage(svg, "image/svg+xml")).toBe(svg);
  });

  it("refuses a file that cannot be decoded, with something worth showing", async () => {
    const notAnImage = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    await expect(reencodeImage(notAnImage, "image/png")).rejects.toBeInstanceOf(ImageError);
  });

  // A few hundred bytes of PNG can declare a bitmap of billions of pixels.
  // This rewrites a real PNG's IHDR to claim 30000x30000 (900 megapixels)
  // without carrying any of them, which is exactly the shape of a decode
  // bomb. The header is read before pixels are allocated, so it is refused.
  it("refuses a decode bomb rather than running out of memory", async () => {
    const bomb = Buffer.from(await png(20, 20));
    // IHDR data starts at byte 16: 8-byte signature, 4-byte length, "IHDR".
    bomb.writeUInt32BE(30_000, 16);
    bomb.writeUInt32BE(30_000, 20);
    // The CRC covers the chunk type and its data, and sharp checks it.
    bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)), 29);

    await expect(reencodeImage(new Uint8Array(bomb), "image/png")).rejects.toBeInstanceOf(ImageError);
  }, 30_000);

  it("still accepts an ordinary image", async () => {
    await expect(reencodeImage(await png(), "image/png")).resolves.toBeInstanceOf(Uint8Array);
  });
});
