import Link from "next/link";
import { ArrowLeft, Info, Upload } from "lucide-react";
import { workspaceScope } from "@/lib/auth/workspace";
import { loadFoundation } from "@/lib/data/foundation";
import { listAssets } from "@/lib/data/assets";
import { SubmitButton } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { PersistForm } from "@/components/persist";
import { saveFoundationAction, uploadAssetAction } from "../actions";

export const metadata = { title: "Edit brief" };

function Field({ name, label, defaultValue, placeholder, rows, hint }: { name: string; label: string; defaultValue?: string; placeholder?: string; rows?: number; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium mb-1.5">{label}</span>
      {rows ? (
        <textarea name={name} defaultValue={defaultValue} placeholder={placeholder} rows={rows} className="field" />
      ) : (
        <input name={name} defaultValue={defaultValue} placeholder={placeholder} className="field" />
      )}
      {hint && <span className="block text-xs text-ink-faint mt-1">{hint}</span>}
    </label>
  );
}

function Card({ id, title, sub, children }: { id: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <section id={id} className="bg-paper border border-hairline rounded-md p-6 scroll-mt-6">
      <p className="font-medium">{title}</p>
      <p className="text-sm text-ink-muted mt-0.5 mb-5">{sub}</p>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export default async function EditBriefPage({ params, searchParams }: PageProps<"/w/[id]/brand/edit">) {
  const { id } = await params;
  const sp = await searchParams;
  const { scope } = await workspaceScope(id);
  const [f, assets] = await Promise.all([loadFoundation(scope), listAssets(scope)]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[760px] mx-auto px-8 py-8">
        <Link href={`/w/${id}/brand`} className="inline-flex items-center gap-1.5 min-h-11 text-sm text-ink-muted hover:text-ink"><ArrowLeft size={15} aria-hidden="true" /> Brief</Link>
        <h1 className="text-3xl mt-3">Edit the brief. <span className="serif-accent">Once.</span></h1>
        <p className="text-ink-muted mt-2 text-sm">This is the context every post and image is generated from. The studio degrades on purpose when it&apos;s thin.</p>

        {sp.placed && (
          <div className="mt-5 bg-panel border border-hairline rounded-md px-4 py-3 flex gap-2.5 text-sm">
            <Info size={15} className="shrink-0 mt-0.5" />
            <span>
              Filled {sp.placed} field{sp.placed === "1" ? "" : "s"} from your notes. Review below and save.
              {sp.unplaced && " Some lines had no label and were left out, so add them where they belong."}
            </span>
          </div>
        )}

        <PersistForm storageKey={`huemen:brief:${id}`} action={saveFoundationAction} className="mt-6 flex flex-col gap-5">
          <input type="hidden" name="tenantId" value={id} />
          <Card id="story" title="Story & positioning" sub="What they do, for whom, and the story behind it.">
            <Field name="niche" label="Niche" defaultValue={f.niche} placeholder="e.g. Personal branding for B2B founders" />
            <Field name="positioning" label="Positioning statement" defaultValue={f.positioning} rows={2} placeholder="I help ___ do ___ so they can ___." />
            <Field name="audience" label="Audience" defaultValue={f.audience} rows={2} />
            <Field name="offers" label="Offers (summary)" defaultValue={f.offers} rows={2} />
            {f.chapters.map((ch, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-3">
                <Field name={`ch${i}_title`} label={`Chapter ${i + 1}`} defaultValue={ch.title} placeholder={["Origin", "Turning point", "Now"][i]} />
                <Field name={`ch${i}_body`} label="Story" defaultValue={ch.body} rows={2} />
              </div>
            ))}
          </Card>

          <Card id="voice" title="Voice" sub="Enforced in every prompt and checked after every draft.">
            <Field name="tone" label="Tone descriptors" defaultValue={f.tone} placeholder="direct, warm, contrarian" hint="Comma-separated." />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field name="doWords" label="Do-words" defaultValue={f.doWords} hint="Comma-separated." />
              <Field name="dontWords" label="Don't-words" defaultValue={f.dontWords} hint="Flagged in drafts, never auto-removed." />
            </div>
            <Field name="readingLevel" label="Reading level" defaultValue={f.readingLevel} placeholder="e.g. grade 8" />
            <Field name="samplePosts" label="Sample posts (3–5)" defaultValue={f.samplePosts} rows={6} hint="One post per line." />
          </Card>

          <Card id="visual" title="Visual identity" sub="Appended to every image prompt and used by the templated visuals.">
            <Field name="palette" label="Palette" defaultValue={f.palette} placeholder="#0A0A0A, #FFFFFF, #F4F4F4" hint="Hex values, comma-separated. The first two become ground and accent." />
            <Field name="fonts" label="Fonts" defaultValue={f.fonts} placeholder="Inter, Instrument Serif" />
            <Field name="imageStyleNotes" label="Image style notes" defaultValue={f.imageStyleNotes} rows={2} placeholder="Candid, natural light. No stock handshakes." />
          </Card>

          <div className="sticky bottom-0 -mx-8 px-8 py-3 bg-ground/90 backdrop-blur border-t border-hairline flex items-center justify-end gap-2">
            <Link href={`/w/${id}/brand`} className={btnClass("ghost")}>Cancel</Link>
            <SubmitButton pendingLabel="Saving…">Save brief</SubmitButton>
          </div>
        </PersistForm>

        <section id="assets" className="mt-6 mb-16 bg-paper border border-hairline rounded-md p-6 scroll-mt-6">
          <p className="font-medium">Brand assets</p>
          <p className="text-sm text-ink-muted mt-0.5 mb-4">Logos, fonts and reference images. PNG, JPG, WebP, SVG or font files, max 5 MB.</p>
          <form action={uploadAssetAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="tenantId" value={id} />
            <input type="file" name="file" required className="text-sm file:mr-3 file:min-h-11 file:rounded-full file:border file:border-line file:bg-transparent file:px-5 file:text-sm file:font-medium file:cursor-pointer hover:file:border-line-strong" />
            <select name="kind" defaultValue="logo" className="field !w-auto">
              <option value="logo">Logo</option>
              <option value="reference_image">Reference image</option>
              <option value="font">Font</option>
            </select>
            <SubmitButton variant="secondary" pendingLabel="Uploading…"><Upload size={14} /> Upload</SubmitButton>
          </form>
          {assets.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-3">
              {assets.map((a) => (
                <div key={a.id} className="w-28 bg-panel border border-hairline rounded-md p-2">
                  {a.mime.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.url} alt={a.kind} className="w-full h-16 object-contain" />
                  ) : (
                    <div className="h-16 flex items-center justify-center text-xs text-ink-faint">{a.mime}</div>
                  )}
                  <p className="label-mono text-ink-faint mt-1 truncate">{a.kind.replace("_", " ")}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
