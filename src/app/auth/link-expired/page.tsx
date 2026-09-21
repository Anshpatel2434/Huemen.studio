import Link from "next/link";
import { LinkIcon } from "lucide-react";
import { safeNext } from "@/lib/auth/tokens";
import { SubmitButton } from "@/components/ui";
import { AuthFoot, AuthIcon, AuthShell, AuthTitle } from "@/components/auth-shell";
import { signInWithEmail } from "@/app/login/actions";

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

  return (
    <AuthShell>
      <AuthIcon><LinkIcon size={19} /></AuthIcon>
      <AuthTitle sub={why.sub}>{why.title}</AuthTitle>
      <form action={signInWithEmail} className="mt-6 flex flex-col gap-3">
        {next !== "/dashboard" && <input type="hidden" name="next" value={next} />}
        <label className="block">
          <span className="block text-[0.76rem] text-ink-muted mb-1.5">Email address</span>
          <input name="email" type="email" required autoComplete="email" defaultValue={email} placeholder="Enter your email address…" className="field" />
        </label>
        <SubmitButton variant="accent" pendingLabel="Sending…" className="w-full">Send a new link</SubmitButton>
      </form>
      <AuthFoot><Link href="/login" className="hover:text-ink">Back to sign in</Link></AuthFoot>
    </AuthShell>
  );
}
