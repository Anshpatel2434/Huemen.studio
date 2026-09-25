/**
 * GET /w/[id]/p/[pid]/export/pdf?scope=approved|all — the brand brief as a PDF:
 * cover, brief, voice, visual identity, pillars, offers, calendar and the
 * pieces. Same access rules as every workspace page (resolveScope + RLS);
 * no access → 404.
 */
import { getSession } from "@/lib/auth";
import { resolveScope } from "@/lib/auth/scope";
import { getProject, type ProjectScope } from "@/lib/data/projects";
import { loadFoundation } from "@/lib/data/foundation";
import { listContent } from "@/lib/data/content";
import { listCalendar, listOffers, listPillars } from "@/lib/data/planning";
import { buildPdf } from "@/lib/export/pdf";

export async function GET(req: Request, ctx: RouteContext<"/w/[id]/p/[pid]/export/pdf">) {
  const { id, pid } = await ctx.params;
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  let scope: ProjectScope;
  try {
    const ws = { ...(await resolveScope(session, id)), tenantId: id, isPlatformAdmin: false };
    if (!(await getProject(ws, pid))) throw new Error("no project");
    scope = { ...ws, projectId: pid };
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const onlyApproved = new URL(req.url).searchParams.get("scope") === "approved";

  const [project, foundation, pillars, content, offers, calendar] = await Promise.all([
    getProject(scope, pid), loadFoundation(scope), listPillars(scope), listContent(scope), listOffers(scope),
    listCalendar(scope, "1900-01-01", "2999-12-31"),
  ]);
  const name = project?.name ?? "Brand";
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
  const file = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brand"}-brief.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "private, no-store",
    },
  });
}
