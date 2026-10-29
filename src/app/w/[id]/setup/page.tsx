import Link from "next/link";
import { ArrowRight, Check, CheckCircle2 } from "lucide-react";
import { workspaceScope } from "@/lib/auth/workspace";
import { loadPackForWorkspace, listSamples } from "@/lib/data/voice-pack";
import { loadBriefAnswers, loadFoundation } from "@/lib/data/foundation";
import { listPillars } from "@/lib/data/planning";
import { basisFrom } from "@/lib/data/enrich";
import { gettingStarted, GUIDE_TABS, isGuideTab, type GuideTab } from "@/lib/data/getting-started";
import { benchmarkPicks, confirmCards, estimateDials } from "@/lib/voice/derive";
import { prefill } from "@/lib/voice/lifecycle";
import { QUESTIONS, questionById } from "@/lib/voice/questions";
import { transcriptionEnabled } from "@/lib/ai";
import type { DialKey } from "@/lib/voice/types";
import { PersistForm } from "@/components/persist";
import { SubmitButton, Badge } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { OnboardingDrafts } from "../onboarding/draft";
import { ConfirmStep, QuestionField, type ConfirmPart } from "../onboarding/steps";
import { BeliefsEditor, ProofsEditor, StoriesEditor, Suggestions } from "../onboarding/enrich-ui";
import { setupPillarsAction } from "./actions";

export const metadata = { title: "Getting started" };
export const dynamic = "force-dynamic";

/**
 * Getting started: everything the short onboarding left for later, in five
 * tabs with ticks (Obello-style). Each tab is the real editor, not a tour;
 * every answer saves on its own, in any order.
 */
export default async function SetupPage({ params, searchParams }: PageProps<"/w/[id]/setup">) {
  const { id } = await params;
  const sp = await searchParams;
  const { scope } = await workspaceScope(id);
  const pack = await loadPackForWorkspace(scope);
  if (!pack) {
    return (
      <div className="absolute inset-0 overflow-y-auto"><div className="page py-12">
        <h1 className="text-3xl">A voice belongs to a person.</h1>
        <p className="text-ink-muted mt-2">Getting started opens for the person whose brand this is.</p>
      </div></div>
    );
  }
  const sections = await gettingStarted(scope, pack);
  const tab: GuideTab = isGuideTab(sp.tab) ? sp.tab : sections.find((s) => !s.done)?.key ?? "voice";
  const at = sections.find((s) => s.key === tab)!;
  const next = sections[(GUIDE_TABS.indexOf(tab) + 1) % GUIDE_TABS.length];
  const doneCount = sections.filter((s) => s.done).length;

  return (
    <OnboardingDrafts prefix={`huemen:setup:${pack.id}`}>
      <div className="absolute inset-0 overflow-y-auto">
        <div className="page py-8 flex flex-col gap-8 max-w-5xl">
          <header className="flex flex-col items-center text-center gap-3">
            <p className="label-mono eyebrow">Getting started · {doneCount} of {sections.length} done</p>
            <h1 className="text-[2.25rem] leading-tight tracking-[-0.02em]">Make it more <span className="serif-accent">you.</span></h1>
            <p className="text-ink-muted max-w-[52ch]">A few recommended steps that bring every draft closer to how you sound. Do them in any order; each answer saves on its own.</p>
          </header>

          <nav aria-label="Getting started" className="flex flex-wrap justify-center gap-2">
            {sections.map((s) => (
              <Link
                key={s.key}
                href={`/w/${id}/setup?tab=${s.key}`}
                aria-current={s.key === tab ? "page" : undefined}
                className={`inline-flex items-center gap-2 min-h-11 px-5 rounded-full text-sm transition-colors ${s.key === tab ? "bg-ink text-on-ink" : "bg-field text-ink-muted hover:text-ink"}`}
              >
                {s.done && <Check size={14} aria-label="done" />} {s.tab}
              </Link>
            ))}
          </nav>

          <section className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-6 items-center bg-field rounded-[28px] p-6 sm:p-10">
            <div className="flex flex-col gap-3">
              <h2 className="text-[1.75rem] leading-tight tracking-[-0.015em]">{at.title}</h2>
              <p className="text-ink-muted leading-relaxed">{at.body}</p>
            </div>
            <ul className="bg-paper border border-hairline rounded-2xl p-5 flex flex-col gap-1" aria-label="What this covers">
              {at.items.map((i) => (
                <li key={i.label} className="flex items-center justify-between gap-3 min-h-11 border-b border-hairline last:border-0">
                  <span className={i.done ? "text-ink" : "text-ink-muted"}>{i.label}</span>
                  {i.done
                    ? <CheckCircle2 size={18} className="text-ok shrink-0" aria-label="done" />
                    : <span className="w-[18px] h-[18px] rounded-full border border-line shrink-0" aria-label="not yet" />}
                </li>
              ))}
            </ul>
          </section>

          <div className="flex flex-col gap-6">{await body(tab)}</div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-6">
            <Link href={`/w/${id}`} className={btnClass("ghost")}>Back to your studio</Link>
            <Link href={`/w/${id}/setup?tab=${next.key}`} className={btnClass("primary")}>Next: {next.tab} <ArrowRight size={16} aria-hidden="true" /></Link>
          </footer>
        </div>
      </div>
    </OnboardingDrafts>
  );

  async function body(t: GuideTab) {
    const p = pack!;
    if (t === "voice" || t === "rules" || t === "stories") {
      const samples = await listSamples(scope, p.id, { includeExcluded: true });
      const live = samples.filter((s) => !s.excluded);
      const brief = await loadFoundation(scope);
      const sugg = p.onboarding.suggestions;
      const current: Record<string, string | string[]> = {
        A2: p.identity.reader?.value ?? "",
        A3: p.identity.personaRoles?.value?.[0] ?? "",
        C1: p.identity.guarded?.value ?? "",
        C2: p.identity.unguarded?.value ?? "",
        D1: p.guardrails.find((g) => g.id === "self-label")?.rule ?? "",
        D2: p.guardrails.find((g) => g.id === "off-limits")?.rule ?? "",
        D7: p.guardrails.find((g) => g.id === "never-write")?.rule ?? "",
        E1: p.index.neverWords,
      };
      const ids = t === "voice" ? ["A2", "A3", "C1", "C2"] : t === "rules" ? ["D1", "D2", "D7", "E1"] : [];
      const parts: ConfirmPart[] = t === "voice" ? ["cards", "suggestions", "dials", "words", "questions"] : t === "rules" ? ["questions", "influences", "languages"] : ["benchmarks"];
      const needed = p.corpusStats.pieces + (brief.audience ? 1 : 0) > 0 && sugg?.basis !== basisFrom(p.corpusStats.pieces, brief);
      const confirm = (
        <ConfirmStep
          tenantId={id}
          parts={parts}
          cards={confirmCards(p, samples).slice(0, 3)}
          dials={(p.identity.dials?.value ?? {}) as Partial<Record<DialKey, number>>}
          estimated={estimateDials(p)}
          longlist={p.identity.personalityLonglist?.value ?? []}
          fourWords={(p.identity.personalityWords?.value ?? []).map((w) => w.word)}
          answered={p.onboarding.answered ?? []}
          current={current}
          prefills={Object.fromEntries(ids.map((q) => [q, prefill(q, current[q], { audience: brief.audience }, sugg?.answers[q])]).filter(([, v]) => v))}
          influences={p.identity.influences?.value ?? { admire: [], avoid: [] }}
          languages={p.identity.languages?.value ?? null}
          suggestions={<Suggestions tenantId={id} needed={needed} at={sugg?.at ?? null} />}
          canRecord={transcriptionEnabled()}
          candidates={benchmarkPicks(live).map((s) => ({ id: s.id, text: s.body, channel: s.channel }))}
          benchmarks={live.filter((s) => s.kind === "benchmark").map((s) => s.id)}
          questions={QUESTIONS.filter((q) => ids.includes(q.id))}
        />
      );
      if (t !== "stories") return confirm;
      const carries = p.identity.carries?.value ?? "";
      return (
        <>
          <BeliefsEditor tenantId={id} initial={p.identity.beliefs?.value ?? []} />
          <StoriesEditor tenantId={id} initial={p.identity.stories?.value ?? []} />
          <ProofsEditor tenantId={id} initial={p.identity.proofs?.value ?? []} />
          <div className="bg-paper border border-hairline rounded-md p-5 flex flex-col gap-2">
            <h2 className="text-base">The one idea <span className="text-ink-faint font-normal text-sm">· optional</span></h2>
            <p className="text-sm text-ink-muted">Skip this if you don&apos;t know yet; nothing depends on it.</p>
            <QuestionField tenantId={id} q={questionById("A4")!} initial={carries} answered={!!carries} prefill={prefill("A4", carries, {}, sugg?.answers.A4) ?? undefined} />
          </div>
          {confirm}
        </>
      );
    }

    if (t === "pillars") {
      const [pillars, answers] = await Promise.all([listPillars(scope), loadBriefAnswers(scope)]);
      const saved = Object.fromEntries(answers.map((a) => [a.key, a.answer]));
      return (
        <PersistForm id="setup-pillars" storageKey={`huemen:setup:${p.id}:pillars`} action={setupPillarsAction} className="bg-paper border border-hairline rounded-md p-5 flex flex-col gap-4">
          <input type="hidden" name="tenantId" value={id} />
          <h2 className="text-base">Your pillars</h2>
          <p className="text-sm text-ink-muted">Pillars come from your brief, your writing and two or three answers about what you stand for.</p>
          {[
            ["known_for", "Twelve months from now, what do you want to be known for?"],
            ["contrarian", "What do you believe that most people in your field would argue with?"],
            ["questions", "What do clients ask you over and over?"],
          ].map(([key, label]) => (
            <label key={key} className="block">
              <span className="block text-sm font-medium mb-1.5">{label}</span>
              <textarea name={key} rows={2} defaultValue={saved[key] ?? ""} className="field" />
            </label>
          ))}
          {sp.made && <p role="status" className="text-sm text-ok flex items-center gap-2"><CheckCircle2 size={15} aria-hidden="true" /> {pillars.length} pillars ready.</p>}
          {pillars.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Your pillars">
              {pillars.map((x) => <li key={x.id}><Badge>{x.name}</Badge></li>)}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <SubmitButton name="intent" value="pillars" pendingLabel="Making pillars…" variant={pillars.length ? "secondary" : "primary"}>
              {pillars.length ? "Make more pillars" : "Make my pillars"}
            </SubmitButton>
            <SubmitButton name="intent" value="save" pendingLabel="Saving…" variant="ghost">Save answers</SubmitButton>
            {pillars.length > 0 && <Link href={`/w/${id}/brand/pillars`} className={btnClass("ghost")}>See the pillar map</Link>}
          </div>
        </PersistForm>
      );
    }

    // connect
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-paper border border-hairline rounded-md p-5 flex flex-col gap-3">
          <h2 className="text-base">Add a few more pieces</h2>
          <p className="text-sm text-ink-muted">You have {p.corpusStats.pieces} {p.corpusStats.pieces === 1 ? "piece" : "pieces"} on file. Around thirty is when the rarer habits become reliable.</p>
          <Link href={`/w/${id}/onboarding?s=writing`} className={`${btnClass("primary", "sm")} self-start`}>Add writing</Link>
        </div>
        <div className="bg-paper border border-hairline rounded-md p-5 flex flex-col gap-3">
          <h2 className="text-base">Connect an account</h2>
          <p className="text-sm text-ink-muted">Gmail, Google Docs and LinkedIn can be read directly, only what you allow, and you can disconnect any time.</p>
          <Link href="/settings/connections" className={`${btnClass("secondary", "sm")} self-start`}>Connect accounts</Link>
        </div>
      </div>
    );
  }
}
