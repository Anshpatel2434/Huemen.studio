/**
 * The connections a person can make, and exactly what each may read.
 *
 * Pure: no I/O. Every capability asks for its own scopes only when the person
 * switches it on (incremental consent), so connecting Google for Docs never
 * asks to read mail. Each says, in plain words, what it reads and what it
 * never does, and those words are shown on the consent screen in the app.
 *
 * Platform limits, as they stand (re-check before launch):
 *  - Gmail read access is a Google RESTRICTED scope. Public launch needs Google
 *    app verification plus an annual third-party security assessment (CASA).
 *    In "testing" mode it works for up to 100 named test users.
 *  - Docs uses drive.file with the Google Picker: the app sees only files the
 *    person picks. That scope is not restricted, so no assessment.
 *  - Calendar events are a SENSITIVE scope: Google verification, no CASA.
 *  - LinkedIn: sign-in (openid, profile, email) is open to any app. Reading a
 *    member's own posts (r_member_social) needs LinkedIn partner approval, so
 *    it stays off until LINKEDIN_POSTS_APPROVED=true.
 */

export type ProviderKey = "google" | "linkedin";
export type CapabilityKey = "gmail" | "docs" | "calendar" | "youtube" | "profile" | "posts";

export interface Capability {
  key: CapabilityKey;
  provider: ProviderKey;
  label: string;
  /** What we read, said to the person. */
  reads: string;
  /** What we never do with it. */
  never: string;
  scopes: string[];
  /** Where the imported writing goes: private writing is measured, never quoted. */
  visibility: "public" | "private" | "none";
  /** The platform's own approval this needs before real users can use it. */
  review: "none" | "verification" | "restricted" | "partner";
}

export interface Provider {
  key: ProviderKey;
  label: string;
  authUrl: string;
  tokenUrl: string;
  revokeUrl: string | null;
  /** Always requested: who the account is. */
  baseScopes: string[];
  /** Extra authorize parameters (offline access, incremental consent). */
  authParams: Record<string, string>;
  pkce: boolean;
  scopeSeparator: string;
}

export const PROVIDERS: Record<ProviderKey, Provider> = {
  google: {
    key: "google",
    label: "Google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    baseScopes: ["openid", "email", "profile"],
    // offline + consent so a refresh token comes back; include_granted_scopes
    // so adding Calendar later keeps Docs.
    authParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    pkce: true,
    scopeSeparator: " ",
  },
  linkedin: {
    key: "linkedin",
    label: "LinkedIn",
    authUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    revokeUrl: "https://www.linkedin.com/oauth/v2/revoke",
    baseScopes: ["openid", "profile", "email"],
    authParams: {},
    pkce: false,
    scopeSeparator: " ",
  },
};

export const CAPABILITIES: Record<CapabilityKey, Capability> = {
  gmail: {
    key: "gmail",
    provider: "google",
    label: "Sent email",
    reads: "Emails you sent in the last two years, your own words only. Quoted replies and signatures are removed before anything is kept.",
    never: "We never read your inbox for anything else, never send email, and never quote your email in a draft.",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    visibility: "private",
    review: "restricted",
  },
  docs: {
    key: "docs",
    provider: "google",
    label: "Google Docs and Slides",
    reads: "Only the documents you pick, one by one. We can't see any other file in your Drive.",
    never: "We never change, share or delete a file.",
    scopes: ["https://www.googleapis.com/auth/drive.file"],
    visibility: "public",
    review: "none",
  },
  calendar: {
    key: "calendar",
    provider: "google",
    label: "Calendar",
    reads: "Your next 60 days of events, so talks, launches and workshops can become ideas. Only the ones you choose are saved.",
    never: "We never change your calendar or read who else is invited.",
    scopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
    visibility: "none",
    review: "verification",
  },
  youtube: {
    key: "youtube",
    provider: "google",
    label: "YouTube captions",
    reads: "Captions from up to 10 of your latest videos on your own channel: your spoken voice.",
    never: "We never upload, edit or comment, and never read anyone else's videos.",
    // captions.download is only allowed with this scope, and only for the channel's owner.
    scopes: ["https://www.googleapis.com/auth/youtube.force-ssl"],
    visibility: "public",
    review: "verification",
  },
  profile: {
    key: "profile",
    provider: "linkedin",
    label: "LinkedIn profile",
    reads: "Your name, photo and email, to confirm it's your account.",
    never: "We never post, message or connect on your behalf.",
    scopes: [],
    visibility: "none",
    review: "none",
  },
  posts: {
    key: "posts",
    provider: "linkedin",
    label: "LinkedIn posts",
    reads: "Posts you wrote on LinkedIn.",
    never: "We never post, comment or react on your behalf.",
    scopes: ["r_member_social"],
    visibility: "public",
    review: "partner",
  },
};

export const capabilitiesOf = (p: ProviderKey) => Object.values(CAPABILITIES).filter((c) => c.provider === p);

/** The scopes to ask for: who you are, what you already granted, and the new capability. */
export function scopesFor(provider: ProviderKey, cap: CapabilityKey | null, granted: string[] = []): string[] {
  const extra = cap ? CAPABILITIES[cap].scopes : [];
  return [...new Set([...PROVIDERS[provider].baseScopes, ...granted, ...extra])];
}

/** A capability is usable when every one of its scopes was actually granted. */
export const hasCapability = (cap: CapabilityKey, granted: string[]) =>
  CAPABILITIES[cap].scopes.every((s) => granted.includes(s));

export function authorizeUrl(
  provider: ProviderKey,
  opts: { clientId: string; redirectUri: string; scopes: string[]; state: string; codeChallenge?: string; loginHint?: string },
): string {
  const p = PROVIDERS[provider];
  const q = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: opts.scopes.join(p.scopeSeparator),
    state: opts.state,
    ...p.authParams,
  });
  if (p.pkce && opts.codeChallenge) {
    q.set("code_challenge", opts.codeChallenge);
    q.set("code_challenge_method", "S256");
  }
  if (opts.loginHint) q.set("login_hint", opts.loginHint);
  return `${p.authUrl}?${q}`;
}

export const redirectUri = (appUrl: string, provider: ProviderKey) =>
  `${appUrl.replace(/\/$/, "")}/connections/callback/${provider}`;
