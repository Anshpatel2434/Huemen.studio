"use client";

/**
 * The customer's hue: palette, fonts and image notes (onboarding step 3 and
 * Brand core › Visual). The design system calls hue "their distinct colour and
 * positioning"; this is the colour half. Visuals are rendered from these, and
 * the first two colours become ground and accent.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Globe, ImagePlus, Pipette, Plus, X } from "lucide-react";
import { paletteFromPixels } from "@/lib/visual/palette";
import { btnClass } from "@/components/btn";
import { readSiteBrandAction, saveVisualAction, uploadAssetAction } from "@/app/w/[id]/brand/actions";
import { MAX_REFERENCES, type SiteBrand, type VisualCore } from "@/lib/visual/core";
import { useStepDraft } from "@/app/w/[id]/onboarding/draft";
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

export function VisualForm({ tenantId, initial, logoUrl, references = [], back }: {
  tenantId: string;
  initial: VisualIdentity;
  logoUrl?: string | null;
  /** Reference designs already uploaded (assets of kind reference_image). */
  references?: { id: string; url: string }[];
  /** Where an upload returns to (onboarding keeps its step). */
  back?: string;
}) {
  const router = useRouter();
  // Drafts inside onboarding (a reload keeps unsaved colours); plain state elsewhere.
  const [palette, setPalette] = useStepDraft<string[]>("visual:palette", initial.palette.length ? initial.palette : ["#0A0A0A", "#FFFFFF"]);
  const [fonts, setFonts] = useStepDraft("visual:fonts", initial.fonts.join(", "));
  const [notes, setNotes] = useStepDraft("visual:notes", initial.imageStyleNotes);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const [suggested, setSuggested] = useState<string[] | null>(null);
  const [readingLogo, setReadingLogo] = useState(false);
  // The Visual Core beyond palette and fonts (lib/visual/core).
  const core0: VisualCore = initial.core ?? {};
  const [roles, setRoles] = useStepDraft<Record<string, string>>("visual:roles", core0.roles ?? {});
  const [layout, setLayout] = useStepDraft("visual:layout", core0.layout ?? "");
  const [motifs, setMotifs] = useStepDraft("visual:motifs", core0.motifs ?? "");
  const [photoStyle, setPhotoStyle] = useStepDraft("visual:photo", core0.photoStyle ?? "");
  const [site, setSite] = useState<VisualCore["site"]>(core0.site);
  const [siteUrl, setSiteUrl] = useState(core0.site?.url ?? "");
  const [found, setFound] = useState<(SiteBrand & { url: string }) | null>(null);
  const [siteError, setSiteError] = useState<string | null>(null);
  const [reading, startReading] = useTransition();
  const readSite = () => startReading(async () => {
    setSiteError(null);
    const r = await readSiteBrandAction(tenantId, siteUrl);
    if (!r.ok) { setFound(null); setSiteError(r.error); return; }
    setFound(r.value);
  });
  const useFound = () => {
    if (!found) return;
    if (found.palette.length) setPalette(found.palette);
    if (found.fonts.length) setFonts(found.fonts.join(", "));
    setSite({ url: found.url, logo: found.logo, at: new Date().toISOString() });
    setFound(null);
    setSaved(false);
  };

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
      {/* Start from the website (Obello-style): colours, fonts and logo read off the site. */}
      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium flex items-center gap-2"><Globe size={15} aria-hidden="true" /> Start from your website</span>
        <div className="hu-composer max-w-2xl !flex-row !items-center !py-2">
          <input type="text" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && siteUrl.trim()) { e.preventDefault(); readSite(); } }} placeholder="yourcompany.com" aria-label="Your website" />
          <button type="button" disabled={!siteUrl.trim() || reading} onClick={readSite} className={`${btnClass("primary", "sm")} shrink-0`}>{reading ? "Reading your site" : "Read my site"}</button>
        </div>
        {siteError && <p className="text-sm text-danger">{siteError}</p>}
        {found && (
          <div className="flex flex-wrap items-center gap-4 bg-field rounded-xl p-4 fade-up">
            {found.logo && <img src={found.logo} alt="Logo found on your site" className="h-12 max-w-[160px] object-contain bg-paper rounded-md p-1.5" />}
            <span className="flex gap-1" aria-label={`Colours found: ${found.palette.join(", ") || "none"}`}>
              {found.palette.map((c) => <span key={c} className="w-7 h-7 rounded-sm border border-hairline" style={{ background: c }} title={c} />)}
            </span>
            <span className="text-sm text-ink-muted">{found.fonts.length ? found.fonts.join(", ") : "No fonts named"}</span>
            <span className="flex-1" />
            <button type="button" onClick={useFound} className={btnClass("secondary", "sm")}>Use these</button>
          </div>
        )}
        {site && !found && <p className="text-xs text-ink-faint">Read from {site.url}{site.logo ? ", logo found" : ""}.</p>}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium mb-1">Palette</legend>
        <div className="flex flex-wrap gap-3">
          {palette.map((c, i) => (
            <div key={i} className="flex items-center gap-2 border border-hairline rounded-md p-2 pr-1">
              <input
                type="color"
                value={HEX.test(c) ? c : "#000000"}
                onChange={(e) => set(i, e.target.value)}
                aria-label={`Colour ${i + 1}`}
                className="w-11 h-11 rounded-sm border border-hairline cursor-pointer bg-transparent"
              />
              <div className="flex flex-col">
                <span className="label-mono text-ink-faint">{ROLE[i] ?? `Colour ${i + 1}`}</span>
                <input
                  value={c}
                  onChange={(e) => set(i, e.target.value)}
                  aria-label={`Hex for colour ${i + 1}`}
                  aria-invalid={!HEX.test(c)}
                  className="w-[6rem] min-h-11 -my-2 font-mono text-sm bg-transparent outline-none"
                />
                <input
                  value={roles[c.toUpperCase()] ?? ""}
                  onChange={(e) => { setSaved(false); setRoles({ ...roles, [c.toUpperCase()]: e.target.value }); }}
                  aria-label={`When to use colour ${i + 1}`}
                  placeholder="When to use it"
                  className="w-[11rem] text-xs bg-transparent outline-none placeholder:text-ink-faint border-t border-hairline pt-1"
                />
              </div>
              {palette.length > 1 && (
                <button type="button" onClick={() => { setSaved(false); setPalette(palette.filter((_, j) => j !== i)); }} className="hu-hit w-7 h-7 rounded-sm flex items-center justify-center text-ink-faint hover:text-ink hover:bg-field" aria-label={`Remove colour ${i + 1}`}>
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
        {bad && <p className="text-xs text-danger">Use six-digit hex values, like #0A0A0A.</p>}
        {logoUrl && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" disabled={readingLogo} onClick={fromLogo} className={btnClass("ghost", "sm")}>
              <Pipette size={14} aria-hidden="true" /> {readingLogo ? "Reading your logo" : "Suggest colours from my logo"}
            </button>
            {suggested && suggested.length === 0 && <span className="text-sm text-ink-muted">No clear colours in that logo. Pick them by hand.</span>}
            {suggested && suggested.length > 0 && (
              <>
                <span className="flex gap-1" aria-label={`Suggested: ${suggested.join(", ")}`}>
                  {suggested.map((c) => <span key={c} className="w-6 h-6 rounded-sm border border-hairline" style={{ background: c }} title={c} />)}
                </span>
                <button type="button" onClick={() => { setPalette(suggested); setSuggested(null); setSaved(false); }} className={btnClass("secondary", "sm")}>Use these</button>
              </>
            )}
          </div>
        )}
      </fieldset>

      <label className="block max-w-md">
        <span className="hu-label !flex mb-2">Fonts</span>
        <input value={fonts} onChange={(e) => { setSaved(false); setFonts(e.target.value); }} placeholder="Heading font, body font" className="field" />
        <span className="block text-xs text-ink-faint mt-1">Comma-separated. Headings first.</span>
      </label>

      <label className="block">
        <span className="hu-label !flex mb-2">Image notes</span>
        <textarea rows={3} value={notes} onChange={(e) => { setSaved(false); setNotes(e.target.value); }} placeholder="Real photos over stock. Lots of white space. No gradients." className="field" />
      </label>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label className="block">
          <span className="hu-label !flex mb-2">Layout grid</span>
          <textarea rows={2} value={layout} onChange={(e) => { setSaved(false); setLayout(e.target.value); }} placeholder="Wide margins, one column, text left-aligned" className="field" />
        </label>
        <label className="block">
          <span className="hu-label !flex mb-2">Motifs</span>
          <textarea rows={2} value={motifs} onChange={(e) => { setSaved(false); setMotifs(e.target.value); }} placeholder="A red dot before every headline" className="field" />
        </label>
        <label className="block">
          <span className="hu-label !flex mb-2">Photo style</span>
          <textarea rows={2} value={photoStyle} onChange={(e) => { setSaved(false); setPhotoStyle(e.target.value); }} placeholder="Natural light, real people at work" className="field" />
        </label>
      </div>

      {/* Reference designs: "this is our look", up to three. */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Designs that look like you <span className="text-ink-faint font-normal">· up to {MAX_REFERENCES}</span></span>
        <div className="flex flex-wrap gap-3">
          {references.slice(0, MAX_REFERENCES).map((r) => (
            <img key={r.id} src={r.url} alt="A reference design" className="w-32 h-32 object-cover rounded-xl border border-hairline" />
          ))}
          {references.length < MAX_REFERENCES && (
            <form action={uploadAssetAction} className="w-32 h-32">
              <input type="hidden" name="tenantId" value={tenantId} />
              <input type="hidden" name="kind" value="reference_image" />
              {back && <input type="hidden" name="back" value={back} />}
              <label className="w-full h-full rounded-xl border border-dashed border-line flex flex-col items-center justify-center gap-1 text-xs text-ink-muted cursor-pointer hover:border-line-strong">
                <ImagePlus size={18} aria-hidden="true" /> Add a design
                <input type="file" name="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.currentTarget.form?.requestSubmit()} />
              </label>
            </form>
          )}
        </div>
        <p className="text-xs text-ink-faint">Branded posts or ads you already like. They show the look; they are never copied.</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending || bad}
          onClick={() => start(async () => {
            await saveVisualAction(tenantId, {
              palette, fonts: fonts.split(","), imageStyleNotes: notes,
              core: { roles, layout, motifs, photoStyle, site, references: references.map((r) => r.id) },
            });
            setSaved(true);
            router.refresh();
          })}
          className={btnClass("secondary", "sm")}
        >
          Save your hue
        </button>
        {saved && <span className="text-sm text-ok flex items-center gap-1.5"><Check size={14} aria-hidden="true" /> Saved</span>}
      </div>
    </div>
  );
}
