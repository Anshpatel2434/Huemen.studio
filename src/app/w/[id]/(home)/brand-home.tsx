/**
 * Brand home: the workspace's front door (design system §14, §15). The brand
 * core is the hero because it is what every piece is written from; around it,
 * what to write next, the pieces in progress with their real first lines and
 * voice scores, what's planned, and how much AI is left this month.
 *
 * The full file browser (filters, grid/list, every project) is the library,
 * one click away at `?view=all`.
 */
import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CalendarDays, Lightbulb, Mic, Sparkles } from "lucide-react";
import { Alert, EmptyState } from "@/components/ui";
import { hueFor } from "@/lib/ui/hue";
import { btnClass } from "@/components/btn";
import { BrandCoreCard, UsageMeter } from "@/components/composites";
import { STAGE_LABEL, stageIndex } from "@/lib/projects/stages";
import type { CoreCardFacts } from "@/lib/voice/core-card";
import { Proposals, ProposalsLoading, Start } from "../create/proposals";
import { SuggestOthers } from "../create/suggest-others";
import { HomeActions, NewProjectButton } from "./home-actions";
import { BandPill, ago, type Project } from "./project-bits";

export interface BrandHomeProps {
  tenantId: string;
  workspaceName: string;
  now: number;
  projects: Project[];
  core: CoreCardFacts | null;
  /** The format suggestions start in (the person's first platform). */
  format: string | null;
  ideas: { id: string; rawText: string; pillarName: string | null }[];
  upcoming: { id: string; date: string; topic: string | null; pillarName: string | null }[];
  usage: { text: number; images: number; textCap: number | null; imageCap: number | null; resets: string };
  showWhatsNew: boolean;
  setupStep: number | null;
  rescanDays: number | null;
  justFinished: boolean;
}

const Eyebrow = ({ children }: { children: React.ReactNode }) => <p className="label-mono text-ink-faint">{children}</p>;

export function BrandHome(props: BrandHomeProps) {
  const { tenantId, workspaceName, now, projects, core, format, ideas, upcoming, usage } = props;
  const recent = projects.slice(0, 6);
  const base = `/w/${tenantId}`;

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="max-w-[1180px] mx-auto px-5 min-[900px]:px-8 pt-8 pb-16 flex flex-col gap-8">
        <header className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <div className="flex-1 min-w-[16ch]">
            <p className="label-mono eyebrow">{workspaceName} · Brand home</p>
            <h1 className="text-3xl mt-2">Write the <span className="serif-accent">next one.</span></h1>
          </div>
          <HomeActions tenantId={tenantId} projects={projects.map((p) => ({ id: p.id, name: p.name }))} showWhatsNew={props.showWhatsNew && !props.justFinished} />
        </header>

        {/* What needs doing first: finishing setup, the welcome, or a re-measure. */}
        {props.justFinished && (
          <Alert tone="success" title="You're set up." action={<Link href={`${base}/create`} className={btnClass("primary", "sm")}>Write the next one</Link>}>
            Your voice is in every piece from here, and your first one is below.
          </Alert>
        )}
        {props.setupStep != null && (
          <Alert tone="info" title="Set up your voice" action={<Link href={`${base}/onboarding?step=${props.setupStep}`} className={btnClass("primary", "sm")}>{props.setupStep > 0 ? "Carry on" : "Start"}</Link>}>
            Step {props.setupStep + 1} of 5. Until it&apos;s done, drafts won&apos;t sound much like you.
          </Alert>
        )}
        {props.rescanDays != null && props.setupStep == null && (
          <Alert tone="info" action={<Link href={`${base}/brand/voice?preview=1#remeasure`} className={btnClass("secondary", "sm")}>See what would change</Link>}>
            It&apos;s been {props.rescanDays} days since we measured your writing, and you&apos;ve published since. A fresh look keeps drafts close to how you sound now.
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-8 items-start">
          {/* Right column first on phones: the core is what everything is written from. */}
          <aside className="flex flex-col gap-4 lg:order-2" aria-label="Your brand core">
            {core ? (
              <>
                <BrandCoreCard {...core} />
                <div className="grid grid-cols-2 gap-2">
                  <Link href={`${base}/brand/voice`} className={btnClass("secondary", "sm")}>What it learned</Link>
                  <Link href={`${base}/onboarding?step=1`} className={btnClass("ghost", "sm")}>Add writing</Link>
                </div>
                {core.state === "trained" && core.confidence < 70 && (
                  <Alert tone="warning" title={`Your core is ${core.confidence}% confident`}>
                    Drafts will read generic until it knows you better.{core.missing[0] ? ` ${core.missing[0]}.` : ""}
                  </Alert>
                )}
              </>
            ) : (
              <div className="hu-card">
                <EmptyState icon={<Mic size={18} />} title="No voice yet" sub="Your core is built from your own writing and a few answers. Everything here is written from it." action={<Link href={`${base}/brand/voice`} className={btnClass("primary", "sm")}>Set it up</Link>} />
              </div>
            )}

            <section className="hu-card !p-5 flex flex-col gap-4" aria-labelledby="usage-h">
              <div className="flex items-center justify-between gap-2">
                <h2 id="usage-h" className="text-base">This month</h2>
                <Link href={`${base}/usage`} className={btnClass("ghost", "sm")}>Usage <ArrowUpRight size={15} aria-hidden="true" /></Link>
              </div>
              <UsageMeter
                rows={[
                  { label: "Drafts and checks", used: usage.text, cap: usage.textCap },
                  { label: "Images", used: usage.images, cap: usage.imageCap },
                ]}
                resets={usage.resets}
              />
            </section>
          </aside>

          <div className="flex flex-col gap-10 min-w-0 lg:order-1">
            <section className="flex flex-col gap-4" aria-labelledby="next-h">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="next-h" className="text-xl flex items-center gap-2"><Sparkles size={18} aria-hidden="true" /> Write next</h2>
                <div className="flex items-center gap-1">
                  <SuggestOthers tenantId={tenantId} />
                  <Link href={`${base}/create`} className={btnClass("ghost", "sm")}>More in Create <ArrowRight size={15} aria-hidden="true" /></Link>
                </div>
              </div>
              <Suspense fallback={<ProposalsLoading />}>
                <Proposals tenantId={tenantId} format={format} limit={3} />
              </Suspense>
            </section>

            <section className="flex flex-col gap-4" aria-labelledby="recent-h">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="recent-h" className="text-xl">Recent pieces</h2>
                <Link href={`${base}?view=all`} className={btnClass("ghost", "sm")}>Open the library <ArrowRight size={15} aria-hidden="true" /></Link>
              </div>
              {recent.length === 0 ? (
                <div className="hu-card">
                  <EmptyState title="Nothing written yet" sub="Pick a topic above, or start a project. Each piece goes from idea to copy to visuals." action={<NewProjectButton tenantId={tenantId} />} />
                </div>
              ) : (
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {recent.map((p) => (
                    <li key={p.id} className="min-w-0">
                      <Link href={`${base}/p/${p.id}`} className="hu-lift group h-full flex flex-col bg-paper border border-hairline rounded-md overflow-hidden">
                        <span aria-hidden="true" className="h-1 shrink-0" style={{ background: hueFor(p.id) }} />
                        <span className="flex-1 flex flex-col gap-3 p-5">
                          <span className="flex items-center gap-2">
                            <span className="label-mono text-ink-faint flex-1 truncate">{stageIndex(p.stage) + 1} · {STAGE_LABEL[p.stage]}</span>
                            <BandPill p={p} />
                          </span>
                          <span className={`text-base leading-snug line-clamp-3 ${p.firstHook ? "font-medium" : "text-ink-muted"}`}>
                            {p.firstHook ?? (p.niche ? `For ${p.niche}` : "No copy yet. Open it to write the first draft.")}
                          </span>
                          <span className="mt-auto flex items-center gap-2 text-sm text-ink-faint min-w-0">
                            <span className="truncate text-ink-muted">{p.name}</span>
                            <span aria-hidden="true">·</span>
                            <span className="shrink-0">{ago(p.updatedAt, now)}</span>
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <section className="flex flex-col gap-3 min-w-0" aria-labelledby="planned-h">
                <div className="flex items-center justify-between gap-2">
                  <h2 id="planned-h" className="text-base flex items-center gap-2"><CalendarDays size={16} aria-hidden="true" /> Coming up</h2>
                  <Link href={`${base}/plan/calendar`} className={btnClass("ghost", "sm")}>Calendar <ArrowUpRight size={15} aria-hidden="true" /></Link>
                </div>
                {upcoming.length ? (
                  <ul className="flex flex-col divide-y divide-[var(--hairline)] border border-hairline rounded-md bg-paper">
                    {upcoming.slice(0, 4).map((s) => (
                      <li key={s.id}>
                        <Start tenantId={tenantId} topic={s.topic ?? ""} pillar={s.pillarName} format={format}>
                          <button type="submit" className="w-full text-left px-4 py-3 min-h-11 hover:bg-hover flex items-center gap-3">
                            <span className="font-mono text-xs text-ink-faint tabular-nums shrink-0">{s.date.slice(5)}</span>
                            <span className="flex-1 min-w-0 text-sm line-clamp-2">{s.topic}</span>
                          </button>
                        </Start>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-muted">Nothing planned for the next two weeks.</p>
                )}
              </section>
              <section className="flex flex-col gap-3 min-w-0" aria-labelledby="ideas-h">
                <div className="flex items-center justify-between gap-2">
                  <h2 id="ideas-h" className="text-base flex items-center gap-2"><Lightbulb size={16} aria-hidden="true" /> Saved ideas</h2>
                  <Link href={`${base}/plan/ideas`} className={btnClass("ghost", "sm")}>Ideas <ArrowUpRight size={15} aria-hidden="true" /></Link>
                </div>
                {ideas.length ? (
                  <ul className="flex flex-col divide-y divide-[var(--hairline)] border border-hairline rounded-md bg-paper">
                    {ideas.slice(0, 4).map((i) => (
                      <li key={i.id}>
                        <Start tenantId={tenantId} topic={i.rawText.slice(0, 200)} pillar={i.pillarName} ideaId={i.id} format={format}>
                          <button type="submit" className="w-full text-left px-4 py-3 min-h-11 hover:bg-hover flex items-center gap-3">
                            <span className="flex-1 min-w-0 text-sm line-clamp-2">{i.rawText}</span>
                            {i.pillarName && <span className="label-mono text-ink-faint max-w-[40%] truncate" title={i.pillarName}>{i.pillarName}</span>}
                          </button>
                        </Start>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-muted">No saved ideas yet.</p>
                )}
              </section>
            </div>
            <Eyebrow>{projects.length} project{projects.length === 1 ? "" : "s"} in {workspaceName}</Eyebrow>
          </div>
        </div>
      </div>
    </div>
  );
}
