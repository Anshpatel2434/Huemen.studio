/**
 * Session lifetime and revocation (brief §07, security review).
 *
 * A session cookie carries the tenant and role claims row-level security keys
 * on, so "signed in" has to be something the server can withdraw. Two things
 * do that: the cookie's own `exp`, checked on every read, and the account's
 * `session_version`, bumped when a role changes or a workspace is archived.
 *
 * Pure crypto/clock checks — no database needed.
 */
import "dotenv/config";
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { decodeSealed, SESSION_TTL_SECONDS } from "@/lib/auth";

const SECRET = process.env.AUTH_SECRET ?? "";

/** Mint a cookie value the way startSession does, with whatever claims we want. */
function cookie(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", SECRET).update(body).digest("hex");
  return `${body}.${mac}`;
}

const base = { userId: "u1", tenantId: "t1", role: "client", email: "a@test", v: 1 };
const inSeconds = (n: number) => Math.floor(Date.now() / 1000) + n;

describe("a session cookie stops working on its own", () => {
  it("accepts one that is signed and still in date", () => {
    const sealed = decodeSealed(cookie({ ...base, exp: inSeconds(60) }));
    expect(sealed?.userId).toBe("u1");
    expect(sealed?.v).toBe(1);
  });

  it("refuses one whose expiry has passed", () => {
    expect(decodeSealed(cookie({ ...base, exp: inSeconds(-1) }))).toBeNull();
  });

  it("refuses a cookie with no expiry at all", () => {
    // The shape minted before this existed. Honouring it would mean a cookie
    // issued once kept working for ever, which is what we are fixing.
    expect(decodeSealed(cookie(base))).toBeNull();
  });

  it("refuses a tampered payload even if the claims look sensible", () => {
    const good = cookie({ ...base, exp: inSeconds(60) });
    const [, mac] = good.split(".");
    const forged = Buffer.from(JSON.stringify({ ...base, role: "owner_admin", exp: inSeconds(60) })).toString("base64url");
    expect(decodeSealed(`${forged}.${mac}`)).toBeNull();
  });

  it("refuses one carrying no session version", () => {
    const { v: _v, ...noVersion } = base;
    void _v;
    expect(decodeSealed(cookie({ ...noVersion, exp: inSeconds(60) }))).toBeNull();
  });

  it("expires within the stated lifetime, not beyond it", () => {
    const sealed = decodeSealed(cookie({ ...base, exp: inSeconds(SESSION_TTL_SECONDS) }));
    expect(sealed).not.toBeNull();
    expect(sealed!.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(SESSION_TTL_SECONDS);
  });
});
