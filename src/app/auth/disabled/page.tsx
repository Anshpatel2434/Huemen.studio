import Link from "next/link";
import { Lock } from "lucide-react";
import { AuthFoot, AuthIcon, AuthShell, AuthTitle } from "@/components/auth-shell";

export const metadata = { title: "Access paused" };

/** Account turned off, or its workspace archived. Nothing to do here but ask. */
export default async function DisabledPage({ searchParams }: PageProps<"/auth/disabled">) {
  const sp = await searchParams;
  const email = typeof sp.email === "string" ? sp.email : "";
  return (
    <AuthShell>
      <AuthIcon><Lock size={18} /></AuthIcon>
      <AuthTitle sub={<>Access for {email ? <span className="font-medium text-ink break-all">{email}</span> : "this account"} is switched off, or its workspace has been archived. Your work isn&apos;t deleted.</>}>
        Access <span className="serif-accent">paused</span>
      </AuthTitle>
      <div className="mt-6 bg-panel rounded-[10px] px-4 py-3 text-[0.8rem] text-ink-muted leading-relaxed">
        Your coach or workspace admin can turn it back on from <span className="text-ink">Workspaces &amp; access</span>. Once they have, sign in as usual.
      </div>
      <Link href="/login" className="mt-4 h-9 rounded-[8px] border border-line text-[0.82rem] font-medium flex items-center justify-center hover:border-ink">Back to sign in</Link>
      <AuthFoot>Signed in with the wrong address? Go back and use the one you were invited with.</AuthFoot>
    </AuthShell>
  );
}
