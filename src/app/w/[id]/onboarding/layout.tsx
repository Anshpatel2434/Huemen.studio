import { workspaceScope } from "@/lib/auth/workspace";
import { getWorkspace } from "@/lib/data/workspaces";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { SectionChrome } from "@/components/section-chrome";
import { btnClass } from "@/components/btn";
import { finishLaterAction } from "./actions";
import { isOwnSetup } from "./gate";

/**
 * Onboarding: built once per person, in five visible steps (design system §14).
 *
 * While it's the way into someone's own studio, the header has no link back to
 * a library they haven't reached yet; "Finish later" is the way out instead.
 * Once they're set up (or for a coach), it's an ordinary section.
 */
export default async function OnboardingLayout({ children, params }: LayoutProps<"/w/[id]/onboarding">) {
  const { id } = await params;
  const { session, scope } = await workspaceScope(id);
  const [ws, pack] = await Promise.all([getWorkspace(scope), loadPackForWorkspace(scope)]);
  const gated = isOwnSetup(session, pack);
  return (
    <SectionChrome
      tenantId={id}
      workspaceName={ws?.name ?? "Workspace"}
      section="Set up your voice"
      back={!gated}
      actions={
        gated ? (
          <form action={finishLaterAction.bind(null, id)}>
            {/* Everything is already saved; the next sign-in resumes at the step reached. */}
            <button type="submit" className={btnClass("ghost", "sm")}>Finish later</button>
          </form>
        ) : null
      }
    >
      {children}
    </SectionChrome>
  );
}
