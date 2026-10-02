import { workspaceScope } from "@/lib/auth/workspace";
import { getWorkspace } from "@/lib/data/workspaces";
import { SectionChrome } from "@/components/section-chrome";

/** Check: any draft, from anywhere, against the person's voice. */
export default async function CheckLayout({ children, params }: LayoutProps<"/w/[id]/check">) {
  const { id } = await params;
  const { scope } = await workspaceScope(id);
  const ws = await getWorkspace(scope);
  return (
    <SectionChrome tenantId={id} workspaceName={ws?.name ?? "Workspace"} section="Check">
      {children}
    </SectionChrome>
  );
}
