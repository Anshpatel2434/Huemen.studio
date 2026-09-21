"use server";

import { redirect } from "next/navigation";
import { devSignIn } from "@/lib/auth";
import { safeNext, signLink } from "@/lib/auth/tokens";
import { findAccountByEmail, getAccount, markSignedIn, type AccountRow } from "@/lib/data/auth";
import { getEnv } from "@/lib/env";
import { sendAuthMail } from "@/lib/mail";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Start a session for an account that has passed every check. */
async function startSession(a: AccountRow): Promise<void> {
  await devSignIn({ userId: a.id, tenantId: a.tenantId, role: a.role, email: a.email });
  await markSignedIn(a.id);
}

/**
 * DEV-ONLY one-click sign-in for seeded accounts. The managed auth provider
 * replaces this entirely (brief §02, §05).
 */
export async function signInAs(formData: FormData): Promise<void> {
  if (getEnv().AUTH_DRIVER !== "dev") throw new Error("dev sign-in disabled");
  const a = await getAccount(String(formData.get("userId")));
  if (!a || a.status !== "active") redirect("/login?e=noinvite");
  await startSession(a);
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

  const token = signLink("signin", a.id, a.lastSeen);
  const link = `${getEnv().APP_URL}/auth/verify?${new URLSearchParams({ token, ...(next !== "/dashboard" ? { next } : {}) })}`;
  await sendAuthMail({
    to: a.email,
    subject: "Your Huemen.studio sign-in link",
    link,
    lines: [`Sign in to ${a.tenantName}.`, "This link works once and expires in 15 minutes."],
  });
  // The dev driver has no mailbox, so the page shows the link as a "dev inbox".
  const dev: Record<string, string> = getEnv().AUTH_DRIVER === "dev" ? { dev: token } : {};
  redirect(`/login/check-email?${q({ email: a.email, ...dev })}`);
}
