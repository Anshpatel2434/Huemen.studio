import Link from "next/link";
import { ArrowLeft, CheckCircle2, FileText, Network, Info } from "lucide-react";
import { workspaceScope } from "@/lib/auth/workspace";
import { getWorkspace } from "@/lib/data/workspaces";
import { loadBriefAnswers } from "@/lib/data/foundation";
import { loadFoundation } from "@/lib/data/foundation";
import { loadBrandContext } from "@/lib/context/context-loader";
import { listPillars } from "@/lib/data/planning";
import { buildQuestions, MIN_SEEDS } from "@/lib/brief/questions";
import { SubmitButton, Alert } from "@/components/ui";
import { answerQuestionsAction } from "../actions";
import { btnClass } from "@/components/btn";

export const metadata = { title: "Brief questions" };

export default async function QuestionsPage({ params, searchParams }: PageProps<"/w/[id]/brand/questions">) {
  const { id } = await params;
  const sp = await searchParams;
  const { scope } = await workspaceScope(id);
  const ws = await getWorkspace(scope);
  const [f, ctx] = await Promise.all([loadFoundation(scope), loadBrandContext(scope)]);
  const questions = buildQuestions(f);
  const saved = Object.fromEntries((await loadBriefAnswers(scope)).map((a) => [a.key, a.answer]));
  const gaps = questions.filter((q) => q.target !== "seed");
  const strategy = questions.filter((q) => q.target === "seed");
  const base = `/w/${id}/brand`;
  const pillarsDone = (await listPillars(scope)).length > 0;

  const Q = ({ q, n }: { q: (typeof questions)[number]; n: number }) => (
    <label className="block bg-paper border border-hairline rounded-md p-4">
      <span className="flex items-baseline gap-2">
        <span className="label-mono text-ink-faint">{String(n).padStart(2, "0")}</span>
        <span className="text-base font-medium">{q.question}</span>
      </span>
      <span className="block text-xs text-ink-faint mt-0.5 mb-2.5 pl-7">{q.why}</span>
      {q.rows === 1 ? (
        <input name={`q_${q.key}`} defaultValue={saved[q.key] ?? ""} placeholder={q.placeholder} className="field" />
      ) : (
        <textarea name={`q_${q.key}`} defaultValue={saved[q.key] ?? ""} placeholder={q.placeholder} rows={q.rows} className="field" />
      )}
    </label>
  );

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="max-w-[1040px] mx-auto px-8 py-8 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_260px] gap-10">
        <div>
          <Link href={base} className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"><ArrowLeft size={14} /> Brief</Link>
          <p className="label-mono text-ink-faint mt-5">Step 1 of 4 · Brief questions</p>
          <h1 className="text-3xl mt-1.5">A few questions, <span className="serif-accent">then pillars.</span></h1>
          <p className="text-ink-muted mt-2 text-sm max-w-xl">We read the brief. Anything missing is asked first and goes straight into it. The strategy questions seed your content pillars.</p>

          {sp.placed && (
            <p className="mt-5 flex items-center gap-2 text-sm bg-panel border border-hairline rounded-md px-3 py-2.5"><Info size={14} /> Your notes filled {sp.placed} field{sp.placed === "1" ? "" : "s"} of the brief. Here&apos;s what&apos;s left.</p>
          )}
          {sp.saved && <p className="mt-5 flex items-center gap-2 text-sm text-ok"><CheckCircle2 size={15} /> Answers saved.</p>}
          {sp.blocked && (
            <Alert tone="info" className="mt-5" title="Not enough to build pillars yet">
              Get the brief past 50% ({ctx.completeness}% now) and answer at least {MIN_SEEDS} strategy questions.
            </Alert>
          )}

          <form action={answerQuestionsAction} className="mt-6 flex flex-col gap-3 pb-24">
            <input type="hidden" name="tenantId" value={id} />

            {gaps.length > 0 && (
              <>
                <p className="flex items-center gap-2 label-mono text-ink-muted mt-2"><FileText size={13} /> Fills your brief · {gaps.length}</p>
                {gaps.map((q, i) => <Q key={q.key} q={q} n={i + 1} />)}
              </>
            )}
            <p className="flex items-center gap-2 label-mono text-ink-muted mt-4"><Network size={13} /> Seeds your pillars · answer at least {MIN_SEEDS}</p>
            {strategy.map((q, i) => <Q key={q.key} q={q} n={gaps.length + i + 1} />)}

            <div className="sticky bottom-0 -mx-8 px-8 py-3 mt-2 bg-ground/90 backdrop-blur border-t border-hairline flex items-center justify-end gap-2">
              <button name="intent" value="save" className={btnClass("ghost", "sm")}>Save answers</button>
              <SubmitButton variant="primary" name="intent" value="generate" pendingLabel="Generating pillars…">
                {pillarsDone ? "Add more pillars →" : "Generate pillars →"}
              </SubmitButton>
            </div>
          </form>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-8 bg-paper border border-hairline rounded-md p-4">
            <p className="label-mono text-ink-faint">How the steps connect</p>
            <ol className="mt-3 flex flex-col gap-3 text-sm">
              {[
                ["Brief", "Story, voice, visuals + these answers"],
                ["Pillars", "3–5 themes generated from the brief"],
                ["Content", "Drafts generated from each pillar"],
                ["Visual", "On-brand frames generated from the drafts"],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-2.5">
                  <span className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-xs font-medium ${i === 0 ? "bg-ink text-on-ink" : "bg-field"}`}>{i + 1}</span>
                  <span><span className="font-medium">{t}</span><span className="block text-ink-muted">{d}</span></span>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
