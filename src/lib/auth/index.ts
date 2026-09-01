/**
 * Auth (brief §05). v1 target is a MANAGED provider with org/tenant + role
 * claims; this dev adapter is a signed cookie so the app runs locally without
 * external accounts. Swap the adapter (getSession/signIn) for the managed
 * provider at integration time — the rest of the app depends only on `Session`.
 *
 * Email-invite flow only in v1. No public sign-up (brief §02).
 *
 * Server-only.
 */
import "server-only";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import type { Session } from "./types";

const COOKIE = "huemen_session";

function sign(payload: string): string {
  return createHmac("sha256", getEnv().AUTH_SECRET).update(payload).digest("hex");
}

function encode(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
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
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
  } catch {
    return null;
  }
}

/** Current session, or null. The single source of identity for the app. */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  return token ? decode(token) : null;
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error("UNAUTHENTICATED");
  return s;
}

/** Dev-only: establish a session for a seeded user. Managed provider replaces this. */
export async function devSignIn(session: Session): Promise<void> {
  if (getEnv().AUTH_DRIVER !== "dev") throw new Error("devSignIn disabled");
  const jar = await cookies();
  jar.set(COOKIE, encode(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: getEnv().NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}
