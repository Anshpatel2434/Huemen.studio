"use client";

/**
 * Brand assets on the brief editor: the file goes straight to storage first
 * (lib/upload-client), then its key to the action, so the 5 MB the page
 * promises is real (a server action takes 1 MB).
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, X } from "lucide-react";
import { deleteAssetAction, uploadAssetChecked } from "@/app/w/[id]/brand/actions";
import { sendToStorage, UploadFailed } from "@/lib/upload-client";
import { ChipChoice } from "@/components/chip-choice";
import { Button } from "@/components/ui";

export function AssetUploadForm({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) return;
    start(async () => {
      setError(null);
      try {
        const fd = new FormData();
        fd.append("tenantId", tenantId);
        fd.append("kind", String(data.get("kind") ?? "logo"));
        fd.append("key", await sendToStorage(tenantId, "asset", file, file.name));
        const r = await uploadAssetChecked(fd);
        if (r.error) return setError(r.error);
        form.current?.reset();
        router.refresh();
      } catch (err) {
        setError(err instanceof UploadFailed ? err.message : "That file couldn't be used. Try a PNG, JPG, WebP, SVG or font file under 5 MB.");
      }
    });
  };

  return (
    <form ref={form} onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" name="file" required className="text-sm file:mr-3 file:min-h-11 file:rounded-full file:border file:border-line file:bg-transparent file:px-5 file:text-sm file:font-medium file:cursor-pointer hover:file:border-line-strong" />
        <ChipChoice name="kind" value="logo" options={[{ value: "logo", label: "Logo" }, { value: "reference_image", label: "Reference image" }, { value: "font", label: "Font" }]} />
        <Button type="submit" variant="secondary" disabled={pending}><Upload size={14} /> {pending ? "Uploading…" : "Upload"}</Button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </form>
  );
}

/** What has been uploaded, each with a way to remove it. */
export function AssetList({ tenantId, assets }: { tenantId: string; assets: { id: string; kind: string; mime: string; url: string }[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  if (!assets.length) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-3">
      {assets.map((a) => (
        <div key={a.id} className="group relative w-28 bg-panel border border-hairline rounded-md p-2">
          {a.mime.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.url} alt={a.kind.replace("_", " ")} className="w-full h-16 object-contain" />
          ) : (
            <div className="h-16 flex items-center justify-center text-xs text-ink-faint">{a.mime}</div>
          )}
          <p className="text-xs text-ink-faint mt-1 truncate capitalize">{a.kind.replace("_", " ")}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => start(async () => { await deleteAssetAction(tenantId, a.id); router.refresh(); })}
            aria-label={`Remove this ${a.kind.replace("_", " ")}`}
            className="hu-iconbtn absolute top-1 right-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 bg-paper"
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
