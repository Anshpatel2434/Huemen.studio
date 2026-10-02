import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { workspaceScope } from "@/lib/auth/workspace";
import { listProjects } from "@/lib/data/projects";
import { getWorkspace } from "@/lib/data/workspaces";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { approvedSince } from "@/lib/data/training";
import { resumeStep } from "@/lib/data/onboarding";
import { rescanDue } from "@/lib/voice/lifecycle";
import { LATER_COOKIE, mustOnboard } from "../onboarding/gate";
import { ProjectsHome } from "./projects-home";

export const metadata = { title: "Projects" };

export default async function WorkspaceHome({ params, searchParams }: PageProps<"/w/[id]">) {
  const { id } = await params;
  const { view, q, ready } = await searchParams;
  const { session, scope } = await workspaceScope(id);
  const v = view === "all" || view === "archived" ? view : "recents";
  const [jar, pack] = await Promise.all([cookies(), loadPackForWorkspace(scope)]);
  // Every way in (invite, sign-in link, /dashboard) lands here first, so this
  // is the one place a client who hasn't set up their voice is sent to do it.
  if (mustOnboard(session, pack, id, jar.get(LATER_COOKIE)?.value)) {
    redirect(`/w/${id}/onboarding?step=${resumeStep(pack!.onboarding)}`);
  }
  const [ws, projects] = await Promise.all([getWorkspace(scope), listProjects(scope, { archived: v === "archived" })]);
  const due = pack ? rescanDue(pack, await approvedSince(scope, pack.scannedAt), Date.now()) : null;
  return (
    <ProjectsHome
      tenantId={id}
      workspaceName={ws?.name ?? "Workspace"}
      projects={projects}
      view={v}
      initialQuery={typeof q === "string" ? q : ""}
      showHero={jar.get("huemen_hero")?.value !== "0" && v !== "archived"}
      showWhatsNew={jar.get("huemen_seen_projects")?.value !== "1"}
      setupStep={pack && !pack.onboarding.completedAt ? resumeStep(pack.onboarding) : null}
      rescanDays={due?.due ? due.days : null}
      justFinished={ready === "1" && !!pack?.onboarding.completedAt}
    />
  );
}
