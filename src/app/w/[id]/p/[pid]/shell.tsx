"use client";

/**
 * Project editor chrome: the app shell's focus mode (design system §14). A
 * canvas tool needs the width, so there is no sidebar here; instead a top bar
 * (file menu, breadcrumb, the step pills, share/export), a tool rail, a left
 * panel with Pages + Layers, Add or the Agent, and the canvas in the middle.
 * The file menu reaches every section of the studio, so nothing is further
 * than it was. Pages render their own right inspector. Steps unlock in order:
 * Ideate → Content → Visual.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import {
  ChevronDown, FileText, Network, PenLine, Palette, Share2, Download, Lightbulb, CalendarDays,
  Package, Check, Lock, Copy, Layers, ArrowLeft, Pencil, Files, Flag, BarChart3, Plus, WandSparkles, X, Settings, Archive, Trash2,
  ScanText,
} from "lucide-react";
import { LogoMark, Modal, Badge, Avatar, IconButton, Menu, MenuItem, MenuSeparator, ToastProvider, useToast } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { PageTransition } from "@/components/page-transition";
import { PanelsProvider, RightPanelToggle, useMinWidth, usePanelsState } from "@/components/project-panels";
import { ThemeToggle } from "@/components/theme";
import { STAGES, STAGE_LABEL, stageIndex, type Stage } from "@/lib/projects/stages";
import { AgentPanel } from "./agent-panel";
import { AddPanel } from "./add-panel";
import { renameProjectAction, duplicateProjectAction, archiveProjectAction, deleteProjectAction } from "../../project-actions";
import { DeleteProjectModal } from "@/components/delete-project-modal";
import { ConfirmModal } from "@/components/confirm-modal";

const STAGE_ICON: Record<Stage, typeof FileText> = { ideate: Lightbulb, content: PenLine, visual: Palette };
const PLANNING = [
  { seg: "ideas", label: "Ideas", icon: Lightbulb },
  { seg: "calendar", label: "Calendar", icon: CalendarDays },
  { seg: "offers", label: "Offers", icon: Package },
];

type Layers = {
  pillars: { id: string; name: string; count: number }[];
  content: { id: string; name: string; status: string; flagged: boolean }[];
};

export function ProjectShell(props: {
  children: ReactNode;
  workspace: { id: string; name: string };
  project: { id: string; name: string; stage: Stage };
  user: { email: string; role: string };
  brief: { completeness: number; degraded: boolean };
  layers: Layers;
  members: { email: string; role: string; status: string }[];
  questionnaireUrl: string | null;
  aiMock: boolean;
}) {
  return (
    // Lifted above the canvas tool strip and the editor's Save row, so a
    // "Saved" never covers the buttons along the bottom.
    <ToastProvider lifted>
      <Shell {...props} />
    </ToastProvider>
  );
}

function Shell({ children, workspace, project, user, brief, layers, members, questionnaireUrl, aiMock }: Parameters<typeof ProjectShell>[0]) {
  const pathname = usePathname();
  const base = `/w/${workspace.id}/p/${project.id}`;
  const seg = pathname.slice(base.length + 1).split("/")[0] || "brief";
  const [leftTab, setLeftTab] = useState<"layers" | "add" | "agent" | null>("layers");
  // The canvas keeps a clear working area (components/project-panels). From
  // 1200px there is room for a panel on each side, so the left one is open by
  // default; below that only one side shows at a time, and the left one stays
  // shut until asked for, and shuts again after a page change.
  const [asked, setAsked] = useState(false);
  const roomy = useMinWidth(1200);
  const panels = usePanelsState("header", () => {
    // The right side was opened on purpose: below 1200px the left makes way.
    if (!window.matchMedia("(min-width: 1200px)").matches) setAsked(false);
  });
  const { resetRight } = panels;
  const [panelPath, setPanelPath] = useState(pathname);
  if (panelPath !== pathname) { setPanelPath(pathname); setAsked(false); resetRight(); }
  // Crossing a breakpoint goes back to that width's defaults, so a choice made
  // on a wide window never leaves two panels over a narrow canvas.
  useEffect(() => {
    const queries = [window.matchMedia("(min-width: 1200px)"), window.matchMedia("(min-width: 900px)")];
    const reset = () => { setAsked(false); resetRight(); };
    queries.forEach((q) => q.addEventListener("change", reset));
    return () => queries.forEach((q) => q.removeEventListener("change", reset));
  }, [resetRight]);
  const leftShown = !!leftTab && (asked || roomy);
  const pick = (t: "layers" | "add" | "agent") => {
    const wide = window.matchMedia("(min-width: 1200px)").matches;
    const opening = !(leftTab === t && (asked || wide));
    setLeftTab(opening ? t : null);
    setAsked(true);
    // Room for one side only: opening the left shuts the right (and its editor).
    if (opening && !wide) { panels.edit?.close(); panels.setRight(false); }
    if (!opening && !wide) resetRight();
  };
  const closeLeft = () => {
    setLeftTab(null);
    if (!window.matchMedia("(min-width: 1200px)").matches) resetRight();
  };
  const [share, setShare] = useState(false);
  const unlocked = stageIndex(project.stage);

  if (seg === "intake") return <>{children}</>;

  return (
    // One warm canvas from edge to edge (Relume). The bar and the tools sit on
    // it; the panels dock beside the working area, never over the artboards.
    <PanelsProvider value={panels}>
    <div className="h-dvh flex flex-col bg-canvas">
      <header className="min-h-16 shrink-0 flex flex-wrap items-center gap-x-3 px-3">
        <div className="flex-1 flex items-center gap-2 min-w-0 min-h-16">
          <FileMenu workspace={workspace} project={project} />
          <Link href={`/w/${workspace.id}`} aria-description={`Back to ${workspace.name}`} className="hidden md:inline-flex items-center min-h-11 px-3.5 rounded-lg bg-paper border border-hairline text-sm font-medium truncate max-w-[24ch] hover:border-line-strong transition-colors">{project.name}</Link>
          <span className="md:hidden text-sm font-medium truncate">{project.name}</span>
          {aiMock && <span className="ml-1 shrink-0 hidden sm:inline-flex"><Badge tone="warn">Mock AI</Badge></span>}
        </div>

        {/* The steps as one segmented control, like Sitemap / Wireframe / Style Guide / Design. */}
        <nav className="flex items-center justify-center order-last w-full pb-2 sm:order-none sm:w-auto sm:pb-0" aria-label="Steps">
          <div className="flex items-center gap-0.5 p-1 rounded-xl bg-active">
            {STAGES.map((s, i) => {
              const Icon = STAGE_ICON[s];
              const open = i <= unlocked;
              const on = seg === s;
              const done = i < unlocked;
              const cls = `flex items-center gap-1.5 min-h-11 px-3 sm:px-5 rounded-lg text-sm font-medium transition-colors ${on ? "bg-paper text-ink shadow-[var(--shadow-sm)]" : open ? "text-ink-muted hover:text-ink" : "text-ink-faint cursor-not-allowed"}`;
              // No step numbers and no padlocks: a finished step gets a tick,
              // a locked one is simply dimmed.
              const inner = (
                <>
                  {done && !on ? <Check size={15} className="text-ok" aria-hidden="true" /> : <Icon size={15} aria-hidden="true" />}
                  {STAGE_LABEL[s]}
                </>
              );
              return open
                ? <Link key={s} href={`${base}/${s}`} aria-current={on ? "page" : undefined} className={cls}>{inner}</Link>
                : <span key={s} className={cls} aria-disabled="true" aria-description={`Finish ${STAGE_LABEL[STAGES[i - 1]]} first`}>{inner}</span>;
            })}
          </div>
        </nav>

        <div className="sm:flex-1 flex items-center justify-end gap-2">
          <div className="hidden lg:flex -space-x-1.5 mr-1">
            {members.slice(0, 3).map((m) => (
              <Avatar key={m.email} seed={m.email} label={m.email} size="sm" className="!w-8 !h-8 text-[0.6rem] ring-2 ring-[var(--canvas)]" />
            ))}
          </div>
          <RightPanelToggle className="inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-lg border border-line text-ink hover:border-line-strong hover:bg-hover transition-colors aria-pressed:bg-accent-soft aria-pressed:text-accent-ink aria-pressed:border-accent" />
          <button onClick={() => setShare(true)} className={`${btnClass("secondary", "sm")} !rounded-lg max-sm:!px-3`}><Share2 size={15} aria-hidden="true" /> <span className="max-sm:sr-only">Share</span></button>
          <Link href={`${base}/export`} className={`${btnClass("primary", "sm")} !rounded-lg max-sm:!px-3`}><Download size={15} aria-hidden="true" /> <span className="max-sm:sr-only">Export</span></Link>
        </div>
      </header>

      {/* On a phone the tools move to a bar along the bottom (thumb reach) and the
          canvas gets the full width; the panels open as sheets above that bar. */}
      <div className="flex-1 flex max-sm:flex-col min-h-0 relative">
        {/* The tool rail: each tool opens its panel beside the canvas, click again to close. */}
        <nav className="w-[72px] shrink-0 flex flex-col items-center pt-1 pb-3 gap-2.5 max-sm:order-last max-sm:w-full max-sm:h-[60px] max-sm:flex-row max-sm:justify-between max-sm:px-4 max-sm:py-2 max-sm:border-t max-sm:border-hairline" aria-label="Tools">
          <RailBtn on={leftShown && leftTab === "layers"} onClick={() => pick("layers")} label="Layers"><Layers size={19} /></RailBtn>
          <RailBtn on={leftShown && leftTab === "add"} onClick={() => pick("add")} label="Add"><Plus size={20} /></RailBtn>
          <RailBtn on={leftShown && leftTab === "agent"} onClick={() => pick("agent")} label="Agent"><WandSparkles size={19} /></RailBtn>
          <span className="flex-1 max-sm:hidden" />
          <ThemeToggle className="!w-11 !h-11 !rounded-xl !bg-paper border border-hairline hover:border-line-strong" />
          <Link href="/settings" className="w-11 h-11 rounded-xl bg-paper border border-hairline flex items-center justify-center text-ink hover:border-line-strong transition-colors" aria-label="Settings"><Settings size={18} aria-hidden="true" /></Link>
        </nav>
        {leftTab && (
          // Docked beside the tools from 900px (its own column, so the canvas
          // is what is left); below that a sheet over the canvas, from the
          // bottom on a phone. Always with a close button.
          <aside aria-label={leftTab === "layers" ? "Layers" : leftTab === "add" ? "Add" : "Huemen agent"} className={`${asked ? "flex" : "hidden min-[1200px]:flex"} absolute top-1 bottom-3 left-[72px] z-30 w-[min(300px,calc(100%-5.5rem))] min-[900px]:static min-[900px]:z-auto min-[900px]:w-[300px] min-[900px]:mt-1 min-[900px]:mb-3 shrink-0 rounded-2xl border border-hairline bg-paper shadow-[var(--shadow-overlay)] min-[900px]:shadow-none flex-col min-h-0 overflow-hidden max-sm:top-auto max-sm:bottom-[60px] max-sm:left-0 max-sm:w-full max-sm:h-[72%] max-sm:rounded-b-none max-sm:border-x-0`}>
            <div className="min-h-14 shrink-0 flex items-center pl-5 pr-2">
              <span className="text-lg font-medium flex-1">{leftTab === "layers" ? "Layers" : leftTab === "add" ? "Add" : "Huemen agent"}</span>
              <IconButton label="Close panel" onClick={closeLeft}><X size={18} /></IconButton>
            </div>
            {leftTab === "layers" ? (
              <LayersPanel base={base} seg={seg} unlocked={unlocked} layers={layers} brief={brief} />
            ) : leftTab === "add" ? (
              <AddPanel tenantId={workspace.id} projectId={project.id} base={base} canDraft={layers.pillars.length > 0} pillars={layers.pillars.map((p) => ({ id: p.id, name: p.name }))} />
            ) : (
              <AgentPanel workspaceId={workspace.id} projectId={project.id} degraded={brief.degraded} completeness={brief.completeness} />
            )}
          </aside>
        )}
        <main className="flex-1 min-w-0 relative">
          <PageTransition level="page">{children}</PageTransition>
        </main>
      </div>

      <ShareModal open={share} onClose={() => setShare(false)} members={members} questionnaireUrl={questionnaireUrl} isAdmin={user.role === "owner_admin"} />
    </div>
    </PanelsProvider>
  );
}

function RailBtn({ children, on, onClick, label }: { children: ReactNode; on: boolean; onClick: () => void; label: string }) {
  // Pressed only while its panel is really showing (it stays shut on a narrow window until asked for).
  return (
    <button onClick={onClick} aria-label={label} aria-pressed={on} className={`w-11 h-11 rounded-xl bg-paper border flex items-center justify-center transition-colors ${on ? "border-accent !bg-accent-soft !text-accent-ink" : "border-hairline hover:border-line-strong"}`}>{children}</button>
  );
}

function FileMenu({ workspace, project }: { workspace: { id: string; name: string }; project: { id: string; name: string } }) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [name, setName] = useState(project.name);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="flex items-center gap-1 min-h-11 pl-1.5 pr-2 rounded-lg bg-paper border border-hairline hover:border-line-strong transition-colors" aria-label="File menu">
        <LogoMark size={26} /> <ChevronDown size={15} className="text-ink-faint" aria-hidden="true" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0" style={{ zIndex: "var(--z-dropdown)" }} onClick={() => setOpen(false)} />
          <Menu label="File" className="absolute left-0 top-12 w-64 pop">
            <MenuItem href={`/w/${workspace.id}`} icon={<ArrowLeft size={15} aria-hidden="true" />}>Back to files</MenuItem>
            <MenuSeparator />
            <MenuItem onClick={() => { setOpen(false); setRenaming(true); }} icon={<Pencil size={15} aria-hidden="true" />}>Rename</MenuItem>
            <MenuItem href={`/w/${workspace.id}/create`} icon={<Files size={15} aria-hidden="true" />}>New piece</MenuItem>
            <MenuSeparator />
            <MenuItem href={`/w/${workspace.id}/brand`} icon={<FileText size={15} aria-hidden="true" />}>Brand core</MenuItem>
            <MenuItem href={`/w/${workspace.id}/check`} icon={<ScanText size={15} aria-hidden="true" />}>Check</MenuItem>
            <MenuItem href={`/w/${workspace.id}/plan`} icon={<CalendarDays size={15} aria-hidden="true" />}>Plan</MenuItem>
            <MenuItem href={`/w/${workspace.id}/usage`} icon={<BarChart3 size={15} aria-hidden="true" />}>Workspace usage</MenuItem>
            <MenuItem href="/settings" icon={<Settings size={15} aria-hidden="true" />}>Settings</MenuItem>
            <MenuSeparator />
            <MenuItem onClick={() => { if (pending) return; setOpen(false); setArchiving(true); }} icon={<Archive size={15} aria-hidden="true" />}>Archive project</MenuItem>
            <MenuItem danger onClick={() => { if (pending) return; setOpen(false); setDeleting(true); }} icon={<Trash2 size={15} aria-hidden="true" />}>Delete project</MenuItem>
          </Menu>
        </>
      )}
      {deleting && (
        <DeleteProjectModal
          name={project.name}
          pending={pending}
          onClose={() => setDeleting(false)}
          onConfirm={() => start(async () => {
            try {
              await deleteProjectAction(workspace.id, project.id);
              router.push(`/w/${workspace.id}`);
            } catch {
              toast("Couldn't delete the project. Try again.", "danger");
            }
          })}
          onArchive={() => start(async () => { await archiveProjectAction(workspace.id, project.id); router.push(`/w/${workspace.id}`); })}
        />
      )}
      <ConfirmModal
        open={archiving}
        title={`Archive “${project.name}”?`}
        confirmLabel="Archive project"
        pending={pending}
        onClose={() => setArchiving(false)}
        onConfirm={() => start(async () => {
          try {
            await archiveProjectAction(workspace.id, project.id);
            router.push(`/w/${workspace.id}`);
          } catch {
            setArchiving(false);
            toast("Couldn't archive the project. Try again.", "danger");
          }
        })}
      >
        It leaves the library and stops counting towards your pillars. You can restore it from Archived at any time.
      </ConfirmModal>
      <Modal open={renaming} onClose={() => setRenaming(false)} title="Rename project">
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} className="field" autoFocus />
          <button disabled={pending || !name.trim()} onClick={() => start(async () => { await renameProjectAction(workspace.id, project.id, name); setRenaming(false); toast("Renamed"); router.refresh(); })} className={btnClass("primary")}>Save</button>
        </div>
      </Modal>
    </div>
  );
}

function LayersPanel({ base, seg, unlocked, layers, brief }: { base: string; seg: string; unlocked: number; layers: Layers; brief: { completeness: number; degraded: boolean } }) {
  const items =
    seg === "pillars" ? layers.pillars.map((p) => ({ id: p.id, label: p.name, meta: `${p.count}`, href: `${base}/pillars?pillar=${p.id}`, icon: Network, flagged: false }))
    : seg === "content" || seg === "visual" ? layers.content.map((c) => ({ id: c.id, label: c.name, meta: c.status, href: `${base}/${seg}?item=${c.id}`, icon: seg === "visual" ? Palette : PenLine, flagged: c.flagged }))
    : [];
  return (
    <div className="flex-1 overflow-y-auto">
      <p className="label-mono text-ink-faint px-3 pt-3 pb-1.5">Pages</p>
      <div className="px-1.5">
        {STAGES.map((s, i) => {
          const Icon = STAGE_ICON[s];
          const open = i <= unlocked;
          const on = seg === s;
          const row = `flex items-center gap-2.5 min-h-11 px-3 rounded-sm text-sm ${on ? "bg-accent-soft text-accent-ink font-medium" : open ? "hover:bg-hover" : "text-ink-faint"}`;
          const inner = (
            <>
              <Icon size={15} aria-hidden="true" /> <span className="flex-1">{STAGE_LABEL[s]}</span>
              {!open ? <Lock size={13} aria-label="Locked" /> : i < unlocked ? <Check size={14} className="text-ok" aria-label="Done" /> : null}
            </>
          );
          return open ? <Link key={s} href={`${base}/${s}`} aria-current={on ? "page" : undefined} className={row}>{inner}</Link> : <div key={s} className={row} aria-disabled="true" aria-description="Locked until the previous step is done">{inner}</div>;
        })}
        <div className="h-px bg-hairline my-1.5 mx-2" />
        {PLANNING.map((p) => {
          const Icon = p.icon;
          // Planning belongs to the workspace (build step 3), not this piece.
          return (
            <Link key={p.seg} href={`${base.replace(/\/p\/[^/]+$/, "")}/plan/${p.seg}`} className={`flex items-center gap-2.5 min-h-11 px-3 rounded-sm text-sm ${seg === p.seg ? "bg-accent-soft font-medium" : "text-ink-muted hover:bg-hover hover:text-ink"}`}>
              <Icon size={15} aria-hidden="true" /> {p.label}
            </Link>
          );
        })}
      </div>

      <p className="label-mono text-ink-faint px-3 pt-4 pb-1.5 border-t border-hairline mt-3">Layers</p>
      <div className="px-1.5 pb-3">
        {items.length === 0 ? (
          <p className="text-xs text-ink-faint px-2 py-1">{seg === "brief" ? "The brief is a document: sections are on the right." : "Nothing on this page yet."}</p>
        ) : (
          items.map((it) => {
            const Icon = it.icon;
            return (
              <Link key={it.id} href={it.href} className="flex items-center gap-2.5 min-h-11 px-3 rounded-sm text-sm hover:bg-hover group">
                <Icon size={14} className="text-ink-faint shrink-0" aria-hidden="true" />
                <span className="flex-1 truncate">{it.label}</span>
                {it.flagged && <Flag size={13} className="text-accent shrink-0" aria-label="Flagged" />}
                <span className="text-xs text-ink-faint">{it.meta}</span>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

function ShareModal({ open, onClose, members, questionnaireUrl, isAdmin }: { open: boolean; onClose: () => void; members: { email: string; role: string; status: string }[]; questionnaireUrl: string | null; isAdmin: boolean }) {
  const toast = useToast();
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast("Link copied"); } catch { toast("Copy failed. Select and copy it manually.", "danger"); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Share" width={480}>
      <div className="flex flex-col gap-5">
        {questionnaireUrl && (
          <div>
            <p className="text-sm font-medium mb-1.5">Pre-workshop questionnaire</p>
            <div className="flex items-center gap-2 bg-hover border border-hairline rounded-sm pl-3 pr-1 min-h-12">
              <span className="text-sm text-accent-ink truncate flex-1">{questionnaireUrl}</span>
              <IconButton label="Copy questionnaire link" onClick={() => copy(questionnaireUrl)}><Copy size={16} /></IconButton>
            </div>
          </div>
        )}
        <div>
          <p className="text-sm font-medium mb-2">Everyone in this workspace can open this project</p>
          <div className="flex flex-col divide-y divide-[var(--hairline)] border border-hairline rounded-md">
            {members.length === 0 && <p className="text-sm text-ink-faint p-3">No one invited yet.</p>}
            {members.map((m) => (
              <div key={m.email} className="flex items-center gap-2.5 px-3 h-11">
                <span className="w-7 h-7 rounded-full bg-field flex items-center justify-center text-[0.62rem] uppercase font-medium">{m.email.slice(0, 2)}</span>
                <span className="text-sm flex-1 truncate">{m.email}</span>
                {m.status === "invited" && <Badge tone="warn">Invited</Badge>}
                <span className="text-xs text-ink-muted capitalize">{m.role.replace("owner_admin", "admin")}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-faint mt-1.5">Other workspaces never see it.</p>
        </div>
        {isAdmin ? <Link href="/settings/workspaces" className={`${btnClass("primary")} self-start`}>Invite people</Link> : <p className="text-sm text-ink-muted">Invites are managed by your admin.</p>}
      </div>
    </Modal>
  );
}
