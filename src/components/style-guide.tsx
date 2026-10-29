"use client";

/**
 * The style guide (Relume's Style Guide tab, for a personal brand): colour
 * cards with their shades, the neutrals, heading and body type, and a live
 * preview of a post and a carousel slide in that look. Shuffle colours (C),
 * shuffle type (T) and shuffle the scheme (Space) to explore; nothing is kept
 * until Save. Below it, the rest of the Visual Core: the website it was read
 * from, notes, layout, motifs, photo style and reference designs.
 */
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { Check, Globe, ImagePlus, Moon, Plus, Shuffle, Sun, X } from "lucide-react";
import { btnClass } from "@/components/btn";
import { readSiteBrandAction, saveVisualAction, uploadAssetAction } from "@/app/w/[id]/brand/actions";
import { MAX_REFERENCES, type SiteBrand, type VisualCore } from "@/lib/visual/core";
import type { VisualIdentity } from "@/lib/data/foundation";

const HEX = /^#[0-9a-f]{6}$/i;

// ---- colour maths ---------------------------------------------------------------------

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
const mix = (a: string, b: string, t: number) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const lum = (h: string) => {
  const [r, g, b] = rgb(h).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const onColour = (h: string) => (lum(h) > 0.45 ? "#0A0A0A" : "#FFFFFF");
function hsl(h: string) {
  const [r, g, b] = rgb(h).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: hue * 60, s, l };
}
/** A plain-words name for a colour: "Deep green", "Soft cream", "Ink". */
function nameOf(h: string): string {
  const { h: hue, s, l } = hsl(h);
  if (s < 0.12) return l > 0.94 ? "White" : l > 0.8 ? "Mist" : l > 0.55 ? "Stone" : l > 0.25 ? "Graphite" : "Ink";
  const names: [number, string][] = [[15, "Red"], [40, "Orange"], [55, "Gold"], [70, "Yellow"], [160, "Green"], [190, "Teal"], [250, "Blue"], [290, "Violet"], [335, "Magenta"], [360, "Red"]];
  let base = names.find(([max]) => hue < max)?.[1] ?? "Red";
  if (base === "Orange" && l > 0.8) base = "Cream";
  if (base === "Yellow" && l > 0.85) base = "Cream";
  const tone = l > 0.85 ? "Soft" : l > 0.65 ? "Light" : l < 0.25 ? "Deep" : s > 0.7 ? "Bright" : "";
  return tone ? `${tone} ${base.toLowerCase()}` : base;
}
const shades = (h: string) => [0.85, 0.6, 0.3, 0, -0.3, -0.55, -0.75].map((t) => (t >= 0 ? mix(h, "#FFFFFF", t) : mix(h, "#000000", -t)));

// Curated looks to shuffle through: [ground, accent, ink, support].
const PALETTES: string[][] = [
  ["#F6F1E9", "#1F4D3A", "#141414", "#C9A227"],
  ["#FFFFFF", "#0047FF", "#0A0A0A", "#FFD166"],
  ["#F4EFE6", "#B5452B", "#1D1A16", "#7A8B6F"],
  ["#0E1116", "#F2E8CF", "#F7F7F2", "#E07A5F"],
  ["#FAFAF7", "#2F2E8C", "#151515", "#F2B5D4"],
  ["#EEF2EC", "#2E5E4E", "#10201A", "#E9C46A"],
  ["#FFF8F0", "#E4572E", "#1B1B1B", "#29335C"],
  ["#F5F5F5", "#111111", "#111111", "#9A9A9A"],
];
const FONT_PAIRS: [string, string][] = [
  ["Fraunces", "Inter"], ["Playfair Display", "Source Sans 3"], ["DM Serif Display", "DM Sans"], ["Space Grotesk", "Inter"],
  ["Aleo", "Spectral"], ["Libre Baskerville", "Work Sans"], ["Syne", "Manrope"], ["Instrument Serif", "Archivo"],
];
const GOOGLE = new Set(FONT_PAIRS.flat());

/** Loads the fonts being previewed from Google Fonts (preview only; nothing is stored). */
function FontLoader({ fonts }: { fonts: string[] }) {
  const families = fonts.filter((f) => GOOGLE.has(f));
  if (!families.length) return null;
  const href = `https://fonts.googleapis.com/css2?${families.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}`).join("&")}&display=swap`;
  return <link rel="stylesheet" href={href} />;
}
const stack = (f: string | undefined, fallback: string) => (f ? `"${f}", ${fallback}` : fallback);

// ---- the page ---------------------------------------------------------------------------

export function StyleGuide({ tenantId, initial, references, brandName, hook }: {
  tenantId: string;
  initial: VisualIdentity;
  references: { id: string; url: string }[];
  /** For the preview: whose post it is, and a line from their writing. */
  brandName: string;
  hook: string;
}) {
  const router = useRouter();
  const core0: VisualCore = initial.core ?? {};
  const [palette, setPalette] = useState<string[]>(initial.palette.length ? initial.palette.map((c) => c.toUpperCase()) : PALETTES[0]);
  const [fonts, setFonts] = useState<string[]>(initial.fonts.length ? initial.fonts : FONT_PAIRS[0]);
  const [roles, setRoles] = useState<Record<string, string>>(core0.roles ?? {});
  const [notes, setNotes] = useState(initial.imageStyleNotes);
  const [layout, setLayout] = useState(core0.layout ?? "");
  const [motifs, setMotifs] = useState(core0.motifs ?? "");
  const [photoStyle, setPhotoStyle] = useState(core0.photoStyle ?? "");
  const [site, setSite] = useState<VisualCore["site"]>(core0.site);
  const [dark, setDark] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, start] = useTransition();
  const touch = () => { setDirty(true); setSaved(false); };

  const bad = palette.some((c) => !HEX.test(c));
  const ok = palette.filter((c) => HEX.test(c));
  const ground = ok[0] ?? "#FFFFFF";
  const accent = ok[1] ?? "#0A0A0A";
  const ink = [...ok].sort((a, b) => lum(a) - lum(b))[0] ?? "#0A0A0A";
  const bg = dark ? ink : ground;
  const fg = dark ? (lum(ground) > 0.5 ? ground : "#FFFFFF") : (ink === ground ? onColour(ground) : ink);
  const neutrals = [0.04, 0.12, 0.3, 0.5, 0.7, 0.86, 0.96].map((t) => mix("#FFFFFF", ink, t));

  const shuffleColours = () => { const i = (PALETTES.findIndex((p) => p[0] === palette[0] && p[1] === palette[1]) + 1) % PALETTES.length; setPalette(PALETTES[i]); setOpen(null); touch(); };
  const shuffleType = () => { const i = (FONT_PAIRS.findIndex((p) => p[0] === fonts[0]) + 1) % FONT_PAIRS.length; setFonts([...FONT_PAIRS[i]]); touch(); };
  /** Scheme shuffle: the next colour becomes the accent (Relume's "Scheme shuffle"). */
  const shuffleScheme = () => { if (ok.length < 3) return; const [g, a, ...rest] = palette; setPalette([g, ...rest, a]); touch(); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable], button, a")) return;
      if (e.key === "c" || e.key === "C") shuffleColours();
      else if (e.key === "t" || e.key === "T") shuffleType();
      else if (e.code === "Space") { e.preventDefault(); shuffleScheme(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const save = () => start(async () => {
    await saveVisualAction(tenantId, {
      palette, fonts, imageStyleNotes: notes,
      core: { roles, layout, motifs, photoStyle, site, references: references.map((r) => r.id) },
    });
    setDirty(false);
    setSaved(true);
    router.refresh();
  });

  return (
    <div className="flex flex-col gap-10">
      <FontLoader fonts={fonts} />
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] gap-8 items-start">
        {/* Left: colours and type */}
        <div className="flex flex-col gap-10 min-w-0">
          <section className="flex flex-col gap-5">
            <Head title="Colours">
              <div className="hu-seg" role="radiogroup" aria-label="Preview in light or dark">
                <button type="button" role="radio" aria-checked={!dark} aria-label="Preview light" onClick={() => setDark(false)} className="hu-seg__item !px-3"><Sun size={15} /></button>
                <button type="button" role="radio" aria-checked={dark} aria-label="Preview dark" onClick={() => setDark(true)} className="hu-seg__item !px-3"><Moon size={15} /></button>
              </div>
              <ShuffleBtn onClick={shuffleColours} k="C" />
            </Head>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 auto-rows-[11rem]">
              <div className="row-span-2 rounded-2xl overflow-hidden border border-hairline flex flex-col" aria-label="Neutrals">
                <div className="bg-paper px-4 pt-4 pb-6 text-sm font-medium">Neutrals</div>
                {neutrals.map((n) => <div key={n} className="flex-1" style={{ background: n }} title={n} />)}
              </div>
              {palette.map((c, i) => (
                <ColourCard
                  key={i}
                  colour={c}
                  role={i === 0 ? "Ground" : i === 1 ? "Main" : null}
                  big={i === 0}
                  open={open === i}
                  onOpen={() => setOpen(open === i ? null : i)}
                  use={roles[c.toUpperCase()] ?? ""}
                  onChange={(v) => { setPalette(palette.map((x, j) => (j === i ? v.toUpperCase() : x))); touch(); }}
                  onUse={(v) => { setRoles({ ...roles, [c.toUpperCase()]: v }); touch(); }}
                  onRemove={palette.length > 1 ? () => { setPalette(palette.filter((_, j) => j !== i)); setOpen(null); touch(); } : undefined}
                />
              ))}
              {palette.length < 8 && (
                <button type="button" onClick={() => { setPalette([...palette, "#888888"]); setOpen(palette.length); touch(); }}
                  className="rounded-2xl border border-dashed border-line hover:border-ink grid place-items-center text-ink-muted hover:text-ink" aria-label="Add a colour">
                  <Plus size={22} aria-hidden="true" />
                </button>
              )}
            </div>
            {bad && <p className="text-xs text-danger">Use six-digit hex values, like #0A0A0A.</p>}
          </section>

          <section className="flex flex-col gap-5">
            <Head title="Typography">
              <span className="text-sm text-ink-muted">Headings first</span>
              <ShuffleBtn onClick={shuffleType} k="T" />
            </Head>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(["Heading", "Body"] as const).map((label, i) => (
                <div key={label} className="rounded-2xl border border-hairline bg-paper p-5 flex flex-col gap-4 min-h-[13rem]">
                  <span className="text-sm text-ink-muted">{label}</span>
                  <span className="text-[2.6rem] leading-none truncate" style={{ fontFamily: stack(fonts[i], i === 0 ? "Georgia, serif" : "system-ui, sans-serif") }}>{fonts[i] || "Not set"}</span>
                  <span className="text-ink-muted text-sm" style={{ fontFamily: stack(fonts[i], "inherit") }}>Aa Bb Cc 0123 — The quick brown fox</span>
                  <input
                    value={fonts[i] ?? ""}
                    onChange={(e) => { const next = [...fonts]; next[i] = e.target.value; setFonts(next); touch(); }}
                    aria-label={`${label} font`}
                    placeholder={i === 0 ? "Heading font" : "Body font"}
                    className="mt-auto field !min-h-10 text-sm"
                  />
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right: the live preview */}
        <aside className="xl:sticky xl:top-4 flex flex-col gap-3" aria-label="Live preview">
          <div className="rounded-2xl border border-hairline overflow-hidden bg-field p-4 sm:p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="label-mono text-ink-faint">Live preview</span>
              <span className="text-xs text-ink-faint">{dark ? "Dark" : "Light"} · {nameOf(accent)}</span>
            </div>
            {/* A carousel slide */}
            <div className="aspect-[4/5] w-full rounded-xl overflow-hidden flex flex-col justify-between p-[7%] transition-colors duration-300" style={{ background: bg, color: fg }}>
              <span className="text-[11px] tracking-[0.2em] uppercase font-semibold" style={{ color: accent === bg ? fg : accent, fontFamily: stack(fonts[1], "system-ui, sans-serif") }}>{brandName} · Note 01</span>
              <span className="text-[clamp(1.6rem,3.2vw,2.8rem)] leading-[1.05] tracking-[-0.01em]" style={{ fontFamily: stack(fonts[0], "Georgia, serif") }}>
                {hook}
              </span>
              <span className="flex items-center justify-between text-xs" style={{ fontFamily: stack(fonts[1], "system-ui, sans-serif") }}>
                <span className="opacity-75">{brandName}</span>
                <span className="px-3 py-1.5 rounded-full font-semibold" style={{ background: accent === bg ? fg : accent, color: onColour(accent === bg ? fg : accent) }}>Read more</span>
              </span>
            </div>
            {/* A quote card strip */}
            <div className="grid grid-cols-3 gap-2">
              {[ok[1] ?? accent, ok[2] ?? ink, ok[3] ?? ground].map((c, i) => (
                <div key={i} className="aspect-square rounded-lg p-3 flex items-end text-[11px] leading-tight" style={{ background: c, color: onColour(c), fontFamily: stack(fonts[0], "Georgia, serif") }}>
                  {["Say the specific thing.", "Show the work.", "Keep it plain."][i]}
                </div>
              ))}
            </div>
          </div>
          <button type="button" onClick={shuffleScheme} disabled={ok.length < 3} className="w-full min-h-12 rounded-2xl border border-hairline bg-paper inline-flex items-center justify-center gap-2 text-sm hover:border-line disabled:opacity-50">
            <Shuffle size={15} aria-hidden="true" /> Scheme shuffle <kbd className="ml-1 text-[11px] font-mono px-1.5 py-0.5 rounded bg-field text-ink-muted">Space</kbd>
          </button>
        </aside>
      </div>

      <More tenantId={tenantId} site={site} onSite={(found) => {
        if (found.palette.length) setPalette(found.palette.map((c) => c.toUpperCase()));
        if (found.fonts.length) setFonts(found.fonts);
        setSite({ url: found.url, logo: found.logo, at: new Date().toISOString() });
        touch();
      }}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Area label="Image notes" value={notes} onChange={(v) => { setNotes(v); touch(); }} placeholder="Real photos over stock. Lots of white space. No gradients." />
          <Area label="Photo style" value={photoStyle} onChange={(v) => { setPhotoStyle(v); touch(); }} placeholder="Natural light, real people at work" />
          <Area label="Layout grid" value={layout} onChange={(v) => { setLayout(v); touch(); }} placeholder="Wide margins, one column, text left-aligned" />
          <Area label="Motifs" value={motifs} onChange={(v) => { setMotifs(v); touch(); }} placeholder="A hand-drawn underline under the key phrase" />
        </div>
        <References tenantId={tenantId} references={references} />
      </More>

      {/* Save: always in reach, says when there's something to keep. */}
      <div className="sticky bottom-4 z-10 flex justify-end">
        <div className="flex items-center gap-3 bg-paper border border-hairline rounded-full pl-5 pr-1.5 py-1.5 shadow-[var(--shadow)]">
          <span className="text-sm text-ink-muted" role="status">
            {saved ? <span className="text-ok inline-flex items-center gap-1.5"><Check size={14} aria-hidden="true" /> Saved. Every visual reads it now.</span> : dirty ? "Unsaved changes" : "Shuffle with C, T and Space"}
          </span>
          <button type="button" onClick={save} disabled={saving || bad || !dirty} className={btnClass("primary", "sm")}>{saving ? "Saving" : "Save style guide"}</button>
        </div>
      </div>
    </div>
  );
}

// ---- pieces -----------------------------------------------------------------------------

const Head = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-3">
    <h2 className="text-[1.75rem] leading-none tracking-[-0.015em] flex-1">{title}</h2>
    {children}
  </div>
);

const ShuffleBtn = ({ onClick, k }: { onClick: () => void; k: string }) => (
  <button type="button" onClick={onClick} className="inline-flex items-center gap-2 min-h-11 px-4 rounded-full border border-hairline bg-paper text-sm hover:border-line">
    <Shuffle size={15} aria-hidden="true" /> Shuffle <kbd className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-field text-ink-muted">{k}</kbd>
  </button>
);

function ColourCard({ colour, role, big, open, onOpen, use, onChange, onUse, onRemove }: {
  colour: string; role: string | null; big: boolean; open: boolean; onOpen: () => void; use: string;
  onChange: (v: string) => void; onUse: (v: string) => void; onRemove?: () => void;
}) {
  const valid = HEX.test(colour);
  const c = valid ? colour : "#DDDDDD";
  const text = onColour(c);
  return (
    <div className={`relative rounded-2xl overflow-hidden flex flex-col border border-hairline ${big ? "row-span-2" : ""}`} style={{ background: c, color: text }}>
      <button type="button" onClick={onOpen} className="flex-1 text-left p-4 flex flex-col justify-between" aria-expanded={open} aria-label={`Edit ${nameOf(c)} ${colour}`}>
        <span className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium">{nameOf(c)}</span>
          {role && <span className="text-[11px] px-2 py-0.5 rounded-md shrink-0" style={{ background: text, color: c }}>{role}</span>}
        </span>
        <span className="font-mono text-lg">{colour.replace("#", "")}</span>
      </button>
      <div className="flex h-3 mx-4 mb-4 rounded-full overflow-hidden" aria-hidden="true">
        {shades(c).map((s, i) => <span key={i} className="flex-1" style={{ background: s }} />)}
      </div>
      {open && (
        <div className="absolute inset-x-2 bottom-2 z-10 bg-paper text-ink rounded-xl border border-hairline shadow-[var(--shadow)] p-3 flex flex-col gap-2 pop">
          <div className="flex items-center gap-2">
            <input value={colour} onChange={(e) => onChange(e.target.value.trim())} aria-label="Hex value" aria-invalid={!valid} spellCheck={false} className="field !min-h-9 font-mono text-sm flex-1" autoFocus />
            {onRemove && <button type="button" onClick={onRemove} aria-label="Remove this colour" className="hu-iconbtn"><X size={15} /></button>}
          </div>
          <input value={use} onChange={(e) => onUse(e.target.value)} placeholder="When to use it" aria-label="When to use this colour" className="field !min-h-9 text-xs" />
        </div>
      )}
    </div>
  );
}

const Area = ({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) => (
  <label className="block">
    <span className="hu-label !flex mb-2">{label}</span>
    <textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="field" />
  </label>
);

function More({ tenantId, site, onSite, children }: { tenantId: string; site: VisualCore["site"]; onSite: (f: SiteBrand & { url: string }) => void; children: ReactNode }) {
  const [url, setUrl] = useState(site?.url ?? "");
  const [error, setError] = useState<string | null>(null);
  const [reading, start] = useTransition();
  const read = () => start(async () => {
    setError(null);
    const r = await readSiteBrandAction(tenantId, url);
    if (!r.ok) return setError(r.error);
    onSite(r.value);
  });
  return (
    <section className="flex flex-col gap-6 border-t border-hairline pt-8">
      <Head title="The rest of your look" />
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium flex items-center gap-2"><Globe size={15} aria-hidden="true" /> Start from your website</span>
        <div className="hu-composer max-w-2xl !flex-row !items-center !py-2">
          <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && url.trim()) { e.preventDefault(); read(); } }} placeholder="yourcompany.com" aria-label="Your website" />
          <button type="button" disabled={!url.trim() || reading} onClick={read} className={`${btnClass("primary", "sm")} shrink-0`}>{reading ? "Reading your site" : "Read my site"}</button>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        {site && <p className="text-xs text-ink-faint">Read from {site.url}. Its colours and fonts are in the style guide above; save to keep them.</p>}
      </div>
      {children}
    </section>
  );
}

function References({ tenantId, references }: { tenantId: string; references: { id: string; url: string }[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const upload = (file?: File) => {
    if (!file) return;
    start(async () => {
      const fd = new FormData();
      fd.append("tenantId", tenantId);
      fd.append("kind", "reference_image");
      fd.append("file", file);
      await uploadAssetAction(fd);
      router.refresh();
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Designs that look like you <span className="text-ink-faint font-normal">· up to {MAX_REFERENCES}</span></span>
      <div className="flex flex-wrap gap-3">
        {references.slice(0, MAX_REFERENCES).map((r) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={r.id} src={r.url} alt="A reference design" className="w-32 h-32 object-cover rounded-xl border border-hairline" />
        ))}
        {references.length < MAX_REFERENCES && (
          <label className="w-32 h-32 rounded-xl border border-dashed border-line flex flex-col items-center justify-center gap-1 text-xs text-ink-muted cursor-pointer hover:border-line-strong">
            <ImagePlus size={18} aria-hidden="true" /> {busy ? "Uploading" : "Add a design"}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
          </label>
        )}
      </div>
      <p className="text-xs text-ink-faint">Branded posts or ads you already like. They show the look; they are never copied.</p>
    </div>
  );
}
