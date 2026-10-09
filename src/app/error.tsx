"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { AuthFoot, AuthIcon, AuthShell, AuthTitle } from "@/components/auth-shell";

/** Branded error boundary: a calm message, a retry, and the error reference for support. */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <AuthShell>
      <AuthIcon><AlertTriangle size={18} /></AuthIcon>
      <AuthTitle sub="Something went wrong on our side. Your work is saved; trying again usually fixes it.">
        That didn&apos;t <span className="serif-accent">load</span>
      </AuthTitle>
      <div className="mt-6 flex flex-col gap-2">
        <button onClick={() => retry()} className="h-10 rounded-sm bg-ink text-on-ink text-sm font-medium hover:opacity-90">Try again</button>
        <Link href="/dashboard" className="h-9 rounded-sm text-sm text-ink-muted hover:text-ink hover:bg-field flex items-center justify-center">Go to your projects</Link>
      </div>
      {error.digest && <AuthFoot>Reference <span className="font-mono">{error.digest}</span>. Quote it if you contact support.</AuthFoot>}
    </AuthShell>
  );
}
