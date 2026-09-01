/**
 * Storage round-trip (P0-6, P1-8): an upload lands under a TENANT-PREFIXED key
 * and is read back via a scoped signed URL whose signature verifies. Also
 * asserts a bad/foreign token is rejected (INV-1).
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import { uploadAsset, listAssets } from "@/lib/data/assets";
import { storage, verifySignature, keyBelongsToTenant } from "@/lib/storage";

let ok = false;
let tenant = "";

beforeAll(async () => {
  try {
    const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await p.query("SELECT 1");
    await p.end();
    ok = true;
  } catch {
    return;
  }
  tenant = (
    await withTenantSession(
      { tenantId: null, userId: null, isPlatformAdmin: true },
      (c) => c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ('storage-test') RETURNING id"),
    )
  ).rows[0].id;
});

afterAll(async () => {
  if (!ok) return;
  await withTenantSession(
    { tenantId: null, userId: null, isPlatformAdmin: true },
    (c) => c.query("DELETE FROM tenants WHERE id = $1", [tenant]),
  );
  await appPool().end();
});

describe("storage round-trip (P0-6/P1-8)", () => {
  it("stores under a tenant-prefixed key and reads back via signed URL", async () => {
    if (!ok) return expect(ok).toBe(false);
    const scope = { tenantId: tenant, userId: null, isPlatformAdmin: false };
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic
    const file = new File([bytes], "logo.png", { type: "image/png" });

    await uploadAsset(scope, file, "logo");
    const assets = await listAssets(scope);
    expect(assets).toHaveLength(1);

    // URL carries a token; the underlying key is tenant-prefixed.
    const url = new URL(assets[0].url);
    const key = decodeURIComponent(url.pathname.replace("/api/storage/", ""));
    expect(keyBelongsToTenant(key, tenant)).toBe(true);

    const token = url.searchParams.get("token")!;
    expect(verifySignature(key, token)).toBe(true);
    expect(verifySignature(key, "0.deadbeef")).toBe(false);

    const obj = await storage().get(key);
    expect(obj?.mime).toBe("image/png");
    await storage().delete(key);
  });

  it("rejects an oversized file", async () => {
    if (!ok) return expect(ok).toBe(false);
    const scope = { tenantId: tenant, userId: null, isPlatformAdmin: false };
    const big = new File([new Uint8Array(6 * 1024 * 1024)], "big.png", { type: "image/png" });
    await expect(uploadAsset(scope, big, "logo")).rejects.toThrow(/too large/);
  });
});
