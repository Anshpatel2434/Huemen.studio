import { WorkspaceShell } from "@/components/workspace-shell";

/** Create: where every new piece starts. */
export default async function CreateLayout({ children, params }: LayoutProps<"/w/[id]/create">) {
  const { id } = await params;
  return <WorkspaceShell tenantId={id} section="Create">{children}</WorkspaceShell>;
}
