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
import { IdeateTree } from "./ideate-tree";
import { loadFoundation } from "@/lib/data/foundation";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { coreCardFacts } from "@/lib/voice/core-card";

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
  const [pillars, ideas, ctx, foundation, pack] = await Promise.all([
    listPillars(scope),
    listIdeas(scope),
    loadBrandContext(scope),
    loadFoundation(scope),
    loadPackForWorkspace(scope),
  ]);
  const facts = pack ? coreCardFacts(pack, new Date().getTime()) : null;
  const topic = project.name.startsWith("Untitled") ? "" : project.name;
  const base = `/w/${id}/p/${pid}`;
  const open = ideas.filter((i) => i.status === "new").slice(0, 6);
  const ready = pillars.length > 0 && !ctx.degraded;


  return (
    <DocPage
      eyebrow={`${project.name} · Ideate`}
      title="What's this one"
      accent="about?"
      sub="Your brand is already set. Pick where this piece goes, which pillar it belongs to and the angle it takes. Then write it: drafted for you, together, or yourself with a check."
    >
      {!ready && (
        <div className="bg-field border border-hairline rounded-md p-4 mb-6 text-sm">
          {pillars.length === 0 ? (
            <>
              No pillars yet. They&apos;re set up once for the whole workspace, not per piece.{" "}
              <Link href={`/w/${id}/brand/pillars`} className="underline underline-offset-2">Set up pillars →</Link>
            </>
          ) : (
            <>
              The brief is {ctx.completeness}% complete, so drafts will read generic.{" "}
              <Link href={`/w/${id}/p/${pid}/brief`} className="underline underline-offset-2">Open the brief →</Link>
            </>
          )}
        </div>
      )}

      {/* The questions on the left, and beside them the map of what they build. */}
      <div className="grid grid-cols-1 min-[1400px]:grid-cols-[minmax(0,620px)_minmax(0,1fr)] gap-x-14 gap-y-12 items-start">
      <form id="ideate-form" action={setIdeateAction} className="flex flex-col gap-6 min-w-0">
        <Hidden id={id} pid={pid} />

        <section className="border-t border-hairline pt-6">
          <p className="label-mono text-ink-faint mb-3">01 · Where does it go</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {FORMATS.map((f) => (
              <label
                key={f.key}
                className="border border-hairline rounded-md p-3 cursor-pointer text-sm hover:bg-field has-[:checked]:border-ink has-[:checked]:bg-field"
              >
                <input
                  type="radio"
                  name="format"
                  value={f.key}
                  defaultChecked={(project.format ?? "linkedin_post") === f.key}
                  className="sr-only"
                />
                <span className="block font-medium">{f.label}</span>
                <span className="block text-xs text-ink-faint mt-0.5">{f.frame.label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="border-t border-hairline pt-6">
          <p className="label-mono text-ink-faint mb-3">02 · Which pillar</p>
          {pillars.length === 0 ? (
            <p className="text-sm text-ink-faint">No pillars yet — this piece will be written from the brief alone.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {pillars.map((p) => (
                <label
                  key={p.id}
                  className="border border-line rounded-full px-4 min-h-11 flex items-center gap-1.5 cursor-pointer text-sm hover:border-line-strong has-[:checked]:bg-ink has-[:checked]:text-on-ink has-[:checked]:border-ink"
                >
                  <input type="radio" name="pillarId" value={p.id} defaultChecked={project.pillarId === p.id} className="sr-only" />
                  {p.name}
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="border-t border-hairline pt-6">
          <p className="label-mono text-ink-faint mb-3">03 · The angle</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {ANGLES.map((a) => (
              <label
                key={a}
                className="border border-hairline rounded-sm px-3.5 min-h-12 flex items-center gap-2.5 cursor-pointer text-sm hover:border-line has-[:checked]:border-line-strong has-[:checked]:bg-hover"
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
              defaultValue={topic}
              placeholder="One line. e.g. Why your first 90 days as a manager decide everything"
              className="field mt-1.5"
            />
          </label>
        </section>

        <div className="flex items-center gap-3">
          <button type="submit" name="next" value="content" className={btnClass("primary", "md")}>
            Write it <ArrowRight size={14} />
          </button>
          <SubmitButton pendingLabel="Saving…" size="md" variant="ghost">Save and stay</SubmitButton>
        </div>
      </form>

      <div className="min-[1400px]:sticky min-[1400px]:top-6 min-w-0">
        <IdeateTree
          formId="ideate-form"
          core={{
            name: facts?.name ?? "Your voice",
            confidence: facts?.confidence ?? 0,
            voiceLine: pack?.voiceLine ?? "",
            tones: facts?.attributes ?? [],
            samples: pack?.corpusStats.pieces ?? 0,
            stories: pack?.identity.stories?.value?.length ?? 0,
            proofs: pack?.identity.proofs?.value?.length ?? 0,
          }}
          brief={{ niche: foundation.niche, audience: foundation.audience, positioning: foundation.positioning }}
          pillars={pillars.map((p) => ({ id: p.id, name: p.name }))}
          initial={{ format: project.format ?? "linkedin_post", pillarId: project.pillarId ?? "", angle: project.angle ?? "", topic }}
        />
      </div>
      </div>

      {open.length > 0 && (
        <section className="mt-10">
          <p className="label-mono text-ink-faint mb-3">From your idea inbox</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {open.map((i) => (
              <form key={i.id} action={setIdeateAction} className="bg-field rounded-xl p-4 flex flex-col gap-3">
                <Hidden id={id} pid={pid} />
                <input type="hidden" name="ideaId" value={i.id} />
                <input type="hidden" name="topic" value={i.rawText} />
                {i.pillarId && <input type="hidden" name="pillarId" value={i.pillarId} />}
                <p className="text-sm leading-relaxed flex-1">{i.rawText}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-faint">{i.pillarName ?? "Untagged"}</span>
                  <SubmitButton pendingLabel="Using…" size="sm" variant="ghost">Use this</SubmitButton>
                </div>
              </form>
            ))}
          </div>
        </section>
      )}

      {open.length === 0 && (
        <div className="mt-10 border-y border-hairline">
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

/** The workspace and project every form on this page acts in. */
function Hidden({ id, pid }: { id: string; pid: string }) {
  return (
    <>
      <input type="hidden" name="tenantId" value={id} />
      <input type="hidden" name="projectId" value={pid} />
    </>
  );
}
