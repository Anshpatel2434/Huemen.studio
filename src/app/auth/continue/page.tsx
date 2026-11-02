import { LogIn } from "lucide-react";
import { safeNext } from "@/lib/auth/tokens";
import { AuthIcon, AuthShell, AuthTitle } from "@/components/auth-shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

/**
 * Step two of an emailed sign-in link (see auth/verify): one button that uses
 * the link. Opening the link alone never signs in, so a mail scanner that
 * opens it can't use it up.
 */
export default async function ContinuePage({ searchParams }: PageProps<"/auth/continue">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const next = safeNext(sp.next);
  return (
    <AuthShell>
      <AuthIcon><LogIn size={19} /></AuthIcon>
      <AuthTitle sub="Your sign-in link is ready.">Continue to Huemen.studio</AuthTitle>
      <form method="post" action="/auth/verify" className="mt-6">
        <input type="hidden" name="token" value={token} />
        {next !== "/dashboard" && <input type="hidden" name="next" value={next} />}
        <button type="submit" autoFocus className="w-full inline-flex items-center justify-center min-h-12 rounded-full bg-ink text-on-ink text-sm font-medium hover:opacity-90">Sign in</button>
      </form>
    </AuthShell>
  );
}
