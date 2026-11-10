import { WorkspaceShell } from "@/components/workspace-shell";

/** Check: any draft, from anywhere, against the person's voice. */
export default async function CheckLayout({ children, params }: LayoutProps<"/w/[id]/check">) {
  const { id } = await params;
  return <WorkspaceShell tenantId={id} section="Check">{children}</WorkspaceShell>;
}
