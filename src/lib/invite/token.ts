/**
 * Tokens for the public pre-workshop questionnaire (brief §4.1). An HMAC over
 * the target tenant id, so a link is tamper-proof and scoped to exactly one
 * workspace — a submission can only ever write that tenant's draft (INV-1).
 *
 * Server-side (no `server-only` guard: used by CLI/admin helpers too).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

function mac(tenantId: string): string {
  return createHmac("sha256", getEnv().AUTH_SECRET).update(`q:${tenantId}`).digest("hex");
}

export function signQuestionnaireToken(tenantId: string): string {
  return `${tenantId}.${mac(tenantId)}`;
}

export function verifyQuestionnaireToken(token: string): string | null {
  const idx = token.lastIndexOf(".");
  if (idx < 0) return null;
  const tenantId = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = mac(tenantId);
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return tenantId;
}
