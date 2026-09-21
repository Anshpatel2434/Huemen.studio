import { projectScope } from "@/lib/auth/workspace";
import { listContent } from "@/lib/data/content";
import { loadFoundation } from "@/lib/data/foundation";
import { listVisuals } from "@/lib/data/pipeline";
import { stageIndex } from "@/lib/projects/stages";
import { LockedStep } from "@/components/locked-step";
import { VisualBoard } from "./visual-board";

export const metadata = { title: "Visual" };

export default async function VisualPage({ params, searchParams }: PageProps<"/w/[id]/p/[pid]/visual">) {
  const { id, pid } = await params;
  const sp = await searchParams;
  const { scope, project } = await projectScope(id, pid);
  const base = `/w/${id}/p/${pid}`;
  if (stageIndex(project.stage) < stageIndex("content")) {
    return <LockedStep step={4} title="Visual" needs="Visuals are designed from your drafted content. Generate content from your pillars first." href={stageIndex(project.stage) >= stageIndex("pillars") ? `${base}/pillars` : `${base}/brief/questions`} cta="Go to the current step" />;
  }
  const [items, f, visuals] = await Promise.all([listContent(scope), loadFoundation(scope), listVisuals(scope)]);
  const schemeOf = new Map(visuals.map((v) => [v.contentItemId, v.scheme]));
  const palette = f.palette.split(",").map((s) => s.trim()).filter((s) => /^#[0-9a-f]{3,8}$/i.test(s));
  const fonts = f.fonts.split(",").map((s) => s.trim()).filter(Boolean);

  return (
    <VisualBoard
      tenantId={id}
      projectId={pid}
      brandName={project.name}
      items={items.map((i) => ({ id: i.id, format: i.format, hook: i.hook, body: i.body, cta: i.cta, status: i.status, pillarName: i.pillarName, scheme: schemeOf.get(i.id) ?? null }))}
      palette={palette}
      fonts={fonts}
      imageStyle={f.imageStyleNotes}
      selectedId={typeof sp.item === "string" ? sp.item : null}
      initialScheme={visuals[0]?.scheme ?? 0}
    />
  );
}
