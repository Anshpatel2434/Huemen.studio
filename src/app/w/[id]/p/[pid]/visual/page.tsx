import { projectScope } from "@/lib/auth/workspace";
import { listContent } from "@/lib/data/content";
import { loadFoundation } from "@/lib/data/foundation";
import { listVisuals } from "@/lib/data/pipeline";
import { getWorkspace } from "@/lib/data/workspaces";
import { logoUrl } from "@/lib/data/assets";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { stageIndex } from "@/lib/projects/stages";
import { LockedStep } from "@/components/locked-step";
import { VisualBoard } from "./visual-board";
import { pictureInfo } from "@/lib/data/pictures";
import { listComments } from "@/lib/data/visual-comments";
import { activeJobsFor } from "@/lib/jobs";
import { ARTBOARDS, type ArtboardKind } from "@/lib/visual/design";

export const metadata = { title: "Visual" };
// Pictures and area redraws start the job queue after the action responds (lib/jobs).
export const maxDuration = 300;

const ARTBOARD_OF: Record<string, ArtboardKind> = { single: "post", quote_card: "quote", carousel_frame: "carousel" };

export default async function VisualPage({ params, searchParams }: PageProps<"/w/[id]/p/[pid]/visual">) {
  const { id, pid } = await params;
  const sp = await searchParams;
  const { scope, project } = await projectScope(id, pid);
  const base = `/w/${id}/p/${pid}`;
  if (stageIndex(project.stage) < stageIndex("content")) {
    return <LockedStep stage="visual" needs="Visuals are designed from your drafted copy. Write the piece first." href={`${base}/content`} cta="Go to Content" />;
  }
  const [items, f, visuals, ws, pack, logo, comments, jobs] = await Promise.all([
    listContent(scope), loadFoundation(scope), listVisuals(scope), getWorkspace(scope), loadPackForWorkspace(scope), logoUrl(scope),
    listComments(scope), activeJobsFor(scope, ["picture_generate", "picture_edit"], pid),
  ]);
  // The sign-off on a visual is the PERSON (their voice pack's name), else the
  // workspace; never the piece's own title, which is what a project is now.
  const brandName = pack?.displayName?.trim() || ws?.name || "Your brand";
  const schemeOf = new Map(visuals.map((v) => [v.contentItemId, v.scheme]));
  const designOf = new Map(visuals.map((v) => [v.contentItemId, v.design]));
  const visualIds = new Map<string, Partial<Record<ArtboardKind, string>>>();
  for (const v of visuals) {
    const k = ARTBOARD_OF[v.kind];
    if (k) visualIds.set(v.contentItemId, { ...visualIds.get(v.contentItemId), [k]: v.id });
  }
  const inUse = [...designOf.values()].flatMap((d) => ARTBOARDS.map((k) => d.pictures[k]?.id).filter((x): x is string => !!x));
  const pictures = await pictureInfo(scope, inUse);
  // Work still running when the page loads keeps its "drawing" overlay.
  const visualById = new Map(visuals.map((v) => [v.id, v]));
  const watching = jobs.flatMap((j) => {
    if (j.kind === "picture_generate") return [{ jobId: j.id, contentItemId: String(j.payload.contentItemId), artboard: String(j.payload.artboard), label: "Drawing a picture" }];
    const c = comments.find((x) => x.id === j.payload.commentId);
    const v = c && visualById.get(c.visualId);
    return c && v ? [{ jobId: j.id, contentItemId: c.contentItemId, artboard: ARTBOARD_OF[v.kind] ?? "post", label: "Changing the picture" }] : [];
  });
  const palette = f.palette.split(",").map((s) => s.trim()).filter((s) => /^#[0-9a-f]{3,8}$/i.test(s));
  const fonts = f.fonts.split(",").map((s) => s.trim()).filter(Boolean);

  return (
    <VisualBoard
      tenantId={id}
      projectId={pid}
      brandName={brandName}
      logo={logo}
      items={items.map((i) => ({ id: i.id, format: i.format, hook: i.hook, body: i.body, cta: i.cta, status: i.status, pillarName: i.pillarName, scheme: schemeOf.get(i.id) ?? null, design: designOf.get(i.id) ?? null, visuals: visualIds.get(i.id) ?? {} }))}
      pictures={pictures}
      comments={comments}
      jobs={watching}
      palette={palette}
      fonts={fonts}
      imageStyle={f.imageStyleNotes}
      selectedId={typeof sp.item === "string" ? sp.item : null}
      initialScheme={visuals[0]?.scheme ?? 0}
    />
  );
}
