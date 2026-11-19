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
import { pictureVersions } from "@/lib/data/pictures";
import { listComments } from "@/lib/data/visual-comments";
import { watchedPictureJobs } from "@/lib/data/picture-jobs";
import { cutoutStatus } from "@/lib/ai/cutout";
import type { ArtboardKind } from "@/lib/visual/design";
import { schemeIndex } from "@/lib/visual/schemes";
import { stripMarkers } from "@/lib/visual/markers";
import { brandFontUploads } from "@/lib/visual/brand-fonts";
import { planBrandFonts } from "@/lib/visual/fonts";

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
  const [items, f, visuals, ws, pack, logo, comments, jobs, fontFiles] = await Promise.all([
    listContent(scope), loadFoundation(scope), listVisuals(scope), getWorkspace(scope), loadPackForWorkspace(scope), logoUrl(scope),
    listComments(scope), watchedPictureJobs(scope), brandFontUploads(scope),
  ]);
  // The sign-off on a visual is the PERSON (their voice pack's name), else the
  // workspace; never the piece's own title, which is what a project is now.
  const brandName = pack?.displayName?.trim() || ws?.name || "Your brand";
  const palette = f.palette.split(",").map((s) => s.trim()).filter((s) => /^#[0-9a-f]{3,8}$/i.test(s));
  const fonts = f.fonts.split(",").map((s) => s.trim()).filter(Boolean);
  // The brand fonts are loaded on this page: an uploaded file first, else Google (lib/visual/fonts).
  const fontPlan = planBrandFonts(fonts, fontFiles);
  // A scheme index saved before the palette was read as [ground, accent, ink]
  // is carried over to the scheme it meant (lib/visual/schemes schemeIndex).
  const schemeAt = (v: (typeof visuals)[number]) => schemeIndex(palette, v.scheme, v.schemeOrder);
  const schemeOf = new Map(visuals.map((v) => [v.contentItemId, schemeAt(v)]));
  const designOf = new Map(visuals.map((v) => [v.contentItemId, v.design]));
  const visualIds = new Map<string, Partial<Record<ArtboardKind, string>>>();
  for (const v of visuals) {
    const k = ARTBOARD_OF[v.kind];
    if (k) visualIds.set(v.contentItemId, { ...visualIds.get(v.contentItemId), [k]: v.id });
  }
  // Every version of every picture, not only the ones in use: the board lists
  // them so an earlier picture can be put back after a reload.
  const versions = await pictureVersions(scope);
  // Work still running when the page loads keeps its "drawing" overlay (lib/data/picture-jobs).
  const watching = jobs;
  // Whether Remove background can run on this server; the tool shows disabled with the reason when it can't.
  const cutout = cutoutStatus();

  return (
    <>
    <h1 className="sr-only">Visual: {project.name}</h1>
    <VisualBoard
      tenantId={id}
      projectId={pid}
      brandName={brandName}
      logo={logo}
      // The words on the visuals carry no markdown emphasis (WhatsApp's *bold* and the like): lib/visual/markers.
      items={items.map((i) => ({ id: i.id, format: i.format, hook: stripMarkers(i.hook), body: stripMarkers(i.body), cta: stripMarkers(i.cta), status: i.status, pillarName: i.pillarName, scheme: schemeOf.get(i.id) ?? null, design: designOf.get(i.id) ?? null, visuals: visualIds.get(i.id) ?? {} }))}
      versions={versions}
      comments={comments}
      jobs={watching}
      cutout={cutout}
      palette={palette}
      fonts={fonts}
      fontPlan={fontPlan}
      imageStyle={f.imageStyleNotes}
      selectedId={typeof sp.item === "string" ? sp.item : null}
      initialScheme={visuals[0] ? schemeAt(visuals[0]) : 0}
    />
    </>
  );
}
