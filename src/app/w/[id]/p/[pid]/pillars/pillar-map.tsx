"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { FileText, Network, MoreHorizontal, Plus, Sparkles, Check, Circle, Lightbulb, CalendarDays, PenLine, Trash2, Pencil, GripVertical, ArrowLeft, ArrowRight } from "lucide-react";
import { Canvas } from "@/components/canvas";
import { CanvasHistory, EditableText, useCanvasHistory, useDeleteKey } from "@/components/canvas-edit";
import { DraftModal } from "@/components/draft-modal";
import { useToast } from "@/components/ui";
import { formatByKey } from "@/lib/content/formats";
import type { PillarView } from "@/lib/data/planning";
import { createPillarAction, deletePillarAction, reorderPillarsAction, updatePillarAction } from "./actions";

const CARD_W = 260;
const GAP = 28;

type Props = {
  tenantId: string; projectId: string; selectedId: string | null; brandName: string; completeness: number; briefRows: { label: string; ok: boolean }[]; pillars: PillarView[];
};

/**
 * Pillars sitemap (Relume's sitemap, as a pillar tree under the brief). The
 * canvas is editable: double-click a name or description to edit it in
 * place, drag the grip to reorder, Delete removes the selected pillar, ⌘Z
 * undoes.
 */
export function PillarMap(props: Props) {
  return (
    <CanvasHistory>
      <PillarTree {...props} />
    </CanvasHistory>
  );
}

function PillarTree({ tenantId, projectId, brandName, completeness, briefRows, pillars, selectedId }: Props) {
  const toast = useToast();
  const history = useCanvasHistory();
  const [draftFor, setDraftFor] = useState<string | null | undefined>(undefined);

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
  const [adding, setAdding] = useState(false);

  const base = `/w/${tenantId}/p/${projectId}`;
  const children = ordered.length + 1; // + "add pillar" card
  const rowWidth = children * CARD_W + (children - 1) * GAP;

  const reorder = (next: string[], label = "reorder pillars") => {
    const prev = ordered.map((p) => p.id);
    if (next.join() === prev.join()) return;
    setLocalOrder(next);
    const save = (ids: string[]) => { setLocalOrder(ids); return reorderPillarsAction(tenantId, projectId, ids); };
    save(next).catch(() => { setLocalOrder(null); toast("Couldn't save the new order."); });
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
    const save = (v: typeof before) => updatePillarAction(tenantId, projectId, p.id, v.name, v.description);
    history.push({ label: patch.name !== undefined ? "rename pillar" : "edit description", undo: () => save(before), redo: () => save(after) });
    return save(after);
  };

  const add = async () => {
    setAdding(true);
    try {
      const id = await createPillarAction(tenantId, projectId, "Untitled pillar", "");
      if (id) { setSel(id); setEditName(id); }
    } catch {
      toast("Couldn't add a pillar. Try again.");
    }
    setAdding(false);
  };

  const remove = useCallback(async (p: PillarView) => {
    if (!confirm(`Delete “${p.name}”? Its content stays, just without a pillar.`)) return;
    try {
      await deletePillarAction(tenantId, projectId, p.id);
      setSel(null);
      toast("Pillar deleted");
    } catch {
      toast("Couldn't delete that pillar.");
    }
  }, [tenantId, projectId, toast]);

  const selected = ordered.find((p) => p.id === sel) ?? null;
  useDeleteKey(selected && !editName ? () => remove(selected) : null);

  const dropAt = (e: React.DragEvent, index: number) => {
    if (!drag) return;
    const r = e.currentTarget.getBoundingClientRect();
    const to = e.clientX > r.left + r.width / 2 ? index + 1 : index;
    if (to !== drag.to) setDrag({ ...drag, to });
  };
  // One insertion bar: left of the card at the target index, or right of the last card.
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

  return (
    <>
      <Canvas onBackground={() => setSel(null)}>
        <div className="flex flex-col items-center p-10" data-canvas-bg="1" style={{ minWidth: rowWidth + 80 }}>
          {/* Root: the brief */}
          <div className="bg-paper rounded-[10px] ring-1 ring-[var(--hairline)] shadow-[var(--shadow-sm)]" style={{ width: 300 }}>
            <div className="flex items-center gap-2 h-10 px-3 border-b border-hairline">
              <FileText size={14} className="text-ink-muted" />
              <span className="text-[0.82rem] font-medium flex-1 truncate">{brandName} · Brief</span>
              <span className="text-[0.72rem] text-ink-faint tabular-nums">{completeness}%</span>
            </div>
            <div className="p-2 flex flex-col gap-1">
              {briefRows.map((r) => (
                <Link key={r.label} href={`${base}/brief/edit`} className="flex items-center gap-2 h-8 px-2.5 rounded-[7px] border border-hairline bg-paper text-[0.8rem] hover:border-line">
                  {r.ok ? <Check size={13} className="text-ok" /> : <Circle size={11} className="text-accent" />}
                  <span className={r.ok ? "" : "text-ink-muted"}>{r.label}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Connector */}
          <div className="w-px h-10 bg-line" />
          <div className="relative flex items-start" style={{ gap: GAP }} onDragOver={(e) => drag && e.preventDefault()} onDrop={(e) => { e.preventDefault(); finishDrop(); }}>
            {children > 1 && (
              <div className="absolute top-0 h-px bg-line" style={{ left: CARD_W / 2, right: CARD_W / 2 }} />
            )}
            {ordered.map((p, i) => (
              <div
                key={p.id}
                className="flex flex-col items-center relative"
                onDragOver={(e) => { if (drag) { e.preventDefault(); dropAt(e, i); } }}
              >
                {drag && dropMark(drag, i) && (
                  <span className="absolute top-8 bottom-0 w-[3px] rounded-full bg-ink z-10" style={{ [dropMark(drag, i)!]: -GAP / 2 - 1.5 }} />
                )}
                <div className="w-px h-8 bg-line" />
                <PillarCard
                  p={p}
                  base={base}
                  selected={sel === p.id}
                  dragging={drag?.id === p.id}
                  editingName={editName === p.id}
                  onEditingName={(on) => setEditName(on ? p.id : null)}
                  onSelect={() => setSel(p.id)}
                  onDraft={() => setDraftFor(p.id)}
                  onEdit={(patch) => edit(p, patch)}
                  onDelete={() => remove(p)}
                  onMove={(by) => move(p.id, by)}
                  canMove={{ left: i > 0, right: i < ordered.length - 1 }}
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.name); setSel(p.id); setDrag({ id: p.id, to: i }); }}
                  onDragEnd={() => setDrag(null)}
                />
              </div>
            ))}
            <div className="flex flex-col items-center">
              <div className="w-px h-8 bg-line" />
              <button onClick={add} disabled={adding} className="rounded-[10px] border-2 border-dashed border-line hover:border-ink text-ink-muted hover:text-ink flex flex-col items-center justify-center gap-1.5 transition-colors disabled:opacity-60" style={{ width: CARD_W, height: 180 }}>
                <Plus size={18} />
                <span className="text-[0.82rem] font-medium">{adding ? "Adding…" : "Add pillar"}</span>
                <span className="text-[0.72rem] text-ink-faint px-6 text-center">A theme this brand keeps coming back to</span>
              </button>
            </div>
          </div>
        </div>
      </Canvas>

      {draftFor !== undefined && (
        <DraftModal open onClose={() => setDraftFor(undefined)} tenantId={tenantId} projectId={projectId} pillars={pillars} defaultPillar={draftFor} />
      )}
    </>
  );
}

function PillarCard({ p, base, selected, dragging, editingName, onEditingName, onSelect, onDraft, onEdit, onDelete, onMove, canMove, onDragStart, onDragEnd }: {
  p: PillarView; base: string; selected: boolean; dragging: boolean;
  editingName: boolean; onEditingName: (on: boolean) => void;
  onSelect: () => void; onDraft: () => void; onEdit: (patch: { name?: string; description?: string }) => Promise<unknown>;
  onDelete: () => void; onMove: (by: number) => void; canMove: { left: boolean; right: boolean };
  onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const item = "w-full flex items-center gap-2 h-8 px-2 rounded-[6px] hover:bg-white/10 text-[0.8rem] disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div
      onClick={onSelect}
      className={`group bg-paper rounded-[10px] shadow-[var(--shadow-sm)] transition-[box-shadow,opacity] ${selected ? "ring-2 ring-accent" : "ring-1 ring-[var(--hairline)] hover:ring-[var(--line)]"} ${dragging ? "opacity-40" : ""}`}
      style={{ width: CARD_W }}
    >
      <div className="flex items-center gap-1.5 h-10 pl-1.5 pr-3 border-b border-hairline relative">
        <span
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          title="Drag to reorder"
          aria-hidden
          className="w-5 h-6 rounded-[5px] flex items-center justify-center text-ink-faint opacity-0 group-hover:opacity-100 hover:bg-field cursor-grab active:cursor-grabbing"
        >
          <GripVertical size={13} />
        </span>
        <Network size={14} className="text-ink-muted shrink-0" />
        <div className="text-[0.82rem] font-medium flex-1 min-w-0" title={p.name}>
          <EditableText value={p.name} required label="Pillar name" className="truncate" editing={editingName} onEditingChange={onEditingName} onCommit={(name) => onEdit({ name })} />
        </div>
        <button onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }} className="w-6 h-6 rounded-[6px] flex items-center justify-center text-ink-faint hover:bg-field shrink-0" aria-label="Pillar menu"><MoreHorizontal size={15} /></button>
        {menu && (
          <>
            <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setMenu(false); }} />
            <div className="absolute right-2 top-9 z-20 w-44 bg-menu text-menu-fg rounded-[9px] shadow-[var(--shadow-lg)] p-1 pop" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setMenu(false); onEditingName(true); }} className={item}><Pencil size={13} /> Rename</button>
              <button disabled={!canMove.left} onClick={() => { setMenu(false); onMove(-1); }} className={item}><ArrowLeft size={13} /> Move left</button>
              <button disabled={!canMove.right} onClick={() => { setMenu(false); onMove(1); }} className={item}><ArrowRight size={13} /> Move right</button>
              <div className="h-px bg-white/10 my-1" />
              <button onClick={() => { setMenu(false); onDelete(); }} className={item}><Trash2 size={13} /> Delete <span className="ml-auto text-menu-fg/50 text-[0.7rem]">Del</span></button>
            </div>
          </>
        )}
      </div>
      <div className="p-2 flex flex-col gap-1">
        <div className="text-[0.75rem] text-ink-muted px-1 pb-1 leading-snug">
          <EditableText value={p.description ?? ""} multiline label="Pillar description" placeholder="Add a description" onCommit={(description) => onEdit({ description })} />
        </div>
        {p.formats.length > 0 ? (
          p.formats.map((f) => (
            <Link key={f} href={`${base}/content`} className="flex items-center gap-2 h-8 px-2.5 rounded-[7px] border border-hairline text-[0.8rem] hover:border-line">
              <PenLine size={12} className="text-ink-faint" /> {formatByKey(f).label}
            </Link>
          ))
        ) : (
          <p className="text-[0.75rem] text-ink-faint px-2.5 py-1.5">No content yet</p>
        )}
        <div className="flex gap-1">
          <Link href={`${base}/ideas`} className="flex-1 flex items-center gap-1.5 h-8 px-2.5 rounded-[7px] bg-panel text-[0.75rem] text-ink-muted hover:text-ink"><Lightbulb size={12} /> {p.ideaCount} ideas</Link>
          <Link href={`${base}/calendar`} className="flex-1 flex items-center gap-1.5 h-8 px-2.5 rounded-[7px] bg-panel text-[0.75rem] text-ink-muted hover:text-ink"><CalendarDays size={12} /> {p.calendarCount} slots</Link>
        </div>
        <button onClick={onDraft} className="flex items-center justify-center gap-1.5 h-8 rounded-[7px] border border-dashed border-line text-[0.8rem] text-ink-muted hover:border-ink hover:text-ink"><Plus size={13} /> Draft content</button>
        <button onClick={onDraft} className="flex items-center justify-center gap-1.5 h-8 rounded-[7px] text-[0.8rem] text-ink-muted hover:bg-field"><Sparkles size={13} /> Ask AI</button>
      </div>
      <div className="px-3 h-8 border-t border-hairline flex items-center text-[0.72rem] text-ink-faint">{p.contentCount} piece{p.contentCount === 1 ? "" : "s"}</div>
    </div>
  );
}
