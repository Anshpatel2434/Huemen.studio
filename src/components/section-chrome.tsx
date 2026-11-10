import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme";
import { PageTransition } from "@/components/page-transition";
import { SectionTabs } from "./section-tabs";
import { LogoMark, ToastProvider } from "./ui";

/**
 * The focused frame: a top bar and nothing else. Used where the app shell's
 * sidebar would be a way out that shouldn't be there, which today is
 * onboarding while it is still the way into someone's own studio. Every other
 * workspace page uses the app shell (components/app-shell).
 *
 * DocPage positions itself absolutely; `main` is the positioned, full-height
 * container it expects.
 */
export function SectionChrome({
  tenantId,
  workspaceName,
  section,
  tabs,
  back = true,
  actions,
  children,
}: {
  tenantId: string;
  workspaceName: string;
  section: string;
  tabs?: { href: string; label: string; exact?: boolean }[];
  /** A way back to the library. Off while onboarding is the way in. */
  back?: boolean;
  /** Header actions beside the theme toggle. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ToastProvider>
    <div className="h-dvh flex flex-col bg-ground">
      <header className="shrink-0 border-b border-hairline bg-paper">
        <div className="min-h-14 flex items-center gap-3 px-3 min-[900px]:px-5">
          {back ? (
            <Link href={`/w/${tenantId}`} className="inline-flex items-center gap-2 min-h-11 px-3 -ml-2 rounded-full text-sm text-ink-muted hover:bg-hover hover:text-ink">
              <ArrowLeft size={16} aria-hidden="true" /> {workspaceName}
            </Link>
          ) : (
            <span className="inline-flex items-center gap-2.5 min-h-11">
              <LogoMark size={26} />
              <span className="text-sm text-ink-muted hidden sm:inline">{workspaceName}</span>
            </span>
          )}
          <span className="text-ink-faint font-mono" aria-hidden="true">/</span>
          <span className="text-sm font-semibold truncate">{section}</span>
          <span className="flex-1" />
          {actions}
          <ThemeToggle />
        </div>
        {tabs && tabs.length > 0 && <SectionTabs tabs={tabs} />}
      </header>
      <main className="flex-1 relative">
        <PageTransition level="page">{children}</PageTransition>
      </main>
    </div>
    </ToastProvider>
  );
}
