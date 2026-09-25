import Link from "next/link";
import { Lightbulb, ArrowRight, Check } from "lucide-react";
import { projectScope } from "@/lib/auth/workspace";
import { listIdeas, listPillars } from "@/lib/data/planning";
import { loadBrandContext } from "@/lib/context/context-loader";
import { FORMATS } from "@/lib/content/formats";
import { DocPage } from "@/components/doc-page";
import { EmptyState, SubmitButton } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { setIdeateAction } from "./actions";

export const metadata = { title: "Ideate" };

/** The angles a piece can take. The same list the batch generator draws on. */
const ANGLES = [
  "The mistake most people make",
  "A story from the work",
  "A simple framework",
  "What I'd do differently",
  "Where I disagree with the field",
  "What the work has taught me",
];

/**
 * Step 1 of a piece: what is this one about?
 *
 * The brand — brief, voice, visual identity, pillars — was settled once in
 * onboarding and does not appear here. All that changes from one piece to the
 * next is the format, the pillar it sits under, and the angle it takes, so
 * that is all this step asks for.
 */
export default async function IdeatePage({ params }: PageProps<"/w/[id]/p/[pid]/ideate">) {
  const { id, pid } = await params;
  const { scope, project } = await projectScope(id, pid);
  const [pillars, ideas, ctx] = await Promise.all([
    listPillars(scope),
    listIdeas(scope),
    loadBrandContext(scope),
  ]);
  const base = `/w/${id}/p/${pid}`;
  const open = ideas.filter((i) => i.status === "new").slice(0, 6);
  const ready = pillars.length > 0 && !ctx.degraded;

  const Hidden = () => (
    <>
      <input type="hidden" name="tenantId" value={id} />
      <input type="hidden" name="projectId" value={pid} />
    </>
  );

  return (
    <DocPage
      eyebrow={`${project.name} · Ideate`}
      title="What's this one"
      accent="about?"
      sub="Your brand is already set. Pick where this piece goes, which pillar it belongs to and the angle it takes — then we draft it in your voice."
    >
      {!ready && (
        <div className="bg-field border border-hairline rounded-[12px] p-4 mb-6 text-[0.85rem]">
          {pillars.length === 0 ? (
            <>
              No pillars yet. They&apos;re set up once for the whole workspace, not per piece.{" "}
              <Link href={`/w/${id}/p/${pid}/pillars`} className="underline underline-offset-2">Set up pillars →</Link>
            </>
          ) : (
            <>
              The brief is {ctx.completeness}% complete, so drafts will read generic.{" "}
              <Link href={`/w/${id}/p/${pid}/brief`} className="underline underline-offset-2">Open the brief →</Link>
            </>
          )}
        </div>
      )}

      <form action={setIdeateAction} className="flex flex-col gap-6">
        <Hidden />

        <section className="bg-paper border border-hairline rounded-[14px] p-5">
          <p className="label-mono text-ink-faint mb-3">01 · Where does it go</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {FORMATS.map((f) => (
              <label
                key={f.key}
                className="border border-hairline rounded-[10px] p-3 cursor-pointer text-[0.82rem] hover:bg-field has-[:checked]:border-ink has-[:checked]:bg-field"
              >
                <input
                  type="radio"
                  name="format"
                  value={f.key}
                  defaultChecked={(project.format ?? "linkedin_post") === f.key}
                  className="sr-only"
                />
                <span className="block font-medium">{f.label}</span>
                <span className="block text-[0.7rem] text-ink-faint mt-0.5">{f.frame.label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="bg-paper border border-hairline rounded-[14px] p-5">
          <p className="label-mono text-ink-faint mb-3">02 · Which pillar</p>
          {pillars.length === 0 ? (
            <p className="text-[0.85rem] text-ink-faint">No pillars yet — this piece will be written from the brief alone.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {pillars.map((p) => (
                <label
                  key={p.id}
                  className="border border-hairline rounded-[999px] px-3 h-8 flex items-center gap-1.5 cursor-pointer text-[0.82rem] hover:bg-field has-[:checked]:bg-ink has-[:checked]:text-on-ink has-[:checked]:border-ink"
                >
                  <input type="radio" name="pillarId" value={p.id} className="sr-only" />
                  {p.name}
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="bg-paper border border-hairline rounded-[14px] p-5">
          <p className="label-mono text-ink-faint mb-3">03 · The angle</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {ANGLES.map((a) => (
              <label
                key={a}
                className="border border-hairline rounded-[10px] px-3 h-10 flex items-center gap-2 cursor-pointer text-[0.85rem] hover:bg-field has-[:checked]:border-ink has-[:checked]:bg-field"
              >
                <input type="radio" name="angle" value={a} defaultChecked={project.angle === a} className="sr-only" />
                {project.angle === a && <Check size={13} />}
                {a}
              </label>
            ))}
          </div>
          <label className="block mt-4">
            <span className="label-mono text-ink-faint">What it&apos;s about</span>
            <input
              name="topic"
              defaultValue={project.name.startsWith("Untitled") ? "" : project.name}
              placeholder="One line. e.g. Why your first 90 days as a manager decide everything"
              className="field mt-1.5"
            />
          </label>
        </section>

        <div className="flex items-center gap-3">
          <button type="submit" name="next" value="content" className={btnClass("primary", "md")}>
            Draft it <ArrowRight size={14} />
          </button>
          <SubmitButton pendingLabel="Saving…" size="md" variant="ghost">Save and stay</SubmitButton>
        </div>
      </form>

      {open.length > 0 && (
        <section className="mt-10">
          <p className="label-mono text-ink-faint mb-3">From your idea inbox</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {open.map((i) => (
              <form key={i.id} action={setIdeateAction} className="bg-paper border border-hairline rounded-[12px] p-4 flex flex-col gap-3">
                <Hidden />
                <input type="hidden" name="ideaId" value={i.id} />
                <input type="hidden" name="topic" value={i.rawText} />
                {i.pillarId && <input type="hidden" name="pillarId" value={i.pillarId} />}
                <p className="text-[0.9rem] leading-relaxed flex-1">{i.rawText}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[0.72rem] text-ink-faint">{i.pillarName ?? "Untagged"}</span>
                  <SubmitButton pendingLabel="Using…" size="sm" variant="ghost">Use this</SubmitButton>
                </div>
              </form>
            ))}
          </div>
        </section>
      )}

      {open.length === 0 && (
        <div className="mt-10 bg-paper border border-hairline rounded-[14px]">
          <EmptyState
            icon={<Lightbulb size={18} />}
            title="Nothing in the idea inbox"
            sub="Ideas you capture for the workspace show up here, ready to become a piece."
          />
        </div>
      )}
    </DocPage>
  );
}
