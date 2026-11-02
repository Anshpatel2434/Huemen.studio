/**
 * Uploads that go straight to storage instead of through a request body.
 *
 * A server action takes 1 MB and a Vercel function 4.5 MB, so a 5 MB logo or
 * a 10 MB PDF can't travel in the request that processes it. Instead:
 *
 *   1. The browser asks for a target (POST /w/[id]/uploads): a tenant-prefixed
 *      key under incoming/, and a one-time address to PUT the bytes to, signed
 *      for that key and that exact size.
 *   2. It PUTs the file there: the bucket itself when STORAGE_DRIVER=s3 (a
 *      presigned URL; the bucket needs a CORS rule for the app's address), or
 *      the app's relay (PUT /api/storage/...) for local disk, or as a fallback
 *      when the bucket refuses the browser and the file is small enough.
 *   3. It hands the key to the step that uses the file, which calls
 *      takeIncoming(): the bytes are read back, removed from incoming/, and
 *      checked exactly as a direct upload would be.
 *
 * Server-only.
 */
import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { storage, tenantKey } from "./index";

/** What each kind of upload is for, and the most it may weigh. */
export const UPLOAD_LIMITS = {
  asset: 5 * 1024 * 1024,
  document: 10 * 1024 * 1024,
  audio: 12 * 1024 * 1024,
} as const;
export type UploadPurpose = keyof typeof UPLOAD_LIMITS;

/** Under Vercel's 4.5 MB body limit, with room for headers. */
export const RELAY_MAX_BYTES = 4 * 1024 * 1024;

const TTL_SECONDS = 10 * 60;

export function incomingKey(tenantId: string, name: string): string {
  const safe = name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(-60) || "file";
  return tenantKey(tenantId, "incoming", `${randomUUID()}-${safe}`);
}

export function isIncomingKey(key: string, tenantId: string): boolean {
  return key.startsWith(`tenants/${tenantId}/incoming/`) && !key.includes("..");
}

const mac = (key: string, size: number, exp: number) =>
  createHmac("sha256", getEnv().AUTH_SECRET).update(`put:${key}:${size}:${exp}`).digest("hex");

/** A write token for the relay: one key, one size, ten minutes. Not valid for reading. */
export function signPut(key: string, size: number): string {
  const exp = Date.now() + TTL_SECONDS * 1000;
  return `${exp}.${size}.${mac(key, size, exp)}`;
}

/** The size the token was signed for, or null when it isn't valid. */
export function verifyPut(key: string, token: string): number | null {
  const [expStr, sizeStr, given] = token.split(".");
  const exp = Number(expStr);
  const size = Number(sizeStr);
  if (!exp || !Number.isInteger(size) || size <= 0 || Date.now() > exp || !given) return null;
  const want = Buffer.from(mac(key, size, exp));
  const got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got) ? size : null;
}

export interface UploadTarget {
  key: string;
  /** Where the browser PUTs the bytes first. */
  url: string;
  /** The app's own relay, for files up to RELAY_MAX_BYTES when `url` can't be reached. Same as `url` on local disk. */
  relayUrl: string | null;
  headers: Record<string, string>;
}

export async function uploadTarget(tenantId: string, purpose: UploadPurpose, name: string, size: number, type: string): Promise<UploadTarget> {
  if (!Number.isInteger(size) || size <= 0) throw new UploadError("No file arrived. Try again.");
  if (size > UPLOAD_LIMITS[purpose]) throw new UploadError(`That file is over ${UPLOAD_LIMITS[purpose] / (1024 * 1024)} MB.`);
  const key = incomingKey(tenantId, name);
  const relay = `${getEnv().APP_URL}/api/storage/${encodeURI(key)}?put=${signPut(key, size)}`;
  const mime = /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : "application/octet-stream";
  const driver = storage();
  const direct = driver.presignPut ? await driver.presignPut(key, size, mime, TTL_SECONDS) : null;
  return {
    key,
    url: direct ?? relay,
    relayUrl: direct ? (size <= RELAY_MAX_BYTES ? relay : null) : relay,
    headers: { "Content-Type": mime },
  };
}

/**
 * The uploaded bytes, removed from incoming/ as they are read. Null when the
 * key isn't this workspace's or nothing is there (never uploaded, or used).
 */
export async function takeIncoming(tenantId: string, key: unknown, purpose: UploadPurpose): Promise<Uint8Array | null> {
  if (typeof key !== "string" || !isIncomingKey(key, tenantId)) return null;
  const obj = await storage().get(key);
  if (!obj) return null;
  await storage().delete(key);
  if (obj.data.byteLength > UPLOAD_LIMITS[purpose]) return null;
  return obj.data;
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}
