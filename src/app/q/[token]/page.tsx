import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { withTenantSession } from "@/db/session";
import { verifyQuestionnaireToken } from "@/lib/invite/token";
import { LogoMark, SubmitButton } from "@/components/ui";
import { PersistForm } from "@/components/persist";
import { submitQuestionnaire } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pre-workshop questionnaire" };

const QUESTIONS: { name: string; label: string; rows?: number; required?: boolean; hint?: string }[] = [
  { name: "niche", label: "What's your niche?", rows: 1, required: true, hint: "e.g. Leadership coaching for first-time managers" },
  { name: "positioning", label: "Who do you help, and with what?", rows: 2 },
  { name: "audience", label: "Describe your audience", rows: 2 },
  { name: "story1", label: "Where did your story start?", rows: 2 },
  { name: "story2", label: "What was the turning point?", rows: 2 },
  { name: "story3", label: "What do you do now?", rows: 2 },
  { name: "samples", label: "Paste 3–5 posts that sound like you", rows: 5, hint: "One post per line." },
];

export default async function QuestionnairePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { token } = await params;
  const { done } = await searchParams;
  const tenantId = verifyQuestionnaireToken(token);
  if (!tenantId) notFound();

  // Read the workspace name (public: name only) to brand the form.
  const name = (
    await withTenantSession(
      { tenantId, userId: null, isPlatformAdmin: true },
      (c) => c.query<{ name: string }>("SELECT name FROM tenants WHERE id=$1", [tenantId]),
    )
  ).rows[0]?.name;
  if (!name) notFound();

  return (
    <main className="flex-1 flex flex-col items-center px-5 py-14">
      <LogoMark size={32} />
      <p className="label-mono text-ink-faint mt-6">Pre-workshop questionnaire · {name}</p>
      <h1 className="text-[2rem] sm:text-[2.4rem] text-center mt-3 leading-[1.1] max-w-xl">
        Tell us your story. <span className="serif-accent">We&apos;ll bring the brief.</span>
      </h1>
      <p className="text-ink-muted text-center mt-3 max-w-md">
        A few minutes now means the workshop starts from your real story, not a blank page.
      </p>

      {done ? (
        <div className="mt-10 w-full max-w-[640px] bg-paper border border-hairline rounded-[14px] p-8 text-center fade-up">
          <CheckCircle2 className="mx-auto text-ok" size={28} />
          <p className="mt-3 font-medium">Received, thank you.</p>
          <p className="text-ink-muted text-[0.875rem] mt-1">Your answers are saved as a draft brief. See you at the workshop.</p>
        </div>
      ) : (
        <PersistForm storageKey={`huemen:q:${token}`} action={submitQuestionnaire} className="mt-10 w-full max-w-[640px] bg-paper border border-hairline rounded-[14px] p-6 sm:p-8 flex flex-col gap-5 shadow-[var(--shadow-sm)]">
          <input type="hidden" name="token" value={token} />
          {QUESTIONS.map((q, i) => (
            <label key={q.name} className="block">
              <span className="flex items-baseline gap-2 mb-1.5">
                <span className="label-mono text-ink-faint">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-[0.9rem] font-medium">{q.label}</span>
              </span>
              {q.rows === 1 ? (
                <input name={q.name} className="field" required={q.required} placeholder={q.hint} />
              ) : (
                <textarea name={q.name} rows={q.rows} className="field" placeholder={q.hint} />
              )}
            </label>
          ))}
          <div className="flex justify-end pt-1">
            <SubmitButton pendingLabel="Saving…">Submit answers</SubmitButton>
          </div>
        </PersistForm>
      )}
    </main>
  );
}
