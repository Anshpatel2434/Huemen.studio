import { workspaceScope } from "@/lib/auth/workspace";
import { getWorkspace } from "@/lib/data/workspaces";
import { SectionChrome } from "@/components/section-chrome";

/** Onboarding: built once per person, in four visible steps (design system §14). */
export default async function OnboardingLayout({ children, params }: LayoutProps<"/w/[id]/onboarding">) {
  const { id } = await params;
  const { scope } = await workspaceScope(id);
  const ws = await getWorkspace(scope);
  return (
    <SectionChrome tenantId={id} workspaceName={ws?.name ?? "Workspace"} section="Set up your voice">
      {children}
    </SectionChrome>
  );
}
