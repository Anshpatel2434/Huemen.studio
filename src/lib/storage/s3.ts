/**
 * S3-compatible storage driver for production: AWS S3, Supabase Storage (its
 * S3 endpoint) or Cloudflare R2. Requests are signed with SigV4 (aws4fetch);
 * set STORAGE_S3_ENDPOINT for anything that isn't AWS, which switches to
 * path-style addresses (https://endpoint/bucket/key).
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
import type { StorageDriver } from "./types";

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Non-AWS services: e.g. https://<ref>.supabase.co/storage/v1/s3 or https://<account>.r2.cloudflarestorage.com */
  endpoint?: string;
}

type FetchLike = (input: Request) => Promise<Response>;

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
  };
}
