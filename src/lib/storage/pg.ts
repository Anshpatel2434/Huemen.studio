/**
 * Postgres storage driver (STORAGE_DRIVER=pg): files in the storage_objects
 * table (migration 0027). For a host that has the database and nothing else
 * yet; S3 or Supabase Storage is the better home once its keys exist.
 *
 * Every call runs in a tenant session for the workspace named in the key
 * (tenants/<id>/...), so RLS checks it like any other row (INV-1). Only the
 * cross-workspace listing that housekeeping does runs as platform admin, read
 * only. Reads are served through /api/storage with a signed, short-lived link.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession, type SessionScope } from "@/db/session";
import type { Listing, StorageDriver } from "./types";

const TENANT = /^tenants\/([0-9a-f-]{36})\//i;

function tenantOf(key: string): string {
  const m = TENANT.exec(key);
  if (!m) throw new Error("storage key is not tenant-prefixed");
  return m[1].toLowerCase();
}

const scopeFor = (tenantId: string): SessionScope => ({ tenantId, userId: null, isPlatformAdmin: false });
const ADMIN_READ: SessionScope = { tenantId: null, userId: null, isPlatformAdmin: true };

export function pgDriver(signedUrl: (key: string, ttlSeconds?: number) => string): StorageDriver {
  return {
    name: "pg",
    async put(key, data, mime) {
      const tenantId = tenantOf(key);
      await withTenantSession(scopeFor(tenantId), (c) =>
        c.query(
          `INSERT INTO storage_objects (key, tenant_id, mime, bytes, data) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (key) DO UPDATE SET mime = EXCLUDED.mime, bytes = EXCLUDED.bytes, data = EXCLUDED.data, modified_at = now()`,
          [key, tenantId, mime, data.byteLength, Buffer.from(data)],
        ),
      );
      return { key, bytes: data.byteLength };
    },
    async get(key) {
      const tenantId = tenantOf(key);
      const r = await withTenantSession(scopeFor(tenantId), (c) =>
        c.query<{ data: Buffer; mime: string }>("SELECT data, mime FROM storage_objects WHERE key = $1", [key]),
      );
      const row = r.rows[0];
      return row ? { data: new Uint8Array(row.data), mime: row.mime } : null;
    },
    async signedUrl(key, ttlSeconds) {
      tenantOf(key);
      return signedUrl(key, ttlSeconds);
    },
    async delete(key) {
      const tenantId = tenantOf(key);
      await withTenantSession(scopeFor(tenantId), (c) => c.query("DELETE FROM storage_objects WHERE key = $1", [key]));
    },
    async list(prefix, opts) {
      const m = TENANT.exec(prefix);
      const scope = m ? scopeFor(m[1].toLowerCase()) : ADMIN_READ;
      const r = await withTenantSession(scope, (c) =>
        c.query<{ key: string; modified_at: Date }>(
          // starts_with, not LIKE: a key may hold % or _ and nothing here needs escaping.
          "SELECT key, modified_at FROM storage_objects WHERE starts_with(key, $1) ORDER BY key",
          [prefix],
        ),
      );
      const out: Listing = { objects: [], prefixes: [] };
      const folders = new Set<string>();
      for (const row of r.rows) {
        const rest = row.key.slice(prefix.length);
        const slash = opts?.delimiter ? rest.indexOf("/") : -1;
        if (slash >= 0) folders.add(prefix + rest.slice(0, slash + 1));
        else out.objects.push({ key: row.key, modified: row.modified_at });
      }
      out.prefixes = [...folders];
      return out;
    },
  };
}
