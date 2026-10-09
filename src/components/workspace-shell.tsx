/**
 * The app shell with its data: loads what the sidebar shows (the workspaces
 * this person can open, starred projects, this month's AI use) and applies
 * the workspace's own accent, so a white-labelled workspace looks like itself
 * on every page, not only in the editor.
 *
 * Server-only.
 */
import type { CSSProperties, ReactNode } from "react";
import { workspaceScope } from "@/lib/auth/workspace";
import { getWorkspace, listWorkspaceNames } from "@/lib/data/workspaces";
import { listProjects } from "@/lib/data/projects";
import { loadUsage } from "@/lib/data/insights";
import { isPlatformAdmin } from "@/lib/auth/types";
import { AppShell, type ShellTab } from "./app-shell";

export async function WorkspaceShell({ tenantId, section, tabs, actions, children }: {
  tenantId: string; section?: string; tabs?: ShellTab[]; actions?: ReactNode; children: ReactNode;
}) {
  const { session, scope } = await workspaceScope(tenantId);
  const [ws, names, projects, usage] = await Promise.all([
    getWorkspace(scope),
    listWorkspaceNames(session),
    listProjects(scope),
    loadUsage(scope),
  ]);
  const accent = typeof ws?.branding?.accent === "string" ? (ws.branding.accent as string) : null;
  return (
    <div style={accent ? ({ ["--accent" as string]: accent } as CSSProperties) : undefined}>
      <AppShell
        nav={{
          workspace: { id: tenantId, name: ws?.name ?? "Workspace" },
          workspaces: names.filter((w) => w.status !== "archived").map((w) => ({ id: w.id, name: w.name })),
          user: { email: session.email, role: session.role },
          isAdmin: isPlatformAdmin(session.role),
          starred: projects.filter((p) => p.starred).map((p) => ({ id: p.id, name: p.name })),
          usage: { used: usage.textThisMonth + usage.imagesThisMonth, cap: usage.caps.textHard },
        }}
        section={section}
        tabs={tabs}
        actions={actions}
      >
        {children}
      </AppShell>
    </div>
  );
}
