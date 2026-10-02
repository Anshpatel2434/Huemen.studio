"use client";

/**
 * The customer's hue: palette, fonts and image notes (onboarding step 3 and
 * Brand core › Visual). The design system calls hue "their distinct colour and
 * positioning"; this is the colour half. Visuals are rendered from these, and
 * the first two colours become ground and accent.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Pipette, Plus, X } from "lucide-react";
import { paletteFromPixels } from "@/lib/visual/palette";
import { btnClass } from "@/components/btn";
import { saveVisualAction } from "@/app/w/[id]/brand/actions";
import type { VisualIdentity } from "@/lib/data/foundation";

const HEX = /^#[0-9a-f]{6}$/i;
const ROLE = ["Ground", "Accent"];

/** Draws the logo to a canvas in the browser and reads its main colours. Nothing is uploaded to do it. */
async function coloursFrom(url: string): Promise<string[]> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();
  const w = Math.min(200, img.naturalWidth || 200);
  const h = Math.max(1, Math.round(((img.naturalHeight || 200) / (img.naturalWidth || 200)) * w));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, w, h);
  return paletteFromPixels(ctx.getImageData(0, 0, w, h).data);
}

export function VisualForm({ tenantId, initial, logoUrl }: { tenantId: string; initial: VisualIdentity; logoUrl?: string | null }) {
  const router = useRouter();
  const [palette, setPalette] = useState<string[]>(initial.palette.length ? initial.palette : ["#0A0A0A", "#FFFFFF"]);
  const [fonts, setFonts] = useState(initial.fonts.join(", "));
  const [notes, setNotes] = useState(initial.imageStyleNotes);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const [suggested, setSuggested] = useState<string[] | null>(null);
  const [readingLogo, setReadingLogo] = useState(false);

  const fromLogo = async () => {
    if (!logoUrl) return;
    setReadingLogo(true);
    try {
      const c = await coloursFrom(logoUrl);
      setSuggested(c.length ? c : []);
    } catch {
      setSuggested([]);
    } finally {
      setReadingLogo(false);
    }
  };

  const set = (i: number, v: string) => { setSaved(false); setPalette(palette.map((c, j) => (j === i ? v : c))); };
  const bad = palette.some((c) => !HEX.test(c));

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[0.88rem] font-medium mb-1">Palette</legend>
        <div className="flex flex-wrap gap-3">
          {palette.map((c, i) => (
            <div key={i} className="flex items-center gap-2 border border-hairline rounded-[10px] p-2 pr-1">
              <input
                type="color"
                value={HEX.test(c) ? c : "#000000"}
                onChange={(e) => set(i, e.target.value)}
                aria-label={`Colour ${i + 1}`}
                className="w-9 h-9 rounded-[6px] border border-hairline cursor-pointer bg-transparent"
              />
              <div className="flex flex-col">
                <span className="label-mono text-ink-faint">{ROLE[i] ?? `Colour ${i + 1}`}</span>
                <input
                  value={c}
                  onChange={(e) => set(i, e.target.value)}
                  aria-label={`Hex for colour ${i + 1}`}
                  aria-invalid={!HEX.test(c)}
                  className="w-[5.5rem] font-mono text-[0.8rem] bg-transparent outline-none"
                />
              </div>
              {palette.length > 1 && (
                <button type="button" onClick={() => { setSaved(false); setPalette(palette.filter((_, j) => j !== i)); }} className="hu-hit w-7 h-7 rounded-[6px] flex items-center justify-center text-ink-faint hover:text-ink hover:bg-field" aria-label={`Remove colour ${i + 1}`}>
                  <X size={13} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          {palette.length < 8 && (
            <button type="button" onClick={() => { setSaved(false); setPalette([...palette, "#888888"]); }} className={btnClass("ghost", "sm")}>
              <Plus size={14} aria-hidden="true" /> Add a colour
            </button>
          )}
        </div>
        {bad && <p className="text-[0.78rem] text-danger">Use six-digit hex values, like #0A0A0A.</p>}
        {logoUrl && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" disabled={readingLogo} onClick={fromLogo} className={btnClass("ghost", "sm")}>
              <Pipette size={14} aria-hidden="true" /> {readingLogo ? "Reading your logo" : "Suggest colours from my logo"}
            </button>
            {suggested && suggested.length === 0 && <span className="text-[0.8rem] text-ink-muted">No clear colours in that logo. Pick them by hand.</span>}
            {suggested && suggested.length > 0 && (
              <>
                <span className="flex gap-1" aria-label={`Suggested: ${suggested.join(", ")}`}>
                  {suggested.map((c) => <span key={c} className="w-6 h-6 rounded-[5px] border border-hairline" style={{ background: c }} title={c} />)}
                </span>
                <button type="button" onClick={() => { setPalette(suggested); setSuggested(null); setSaved(false); }} className={btnClass("secondary", "sm")}>Use these</button>
              </>
            )}
          </div>
        )}
      </fieldset>

      <label className="block max-w-md">
        <span className="block text-[0.88rem] font-medium mb-1">Fonts</span>
        <input value={fonts} onChange={(e) => { setSaved(false); setFonts(e.target.value); }} placeholder="Heading font, body font" className="field" />
        <span className="block text-[0.75rem] text-ink-faint mt-1">Comma-separated. Headings first.</span>
      </label>

      <label className="block">
        <span className="block text-[0.88rem] font-medium mb-1">Image notes</span>
        <textarea rows={3} value={notes} onChange={(e) => { setSaved(false); setNotes(e.target.value); }} placeholder="Real photos over stock. Lots of white space. No gradients." className="field" />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending || bad}
          onClick={() => start(async () => {
            await saveVisualAction(tenantId, { palette, fonts: fonts.split(","), imageStyleNotes: notes });
            setSaved(true);
            router.refresh();
          })}
          className={btnClass("secondary", "sm")}
        >
          Save your hue
        </button>
        {saved && <span className="text-[0.85rem] text-ok flex items-center gap-1.5"><Check size={14} aria-hidden="true" /> Saved</span>}
      </div>
    </div>
  );
}
