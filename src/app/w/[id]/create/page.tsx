import { Suspense } from "react";
import Link from "next/link";
import { CalendarDays, Lightbulb, Sparkles } from "lucide-react";
import { workspaceScope } from "@/lib/auth/workspace";
import { listCalendar, listIdeas } from "@/lib/data/planning";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { FORMATS } from "@/lib/content/formats";
import { btnClass } from "@/components/btn";
import { Avatar } from "@/components/ui";
import { coreCardFacts } from "@/lib/voice/core-card";
import { startPieceAction } from "./actions";
import { SuggestOthers } from "./suggest-others";
import { Proposals, ProposalsLoading, Start } from "./proposals";

export const metadata = { title: "Create" };

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
  const core = pack ? coreCardFacts(pack, today.getTime()) : null;

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="max-w-[960px] mx-auto px-5 sm:px-8 py-8 flex flex-col gap-8">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-5">
          <div className="flex-1 min-w-[24ch]">
            <p className="label-mono eyebrow">Create</p>
            <h1 className="text-3xl mt-2">What are we <span className="serif-accent">writing?</span></h1>
            <p className="text-ink-muted mt-2 max-w-[62ch]">Pick a topic from your own pillars, an idea you saved, or anything else. Each piece becomes its own project.</p>
          </div>
          {/* §15.7: whose voice is in use is visible before anything is written. */}
          {core && (
            <Link href={`/w/${id}/brand/voice`} className="flex items-center gap-3 bg-paper border border-hairline rounded-md px-4 py-3 hover:border-line-strong transition-colors">
              <Avatar seed={core.seed} label={core.name} size="md" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Writing as {core.name}</span>
                <span className="block label-mono text-ink-faint"><span className="num">{core.confidence}%</span> confident</span>
              </span>
            </Link>
          )}
        </div>

        {pack && !onboarded && (
          <p className="text-sm bg-field rounded-md px-4 py-3 flex flex-wrap items-center gap-3">
            <span className="flex-1 min-w-0">Your voice isn&apos;t set up yet, so drafts won&apos;t sound much like you.</span>
            <Link href={`/w/${id}/onboarding`} className={btnClass("secondary", "sm")}>Finish setting up</Link>
          </p>
        )}

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base flex items-center gap-2"><Sparkles size={16} aria-hidden="true" /> Suggested for you</h2>
            <SuggestOthers tenantId={id} />
          </div>
          <Suspense fallback={<ProposalsLoading />}>
            <Proposals tenantId={id} format={format} />
          </Suspense>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-base">Something else</h2>
          <form action={startPieceAction} className="bg-paper border border-hairline rounded-md p-4 flex flex-col sm:flex-row gap-3 sm:items-end">
            <input type="hidden" name="tenantId" value={id} />
            <label className="flex-1 min-w-0">
              <span className="hu-label !flex mb-2">Topic</span>
              <input name="topic" required placeholder="What's it about?" className="field" />
            </label>
            <label>
              <span className="hu-label !flex mb-2">Format</span>
              <select name="format" defaultValue={format ?? ""} className="field min-h-11">
                {FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </label>
            <button type="submit" className={btnClass("primary")}>Start</button>
          </form>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <section className="flex flex-col gap-3 min-w-0">
            <h2 className="text-base flex items-center gap-2"><Lightbulb size={16} aria-hidden="true" /> From your ideas</h2>
            {open.length ? (
              <ul className="flex flex-col divide-y divide-[var(--hairline)] border border-hairline rounded-md bg-paper">
                {open.map((i) => (
                  <li key={i.id}>
                    <Start tenantId={id} topic={i.rawText.slice(0, 200)} pillar={i.pillarName} ideaId={i.id} format={format}>
                      <button type="submit" className="w-full text-left px-4 py-3 min-h-11 hover:bg-field flex items-center gap-3">
                        <span className="flex-1 min-w-0 text-sm line-clamp-2">{i.rawText}</span>
                        {i.pillarName && <span className="label-mono text-ink-faint max-w-[40%] truncate" title={i.pillarName}>{i.pillarName}</span>}
                      </button>
                    </Start>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">No saved ideas. <Link href={`/w/${id}/plan/ideas`} className="text-accent underline underline-offset-2">Capture one</Link></p>
            )}
          </section>

          <section className="flex flex-col gap-3 min-w-0">
            <h2 className="text-base flex items-center gap-2"><CalendarDays size={16} aria-hidden="true" /> Next two weeks</h2>
            {upcoming.length ? (
              <ul className="flex flex-col divide-y divide-[var(--hairline)] border border-hairline rounded-md bg-paper">
                {upcoming.map((s) => (
                  <li key={s.id}>
                    <Start tenantId={id} topic={s.topic ?? ""} pillar={s.pillarName} format={format}>
                      <button type="submit" className="w-full text-left px-4 py-3 min-h-11 hover:bg-field flex items-center gap-3">
                        <span className="font-mono text-xs text-ink-faint tabular-nums shrink-0">{s.date.slice(5)}</span>
                        <span className="flex-1 min-w-0 text-sm line-clamp-2">{s.topic}</span>
                      </button>
                    </Start>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">Nothing planned. <Link href={`/w/${id}/plan/calendar`} className="text-accent underline underline-offset-2">Open the calendar</Link></p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
