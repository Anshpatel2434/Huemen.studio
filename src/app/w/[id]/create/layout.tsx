import { workspaceScope } from "@/lib/auth/workspace";
import { getWorkspace } from "@/lib/data/workspaces";
import { SectionChrome } from "@/components/section-chrome";

/** Create: where every new piece starts. */
export default async function CreateLayout({ children, params }: LayoutProps<"/w/[id]/create">) {
  const { id } = await params;
  const { scope } = await workspaceScope(id);
  const ws = await getWorkspace(scope);
  return (
    <SectionChrome tenantId={id} workspaceName={ws?.name ?? "Workspace"} section="Create">
      {children}
    </SectionChrome>
  );
}
