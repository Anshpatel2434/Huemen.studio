/**
 * Reading from Google: sent mail (Gmail), picked documents (Drive), and
 * upcoming events (Calendar). Each returns plain pieces; nothing here writes.
 *
 * What is kept, and what never is:
 *  - Gmail: only messages in Sent. Only the body the person wrote: quoted
 *    replies, forwarded chains and signatures are stripped (stripEmail). No
 *    recipients, no subjects, no attachments. Stored PRIVATE: measured, never
 *    quoted in a draft (spec question 12).
 *  - Drive: only files the person picked with the Google Picker (drive.file
 *    can't see anything else). Exported as plain text.
 *  - Calendar: title, date and a short description. Attendees are never
 *    requested (the `fields` mask leaves them out).
 *
 * Server-only. Fetch is injectable for tests.
 */
import { stripEmail } from "@/lib/voice/ingest";
import { htmlToText, parseCaptions } from "./text";

export { htmlToText };
import { call, type FetchLike } from "./oauth";

export interface ImportedPiece {
  externalId: string;
  body: string;
  channel: string;
  visibility: "public" | "private";
  publishedAt: string | null;
  title?: string;
}

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

// ---- Gmail ---------------------------------------------------------------------

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
}

const decode = (data: string) => Buffer.from(data, "base64url").toString("utf8");

/** The text the person wrote: text/plain if there is one, else the HTML as text. */
export function messageText(payload: GmailPart): string {
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: GmailPart) => {
    if (p.mimeType === "text/plain" && p.body?.data) plain.push(decode(p.body.data));
    else if (p.mimeType === "text/html" && p.body?.data) html.push(decode(p.body.data));
    p.parts?.forEach(walk);
  };
  walk(payload);
  const raw = plain.length ? plain.join("\n") : htmlToText(html.join("\n"));
  return stripEmail(raw).trim();
}

/** Below this, a message says nothing about how someone writes ("Thanks!", "See you then"). */
export const MIN_EMAIL_WORDS = 25;

export async function importSentMail(
  token: string,
  opts: { max?: number; since?: string } = {},
  fetchImpl: FetchLike = fetch,
): Promise<{ pieces: ImportedPiece[]; scanned: number }> {
  const max = Math.min(opts.max ?? 200, 400);
  const ids: string[] = [];
  let pageToken: string | undefined;
  const q = `in:sent newer_than:2y${opts.since ? ` after:${Math.floor(new Date(opts.since).getTime() / 1000)}` : ""}`;
  while (ids.length < max) {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", q);
    url.searchParams.set("maxResults", String(Math.min(100, max - ids.length)));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = (await (await call(fetchImpl, url.toString(), auth(token))).json()) as {
      messages?: { id: string }[];
      nextPageToken?: string;
    };
    ids.push(...(page.messages ?? []).map((m) => m.id));
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }

  const pieces: ImportedPiece[] = [];
  // A few at a time: Gmail's per-user quota is generous but not unlimited.
  for (let i = 0; i < ids.length; i += 5) {
    const batch = await Promise.all(
      ids.slice(i, i + 5).map(async (id) => {
        const m = (await (await call(
          fetchImpl,
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full&fields=id,internalDate,payload`,
          auth(token),
        )).json()) as { id: string; internalDate?: string; payload?: GmailPart };
        return m;
      }),
    );
    for (const m of batch) {
      const body = m.payload ? messageText(m.payload) : "";
      if (words(body) < MIN_EMAIL_WORDS) continue;
      pieces.push({
        externalId: `gmail:${m.id}`,
        body,
        channel: "email",
        visibility: "private",
        publishedAt: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
      });
    }
  }
  return { pieces, scanned: ids.length };
}

// ---- Drive (Docs, Slides) via the Picker -----------------------------------------

const EXPORTABLE = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.presentation",
]);

/** Long documents are capped: one 20,000-word report would outweigh a hundred posts. */
export const MAX_DOC_WORDS = 3000;

export async function importPickedFiles(
  token: string,
  files: { id: string; channel: string; published: boolean }[],
  fetchImpl: FetchLike = fetch,
): Promise<{ pieces: ImportedPiece[]; skipped: string[] }> {
  const pieces: ImportedPiece[] = [];
  const skipped: string[] = [];
  for (const f of files.slice(0, 50)) {
    const meta = (await (await call(
      fetchImpl,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}?fields=id,name,mimeType,modifiedTime`,
      auth(token),
    )).json()) as { id: string; name: string; mimeType: string; modifiedTime?: string };
    if (!EXPORTABLE.has(meta.mimeType)) {
      skipped.push(meta.name);
      continue;
    }
    const text = await (await call(
      fetchImpl,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}/export?mimeType=text/plain`,
      auth(token),
    )).text();
    const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!clean) {
      skipped.push(meta.name);
      continue;
    }
    const capped = clean.split(/\s+/).length > MAX_DOC_WORDS ? clean.split(/(\s+)/).slice(0, MAX_DOC_WORDS * 2).join("").trim() : clean;
    pieces.push({
      externalId: `drive:${meta.id}`,
      body: capped,
      channel: f.channel,
      visibility: f.published ? "public" : "private",
      publishedAt: meta.modifiedTime ?? null,
      title: meta.name,
    });
  }
  return { pieces, skipped };
}

// ---- Calendar -------------------------------------------------------------------

export interface UpcomingEvent {
  id: string;
  title: string;
  date: string;
  description: string;
}

const SKIP_TYPES = new Set(["outOfOffice", "focusTime", "workingLocation", "birthday"]);

export async function upcomingEvents(token: string, now: number, fetchImpl: FetchLike = fetch): Promise<UpcomingEvent[]> {
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", new Date(now).toISOString());
  url.searchParams.set("timeMax", new Date(now + 60 * 86_400_000).toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "100");
  // No attendees, ever: the mask asks only for what an idea needs.
  url.searchParams.set("fields", "items(id,summary,description,start,eventType,status)");
  const body = (await (await call(fetchImpl, url.toString(), auth(token))).json()) as {
    items?: { id: string; summary?: string; description?: string; start?: { date?: string; dateTime?: string }; eventType?: string; status?: string }[];
  };
  return (body.items ?? [])
    .filter((e) => e.summary?.trim() && e.status !== "cancelled" && !SKIP_TYPES.has(e.eventType ?? "default"))
    .map((e) => ({
      id: e.id,
      title: e.summary!.trim(),
      date: (e.start?.date ?? e.start?.dateTime ?? "").slice(0, 10),
      description: htmlToText(e.description ?? "").slice(0, 300),
    }));
}

// ---- YouTube captions (their own channel) ---------------------------------------

const YT = "https://www.googleapis.com/youtube/v3";

/**
 * Captions from the person's latest videos. Prefers captions they uploaded,
 * then YouTube's automatic ones. captions.download costs 200 quota units, so
 * a run reads at most 10 videos.
 */
export async function importYouTubeCaptions(
  token: string,
  opts: { max?: number } = {},
  fetchImpl: FetchLike = fetch,
): Promise<{ pieces: ImportedPiece[]; videos: number }> {
  const max = Math.min(opts.max ?? 10, 10);
  const ch = (await (await call(fetchImpl, `${YT}/channels?part=contentDetails&mine=true`, auth(token))).json()) as {
    items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[];
  };
  const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return { pieces: [], videos: 0 };
  const list = (await (await call(fetchImpl, `${YT}/playlistItems?part=snippet,contentDetails&maxResults=${max}&playlistId=${encodeURIComponent(uploads)}`, auth(token))).json()) as {
    items?: { contentDetails?: { videoId?: string; videoPublishedAt?: string }; snippet?: { title?: string } }[];
  };
  const pieces: ImportedPiece[] = [];
  const videos = (list.items ?? []).filter((v) => v.contentDetails?.videoId);
  for (const v of videos) {
    const id = v.contentDetails!.videoId!;
    const tracks = (await (await call(fetchImpl, `${YT}/captions?part=snippet&videoId=${encodeURIComponent(id)}`, auth(token))).json()) as {
      items?: { id: string; snippet?: { trackKind?: string; language?: string } }[];
    };
    const all = tracks.items ?? [];
    const track = all.find((t) => t.snippet?.trackKind !== "asr") ?? all[0];
    if (!track) continue;
    const vtt = await (await call(fetchImpl, `${YT}/captions/${encodeURIComponent(track.id)}?tfmt=vtt`, auth(token))).text();
    const text = parseCaptions(vtt);
    if (text.split(/\s+/).length < 40) continue;
    pieces.push({
      externalId: `youtube:${id}`,
      body: text.split(/(\s+)/).slice(0, MAX_DOC_WORDS * 2).join("").trim(),
      channel: "spoken",
      visibility: "public",
      publishedAt: v.contentDetails?.videoPublishedAt ?? null,
      title: v.snippet?.title ?? id,
    });
  }
  return { pieces, videos: videos.length };
}
