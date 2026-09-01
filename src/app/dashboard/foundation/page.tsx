import { requireSession } from "@/lib/auth";
import { resolveScope } from "@/lib/auth/scope";
import { loadFoundation } from "@/lib/data/foundation";
import { listAssets } from "@/lib/data/assets";
import { saveFoundationAction, uploadAssetAction } from "./actions";

export const dynamic = "force-dynamic";

const labelCls = "eyebrow block mb-1.5";
const inputCls =
  "w-full border border-hairline bg-muted-surface px-3 py-2 text-sm focus:outline-none focus:border-ink";

function Field({
  name,
  label,
  defaultValue,
  placeholder,
  textarea,
  rows,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  textarea?: boolean;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {textarea ? (
        <textarea name={name} defaultValue={defaultValue} placeholder={placeholder}
          rows={rows ?? 3} className={inputCls} />
      ) : (
        <input name={name} defaultValue={defaultValue} placeholder={placeholder}
          className={inputCls} />
      )}
    </label>
  );
}

export default async function FoundationPage() {
  const session = await requireSession();
  const scope = await resolveScope(session);
  const f = await loadFoundation(scope);
  const assets = await listAssets(scope);

  return (
    <div>
      <p className="eyebrow mb-2">Brand Foundation</p>
      <h1 className="text-3xl tracking-tight mb-2">
        Define it <span className="serif-accent">once.</span>
      </h1>
      <p className="text-sm text-ink-muted mb-8 max-w-xl">
        This is the context every post and image is generated from. Fill it well
        — the studio degrades on purpose when it&apos;s thin.
      </p>

      <form action={saveFoundationAction} className="flex flex-col gap-8">
        <section className="flex flex-col gap-4">
          <h2 className="text-lg border-b border-hairline pb-2">Story &amp; positioning</h2>
          <Field name="niche" label="Niche" defaultValue={f.niche}
            placeholder="e.g. Personal branding for B2B founders" />
          <Field name="positioning" label="Positioning statement" defaultValue={f.positioning}
            textarea rows={2} />
          <Field name="audience" label="Audience" defaultValue={f.audience} textarea rows={2} />
          <Field name="offers" label="Offers" defaultValue={f.offers} textarea rows={2} />
          {f.chapters.map((ch, i) => (
            <div key={i} className="grid grid-cols-3 gap-3">
              <Field name={`ch${i}_title`} label={`Chapter ${i + 1} — title`} defaultValue={ch.title} />
              <div className="col-span-2">
                <Field name={`ch${i}_body`} label="Body" defaultValue={ch.body} textarea rows={2} />
              </div>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-lg border-b border-hairline pb-2">Voice</h2>
          <Field name="tone" label="Tone descriptors (comma-separated)" defaultValue={f.tone}
            placeholder="direct, warm, contrarian" />
          <div className="grid grid-cols-2 gap-3">
            <Field name="doWords" label="Do-words (comma)" defaultValue={f.doWords} />
            <Field name="dontWords" label="Don't-words (comma)" defaultValue={f.dontWords} />
          </div>
          <Field name="readingLevel" label="Reading level" defaultValue={f.readingLevel}
            placeholder="e.g. grade 8" />
          <Field name="samplePosts" label="Sample posts (one per line, 3–5)"
            defaultValue={f.samplePosts} textarea rows={5} />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-lg border-b border-hairline pb-2">Visual identity</h2>
          <Field name="palette" label="Palette — hex values (comma)" defaultValue={f.palette}
            placeholder="#000000, #FF3429, #F4F4F4" />
          <Field name="fonts" label="Fonts (comma)" defaultValue={f.fonts} />
          <Field name="imageStyleNotes" label="Image style notes" defaultValue={f.imageStyleNotes}
            textarea rows={2} />
        </section>

        <div>
          <button type="submit"
            className="bg-ink text-paper px-6 py-3 text-sm font-medium hover:bg-accent transition-colors">
            Save foundation
          </button>
        </div>
      </form>

      <section className="flex flex-col gap-4 mt-8">
        <h2 className="text-lg border-b border-hairline pb-2">Brand assets</h2>
        <form action={uploadAssetAction} className="flex flex-wrap items-center gap-2">
          <input type="file" name="file" required
            className="text-sm file:mr-3 file:border file:border-hairline file:bg-muted-surface file:px-3 file:py-1.5 file:text-xs" />
          <select name="kind" defaultValue="logo" className={inputCls + " w-auto"}>
            <option value="logo">logo</option>
            <option value="reference_image">reference image</option>
            <option value="font">font</option>
          </select>
          <button type="submit"
            className="bg-ink text-paper px-4 py-2 text-xs font-medium hover:bg-accent transition-colors">
            Upload
          </button>
        </form>
        {assets.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {assets.map((a) => (
              <div key={a.id} className="border border-hairline p-2 w-28">
                {a.mime.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt={a.kind} className="w-full h-20 object-contain" />
                ) : (
                  <div className="h-20 flex items-center justify-center text-xs text-ink-faint">
                    {a.mime}
                  </div>
                )}
                <span className="eyebrow block mt-1 truncate">{a.kind}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
