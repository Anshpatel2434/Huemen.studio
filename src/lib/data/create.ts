/**
 * Create (Flow 2): starting a piece, and writing it in the person's chosen way.
 *
 *   proposeTopics   three topics from their own core, so Create never opens on
 *                   a blank page (design system §12). Cached on the pack: a
 *                   page view never pays for a model call, and "suggest
 *                   others" is an explicit choice.
 *   startPiece      a new project at Ideate, from a proposal, an idea, a
 *                   calendar slot or a topic they typed.
 *   ownDraft        F2 "check mine": their writing, stored as-is, then checked.
 *   coWrite         F2 "co-write": an outline in their voice they fill in.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession } from "@/db/session";
import { linkGeneration, runTask, runTaskStamped } from "@/lib/ai";
import { coWriteOutline, topicProposals } from "@/lib/ai/tasks";
import { loadBrandContext } from "@/lib/context/context-loader";
import { findPlaceholders, formatByKey } from "@/lib/content/formats";
import { angleLine } from "@/lib/content/angles";
import { isUuid } from "@/lib/content/ids";
import { clip } from "@/lib/voice/derive";
import { unlockStage, type ProjectScope, type WorkspaceScope } from "./projects";
import { listPillars } from "./planning";
import { createContentItem, topicLine } from "./content";
import { loadPackForWorkspace } from "./voice-pack";
import type { TopicSuggestion } from "@/lib/voice/types";

// ---- a piece's topic: a short name to show, the whole of it to write from -----

/** The longest project name. Longer topics are cut for the NAME only, at a word, with an ellipsis. */
export const NAME_MAX = 120;

/** The name a piece is listed under: its topic, cut at a word boundary if it is long. */
export const pieceName = (topic: string): string => clip(topic.replace(/\s+/g, " ").trim(), NAME_MAX);

const sameStart = (a: string, b: string) => a.slice(0, 40).toLowerCase() === b.slice(0, 40).toLowerCase();

/**
 * The whole topic of a piece. The name is cut to fit a card; when the topic
 * was longer, all of it is kept in the project's description and that is what
 * the writing step uses. A description that is not this piece's topic (typed
 * as a note when the project was made) is left out of it.
 */
export function pieceTopic(p: { name: string; description?: string | null }): string {
  const name = p.name.trim();
  const full = (p.description ?? "").replace(/\s+/g, " ").trim();
  return full.length > name.length && sameStart(full, name.replace(/…$/, "")) ? full : name;
}

/**
 * Set a piece's topic from the Ideate step: the name (cut at a word) and, when
 * the topic is longer than the name, the whole of it beside the name. A blank
 * topic changes nothing.
 */
export async function saveTopic(scope: ProjectScope, topic: string): Promise<void> {
  const full = topicLine(topic);
  if (!full) return;
  const name = pieceName(full);
  await withTenantSession(scope, (c) =>
    c.query(
      `UPDATE projects
          SET description = CASE
                WHEN $2::text IS NOT NULL THEN $2
                -- the old description was the old, longer topic: it no longer applies
                WHEN description IS NOT NULL AND lower(left(description, 40)) = lower(left(rtrim(name, '…'), 40)) THEN NULL
                ELSE description END,
              name = $1
        WHERE id = $3`,
      [name, full.length > name.length ? full : null, scope.projectId],
    ),
  );
}

/** Two topics are the same piece: same words once case, punctuation and a cut-off ending are set aside. */
export function sameTopic(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/…$/, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // A name cut for the card still matches the topic it was cut from.
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 24 && long.startsWith(short);
}

/** Proposals older than this are refreshed on the next visit. */
const TOPICS_TTL_MS = 7 * 24 * 3600 * 1000;

/**
 * Cached proposals are only good for the pillars they were made from. A pillar
 * added since (the usual case: Create glanced at during onboarding, pillars made
 * at step 3) makes them stale; otherwise the first piece would be written on a
 * placeholder topic for a week. Compared by time, not by name, so a model that
 * words a pillar differently can't make every visit pay for a new proposal.
 */
export const topicsStale = (generatedAt: string | null, newestPillarAt: string | null): boolean =>
  !!generatedAt && !!newestPillarAt && new Date(newestPillarAt).getTime() > new Date(generatedAt).getTime();

/** A suggestion a person can act on: it has a title, and no "[placeholder]" (the drafting contract's marker) in it. */
const usableTopic = (t: TopicSuggestion): boolean => !!t.title.trim() && findPlaceholders(`${t.title} ${t.why}`).length === 0;

export async function proposeTopics(scope: WorkspaceScope, opts: { force?: boolean } = {}): Promise<TopicSuggestion[]> {
  const pack = await loadPackForWorkspace(scope);
  if (!pack) return [];
  const fresh = pack.topicsGeneratedAt && Date.now() - new Date(pack.topicsGeneratedAt).getTime() < TOPICS_TTL_MS;
  // Every piece already started or written, archived ones included: a
  // suggestion for one of those is not a suggestion (2026-11-17: Home's first
  // card offered the topic that had just been written).
  const written = await withTenantSession(scope, async (c) =>
    (
      await c.query<{ t: string }>(
        `SELECT name AS t FROM projects
         UNION SELECT description FROM projects WHERE description IS NOT NULL
         UNION SELECT topic FROM content_items WHERE topic IS NOT NULL`,
      )
    ).rows.map((r) => r.t),
  );
  const unwritten = (list: TopicSuggestion[]) => list.filter((t) => usableTopic(t) && !written.some((w) => sameTopic(w, t.title)));

  if (!opts.force && fresh && pack.topicSuggestions.length) {
    const newest = await withTenantSession(scope, async (c) =>
      (await c.query<{ at: Date | null }>(`SELECT max(created_at) AS at FROM pillars WHERE project_id IS NULL`)).rows[0]?.at ?? null,
    );
    if (!topicsStale(pack.topicsGeneratedAt, newest?.toISOString() ?? null)) {
      // Shown without the ones already taken. Only when none is left does a
      // visit pay for new ones; otherwise the page view stays free.
      const left = unwritten(pack.topicSuggestions);
      if (left.length) return left;
    }
  }

  const [pillars, recent] = await Promise.all([
    listPillars(scope),
    withTenantSession(scope, async (c) =>
      (await c.query<{ name: string }>(`SELECT name FROM projects ORDER BY created_at DESC LIMIT 20`)).rows.map((r) => r.name),
    ),
  ]);
  // Topics come from pillars. With none there is nothing to suggest, and the
  // model, asked anyway, answered with "[placeholder]" cards on a new
  // workspace's home (2026-11-19 QA) and spent a generation on every visit.
  if (!pillars.length) return [];
  const taskInput = [
    // Names only: what each pillar means is in the context block (INV-2).
    ...pillars.map((p) => `Pillar: ${p.name}`),
    ...recent.map((r) => `Recent: ${r}`),
    ...(opts.force ? pack.topicSuggestions.map((t) => `Recent: ${t.title}`) : []),
  ].join("\n");

  const { topics } = await runTask(scope, topicProposals, {
    context: await loadBrandContext(scope),
    taskInput: taskInput || "No pillars yet.",
  });
  const clean = topics.slice(0, 3).map((t) => ({ title: t.title.trim(), why: t.why.trim(), pillar: t.pillar.trim() })).filter(usableTopic);
  await withTenantSession(scope, (c) =>
    c.query(`UPDATE voice_packs SET topic_suggestions = $1, topics_generated_at = now() WHERE id = $2`, [JSON.stringify(clean), pack.id]),
  );
  // The model was told what is recent; this holds it to that.
  return unwritten(clean);
}

/** An id sent with "start a piece" (the idea, the pillar) is not an id, or is not in this workspace. */
export class StartNotFoundError extends Error {
  constructor() {
    super("That idea or pillar isn't in this workspace any more.");
  }
}

/**
 * A new piece at Ideate. Returns the project id. When an id the browser sent
 * (the idea, the pillar) is not an id or is not in this workspace, that is
 * "not found": StartNotFoundError, never a raw database error, and nothing
 * is created.
 *
 * The project is written in ONE statement with everything it starts with, so
 * a failure can't leave a half-made project behind (2026-11-17: the project
 * was created, then the step that linked its idea failed, and the orphan
 * stayed on Home).
 */
export async function startPiece(
  scope: WorkspaceScope,
  input: { topic: string; format?: string | null; pillarName?: string | null; pillarId?: string | null; angle?: string | null; ideaId?: string | null },
): Promise<string> {
  const topic = topicLine(input.topic) || "Untitled piece";
  const name = pieceName(topic);
  const ideaId = input.ideaId || null;
  const pillarId = input.pillarId || null;
  if ((ideaId && !isUuid(ideaId)) || (pillarId && !isUuid(pillarId))) throw new StartNotFoundError();
  const fmt = input.format ? formatByKey(input.format) : null;
  // An unknown format key falls back to the default in formatByKey; keep it only when it is a real one.
  const format = fmt && fmt.key === input.format ? fmt : null;

  const pillars = input.pillarName && !pillarId ? await listPillars(scope) : [];
  // A suggestion names its pillar the way the prompt listed it, which can carry
  // the description after the name: match exactly first, then by the name.
  const want = (input.pillarName ?? "").trim().toLowerCase();
  const named =
    pillars.find((x) => x.name.toLowerCase() === want) ??
    [...pillars].sort((a, b) => b.name.length - a.name.length).find((x) => want.startsWith(x.name.toLowerCase()));

  return withTenantSession(scope, async (c) => {
    // RLS confines both lookups to this workspace: another tenant's id reads as missing.
    if (ideaId && !(await c.query("SELECT 1 FROM ideas WHERE id = $1 AND project_id IS NULL", [ideaId])).rowCount) throw new StartNotFoundError();
    if (pillarId && !(await c.query("SELECT 1 FROM pillars WHERE id = $1 AND project_id IS NULL", [pillarId])).rowCount) throw new StartNotFoundError();
    return (
      await c.query<{ id: string }>(
        `INSERT INTO projects (tenant_id, name, description, created_by, format, channel, angle, idea_id, pillar_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [scope.tenantId, name, topic.length > name.length ? topic : null, scope.userId,
         format?.key ?? null, format?.channel ?? null, input.angle?.trim() || null, ideaId, pillarId ?? named?.id ?? null],
      )
    ).rows[0].id;
  });
}

/** F2 "check mine": their own draft, stored unchanged. */
export async function ownDraft(scope: ProjectScope, input: { format: string; topic: string; text: string; pillarId?: string | null }): Promise<string> {
  const lines = input.text.replace(/\r\n/g, "\n").trim().split("\n");
  const hook = (lines.shift() ?? "").trim();
  const body = lines.join("\n").trim();
  const id = await createContentItem(scope, {
    format: input.format,
    topic: input.topic,
    hook,
    body,
    cta: "",
    pillarId: input.pillarId,
    status: "edited",
    origin: "own-writing",
  });
  await unlockStage(scope, "content").catch(() => undefined);
  return id;
}

/** F2 "co-write": a hook and the beats of the argument; the writing is theirs. */
export async function coWrite(
  scope: ProjectScope,
  input: { format: string; topic: string; angle?: string | null; pillarId?: string | null },
): Promise<string> {
  const fmt = formatByKey(input.format);
  const pillar = isUuid(input.pillarId)
    ? (await withTenantSession(scope, (c) => c.query<{ name: string }>("SELECT name FROM pillars WHERE id = $1 AND project_id IS NULL", [input.pillarId]))).rows[0]?.name ?? null
    : null;
  const { data: outline, template, logId } = await runTaskStamped(scope, coWriteOutline, {
    context: await loadBrandContext(scope, "en", fmt.platform, fmt.reply ? "reply" : "write"),
    // The pillar by name only (what it means is in the context block, INV-2); the angle with what it asks for.
    taskInput: [`Format: ${fmt.label}`, `Topic: ${topicLine(input.topic)}`, pillar ? `Pillar: ${pillar}` : "", angleLine(input.angle)].filter(Boolean).join("\n"),
  });
  const id = await createContentItem(scope, {
    format: input.format,
    topic: input.topic,
    hook: outline.hook,
    body: outline.points.map((p) => `• ${p}`).join("\n\n"),
    cta: outline.cta,
    pillarId: input.pillarId,
    status: "draft",
    origin: "co-write-outline",
    stamp: { templateId: template.id, version: template.version },
  });
  // The outline was logged before its piece existed; tie the call to it now.
  await linkGeneration(scope, logId, id);
  await unlockStage(scope, "content").catch(() => undefined);
  return id;
}
