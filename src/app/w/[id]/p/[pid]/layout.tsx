import { withTenantSession } from "@/db/session";
import { projectScope } from "@/lib/auth/workspace";
import { getWorkspace } from "@/lib/data/workspaces";
import { loadBrandContext } from "@/lib/context/context-loader";
import { listPillars } from "@/lib/data/planning";
import { listContent } from "@/lib/data/content";
import { signQuestionnaireToken } from "@/lib/invite/token";
import { getEnv } from "@/lib/env";
import { ProjectShell } from "./shell";

export const dynamic = "force-dynamic";

export default async function ProjectLayout({ children, params }: LayoutProps<"/w/[id]/p/[pid]">) {
  const { id, pid } = await params;
  const { session, scope, project } = await projectScope(id, pid);

  const [workspace, ctx, pillars, content, members] = await Promise.all([
    getWorkspace(scope),
    loadBrandContext(scope),
    listPillars(scope),
    listContent(scope),
    withTenantSession(scope, async (c) =>
      (await c.query<{ email: string; role: string; status: string }>("SELECT email, role, status FROM users ORDER BY role, email")).rows,
    ),
  ]);
  const env = getEnv();
  const accent = typeof workspace?.branding?.accent === "string" ? (workspace.branding.accent as string) : null;

  return (
    <div style={accent ? ({ ["--accent" as string]: accent } as React.CSSProperties) : undefined}>
      <ProjectShell
        workspace={{ id, name: workspace?.name ?? "Workspace" }}
        project={{ id: pid, name: project.name, stage: project.stage }}
        user={{ email: session.email, role: session.role }}
        brief={{ completeness: ctx.completeness, degraded: ctx.degraded }}
        layers={{
          pillars: pillars.map((p) => ({ id: p.id, name: p.name, count: p.contentCount })),
          content: content.map((c) => ({ id: c.id, name: c.hook || "Untitled", status: c.status, flagged: c.violations.length > 0 })),
        }}
        members={members}
        questionnaireUrl={session.role === "client" ? null : `${env.APP_URL}/q/${signQuestionnaireToken(id)}`}
        aiMock={env.AI_TEXT_PROVIDER === "mock"}
      >
        {children}
      </ProjectShell>
    </div>
  );
}
