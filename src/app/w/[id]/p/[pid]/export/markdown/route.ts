/**
 * GET /w/[id]/export/markdown?scope=approved|all — Markdown download of the
 * brief, pillars, offers, calendar and content. Same access rules as every
 * workspace page (resolveScope + RLS); no access → 404.
 */
import { getSession } from "@/lib/auth";
import { resolveScope } from "@/lib/auth/scope";
import { getProject, type ProjectScope } from "@/lib/data/projects";
import { getWorkspace } from "@/lib/data/workspaces";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { loadFoundation } from "@/lib/data/foundation";
import { listContent } from "@/lib/data/content";
import { listCalendar, listOffers, listPillars } from "@/lib/data/planning";
import { buildMarkdown, exportFileName } from "@/lib/export/markdown";

export async function GET(req: Request, ctx: RouteContext<"/w/[id]/p/[pid]/export/markdown">) {
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
  // "Approved only" with nothing approved used to download a file with no
  // content in it. The Export page no longer offers it; a link typed by hand
  // gets a plain answer instead of an empty file.
  if (onlyApproved && !content.some((c) => c.status === "approved")) {
    return new Response("Nothing is approved yet. Approve a piece on the Content step, or export everything.", { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  // The export is the BRAND's: the person's name, else the workspace. A project
  // is one piece, so its title is never the brand.
  const name = pack?.displayName?.trim() || workspace?.name || "Brand";
  const md = buildMarkdown({
    brandName: name,
    foundation,
    pillars,
    content: onlyApproved ? content.filter((c) => c.status === "approved") : content,
    calendar,
    offers,
    generatedAt: new Date(),
  });
  // The file says which piece of work it was taken from, so two exports don't share a name.
  const file = exportFileName(name, projectName, "md");
  return new Response(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
