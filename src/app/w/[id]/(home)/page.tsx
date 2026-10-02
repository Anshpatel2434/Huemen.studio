import { cookies } from "next/headers";
import { workspaceScope } from "@/lib/auth/workspace";
import { listProjects } from "@/lib/data/projects";
import { getWorkspace } from "@/lib/data/workspaces";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { approvedSince } from "@/lib/data/training";
import { rescanDue } from "@/lib/voice/lifecycle";
import { ProjectsHome } from "./projects-home";

export const metadata = { title: "Projects" };

export default async function WorkspaceHome({ params, searchParams }: PageProps<"/w/[id]">) {
  const { id } = await params;
  const { view, q } = await searchParams;
  const { scope } = await workspaceScope(id);
  const v = view === "all" || view === "archived" ? view : "recents";
  const [ws, projects, jar, pack] = await Promise.all([
    getWorkspace(scope),
    listProjects(scope, { archived: v === "archived" }),
    cookies(),
    loadPackForWorkspace(scope),
  ]);
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
      setupStep={pack && !pack.onboarding.completedAt ? Math.max(1, pack.onboarding.step ?? 1) : null}
      rescanDays={due?.due ? due.days : null}
    />
  );
}
