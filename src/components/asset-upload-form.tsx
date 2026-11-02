"use client";

/**
 * Brand assets on the brief editor: the file goes straight to storage first
 * (lib/upload-client), then its key to the action, so the 5 MB the page
 * promises is real (a server action takes 1 MB).
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { uploadAssetChecked } from "@/app/w/[id]/brand/actions";
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
