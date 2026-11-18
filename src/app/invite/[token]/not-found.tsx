import Link from "next/link";
import { MailWarning } from "lucide-react";
import { AuthIcon, AuthShell, AuthTitle } from "@/components/auth-shell";
import { btnClass } from "@/components/btn";

export const metadata = { title: "Invite not found" };

/** A 404 for an invite link that isn't valid: the page says what to do next. */
export default function InviteNotFound() {
  return (
    <AuthShell>
      <AuthIcon><MailWarning size={19} /></AuthIcon>
      <AuthTitle sub="This invite link isn't valid. It may have been cut off when it was copied. Ask for a fresh one.">
        Invite not found
      </AuthTitle>
      <Link href="/login" className={`mt-6 w-full ${btnClass("secondary")}`}>Already joined? Sign in</Link>
    </AuthShell>
  );
}
