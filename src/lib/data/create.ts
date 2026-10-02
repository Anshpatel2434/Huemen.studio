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
import { runTask } from "@/lib/ai";
import { coWriteOutline, topicProposals } from "@/lib/ai/tasks";
import { loadBrandContext } from "@/lib/context/context-loader";
import { formatByKey } from "@/lib/content/formats";
import { createProject, setIdeate, unlockStage, type ProjectScope, type WorkspaceScope } from "./projects";
import { listPillars } from "./planning";
import { createContentItem } from "./content";
import { loadPackForWorkspace } from "./voice-pack";
import type { TopicSuggestion } from "@/lib/voice/types";

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

export async function proposeTopics(scope: WorkspaceScope, opts: { force?: boolean } = {}): Promise<TopicSuggestion[]> {
  const pack = await loadPackForWorkspace(scope);
  if (!pack) return [];
  const fresh = pack.topicsGeneratedAt && Date.now() - new Date(pack.topicsGeneratedAt).getTime() < TOPICS_TTL_MS;
  if (!opts.force && fresh && pack.topicSuggestions.length) {
    const newest = await withTenantSession(scope, async (c) =>
      (await c.query<{ at: Date | null }>(`SELECT max(created_at) AS at FROM pillars WHERE project_id IS NULL`)).rows[0]?.at ?? null,
    );
    if (!topicsStale(pack.topicsGeneratedAt, newest?.toISOString() ?? null)) return pack.topicSuggestions;
  }

  const [pillars, recent] = await Promise.all([
    listPillars(scope),
    withTenantSession(scope, async (c) =>
      (await c.query<{ name: string }>(`SELECT name FROM projects WHERE status = 'active' ORDER BY created_at DESC LIMIT 12`)).rows.map((r) => r.name),
    ),
  ]);
  const taskInput = [
    ...pillars.map((p) => `Pillar: ${p.name}${p.description ? ` (${p.description})` : ""}`),
    ...recent.map((r) => `Recent: ${r}`),
    ...(opts.force ? pack.topicSuggestions.map((t) => `Recent: ${t.title}`) : []),
  ].join("\n");

  const { topics } = await runTask(scope, topicProposals, {
    context: await loadBrandContext(scope),
    taskInput: taskInput || "No pillars yet.",
  });
  const clean = topics.slice(0, 3).map((t) => ({ title: t.title.trim(), why: t.why.trim(), pillar: t.pillar.trim() }));
  await withTenantSession(scope, (c) =>
    c.query(`UPDATE voice_packs SET topic_suggestions = $1, topics_generated_at = now() WHERE id = $2`, [JSON.stringify(clean), pack.id]),
  );
  return clean;
}

/** A new piece at Ideate. Returns the project id. */
export async function startPiece(
  scope: WorkspaceScope,
  input: { topic: string; format?: string | null; pillarName?: string | null; ideaId?: string | null },
): Promise<string> {
  const topic = input.topic.trim() || "Untitled piece";
  const projectId = await createProject(scope, topic.slice(0, 120));
  const p: ProjectScope = { ...scope, projectId };
  const pillars = input.pillarName ? await listPillars(scope) : [];
  // A suggestion names its pillar the way the prompt listed it, which can carry
  // the description after the name: match exactly first, then by the name.
  const want = (input.pillarName ?? "").trim().toLowerCase();
  const pillar =
    pillars.find((x) => x.name.toLowerCase() === want) ??
    [...pillars].sort((a, b) => b.name.length - a.name.length).find((x) => want.startsWith(x.name.toLowerCase()));
  await setIdeate(p, {
    format: input.format ?? null,
    pillarId: pillar?.id ?? null,
    angle: null,
    ideaId: input.ideaId ?? null,
    topic,
  });
  return projectId;
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
  const outline = await runTask(scope, coWriteOutline, {
    context: await loadBrandContext(scope, "en", fmt.platform),
    taskInput: [`Format: ${fmt.label}`, `Topic: ${input.topic}`, input.angle ? `Angle: ${input.angle}` : ""].filter(Boolean).join("\n"),
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
  });
  await unlockStage(scope, "content").catch(() => undefined);
  return id;
}
