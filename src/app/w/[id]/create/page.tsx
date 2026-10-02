import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Lightbulb, Sparkles } from "lucide-react";
import { workspaceScope } from "@/lib/auth/workspace";
import { proposeTopics } from "@/lib/data/create";
import { listCalendar, listIdeas } from "@/lib/data/planning";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { FORMATS } from "@/lib/content/formats";
import { userMessage } from "@/lib/ai/errors";
import { btnClass } from "@/components/btn";
import { AgentDots } from "@/components/ui";
import { startPieceAction } from "./actions";
import { SuggestOthers } from "./suggest-others";

export const metadata = { title: "Create" };

const Start = ({ tenantId, topic, pillar, ideaId, format, children, className }: {
  tenantId: string; topic: string; pillar?: string | null; ideaId?: string; format?: string | null; children: React.ReactNode; className?: string;
}) => (
  <form action={startPieceAction} className={className}>
    <input type="hidden" name="tenantId" value={tenantId} />
    <input type="hidden" name="topic" value={topic} />
    {pillar && <input type="hidden" name="pillar" value={pillar} />}
    {ideaId && <input type="hidden" name="ideaId" value={ideaId} />}
    {format && <input type="hidden" name="format" value={format} />}
    {children}
  </form>
);

/**
 * Proposals render on their own so the page never waits on them. They are
 * cached on the pack for a week, so most visits cost nothing.
 */
async function Proposals({ tenantId, format }: { tenantId: string; format: string | null }) {
  const { scope } = await workspaceScope(tenantId);
  let topics;
  try {
    topics = await proposeTopics(scope);
  } catch (e) {
    return <p role="alert" className="text-[0.85rem] text-danger bg-danger-soft rounded-[8px] px-3 py-2.5">{userMessage(e)}</p>;
  }
  if (!topics.length) {
    return <p className="text-[0.88rem] text-ink-muted">Set your pillars and we'll suggest topics from them. <Link href={`/w/${tenantId}/brand/pillars`} className="text-accent underline underline-offset-2">Pillars</Link></p>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {topics.map((t) => (
        <Start key={t.title} tenantId={tenantId} topic={t.title} pillar={t.pillar} format={format} className="flex">
          <button type="submit" className="flex-1 text-left bg-paper border border-hairline hover:border-ink rounded-[12px] p-4 flex flex-col gap-2 min-h-11 transition-colors">
            {t.pillar && <span className="label-mono text-ink-faint line-clamp-1" title={t.pillar}>{t.pillar}</span>}
            <span className="text-[0.98rem] font-medium leading-snug">{t.title}</span>
            <span className="text-[0.82rem] text-ink-muted flex-1">{t.why}</span>
            <span className="text-[0.82rem] font-medium flex items-center gap-1.5">Start this <ArrowRight size={14} aria-hidden="true" /></span>
          </button>
        </Start>
      ))}
    </div>
  );
}

export default async function CreatePage({ params }: PageProps<"/w/[id]/create">) {
  const { id } = await params;
  const { scope } = await workspaceScope(id);
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [pack, ideas, slots] = await Promise.all([
    loadPackForWorkspace(scope),
    listIdeas(scope),
    listCalendar(scope, iso(today), iso(new Date(today.getTime() + 14 * 864e5))),
  ]);
  const platform = pack?.onboarding.writeFor?.[0] ?? "linkedin";
  const format = FORMATS.find((f) => f.platform === platform)?.key ?? null;
  const open = ideas.filter((i) => i.status !== "archived" && !i.projectId && !i.convertedTo).slice(0, 6);
  const upcoming = slots.filter((s) => !s.contentItemId && s.topic).slice(0, 6);
  const onboarded = !!pack?.onboarding.completedAt;

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="max-w-[960px] mx-auto px-5 sm:px-8 py-8 flex flex-col gap-8">
        <div>
          <p className="label-mono eyebrow">Create</p>
          <h1 className="text-[1.9rem] mt-2">What are we <span className="serif-accent">writing?</span></h1>
          <p className="text-ink-muted mt-2 max-w-[62ch]">Pick a topic from your own pillars, an idea you saved, or anything else. Each piece becomes its own project.</p>
        </div>

        {pack && !onboarded && (
          <p className="text-[0.88rem] bg-field rounded-[10px] px-4 py-3 flex flex-wrap items-center gap-3">
            <span className="flex-1 min-w-0">Your voice isn't set up yet, so drafts won't sound much like you.</span>
            <Link href={`/w/${id}/onboarding`} className={btnClass("secondary", "sm")}>Finish setting up</Link>
          </p>
        )}

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[1.05rem] flex items-center gap-2"><Sparkles size={16} aria-hidden="true" /> Suggested for you</h2>
            <SuggestOthers tenantId={id} />
          </div>
          <Suspense fallback={<p className="text-[0.85rem] text-ink-muted flex items-center gap-2"><AgentDots /> Finding topics in your pillars</p>}>
            <Proposals tenantId={id} format={format} />
          </Suspense>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-[1.05rem]">Something else</h2>
          <form action={startPieceAction} className="bg-paper border border-hairline rounded-[12px] p-4 flex flex-col sm:flex-row gap-3 sm:items-end">
            <input type="hidden" name="tenantId" value={id} />
            <label className="flex-1 min-w-0">
              <span className="block text-[0.8rem] font-medium mb-1">Topic</span>
              <input name="topic" required placeholder="What's it about?" className="field" />
            </label>
            <label>
              <span className="block text-[0.8rem] font-medium mb-1">Format</span>
              <select name="format" defaultValue={format ?? ""} className="field min-h-11">
                {FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </label>
            <button type="submit" className={btnClass("primary")}>Start</button>
          </form>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <section className="flex flex-col gap-3 min-w-0">
            <h2 className="text-[1.05rem] flex items-center gap-2"><Lightbulb size={16} aria-hidden="true" /> From your ideas</h2>
            {open.length ? (
              <ul className="flex flex-col divide-y divide-[var(--hairline)] border border-hairline rounded-[12px] bg-paper">
                {open.map((i) => (
                  <li key={i.id}>
                    <Start tenantId={id} topic={i.rawText.slice(0, 200)} pillar={i.pillarName} ideaId={i.id} format={format}>
                      <button type="submit" className="w-full text-left px-4 py-3 min-h-11 hover:bg-field flex items-center gap-3">
                        <span className="flex-1 min-w-0 text-[0.88rem] line-clamp-2">{i.rawText}</span>
                        {i.pillarName && <span className="label-mono text-ink-faint max-w-[40%] truncate" title={i.pillarName}>{i.pillarName}</span>}
                      </button>
                    </Start>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[0.85rem] text-ink-muted">No saved ideas. <Link href={`/w/${id}/plan/ideas`} className="text-accent underline underline-offset-2">Capture one</Link></p>
            )}
          </section>

          <section className="flex flex-col gap-3 min-w-0">
            <h2 className="text-[1.05rem] flex items-center gap-2"><CalendarDays size={16} aria-hidden="true" /> Next two weeks</h2>
            {upcoming.length ? (
              <ul className="flex flex-col divide-y divide-[var(--hairline)] border border-hairline rounded-[12px] bg-paper">
                {upcoming.map((s) => (
                  <li key={s.id}>
                    <Start tenantId={id} topic={s.topic ?? ""} pillar={s.pillarName} format={format}>
                      <button type="submit" className="w-full text-left px-4 py-3 min-h-11 hover:bg-field flex items-center gap-3">
                        <span className="font-mono text-[0.75rem] text-ink-faint tabular-nums shrink-0">{s.date.slice(5)}</span>
                        <span className="flex-1 min-w-0 text-[0.88rem] line-clamp-2">{s.topic}</span>
                      </button>
                    </Start>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[0.85rem] text-ink-muted">Nothing planned. <Link href={`/w/${id}/plan/calendar`} className="text-accent underline underline-offset-2">Open the calendar</Link></p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
