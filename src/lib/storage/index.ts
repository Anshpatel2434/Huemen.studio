/**
 * Object storage (brief §05, §07). Keys are ALWAYS tenant-prefixed and signed
 * URLs are scoped + short-lived (INV-1). Feature code uses `storage()` and
 * `tenantKey()`; it never builds a raw key or a public URL.
 *
 * Dev uses the local-disk driver; production swaps to S3 via env.
 *
 * Server-only.
 */
import "server-only";
import { createHmac } from "node:crypto";
import { getEnv } from "@/lib/env";
import { localDriver } from "./local";
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
  const expected = createHmac("sha256", getEnv().AUTH_SECRET)
    .update(`${key}:${exp}`)
    .digest("hex");
  return expected === mac;
}

let _driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  if (_driver) return _driver;
  switch (getEnv().STORAGE_DRIVER) {
    case "local":
      _driver = localDriver();
      break;
    case "s3":
      throw new Error("S3 driver not wired yet — add src/lib/storage/s3.ts");
    default:
      _driver = localDriver();
  }
  return _driver;
}

export type { StorageDriver } from "./types";
