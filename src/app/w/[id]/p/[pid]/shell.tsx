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
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import {
  ChevronDown, FileText, Network, PenLine, Palette, Share2, Download, Lightbulb, CalendarDays,
  Package, ArrowUp, Check, Lock, Copy, ChevronRight, Layers, ArrowLeft, Pencil, Files, Flag, BarChart3, Plus, WandSparkles, X, Settings, Archive, Trash2,
  ScanText,
} from "lucide-react";
import { LogoMark, Modal, AgentDots, Badge, Avatar, IconButton, Menu, MenuItem, MenuSeparator, ToastProvider, useToast } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { PageTransition } from "@/components/page-transition";
import { ThemeToggle } from "@/components/theme";
import { STAGES, STAGE_LABEL, stageIndex, type Stage } from "@/lib/projects/stages";
import { askAgent, type AgentReply } from "./agent-actions";
import { AddPanel } from "./add-panel";
import { renameProjectAction, duplicateProjectAction, archiveProjectAction, deleteProjectAction } from "../../project-actions";
import { DeleteProjectModal } from "@/components/delete-project-modal";

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
    <ToastProvider>
      <Shell {...props} />
    </ToastProvider>
  );
}

function Shell({ children, workspace, project, user, brief, layers, members, questionnaireUrl, aiMock }: Parameters<typeof ProjectShell>[0]) {
  const pathname = usePathname();
  const base = `/w/${workspace.id}/p/${project.id}`;
  const seg = pathname.slice(base.length + 1).split("/")[0] || "brief";
  const [leftTab, setLeftTab] = useState<"layers" | "add" | "agent" | null>("layers");
  // Below 900px the panel is an overlay that would cover the canvas, so it
  // stays shut until asked for, and shuts again after a page change.
  const [asked, setAsked] = useState(false);
  const [panelPath, setPanelPath] = useState(pathname);
  if (panelPath !== pathname) { setPanelPath(pathname); setAsked(false); }
  const pick = (t: "layers" | "add" | "agent") => {
    const shown = asked || window.matchMedia("(min-width: 900px)").matches;
    setLeftTab((cur) => (cur === t && shown ? null : t));
    setAsked(true);
  };
  const [share, setShare] = useState(false);
  const unlocked = stageIndex(project.stage);

  if (seg === "intake") return <>{children}</>;

  return (
    <div className="h-screen flex flex-col">
      <header className="min-h-14 shrink-0 flex flex-wrap items-center gap-x-3 px-2 border-b border-hairline bg-paper">
        <div className="flex-1 flex items-center gap-2 min-w-0 min-h-14">
          <FileMenu workspace={workspace} project={project} />
          <nav aria-label="Breadcrumb" className="min-w-0">
            <ol className="hu-crumbs">
              <li className="hidden md:flex"><Link href={`/w/${workspace.id}`} className="truncate max-w-[18ch]">{workspace.name}</Link></li>
              <li className="hidden md:flex sep" aria-hidden="true">/</li>
              <li className="min-w-0 flex"><span aria-current="page">{project.name}</span></li>
            </ol>
          </nav>
          {aiMock && <span className="ml-1 shrink-0 hidden sm:inline-flex"><Badge tone="warn">Mock AI</Badge></span>}
        </div>

        <nav className="flex items-center justify-center order-last w-full border-t border-hairline py-1 sm:order-none sm:w-auto sm:border-0 sm:py-0" aria-label="Steps">
          {STAGES.map((s, i) => {
            const Icon = STAGE_ICON[s];
            const open = i <= unlocked;
            const on = seg === s;
            const done = i < unlocked;
            const cls = `flex items-center gap-1.5 min-h-11 px-3 sm:px-4 rounded-full text-sm font-medium transition-colors ${on ? "bg-ink text-on-ink" : open ? "text-ink hover:bg-hover" : "text-ink-faint cursor-not-allowed"}`;
            // No step numbers and no padlocks: the step icon carries it, a
            // finished step gets a tick, and a locked one is simply dimmed.
            const inner = (
              <>
                {done && !on ? <Check size={15} className="text-ok" aria-hidden="true" /> : <Icon size={15} aria-hidden="true" />}
                {STAGE_LABEL[s]}
              </>
            );
            return (
              <div key={s} className="flex items-center">
                {i > 0 && <ChevronRight size={15} className="text-ink-faint mx-0.5 hidden sm:block" aria-hidden="true" />}
                {open ? <Link href={`${base}/${s}`} aria-current={on ? "page" : undefined} className={cls}>{inner}</Link> : <span className={cls} aria-disabled="true" title={`Finish ${STAGE_LABEL[STAGES[i - 1]]} first`}>{inner}</span>}
              </div>
            );
          })}
        </nav>

        <div className="sm:flex-1 flex items-center justify-end gap-1.5">
          <div className="hidden lg:flex -space-x-1.5 mr-1">
            {members.slice(0, 3).map((m) => (
              <Avatar key={m.email} seed={m.email} label={m.email} size="sm" className="!w-6 !h-6 text-[0.55rem] ring-2 ring-paper" />

            ))}
          </div>
          <button onClick={() => setShare(true)} className={`${btnClass("secondary", "sm")} max-sm:!px-3`}><Share2 size={15} aria-hidden="true" /> <span className="max-sm:sr-only">Share</span></button>
          <Link href={`${base}/export`} className={`${btnClass("primary", "sm")} max-sm:!px-3`}><Download size={15} aria-hidden="true" /> <span className="max-sm:sr-only">Export</span></Link>
        </div>
      </header>

      <div className="flex-1 flex min-h-0 relative">
        {/* Tool rail (Relume/Figma): each icon opens its panel; click again to close. */}
        <nav className="w-14 shrink-0 border-r border-hairline bg-paper flex flex-col items-center py-2 gap-2" aria-label="Tools">
          <RailBtn on={leftTab === "layers"} shown={asked} onClick={() => pick("layers")} label="Layers"><Layers size={18} /></RailBtn>
          <RailBtn on={leftTab === "add"} shown={asked} onClick={() => pick("add")} label="Add"><Plus size={19} /></RailBtn>
          <RailBtn on={leftTab === "agent"} shown={asked} onClick={() => pick("agent")} label="Agent"><WandSparkles size={18} /></RailBtn>
          <span className="flex-1" />
          <ThemeToggle />
          <Link href="/settings" className="hu-iconbtn" title="Settings" aria-label="Settings"><Settings size={18} aria-hidden="true" /></Link>
        </nav>
        {leftTab && (
          <aside className={`${asked ? "flex" : "hidden min-[900px]:flex"} absolute inset-y-0 left-14 z-30 w-[min(300px,calc(100%-3.5rem))] shadow-[var(--shadow-overlay)] min-[900px]:static min-[900px]:z-auto min-[900px]:w-[260px] min-[900px]:shadow-none shrink-0 border-r border-hairline bg-paper flex-col min-h-0`}>
            <div className="min-h-12 shrink-0 flex items-center pl-4 pr-1.5 border-b border-hairline">
              <span className="text-sm font-semibold flex-1">{leftTab === "layers" ? "Layers" : leftTab === "add" ? "Add" : "Huemen agent"}</span>
              <IconButton label="Close panel" onClick={() => setLeftTab(null)}><X size={17} /></IconButton>
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
        <main className="flex-1 min-w-0 relative bg-ground">
          <PageTransition level="page">{children}</PageTransition>
        </main>
      </div>

      <ShareModal open={share} onClose={() => setShare(false)} members={members} questionnaireUrl={questionnaireUrl} isAdmin={user.role === "owner_admin"} />
    </div>
  );
}

function RailBtn({ children, on, shown, onClick, label }: { children: ReactNode; on: boolean; shown: boolean; onClick: () => void; label: string }) {
  // On a phone the panel is hidden until asked for, so only look pressed then.
  const pressed = on ? (shown ? "!bg-accent-soft !text-accent-ink" : "min-[900px]:!bg-accent-soft min-[900px]:!text-accent-ink") : "";
  return (
    <button onClick={onClick} title={label} aria-label={label} aria-pressed={on} className={`hu-iconbtn !w-10 !h-10 !rounded-sm ${pressed}`}>{children}</button>
  );
}

function FileMenu({ workspace, project }: { workspace: { id: string; name: string }; project: { id: string; name: string } }) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(project.name);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="flex items-center gap-1 min-h-11 px-1.5 rounded-sm hover:bg-hover" aria-label="File menu">
        <LogoMark size={28} /> <ChevronDown size={15} className="text-ink-faint" aria-hidden="true" />
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
            <MenuItem onClick={() => { if (!pending && confirm(`Archive “${project.name}”? It disappears from the workspace.`)) start(async () => { await archiveProjectAction(workspace.id, project.id); router.push(`/w/${workspace.id}`); }); }} icon={<Archive size={15} aria-hidden="true" />}>Archive project</MenuItem>
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
          return open ? <Link key={s} href={`${base}/${s}`} aria-current={on ? "page" : undefined} className={row}>{inner}</Link> : <div key={s} className={row} title="Locked until the previous step is done">{inner}</div>;
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

type Msg = { role: "agent" | "me"; text: string; tasks?: AgentReply["tasks"] };

function AgentPanel({ workspaceId, projectId, degraded, completeness }: { workspaceId: string; projectId: string; degraded: boolean; completeness: number }) {
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "agent", text: degraded ? `This brief is ${completeness}% complete. I can draft, but it will read generic until the brief is filled in.` : "Brief loaded. Ask me to draft a post, add a pillar, capture an idea, or tell you what's missing." },
  ]);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, pending]);

  const send = () => {
    const text = draft.trim();
    if (!text || pending) return;
    setMsgs((m) => [...m, { role: "me", text }]);
    setDraft("");
    start(async () => {
      try {
        const r = await askAgent(workspaceId, projectId, text);
        setMsgs((m) => [...m, { role: "agent", text: r.text, tasks: r.tasks }]);
        router.refresh();
      } catch {
        setMsgs((m) => [...m, { role: "agent", text: "That didn't go through. Your message is back in the box, so try again." }]);
        setDraft(text);
      }
    });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3" role="log" aria-live="polite" aria-label="Assistant conversation">
        {msgs.map((m, i) =>
          m.role === "me" ? (
            <div key={i} className="self-end max-w-[90%] bg-field rounded-md px-2.5 py-1.5 text-sm fade-up">{m.text}</div>
          ) : (
            <div key={i} className="text-sm leading-relaxed fade-up">
              <p>{m.text}</p>
              {m.tasks && m.tasks.length > 0 && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <p className="text-xs text-ink-faint">Carried out {m.tasks.length} task{m.tasks.length > 1 ? "s" : ""}</p>
                  {m.tasks.map((t, j) => {
                    const card = (
                      <span className="flex items-center gap-2 border border-hairline rounded-md px-2 py-1.5 hover:border-line">
                        <span className="w-6 h-6 rounded-sm bg-field flex items-center justify-center shrink-0"><Check size={12} /></span>
                        <span className="min-w-0"><span className="block text-xs font-medium truncate">{t.label}</span>{t.detail && <span className="block text-xs text-ink-faint truncate">{t.detail}</span>}</span>
                      </span>
                    );
                    return t.href ? <Link key={j} href={t.href}>{card}</Link> : <div key={j}>{card}</div>;
                  })}
                </div>
              )}
            </div>
          ),
        )}
        {pending && <div role="status" className="flex items-center gap-2 bg-accent-soft text-accent-ink rounded-md px-2.5 py-2 text-xs font-medium fade-in"><AgentDots /> Working from your brief…</div>}
        <div ref={endRef} />
      </div>
      <div className="p-2.5 border-t border-hairline">
        <div className="bg-panel border border-hairline rounded-md focus-within:border-ink">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={3}
            placeholder="Ask Huemen…"
            className="w-full resize-none bg-transparent px-2.5 pt-2 text-sm outline-none placeholder:text-ink-faint"
          />
          <div className="flex justify-end px-1.5 pb-1.5">
            <button onClick={send} disabled={!draft.trim() || pending} className="hu-iconbtn !bg-ink !text-on-ink hover:opacity-90 disabled:!bg-active disabled:!text-ink-faint" aria-label="Send"><ArrowUp size={17} aria-hidden="true" /></button>
          </div>
        </div>
        <p className="text-xs text-ink-faint text-center mt-1.5">Powered by this project&apos;s brief</p>
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
