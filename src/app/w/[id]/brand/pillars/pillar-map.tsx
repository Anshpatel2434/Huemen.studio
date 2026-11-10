"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Children, useCallback, useState, useTransition, type ReactNode } from "react";
import {
  FileText, Network, MoreHorizontal, Plus, Sparkles, Check, Circle, Lightbulb, CalendarDays, Trash2, Pencil, GripVertical,
  ArrowLeft, ArrowRight, Search, X, BookOpen, Layers, PenLine,
} from "lucide-react";
import { Canvas } from "@/components/canvas";
import { CanvasHistory, EditableText, useCanvasHistory, useDeleteKey } from "@/components/canvas-edit";
import { IconButton, Menu, MenuItem, MenuSeparator, useToast } from "@/components/ui";
import { ConfirmModal } from "@/components/confirm-modal";
import { formatByKey } from "@/lib/content/formats";
import type { PillarView } from "@/lib/data/planning";
import { createPillarAction, deletePillarAction, reorderPillarsAction, startFromPillarAction, updatePillarAction } from "./actions";

const NODE_W = 280;
const GAP = 36;
const PIECES_SHOWN = 3;

export type MapPiece = { id: string; name: string; hook: string | null; format: string | null; status: string | null; score: number | null };
export type BriefRow = { label: string; ok: boolean; note: string };

type Props = {
  tenantId: string; selectedId: string | null; brandName: string; completeness: number; briefRows: BriefRow[]; pillars: PillarView[];
  /** The pieces filed under each pillar, newest first. */
  pieces: Record<string, MapPiece[]>;
};

/**
 * Pillars sitemap (Relume's sitemap): the brief at the root with its sections,
 * pillars as the pages under it, and each pillar's pieces hanging below. The
 * Add panel on the left is the section library: pillar ideas to drop onto the
 * map. The canvas is editable: double-click a name or description to edit it
 * in place, drag the grip to reorder, Delete removes the selected pillar, ⌘Z
 * undoes.
 */
export function PillarMap(props: Props) {
  return (
    <CanvasHistory>
      <PillarTree {...props} />
    </CanvasHistory>
  );
}

// ---- connectors -----------------------------------------------------------------------

/**
 * A row of children under one parent, joined by Relume's rounded elbows: a
 * stub down from the parent, a bus across, and a stub down into each child.
 */
function Branches({ children, onDragOver, onDrop }: { children: ReactNode; onDragOver?: (e: React.DragEvent) => void; onDrop?: (e: React.DragEvent) => void }) {
  const items = Children.toArray(children);
  const n = items.length;
  return (
    <div className="flex flex-col items-center">
      <Stub h={28} />
      <div className="flex items-start" onDragOver={onDragOver} onDrop={onDrop}>
        {items.map((c, i) => {
          const first = i === 0, last = i === n - 1;
          const elbow: React.CSSProperties = first
            ? { left: "50%", right: 0, borderTop: LINE, borderLeft: LINE, borderTopLeftRadius: 16 }
            : last
              ? { left: 0, right: "50%", borderTop: LINE, borderRight: LINE, borderTopRightRadius: 16 }
              : { left: 0, right: 0, borderTop: LINE };
          return (
            <div key={i} className="relative flex flex-col items-center" style={{ paddingLeft: GAP / 2, paddingRight: GAP / 2 }}>
              {n === 1 ? <Stub h={28} /> : (
                <>
                  <span aria-hidden="true" className="absolute top-0" style={{ ...elbow, height: 28 }} />
                  {!first && !last && <span aria-hidden="true" className="absolute top-0" style={{ left: "50%", width: LINE_W, height: 28, background: LINE_C }} />}
                  <span className="h-7" aria-hidden="true" />
                </>
              )}
              {c}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const LINE_W = 1.5;
const LINE_C = "var(--color-ink-faint)";
const LINE = `${LINE_W}px solid ${LINE_C}`;
/** A straight connector down. */
const Stub = ({ h }: { h: number }) => <span aria-hidden="true" style={{ width: LINE_W, height: h, background: LINE_C }} />;

/** Relume's page node: a small label bar over a white card of stacked sections. */
function Node({ icon, title, right, selected, dim, children, onClick, className = "" }: {
  icon: ReactNode; title: ReactNode; right?: ReactNode; selected?: boolean; dim?: boolean; children?: ReactNode; onClick?: () => void; className?: string;
}) {
  return (
    <div
      onClick={onClick}
      className={`group rounded-xl bg-hover p-1 transition-[box-shadow,opacity] ${selected ? "ring-2 ring-accent" : "ring-1 ring-[var(--hairline)] hover:ring-[var(--line)]"} ${dim ? "opacity-40" : ""} ${className}`}
      style={{ width: NODE_W }}
    >
      <div className="flex items-center gap-1.5 min-h-9 pl-2 pr-1 text-xs relative">
        {icon}
        <div className="font-medium flex-1 min-w-0 truncate">{title}</div>
        {right}
      </div>
      {children !== undefined && <div className="bg-paper rounded-lg p-1.5 flex flex-col gap-1.5 shadow-[var(--shadow-sm)] min-h-14">{children}</div>}
    </div>
  );
}

/** One section inside a node: a bold line and a quiet one, like Relume's "Hero Header Section". */
function Section({ title, note, href, tone, icon, faded }: { title: ReactNode; note?: ReactNode; href?: string; tone?: "ok" | "todo"; icon?: ReactNode; faded?: boolean }) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[13px] font-medium leading-tight">
        {icon}
        {tone === "ok" && <Check size={12} className="text-ok shrink-0" aria-label="done" />}
        {tone === "todo" && <Circle size={10} className="text-ink-faint shrink-0" aria-label="not yet" />}
        <span className="truncate">{title}</span>
      </span>
      {note && <span className="block text-[11.5px] text-ink-muted leading-snug mt-1 line-clamp-2">{note}</span>}
    </>
  );
  const cls = `block text-left rounded-md border px-2.5 py-2 ${faded ? "border-dashed border-line text-ink-faint" : "border-hairline hover:border-line"}`;
  return href ? <Link href={href} onClick={(e) => e.stopPropagation()} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

// ---- the Add panel (Relume's section library) ---------------------------------------------

const LIBRARY: { name: string; note: string }[] = [
  { name: "Signature point of view", note: "The one belief you want to be known for, argued from every angle" },
  { name: "Contrarian takes", note: "Where you disagree with your field, and why" },
  { name: "Client questions, answered", note: "The questions clients ask you over and over" },
  { name: "Origin story", note: "How you got here, and what it taught you" },
  { name: "How I work", note: "Your method, step by step, with real examples" },
  { name: "Case stories", note: "Before and after, from real client work" },
  { name: "Lessons learned", note: "Mistakes you made so your reader doesn't have to" },
  { name: "Behind the scenes", note: "What a normal week in your work looks like" },
  { name: "Industry take", note: "Your read on what's changing in your field" },
  { name: "Tools and frameworks", note: "The models and checklists you use with clients" },
];

/** One row in the Add panel: an icon, a name and what it is, and its action. */
const Row = ({ icon, title, sub, action }: { icon: ReactNode; title: string; sub?: string; action: ReactNode }) => (
  <div className="flex items-center gap-3 rounded-xl border border-hairline bg-paper px-3 min-h-14 py-2">
    <span className="w-9 h-9 rounded-md bg-field grid place-items-center text-ink-muted shrink-0" aria-hidden="true">{icon}</span>
    <span className="flex-1 min-w-0">
      <span className="block text-sm font-medium truncate">{title}</span>
      {sub && <span className="block text-xs text-ink-faint truncate">{sub}</span>}
    </span>
    {action}
  </div>
);

function AddPanel({ tenantId, onMap, onAdd, adding, onClose }: {
  tenantId: string; onMap: string[]; onAdd: (name: string, note: string) => void; adding: string | null; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const has = (n: string) => onMap.some((m) => m.trim().toLowerCase() === n.toLowerCase());
  const list = LIBRARY.filter((l) => `${l.name} ${l.note}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <aside
      className="absolute top-3 left-3 bottom-3 z-30 w-[288px] bg-paper border border-hairline rounded-2xl shadow-[var(--shadow)] flex flex-col"
      onPointerDown={(e) => e.stopPropagation()}
      aria-label="Add to the map"
    >
      <div className="flex items-center justify-between px-4 pt-3">
        <h2 className="text-lg font-medium">Add</h2>
        <IconButton label="Close the Add panel" onClick={onClose}><X size={17} /></IconButton>
      </div>
      <label className="mx-4 mt-2 flex items-center gap-2 border border-hairline rounded-lg px-3 min-h-11 focus-within:border-line-strong">
        <Search size={15} className="text-ink-faint" aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search pillar ideas" className="flex-1 bg-transparent outline-none text-sm" />
      </label>
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        {!q && (
          <>
            <p className="text-xs text-ink-muted mt-1">On every map</p>
            <Row icon={<FileText size={16} />} title="Brief" sub="1 instance, at the root" action={<Link href={`/w/${tenantId}/brand/edit`} className="text-xs text-ink-muted hover:text-ink underline underline-offset-2">Edit</Link>} />
            <p className="text-xs text-ink-muted mt-3">Start blank</p>
            <Row icon={<Plus size={16} />} title="Blank pillar" action={
              <IconButton label="Add a blank pillar" onClick={() => onAdd("Untitled pillar", "")}><Plus size={17} /></IconButton>
            } />
            <p className="text-xs text-ink-muted mt-3">Pillar ideas</p>
          </>
        )}
        {list.map((l) => (
          <Row
            key={l.name}
            icon={<Network size={16} />}
            title={l.name}
            sub={l.note}
            action={has(l.name)
              ? <span className="text-xs text-ok flex items-center gap-1 shrink-0"><Check size={13} aria-hidden="true" /> On the map</span>
              : <IconButton label={`Add ${l.name}`} disabled={adding !== null} onClick={() => onAdd(l.name, l.note)}>{adding === l.name ? <span className="text-xs">…</span> : <Plus size={17} />}</IconButton>}
          />
        ))}
        {q && list.length === 0 && (
          <div className="text-sm text-ink-muted px-1 py-4">
            Nothing called that yet.{" "}
            <button type="button" onClick={() => onAdd(q.trim(), "")} className="underline underline-offset-2 hover:text-ink">Add “{q.trim()}” as a pillar</button>
          </div>
        )}
      </div>
    </aside>
  );
}

// ---- the tree ---------------------------------------------------------------------------

function PillarTree({ tenantId, brandName, completeness, briefRows, pillars, pieces, selectedId }: Props) {
  const router = useRouter();
  const [starting, startTransition] = useTransition();
  // Drafting from a pillar starts a new piece: each output is its own project.
  const draftFrom = (p: PillarView) =>
    startTransition(async () => router.push(await startFromPillarAction(tenantId, p.name)));
  const toast = useToast();
  const history = useCanvasHistory();
  const [panel, setPanel] = useState(true);

  // Selection: seeded from ?pillar= (Layers panel), then local.
  const [sel, setSel] = useState<string | null>(selectedId);
  const [urlSel, setUrlSel] = useState(selectedId);
  if (selectedId !== urlSel) { setUrlSel(selectedId); setSel(selectedId); }

  // Which pillar name is in edit mode (double-click, "Rename", or a fresh pillar).
  const [editName, setEditName] = useState<string | null>(null);

  // Optimistic order while a reorder is saving.
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const byId = new Map(pillars.map((p) => [p.id, p]));
  const sameSet = localOrder && localOrder.length === pillars.length && localOrder.every((id) => byId.has(id));
  const ordered = sameSet ? localOrder.map((id) => byId.get(id)!) : pillars;

  const [drag, setDrag] = useState<{ id: string; to: number } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const base = `/w/${tenantId}`;

  const reorder = (next: string[], label = "reorder pillars") => {
    const prev = ordered.map((p) => p.id);
    if (next.join() === prev.join()) return;
    setLocalOrder(next);
    const save = (ids: string[]) => { setLocalOrder(ids); return reorderPillarsAction(tenantId, ids); };
    save(next).catch(() => { setLocalOrder(null); toast("Couldn't save the new order.", "danger"); });
    history.push({ label, undo: () => save(prev), redo: () => save(next) });
  };
  const move = (id: string, by: number) => {
    const ids = ordered.map((p) => p.id);
    const i = ids.indexOf(id), j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder(ids, "move pillar");
  };

  const edit = (p: PillarView, patch: { name?: string; description?: string }) => {
    const before = { name: p.name, description: p.description ?? "" };
    const after = { ...before, ...patch };
    const save = (v: typeof before) => updatePillarAction(tenantId, p.id, v.name, v.description);
    history.push({ label: patch.name !== undefined ? "rename pillar" : "edit description", undo: () => save(before), redo: () => save(after) });
    return save(after);
  };

  const add = async (name = "Untitled pillar", note = "") => {
    setAdding(name);
    try {
      const id = await createPillarAction(tenantId, name, note);
      if (id) { setSel(id); if (name === "Untitled pillar") setEditName(id); else toast(`“${name}” added to the map`); }
    } catch {
      toast("Couldn't add a pillar. Try again.", "danger");
    }
    setAdding(null);
  };

  // Delete asks first, in the app's own dialog (never the browser's confirm()).
  const [toDelete, setToDelete] = useState<PillarView | null>(null);
  const remove = useCallback((p: PillarView) => setToDelete(p), []);
  const confirmDelete = async () => {
    const p = toDelete;
    if (!p) return;
    setToDelete(null);
    try {
      await deletePillarAction(tenantId, p.id);
      setSel(null);
      toast("Pillar deleted");
    } catch {
      toast("Couldn't delete that pillar.", "danger");
    }
  };

  const selected = ordered.find((p) => p.id === sel) ?? null;
  useDeleteKey(selected && !editName ? () => remove(selected) : null);

  const dropAt = (e: React.DragEvent, index: number) => {
    if (!drag) return;
    const r = e.currentTarget.getBoundingClientRect();
    const to = e.clientX > r.left + r.width / 2 ? index + 1 : index;
    if (to !== drag.to) setDrag({ ...drag, to });
  };
  // One insertion bar: left of the node at the target index, or right of the last node.
  const dropMark = (d: { id: string; to: number }, i: number): "left" | "right" | null => {
    const from = ordered.findIndex((p) => p.id === d.id);
    if (d.to === from || d.to === from + 1) return null; // dropping in place
    if (d.to === i) return "left";
    if (i === ordered.length - 1 && d.to === ordered.length) return "right";
    return null;
  };
  const finishDrop = () => {
    if (!drag) return;
    const ids = ordered.map((p) => p.id).filter((id) => id !== drag.id);
    const from = ordered.findIndex((p) => p.id === drag.id);
    ids.splice(drag.to > from ? drag.to - 1 : drag.to, 0, drag.id);
    setDrag(null);
    reorder(ids);
  };

  const pieceCount = Object.values(pieces).reduce((n, l) => n + l.length, 0);
  const width = (ordered.length + 1) * (NODE_W + GAP) + 80;

  return (
    <>
      {/* The canvas sits beside the Add panel, never under it. */}
      <div className="absolute inset-y-0 right-0 transition-[left] duration-200" style={{ left: panel ? 304 : 0 }}>
      <Canvas
        onBackground={() => setSel(null)}
        toolbarExtra={
          !panel && (
            <>
              <span className="w-px h-6 bg-hairline mx-1" aria-hidden="true" />
              <button type="button" onClick={() => setPanel(true)} className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-sm text-sm hover:bg-hover"><Plus size={15} aria-hidden="true" /> Add</button>
            </>
          )
        }
      >
        <div className="p-10 pt-6" data-canvas-bg="1" style={{ minWidth: width }}>
          {/* The frame bar, like Relume's "AI Sitemap 1" */}
          <div className="flex items-center gap-2 h-9 px-3 rounded-lg bg-hover text-xs text-ink-muted mb-6" data-canvas-bg="1">
            <Layers size={13} aria-hidden="true" />
            <span className="font-medium text-ink">Pillar map</span>
            <span>· {ordered.length} {ordered.length === 1 ? "pillar" : "pillars"} · {pieceCount} {pieceCount === 1 ? "piece" : "pieces"}</span>
          </div>

          <div className="flex flex-col items-center" data-canvas-bg="1">
            {/* Root: the brief, its sections stacked like Relume's Home page */}
            <Node
              icon={<BookOpen size={13} className="text-ink-muted" aria-hidden="true" />}
              title={<>{brandName} · Brief</>}
              right={<span className="text-[11px] text-ink-faint tabular-nums pr-1.5">{completeness}%</span>}
            >
              {briefRows.map((r) => (
                <Section key={r.label} title={r.label} note={r.note || (r.ok ? undefined : "Not filled in yet")} tone={r.ok ? "ok" : "todo"} href={`${base}/brand/edit`} />
              ))}
            </Node>

            <Branches onDragOver={(e) => drag && e.preventDefault()} onDrop={(e) => { e.preventDefault(); finishDrop(); }}>
              {[
                ...ordered.map((p, i) => (
                  <div key={p.id} className="relative flex flex-col items-center" onDragOver={(e) => { if (drag) { e.preventDefault(); dropAt(e, i); } }}>
                    {drag && dropMark(drag, i) && (
                      <span className="absolute top-0 bottom-0 w-[3px] rounded-full bg-ink z-10" style={{ [dropMark(drag, i)!]: -GAP / 2 - 1.5 }} />
                    )}
                    <PillarNode
                      p={p}
                      base={base}
                      selected={sel === p.id}
                      dragging={drag?.id === p.id}
                      editingName={editName === p.id}
                      onEditingName={(on) => setEditName(on ? p.id : null)}
                      onSelect={() => setSel(p.id)}
                      onDraft={() => !starting && draftFrom(p)}
                      onEdit={(patch) => edit(p, patch)}
                      onDelete={() => remove(p)}
                      onMove={(by) => move(p.id, by)}
                      canMove={{ left: i > 0, right: i < ordered.length - 1 }}
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.name); setSel(p.id); setDrag({ id: p.id, to: i }); }}
                      onDragEnd={() => setDrag(null)}
                    />
                    <PieceBranch base={base} list={pieces[p.id] ?? []} onDraft={() => !starting && draftFrom(p)} />
                  </div>
                )),
                <div key="add" className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => add()}
                    disabled={adding !== null}
                    className="rounded-xl border-2 border-dashed border-line hover:border-ink text-ink-muted hover:text-ink flex flex-col items-center justify-center gap-1.5 transition-colors disabled:opacity-60"
                    style={{ width: NODE_W, height: 150 }}
                  >
                    <Plus size={18} aria-hidden="true" />
                    <span className="text-sm font-medium">{adding === "Untitled pillar" ? "Adding…" : "Add pillar"}</span>
                    <span className="text-xs text-ink-faint px-6 text-center">A theme this brand keeps coming back to</span>
                  </button>
                </div>,
              ]}
            </Branches>
          </div>
        </div>
      </Canvas>
      </div>

      {panel && <AddPanel tenantId={tenantId} onMap={ordered.map((p) => p.name)} onAdd={(n, d) => void add(n, d)} adding={adding} onClose={() => setPanel(false)} />}

      <ConfirmModal
        open={toDelete !== null}
        title={`Delete “${toDelete?.name ?? ""}”?`}
        confirmLabel="Delete pillar"
        danger
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
      >
        Its content stays, just without a pillar. Ideas and calendar slots tagged to it keep their text too.
      </ConfirmModal>
    </>
  );
}

/** The pieces filed under a pillar, as child nodes (Relume's sub-pages). */
function PieceBranch({ base, list, onDraft }: { base: string; list: MapPiece[]; onDraft: () => void }) {
  const shown = list.slice(0, PIECES_SHOWN);
  const more = list.length - shown.length;
  if (!list.length) {
    return (
      <Branches>
        <button type="button" onClick={onDraft} className="rounded-xl border border-dashed border-line hover:border-ink text-ink-faint hover:text-ink text-xs flex items-center justify-center gap-1.5 min-h-12" style={{ width: NODE_W - 60 }}>
          <Plus size={13} aria-hidden="true" /> First piece for this pillar
        </button>
      </Branches>
    );
  }
  return (
    <div className="flex flex-col items-center">
      <Stub h={28} />
      <div className="flex flex-col items-center gap-0">
        {shown.map((x, i) => (
          <div key={x.id} className="flex flex-col items-center">
            {i > 0 && <Stub h={16} />}
            <Node icon={<FileText size={13} className="text-ink-muted" aria-hidden="true" />} title={x.name} className="!w-[240px]">
              <Section
                href={`${base}/p/${x.id}/content`}
                icon={<PenLine size={11} className="text-ink-faint shrink-0" aria-hidden="true" />}
                title={x.hook || "No copy yet"}
                note={[x.format ? formatByKey(x.format).label : null, x.status, x.score != null ? `${x.score}/100` : null].filter(Boolean).join(" · ")}
              />
            </Node>
          </div>
        ))}
        {more > 0 && (
          <>
            <Stub h={16} />
            <Link href={`${base}?view=all`} className="rounded-full border border-line bg-paper px-4 min-h-9 inline-flex items-center text-xs text-ink-muted hover:text-ink">+{more} more</Link>
          </>
        )}
      </div>
    </div>
  );
}

function PillarNode({ p, base, selected, dragging, editingName, onEditingName, onSelect, onDraft, onEdit, onDelete, onMove, canMove, onDragStart, onDragEnd }: {
  p: PillarView; base: string; selected: boolean; dragging: boolean;
  editingName: boolean; onEditingName: (on: boolean) => void;
  onSelect: () => void; onDraft: () => void; onEdit: (patch: { name?: string; description?: string }) => Promise<unknown>;
  onDelete: () => void; onMove: (by: number) => void; canMove: { left: boolean; right: boolean };
  onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <Node
      selected={selected}
      dim={dragging}
      onClick={onSelect}
      icon={
        <>
          <span draggable onDragStart={onDragStart} onDragEnd={onDragEnd} title="Drag to reorder" aria-hidden
            className="w-4 h-6 -ml-1 rounded-sm flex items-center justify-center text-ink-faint opacity-0 group-hover:opacity-100 hover:bg-field cursor-grab active:cursor-grabbing">
            <GripVertical size={12} />
          </span>
          <Network size={13} className="text-ink-muted shrink-0" aria-hidden="true" />
        </>
      }
      title={<EditableText value={p.name} required label="Pillar name" className="truncate" editing={editingName} onEditingChange={onEditingName} onCommit={(name) => onEdit({ name })} />}
      right={
        <span onClick={(e) => e.stopPropagation()} className="inline-flex relative">
          <IconButton label={`Actions for ${p.name}`} pressed={menu} onClick={() => setMenu((m) => !m)}><MoreHorizontal size={16} /></IconButton>
          {menu && (
            <>
              <div className="fixed inset-0" style={{ zIndex: "var(--z-dropdown)" }} onClick={() => setMenu(false)} />
              <div className="absolute right-0 top-11" style={{ zIndex: "var(--z-dropdown)" }}>
                <Menu label={`Actions for ${p.name}`} className="w-52 pop">
                  <MenuItem icon={<Pencil size={15} aria-hidden="true" />} onClick={() => { setMenu(false); onEditingName(true); }}>Rename</MenuItem>
                  {canMove.left && <MenuItem icon={<ArrowLeft size={15} aria-hidden="true" />} onClick={() => { setMenu(false); onMove(-1); }}>Move left</MenuItem>}
                  {canMove.right && <MenuItem icon={<ArrowRight size={15} aria-hidden="true" />} onClick={() => { setMenu(false); onMove(1); }}>Move right</MenuItem>}
                  <MenuSeparator />
                  <MenuItem danger icon={<Trash2 size={15} aria-hidden="true" />} onClick={() => { setMenu(false); onDelete(); }}>Delete</MenuItem>
                </Menu>
              </div>
            </>
          )}
        </span>
      }
    >
      <div className="rounded-md border border-hairline px-2.5 py-2">
        <span className="block text-[13px] font-medium leading-tight">What it&apos;s about</span>
        <div className="text-[11.5px] text-ink-muted leading-snug mt-1">
          <EditableText value={p.description ?? ""} multiline label="Pillar description" placeholder="Add a description" onCommit={(description) => onEdit({ description })} />
        </div>
      </div>
      <Section href={`${base}/plan/ideas`} icon={<Lightbulb size={11} className="text-ink-faint shrink-0" aria-hidden="true" />} title={`Ideas · ${p.ideaCount}`} note={p.ideaCount ? "Waiting in the idea inbox" : "None captured yet"} />
      <Section href={`${base}/plan/calendar`} icon={<CalendarDays size={11} className="text-ink-faint shrink-0" aria-hidden="true" />} title={`Calendar · ${p.calendarCount}`} note={p.calendarCount ? "Slots planned" : "Nothing planned yet"} />
      <div className="flex flex-col gap-1.5 pt-0.5">
        <button type="button" onClick={(e) => { e.stopPropagation(); onDraft(); }} className="inline-flex items-center justify-center gap-1.5 min-h-10 rounded-full border border-dashed border-line text-xs text-ink-muted hover:border-line-strong hover:text-ink"><Sparkles size={13} aria-hidden="true" /> Draft content</button>
        <Link href={`${base}/brand/pillars/${p.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center justify-center gap-1.5 min-h-10 rounded-full border border-line text-xs font-medium hover:border-line-strong"><Network size={13} aria-hidden="true" /> See how it connects</Link>
      </div>
    </Node>
  );
}
