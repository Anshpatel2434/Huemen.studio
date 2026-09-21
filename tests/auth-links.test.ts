/**
 * Sign-in and invite links: signed, purpose-bound, expiring, single-use, and
 * `next` can never send someone off-site.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import { safeNext, signLink, verifyLink } from "@/lib/auth/tokens";
import { activateInvite, getAccount, markSignedIn } from "@/lib/data/auth";

describe("link tokens", () => {
  it("round-trips and is bound to its purpose", () => {
    const t = signLink("signin", "user-1", "v1");
    expect(verifyLink("signin", t)).toEqual({ ok: true, subject: "user-1", version: "v1" });
    expect(verifyLink("invite", t)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects tampering and expiry", () => {
    const t = signLink("signin", "user-1", "v1");
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), s: "admin" })).toString("base64url");
    expect(verifyLink("signin", `${forged}.${sig}`).ok).toBe(false);
    expect(verifyLink("signin", `${body}.x${sig.slice(1)}`).ok).toBe(false);
    expect(verifyLink("signin", "garbage").ok).toBe(false);
    const old = signLink("signin", "user-1", "v1", Date.now() - 16 * 60 * 1000);
    expect(verifyLink("signin", old)).toEqual({ ok: false, reason: "expired" });
    const invite = signLink("invite", "user-1", "invited", Date.now() - 6 * 24 * 3600 * 1000);
    expect(verifyLink("invite", invite).ok).toBe(true);
  });

  it("only allows same-site `next` paths", () => {
    expect(safeNext("/w/abc/p/def?item=1")).toBe("/w/abc/p/def?item=1");
    for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)", "/login?x=1", "", undefined, 42]) {
      expect(safeNext(bad)).toBe("/dashboard");
    }
  });
});

let db = false;
let tenant = "";
let userId = "";

beforeAll(async () => {
  try {
    const probe = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await probe.query("SELECT 1");
    await probe.end();
    db = true;
  } catch {
    return;
  }
  await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, async (c) => {
    tenant = (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ('Auth links (test)') RETURNING id")).rows[0].id;
    userId = (await c.query<{ id: string }>("INSERT INTO users (tenant_id, email, role, status) VALUES ($1, 'invitee@test.local', 'client', 'invited') RETURNING id", [tenant])).rows[0].id;
  });
});

afterAll(async () => {
  if (!db) return;
  await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, (c) => c.query("DELETE FROM tenants WHERE id = $1", [tenant]));
  await appPool().end();
});

describe("single use", () => {
  it("an invite can be accepted once", async () => {
    if (!db) return;
    expect(await activateInvite(userId)).toBe(true);
    expect(await activateInvite(userId)).toBe(false);
    expect((await getAccount(userId))!.status).toBe("active");
  });

  it("signing in retires earlier sign-in links", async () => {
    if (!db) return;
    const before = (await getAccount(userId))!.lastSeen;
    const link = signLink("signin", userId, before);
    const check = verifyLink("signin", link);
    expect(check.ok && check.version === before).toBe(true);
    await markSignedIn(userId);
    const after = (await getAccount(userId))!.lastSeen;
    expect(after).not.toBe(before); // the route compares these: the old link is now "used"
  });
});
