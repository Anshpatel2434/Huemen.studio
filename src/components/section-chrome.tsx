import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme";
import { PageTransition } from "@/components/page-transition";
import { SectionTabs } from "./section-tabs";
import { ToastProvider } from "./ui";

/**
 * The chrome for a workspace-level section: Brand core, Plan, Create, Check,
 * Onboarding. These sit above any one piece, so they get a plain header with a
 * way back to the library and the section's own tabs, not the piece editor.
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
        <div className="h-12 flex items-center gap-3 px-4">
          {back ? (
            <Link
              href={`/w/${tenantId}`}
              className="hu-hit flex items-center gap-1.5 h-8 px-2.5 rounded-[8px] text-[0.82rem] hover:bg-field"
            >
              <ArrowLeft size={14} aria-hidden="true" /> {workspaceName}
            </Link>
          ) : (
            <span className="h-8 px-2.5 flex items-center text-[0.82rem] text-ink-muted">{workspaceName}</span>
          )}
          <span className="text-ink-faint" aria-hidden="true">/</span>
          <span className="text-[0.82rem] font-medium">{section}</span>
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
