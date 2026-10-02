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

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/**
 * What a person sees when a model call fails. Plain, and never about "AI":
 * the product's job is their voice, not the machinery (design system §15).
 * Server actions return this rather than throwing, because a thrown error's
 * message is scrubbed before it reaches the browser in production.
 */
export function userMessage(e: unknown): string {
  if (e instanceof AiConfigError) return "Drafting isn't switched on for this workspace yet. Your admin can turn it on.";
  if (e instanceof ProviderError) {
    switch (e.kind) {
      case "timeout": return "That took too long and was stopped. Try again.";
      case "rate_limit": return "Too many requests at once. Give it a minute and try again.";
      case "auth": return "Drafting couldn't sign in to its service. Your admin needs to check the key.";
      case "refusal": return "That one couldn't be written. Try rewording the topic.";
      default: return "That didn't work and was logged. Try again.";
    }
  }
  return "That didn't work and was logged. Try again.";
}
