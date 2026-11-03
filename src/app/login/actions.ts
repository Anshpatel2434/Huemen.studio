"use server";

import { redirect } from "next/navigation";
import { startSession } from "@/lib/auth";
import { safeNext, signLink } from "@/lib/auth/tokens";
import { findAccountByEmail, getAccount, markSignedIn } from "@/lib/data/auth";
import { getEnv } from "@/lib/env";
import { sendAuthMail } from "@/lib/mail";
import { takeHit } from "@/lib/ratelimit";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * DEV-ONLY one-click sign-in for seeded accounts (AUTH_DRIVER=dev). In
 * production everyone signs in with the emailed one-time link below.
 */
export async function signInAs(formData: FormData): Promise<void> {
  if (getEnv().AUTH_DRIVER !== "dev") throw new Error("dev sign-in disabled");
  const a = await getAccount(String(formData.get("userId")));
  if (!a || a.status !== "active") redirect("/login?e=noinvite");
  await startSession({ userId: a.id, tenantId: a.tenantId, role: a.role, email: a.email }, a.sessionVersion);
  await markSignedIn(a.id);
  redirect(safeNext(formData.get("next")));
}

/**
 * Email sign-in, passwordless and invite-only (no public sign-up, brief §02).
 * The address must belong to an invited, active account; we then email a
 * one-time link and show "check your email". Unknown, pending and disabled
 * accounts each get their own page, so nobody is left guessing.
 */
export async function signInWithEmail(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const next = safeNext(formData.get("next"));
  const q = (extra: Record<string, string>) => new URLSearchParams({ ...extra, ...(next !== "/dashboard" ? { next } : {}) }).toString();
  if (!EMAIL.test(email)) redirect(`/login?${q({ e: "invalid", email })}`);

  const a = await findAccountByEmail(email);
  if (!a) redirect(`/login?${q({ e: "noinvite", email })}`);
  if (a.status === "disabled" || a.tenantStatus !== "active") redirect(`/auth/disabled?${q({ email })}`);
  if (a.status === "invited") redirect(`/login?${q({ e: "pending", email })}`);

  // Five links per account per quarter hour: enough for a typo'd inbox or a
  // lost email, not enough to flood someone's mailbox from this form.
  let allowed = true;
  try {
    await takeHit({ tenantId: a.tenantId, userId: a.id }, "signin-email", { perUser: 5, windowSeconds: 15 * 60 });
  } catch {
    allowed = false;
  }
  if (!allowed) redirect(`/login?${q({ e: "toomany", email })}`);

  const token = signLink("signin", a.id, a.lastSeen);
  const link = `${getEnv().APP_URL}/auth/verify?${new URLSearchParams({ token, ...(next !== "/dashboard" ? { next } : {}) })}`;
  let sent = true;
  try {
    await sendAuthMail({
      to: a.email,
      subject: "Your Huemen.studio sign-in link",
      link,
      lines: [`Sign in to ${a.tenantName}.`, "This link works once and expires in 15 minutes."],
      action: "Sign in",
    });
  } catch {
    sent = false;
  }
  if (!sent) redirect(`/login?${q({ e: "mailfail", email })}`);
  // The dev driver has no mailbox, so the page shows the link as a "dev inbox".
  const dev: Record<string, string> = getEnv().AUTH_DRIVER === "dev" ? { dev: token } : {};
  redirect(`/login/check-email?${q({ email: a.email, ...dev })}`);
}
