/**
 * The harness for the per-endpoint cross-tenant tests
 * (tests/cross-tenant-endpoints.test.ts): two client workspaces A and B with
 * real data, the people who try to reach A, a fingerprint of everything A
 * holds, and a way to run one real action or route handler as one person and
 * say what came back.
 *
 * Identity is real: each person's cookie is made by the app's own encoder
 * (lib/auth startSession) and read back by the real getSession, resolveScope
 * and RLS. Only the request plumbing (cookie jar, page-cache revalidation) is
 * stood in for, in tests/helpers/next-request.ts.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { Pool } from "pg";
import { withTenantSession, type SessionScope } from "@/db/session";
import { startSession } from "@/lib/auth";
import { ForbiddenError } from "@/lib/auth/scope";
import type { Role, Session } from "@/lib/auth/types";
import { getEnv } from "@/lib/env";
import { storage } from "@/lib/storage";
import { createProject, setIdeate, unlockStage, archiveProject, type ProjectScope } from "@/lib/data/projects";
import { addCalendarEntry, captureIdea, createOffer, createPillar } from "@/lib/data/planning";
import { generateContent, patchContent } from "@/lib/data/content";
import { generateVisuals } from "@/lib/data/pipeline";
import { storeAsset } from "@/lib/data/assets";
import { saveFoundation } from "@/lib/data/foundation";
import { addSamples, loadPackForWorkspace } from "@/lib/data/voice-pack";
import { finishIngest } from "@/lib/data/onboarding";
import { jar } from "./next-request";

export const SESSION_COOKIE = "huemen_session";

/** A unique word in every piece of A's text: if it shows up in an answer to B, A leaked. */
export const MARK = `amark${randomUUID().replace(/-/g, "").slice(0, 10)}`;
/** Names everything this run creates outside A, for cleanup. */
export const RUN = `xt-${randomUUID().slice(0, 8)}`;

export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * What an endpoint is aimed at. `tenantId` and `projectId` pick the scope; the
 * rest are object ids (A's, unless a test swaps them). Reading any of the
 * OBJECT_KEYS while building a call marks the endpoint as taking object ids,
 * so it also gets the "B's own workspace, A's object ids" attempt.
 */
export interface Target {
  tenantId: string;
  projectId: string;
  itemId: string;
  generationId: string;
  assetId: string;
  ideaId: string;
  slotId: string;
  offerId: string;
  pillarId: string;
  pillar2Id: string;
  sampleId: string;
  proposalId: string;
  signalId: string;
  incomingKey: string;
  memberId: string;
  coachId: string;
  assignedCoachId: string;
  /** A version number of A's voice, not an id. */
  version: number;
  /** For the admin status change. */
  workspaceStatus: "active" | "archived";
}

export const OBJECT_KEYS: (keyof Target)[] = [
  "itemId", "generationId", "assetId", "ideaId", "slotId", "offerId", "pillarId", "pillar2Id",
  "sampleId", "proposalId", "signalId", "incomingKey", "memberId", "coachId", "assignedCoachId",
];

export interface Person {
  label: string;
  session: Session | null;
  cookie: string | null;
}

export interface Fixture {
  A: string;
  B: string;
  ORG: string;
  PA: string;
  PB: string;
  a: Target;
  people: { clientA: Person; clientB: Person; coachB: Person; disabledA: Person; admin: Person; nobody: Person };
  /** Every id of A's, by name, to look for in answers to B. */
  aIds: Record<string, string>;
  packA: string;
  scopeA: SessionScope & { tenantId: string };
  scopeB: SessionScope & { tenantId: string };
  coach2: string;
}

// ---- database helpers -----------------------------------------------------------

export const ADMIN_DB = { tenantId: null, userId: null, isPlatformAdmin: true } as const;
let adminPg: Pool | null = null;
/** The owner role: bypasses RLS, so it sees what really is in A, whatever the app is told. */
export function ownerDb(): Pool {
  if (!adminPg) adminPg = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 });
  return adminPg;
}

export async function one<T = Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T> {
  return (await ownerDb().query(sql, args)).rows[0] as T;
}

async function insertUser(tenantId: string, email: string, role: Role, status = "active"): Promise<string> {
  return (await one<{ id: string }>(
    "INSERT INTO users (tenant_id, email, role, status, last_seen_at) VALUES ($1,$2,$3,$4, now()) RETURNING id",
    [tenantId, email, role, status],
  )).id;
}

/** A real session cookie, made the way sign-in makes it. */
async function personFor(label: string, s: Session | null): Promise<Person> {
  if (!s) return { label, session: null, cookie: null };
  jar.clear();
  await startSession(s);
  const cookie = jar.get(SESSION_COOKIE) ?? null;
  jar.clear();
  return { label, session: s, cookie };
}

let snapSql = "";

/** Every row A holds, table by table, plus A's stored files. Read as the owner role. */
export async function fingerprint(tenantId: string): Promise<Record<string, string>> {
  if (!snapSql) {
    const tables = (await ownerDb().query<{ t: string }>(
      `SELECT DISTINCT table_name AS t FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'tenant_id' ORDER BY 1`,
    )).rows.map((r) => r.t);
    snapSql = tables
      .map((t) => `SELECT '${t}' AS t, count(*)::int AS n, md5(coalesce(string_agg(x::text, E'\\n' ORDER BY x::text), '')) AS h
                     FROM "${t}" x WHERE x.tenant_id = $1${t === "tenants" ? " OR x.id = $1" : ""}`)
      .join(" UNION ALL ");
  }
  const rows = (await ownerDb().query<{ t: string; n: number; h: string }>(snapSql, [tenantId])).rows;
  const out: Record<string, string> = Object.fromEntries(rows.map((r) => [r.t, `${r.n}:${r.h}`]));
  out["storage files"] = filesOf(tenantId).join("|");
  return out;
}

function filesOf(tenantId: string): string[] {
  if (getEnv().STORAGE_DRIVER !== "local") return [];
  const root = resolve(process.cwd(), getEnv().STORAGE_LOCAL_DIR, "tenants", tenantId);
  const list = (dir: string): string[] => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return [];
    }
    return names.flatMap((n) => {
      const p = join(dir, n);
      const st = statSync(p);
      return st.isDirectory() ? list(p) : [`${p.slice(root.length)}:${st.size}`];
    });
  };
  return list(root).sort();
}

export function changedParts(before: Record<string, string>, after: Record<string, string>): string[] {
  return Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]);
}

// ---- A's objects ---------------------------------------------------------------

const words = (n: number, lead: string) => `${lead} ${Array.from({ length: n }, (_, i) => `word${i}`).join(" ")}.`;

export async function newSample(fx: Pick<Fixture, "scopeA" | "packA">, tag = randomUUID().slice(0, 6)): Promise<string> {
  await addSamples(fx.scopeA, fx.packA, [{ body: words(40, `${MARK} sample ${tag} I wrote this about pricing and clients`), channel: "linkedin", visibility: "public", source: "paste" }]);
  return (await one<{ id: string }>("SELECT id FROM voice_samples WHERE tenant_id=$1 AND body LIKE $2", [fx.scopeA.tenantId, `%sample ${tag} %`])).id;
}

export async function newProject(fx: Pick<Fixture, "scopeA">, opts: { archived?: boolean } = {}): Promise<string> {
  const id = await createProject(fx.scopeA, `Project ${MARK} ${randomUUID().slice(0, 4)}`, `About ${MARK}`);
  const ps: ProjectScope = { ...fx.scopeA, projectId: id };
  await setIdeate(ps, { format: "linkedin_post", pillarId: null, angle: `${MARK} angle`, ideaId: null, topic: `${MARK} topic` });
  await unlockStage(ps, "content");
  if (opts.archived) await archiveProject(ps);
  return id;
}

export async function newItem(scope: SessionScope & { tenantId: string }, projectId: string, pillarId: string | null = null): Promise<string> {
  const ps: ProjectScope = { ...scope, projectId };
  const id = await generateContent(ps, { format: "linkedin_post", topic: `${MARK} topic`, pillarId });
  await patchContent(ps, id, { body: `${MARK} body line one\nSecond line of the post.` });
  return id;
}

export async function newIdea(scope: SessionScope & { tenantId: string }): Promise<string> {
  const tag = randomUUID().slice(0, 6);
  await captureIdea(scope, `Idea ${MARK} ${tag}`);
  return (await one<{ id: string }>("SELECT id FROM ideas WHERE tenant_id=$1 AND raw_text LIKE $2", [scope.tenantId, `%${tag}`])).id;
}

export async function newSlot(scope: SessionScope & { tenantId: string }, pillarId: string | null): Promise<string> {
  const tag = randomUUID().slice(0, 6);
  await addCalendarEntry(scope, { date: "2030-01-15", pillarId, channel: "linkedin", topic: `${MARK} slot ${tag}`, hookAngle: `${MARK} hook`, cta: "Book a call" });
  return (await one<{ id: string }>("SELECT id FROM calendar_entries WHERE tenant_id=$1 AND topic LIKE $2", [scope.tenantId, `%${tag}`])).id;
}

export async function newOffer(scope: SessionScope & { tenantId: string }): Promise<string> {
  const tag = randomUUID().slice(0, 6);
  await createOffer(scope, { name: `Offer ${MARK} ${tag}`, format: "1:1", promise: `${MARK} promise`, deliverables: ["one"], pricingLogic: "fixed" });
  return (await one<{ id: string }>("SELECT id FROM offers WHERE tenant_id=$1 AND name LIKE $2", [scope.tenantId, `%${tag}`])).id;
}

export async function newPillar(scope: SessionScope & { tenantId: string }): Promise<string> {
  return createPillar(scope, `Pillar ${MARK} ${randomUUID().slice(0, 4)}`, `${MARK} pillar description`);
}

export async function newAsset(scope: SessionScope & { tenantId: string }): Promise<string> {
  await storeAsset(scope, new Uint8Array(PNG), "reference_image");
  return (await one<{ id: string }>("SELECT id FROM assets WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1", [scope.tenantId])).id;
}

/** A file sent ahead to storage and not used yet (lib/storage/upload). */
export async function newIncoming(tenantId: string, body: Uint8Array = new Uint8Array(PNG), name = "logo.png"): Promise<string> {
  const key = `tenants/${tenantId}/incoming/${randomUUID()}-${name}`;
  await storage().put(key, body, "application/octet-stream");
  return key;
}

export async function newOrgCoach(org: string): Promise<string> {
  return insertUser(org, `${RUN}-coach-${randomUUID().slice(0, 6)}@test.local`, "coach");
}

// ---- the fixture -----------------------------------------------------------------

export async function dbReachable(): Promise<boolean> {
  try {
    const probe = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await probe.query("SELECT 1");
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

export async function buildFixture(): Promise<Fixture> {
  const mk = async (name: string) => (await one<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name])).id;
  const ORG = await mk(`${RUN} org`);
  const A = await mk(`A ${MARK}`);
  const B = await mk(`${RUN} B`);

  const adminId = await insertUser(ORG, `${RUN}-admin@test.local`, "owner_admin");
  const coachId = await insertUser(ORG, `${RUN}-coach@test.local`, "coach");
  const coach2 = await newOrgCoach(ORG);
  const clientA = await insertUser(A, `${MARK}-client@test.local`, "client");
  const disabledA = await insertUser(A, `${MARK}-gone@test.local`, "client", "disabled");
  const spareA = await insertUser(A, `${MARK}-spare@test.local`, "client");
  const clientB = await insertUser(B, `${RUN}-b@test.local`, "client");
  await ownerDb().query("INSERT INTO coach_assignments (tenant_id, coach_user_id, assigned_by) VALUES ($1,$2,$3)", [B, coachId, adminId]);
  await ownerDb().query("INSERT INTO coach_assignments (tenant_id, coach_user_id, assigned_by) VALUES ($1,$2,$3)", [A, coach2, adminId]);

  const scopeA = { tenantId: A, userId: clientA, isPlatformAdmin: false };
  const scopeB = { tenantId: B, userId: clientB, isPlatformAdmin: false };

  // A's brand, voice and writing.
  await saveFoundation(scopeA, {
    niche: `${MARK} niche`, positioning: `${MARK} positioning`, offers: `${MARK} offers`, audience: `${MARK} audience`,
    chapters: [0, 1, 2].map((i) => ({ title: `${MARK} chapter ${i}`, body: `${MARK} story ${i}` })),
    tone: "plain, direct", doWords: "clients", dontWords: "synergy", readingLevel: "8",
    samplePosts: "", palette: "#112233, #445566", fonts: "Inter", imageStyleNotes: `${MARK} image notes`,
  });
  const pack = (await loadPackForWorkspace(scopeA))!;
  const sampleId = await newSample({ scopeA, packA: pack.id });
  await newSample({ scopeA, packA: pack.id });
  await newSample({ scopeA, packA: pack.id });
  await finishIngest(scopeA, (await loadPackForWorkspace(scopeA))!);
  const version = (await one<{ v: number }>("SELECT max(version)::int AS v FROM voice_pack_versions WHERE pack_id=$1", [pack.id]))?.v ?? 1;

  const pillarId = await newPillar(scopeA);
  const pillar2Id = await newPillar(scopeA);
  const PA = await newProject({ scopeA });
  const itemId = await newItem(scopeA, PA, pillarId);
  await generateVisuals({ ...scopeA, projectId: PA }, { scheme: 0, approvedOnly: false });
  const generationId = (await one<{ id: string }>("SELECT id FROM content_generations WHERE content_item_id=$1 ORDER BY variant_index DESC LIMIT 1", [itemId])).id;
  const assetId = await newAsset(scopeA);
  const incomingKey = await newIncoming(A);
  const ideaId = await newIdea(scopeA);
  const slotId = await newSlot(scopeA, pillarId);
  const offerId = await newOffer(scopeA);
  const proposalId = (await one<{ id: string }>(
    "INSERT INTO voice_pack_proposals (tenant_id, pack_id, patch, note, proposed_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [A, pack.id, JSON.stringify({ voiceLine: `${MARK} proposed line` }), `${MARK} note`, coach2],
  )).id;
  const signalId = (await one<{ id: string }>(
    "INSERT INTO voice_edit_signals (tenant_id, pack_id, kind, value, count, status) VALUES ($1,$2,'removed_word',$3,3,'proposed') RETURNING id",
    [A, pack.id, `${MARK}word`],
  )).id;
  // The token is never opened: no provider is configured in tests, so nothing is called.
  await ownerDb().query(
    "INSERT INTO connections (tenant_id, user_id, provider, account_email, scopes, access_token_enc) VALUES ($1,$2,'google',$3,'{}',$4)",
    [A, clientA, `${MARK}@gmail.test`, "not-a-real-token"],
  );

  // B: a workspace of its own, so B's people have a project and a voice to act in.
  await saveFoundation(scopeB, {
    niche: "B niche", positioning: "B positioning", offers: "", audience: "B audience",
    chapters: [0, 1, 2].map(() => ({ title: "", body: "" })),
    tone: "", doWords: "", dontWords: "", readingLevel: "", samplePosts: "", palette: "", fonts: "", imageStyleNotes: "",
  });
  const packB = (await loadPackForWorkspace(scopeB))!;
  await addSamples(scopeB, packB.id, [{ body: words(40, "B wrote this"), channel: "linkedin", visibility: "public", source: "paste" }]);
  const PB = await createProject(scopeB, "B project");
  await setIdeate({ ...scopeB, projectId: PB }, { format: "linkedin_post", pillarId: null, angle: null, ideaId: null, topic: "B topic" });
  await unlockStage({ ...scopeB, projectId: PB }, "content");

  const s = (userId: string, tenantId: string, role: Role, email: string): Session => ({ userId, tenantId, role, email });
  const people = {
    clientA: await personFor("A's own client", s(clientA, A, "client", `${MARK}-client@test.local`)),
    clientB: await personFor("a client of B", s(clientB, B, "client", `${RUN}-b@test.local`)),
    coachB: await personFor("a coach assigned only to B", s(coachId, ORG, "coach", `${RUN}-coach@test.local`)),
    disabledA: await personFor("a disabled user of A", s(disabledA, A, "client", `${MARK}-gone@test.local`)),
    admin: await personFor("a platform admin", s(adminId, ORG, "owner_admin", `${RUN}-admin@test.local`)),
    nobody: await personFor("no session", null),
  };

  const a: Target = {
    tenantId: A, projectId: PA, itemId, generationId, assetId, ideaId, slotId, offerId, pillarId, pillar2Id, sampleId,
    proposalId, signalId, incomingKey, memberId: spareA, coachId, assignedCoachId: coach2, version, workspaceStatus: "archived",
  };
  const aIds: Record<string, string> = {
    tenant: A, project: PA, item: itemId, generation: generationId, asset: assetId, idea: ideaId, slot: slotId, offer: offerId,
    pillar: pillarId, pillar2: pillar2Id, sample: sampleId, proposal: proposalId, signal: signalId, incoming: incomingKey,
    pack: pack.id, clientA, disabledA, spareA,
  };
  return { A, B, ORG, PA, PB, a, people, aIds, packA: pack.id, scopeA, scopeB, coach2 };
}

export async function dropFixture(fx: Fixture | null): Promise<void> {
  const ids = (await ownerDb().query<{ id: string }>("SELECT id FROM tenants WHERE name LIKE $1 OR name LIKE $2", [`${RUN}%`, `%${MARK}%`])).rows.map((r) => r.id);
  if (fx) ids.push(fx.A, fx.B, fx.ORG);
  const all = [...new Set(ids)];
  if (all.length) await withTenantSession(ADMIN_DB, (c) => c.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [all]));
  if (getEnv().STORAGE_DRIVER === "local") {
    for (const id of all) rmSync(resolve(process.cwd(), getEnv().STORAGE_LOCAL_DIR, "tenants", id), { recursive: true, force: true });
  }
  await adminPg?.end();
  adminPg = null;
}

// ---- running one call ----------------------------------------------------------------

export type Outcome =
  | { kind: "value"; value: unknown }
  | { kind: "redirect"; to: string }
  | { kind: "notFound" }
  | { kind: "forbidden"; message: string }
  | { kind: "response"; status: number; location: string | null; type: string | null; text: string }
  | { kind: "error"; error: unknown };

/** Run one call as one person: their cookie, and only theirs, is in the request. */
export async function runAs(p: Person, fn: () => Promise<unknown>): Promise<Outcome> {
  jar.clear();
  if (p.cookie) jar.set(SESSION_COOKIE, p.cookie);
  try {
    const v = await fn();
    if (v instanceof Response) {
      return {
        kind: "response",
        status: v.status,
        location: v.headers.get("location"),
        type: v.headers.get("content-type"),
        text: `${v.headers.get("content-disposition") ?? ""}\n${await v.text()}`,
      };
    }
    return { kind: "value", value: v };
  } catch (e) {
    const digest = (e as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) return { kind: "redirect", to: digest.split(";")[2] };
    if (typeof digest === "string" && digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return { kind: "notFound" };
    if (e instanceof ForbiddenError || (e instanceof Error && e.message === "UNAUTHENTICATED")) return { kind: "forbidden", message: e.message };
    return { kind: "error", error: e };
  } finally {
    jar.clear();
  }
}

/** A refusal: sign in, not found, forbidden, or the HTTP equivalent. */
export function refused(o: Outcome): boolean {
  if (o.kind === "notFound" || o.kind === "forbidden") return true;
  if (o.kind === "redirect") return o.to.startsWith("/login");
  if (o.kind === "response") return [401, 403, 404].includes(o.status) || (o.location ?? "").includes("/login");
  return false;
}

export function textOf(o: Outcome): string {
  switch (o.kind) {
    case "value":
      try {
        return JSON.stringify(o.value) ?? "";
      } catch {
        return String(o.value);
      }
    case "redirect":
      return o.to;
    case "notFound":
      return "";
    case "forbidden":
      return o.message;
    case "response":
      return `${o.status} ${o.location ?? ""} ${o.text}`;
    case "error":
      return o.error instanceof Error ? `${o.error.name}: ${o.error.message} ${(o.error as { digest?: string }).digest ?? ""}` : String(o.error);
  }
}

export function describeOutcome(o: Outcome): string {
  return `${o.kind}: ${textOf(o).slice(0, 300)}`;
}

/** What of A's is in an answer: the marker, or an id of A's the caller did not send. */
export function leaksOf(o: Outcome, fx: Fixture, sent: string[]): string[] {
  const s = textOf(o);
  const out: string[] = [];
  if (s.toLowerCase().includes(MARK)) out.push("A's text");
  for (const [name, id] of Object.entries(fx.aIds)) if (!sent.includes(id) && s.includes(id)) out.push(`A's ${name} id`);
  return out;
}

/** The target, watching which of its fields a call reads. */
export function watched(t: Target, seen: Set<string>): Target {
  return new Proxy(t, {
    get(obj, key: string | symbol) {
      if (typeof key === "string") seen.add(key);
      return Reflect.get(obj, key);
    },
  });
}

/** A form post, as the browser sends it. */
export function form(fields: Record<string, string | number | undefined>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.set(k, String(v));
  return fd;
}

/** A request to a route handler, carrying the cookies in the jar. */
export function request(method: string, path: string, opts: { json?: unknown; headers?: Record<string, string> } = {}): Request {
  const headers = new Headers(opts.headers);
  const cookie = [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
  if (cookie) headers.set("cookie", cookie);
  if (opts.json !== undefined) headers.set("content-type", "application/json");
  return new Request(new URL(path, getEnv().APP_URL), {
    method,
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
}
