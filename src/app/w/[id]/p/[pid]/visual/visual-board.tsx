"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Type, Image as ImageIcon, Ruler, ChevronDown, Palette, AlertTriangle } from "lucide-react";
import { SubmitButton } from "@/components/ui";
import { generateVisualsAction } from "../pipeline-actions";
import { Canvas, Artboard } from "@/components/canvas";
import { CanvasHistory, EditableText, useCanvasHistory } from "@/components/canvas-edit";
import { patchContentAction } from "../content/actions";
import { EmptyState } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { FORMATS, formatByKey } from "@/lib/content/formats";

type Item = { id: string; format: string; hook: string; body: string; cta: string; status: string; pillarName: string | null; scheme: number | null };
type Scheme = { name: string; bg: string; fg: string; accent: string };

/**
 * Colour schemes derived from the brand palette (Relume's Style Guide "Scheme
 * 1…n"). With no palette set, the house tokens stand in and the UI says so.
 */
function schemesFrom(palette: string[]): Scheme[] {
  const [a, b, c, d] = palette.length ? palette : ["#0a0a0a", "#6b6b6b", "#ffffff"];
  const light = c ?? "#ffffff";
  const candidates = [a, light, b, d, "#0a0a0a", "#ffffff"].filter(Boolean) as string[];
  // Text colour = the palette colour with the most contrast on that background.
  const on = (bg: string) => candidates.reduce((best, x) => (contrast(x, bg) > contrast(best, bg) ? x : best));
  const mk = (name: string, bg: string, accent: string): Scheme => ({ name, bg, fg: on(bg), accent: contrast(accent, bg) > 1.5 ? accent : on(bg) });
  const out: Scheme[] = [mk("Scheme 1", light, b ?? a), mk("Scheme 2", a, b ?? light)];
  if (b && b.toLowerCase() !== light.toLowerCase()) out.push(mk("Scheme 3", b, a));
  if (d) out.push(mk(`Scheme ${out.length + 1}`, d, b ?? a));
  return out;
}

function luminance(hex: string): number {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((x) => x + x).join("") : m.slice(0, 6);
  const [r, g, bl] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}
function contrast(x: string, y: string): number {
  if (!/^#[0-9a-f]{3,8}$/i.test(x) || !/^#[0-9a-f]{3,8}$/i.test(y)) return 1;
  const [l1, l2] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (l1 + 0.05) / (l2 + 0.05);
}

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

type BoardProps = {
  tenantId: string; projectId: string; brandName: string; items: Item[]; palette: string[]; fonts: string[]; imageStyle: string; selectedId: string | null; initialScheme: number;
};

/**
 * Visual step (Relume's design + style guide). The artboards are editable:
 * double-click the text on a post image, quote card or carousel slide to
 * change it. Edits write back to the post's copy, so Content and Export stay
 * in step. Cmd/Ctrl+Z undoes.
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
  const edit = useCallback((i: Item, next: { hook?: string; body?: string; cta?: string }, label: string) => {
    const prev = Object.fromEntries(Object.keys(next).map((k) => [k, i[k as "hook" | "body" | "cta"]]));
    history.push({ label, undo: () => patchContentAction(tenantId, projectId, i.id, prev), redo: () => patchContentAction(tenantId, projectId, i.id, next) });
    return patchContentAction(tenantId, projectId, i.id, next);
  }, [history, tenantId, projectId]);
  const schemes = useMemo(() => schemesFrom(palette), [palette]);
  const [scheme, setScheme] = useState(initialScheme);
  const designed = items.filter((i) => i.scheme !== null);
  const undesigned = items.length - designed.length;
  const [open, setOpen] = useState<string | null>("type");
  const s = schemes[scheme] ?? schemes[0];
  const display = fonts[0] ? `"${fonts[0]}", var(--font-sans)` : "var(--font-sans)";
  const accentFont = fonts[1] ? `"${fonts[1]}", var(--font-serif)` : "var(--font-serif)";
  const ordered = [...designed].sort((x, y) => (x.status === "approved" ? -1 : 0) - (y.status === "approved" ? -1 : 0));

  return (
    <div className="absolute inset-0 flex flex-row-reverse">
      {(
        <aside className="w-[280px] shrink-0 border-l border-hairline bg-paper flex flex-col min-h-0 z-10">
          <div className="h-10 shrink-0 flex items-center px-3 border-b border-hairline">
            <span className="label-mono text-ink-faint flex-1">Step 4 · Visual · Style guide</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {!palette.length && (
              <Link href={`/w/${tenantId}/p/${projectId}/brief/edit#visual`} className="m-3 flex gap-2 bg-accent-soft rounded-[10px] px-3 py-2.5 text-[0.78rem] text-accent-ink">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" /> No brand palette yet, so these use the house colours. Add one in the brief →
              </Link>
            )}
            <div className="p-3 grid grid-cols-2 gap-2">
              {schemes.map((sc, i) => (
                <button key={sc.name} onClick={() => setScheme(i)} className={`rounded-[10px] overflow-hidden border text-left transition-colors ${i === scheme ? "border-ink ring-1 ring-ink" : "border-hairline hover:border-line"}`}>
                  <div className="h-16 flex items-center justify-between px-3" style={{ background: sc.bg }}>
                    <span className="text-[1.3rem] font-medium leading-none" style={{ color: sc.fg }}>Aa<span className="block h-[3px] w-6 mt-1 rounded-full" style={{ background: sc.accent }} /></span>
                    <span className="w-7 h-7 rounded-[5px] border border-black/10" style={{ background: sc.accent }} />
                  </div>
                  <p className="text-[0.75rem] px-2.5 py-1.5 bg-paper">{sc.name}</p>
                </button>
              ))}
            </div>
            <form action={generateVisualsAction} className="mx-3 mb-3 flex flex-col gap-2 border border-hairline rounded-[10px] p-3">
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="scheme" value={scheme} />
              <p className="text-[0.75rem] font-medium">{designed.length ? "Apply scheme & regenerate" : "Generate visuals"}</p>
              <p className="text-[0.7rem] text-ink-muted">{designed.length} designed{undesigned ? ` · ${undesigned} piece${undesigned === 1 ? "" : "s"} not yet` : ""}</p>
              <label className="flex items-center gap-2 text-[0.72rem]"><input type="checkbox" name="approvedOnly" /> Approved pieces only</label>
              <SubmitButton variant="accent" size="sm" pendingLabel="Designing…" className="w-full">{designed.length ? `Regenerate with ${schemes[scheme]?.name ?? "scheme"}` : "Generate visuals"}</SubmitButton>
            </form>
            <Section id="type" icon={Type} title="Typography" open={open} setOpen={setOpen}>
              <p className="text-[1.4rem] leading-tight" style={{ fontFamily: display }}>{fonts[0] ?? "Inter (house)"}</p>
              <p className="text-[1.2rem] italic mt-1" style={{ fontFamily: accentFont }}>{fonts[1] ?? "Instrument Serif (house)"}</p>
              <p className="text-[0.72rem] text-ink-faint mt-2">Brand fonts render only if installed; licence check for server rendering is an open decision (brief §09).</p>
            </Section>
            <Section id="img" icon={ImageIcon} title="Image style" open={open} setOpen={setOpen}>
              <p className="text-[0.8rem] text-ink-muted leading-relaxed">{imageStyle || "No image style notes. Generated backgrounds will look generic until you add them."}</p>
              <p className="text-[0.72rem] text-ink-faint mt-2">Appended to every image prompt, with negative prompts against the generic AI look.</p>
            </Section>
            <Section id="dims" icon={Ruler} title="Export sizes" open={open} setOpen={setOpen}>
              <ul className="text-[0.78rem] flex flex-col gap-1">
                {Array.from(new Map(FORMATS.map((f) => [f.frame.label, f])).values()).map((f) => (
                  <li key={f.key} className="flex justify-between gap-2"><span className="text-ink-muted">{f.label}</span><span className="tabular-nums">{f.frame.label}</span></li>
                ))}
              </ul>
            </Section>
            <Section id="palette" icon={Palette} title="Palette" open={open} setOpen={setOpen}>
              <div className="flex flex-wrap gap-1.5">
                {(palette.length ? palette : ["#0a0a0a", "#6b6b6b", "#ffffff"]).map((c) => (
                  <span key={c} title={c} className="w-8 h-8 rounded-[6px] border border-hairline" style={{ background: c }} />
                ))}
              </div>
            </Section>
          </div>
        </aside>
      )}

      <div className="flex-1 relative min-w-0">
        {designed.length === 0 ? (
          <div className="absolute inset-0 canvas-dots flex items-center justify-center p-6">
            <div className="bg-paper border border-hairline rounded-[14px] max-w-md w-full shadow-[var(--shadow)]">
              <EmptyState icon={<ImageIcon size={18} />} title="No visuals generated yet" sub="Pick a scheme on the right and generate. Each piece gets a post image, quote card and carousel with real text over brand colours." action={<Link href={`/w/${tenantId}/p/${projectId}/content`} className={btnClass("secondary")}>Back to Content</Link>} />
            </div>
          </div>
        ) : (
          <Canvas>
            <div className="flex flex-col gap-16 p-4" data-canvas-bg="1">
              {ordered.map((i) => {
                const fmt = formatByKey(i.format);
                const slides = slidesOf(i);
                return (
                  <section key={i.id} data-canvas-bg="1" className={selectedId === i.id ? "outline outline-2 outline-accent outline-offset-[12px] rounded-[4px]" : ""}>
                    <p className="label-mono text-ink-faint mb-4">{fmt.label} · {i.pillarName ?? "No pillar"} · {i.status}</p>
                    <div className="flex gap-8 items-start" data-canvas-bg="1">
                      <Artboard label="Post image" meta={fmt.frame.label} width={DISPLAY_W}>
                        <Frame w={fmt.frame.w} h={fmt.frame.h} s={s}>
                          <div className="h-full flex flex-col justify-between p-[9%]">
                            <span className="h-[3%] w-[14%] rounded-full" style={{ background: s.accent }} />
                            <div className="text-[1.45rem] leading-[1.12] font-medium" style={{ fontFamily: display, color: s.fg }}>
                              <EditableText value={i.hook} required label="Post image headline" onCommit={(hook) => edit(i, { hook }, "edit headline")} />
                            </div>
                            <p className="text-[0.62rem] tracking-[0.18em] uppercase font-medium" style={{ color: s.accent, fontFamily: "var(--font-mono)" }}>{brandName}</p>
                          </div>
                        </Frame>
                      </Artboard>
                      <Artboard label="Quote card" meta="1:1 · 1080×1080" width={DISPLAY_W}>
                        <Frame w={1080} h={1080} s={{ ...s, bg: s.fg, fg: s.bg }}>
                          <div className="h-full flex flex-col justify-center p-[10%]">
                            <span className="text-[3rem] leading-none" style={{ color: s.accent, fontFamily: accentFont }}>“</span>
                            <div className="text-[1.25rem] leading-snug italic" style={{ fontFamily: accentFont, color: s.bg }}>
                              <EditableText value={i.hook} required label="Quote" onCommit={(hook) => edit(i, { hook }, "edit quote")} />
                            </div>
                            <p className="mt-4 text-[0.6rem] tracking-[0.18em] uppercase" style={{ color: s.accent, fontFamily: "var(--font-mono)" }}>— {brandName}</p>
                          </div>
                        </Frame>
                      </Artboard>
                      <Artboard label="Carousel" meta={`${slides.length} frames · 1080×1350`} width={slides.length * 170 + (slides.length - 1) * 8 + 16}>
                        <div className="flex gap-2 p-2 bg-panel">
                          {slides.map((sl, k) => {
                            const alt = k % 2 === 1;
                            return (
                              <div key={k} className="w-[170px] shrink-0">
                                <Frame w={1080} h={1350} s={alt ? { ...s, bg: s.fg, fg: s.bg } : s}>
                                  <div className="h-full flex flex-col justify-between p-[10%]">
                                    <span className="text-[0.55rem] tracking-[0.15em] font-medium" style={{ color: s.accent, fontFamily: "var(--font-mono)" }}>{k + 1}/{slides.length}</span>
                                    <div className={`${k === 0 ? "text-[0.95rem] font-medium" : "text-[0.72rem]"} leading-snug flex gap-1`} style={{ fontFamily: display, color: alt ? s.bg : s.fg }}>
                                      {sl.src.kind === "cta" && <span className="shrink-0">→</span>}
                                      <div className="flex-1 min-w-0">
                                        <EditableText
                                          value={sl.text}
                                          multiline={sl.src.kind === "body"}
                                          required={sl.src.kind === "hook"}
                                          label={`Slide ${k + 1}`}
                                          onCommit={(text) => edit(i, patchForSlide(i, sl, text), `edit slide ${k + 1}`)}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </Frame>
                              </div>
                            );
                          })}
                        </div>
                      </Artboard>
                    </div>
                  </section>
                );
              })}
            </div>
          </Canvas>
        )}
      </div>
    </div>
  );
}

function Frame({ w, h, s, children }: { w: number; h: number; s: Scheme; children: React.ReactNode }) {
  return <div style={{ aspectRatio: `${w} / ${h}`, background: s.bg, color: s.fg }} className="w-full overflow-hidden">{children}</div>;
}

function Section({ id, icon: Icon, title, open, setOpen, children }: { id: string; icon: typeof Type; title: string; open: string | null; setOpen: (v: string | null) => void; children: React.ReactNode }) {
  const on = open === id;
  return (
    <div className="border-t border-hairline">
      <button onClick={() => setOpen(on ? null : id)} className="w-full flex items-center gap-2.5 h-11 px-3 hover:bg-field/60">
        <Icon size={14} /> <span className="label-mono flex-1 text-left">{title}</span>
        <ChevronDown size={14} className={`text-ink-faint transition-transform ${on ? "rotate-180" : ""}`} />
      </button>
      {on && <div className="px-3 pb-4 fade-in">{children}</div>}
    </div>
  );
}
