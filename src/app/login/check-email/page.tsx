import Link from "next/link";
import { MailCheck, ArrowUpRight } from "lucide-react";
import { safeNext } from "@/lib/auth/tokens";
import { getEnv } from "@/lib/env";
import { SubmitButton } from "@/components/ui";
import { AuthFoot, AuthIcon, AuthShell, AuthTitle } from "@/components/auth-shell";
import { signInWithEmail } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Check your email" };

/** After "Continue with email": the one-time link is on its way. */
export default async function CheckEmailPage({ searchParams }: PageProps<"/login/check-email">) {
  const sp = await searchParams;
  const email = typeof sp.email === "string" ? sp.email : "";
  const next = safeNext(sp.next);
  const devToken = getEnv().AUTH_DRIVER === "dev" && typeof sp.dev === "string" ? sp.dev : null;
  const devHref = devToken ? `/auth/verify?${new URLSearchParams({ token: devToken, ...(next !== "/dashboard" ? { next } : {}) })}` : null;

  return (
    <AuthShell>
      <AuthIcon><MailCheck size={20} /></AuthIcon>
      <AuthTitle sub={<>We sent a sign-in link to <span className="font-medium text-ink break-all">{email || "your inbox"}</span>. It works once and expires in 15 minutes.</>}>
        Check your <span className="serif-accent">email</span>
      </AuthTitle>

      {devHref && (
        <div className="mt-6 rounded-[10px] border border-dashed border-line p-3.5">
          <p className="label-mono text-ink-faint">Dev inbox</p>
          <p className="text-[0.78rem] text-ink-muted mt-1 leading-relaxed">No mail is sent locally. This is the link the email would contain (also printed in the server log).</p>
          <Link href={devHref} className="mt-3 h-9 rounded-[8px] bg-ink text-on-ink text-[0.82rem] font-medium flex items-center justify-center gap-1.5 hover:opacity-90">
            Open sign-in link <ArrowUpRight size={14} />
          </Link>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-2">
        <form action={signInWithEmail}>
          <input type="hidden" name="email" value={email} />
          {next !== "/dashboard" && <input type="hidden" name="next" value={next} />}
          <SubmitButton variant="secondary" pendingLabel="Sending…" className="w-full">Resend the link</SubmitButton>
        </form>
        <Link href={`/login${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`} className="h-9 rounded-[8px] text-[0.82rem] text-ink-muted hover:text-ink hover:bg-field flex items-center justify-center">Use a different email</Link>
      </div>

      <AuthFoot>Can&apos;t find it? Check spam or promotions, and make sure it&apos;s the address you were invited with.</AuthFoot>
    </AuthShell>
  );
}
