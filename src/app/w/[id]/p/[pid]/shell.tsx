"use client";

/**
 * Project editor chrome, Figma-style: top bar (file menu, breadcrumb, the
 * four-step stepper, share/export), a left panel with Pages + Layers or the
 * Agent, and the canvas/document in the middle. Pages render their own right
 * inspector. Steps unlock in order: Brief → Pillars → Content → Visual.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import {
  ChevronDown, FileText, Network, PenLine, Palette, Share2, Download, Lightbulb, CalendarDays,
  Package, ArrowUp, Check, Lock, Copy, ChevronRight, Layers, ArrowLeft, Pencil, Files, Flag, BarChart3, Plus, WandSparkles, X, HelpCircle, Archive, Trash2,
} from "lucide-react";
import { LogoMark, Modal, AgentDots, Badge, ToastProvider, useToast } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { PageTransition } from "@/components/page-transition";
import { ThemeToggle } from "@/components/theme";
import { STAGES, STAGE_LABEL, stageIndex, type Stage } from "@/lib/projects/stages";
import { askAgent, type AgentReply } from "./agent-actions";
import { AddPanel } from "./add-panel";
import { renameProjectAction, duplicateProjectAction, archiveProjectAction, deleteProjectAction } from "../../project-actions";
import { DeleteProjectModal } from "@/components/delete-project-modal";

const STAGE_ICON: Record<Stage, typeof FileText> = { brief: FileText, pillars: Network, content: PenLine, visual: Palette };
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
  const pick = (t: "layers" | "add" | "agent") => setLeftTab((cur) => (cur === t ? null : t));
  const [share, setShare] = useState(false);
  const unlocked = stageIndex(project.stage);

  if (seg === "intake") return <>{children}</>;

  return (
    <div className="h-screen flex flex-col">
      <header className="h-12 shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-2 border-b border-hairline bg-paper">
        <div className="flex items-center gap-1 min-w-0">
          <FileMenu workspace={workspace} project={project} />
          <Link href={`/w/${workspace.id}`} className="text-[0.8rem] text-ink-faint hover:text-ink truncate hidden md:block">{workspace.name}</Link>
          <span className="text-ink-faint hidden md:block">/</span>
          <span className="text-[0.82rem] font-medium truncate">{project.name}</span>
          {aiMock && <span className="ml-1"><Badge tone="warn">Mock AI</Badge></span>}
        </div>

        <nav className="flex items-center" aria-label="Steps">
          {STAGES.map((s, i) => {
            const Icon = STAGE_ICON[s];
            const open = i <= unlocked;
            const on = seg === s;
            const done = i < unlocked;
            const cls = `flex items-center gap-1.5 h-8 pl-1.5 pr-2.5 rounded-[8px] text-[0.8rem] transition-colors ${on ? "bg-ink text-on-ink" : open ? "text-ink hover:bg-field" : "text-ink-faint cursor-not-allowed"}`;
            const inner = (
              <>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[0.65rem] font-medium ${on ? "bg-on-ink/15" : done ? "bg-ok text-on-ink" : open ? "bg-field" : "bg-field"}`}>
                  {done && !on ? <Check size={11} /> : open ? i + 1 : <Lock size={10} />}
                </span>
                <Icon size={13} className="hidden lg:block" /> {STAGE_LABEL[s]}
              </>
            );
            return (
              <div key={s} className="flex items-center">
                {i > 0 && <ChevronRight size={14} className="text-ink-faint mx-0.5" />}
                {open ? <Link href={`${base}/${s}`} className={cls}>{inner}</Link> : <span className={cls} title={`Finish ${STAGE_LABEL[STAGES[i - 1]]} first`}>{inner}</span>}
              </div>
            );
          })}
        </nav>

        <div className="flex items-center justify-end gap-1.5">
          <div className="hidden lg:flex -space-x-1.5 mr-1">
            {members.slice(0, 3).map((m) => (
              <span key={m.email} title={m.email} className="w-6 h-6 rounded-full bg-ink text-on-ink text-[0.55rem] uppercase flex items-center justify-center ring-2 ring-paper">{m.email.slice(0, 2)}</span>
            ))}
          </div>
          <button onClick={() => setShare(true)} className={btnClass("secondary", "sm")}><Share2 size={13} /> Share</button>
          <Link href={`${base}/export`} className={btnClass("accent", "sm")}><Download size={13} /> Export</Link>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Tool rail (Relume/Figma): each icon opens its panel; click again to close. */}
        <nav className="w-12 shrink-0 border-r border-hairline bg-paper flex flex-col items-center py-2 gap-1" aria-label="Tools">
          <RailBtn on={leftTab === "layers"} onClick={() => pick("layers")} label="Layers"><Layers size={16} /></RailBtn>
          <RailBtn on={leftTab === "add"} onClick={() => pick("add")} label="Add"><Plus size={17} /></RailBtn>
          <RailBtn on={leftTab === "agent"} onClick={() => pick("agent")} label="Agent"><WandSparkles size={16} /></RailBtn>
          <span className="flex-1" />
          <ThemeToggle />
          <Link href="/settings" className="w-8 h-8 rounded-[8px] flex items-center justify-center text-ink-muted hover:bg-field" title="Settings"><HelpCircle size={16} /></Link>
        </nav>
        {leftTab && (
          <aside className="w-[260px] shrink-0 border-r border-hairline bg-paper flex flex-col min-h-0">
            <div className="h-10 shrink-0 flex items-center px-3 border-b border-hairline">
              <span className="text-[0.82rem] font-medium flex-1">{leftTab === "layers" ? "Layers" : leftTab === "add" ? "Add" : "Huemen agent"}</span>
              <button onClick={() => setLeftTab(null)} className="w-6 h-6 rounded-[6px] flex items-center justify-center text-ink-faint hover:bg-field hover:text-ink" aria-label="Close panel"><X size={14} /></button>
            </div>
            {leftTab === "layers" ? (
              <LayersPanel base={base} seg={seg} unlocked={unlocked} layers={layers} brief={brief} />
            ) : leftTab === "add" ? (
              <AddPanel tenantId={workspace.id} projectId={project.id} base={base} canDraft={unlocked >= stageIndex("pillars")} pillars={layers.pillars.map((p) => ({ id: p.id, name: p.name }))} />
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

function RailBtn({ children, on, onClick, label }: { children: ReactNode; on: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} aria-pressed={on} className={`w-8 h-8 rounded-[8px] flex items-center justify-center transition-colors ${on ? "bg-accent-soft text-accent-ink ring-1 ring-accent/40" : "text-ink-muted hover:bg-field hover:text-ink"}`}>{children}</button>
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
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-0.5 p-1 rounded-[8px] hover:bg-field" aria-label="File menu">
        <LogoMark size={24} /> <ChevronDown size={13} className="text-ink-faint" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-10 z-40 w-60 bg-menu text-menu-fg rounded-[10px] shadow-[var(--shadow-lg)] p-1.5 pop text-[0.8rem]">
            <Link href={`/w/${workspace.id}`} className="flex items-center gap-2 h-8 px-2.5 rounded-[6px] hover:bg-white/10"><ArrowLeft size={14} /> Back to files</Link>
            <div className="h-px bg-white/10 my-1" />
            <button onClick={() => { setOpen(false); setRenaming(true); }} className="w-full flex items-center gap-2 h-8 px-2.5 rounded-[6px] hover:bg-white/10"><Pencil size={14} /> Rename</button>
            <button disabled={pending} onClick={() => start(async () => { const id = await duplicateProjectAction(workspace.id, project.id); router.push(`/w/${workspace.id}/p/${id}/brief`); })} className="w-full flex items-center gap-2 h-8 px-2.5 rounded-[6px] hover:bg-white/10"><Files size={14} /> New project from this brief</button>
            <Link href={`/w/${workspace.id}/usage`} className="flex items-center gap-2 h-8 px-2.5 rounded-[6px] hover:bg-white/10"><BarChart3 size={14} /> Workspace usage</Link>
            <div className="h-px bg-white/10 my-1" />
            <button disabled={pending} onClick={() => { if (confirm(`Archive “${project.name}”? It disappears from the workspace.`)) start(async () => { await archiveProjectAction(workspace.id, project.id); router.push(`/w/${workspace.id}`); }); }} className="w-full flex items-center gap-2 h-8 px-2.5 rounded-[6px] hover:bg-white/10 text-menu-fg/70"><Archive size={14} /> Archive project</button>
            <button disabled={pending} onClick={() => { setOpen(false); setDeleting(true); }} className="w-full flex items-center gap-2 h-8 px-2.5 rounded-[6px] hover:bg-white/10 text-menu-fg/70"><Trash2 size={14} /> Delete project</button>
          </div>
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
              toast("Couldn't delete the project. Try again.");
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
          const on = seg === s || (s === "brief" && seg === "brief");
          const row = `flex items-center gap-2 h-8 px-2 rounded-[7px] text-[0.8rem] ${on ? "bg-accent-soft text-ink font-medium" : open ? "hover:bg-field" : "text-ink-faint"}`;
          const inner = (
            <>
              <Icon size={13} /> <span className="flex-1">{i + 1}. {STAGE_LABEL[s]}</span>
              {!open ? <Lock size={11} /> : i < unlocked ? <Check size={12} className="text-ok" /> : s === "brief" ? <span className="text-[0.68rem] text-ink-faint tabular-nums">{brief.completeness}%</span> : null}
            </>
          );
          return open ? <Link key={s} href={`${base}/${s}`} className={row}>{inner}</Link> : <div key={s} className={row} title="Locked until the previous step is done">{inner}</div>;
        })}
        <div className="h-px bg-hairline my-1.5 mx-2" />
        {PLANNING.map((p) => {
          const Icon = p.icon;
          return (
            <Link key={p.seg} href={`${base}/${p.seg}`} className={`flex items-center gap-2 h-8 px-2 rounded-[7px] text-[0.8rem] ${seg === p.seg ? "bg-accent-soft font-medium" : "text-ink-muted hover:bg-field"}`}>
              <Icon size={13} /> {p.label}
            </Link>
          );
        })}
      </div>

      <p className="label-mono text-ink-faint px-3 pt-4 pb-1.5 border-t border-hairline mt-3">Layers</p>
      <div className="px-1.5 pb-3">
        {items.length === 0 ? (
          <p className="text-[0.75rem] text-ink-faint px-2 py-1">{seg === "brief" ? "The brief is a document: sections are on the right." : "Nothing on this page yet."}</p>
        ) : (
          items.map((it) => {
            const Icon = it.icon;
            return (
              <Link key={it.id} href={it.href} className="flex items-center gap-2 h-7 px-2 rounded-[6px] text-[0.76rem] hover:bg-field group">
                <Icon size={12} className="text-ink-faint shrink-0" />
                <span className="flex-1 truncate">{it.label}</span>
                {it.flagged && <Flag size={11} className="text-accent shrink-0" />}
                <span className="text-[0.66rem] text-ink-faint">{it.meta}</span>
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
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
        {msgs.map((m, i) =>
          m.role === "me" ? (
            <div key={i} className="self-end max-w-[90%] bg-field rounded-[10px] px-2.5 py-1.5 text-[0.8rem] fade-up">{m.text}</div>
          ) : (
            <div key={i} className="text-[0.8rem] leading-relaxed fade-up">
              <p>{m.text}</p>
              {m.tasks && m.tasks.length > 0 && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <p className="text-[0.7rem] text-ink-faint">Carried out {m.tasks.length} task{m.tasks.length > 1 ? "s" : ""}</p>
                  {m.tasks.map((t, j) => {
                    const card = (
                      <span className="flex items-center gap-2 border border-hairline rounded-[9px] px-2 py-1.5 hover:border-line">
                        <span className="w-6 h-6 rounded-[6px] bg-field flex items-center justify-center shrink-0"><Check size={12} /></span>
                        <span className="min-w-0"><span className="block text-[0.76rem] font-medium truncate">{t.label}</span>{t.detail && <span className="block text-[0.68rem] text-ink-faint truncate">{t.detail}</span>}</span>
                      </span>
                    );
                    return t.href ? <Link key={j} href={t.href}>{card}</Link> : <div key={j}>{card}</div>;
                  })}
                </div>
              )}
            </div>
          ),
        )}
        {pending && <div className="flex items-center gap-2 bg-accent-soft text-accent-ink rounded-[9px] px-2.5 py-2 text-[0.78rem] font-medium fade-in"><AgentDots /> Working from your brief…</div>}
        <div ref={endRef} />
      </div>
      <div className="p-2.5 border-t border-hairline">
        <div className="bg-panel border border-hairline rounded-[10px] focus-within:border-ink">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={3}
            placeholder="Ask Huemen…"
            className="w-full resize-none bg-transparent px-2.5 pt-2 text-[0.8rem] outline-none placeholder:text-ink-faint"
          />
          <div className="flex justify-end px-1.5 pb-1.5">
            <button onClick={send} disabled={!draft.trim() || pending} className="w-7 h-7 rounded-[7px] bg-ink text-on-ink flex items-center justify-center disabled:bg-field disabled:text-ink-faint" aria-label="Send"><ArrowUp size={14} /></button>
          </div>
        </div>
        <p className="text-[0.66rem] text-ink-faint text-center mt-1.5">Powered by this project&apos;s brief</p>
      </div>
    </div>
  );
}

function ShareModal({ open, onClose, members, questionnaireUrl, isAdmin }: { open: boolean; onClose: () => void; members: { email: string; role: string; status: string }[]; questionnaireUrl: string | null; isAdmin: boolean }) {
  const toast = useToast();
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast("Link copied"); } catch { toast("Copy failed. Select and copy it manually."); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Share" width={480}>
      <div className="flex flex-col gap-5">
        {questionnaireUrl && (
          <div>
            <p className="text-[0.8rem] font-medium mb-1.5">Pre-workshop questionnaire</p>
            <div className="flex items-center gap-2 bg-field rounded-[8px] pl-3 pr-1 h-9">
              <span className="text-[0.78rem] text-accent-ink truncate flex-1">{questionnaireUrl}</span>
              <button onClick={() => copy(questionnaireUrl)} className="w-7 h-7 rounded-[6px] flex items-center justify-center hover:bg-paper" title="Copy"><Copy size={13} /></button>
            </div>
          </div>
        )}
        <div>
          <p className="text-[0.8rem] font-medium mb-2">Everyone in this workspace can open this project</p>
          <div className="flex flex-col divide-y divide-[var(--hairline)] border border-hairline rounded-[10px]">
            {members.length === 0 && <p className="text-[0.8rem] text-ink-faint p-3">No one invited yet.</p>}
            {members.map((m) => (
              <div key={m.email} className="flex items-center gap-2.5 px-3 h-11">
                <span className="w-7 h-7 rounded-full bg-field flex items-center justify-center text-[0.62rem] uppercase font-medium">{m.email.slice(0, 2)}</span>
                <span className="text-[0.8rem] flex-1 truncate">{m.email}</span>
                {m.status === "invited" && <Badge tone="warn">Invited</Badge>}
                <span className="text-[0.75rem] text-ink-muted capitalize">{m.role.replace("owner_admin", "admin")}</span>
              </div>
            ))}
          </div>
          <p className="text-[0.72rem] text-ink-faint mt-1.5">Other workspaces never see it.</p>
        </div>
        {isAdmin ? <Link href="/settings/workspaces" className={`${btnClass("primary")} self-start`}>Invite people</Link> : <p className="text-[0.8rem] text-ink-muted">Invites are managed by your admin.</p>}
      </div>
    </Modal>
  );
}
