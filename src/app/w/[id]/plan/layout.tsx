import { WorkspaceShell } from "@/components/workspace-shell";

/** Planning: ideas, calendar and offers, for the whole workspace. */
export default async function PlanLayout({ children, params }: LayoutProps<"/w/[id]/plan">) {
  const { id } = await params;
  const base = `/w/${id}/plan`;
  return (
    <WorkspaceShell
      tenantId={id}
      section="Plan"
      tabs={[
        { href: `${base}/ideas`, label: "Ideas" },
        { href: `${base}/calendar`, label: "Calendar" },
        { href: `${base}/offers`, label: "Offers" },
      ]}
    >
      {children}
    </WorkspaceShell>
  );
}
