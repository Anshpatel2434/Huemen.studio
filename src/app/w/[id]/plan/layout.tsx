import { workspaceScope } from "@/lib/auth/workspace";
import { getWorkspace } from "@/lib/data/workspaces";
import { SectionChrome } from "@/components/section-chrome";

/** Planning: ideas, calendar and offers, for the whole workspace. */
export default async function PlanLayout({ children, params }: LayoutProps<"/w/[id]/plan">) {
  const { id } = await params;
  const { scope } = await workspaceScope(id);
  const ws = await getWorkspace(scope);
  const base = `/w/${id}/plan`;
  return (
    <SectionChrome
      tenantId={id}
      workspaceName={ws?.name ?? "Workspace"}
      section="Plan"
      tabs={[
        { href: `${base}/ideas`, label: "Ideas" },
        { href: `${base}/calendar`, label: "Calendar" },
        { href: `${base}/offers`, label: "Offers" },
      ]}
    >
      {children}
    </SectionChrome>
  );
}

