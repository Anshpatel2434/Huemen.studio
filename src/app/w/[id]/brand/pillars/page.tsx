import { CheckCircle2 } from "lucide-react";
import { workspaceScope } from "@/lib/auth/workspace";
import { getWorkspace } from "@/lib/data/workspaces";
import { loadBriefAnswers, loadFoundation } from "@/lib/data/foundation";
import { loadBrandContext } from "@/lib/context/context-loader";
import { listPillars } from "@/lib/data/planning";
import { listProjects } from "@/lib/data/projects";
import { FORMATS } from "@/lib/content/formats";
import { StepPanel } from "@/components/step-panel";
import { SubmitButton } from "@/components/ui";
import { ChipChoice } from "@/components/chip-choice";
import { draftFromPillarsAction, regeneratePillarsAction } from "./actions";
import { PillarMap, type MapPiece } from "./pillar-map";

const clip = (s: string, n = 90) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export const metadata = { title: "Pillars" };

export default async function PillarsPage({ params, searchParams }: PageProps<"/w/[id]/brand/pillars">) {
  const { id } = await params;
  const sp = await searchParams;
  const { scope } = await workspaceScope(id);
  const ws = await getWorkspace(scope);
  const [f, ctx, pillars, answers, projects] = await Promise.all([
    loadFoundation(scope), loadBrandContext(scope), listPillars(scope), loadBriefAnswers(scope), listProjects(scope),
  ]);
  const chapters = f.chapters.filter((c) => c.body.trim()).length;
  const samples = f.samplePosts.split("\n").filter((s) => s.trim()).length;
  // Each section shows what it holds, like Relume's section descriptions.
  const briefRows = [
    { label: "Story arc", ok: chapters === 3, note: chapters ? `${chapters} of 3 chapters written` : "" },
    { label: "Positioning", ok: !!f.positioning.trim(), note: clip(f.positioning) },
    { label: "Niche", ok: !!f.niche.trim(), note: clip(f.niche) },
    { label: "Audience", ok: !!f.audience.trim(), note: clip(f.audience) },
    { label: "Voice & guardrails", ok: !!(f.tone.trim() && (f.doWords.trim() || f.dontWords.trim())), note: clip(f.tone) },
    { label: "Sample posts", ok: samples >= 3, note: samples ? `${samples} on file` : "" },
    { label: "Visual identity", ok: !!f.palette.trim(), note: clip(f.palette) },
    { label: `Strategy answers · ${answers.length}`, ok: answers.length >= 2, note: answers[0] ? clip(answers[0].answer) : "" },
  ];
  // The pieces filed under each pillar hang below it on the map.
  const pieces: Record<string, MapPiece[]> = {};
  for (const pr of projects) {
    if (!pr.pillarId) continue;
    (pieces[pr.pillarId] ??= []).push({ id: pr.id, name: pr.name, hook: pr.firstHook, format: pr.format, status: pr.contentStatus, score: pr.voiceScore });
  }

  return (
    <>
      <div className="absolute inset-0 min-[900px]:right-[280px]">
        <PillarMap tenantId={id} brandName={(ws?.name ?? "Your brand")} completeness={ctx.completeness} briefRows={briefRows} pillars={pillars} pieces={pieces} selectedId={typeof sp.pillar === "string" ? sp.pillar : null} />
      </div>
      <StepPanel title="Pillars">
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
          <fieldset>
            <legend className="text-xs text-ink-muted mb-1.5">How many</legend>
            <ChipChoice name="count" value="3" options={["1", "2", "3", "4", "5"].map((n) => ({ value: n, label: n }))} />
          </fieldset>
          {/* v1 is English-only (brief section 09); language is already a parameter for later. */}
          <input type="hidden" name="language" value="en" />
          <p className="text-xs text-ink-faint">Written in English.</p>
          <SubmitButton variant="primary" size="sm" pendingLabel="Generating…" className="w-full">Generate pillars</SubmitButton>
          <p className="text-xs text-ink-faint">Adds pillars from the brief and your answers. Existing pillars and their content are kept.</p>
        </form>
        <form action={draftFromPillarsAction} className="flex flex-col gap-3 border-t border-hairline pt-4">
          <input type="hidden" name="tenantId" value={id} />
          <p className="text-xs font-medium">Draft a piece from every pillar</p>
          <fieldset>
            <legend className="text-xs text-ink-muted mb-1.5">Format</legend>
            <ChipChoice name="format" value="linkedin_post" options={FORMATS.map((fm) => ({ value: fm.key, label: fm.label }))} />
          </fieldset>
          <SubmitButton variant="primary" size="sm" pendingLabel={`Drafting ${pillars.length} pieces…`} className="w-full">
            Draft {pillars.length} {pillars.length === 1 ? "piece" : "pieces"}
          </SubmitButton>
          <p className="text-xs text-ink-faint">Each piece becomes its own project in your library, drafted in your voice. Every call is logged.</p>
        </form>
      </StepPanel>
    </>
  );
}
