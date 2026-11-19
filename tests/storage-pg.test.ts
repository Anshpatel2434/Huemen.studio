/**
 * The Postgres storage driver (STORAGE_DRIVER=pg, migration 0027): round trip,
 * listing, and the one thing that must hold: another workspace cannot read or
 * write a workspace's files, whatever key it names (RLS, INV-1).
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantSession } from "@/db/session";
import { pgDriver } from "@/lib/storage/pg";

const ADMIN = { tenantId: null, userId: null, isPlatformAdmin: true } as const;
const driver = pgDriver((key) => `/api/storage/${key}?token=test`);
let a = "", b = "";

beforeAll(async () => {
  const mk = (name: string) => withTenantSession(ADMIN, (c) => c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name])).then((r) => r.rows[0].id);
  a = await mk(`storage-test-a-${Date.now()}`);
  b = await mk(`storage-test-b-${Date.now()}`);
});

afterAll(async () => {
  await withTenantSession(ADMIN, (c) => c.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[a, b].filter(Boolean)]));
});

describe("pg storage driver", { timeout: 120_000 }, () => {
  it("stores, reads, lists and deletes a file", async () => {
    const key = `tenants/${a}/smoke/check_100%_file.bin`;
    const bytes = new Uint8Array(200_000).map((_, i) => i % 251);
    expect(await driver.put(key, bytes, "application/octet-stream")).toEqual({ key, bytes: bytes.length });
    const back = await driver.get(key);
    expect(back?.mime).toBe("application/octet-stream");
    expect(Buffer.from(back!.data).equals(Buffer.from(bytes))).toBe(true);

    await driver.put(`tenants/${a}/smoke/deeper/x.png`, new Uint8Array([1, 2, 3]), "image/png");
    const flat = await driver.list(`tenants/${a}/smoke/`);
    expect(flat.objects.map((o) => o.key).sort()).toEqual([key, `tenants/${a}/smoke/deeper/x.png`].sort());
    const top = await driver.list(`tenants/${a}/smoke/`, { delimiter: "/" });
    expect(top.objects.map((o) => o.key)).toEqual([key]);
    expect(top.prefixes).toEqual([`tenants/${a}/smoke/deeper/`]);
    expect((await driver.list("tenants/", { delimiter: "/" })).prefixes).toContain(`tenants/${a}/`);

    // Writing again replaces it.
    await driver.put(key, new Uint8Array([9]), "text/plain");
    expect((await driver.get(key))?.data.length).toBe(1);

    await driver.delete(key);
    expect(await driver.get(key)).toBeNull();
  });

  it("keeps one workspace's files from another (RLS)", async () => {
    const key = `tenants/${a}/private/secret.bin`;
    await driver.put(key, new Uint8Array([1, 2, 3]), "application/octet-stream");
    const asB = { tenantId: b, userId: null, isPlatformAdmin: false } as const;
    const seen = await withTenantSession(asB, (c) => c.query("SELECT 1 FROM storage_objects WHERE key = $1", [key]));
    expect(seen.rowCount).toBe(0);
    await expect(
      withTenantSession(asB, (c) => c.query("INSERT INTO storage_objects (key, tenant_id, mime, bytes, data) VALUES ($1, $2, 'x', 1, 'x')", [`${key}.forged`, a])),
    ).rejects.toThrow();
    const removed = await withTenantSession(asB, (c) => c.query("DELETE FROM storage_objects WHERE key = $1", [key]));
    expect(removed.rowCount).toBe(0);
    expect((await driver.get(key))?.data.length).toBe(3);
  });

  it("refuses a key with no workspace in it", async () => {
    await expect(driver.put("loose/file.bin", new Uint8Array([1]), "x")).rejects.toThrow();
    await expect(driver.get("tenants/not-a-uuid/file.bin")).rejects.toThrow();
  });
});
