/**
 * Connections (migration 0013): Gmail, Google Docs, Google Calendar, LinkedIn.
 *
 * Every network call is a fake: what's tested is what we send, what we keep,
 * and what we refuse. The DB half runs against the real database, like the
 * isolation suite, and skips if none is reachable.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";

// Set before anything reads the environment.
process.env.CONNECTIONS_KEY = randomBytes(32).toString("base64");
process.env.GOOGLE_CLIENT_ID = "test-google-client";
process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";

import { open, seal } from "@/lib/integrations/crypto";
import { decodeState, encodeState, pkcePair } from "@/lib/integrations/state";
import { authorizeUrl, hasCapability, redirectUri, scopesFor, CAPABILITIES } from "@/lib/integrations/providers";
import { ConnectionError, exchangeCode, refresh, whoami, type FetchLike } from "@/lib/integrations/oauth";
import { importPickedFiles, importSentMail, messageText, upcomingEvents } from "@/lib/integrations/google";
import { importPosts, LINKEDIN_VERSION } from "@/lib/integrations/linkedin";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import type { WorkspaceScope } from "@/lib/data/projects";

const KEY = process.env.CONNECTIONS_KEY;
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

/** A fake fetch that answers by URL prefix and remembers every request. */
function fake(routes: [string, (url: string, init?: RequestInit) => Response][]) {
  const seen: { url: string; init?: RequestInit }[] = [];
  const f: FetchLike = async (url, init) => {
    seen.push({ url, init });
    const hit = routes.find(([prefix]) => url.startsWith(prefix));
    if (!hit) throw new Error(`unexpected request ${url}`);
    return hit[1](url, init);
  };
  return { f, seen };
}

describe("tokens are sealed at rest", () => {
  it("round-trips, and a different IV every time", () => {
    const a = seal("ya29.secret", KEY);
    expect(a).not.toContain("ya29");
    expect(a).not.toBe(seal("ya29.secret", KEY));
    expect(open(a, KEY)).toBe("ya29.secret");
  });

  it("refuses a tampered value, a wrong key, or no key", () => {
    const a = seal("token", KEY);
    const parts = a.split(".");
    parts[3] = b64("forged");
    expect(() => open(parts.join("."), KEY)).toThrow();
    expect(() => open(a, randomBytes(32).toString("base64"))).toThrow();
    expect(() => seal("x", undefined)).toThrow(/CONNECTIONS_KEY/);
    expect(() => seal("x", Buffer.from("short").toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("the OAuth state", () => {
  const s = { t: "tenant", u: "user", p: "google" as const, c: "gmail" as const, n: "nonce-1" };

  it("comes back only with its signature, before expiry, in the browser that started it", () => {
    const tok = encodeState(s, "secret", 1_000);
    expect(decodeState(tok, "secret", "nonce-1", 2_000)).toMatchObject(s);
    expect(decodeState(tok, "other-secret", "nonce-1", 2_000)).toBeNull();
    expect(decodeState(tok, "secret", "nonce-2", 2_000)).toBeNull();
    expect(decodeState(tok, "secret", undefined, 2_000)).toBeNull();
    expect(decodeState(tok, "secret", "nonce-1", 1_000 + 11 * 60_000)).toBeNull();
    const [body, sig] = tok.split(".");
    const forged = b64(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), t: "someone-else" }));
    expect(decodeState(`${forged}.${sig}`, "secret", "nonce-1", 2_000)).toBeNull();
  });

  it("uses a PKCE challenge that is the hash of the verifier", () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).not.toBe(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("asking for exactly what is needed", () => {
  it("asks for identity plus the one capability, and keeps what was granted", () => {
    expect(scopesFor("google", "docs")).toEqual(["openid", "email", "profile", "https://www.googleapis.com/auth/drive.file"]);
    const withMail = scopesFor("google", "gmail", ["https://www.googleapis.com/auth/drive.file"]);
    expect(withMail).toContain("https://www.googleapis.com/auth/drive.file");
    expect(withMail).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(scopesFor("google", "docs")).not.toContain("https://www.googleapis.com/auth/gmail.readonly");
  });

  it("never asks for full Drive, and Docs needs no restricted scope", () => {
    const all = Object.values(CAPABILITIES).flatMap((c) => c.scopes);
    expect(all).not.toContain("https://www.googleapis.com/auth/drive.readonly");
    expect(all).not.toContain("https://www.googleapis.com/auth/drive");
    expect(CAPABILITIES.docs.review).toBe("none");
  });

  it("knows a capability is on only when all its scopes were granted", () => {
    expect(hasCapability("gmail", ["openid"])).toBe(false);
    expect(hasCapability("gmail", ["https://www.googleapis.com/auth/gmail.readonly"])).toBe(true);
  });

  it("builds Google's URL with offline access, incremental consent and PKCE", () => {
    const u = new URL(authorizeUrl("google", {
      clientId: "cid", redirectUri: redirectUri("http://localhost:3120/", "google"), scopes: ["openid", "email"], state: "st", codeChallenge: "ch",
    }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:3120/connections/callback/google");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("include_granted_scopes")).toBe("true");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toBe("openid email");
  });
});

describe("OAuth calls", () => {
  const client = { clientId: "cid", clientSecret: "secret" };

  it("swaps a code for tokens, sending the PKCE verifier", async () => {
    const { f, seen } = fake([["https://oauth2.googleapis.com/token", () => json({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "openid email" })]]);
    const t = await exchangeCode("google", client, { code: "c", redirectUri: "r", codeVerifier: "v", requestedScopes: [] }, f, 0);
    expect(t).toEqual({ accessToken: "at", refreshToken: "rt", expiresAt: new Date(3_600_000).toISOString(), scopes: ["openid", "email"] });
    expect(String(seen[0].init?.body)).toContain("code_verifier=v");
  });

  it("keeps the refresh token when a refresh doesn't send a new one", async () => {
    const { f } = fake([["https://oauth2.googleapis.com/token", () => json({ access_token: "at2", expires_in: 3600 })]]);
    const t = await refresh("google", client, { refreshToken: "rt", scopes: ["a"] }, f, 0);
    expect(t.refreshToken).toBe("rt");
    expect(t.scopes).toEqual(["a"]);
  });

  it("reads LinkedIn's comma-separated scopes", async () => {
    const { f } = fake([["https://www.linkedin.com/oauth/v2/accessToken", () => json({ access_token: "at", expires_in: 5184000, scope: "email,openid,profile" })]]);
    const t = await exchangeCode("linkedin", client, { code: "c", redirectUri: "r", requestedScopes: [] }, f, 0);
    expect(t.scopes).toEqual(["email", "openid", "profile"]);
  });

  it("turns provider failures into kinds the page can speak about", async () => {
    const fail = (status: number, body = "") => fake([["https://", () => new Response(body, { status })]]).f;
    await expect(refresh("google", client, { refreshToken: "r", scopes: [] }, fail(400, '{"error":"invalid_grant"}'))).rejects.toMatchObject({ kind: "revoked" });
    await expect(whoami("google", "t", fail(401))).rejects.toMatchObject({ kind: "auth" });
    await expect(whoami("google", "t", fail(429))).rejects.toMatchObject({ kind: "rate_limit" });
    await expect(whoami("google", "t", fail(503))).rejects.toBeInstanceOf(ConnectionError);
  });
});

describe("Gmail: only what they wrote, in Sent", () => {
  it("keeps the body they wrote: plain text first, HTML as text, quotes gone", () => {
    const multipart = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64("Hi Sam,\n\nHere is the plan for Tuesday.\n\nOn Mon, Sam wrote:\n> old text") } },
        { mimeType: "text/html", body: { data: b64("<p>ignored</p>") } },
      ],
    };
    const text = messageText(multipart);
    expect(text).toContain("Here is the plan for Tuesday.");
    expect(text).not.toContain("old text");
    expect(messageText({ mimeType: "text/html", body: { data: b64("<p>One.</p><blockquote>quoted</blockquote><p>Two &amp; three.</p>") } }))
      .toBe("One.\n\nTwo & three.");
  });

  it("searches Sent only, pages through, and drops one-liners", async () => {
    const long = "This is a properly written email about delegation and why handing over a decision early saves time later, and what I would do differently next time.";
    const { f, seen } = fake([
      ["https://gmail.googleapis.com/gmail/v1/users/me/messages?", (url) =>
        new URL(url).searchParams.get("pageToken")
          ? json({ messages: [{ id: "m3" }] })
          : json({ messages: [{ id: "m1" }, { id: "m2" }], nextPageToken: "p2" })],
      ["https://gmail.googleapis.com/gmail/v1/users/me/messages/m1", () => json({ id: "m1", internalDate: "1700000000000", payload: { mimeType: "text/plain", body: { data: b64(long) } } })],
      ["https://gmail.googleapis.com/gmail/v1/users/me/messages/m2", () => json({ id: "m2", payload: { mimeType: "text/plain", body: { data: b64("Thanks!") } } })],
      ["https://gmail.googleapis.com/gmail/v1/users/me/messages/m3", () => json({ id: "m3", payload: { mimeType: "text/plain", body: { data: b64(long + " Again.") } } })],
    ]);
    const { pieces, scanned } = await importSentMail("tok", { max: 50 }, f);
    expect(scanned).toBe(3);
    expect(pieces.map((p) => p.externalId)).toEqual(["gmail:m1", "gmail:m3"]);
    expect(pieces.every((p) => p.visibility === "private" && p.channel === "email")).toBe(true);
    expect(new URL(seen[0].url).searchParams.get("q")).toMatch(/^in:sent /);
    expect((seen[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
});

describe("Docs: only picked files, exported as text", () => {
  it("imports Docs and Slides, skips anything else, and caps very long documents", async () => {
    const huge = Array.from({ length: 4000 }, (_, i) => `w${i}`).join(" ");
    const { f } = fake([
      ["https://www.googleapis.com/drive/v3/files/d1/export", () => new Response("My essay.\r\n\r\n\r\nSecond paragraph.")],
      ["https://www.googleapis.com/drive/v3/files/d1?", () => json({ id: "d1", name: "Essay", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-09-01T00:00:00Z" })],
      ["https://www.googleapis.com/drive/v3/files/s1/export", () => new Response(huge)],
      ["https://www.googleapis.com/drive/v3/files/s1?", () => json({ id: "s1", name: "Deck", mimeType: "application/vnd.google-apps.presentation" })],
      ["https://www.googleapis.com/drive/v3/files/p1?", () => json({ id: "p1", name: "Photo.jpg", mimeType: "image/jpeg" })],
    ]);
    const { pieces, skipped } = await importPickedFiles("tok", [
      { id: "d1", channel: "newsletter", published: true },
      { id: "s1", channel: "spoken", published: false },
      { id: "p1", channel: "newsletter", published: true },
    ], f);
    expect(skipped).toEqual(["Photo.jpg"]);
    expect(pieces[0]).toMatchObject({ externalId: "drive:d1", body: "My essay.\n\nSecond paragraph.", visibility: "public", title: "Essay" });
    expect(pieces[1].visibility).toBe("private");
    expect(pieces[1].body.split(/\s+/).length).toBe(3000);
  });
});

describe("Calendar: ideas, never attendees", () => {
  it("asks only for what an idea needs and leaves out non-events", async () => {
    const { f, seen } = fake([["https://www.googleapis.com/calendar/v3/calendars/primary/events", () => json({ items: [
      { id: "e1", summary: "Keynote: Leading new managers", start: { dateTime: "2026-10-20T10:00:00Z" }, description: "<b>Main stage</b>" },
      { id: "e2", summary: "Focus", eventType: "focusTime", start: { dateTime: "2026-10-21T10:00:00Z" } },
      { id: "e3", summary: "Cancelled thing", status: "cancelled", start: { date: "2026-10-22" } },
      { id: "e4", start: { date: "2026-10-23" } },
    ] })]]);
    const events = await upcomingEvents("tok", Date.parse("2026-10-01T00:00:00Z"), f);
    expect(events).toEqual([{ id: "e1", title: "Keynote: Leading new managers", date: "2026-10-20", description: "Main stage" }]);
    const fields = new URL(seen[0].url).searchParams.get("fields") ?? "";
    expect(fields).not.toMatch(/attendee|organizer|creator/);
  });
});

describe("LinkedIn posts (partner-only)", () => {
  it("reads their own posts with the versioned API, skipping reshares and drafts", async () => {
    const { f, seen } = fake([["https://api.linkedin.com/rest/posts", () => json({ elements: [
      { id: "urn:li:share:1", commentary: "Delegation is a skill.", publishedAt: 1700000000000 },
      { id: "urn:li:share:2", commentary: "", reshareContext: {} },
      { id: "urn:li:share:3", commentary: "Draft", lifecycleState: "DRAFT" },
    ] })]]);
    const pieces = await importPosts("tok", "abc123", {}, f);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ externalId: "linkedin:urn:li:share:1", channel: "linkedin", visibility: "public" });
    expect(seen[0].url).toContain(encodeURIComponent("urn:li:person:abc123"));
    expect((seen[0].init?.headers as Record<string, string>)["LinkedIn-Version"]).toBe(LINKEDIN_VERSION);
  });
});

// ---- against the database ------------------------------------------------------

let dbReachable = false;
let A: WorkspaceScope;
let B: WorkspaceScope;
let A2: WorkspaceScope;

async function tenant(name: string) {
  return withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, async (c) => {
    const t = (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name])).rows[0].id;
    const u1 = (await c.query<{ id: string }>("INSERT INTO users (tenant_id, email, role, status) VALUES ($1,$2,'client','active') RETURNING id", [t, `${name.replace(/\W+/g, "-").toLowerCase()}@test.local`])).rows[0].id;
    const u2 = (await c.query<{ id: string }>("INSERT INTO users (tenant_id, email, role, status) VALUES ($1,$2,'coach','active') RETURNING id", [t, `coach-${name.replace(/\W+/g, "-").toLowerCase()}@test.local`])).rows[0].id;
    return { t, u1, u2 };
  });
}

beforeAll(async () => {
  try {
    const probe = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await probe.query("SELECT 1");
    await probe.end();
    dbReachable = true;
  } catch {
    return;
  }
  const a = await tenant("Connections A test");
  const b = await tenant("Connections B test");
  A = { tenantId: a.t, userId: a.u1, isPlatformAdmin: false };
  A2 = { tenantId: a.t, userId: a.u2, isPlatformAdmin: false };
  B = { tenantId: b.t, userId: b.u1, isPlatformAdmin: false };
});

afterAll(async () => {
  if (!dbReachable) return;
  await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, (c) =>
    c.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[A.tenantId, B.tenantId]]),
  );
  await appPool().end();
});

describe("connections in the database", () => {
  it("stores tokens sealed, never in the clear", async () => {
    if (!dbReachable) return;
    const { saveConnection } = await import("@/lib/data/connections");
    await saveConnection(A, "google", { accessToken: "ya29.PLAIN", refreshToken: "1//REFRESH", expiresAt: new Date(Date.now() + 3600e3).toISOString(), scopes: ["openid", "https://www.googleapis.com/auth/gmail.readonly"] }, { id: "g-1", email: "a@example.com", name: "A" });
    const raw = (await withTenantSession(A, (c) => c.query("SELECT access_token_enc, refresh_token_enc FROM connections WHERE user_id = $1", [A.userId]))).rows[0];
    expect(JSON.stringify(raw)).not.toMatch(/PLAIN|REFRESH/);
    expect(open(raw.access_token_enc, KEY)).toBe("ya29.PLAIN");
  });

  it("belongs to its person: a coach in the same workspace, and another workspace, see nothing", async () => {
    if (!dbReachable) return;
    const { listConnections } = await import("@/lib/data/connections");
    expect((await listConnections(A)).map((c) => c.provider)).toEqual(["google"]);
    expect((await listConnections(A)).at(0)?.granted).toContain("gmail");
    expect(await listConnections(A2)).toEqual([]);
    expect(await listConnections(B)).toEqual([]);
    const raw = await withTenantSession(B, (c) => c.query("SELECT count(*)::int AS n FROM connections"));
    expect(raw.rows[0].n).toBe(0);
  });

  it("refreshes an expiring token and keeps the old refresh token", async () => {
    if (!dbReachable) return;
    const { accessToken } = await import("@/lib/data/connections");
    await withTenantSession(A, (c) => c.query("UPDATE connections SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [A.userId]));
    const { f } = fake([["https://oauth2.googleapis.com/token", () => json({ access_token: "ya29.NEW", expires_in: 3600 })]]);
    const { token } = await accessToken(A, "google", f);
    expect(token).toBe("ya29.NEW");
    const raw = (await withTenantSession(A, (c) => c.query("SELECT refresh_token_enc FROM connections WHERE user_id = $1", [A.userId]))).rows[0];
    expect(open(raw.refresh_token_enc, KEY)).toBe("1//REFRESH");
  });

  it("marks the connection expired when the provider withdraws access", async () => {
    if (!dbReachable) return;
    const { accessToken, listConnections } = await import("@/lib/data/connections");
    await withTenantSession(A, (c) => c.query("UPDATE connections SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [A.userId]));
    const { f } = fake([["https://oauth2.googleapis.com/token", () => new Response('{"error":"invalid_grant"}', { status: 400 })]]);
    await expect(accessToken(A, "google", f)).rejects.toMatchObject({ kind: "revoked" });
    expect((await listConnections(A))[0].status).toBe("expired");
  });

  it("never imports the same message twice, and disconnecting can take it all back", async () => {
    if (!dbReachable) return;
    const { addImported, disconnect, listConnections } = await import("@/lib/data/connections");
    const { loadPackForWorkspace, listSamples } = await import("@/lib/data/voice-pack");
    const pack = (await loadPackForWorkspace(A))!;
    const conn = (await listConnections(A))[0];
    const piece = { externalId: "gmail:x1", body: "A private email body, long enough to count as a piece of writing for the voice.", channel: "email", visibility: "private" as const, publishedAt: null };
    expect(await addImported(A, pack, conn.id, [piece])).toBe(1);
    expect(await addImported(A, pack, conn.id, [{ ...piece, body: piece.body + " Edited later." }])).toBe(0);
    expect((await listConnections(A))[0].importedPieces).toBe(1);

    const { f, seen } = fake([["https://oauth2.googleapis.com/revoke", () => new Response("", { status: 200 })]]);
    const r = await disconnect(A, "google", { removeWriting: true }, f);
    expect(r).toEqual({ removed: 1, revoked: true });
    expect(seen).toHaveLength(1);
    expect(await listConnections(A)).toEqual([]);
    expect((await listSamples(A, pack.id)).some((s) => s.body === piece.body)).toBe(false);
  });

  it("refuses a sample that points at another workspace's connection (0013)", async () => {
    if (!dbReachable) return;
    const { saveConnection, listConnections } = await import("@/lib/data/connections");
    const { loadPackForWorkspace } = await import("@/lib/data/voice-pack");
    await saveConnection(B, "linkedin", { accessToken: "x", refreshToken: null, expiresAt: null, scopes: [] }, { id: "li-1", email: null, name: null });
    const theirs = (await listConnections(B))[0].id;
    const mine = (await loadPackForWorkspace(A))!;
    const raw = withTenantSession(A, (c) =>
      c.query("INSERT INTO voice_samples (tenant_id, pack_id, body, connection_id) VALUES ($1,$2,'x',$3)", [A.tenantId, mine.id, theirs]),
    );
    await expect(raw).rejects.toThrow(/foreign key/i);
  });
});
