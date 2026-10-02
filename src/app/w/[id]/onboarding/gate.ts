/**
 * Who goes through onboarding before the studio opens.
 *
 * A client whose own voice isn't set up lands in onboarding, at the step they
 * reached, instead of an empty dashboard. Coaches and admins working in
 * someone else's workspace are never sent there: it isn't their voice. "Finish
 * later" opens the studio for the rest of the sitting (a cookie naming the
 * workspace, cleared on sign-in and sign-out); the next sign-in resumes the flow.
 *
 * Server-only.
 */
import "server-only";
import { ONBOARDING_LATER_COOKIE } from "@/lib/auth";
import type { Session } from "@/lib/auth/types";
import type { VoicePack } from "@/lib/voice/types";

/** Cleared by every sign-in and sign-out (lib/auth), so it lasts one sitting. */
export const LATER_COOKIE = ONBOARDING_LATER_COOKIE;

/** The person setting up their own voice, and not finished yet. */
export const isOwnSetup = (session: Pick<Session, "userId" | "role">, pack: VoicePack | null): pack is VoicePack =>
  !!pack && !pack.onboarding.completedAt && pack.userId === session.userId && session.role === "client";

export function mustOnboard(
  session: Pick<Session, "userId" | "role">,
  pack: VoicePack | null,
  tenantId: string,
  laterFor: string | undefined,
): boolean {
  return isOwnSetup(session, pack) && laterFor !== tenantId;
}
