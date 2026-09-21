"use server";

import { redirect } from "next/navigation";
import { devSignIn } from "@/lib/auth";
import { verifyLink } from "@/lib/auth/tokens";
import { activateInvite, getAccount } from "@/lib/data/auth";
import { getEnv } from "@/lib/env";

/**
 * Accept an invite: invited → active, then straight into the workspace. The
 * token is re-verified here (never trust the page that rendered the button).
 */
export async function acceptInviteAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const check = verifyLink("invite", token);
  if (!check.ok) redirect(`/invite/${encodeURIComponent(token)}`);
  const a = await getAccount(check.subject);
  if (!a || a.status !== "invited" || a.tenantStatus !== "active") redirect(`/invite/${encodeURIComponent(token)}`);
  if (!(await activateInvite(a.id))) redirect(`/invite/${encodeURIComponent(token)}`);

  if (getEnv().AUTH_DRIVER !== "dev") redirect(`/login?${new URLSearchParams({ email: a.email })}`);
  await devSignIn({ userId: a.id, tenantId: a.tenantId, role: a.role, email: a.email });
  redirect(`/w/${a.tenantId}?welcome=1`);
}
