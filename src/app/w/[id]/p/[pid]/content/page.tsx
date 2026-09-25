import { CheckCircle2 } from "lucide-react";
import { projectScope } from "@/lib/auth/workspace";
import { listContent } from "@/lib/data/content";
import { listPillars } from "@/lib/data/planning";
import { loadBrandContext } from "@/lib/context/context-loader";
import { stageIndex } from "@/lib/projects/stages";
import { LockedStep } from "@/components/locked-step";
import { StepPanel, PanelSection } from "@/components/step-panel";
import { SubmitButton } from "@/components/ui";
import { generateVisualsAction } from "../pipeline-actions";
import { ContentBoard } from "./content-board";

export const metadata = { title: "Content" };

export default async function ContentPage({ params, searchParams }: PageProps<"/w/[id]/p/[pid]/content">) {
  const { id, pid } = await params;
  const sp = await searchParams;
  const { scope, project } = await projectScope(id, pid);
  const base = `/w/${id}/p/${pid}`;
  if (stageIndex(project.stage) < stageIndex("content")) {
    const pillarsOpen = true; // set once in onboarding, always available
    return (
      <LockedStep
        step={3}
        title="Content"
        needs={pillarsOpen ? "Content is drafted from your pillars. Generate it from the Pillars step." : "Content comes from pillars, and pillars come from the brief. Start with the brief questions."}
        href={pillarsOpen ? `${base}/pillars` : `${base}/brief/questions`}
        cta={pillarsOpen ? "Go to Pillars" : "Answer brief questions"}
      />
    );
  }
  const [items, pillars, ctx] = await Promise.all([listContent(scope), listPillars(scope), loadBrandContext(scope)]);
  const approved = items.filter((i) => i.status === "approved").length;
  const flagged = items.filter((i) => i.violations.length).length;
  const visualDone = stageIndex(project.stage) >= stageIndex("visual");
  const stats: [string, number][] = [["Pieces", items.length], ["Approved", approved], ["Flagged", flagged]];

  return (
    <>
      <div className="absolute inset-0 right-[280px]">
        <ContentBoard
          tenantId={id}
          projectId={pid}
          brandName={project.name}
          items={items}
          pillars={pillars.map((p) => ({ id: p.id, name: p.name }))}
          selectedId={typeof sp.item === "string" ? sp.item : null}
          degraded={ctx.degraded}
          dontWords={ctx.guardrails.dontWords}
        />
      </div>
      <StepPanel step={3} title="Content">
        {sp.generated && (
          <p className="flex items-start gap-2 text-[0.78rem] text-ok bg-ok-soft rounded-[8px] px-2.5 py-2"><CheckCircle2 size={14} className="shrink-0 mt-px" /> {String(sp.generated)} piece{sp.generated === "1" ? "" : "s"} drafted from your pillars.</p>
        )}
        <PanelSection title="On the canvas">
          <div className="grid grid-cols-3 gap-1.5 text-center">
            {stats.map(([k, v]) => (
              <div key={k} className="bg-panel rounded-[8px] py-2"><p className="text-[1.05rem] tabular-nums">{v}</p><p className="text-[0.66rem] text-ink-faint">{k}</p></div>
            ))}
          </div>
          <p className="text-[0.72rem] text-ink-muted mt-2 leading-relaxed">Double-click any text on the canvas to edit it in place. Drag a post by its label to move it to another pillar. Click a post for variants, steers and approval.</p>
        </PanelSection>
        <form action={generateVisualsAction} className="flex flex-col gap-3 border-t border-hairline pt-4">
          <input type="hidden" name="tenantId" value={id} />
          <input type="hidden" name="projectId" value={pid} />
          <input type="hidden" name="scheme" value="0" />
          <p className="text-[0.75rem] font-medium">Next: generate visuals</p>
          <label className="flex items-center gap-2 text-[0.75rem]"><input type="checkbox" name="approvedOnly" disabled={approved === 0} defaultChecked={approved > 0} /> Approved pieces only ({approved})</label>
          <SubmitButton variant="primary" size="sm" pendingLabel="Designing…" className="w-full">{visualDone ? "Regenerate visuals →" : "Generate visuals →"}</SubmitButton>
          <p className="text-[0.68rem] text-ink-faint">Post image, quote card and carousel for each piece: real text over your brand colours.</p>
        </form>
      </StepPanel>
    </>
  );
}
