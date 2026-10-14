"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Type, Image as ImageIcon, Ruler, ChevronDown, Palette, AlertTriangle, SlidersHorizontal, X, Download, Trash2, LayoutGrid, Check, RotateCcw, Copy } from "lucide-react";
import { AgentDots, Badge, IconButton, Modal, Segmented, SubmitButton, Tabs, useToast } from "@/components/ui";
import { ConfirmModal } from "@/components/confirm-modal";
import { fileSlug, nodeToPngBlob, saveBlob, zipBlobs } from "@/lib/ui/png";
import { deleteVisualsAction, generateVisualsAction, saveDesignAction } from "../pipeline-actions";
import { Canvas, Artboard } from "@/components/canvas";
import { CanvasHistory, EditableText, useCanvasHistory } from "@/components/canvas-edit";
import { askRewriteAction, patchContentAction } from "../content/actions";
import { EmptyState } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { FORMATS, formatByKey } from "@/lib/content/formats";
import { stepLabel } from "@/lib/projects/stages";
import {
  CAROUSEL_LAYOUTS, DEFAULT_DESIGN, DEFAULT_TWEAKS, POST_LAYOUTS, QUOTE_LAYOUTS, sameDesign,
  type ArtboardKind, type Design, type Tweaks,
} from "@/lib/visual/design";
import { CarouselFrames, PostImage, QuoteCard, schemesFrom, type Fonts, type RenderText } from "./visual-layouts";

type Item = {
  id: string; format: string; hook: string; body: string; cta: string; status: string; pillarName: string | null;
  scheme: number | null; design: Design | null;
};

/** Where a carousel slide's text lives in the post, so a slide edit writes back to it. */
type Slide = { text: string; src: { kind: "hook" } | { kind: "body"; part: number } | { kind: "cta" } };

/** Split body copy into carousel slides: one idea (paragraph/list line) each. */
function slidesOf(i: Item): Slide[] {
  const parts = i.body.split(/(\n+)/); // keeps the separators, so edits preserve spacing
  const body = parts
    .map((t, part) => ({ t: t.trim(), part }))
    .filter((x) => x.part % 2 === 0 && x.t)
    .slice(0, 5)
    .map((x): Slide => ({ text: x.t, src: { kind: "body", part: x.part } }));
  return [
    { text: i.hook, src: { kind: "hook" } },
    ...body,
    ...(i.cta ? [{ text: i.cta, src: { kind: "cta" } } as Slide] : []),
  ];
}

/** The post field a slide edit changes. An emptied body slide drops that paragraph. */
function patchForSlide(i: Item, slide: Slide, text: string): { hook?: string; body?: string; cta?: string } {
  if (slide.src.kind === "hook") return { hook: text };
  if (slide.src.kind === "cta") return { cta: text };
  const parts = i.body.split(/(\n+)/);
  if (text) parts[slide.src.part] = text;
  else parts.splice(slide.src.part, slide.src.part + 1 < parts.length ? 2 : 1);
  return { body: parts.join("").replace(/^\n+|\n+$/g, "") };
}

const DISPLAY_W = 300;
const KIND_LABEL: Record<ArtboardKind, string> = { post: "Post image", quote: "Quote card", carousel: "Carousel" };

type BoardProps = {
  tenantId: string; projectId: string; brandName: string; items: Item[]; palette: string[]; fonts: string[]; imageStyle: string; selectedId: string | null; initialScheme: number;
};

/**
 * Visual step (Relume's design + style guide, worked like a design tool):
 *
 *   - Every artboard's text is editable (double-click) and askable (click,
 *     then say what to change). Edits write back to the post's copy, so
 *     Content and Export stay in step.
 *   - Each artboard kind has several layouts. "Show me options" lays them out
 *     side by side in this piece's own words and colours; keep one.
 *   - Live tweaks for the selected piece (type size, alignment, accent,
 *     background) redraw as they move and save a moment after.
 *   - Cmd/Ctrl+Z undoes copy edits, layout picks and tweaks alike.
 */
export function VisualBoard(props: BoardProps) {
  return (
    <CanvasHistory>
      <Board {...props} />
    </CanvasHistory>
  );
}

function Board({ tenantId, projectId, brandName, items, palette, fonts, imageStyle, selectedId, initialScheme }: BoardProps) {
  const history = useCanvasHistory();
  const router = useRouter();
  const toast = useToast();

  // ---- copy: edit and ask ----------------------------------------------------
  const edit = useCallback((i: Item, next: { hook?: string; body?: string; cta?: string }, label: string, asked = false) => {
    const prev = Object.fromEntries(Object.keys(next).map((k) => [k, i[k as "hook" | "body" | "cta"]]));
    // A rewrite the person asked for is the model's words, so it is not learned from.
    const opts = { learn: !asked };
    history.push({ label, undo: () => patchContentAction(tenantId, projectId, i.id, prev, opts), redo: () => patchContentAction(tenantId, projectId, i.id, next, opts) });
    return patchContentAction(tenantId, projectId, i.id, next, opts);
  }, [history, tenantId, projectId]);
  const askFor = useCallback((i: Item, part: string) => async (instruction: string, current: string) => {
    const r = await askRewriteAction(tenantId, projectId, i.id, { part, text: current, instruction });
    if (!r.ok) throw new Error(r.error);
    return r.text;
  }, [tenantId, projectId]);

  // ---- schemes ----------------------------------------------------------------
  const schemes = useMemo(() => schemesFrom(palette), [palette]);
  const [scheme, setScheme] = useState(initialScheme);
  const s = schemes[scheme] ?? schemes[0];
  const fontPair: Fonts = {
    display: fonts[0] ? `"${fonts[0]}", var(--font-sans)` : "var(--font-sans)",
    accent: fonts[1] ? `"${fonts[1]}", var(--font-serif)` : "var(--font-serif)",
  };

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

  const designed = items.filter((i) => i.scheme !== null);
  const undesigned = items.length - designed.length;
  const ordered = [...designed].sort((x, y) => (x.status === "approved" ? -1 : 0) - (y.status === "approved" ? -1 : 0));
  const [focusId, setFocusId] = useState<string | null>(selectedId);
  const focus = ordered.find((i) => i.id === focusId) ?? ordered[0] ?? null;

  const [open, setOpen] = useState<string | null>("design");
  // Phones: the style guide opens over the canvas from a button (as StepPanel does).
  const [details, setDetails] = useState(false);
  const [options, setOptions] = useState<{ item: Item; kind: ArtboardKind } | null>(null);

  // ---- export -----------------------------------------------------------------
  const frames = useRef(new Map<string, HTMLDivElement>());
  const frameRef = (key: string) => (el: HTMLDivElement | null) => {
    if (el) frames.current.set(key, el);
    else frames.current.delete(key);
  };
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Item | null>(null);

  const exportOne = async (key: string, w: number, h: number, name: string) => {
    const node = frames.current.get(key);
    if (!node) return;
    setBusy(key);
    try {
      saveBlob(await nodeToPngBlob(node, w, h), `${name}.png`);
      toast(`Saved ${name}.png`);
    } catch {
      toast("Couldn't render that image. Try again.", "danger");
    } finally {
      setBusy(null);
    }
  };
  const exportSet = async (i: Item, slides: Slide[]) => {
    const fmt = formatByKey(i.format);
    const base = `${fileSlug(brandName)}-${fileSlug(i.hook).slice(0, 32)}`;
    setBusy(`${i.id}:set`);
    try {
      const files: { name: string; blob: Blob }[] = [];
      const post = frames.current.get(`${i.id}:single`);
      if (post) files.push({ name: `${base}-post-${fmt.frame.w}x${fmt.frame.h}.png`, blob: await nodeToPngBlob(post, fmt.frame.w, fmt.frame.h) });
      const quote = frames.current.get(`${i.id}:quote`);
      if (quote) files.push({ name: `${base}-quote-1080x1080.png`, blob: await nodeToPngBlob(quote, 1080, 1080) });
      for (let k = 0; k < slides.length; k++) {
        const f = frames.current.get(`${i.id}:carousel:${k}`);
        if (f) files.push({ name: `${base}-carousel-${String(k + 1).padStart(2, "0")}-1080x1350.png`, blob: await nodeToPngBlob(f, 1080, 1350) });
      }
      if (!files.length) throw new Error("nothing to export");
      saveBlob(await zipBlobs(files), `${base}-visuals.zip`);
      toast(`Saved ${files.length} images as a zip`);
    } catch {
      toast("Couldn't render the set. Try again.", "danger");
    } finally {
      setBusy(null);
    }
  };
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
      return (
        <EditableText
          value={i.hook}
          required
          label={what}
          onAsk={askFor(i, slot.kind === "post" ? "Post image headline" : "Quote card line")}
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

  return (
    <div className="absolute inset-0 flex flex-row-reverse">
      <button
        type="button"
        onClick={() => setDetails(true)}
        aria-expanded={details}
        className="min-[900px]:hidden absolute top-[4.25rem] right-3 z-20 inline-flex items-center gap-2 min-h-11 px-4 rounded-full bg-paper border border-hairline shadow-[var(--shadow)] text-sm font-medium"
      >
        <SlidersHorizontal size={15} aria-hidden="true" /> Design
      </button>
      <aside aria-label="Design and style guide" className={`${details ? "flex" : "hidden"} min-[900px]:flex absolute min-[900px]:static inset-y-0 right-0 z-30 min-[900px]:z-10 w-[min(320px,100%)] min-[900px]:w-[300px] shadow-[var(--shadow-overlay)] min-[900px]:shadow-none shrink-0 border-l border-hairline bg-paper flex-col min-h-0`}>
        <div className="min-h-10 shrink-0 flex items-center pl-3 pr-1 border-b border-hairline">
          <span className="label-mono text-ink-faint flex-1">{stepLabel("visual")} · Visual</span>
          <span className="min-[900px]:hidden"><IconButton label="Close design panel" onClick={() => setDetails(false)}><X size={17} /></IconButton></span>
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

          <div className="p-3 grid grid-cols-2 gap-2 border-t border-hairline">
            {schemes.map((sc, i) => (
              <button key={sc.name} onClick={() => setScheme(i)} className={`rounded-md overflow-hidden border text-left transition-colors ${i === scheme ? "border-ink ring-1 ring-ink" : "border-hairline hover:border-line"}`}>
                <div className="h-14 flex items-center justify-between px-3" style={{ background: sc.bg }}>
                  <span className="text-[1.2rem] font-medium leading-none" style={{ color: sc.fg }}>Aa<span className="block h-[3px] w-6 mt-1 rounded-full" style={{ background: sc.accent }} /></span>
                  <span className="w-6 h-6 rounded-sm border border-black/10" style={{ background: sc.accent }} />
                </div>
                <p className="text-xs px-2.5 py-1.5 bg-paper">{sc.name}</p>
              </button>
            ))}
          </div>
          <form action={generateVisualsAction} className="mx-3 mb-3 flex flex-col gap-2 border border-hairline rounded-md p-3">
            <input type="hidden" name="tenantId" value={tenantId} />
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="scheme" value={scheme} />
            <p className="text-xs font-medium">{designed.length ? "Apply scheme & regenerate" : "Generate visuals"}</p>
            <p className="text-xs text-ink-muted">{designed.length} designed{undesigned ? ` · ${undesigned} piece${undesigned === 1 ? "" : "s"} not yet` : ""}. Layouts and tweaks carry over.</p>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="approvedOnly" /> Approved pieces only</label>
            <SubmitButton variant="primary" size="sm" pendingLabel="Designing…" className="w-full">{designed.length ? `Regenerate with ${schemes[scheme]?.name ?? "scheme"}` : "Generate visuals"}</SubmitButton>
          </form>
          <Section id="type" icon={Type} title="Typography" open={open} setOpen={setOpen}>
            <p className="text-[1.4rem] leading-tight" style={{ fontFamily: fontPair.display }}>{fonts[0] ?? "Archivo (house)"}</p>
            <p className="text-[1.2rem] italic mt-1" style={{ fontFamily: fontPair.accent }}>{fonts[1] ?? "Instrument Serif (house)"}</p>
            <p className="text-xs text-ink-faint mt-2">Brand fonts render only if installed; licence check for server rendering is an open decision (brief §09).</p>
          </Section>
          <Section id="img" icon={ImageIcon} title="Image style" open={open} setOpen={setOpen}>
            <p className="text-sm text-ink-muted leading-relaxed">{imageStyle || "No image style notes yet."}</p>
          </Section>
          <Section id="dims" icon={Ruler} title="Export sizes" open={open} setOpen={setOpen}>
            <ul className="text-xs flex flex-col gap-1">
              {Array.from(new Map(FORMATS.map((f) => [f.frame.label, f])).values()).map((f) => (
                <li key={f.key} className="flex justify-between gap-2"><span className="text-ink-muted">{f.label}</span><span className="tabular-nums">{f.frame.label}</span></li>
              ))}
            </ul>
          </Section>
          <Section id="palette" icon={Palette} title="Palette" open={open} setOpen={setOpen}>
            <div className="flex flex-wrap gap-1.5">
              {(palette.length ? palette : ["#0a0a0a", "#6b6b6b", "#ffffff"]).map((c) => (
                <span key={c} title={c} className="w-8 h-8 rounded-sm border border-hairline" style={{ background: c }} />
              ))}
            </div>
          </Section>
        </div>
      </aside>

      <div className="flex-1 relative min-w-0">
        {designed.length === 0 ? (
          <div className="absolute inset-0 canvas-dots flex items-center justify-center p-6">
            <div className="bg-paper border border-hairline rounded-md max-w-md w-full shadow-[var(--shadow)]">
              <EmptyState icon={<ImageIcon size={18} />} title="No visuals generated yet" sub="Pick a scheme on the right and generate. Each piece gets a post image, quote card and carousel with real text over brand colours." action={<Link href={`/w/${tenantId}/p/${projectId}/content`} className={btnClass("secondary")}>Back to Content</Link>} />
            </div>
          </div>
        ) : (
          <Canvas>
            <div className="flex flex-col gap-16 p-4" data-canvas-bg="1">
              {ordered.map((i) => {
                const fmt = formatByKey(i.format);
                const slides = slidesOf(i);
                const d = designOf(i);
                const text = textFor(i, slides);
                const isFocus = focus?.id === i.id;
                return (
                  <section key={i.id} data-canvas-bg="1" onPointerDownCapture={() => setFocusId(i.id)} className={`rounded-xs ${isFocus ? "outline outline-2 outline-accent outline-offset-[14px]" : ""}`}>
                    <div className="flex items-center gap-3 mb-4" data-canvas-bg="1">
                      <p className="label-mono text-ink-faint">{fmt.label} · {i.pillarName ?? "No pillar"} · {i.status}</p>
                      <span className="flex-1" data-canvas-bg="1" />
                      <button type="button" onClick={() => setOptions({ item: i, kind: "post" })} className={btnClass("secondary", "sm")}>
                        <LayoutGrid size={14} aria-hidden="true" /> Show me options
                      </button>
                      <button type="button" onClick={() => exportSet(i, slides)} disabled={busy !== null} className={btnClass("secondary", "sm")}>
                        {busy === `${i.id}:set` ? <><AgentDots /> Rendering…</> : <><Download size={14} aria-hidden="true" /> Download set</>}
                      </button>
                      <IconButton label="Remove these visuals" onClick={() => setRemoving(i)}><Trash2 size={15} /></IconButton>
                    </div>
                    <div className="flex gap-8 items-start" data-canvas-bg="1">
                      <Artboard
                        label={`Post image · ${POST_LAYOUTS.find((l) => l.key === d.layouts.post)?.label}`}
                        meta={fmt.frame.label}
                        width={DISPLAY_W}
                        actions={<ExportButton busy={busy === `${i.id}:single`} onClick={() => exportOne(`${i.id}:single`, fmt.frame.w, fmt.frame.h, `${fileSlug(brandName)}-post-${fmt.frame.w}x${fmt.frame.h}`)} />}
                      >
                        <PostImage layout={d.layouts.post} w={fmt.frame.w} h={fmt.frame.h} s={s} t={d.tweaks} fonts={fontPair} brand={brandName} eyebrow={i.pillarName ?? undefined} text={text} frameRef={frameRef(`${i.id}:single`)} />
                      </Artboard>
                      <Artboard
                        label={`Quote card · ${QUOTE_LAYOUTS.find((l) => l.key === d.layouts.quote)?.label}`}
                        meta="1:1 · 1080×1080"
                        width={DISPLAY_W}
                        actions={<ExportButton busy={busy === `${i.id}:quote`} onClick={() => exportOne(`${i.id}:quote`, 1080, 1080, `${fileSlug(brandName)}-quote-1080x1080`)} />}
                      >
                        <QuoteCard layout={d.layouts.quote} s={s} t={d.tweaks} fonts={fontPair} brand={brandName} text={text} frameRef={frameRef(`${i.id}:quote`)} />
                      </Artboard>
                      <Artboard
                        label={`Carousel · ${CAROUSEL_LAYOUTS.find((l) => l.key === d.layouts.carousel)?.label}`}
                        meta={`${slides.length} frames · 1080×1350`}
                        width={slides.length * 170 + (slides.length - 1) * 8 + 16}
                        actions={<ExportButton label="Download all frames" busy={busy === `${i.id}:set`} onClick={() => exportSet(i, slides)} />}
                      >
                        <CarouselFrames
                          layout={d.layouts.carousel}
                          slides={slides.map((x) => x.text)}
                          ctaIndex={slides.findIndex((x) => x.src.kind === "cta")}
                          s={s}
                          t={d.tweaks}
                          fonts={fontPair}
                          frameWidth={170}
                          text={text}
                          frameRef={(k) => frameRef(`${i.id}:carousel:${k}`)}
                        />
                      </Artboard>
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
          onClose={() => setOptions(null)}
          onKeep={(kind, key, label) => {
            const d = designOf(options.item);
            changeDesign(options.item, { ...d, layouts: { ...d.layouts, [kind]: key } }, `layout: ${label}`, 0);
            toast(`${KIND_LABEL[kind]}: ${label}`);
          }}
        />
      )}
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
        <input
          type="range"
          min={80}
          max={140}
          step={5}
          value={Math.round(t.scale * 100)}
          onChange={(e) => set("scale", Number(e.target.value) / 100, "type size")}
          className="w-full accent-[var(--accent)] min-h-11"
          aria-label="Type size"
        />
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
        {(["post", "quote", "carousel"] as ArtboardKind[]).map((k) => {
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
      <p className="text-xs text-ink-faint">Redraws as you change it and saves a moment after. ⌘Z undoes.</p>
    </div>
  );
}

// ---- show me options -----------------------------------------------------------------

function OptionsModal({ item, kind, onKind, design, slides, ctaIndex, scheme, fonts, brand, onClose, onKeep }: {
  item: Item; kind: ArtboardKind; onKind: (k: ArtboardKind) => void; design: Design; slides: string[]; ctaIndex: number;
  scheme: ReturnType<typeof schemesFrom>[number]; fonts: Fonts; brand: string; onClose: () => void;
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
            items={(["post", "quote", "carousel"] as ArtboardKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          />
          <p className="text-xs text-ink-muted">In this piece&apos;s words, scheme and tweaks. Keep one; the others stay a click away.</p>
        </div>
        <div className={`grid gap-5 ${kind === "carousel" ? "grid-cols-1 lg:grid-cols-3" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"}`}>
          {list.map((l) => {
            const on = l.key === current;
            return (
              <div key={l.key} className={`rounded-md border p-3 flex flex-col gap-3 ${on ? "border-ink ring-1 ring-ink" : "border-hairline"}`}>
                <div className="theme-light rounded-xs overflow-hidden ring-1 ring-[var(--hairline)] pointer-events-none">
                  {kind === "post" ? (
                    <PostImage layout={l.key as never} w={fmt.frame.w} h={fmt.frame.h} s={scheme} t={t} fonts={fonts} brand={brand} eyebrow={item.pillarName ?? undefined} text={plain} />
                  ) : kind === "quote" ? (
                    <QuoteCard layout={l.key as never} s={scheme} t={t} fonts={fonts} brand={brand} text={plain} />
                  ) : (
                    <div className="overflow-hidden"><CarouselFrames layout={l.key as never} slides={slides.slice(0, 3)} ctaIndex={ctaIndex < 3 ? ctaIndex : -1} s={scheme} t={t} fonts={fonts} frameWidth={104} text={plain} /></div>
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

function ExportButton({ busy, onClick, label = "Download PNG" }: { busy: boolean; onClick: () => void; label?: string }) {
  return (
    <IconButton label={label} onClick={onClick} disabled={busy} className="opacity-0 group-hover/board:opacity-100 focus-visible:opacity-100">
      {busy ? <AgentDots /> : <Download size={14} />}
    </IconButton>
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
