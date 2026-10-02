import { workspaceScope } from "@/lib/auth/workspace";
import { getWorkspace } from "@/lib/data/workspaces";
import { SectionChrome } from "@/components/section-chrome";

/**
 * Brand core: brief, voice, pillars and visual. Set once in onboarding, refined here,
 * read by every piece. None of it changes from one post to the next, so it
 * lives above the editor for any one of them.
 */
export default async function BrandLayout({ children, params }: LayoutProps<"/w/[id]/brand">) {
  const { id } = await params;
  const { scope } = await workspaceScope(id);
  const ws = await getWorkspace(scope);
  const base = `/w/${id}/brand`;
  return (
    <SectionChrome
      tenantId={id}
      workspaceName={ws?.name ?? "Workspace"}
      section="Brand core"
      tabs={[
        { href: base, label: "Brief", exact: true },
        { href: `${base}/voice`, label: "Voice" },
        { href: `${base}/pillars`, label: "Pillars" },
        { href: `${base}/visual`, label: "Visual" },
      ]}
    >
      {children}
    </SectionChrome>
  );
}
