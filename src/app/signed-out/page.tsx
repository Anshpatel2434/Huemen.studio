import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { getSession } from "@/lib/auth";
import { AuthFoot, AuthIcon, AuthShell, AuthTitle } from "@/components/auth-shell";
import { ClearAccountDrafts } from "@/components/persist";
import { btnClass } from "@/components/btn";

export const dynamic = "force-dynamic";
export const metadata = { title: "Signed out" };

/** Confirmation after "Sign out", so a shared computer clearly isn't signed in any more. */
export default async function SignedOutPage() {
  if (await getSession()) redirect("/dashboard");
  return (
    <AuthShell>
      <ClearAccountDrafts />
      <AuthIcon><LogOut size={18} /></AuthIcon>
      <AuthTitle sub="Your session on this device has ended. Your brief and content are saved.">
        You&apos;re signed <span className="serif-accent">out</span>
      </AuthTitle>
      <Link href="/login" className={`mt-6 w-full ${btnClass("primary")}`}>Sign in again</Link>
      <AuthFoot>On a shared computer? Close this browser window too.</AuthFoot>
    </AuthShell>
  );
}
