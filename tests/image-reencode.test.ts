/**
 * Uploaded images are re-encoded before they are stored (lib/storage/image):
 * the GPS position and the rest of the EXIF are gone, the picture is turned
 * the right way up, a file that would decode to too many pixels is refused
 * before it is decoded, and bytes that only pretend to be an image are refused.
 * The first part runs without a database; the last goes through storeAsset.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { crc32, deflateSync } from "node:zlib";
import { Pool } from "pg";
import sharp from "sharp";
import { reencodeImage, ImageRefused, MAX_SIDE } from "@/lib/storage/image";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import { storage } from "@/lib/storage";
import { storeAsset, AssetError } from "@/lib/data/assets";

/** 40 x 20: left half red, right half blue. */
function halves(): Buffer {
  const px = Buffer.alloc(40 * 20 * 3);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 40; x++) px.set(x < 20 ? [220, 20, 20] : [20, 20, 220], (y * 40 + x) * 3);
  return px;
}

/** A phone photo: stored sideways with "rotate 90 to view", a camera name and a GPS position. */
async function phonePhoto(): Promise<Buffer> {
  return sharp(halves(), { raw: { width: 40, height: 20, channels: 3 } })
    .jpeg({ quality: 95 })
    .withExif({
      IFD0: { Make: "TestCam", Model: "Pocket 9" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 0/1" },
    })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

const hasGpsPointer = (exif: Buffer) => exif.includes(Buffer.from([0x88, 0x25])) || exif.includes(Buffer.from([0x25, 0x88]));

/** A real PNG header that claims `w` x `h` pixels, with a few bytes of data: a decompression bomb's shape. */
function claimedPng(w: number, h: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 0, 0, 0, 0], 8); // 8-bit greyscale
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(1024))),
    chunk("IEND", Buffer.alloc(0)),
  ]));
}

describe("re-encoding an uploaded image", () => {
  it("removes the GPS position and every other piece of EXIF", async () => {
    const src = await phonePhoto();
    const before = await sharp(src).metadata();
    expect(before.exif && hasGpsPointer(before.exif)).toBe(true); // the fixture really carries GPS
    expect(before.orientation).toBe(6);
    expect(src.includes(Buffer.from("TestCam"))).toBe(true);

    const out = await reencodeImage(new Uint8Array(src), "image/jpeg");
    const after = await sharp(out.data).metadata();
    expect(out.mime).toBe("image/jpeg");
    expect(after.format).toBe("jpeg");
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    expect(Buffer.from(out.data).includes(Buffer.from("TestCam"))).toBe(false);
    expect(Buffer.from(out.data).includes(Buffer.from("Exif\0\0"))).toBe(false);
  });

  it("turns the picture the right way up before dropping the orientation flag", async () => {
    const out = await reencodeImage(new Uint8Array(await phonePhoto()), "image/jpeg");
    expect([out.width, out.height]).toEqual([20, 40]);
    // Orientation 6 means "rotate 90 degrees clockwise to view": the left (red) half ends up on top.
    const { data, info } = await sharp(out.data).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    expect(at(10, 3)[0]).toBeGreaterThan(150);
    expect(at(10, 3)[2]).toBeLessThan(100);
    expect(at(10, 36)[2]).toBeGreaterThan(150);
    expect(at(10, 36)[0]).toBeLessThan(100);
  });

  it("keeps the format, and alpha in a PNG", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
    const out = await reencodeImage(new Uint8Array(png), "image/png");
    const m = await sharp(out.data).metadata();
    expect([m.format, m.hasAlpha]).toEqual(["png", true]);
    const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } }).webp().toBuffer();
    expect((await sharp((await reencodeImage(new Uint8Array(webp), "image/webp")).data).metadata()).format).toBe("webp");
  });

  it(`scales anything over ${MAX_SIDE}px down to fit, keeping the shape`, async () => {
    const wide = await sharp({ create: { width: 3000, height: 600, channels: 3, background: "#fff" } }).png().toBuffer();
    const out = await reencodeImage(new Uint8Array(wide), "image/png", { maxSide: 1000 });
    expect([out.width, out.height]).toEqual([1000, 200]);
    const small = await reencodeImage(new Uint8Array(wide), "image/png");
    expect([small.width, small.height]).toEqual([3000, 600]); // never scaled up, and under the cap it is left alone
  });

  it("refuses a file that would decode to too many pixels, before decoding it", async () => {
    const bomb = claimedPng(100_000, 100_000); // ten billion pixels in about a kilobyte
    expect(bomb.byteLength).toBeLessThan(2048);
    const err = await reencodeImage(bomb, "image/png").catch((e) => e);
    expect(err).toBeInstanceOf(ImageRefused);
    expect(err.reason).toBe("too_large");
    expect(err.message).toMatch(/too big to process: over 50 megapixels/);
  });

  it("refuses bytes that start like an image but aren't one", async () => {
    const fake = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode("<script>alert(1)</script>")]);
    const err = await reencodeImage(fake, "image/png").catch((e) => e);
    expect(err).toBeInstanceOf(ImageRefused);
    expect(err.reason).toBe("unreadable");
    const truncated = (await phonePhoto()).subarray(0, 300);
    await expect(reencodeImage(new Uint8Array(truncated), "image/jpeg")).rejects.toThrow(/couldn't be read as an image/);
  });
});

describe("storeAsset stores the re-encoded file", () => {
  let ok = false;
  let tenant = "";
  const scope = () => ({ tenantId: tenant, projectId: null, userId: null, isPlatformAdmin: false });

  beforeAll(async () => {
    try {
      const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
      await p.query("SELECT 1");
      await p.end();
      ok = true;
    } catch {
      return;
    }
    tenant = (
      await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, (c) =>
        c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ('image-reencode-test') RETURNING id"),
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    if (!ok) return;
    const keys = (
      await withTenantSession(scope(), (c) => c.query<{ storage_key: string }>("SELECT storage_key FROM assets"))
    ).rows.map((r) => r.storage_key);
    await Promise.all(keys.map((k) => storage().delete(k)));
    await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, (c) => c.query("DELETE FROM tenants WHERE id = $1", [tenant]));
    await appPool().end();
  });

  it("keeps no GPS, and records the stored size", async () => {
    if (!ok) return expect(ok).toBe(false);
    await storeAsset(scope(), new Uint8Array(await phonePhoto()), "reference_image");
    const row = (
      await withTenantSession(scope(), (c) => c.query<{ storage_key: string; mime: string; bytes: number }>("SELECT storage_key, mime, bytes FROM assets"))
    ).rows[0];
    const stored = await storage().get(row.storage_key);
    expect(stored?.mime).toBe("image/jpeg");
    expect(Number(row.bytes)).toBe(stored!.data.byteLength);
    const m = await sharp(stored!.data).metadata();
    expect(m.exif).toBeUndefined();
    expect([m.width, m.height]).toEqual([20, 40]);
  });

  it("refuses a bomb, and non-image bytes with an image name, with a message for the person", async () => {
    if (!ok) return expect(ok).toBe(false);
    await expect(storeAsset(scope(), claimedPng(100_000, 100_000), "logo")).rejects.toThrow(AssetError);
    await expect(storeAsset(scope(), claimedPng(100_000, 100_000), "logo")).rejects.toThrow(/too big to process/);
    const html = new TextEncoder().encode("<html><body>not a picture</body></html>");
    await expect(storeAsset(scope(), html, "reference_image")).rejects.toThrow(/isn't one we can use/);
    const posing = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode("MZ this is an executable, named photo.jpg")]);
    await expect(storeAsset(scope(), posing, "reference_image")).rejects.toThrow(/couldn't be read as an image/);
    const count = (await withTenantSession(scope(), (c) => c.query<{ n: number }>("SELECT count(*)::int AS n FROM assets"))).rows[0].n;
    expect(count).toBe(1); // only the photo from the test above
  });
});
