/**
 * GET /w/[id]/p/[pid]/export/pdf?scope=approved|all — the brand brief as a PDF:
 * cover, brief, voice, visual identity, pillars, offers, calendar and the
 * pieces. Same access rules as every workspace page (resolveScope + RLS);
 * no access → 404.
 */
import { getSession } from "@/lib/auth";
import { resolveScope } from "@/lib/auth/scope";
import { getProject, type ProjectScope } from "@/lib/data/projects";
import { getWorkspace } from "@/lib/data/workspaces";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { loadFoundation } from "@/lib/data/foundation";
import { listContent } from "@/lib/data/content";
import { listCalendar, listOffers, listPillars } from "@/lib/data/planning";
import { buildPdf } from "@/lib/export/pdf";
import { exportFileName } from "@/lib/export/markdown";

export async function GET(req: Request, ctx: RouteContext<"/w/[id]/p/[pid]/export/pdf">) {
  const { id, pid } = await ctx.params;
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  let scope: ProjectScope;
  let projectName = "";
  try {
    const ws = { ...(await resolveScope(session, id)), tenantId: id, isPlatformAdmin: false };
    const project = await getProject(ws, pid);
    if (!project) throw new Error("no project");
    projectName = project.name;
    scope = { ...ws, projectId: pid };
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const onlyApproved = new URL(req.url).searchParams.get("scope") === "approved";

  const [foundation, pillars, content, offers, calendar, workspace, pack] = await Promise.all([
    loadFoundation(scope), listPillars(scope), listContent(scope), listOffers(scope),
    listCalendar(scope, "1900-01-01", "2999-12-31"), getWorkspace(scope), loadPackForWorkspace(scope),
  ]);
  // Same rule as the Markdown export: "approved only" needs something approved.
  if (onlyApproved && !content.some((c) => c.status === "approved")) {
    return new Response("Nothing is approved yet. Approve a piece on the Content step, or export everything.", { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  // The export is the BRAND's: the person's name, else the workspace. A project
  // is one piece, so its title is never the brand.
  const name = pack?.displayName?.trim() || workspace?.name || "Brand";
  const pdf = await buildPdf({
    brandName: name,
    foundation,
    pillars,
    content: onlyApproved ? content.filter((c) => c.status === "approved") : content,
    calendar,
    offers,
    generatedAt: new Date(),
    scopeLabel: onlyApproved ? "Approved pieces only" : "Every piece, including drafts",
  });
  const file = exportFileName(name, projectName, "pdf");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "private, no-store",
    },
  });
}
