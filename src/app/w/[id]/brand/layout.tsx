import { WorkspaceShell } from "@/components/workspace-shell";

/**
 * Brand core: brief, voice, pillars, visual, and stories and facts. Set once in onboarding, refined here,
 * read by every piece. None of it changes from one post to the next, so it
 * lives above the editor for any one of them.
 */
export default async function BrandLayout({ children, params }: LayoutProps<"/w/[id]/brand">) {
  const { id } = await params;
  const base = `/w/${id}/brand`;
  return (
    <WorkspaceShell
      tenantId={id}
      section="Brand core"
      tabs={[
        { href: base, label: "Brief", exact: true },
        { href: `${base}/voice`, label: "Voice" },
        { href: `${base}/pillars`, label: "Pillars" },
        { href: `${base}/visual`, label: "Visual" },
        { href: `${base}/stories`, label: "Stories and facts" },
      ]}
    >
      {children}
    </WorkspaceShell>
  );
}
