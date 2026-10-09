import { CheckCircle2 } from "lucide-react";
import { workspaceScope } from "@/lib/auth/workspace";
import { getWorkspace } from "@/lib/data/workspaces";
import { loadBriefAnswers, loadFoundation } from "@/lib/data/foundation";
import { loadBrandContext } from "@/lib/context/context-loader";
import { listPillars } from "@/lib/data/planning";
import { FORMATS } from "@/lib/content/formats";
import { StepPanel } from "@/components/step-panel";
import { SubmitButton } from "@/components/ui";
import { draftFromPillarsAction, regeneratePillarsAction } from "./actions";
import { PillarMap } from "./pillar-map";

export const metadata = { title: "Pillars" };

export default async function PillarsPage({ params, searchParams }: PageProps<"/w/[id]/brand/pillars">) {
  const { id } = await params;
  const sp = await searchParams;
  const { scope } = await workspaceScope(id);
  const ws = await getWorkspace(scope);
  const [f, ctx, pillars, answers] = await Promise.all([
    loadFoundation(scope), loadBrandContext(scope), listPillars(scope), loadBriefAnswers(scope),
  ]);
  const briefRows = [
    { label: "Story arc", ok: f.chapters.filter((c) => c.body.trim()).length === 3 },
    { label: "Positioning", ok: !!f.positioning.trim() },
    { label: "Niche", ok: !!f.niche.trim() },
    { label: "Audience", ok: !!f.audience.trim() },
    { label: "Voice & guardrails", ok: !!(f.tone.trim() && (f.doWords.trim() || f.dontWords.trim())) },
    { label: "Sample posts", ok: f.samplePosts.split("\n").filter((s) => s.trim()).length >= 3 },
    { label: "Visual identity", ok: !!f.palette.trim() },
    { label: `Strategy answers · ${answers.length}`, ok: answers.length >= 2 },
  ];

  return (
    <>
      <div className="absolute inset-0 right-[280px]">
        <PillarMap tenantId={id} brandName={(ws?.name ?? "Your brand")} completeness={ctx.completeness} briefRows={briefRows} pillars={pillars} selectedId={typeof sp.pillar === "string" ? sp.pillar : null} />
      </div>
      <StepPanel step={3} title="Pillars">
        {sp.generated && (
          <p className="flex items-start gap-2 text-xs text-ok bg-ok-soft rounded-sm px-2.5 py-2"><CheckCircle2 size={14} className="shrink-0 mt-px" /> Pillars generated from your brief and answers. Rename, remove or add any before drafting.</p>
        )}
        {sp.added && (
          <p className="flex items-start gap-2 text-xs text-ok bg-ok-soft rounded-sm px-2.5 py-2"><CheckCircle2 size={14} className="shrink-0 mt-px" /> {sp.added === "0" ? "No new pillars: those already exist." : `${String(sp.added)} pillar${sp.added === "1" ? "" : "s"} added.`}</p>
        )}
        <form action={regeneratePillarsAction} className="flex flex-col gap-3">
          <input type="hidden" name="tenantId" value={id} />
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-medium">Generate pillars</p>
            <span className="text-xs text-ink-faint">{pillars.length} on the map</span>
          </div>
          <label className="block">
            <span className="text-xs text-ink-muted mb-1 block">Focus <span className="text-ink-faint">(optional)</span></span>
            <textarea name="focus" rows={3} className="field text-sm" placeholder="e.g. Hiring your first team" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs text-ink-muted mb-1 block">Number</span>
              <select name="count" className="field !py-1.5 text-sm" defaultValue="3"><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select>
            </label>
            <label className="block" title="v1 is English-only (brief section 09); language is already a parameter for later.">
              <span className="text-xs text-ink-muted mb-1 block">Language</span>
              <select name="language" className="field !py-1.5 text-sm" defaultValue="en" disabled><option value="en">English</option></select>
            </label>
          </div>
          <SubmitButton variant="primary" size="sm" pendingLabel="Generating…" className="w-full">Generate pillars</SubmitButton>
          <p className="text-xs text-ink-faint">Adds pillars from the brief and your answers. Existing pillars and their content are kept.</p>
        </form>
        <form action={draftFromPillarsAction} className="flex flex-col gap-3 border-t border-hairline pt-4">
          <input type="hidden" name="tenantId" value={id} />
          <p className="text-xs font-medium">Draft a piece from every pillar</p>
          <label className="block">
            <span className="text-xs text-ink-muted mb-1 block">Format</span>
            <select name="format" className="field !py-1.5 text-sm" defaultValue="linkedin_post">
              {FORMATS.map((fm) => <option key={fm.key} value={fm.key}>{fm.label}</option>)}
            </select>
          </label>
          <SubmitButton variant="primary" size="sm" pendingLabel={`Drafting ${pillars.length} pieces…`} className="w-full">
            Draft {pillars.length} {pillars.length === 1 ? "piece" : "pieces"}
          </SubmitButton>
          <p className="text-xs text-ink-faint">Each piece becomes its own project in your library, drafted in your voice. Every call is logged.</p>
        </form>
      </StepPanel>
    </>
  );
}
