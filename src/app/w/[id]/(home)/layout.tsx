import { WorkspaceShell } from "@/components/workspace-shell";

export const dynamic = "force-dynamic";

/** Workspace home and Usage, in the app shell (design system §14). */
export default async function HomeLayout({ children, params }: LayoutProps<"/w/[id]">) {
  const { id } = await params;
  return <WorkspaceShell tenantId={id}>{children}</WorkspaceShell>;
}
