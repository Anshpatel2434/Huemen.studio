import { NextResponse, type NextRequest } from "next/server";
import { startSession } from "@/lib/auth";
import { safeNext, verifyLink } from "@/lib/auth/tokens";
import { getAccount, markSignedIn } from "@/lib/data/auth";

/**
 * The one-time sign-in link from the email, in two steps.
 *
 * GET (the link itself) only checks it and shows a "Continue" button
 * (/auth/continue). Corporate mail scanners open every link in an email to
 * look for malware; if opening it signed in, the scanner would use the link up
 * and the person would land on "already used".
 *
 * POST (the button) uses it: start a session and go to `next`. Expired,
 * already used, or tampered → the link-expired page, which can send a fresh one.
 */
async function check(token: string, next: string, url: URL) {
  const fail = (reason: string, email?: string) =>
    NextResponse.redirect(new URL(`/auth/link-expired?${new URLSearchParams({ reason, ...(email ? { email } : {}), ...(next !== "/dashboard" ? { next } : {}) })}`, url), 303);
  const link = verifyLink("signin", token);
  if (!link.ok) return { fail: fail(link.reason) };
  const a = await getAccount(link.subject);
  if (!a) return { fail: fail("invalid") };
  if (a.status !== "active" || a.tenantStatus !== "active") {
    return { fail: NextResponse.redirect(new URL(`/auth/disabled?${new URLSearchParams({ email: a.email })}`, url), 303) };
  }
  // A sign-in since this link was issued (including this link, once) retires it.
  if (link.version !== a.lastSeen) return { fail: fail("used", a.email) };
  return { account: a };
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const token = url.searchParams.get("token") ?? "";
  const next = safeNext(url.searchParams.get("next"));
  const r = await check(token, next, url);
  if (r.fail) return r.fail;
  return NextResponse.redirect(new URL(`/auth/continue?${new URLSearchParams({ token, ...(next !== "/dashboard" ? { next } : {}) })}`, url));
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  const next = safeNext(form?.get("next"));
  const r = await check(token, next, req.nextUrl);
  if (r.fail) return r.fail;
  const a = r.account!;
  await startSession({ userId: a.id, tenantId: a.tenantId, role: a.role, email: a.email });
  await markSignedIn(a.id);
  return NextResponse.redirect(new URL(next, req.nextUrl), 303);
}
