import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { workspaceScope } from "@/lib/auth/workspace";
import { getWorkspace } from "@/lib/data/workspaces";
import { ThemeToggle } from "@/components/theme";
import { PageTransition } from "@/components/page-transition";

/**
 * Onboarding chrome: the brand itself — brief, voice, visual identity, pillars.
 *
 * Set once, here, rather than inside a piece. That is the whole point of the
 * change: none of it differs from one post to the next, so it does not belong
 * in the editor for any one of them.
 *
 * DocPage positions itself absolutely, so this provides the positioned,
 * full-height container it expects.
 */
export default async function BrandLayout({ children, params }: LayoutProps<"/w/[id]/brand">) {
  const { id } = await params;
  const { scope } = await workspaceScope(id);
  const ws = await getWorkspace(scope);

  return (
    <div className="h-dvh flex flex-col bg-ground">
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-hairline bg-paper">
        <Link
          href={`/w/${id}`}
          className="flex items-center gap-1.5 h-8 px-2.5 rounded-[8px] text-[0.82rem] hover:bg-field"
        >
          <ArrowLeft size={14} /> {ws?.name ?? "Workspace"}
        </Link>
        <span className="text-ink-faint">/</span>
        <span className="text-[0.82rem] font-medium">Brand</span>
        <span className="flex-1" />
        <ThemeToggle />
      </header>
      <main className="flex-1 relative">
        <PageTransition level="page">{children}</PageTransition>
      </main>
    </div>
  );
}
