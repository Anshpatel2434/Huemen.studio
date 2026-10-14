"use client";

/**
 * The visual templates (brief §09: real text over brand colours, never an
 * image model's lettering). Each artboard kind has several layouts
 * (lib/visual/design), and every layout reads the same live tweaks: type
 * scale, alignment, accent use and background. They are HTML, so a tweak
 * redraws at once and the PNG export rasterises exactly what is on screen.
 *
 * Text is drawn through `text(slot)`, so the canvas can make it editable and
 * askable while the options view shows it plain.
 */
import type { CSSProperties, ReactNode } from "react";
import type { CarouselLayout, PostLayout, QuoteLayout, Tweaks } from "@/lib/visual/design";

export type Scheme = { name: string; bg: string; fg: string; accent: string };
export type TextSlot = { kind: "post" } | { kind: "quote" } | { kind: "slide"; index: number };
export type RenderText = (slot: TextSlot) => ReactNode;
export type Fonts = { display: string; accent: string };

// ---- colour -----------------------------------------------------------------

function luminance(hex: string): number {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((x) => x + x).join("") : m.slice(0, 6);
  const [r, g, bl] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}
export function contrast(x: string, y: string): number {
  if (!/^#[0-9a-f]{3,8}$/i.test(x) || !/^#[0-9a-f]{3,8}$/i.test(y)) return 1;
  const [l1, l2] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Colour schemes from the brand palette. With none, the house tokens stand in. */
export function schemesFrom(palette: string[]): Scheme[] {
  const [a, b, c, d] = palette.length ? palette : ["#0a0a0a", "#6b6b6b", "#ffffff"];
  const light = c ?? "#ffffff";
  const candidates = [a, light, b, d, "#0a0a0a", "#ffffff"].filter(Boolean) as string[];
  const on = (bg: string) => candidates.reduce((best, x) => (contrast(x, bg) > contrast(best, bg) ? x : best));
  const mk = (name: string, bg: string, accent: string): Scheme => ({ name, bg, fg: on(bg), accent: contrast(accent, bg) > 1.5 ? accent : on(bg) });
  const out: Scheme[] = [mk("Scheme 1", light, b ?? a), mk("Scheme 2", a, b ?? light)];
  if (b && b.toLowerCase() !== light.toLowerCase()) out.push(mk("Scheme 3", b, a));
  if (d) out.push(mk(`Scheme ${out.length + 1}`, d, b ?? a));
  return out;
}

type Paint = { bg: string; fg: string; mark: string; words: string; showMarks: boolean; bold: boolean };

/**
 * The colours one artboard is drawn in. `base` is the template's own ground
 * (a quote card is drawn inverse); the background tweak flips or tints it.
 * The accent tweak decides whether marks show and whether the words take the
 * accent too, but only when the accent stays readable on that ground (3:1).
 */
export function paint(s: Scheme, t: Tweaks, base: "normal" | "inverse"): Paint {
  const inverse = (base === "inverse") !== (t.background === "inverse");
  const ground = inverse ? s.fg : s.bg;
  const ink = inverse ? s.bg : s.fg;
  const bg = t.background === "tint" ? `color-mix(in srgb, ${s.accent} 16%, ${ground})` : ground;
  const accentReadable = contrast(s.accent, ground) >= 3;
  return {
    bg,
    fg: ink,
    mark: t.accent === "none" ? "transparent" : s.accent,
    words: t.accent === "bold" && accentReadable ? s.accent : ink,
    showMarks: t.accent !== "none",
    bold: t.accent === "bold",
  };
}

/**
 * One artboard. A size container, so every type size below is a share of the
 * frame's width (cqw): a 240px preview, the 300px canvas board and the 1080px
 * PNG all keep the same proportions, and nothing overflows a smaller preview.
 */
export function Frame({ w, h, bg, fg, children, frameRef, style }: { w: number; h: number; bg: string; fg: string; children: ReactNode; frameRef?: (el: HTMLDivElement | null) => void; style?: CSSProperties }) {
  return <div ref={frameRef} style={{ aspectRatio: `${w} / ${h}`, background: bg, color: fg, containerType: "inline-size", ...style }} className="w-full overflow-hidden">{children}</div>;
}

/**
 * Type size as a share of the frame width. `n` is the size in rem the
 * template was drawn at on a `base`-px-wide board (300 for posts and quote
 * cards, 170 for a carousel frame), so the original look is unchanged there.
 */
const fz = (n: number, t: Tweaks | null, base = 300) => `${((n * 16 * 100) / base * (t?.scale ?? 1)).toFixed(3)}cqw`;
const rem = (n: number, t: Tweaks) => fz(n, t);
const MONO = "var(--font-mono)";

// ---- post image ---------------------------------------------------------------

export function PostImage({ layout, w, h, s, t, fonts, brand, eyebrow, text, frameRef }: {
  layout: PostLayout; w: number; h: number; s: Scheme; t: Tweaks; fonts: Fonts; brand: string; eyebrow?: string;
  text: RenderText; frameRef?: (el: HTMLDivElement | null) => void;
}) {
  const p = paint(s, t, "normal");
  const center = t.align === "center";
  const al: CSSProperties = { textAlign: t.align, alignItems: center ? "center" : "flex-start" };
  const headline = (n: number, font = fonts.display, extra: CSSProperties = {}) => (
    <div className="leading-[1.12] font-medium w-full" style={{ fontFamily: font, color: p.words, fontSize: rem(n, t), ...extra }}>{text({ kind: "post" })}</div>
  );
  const sign = (color = p.bold ? p.mark : p.fg) => (
    <p className="tracking-[0.18em] uppercase font-medium" style={{ color: p.showMarks ? color : p.fg, fontFamily: MONO, fontSize: fz(0.62, null) }}>{brand}</p>
  );

  if (layout === "split") {
    return (
      <Frame w={w} h={h} bg={p.bg} fg={p.fg} frameRef={frameRef}>
        <div className="h-full flex flex-col">
          <div className="flex-[62] flex flex-col justify-center p-[9%]" style={al}>{headline(1.35)}</div>
          <div className="flex-[38] flex flex-col justify-end p-[9%] gap-2" style={{ ...al, background: p.showMarks ? s.accent : p.fg, color: p.showMarks ? (contrast(s.bg, s.accent) >= contrast(s.fg, s.accent) ? s.bg : s.fg) : p.bg }}>
            <span className="h-[2px] w-[16%] bg-current opacity-70" />
            <p className="tracking-[0.18em] uppercase font-medium" style={{ fontFamily: MONO, fontSize: fz(0.62, null) }}>{brand}</p>
          </div>
        </div>
      </Frame>
    );
  }
  if (layout === "framed") {
    return (
      <Frame w={w} h={h} bg={p.bg} fg={p.fg} frameRef={frameRef}>
        <div className="h-full p-[6%]">
          <div className="h-full flex flex-col justify-between p-[8%]" style={{ ...al, alignItems: "center", textAlign: "center", border: `${p.bold ? 3 : 1.5}px solid ${p.showMarks ? s.accent : p.fg}` }}>
            <span />
            {headline(1.3)}
            {sign()}
          </div>
        </div>
      </Frame>
    );
  }
  if (layout === "editorial") {
    return (
      <Frame w={w} h={h} bg={p.bg} fg={p.fg} frameRef={frameRef}>
        <div className="h-full flex p-[9%] gap-[6%]">
          {p.showMarks && !center && <span className="shrink-0 w-[3px] self-stretch" style={{ background: s.accent }} />}
          <div className="flex-1 min-w-0 flex flex-col justify-between" style={al}>
            <p className="tracking-[0.2em] uppercase" style={{ fontFamily: MONO, color: p.showMarks ? s.accent : p.fg, fontSize: fz(0.58, null) }}>№ 01 · {eyebrow || brand}</p>
            {headline(1.6, fonts.accent, { fontStyle: "italic", fontWeight: 400, lineHeight: 1.05 })}
            {sign(p.fg)}
          </div>
        </div>
      </Frame>
    );
  }
  // statement (the original)
  return (
    <Frame w={w} h={h} bg={p.bg} fg={p.fg} frameRef={frameRef}>
      <div className="h-full flex flex-col justify-between p-[9%]" style={al}>
        <span className="rounded-full" style={{ height: p.bold ? "4%" : "3%", width: "14%", background: p.mark }} />
        {headline(1.45)}
        {sign()}
      </div>
    </Frame>
  );
}

// ---- quote card ---------------------------------------------------------------

export function QuoteCard({ layout, s, t, fonts, brand, text, frameRef }: {
  layout: QuoteLayout; s: Scheme; t: Tweaks; fonts: Fonts; brand: string; text: RenderText; frameRef?: (el: HTMLDivElement | null) => void;
}) {
  const p = paint(s, t, "inverse");
  const center = layout === "centered" || t.align === "center";
  const al: CSSProperties = { textAlign: center ? "center" : "left", alignItems: center ? "center" : "flex-start" };
  const words = (n: number, italic = true, font = fonts.accent) => (
    <div className="leading-snug w-full" style={{ fontFamily: font, fontStyle: italic ? "italic" : "normal", color: p.words, fontSize: rem(n, t) }}>{text({ kind: "quote" })}</div>
  );
  const sign = (dash = true) => (
    <p className="tracking-[0.18em] uppercase" style={{ color: p.showMarks ? s.accent : p.fg, fontFamily: MONO, fontSize: fz(0.6, null) }}>{dash ? "— " : ""}{brand}</p>
  );

  if (layout === "centered") {
    return (
      <Frame w={1080} h={1080} bg={p.bg} fg={p.fg} frameRef={frameRef}>
        <div className="h-full flex flex-col justify-center gap-4 p-[11%]" style={al}>
          <span className="leading-[0.6]" style={{ color: p.mark, fontFamily: fonts.accent, fontSize: rem(p.bold ? 4.4 : 3.6, t) }}>“</span>
          {words(1.2)}
          <span className="h-[2px] w-[12%]" style={{ background: p.showMarks ? s.accent : p.fg }} />
          {sign(false)}
        </div>
      </Frame>
    );
  }
  if (layout === "minimal") {
    return (
      <Frame w={1080} h={1080} bg={p.bg} fg={p.fg} frameRef={frameRef}>
        <div className="h-full flex flex-col justify-center p-[11%]">
          <div className="flex gap-[6%] items-stretch">
            {p.showMarks && !center && <span className="shrink-0 rounded-full" style={{ width: p.bold ? 5 : 3, background: s.accent }} />}
            <div className="flex-1 min-w-0 flex flex-col gap-4" style={al}>
              {words(1.25, false, fonts.display)}
              {sign()}
            </div>
          </div>
        </div>
      </Frame>
    );
  }
  // classic (the original)
  return (
    <Frame w={1080} h={1080} bg={p.bg} fg={p.fg} frameRef={frameRef}>
      <div className="h-full flex flex-col justify-center p-[10%]" style={al}>
        <span className="leading-none" style={{ color: p.mark, fontFamily: fonts.accent, fontSize: rem(3, t) }}>“</span>
        {words(1.25)}
        <div className="mt-4">{sign()}</div>
      </div>
    </Frame>
  );
}

// ---- carousel -------------------------------------------------------------------

export function CarouselFrames({ layout, slides, s, t, fonts, frameWidth, text, frameRef, ctaIndex }: {
  layout: CarouselLayout; slides: string[]; s: Scheme; t: Tweaks; fonts: Fonts; frameWidth: number;
  text: RenderText; frameRef?: (k: number) => (el: HTMLDivElement | null) => void;
  /** The slide that is the call to action, if any (it gets the arrow). */
  ctaIndex?: number;
}) {
  const n = slides.length;
  return (
    <div className="flex gap-2 p-2 bg-panel">
      {slides.map((_, k) => {
        const alt = layout === "standard" && k % 2 === 1;
        const p = paint(s, t, alt ? "inverse" : "normal");
        const al: CSSProperties = { textAlign: t.align, alignItems: t.align === "center" ? "center" : "flex-start" };
        const first = k === 0;
        const body = (
          <div className={`${first ? "font-medium" : ""} leading-snug flex gap-1 w-full`} style={{ fontFamily: fonts.display, color: p.words, fontSize: fz(first ? 0.95 : 0.72, t, 170), justifyContent: t.align === "center" ? "center" : "flex-start" }}>
            {k === ctaIndex && <span className="shrink-0">→</span>}
            <div className="min-w-0" style={{ flex: t.align === "center" ? "0 1 auto" : "1 1 0%" }}>{text({ kind: "slide", index: k })}</div>
          </div>
        );
        return (
          <div key={k} className="shrink-0" style={{ width: frameWidth }}>
            <Frame w={1080} h={1350} bg={p.bg} fg={p.fg} frameRef={frameRef?.(k)}>
              {layout === "numbered" ? (
                <div className="h-full flex flex-col justify-between p-[10%]" style={al}>
                  <span className="font-medium leading-none" style={{ fontFamily: fonts.display, color: p.showMarks ? s.accent : p.fg, fontSize: fz(p.bold ? 2.4 : 2, t, 170) }}>{String(k + 1).padStart(2, "0")}</span>
                  {body}
                  <span className="tracking-[0.15em]" style={{ fontFamily: MONO, color: p.fg, opacity: 0.6, fontSize: fz(0.5, null, 170) }}>{k + 1}/{n}</span>
                </div>
              ) : layout === "progress" ? (
                <div className="h-full flex flex-col justify-between p-[10%] pb-[8%]" style={al}>
                  {body}
                  <div className="w-full flex gap-[3%]">
                    {slides.map((__, j) => (
                      <span key={j} className="flex-1 rounded-full" style={{ height: p.bold ? 4 : 3, background: j <= k ? (p.showMarks ? s.accent : p.fg) : `color-mix(in srgb, ${p.fg} 18%, transparent)` }} />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col justify-between p-[10%]" style={al}>
                  <span className="tracking-[0.15em] font-medium" style={{ color: p.showMarks ? s.accent : p.fg, fontFamily: MONO, fontSize: fz(0.55, null, 170) }}>{k + 1}/{n}</span>
                  {body}
                </div>
              )}
            </Frame>
          </div>
        );
      })}
    </div>
  );
}
