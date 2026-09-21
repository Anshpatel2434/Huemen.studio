/**
 * Signed, expiring links for the passwordless, invite-only flow (brief §02):
 * - "signin": a one-time sign-in link (15 minutes). It carries the user's
 *   last_seen_at at issue time; signing in moves last_seen_at, so a used link,
 *   or any older link, stops working. No token table needed.
 * - "invite": accept an invite (7 days). Single use because accepting moves the
 *   user from 'invited' to 'active'.
 *
 * HMAC with AUTH_SECRET, purpose-bound so one kind can't be replayed as another.
 * Server-only.
 */
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

export type TokenPurpose = "signin" | "invite";
const TTL: Record<TokenPurpose, number> = { signin: 15 * 60, invite: 7 * 24 * 60 * 60 };

type Payload = { p: TokenPurpose; s: string; v: string; e: number };

function mac(body: string): string {
  return createHmac("sha256", getEnv().AUTH_SECRET).update(`link:${body}`).digest("base64url");
}

/** `subject` is a user id; `version` pins the link to the user's current state. */
export function signLink(purpose: TokenPurpose, subject: string, version: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ p: purpose, s: subject, v: version, e: Math.floor(now / 1000) + TTL[purpose] } satisfies Payload)).toString("base64url");
  return `${body}.${mac(body)}`;
}

export type LinkCheck = { ok: true; subject: string; version: string } | { ok: false; reason: "invalid" | "expired" };

export function verifyLink(purpose: TokenPurpose, token: string, now = Date.now()): LinkCheck {
  const [body, sig] = token.split(".");
  if (!body || !sig) return { ok: false, reason: "invalid" };
  const want = mac(body);
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return { ok: false, reason: "invalid" };
  let p: Payload;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (p.p !== purpose || typeof p.s !== "string") return { ok: false, reason: "invalid" };
  if (p.e * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true, subject: p.s, version: p.v ?? "" };
}

/** Only same-site paths may be a post-sign-in destination (no open redirects). */
export function safeNext(next: unknown): string {
  return typeof next === "string" && /^\/(?!\/)[^\s\\]*$/.test(next) && !next.startsWith("/login") ? next : "/dashboard";
}
