/**
 * Local-disk storage driver for dev. Files live under STORAGE_LOCAL_DIR, keyed
 * by their tenant-prefixed storage key. Signed URLs point at /api/storage and
 * carry a short-lived HMAC token (see ../index signKey/verifySignature).
 *
 * Server-only.
 */
import "server-only";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { getEnv } from "@/lib/env";
import type { StorageDriver } from "./types";

function baseDir(): string {
  return resolve(process.cwd(), getEnv().STORAGE_LOCAL_DIR);
}

// Sidecar file stores the mime type alongside the object.
function pathsFor(key: string) {
  const root = baseDir();
  const full = join(root, key);
  if (!full.startsWith(root)) throw new Error("storage key escapes base dir");
  return { full, meta: `${full}.mime` };
}

export function localDriver(): StorageDriver {
  return {
    name: "local",
    async put(key, data, mime) {
      const { full, meta } = pathsFor(key);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, data);
      await writeFile(meta, mime, "utf8");
      return { key, bytes: data.byteLength };
    },
    async get(key) {
      const { full, meta } = pathsFor(key);
      try {
        const data = await readFile(full);
        const mime = await readFile(meta, "utf8").catch(() => "application/octet-stream");
        return { data: new Uint8Array(data), mime };
      } catch {
        return null;
      }
    },
    async signedUrl(key, ttlSeconds) {
      const { appSignedUrl } = await import("./index");
      return appSignedUrl(key, ttlSeconds);
    },
    async delete(key) {
      const { full, meta } = pathsFor(key);
      await unlink(full).catch(() => {});
      await unlink(meta).catch(() => {});
    },
  };
}
