"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Type, Image as ImageIcon, Ruler, ChevronDown, Palette, AlertTriangle, SlidersHorizontal, X, Download, Trash2, LayoutGrid, Check, RotateCcw, Copy, MessageSquare, History, Sparkles, PenLine, Eraser, ImageMinus, Crop } from "lucide-react";
import { AgentDots, Badge, Choice, Modal, Segmented, Shortcut, SubmitButton, Tabs, useToast } from "@/components/ui";
import { RightDock, usePanels } from "@/components/project-panels";
import { ConfirmModal } from "@/components/confirm-modal";
import { nodeToPngBlob, saveBlob, zipBlobs } from "@/lib/ui/png";
import { deleteVisualsAction, generateVisualsAction, saveDesignAction } from "../pipeline-actions";
import { Canvas, Artboard, type CanvasTool } from "@/components/canvas";
import { CanvasHistory, EditableText, useCanvasHistory } from "@/components/canvas-edit";
import { askRewriteAction, patchContentAction } from "../content/actions";
import { EmptyState } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { formatByKey, formatUsesCarousel } from "@/lib/content/formats";
import { stepLabel } from "@/lib/projects/stages";
import {
  CAROUSEL_LAYOUTS, DEFAULT_DESIGN, DEFAULT_TWEAKS, POST_LAYOUTS, QUOTE_LAYOUTS, artboardsFor, clampScale, sameDesign,
  type ArtboardKind, type Design, type Tweaks,
} from "@/lib/visual/design";
import { cssFamily, fontStack, type FontPlan, type FontSource } from "@/lib/visual/fonts";
import { CarouselFrames, PostImage, QuoteCard, schemesFrom, type Fonts, type RenderText, type Scheme } from "./visual-layouts";
import { lookCheck, type LookResult } from "@/lib/visual/look-check";
import type { PictureMode } from "@/lib/visual/design";
import { patchForSlide, slidesOf, type Slide } from "@/lib/visual/slides";
import { exportBase } from "@/lib/visual/export";
import type { VisualComment } from "@/lib/data/visual-comments";
import type { JobView } from "@/lib/jobs/types";
import {
  addCommentAction, approveAgainAction, checkWordsAction, dismissCommentAction, dismissCommentsAction, pictureJobsAction, removeBackgroundAction, resizePictureAction,
  restoreCommentsAction, retryCommentAction, revertCopyAction, sendPictureCommentsAction, setPictureAction, startPictureAction,
} from "./picture-actions";
import { cancelJobAction, retryJobAction } from "../../../jobs/actions";
import { CommentSurface, PictureMenu, TARGET_LABEL, WorkingOverlay, commentState, commentWhat, useJobWatch, type DraftOps, type DraftPin, type Lost, type Watched } from "./visual-comments-ui";
import { BoardIconButton, BrandFonts, ExportSizes, HeadingCheck, PictureVersions, WordsNote, WordsUncheckedNote, ScaleSlider, lineage, sameHeading, useFitStates, useFontRenders, type Version } from "./visual-panels";
import { draftsKey, restoreDrafts, toolsOff } from "./board-state";
import { PictureSurface, ResizeModal, ToolLine, type Picked, type PictureTool } from "./picture-tools-ui";
import { areaOnFrame, draftSummary, isPicturePin, strokesBox, summaryLine } from "./picture-tools-maths";
import { ERASE_NOTE, MAX_PINS_PER_SEND, MAX_STROKES, type CutoutStatus, type PicturePin, type ResizeInput, type Stroke } from "@/lib/visual/picture-tools";
import type { Box } from "@/lib/visual/region-types";

type Item = {
  id: string; format: string; hook: string; body: string; cta: string; status: string; pillarName: string | null;
  scheme: number | null; design: Design | null;
  /** The image_assets row of each visual, for comments. */
  visuals: Partial<Record<ArtboardKind, string>>;
};

const DISPLAY_W = 300;
/** Relume's Wireframe view: the same layouts and real words, before any colour. */
const WIRE: Scheme = { name: "Wireframe", bg: "#FFFFFF", fg: "#1F1F1F", accent: "#BDBDBD" };
const WIRE_FONTS: Fonts = { display: "var(--font-sans)", accent: "var(--font-sans)" };

const KIND_LABEL: Record<ArtboardKind, string> = { post: "Post image", quote: "Quote card", carousel: "Carousel" };
const KINDS: ArtboardKind[] = ["post", "quote", "carousel"];

/** What each picture tool wants next, said in the tool strip's own line. */
const TOOL_TEXT: Record<PictureTool, string> = {
  comment: "Click a part to add a comment",
  markup: "Draw on the picture, then say what to change",
  erase: "Brush over what to remove",
  cutout: "Click the picture to remove its background",
  resize: "Click the picture to resize it",
};
const NO_PICTURE = "Add a picture first";
const IS_CUTOUT = "This picture has its background removed. Go back to the version before to change it.";
const HEADING_DRAWN_IN = "This picture has its heading drawn in. Switch to live text first.";
const PICTURE_BUSY = "This picture is being changed. Give it a moment.";
/** Said when a picture change finished after the person had put another picture on the visual (PI-26). */
const NOT_KEPT = "The change is done, but you'd put another picture on this visual meanwhile, so yours stays. The new one is in Picture versions.";
/** A history step that couldn't run now but can later: it stays on the stack (components/canvas-edit). */
const later = (message: string) => Object.assign(new Error(message), { keep: true });
/** What the board says when an area change finishes. */
const DONE_AREA = "Picture changed. Only the marked area was redrawn.";
/** A comment pin left without words is taken away when the person moves on to another (`keep` is the one being opened). */
const tidy = (all: DraftPin[], keep?: string) => all.filter((d) => d.id === keep || d.kind !== "comment" || d.note.trim() !== "");

type BoardProps = {
  tenantId: string; projectId: string; brandName: string; logo: string | null; items: Item[]; palette: string[]; fonts: string[]; imageStyle: string; selectedId: string | null; initialScheme: number;
  /** Where each brand font is loaded from on this page (lib/visual/fonts): an uploaded file, Google, or nowhere. */
  fontPlan: FontPlan;
  /** Every version of every picture in the project, newest first (fresh draws and area changes). */
  versions: Version[];
  comments: VisualComment[];
  /** Picture work still queued or running when the page loaded. */
  jobs: Watched[];
  /** Whether Remove background can run here, and why not when it can't (lib/ai/cutout). */
  cutout: CutoutStatus;
};

/**
 * Visual step (Relume's design + style guide, worked like a design tool):
 *
 *   - Every artboard's text is editable (double-click). The headline and quote
 *     also have "Rewrite the words" (its own button); carousel frames are askable
 *     with a click. Edits write back to the post's copy, so Content and Export
 *     stay in step.
 *   - Each artboard kind has several layouts. "Show me options" lays them out
 *     side by side in this piece's own words and colours; keep one.
 *   - Live tweaks for the selected piece (type size, alignment, accent,
 *     background) redraw as they move and save a moment after.
 *   - Cmd/Ctrl+Z undoes copy edits, layout picks and tweaks alike.
 */
/** What an edit changed, in the post's terms, for the "back to Edited" notice. */
const partWords = (keys: string[]) =>
  keys.length === 1 ? ({ hook: "opening line", body: "body", cta: "call to action" } as Record<string, string>)[keys[0]] ?? "words" : "words";

export function VisualBoard(props: BoardProps) {
  return (
    <CanvasHistory>
      <Board {...props} />
    </CanvasHistory>
  );
}

function Board({ tenantId, projectId, brandName, logo, items, palette, fonts, fontPlan, imageStyle, selectedId, initialScheme, versions, comments: savedComments, jobs, cutout }: BoardProps) {
  const history = useCanvasHistory();
  const router = useRouter();
  const toast = useToast();

  // ---- pictures: drawn and changed in the queue, watched until they finish ----
  const pictures = useMemo(() => new Map(versions.map((v) => [v.id, v])), [versions]);
  const pictureFor = (i: Item, k: ArtboardKind) => {
    const ref = i.design?.pictures?.[k];
    const info = ref ? pictures.get(ref.id) : undefined;
    return ref && info
      ? { id: ref.id, url: info.url, mode: ref.mode, parentId: info.parentId, heading: info.heading, cutout: !!(ref.cutout ?? info.cutout), width: info.width ?? 0, height: info.height ?? 0, textLeft: !!info.textLeft, wordsUnchecked: !!info.wordsUnchecked }
      : null;
  };
  /** The heading is drawn into this visual's picture, and the piece's heading no longer reads that. */
  const stale = (i: Item, k: ArtboardKind) => {
    const p = pictureFor(i, k);
    return !!p && p.mode === "with_text" && p.heading !== null && !sameHeading(p.heading, i.hook);
  };
  // Try again (from a toast) watches the job again; the watcher is created just below.
  const watchRef = useRef<(w: Watched) => void>(() => {});
  // Other tabs on this project hear about every picture change and refresh (PI-27).
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel(`hu-visual:${tenantId}:${projectId}`);
    bc.onmessage = () => router.refresh();
    channel.current = bc;
    return () => { bc.close(); channel.current = null; };
  }, [tenantId, projectId, router]);
  const tellOtherTabs = useCallback(() => { try { channel.current?.postMessage("changed"); } catch { /* a closed channel: nothing to tell */ } }, []);
  // The visuals being changed now, for history steps made earlier (their closures would see an old list).
  const busyNow = useRef<Watched[]>([]);
  const setPicture = useCallback(async (i: Item, k: ArtboardKind, id: string | null) => {
    // While a job changes this visual, its versions wait (PI-26); the step stays to be undone after.
    if (busyNow.current.some((w) => w.contentItemId === i.id && w.artboard === k)) throw later(PICTURE_BUSY);
    const r = await setPictureAction(tenantId, projectId, i.id, k, id);
    if (!r.ok) throw new Error(r.error);
    tellOtherTabs();
    router.refresh();
  }, [tenantId, projectId, router, tellOtherTabs]);
  const onJobDone = useCallback((w: Watched, job: JobView) => {
    const result = job.result as { pictureId?: string; changed?: number; failed?: number; kept?: boolean } | null;
    // Several changes sent together run one after another: a job that stopped part-way has still made the ones before
    // (its progress carries the newest picture), and that much can be undone too.
    const made = result?.pictureId ?? (typeof job.progress?.last === "string" ? job.progress.last : undefined);
    const i = items.find((x) => x.id === w.contentItemId);
    const k = w.artboard as ArtboardKind;
    const kept = result?.kept !== false && job.progress?.notKept !== true;
    tellOtherTabs();
    // Started in another tab: this board only shows the result (that tab has its undo).
    if (w.foreign) {
      if (job.status === "succeeded" && made && kept) toast(`${w.label.replace(/^Changing/, "Changed").replace(/^Drawing a picture/, "Drew a picture").replace(/^Resizing/, "Resized").replace(/^Removing/, "Removed")} (started in another tab).`, "neutral");
      router.refresh();
      return;
    }
    const undo = i && made && made !== (w.prev ?? null) && kept ? () => setPicture(i, k, w.prev ?? null) : null;
    // Undo goes back to the picture before the job: for several changes, the picture before all of them.
    if (undo && i && made) history.push({ label: w.label.toLowerCase(), undo, redo: () => setPicture(i, k, made) });
    if (job.status === "succeeded" && made) {
      if (!kept) toast(NOT_KEPT, "neutral");
      else if (result?.failed) toast(`${result.changed ?? 0} of ${(result.changed ?? 0) + result.failed} changes went through. The pins that didn't say why.`, "danger");
      // Keep it, or Undo right here (PI-18): an area change is judged by eye, and the button is where the eye is.
      else toast(w.done ?? (w.label.startsWith("Changing the picture") ? DONE_AREA : "Picture ready"), "success", undo ? {
        label: "Undo",
        run: () => void undo().then(() => toast("Back to the picture before."), (e) => toast(e instanceof Error ? e.message : "Couldn't undo that.", "danger")),
      } : undefined);
    } else {
      toast(job.error ?? "That didn't go through.", "danger", {
        label: "Try again",
        run: () => void retryJobAction(tenantId, w.jobId).then((ok) => { if (ok) watchRef.current(w); }),
      });
    }
    router.refresh();
  }, [items, history, setPicture, toast, router, tenantId, tellOtherTabs]);
  /** A watched job that can't be followed any more (PI-28): signed out, gone, or very slow. */
  const unwatchRef = useRef<(jobId: string) => void>(() => {});
  const onJobLost = useCallback((w: Watched, why: Lost) => {
    if (why === "signed_out") return toast("Signed out. Sign in again to see this picture.", "danger");
    if (why === "gone") { router.refresh(); return; }
    toast(`${w.label} is taking much longer than usual.`, "neutral", {
      label: "Stop",
      run: () => void cancelJobAction(tenantId, w.jobId).then((ok) => {
        if (ok) { unwatchRef.current(w.jobId); toast("Stopped. Nothing more is changed or used.", "neutral"); router.refresh(); }
        else toast("It finished or stopped already.", "neutral");
      }),
    });
  }, [toast, router, tenantId]);
  const { watching, watch, unwatch } = useJobWatch(tenantId, jobs, onJobDone, onJobLost);
  useEffect(() => { watchRef.current = watch; unwatchRef.current = unwatch; busyNow.current = watching; }, [watch, unwatch, watching]);
  // Picture work started in another tab, or by someone else, shows here too (PI-27): looked for every few seconds while this tab is in view.
  useEffect(() => {
    let stop = false;
    const look = async () => {
      if (stop || document.visibilityState !== "visible") return;
      try {
        const active = await pictureJobsAction(tenantId, projectId);
        if (stop) return;
        for (const j of active) if (!busyNow.current.some((w) => w.jobId === j.jobId)) watchRef.current({ ...j, foreign: true });
      } catch {
        // Offline for a moment, or signed out: the next look tries again (the job watcher says "signed out").
      }
    };
    const t = setInterval(() => void look(), 5000);
    return () => { stop = true; clearInterval(t); };
  }, [tenantId, projectId]);
  const working = (i: Item, k: ArtboardKind) => watching.find((w) => w.contentItemId === i.id && w.artboard === k);
  const drawPicture = async (i: Item, k: ArtboardKind, mode: PictureMode) => {
    const r = await startPictureAction(tenantId, projectId, i.id, k, mode);
    if (!r.ok) return toast(r.error, "danger");
    watch({ jobId: r.jobId, contentItemId: i.id, artboard: k, label: "Drawing a picture", prev: pictureFor(i, k)?.id ?? null });
  };

  // ---- the picture tools: one is in use at a time; changes wait as drafts until Send ----
  const [tool, setTool] = useState<PictureTool | null>(null);
  /** Changes pinned on visuals and not sent yet: comments, markup and erase, in the order they were made. */
  const [drafts, setDrafts] = useState<DraftPin[]>([]);
  // Kept for this project in the browser, so a reload, a closed tab or a trip to
  // another page doesn't lose them (PI-07); put back when the board opens, for
  // the visuals that are still here.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    let saved: unknown = null;
    try { saved = JSON.parse(window.localStorage.getItem(draftsKey(tenantId, projectId)) ?? "null"); } catch { saved = null; }
    const back = restoreDrafts(saved, items);
    if (!back.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- once, after mount: the browser's copy is not there on the server
    setDrafts(back);
    toast(`${back.length} change${back.length === 1 ? "" : "s"} you hadn't sent ${back.length === 1 ? "is" : "are"} back. Send or discard ${back.length === 1 ? "it" : "them"} from the bar below.`, "neutral");
  }, [tenantId, projectId, items, toast]);
  useEffect(() => {
    if (!restored.current) return;
    try {
      const key = draftsKey(tenantId, projectId);
      if (drafts.length) window.localStorage.setItem(key, JSON.stringify(drafts));
      else window.localStorage.removeItem(key);
    } catch {
      // Private window or full storage: the drafts still work, they just aren't kept past a reload.
    }
  }, [drafts, tenantId, projectId]);
  /** The X with words typed: asks first (PI-06). */
  const [discarding, setDiscarding] = useState(false);
  /** The draft whose field is open (one on the whole board). */
  const [openDraft, setOpenDraft] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  /** The picture Resize was clicked on. */
  const [resizing, setResizing] = useState<{ item: Item; kind: ArtboardKind; url: string; natural: { w: number; h: number }; fit: number } | null>(null);

  // ---- comments pinned on a spot ---------------------------------------------------
  const [extraComments, setExtraComments] = useState<VisualComment[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const allComments = useMemo(() => {
    const byId = new Map(extraComments.map((c) => [c.id, c]));
    for (const c of savedComments) byId.set(c.id, c);
    return [...byId.values()].filter((c) => !dismissed.has(c.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [extraComments, savedComments, dismissed]);
  const commentsOn = (visualId: string | undefined) => (visualId ? allComments.filter((c) => c.visualId === visualId) : []);

  // ---- copy: edit and ask ----------------------------------------------------
  /**
   * The words on a visual are the post's own words, so changing them changes
   * the post, and an approved post goes back to Edited until it is approved
   * again. That is said, with Approve again, never done silently (2026-11-18
   * new-account run).
   */
  const unapprovedNotice = useCallback((i: Item, part: string) => {
    toast(`Saved. This changes the post's ${part} too, so it's back to Edited until you approve it again.`, "neutral", {
      label: "Approve again",
      run: () => void approveAgainAction(tenantId, projectId, i.id).then((ok) => {
        toast(ok ? "Approved again." : "It was changed again since, so it wasn't approved. Check it on Content.", ok ? "neutral" : "danger");
        router.refresh();
      }),
    });
  }, [toast, tenantId, projectId, router]);
  const edit = useCallback((i: Item, next: { hook?: string; body?: string; cta?: string }, label: string, asked = false) => {
    const prev = Object.fromEntries(Object.keys(next).map((k) => [k, i[k as "hook" | "body" | "cta"]]));
    // A rewrite the person asked for is the model's words, so it is not learned from.
    const opts = { learn: !asked };
    const send = async (p: Record<string, string | undefined>, base: Record<string, string | undefined>) => {
      const r = await patchContentAction(tenantId, projectId, i.id, p, { ...opts, base });
      if (r && "conflict" in r) throw new Error(r.conflict);
    };
    // Undo puts the words back AND the status the piece had before this edit:
    // a draft that was edited and undone is a draft again (lib/data/visual-copy).
    const was = i.status;
    const back = async () => {
      const r = await revertCopyAction(tenantId, projectId, i.id, prev, next, was);
      if (r && "conflict" in r) throw new Error(r.conflict);
    };
    history.push({ label, undo: back, redo: () => send(next, prev) });
    return send(next, prev).then(() => {
      if (was === "approved") unapprovedNotice(i, partWords(Object.keys(next)));
      return was === "approved";
    });
  }, [history, tenantId, projectId, unapprovedNotice]);
  const askFor = useCallback((i: Item, part: string) => async (instruction: string, current: string) => {
    const r = await askRewriteAction(tenantId, projectId, i.id, { part, text: current, instruction });
    if (!r.ok) throw new Error(r.error);
    return r.text;
  }, [tenantId, projectId]);
  /** The AI rewrite of the words on the visuals (headline and quote card share the piece's hook). Undoable like an edit. */
  const rewriteWords = async (i: Item, instruction: string) => {
    const next = (await askFor(i, "Post image headline")(instruction, i.hook)).trim();
    if (!next || next === i.hook) return toast("That came back unchanged. Try saying it another way.");
    // An approved post gets the "back to Edited" notice from edit instead.
    if (await edit(i, { hook: next }, "rewrite headline", true)) return;
    toast(`Rewritten. ${typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl+"}Z undoes it.`);
  };

  // ---- schemes ----------------------------------------------------------------
  const schemes = useMemo(() => schemesFrom(palette), [palette]);
  const [scheme, setScheme] = useState(initialScheme);
  const s = schemes[scheme] ?? schemes[0];
  // The brand fonts first, then the house faces (the fallback chain). BrandFonts
  // below loads them; the names are spelled the way its @font-face rules are.
  const fontPair: Fonts = {
    display: fontStack(fonts[0], "var(--font-sans)"),
    accent: fontStack(fonts[1], "var(--font-serif)"),
  };
  const sourceOf = (name: string | undefined): FontSource => (name ? fontPlan.source[cssFamily(name)] ?? "none" : "none");

  // ---- designs: layouts + tweaks per piece, saved a moment after they settle ----
  const [designs, setDesigns] = useState<Record<string, Design>>({});
  const designOf = useCallback((i: Item): Design => designs[i.id] ?? i.design ?? DEFAULT_DESIGN, [designs]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const before = useRef(new Map<string, Design>());
  const put = useCallback(async (id: string, d: Design) => {
    setDesigns((all) => ({ ...all, [id]: d }));
    await saveDesignAction(tenantId, projectId, id, d);
  }, [tenantId, projectId]);
  const changeDesign = useCallback((i: Item, next: Design, label: string, delay = 450) => {
    const cur = designOf(i);
    if (!before.current.has(i.id)) before.current.set(i.id, cur);
    setDesigns((all) => ({ ...all, [i.id]: next }));
    clearTimeout(timers.current.get(i.id));
    timers.current.set(i.id, setTimeout(async () => {
      const prev = before.current.get(i.id) ?? cur;
      before.current.delete(i.id);
      if (sameDesign(prev, next)) return;
      // One undo step per settled change, however many frames a slider moved through.
      history.push({ label, undo: () => put(i.id, prev), redo: () => put(i.id, next) });
      try {
        await saveDesignAction(tenantId, projectId, i.id, next);
      } catch {
        toast("Couldn't save that design change. It's still on screen; try again.", "danger");
      }
    }, delay));
  }, [designOf, history, put, tenantId, projectId, toast]);
  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t); }, []);

  type CommentOutcome = Extract<Awaited<ReturnType<typeof addCommentAction>>, { ok: true }>;
  /** What a sent (or retried) comment came back with: watch its job, or record what it changed so it can be undone. */
  const settleComment = (i: Item, k: ArtboardKind, r: CommentOutcome, was: { copy: { hook: string; body: string; cta: string }; design: Design; status: string }) => {
    const target = r.comment.target;
    setExtraComments((all) => [...all.filter((c) => c.id !== r.comment.id), r.comment]);
    if (r.jobId) {
      watch({ jobId: r.jobId, contentItemId: i.id, artboard: k, label: "Changing the picture", prev: pictureFor(i, k)?.id ?? null, done: DONE_AREA });
      toast("Redrawing the marked area. It takes a moment.", "neutral");
      return;
    }
    if (r.comment.status === "applied" && r.after) {
      if (target === "headline" || target === "body" || target === "cta") {
        const after = { hook: r.after.hook, body: r.after.body, cta: r.after.cta };
        const opts = { learn: false };
        history.push({
          label: `comment on the ${TARGET_LABEL[target].toLowerCase()}`,
          undo: () => revertCopyAction(tenantId, projectId, i.id, was.copy, null, was.status),
          redo: () => patchContentAction(tenantId, projectId, i.id, after, opts),
        });
        if (was.status === "approved") {
          unapprovedNotice(i, partWords([target === "headline" ? "hook" : target]));
          router.refresh();
          return;
        }
      } else if (r.after.design) {
        const next = r.after.design;
        setDesigns((all) => ({ ...all, [i.id]: next }));
        history.push({ label: `comment on the ${TARGET_LABEL[target].toLowerCase()}`, undo: () => put(i.id, was.design), redo: () => put(i.id, next) });
      }
      toast(r.comment.result ?? "Done");
    } else {
      // The pin and the side panel both carry Try again for it.
      toast(r.comment.result ?? "That didn't change anything.", "danger");
    }
    router.refresh();
  };
  /** Try again: the same comment (same box, same words) is run again. */
  const retryComment = async (c: VisualComment) => {
    const i = items.find((x) => x.id === c.contentItemId);
    const k = i && (Object.keys(i.visuals) as ArtboardKind[]).find((a) => i.visuals[a] === c.visualId);
    if (!i || !k) return;
    const was = { copy: { hook: i.hook, body: i.body, cta: i.cta }, design: designOf(i), status: i.status };
    const r = await retryCommentAction(tenantId, projectId, c.id);
    if (!r.ok) {
      toast(r.error, "danger");
      return;
    }
    settleComment(i, k, r, was);
  };
  const [retrying, setRetrying] = useState<string | null>(null);
  const hide = (ids: string[], on: boolean) => setDismissed((all) => {
    const next = new Set(all);
    for (const id of ids) if (on) next.add(id); else next.delete(id);
    return next;
  });
  /** Bring cleared comments back (Undo of Clear, PI-35). */
  const restore = (ids: string[]) => void restoreCommentsAction(tenantId, projectId, ids).then((back) => {
    hide(back, false);
    toast(back.length ? `${back.length === 1 ? "Comment" : `${back.length} comments`} back.` : "Couldn't bring that back.", back.length ? "neutral" : "danger");
    router.refresh();
  });
  /** Clear one comment: hidden at once, shown again if the server says no, and Undo is one press away. */
  const dismissComment = (id: string) => {
    hide([id], true);
    void dismissCommentAction(tenantId, projectId, id).then((ok) => {
      if (!ok) { hide([id], false); return toast("Couldn't clear that comment. It may still be working.", "danger"); }
      toast("Comment cleared.", "neutral", { label: "Undo", run: () => restore([id]) });
    }, () => { hide([id], false); toast("Couldn't clear that comment.", "danger"); });
  };
  // Done comments are quiet by default (PI-11): the pins show what is open, working or failed.
  const [showDone, setShowDone] = useState(false);
  const isDone = (c: VisualComment) => c.status === "applied";
  /** Clear done: every done comment on the board at once, undoable. */
  const clearDone = () => {
    const ids = allComments.filter((c) => isDone(c) && items.some((i) => i.id === c.contentItemId)).map((c) => c.id);
    if (!ids.length) return;
    hide(ids, true);
    void dismissCommentsAction(tenantId, projectId, ids).then((gone) => {
      hide(ids.filter((id) => !gone.includes(id)), false);
      toast(`Cleared ${gone.length} done comment${gone.length === 1 ? "" : "s"}.`, "neutral", { label: "Undo", run: () => restore(gone) });
    }, () => { hide(ids, false); toast("Couldn't clear those comments.", "danger"); });
  };
  // One number per comment, counted per piece in the order they were made:
  // the pin on the visual and the row in the side panel show the same one.
  const commentNumbers = useMemo(() => {
    const out: Record<string, number> = {};
    const count = new Map<string, number>();
    for (const c of allComments) {
      const n = (count.get(c.contentItemId) ?? 0) + 1;
      count.set(c.contentItemId, n);
      out[c.id] = n;
    }
    return out;
  }, [allComments]);
  /** A picture change whose result is no longer in the visual's picture (undone, or an earlier version put back). */
  const isUndone = (c: VisualComment) => {
    if (c.target !== "picture" || c.status !== "applied" || !c.resultPictureId) return false;
    const i = items.find((x) => x.id === c.contentItemId);
    const k = i && (Object.keys(i.visuals) as ArtboardKind[]).find((a) => i.visuals[a] === c.visualId);
    return !i || !k || !lineage(i.design?.pictures?.[k]?.id, versions).has(c.resultPictureId);
  };

  // ---- drafts: pinned, numbered, sent together ------------------------------------------
  /** A draft's number: after the piece's sent comments, in the order the drafts were made. */
  const draftNumbers = useMemo(() => {
    const out: Record<string, number> = {};
    const count = new Map<string, number>();
    for (const c of allComments) count.set(c.contentItemId, (count.get(c.contentItemId) ?? 0) + 1);
    for (const d of drafts) {
      const n = (count.get(d.itemId) ?? 0) + 1;
      count.set(d.itemId, n);
      out[d.id] = n;
    }
    return out;
  }, [allComments, drafts]);
  const openDraftPin = useCallback((id: string | null) => {
    setDrafts((all) => tidy(all, id ?? undefined));
    setOpenDraft(id);
  }, []);
  const removeDraft = useCallback((id: string) => {
    setDrafts((all) => all.filter((d) => d.id !== id));
    setOpenDraft((cur) => (cur === id ? null : cur));
  }, []);
  /** Why a picture can't be changed by a tool right now, when it can't. Said in a toast where it is clicked. */
  const lockFor = (i: Item, k: ArtboardKind, t: PictureTool): string | null => {
    const p = pictureFor(i, k);
    if (!p) return null;
    if (working(i, k)) return PICTURE_BUSY;
    if (p.cutout) return IS_CUTOUT;
    if ((t === "resize" || t === "cutout") && p.mode === "with_text") return HEADING_DRAWN_IN;
    return null;
  };
  const refuse = useCallback((why: string) => toast(why, "neutral"), [toast]);
  /** Room for one more change on this piece? Each Send carries at most MAX_PINS_PER_SEND. */
  const roomFor = (i: Item) => {
    if (drafts.filter((d) => d.itemId === i.id).length < MAX_PINS_PER_SEND) return true;
    toast(`That's ${MAX_PINS_PER_SEND} changes on this piece. Send them, then add more.`, "neutral");
    return false;
  };
  const draftOps = (i: Item, k: ArtboardKind): DraftOps => ({
    add: (d) => {
      const visualId = i.visuals[k];
      if (!visualId) { toast("Generate this visual first, then comment on it.", "neutral"); return false; }
      if (!roomFor(i)) return false;
      const id = crypto.randomUUID();
      setDrafts((all) => [...tidy(all), { ...d, id, itemId: i.id, artboard: k, visualId }]);
      setOpenDraft(id);
      return true;
    },
    update: (id, patch) => setDrafts((all) => all.map((d) => (d.id === id ? { ...d, ...patch } : d))),
    remove: removeDraft,
    open: openDraftPin,
  });
  /**
   * A stroke drawn on a picture. Each visual has ONE markup change and ONE
   * erase change: more strokes add to it. `on.pic` is where the whole picture
   * sits on its frame, so the strokes' box on the picture can be shown on the frame.
   */
  const addStroke = (i: Item, k: ArtboardKind) => (kind: "markup" | "erase", stroke: Stroke, on: { frame: number; pic: Box; aspect: number }): boolean => {
    const visualId = i.visuals[k];
    if (!visualId) return false;
    const mine = drafts.find((d) => d.visualId === visualId && d.kind === kind);
    if (!mine && !roomFor(i)) return false;
    if ((mine?.strokes?.length ?? 0) >= MAX_STROKES) {
      toast(`That's ${MAX_STROKES} strokes on this picture. Send them, or undo one, before drawing more.`, "neutral");
      return false;
    }
    const strokes = [...(mine?.strokes ?? []), stroke];
    const area = strokesBox(strokes, on.aspect);
    if (!area) return false;
    const id = mine?.id ?? crypto.randomUUID();
    const next: DraftPin = {
      id, itemId: i.id, artboard: k, visualId, kind, target: "picture", strokes, area, box: areaOnFrame(area, on.pic),
      note: kind === "erase" ? ERASE_NOTE : mine?.note ?? "", frame: on.frame, offered: ["picture"], pic: on.pic, aspect: on.aspect,
    };
    setDrafts((all) => (mine ? all.map((d) => (d.id === id ? next : d)) : [...tidy(all), next]));
    // Markup: the note's field opens beside the marks as soon as there is one.
    if (kind === "markup" && !mine?.note.trim()) setOpenDraft(id);
    return true;
  };
  /** Undo the last stroke of the tool in use (the change it belonged to goes when it was its only one). */
  const undoStroke = (kind: "markup" | "erase") => {
    const last = [...drafts].reverse().find((d) => d.kind === kind && d.strokes?.length);
    if (!last) return;
    const strokes = (last.strokes ?? []).slice(0, -1);
    const area = strokesBox(strokes, last.aspect ?? 1);
    if (!strokes.length || !area) return removeDraft(last.id);
    setDrafts((all) => all.map((d) => (d.id === last.id ? { ...d, strokes, area, box: last.pic ? areaOnFrame(area, last.pic) : d.box } : d)));
  };
  const clearStrokes = (kind: "markup" | "erase") => {
    setDrafts((all) => all.filter((d) => d.kind !== kind));
    setOpenDraft(null);
  };
  /**
   * The X: leave the tool and drop what was not sent, as one undoable step.
   * Escape only leaves the tool (the canvas does that) and keeps every draft,
   * as switching tool does (PI-06: Escape threw away every typed comment).
   */
  const discardDrafts = useCallback(() => {
    const was = drafts;
    setTool(null);
    setDrafts([]);
    setOpenDraft(null);
    setDiscarding(false);
    if (!was.length) return;
    history.push({ label: "discard changes", undo: async () => setDrafts(was), redo: async () => setDrafts([]) });
    toast(`${was.length} change${was.length === 1 ? "" : "s"} discarded.`, "neutral", { label: "Undo", run: () => setDrafts(was) });
  }, [drafts, history, toast]);
  const closeTool = useCallback(() => {
    // Words typed on any of them: ask first. Marks and brushed areas alone go at once (Undo brings them back).
    if (drafts.some((d) => d.note.trim() && d.kind !== "erase")) return setDiscarding(true);
    discardDrafts();
  }, [drafts, discardDrafts]);

  /**
   * Send every draft. Words and design changes go one by one (each is applied
   * in its request and can be undone on its own). Picture changes go together,
   * ONE job per visual, in the order they were made; undo then returns to the
   * picture before all of them. What didn't go through stays pinned, with the
   * server's reason in a toast.
   */
  const sendDrafts = async () => {
    if (sending || !draftSummary(drafts).ready) return;
    setSending(true);
    setOpenDraft(null);
    const sent = new Set<string>();
    /** Why each change that didn't go through didn't: kept on its pin (PI-32). */
    const failed = new Map<string, string>();
    const fail = (ids: string[], why: string) => { for (const id of ids) failed.set(id, why); };
    let queued = 0;
    try {
      // What each piece is as the changes land: the next change's undo goes back to this, not to the page's older copy.
      const now = new Map<string, { copy: { hook: string; body: string; cta: string }; design: Design; status: string }>();
      // Each change is sent on its own: one that fails keeps its pin and its reason, and the rest still go (PI-32).
      for (const d of drafts.filter((x) => !isPicturePin(x))) {
        const i = items.find((x) => x.id === d.itemId);
        if (!i) continue;
        const was = now.get(i.id) ?? { copy: { hook: i.hook, body: i.body, cta: i.cta }, design: designOf(i), status: i.status };
        let r: Awaited<ReturnType<typeof addCommentAction>>;
        try {
          r = await addCommentAction(tenantId, projectId, { visualId: d.visualId, target: d.target, box: d.box, note: d.note.trim(), area: null, frame: d.frame });
        } catch {
          fail([d.id], "The connection dropped. Send it again.");
          continue;
        }
        if (!r.ok) { fail([d.id], r.error); continue; }
        sent.add(d.id);
        settleComment(i, d.artboard, r, was);
        if (r.comment.status === "applied" && r.after) {
          const words = d.target === "headline" || d.target === "body" || d.target === "cta";
          now.set(i.id, {
            copy: { hook: r.after.hook, body: r.after.body, cta: r.after.cta },
            design: r.after.design ?? was.design,
            // Changed words move an approved piece back to edited.
            status: words && was.status === "approved" ? "edited" : was.status,
          });
        }
      }
      const byVisual = new Map<string, DraftPin[]>();
      for (const d of drafts.filter(isPicturePin)) byVisual.set(d.visualId, [...(byVisual.get(d.visualId) ?? []), d]);
      for (const [visualId, pins] of byVisual) {
        const i = items.find((x) => x.id === pins[0].itemId);
        if (!i) continue;
        const k = pins[0].artboard;
        const payload: PicturePin[] = pins.map((d) => ({ kind: d.kind, box: d.box, area: d.area, ...(d.strokes?.length ? { strokes: d.strokes } : {}), note: d.kind === "erase" ? ERASE_NOTE : d.note.trim(), frame: d.frame }));
        let r: Awaited<ReturnType<typeof sendPictureCommentsAction>>;
        try {
          r = await sendPictureCommentsAction(tenantId, projectId, { visualId, pins: payload });
        } catch {
          fail(pins.map((d) => d.id), "The connection dropped. Send it again.");
          continue;
        }
        if (!r.ok) { fail(pins.map((d) => d.id), r.error); continue; }
        for (const d of pins) sent.add(d.id);
        queued += pins.length;
        const made = r.comments;
        setExtraComments((all) => [...all.filter((c) => !made.some((m) => m.id === c.id)), ...made]);
        const n = pins.length;
        watch({
          jobId: r.jobId, contentItemId: i.id, artboard: k, prev: pictureFor(i, k)?.id ?? null,
          label: n === 1 ? "Changing the picture" : `Changing the picture (${n} changes)`,
          done: n === 1 ? DONE_AREA : `Picture changed: ${n} changes. Only the marked areas were redrawn.`,
        });
      }
      if (queued) toast(queued === 1 ? "Changing the picture. It takes a moment." : `Changing the picture: ${queued} changes, one after another. It takes a moment.`, "neutral");
      if (sent.size) tellOtherTabs();
    } finally {
      setSending(false);
      // Sent ones go; the rest stay pinned, each with its own reason.
      setDrafts((all) => all.filter((d) => !sent.has(d.id)).map((d) => (failed.has(d.id) ? { ...d, error: failed.get(d.id) } : d.error ? { ...d, error: undefined } : d)));
      if (failed.size) {
        const reasons = [...new Set(failed.values())];
        toast(`${failed.size} change${failed.size === 1 ? "" : "s"} didn't go through and ${failed.size === 1 ? "is" : "are"} still pinned: ${reasons[0]}${reasons.length > 1 ? " (open each pin for its reason)" : ""}`, "danger");
      }
      // Everything went: the tool has done its job.
      if (drafts.every((d) => sent.has(d.id))) setTool(null);
    }
  };

  // ---- the words check, run again on one picture (PI-20) ------------------------------------
  const [checking, setChecking] = useState<string | null>(null);
  const checkWords = async (i: Item, k: ArtboardKind) => {
    setChecking(`${i.id}:${k}`);
    try {
      const r = await checkWordsAction(tenantId, projectId, i.id, k);
      if (!r.ok) return toast(r.error, "danger");
      toast(r.found === "clean" ? "Checked: no words in this picture." : r.found === "words" ? "This picture shows some words. Use Erase to remove them." : "The check still couldn't run. Try again in a few minutes.", r.found === "unchecked" ? "danger" : "neutral");
      router.refresh();
    } catch {
      toast("That didn't go through. Try again.", "danger");
    } finally {
      setChecking(null);
    }
  };

  // ---- remove background, resize ---------------------------------------------------------
  const starting = useRef(false);
  const removeBackground = async (i: Item, k: ArtboardKind) => {
    if (starting.current) return;
    starting.current = true;
    try {
      const r = await removeBackgroundAction(tenantId, projectId, i.id, k);
      if (!r.ok) return toast(r.error, "danger");
      watch({ jobId: r.jobId, contentItemId: i.id, artboard: k, label: "Removing the background", prev: pictureFor(i, k)?.id ?? null, done: "Background removed. The picture now sits on your background colour." });
      tellOtherTabs();
      setTool(null);
    } catch {
      toast("That didn't go through. Try again.", "danger");
    } finally {
      starting.current = false;
    }
  };
  /** A picture was clicked in Remove background or Resize. */
  const pickPicture = (i: Item, k: ArtboardKind) => (m: Picked) => {
    const p = pictureFor(i, k);
    if (!p) return;
    if (tool === "cutout") return void removeBackground(i, k);
    // The version's own size when the page has it; else what the browser read from the file.
    const natural = p.width > 0 && p.height > 0 ? { w: p.width, h: p.height } : m.natural;
    if (tool === "resize") setResizing({ item: i, kind: k, url: p.url, natural, fit: m.slot });
  };
  const applyResize = async (input: ResizeInput): Promise<boolean> => {
    if (!resizing) return false;
    const { item: i, kind: k } = resizing;
    const prev = pictureFor(i, k)?.id ?? null;
    try {
      const r = await resizePictureAction(tenantId, projectId, i.id, k, input);
      if (!r.ok) { toast(r.error, "danger"); return false; }
      if (r.pictureId) {
        // A crop: done in the request. The same undo as choosing a version.
        const made = r.pictureId;
        history.push({ label: "crop picture", undo: () => setPicture(i, k, prev), redo: () => setPicture(i, k, made) });
        toast("Picture cropped.");
        router.refresh();
      } else if (r.jobId) {
        watch({ jobId: r.jobId, contentItemId: i.id, artboard: k, label: "Resizing the picture", prev, done: "Picture resized. The new part was drawn to match." });
      }
      setResizing(null);
      setTool(null);
      return true;
    } catch {
      toast("That didn't go through. Try again.", "danger");
      return false;
    }
  };

  const designed = items.filter((i) => i.scheme !== null);
  const undesigned = items.length - designed.length;
  // The order is settled once, when the board opens (approved pieces first).
  // Editing a piece changes its status; re-sorting then moved it away from
  // under the pointer, and the next action landed on another piece.
  const [order] = useState(() => [...designed].sort((x, y) => (x.status === "approved" ? -1 : 0) - (y.status === "approved" ? -1 : 0)).map((i) => i.id));
  const place = (id: string) => { const n = order.indexOf(id); return n < 0 ? order.length : n; };
  const ordered = [...designed].sort((x, y) => place(x.id) - place(y.id));
  // Wireframe shows every piece laid out; Design shows the ones generated in a scheme.
  const [view, setView] = useState<"wireframe" | "design">(designed.length ? "design" : "wireframe");
  const wire = view === "wireframe" || designed.length === 0;
  const shown = wire ? [...ordered, ...items.filter((i) => i.scheme === null)] : ordered;
  const [focusId, setFocusId] = useState<string | null>(selectedId);
  const focus = ordered.find((i) => i.id === focusId) ?? ordered[0] ?? null;

  const [open, setOpen] = useState<string | null>("design");
  // The style guide lives in the page's right slot (components/project-panels):
  // docked beside the canvas, opened and closed from the editor's top bar.
  const panels = usePanels();
  const [options, setOptions] = useState<{ item: Item; kind: ArtboardKind } | null>(null);

  // ---- export -----------------------------------------------------------------
  const frames = useRef(new Map<string, HTMLDivElement>());
  const frameRef = (key: string) => (el: HTMLDivElement | null) => {
    if (el) frames.current.set(key, el);
    else frames.current.delete(key);
  };
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Item | null>(null);

  // Files are named after the brand AND the piece (lib/visual/export), so two
  // pieces never save over each other.
  const nameOf = (i: Item) => exportBase(brandName, i, items);
  /**
   * Said with a download: a picture that still carries the piece's old heading,
   * and a heading drawn into a picture that nobody has checked (the app does not
   * read it). It never blocks the download.
   */
  const staleNote = (i: Item, kinds: ArtboardKind[]) => {
    const old = kinds.filter((k) => stale(i, k)).map((k) => KIND_LABEL[k].toLowerCase());
    const drawn = kinds.filter((k) => !stale(i, k) && pictureFor(i, k)?.mode === "with_text").map((k) => KIND_LABEL[k].toLowerCase());
    return [
      old.length ? ` Check it first: the picture on the ${old.join(" and ")} still shows the old heading.` : "",
      drawn.length ? ` The heading drawn into the picture on the ${drawn.join(" and ")} may not be spelled right: read it before you post.` : "",
    ].join("");
  };
  const exportOne = async (i: Item, kind: ArtboardKind, key: string, w: number, h: number) => {
    const node = frames.current.get(key);
    if (!node) return;
    const name = `${nameOf(i)}-${kind}-${w}x${h}`;
    setBusy(key);
    try {
      saveBlob(await nodeToPngBlob(node, w, h), `${name}.png`);
      toast(`Saved ${name}.png.${staleNote(i, [kind])}`);
    } catch {
      toast("Couldn't render that image. Try again.", "danger");
    } finally {
      setBusy(null);
    }
  };
  const carouselFiles = async (i: Item, slides: Slide[]) => {
    const files: { name: string; blob: Blob }[] = [];
    for (let k = 0; k < slides.length; k++) {
      const f = frames.current.get(`${i.id}:carousel:${k}`);
      if (f) files.push({ name: `${nameOf(i)}-carousel-${String(k + 1).padStart(2, "0")}-1080x1350.png`, blob: await nodeToPngBlob(f, 1080, 1350) });
    }
    return files;
  };
  /** The whole set: post image, quote card and every carousel frame, as one zip. */
  const exportSet = async (i: Item, slides: Slide[]) => {
    const fmt = formatByKey(i.format);
    const base = nameOf(i);
    setBusy(`${i.id}:set`);
    try {
      const files: { name: string; blob: Blob }[] = [];
      const post = frames.current.get(`${i.id}:single`);
      if (post) files.push({ name: `${base}-post-${fmt.frame.w}x${fmt.frame.h}.png`, blob: await nodeToPngBlob(post, fmt.frame.w, fmt.frame.h) });
      const quote = frames.current.get(`${i.id}:quote`);
      if (quote) files.push({ name: `${base}-quote-1080x1080.png`, blob: await nodeToPngBlob(quote, 1080, 1080) });
      files.push(...(await carouselFiles(i, slides)));
      if (!files.length) throw new Error("nothing to export");
      saveBlob(await zipBlobs(files), `${base}-visuals.zip`);
      toast(`Saved ${files.length} images as ${base}-visuals.zip.${staleNote(i, ["post", "quote", "carousel"])}`);
    } catch {
      toast("Couldn't render the set. Try again.", "danger");
    } finally {
      setBusy(null);
    }
  };
  /** Only the carousel's frames, as one zip. */
  const exportFrames = async (i: Item, slides: Slide[]) => {
    setBusy(`${i.id}:frames`);
    try {
      const files = await carouselFiles(i, slides);
      if (!files.length) throw new Error("nothing to export");
      saveBlob(await zipBlobs(files), `${nameOf(i)}-carousel.zip`);
      toast(`Saved ${files.length} frame${files.length === 1 ? "" : "s"} as ${nameOf(i)}-carousel.zip.${staleNote(i, ["carousel"])}`);
    } catch {
      toast("Couldn't render the frames. Try again.", "danger");
    } finally {
      setBusy(null);
    }
  };

  // ---- the look check's eyes: what is really on the visuals ------------------------
  const fits = useFitStates();
  const fontRendering = useFontRenders(fonts[0]);
  const [switching, setSwitching] = useState(false);
  /** Put a version of a visual's picture on it (from the version list), undoable. */
  /**
   * Point a visual at another picture (a version, the one before, none), and
   * only once the server has said yes add the undo step (PI-33: a refused
   * switch left an undo for a change that never happened).
   */
  const switchPicture = (i: Item, k: ArtboardKind, id: string | null, label: string, said: string, refused: string) => {
    const cur = i.design?.pictures?.[k]?.id ?? null;
    if (cur === id) return;
    // While a job changes this visual, its picture waits (PI-26): the job would otherwise put its own back on top.
    if (working(i, k)) return toast(PICTURE_BUSY, "neutral");
    setSwitching(true);
    void setPicture(i, k, id)
      .then(() => {
        history.push({ label, undo: () => setPicture(i, k, cur), redo: () => setPicture(i, k, id) });
        if (said) toast(said);
      })
      .catch((e) => toast(e instanceof Error && e.message ? e.message : refused, "danger"))
      .finally(() => setSwitching(false));
  };
  const putVersion = (i: Item, k: ArtboardKind, id: string) =>
    switchPicture(i, k, id, "use picture version", `${KIND_LABEL[k]}: that version is on the visual now.`, "Couldn't switch to that version.");
  const confirmRemove = async () => {
    const i = removing;
    if (!i) return;
    setRemoving(null);
    try {
      await deleteVisualsAction(tenantId, projectId, i.id);
      toast("Visuals removed");
      router.refresh();
    } catch {
      toast("Couldn't remove those visuals.", "danger");
    }
  };

  // ---- text on the canvas: editable and askable --------------------------------
  const textFor = (i: Item, slides: Slide[]): RenderText => function renderText(slot) {
    if (slot.kind === "post" || slot.kind === "quote") {
      const what = slot.kind === "post" ? "Headline" : "Quote";
      // Double-click edits the words where they sit. No click-to-ask here: a click opened the AI box on the way to a double-click (F11).
      // The AI rewrite is its own button (RewriteWords), so it never takes over an edit.
      return (
        <EditableText
          value={i.hook}
          required
          label={what}
          onCommit={(hook, _p, m) => edit(i, { hook }, `${m?.asked ? "rewrite" : "edit"} ${what.toLowerCase()}`, m?.asked)}
        />
      );
    }
    const sl = slides[slot.index];
    return (
      <EditableText
        value={sl.text}
        multiline={sl.src.kind === "body"}
        required={sl.src.kind === "hook"}
        label={`Slide ${slot.index + 1}`}
        onAsk={askFor(i, `Carousel slide ${slot.index + 1}`)}
        onCommit={(text, _p, m) => edit(i, patchForSlide(i, sl, text), `${m?.asked ? "rewrite" : "edit"} slide ${slot.index + 1}`, m?.asked)}
      />
    );
  };

  // ---- the picture tools in the canvas strip, and the line they speak in ---------------------
  // A tool is on when ANY picture on the board can take it (PI-02: only the first
  // piece was looked at), and off, with the reason, when none can, before anything
  // is drawn (PI-36: every picture a cut-out, the tool looked ready and refused after).
  // A visual that can't take it still says why when it is clicked (lockFor).
  const off = toolsOff(ordered.flatMap((i) => KINDS.map((k) => pictureFor(i, k)).filter((p): p is NonNullable<typeof p> => !!p)));
  const toolItems: CanvasTool[] = [
    { id: "comment", label: "Comment", key: "C", icon: <MessageSquare size={18} aria-hidden="true" /> },
    { id: "markup", label: "Markup", key: "M", icon: <PenLine size={18} aria-hidden="true" />, off: off.markup },
    { id: "erase", label: "Erase", key: "E", icon: <Eraser size={18} aria-hidden="true" />, off: off.erase },
    { id: "cutout", label: "Remove background", key: "B", icon: <ImageMinus size={18} aria-hidden="true" />, off: off.cutout ?? (cutout.available ? undefined : cutout.reason ?? "Not set up here yet") },
    { id: "resize", label: "Resize", key: "R", icon: <Crop size={18} aria-hidden="true" />, off: off.resize },
  ];
  const strokeTool = tool === "markup" || tool === "erase" ? tool : null;
  const noStrokes = !strokeTool || !drafts.some((d) => d.kind === strokeTool);
  const doneCount = allComments.filter((c) => isDone(c) && ordered.some((i) => i.id === c.contentItemId)).length;
  const toolLine = tool || drafts.length ? (
    <ToolLine
      text={tool ? TOOL_TEXT[tool] : "Changes not sent yet"}
      summary={summaryLine(drafts)}
      actions={strokeTool ? [
        { label: "Undo stroke", run: () => undoStroke(strokeTool), disabled: noStrokes },
        { label: "Clear", run: () => clearStrokes(strokeTool), disabled: noStrokes },
      ] : tool === "comment" && doneCount ? [
        { label: showDone ? "Hide done" : `Show done (${doneCount})`, run: () => setShowDone((v) => !v) },
        { label: "Clear done", run: clearDone },
      ] : []}
      send={drafts.length || tool === "comment" || strokeTool ? { ready: draftSummary(drafts).ready, busy: sending, run: () => void sendDrafts() } : null}
      onClose={closeTool}
      // Escape only leaves the tool and keeps what is pinned; the X discards (and asks first when words are typed).
      closeLabel={drafts.length ? "Close and discard" : "Close (Esc)"}
    />
  ) : undefined;

  return (
    <div className="absolute inset-0 flex flex-row-reverse">
      <BrandFonts plan={fontPlan} />
      <RightDock label="Design">
      <aside aria-label="Design and style guide" data-panel="step" className="hu-panel">
        <div className="min-h-12 shrink-0 flex items-center pl-3 pr-1.5 border-b border-hairline">
          <span className="label-mono text-ink-faint flex-1 truncate">{stepLabel("visual")} · Visual</span>
          <BoardIconButton label="Close design panel" onClick={() => panels?.setRight(false)}><X size={17} aria-hidden="true" /></BoardIconButton>
        </div>
        <div className="flex-1 overflow-y-auto">
          {!palette.length && (
            <Link href={`/w/${tenantId}/brand/visual`} className="m-3 flex gap-2 bg-accent-soft rounded-md px-3 py-2.5 text-xs text-accent-ink">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" /> No brand palette yet, so these use the house colours. Add one in Brand core →
            </Link>
          )}

          {focus && (
            <Section id="design" icon={SlidersHorizontal} title="Design this piece" open={open} setOpen={setOpen}>
              <TweakPanel
                item={focus}
                design={designOf(focus)}
                onTweak={(t, label) => changeDesign(focus, { ...designOf(focus), tweaks: t }, label)}
                onOptions={(kind) => setOptions({ item: focus, kind })}
                onReset={() => changeDesign(focus, DEFAULT_DESIGN, "reset design", 0)}
                onApplyAll={() => {
                  const d = designOf(focus);
                  for (const i of designed) if (i.id !== focus.id) changeDesign(i, d, "apply design to every piece", 0);
                  toast(`Applied to ${designed.length - 1} other piece${designed.length - 1 === 1 ? "" : "s"}`);
                }}
                canApplyAll={designed.length > 1}
              />
            </Section>
          )}

          {focus && (() => {
            const mine = allComments.filter((c) => c.contentItemId === focus.id);
            return (
              <Section id="comments" icon={MessageSquare} title={`Comments${mine.length ? ` · ${mine.length}` : ""}`} open={open} setOpen={setOpen}>
                {mine.length === 0 ? (
                  <p className="text-sm text-ink-muted">Pick Comment in the bar under the canvas (or press C), click a part of a visual and say what to change. Add as many as you like, then Send. A comment on a picture redraws only that area.</p>
                ) : (
                  <ol className="flex flex-col gap-2.5">
                    {mine.map((c) => {
                      // The same number and the same words as the pin on the visual.
                      const state = commentState(c, isUndone(c));
                      return (
                        <li key={c.id} className="text-sm border border-hairline rounded-md p-2.5">
                          <p className="text-xs text-ink-faint">{commentNumbers[c.id]} · {commentWhat(c)} · {state.label}</p>
                          <p className="mt-0.5">{c.note}</p>
                          {c.status !== "working" && <p className="text-xs text-ink-muted mt-1 whitespace-pre-line">{state.text}</p>}
                          {c.status !== "working" && (
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                              {c.status === "failed" && (
                                <button type="button" disabled={retrying !== null} onClick={() => { setRetrying(c.id); void retryComment(c).finally(() => setRetrying(null)); }} className={btnClass("secondary", "sm")}>
                                  {retrying === c.id ? <><AgentDots /> Trying again…</> : "Try again"}
                                </button>
                              )}
                              <button type="button" onClick={() => dismissComment(c.id)} className={btnClass("ghost", "sm")}>Clear</button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Section>
            );
          })()}

          {focus && (() => {
            const mine = versions.filter((v) => v.contentItemId === focus.id);
            const inUse: Partial<Record<ArtboardKind, string>> = {};
            for (const k of ["post", "quote", "carousel"] as ArtboardKind[]) { const id = focus.design?.pictures?.[k]?.id; if (id) inUse[k] = id; }
            return (
              <Section id="versions" icon={History} title={`Picture versions${mine.length ? ` · ${mine.length}` : ""}`} open={open} setOpen={setOpen}>
                <PictureVersions
                  versions={mine}
                  inUse={inUse}
                  busy={switching}
                  working={{ post: !!working(focus, "post"), quote: !!working(focus, "quote"), carousel: !!working(focus, "carousel") }}
                  // A click handler: the busy ref behind putVersion is read when it runs, never during render.
                  // eslint-disable-next-line react-hooks/refs
                  onUse={(k, id) => putVersion(focus, k, id)}
                />
              </Section>
            );
          })()}

          {/* Colour schemes: their own labelled part, never under the picture versions (F13). */}
          <div className="px-3 pt-3 pb-3 border-t border-hairline">
            <p className="label-mono text-ink-faint mb-2">Colour scheme</p>
            {/* A card is a preview until it is applied below (PI-16): said plainly, with the way back. */}
            {designed.length > 0 && scheme !== initialScheme && (
              <div role="status" className="mb-2 text-xs text-ink-muted leading-relaxed bg-field rounded-md px-2.5 py-2">
                <p>Previewing {schemes[scheme]?.name ?? "this scheme"}. It isn&apos;t saved yet, and downloads use it too. Apply it below to keep it.</p>
                <button type="button" onClick={() => setScheme(initialScheme)} className={`${btnClass("ghost", "sm")} mt-1`}>Back to {schemes[initialScheme]?.name ?? "the saved scheme"}</button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {schemes.map((sc, i) => (
                <button key={sc.name} onClick={() => setScheme(i)} aria-pressed={i === scheme} className={`rounded-md overflow-hidden border text-left transition-colors ${i === scheme ? "border-ink ring-1 ring-ink" : "border-hairline hover:border-line"}`}>
                  <div className="h-14 flex items-center justify-between px-3" style={{ background: sc.bg }}>
                    <span className="text-[1.2rem] font-medium leading-none" style={{ color: sc.fg }}>Aa<span className="block h-[3px] w-6 mt-1 rounded-full" style={{ background: sc.accent }} /></span>
                    <span className="w-6 h-6 rounded-sm border border-black/10" style={{ background: sc.accent }} />
                  </div>
                  <p className="text-xs px-2.5 py-1.5 bg-paper">{sc.name}</p>
                </button>
              ))}
            </div>
          </div>
          <form action={generateVisualsAction} className="mx-3 mb-3 flex flex-col gap-2 border border-hairline rounded-md p-3">
            <input type="hidden" name="tenantId" value={tenantId} />
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="scheme" value={scheme} />
            <p className="text-xs font-medium">{designed.length ? "Apply scheme & regenerate" : "Generate visuals"}</p>
            <p className="text-xs text-ink-muted">{designed.length} designed{undesigned ? ` · ${undesigned} piece${undesigned === 1 ? "" : "s"} not yet` : ""}. Layouts and tweaks carry over.</p>
            <Choice dense name="approvedOnly" label="Approved pieces only" className="!py-0" />
            <SubmitButton variant="primary" size="sm" pendingLabel="Designing…" className="w-full">{designed.length ? `Regenerate with ${schemes[scheme]?.name ?? "scheme"}` : "Generate visuals"}</SubmitButton>
          </form>
          <Section id="type" icon={Type} title="Typography" open={open} setOpen={setOpen}>
            <p className="text-[1.4rem] leading-tight" style={{ fontFamily: fontPair.display }}>{fonts[0] ?? "Archivo (house)"}</p>
            <p className="text-[1.2rem] italic mt-1" style={{ fontFamily: fontPair.accent }}>{fonts[1] ?? "Instrument Serif (house)"}</p>
            <p className="text-xs text-ink-faint mt-2">{fontNote(fonts, sourceOf)}</p>
          </Section>
          <Section id="img" icon={ImageIcon} title="Image style" open={open} setOpen={setOpen}>
            <p className="text-sm text-ink-muted leading-relaxed">{imageStyle || "No image style notes yet."}</p>
          </Section>
          <Section id="dims" icon={Ruler} title="Export sizes" open={open} setOpen={setOpen}>
            <ExportSizes />
          </Section>
          <Section id="palette" icon={Palette} title="Palette" open={open} setOpen={setOpen}>
            {/* Each colour with its value written beside it, never in a hover tooltip. */}
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {(palette.length ? palette : ["#0a0a0a", "#6b6b6b", "#ffffff"]).map((c) => (
                <li key={c} className="flex items-center gap-2 min-w-0">
                  <span aria-hidden="true" className="w-6 h-6 shrink-0 rounded-xs border border-hairline" style={{ background: c }} />
                  <span className="text-xs font-mono uppercase truncate">{c}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </aside>
      </RightDock>

      <div className="flex-1 relative min-w-0">
        {/* The view switch: a strip at the top left of the visible canvas, like the tool strip below it. */}
        {items.length > 0 && (
          <div className="hu-strip absolute top-3 left-3 z-20" role="radiogroup" aria-label="Canvas view" onPointerDown={(e) => e.stopPropagation()}>
            {/* The picture tools belong to the designed view: going to the wireframe leaves the tool (what is pinned waits). */}
            <button type="button" role="radio" aria-checked={wire} onClick={() => { setView("wireframe"); setTool(null); setOpenDraft(null); }} className="hu-strip__btn">Wireframe</button>
            <button type="button" role="radio" aria-checked={!wire} disabled={!designed.length} aria-label={designed.length ? undefined : "Design (generate visuals first)"} onClick={() => setView("design")} className="hu-strip__btn">Design</button>
          </div>
        )}
        {items.length === 0 ? (
          <div className="absolute inset-0 canvas-dots flex items-center justify-center p-6">
            <div className="bg-paper border border-hairline rounded-md max-w-md w-full shadow-[var(--shadow)]">
              <EmptyState icon={<ImageIcon size={18} />} title="No visuals generated yet" sub="Pick a scheme on the right and generate. Each piece gets a post image, quote card and carousel with real text over brand colours." action={<Link href={`/w/${tenantId}/p/${projectId}/content`} className={btnClass("secondary")}>Back to Content</Link>} />
            </div>
          </div>
        ) : (
          <Canvas
            tools={wire ? undefined : {
              items: toolItems,
              active: tool,
              // Changing tool keeps what is pinned; only Close and Escape discard it.
              onChange: (id) => { setTool(id as PictureTool | null); openDraftPin(null); },
              onOff: (t) => refuse(t.off ?? NO_PICTURE),
              line: toolLine,
            }}
          >
            <div className="flex flex-col gap-16 p-4 pt-16" data-canvas-bg="1">
              {shown.map((i) => {
                const fmt = formatByKey(i.format);
                const sc = wire ? WIRE : s;
                const fp = wire ? WIRE_FONTS : fontPair;
                const slides = slidesOf(i);
                // Only formats that are carousels get a carousel surface (see formats.ts).
                const usesCarousel = formatUsesCarousel(i.format);
                const d = designOf(i);
                const text = textFor(i, slides);
                const isFocus = focus?.id === i.id;
                // Pictures and comments belong to the designed view; the wireframe stays plain.
                const pic = (k: ArtboardKind) => (wire ? null : pictureFor(i, k));
                const picMenu = (k: ArtboardKind) => !wire && i.visuals[k] && (
                  <PictureMenu
                    has={!!pic(k)}
                    mode={pic(k)?.mode ?? null}
                    hasPrevious={!!pic(k)?.parentId}
                    busy={!!working(i, k)}
                    cutout={pic(k)?.cutout ? { url: pic(k)!.url, name: `${nameOf(i)}-${k}-cutout.png` } : null}
                    onDraw={(mode) => void drawPicture(i, k, mode)}
                    onPrevious={() => { const p0 = pic(k); if (p0?.parentId) switchPicture(i, k, p0.parentId, "previous picture", "", "Couldn't go back a version."); }}
                    onRemove={() => switchPicture(i, k, null, "remove picture", "", "Couldn't take the picture off.")}
                  />
                );
                // One visual under the tools: the picture tools over its picture, the comment pins over all of it.
                const surface = (k: ArtboardKind, child: React.ReactNode) => {
                  const visualId = i.visuals[k];
                  const mine = visualId ? drafts.filter((d) => d.visualId === visualId) : [];
                  const t = wire ? null : tool;
                  const ops = draftOps(i, k);
                  return (
                    <PictureSurface
                      tool={t}
                      pictureKey={pic(k)?.id}
                      lock={t ? lockFor(i, k, t) : null}
                      drafts={mine.filter((d) => d.kind !== "comment")}
                      numbers={draftNumbers}
                      openDraft={openDraft}
                      onStroke={addStroke(i, k)}
                      onDraft={ops}
                      onPick={pickPicture(i, k)}
                      onRefuse={refuse}
                    >
                      <CommentSurface
                        mode={t === "comment" ? "on" : t === "markup" || t === "erase" ? "show" : "off"}
                        // Sent comments show in Comment (done ones only on "Show done", PI-11); while drawing, only what is waiting to be sent.
                        comments={t === "comment" ? commentsOn(visualId).filter((c) => showDone || !isDone(c)) : []}
                        slides={k === "carousel"}
                        numbers={commentNumbers}
                        isUndone={isUndone}
                        drafts={mine.filter((d) => d.kind === "comment")}
                        draftNumbers={draftNumbers}
                        openDraft={openDraft}
                        onDraft={ops}
                        pictureLock={lockFor(i, k, "comment")}
                        onRefuse={refuse}
                        onRetry={retryComment}
                        onDismiss={dismissComment}
                      >
                        {child}
                        {working(i, k) && <WorkingOverlay label={working(i, k)!.label} retrying={working(i, k)!.retrying} />}
                      </CommentSurface>
                    </PictureSurface>
                  );
                };
                // While a tool is in use, a pin's field may reach past its visual's edge.
                const spill = !wire && tool !== null;
                // Under a visual whose picture has the heading drawn into it: stale (the heading changed since), or to be read by the person.
                // Or, under live text, a picture that may still show words the check couldn't remove.
                const headingNote = (k: ArtboardKind) => !wire && (pic(k)?.mode === "with_text" ? (
                  <HeadingCheck stale={stale(i, k)} busy={!!working(i, k)} onRedraw={() => void drawPicture(i, k, "with_text")} onLiveText={() => void drawPicture(i, k, "live_text")} />
                ) : pic(k)?.textLeft && !pic(k)?.cutout && !working(i, k) ? <WordsNote />
                  : pic(k)?.wordsUnchecked && !pic(k)?.cutout && !working(i, k) ? <WordsUncheckedNote busy={checking === `${i.id}:${k}`} onCheck={() => void checkWords(i, k)} /> : null);
                const look = () => lookCheck({
                  palette, fonts, scheme: s, tweaks: d.tweaks, headline: i.hook,
                  fontRendering,
                  fontSource: sourceOf(fonts[0]),
                  logo: !!logo && d.tweaks.logo !== "hidden",
                  logoHidden: !!logo && d.tweaks.logo === "hidden",
                  picture: (["post", "quote", "carousel"] as ArtboardKind[]).some((k) => !!pictureFor(i, k)),
                  // A heading drawn into a picture is not checked by the app: never On brand on its own (lib/visual/look-check).
                  drawnIn: (["post", "quote", "carousel"] as ArtboardKind[]).some((k) => pictureFor(i, k)?.mode === "with_text"),
                  fit: fits[i.id],
                });
                return (
                  <section key={i.id} data-piece={i.id} data-canvas-focus={isFocus ? "1" : undefined} data-canvas-bg="1" onPointerDownCapture={() => setFocusId(i.id)} className={`rounded-xs ${isFocus ? "outline outline-2 outline-accent outline-offset-[14px]" : ""}`}>
                    <div className="flex items-center gap-3 mb-4" data-canvas-bg="1">
                      <p className="label-mono text-ink-faint">{fmt.label} · {i.pillarName ?? "No pillar"} · {i.status}</p>
                      {wire ? (i.scheme === null && <span className="label-mono text-ink-faint">· not designed yet</span>) : <LookBadge result={look()} />}
                      <span className="flex-1" data-canvas-bg="1" />
                      {!wire && <RewriteWords label="headline" onRewrite={(t) => rewriteWords(i, t)} />}
                      <button type="button" onClick={() => setOptions({ item: i, kind: "post" })} className={btnClass("secondary", "sm")}>
                        <LayoutGrid size={14} aria-hidden="true" /> Show me options
                      </button>
                      {/* Downloads and removal belong to designed pieces, not wireframes. */}
                      {!wire && (
                        <>
                          <button type="button" onClick={() => exportSet(i, slides)} disabled={busy !== null} className={btnClass("secondary", "sm")}>
                            {busy === `${i.id}:set` ? <><AgentDots /> Rendering…</> : <><Download size={14} aria-hidden="true" /> Download set</>}
                          </button>
                          <BoardIconButton label="Remove these visuals" onClick={() => setRemoving(i)}><Trash2 size={15} aria-hidden="true" /></BoardIconButton>
                        </>
                      )}
                    </div>
                    <div className="flex gap-8 items-start" data-canvas-bg="1">
                      <div className="shrink-0" style={{ width: DISPLAY_W }} data-canvas-bg="1">
                      <Artboard
                        label={`Post image · ${POST_LAYOUTS.find((l) => l.key === d.layouts.post)?.label}`}
                        meta={fmt.frame.label}
                        width={DISPLAY_W}
                        spill={spill}
                        actions={<>{picMenu("post")}<ExportButton busy={busy === `${i.id}:single`} onClick={() => exportOne(i, "post", `${i.id}:single`, fmt.frame.w, fmt.frame.h)} /></>}
                      >
                        {surface("post", <PostImage layout={d.layouts.post} w={fmt.frame.w} h={fmt.frame.h} s={sc} t={d.tweaks} fonts={fp} brand={brandName} logo={logo} eyebrow={i.pillarName ?? undefined} text={text} frameRef={frameRef(`${i.id}:single`)} picture={pic("post")} />)}
                      </Artboard>
                      {headingNote("post")}
                      </div>
                      <div className="shrink-0" style={{ width: DISPLAY_W }} data-canvas-bg="1">
                      <Artboard
                        label={`Quote card · ${QUOTE_LAYOUTS.find((l) => l.key === d.layouts.quote)?.label}`}
                        meta="1:1 · 1080×1080"
                        width={DISPLAY_W}
                        spill={spill}
                        actions={<>{picMenu("quote")}<ExportButton busy={busy === `${i.id}:quote`} onClick={() => exportOne(i, "quote", `${i.id}:quote`, 1080, 1080)} /></>}
                      >
                        {surface("quote", <QuoteCard layout={d.layouts.quote} s={sc} t={d.tweaks} fonts={fp} brand={brandName} logo={logo} text={text} frameRef={frameRef(`${i.id}:quote`)} picture={pic("quote")} />)}
                      </Artboard>
                      {headingNote("quote")}
                      </div>
                      {usesCarousel && (
                      <div className="shrink-0" style={{ width: slides.length * 170 + (slides.length - 1) * 8 + 16 }} data-canvas-bg="1">
                      <Artboard
                        label={`Carousel ·${CAROUSEL_LAYOUTS.find((l) => l.key === d.layouts.carousel)?.label}`}
                        meta={`${slides.length} frames · 1080×1350`}
                        width={slides.length * 170 + (slides.length - 1) * 8 + 16}
                        spill={spill}
                        actions={<>{picMenu("carousel")}<ExportButton label="Download the carousel frames" busy={busy === `${i.id}:frames`} onClick={() => exportFrames(i, slides)} /></>}
                      >
                        {surface("carousel", <CarouselFrames
                          layout={d.layouts.carousel}
                          slides={slides.map((x) => x.text)}
                          ctaIndex={slides.findIndex((x) => x.src.kind === "cta")}
                          s={sc}
                          t={d.tweaks}
                          fonts={fp}
                          frameWidth={170}
                          text={text}
                          frameRef={(k) => frameRef(`${i.id}:carousel:${k}`)}
                          cover={pic("carousel")}
                          brand={brandName}
                          logo={logo}
                        />)}
                      </Artboard>
                      {headingNote("carousel")}
                      </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </Canvas>
        )}
      </div>

      {options && (
        <OptionsModal
          item={options.item}
          kind={options.kind}
          onKind={(kind) => setOptions({ ...options, kind })}
          design={designOf(options.item)}
          slides={slidesOf(options.item).map((x) => x.text)}
          ctaIndex={slidesOf(options.item).findIndex((x) => x.src.kind === "cta")}
          scheme={s}
          fonts={fontPair}
          brand={brandName}
          logo={logo}
          picture={pictureFor(options.item, options.kind)}
          onClose={() => setOptions(null)}
          onKeep={(kind, key, label) => {
            const d = designOf(options.item);
            changeDesign(options.item, { ...d, layouts: { ...d.layouts, [kind]: key } }, `layout: ${label}`, 0);
            toast(`${KIND_LABEL[kind]}: ${label}`);
          }}
        />
      )}
      {resizing && (
        <ResizeModal url={resizing.url} natural={resizing.natural} fit={resizing.fit} onClose={() => setResizing(null)} onApply={applyResize} />
      )}
      <ConfirmModal
        open={discarding}
        title={`Discard ${drafts.length} change${drafts.length === 1 ? "" : "s"}?`}
        confirmLabel="Discard"
        danger
        onClose={() => setDiscarding(false)}
        onConfirm={discardDrafts}
      >
        What you typed on {drafts.length === 1 ? "it" : "them"} goes too. Undo brings {drafts.length === 1 ? "it" : "them"} back. To keep {drafts.length === 1 ? "it" : "them"} for later, press Escape instead: that only leaves the tool.
      </ConfirmModal>
      <ConfirmModal
        open={removing !== null}
        title="Remove these visuals?"
        confirmLabel="Remove visuals"
        danger
        onClose={() => setRemoving(null)}
        onConfirm={confirmRemove}
      >
        The post image, quote card and carousel for this piece go. The copy stays, and you can generate them again with any scheme.
      </ConfirmModal>
    </div>
  );
}

// ---- live tweaks ------------------------------------------------------------------

function TweakPanel({ item, design, onTweak, onOptions, onReset, onApplyAll, canApplyAll }: {
  item: Item; design: Design; onTweak: (t: Tweaks, label: string) => void; onOptions: (kind: ArtboardKind) => void;
  onReset: () => void; onApplyAll: () => void; canApplyAll: boolean;
}) {
  const t = design.tweaks;
  const set = <K extends keyof Tweaks>(k: K, v: Tweaks[K], label: string) => onTweak({ ...t, [k]: v }, label);
  const isDefault = JSON.stringify(design) === JSON.stringify(DEFAULT_DESIGN);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-ink-muted leading-relaxed line-clamp-2">“{item.hook}”</p>

      <div>
        <div className="flex items-baseline justify-between mb-1">
          <p className="text-xs font-medium">Type size</p>
          <span className="text-xs num text-ink-muted">{Math.round(t.scale * 100)}%</span>
        </div>
        <ScaleSlider value={clampScale(t.scale * 100)} onChange={(pct) => set("scale", pct / 100, "type size")} />
      </div>
      <div>
        <p className="text-xs font-medium mb-1.5">Alignment</p>
        <Segmented label="Alignment" value={t.align} onChange={(v) => set("align", v, "alignment")} items={[{ value: "left", label: "Left" }, { value: "center", label: "Centre" }]} />
      </div>
      <div>
        <p className="text-xs font-medium mb-1.5">Accent</p>
        <Segmented label="Accent use" value={t.accent} onChange={(v) => set("accent", v, "accent")} items={[{ value: "none", label: "None" }, { value: "subtle", label: "Subtle" }, { value: "bold", label: "Bold" }]} />
      </div>
      <div>
        <p className="text-xs font-medium mb-1.5">Background</p>
        <Segmented label="Background" value={t.background} onChange={(v) => set("background", v, "background")} items={[{ value: "scheme", label: "Scheme" }, { value: "inverse", label: "Inverse" }, { value: "tint", label: "Tint" }]} />
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium">Layouts</p>
        {/* No carousel row for a format that has no carousel (an X post, say): the board draws none either. */}
        {artboardsFor(item.format).map((k) => {
          const list = k === "post" ? POST_LAYOUTS : k === "quote" ? QUOTE_LAYOUTS : CAROUSEL_LAYOUTS;
          const cur = list.find((l) => l.key === design.layouts[k])?.label;
          return (
            <button key={k} type="button" onClick={() => onOptions(k)} className="flex items-center justify-between min-h-11 px-3 rounded-sm border border-hairline hover:border-line text-sm">
              <span>{KIND_LABEL[k]}</span>
              <span className="text-xs text-ink-muted">{cur} · {list.length} options</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onReset} disabled={isDefault} className={btnClass("ghost", "sm")}><RotateCcw size={14} aria-hidden="true" /> Reset</button>
        {canApplyAll && <button type="button" onClick={onApplyAll} className={btnClass("secondary", "sm")}><Copy size={14} aria-hidden="true" /> Apply to every piece</button>}
      </div>
      <p className="text-xs text-ink-faint">Redraws as you change it and saves a moment after. <Shortcut keys="Z" /> undoes.</p>
    </div>
  );
}

// ---- show me options -----------------------------------------------------------------

function OptionsModal({ item, kind, onKind, design, slides, ctaIndex, scheme, fonts, brand, logo, picture, onClose, onKeep }: {
  item: Item; kind: ArtboardKind; onKind: (k: ArtboardKind) => void; design: Design; slides: string[]; ctaIndex: number;
  scheme: ReturnType<typeof schemesFrom>[number]; fonts: Fonts; brand: string; logo: string | null; onClose: () => void;
  /** The picture on this artboard, if it has one: every option is shown with it, as it will look. */
  picture: { url: string; mode: PictureMode; cutout?: boolean } | null;
  onKeep: (kind: ArtboardKind, key: string, label: string) => void;
}) {
  const fmt = formatByKey(item.format);
  const plain: RenderText = (slot) => (slot.kind === "slide" ? slides[slot.index] : item.hook);
  const list = kind === "post" ? POST_LAYOUTS : kind === "quote" ? QUOTE_LAYOUTS : CAROUSEL_LAYOUTS;
  const current = design.layouts[kind];
  const t = design.tweaks ?? DEFAULT_TWEAKS;
  return (
    <Modal open onClose={onClose} title="Show me options" width={1180}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            label="Artboard"
            value={kind}
            onSelect={onKind}
            items={artboardsFor(item.format).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          />
          <p className="text-xs text-ink-muted">In this piece&apos;s words, scheme, tweaks{picture ? " and picture" : ""}. Keep one; the others stay a click away.</p>
        </div>
        {picture?.mode === "with_text" && (
          <p className="text-sm text-ink-muted">The heading is drawn into this picture, so the picture fills the visual whichever layout you keep (cropping it would cut the words). Switch to live text from the picture menu to place the picture and the words separately.</p>
        )}
        <div className={`grid gap-5 ${kind === "carousel" ? "grid-cols-1 lg:grid-cols-3" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"}`}>
          {list.map((l) => {
            const on = l.key === current;
            return (
              <div key={l.key} className={`rounded-md border p-3 flex flex-col gap-3 ${on ? "border-ink ring-1 ring-ink" : "border-hairline"}`}>
                <div className="theme-light rounded-xs overflow-hidden ring-1 ring-[var(--hairline)] pointer-events-none">
                  {kind === "post" ? (
                    <PostImage layout={l.key as never} w={fmt.frame.w} h={fmt.frame.h} s={scheme} t={t} fonts={fonts} brand={brand} logo={logo} eyebrow={item.pillarName ?? undefined} text={plain} picture={picture} />
                  ) : kind === "quote" ? (
                    <QuoteCard layout={l.key as never} s={scheme} t={t} fonts={fonts} brand={brand} logo={logo} text={plain} picture={picture} />
                  ) : (
                    <div className="overflow-hidden"><CarouselFrames layout={l.key as never} slides={slides.slice(0, 3)} ctaIndex={ctaIndex < 3 ? ctaIndex : -1} s={scheme} t={t} fonts={fonts} frameWidth={104} text={plain} cover={picture} brand={brand} logo={logo} /></div>
                  )}
                </div>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{l.label}</p>
                    <p className="text-xs text-ink-muted mt-0.5">{l.about}</p>
                  </div>
                  {on ? (
                    <Badge tone="ok"><Check size={10} aria-hidden="true" /> Current</Badge>
                  ) : (
                    <button type="button" onClick={() => onKeep(kind, l.key, l.label)} className={btnClass("primary", "sm")}>Keep this</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

const REWRITE_CHIPS = ["Shorter", "Punchier", "More contrarian", "Warmer", "As a question"];

/**
 * "Rewrite the words" for the words on the visuals: its own button and box, so a
 * double-click on the words only ever edits them in place. Enter, or Ctrl/⌘+Enter,
 * sends. A failed rewrite keeps the box open with its words.
 */
function RewriteWords({ label, onRewrite }: { label: string; onRewrite: (instruction: string) => Promise<void> }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (raw: string) => {
    const t = raw.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await onRewrite(t);
      setText("");
      setOpen(false);
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : "That didn't go through.", "danger");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="relative" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" aria-expanded={open} disabled={busy} onClick={() => setOpen((o) => !o)} className={btnClass("secondary", "sm")}>
        {busy ? <><AgentDots /> Rewriting…</> : <><Sparkles size={14} aria-hidden="true" /> Rewrite the words</>}
      </button>
      {open && (
        <div role="dialog" aria-label={`Rewrite the ${label}`} className="absolute left-0 top-11 z-20 w-80 bg-paper border border-hairline rounded-md shadow-[var(--shadow-overlay)] p-2.5 flex flex-col gap-2">
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") { e.preventDefault(); void send(text); }
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder={`Change this ${label}…`}
            aria-label={`What to change in this ${label}`}
            disabled={busy}
            className="min-h-10 bg-transparent outline-none text-sm px-2 border border-hairline rounded-sm"
          />
          <div className="flex flex-wrap gap-1">
            {REWRITE_CHIPS.map((c) => (
              <button key={c} type="button" disabled={busy} onClick={() => void send(c)} className="h-8 px-2.5 rounded-full border border-line text-xs hover:bg-hover disabled:opacity-40">{c}</button>
            ))}
          </div>
          <p className="text-xs text-ink-faint">Rewritten in your voice and applied to the words on every visual. Undo brings it back.</p>
        </div>
      )}
    </div>
  );
}

function ExportButton({ busy, onClick, label = "Download PNG" }: { busy: boolean; onClick: () => void; label?: string }) {
  return (
    // Shown on hover where there is one; always shown on a touch screen, which has none (PI-10).
    <BoardIconButton label={label} onClick={onClick} disabled={busy} className="opacity-0 group-hover/board:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100">
      {busy ? <AgentDots /> : <Download size={14} aria-hidden="true" />}
    </BoardIconButton>
  );
}

function Section({ id, icon: Icon, title, open, setOpen, children }: { id: string; icon: typeof Type; title: string; open: string | null; setOpen: (v: string | null) => void; children: React.ReactNode }) {
  const on = open === id;
  return (
    <div className="border-t border-hairline first:border-t-0">
      <button onClick={() => setOpen(on ? null : id)} aria-expanded={on} className="w-full flex items-center gap-2.5 h-11 px-3 hover:bg-field/60">
        <Icon size={14} /> <span className="label-mono flex-1 text-left">{title}</span>
        <ChevronDown size={14} className={`text-ink-faint transition-transform ${on ? "rotate-180" : ""}`} />
      </button>
      {on && <div className="px-3 pb-4 fade-in">{children}</div>}
    </div>
  );
}

/** Where the brand fonts on these visuals come from, said under the Typography samples. */
function fontNote(fonts: string[], sourceOf: (name: string | undefined) => FontSource): string {
  if (!fonts.length) return "No brand fonts set, so the house faces draw the visuals. Add yours in Brand core, Visual.";
  const say = (name: string) => {
    const src = sourceOf(name);
    return src === "upload" ? `${name} from your uploaded file` : src === "google" ? `${name} from Google Fonts` : `${name} isn't loaded (upload its WOFF2, WOFF, TTF or OTF file in Brand core, Visual), so a house face stands in`;
  };
  return `${fonts.slice(0, 2).map(say).join("; ")}. The PNG downloads use the same fonts.`;
}

const LOOK_LABEL = { on: "On brand", drift: "Drifting", off: "Off brand" } as const;
const LOOK_DOT = { on: "bg-[var(--ok-line)]", drift: "bg-[var(--warn-line)]", off: "bg-[var(--danger-line)]" } as const;

/**
 * Hue Check, "On-brand look?" (lib/visual/look-check): the score and band,
 * shape plus word plus colour, with what it measured one click away. Like the
 * voice check it never blocks a download.
 */
function LookBadge({ result }: { result: LookResult }) {
  return (
    <details className="relative" onPointerDown={(e) => e.stopPropagation()}>
      <summary className="list-none cursor-pointer inline-flex items-center gap-2 min-h-11 px-3 rounded-full border border-line bg-paper text-sm hover:border-line-strong">
        <span className={`w-2 h-2 rounded-full ${LOOK_DOT[result.band]}`} aria-hidden="true" />
        Look <span className="num font-medium">{result.score}</span> · {LOOK_LABEL[result.band]}
      </summary>
      <div className="absolute left-0 top-12 w-80 z-20 bg-paper border border-hairline rounded-xl shadow-[var(--shadow-lg)] p-4 flex flex-col gap-2.5">
        <p className="label-mono text-ink-faint">On-brand look</p>
        {result.findings.map((f, n) => (
          <p key={n} className="text-sm flex gap-2">
            <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${LOOK_DOT[f.verdict]}`} aria-hidden="true" />
            <span><span className="sr-only">{LOOK_LABEL[f.verdict]}: </span>{f.text}</span>
          </p>
        ))}
      </div>
    </details>
  );
}
