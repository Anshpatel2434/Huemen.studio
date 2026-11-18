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
 *
 * Text never leaves its frame. Every text block sits in a <Fit>: it is
 * measured in the browser, its type steps down to a floor when it is too
 * tall for the room the layout gives it, and past the floor it is clamped
 * with an ellipsis. The export rasterises the same measured DOM, so the file
 * matches the editor.
 *
 * A picture is part of the layout, not a replacement for it: Statement puts
 * it behind the words, Split gives it one half and the words the other on the
 * scheme's ground, and so on. Only a picture with the heading drawn into it
 * ("with_text") fills the whole visual, because cropping it would cut the words.
 *
 * A cut-out (a picture with its background removed) is a subject, not a
 * backdrop: it sits whole (never cropped) on the colour the layout paints
 * there without a picture, with no dark shade over it and the words in the
 * scheme's own colours. Every layout takes one the same way.
 */
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { CarouselLayout, PictureMode, PostLayout, QuoteLayout, Tweaks } from "@/lib/visual/design";
import { contrast, onBand, paint, schemesFrom, type Paint, type Scheme } from "@/lib/visual/schemes";

export { contrast, paint, schemesFrom };
export type { Scheme };
export type TextSlot = { kind: "post" } | { kind: "quote" } | { kind: "slide"; index: number };
export type RenderText = (slot: TextSlot) => ReactNode;
export type Fonts = { display: string; accent: string };
/**
 * A picture on a visual: its same-origin link, whether the heading is drawn
 * into it, and whether it is a cut-out (background removed, a PNG with alpha).
 */
export type Picture = { url: string; mode: PictureMode; cutout?: boolean } | null;

/** The picture is a backdrop the words are set on (dark shade, white words). A cut-out never is. */
const isBackdrop = (p: Picture | undefined): boolean => !!p && !p.cutout;
/** The heading is drawn into the picture, so the picture is the whole visual. Not so for a cut-out. */
const isDrawnIn = (p: Picture | undefined): boolean => !!p && p.mode === "with_text" && !p.cutout;

/**
 * One artboard. A size container, so every type size below is a share of the
 * frame's width (cqw): a 240px preview, the 300px canvas board and the 1080px
 * PNG all keep the same proportions, and nothing overflows a smaller preview.
 */
export function Frame({ w, h, bg, fg, children, frameRef, style }: { w: number; h: number; bg: string; fg: string; children: ReactNode; frameRef?: (el: HTMLDivElement | null) => void; style?: CSSProperties }) {
  return <div ref={frameRef} data-part="background" style={{ aspectRatio: `${w} / ${h}`, background: bg, color: fg, containerType: "inline-size", ...style }} className="w-full overflow-hidden relative">{children}</div>;
}

/**
 * Type size as a share of the frame width. `n` is the size in rem the
 * template was drawn at on a `base`-px-wide board (300 for posts and quote
 * cards, 170 for a carousel frame), so the original look is unchanged there.
 */
const fz = (n: number, t: Tweaks | null, base = 300) => `${((n * 16 * 100) / base * (t?.scale ?? 1)).toFixed(3)}cqw`;
const rem = (n: number, t: Tweaks) => fz(n, t);
const MONO = "var(--font-mono)";

// ---- text that fits ---------------------------------------------------------------

/** Type steps down to this share of the template's size; past it the text is clamped. */
const FIT_FLOOR = 0.5;
const FIT_STEP = 0.05;

/**
 * A text block that fits the room its layout gives it. The outer box takes
 * its natural height while the text fits and is squeezed by the layout (flex)
 * when it doesn't; the inner block is then stepped down in size, and clamped
 * with an ellipsis at the floor. `data-fit` on the inner block says which
 * ("ok", "shrunk", "clamped") for the look check.
 *
 * Measured after layout and again whenever the box, the text or the fonts
 * change. Only styles this component owns are touched, straight on the node.
 */
function Fit({ part, size, className = "", style, box, v = "center", children }: {
  part?: string;
  /** The template's own type size (a cqw length). */
  size: string;
  className?: string;
  style?: CSSProperties;
  /** Extra styles for the outer box (how it sits in its layout). */
  box?: CSSProperties;
  v?: "start" | "center" | "end";
  children: ReactNode;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const fit = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    fit.current = () => {
      const o = outer.current, i = inner.current;
      if (!o || !i) return;
      const st = i.style;
      st.fontSize = "";
      st.display = "";
      st.overflow = "";
      st.removeProperty("-webkit-line-clamp");
      st.removeProperty("-webkit-box-orient");
      // Not rendered (a hidden panel or tab): nothing to measure yet; the size observer measures it when it shows.
      if (!o.getClientRects().length) return;
      // A box squeezed to no height is still measured: the text is then too tall for its room, and says so
      // (it used to be read as "ok" here, and overflowed the frame top and bottom on a wide banner).
      const room = o.clientHeight;
      let state = "ok";
      if (i.scrollHeight > room + 1) {
        state = "shrunk";
        let k = 1;
        while (k > FIT_FLOOR + 0.001 && i.scrollHeight > room + 1) {
          k = Math.max(FIT_FLOOR, k - FIT_STEP);
          st.fontSize = `${k.toFixed(2)}em`;
        }
        // Still too tall at the floor: whole lines only, the last one ending in an ellipsis.
        // Not while it is being typed in: the person must see what they type.
        if (i.scrollHeight > room + 1 && !i.querySelector("textarea")) {
          const cs = getComputedStyle(i);
          const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
          st.display = "-webkit-box";
          st.setProperty("-webkit-box-orient", "vertical");
          st.setProperty("-webkit-line-clamp", String(Math.max(1, Math.floor((room + 1) / line))));
          st.overflow = "hidden";
          state = "clamped";
        }
      }
      if (i.dataset.fit !== state) i.dataset.fit = state;
    };
    fit.current();
  });

  useEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    const run = () => fit.current();
    const ro = new ResizeObserver(run);
    ro.observe(o);
    ro.observe(i);
    // An edit shows before it is saved (EditableText), without this block rendering again.
    const mo = new MutationObserver(run);
    mo.observe(i, { childList: true, characterData: true, subtree: true });
    let live = true;
    void document.fonts?.ready.then(() => { if (live) run(); });
    return () => { live = false; ro.disconnect(); mo.disconnect(); };
  }, []);

  return (
    <div ref={outer} className="min-h-0 w-full flex flex-col" style={{ flex: "0 1 auto", justifyContent: v === "start" ? "flex-start" : v === "end" ? "flex-end" : "center", fontSize: size, ...box }}>
      <div ref={inner} data-part={part} className={`w-full relative ${className}`} style={style}>{children}</div>
    </div>
  );
}

// ---- parts shared by the layouts ------------------------------------------------------

const LOGO_EM = { small: 1.6, medium: 2.4, large: 3.4, hidden: 0 } as const;

/** The sign-off: the workspace's logo, when it has one, beside the brand name. */
function Signoff({ brand, logo, style, prefix = "", size = "medium" }: { brand: string; logo?: string | null; style: CSSProperties; prefix?: string; size?: Tweaks["logo"] }) {
  const em = LOGO_EM[size] ?? LOGO_EM.medium;
  return (
    <span data-part="logo" className="inline-flex items-center gap-[0.6em] max-w-full relative shrink-0" style={style}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo && em > 0 && <img src={logo} alt="" crossOrigin="anonymous" className="w-auto object-contain shrink-0" style={{ height: `${em}em`, maxWidth: `${em * 3.4}em` }} />}
      <span className="tracking-[0.18em] uppercase font-medium truncate">{prefix}{brand}</span>
    </span>
  );
}

const SCRIM = { none: 0, light: 0.45, strong: 0.72 } as const;
const WHITE = "#ffffff";
const SHADOW = "0 1px 12px rgba(0,0,0,.35)";

/** The colours of text set straight on a picture: white, kept readable by the shade under it. */
const overPicture = (t: Tweaks): Paint => ({
  bg: "#000000", fg: WHITE, accent: WHITE, mark: t.accent === "none" ? "transparent" : WHITE, sign: WHITE, words: WHITE,
  showMarks: t.accent !== "none", bold: t.accent === "bold",
});

/**
 * The picture, filling the box it is in (a cut-out sits whole inside it
 * instead, on whatever is painted behind). Drawn as an <img> so the PNG export
 * rasterises it with the rest.
 */
function PictureFill({ url, cutout = false }: { url: string; cutout?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img data-part="picture" data-cutout={cutout ? "" : undefined} src={url} alt="" crossOrigin="anonymous" draggable={false} className={`absolute inset-0 w-full h-full ${cutout ? "object-contain" : "object-cover"}`} />
  );
}

/** The shade that keeps live text readable on a picture. `even` shades the whole picture, for centred text. */
function Shade({ t, even = false }: { t: Tweaks; even?: boolean }) {
  const shade = SCRIM[t.scrim] ?? SCRIM.light;
  if (shade <= 0) return null;
  const background = even
    ? `rgba(0,0,0,${(shade * 0.8).toFixed(3)})`
    : `linear-gradient(to top, rgba(0,0,0,${shade}) 0%, rgba(0,0,0,${shade * 0.55}) 45%, rgba(0,0,0,0) 75%)`;
  return <div className="absolute inset-0 pointer-events-none" style={{ background }} />;
}

/**
 * A cut-out in a layout that puts the picture BEHIND the words: the subject
 * stands in the top half and the words take the bottom half, so they never
 * sit on it (2026-11-18: the heading landed across the cut-out scales).
 */
function CutoutTop({ url }: { url: string }) {
  return (
    <div className="absolute left-[9%] right-[9%] top-[6%] bottom-[50%]">
      <PictureFill url={url} cutout />
    </div>
  );
}
/** Where the words go over a cut-out: the bottom half of the frame. */
const CUT_TEXT = "absolute inset-x-0 bottom-0 top-[50%]";

/** The heading is drawn into the picture: the picture is the whole visual, with the sign-off in the corner. */
function DrawnIn({ w, h, picture, t, brand, logo, frameRef }: {
  w: number; h: number; picture: NonNullable<Picture>; t: Tweaks; brand: string; logo?: string | null; frameRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <Frame w={w} h={h} bg="#000" fg="#fff" frameRef={frameRef}>
      <PictureFill url={picture.url} />
      {t.logo !== "hidden" && (
        <div className="absolute right-[6%] bottom-[5%] max-w-[88%] flex">
          <Signoff brand={brand} logo={logo} size={t.logo} style={{ color: WHITE, fontFamily: MONO, fontSize: fz(0.6, null), textShadow: "0 1px 6px rgba(0,0,0,.35)" }} />
        </div>
      )}
    </Frame>
  );
}

const GAP = "4cqw";

// ---- post image ---------------------------------------------------------------

/**
 * A very wide, short frame (a profile banner, 1584x396 is 4:1). Stacked, the
 * padding, the gap and the sign-off take the whole height, and the headline
 * was squeezed out of its box and overflowed the frame. So here the words and
 * the sign-off sit side by side: the headline has the full height of the frame
 * less a thin margin, steps down in size to fit it, and is clamped only past that.
 *
 * Each post layout has its own banner, so "Show me options" offers four
 * different ones (2026-11-18: all four drew the same row):
 *   statement  an accent bar, the line, the sign-off at the right
 *   split      the line on the ground, a colour band at the right carrying the name
 *   framed     a hairline frame, the line centred, the sign-off under it
 *   editorial  an eyebrow over a serif italic line, a rule, the sign-off at the right
 */
const BANNER_RATIO = 2.2;

function Banner({ layout, w, h, s, t, fonts, brand, logo, eyebrow, text, frameRef, picture = null }: {
  layout: PostLayout; w: number; h: number; s: Scheme; t: Tweaks; fonts: Fonts; brand: string; logo?: string | null; eyebrow?: string;
  text: RenderText; frameRef?: (el: HTMLDivElement | null) => void; picture?: Picture;
}) {
  const p = paint(s, t, "normal");
  const o = overPicture(t);
  const shadow = "0 1px 6px rgba(0,0,0,.35)";
  // A backdrop picture takes white words over a shade; a cut-out keeps the layout's own paint.
  const over = isBackdrop(picture);
  const cut = !!picture?.cutout;
  const headline = (n: number, x: { font?: string; color?: string; align?: CSSProperties["textAlign"]; extra?: CSSProperties; cls?: string; over?: boolean } = {}) => (
    <Fit
      part="headline"
      size={rem(n, t)}
      v="center"
      className={x.cls ?? "leading-[1.12] font-medium"}
      box={{ flex: "1 1 0%", width: "auto", minWidth: 0, alignSelf: "stretch" }}
      style={{ fontFamily: x.font ?? fonts.display, color: x.color ?? p.words, textShadow: x.over ? SHADOW : undefined, textAlign: x.align ?? t.align, ...x.extra }}
    >
      {text({ kind: "post" })}
    </Fit>
  );
  const sign = (color: string, over = false, style: CSSProperties = {}) => (
    <Signoff brand={brand} logo={logo} size={t.logo} style={{ color, fontFamily: MONO, fontSize: fz(0.62, null), textShadow: over ? shadow : undefined, ...style }} />
  );

  if (layout === "split") {
    // The words on the scheme's ground; a band at the right carries the name (with a picture, the picture is the band).
    const band = p.showMarks ? p.accent : p.fg;
    return (
      <Frame w={w} h={h} bg={p.bg} fg={p.fg} frameRef={frameRef}>
        <div className="absolute inset-0 flex" data-banner="split">
          <div className="flex-[68] min-w-0 flex items-center" style={{ padding: "3% 4% 3% 5%" }}>{headline(1.2)}</div>
          <div className="flex-[32] min-w-0 relative overflow-hidden flex flex-col justify-end" style={{ background: over ? "#000" : band, color: over ? WHITE : onBand(s, band), padding: "3% 4%", gap: "1.5cqw" }}>
            {picture && <PictureFill url={picture.url} cutout={cut} />}
            {over && <Shade t={t} />}
            <span className="relative h-[2px] w-[22%] bg-current opacity-70 shrink-0" />
            <span className="relative">{sign(over ? WHITE : "currentColor", over)}</span>
          </div>
        </div>
      </Frame>
    );
  }
  if (layout === "framed") {
    // A hairline frame around a centred line, the sign-off centred under it; a picture sits behind, shaded evenly.
    const c = over ? o : p;
    return (
      <Frame w={w} h={h} bg={over ? "#000" : p.bg} fg={over ? WHITE : p.fg} frameRef={frameRef}>
        {picture && <PictureFill url={picture.url} cutout={cut} />}
        {over && <Shade t={t} even />}
        <div className="absolute flex flex-col items-center" data-banner="framed" style={{ inset: "6% 3%", padding: "2% 6%", gap: "1cqw", border: `${p.bold ? 3 : 1.5}px solid ${over ? WHITE : p.showMarks ? p.accent : p.fg}` }}>
          {headline(1.05, { align: "center", color: c.words, over })}
          {sign(over ? WHITE : p.bold ? p.sign : p.fg, over, { fontSize: fz(0.52, null) })}
        </div>
      </Frame>
    );
  }
  if (layout === "editorial") {
    // A magazine pull: an eyebrow over a serif italic line, a rule, the sign-off at the right. A picture is a column at the left.
    return (
      <Frame w={w} h={h} bg={p.bg} fg={p.fg} frameRef={frameRef}>
        <div className="absolute inset-0 flex" data-banner="editorial">
          {picture && <div className="w-[26%] shrink-0 relative overflow-hidden"><PictureFill url={picture.url} cutout={cut} /></div>}
          <div className="flex-1 min-w-0 flex items-center" style={{ padding: "3% 5%", gap: "3cqw" }}>
            <div className="flex-1 min-w-0 self-stretch flex flex-col justify-center" style={{ gap: "0.6cqw" }}>
              <p className="tracking-[0.2em] uppercase shrink-0 max-w-full truncate" style={{ fontFamily: MONO, color: p.showMarks ? p.sign : p.fg, fontSize: fz(0.5, null) }}>№ 01 · {eyebrow || brand}</p>
              {headline(1.3, { font: fonts.accent, cls: "", extra: { fontStyle: "italic", fontWeight: 400, lineHeight: 1.05 } })}
            </div>
            <span className="shrink-0 self-stretch" style={{ width: 1.5, margin: "2% 0", background: p.showMarks ? p.accent : p.fg }} />
            {sign(p.fg)}
          </div>
        </div>
      </Frame>
    );
  }
  // statement (the original): an accent bar, the line, the sign-off; a picture fills the frame behind them.
  return (
    <Frame w={w} h={h} bg={over ? "#000" : p.bg} fg={over ? WHITE : p.fg} frameRef={frameRef}>
      {picture && <PictureFill url={picture.url} cutout={cut} />}
      {over && <Shade t={t} />}
      <div className="absolute inset-0 flex items-center" data-banner="statement" style={{ gap: "3cqw", padding: "3% 5%" }}>
        {!over && p.showMarks && <span className="shrink-0 self-stretch rounded-full" style={{ width: "0.7%", background: p.accent }} />}
        {headline(1.2, { color: over ? WHITE : p.words, over })}
        {sign(over ? WHITE : p.sign, over)}
      </div>
    </Frame>
  );
}

export function PostImage({ layout, w, h, s, t, fonts, brand, logo, eyebrow, text, frameRef, picture = null }: {
  layout: PostLayout; w: number; h: number; s: Scheme; t: Tweaks; fonts: Fonts; brand: string; logo?: string | null; eyebrow?: string;
  text: RenderText; frameRef?: (el: HTMLDivElement | null) => void; picture?: Picture;
}) {
  if (picture && isDrawnIn(picture)) return <DrawnIn w={w} h={h} picture={picture} t={t} brand={brand} logo={logo} frameRef={frameRef} />;
  if (w > h * BANNER_RATIO) return <Banner layout={layout} w={w} h={h} s={s} t={t} fonts={fonts} brand={brand} logo={logo} eyebrow={eyebrow} text={text} frameRef={frameRef} picture={picture} />;

  const p = paint(s, t, "normal");
  const center = t.align === "center";
  const al: CSSProperties = { textAlign: t.align, alignItems: center ? "center" : "flex-start" };
  const headline = (n: number, o: { font?: string; v?: "start" | "center" | "end"; color?: string; extra?: CSSProperties; cls?: string } = {}) => (
    <Fit part="headline" size={rem(n, t)} v={o.v} className={o.cls ?? "leading-[1.12] font-medium"} style={{ fontFamily: o.font ?? fonts.display, color: o.color ?? p.words, ...o.extra }}>
      {text({ kind: "post" })}
    </Fit>
  );
  const sign = (color = p.bold ? p.sign : p.fg, extra: CSSProperties = {}) => (
    <Signoff brand={brand} logo={logo} size={t.logo} style={{ color, fontFamily: MONO, fontSize: fz(0.62, null), ...extra }} />
  );
  const band = p.showMarks ? p.accent : p.fg;
  const cut = !!picture?.cutout;
  const eyebrowLine = (color: string) => (
    <p className="tracking-[0.2em] uppercase shrink-0 max-w-full truncate" style={{ fontFamily: MONO, color, fontSize: fz(0.58, null) }}>№ 01 · {eyebrow || brand}</p>
  );

  if (layout === "split") {
    return (
      <Frame w={w} h={h} bg={p.bg} fg={p.fg} frameRef={frameRef}>
        <div className="h-full flex flex-col">
          {picture ? (
            // The picture has the top half; the words sit under it on the scheme's ground.
            <>
              <div className="flex-[54] min-h-0 relative overflow-hidden"><PictureFill url={picture.url} cutout={cut} /></div>
              <div className="flex-[46] min-h-0 flex flex-col justify-between px-[9%] py-[7%]" style={{ ...al, gap: GAP }}>
                {p.showMarks && <span className="h-[2px] w-[16%] shrink-0" style={{ background: p.accent }} />}
                {headline(1.2)}
                {sign()}
              </div>
            </>
          ) : (
            <>
              <div className="flex-[62] min-h-0 flex flex-col justify-center p-[9%]" style={al}>{headline(1.35)}</div>
              <div className="flex-[38] min-h-0 flex flex-col justify-end p-[9%] gap-2" style={{ ...al, background: band, color: onBand(s, band) }}>
                <span className="h-[2px] w-[16%] bg-current opacity-70 shrink-0" />
                <Signoff brand={brand} logo={logo} size={t.logo} style={{ fontFamily: MONO, fontSize: fz(0.62, null) }} />
              </div>
            </>
          )}
        </div>
      </Frame>
    );
  }
  if (layout === "framed") {
    return (
      <Frame w={w} h={h} bg={p.bg} fg={p.fg} frameRef={frameRef}>
        <div className="h-full p-[6%]">
          <div className="h-full flex flex-col justify-between" style={{ ...al, alignItems: "center", textAlign: "center", gap: GAP, padding: picture ? "0 0 7%" : "8%", border: `${p.bold ? 3 : 1.5}px solid ${p.showMarks ? p.accent : p.fg}` }}>
            {/* The picture is set inside the frame, above the centred line. */}
            {picture ? <div className="w-full flex-[52] min-h-0 relative overflow-hidden"><PictureFill url={picture.url} cutout={cut} /></div> : <span />}
            <div className={`min-h-0 w-full flex flex-col justify-center ${picture ? "flex-[36] px-[8%]" : ""}`} style={picture ? undefined : { flex: "0 1 auto" }}>{headline(picture ? 1.1 : 1.3)}</div>
            {sign()}
          </div>
        </div>
      </Frame>
    );
  }
  if (layout === "editorial") {
    return (
      <Frame w={w} h={h} bg={p.bg} fg={p.fg} frameRef={frameRef}>
        <div className="h-full flex" style={picture ? undefined : { padding: "9%", gap: "6%" }}>
          {/* The picture runs down one side like a magazine column. */}
          {picture
            ? <div className="w-[40%] shrink-0 relative overflow-hidden"><PictureFill url={picture.url} cutout={cut} /></div>
            : p.showMarks && !center && <span className="shrink-0 w-[3px] self-stretch" style={{ background: p.accent }} />}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col justify-between" style={{ ...al, gap: GAP, padding: picture ? "9% 7%" : undefined }}>
            {eyebrowLine(p.showMarks ? p.sign : p.fg)}
            {headline(picture ? 1.25 : 1.6, { font: fonts.accent, cls: "", extra: { fontStyle: "italic", fontWeight: 400, lineHeight: 1.05 } })}
            {sign(p.fg)}
          </div>
        </div>
      </Frame>
    );
  }
  // statement (the original)
  if (picture && !cut) {
    const o = overPicture(t);
    return (
      <Frame w={w} h={h} bg="#000" fg="#fff" frameRef={frameRef}>
        <PictureFill url={picture.url} />
        <Shade t={t} />
        <div className="absolute inset-0 flex flex-col justify-end p-[9%]" style={{ ...al, gap: GAP }}>
          {headline(1.45, { v: "end", color: o.words, extra: { textShadow: SHADOW } })}
          {sign(o.sign, { textShadow: "0 1px 6px rgba(0,0,0,.35)" })}
        </div>
      </Frame>
    );
  }
  return (
    <Frame w={w} h={h} bg={p.bg} fg={p.fg} frameRef={frameRef}>
      {/* A cut-out stands on the scheme's ground, behind the layout as it is without a picture. */}
      {picture && <CutoutTop url={picture.url} />}
      <div className={`${picture ? CUT_TEXT : "h-full"} flex flex-col justify-between p-[9%]`} style={{ ...al, gap: GAP }}>
        <span className="rounded-full shrink-0" style={{ height: p.bold ? "4%" : "3%", width: "14%", background: p.mark }} />
        {headline(1.45)}
        {sign()}
      </div>
    </Frame>
  );
}

// ---- quote card ---------------------------------------------------------------

export function QuoteCard({ layout, s, t, fonts, brand, logo, text, frameRef, picture = null }: {
  layout: QuoteLayout; s: Scheme; t: Tweaks; fonts: Fonts; brand: string; logo?: string | null; text: RenderText; frameRef?: (el: HTMLDivElement | null) => void; picture?: Picture;
}) {
  if (picture && isDrawnIn(picture)) return <DrawnIn w={1080} h={1080} picture={picture} t={t} brand={brand} logo={logo} frameRef={frameRef} />;

  // Classic and Centred set the words straight on a picture; Minimal keeps them on the scheme's ground beside it.
  // `behind`: the picture is under the words. `over`: it is a backdrop too (white words on a shade); a cut-out is not.
  const behind = !!picture && layout !== "minimal";
  const over = behind && isBackdrop(picture);
  const cut = !!picture?.cutout;
  const p = over ? overPicture(t) : paint(s, t, "inverse");
  const center = layout === "centered" || t.align === "center";
  const al: CSSProperties = { textAlign: center ? "center" : "left", alignItems: center ? "center" : "flex-start" };
  const words = (n: number, italic = true, font = fonts.accent, v: "start" | "center" | "end" = "center") => (
    <Fit part="headline" size={rem(n, t)} v={v} className="leading-snug" style={{ fontFamily: font, fontStyle: italic ? "italic" : "normal", color: p.words, textShadow: over ? SHADOW : undefined }}>
      {text({ kind: "quote" })}
    </Fit>
  );
  const sign = (dash = true) => (
    <Signoff brand={brand} logo={logo} size={t.logo} prefix={dash && !logo ? "— " : ""} style={{ color: p.sign, fontFamily: MONO, fontSize: fz(0.6, null), textShadow: over ? "0 1px 6px rgba(0,0,0,.35)" : undefined }} />
  );
  const mark = (n: number, cls: string) => p.showMarks && (
    <span className={`${cls} shrink-0`} style={{ color: p.mark, fontFamily: fonts.accent, fontSize: rem(n, t), textShadow: over ? SHADOW : undefined }}>“</span>
  );
  const frame = (children: ReactNode) => (
    <Frame w={1080} h={1080} bg={over ? "#000" : p.bg} fg={p.fg} frameRef={frameRef}>
      {behind && picture && (cut ? <CutoutTop url={picture.url} /> : <PictureFill url={picture.url} />)}
      {over && <Shade t={t} even={layout === "centered"} />}
      {children}
    </Frame>
  );

  if (layout === "centered") {
    return frame(
      <div className={`${behind ? (cut ? CUT_TEXT : "absolute inset-0") : "h-full"} flex flex-col justify-center gap-4 p-[11%]`} style={al}>
        {mark(p.bold ? 4.4 : 3.6, "leading-[0.6]")}
        {words(1.2)}
        <span className="h-[2px] w-[12%] shrink-0" style={{ background: p.showMarks ? p.accent : p.fg }} />
        {sign(false)}
      </div>,
    );
  }
  if (layout === "minimal") {
    return frame(
      <div className="h-full flex">
        {picture && <div className="w-[42%] shrink-0 relative overflow-hidden"><PictureFill url={picture.url} cutout={cut} /></div>}
        <div className="flex-1 min-w-0 h-full flex flex-col justify-center" style={{ padding: picture ? "9%" : "11%" }}>
          <div className="min-h-0 flex gap-[6%] items-stretch" style={{ flex: "0 1 auto" }}>
            {p.showMarks && !center && <span className="shrink-0 rounded-full" style={{ width: p.bold ? 5 : 3, background: p.accent }} />}
            <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-4" style={al}>
              {words(picture ? 1.05 : 1.25, false, fonts.display)}
              {sign()}
            </div>
          </div>
        </div>
      </div>,
    );
  }
  // classic (the original)
  return frame(
    <div className={`${behind ? (cut ? CUT_TEXT : "absolute inset-0") : "h-full"} ${over ? "justify-end" : "justify-center"} flex flex-col p-[10%]`} style={al}>
      {mark(3, "leading-none")}
      {words(1.25, true, fonts.accent, over ? "end" : "center")}
      <div className="mt-4 shrink-0 max-w-full flex">{sign()}</div>
    </div>,
  );
}

// ---- carousel -------------------------------------------------------------------

export function CarouselFrames({ layout, slides, s, t, fonts, frameWidth, text, frameRef, ctaIndex, cover = null, brand = "", logo = null }: {
  layout: CarouselLayout; slides: string[]; s: Scheme; t: Tweaks; fonts: Fonts; frameWidth: number;
  text: RenderText; frameRef?: (k: number) => (el: HTMLDivElement | null) => void;
  /** The slide that is the call to action, if any (it gets the arrow). */
  ctaIndex?: number;
  /** A picture on the first frame (the cover). */
  cover?: Picture;
  brand?: string;
  logo?: string | null;
}) {
  const n = slides.length;
  const center = t.align === "center";
  return (
    <div className="flex gap-2 p-2 bg-panel">
      {slides.map((_, k) => {
        const first = k === 0;
        const pic = first ? cover : null;
        if (pic && isDrawnIn(pic)) {
          return (
            <div key={k} className="shrink-0" style={{ width: frameWidth }}>
              <DrawnIn w={1080} h={1350} picture={pic} t={t} brand={brand} logo={logo} frameRef={frameRef?.(k)} />
            </div>
          );
        }
        const alt = layout === "standard" && k % 2 === 1;
        // On a cover picture the frame keeps its layout (number, counter, progress), drawn in white over the shade.
        // A cut-out keeps the frame's own colours, with nothing over it.
        const over = isBackdrop(pic);
        const p = over ? overPicture(t) : paint(s, t, alt ? "inverse" : "normal");
        const al: CSSProperties = { textAlign: t.align, alignItems: center ? "center" : "flex-start", gap: "5cqw" };
        const part = first ? "headline" : k === ctaIndex ? "cta" : "body";
        const size = fz(first ? 0.95 : 0.72, t, 170);
        const body = (
          <div className="min-h-0 w-full flex gap-[0.3em]" style={{ flex: "0 1 auto", justifyContent: center ? "center" : "flex-start", color: p.words, fontFamily: fonts.display, textShadow: over ? SHADOW : undefined }}>
            {k === ctaIndex && <span className="shrink-0 leading-snug" style={{ fontSize: size }}>→</span>}
            <Fit part={part} size={size} v={over ? "end" : "center"} className={`${first ? "font-medium" : ""} leading-snug`} box={{ flex: center ? "0 1 auto" : "1 1 0%", width: "auto", minWidth: 0 }}>
              {text({ kind: "slide", index: k })}
            </Fit>
          </div>
        );
        const count = (color: string, extra: CSSProperties = {}) => (
          <span className="tracking-[0.15em] shrink-0" style={{ fontFamily: MONO, color, fontSize: fz(0.5, null, 170), ...extra }}>{k + 1}/{n}</span>
        );
        return (
          <div key={k} className="shrink-0" style={{ width: frameWidth }}>
            <Frame w={1080} h={1350} bg={over ? "#000" : p.bg} fg={p.fg} frameRef={frameRef?.(k)}>
              {pic && (pic.cutout ? <CutoutTop url={pic.url} /> : <PictureFill url={pic.url} />)}
              {over && <Shade t={t} />}
              {layout === "numbered" ? (
                <div className={`${pic ? (pic.cutout ? CUT_TEXT : "absolute inset-0") : "h-full"} flex flex-col justify-between p-[10%]`} style={al}>
                  <span className="font-medium leading-none shrink-0" style={{ fontFamily: fonts.display, color: p.showMarks ? p.accent : p.fg, fontSize: fz(p.bold ? 2.4 : 2, t, 170), textShadow: over ? SHADOW : undefined }}>{String(k + 1).padStart(2, "0")}</span>
                  {body}
                  {count(p.fg, { opacity: 0.6 })}
                </div>
              ) : layout === "progress" ? (
                <div className={`${pic ? (pic.cutout ? CUT_TEXT : "absolute inset-0") : "h-full"} flex flex-col justify-between p-[10%] pb-[8%]`} style={al}>
                  {body}
                  <div className="w-full flex gap-[3%] shrink-0">
                    {slides.map((__, j) => (
                      <span key={j} className="flex-1 rounded-full" style={{ height: p.bold ? 4 : 3, background: j <= k ? (p.showMarks ? p.accent : p.fg) : `color-mix(in srgb, ${p.fg} 18%, transparent)` }} />
                    ))}
                  </div>
                </div>
              ) : (
                <div className={`${pic ? (pic.cutout ? CUT_TEXT : "absolute inset-0") : "h-full"} flex flex-col justify-between p-[10%]`} style={al}>
                  {count(p.showMarks ? p.sign : p.fg, { fontWeight: 500, fontSize: fz(0.55, null, 170) })}
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
