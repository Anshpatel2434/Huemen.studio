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
  Plus, FileText, PenLine, Palette, FolderOpen, X, ArrowRight, Copy, ClipboardPaste, Sparkles,
  LayoutGrid, List, ChevronDown, MoreHorizontal, Star, Pencil, Archive, RotateCcw, ExternalLink, Trash2, Lightbulb, CheckCircle2,
} from "lucide-react";
import {
  Modal, SubmitButton, EmptyState, AgentDots, useToast, hueFor, IconButton, Tabs, Segmented, Field, Menu, MenuItem, MenuSeparator,
} from "@/components/ui";
import { btnClass } from "@/components/btn";
import { DeleteProjectModal } from "@/components/delete-project-modal";
import { STAGES, STAGE_LABEL, stageIndex, type Stage } from "@/lib/projects/stages";
import { WhatsNew } from "./whats-new";
import { formatByKey } from "@/lib/content/formats";
import { PLATFORM_RULES } from "@/lib/voice/platforms";
import {
  createProjectAction, createFromPromptAction, dismissHeroAction, starProjectAction, renameProjectAction,
  archiveProjectAction, restoreProjectAction, duplicateProjectAction, deleteProjectAction,
} from "../project-actions";

type Project = {
  id: string; name: string; stage: Stage; updatedAt: string; createdAt: string; completeness: number; niche: string | null;
  palette: string[]; pillarCount: number; contentCount: number; firstHook: string | null; starred: boolean;
  format: string | null; contentStatus: string | null;
  voiceBand: "on_brand" | "drifting" | "off_brand" | null; voiceScore: number | null;
};

// The Library's filters (plan, Flows 5–7): platform, status and band.
const platformOf = (p: Project) => (p.format ? formatByKey(p.format).platform ?? null : null);
const STATUS_LABEL: Record<string, string> = { none: "No copy yet", draft: "Draft", edited: "Edited", approved: "Approved" };
const BAND_LABEL: Record<string, string> = { on_brand: "On brand", drifting: "Drifting", off_brand: "Off brand", unchecked: "Not checked" };
const BAND_TONE: Record<string, string> = {
  on_brand: "bg-ok-soft text-ok", drifting: "bg-warn-soft text-warn", off_brand: "bg-danger-soft text-danger", unchecked: "bg-ground text-ink-faint",
};

function BandPill({ p }: { p: Project }) {
  if (!p.contentStatus) return null;
  const b = p.voiceBand ?? "unchecked";
  return (
    <span className={`label-mono inline-flex items-center gap-1.5 h-5 px-2 rounded-full shrink-0 ${BAND_TONE[b]}`} title={p.voiceScore != null ? `${p.voiceScore}/100 against your voice` : "Not checked yet"}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
      {p.voiceScore != null ? p.voiceScore : "–"}
      <span className="sr-only"> {BAND_LABEL[b]}</span>
    </span>
  );
}
type View = "recents" | "all" | "archived";
type Sort = "edited" | "name" | "created";

const STAGE_ICON: Record<Stage, typeof FileText> = { ideate: Lightbulb, content: PenLine, visual: Palette };
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

export function ProjectsHome({ tenantId, workspaceName, projects, view, initialQuery, showHero, showWhatsNew, setupStep, rescanDays, justFinished = false }: {
  tenantId: string; workspaceName: string; projects: Project[]; view: View; initialQuery: string; showHero: boolean; showWhatsNew: boolean;
  /** The onboarding step the person reached (0 About you … 4 First draft), or null once their voice is set up. */
  setupStep: number | null;
  /** Days since the voice was measured, when a re-measure is due (90 days and new writing). */
  rescanDays: number | null;
  /** Arrived straight from the last onboarding step. */
  justFinished?: boolean;
}) {
  const q = initialQuery;
  const [stage, setStage] = useState<Stage | "all">("all");
  const [platform, setPlatform] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [band, setBand] = useState<string>("all");
  const platforms = useMemo(() => [...new Set(projects.map(platformOf).filter((x): x is string => !!x))], [projects]);
  const filtered = stage !== "all" || platform !== "all" || status !== "all" || band !== "all";
  const [sort, setSort] = useState<Sort>("edited");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [creating, setCreating] = useState<null | "blank" | "copy">(null);
  const [hero, setHero] = useState(showHero);
  const [prompt, setPrompt] = useState("");

  const shown = useMemo(() => {
    let list = projects.filter((p) =>
      (stage === "all" || p.stage === stage) &&
      (platform === "all" || platformOf(p) === platform) &&
      (status === "all" || (p.contentStatus ?? "none") === status) &&
      (band === "all" || (p.contentStatus ? (p.voiceBand ?? "unchecked") : null) === band) &&
      `${p.name} ${p.niche ?? ""}`.toLowerCase().includes(q.toLowerCase()));
    list = [...list].sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : sort === "created" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt),
    );
    return view === "recents" ? list.slice(0, 12) : list;
  }, [projects, q, stage, platform, status, band, sort, view]);

  const title = view === "all" ? "All projects" : view === "archived" ? "Archived" : "Recents";
  const tabs: { v: View; label: string }[] = [
    { v: "recents", label: "Recently viewed" },
    { v: "all", label: "All projects" },
    { v: "archived", label: "Archived" },
  ];

  return (
    <div className="absolute inset-0 flex flex-col">
      {showWhatsNew && !justFinished && <WhatsNew onStart={() => setCreating("blank")} />}
      {/* Top bar */}
      <header className="shrink-0 flex flex-wrap items-center gap-2 px-5 min-[900px]:px-8 pt-6 pb-4 bg-ground">
        <h1 className="text-2xl flex-1 min-w-[10ch]">{title}{q ? <span className="text-ink-faint font-normal"> · “{q}”</span> : null}</h1>
        <button onClick={() => setHero(true)} className={btnClass("ghost", "sm")}><ClipboardPaste size={15} aria-hidden="true" /> Paste notes</button>
        <button onClick={() => setCreating("copy")} disabled={projects.length === 0} className={btnClass("secondary", "sm")}><Copy size={15} aria-hidden="true" /> From a brief</button>
        <button onClick={() => setCreating("blank")} className={btnClass("primary", "sm")}><Plus size={15} aria-hidden="true" /> New project</button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {rescanDays != null && setupStep == null && view !== "archived" && (
          <section className="border-b border-hairline bg-field">
            <div className="max-w-[1180px] mx-auto px-5 py-3 flex flex-wrap items-center gap-3">
              <p className="flex-1 min-w-0 text-sm">It&apos;s been {rescanDays} days since we measured your writing, and you&apos;ve published since. A fresh look keeps drafts close to how you sound now.</p>
              <Link href={`/w/${tenantId}/brand/voice?preview=1#remeasure`} className={btnClass("secondary", "sm")}>See what would change</Link>
            </div>
          </section>
        )}
        {justFinished && view !== "archived" && (
          <section role="status" className="border-b border-hairline bg-ok-soft">
            <div className="max-w-[1180px] mx-auto px-5 py-4 flex flex-wrap items-center gap-3">
              <CheckCircle2 size={17} className="text-ok shrink-0" aria-hidden="true" />
              <p className="flex-1 min-w-0 text-sm">
                <span className="font-medium">You&apos;re set up.</span>
                <span className="text-ink-muted"> Your voice is in every piece from here, and your first one is below.</span>
              </p>
              <Link href={`/w/${tenantId}/create`} className={btnClass("primary", "sm")}>Write the next one</Link>
            </div>
          </section>
        )}
        {setupStep != null && view !== "archived" && (
          <section className="border-b border-hairline bg-accent-soft">
            <div className="max-w-[1180px] mx-auto px-5 py-4 flex flex-wrap items-center gap-3">
              <p className="flex-1 min-w-0 text-sm">
                <span className="font-medium">Set up your voice</span>
                <span className="text-ink-muted"> · step {setupStep + 1} of 5. Until it&apos;s done, drafts won&apos;t sound much like you.</span>
              </p>
              <Link href={`/w/${tenantId}/onboarding?step=${setupStep}`} className={btnClass("primary", "sm")}>{setupStep > 0 ? "Carry on" : "Start"}</Link>
            </div>
          </section>
        )}
        {/* AI banner */}
        {hero && view !== "archived" && (
          <section className="relative border-b border-hairline bg-panel">
            <div className="max-w-[1180px] mx-auto px-5 py-7">
              <div className="flex items-center gap-2">
                <h2 className="text-lg">Describe the brand and <span className="serif-accent">start the brief</span></h2>
                <span className="h-5 px-1.5 rounded-sm bg-paper text-xs font-medium flex items-center gap-1"><Sparkles size={10} /> AI</span>
              </div>
              <form action={createFromPromptAction} className="mt-3 bg-paper border border-hairline rounded-md shadow-[var(--shadow-sm)] flex items-end gap-2 p-2 focus-within:border-ink">
                <input type="hidden" name="tenantId" value={tenantId} />
                <textarea
                  name="prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={prompt.split("\n").length > 1 ? 4 : 1}
                  placeholder={EXAMPLES[0]}
                  className="flex-1 resize-none bg-transparent outline-none text-base px-2 py-2.5 min-h-11 placeholder:text-ink-faint"
                />
                <PromptSubmit disabled={!prompt.trim()} />
              </form>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-sm text-ink-faint mr-1">Try</span>
                {EXAMPLES.map((e) => (
                  <button key={e} onClick={() => setPrompt(e)} className={`${btnClass("secondary", "sm")} !px-4 max-w-[300px] !block truncate`}>{e}</button>
                ))}
              </div>
              <p className="text-sm text-ink-faint mt-2">Paste workshop notes with labels (Niche:, Audience:) for more detail.</p>
            </div>
            <IconButton label="Dismiss" onClick={() => { setHero(false); dismissHeroAction(tenantId); }} className="!absolute top-3 right-4"><X size={16} /></IconButton>
          </section>
        )}

        <div className="max-w-[1180px] mx-auto px-5 py-5">
          {/* Tabs + filters */}
          <div className="flex items-end gap-1 flex-wrap border-b border-hairline">
            <Tabs
              label="Projects"
              className="!border-b-0"
              value={view}
              items={tabs.map((t) => ({ value: t.v, label: t.label, href: t.v === "recents" ? `/w/${tenantId}` : `/w/${tenantId}?view=${t.v}` }))}
            />
            <span className="flex-1" />
            <Dropdown label={stage === "all" ? "All steps" : `${stageIndex(stage) + 1}. ${STAGE_LABEL[stage]}`} options={[["all", "All steps"], ...STAGES.map((s) => [s, `${stageIndex(s) + 1}. ${STAGE_LABEL[s]}`] as [string, string])]} onPick={(v) => setStage(v as Stage | "all")} />
            {platforms.length > 1 && (
              <Dropdown label={platform === "all" ? "All platforms" : PLATFORM_RULES[platform]?.label ?? platform} options={[["all", "All platforms"], ...platforms.map((x) => [x, PLATFORM_RULES[x]?.label ?? x] as [string, string])]} onPick={setPlatform} />
            )}
            <Dropdown label={status === "all" ? "Any status" : STATUS_LABEL[status]} options={[["all", "Any status"], ...Object.entries(STATUS_LABEL)]} onPick={setStatus} />
            <Dropdown label={band === "all" ? "Any band" : BAND_LABEL[band]} options={[["all", "Any band"], ...Object.entries(BAND_LABEL)]} onPick={setBand} />
            <Dropdown label={sort === "edited" ? "Last edited" : sort === "name" ? "Alphabetical" : "Date created"} options={[["edited", "Last edited"], ["name", "Alphabetical"], ["created", "Date created"]]} onPick={(v) => setSort(v as Sort)} />
            <Segmented
              label="Layout"
              className="ml-2 mb-1.5"
              value={layout}
              onChange={setLayout}
              items={[
                { value: "grid", title: "Grid", label: <LayoutGrid size={15} aria-hidden="true" /> },
                { value: "list", title: "List", label: <List size={15} aria-hidden="true" /> },
              ]}
            />
          </div>

          {shown.length === 0 ? (
            <div className="mt-8 bg-paper border border-hairline rounded-md max-w-xl mx-auto">
              <EmptyState
                icon={view === "archived" ? <Archive size={18} /> : <FolderOpen size={18} />}
                title={view === "archived" ? "Nothing archived" : q || filtered ? "No projects match" : "No projects yet"}
                sub={view === "archived" ? "Archived projects land here and can be restored." : "A project takes one brand from brief to pillars to content to visuals."}
                action={view === "archived" ? undefined : <button onClick={() => setCreating("blank")} className={btnClass("primary")}><Plus size={14} /> New project</button>}
              />
            </div>
          ) : layout === "grid" ? (
            <div className="mt-4 grid gap-5 grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
              {shown.map((p) => <ProjectCard key={p.id} p={p} tenantId={tenantId} archived={view === "archived"} />)}
            </div>
          ) : (
            <div className="mt-4 bg-paper border border-hairline rounded-md overflow-hidden">
              <div className="grid grid-cols-[minmax(0,1fr)_120px_90px_140px_40px] px-4 h-9 items-center text-xs text-ink-faint border-b border-hairline">
                <span>Name</span><span>Step</span><span>Voice</span><span>Last edited</span><span />
              </div>
              {shown.map((p) => {
                const Icon = STAGE_ICON[p.stage];
                return (
                  <div key={p.id} className="grid grid-cols-[minmax(0,1fr)_120px_90px_140px_40px] px-4 h-12 items-center text-sm border-b border-hairline last:border-0 hover:bg-panel">
                    <Link href={`/w/${tenantId}/p/${p.id}`} className="flex items-center gap-2.5 min-w-0">
                      <span className="w-6 h-6 rounded-sm flex items-center justify-center bg-ink text-on-ink shrink-0"><Icon size={12} /></span>
                      <span className="truncate font-medium">{p.name}</span>
                      {p.starred && <Star size={12} className="fill-current text-accent shrink-0" />}
                    </Link>
                    <span className="text-ink-muted">{stageIndex(p.stage) + 1}. {STAGE_LABEL[p.stage]}</span>
                    <span><BandPill p={p} /></span>
                    <span className="text-ink-muted" suppressHydrationWarning>{ago(p.updatedAt)}</span>
                    <CardMenu p={p} tenantId={tenantId} archived={view === "archived"} />
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-xs text-ink-faint mt-6 pb-6">{projects.length} project{projects.length === 1 ? "" : "s"} in {workspaceName}{view === "recents" && projects.length > 12 ? " · showing the 12 most recent" : ""}</p>
        </div>
      </div>

      <Modal open={creating !== null} onClose={() => setCreating(null)} title={creating === "copy" ? "New project from a brief" : "New project"} width={460}>
        <form action={createProjectAction} className="flex flex-col gap-5">
          <input type="hidden" name="tenantId" value={tenantId} />
          <Field label="Project name" required>
            <input name="name" className="field" placeholder="e.g. Q4 thought-leadership push" autoFocus />
          </Field>
          {creating === "copy" ? (
            <Field label="Copy the brief from" hint="Story, voice and visual identity are copied; pillars and content start fresh." required>
              <select name="fromProject" className="field" defaultValue={projects[0]?.id}>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          ) : (
            <p className="text-sm text-ink-muted">It starts at Ideate. Content and Visual follow, each unlocking the next.</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
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
    <div className="relative mb-0.5">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="min-h-11 px-3 rounded-full text-sm text-ink-muted flex items-center gap-1.5 hover:bg-hover hover:text-ink transition-colors">
        {label} <ChevronDown size={14} className="text-ink-faint" aria-hidden="true" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0" style={{ zIndex: "var(--z-dropdown)" }} onClick={() => setOpen(false)} />
          <Menu label={label} className="absolute right-0 top-12 w-52 pop">
            {options.map(([v, l]) => (
              <MenuItem key={v} checked={l === label} onClick={() => { onPick(v); setOpen(false); }}>{l}</MenuItem>
            ))}
          </Menu>
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
    start(async () => { setOpen(false); try { await fn(); toast(msg); router.refresh(); } catch { toast("That didn't work. Try again.", "danger"); } });

  return (
    <div className={`relative ${floating ? "" : "justify-self-end"}`}>
      <span
        className={floating ? `inline-flex rounded-full bg-paper/95 shadow-[var(--shadow-sm)] opacity-0 group-hover:opacity-100 focus-within:opacity-100 ${open ? "opacity-100" : ""}` : "inline-flex"}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <IconButton label={`Actions for ${p.name}`} onClick={() => setOpen((o) => !o)} pressed={open}>
          {pending ? <AgentDots /> : <MoreHorizontal size={17} />}
        </IconButton>
      </span>
      {open && (
        <>
          <div className="fixed inset-0" style={{ zIndex: "var(--z-dropdown)" }} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); }} />
          <div className="absolute right-0 top-11" style={{ zIndex: "var(--z-dropdown)" }} onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
            <Menu label={`Actions for ${p.name}`} className="w-64 pop">
              {archived ? (
                <>
                  <MenuItem icon={<RotateCcw size={15} aria-hidden="true" />} onClick={() => run(() => restoreProjectAction(tenantId, p.id), "Restored")}>Restore</MenuItem>
                  <MenuSeparator />
                  <MenuItem danger icon={<Trash2 size={15} aria-hidden="true" />} onClick={() => { setOpen(false); setDeleting(true); }}>Delete permanently</MenuItem>
                </>
              ) : (
                <>
                  <MenuItem icon={<ExternalLink size={15} aria-hidden="true" />} onClick={() => { setOpen(false); router.push(`/w/${tenantId}/p/${p.id}`); }}>Open</MenuItem>
                  <MenuItem icon={<Star size={15} aria-hidden="true" />} onClick={() => run(() => starProjectAction(tenantId, p.id, !p.starred), p.starred ? "Removed from starred" : "Starred")}>{p.starred ? "Unstar" : "Add to starred"}</MenuItem>
                  <MenuItem icon={<Pencil size={15} aria-hidden="true" />} onClick={() => { setOpen(false); setRenaming(true); }}>Rename</MenuItem>
                  <MenuItem icon={<Copy size={15} aria-hidden="true" />} onClick={() => start(async () => { setOpen(false); const id = await duplicateProjectAction(tenantId, p.id); router.push(`/w/${tenantId}/p/${id}/brief/questions`); })}>New project from this brief</MenuItem>
                  <MenuSeparator />
                  <MenuItem icon={<Archive size={15} aria-hidden="true" />} onClick={() => run(() => archiveProjectAction(tenantId, p.id), "Archived")}>Archive</MenuItem>
                  <MenuItem danger icon={<Trash2 size={15} aria-hidden="true" />} onClick={() => { setOpen(false); setDeleting(true); }}>Delete</MenuItem>
                </>
              )}
            </Menu>
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
    <div className="group relative bg-paper border border-hairline rounded-md hover:border-line hover:shadow-[var(--shadow)] transition-all">
      <div className="absolute top-2 right-2 z-10"><CardMenu p={p} tenantId={tenantId} archived={archived} floating /></div>
      <Link href={archived ? "#" : `/w/${tenantId}/p/${p.id}`} onClick={(e) => archived && e.preventDefault()} className="block">
      <div className="theme-light aspect-[16/10] relative bg-panel border-b border-hairline overflow-hidden rounded-t-md">
        <Thumb p={p} />
        {p.starred && <Star size={13} className="absolute top-2.5 left-2.5 fill-current text-accent" />}
      </div>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="w-6 h-6 rounded-sm flex items-center justify-center bg-ink text-on-ink shrink-0" title={`Step ${stageIndex(p.stage) + 1}: ${STAGE_LABEL[p.stage]}`}><Icon size={12} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 min-w-0"><span className="block text-sm font-medium truncate">{p.name}</span></span>
          <span className="block text-xs text-ink-faint" suppressHydrationWarning>{archived ? "Archived" : "Edited"} {ago(p.updatedAt)}</span>
        </span>
        <BandPill p={p} />
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
        <div className="w-[34%] aspect-[4/5] rounded-xs p-2 flex flex-col justify-between shadow-[var(--shadow)]" style={{ background: light }}>
          <span className="w-4 h-[3px] rounded-full" style={{ background: accent }} />
          <p className="text-[0.45rem] font-semibold leading-tight line-clamp-4" style={{ color: ink }}>{p.firstHook ?? p.name}</p>
        </div>
        <div className="w-[34%] aspect-square rounded-xs p-2 flex flex-col justify-center shadow-[var(--shadow)]" style={{ background: ink }}>
          <p className="serif-accent text-[0.55rem] leading-tight line-clamp-4" style={{ color: light }}>“{p.firstHook ?? p.name}”</p>
        </div>
        <div className="w-[18%] aspect-[4/5] rounded-xs shadow-[var(--shadow)]" style={{ background: accent }} />
      </div>
    );
  }
  if (p.stage === "content") {
    return (
      <div className="absolute inset-0 flex items-start justify-center gap-2 p-4 pt-5 canvas-dots">
        {[0, 1, 2].map((i) => (
          <div key={i} className="w-[30%] bg-paper rounded-xs p-1.5 shadow-[var(--shadow-sm)]" style={{ marginTop: i * 6 }}>
            <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: hueFor(p.id) }} /><span className="wf-bar h-1 w-8" /></div>
            {i === 0 && p.firstHook ? <p className="text-[0.4rem] font-semibold mt-1 leading-tight line-clamp-3">{p.firstHook}</p> : <span className="wf-bar h-1 w-full mt-1.5 block" />}
            <div className="mt-1 flex flex-col gap-0.5"><span className="wf-bar h-[3px] w-full" /><span className="wf-bar h-[3px] w-4/5" /><span className="wf-bar h-[3px] w-3/5" /></div>
          </div>
        ))}
      </div>
    );
  }
  if (p.stage === "ideate") {
    const n = Math.max(2, Math.min(4, p.pillarCount));
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center canvas-dots">
        <span className="w-20 h-6 rounded-xs bg-paper shadow-[var(--shadow-sm)] flex items-center px-1.5"><span className="wf-bar h-1 w-full" /></span>
        <span className="w-px h-3 bg-line" />
        <div className="relative flex gap-2 pt-3">
          <span className="absolute top-0 h-px bg-line" style={{ left: "1.25rem", right: "1.25rem" }} />
          {Array.from({ length: n }).map((_, i) => (
            <span key={i} className="w-10 h-14 rounded-xs bg-paper shadow-[var(--shadow-sm)] p-1 flex flex-col gap-1"><span className="h-1 rounded" style={{ background: hueFor(p.id + i) }} /><span className="wf-bar h-1" /><span className="wf-bar h-1" /></span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div className="w-[62%] h-[88%] bg-paper rounded-xs shadow-[var(--shadow-sm)] p-2.5 flex flex-col">
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
