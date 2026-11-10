/**
 * S3-compatible storage driver for production: AWS S3, Supabase Storage (its
 * S3 endpoint) or Cloudflare R2. Requests are signed with SigV4 (aws4fetch);
 * set STORAGE_S3_ENDPOINT for anything that isn't AWS, which switches to
 * path-style addresses (https://endpoint/bucket/key).
 *
 * Large uploads go browser -> bucket on a presigned PUT (presignPut, see
 * ./upload), so the bucket needs a CORS rule allowing PUT from APP_URL.
 *
 * Reads are still served through the app's own signed route (/api/storage,
 * ../index appSignedUrl), not bucket URLs: one place for access checks and
 * safe headers, and images stay same-origin so the visual board can export
 * them to PNG.
 *
 * Server-only.
 */
import "server-only";
import { AwsClient } from "aws4fetch";
import type { Listing, StorageDriver } from "./types";

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Non-AWS services: e.g. https://<ref>.supabase.co/storage/v1/s3 or https://<account>.r2.cloudflarestorage.com */
  endpoint?: string;
}

type FetchLike = (input: Request) => Promise<Response>;

const MAX_LIST_PAGES = 200;

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** The text of the first <tag>, with XML escapes undone; null when absent. */
function xmlTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!m) return null;
  return m[1].replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) =>
    e[0] !== "#" ? (XML_ENTITIES[e] ?? all) : String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))),
  );
}

export function s3Driver(cfg: S3Config, appSignedUrl: (key: string, ttl?: number) => string, fetchImpl?: FetchLike): StorageDriver {
  const client = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: cfg.region, service: "s3" });
  const base = cfg.endpoint
    ? `${cfg.endpoint.replace(/\/+$/, "")}/${encodeURIComponent(cfg.bucket)}`
    : `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com`;
  const urlFor = (key: string) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const send = async (url: string, init: RequestInit) => {
    const signed = await client.sign(url, init);
    return fetchImpl ? fetchImpl(signed) : fetch(signed);
  };
  const fail = async (what: string, res: Response) => {
    throw new Error(`storage ${what} failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  };

  return {
    name: "s3",
    async put(key, data, mime) {
      const res = await send(urlFor(key), { method: "PUT", body: data as BodyInit, headers: { "Content-Type": mime } });
      if (!res.ok) await fail("upload", res);
      return { key, bytes: data.byteLength };
    },
    async get(key) {
      const res = await send(urlFor(key), { method: "GET" });
      if (res.status === 404) return null;
      if (!res.ok) await fail("read", res);
      return { data: new Uint8Array(await res.arrayBuffer()), mime: res.headers.get("content-type") ?? "application/octet-stream" };
    },
    async signedUrl(key, ttlSeconds) {
      return appSignedUrl(key, ttlSeconds);
    },
    async delete(key) {
      const res = await send(urlFor(key), { method: "DELETE" });
      if (!res.ok && res.status !== 404) await fail("delete", res);
    },
    async list(prefix, opts) {
      // ListObjectsV2: AWS S3, Supabase Storage and R2 all answer it. Paged
      // at 1,000 keys; MAX_LIST_PAGES bounds a runaway (or lying) server.
      const out: Listing = { objects: [], prefixes: [] };
      let token: string | null = null;
      for (let page = 0; page < MAX_LIST_PAGES; page++) {
        const q = new URLSearchParams({ "list-type": "2", prefix });
        if (opts?.delimiter) q.set("delimiter", opts.delimiter);
        if (token) q.set("continuation-token", token);
        const res = await send(`${cfg.endpoint ? base : `${base}/`}?${q}`, { method: "GET" });
        if (!res.ok) await fail("list", res);
        const xml = await res.text();
        for (const [, body] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const key = xmlTag(body, "Key");
          const modified = new Date(xmlTag(body, "LastModified") ?? "");
          if (key !== null && !Number.isNaN(modified.getTime())) out.objects.push({ key, modified });
        }
        for (const [, body] of xml.matchAll(/<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/g)) {
          const p = xmlTag(body, "Prefix");
          if (p !== null) out.prefixes.push(p);
        }
        token = /<IsTruncated>\s*true\s*<\/IsTruncated>/.test(xml) ? xmlTag(xml, "NextContinuationToken") : null;
        if (!token) return out;
      }
      throw new Error(`storage list failed: more than ${MAX_LIST_PAGES} pages under ${prefix}`);
    },
    async presignPut(key, bytes, mime, ttlSeconds) {
      // Length and type are signed in: the bucket refuses any other size, so
      // a link for a 2 MB logo can't be used to park 2 GB in the client's bucket.
      const signed = await client.sign(`${urlFor(key)}?X-Amz-Expires=${ttlSeconds}`, {
        method: "PUT",
        headers: { "Content-Length": String(bytes), "Content-Type": mime },
        aws: { signQuery: true, allHeaders: true },
      });
      return signed.url;
    },
  };
}
