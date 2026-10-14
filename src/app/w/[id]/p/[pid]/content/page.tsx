import { Suspense } from "react";
import { CheckCircle2 } from "lucide-react";
import { LiveDraftLayer } from "@/components/live-draft";
import { projectScope } from "@/lib/auth/workspace";
import { listContent } from "@/lib/data/content";
import { listPillars } from "@/lib/data/planning";
import { loadBrandContext } from "@/lib/context/context-loader";
import { stageIndex, stepLabel } from "@/lib/projects/stages";
import { LockedStep } from "@/components/locked-step";
import { StepPanel, PanelSection } from "@/components/step-panel";
import { SubmitButton } from "@/components/ui";
import { BrandCheck } from "@/components/brand-check";
import { generateVisualsAction } from "../pipeline-actions";
import { ContentBoard } from "./content-board";
import { WritePiece } from "./write-piece";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { getWorkspace } from "@/lib/data/workspaces";
import { confidence } from "@/lib/voice/derive";

export const metadata = { title: "Content" };

export default async function ContentPage({ params, searchParams }: PageProps<"/w/[id]/p/[pid]/content">) {
  const { id, pid } = await params;
  const sp = await searchParams;
  const { scope, project } = await projectScope(id, pid);
  const base = `/w/${id}/p/${pid}`;
  if (stageIndex(project.stage) < stageIndex("content")) {
    return (
      <LockedStep
        stage="content"
        needs="Say what this piece is about first: its format, its pillar and its angle."
        href={`${base}/ideate`}
        cta="Go to Ideate"
      />
    );
  }
  const [items, pillars, ctx, pack, ws] = await Promise.all([listContent(scope), listPillars(scope), loadBrandContext(scope), loadPackForWorkspace(scope), getWorkspace(scope)]);
  // The author shown on the post wireframes: the person, else the workspace.
  const brandName = pack?.displayName?.trim() || ws?.name || "Your brand";
  const approved = items.filter((i) => i.status === "approved").length;
  const flagged = items.filter((i) => i.violations.length).length;
  const visualDone = stageIndex(project.stage) >= stageIndex("visual");
  const stats: [string, number][] = [["Pieces", items.length], ["Approved", approved], ["Flagged", flagged]];

  const conf = pack ? confidence(pack) : null;

  return (
    <>
      <div className="absolute inset-0 min-[900px]:right-[280px]">
        {items.length === 0 ? (
          <WritePiece
            tenantId={id}
            projectId={pid}
            pillarId={project.pillarId}
            topic={project.name}
            format={project.format}
            angle={project.angle}
            mode={pack?.workMode ?? "ghostwrite"}
            confidence={conf ? { score: conf.score, missing: conf.missing } : null}
          />
        ) : (
        <ContentBoard
          tenantId={id}
          projectId={pid}
          brandName={brandName}
          items={items}
          pillars={pillars.map((p) => ({ id: p.id, name: p.name }))}
          selectedId={typeof sp.item === "string" ? sp.item : null}
          degraded={ctx.degraded}
          dontWords={ctx.guardrails.dontWords}
        />
        )}
        <Suspense fallback={null}>
          <LiveDraftLayer tenantId={id} projectId={pid} brandName={brandName} />
        </Suspense>
      </div>
      <StepPanel eyebrow={stepLabel("content")} title="Content">
        {sp.generated && (
          <p className="flex items-start gap-2 text-xs text-ok bg-ok-soft rounded-sm px-2.5 py-2"><CheckCircle2 size={14} className="shrink-0 mt-px" /> {String(sp.generated)} piece{sp.generated === "1" ? "" : "s"} drafted from your pillars.</p>
        )}
        <PanelSection title="On the canvas">
          <div className="grid grid-cols-3 gap-1.5 text-center">
            {stats.map(([k, v]) => (
              <div key={k} className="bg-panel rounded-sm py-2"><p className="text-base tabular-nums">{v}</p><p className="text-xs text-ink-faint">{k}</p></div>
            ))}
          </div>
          {conf && <p className="text-xs text-ink-muted mt-2">Voice core: <span className={conf.score < 70 ? "text-warn font-medium" : "font-medium"}>{conf.score}% confident</span>{conf.score < 70 ? ", still learning" : ""}</p>}
          <p className="text-xs text-ink-muted mt-2 leading-relaxed">Press Edit on any post to change it, ask for a change in your own words, or approve it. On the canvas you can also double-click text to edit it in place, and drag a post by its label to another pillar.</p>
        </PanelSection>
        {(() => {
          const checkItem = items.find((i) => i.id === (typeof sp.item === "string" ? sp.item : null)) ?? items[0];
          return checkItem ? (
            <PanelSection title="Brand check">
              <p className="text-xs text-ink-muted mb-2.5 leading-relaxed">Score {checkItem.hook ? `“${checkItem.hook.slice(0, 32)}${checkItem.hook.length > 32 ? "…" : ""}”` : "the selected post"} against your voice. Findings cite your own writing, never block publishing.</p>
              <BrandCheck key={checkItem.id} tenantId={id} projectId={pid} itemId={checkItem.id} />
            </PanelSection>
          ) : null;
        })()}
        <form action={generateVisualsAction} className="flex flex-col gap-3 border-t border-hairline pt-4">
          <input type="hidden" name="tenantId" value={id} />
          <input type="hidden" name="projectId" value={pid} />
          <input type="hidden" name="scheme" value="0" />
          <p className="text-xs font-medium">Next: generate visuals</p>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="approvedOnly" disabled={approved === 0} defaultChecked={approved > 0} /> Approved pieces only ({approved})</label>
          <SubmitButton variant="primary" size="sm" pendingLabel="Designing…" className="w-full">{visualDone ? "Regenerate visuals →" : "Generate visuals →"}</SubmitButton>
          <p className="text-xs text-ink-faint">Post image, quote card and carousel for each piece: real text over your brand colours.</p>
        </form>
      </StepPanel>
    </>
  );
}
