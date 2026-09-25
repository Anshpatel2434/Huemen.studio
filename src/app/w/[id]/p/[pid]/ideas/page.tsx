import Link from "next/link";
import { Lightbulb, Archive, ArrowRight, CheckCircle2 } from "lucide-react";
import { projectScope } from "@/lib/auth/workspace";
import { listIdeas, listPillars } from "@/lib/data/planning";
import { DocPage } from "@/components/doc-page";
import { EmptyState, SubmitButton } from "@/components/ui";
import { FORMATS } from "@/lib/content/formats";
import { stageIndex } from "@/lib/projects/stages";
import { archiveIdeaAction, captureIdeaAction, convertIdeaAction, setIdeaPillarAction } from "../planning-actions";

export const metadata = { title: "Ideas" };

export default async function IdeasPage({ params }: PageProps<"/w/[id]/p/[pid]/ideas">) {
  const { id, pid } = await params;
  const { scope, project } = await projectScope(id, pid);
  const [ideas, pillars] = await Promise.all([listIdeas(scope), listPillars(scope)]);
  const canDraft = pillars.length > 0;
  const open = ideas.filter((i) => i.status === "new");
  const done = ideas.filter((i) => i.status === "converted");

  return (
    <DocPage eyebrow={`${project.name} · Idea inbox`} title="Catch it now." accent="Shape it later." sub="Paste a thought; it's auto-tagged to the closest pillar. One click turns it into a draft built from your brief.">
      <form action={captureIdeaAction} className="bg-paper border border-hairline rounded-[14px] p-3 flex gap-2 items-end shadow-[var(--shadow-sm)]">
        <input type="hidden" name="tenantId" value={id} />
        <input type="hidden" name="projectId" value={pid} />
        <textarea name="text" rows={2} required placeholder="e.g. The client who fired me taught me more than the ones who stayed" className="flex-1 resize-none bg-transparent outline-none text-[0.9rem] px-1.5 py-1 placeholder:text-ink-faint" />
        <SubmitButton pendingLabel="Saving…" size="sm">Capture</SubmitButton>
      </form>

      <div className="mt-8">
        <p className="label-mono text-ink-faint mb-3">Open · {open.length}</p>
        {open.length === 0 ? (
          <div className="bg-paper border border-hairline rounded-[14px]"><EmptyState icon={<Lightbulb size={18} />} title="Inbox zero" sub="Ideas you capture (or tell the agent “Idea: …”) land here." /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {open.map((i) => (
              <div key={i.id} className="bg-paper border border-hairline rounded-[12px] p-4 flex flex-col gap-3">
                <p className="text-[0.92rem] leading-relaxed flex-1">{i.rawText}</p>
                <form action={setIdeaPillarAction} className="flex items-center gap-2">
                  <input type="hidden" name="tenantId" value={id} />
        <input type="hidden" name="projectId" value={pid} />
                  <input type="hidden" name="id" value={i.id} />
                  <select name="pillarId" defaultValue={i.pillarId ?? ""} className="h-8 rounded-[7px] bg-field px-2 text-[0.78rem] flex-1">
                    <option value="">Untagged</option>
                    {pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <SubmitButton variant="ghost" size="sm" pendingLabel="…">Tag</SubmitButton>
                </form>
                <div className="flex items-center gap-2 border-t border-hairline pt-3">
                  <form action={archiveIdeaAction}>
                    <input type="hidden" name="tenantId" value={id} />
        <input type="hidden" name="projectId" value={pid} />
                    <input type="hidden" name="id" value={i.id} />
                    <button className="w-8 h-8 rounded-[7px] flex items-center justify-center text-ink-faint hover:bg-field hover:text-ink" title="Archive"><Archive size={14} /></button>
                  </form>
                  <form action={convertIdeaAction} className="flex items-center gap-2 flex-1 justify-end">
                    <input type="hidden" name="tenantId" value={id} />
        <input type="hidden" name="projectId" value={pid} />
                    <input type="hidden" name="id" value={i.id} />
                    <select name="format" className="h-8 rounded-[7px] bg-field px-2 text-[0.78rem]">
                      {FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                    {canDraft ? <SubmitButton size="sm" pendingLabel="Drafting…">Draft it <ArrowRight size={13} /></SubmitButton> : <span className="text-[0.72rem] text-ink-faint" title="Drafting unlocks with Pillars">Drafts unlock after pillars</span>}
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {done.length > 0 && (
        <div className="mt-10 pb-10">
          <p className="label-mono text-ink-faint mb-3">Converted · {done.length}</p>
          <div className="flex flex-col divide-y divide-[var(--hairline)] bg-paper border border-hairline rounded-[12px]">
            {done.map((i) => (
              <Link key={i.id} href={`/w/${id}/p/${pid}/content?item=${i.convertedTo}`} className="flex items-center gap-3 px-4 h-12 hover:bg-panel text-[0.85rem]">
                <CheckCircle2 size={14} className="text-ok shrink-0" />
                <span className="flex-1 truncate text-ink-muted">{i.rawText}</span>
                {i.pillarName && <span className="text-[0.75rem] text-ink-faint">{i.pillarName}</span>}
                <ArrowRight size={14} className="text-ink-faint" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </DocPage>
  );
}
