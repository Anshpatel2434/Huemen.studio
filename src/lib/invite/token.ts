/**
 * Tokens for the public pre-workshop questionnaire (brief §4.1). An HMAC over
 * the target tenant id and an expiry, so a link is tamper-proof, scoped to
 * exactly one workspace (a submission can only ever write that tenant's
 * draft — INV-1), and stops working on its own.
 *
 * The expiry matters: these links are mailed around before a workshop and get
 * forwarded. Without one, a leaked link could write a client's brief for ever,
 * and the "invalid or expired" message the form shows would have been a lie.
 *
 * Server-side (no `server-only` guard: used by CLI/admin helpers too).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

/** How long a questionnaire link lasts. Long enough to survive a workshop cycle. */
export const QUESTIONNAIRE_TTL_SECONDS = 90 * 24 * 60 * 60;

function mac(body: string): string {
  return createHmac("sha256", getEnv().AUTH_SECRET).update(`q:${body}`).digest("hex");
}

export function signQuestionnaireToken(tenantId: string, now = Date.now()): string {
  const body = `${tenantId}.${Math.floor(now / 1000) + QUESTIONNAIRE_TTL_SECONDS}`;
  return `${body}.${mac(body)}`;
}

/** The tenant this link writes to, or null if it is tampered with or expired. */
export function verifyQuestionnaireToken(token: string, now = Date.now()): string | null {
  const idx = token.lastIndexOf(".");
  if (idx < 0) return null;
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = mac(body);
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  const cut = body.lastIndexOf(".");
  // Links minted before expiry existed have no second part; they are refused
  // rather than honoured for ever. Re-issue from the admin console.
  if (cut < 0) return null;
  const tenantId = body.slice(0, cut);
  const expiry = Number(body.slice(cut + 1));
  if (!Number.isFinite(expiry) || expiry * 1000 <= now) return null;
  return tenantId;
}
