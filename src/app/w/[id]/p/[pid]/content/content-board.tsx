"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Plus, X, Flag, Trash2, History, Wand2, PenLine, Pencil, Globe, ThumbsUp, MessageCircle, Repeat2, Send, Copy, Check, Heart, Bookmark, Ellipsis, Image as ImageIcon, ChartNoAxesColumn, Share, type LucideIcon } from "lucide-react";
import { Canvas, Artboard, type Device } from "@/components/canvas";
import { EditPanel } from "@/components/project-panels";
import { EditableText, useCanvasHistory, useDeleteKey } from "@/components/canvas-edit";
import { DraftModal } from "@/components/draft-modal";
import { ConfirmModal } from "@/components/confirm-modal";
import { AgentDots, Badge, EmptyState, Avatar, IconButton, Segmented, useToast } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { STEERS, findPlaceholders, findViolations, formatByKey, formatUsesCarousel, pieceText } from "@/lib/content/formats";
import { slidesOf } from "@/lib/visual/slides";
import { previewFrameOf } from "./preview-frame";
import { currentVersionId, typedByPerson, versionLabel } from "@/lib/content/history";
import type { ContentItemView } from "@/lib/data/content";
import { askRewriteAction, deleteContentAction, saveContentAction, steerAction, applyVariantAction, patchContentAction } from "./actions";
import { Select } from "@/components/select";
import { guardedLeave, hasUnsavedChanges, unsavedKey, useUnsavedChanges } from "@/components/unsaved-guard";

const WIDTH: Record<Device, number> = { desktop: 520, tablet: 440, mobile: 360 };
const STATUS_TONE = { draft: "neutral", edited: "dark", approved: "ok" } as const;

type BoardProps = {
  tenantId: string; projectId: string; brandName: string; items: ContentItemView[]; pillars: { id: string; name: string }[];
  selectedId: string | null; degraded: boolean; dontWords: string[];
  /** Show which prompt template wrote a piece: for admins, who edit templates. */
  showTemplate?: boolean;
};
type Patch = { hook?: string; body?: string; cta?: string; pillarId?: string | null };
/** The words of a patch, for the stale check (a pillar move has none). */
const textOnly = (p: Patch) => ({ hook: p.hook, body: p.body, cta: p.cta });

/**
 * Content wireframes. The canvas is editable: double-click the hook, body or
 * call to action on a post to edit it in place, drag a post by its label to
 * another pillar, Delete removes the selected post, Cmd/Ctrl+Z undoes.
 * The undo history is the Content step's (the page provides it), so a fix
 * applied from the Brand check panel undoes the same way.
 */
export function ContentBoard(props: BoardProps) {
  return <Board {...props} />;
}

function Board({ tenantId, projectId, brandName, items: serverItems, pillars, selectedId, degraded, dontWords, showTemplate = false }: BoardProps) {
  const router = useRouter();
  const toast = useToast();
  const history = useCanvasHistory();
  const pathname = usePathname();
  const [device, setDevice] = useState<Device>("desktop");
  const [drafting, setDrafting] = useState(false);
  const [pillarFilter, setPillarFilter] = useState<string>("all");

  // Optimistic pillar moves: shown until the server's pillar for that piece changes.
  const [moves, setMoves] = useState<Record<string, { from: string | null; to: string | null }>>({});
  const items = useMemo(() => serverItems.map((i) => {
    const m = moves[i.id];
    if (!m || (i.pillarId ?? null) !== m.from) return i;
    return { ...i, pillarId: m.to, pillarName: pillars.find((p) => p.id === m.to)?.name ?? null };
  }), [serverItems, moves, pillars]);
  const selected = items.find((i) => i.id === selectedId) ?? null;
  // The piece last opened here stays the one "Ask Huemen" changes when the
  // editor is closed by a click on the canvas (agent-panel reads this key).
  useEffect(() => {
    if (!selectedId) return;
    try { sessionStorage.setItem(`huemen:open-piece:${projectId}`, selectedId); } catch { /* private window: the URL still says it */ }
  }, [selectedId, projectId]);

  // Moving to another piece (or closing the editor) asks first when the open
  // one has unsaved edits.
  const select = useCallback(
    (id: string | null) => {
      if (id === selectedId) return;
      guardedLeave(() => router.replace(id ? `${pathname}?item=${id}` : pathname, { scroll: false }));
    },
    [router, pathname, selectedId],
  );

  // Every pillar is a column (empty ones are drop targets), then "No pillar".
  const groups = useMemo(() => {
    const cols: { key: string; pillarId: string | null; name: string }[] = [
      ...pillars.map((p) => ({ key: p.id, pillarId: p.id as string | null, name: p.name })),
      { key: "none", pillarId: null, name: "No pillar" },
    ];
    return cols
      .filter((c) => pillarFilter === "all" || pillarFilter === c.key)
      .map((c) => ({ ...c, items: items.filter((i) => (i.pillarId ?? null) === c.pillarId) }))
      .filter((c) => c.items.length > 0 || c.pillarId !== null || pillarFilter === c.key);
  }, [items, pillars, pillarFilter]);

  const patch = useCallback((item: ContentItemView, next: Patch, label: string, asked = false) => {
    const prev = Object.fromEntries(Object.keys(next).map((k) => [k, item[k as keyof Patch]])) as Patch;
    // A rewrite the person asked for is the model's words, so it is not learned from.
    const opts = { learn: !asked };
    const send = async (p: Patch, base: Patch, rewrite?: string) => {
      const r = await patchContentAction(tenantId, projectId, item.id, p, { ...opts, base: textOnly(base), rewrite });
      if (r && "conflict" in r) throw new Error(r.conflict);
    };
    history.push({ label, undo: () => send(prev, next), redo: () => send(next, prev) });
    // The first commit of an asked rewrite says what was asked, so History
    // lists it as "Rewrite: ..." and not as something they typed.
    const what = asked ? `${lastAsk.current[item.id] ?? "as asked"} (${label.replace(/^rewrite /, "")})` : undefined;
    return send(next, prev, what);
  }, [history, tenantId, projectId]);

  /** What was last asked of each piece, for the History label of the rewrite that follows. */
  const lastAsk = useRef<Record<string, string>>({});

  /** Select and instruct: the model's version of one part, committed by the canvas like an edit. */
  const askFor = useCallback((item: ContentItemView, part: string) => async (instruction: string, current: string) => {
    lastAsk.current[item.id] = instruction;
    const r = await askRewriteAction(tenantId, projectId, item.id, { part, text: current, instruction });
    if (!r.ok) throw new Error(r.error);
    return r.text;
  }, [tenantId, projectId]);

  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const moveTo = (itemId: string, pillarId: string | null) => {
    const item = items.find((i) => i.id === itemId);
    if (!item || (item.pillarId ?? null) === pillarId) return;
    const before = item.pillarId ?? null;
    const serverNow = serverItems.find((i) => i.id === itemId)?.pillarId ?? null;
    setMoves((m) => ({ ...m, [itemId]: { from: serverNow, to: pillarId } }));
    const name = pillarId ? pillars.find((p) => p.id === pillarId)?.name : "No pillar";
    patchContentAction(tenantId, projectId, itemId, { pillarId }).then(
      () => toast(`Moved to ${name}`),
      () => { setMoves((m) => { const n = { ...m }; delete n[itemId]; return n; }); toast("Couldn't move that piece.", "danger"); },
    );
    history.push({
      label: "move piece",
      undo: () => patchContentAction(tenantId, projectId, itemId, { pillarId: before }),
      redo: () => patchContentAction(tenantId, projectId, itemId, { pillarId }),
    });
  };

  // Delete asks first, in the app's own dialog (never the browser's confirm()).
  const [toDelete, setToDelete] = useState<ContentItemView | null>(null);
  const remove = useCallback((item: ContentItemView) => setToDelete(item), []);
  const confirmDelete = () => {
    const item = toDelete;
    if (!item) return;
    setToDelete(null);
    deleteContentAction(tenantId, projectId, item.id).then(
      // Gone, so there is nothing left to save: no "leave without saving?".
      () => { toast("Deleted"); router.replace(pathname, { scroll: false }); router.refresh(); },
      () => toast("Couldn't delete that piece.", "danger"),
    );
  };
  useDeleteKey(selected ? () => remove(selected) : null);

  return (
    <>
      {items.length === 0 ? (
        <div className="absolute inset-0 canvas-dots flex items-center justify-center p-6">
          <div className="bg-paper border border-hairline rounded-md max-w-md w-full shadow-[var(--shadow)]">
            <EmptyState
              icon={<PenLine size={18} />}
              title="Nothing drafted yet"
              sub={degraded ? "You can draft now, but the brief is thin so it will read generic. Filling the brief first is worth it." : "Pick a format and an optional topic. Voice, story and guardrails come from the brief."}
              action={<button onClick={() => setDrafting(true)} className={btnClass("primary")}><Plus size={15} /> Draft content</button>}
            />
          </div>
        </div>
      ) : (
        <Canvas device={device} onDevice={setDevice} onBackground={() => { if (selected && !hasUnsavedChanges()) select(null); }}>
          <div className="flex gap-14 items-start p-4" data-canvas-bg="1">
            {groups.map((g) => (
              <section
                key={g.key}
                data-canvas-bg="1"
                onDragOver={(e) => { if (dragId) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (over !== g.key) setOver(g.key); } }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === g.key ? null : o)); }}
                onDrop={(e) => { e.preventDefault(); if (dragId) moveTo(dragId, g.pillarId); setDragId(null); setOver(null); }}
                className={`rounded-md -m-3 p-3 transition-colors ${dragId && over === g.key ? "bg-accent-soft ring-2 ring-ink/60" : ""}`}
              >
                <p className="label-mono text-ink-faint mb-4 truncate" style={{ maxWidth: WIDTH[device] }}>{g.name} · {g.items.length}</p>
                <div className="flex flex-col gap-10 items-start" data-canvas-bg="1">
                  {g.items.length === 0 && (
                    <div data-canvas-bg="1" className="rounded-sm border-2 border-dashed border-line text-ink-faint text-sm flex items-center justify-center text-center px-6" style={{ width: WIDTH[device], height: 160 }}>
                      {dragId ? "Drop here to move it to this pillar" : "No pieces yet. Drag one here."}
                    </div>
                  )}
                  {g.items.map((i) => (
                    <Artboard
                      key={i.id}
                      label={formatByKey(i.format).label}
                      meta={i.topic ?? undefined}
                      width={WIDTH[device]}
                      selected={selected?.id === i.id}
                      onSelect={() => select(i.id)}
                      onEdit={() => select(i.id)}
                      dimmed={dragId === i.id}
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", i.hook); setDragId(i.id); }}
                      onDragEnd={() => { setDragId(null); setOver(null); }}
                      actions={
                        <>
                          {i.placeholders.length > 0 && <Badge tone="accent"><Flag size={10} /> Placeholder</Badge>}
                          {i.violations.length > 0 && <Badge tone="accent"><Flag size={10} /> {i.violations.length}</Badge>}
                          <Badge tone={STATUS_TONE[i.status as keyof typeof STATUS_TONE] ?? "neutral"}>{i.status}</Badge>
                        </>
                      }
                    >
                      {/* A placeholder still in the copy is marked where it stands, like a don't-word. */}
                      <PostPreview item={i} brandName={brandName} dontWords={i.placeholders.length ? [...dontWords, ...i.placeholders] : dontWords} onPatch={(next, label, asked) => patch(i, next, label, asked)} onAsk={(part) => askFor(i, part)} />
                    </Artboard>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </Canvas>
      )}

      {/* The canvas's own controls: one strip, top left of the visible canvas.
          (The thin-brief note lives in the Details panel, not on the canvas.) */}
      {items.length > 0 && (
        <div className="hu-strip absolute top-3 left-3 z-20" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => setDrafting(true)} className="hu-strip__btn hu-strip__btn--primary"><Plus size={14} aria-hidden="true" /> Draft</button>
          <span className="hu-strip__sep" aria-hidden="true" />
          <Select
            value={pillarFilter}
            onChange={setPillarFilter}
            label="Pillar"
            variant="pill"
            options={[{ value: "all", label: "All pillars" }, ...pillars.map((p) => ({ value: p.id, label: p.name })), { value: "none", label: "No pillar" }]}
          />
        </div>
      )}

      {selected && <Inspector key={`${selected.id}:${selected.history.length}:${selected.hook}:${selected.body.length}:${selected.cta}`} tenantId={tenantId} projectId={projectId} item={selected} pillars={pillars} dontWords={dontWords} showTemplate={showTemplate} onClose={() => select(null)} onDelete={() => remove(selected)} />}
      {drafting && <DraftModal open onClose={() => setDrafting(false)} tenantId={tenantId} projectId={projectId} pillars={pillars} />}
      <ConfirmModal
        open={toDelete !== null}
        title="Delete this piece?"
        confirmLabel="Delete piece"
        danger
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
      >
        {toDelete?.hook ? <>“{toDelete.hook.slice(0, 80)}{toDelete.hook.length > 80 ? "…" : ""}” and its {toDelete.history.length} saved version{toDelete.history.length === 1 ? "" : "s"} go with it. </> : null}
        This can&apos;t be undone.
      </ConfirmModal>
    </>
  );
}

/**
 * Channel-shaped wireframe of the post: real copy, greyscale chrome. Copy is
 * editable in place. Each platform gets its own frame (./preview-frame): an
 * Instagram carousel is a 4:5 slide with dots, not a LinkedIn post.
 */
function PostPreview({ item, brandName, dontWords, onPatch, onAsk }: {
  item: ContentItemView; brandName: string; dontWords: string[];
  onPatch: (p: Patch, label: string, asked?: boolean) => Promise<unknown>;
  onAsk: (part: string) => (instruction: string, current: string) => Promise<string>;
}) {
  const frame = previewFrameOf(item.format);
  const handle = brandName.toLowerCase().replace(/[^a-z0-9._]+/g, "") || "you";
  const hookEl = <EditableText value={item.hook} required label="Hook" display={<Marked text={item.hook} words={dontWords} />} onAsk={onAsk("Hook")} onCommit={(hook, _p, m) => onPatch({ hook }, m?.asked ? "rewrite hook" : "edit hook", m?.asked)} />;
  const bodyEl = <EditableText value={item.body} multiline label="Body" placeholder="Add body copy" display={<Marked text={item.body} words={dontWords} />} onAsk={onAsk("Body")} onCommit={(body, _p, m) => onPatch({ body }, m?.asked ? "rewrite body" : "edit body", m?.asked)} />;
  const ctaEl = <EditableText value={item.cta} label="Call to action" placeholder="Add a call to action" display={<Marked text={item.cta} words={dontWords} />} onAsk={onAsk("Call to action")} onCommit={(cta, _p, m) => onPatch({ cta }, m?.asked ? "rewrite call to action" : "edit call to action", m?.asked)} />;
  // Platform chrome is drawing, not controls: hidden from screen readers.
  const chrome = (icons: LucideIcon[], className: string) => (
    <div className={className} aria-hidden="true">{icons.map((I, k) => <I key={k} size={15} />)}</div>
  );

  if (frame === "instagram") {
    const carousel = formatUsesCarousel(item.format);
    const slides = carousel ? Math.min(slidesOf(item).length, 10) : 0;
    return (
      <div className="py-3">
        <div className="flex items-center gap-2.5 px-3.5">
          <Avatar seed={brandName} label={brandName} size="sm" />
          <p className="text-[0.8rem] font-semibold flex-1 truncate">{handle}</p>
          <Ellipsis size={16} className="text-ink-faint" aria-hidden="true" />
        </div>
        {carousel ? (
          // The first slide is the hook, as it opens in the feed.
          <div className="mt-2.5 relative aspect-[4/5] bg-muted-surface flex items-center justify-center px-8 text-center">
            <span className="absolute top-2.5 right-2.5 rounded-full bg-paper text-ink-muted text-[0.65rem] px-2 py-0.5">1/{slides}</span>
            <div className="w-full text-[1.15rem] font-semibold leading-snug">{hookEl}</div>
          </div>
        ) : (
          <div className="mt-2.5 aspect-[4/5] bg-muted-surface flex items-center justify-center" aria-hidden="true"><ImageIcon size={22} className="text-ink-faint" /></div>
        )}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-3.5 pt-2.5 text-ink-muted">
          {chrome([Heart, MessageCircle, Send], "flex items-center gap-3.5")}
          {carousel ? (
            <div className="flex items-center gap-1" role="img" aria-label={`${slides} slides`}>
              {Array.from({ length: slides }, (_, k) => <span key={k} className={`w-1.5 h-1.5 rounded-full ${k === 0 ? "bg-ink" : "bg-line-strong"}`} />)}
            </div>
          ) : <span />}
          {chrome([Bookmark], "flex justify-end")}
        </div>
        <div className="px-3.5 mt-2 text-[0.82rem] leading-relaxed">
          <p className="font-semibold">{handle}</p>
          {!carousel && <div className="font-semibold mt-0.5">{hookEl}</div>}
          <div className="mt-0.5 text-ink/85">{bodyEl}</div>
          <div className="mt-2 font-medium">{ctaEl}</div>
        </div>
      </div>
    );
  }

  if (frame === "x" || frame === "threads") {
    return (
      <div className="p-4 flex gap-3">
        <Avatar seed={brandName} label={brandName} size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.82rem] truncate">
            <span className="font-semibold">{frame === "x" ? brandName : handle}</span>
            <span className="text-ink-faint">{frame === "x" ? ` @${handle} · now` : " · now"}</span>
          </p>
          <div className="mt-1 text-[0.9rem] font-medium leading-snug">{hookEl}</div>
          <div className="mt-2 text-[0.85rem] leading-relaxed text-ink/85">{bodyEl}</div>
          <div className="mt-2 text-[0.85rem]">{ctaEl}</div>
          {frame === "x"
            ? chrome([MessageCircle, Repeat2, Heart, ChartNoAxesColumn, Share], "flex justify-between mt-3 pr-6 text-ink-faint")
            : chrome([Heart, MessageCircle, Repeat2, Send], "flex gap-4 mt-3 text-ink-faint")}
        </div>
      </div>
    );
  }

  if (frame === "message") {
    return (
      <div className="p-4 bg-muted-surface">
        <p className="label-mono text-ink-faint text-center mb-3">Today</p>
        <div className="ml-auto max-w-[88%] bg-paper border border-hairline rounded-lg px-3.5 py-2.5 text-[0.85rem] leading-relaxed">
          <div className="font-medium">{hookEl}</div>
          <div className="mt-1.5 text-ink/85">{bodyEl}</div>
          <div className="mt-1.5">{ctaEl}</div>
          <p className="text-[0.65rem] text-ink-faint text-right mt-1">now</p>
        </div>
      </div>
    );
  }

  if (frame === "email") {
    return (
      <div className="p-5">
        <div className="flex gap-2 pb-2 border-b border-hairline text-[0.75rem]">
          <span className="w-14 shrink-0 text-ink-faint">From</span><span className="truncate">{brandName}</span>
        </div>
        <div className="flex gap-2 py-2 border-b border-hairline items-baseline">
          <span className="w-14 shrink-0 text-[0.75rem] text-ink-faint">Subject</span>
          <div className="flex-1 min-w-0 text-[0.9rem] font-semibold">{hookEl}</div>
        </div>
        <div className="mt-3 text-[0.85rem] leading-relaxed text-ink/85">{bodyEl}</div>
        <div className="mt-3 text-[0.85rem] font-medium">{ctaEl}</div>
      </div>
    );
  }

  if (frame === "neutral") {
    return (
      <div className="p-5">
        <div className="text-[0.95rem] font-semibold leading-snug">{hookEl}</div>
        <div className="mt-2 text-[0.85rem] leading-relaxed text-ink/85">{bodyEl}</div>
        <div className="mt-3 text-[0.85rem] font-medium">{ctaEl}</div>
      </div>
    );
  }

  return (
    <div className="p-5">
      <div className="flex items-start gap-2.5">
        <Avatar seed={brandName} label={brandName} size="md" className="!w-10 !h-10" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.85rem] font-semibold">{brandName}</p>
          <div className="wf-bar h-2 w-32 mt-1.5" />
          <p className="text-[0.68rem] text-ink-faint flex items-center gap-1 mt-1">now · <Globe size={10} aria-hidden="true" /></p>
        </div>
      </div>
      <div className="mt-3.5 text-[0.95rem] font-semibold leading-snug">{hookEl}</div>
      <div className="mt-2 text-[0.85rem] leading-relaxed text-ink/85">{bodyEl}</div>
      <div className="mt-3 text-[0.85rem] font-medium flex gap-1">
        <span className="shrink-0" aria-hidden="true">→</span>
        <div className="flex-1 min-w-0">{ctaEl}</div>
      </div>
      <div className="grid grid-cols-4 mt-4 pt-2 border-t border-hairline text-ink-faint" aria-hidden="true">
        {[ThumbsUp, MessageCircle, Repeat2, Send].map((I, k) => <span key={k} className="flex justify-center py-1"><I size={14} /></span>)}
      </div>
    </div>
  );
}

/** Highlights don't-words in place — flagged, never rewritten (brief §4.2). */
function Marked({ text, words }: { text: string; words: string[] }) {
  const ws = words.map((w) => w.trim()).filter(Boolean);
  if (!ws.length || !text) return <>{text}</>;
  const re = new RegExp(`(${ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return <>{text.split(re).map((part, i) => (ws.some((w) => w.toLowerCase() === part.toLowerCase()) ? <mark key={i} className="bg-accent-soft text-accent-ink rounded-xs px-0.5">{part}</mark> : <span key={i}>{part}</span>))}</>;
}

function Inspector({ tenantId, projectId, item, pillars, dontWords, showTemplate, onClose, onDelete }: {
  tenantId: string; projectId: string; item: ContentItemView; pillars: { id: string; name: string }[]; dontWords: string[]; showTemplate: boolean; onClose: () => void; onDelete: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [hook, setHook] = useState(item.hook);
  const [askText, setAskText] = useState("");
  const [body, setBody] = useState(item.body);
  const [cta, setCta] = useState(item.cta);
  const [pillarId, setPillarId] = useState(item.pillarId ?? "");
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"edit" | "history">("edit");

  const liveViolations = findViolations(`${hook}\n${body}\n${cta}`, dontWords);
  // Found in code, as you type: a placeholder must never be approved by accident.
  const livePlaceholders = findPlaceholders(`${hook}\n${body}\n${cta}`);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(pieceText({ hook, body, cta }));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { toast("Copying didn't work here. Select the text and copy it.", "danger"); }
  };
  const current = currentVersionId(item, item.history);
  const dirty = hook !== item.hook || body !== item.body || cta !== item.cta || (pillarId || null) !== item.pillarId;
  const { bar } = useUnsavedChanges<{ hook: string; body: string; cta: string; pillarId: string }>({
    dirty,
    storageKey: unsavedKey(tenantId, `piece:${item.id}`),
    value: { hook, body, cta, pillarId },
    onRestore: (v) => { setHook(v.hook); setBody(v.body); setCta(v.cta); setPillarId(v.pillarId); setTab("edit"); },
    isSaved: (v) => v.hook === item.hook && v.body === item.body && v.cta === item.cta && (v.pillarId || null) === item.pillarId,
  });

  // A failed generation stays retryable (P2-3): the toast holds Try again,
  // which repeats the same request; the draft and the ask are untouched.
  // `onOk` runs only when it worked (the Ask box clears then, never on a failure).
  const run = (label: string, fn: () => Promise<void | { error?: string }>, done: string, onOk?: () => void): void =>
    start(async () => {
      setBusy(label);
      const again = { label: "Try again", run: () => run(label, fn, done, onOk) };
      try {
        const r = await fn();
        if (r && r.error) toast(r.error, "danger", again);
        else { onOk?.(); toast(done); router.refresh(); }
      } catch { toast("That didn't go through and was logged.", "danger", again); }
      setBusy(null);
    });

  const save = (status: "edited" | "approved") =>
    start(async () => {
      setBusy(status);
      try {
        const out = await saveContentAction(tenantId, projectId, item.id, { hook, body, cta, pillarId: pillarId || null, status }, { hook: item.hook, body: item.body, cta: item.cta });
        if (out && "conflict" in out) {
          toast(out.conflict, "danger", { label: "Reload", run: () => router.refresh() });
          setBusy(null);
          return;
        }
        const learned = out;
        // Say what the voice took from it, so learning is never silent.
        toast(
          status !== "approved" ? "Saved"
          : learned?.learned ? `Approved. Your voice learned from it: ${learned.why.toLowerCase()}${learned.remeasured ? " It re-measured itself." : ""}`
          : "Approved",
        );
        router.refresh();
      } catch { toast("That failed and was logged. Try again.", "danger"); }
      setBusy(null);
    });

  return (
    // Opens IN the right slot, in place of the Details panel (components/project-panels).
    <EditPanel label={`Edit ${formatByKey(item.format).label}`} onClose={onClose}>
      <div className="min-h-14 shrink-0 flex items-center gap-2 pl-4 pr-2 border-b border-hairline">
        <span className="text-sm font-semibold flex-1 truncate">{formatByKey(item.format).label}</span>
        <Segmented
          label="Panel view"
          value={tab}
          onChange={setTab}
          items={[{ value: "edit", label: "Edit" }, { value: "history", label: `History · ${item.history.length}` }]}
        />
        <IconButton label="Close" onClick={onClose}><X size={17} /></IconButton>
      </div>

      {tab === "edit" ? (
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {bar}
          {liveViolations.length > 0 && (
            <div className="bg-accent-soft rounded-md px-3 py-2.5 text-sm">
              <p className="font-medium text-accent-ink flex items-center gap-1.5"><Flag size={13} /> Don&apos;t-words found</p>
              <p className="text-ink-muted mt-0.5">{liveViolations.join(", ")}. Flagged, not removed: your call.</p>
            </div>
          )}
          {livePlaceholders.length > 0 && (
            <div role="status" className="bg-accent-soft rounded-md px-3 py-2.5 text-sm">
              <p className="font-medium text-accent-ink flex items-center gap-1.5"><Flag size={13} /> A placeholder is still in the copy</p>
              <p className="text-ink-muted mt-0.5">{livePlaceholders.length === 1 ? "It stands" : `${livePlaceholders.length} of them stand`} where a fact was missing. Put the real one in, or rewrite the line without it, before this goes out.</p>
            </div>
          )}
          <label className="block"><span className="hu-label !flex mb-2">Hook</span><textarea aria-label="Hook" value={hook} onChange={(e) => setHook(e.target.value)} rows={2} className="field" /></label>
          <label className="block"><span className="hu-label !flex mb-2">Body</span><textarea aria-label="Body" value={body} onChange={(e) => setBody(e.target.value)} rows={9} className="field" /></label>
          <label className="block"><span className="hu-label !flex mb-2">Call to action</span><input aria-label="Call to action" value={cta} onChange={(e) => setCta(e.target.value)} className="field" placeholder="Missing: add one" /></label>
          <label className="block">
            <span className="hu-label !flex mb-2">Pillar</span>
            <Select value={pillarId} onChange={setPillarId} label="Pillar" options={[{ value: "", label: "No pillar" }, ...pillars.map((p) => ({ value: p.id, label: p.name }))]} />
          </label>
          <div>
            <p className="text-xs font-medium mb-1.5 flex items-center gap-1.5"><Wand2 size={12} /> Regenerate with a steer</p>
            <div className="flex flex-wrap gap-1.5">
              {STEERS.map((s) => (
                <button key={s} disabled={pending} onClick={() => run(s, () => steerAction(tenantId, projectId, item.id, s), "New version added to history")} className="min-h-11 px-3.5 rounded-full border border-line text-sm hover:border-line-strong hover:bg-hover disabled:opacity-50 flex items-center gap-1.5">
                  {busy === s && <AgentDots />} {s}
                </button>
              ))}
            </div>
            {/* Ask for a change in your own words: the same steer, without a preset. */}
            <form
              className="hu-composer !p-2 !pl-3.5 !flex-row !items-center mt-2"
              onSubmit={(e) => { e.preventDefault(); const ask = askText.trim(); if (!ask || pending) return; run("ask", () => steerAction(tenantId, projectId, item.id, ask), "New version added to history", () => setAskText((t) => (t.trim() === ask ? "" : t))); }}
            >
              <input type="text" value={askText} onChange={(e) => setAskText(e.target.value)} placeholder="Ask for a change: shorter, add a story, end on a question" aria-label="Ask for a change" className="max-sm:min-h-10" />
              <button type="submit" disabled={!askText.trim() || pending} className={`${btnClass("secondary", "sm")} shrink-0`}>{busy === "ask" ? <AgentDots /> : "Ask"}</button>
            </form>
            <p className="text-xs text-ink-faint mt-1.5">The previous version stays in History.</p>
          </div>
          {/* When the copy last changed, for everyone. Which template wrote it is for
              admins only; version 0 is the built-in template nobody has edited yet. */}
          <p className="text-xs text-ink-faint" suppressHydrationWarning>
            {showTemplate && item.promptVersion != null ? `${item.promptVersion > 0 ? `Template v${item.promptVersion}` : "Built-in template"} · ` : ""}
            Last changed {new Date(item.updatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5">
          {item.history.slice().reverse().map((g) => (
            <div key={g.id} className={`border rounded-md p-3 ${g.id === current ? "border-line-strong" : "border-hairline"}`}>
              <div className="flex items-center gap-2 mb-1.5">
                <History size={12} className="text-ink-faint" />
                <span className="text-xs text-ink-muted flex-1 min-w-0 truncate">
                  {/* Named by where it came from: a draft, a rewrite and what was asked, or words you typed. */}
                  {typedByPerson(g) && <Pencil size={11} className="inline mb-0.5 mr-1" aria-hidden="true" />}
                  {versionLabel(g, item.history)}
                </span>
                {g.id === current
                  ? <Badge tone="dark">Current</Badge>
                  : <button disabled={pending} onClick={() => run("v" + g.id, () => applyVariantAction(tenantId, projectId, item.id, g.id), "That version is on the piece now")} className="text-xs font-medium hover:text-accent-ink">Use</button>}
              </div>
              <p className="text-sm font-medium">{g.hook}</p>
              <p className="text-xs text-ink-muted line-clamp-3 whitespace-pre-wrap mt-0.5">{g.body}</p>
            </div>
          ))}
        </div>
      )}

      {/* Four actions in a 360px panel: the two on the left are icons, so Save
          and Approve are never pushed off the edge. */}
      <div className="shrink-0 border-t border-hairline p-3 flex items-center gap-2">
        <button onClick={onDelete} disabled={pending} className={`${btnClass("danger", "sm")} !px-4`} aria-label="Delete piece"><Trash2 size={14} /></button>
        {/* The post as plain text (hook, body, call to action), ready to paste. */}
        <button type="button" onClick={copyText} disabled={!hook.trim() && !body.trim()} className={`${btnClass("ghost", "sm")} !px-3.5`} aria-label={copied ? "Copied" : "Copy text"}>
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        </button>
        <span className="flex-1" />
        <button disabled={pending || !dirty} onClick={() => save("edited")} className={btnClass("secondary", "sm")}>{busy === "edited" ? <AgentDots /> : "Save"}</button>
        <button disabled={pending} onClick={() => (livePlaceholders.length ? setConfirmApprove(true) : save("approved"))} className={btnClass("primary", "sm")}>{busy === "approved" ? <AgentDots /> : item.status === "approved" && !dirty ? "Approved" : "Approve"}</button>
      </div>
      {/* Approving with a placeholder in the copy asks first, in the app's own dialog. */}
      <ConfirmModal
        open={confirmApprove}
        title="Approve with a placeholder in it?"
        confirmLabel="Approve anyway"
        cancelLabel="Go back and fix it"
        focusCancel
        onClose={() => setConfirmApprove(false)}
        onConfirm={() => { setConfirmApprove(false); save("approved"); }}
      >
        {livePlaceholders.length === 1 ? "A placeholder is" : `${livePlaceholders.length} placeholders are`} still in the copy, where a fact was missing. Approved pieces go to visuals and export as they are.
      </ConfirmModal>
    </EditPanel>
  );
}
