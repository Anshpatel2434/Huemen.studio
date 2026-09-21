"use client";

/**
 * Workspace home, modelled on Figma's file browser: top bar with create
 * buttons, a dismissible "describe it" AI banner, tabs + filters + grid/list
 * toggle, and file cards with a hover ⋯ menu.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  Plus, FileText, Network, PenLine, Palette, FolderOpen, X, ArrowRight, Copy, ClipboardPaste, Sparkles,
  LayoutGrid, List, ChevronDown, MoreHorizontal, Star, Pencil, Archive, RotateCcw, ExternalLink, Trash2,
} from "lucide-react";
import { Modal, SubmitButton, EmptyState, AgentDots, useToast } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { DeleteProjectModal } from "@/components/delete-project-modal";
import { STAGES, STAGE_LABEL, stageIndex, type Stage } from "@/lib/projects/stages";
import { WhatsNew } from "./whats-new";
import {
  createProjectAction, createFromPromptAction, dismissHeroAction, starProjectAction, renameProjectAction,
  archiveProjectAction, restoreProjectAction, duplicateProjectAction, deleteProjectAction,
} from "../project-actions";

type Project = {
  id: string; name: string; stage: Stage; updatedAt: string; createdAt: string; completeness: number; niche: string | null;
  palette: string[]; pillarCount: number; contentCount: number; firstHook: string | null; starred: boolean;
};
type View = "recents" | "all" | "archived";
type Sort = "edited" | "name" | "created";

const STAGE_ICON: Record<Stage, typeof FileText> = { brief: FileText, pillars: Network, content: PenLine, visual: Palette };
const EXAMPLES = [
  "Leadership coach for first-time engineering managers. Direct, warm, a bit contrarian.",
  "Founder building a D2C skincare brand in India, in public. Numbers-first, honest.",
  "Keynote speaker on resilience for HR leaders. Story-led, energetic.",
];

function ago(iso: string): string {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  const mo = Math.round(d / 30); return mo < 12 ? `${mo} month${mo === 1 ? "" : "s"} ago` : `${Math.round(mo / 12)} year ago`;
}

export function ProjectsHome({ tenantId, workspaceName, projects, view, initialQuery, showHero, showWhatsNew }: {
  tenantId: string; workspaceName: string; projects: Project[]; view: View; initialQuery: string; showHero: boolean; showWhatsNew: boolean;
}) {
  const router = useRouter();
  const q = initialQuery;
  const [stage, setStage] = useState<Stage | "all">("all");
  const [sort, setSort] = useState<Sort>("edited");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [creating, setCreating] = useState<null | "blank" | "copy">(null);
  const [hero, setHero] = useState(showHero);
  const [prompt, setPrompt] = useState("");

  const shown = useMemo(() => {
    let list = projects.filter((p) => (stage === "all" || p.stage === stage) && `${p.name} ${p.niche ?? ""}`.toLowerCase().includes(q.toLowerCase()));
    list = [...list].sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : sort === "created" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt),
    );
    return view === "recents" ? list.slice(0, 12) : list;
  }, [projects, q, stage, sort, view]);

  const title = view === "all" ? "All projects" : view === "archived" ? "Archived" : "Recents";
  const tabs: { v: View; label: string }[] = [
    { v: "recents", label: "Recently viewed" },
    { v: "all", label: "All projects" },
    { v: "archived", label: "Archived" },
  ];

  return (
    <div className="absolute inset-0 flex flex-col">
      {showWhatsNew && <WhatsNew onStart={() => setCreating("blank")} />}
      {/* Top bar */}
      <header className="h-12 shrink-0 flex items-center gap-2 px-5 border-b border-hairline bg-paper">
        <h1 className="text-[0.9rem] font-medium flex-1">{title}{q ? <span className="text-ink-faint font-normal"> · “{q}”</span> : null}</h1>
        <button onClick={() => setCreating("blank")} className="flex items-center gap-1.5 h-8 px-3 rounded-[8px] border border-line text-[0.8rem] hover:border-ink"><span className="w-4 h-4 rounded-[4px] bg-ink text-on-ink flex items-center justify-center"><FileText size={10} /></span> New project</button>
        <button onClick={() => setCreating("copy")} disabled={projects.length === 0} className="flex items-center gap-1.5 h-8 px-3 rounded-[8px] border border-line text-[0.8rem] hover:border-ink disabled:opacity-40"><span className="w-4 h-4 rounded-[4px] bg-accent text-on-ink flex items-center justify-center"><Copy size={10} /></span> From a brief</button>
        <button onClick={() => setHero(true)} className="flex items-center gap-1.5 h-8 px-3 rounded-[8px] border border-line text-[0.8rem] hover:border-ink"><span className="w-4 h-4 rounded-[4px] bg-field flex items-center justify-center"><ClipboardPaste size={10} /></span> Paste notes</button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* AI banner */}
        {hero && view !== "archived" && (
          <section className="relative border-b border-hairline bg-panel">
            <div className="max-w-[1180px] mx-auto px-5 py-7">
              <div className="flex items-center gap-2">
                <h2 className="text-[1.15rem]">Describe the brand and <span className="serif-accent">start the brief</span></h2>
                <span className="h-5 px-1.5 rounded-[5px] bg-paper text-[0.62rem] font-medium flex items-center gap-1"><Sparkles size={10} /> AI</span>
              </div>
              <form action={createFromPromptAction} className="mt-3 bg-paper border border-hairline rounded-[12px] shadow-[var(--shadow-sm)] flex items-end gap-2 p-2 focus-within:border-ink">
                <input type="hidden" name="tenantId" value={tenantId} />
                <textarea
                  name="prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={prompt.split("\n").length > 1 ? 4 : 1}
                  placeholder={EXAMPLES[0]}
                  className="flex-1 resize-none bg-transparent outline-none text-[0.88rem] px-2 py-1.5 placeholder:text-ink-faint"
                />
                <PromptSubmit disabled={!prompt.trim()} />
              </form>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[0.72rem] text-ink-faint mr-1">Try</span>
                {EXAMPLES.map((e) => (
                  <button key={e} onClick={() => setPrompt(e)} className="h-6 px-2 rounded-[6px] bg-paper/70 border border-hairline text-[0.7rem] text-ink-muted hover:text-ink truncate max-w-[280px]">{e}</button>
                ))}
                <span className="text-[0.7rem] text-ink-faint ml-auto">Paste workshop notes with labels (Niche:, Audience:) for more detail.</span>
              </div>
            </div>
            <button onClick={() => { setHero(false); dismissHeroAction(tenantId); }} className="absolute top-3 right-4 w-7 h-7 rounded-[7px] flex items-center justify-center text-ink-muted hover:bg-paper" aria-label="Dismiss"><X size={15} /></button>
          </section>
        )}

        <div className="max-w-[1180px] mx-auto px-5 py-5">
          {/* Tabs + filters */}
          <div className="flex items-center gap-1 flex-wrap">
            {tabs.map((t) => (
              <button key={t.v} onClick={() => router.push(t.v === "recents" ? `/w/${tenantId}` : `/w/${tenantId}?view=${t.v}`)} className={`h-8 px-3 rounded-[7px] text-[0.8rem] ${view === t.v ? "bg-field font-medium" : "text-ink-muted hover:text-ink"}`}>{t.label}</button>
            ))}
            <span className="flex-1" />
            <Dropdown label={stage === "all" ? "All steps" : `${stageIndex(stage) + 1}. ${STAGE_LABEL[stage]}`} options={[["all", "All steps"], ...STAGES.map((s) => [s, `${stageIndex(s) + 1}. ${STAGE_LABEL[s]}`] as [string, string])]} onPick={(v) => setStage(v as Stage | "all")} />
            <Dropdown label={sort === "edited" ? "Last edited" : sort === "name" ? "Alphabetical" : "Date created"} options={[["edited", "Last edited"], ["name", "Alphabetical"], ["created", "Date created"]]} onPick={(v) => setSort(v as Sort)} />
            <div className="flex items-center ml-1">
              <button onClick={() => setLayout("grid")} className={`w-8 h-8 rounded-[7px] flex items-center justify-center ${layout === "grid" ? "bg-field" : "text-ink-muted hover:text-ink"}`} aria-label="Grid"><LayoutGrid size={14} /></button>
              <button onClick={() => setLayout("list")} className={`w-8 h-8 rounded-[7px] flex items-center justify-center ${layout === "list" ? "bg-field" : "text-ink-muted hover:text-ink"}`} aria-label="List"><List size={14} /></button>
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="mt-8 bg-paper border border-hairline rounded-[14px] max-w-xl mx-auto">
              <EmptyState
                icon={view === "archived" ? <Archive size={18} /> : <FolderOpen size={18} />}
                title={view === "archived" ? "Nothing archived" : q || stage !== "all" ? "No projects match" : "No projects yet"}
                sub={view === "archived" ? "Archived projects land here and can be restored." : "A project takes one brand from brief to pillars to content to visuals."}
                action={view === "archived" ? undefined : <button onClick={() => setCreating("blank")} className={btnClass("primary")}><Plus size={14} /> New project</button>}
              />
            </div>
          ) : layout === "grid" ? (
            <div className="mt-4 grid gap-5 grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
              {shown.map((p) => <ProjectCard key={p.id} p={p} tenantId={tenantId} archived={view === "archived"} />)}
            </div>
          ) : (
            <div className="mt-4 bg-paper border border-hairline rounded-[12px] overflow-hidden">
              <div className="grid grid-cols-[minmax(0,1fr)_120px_90px_140px_40px] px-4 h-9 items-center text-[0.72rem] text-ink-faint border-b border-hairline">
                <span>Name</span><span>Step</span><span>Pieces</span><span>Last edited</span><span />
              </div>
              {shown.map((p) => {
                const Icon = STAGE_ICON[p.stage];
                return (
                  <div key={p.id} className="grid grid-cols-[minmax(0,1fr)_120px_90px_140px_40px] px-4 h-12 items-center text-[0.8rem] border-b border-hairline last:border-0 hover:bg-panel">
                    <Link href={`/w/${tenantId}/p/${p.id}`} className="flex items-center gap-2.5 min-w-0">
                      <span className="w-6 h-6 rounded-[6px] flex items-center justify-center bg-ink text-on-ink shrink-0"><Icon size={12} /></span>
                      <span className="truncate font-medium">{p.name}</span>
                      {p.starred && <Star size={12} className="fill-current text-accent shrink-0" />}
                    </Link>
                    <span className="text-ink-muted">{stageIndex(p.stage) + 1}. {STAGE_LABEL[p.stage]}</span>
                    <span className="text-ink-muted tabular-nums">{p.contentCount}</span>
                    <span className="text-ink-muted" suppressHydrationWarning>{ago(p.updatedAt)}</span>
                    <CardMenu p={p} tenantId={tenantId} archived={view === "archived"} />
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[0.72rem] text-ink-faint mt-6 pb-6">{projects.length} project{projects.length === 1 ? "" : "s"} in {workspaceName}{view === "recents" && projects.length > 12 ? " · showing the 12 most recent" : ""}</p>
        </div>
      </div>

      <Modal open={creating !== null} onClose={() => setCreating(null)} title={creating === "copy" ? "New project from a brief" : "New project"} width={460}>
        <form action={createProjectAction} className="flex flex-col gap-4">
          <input type="hidden" name="tenantId" value={tenantId} />
          <label className="block">
            <span className="text-[0.8rem] font-medium mb-1.5 block">Project name</span>
            <input name="name" className="field" placeholder="e.g. Q4 thought-leadership push" required autoFocus />
          </label>
          {creating === "copy" ? (
            <label className="block">
              <span className="text-[0.8rem] font-medium mb-1.5 block">Copy the brief from</span>
              <select name="fromProject" className="field" defaultValue={projects[0]?.id} required>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <span className="block text-[0.72rem] text-ink-faint mt-1">Story, voice and visual identity are copied; pillars and content start fresh.</span>
            </label>
          ) : (
            <p className="text-[0.76rem] text-ink-muted">You&apos;ll start at the intake. Four steps follow: Brief → Pillars → Content → Visual, each unlocking the next.</p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCreating(null)} className={btnClass("ghost")}>Cancel</button>
            <SubmitButton pendingLabel="Creating…">Create project</SubmitButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function PromptSubmit({ disabled }: { disabled: boolean }) {
  return (
    <SubmitButton variant="primary" size="sm" pendingLabel="Starting…" className={disabled ? "opacity-40 pointer-events-none" : ""}>
      Start brief <ArrowRight size={13} />
    </SubmitButton>
  );
}

function Dropdown({ label, options, onPick }: { label: string; options: [string, string][]; onPick: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="h-8 px-2.5 rounded-[7px] text-[0.78rem] flex items-center gap-1 hover:bg-field">{label} <ChevronDown size={13} className="text-ink-faint" /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-40 w-44 bg-paper border border-hairline rounded-[10px] shadow-[var(--shadow-lg)] p-1 pop">
            {options.map(([v, l]) => (
              <button key={v} onClick={() => { onPick(v); setOpen(false); }} className={`w-full text-left h-8 px-2.5 rounded-[7px] text-[0.8rem] hover:bg-field ${l === label ? "font-medium" : ""}`}>{l}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CardMenu({ p, tenantId, archived, floating }: { p: Project; tenantId: string; archived: boolean; floating?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(p.name);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>, msg: string) =>
    start(async () => { setOpen(false); try { await fn(); toast(msg); router.refresh(); } catch { toast("That didn't work. Try again."); } });

  return (
    <div className={`relative ${floating ? "" : "justify-self-end"}`}>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        className={`w-7 h-7 rounded-[7px] flex items-center justify-center ${floating ? "bg-paper/95 shadow-[var(--shadow-sm)] opacity-0 group-hover:opacity-100 focus:opacity-100" : "hover:bg-field"} ${open ? "opacity-100" : ""} text-ink-muted hover:text-ink`}
        aria-label="Project menu"
      >
        {pending ? <AgentDots /> : <MoreHorizontal size={15} />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); }} />
          <div className="absolute right-0 top-8 z-40 w-60 bg-menu text-menu-fg rounded-[10px] shadow-[var(--shadow-lg)] p-1.5 pop text-[0.8rem]" onClick={(e) => e.stopPropagation()}>
            {archived ? (
              <>
                <button onClick={() => run(() => restoreProjectAction(tenantId, p.id), "Restored")} className="w-full flex items-center gap-2 h-8 px-2.5 rounded-[6px] hover:bg-white/10"><RotateCcw size={14} /> Restore</button>
                <div className="h-px bg-white/10 my-1" />
                <button onClick={() => { setOpen(false); setDeleting(true); }} className="w-full flex items-center gap-2 h-8 px-2.5 rounded-[6px] hover:bg-white/10"><Trash2 size={14} /> Delete permanently</button>
              </>
            ) : (
              <>
                <button onClick={() => { setOpen(false); router.push(`/w/${tenantId}/p/${p.id}`); }} className="w-full flex items-center gap-2 h-8 px-2.5 rounded-[6px] hover:bg-white/10"><ExternalLink size={14} /> Open</button>
                <button onClick={() => run(() => starProjectAction(tenantId, p.id, !p.starred), p.starred ? "Removed from starred" : "Starred")} className="w-full flex items-center gap-2 h-8 px-2.5 rounded-[6px] hover:bg-white/10"><Star size={14} /> {p.starred ? "Unstar" : "Add to starred"}</button>
                <button onClick={() => { setOpen(false); setRenaming(true); }} className="w-full flex items-center gap-2 h-8 px-2.5 rounded-[6px] hover:bg-white/10"><Pencil size={14} /> Rename</button>
                <button onClick={() => start(async () => { setOpen(false); const id = await duplicateProjectAction(tenantId, p.id); router.push(`/w/${tenantId}/p/${id}/brief/questions`); })} className="w-full flex items-center gap-2 h-8 px-2.5 rounded-[6px] hover:bg-white/10"><Copy size={14} className="shrink-0" /> <span className="whitespace-nowrap">New project from this brief</span></button>
                <div className="h-px bg-white/10 my-1" />
                <button onClick={() => run(() => archiveProjectAction(tenantId, p.id), "Archived")} className="w-full flex items-center gap-2 h-8 px-2.5 rounded-[6px] hover:bg-white/10 text-menu-fg/70"><Archive size={14} /> Archive</button>
                <button onClick={() => { setOpen(false); setDeleting(true); }} className="w-full flex items-center gap-2 h-8 px-2.5 rounded-[6px] hover:bg-white/10"><Trash2 size={14} /> Delete</button>
              </>
            )}
          </div>
        </>
      )}
      {deleting && (
        <DeleteProjectModal
          name={p.name}
          pending={pending}
          onClose={() => setDeleting(false)}
          onConfirm={() => { setDeleting(false); run(() => deleteProjectAction(tenantId, p.id), `Deleted “${p.name}”`); }}
          onArchive={archived ? undefined : () => { setDeleting(false); run(() => archiveProjectAction(tenantId, p.id), "Archived"); }}
        />
      )}
      <Modal open={renaming} onClose={() => setRenaming(false)} title="Rename project">
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <input value={name} onChange={(e) => setName(e.target.value)} className="field" autoFocus />
          <button disabled={pending || !name.trim()} onClick={() => { setRenaming(false); run(() => renameProjectAction(tenantId, p.id, name), "Renamed"); }} className={btnClass("primary")}>Save</button>
        </div>
      </Modal>
    </div>
  );
}

function ProjectCard({ p, tenantId, archived }: { p: Project; tenantId: string; archived: boolean }) {
  const Icon = STAGE_ICON[p.stage];
  return (
    <div className="group relative bg-paper border border-hairline rounded-[10px] hover:border-line hover:shadow-[var(--shadow)] transition-all">
      <div className="absolute top-2 right-2 z-10"><CardMenu p={p} tenantId={tenantId} archived={archived} floating /></div>
      <Link href={archived ? "#" : `/w/${tenantId}/p/${p.id}`} onClick={(e) => archived && e.preventDefault()} className="block">
      <div className="theme-light aspect-[16/10] relative bg-panel border-b border-hairline overflow-hidden rounded-t-[9px]">
        <Thumb p={p} />
        {p.starred && <Star size={13} className="absolute top-2.5 left-2.5 fill-current text-accent" />}
      </div>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="w-6 h-6 rounded-[6px] flex items-center justify-center bg-ink text-on-ink shrink-0" title={`Step ${stageIndex(p.stage) + 1}: ${STAGE_LABEL[p.stage]}`}><Icon size={12} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.8rem] font-medium truncate">{p.name}</span>
          <span className="block text-[0.7rem] text-ink-faint" suppressHydrationWarning>{archived ? "Archived" : "Edited"} {ago(p.updatedAt)}</span>
        </span>
      </div>
      </Link>
    </div>
  );
}

/** Where the project is, at a glance: brief → pillar tree → post → visual set. */
function Thumb({ p }: { p: Project }) {
  const ink = p.palette[0] ?? "#0b0b0b";
  const accent = p.palette[1] ?? "#6b6b6b";
  const light = p.palette[2] ?? "#ffffff";
  if (p.stage === "visual") {
    return (
      <div className="absolute inset-0 flex items-center justify-center gap-2 p-4" style={{ background: "#e9e8e5" }}>
        <div className="w-[34%] aspect-[4/5] rounded-[3px] p-2 flex flex-col justify-between shadow-[var(--shadow)]" style={{ background: light }}>
          <span className="w-4 h-[3px] rounded-full" style={{ background: accent }} />
          <p className="text-[0.45rem] font-semibold leading-tight line-clamp-4" style={{ color: ink }}>{p.firstHook ?? p.name}</p>
        </div>
        <div className="w-[34%] aspect-square rounded-[3px] p-2 flex flex-col justify-center shadow-[var(--shadow)]" style={{ background: ink }}>
          <p className="serif-accent text-[0.55rem] leading-tight line-clamp-4" style={{ color: light }}>“{p.firstHook ?? p.name}”</p>
        </div>
        <div className="w-[18%] aspect-[4/5] rounded-[3px] shadow-[var(--shadow)]" style={{ background: accent }} />
      </div>
    );
  }
  if (p.stage === "content") {
    return (
      <div className="absolute inset-0 flex items-start justify-center gap-2 p-4 pt-5 canvas-dots">
        {[0, 1, 2].map((i) => (
          <div key={i} className="w-[30%] bg-paper rounded-[4px] p-1.5 shadow-[var(--shadow-sm)]" style={{ marginTop: i * 6 }}>
            <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-field" /><span className="wf-bar h-1 w-8" /></div>
            {i === 0 && p.firstHook ? <p className="text-[0.4rem] font-semibold mt-1 leading-tight line-clamp-3">{p.firstHook}</p> : <span className="wf-bar h-1 w-full mt-1.5 block" />}
            <div className="mt-1 flex flex-col gap-0.5"><span className="wf-bar h-[3px] w-full" /><span className="wf-bar h-[3px] w-4/5" /><span className="wf-bar h-[3px] w-3/5" /></div>
          </div>
        ))}
      </div>
    );
  }
  if (p.stage === "pillars") {
    const n = Math.max(2, Math.min(4, p.pillarCount));
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center canvas-dots">
        <span className="w-20 h-6 rounded-[4px] bg-paper shadow-[var(--shadow-sm)] flex items-center px-1.5"><span className="wf-bar h-1 w-full" /></span>
        <span className="w-px h-3 bg-line" />
        <div className="relative flex gap-2 pt-3">
          <span className="absolute top-0 h-px bg-line" style={{ left: "1.25rem", right: "1.25rem" }} />
          {Array.from({ length: n }).map((_, i) => (
            <span key={i} className="w-10 h-14 rounded-[4px] bg-paper shadow-[var(--shadow-sm)] p-1 flex flex-col gap-1"><span className="h-1 rounded bg-ink/70" /><span className="wf-bar h-1" /><span className="wf-bar h-1" /></span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div className="w-[62%] h-[88%] bg-paper rounded-[4px] shadow-[var(--shadow-sm)] p-2.5 flex flex-col">
        <p className="text-[0.55rem] font-semibold leading-tight line-clamp-2">{p.niche ?? p.name}</p>
        <div className="mt-1.5 flex flex-col gap-1"><span className="wf-bar h-[3px] w-full" /><span className="wf-bar h-[3px] w-5/6" /><span className="wf-bar h-[3px] w-2/3" /></div>
        <div className="mt-auto">
          <div className="h-[3px] rounded-full bg-field overflow-hidden"><div className="h-full bg-accent" style={{ width: `${p.completeness}%` }} /></div>
          <p className="text-[0.45rem] text-ink-faint mt-0.5">Brief {p.completeness}%</p>
        </div>
      </div>
    </div>
  );
}
