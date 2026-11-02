/**
 * Browser side of direct uploads (lib/storage/upload): ask the workspace for a
 * target, PUT the file there, and return the key for the step that uses it.
 *
 * The bucket is tried first. If the browser can't reach it (no CORS rule for
 * this address yet) and the file is small enough, the app's own relay takes
 * it instead, so small uploads keep working while a bucket is being set up.
 */
export type UploadPurpose = "asset" | "document" | "audio";

export class UploadFailed extends Error {}

interface Target {
  key: string;
  url: string;
  relayUrl: string | null;
  headers: Record<string, string>;
}

export async function sendToStorage(tenantId: string, purpose: UploadPurpose, file: Blob, name: string): Promise<string> {
  const res = await fetch(`/w/${tenantId}/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ purpose, name, size: file.size, type: file.type }),
  });
  const target = (await res.json().catch(() => ({}))) as Partial<Target> & { error?: string };
  if (!res.ok || !target.url || !target.key) throw new UploadFailed(target.error ?? "The upload couldn't start. Try again.");

  const put = (url: string) => fetch(url, { method: "PUT", body: file, headers: target.headers });
  let sent = await put(target.url).catch(() => null);
  if ((!sent || !sent.ok) && target.relayUrl && target.relayUrl !== target.url) {
    sent = await put(target.relayUrl).catch(() => null);
  }
  if (!sent || !sent.ok) throw new UploadFailed("The file didn't reach storage. Check your connection and try again.");
  return target.key;
}
