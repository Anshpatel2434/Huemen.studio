import { CheckCircle2 } from "lucide-react";
import { projectScope } from "@/lib/auth/workspace";
import { loadFoundation } from "@/lib/data/foundation";
import { loadBrandContext } from "@/lib/context/context-loader";
import { listPillars } from "@/lib/data/planning";
import { stageIndex } from "@/lib/projects/stages";
import { FORMATS } from "@/lib/content/formats";
import { LockedStep } from "@/components/locked-step";
import { StepPanel } from "@/components/step-panel";
import { SubmitButton } from "@/components/ui";
import { generateContentAction, regeneratePillarsAction } from "../pipeline-actions";
import { PillarMap } from "./pillar-map";

export const metadata = { title: "Pillars" };

export default async function PillarsPage({ params, searchParams }: PageProps<"/w/[id]/p/[pid]/pillars">) {
  const { id, pid } = await params;
  const sp = await searchParams;
  const { scope, project } = await projectScope(id, pid);
  const base = `/w/${id}/p/${pid}`;
  if (stageIndex(project.stage) < stageIndex("pillars")) {
    return <LockedStep step={2} title="Pillars" needs="Pillars are generated from your brief. Answer the brief questions first and they'll be created for you." href={`${base}/brief/questions`} cta="Answer brief questions" />;
  }

  const [f, ctx, pillars] = await Promise.all([loadFoundation(scope), loadBrandContext(scope), listPillars(scope)]);
  const briefRows = [
    { label: "Story arc", ok: f.chapters.filter((c) => c.body.trim()).length === 3 },
    { label: "Positioning", ok: !!f.positioning.trim() },
    { label: "Niche", ok: !!f.niche.trim() },
    { label: "Audience", ok: !!f.audience.trim() },
    { label: "Voice & guardrails", ok: !!(f.tone.trim() && (f.doWords.trim() || f.dontWords.trim())) },
    { label: "Sample posts", ok: f.samplePosts.split("\n").filter((s) => s.trim()).length >= 3 },
    { label: "Visual identity", ok: !!f.palette.trim() },
    { label: `Strategy answers · ${project.briefAnswers.length}`, ok: project.briefAnswers.length >= 2 },
  ];
  const contentDone = stageIndex(project.stage) >= stageIndex("content");
  const empty = pillars.filter((p) => p.contentCount === 0).length;

  return (
    <>
      <div className="absolute inset-0 right-[280px]">
        <PillarMap tenantId={id} projectId={pid} brandName={project.name} completeness={ctx.completeness} briefRows={briefRows} pillars={pillars} selectedId={typeof sp.pillar === "string" ? sp.pillar : null} />
      </div>
      <StepPanel step={2} title="Pillars">
        {sp.generated && (
          <p className="flex items-start gap-2 text-[0.78rem] text-ok bg-ok-soft rounded-[8px] px-2.5 py-2"><CheckCircle2 size={14} className="shrink-0 mt-px" /> Pillars generated from your brief and answers. Rename, remove or add any before drafting.</p>
        )}
        {sp.added && (
          <p className="flex items-start gap-2 text-[0.78rem] text-ok bg-ok-soft rounded-[8px] px-2.5 py-2"><CheckCircle2 size={14} className="shrink-0 mt-px" /> {sp.added === "0" ? "No new pillars: those already exist." : `${String(sp.added)} pillar${sp.added === "1" ? "" : "s"} added.`}</p>
        )}
        <form action={regeneratePillarsAction} className="flex flex-col gap-3">
          <input type="hidden" name="tenantId" value={id} />
          <input type="hidden" name="projectId" value={pid} />
          <div className="flex items-baseline justify-between">
            <p className="text-[0.75rem] font-medium">Generate pillars</p>
            <span className="text-[0.7rem] text-ink-faint">{pillars.length} on the map</span>
          </div>
          <label className="block">
            <span className="text-[0.72rem] text-ink-muted mb-1 block">Focus <span className="text-ink-faint">(optional)</span></span>
            <textarea name="focus" rows={3} className="field text-[0.8rem]" placeholder="e.g. Hiring your first team" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[0.72rem] text-ink-muted mb-1 block">Number</span>
              <select name="count" className="field !py-1.5 text-[0.8rem]" defaultValue="3"><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select>
            </label>
            <label className="block" title="v1 is English-only (brief section 09); language is already a parameter for later.">
              <span className="text-[0.72rem] text-ink-muted mb-1 block">Language</span>
              <select name="language" className="field !py-1.5 text-[0.8rem]" defaultValue="en" disabled><option value="en">English</option></select>
            </label>
          </div>
          <SubmitButton variant="primary" size="sm" pendingLabel="Generating…" className="w-full">Generate pillars</SubmitButton>
          <p className="text-[0.68rem] text-ink-faint">Adds pillars from the brief and your answers. Existing pillars and their content are kept.</p>
        </form>
        <form action={generateContentAction} className="flex flex-col gap-3 border-t border-hairline pt-4">
          <input type="hidden" name="tenantId" value={id} />
          <input type="hidden" name="projectId" value={pid} />
          <p className="text-[0.75rem] font-medium">Next: generate content</p>
          <label className="block">
            <span className="text-[0.72rem] text-ink-muted mb-1 block">Format</span>
            <select name="format" className="field !py-1.5 text-[0.8rem]" defaultValue="linkedin_post">
              {FORMATS.map((fm) => <option key={fm.key} value={fm.key}>{fm.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[0.72rem] text-ink-muted mb-1 block">Pieces per pillar</span>
            <select name="perPillar" className="field !py-1.5 text-[0.8rem]" defaultValue="1">
              <option value="1">1</option><option value="2">2</option><option value="3">3</option>
            </select>
          </label>
          {contentDone && (
            <label className="flex items-center gap-2 text-[0.75rem]"><input type="checkbox" name="onlyEmpty" defaultChecked /> Only pillars with no content ({empty})</label>
          )}
          <SubmitButton variant="accent" size="sm" pendingLabel="Drafting from pillars…" className="w-full">{contentDone ? "Generate more content →" : "Generate content →"}</SubmitButton>
          <p className="text-[0.68rem] text-ink-faint">Two variants per piece, voice and guardrails from the brief. Every call is logged.</p>
        </form>
      </StepPanel>
    </>
  );
}
