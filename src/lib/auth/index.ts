/**
 * Auth (brief §05): a signed, httpOnly session cookie. People prove who they
 * are with a one-time link sent to their email (lib/auth/tokens, lib/mail);
 * AUTH_DRIVER=dev adds one-click sign-in for seeded accounts and shows links
 * on screen, for local work only. The rest of the app depends only on `Session`.
 *
 * Email-invite flow only in v1. No public sign-up (brief §02).
 *
 * Two things make a cookie stop working, because a cookie's own `maxAge` is
 * only a hint the browser may ignore and a copied value would otherwise last
 * for ever:
 *   - `exp`, checked here on every read, so a session dies on its own;
 *   - `v`, the account's session version. Changing a role, archiving a
 *     workspace or signing someone out everywhere bumps it in the database,
 *     and every live cookie for that account stops matching. This matters
 *     because RLS keys on the tenant and role claims carried in the cookie: a
 *     demoted user must not keep the old claim until it expires.
 *
 * Server-only.
 */
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { currentSessionVersion } from "@/lib/data/auth";
import type { Session } from "./types";

const COOKIE = "huemen_session";

/** How long a session lasts without signing in again. */
export const SESSION_TTL_SECONDS = 60 * 60 * 8;

/**
 * Onboarding's "Finish later": it lasts one sign-in, so starting or ending a
 * session clears it and the next sign-in resumes onboarding. A managed auth
 * provider must keep that: clear it in its own sign-in and sign-out hooks.
 */
export const ONBOARDING_LATER_COOKIE = "huemen_onb_later";

/** What is actually signed into the cookie: the session, plus its lifetime. */
type SealedSession = Session & {
  /** Unix seconds after which this cookie is refused. */
  exp: number;
  /** The account's session version when it was issued (see `users.session_version`). */
  v: number;
};

function sign(payload: string): string {
  return createHmac("sha256", getEnv().AUTH_SECRET).update(payload).digest("hex");
}

function encode(sealed: SealedSession): string {
  const payload = Buffer.from(JSON.stringify(sealed)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify, then check the clock. Returns the sealed form so callers that need
 * the version (the one database check) can see it; `getSession` hands the
 * plain `Session` to everyone else.
 */
export function decodeSealed(token: string, now = Date.now()): SealedSession | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = sign(payload);
  try {
    if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  let sealed: SealedSession;
  try {
    sealed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SealedSession;
  } catch {
    return null;
  }
  // A cookie minted before expiry existed has no `exp`; treat it as expired
  // rather than trusting it for ever.
  if (typeof sealed.exp !== "number" || sealed.exp * 1000 <= now) return null;
  if (typeof sealed.v !== "number") return null;
  return sealed;
}

/**
 * One revocation lookup per request however many times `getSession` is called
 * (React's per-request cache), so the check costs a single query per page.
 */
const liveVersion = cache(async (userId: string) => currentSessionVersion(userId));

/**
 * Current session, or null. The single source of identity for the app.
 *
 * Refuses a cookie whose signature is wrong, whose `exp` has passed, or whose
 * version no longer matches the account — which is how a role change, an
 * archived workspace or a disabled user ends a session that is already open.
 */
export async function getSession(): Promise<Session | null> {
  const sealed = await getSealedSession();
  if (!sealed) return null;
  if ((await liveVersion(sealed.userId)) !== sealed.v) return null;
  const { exp: _exp, v: _v, ...session } = sealed;
  void _exp;
  void _v;
  return session;
}

/** The session with its version, for the sign-in-time revocation check. */
export async function getSealedSession(): Promise<SealedSession | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  return token ? decodeSealed(token) : null;
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error("UNAUTHENTICATED");
  return s;
}

/**
 * Start a session for an account that has already proved who it is: a valid
 * one-time sign-in link, an accepted invite, or (dev only, gated by its
 * caller) the one-click sign-in for seeded accounts.
 */
export async function startSession(session: Session, sessionVersion: number): Promise<void> {
  const jar = await cookies();
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  jar.set(COOKIE, encode({ ...session, exp, v: sessionVersion }), {
    httpOnly: true,
    sameSite: "lax",
    secure: getEnv().NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  jar.delete(ONBOARDING_LATER_COOKIE);
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
  jar.delete(ONBOARDING_LATER_COOKIE);
}
