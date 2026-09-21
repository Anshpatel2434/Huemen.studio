import Link from "next/link";
import { Compass } from "lucide-react";
import { AuthFoot, AuthIcon, AuthShell, AuthTitle } from "@/components/auth-shell";

export const metadata = { title: "Not found" };

/**
 * 404. Also what you see for a workspace or project you can't access: we
 * deliberately don't say whether it exists (tenant isolation, INV-1).
 */
export default function NotFound() {
  return (
    <AuthShell>
      <AuthIcon><Compass size={19} /></AuthIcon>
      <AuthTitle sub="This page doesn't exist, or it belongs to a workspace you don't have access to.">
        Nothing <span className="serif-accent">here</span>
      </AuthTitle>
      <Link href="/dashboard" className="mt-6 h-10 rounded-[8px] bg-ink text-on-ink text-[0.85rem] font-medium flex items-center justify-center hover:opacity-90">Go to your projects</Link>
      <AuthFoot>Expected to see something? Check you&apos;re signed in with the email you were invited with.</AuthFoot>
    </AuthShell>
  );
}
