import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { withTenantSession } from "@/db/session";
import { getSession } from "@/lib/auth";
import { safeNext } from "@/lib/auth/tokens";
import { getEnv } from "@/lib/env";
import { SubmitButton } from "@/components/ui";
import { AuthFoot, AuthNotice, AuthShell, AuthTitle } from "@/components/auth-shell";
import { signInAs, signInWithEmail } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

const ROLE_LABEL: Record<string, string> = { owner_admin: "Owner / Admin", coach: "Coach", client: "Client" };
const ERRORS: Record<string, string> = {
  invalid: "That doesn't look like an email address.",
  noinvite: "There's no account for that address. Workspaces are invite-only, so ask your coach or admin to invite you.",
  pending: "You've been invited but haven't accepted yet. Open the invite link in your email to join, then sign in here.",
  provider: "Sign-in links are sent by your identity provider. Check your inbox for the invite.",
  signin: "Sign in to continue. You'll go straight back to where you were.",
};

/**
 * Sign in. Invite-only and passwordless (brief §02): enter your email, get a
 * one-time link. In dev, seeded accounts are listed for one-click sign-in.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getSession()) redirect(next);

  const isDev = getEnv().AUTH_DRIVER === "dev";
  const users = isDev
    ? (
        await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, (c) =>
          c.query<{ id: string; email: string; role: string; tenant: string }>(
            `SELECT u.id, u.email, u.role, t.name AS tenant FROM users u JOIN tenants t ON t.id = u.tenant_id
              WHERE u.status = 'active' AND t.status = 'active' ORDER BY u.role`,
          ),
        )
      ).rows
    : [];
  const error = typeof sp.e === "string" ? ERRORS[sp.e] : undefined;
  const email = typeof sp.email === "string" ? sp.email : "";

  return (
    <AuthShell showcase>
      <AuthTitle sub="Define the brand once. Every post, carousel and visual follows from it.">
        Your personal-brand <span className="serif-accent">studio</span>
      </AuthTitle>

      {error && <AuthNotice>{error}</AuthNotice>}

      <form action={signInWithEmail} className="mt-6 flex flex-col gap-3">
        {next !== "/dashboard" && <input type="hidden" name="next" value={next} />}
        <label className="block">
          <span className="block text-[0.76rem] text-ink-muted mb-1.5">Email address</span>
          <input name="email" type="email" required autoComplete="email" defaultValue={email} placeholder="Enter your email address…" className="field" autoFocus={!!error} />
        </label>
        <SubmitButton variant="primary" pendingLabel="Sending your link…" className="w-full">Continue with email</SubmitButton>
      </form>

      <AuthFoot>
        We&apos;ll email you a one-time sign-in link, so there&apos;s no password to remember.
        <br />
        Access is by invite. Got an invite? <span className="text-ink-muted">Open the link in that email.</span>
      </AuthFoot>

      {isDev && users.length > 0 && (
        <div className="mt-7">
          <div className="flex items-center gap-3 text-[0.72rem] text-ink-faint"><span className="flex-1 h-px bg-hairline" /> dev accounts <span className="flex-1 h-px bg-hairline" /></div>
          <div className="mt-3 flex flex-col gap-1.5">
            {users.map((u) => (
              <form key={u.id} action={signInAs}>
                <input type="hidden" name="userId" value={u.id} />
                {next !== "/dashboard" && <input type="hidden" name="next" value={next} />}
                <button type="submit" className="group w-full text-left rounded-[9px] border border-hairline hover:border-line bg-paper px-3 py-2 flex items-center gap-2.5 transition-colors">
                  <span className="w-7 h-7 rounded-full bg-ink text-on-ink flex items-center justify-center text-[0.65rem] font-medium uppercase">{u.email.slice(0, 2)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[0.8rem] font-medium truncate">{u.email}</span>
                    <span className="block text-[0.7rem] text-ink-faint truncate">{ROLE_LABEL[u.role] ?? u.role} · {u.tenant}</span>
                  </span>
                  <ArrowRight size={14} className="text-ink-faint group-hover:text-ink" />
                </button>
              </form>
            ))}
          </div>
        </div>
      )}

      <p className="mt-7 text-center text-[0.72rem] text-ink-faint">
        <Link href="/" className="hover:text-ink">About Huemen.studio</Link>
      </p>
    </AuthShell>
  );
}
