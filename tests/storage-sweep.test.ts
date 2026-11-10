/**
 * Abandoned uploads are swept (lib/storage/sweep): a file sent to a
 * workspace's incoming/ folder and never taken is removed once it is a day
 * old; anything newer, anything outside incoming/, and anything outside a
 * workspace folder is left alone. Run against the local disk driver (its own
 * folder, and the configured one through sweepAbandonedUploads) and the S3
 * driver against a fake S3 server that answers ListObjectsV2 in pages.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { localDriver } from "@/lib/storage/local";
import { s3Driver } from "@/lib/storage/s3";
import { sweepAbandonedUploads, sweepIncoming, ABANDONED_AFTER_MS } from "@/lib/storage/sweep";
import { storage } from "@/lib/storage";
import { incomingKey } from "@/lib/storage/upload";
import { getEnv } from "@/lib/env";
import type { StorageDriver } from "@/lib/storage/types";

const A = randomUUID();
const B = randomUUID();
const NOW = new Date("2026-11-11T12:00:00Z");
const OLD = new Date(NOW.getTime() - ABANDONED_AFTER_MS - 60_000);
const FRESH = new Date(NOW.getTime() - ABANDONED_AFTER_MS + 60 * 60_000);
const bytes = new Uint8Array([1, 2, 3]);

/** Every object a driver holds, by key. */
async function keys(d: StorageDriver): Promise<string[]> {
  return (await d.list("tenants/")).objects.map((o) => o.key).sort();
}

describe("sweep on local disk", () => {
  let dir = "";
  let d: StorageDriver;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "huemen-sweep-"));
    d = localDriver(dir);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  async function put(key: string, at: Date) {
    await d.put(key, bytes, "application/octet-stream");
    await utimes(join(dir, key), at, at);
  }

  it("lists folders one level down with a delimiter, everything below without, and never the type sidecars", async () => {
    await put(`tenants/${A}/incoming/x-logo.png`, FRESH);
    await put(`tenants/${A}/incoming/y-notes.mime`, FRESH); // a file really named .mime is still an object
    await put(`tenants/${A}/assets/kept.png`, FRESH);
    const top = await d.list("tenants/", { delimiter: "/" });
    expect(top.objects).toEqual([]);
    expect(top.prefixes).toEqual([`tenants/${A}/`]);
    const all = await d.list(`tenants/${A}/`);
    expect(all.objects.map((o) => o.key).sort()).toEqual([`tenants/${A}/assets/kept.png`, `tenants/${A}/incoming/x-logo.png`, `tenants/${A}/incoming/y-notes.mime`]);
    expect(all.objects.every((o) => o.modified instanceof Date)).toBe(true);
    expect((await d.list("tenants/nothing-here/")).objects).toEqual([]);
    await expect(d.list("tenants")).rejects.toThrow(/folder prefix/);
    await expect(d.list("tenants/../")).rejects.toThrow(/folder prefix/);
  });

  it("removes incoming files older than a day, and nothing else", async () => {
    await put(`tenants/${A}/incoming/old-1.png`, OLD);
    await put(`tenants/${A}/incoming/old-2.pdf`, OLD);
    await put(`tenants/${B}/incoming/old-3.webm`, OLD);
    await put(`tenants/${B}/incoming/fresh.png`, FRESH);
    await put(`tenants/${B}/assets/old-asset.png`, OLD); // used: lives in assets/, not incoming/
    await put("tenants/not-a-workspace/incoming/old.png", OLD);
    await put("elsewhere/incoming/old.png", OLD);

    expect(await sweepIncoming(d, NOW)).toEqual({ removed: 3 });
    expect(await keys(d)).toEqual([
      `tenants/${A}/assets/kept.png`,
      `tenants/${A}/incoming/x-logo.png`,
      `tenants/${A}/incoming/y-notes.mime`,
      `tenants/${B}/assets/old-asset.png`,
      `tenants/${B}/incoming/fresh.png`,
      "tenants/not-a-workspace/incoming/old.png",
    ].sort((x, y) => (x < y ? -1 : 1)));
    expect(await d.get(`tenants/${A}/incoming/old-1.png`)).toBeNull();

    // Run again: nothing left to do. A day later the fresh ones go too.
    expect(await sweepIncoming(d, NOW)).toEqual({ removed: 0 });
    expect(await sweepIncoming(d, new Date(NOW.getTime() + 2 * ABANDONED_AFTER_MS))).toEqual({ removed: 3 });
  });

  it("is a no-op when nothing was ever stored", async () => {
    const empty = await mkdtemp(join(tmpdir(), "huemen-sweep-empty-"));
    try {
      expect(await sweepIncoming(localDriver(empty), NOW)).toEqual({ removed: 0 });
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe("sweepAbandonedUploads (the configured storage)", () => {
  it("removes an abandoned upload and keeps one in progress", async () => {
    if (getEnv().STORAGE_DRIVER !== "local") return;
    const T = randomUUID();
    const abandoned = incomingKey(T, "never-used.png");
    const inProgress = incomingKey(T, "being-used.png");
    await storage().put(abandoned, bytes, "application/octet-stream");
    await storage().put(inProgress, bytes, "application/octet-stream");
    const twoDaysAgo = new Date(Date.now() - 2 * ABANDONED_AFTER_MS);
    await utimes(resolve(process.cwd(), getEnv().STORAGE_LOCAL_DIR, abandoned), twoDaysAgo, twoDaysAgo);

    const { removed } = await sweepAbandonedUploads();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await storage().get(abandoned)).toBeNull();
    expect(await storage().get(inProgress)).not.toBeNull();
    await storage().delete(inProgress);
  });
});

describe("sweep on S3", () => {
  // A fake S3 bucket: path-style addresses, SigV4-signed requests required,
  // ListObjectsV2 with prefix, delimiter and continuation tokens, two keys a page.
  const objects = new Map<string, { body: Buffer; modified: Date }>();
  const seen: string[] = [];
  let server: Server;
  let endpoint = "";
  const PAGE = 2;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function listXml(prefix: string, delimiter: string | null, token: string | null): string {
    const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    const contents: string[] = [];
    const common = new Set<string>();
    for (const k of all) {
      const rest = k.slice(prefix.length);
      if (delimiter && rest.includes(delimiter)) common.add(prefix + rest.slice(0, rest.indexOf(delimiter) + 1));
      else contents.push(k);
    }
    const entries = [...contents.map((k) => ({ k, kind: "c" as const })), ...[...common].map((k) => ({ k, kind: "p" as const }))].sort((x, y) => (x.k < y.k ? -1 : 1));
    const start = token ? Number(token) : 0;
    const page = entries.slice(start, start + PAGE);
    const more = start + PAGE < entries.length;
    return `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>huemen</Name><Prefix>${esc(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${PAGE}</MaxKeys><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + PAGE}</NextContinuationToken>` : ""}
${page.map((e) => e.kind === "c"
    ? `<Contents><Key>${esc(e.k)}</Key><LastModified>${objects.get(e.k)!.modified.toISOString()}</LastModified><ETag>&quot;x&quot;</ETag><Size>3</Size><StorageClass>STANDARD</StorageClass></Contents>`
    : `<CommonPrefixes><Prefix>${esc(e.k)}</Prefix></CommonPrefixes>`).join("\n")}
</ListBucketResult>`;
  }

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const auth = String(req.headers.authorization ?? "");
        if (!/^AWS4-HMAC-SHA256 Credential=AKIATEST\/\d{8}\/ap-south-1\/s3\/aws4_request, /.test(auth)) {
          res.writeHead(403).end("<Error><Code>SignatureDoesNotMatch</Code></Error>");
          return;
        }
        const url = new URL(req.url!, "http://x");
        seen.push(`${req.method} ${url.pathname}${url.search}`);
        const bucketPath = "/storage/v1/s3/huemen";
        if (req.method === "GET" && url.pathname === bucketPath && url.searchParams.get("list-type") === "2") {
          res.writeHead(200, { "Content-Type": "application/xml" }).end(listXml(url.searchParams.get("prefix") ?? "", url.searchParams.get("delimiter"), url.searchParams.get("continuation-token")));
          return;
        }
        const key = decodeURIComponent(url.pathname.slice(bucketPath.length + 1));
        if (req.method === "PUT") { objects.set(key, { body: Buffer.concat(chunks), modified: new Date() }); res.writeHead(200).end(); return; }
        if (req.method === "DELETE") { objects.delete(key); res.writeHead(204).end(); return; }
        const o = objects.get(key);
        if (!o) { res.writeHead(404).end(); return; }
        res.writeHead(200).end(o.body);
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/storage/v1/s3`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const driver = () => s3Driver({ bucket: "huemen", region: "ap-south-1", accessKeyId: "AKIATEST", secretAccessKey: "secret", endpoint }, (k) => `https://app.example/api/storage/${k}`);
  const plant = (key: string, modified: Date) => objects.set(key, { body: Buffer.from(bytes), modified });

  it("lists every page, with folders under a delimiter and XML escapes undone", async () => {
    objects.clear();
    plant(`tenants/${A}/incoming/1-a&b.png`, OLD);
    plant(`tenants/${A}/incoming/2.png`, OLD);
    plant(`tenants/${A}/incoming/3.png`, FRESH);
    plant(`tenants/${B}/assets/x.png`, OLD);
    plant(`tenants/${randomUUID()}/assets/y.png`, OLD);
    const top = await driver().list("tenants/", { delimiter: "/" });
    expect(top.objects).toEqual([]);
    expect(top.prefixes).toHaveLength(3); // two pages of two and one
    const inA = await driver().list(`tenants/${A}/incoming/`);
    expect(inA.objects.map((o) => o.key)).toEqual([`tenants/${A}/incoming/1-a&b.png`, `tenants/${A}/incoming/2.png`, `tenants/${A}/incoming/3.png`]);
    expect(inA.objects[0].modified.toISOString()).toBe(OLD.toISOString());
    expect(seen.some((s) => s.includes("continuation-token=2"))).toBe(true);
  });

  it("removes incoming files older than a day, and nothing else", async () => {
    objects.clear();
    plant(`tenants/${A}/incoming/old-1.png`, OLD);
    plant(`tenants/${A}/incoming/old 2 & more.pdf`, OLD);
    plant(`tenants/${A}/incoming/fresh.png`, FRESH);
    plant(`tenants/${A}/assets/old-asset.png`, OLD);
    plant(`tenants/${B}/incoming/old-3.png`, OLD);
    plant(`tenants/${B}/brand/incoming/old.png`, OLD); // not the workspace's incoming/ folder
    plant("tenants/not-a-workspace/incoming/old.png", OLD);

    expect(await sweepIncoming(driver(), NOW)).toEqual({ removed: 3 });
    expect([...objects.keys()].sort()).toEqual([
      `tenants/${A}/assets/old-asset.png`,
      `tenants/${A}/incoming/fresh.png`,
      `tenants/${B}/brand/incoming/old.png`,
      "tenants/not-a-workspace/incoming/old.png",
    ].sort());
  });

  it("reports a refused listing instead of pretending the bucket is empty", async () => {
    const bad = s3Driver({ bucket: "huemen", region: "ap-south-1", accessKeyId: "WRONGKEY", secretAccessKey: "secret", endpoint }, (k) => k);
    await expect(sweepIncoming(bad, NOW)).rejects.toThrow(/storage list failed: 403/);
  });
});
