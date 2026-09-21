import Link from "next/link";
import { MailWarning, UserCheck, ArrowRight } from "lucide-react";
import { getSession } from "@/lib/auth";
import { verifyLink } from "@/lib/auth/tokens";
import { getAccount } from "@/lib/data/auth";
import { SubmitButton } from "@/components/ui";
import { AuthFoot, AuthIcon, AuthNotice, AuthShell, AuthTitle } from "@/components/auth-shell";
import { acceptInviteAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accept your invite" };

const ROLE: Record<string, { label: string; can: string }> = {
  client: { label: "Client", can: "Build your brief, pillars, content and visuals, and export them." },
  coach: { label: "Coach", can: "Work on this client's brand and content on their behalf." },
  owner_admin: { label: "Admin", can: "Manage workspaces, people and prompt templates." },
};

/**
 * Accept an invite (the only way in: no public sign-up, brief §02). Shows
 * who invited you, to which workspace and as what, then one button to join.
 */
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const check = verifyLink("invite", decodeURIComponent(token));
  const a = check.ok ? await getAccount(check.subject) : null;
  const session = await getSession();

  // ---- Dead ends, each with a clear next step.
  if (!check.ok || !a) {
    const expired = !check.ok && check.reason === "expired";
    return (
      <AuthShell>
        <AuthIcon><MailWarning size={19} /></AuthIcon>
        <AuthTitle sub={expired ? "Invites are valid for 7 days. Ask the person who invited you to send a new one." : "This invite link isn't valid. It may have been cut off when it was copied. Ask for a fresh one."}>
          {expired ? "This invite has expired" : "Invite not found"}
        </AuthTitle>
        <Link href="/login" className="mt-6 h-9 rounded-[8px] border border-line text-[0.82rem] font-medium flex items-center justify-center hover:border-ink">Already joined? Sign in</Link>
      </AuthShell>
    );
  }
  if (a.status === "active") {
    return (
      <AuthShell>
        <AuthIcon><UserCheck size={19} /></AuthIcon>
        <AuthTitle sub={<>{a.email} has already joined <span className="font-medium text-ink">{a.tenantName}</span>. Sign in to pick up where you left off.</>}>
          You&apos;re already <span className="serif-accent">in</span>
        </AuthTitle>
        <Link href={`/login?${new URLSearchParams({ email: a.email })}`} className="mt-6 h-10 rounded-[8px] bg-ink text-on-ink text-[0.85rem] font-medium flex items-center justify-center gap-1.5 hover:opacity-90">Sign in <ArrowRight size={14} /></Link>
      </AuthShell>
    );
  }
  if (a.status === "disabled" || a.tenantStatus !== "active") {
    return (
      <AuthShell>
        <AuthIcon><MailWarning size={19} /></AuthIcon>
        <AuthTitle sub="This invite was withdrawn, or the workspace is no longer active. Ask your coach or admin if you think that's a mistake.">Invite withdrawn</AuthTitle>
        <Link href="/login" className="mt-6 h-9 rounded-[8px] border border-line text-[0.82rem] font-medium flex items-center justify-center hover:border-ink">Back to sign in</Link>
      </AuthShell>
    );
  }

  const role = ROLE[a.role] ?? { label: a.role, can: "" };
  return (
    <AuthShell showcase width={360}>
      <p className="text-center label-mono text-ink-faint">You&apos;re invited</p>
      <AuthTitle sub={<>{a.invitedBy ? <><span className="text-ink">{a.invitedBy}</span> invited you</> : "You've been invited"} to join their personal-brand studio on Huemen.</>}>
        Join <span className="serif-accent">{a.tenantName}</span>
      </AuthTitle>

      <dl className="mt-6 rounded-[10px] border border-hairline divide-y divide-[var(--hairline)] text-[0.8rem]">
        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5"><dt className="text-ink-muted">Workspace</dt><dd className="font-medium truncate">{a.tenantName}</dd></div>
        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5"><dt className="text-ink-muted">Your email</dt><dd className="font-medium truncate">{a.email}</dd></div>
        <div className="px-3.5 py-2.5">
          <div className="flex items-center justify-between gap-3"><dt className="text-ink-muted">Role</dt><dd className="font-medium">{role.label}</dd></div>
          {role.can && <p className="text-[0.74rem] text-ink-faint mt-1 leading-snug">{role.can}</p>}
        </div>
      </dl>

      {session && session.email.toLowerCase() !== a.email.toLowerCase() && (
        <AuthNotice>You&apos;re signed in as {session.email}. Accepting signs you in as {a.email} instead.</AuthNotice>
      )}

      <form action={acceptInviteAction} className="mt-6">
        <input type="hidden" name="token" value={decodeURIComponent(token)} />
        <SubmitButton variant="accent" pendingLabel="Joining…" className="w-full">Accept invite &amp; join</SubmitButton>
      </form>
      <AuthFoot>
        No password needed: next time, sign in with a one-time link sent to {a.email}.
        <br />Not expecting this? You can ignore it and nothing happens.
      </AuthFoot>
    </AuthShell>
  );
}
