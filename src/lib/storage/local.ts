/**
 * Local-disk storage driver for dev. Files live under STORAGE_LOCAL_DIR, keyed
 * by their tenant-prefixed storage key. Signed URLs point at /api/storage and
 * carry a short-lived HMAC token (see ../index signKey/verifySignature).
 *
 * Server-only.
 */
import "server-only";
import { mkdir, readFile, readdir, stat, writeFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { getEnv } from "@/lib/env";
import type { Listing, StorageDriver, StoredObject } from "./types";

// Sidecar file stores the mime type alongside the object.
const SIDECAR = ".mime";

/** `dir` overrides STORAGE_LOCAL_DIR (tests use a folder of their own). */
export function localDriver(dir?: string): StorageDriver {
  const baseDir = () => resolve(process.cwd(), dir ?? getEnv().STORAGE_LOCAL_DIR);

  function pathsFor(key: string) {
    const root = baseDir();
    const full = join(root, key);
    if (!full.startsWith(root)) throw new Error("storage key escapes base dir");
    return { full, meta: `${full}${SIDECAR}` };
  }

  /** Files and sub-folders directly in `folder` (a key prefix ending in "/"). */
  async function entries(folder: string) {
    const { full } = pathsFor(folder);
    const found = await readdir(full, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT" || e.code === "ENOTDIR") return [];
      throw e;
    });
    const names = new Set(found.filter((d) => d.isFile()).map((d) => d.name));
    const files: StoredObject[] = [];
    for (const d of found) {
      // "x.png.mime" next to "x.png" is the type, not an object of its own.
      if (!d.isFile() || (d.name.endsWith(SIDECAR) && names.has(d.name.slice(0, -SIDECAR.length)))) continue;
      const s = await stat(join(full, d.name)).catch(() => null);
      if (s) files.push({ key: `${folder}${d.name}`, modified: s.mtime });
    }
    return { files, folders: found.filter((d) => d.isDirectory()).map((d) => `${folder}${d.name}/`) };
  }

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
    async list(prefix, opts) {
      if (!prefix.endsWith("/") || prefix.split("/").includes("..")) {
        throw new Error("list takes a folder prefix ending in /");
      }
      const out: Listing = { objects: [], prefixes: [] };
      const queue = [prefix];
      while (queue.length) {
        const { files, folders } = await entries(queue.shift()!);
        out.objects.push(...files);
        if (opts?.delimiter) out.prefixes.push(...folders);
        else queue.push(...folders);
      }
      return out;
    },
  };
}
