/**
 * Reading a person's own LinkedIn posts (Posts API, r_member_social).
 *
 * LinkedIn grants that permission only to approved partners, so this runs
 * only when LINKEDIN_POSTS_APPROVED=true. Until then a LinkedIn connection is
 * sign-in and profile only, and posts come in through the data export
 * (Shares.csv), which lib/voice/ingest already reads.
 *
 * The API is versioned by month; LINKEDIN_VERSION is the one this was written
 * against. Re-check it when enabling.
 *
 * Server-only. Fetch is injectable for tests.
 */
import { call, type FetchLike } from "./oauth";
import type { ImportedPiece } from "./google";

export const LINKEDIN_VERSION = "202509";

interface Post {
  id: string;
  commentary?: string;
  createdAt?: number;
  publishedAt?: number;
  lifecycleState?: string;
  reshareContext?: unknown;
}

export async function importPosts(
  token: string,
  memberId: string,
  opts: { max?: number } = {},
  fetchImpl: FetchLike = fetch,
): Promise<ImportedPiece[]> {
  const max = Math.min(opts.max ?? 200, 400);
  const author = encodeURIComponent(`urn:li:person:${memberId}`);
  const pieces: ImportedPiece[] = [];
  for (let start = 0; start < max; start += 50) {
    const res = await call(fetchImpl, `https://api.linkedin.com/rest/posts?author=${author}&q=author&count=50&start=${start}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "LinkedIn-Version": LINKEDIN_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });
    const body = (await res.json()) as { elements?: Post[] };
    const els = body.elements ?? [];
    for (const p of els) {
      // Their own words only: a bare reshare has none.
      const text = (p.commentary ?? "").trim();
      if (!text || p.lifecycleState === "DRAFT") continue;
      const at = p.publishedAt ?? p.createdAt;
      pieces.push({
        externalId: `linkedin:${p.id}`,
        body: text,
        channel: "linkedin",
        visibility: "public",
        publishedAt: at ? new Date(at).toISOString() : null,
      });
    }
    if (els.length < 50) break;
  }
  return pieces;
}
