import Link from "next/link";
import { Pencil, Sparkles, AlertTriangle, FileImage, ChevronRight, CheckCircle2 } from "lucide-react";
import { projectScope } from "@/lib/auth/workspace";
import { loadFoundation } from "@/lib/data/foundation";
import { loadBrandContext } from "@/lib/context/context-loader";
import { listAssets } from "@/lib/data/assets";
import { listOffers } from "@/lib/data/planning";
import { Meter } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { BriefToc } from "./toc";
import type { Stage } from "@/lib/projects/stages";
import { MIN_SEEDS } from "@/lib/brief/questions";

/** Step 1's "what's next" card: brief → questions → generate pillars. */
function StepCard({ base, completeness, degraded, answered, stage }: { base: string; completeness: number; degraded: boolean; answered: number; stage: Stage }) {
  // Pillars belong to the workspace now, so the only question is whether any
  // have been generated yet — not which step this one piece is on.
  const done = stage !== "ideate";
  return (
    <div className="bg-paper border border-hairline rounded-[12px] p-4">
      <p className="label-mono text-ink-faint">Onboarding · Brief</p>
      <ul className="mt-3 flex flex-col gap-2 text-[0.8rem]">
        <li className="flex items-center gap-2">{!degraded ? <CheckCircle2 size={14} className="text-ok" /> : <AlertTriangle size={14} className="text-warn" />} Brief {completeness}% complete</li>
        <li className="flex items-center gap-2">{answered >= MIN_SEEDS ? <CheckCircle2 size={14} className="text-ok" /> : <AlertTriangle size={14} className="text-ink-faint" />} {answered} strategy answers</li>
        <li className="flex items-center gap-2">{done ? <CheckCircle2 size={14} className="text-ok" /> : <AlertTriangle size={14} className="text-ink-faint" />} Pillars generated</li>
      </ul>
      {done ? (
        <Link href={`${base}/pillars`} className={`${btnClass("primary", "sm")} w-full mt-4`}>Go to Pillars →</Link>
      ) : (
        <Link href={`${base}/brief/questions`} className={`${btnClass("primary", "sm")} w-full mt-4`}>Answer questions →</Link>
      )}
      <p className="text-[0.7rem] text-ink-faint mt-2">Pillars are generated from the brief plus your answers.</p>
    </div>
  );
}

export const metadata = { title: "Brief" };

const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function Empty({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block text-[0.9rem] text-ink-faint border border-dashed border-line rounded-[10px] px-4 py-3 hover:border-ink hover:text-ink transition-colors">
      {children}
    </Link>
  );
}

export default async function BriefPage({ params, searchParams }: PageProps<"/w/[id]/p/[pid]/brief">) {
  const { id, pid } = await params;
  const { saved } = await searchParams;
  const { scope, project } = await projectScope(id, pid);
  const [f, ctx, assets, offers] = await Promise.all([
    loadFoundation(scope), loadBrandContext(scope), listAssets(scope), listOffers(scope),
  ]);
  const base = `/w/${id}/p/${pid}`;
  const edit = `${base}/brief/edit`;
  const answered = project.briefAnswers.length;
  const chapters = f.chapters.filter((c) => c.body.trim());
  const samples = f.samplePosts.split("\n").map((s) => s.trim()).filter(Boolean);
  const palette = csv(f.palette);

  const sections = [
    { id: "what", label: "What they do" },
    { id: "audience", label: "Target audience" },
    { id: "story", label: "Story arc" },
    { id: "voice", label: "Voice" },
    { id: "visual", label: "Visual identity" },
    { id: "offers", label: "Offers" },
    { id: "docs", label: "Supporting docs" },
  ];

  return (
    <div className="h-full overflow-y-auto" id="brief-scroll">
      <div className="max-w-[1080px] mx-auto px-8 py-10 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_240px] gap-12">
        <article className="min-w-0 max-w-[720px]">
          {/* Banner */}
          <div className="relative overflow-hidden bg-paper border border-hairline rounded-[14px] px-6 py-5 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-[1.05rem] font-medium">Brand brief</p>
              <p className="text-[0.8rem] text-ink-muted mt-0.5">Every draft and visual is generated from this. Keep it current.</p>
            </div>
            <div className="w-40 hidden sm:block">
              <div className="flex justify-between text-[0.72rem] text-ink-faint mb-1"><span>Complete</span><span className="tabular-nums">{ctx.completeness}%</span></div>
              <Meter value={ctx.completeness} tone={ctx.degraded ? "accent" : "ink"} />
            </div>
            <span className="w-11 h-11 rounded-full bg-ink text-on-ink flex items-center justify-center shrink-0"><Sparkles size={17} /></span>
          </div>

          {saved && (
            <p className="mt-4 flex items-center gap-2 text-[0.85rem] text-ok"><CheckCircle2 size={15} /> Brief saved. Every new draft now uses this version.</p>
          )}

          {ctx.degraded && (
            <div className="mt-4 bg-warn-soft rounded-[12px] px-4 py-3.5 flex gap-3">
              <AlertTriangle size={16} className="text-warn shrink-0 mt-0.5" />
              <div className="text-[0.85rem]">
                <p className="font-medium text-warn">This brief is too thin for on-brand output.</p>
                <p className="text-ink-muted mt-0.5">The studio will still draft, but it will say so. Missing: {ctx.warnings.slice(0, 3).join(" ")}</p>
              </div>
            </div>
          )}

          <div className="flex items-start justify-between gap-4 mt-10">
            <h1 className="text-[2.1rem] leading-tight">{project.name}</h1>
            <div className="flex gap-2 shrink-0">
              <Link href={`${base}/intake`} className={btnClass("ghost", "sm")}>Paste notes</Link>
              <Link href={edit} className={btnClass("secondary", "sm")}><Pencil size={13} /> Edit brief</Link>
            </div>
          </div>

          <section id="what" className="scroll-mt-6 mt-8">
            <h2 className="text-[1.45rem]">What they do</h2>
            {f.niche || f.positioning ? (
              <div className="mt-3 text-[0.98rem] leading-[1.7] text-ink/90 space-y-3">
                {f.niche && <p><span className="font-semibold">{f.niche}.</span></p>}
                {f.positioning && <p>{f.positioning}</p>}
              </div>
            ) : <div className="mt-3"><Empty href={edit}>Add a niche and positioning statement →</Empty></div>}
          </section>

          <section id="audience" className="scroll-mt-6 mt-10">
            <h2 className="text-[1.45rem]">Target audience</h2>
            {f.audience ? <p className="mt-3 text-[0.98rem] leading-[1.7] text-ink/90">{f.audience}</p> : <div className="mt-3"><Empty href={edit}>Describe who this brand talks to →</Empty></div>}
          </section>

          <section id="story" className="scroll-mt-6 mt-10">
            <h2 className="text-[1.45rem]">Story arc</h2>
            {chapters.length ? (
              <ol className="mt-4 grid gap-3">
                {f.chapters.map((c, i) => (
                  <li key={i} className="flex gap-4">
                    <span className="label-mono text-ink-faint pt-1 w-6 shrink-0">0{i + 1}</span>
                    <div className="flex-1 border-b border-hairline pb-3">
                      <p className="font-medium">{c.title || ["Origin", "Turning point", "Now"][i]}</p>
                      <p className="text-[0.95rem] text-ink-muted leading-relaxed mt-0.5">{c.body || <span className="text-ink-faint">Not written yet</span>}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : <div className="mt-3"><Empty href={edit}>Write the three chapters: origin, turning point, now →</Empty></div>}
          </section>

          <section id="voice" className="scroll-mt-6 mt-10">
            <div className="flex items-baseline gap-3">
              <h2 className="text-[1.45rem] flex-1">Voice</h2>
              {/* The voice belongs to the person, so it is edited once for the
                  workspace rather than per piece. */}
              <Link href={`/w/${id}/brand/voice`} className="label-mono text-accent hover:underline underline-offset-2">
                Open the voice pack ↗
              </Link>
            </div>
            <ul className="mt-3 list-disc pl-5 space-y-2 text-[0.98rem] leading-[1.65] text-ink/90">
              <li><span className="font-medium">Tone:</span> {f.tone || <span className="text-ink-faint">not set</span>}{f.readingLevel && <span className="text-ink-muted"> · reading level {f.readingLevel}</span>}</li>
              <li><span className="font-medium">Use:</span> {csv(f.doWords).length ? csv(f.doWords).join(", ") : <span className="text-ink-faint">no do-words</span>}</li>
              <li>
                <span className="font-medium">Never use:</span>{" "}
                {csv(f.dontWords).length ? csv(f.dontWords).map((w) => <span key={w} className="inline-block mr-1 px-1.5 rounded-[5px] bg-accent-soft text-accent-ink text-[0.85rem]">{w}</span>) : <span className="text-ink-faint">no don&apos;t-words (guardrails off)</span>}
              </li>
            </ul>
            {samples.length > 0 && (
              <div className="mt-5">
                <p className="label-mono text-ink-faint mb-2">Sample posts · {samples.length}</p>
                <div className="grid gap-2">
                  {samples.slice(0, 5).map((s, i) => (
                    <blockquote key={i} className="bg-paper border border-hairline rounded-[10px] px-4 py-3 text-[0.9rem] leading-relaxed text-ink-muted">“{s}”</blockquote>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section id="visual" className="scroll-mt-6 mt-10">
            <h2 className="text-[1.45rem]">Visual identity</h2>
            {palette.length || f.fonts || f.imageStyleNotes ? (
              <div className="mt-4 grid gap-4">
                {palette.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {palette.map((c) => (
                      <div key={c} className="w-24">
                        <div className="h-14 rounded-[8px] border border-hairline" style={{ background: c }} />
                        <p className="label-mono text-ink-faint mt-1.5">{c}</p>
                      </div>
                    ))}
                  </div>
                )}
                {f.fonts && <p className="text-[0.95rem]"><span className="font-medium">Type:</span> {f.fonts}</p>}
                {f.imageStyleNotes && <p className="text-[0.95rem] leading-relaxed"><span className="font-medium">Imagery:</span> {f.imageStyleNotes}</p>}
              </div>
            ) : <div className="mt-3"><Empty href={edit}>Add palette, fonts and image style notes →</Empty></div>}
          </section>

          <section id="offers" className="scroll-mt-6 mt-10">
            <h2 className="text-[1.45rem]">Offers</h2>
            {f.offers && <p className="mt-3 text-[0.98rem] leading-[1.7] text-ink/90">{f.offers}</p>}
            {offers.length > 0 && (
              <div className="mt-3 grid gap-2">
                {offers.map((o) => (
                  <Link key={o.id} href={`${base}/offers`} className="flex items-center justify-between bg-paper border border-hairline rounded-[10px] px-4 h-11 hover:border-line text-[0.9rem]">
                    <span>{o.name} {o.format && <span className="text-ink-faint">· {o.format}</span>}</span><ChevronRight size={15} className="text-ink-faint" />
                  </Link>
                ))}
              </div>
            )}
            {!f.offers && offers.length === 0 && <div className="mt-3"><Empty href={`${base}/offers`}>Design an offer, reusable in pitch emails →</Empty></div>}
          </section>

          <section id="docs" className="scroll-mt-6 mt-10 pb-16">
            <h2 className="text-[1.45rem]">Supporting docs</h2>
            {assets.length ? (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {assets.map((a) => (
                  <div key={a.id} className="bg-paper border border-hairline rounded-[10px] p-2">
                    {a.mime.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.url} alt={a.kind} className="w-full h-20 object-contain rounded-[6px] bg-panel" />
                    ) : (
                      <div className="h-20 flex items-center justify-center text-ink-faint bg-panel rounded-[6px]"><FileImage size={18} /></div>
                    )}
                    <p className="label-mono text-ink-faint mt-1.5 truncate">{a.kind.replace("_", " ")}</p>
                  </div>
                ))}
              </div>
            ) : <div className="mt-3"><Empty href={`${edit}#assets`}>Upload a logo, fonts or reference images →</Empty></div>}
          </section>
        </article>

        <div className="hidden lg:flex flex-col gap-6 sticky top-10 self-start">
          <StepCard base={base} completeness={ctx.completeness} degraded={ctx.degraded} answered={answered} stage={project.stage} />
          <BriefToc sections={sections} />
        </div>
      </div>
    </div>
  );
}
