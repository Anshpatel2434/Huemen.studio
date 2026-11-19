/**
 * Errors the AI layer raises. Pure, client-safe.
 *
 * Two kinds, kept apart because they need opposite handling:
 *
 *   AiConfigError   — the deployment is set up wrong (a provider that isn't
 *                     built, a model that isn't named). Never retried, and
 *                     raised before any call is made, so a misconfiguration is
 *                     loud on the first draft rather than silently degrading.
 *
 *   ProviderError   — the provider was reached and the call failed. `retryable`
 *                     tells the facade whether another attempt could help. A
 *                     real provider's SDK has already retried what it can, so
 *                     it reports everything as not retryable and the facade does
 *                     not stack a second round of retries on top.
 */

export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigError";
  }
}

/**
 * The workspace's monthly hard cap is reached (brief §4.6, TASKS P3-9). Raised
 * BEFORE the provider is called, so a runaway workspace costs nothing more;
 * logged like every other failed call, so it shows in usage.
 */
export class UsageCapError extends Error {
  constructor(
    public readonly kind: "text" | "image",
    public readonly used: number,
    public readonly cap: number,
    /** The monthly hard cap (admin-set), or the daily picture cap (AI_IMAGE_DAILY_CAP, PI-30). */
    public readonly period: "month" | "day" = "month",
  ) {
    super(`${period === "day" ? "Daily" : "Monthly"} ${kind} cap reached: ${used} of ${cap}`);
    this.name = "UsageCapError";
  }
}

/**
 * One picture action (a comment's redraw, a markup, an erase, a resize, a new
 * picture) may make at most so many paid picture calls, its retries and word
 * checks included (lib/ai withPictureBudget, PI-30). Raised in the facade
 * BEFORE the provider is reached, so the call that would go over costs nothing.
 */
export class PictureBudgetError extends Error {
  constructor(public readonly max: number) {
    super(`Picture budget for this change reached: ${max}`);
    this.name = "PictureBudgetError";
  }
}

/**
 * Too many calls in a short window (lib/ratelimit). Raised before the provider
 * is reached, like the monthly cap, and over once the window has moved on.
 */
export class RateLimitError extends Error {
  constructor(
    public readonly bucket: string,
    public readonly by: "user" | "workspace",
    public readonly retryAfterSeconds: number,
  ) {
    super(`Rate limit (${by}) on ${bucket}: retry in ${retryAfterSeconds}s`);
    this.name = "RateLimitError";
  }
}

export type ProviderErrorKind =
  | "timeout"
  | "rate_limit"
  | "auth"
  | "bad_request"
  | "refusal"
  | "truncated"
  | "unparseable"
  | "server"
  | "unknown";

/**
 * What a provider said about its own limit, when it said anything:
 *   window             "minute" for a per-minute limit (gone in seconds),
 *                      "day" for a daily allowance (gone for a long while)
 *   retryAfterSeconds  when the provider says to come back
 */
export interface LimitInfo {
  window?: "minute" | "day";
  retryAfterSeconds?: number;
}

export class ProviderError extends Error {
  public readonly limit: LimitInfo;
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly retryable = false,
    limit: LimitInfo = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.limit = limit;
  }
}

/** "7m12.5s", "1h2m", "45.3s", "250ms" (Groq's "try again in ...") as seconds, or undefined. */
export function parseWait(text: string): number | undefined {
  const m = /try again in\s+((?:\d+(?:\.\d+)?(?:h|ms|m|s))+)/i.exec(text);
  if (!m) return undefined;
  let s = 0;
  for (const [, n, unit] of m[1].matchAll(/(\d+(?:\.\d+)?)(h|ms|m|s)/g)) {
    const v = Number(n);
    s += unit === "h" ? v * 3600 : unit === "m" ? v * 60 : unit === "ms" ? v / 1000 : v;
  }
  return s > 0 ? Math.ceil(s) : undefined;
}

/**
 * Read a 429's body and retry-after header into LimitInfo. Groq names the
 * limit it hit ("tokens per day (TPD)", "requests per minute (RPM)") and when
 * to come back; other providers send only retry-after.
 */
export function limitFrom(body: string, retryAfterHeader: string | null): LimitInfo {
  const text = body.slice(0, 2000);
  const window: LimitInfo["window"] =
    /per day|\((?:TPD|RPD|ASD)\)|daily/i.test(text) ? "day"
    : /per minute|\((?:TPM|RPM|ASH)\)/i.test(text) ? "minute"
    : undefined;
  const header = Number(retryAfterHeader);
  const retryAfterSeconds = parseWait(text) ?? (Number.isFinite(header) && header > 0 ? Math.ceil(header) : undefined);
  return { ...(window ? { window } : {}), ...(retryAfterSeconds ? { retryAfterSeconds } : {}) };
}

/** "about 14 minutes", "about 2 hours", "a few seconds". */
export function waitWords(seconds: number): string {
  if (seconds < 50) return "a few seconds";
  if (seconds < 90) return "about a minute";
  if (seconds < 3600) return `about ${Math.round(seconds / 60)} minutes`;
  const h = Math.round(seconds / 3600);
  return h === 1 ? "about an hour" : `about ${h} hours`;
}

/** The plain sentence for a provider's rate limit, saying which limit and when it frees up. */
function rateLimitMessage(e: ProviderError): string {
  const wait = e.limit.retryAfterSeconds;
  if (e.limit.window === "day") {
    return `The writing service has used up its daily allowance (pictures need it too).${wait ? ` It frees up in ${waitWords(wait)}.` : " It frees up later today."} Your admin can move to a paid plan to lift it.`;
  }
  return `Too many requests this minute. Try again in ${wait ? waitWords(wait) : "a minute"}.`;
}

/**
 * What the failed call was for, so the sentence names it (PI-31): a picture
 * failure was worded as a "Drafting" one. "picture" covers new pictures,
 * changes to one, Remove background and the words check on a picture.
 */
export type MessageFor = "writing" | "picture";

/**
 * What a person sees when a model call fails. Plain, and never about "AI":
 * the product's job is their voice, not the machinery (design system §15).
 * Server actions return this rather than throwing, because a thrown error's
 * message is scrubbed before it reaches the browser in production.
 */
export function userMessage(e: unknown, about: MessageFor = "writing"): string {
  const picture = about === "picture" || (e instanceof UsageCapError && e.kind === "image");
  if (e instanceof PictureBudgetError) return `This change reached its limit of ${e.max} pictures, so it stopped there. Nothing more was used.`;
  if (e instanceof AiConfigError) {
    return picture ? "Pictures aren't switched on for this workspace yet. Your admin can turn them on." : "Drafting isn't switched on for this workspace yet. Your admin can turn it on.";
  }
  if (e instanceof RateLimitError) {
    const wait = e.retryAfterSeconds > 90 ? `${Math.ceil(e.retryAfterSeconds / 60)} minutes` : "a minute";
    return e.by === "user"
      ? `That's a lot in a short time. Give it ${wait} and try again.`
      : `This workspace is busy right now. Give it ${wait} and try again.`;
  }
  if (e instanceof UsageCapError) {
    if (e.period === "day") return `This workspace has used its ${e.cap} pictures for today. It frees up tomorrow; your admin can raise the daily limit.`;
    if (e.cap === 0) return picture ? "Pictures are switched off for this workspace. Your admin can turn them on in Settings." : "Drafting is switched off for this workspace. Your admin can turn it on in Settings.";
    return `This workspace has used its ${e.cap} ${picture ? "pictures" : "generations"} for the month. Your admin can raise the cap in Settings.`;
  }
  if (e instanceof ProviderError) {
    switch (e.kind) {
      case "timeout": return "That took too long and was stopped. Try again.";
      case "rate_limit": return rateLimitMessage(e);
      case "auth": return picture ? "The picture service refused the key. Your admin needs to check it." : "Drafting couldn't sign in to its service. Your admin needs to check the key.";
      case "refusal": return picture ? "The picture service turned that one down. Try saying it another way." : "That one couldn't be written. Try rewording the topic.";
      default: return "That didn't work and was logged. Try again.";
    }
  }
  return "That didn't work and was logged. Try again.";
}
