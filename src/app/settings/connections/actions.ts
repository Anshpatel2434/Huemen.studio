"use server";

/**
 * Settings › Connections: import from what the person connected. Every action acts for
 * the signed-in person only, through their own connection (lib/data/connections),
 * and only when the voice is theirs: a coach never imports into a client's
 * voice through anyone's account.
 */
import { revalidatePath } from "next/cache";
import { actionActor } from "@/lib/auth/workspace";
import { getEnv } from "@/lib/env";
import { loadPackForWorkspace } from "@/lib/data/voice-pack";
import { ownsVoice } from "@/lib/data/training";
import { finishIngest, markIngesting } from "@/lib/data/onboarding";
import { captureIdea } from "@/lib/data/planning";
import {
  accessToken, addImported, disconnect, importedEmailCount, listConnections, onlyFor, recordSync, removeImportedEmail, unavailableReason,
} from "@/lib/data/connections";
import {
  GMAIL_DEFAULT_RANGE, GMAIL_IMPORT_MAX, GMAIL_KEEP, GMAIL_RANGES, importPickedFiles, importYouTubeCaptions, sampleEvery,
  sentMailEstimate, sentMailPage, upcomingEvents, type GmailRange, type UpcomingEvent,
} from "@/lib/integrations/google";
import { importPosts } from "@/lib/integrations/linkedin";
import { ConnectionError } from "@/lib/integrations/oauth";
import { hasCapability, type CapabilityKey, type ProviderKey } from "@/lib/integrations/providers";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** A refusal meant for the person, in their words. Anything else is logged and said generically. */
class Refusal extends Error {}

const say = (e: unknown) =>
  e instanceof ConnectionError
    ? e.kind === "auth" || e.kind === "revoked"
      ? "The connection needs renewing. Reconnect and try again."
      : e.kind === "rate_limit"
        ? "The provider asked us to slow down. Try again in a minute."
        : e.kind === "not_enabled"
          ? "That isn't connected yet."
          : "The provider didn't answer properly. Try again."
    : "That didn't work and was logged. Try again.";

async function ctx(tenantId: string, cap: CapabilityKey) {
  const { scope, actor } = await actionActor(tenantId);
  const pack = await loadPackForWorkspace(scope);
  if (!pack || !ownsVoice(actor, pack)) throw new Refusal("Only the person whose voice this is can import from their accounts.");
  const reason = unavailableReason(cap);
  if (reason) throw new Refusal(reason);
  return { scope, pack };
}

async function guarded<T>(tenantId: string, provider: ProviderKey, cap: CapabilityKey, fn: () => Promise<{ value: T; count: number }>): Promise<Result<T>> {
  const { scope } = await actionActor(tenantId);
  try {
    const { value, count } = await fn();
    await recordSync(scope, provider, cap, { count });
    revalidatePath(`/w/${tenantId}`, "layout");
    revalidatePath("/settings/connections");
    return { ok: true, value };
  } catch (e) {
    const error = e instanceof Refusal ? e.message : say(e);
    if (!(e instanceof Refusal) && !(e instanceof ConnectionError)) console.error("[connections]", cap, e);
    await recordSync(scope, provider, cap, { count: 0, error }).catch(() => undefined);
    revalidatePath("/settings/connections");
    return { ok: false, error };
  }
}

export interface GmailCursor {
  pageToken: string | null;
  /** Running totals across every page so far. */
  scanned: number;
  added: number;
  /** How far back, in months (the person's choice, default 12). */
  months: GmailRange;
  /** Read every Nth message so the ~200 kept spread evenly across the range. Set on the first call. */
  every?: number;
}

export interface GmailPage extends GmailCursor {
  nextPageToken: string | null;
  /** Gmail's own estimate of how many sent emails match, capped at what we'll look through. */
  estimate: number;
  done: boolean;
}

/**
 * Sent email, one page per call: the browser keeps calling until `done`, so
 * looking through the whole range shows real progress and no single request
 * runs long. Only an even sample of about GMAIL_KEEP is read and kept (spec 06
 * §1: "sample, don't hoard"). Private: measured, never quoted.
 */
export async function gmailPageAction(tenantId: string, cursor: GmailCursor): Promise<Result<GmailPage>> {
  try {
    const { scope, pack } = await ctx(tenantId, "gmail");
    const { token, connection } = await accessToken(scope, "google");
    if (!hasCapability("gmail", connection.scopes)) throw new Refusal("Sent email isn't switched on yet.");
    const months: GmailRange = GMAIL_RANGES.includes(cursor.months) ? cursor.months : GMAIL_DEFAULT_RANGE;
    // The heartbeat: the core shows "Reading your writing", and a read that
    // stops arriving is noticed as interrupted (lifecycle `ingestStalled`).
    await markIngesting(scope, pack);
    const every = cursor.every ?? sampleEvery(await sentMailEstimate(token, months));
    const page = await sentMailPage(token, { pageToken: cursor.pageToken ?? undefined, months, every, offset: cursor.scanned });
    const added = await addImported(scope, pack, connection.id, page.pieces);
    const scanned = cursor.scanned + page.scanned;
    return {
      ok: true,
      value: {
        months,
        every,
        nextPageToken: page.nextPageToken,
        pageToken: page.nextPageToken,
        scanned,
        added: cursor.added + added,
        estimate: Math.min(Math.max(page.estimate, scanned), GMAIL_IMPORT_MAX),
        done: !page.nextPageToken || page.scanned === 0 || scanned >= GMAIL_IMPORT_MAX || cursor.added + added >= GMAIL_KEEP,
      },
    };
  } catch (e) {
    if (!(e instanceof Refusal) && !(e instanceof ConnectionError)) console.error("[connections] gmail page", e);
    return { ok: false, error: e instanceof Refusal ? e.message : say(e) };
  }
}

/**
 * The read is over: measure everything that arrived, then withdraw the
 * connection. Gmail is read once; nothing is left that could read it again.
 * The one exception: when the same Google connection also serves Docs,
 * Calendar or YouTube, withdrawing it would cut those off too, so it stays
 * and the page says so.
 */
export async function gmailFinishAction(tenantId: string, totals: { scanned: number }): Promise<Result<{ pieces: number; disconnected: boolean }>> {
  return guarded(tenantId, "google", "gmail", async () => {
    const { scope, pack } = await ctx(tenantId, "gmail");
    await finishIngest(scope, pack);
    const pieces = await importedEmailCount(scope, pack.id);
    const google = (await listConnections(scope)).find((c) => c.provider === "google");
    let disconnected = false;
    if (google && onlyFor(google, "gmail")) {
      await recordSync(scope, "google", "gmail", { count: pieces });
      await disconnect(scope, "google", { removeWriting: false });
      disconnected = true;
    }
    console.info(`[connections] gmail read: ${totals.scanned} scanned, ${pieces} kept, disconnected=${disconnected}`);
    return { value: { pieces, disconnected }, count: pieces };
  });
}

/** Remove every email that was read from Gmail, then re-measure without it. */
export async function removeImportedEmailAction(fd: FormData): Promise<void> {
  const tenantId = String(fd.get("tenantId"));
  const { scope, actor } = await actionActor(tenantId);
  const pack = await loadPackForWorkspace(scope);
  if (!pack || !ownsVoice(actor, pack)) return;
  if (await removeImportedEmail(scope, pack.id)) await finishIngest(scope, pack);
  revalidatePath(`/w/${tenantId}`, "layout");
  revalidatePath("/settings/connections");
}

/** What the Google Picker needs in the browser: a short-lived token and the app's public ids. */
export async function pickerConfigAction(tenantId: string): Promise<Result<{ token: string; apiKey: string; appId: string }>> {
  try {
    const { scope } = await ctx(tenantId, "docs");
    const { token, connection } = await accessToken(scope, "google");
    if (!hasCapability("docs", connection.scopes)) return { ok: false, error: "Google Docs isn't switched on yet." };
    const env = getEnv();
    return { ok: true, value: { token, apiKey: env.GOOGLE_PICKER_API_KEY!, appId: env.GOOGLE_PROJECT_NUMBER! } };
  } catch (e) {
    return { ok: false, error: e instanceof Refusal ? e.message : say(e) };
  }
}

/** The documents the person picked. Each is public only if they said it was published. */
export async function importDocsAction(
  tenantId: string,
  files: { id: string; channel: string; published: boolean }[],
): Promise<Result<{ added: number; skipped: string[] }>> {
  return guarded(tenantId, "google", "docs", async () => {
    const { scope, pack } = await ctx(tenantId, "docs");
    const { token, connection } = await accessToken(scope, "google");
    const { pieces, skipped } = await importPickedFiles(token, files);
    const added = await addImported(scope, pack, connection.id, pieces);
    if (added) await finishIngest(scope, pack);
    return { value: { added, skipped }, count: added };
  });
}

export async function listEventsAction(tenantId: string): Promise<Result<UpcomingEvent[]>> {
  return guarded(tenantId, "google", "calendar", async () => {
    const { scope } = await ctx(tenantId, "calendar");
    const { token } = await accessToken(scope, "google");
    const events = await upcomingEvents(token, Date.now());
    return { value: events, count: 0 };
  });
}

/** Chosen events become ideas in the inbox, auto-tagged to a pillar. */
export async function saveEventsAsIdeasAction(
  tenantId: string,
  events: { title: string; date: string; description: string }[],
): Promise<Result<number>> {
  return guarded(tenantId, "google", "calendar", async () => {
    const { scope } = await ctx(tenantId, "calendar");
    const keep = events.slice(0, 30);
    for (const e of keep) {
      await captureIdea(scope, `${e.title} (${e.date})${e.description ? `: ${e.description.slice(0, 200)}` : ""}`);
    }
    return { value: keep.length, count: keep.length };
  });
}

/** Captions from their own latest videos: their spoken voice. */
export async function importYouTubeAction(tenantId: string): Promise<Result<{ added: number; videos: number }>> {
  return guarded(tenantId, "google", "youtube", async () => {
    const { scope, pack } = await ctx(tenantId, "youtube");
    const { token, connection } = await accessToken(scope, "google");
    if (!hasCapability("youtube", connection.scopes)) throw new Refusal("YouTube isn't switched on yet.");
    const { pieces, videos } = await importYouTubeCaptions(token);
    const added = await addImported(scope, pack, connection.id, pieces);
    if (added) await finishIngest(scope, pack);
    return { value: { added, videos }, count: added };
  });
}

export async function importLinkedInPostsAction(tenantId: string): Promise<Result<{ added: number }>> {
  return guarded(tenantId, "linkedin", "posts", async () => {
    const { scope, pack } = await ctx(tenantId, "posts");
    const { token, connection, accountId } = await accessToken(scope, "linkedin");
    if (!accountId) throw new Refusal("Reconnect LinkedIn so we know which account is yours.");
    const pieces = await importPosts(token, accountId);
    const added = await addImported(scope, pack, connection.id, pieces);
    if (added) await finishIngest(scope, pack);
    return { value: { added }, count: added };
  });
}

/** Disconnect, and optionally remove everything it brought in, then re-measure. */
export async function disconnectAction(fd: FormData): Promise<void> {
  const tenantId = String(fd.get("tenantId"));
  const provider = String(fd.get("provider")) as ProviderKey;
  const removeWriting = fd.get("remove") === "1";
  const { scope } = await actionActor(tenantId);
  const { removed } = await disconnect(scope, provider, { removeWriting });
  const pack = removed ? await loadPackForWorkspace(scope) : null;
  if (pack) await finishIngest(scope, pack);
  revalidatePath(`/w/${tenantId}`, "layout");
  revalidatePath("/settings/connections");
}
