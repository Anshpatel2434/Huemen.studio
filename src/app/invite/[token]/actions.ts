"use server";

import { redirect } from "next/navigation";
import { startSession } from "@/lib/auth";
import { verifyLink } from "@/lib/auth/tokens";
import { activateInvite, getAccount, markSignedIn } from "@/lib/data/auth";

/**
 * Accept an invite: invited → active, then straight into the workspace. The
 * token is re-verified here (never trust the page that rendered the button).
 * The invite link went to their email, so opening it proves the address, the
 * same as a sign-in link; it works once (accepting moves them to active).
 */
export async function acceptInviteAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const check = verifyLink("invite", token);
  if (!check.ok) redirect(`/invite/${encodeURIComponent(token)}`);
  const a = await getAccount(check.subject);
  if (!a || a.status !== "invited" || a.tenantStatus !== "active") redirect(`/invite/${encodeURIComponent(token)}`);
  if (!(await activateInvite(a.id))) redirect(`/invite/${encodeURIComponent(token)}`);

  await startSession({ userId: a.id, tenantId: a.tenantId, role: a.role, email: a.email });
  await markSignedIn(a.id);
  redirect(`/w/${a.tenantId}?welcome=1`);
}
