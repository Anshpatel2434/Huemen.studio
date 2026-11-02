/**
 * Tokens for the public pre-workshop questionnaire (brief §4.1). An HMAC over
 * the target tenant id and an expiry, so a link is tamper-proof, scoped to
 * exactly one workspace (a submission can only ever write that tenant's draft,
 * INV-1) and stops working after 30 days. The admin page signs a fresh one
 * each time it is opened.
 *
 * Server-side (no `server-only` guard: used by CLI/admin helpers too).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

const TTL_MS = 30 * 24 * 60 * 60 * 1000;

function mac(tenantId: string, exp: number): string {
  return createHmac("sha256", getEnv().AUTH_SECRET).update(`q:${tenantId}:${exp}`).digest("hex");
}

export function signQuestionnaireToken(tenantId: string, now = Date.now()): string {
  const exp = now + TTL_MS;
  return `${tenantId}.${exp}.${mac(tenantId, exp)}`;
}

/** The workspace a link is for, or null when it is forged, malformed or past its date. */
export function verifyQuestionnaireToken(token: string): string | null {
  const [tenantId, expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!tenantId || !sig || !Number.isInteger(exp) || Date.now() > exp) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(mac(tenantId, exp)))) return null;
  } catch {
    return null;
  }
  return tenantId;
}
