import Link from "next/link";
import { LinkIcon } from "lucide-react";
import { safeNext } from "@/lib/auth/tokens";
import { SubmitButton } from "@/components/ui";
import { AuthFoot, AuthIcon, AuthShell, AuthTitle } from "@/components/auth-shell";
import { signInWithEmail } from "@/app/login/actions";
import { getEnv } from "@/lib/env";
import { btnClass } from "@/components/btn";

export const dynamic = "force-dynamic";
export const metadata = { title: "Link expired" };

const WHY: Record<string, { title: string; sub: string }> = {
  expired: { title: "This link has expired", sub: "Sign-in links last 15 minutes. Send yourself a fresh one." },
  used: { title: "This link was already used", sub: "Each sign-in link works once, and a newer sign-in retires older links. Send yourself a fresh one." },
  invalid: { title: "This link doesn't work", sub: "It may have been cut off or changed when it was copied. Send yourself a fresh one." },
};

/** A sign-in link that's expired, used or broken, with a one-step way to get a new one. */
export default async function LinkExpiredPage({ searchParams }: PageProps<"/auth/link-expired">) {
  const sp = await searchParams;
  const why = WHY[typeof sp.reason === "string" ? sp.reason : "invalid"] ?? WHY.invalid;
  const email = typeof sp.email === "string" ? sp.email : "";
  const next = safeNext(sp.next);
  // No way to send email on this host (password sign-in, docs/deploy-first-client.md):
  // a form that promises a new link would leave the person waiting for nothing.
  const env = getEnv();
  const canMail = env.AUTH_DRIVER === "dev" || env.MAIL_PROVIDER !== "log";
  if (!canMail) {
    return (
      <AuthShell>
        <AuthIcon><LinkIcon size={19} /></AuthIcon>
        <AuthTitle sub="Sign in with your email and password. If the link was an invite, ask the person who invited you for a new one.">{why.title}</AuthTitle>
        <Link href={`/login?${new URLSearchParams({ ...(email ? { email } : {}), ...(next !== "/dashboard" ? { next } : {}) })}`} className={`mt-6 w-full ${btnClass("primary")}`}>Go to sign in</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthIcon><LinkIcon size={19} /></AuthIcon>
      <AuthTitle sub={why.sub}>{why.title}</AuthTitle>
      <form action={signInWithEmail} className="mt-6 flex flex-col gap-3">
        {next !== "/dashboard" && <input type="hidden" name="next" value={next} />}
        <label className="block">
          <span className="block text-xs text-ink-muted mb-1.5">Email address</span>
          <input name="email" type="email" required autoComplete="email" defaultValue={email} placeholder="Enter your email address…" className="field" />
        </label>
        <SubmitButton variant="primary" pendingLabel="Sending…" className="w-full">Send a new link</SubmitButton>
      </form>
      <AuthFoot><Link href="/login" className="hover:text-ink">Back to sign in</Link></AuthFoot>
    </AuthShell>
  );
}
