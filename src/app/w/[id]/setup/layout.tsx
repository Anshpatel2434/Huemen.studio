import { WorkspaceShell } from "@/components/workspace-shell";

/** Getting started lives in the ordinary app shell: by now the studio is theirs. */
export default async function SetupLayout({ children, params }: LayoutProps<"/w/[id]/setup">) {
  const { id } = await params;
  return <WorkspaceShell tenantId={id} section="Getting started">{children}</WorkspaceShell>;
}
