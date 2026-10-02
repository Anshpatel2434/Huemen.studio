/**
 * The OAuth `state` parameter: who started the connection, for which
 * workspace and capability, and until when. HMAC-signed with AUTH_SECRET, so
 * the callback can trust it without a server-side session table; and bound to
 * a random nonce kept in an httpOnly cookie, so a state lifted from one browser
 * can't be replayed in another (CSRF on the callback).
 *
 * PKCE: the verifier lives in the same cookie; only its hash goes to Google.
 *
 * Server-only.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CapabilityKey, ProviderKey } from "./providers";

export interface OAuthState {
  t: string; // tenant
  u: string; // user
  p: ProviderKey;
  c: CapabilityKey | null;
  n: string; // nonce, matched against the cookie
  x: number; // expiry, ms since epoch
}

const TTL_MS = 10 * 60 * 1000;

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(`oauth:${body}`).digest("base64url");

export function newNonce(): string {
  return randomBytes(24).toString("base64url");
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function encodeState(s: Omit<OAuthState, "x">, secret: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...s, x: now + TTL_MS })).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** The state, if its signature holds, it hasn't expired and it matches this browser's nonce. */
export function decodeState(token: string, secret: string, nonce: string | undefined, now = Date.now()): OAuthState | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body, secret);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let s: OAuthState;
  try {
    s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
  } catch {
    return null;
  }
  if (typeof s.x !== "number" || s.x < now) return null;
  if (!nonce || nonce !== s.n) return null;
  return s;
}
