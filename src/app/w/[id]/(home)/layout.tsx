import { workspaceScope } from "@/lib/auth/workspace";
import { listWorkspaceNames, getWorkspace } from "@/lib/data/workspaces";
import { listProjects } from "@/lib/data/projects";
import { loadUsage } from "@/lib/data/insights";
import { isPlatformAdmin } from "@/lib/auth/types";
import { ToastProvider } from "@/components/ui";
import { PageTransition } from "@/components/page-transition";
import { HomeSidebar } from "./sidebar";

export const dynamic = "force-dynamic";

/** Workspace home chrome (Figma file browser): sidebar + main. Not used by the project editor. */
export default async function HomeLayout({ children, params }: LayoutProps<"/w/[id]">) {
  const { id } = await params;
  const { session, scope } = await workspaceScope(id);
  const [ws, names, projects, usage] = await Promise.all([
    getWorkspace(scope),
    listWorkspaceNames(session),
    listProjects(scope),
    loadUsage(scope),
  ]);
  return (
    <ToastProvider>
      <div className="h-screen flex">
        <HomeSidebar
          workspace={{ id, name: ws?.name ?? "Workspace" }}
          workspaces={names.filter((w) => w.status !== "archived").map((w) => ({ id: w.id, name: w.name }))}
          user={{ email: session.email, role: session.role }}
          isAdmin={isPlatformAdmin(session.role)}
          starred={projects.filter((p) => p.starred).map((p) => ({ id: p.id, name: p.name }))}
          usage={{ used: usage.textThisMonth + usage.imagesThisMonth, cap: usage.caps.textHard }}
        />
        <main className="flex-1 min-w-0 relative">
          <PageTransition level="page">{children}</PageTransition>
        </main>
      </div>
    </ToastProvider>
  );
}
