/**
 * Auth (brief §05): a signed, httpOnly session cookie. People prove who they
 * are with a one-time link sent to their email (lib/auth/tokens, lib/mail);
 * AUTH_DRIVER=dev adds one-click sign-in for seeded accounts and shows links
 * on screen, for local work only. The rest of the app depends only on `Session`.
 *
 * Email-invite flow only in v1. No public sign-up (brief §02).
 *
 * Server-only.
 */
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { getAccount } from "@/lib/data/auth";
import type { Session } from "./types";

const COOKIE = "huemen_session";
/** A session lasts a working day. The limit is inside the signed value, so a copied cookie stops working too. */
const MAX_AGE_S = 60 * 60 * 8;

/**
 * Onboarding's "Finish later": it lasts one sign-in, so starting or ending a
 * session clears it and the next sign-in resumes onboarding. A managed auth
 * provider must keep that: clear it in its own sign-in and sign-out hooks.
 */
export const ONBOARDING_LATER_COOKIE = "huemen_onb_later";

function sign(payload: string): string {
  return createHmac("sha256", getEnv().AUTH_SECRET).update(payload).digest("hex");
}

function encode(session: Session): string {
  const payload = Buffer.from(JSON.stringify({ ...session, exp: Date.now() + MAX_AGE_S * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decode(token: string): Session | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = sign(payload);
  try {
    if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session & { exp?: number };
    return typeof s.exp === "number" && s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

/**
 * Current session, or null. The single source of identity for the app.
 *
 * The cookie only says who signed in. The account is read again on every
 * request (once per render), so disabling a person, archiving their
 * workspace or changing their role takes effect at once, not at sign-out.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  const signed = token ? decode(token) : null;
  if (!signed) return null;
  const a = await getAccount(signed.userId);
  if (!a || a.status !== "active" || a.tenantStatus !== "active") return null;
  return { userId: a.id, tenantId: a.tenantId, role: a.role, email: a.email };
});

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
export async function startSession(session: Session): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, encode(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: getEnv().NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
  jar.delete(ONBOARDING_LATER_COOKIE);
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
  jar.delete(ONBOARDING_LATER_COOKIE);
}
