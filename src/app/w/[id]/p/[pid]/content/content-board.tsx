"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { Plus, X, Flag, Trash2, History, Wand2, PenLine, Pencil, AlertTriangle, Globe, ThumbsUp, MessageCircle, Repeat2, Send } from "lucide-react";
import { Canvas, Artboard, type Device } from "@/components/canvas";
import { CanvasHistory, EditableText, useCanvasHistory, useDeleteKey } from "@/components/canvas-edit";
import { DraftModal } from "@/components/draft-modal";
import { ConfirmModal } from "@/components/confirm-modal";
import { AgentDots, Badge, EmptyState, Avatar, IconButton, Segmented, useToast } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { STEERS, findViolations, formatByKey } from "@/lib/content/formats";
import type { ContentItemView } from "@/lib/data/content";
import { askRewriteAction, deleteContentAction, saveContentAction, steerAction, applyVariantAction, patchContentAction } from "./actions";

const WIDTH: Record<Device, number> = { desktop: 520, tablet: 440, mobile: 360 };
const STATUS_TONE = { draft: "neutral", edited: "dark", approved: "ok" } as const;

type BoardProps = {
  tenantId: string; projectId: string; brandName: string; items: ContentItemView[]; pillars: { id: string; name: string }[];
  selectedId: string | null; degraded: boolean; dontWords: string[];
};
type Patch = { hook?: string; body?: string; cta?: string; pillarId?: string | null };

/**
 * Content wireframes. The canvas is editable: double-click the hook, body or
 * call to action on a post to edit it in place, drag a post by its label to
 * another pillar, Delete removes the selected post, Cmd/Ctrl+Z undoes.
 */
export function ContentBoard(props: BoardProps) {
  return (
    <CanvasHistory>
      <Board {...props} />
    </CanvasHistory>
  );
}

function Board({ tenantId, projectId, brandName, items: serverItems, pillars, selectedId, degraded, dontWords }: BoardProps) {
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

  const select = useCallback(
    (id: string | null) => router.replace(id ? `${pathname}?item=${id}` : pathname, { scroll: false }),
    [router, pathname],
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
    history.push({ label, undo: () => patchContentAction(tenantId, projectId, item.id, prev, opts), redo: () => patchContentAction(tenantId, projectId, item.id, next, opts) });
    return patchContentAction(tenantId, projectId, item.id, next, opts);
  }, [history, tenantId, projectId]);

  /** Select and instruct: the model's version of one part, committed by the canvas like an edit. */
  const askFor = useCallback((item: ContentItemView, part: string) => async (instruction: string, current: string) => {
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
      () => { toast("Deleted"); select(null); router.refresh(); },
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
        <Canvas device={device} onDevice={setDevice} onBackground={() => { if (selected) select(null); }}>
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
                          {i.violations.length > 0 && <Badge tone="accent"><Flag size={10} /> {i.violations.length}</Badge>}
                          <Badge tone={STATUS_TONE[i.status as keyof typeof STATUS_TONE] ?? "neutral"}>{i.status}</Badge>
                        </>
                      }
                    >
                      <PostPreview item={i} brandName={brandName} dontWords={dontWords} onPatch={(next, label, asked) => patch(i, next, label, asked)} onAsk={(part) => askFor(i, part)} />
                    </Artboard>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </Canvas>
      )}

      {/* Top-left canvas controls */}
      {items.length > 0 && (
        <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
          <button onClick={() => setDrafting(true)} className={`${btnClass("primary", "sm")} shadow-[var(--shadow)]`}><Plus size={14} /> Draft</button>
          <select value={pillarFilter} onChange={(e) => setPillarFilter(e.target.value)} aria-label="Pillar" className="shadow-[var(--shadow-sm)]">
            <option value="all">All pillars</option>
            {pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="none">No pillar</option>
          </select>
          {degraded && <span className="flex items-center gap-1.5 h-8 px-2.5 rounded-sm bg-accent-soft text-accent-ink text-xs"><AlertTriangle size={13} /> Thin brief: drafts will read generic</span>}
        </div>
      )}

      {selected && <Inspector key={`${selected.id}:${selected.history.length}:${selected.hook}:${selected.body.length}:${selected.cta}`} tenantId={tenantId} projectId={projectId} item={selected} pillars={pillars} dontWords={dontWords} onClose={() => select(null)} onDelete={() => remove(selected)} />}
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

/** Channel-shaped wireframe of the post: real copy, greyscale chrome. Copy is editable in place. */
function PostPreview({ item, brandName, dontWords, onPatch, onAsk }: {
  item: ContentItemView; brandName: string; dontWords: string[];
  onPatch: (p: Patch, label: string, asked?: boolean) => Promise<unknown>;
  onAsk: (part: string) => (instruction: string, current: string) => Promise<string>;
}) {
  return (
    <div className="p-5">
      <div className="flex items-start gap-2.5">
        <Avatar seed={brandName} label={brandName} size="md" className="!w-10 !h-10" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.85rem] font-semibold">{brandName}</p>
          <div className="wf-bar h-2 w-32 mt-1.5" />
          <p className="text-[0.68rem] text-ink-faint flex items-center gap-1 mt-1">now · <Globe size={10} /></p>
        </div>
      </div>
      <div className="mt-3.5 text-[0.95rem] font-semibold leading-snug">
        <EditableText value={item.hook} required label="Hook" display={<Marked text={item.hook} words={dontWords} />} onAsk={onAsk("Hook")} onCommit={(hook, _p, m) => onPatch({ hook }, m?.asked ? "rewrite hook" : "edit hook", m?.asked)} />
      </div>
      <div className="mt-2 text-[0.85rem] leading-relaxed text-ink/85">
        <EditableText value={item.body} multiline label="Body" placeholder="Add body copy" display={<Marked text={item.body} words={dontWords} />} onAsk={onAsk("Body")} onCommit={(body, _p, m) => onPatch({ body }, m?.asked ? "rewrite body" : "edit body", m?.asked)} />
      </div>
      <div className="mt-3 text-[0.85rem] font-medium flex gap-1">
        <span className="shrink-0">→</span>
        <div className="flex-1 min-w-0">
          <EditableText value={item.cta} label="Call to action" placeholder="Add a call to action" display={<Marked text={item.cta} words={dontWords} />} onAsk={onAsk("Call to action")} onCommit={(cta, _p, m) => onPatch({ cta }, m?.asked ? "rewrite call to action" : "edit call to action", m?.asked)} />
        </div>
      </div>
      <div className="grid grid-cols-4 mt-4 pt-2 border-t border-hairline text-ink-faint">
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

function Inspector({ tenantId, projectId, item, pillars, dontWords, onClose, onDelete }: {
  tenantId: string; projectId: string; item: ContentItemView; pillars: { id: string; name: string }[]; dontWords: string[]; onClose: () => void; onDelete: () => void;
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
  const dirty = hook !== item.hook || body !== item.body || cta !== item.cta || (pillarId || null) !== item.pillarId;

  const run = (label: string, fn: () => Promise<void>, done: string) =>
    start(async () => {
      setBusy(label);
      try { await fn(); toast(done); router.refresh(); } catch { toast("That failed and was logged. Try again.", "danger"); }
      setBusy(null);
    });

  const save = (status: "edited" | "approved") =>
    start(async () => {
      setBusy(status);
      try {
        const learned = await saveContentAction(tenantId, projectId, item.id, { hook, body, cta, pillarId: pillarId || null, status });
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
    <aside className="absolute top-0 right-0 bottom-0 min-[900px]:top-1 min-[900px]:right-3 min-[900px]:bottom-3 min-[900px]:rounded-2xl min-[900px]:border overflow-hidden z-30 w-[min(360px,100%)] bg-paper border-l border-hairline shadow-[var(--shadow-lg)] flex flex-col fade-in">
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
          {liveViolations.length > 0 && (
            <div className="bg-accent-soft rounded-md px-3 py-2.5 text-sm">
              <p className="font-medium text-accent-ink flex items-center gap-1.5"><Flag size={13} /> Don&apos;t-words found</p>
              <p className="text-ink-muted mt-0.5">{liveViolations.join(", ")}. Flagged, not removed: your call.</p>
            </div>
          )}
          <label className="block"><span className="hu-label !flex mb-2">Hook</span><textarea value={hook} onChange={(e) => setHook(e.target.value)} rows={2} className="field" /></label>
          <label className="block"><span className="hu-label !flex mb-2">Body</span><textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} className="field" /></label>
          <label className="block"><span className="hu-label !flex mb-2">Call to action</span><input value={cta} onChange={(e) => setCta(e.target.value)} className="field" placeholder="Missing: add one" /></label>
          <label className="block">
            <span className="hu-label !flex mb-2">Pillar</span>
            <select value={pillarId} onChange={(e) => setPillarId(e.target.value)} className="field">
              <option value="">No pillar</option>
              {pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
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
              onSubmit={(e) => { e.preventDefault(); const ask = askText.trim(); if (!ask || pending) return; run("ask", () => steerAction(tenantId, projectId, item.id, ask), "New version added to history"); setAskText(""); }}
            >
              <input type="text" value={askText} onChange={(e) => setAskText(e.target.value)} placeholder="Ask for a change: shorter, add a story, end on a question" aria-label="Ask for a change" />
              <button type="submit" disabled={!askText.trim() || pending} className={`${btnClass("secondary", "sm")} shrink-0`}>{busy === "ask" ? <AgentDots /> : "Ask"}</button>
            </form>
            <p className="text-xs text-ink-faint mt-1.5">The previous version stays in History.</p>
          </div>
          <p className="text-xs text-ink-faint" suppressHydrationWarning>Template v{item.promptVersion ?? "–"} · {new Date(item.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5">
          {item.history.slice().reverse().map((g) => (
            <div key={g.id} className="border border-hairline rounded-md p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <History size={12} className="text-ink-faint" />
                <span className="text-xs text-ink-muted flex-1">
                  {/* A version with no model is one you typed, not one we wrote. */}
                  {g.model
                    ? <>{g.steer ? `Steer: ${g.steer}` : `Variant ${g.variantIndex + 1}`} · {g.model}</>
                    : <><Pencil size={11} className="inline mb-0.5 mr-1" aria-hidden="true" />{g.steer || "Edited by you"}</>}
                </span>
                <button disabled={pending} onClick={() => run("v" + g.id, () => applyVariantAction(tenantId, projectId, item.id, g.id), "Variant applied")} className="text-xs font-medium hover:text-accent-ink">Use</button>
              </div>
              <p className="text-sm font-medium">{g.hook}</p>
              <p className="text-xs text-ink-muted line-clamp-3 whitespace-pre-wrap mt-0.5">{g.body}</p>
            </div>
          ))}
        </div>
      )}

      <div className="shrink-0 border-t border-hairline p-3 flex items-center gap-2">
        <button onClick={onDelete} disabled={pending} className={btnClass("danger", "sm")} aria-label="Delete piece" title="Delete piece"><Trash2 size={14} /></button>
        <span className="flex-1" />
        <button disabled={pending || !dirty} onClick={() => save("edited")} className={btnClass("secondary", "sm")}>{busy === "edited" ? <AgentDots /> : "Save"}</button>
        <button disabled={pending} onClick={() => save("approved")} className={btnClass("primary", "sm")}>{busy === "approved" ? <AgentDots /> : item.status === "approved" && !dirty ? "Approved" : "Approve"}</button>
      </div>
    </aside>
  );
}
