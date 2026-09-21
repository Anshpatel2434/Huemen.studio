import { NextResponse, type NextRequest } from "next/server";
import { devSignIn } from "@/lib/auth";
import { safeNext, verifyLink } from "@/lib/auth/tokens";
import { getAccount, markSignedIn } from "@/lib/data/auth";

/**
 * The one-time sign-in link from the email. Valid → start a session and go to
 * `next`. Expired, already used, or tampered → the link-expired page, which
 * can send a fresh one.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const next = safeNext(url.searchParams.get("next"));
  const fail = (reason: string, email?: string) =>
    NextResponse.redirect(new URL(`/auth/link-expired?${new URLSearchParams({ reason, ...(email ? { email } : {}), ...(next !== "/dashboard" ? { next } : {}) })}`, url));

  const check = verifyLink("signin", url.searchParams.get("token") ?? "");
  if (!check.ok) return fail(check.reason);
  const a = await getAccount(check.subject);
  if (!a) return fail("invalid");
  if (a.status !== "active" || a.tenantStatus !== "active") {
    return NextResponse.redirect(new URL(`/auth/disabled?${new URLSearchParams({ email: a.email })}`, url));
  }
  // A sign-in since this link was issued (including this link, once) retires it.
  if (check.version !== a.lastSeen) return fail("used", a.email);

  await devSignIn({ userId: a.id, tenantId: a.tenantId, role: a.role, email: a.email });
  await markSignedIn(a.id);
  return NextResponse.redirect(new URL(next, url));
}
