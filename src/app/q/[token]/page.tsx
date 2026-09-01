import { notFound } from "next/navigation";
import { withTenantSession } from "@/db/session";
import { verifyQuestionnaireToken } from "@/lib/invite/token";
import { submitQuestionnaire } from "./actions";

export const dynamic = "force-dynamic";

const input =
  "w-full border border-hairline bg-muted-surface px-3 py-2 text-sm focus:outline-none focus:border-ink";

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
    <main className="flex-1 max-w-2xl mx-auto px-8 py-16 w-full">
      <p className="eyebrow mb-3">Pre-workshop questionnaire</p>
      <h1 className="text-3xl tracking-tight mb-2">
        Tell us about <span className="serif-accent">your brand.</span>
      </h1>
      <p className="text-sm text-ink-muted mb-8">
        For <strong>{name}</strong>. A few minutes now means the workshop starts
        from your real story, not a blank page.
      </p>

      {done ? (
        <div className="border border-hairline p-6">
          <p className="eyebrow mb-2 text-accent">Received</p>
          <p className="text-sm text-ink-muted">
            Thanks — your answers are saved as a draft foundation. See you at the
            workshop.
          </p>
        </div>
      ) : (
        <form action={submitQuestionnaire} className="flex flex-col gap-4">
          <input type="hidden" name="token" value={token} />
          <label className="block">
            <span className="eyebrow block mb-1.5">What&apos;s your niche?</span>
            <input name="niche" className={input} required />
          </label>
          <label className="block">
            <span className="eyebrow block mb-1.5">Who do you help, and with what?</span>
            <textarea name="positioning" rows={2} className={input} />
          </label>
          <label className="block">
            <span className="eyebrow block mb-1.5">Describe your audience</span>
            <textarea name="audience" rows={2} className={input} />
          </label>
          <label className="block">
            <span className="eyebrow block mb-1.5">Where did your story start?</span>
            <textarea name="story1" rows={2} className={input} />
          </label>
          <label className="block">
            <span className="eyebrow block mb-1.5">What was the turning point?</span>
            <textarea name="story2" rows={2} className={input} />
          </label>
          <label className="block">
            <span className="eyebrow block mb-1.5">What do you do now?</span>
            <textarea name="story3" rows={2} className={input} />
          </label>
          <label className="block">
            <span className="eyebrow block mb-1.5">Paste 3–5 posts that sound like you (one per line)</span>
            <textarea name="samples" rows={5} className={input} />
          </label>
          <div>
            <button type="submit"
              className="bg-ink text-paper px-6 py-3 text-sm font-medium hover:bg-accent transition-colors">
              Submit
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
