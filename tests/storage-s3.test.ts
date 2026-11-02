/**
 * The S3 driver against a fake S3 server in this process: real HTTP, real
 * SigV4 headers, path-style addresses (as for Supabase Storage and R2), and
 * the AWS virtual-host address when no endpoint is set. No network, no keys.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { createHash, createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { s3Driver } from "@/lib/storage/s3";
import { parseEnv } from "@/lib/env";

const objects = new Map<string, { body: Buffer; type: string }>();
const seen: { method: string; path: string; auth: string }[] = [];
let server: Server;
let endpoint = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const auth = String(req.headers.authorization ?? "");
      seen.push({ method: req.method!, path: req.url!, auth });
      // A presigned PUT (query-string SigV4) is checked independently here, the
      // way S3 does: every signed header, Content-Length included, must match.
      if (req.url!.includes("X-Amz-Signature=")) {
        const ok = presignedValid(req.method!, req.url!, req.headers as Record<string, string>);
        if (!ok) { res.writeHead(403).end("<Error><Code>SignatureDoesNotMatch</Code></Error>"); return; }
        const key = decodeURIComponent(req.url!.split("?")[0]);
        objects.set(key, { body: Buffer.concat(chunks), type: String(req.headers["content-type"]) });
        res.writeHead(200).end();
        return;
      }
      // Every request must be SigV4-signed for this key, region and service.
      if (!/^AWS4-HMAC-SHA256 Credential=AKIATEST\/\d{8}\/ap-south-1\/s3\/aws4_request, SignedHeaders=[^,]+, Signature=[0-9a-f]{64}$/.test(auth) || !req.headers["x-amz-date"]) {
        res.writeHead(403).end("<Error><Code>SignatureDoesNotMatch</Code></Error>");
        return;
      }
      const key = decodeURIComponent(req.url!);
      if (req.method === "PUT") { objects.set(key, { body: Buffer.concat(chunks), type: String(req.headers["content-type"]) }); res.writeHead(200).end(); return; }
      if (req.method === "DELETE") { objects.delete(key); res.writeHead(204).end(); return; }
      const o = objects.get(key);
      if (!o) { res.writeHead(404).end("<Error><Code>NoSuchKey</Code></Error>"); return; }
      res.writeHead(200, { "Content-Type": o.type }).end(o.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/storage/v1/s3/`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** SigV4 query-string verification, written from the AWS spec rather than taken from aws4fetch. */
function presignedValid(method: string, url: string, headers: Record<string, string>): boolean {
  const [path, query] = url.split("?");
  const pairs = query.split("&").map((kv) => kv.split("=") as [string, string]);
  const q = Object.fromEntries(pairs.map(([k, v]) => [decodeURIComponent(k), decodeURIComponent(v)]));
  const canonicalQuery = pairs.filter(([k]) => k !== "X-Amz-Signature").sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("&");
  const signedHeaders = q["X-Amz-SignedHeaders"].split(";");
  const canonicalHeaders = signedHeaders.map((h) => `${h}:${String(headers[h] ?? "").trim()}\n`).join("");
  const canonical = [method, path, canonicalQuery, canonicalHeaders, signedHeaders.join(";"), "UNSIGNED-PAYLOAD"].join("\n");
  const [, date, region, service] = q["X-Amz-Credential"].split("/");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", q["X-Amz-Date"], scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  const hmac = (k: Buffer | string, d: string) => createHmac("sha256", k).update(d).digest();
  const key = hmac(hmac(hmac(hmac("AWS4secret", date), region), service), "aws4_request");
  return createHmac("sha256", key).update(toSign).digest("hex") === q["X-Amz-Signature"];
}

const cfg = () => ({ bucket: "huemen", region: "ap-south-1", accessKeyId: "AKIATEST", secretAccessKey: "secret", endpoint });
const signed = (key: string) => `https://app.example/api/storage/${key}?token=t`;

describe("S3 storage driver", () => {
  it("uploads, reads back with its type, and deletes, all signed, at path-style addresses", async () => {
    const d = s3Driver(cfg(), signed);
    const key = "tenants/t-1/assets/My Logo (final).png";
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    expect(await d.put(key, bytes, "image/png")).toEqual({ key, bytes: 7 });
    expect(seen.at(-1)).toMatchObject({ method: "PUT", path: "/storage/v1/s3/huemen/tenants/t-1/assets/My%20Logo%20(final).png" });

    const got = await d.get(key);
    expect(got?.mime).toBe("image/png");
    expect([...got!.data]).toEqual([...bytes]);

    await d.delete(key);
    expect(await d.get(key)).toBeNull();
  });

  it("serves reads through the app's own signed link, not a bucket URL", async () => {
    expect(await s3Driver(cfg(), signed).signedUrl("tenants/t-1/a.png")).toBe("https://app.example/api/storage/tenants/t-1/a.png?token=t");
  });

  it("reports a refused request instead of pretending it worked", async () => {
    const d = s3Driver({ ...cfg(), accessKeyId: "WRONGKEY" }, signed);
    await expect(d.put("tenants/t-1/x.txt", new Uint8Array([1]), "text/plain")).rejects.toThrow(/storage upload failed: 403/);
  });

  it("uses the AWS virtual-host address when no endpoint is set", async () => {
    let url = "";
    const d = s3Driver({ ...cfg(), endpoint: undefined }, signed, async (req) => { url = req.url; return new Response(null, { status: 404 }); });
    await d.get("tenants/t-1/a.png");
    expect(url).toBe("https://huemen.s3.ap-south-1.amazonaws.com/tenants/t-1/a.png");
  });
});

describe("S3 settings", () => {
  const BASE = { DATABASE_URL: "postgres://x", DATABASE_ADMIN_URL: "postgres://x", DATABASE_APP_PASSWORD: "x", AUTH_SECRET: "0123456789abcdef0123" };
  it("refuses STORAGE_DRIVER=s3 without the bucket and keys", () => {
    expect(() => parseEnv({ ...BASE, STORAGE_DRIVER: "s3", STORAGE_S3_BUCKET: "b" })).toThrow(/STORAGE_S3_REGION, STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY/);
  });

  it("presigns a browser upload for one key, one size and one type, which the bucket enforces", async () => {
    const d = s3Driver(cfg(), signed);
    const key = "tenants/t-1/incoming/abc-logo.png";
    const url = await d.presignPut!(key, 5, "image/png", 600);
    const u = new URL(url);
    expect(u.pathname).toBe("/storage/v1/s3/huemen/tenants/t-1/incoming/abc-logo.png");
    expect(u.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");

    const ok = await fetch(url, { method: "PUT", body: new Uint8Array([1, 2, 3, 4, 5]), headers: { "Content-Type": "image/png" } });
    expect(ok.status).toBe(200);
    expect([...(await d.get(key))!.data]).toEqual([1, 2, 3, 4, 5]);

    const bigger = await fetch(url, { method: "PUT", body: new Uint8Array(6), headers: { "Content-Type": "image/png" } });
    expect(bigger.status).toBe(403);
    const otherType = await fetch(url, { method: "PUT", body: new Uint8Array(5), headers: { "Content-Type": "text/html" } });
    expect(otherType.status).toBe(403);
  });
});
