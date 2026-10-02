import Link from "next/link";
import { Check, CheckCircle2 } from "lucide-react";
import { workspaceScope } from "@/lib/auth/workspace";
import { listSamples, loadPackForWorkspace } from "@/lib/data/voice-pack";
import { loadBriefAnswers, loadFoundation } from "@/lib/data/foundation";
import { listPillars } from "@/lib/data/planning";
import { listContent } from "@/lib/data/content";
import { checkText } from "@/lib/data/check";
import { getProject } from "@/lib/data/projects";
import { benchmarkPicks, confidence, confirmCards, estimateDials } from "@/lib/voice/derive";
import { corpusLevel, type DialKey } from "@/lib/voice/types";
import { QUESTIONS, questionById } from "@/lib/voice/questions";
import { coreState, prefill } from "@/lib/voice/lifecycle";
import { transcriptionEnabled } from "@/lib/ai";
import { VisualForm } from "@/components/visual-form";
import { CoreWatcher } from "@/components/core-watcher";
import { listAssets } from "@/lib/data/assets";
import { basisFrom } from "@/lib/data/enrich";
import {
  BrandImages, InfluencesEditor, LanguagesEditor, ProofsEditor, StoriesEditor, Suggestions, UrlImport, VoicePreview,
} from "./enrich-ui";
import { btnClass } from "@/components/btn";
import { SubmitButton, Badge } from "@/components/ui";
import { BrandCoreCard } from "@/components/composites";
import { ConfirmStep, PayoffStep, QuestionField, SamplesStep } from "./steps";
import { hueAction, goToStepAction } from "./actions";

export const metadata = { title: "Set up your voice" };
export const dynamic = "force-dynamic";

const STEPS = ["Add samples", "Confirm your voice", "Set your hue", "First draft"];

/**
 * The four-step stepper (design system §14: "the step count is visible from
 * step one"). Done steps carry a tick, the current one its number and weight:
 * position, shape and colour together, never colour alone.
 */
function Stepper({ id, current, reached }: { id: string; current: number; reached: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Onboarding steps">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < reached || (n < current);
        const on = n === current;
        const open = n <= reached;
        const dot = (
          <span
            className={`w-7 h-7 rounded-full grid place-items-center text-[0.75rem] font-mono shrink-0 ${
              on ? "bg-ink text-on-ink" : done ? "bg-ok-soft text-ok" : "border border-line text-ink-faint"
            }`}
            aria-hidden="true"
          >
            {done && !on ? <Check size={13} /> : n}
          </span>
        );
        const inner = (
          <span className={`flex items-center gap-2 min-h-11 pr-3 text-[0.85rem] ${on ? "font-medium text-ink" : open ? "text-ink-muted" : "text-ink-faint"}`}>
            {dot} {label}
          </span>
        );
        return (
          <li key={label} role="tab" aria-selected={on} aria-setsize={4} aria-posinset={n} className="flex items-center gap-2">
            {open ? <Link href={`/w/${id}/onboarding?step=${n}`}>{inner}</Link> : inner}
            {n < 4 && <span className="w-6 h-px bg-line" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

export default async function OnboardingPage({ params, searchParams }: PageProps<"/w/[id]/onboarding">) {
  const { id } = await params;
  const sp = await searchParams;
  const { scope } = await workspaceScope(id);
  const pack = await loadPackForWorkspace(scope);
  if (!pack) {
    return (
      <div className="absolute inset-0 overflow-y-auto">
        <div className="max-w-[760px] mx-auto px-6 py-12">
          <h1 className="text-[1.9rem]">A voice belongs to a person.</h1>
          <p className="text-ink-muted mt-2">Sign in as the person whose brand this is and their voice pack will be created for them.</p>
        </div>
      </div>
    );
  }

  const reached = Math.min(4, Math.max(1, pack.onboarding.step ?? 1));
  const requested = Number(sp.step);
  const step = requested >= 1 && requested <= reached ? requested : reached;
  const samples = await listSamples(scope, pack.id, { includeExcluded: true });
  const conf = confidence(pack);
  const live = samples.filter((s) => !s.excluded);
  const state = coreState(pack, Date.now());
  const canRecord = transcriptionEnabled();
  const brief = step === 2 ? await loadFoundation(scope) : null;
  const sugg = pack.onboarding.suggestions;
  const suggestionsNeeded = !!brief && pack.corpusStats.pieces + (brief.audience ? 1 : 0) > 0 && sugg?.basis !== basisFrom(pack.corpusStats.pieces, brief);
  const current: Record<string, string | string[]> = {
    A2: pack.identity.reader?.value ?? "",
    A3: pack.identity.personaRoles?.value?.[0] ?? "",
    C1: pack.identity.guarded?.value ?? "",
    C2: pack.identity.unguarded?.value ?? "",
    D1: pack.guardrails.find((g) => g.id === "self-label")?.rule ?? "",
    D2: pack.guardrails.find((g) => g.id === "off-limits")?.rule ?? "",
    D7: pack.guardrails.find((g) => g.id === "never-write")?.rule ?? "",
    E1: pack.index.neverWords,
  };
  const CORE = ["A2", "A3", "C1", "C2", "D1", "D2", "D7", "E1"];

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className={`${step < 4 ? "max-w-[1200px]" : "max-w-[880px]"} mx-auto px-5 sm:px-8 py-8 flex flex-col gap-8`}>
        <div className="flex flex-col gap-4">
          <p className="label-mono eyebrow">Onboarding · step {step} of 4</p>
          <Stepper id={id} current={step} reached={reached} />
        </div>

        <CoreWatcher state={state} pieces={pack.corpusStats.pieces} />

        <div className={step < 4 ? "grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8 items-start" : ""}>
        <div className="flex flex-col gap-8 min-w-0">

        {step === 1 && (
          <SamplesStep
            tenantId={id}
            sources={pack.onboarding.sources ?? []}
            writeFor={pack.onboarding.writeFor ?? []}
            pieces={pack.corpusStats.pieces}
            words={pack.corpusStats.words}
            level={corpusLevel(pack.corpusStats)}
            canRecord={canRecord}
            links={<UrlImport tenantId={id} />}
          />
        )}

        {step === 2 && (
          <ConfirmStep
            tenantId={id}
            cards={confirmCards(pack, samples).slice(0, 3)}
            dials={(pack.identity.dials?.value ?? {}) as Partial<Record<DialKey, number>>}
            estimated={estimateDials(pack)}
            longlist={pack.identity.personalityLonglist?.value ?? []}
            fourWords={(pack.identity.personalityWords?.value ?? []).map((w) => w.word)}
            answered={pack.onboarding.answered ?? []}
            current={current}
            prefills={Object.fromEntries(
              CORE.map((q) => [q, prefill(q, current[q], { audience: brief?.audience }, sugg?.answers[q])]).filter(([, v]) => v),
            )}
            influences={pack.identity.influences?.value ?? { admire: [], avoid: [] }}
            languages={pack.identity.languages?.value ?? null}
            suggestions={<Suggestions tenantId={id} needed={suggestionsNeeded} at={sugg?.at ?? null} />}
            canRecord={canRecord}
            candidates={benchmarkPicks(live).map((s) => ({ id: s.id, text: s.body, channel: s.channel }))}
            benchmarks={live.filter((s) => s.kind === "benchmark").map((s) => s.id)}
            questions={QUESTIONS.filter((q) => CORE.includes(q.id))}
          />
        )}

        {step === 3 && <HueStep id={id} scope={scope} justGenerated={!!sp.pillars} carries={pack.identity.carries?.value ?? ""} />}

        {step === 4 && <Payoff id={id} scope={scope} />}
        </div>

        {/* The live preview: beside steps 1–3, so each answer visibly moves it. */}
        {step < 4 && (
          <div className="lg:sticky lg:top-6 order-first lg:order-none">
            <VoicePreview tenantId={id} version={pack.version} />
          </div>
        )}
        </div>

        <p className="text-[0.78rem] text-ink-faint border-t border-hairline pt-4">
          Your core is {conf.score}% confident{conf.trained ? "" : ", so it's still provisional"}. You can leave at any step; everything saves as you go.
        </p>
      </div>
    </div>
  );

  // ---- step 3 ------------------------------------------------------------------
  async function HueStep({ id, scope, justGenerated, carries }: { id: string; scope: Awaited<ReturnType<typeof workspaceScope>>["scope"]; justGenerated: boolean; carries: string }) {
    const [f, pillars, answers, assets] = await Promise.all([loadFoundation(scope), listPillars(scope), loadBriefAnswers(scope), listAssets(scope)]);
    const logo = assets.find((a) => a.kind === "logo")?.url ?? null;
    const headshot = assets.find((a) => a.kind === "headshot")?.url ?? null;
    const saved = Object.fromEntries(answers.map((a) => [a.key, a.answer]));
    const briefRows = [
      { label: "What you do", ok: !!(f.niche || f.positioning) },
      { label: "Who it's for", ok: !!f.audience },
      { label: "What you offer", ok: !!f.offers },
    ];
    const csv = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
    return (
      <section className="flex flex-col gap-6">
        <div>
          <h1 className="text-[1.9rem]">Set your <span className="serif-accent">hue.</span></h1>
          <p className="text-ink-muted mt-2 max-w-[60ch]">Your colour and your positioning. Set once here; every piece you write reads it. Nothing in this step blocks you from moving on.</p>
        </div>

        <div className="bg-paper border border-hairline rounded-[12px] p-5 flex flex-col gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-[1.05rem] flex-1">Your brief</h2>
            <Link href={`/w/${id}/brand/edit`} className={btnClass("secondary", "sm")}>Edit the brief</Link>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[0.88rem]">
            {briefRows.map((r) => (
              <li key={r.label} className="flex items-center gap-2">
                {r.ok ? <CheckCircle2 size={15} className="text-ok" aria-hidden="true" /> : <span className="w-[15px] h-[15px] rounded-full border border-line" aria-hidden="true" />}
                {r.label} <span className="sr-only">{r.ok ? "done" : "not yet"}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-paper border border-hairline rounded-[12px] p-5 flex flex-col gap-4">
          <div>
            <h2 className="text-[1.05rem]">Your look</h2>
            <p className="text-[0.88rem] text-ink-muted mt-1">Your logo, your face, and your colours. Every visual is made from these; the first two colours are the ground and the accent.</p>
          </div>
          <BrandImages tenantId={id} logo={logo} headshot={headshot} />
          <VisualForm tenantId={id} initial={{ palette: csv(f.palette), fonts: csv(f.fonts), imageStyleNotes: f.imageStyleNotes }} logoUrl={logo} />
        </div>

        <StoriesEditor tenantId={id} initial={pack!.identity.stories?.value ?? []} />
        <ProofsEditor tenantId={id} initial={pack!.identity.proofs?.value ?? []} />

        <form action={hueAction} className="bg-paper border border-hairline rounded-[12px] p-5 flex flex-col gap-4">
          <input type="hidden" name="tenantId" value={id} />
          <h2 className="text-[1.05rem]">Your pillars</h2>
          <p className="text-[0.88rem] text-ink-muted">Pillars come from your brief and two or three answers about what you stand for.</p>
          {[
            ["known_for", "Twelve months from now, what do you want to be known for?"],
            ["contrarian", "What do you believe that most people in your field would argue with?"],
            ["questions", "What do clients ask you over and over?"],
          ].map(([key, label]) => (
            <label key={key} className="block">
              <span className="block text-[0.85rem] font-medium mb-1.5">{label}</span>
              <textarea name={key} rows={2} defaultValue={saved[key] ?? ""} className="field" />
            </label>
          ))}
          {justGenerated && <p className="text-[0.85rem] text-ok flex items-center gap-2"><CheckCircle2 size={15} aria-hidden="true" /> {pillars.length} pillars ready.</p>}
          {pillars.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {pillars.map((p) => <li key={p.id}><Badge>{p.name}</Badge></li>)}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <SubmitButton name="intent" value="pillars" pendingLabel="Generating pillars…" variant={pillars.length ? "secondary" : "primary"}>
              {pillars.length ? "Generate more pillars" : "Generate my pillars"}
            </SubmitButton>
            <SubmitButton name="intent" value="save" pendingLabel="Saving…" variant="ghost">Save answers</SubmitButton>
          </div>
        </form>

        <div className="bg-paper border border-hairline rounded-[12px] p-5 flex flex-col gap-2">
          <h2 className="text-[1.05rem]">The one idea <span className="text-ink-faint font-normal text-[0.85rem]">· optional</span></h2>
          <p className="text-[0.88rem] text-ink-muted">Skip this if you don&apos;t know yet; nothing depends on it.</p>
          <QuestionField tenantId={id} q={questionById("A4")!} initial={carries} answered={!!carries} prefill={prefill("A4", carries, {}, pack!.onboarding.suggestions?.answers.A4) ?? undefined} />
        </div>

        <form action={goToStepAction.bind(null, id, 4)}>
          <SubmitButton pendingLabel="Opening…">Continue to your first draft</SubmitButton>
        </form>
      </section>
    );
  }

  // ---- step 4 ------------------------------------------------------------------
  async function Payoff({ id, scope }: { id: string; scope: Awaited<ReturnType<typeof workspaceScope>>["scope"] }) {
    const p = pack!;
    const firstId = p.onboarding.firstProjectId;
    const first = firstId ? await getProject(scope, firstId) : null;
    const draft = first ? (await listContent({ ...scope, projectId: first.id }))[0] ?? null : null;
    const own = live.filter((s) => s.visibility === "public").sort((a, b) => b.wordCount - a.wordCount)[0];
    const ownCheck = own ? await checkText(scope, own.body, own.channel) : null;
    const draftCheck = draft ? await checkText(scope, [draft.hook, draft.body, draft.cta].filter(Boolean).join("\n\n"), first?.channel ?? "linkedin") : null;
    const words = (p.identity.personalityWords?.value ?? []).map((w) => w.word);
    return (
      <PayoffStep
        tenantId={id}
        mode={p.workMode}
        core={
          <BrandCoreCard
            name={p.displayName || "Your voice"}
            seed={p.id}
            subtitle={`core v${p.version}`}
            trained={conf.trained}
            state={state}
            attributes={words.length ? words : (p.identity.toneDescriptors?.value ?? []).slice(0, 4)}
            confidence={conf.score}
            stats={[
              { label: "Samples", value: String(p.corpusStats.pieces) },
              { label: "Words read", value: p.corpusStats.words >= 1000 ? `${(p.corpusStats.words / 1000).toFixed(1)}k` : String(p.corpusStats.words) },
              { label: "Channels", value: String(p.corpusStats.channels.length) },
            ]}
          />
        }
        mirror={{
          words,
          openers: (p.mechanics.openers?.value ?? []).slice(0, 3).map((o) => o.example),
          never: p.index.neverWords,
          guardrail: p.guardrails[0] ? { id: p.guardrails[0].id, name: p.guardrails[0].name, rule: p.guardrails[0].rule } : null,
          dials: (p.identity.dials?.value ?? {}) as Partial<Record<DialKey, number>>,
          estimated: estimateDials(p),
        }}
        missing={conf.missing}
        confidence={conf.score}
        first={first && { id: first.id, name: first.name, hook: draft?.hook ?? null, body: draft?.body ?? null, cta: draft?.cta ?? null, score: draftCheck?.score ?? null, band: draftCheck?.band ?? null }}
        ownCheck={own && ownCheck ? { excerpt: own.body.split("\n")[0].slice(0, 160), score: ownCheck.score, band: ownCheck.band, issues: ownCheck.issues.slice(0, 3).map((i) => i.message) } : null}
      />
    );
  }
}
