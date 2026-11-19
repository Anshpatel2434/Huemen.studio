import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2 } from "lucide-react";
import { LiveDraftLayer } from "@/components/live-draft";
import { projectScope } from "@/lib/auth/workspace";
import { listContent } from "@/lib/data/content";
import { listPillars } from "@/lib/data/planning";
import { loadBrandContext } from "@/lib/context/context-loader";
import { stageIndex, stepLabel } from "@/lib/projects/stages";
import { LockedStep } from "@/components/locked-step";
import { StepPanel, PanelSection } from "@/components/step-panel";
import { Stage, StageCanvas } from "@/components/project-panels";
import { Choice, SubmitButton } from "@/components/ui";
import { BrandCheck } from "@/components/brand-check";
import { CanvasHistory } from "@/components/canvas-edit";
import { pieceTopic } from "@/lib/data/create";
import { formatByKey, pieceText } from "@/lib/content/formats";
import { platformRule } from "@/lib/voice/platforms";
import { isPlatformAdmin } from "@/lib/auth/types";
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
  const { session, scope, project } = await projectScope(id, pid);
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

  const writing = items.length === 0 || sp.write === "1";

  // One undo history for the whole step, so a fix applied from the Brand
  // check panel undoes with Ctrl/Cmd+Z exactly like an edit made on the canvas.
  return (
    <CanvasHistory>
    <Stage>
      <StageCanvas>
        {/* The writing screen has the topic as its heading; the board needs one of its own. */}
        {!writing && <h1 className="sr-only">Content: {project.name}</h1>}
        {items.length > 0 && sp.write === "1" && (
          <div className="hu-strip absolute top-3 left-3 z-10">
            <Link href={`/w/${id}/p/${pid}/content`} className="hu-strip__btn">
              <ArrowLeft size={15} aria-hidden="true" /> Back to {items.length === 1 ? "the draft" : `the ${items.length} drafts`}
            </Link>
          </div>
        )}
        {writing ? (
          <WritePiece
            tenantId={id}
            projectId={pid}
            pillarId={project.pillarId}
            // The whole topic, not the name cut for the card (lib/data/create).
            topic={pieceTopic(project)}
            title={project.name}
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
          projectFormat={project.format}
          projectPillarId={project.pillarId}
          degraded={ctx.degraded}
          dontWords={ctx.guardrails.dontWords}
          // Which prompt template wrote a piece is for the people who edit
          // templates (Settings › Prompts), not for a client.
          showTemplate={isPlatformAdmin(session.role)}
        />
        )}
        <Suspense fallback={null}>
          <LiveDraftLayer tenantId={id} projectId={pid} brandName={brandName} />
        </Suspense>
      </StageCanvas>
      <StepPanel eyebrow={stepLabel("content")} title="Content">
        {ctx.degraded && (
          <p className="flex items-start gap-2 text-xs text-accent-ink bg-accent-soft rounded-sm px-2.5 py-2"><AlertTriangle size={14} className="shrink-0 mt-px" aria-hidden="true" /> The brief is thin, so drafts will read generic. Filling it in is worth it.</p>
        )}
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
              {/* Keyed by the piece only: the panel is given the copy and marks its own
                  verdict stale when the copy changes, so applying one fix keeps the rest. */}
              <BrandCheck
                key={checkItem.id}
                tenantId={id}
                projectId={pid}
                itemId={checkItem.id}
                copy={pieceText(checkItem)}
                limit={(() => {
                  // Only a short hard cap is counted on the piece (X 280, Threads 500); a long one is noise.
                  const rule = platformRule(formatByKey(checkItem.format).platform);
                  return rule?.maxChars != null && rule.maxChars <= 500 ? { label: rule.label, max: rule.maxChars } : null;
                })()}
              />
            </PanelSection>
          ) : null;
        })()}
        <form action={generateVisualsAction} className="flex flex-col gap-3 border-t border-hairline pt-4">
          <input type="hidden" name="tenantId" value={id} />
          <input type="hidden" name="projectId" value={pid} />
          <input type="hidden" name="scheme" value="0" />
          <p className="text-xs font-medium">Next: generate visuals</p>
          <Choice dense name="approvedOnly" disabled={approved === 0} defaultChecked={approved > 0} label={`Approved pieces only (${approved})`} className="!py-0" />
          <SubmitButton variant="primary" size="sm" pendingLabel="Designing…" className="w-full">{visualDone ? "Regenerate visuals →" : "Generate visuals →"}</SubmitButton>
          <p className="text-xs text-ink-faint">Post image and quote card for each piece, plus carousel frames for carousel formats: real text over your brand colours.</p>
        </form>
      </StepPanel>
    </Stage>
    </CanvasHistory>
  );
}
