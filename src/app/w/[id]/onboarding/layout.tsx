import { workspaceScope } from "@/lib/auth/workspace";
import { getWorkspace } from "@/lib/data/workspaces";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { SectionChrome } from "@/components/section-chrome";
import { WorkspaceShell } from "@/components/workspace-shell";
import { btnClass } from "@/components/btn";
import { finishLaterAction } from "./actions";
import { isOwnSetup } from "./gate";

/**
 * Onboarding: built once per person, in five visible steps (design system §14).
 *
 * While it's the way into someone's own studio it keeps a focused frame: no
 * sidebar and no link back to a library they haven't reached yet; "Finish
 * later" is the way out instead. Once they're set up (or for a coach), it is
 * an ordinary page in the app shell.
 */
export default async function OnboardingLayout({ children, params }: LayoutProps<"/w/[id]/onboarding">) {
  const { id } = await params;
  const { session, scope } = await workspaceScope(id);
  const pack = await loadPackForWorkspace(scope);
  if (!isOwnSetup(session, pack)) {
    return <WorkspaceShell tenantId={id} section="Set up your voice">{children}</WorkspaceShell>;
  }
  const ws = await getWorkspace(scope);
  return (
    <SectionChrome
      tenantId={id}
      workspaceName={ws?.name ?? "Workspace"}
      section="Set up your voice"
      back={false}
      actions={
        <form action={finishLaterAction.bind(null, id)}>
          {/* Everything is already saved; the next sign-in resumes at the step reached. */}
          <button type="submit" className={btnClass("ghost", "sm")}>Finish later</button>
        </form>
      }
    >
      {children}
    </SectionChrome>
  );
}
