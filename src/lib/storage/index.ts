/**
 * Object storage (brief §05, §07). Keys are ALWAYS tenant-prefixed and signed
 * URLs are scoped + short-lived (INV-1). Feature code uses `storage()` and
 * `tenantKey()`; it never builds a raw key or a public URL.
 *
 * Dev uses the local-disk driver; production sets STORAGE_DRIVER=s3 (./s3:
 * AWS S3, Supabase Storage or R2). Both serve reads through /api/storage.
 *
 * Server-only.
 */
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { localDriver } from "./local";
import { s3Driver } from "./s3";
import type { StorageDriver } from "./types";

/** Build a tenant-prefixed storage key. Never store an object without one. */
export function tenantKey(tenantId: string, ...parts: string[]): string {
  const safe = parts
    .join("/")
    .replace(/\.\.+/g, "")
    .replace(/^\/+/, "");
  return `tenants/${tenantId}/${safe}`;
}

/** Assert a key belongs to a tenant — defence in depth before serving. */
export function keyBelongsToTenant(key: string, tenantId: string): boolean {
  return key.startsWith(`tenants/${tenantId}/`);
}

export function signKey(key: string, expiresAtMs: number): string {
  const mac = createHmac("sha256", getEnv().AUTH_SECRET)
    .update(`${key}:${expiresAtMs}`)
    .digest("hex");
  return `${expiresAtMs}.${mac}`;
}

export function verifySignature(key: string, token: string): boolean {
  const [expStr, mac] = token.split(".");
  const exp = Number(expStr);
  if (!exp || Number.isNaN(exp) || Date.now() > exp) return false;
  const expected = Buffer.from(createHmac("sha256", getEnv().AUTH_SECRET)
    .update(`${key}:${exp}`)
    .digest("hex"));
  const given = Buffer.from(mac ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A short-lived link to read one object through /api/storage, whichever driver holds it. */
export function appSignedUrl(key: string, ttlSeconds?: number): string {
  const ttl = ttlSeconds ?? getEnv().STORAGE_SIGNED_URL_TTL_SECONDS;
  return `${getEnv().APP_URL}/api/storage/${encodeURI(key)}?token=${signKey(key, Date.now() + ttl * 1000)}`;
}

let _driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  if (_driver) return _driver;
  const env = getEnv();
  switch (env.STORAGE_DRIVER) {
    case "local":
      _driver = localDriver();
      break;
    case "s3":
      // configProblems (lib/env) has already refused to start without these.
      _driver = s3Driver(
        {
          bucket: env.STORAGE_S3_BUCKET!,
          region: env.STORAGE_S3_REGION!,
          accessKeyId: env.STORAGE_S3_ACCESS_KEY_ID!,
          secretAccessKey: env.STORAGE_S3_SECRET_ACCESS_KEY!,
          endpoint: env.STORAGE_S3_ENDPOINT || undefined,
        },
        appSignedUrl,
      );
      break;
  }
  return _driver!;
}

export type { StorageDriver } from "./types";
