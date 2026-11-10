/**
 * Cross-tenant tests on every endpoint (INV-1, brief §07): the REAL server
 * actions and route handlers, called in-process against the real database,
 * as people of workspace B aimed at workspace A.
 *
 * For every exported server action and route handler:
 *   1. Aimed at A (A's workspace id, A's project and object ids), each of
 *      - a client of B,
 *      - a coach assigned only to B,
 *      - a disabled user of A,
 *      - nobody signed in
 *      is refused (sign-in redirect, not found, forbidden, 401/403/404).
 *   2. From inside B's own workspace with A's object ids (and with A's
 *      project id), the client and the coach of B get nothing of A's back.
 *   3. After every attempt, nothing of A's changed: every row of every table
 *      with a tenant_id, and A's stored files, read by the owner role (which
 *      bypasses RLS), are exactly as before.
 *   4. Positive control: the same call by A's own member (or, for the admin
 *      console, a platform admin) is NOT refused and does what it says, so a
 *      refusal above proves something.
 * Nothing of A's: no answer to B contains A's marker word or an id of A's that
 * B did not send.
 *
 * Who is asking is real: each person's cookie is made by the app's own encoder
 * (lib/auth startSession) and read by the real getSession, resolveScope and
 * RLS. Only the request plumbing is stood in for (tests/helpers/next-request).
 *
 * A new action or route without a case here fails "every endpoint has a case".
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/headers", async () => (await import("./helpers/next-request")).nextHeaders);
vi.mock("next/cache", async () => (await import("./helpers/next-request")).nextCache);

import { appPool } from "@/db/pool";
import { signKey } from "@/lib/storage";
import { signPut } from "@/lib/storage/upload";
import { signLink } from "@/lib/auth/tokens";
import { getAccount } from "@/lib/data/auth";
import { signQuestionnaireToken } from "@/lib/invite/token";
import { encodeState } from "@/lib/integrations/state";
import { unavailableReason } from "@/lib/data/connections";
import { getEnv } from "@/lib/env";
import { TEMPLATE_CATALOG } from "@/lib/ai/template-defaults";
import { DEFAULT_DESIGN } from "@/lib/visual/design";
import { PUBLIC, endpointKeys } from "./helpers/endpoints";
import { jar } from "./helpers/next-request";
import {
  MARK, RUN, OBJECT_KEYS, SESSION_COOKIE, buildFixture, changedParts, dbReachable, describeOutcome, dropFixture, fingerprint, form,
  leaksOf, newAsset, newIdea, newIncoming, newItem, newOffer, newOrgCoach, newPillar, newProject, newSample, newSlot, one, ownerDb,
  refused, request, runAs, textOf, watched, type Fixture, type Outcome, type Person, type Target,
} from "./helpers/cross-tenant";

import * as brand from "@/app/w/[id]/brand/actions";
import * as pillars from "@/app/w/[id]/brand/pillars/actions";
import * as voice from "@/app/w/[id]/brand/voice/actions";
import * as check from "@/app/w/[id]/check/actions";
import * as create from "@/app/w/[id]/create/actions";
import * as onb from "@/app/w/[id]/onboarding/actions";
import * as agent from "@/app/w/[id]/p/[pid]/agent-actions";
import * as content from "@/app/w/[id]/p/[pid]/content/actions";
import * as ideate from "@/app/w/[id]/p/[pid]/ideate/actions";
import * as pipeline from "@/app/w/[id]/p/[pid]/pipeline-actions";
import * as plan from "@/app/w/[id]/plan/actions";
import * as projects from "@/app/w/[id]/project-actions";
import * as setup from "@/app/w/[id]/setup/actions";
import * as conn from "@/app/settings/connections/actions";
import * as prompts from "@/app/settings/prompts/actions";
import * as ws from "@/app/settings/workspaces/actions";
import * as invite from "@/app/invite/[token]/actions";
import * as questionnaire from "@/app/q/[token]/actions";
import * as tokensRoute from "@/app/w/[id]/brand/visual/tokens/route";
import * as voiceExport from "@/app/w/[id]/brand/voice/export/route";
import * as extract from "@/app/w/[id]/onboarding/extract/route";
import * as transcribe from "@/app/w/[id]/onboarding/transcribe/route";
import * as agentStream from "@/app/w/[id]/p/[pid]/agent/stream/route";
import * as contentStream from "@/app/w/[id]/p/[pid]/content/stream/route";
import * as mdExport from "@/app/w/[id]/p/[pid]/export/markdown/route";
import * as pdfExport from "@/app/w/[id]/p/[pid]/export/pdf/route";
import * as uploads from "@/app/w/[id]/uploads/route";
import * as storageRoute from "@/app/api/storage/[...key]/route";
import * as verify from "@/app/auth/verify/route";
import * as callback from "@/app/connections/callback/[provider]/route";
import * as connStart from "@/app/settings/connections/[provider]/start/route";

// ---- cases ------------------------------------------------------------------------

interface Case {
  key: string;
  call: (t: Target) => Promise<unknown>;
  /** Who the positive control runs as: A's own client (default) or a platform admin. */
  as?: "admin";
  /** New objects for the positive control, when it would use up A's shared ones. */
  fresh?: (fx: Fixture) => Promise<Partial<Target>>;
  /** The positive control's check. Default: A's data changed. */
  ok?: (o: Outcome, changed: string[], fx: Fixture) => void | Promise<void>;
  /** Some other answer that also means "refused" for this endpoint. */
  alsoRefused?: (o: Outcome) => boolean;
  /** "B's workspace, A's project" is not a refusal here: the project id is only echoed in a redirect. */
  projectEchoed?: true;
}

const CASES: Case[] = [];

type Fn = (...args: never[]) => unknown;
/** One case for `mod[name]`, filed under its source file so coverage can be checked. */
function on<M extends Record<string, unknown>, N extends keyof M & string>(
  file: string, mod: M, name: N,
  call: (f: M[N] extends Fn ? M[N] : never, t: Target) => Promise<unknown>,
  opts: Omit<Case, "key" | "call"> = {},
) {
  CASES.push({ key: `${file}#${name}`, call: (t) => call(mod[name] as M[N] extends Fn ? M[N] : never, t), ...opts });
}

// Positive-control checks.
const returns = (pred?: (v: unknown) => boolean) => (o: Outcome) => {
  expect(o.kind, describeOutcome(o)).toBe("value");
  if (pred) expect(pred((o as { value: unknown }).value), describeOutcome(o)).toBe(true);
};
const redirectsTo = (re: RegExp) => (o: Outcome) => {
  expect(o.kind, describeOutcome(o)).toBe("redirect");
  expect((o as { to: string }).to).toMatch(re);
};
const writesAndRedirects = (re: RegExp) => (o: Outcome, changed: string[]) => {
  redirectsTo(re)(o);
  expect(changed.length, "A's data should change").toBeGreaterThan(0);
};
const isOk = (v: unknown) => (v as { ok?: boolean } | null)?.ok === true;
const isNotOk = (v: unknown) => (v as { ok?: boolean } | null)?.ok === false;
const status = (...codes: number[]) => (o: Outcome) => {
  expect(o.kind, describeOutcome(o)).toBe("response");
  expect(codes, describeOutcome(o)).toContain((o as { status: number }).status);
};
/** Connections whose provider isn't set up stop at the capability check, AFTER the workspace and owner checks. */
const pastGateTo = (cap: Parameters<typeof unavailableReason>[0]) => (o: Outcome) => {
  expect(o.kind, describeOutcome(o)).toBe("value");
  const v = (o as { value: { ok: boolean; error?: string } }).value;
  if (!v.ok) expect(v.error, "should stop at the capability check, not the generic failure").not.toMatch(/didn't work and was logged/);
  if (!v.ok && unavailableReason(cap)) expect(v.error).toBe(unavailableReason(cap));
};
/** connections actions that catch everything answer a refusal with their generic failure. */
const genericFailure = (o: Outcome) => o.kind === "value" && isNotOk(o.value) && /didn't work and was logged/.test(String((o.value as { error?: string }).error));

const params = <P extends Record<string, string | string[]>>(p: P) => ({ params: Promise.resolve(p) });
const W = (t: Target, rest = "") => `/w/${t.tenantId}${rest}`;
const P = (t: Target, rest = "") => `/w/${t.tenantId}/p/${t.projectId}${rest}`;

// -- workspace: brand ---------------------------------------------------------------------
{
  const f = "src/app/w/[id]/brand/actions.ts";
  on(f, brand, "saveFoundationAction", (fn, t) => fn(form({ tenantId: t.tenantId, niche: "Changed niche", positioning: "Changed" })), { ok: writesAndRedirects(/\/brand\?saved=1$/) });
  on(f, brand, "uploadAssetAction", (fn, t) => fn(form({ tenantId: t.tenantId, kind: "reference_image", key: t.incomingKey })), {
    fresh: async (fx) => ({ incomingKey: await newIncoming(fx.A) }),
  });
  on(f, brand, "uploadAssetChecked", (fn, t) => fn(form({ tenantId: t.tenantId, kind: "reference_image", key: t.incomingKey })), {
    fresh: async (fx) => ({ incomingKey: await newIncoming(fx.A) }),
  });
  on(f, brand, "deleteAssetAction", (fn, t) => fn(t.tenantId, t.assetId), { fresh: async (fx) => ({ assetId: await newAsset(fx.scopeA) }) });
  on(f, brand, "submitIntakeAction", (fn, t) => fn(form({ tenantId: t.tenantId, notes: "Niche: intake niche\nAudience: founders" })), { ok: writesAndRedirects(/\/brand\/questions\?placed=/) });
  on(f, brand, "answerQuestionsAction", (fn, t) => fn(form({ tenantId: t.tenantId, q_audience: "Founders of small studios" })), { ok: writesAndRedirects(/\/brand\/questions\?saved=1$/) });
  on(f, brand, "saveVisualAction", (fn, t) => fn(t.tenantId, { palette: ["#0a0b0c"], fonts: ["Inter"], imageStyleNotes: "flat" }));
  on(f, brand, "readSiteBrandAction", (fn, t) => fn(t.tenantId, "http://127.0.0.1/"), { ok: returns(isNotOk) });
}

// -- workspace: pillars ------------------------------------------------------------------------
{
  const f = "src/app/w/[id]/brand/pillars/actions.ts";
  on(f, pillars, "createPillarAction", (fn, t) => fn(t.tenantId, "New pillar", "about it"));
  on(f, pillars, "reorderPillarsAction", (fn, t) => fn(t.tenantId, [t.pillar2Id, t.pillarId]));
  on(f, pillars, "updatePillarAction", (fn, t) => fn(t.tenantId, t.pillarId, "Renamed pillar", "new words"));
  on(f, pillars, "deletePillarAction", (fn, t) => fn(t.tenantId, t.pillarId), { fresh: async (fx) => ({ pillarId: await newPillar(fx.scopeA) }) });
  on(f, pillars, "regeneratePillarsAction", (fn, t) => fn(form({ tenantId: t.tenantId, count: 1, focus: "pricing" })), { ok: writesAndRedirects(/\/brand\/pillars\?generated=1$/) });
  on(f, pillars, "draftFromPillarsAction", (fn, t) => fn(form({ tenantId: t.tenantId, format: "linkedin_post" })), { ok: writesAndRedirects(/\/brand\/pillars\?drafted=/) });
  on(f, pillars, "startFromPillarAction", (fn, t) => fn(t.tenantId, "A pillar"));
}

// -- workspace: voice --------------------------------------------------------------------------
{
  const f = "src/app/w/[id]/brand/voice/actions.ts";
  on(f, voice, "addSamplesAction", (fn, t) => fn(form({ tenantId: t.tenantId, channel: "linkedin", text: "A new post I wrote about pricing, the long way round.\n\n\nAnd a second one about clients." })));
  on(f, voice, "rescanAction", (fn, t) => fn(form({ tenantId: t.tenantId })), { ok: redirectsTo(/\/brand\/voice\?scanned=1/) });
  on(f, voice, "excludeSampleAction", (fn, t) => fn(form({ tenantId: t.tenantId, sampleId: t.sampleId, excluded: "1" })), { fresh: async (fx) => ({ sampleId: await newSample(fx) }) });
  on(f, voice, "deleteSampleAction", (fn, t) => fn(form({ tenantId: t.tenantId, sampleId: t.sampleId })), { fresh: async (fx) => ({ sampleId: await newSample(fx) }) });
  on(f, voice, "saveVoiceAction", (fn, t) => fn(form({ tenantId: t.tenantId, voiceLine: "Plain and direct.", hardRules: "No jargon", neverWords: "synergy", reader: "founders", carries: "warmth" })), { ok: writesAndRedirects(/\/brand\/voice/) });
  on(f, voice, "resolveSignatureAction", (fn, t) => fn(form({ tenantId: t.tenantId, phrase: "to be honest", keep: "0" })), { ok: writesAndRedirects(/\/brand\/voice/) });
  on(f, voice, "decideProposalAction", (fn, t) => fn(form({ tenantId: t.tenantId, proposalId: t.proposalId, approve: "1" })));
  on(f, voice, "decideEditAction", (fn, t) => fn(form({ tenantId: t.tenantId, signalId: t.signalId, accept: "1" })));
  on(f, voice, "restoreVersionAction", (fn, t) => fn(form({ tenantId: t.tenantId, version: t.version })), { ok: writesAndRedirects(/\/brand\/voice/) });
  on(f, voice, "previewRescanAction", (fn, t) => fn(form({ tenantId: t.tenantId })), { ok: redirectsTo(/\/brand\/voice\?preview=1/) });
  on(f, voice, "decidePatternAction", (fn, t) => fn(form({ tenantId: t.tenantId, value: "short paragraphs", keep: "1" })));
  on(f, voice, "setBenchmarkNoteAction", (fn, t) => fn(form({ tenantId: t.tenantId, sampleId: t.sampleId, note: "This is how I sound on a good day." })));
  on(f, voice, "setAntiSampleAction", (fn, t) => fn(form({ tenantId: t.tenantId, sampleId: t.sampleId, off: "too formal", fixed: "say it plainly" })));
  on(f, voice, "saveSelfCheckAction", (fn, t) => fn(form({ tenantId: t.tenantId, selfCheck: "Would I say this out loud?" })), { ok: writesAndRedirects(/\/brand\/voice/) });
}

// -- workspace: check, create, setup ---------------------------------------------------------------
{
  const f = "src/app/w/[id]/check/actions.ts";
  on(f, check, "checkAction", (fn, t) => fn(t.tenantId, "We leverage synergy to unlock value.", "linkedin"), { ok: returns(isOk) });
  on(f, check, "judgeAction", (fn, t) => fn(t.tenantId, "We leverage synergy to unlock value.", "linkedin"), { ok: returns(isOk) });
  on(f, check, "rewriteAction", (fn, t) => fn(t.tenantId, "We leverage synergy to unlock value.", "linkedin"), { ok: returns(isOk) });
}
{
  const f = "src/app/w/[id]/create/actions.ts";
  on(f, create, "startPieceAction", (fn, t) => fn(form({ tenantId: t.tenantId, topic: "Pricing without apology", format: "linkedin_post", ideaId: t.ideaId })), {
    fresh: async (fx) => ({ ideaId: await newIdea(fx.scopeA) }),
    ok: writesAndRedirects(/\/p\/[0-9a-f-]{36}\/ideate$/),
  });
  on(f, create, "suggestOthersAction", (fn, t) => fn(t.tenantId), { ok: (o, changed) => { returns(isOk)(o); expect(changed.length).toBeGreaterThan(0); } });
}
{
  const f = "src/app/w/[id]/setup/actions.ts";
  on(f, setup, "setupPillarsAction", (fn, t) => fn(form({ tenantId: t.tenantId, known_for: "Pricing for studios", contrarian: "Discounts kill studios" })), { ok: writesAndRedirects(/\/setup\?tab=pillars&saved=1$/) });
}

// -- workspace: onboarding ------------------------------------------------------------------------
{
  const f = "src/app/w/[id]/onboarding/actions.ts";
  const about = { name: "A name", niche: "studios", audience: "founders", offers: "coaching", positioning: "plain talk" };
  const story = "I priced my first studio job at half of what it cost me, and learned the hard way what a quote is for.";
  on(f, onb, "aboutAction", (fn, t) => fn(t.tenantId, about), { ok: writesAndRedirects(/\/onboarding\?step=/) });
  on(f, onb, "finishLaterAction", (fn, t) => fn(t.tenantId), { ok: (o, _c, fx) => redirectsTo(new RegExp(`^/w/${fx.A}$`))(o) });
  on(f, onb, "saveSourcesAction", (fn, t) => fn(t.tenantId, ["paste", "linkedin"], ["linkedin", "newsletter"]));
  on(f, onb, "ingestAction", (fn, t) => fn(t.tenantId, [{ body: `${story} Then I did it again.`, channel: "linkedin", visibility: "public", kind: "corpus" }], "paste"));
  on(f, onb, "markIngestingAction", (fn, t) => fn(t.tenantId));
  on(f, onb, "resumeIngestAction", (fn, t) => fn(t.tenantId));
  on(f, onb, "finishIngestAction", (fn, t) => fn(t.tenantId));
  on(f, onb, "voiceNotesAction", (fn, t) => fn(t.tenantId, [`${story} That is the note.`]));
  on(f, onb, "answerAction", (fn, t) => fn(t.tenantId, "C1", "Founders who are tired of jargon"));
  on(f, onb, "dialsAction", (fn, t) => fn(t.tenantId, { fun_serious: 4, casual_formal: 3 }));
  // A card that isn't showing is a no-op; what is under test is who gets past actionActor.
  on(f, onb, "cardAction", (fn, t) => fn(t.tenantId, "H5:synergy", "allow"), { ok: returns() });
  on(f, onb, "benchmarksAction", (fn, t) => fn(t.tenantId, [t.sampleId]));
  on(f, onb, "goToStepAction", (fn, t) => fn(t.tenantId, 2), { ok: writesAndRedirects(/\/onboarding\?step=2$/) });
  on(f, onb, "hueAction", (fn, t) => fn(form({ tenantId: t.tenantId, known_for: "pricing", intent: "next" })), { ok: writesAndRedirects(/\/onboarding\?step=4$/) });
  on(f, onb, "workModeAction", (fn, t) => fn(t.tenantId, "cowrite"));
  on(f, onb, "firstPieceAction", (fn, t) => fn(t.tenantId));
  on(f, onb, "ownDraftForFirstPieceAction", (fn, t) => fn(t.tenantId, `${story} My own draft of the first piece.`));
  on(f, onb, "finishOnboardingAction", (fn, t) => fn(form({ tenantId: t.tenantId, editPiece: t.projectId })), { ok: writesAndRedirects(/\/content$/), projectEchoed: true });
  on(f, onb, "neverWordsAction", (fn, t) => fn(t.tenantId, ["leverage", "synergy"]));
  on(f, onb, "dropOpenerAction", (fn, t) => fn(t.tenantId, "Here's the thing"));
  on(f, onb, "guardrailAction", (fn, t) => fn(t.tenantId, "g-test", "Never name a client"));
  on(f, onb, "suggestionsAction", (fn, t) => fn(t.tenantId, true), { ok: returns(isOk) });
  on(f, onb, "pairsAction", (fn, t) => fn(t.tenantId), { ok: returns(isOk) });
  on(f, onb, "picksAction", (fn, t) => fn(t.tenantId, [{ dial: "fun_serious", side: "left" }]));
  on(f, onb, "previewAction", (fn, t) => fn(t.tenantId), { ok: returns(isOk) });
  on(f, onb, "storiesAction", (fn, t) => fn(t.tenantId, [{ title: "First quote", body: story }]));
  on(f, onb, "beliefsAction", (fn, t) => fn(t.tenantId, ["Price the outcome, not the hours"]));
  on(f, onb, "proofsAction", (fn, t) => fn(t.tenantId, [{ claim: "40 studios coached", source: "own records" }]));
  on(f, onb, "influencesAction", (fn, t) => fn(t.tenantId, { admire: ["Plain speakers"], avoid: ["Hype"] }));
  on(f, onb, "languagesAction", (fn, t) => fn(t.tenantId, { primary: "en", also: [] }));
  on(f, onb, "importUrlAction", (fn, t) => fn(t.tenantId, "http://127.0.0.1/blog", true), { ok: returns(isNotOk) });
  on(f, onb, "advanceAction", (fn, t) => fn(t.tenantId, "name"), { ok: writesAndRedirects(/\/onboarding\?s=name$/) });
  on(f, onb, "siteAction", (fn, t) => fn(t.tenantId, "http://127.0.0.1/"), { ok: returns(isNotOk) });
  on(f, onb, "siteProfileAction", (fn, t) => fn(t.tenantId, "We help studios price their work."), { ok: returns((v) => isOk(v) || isNotOk(v)) });
  on(f, onb, "nameAction", (fn, t) => fn(t.tenantId, { name: "A person", niche: "studios" }), { ok: writesAndRedirects(/\/onboarding\?s=audience$/) });
  on(f, onb, "audienceAction", (fn, t) => fn(t.tenantId, { audience: "founders", offers: "coaching", positioning: "plain" }), { ok: writesAndRedirects(/\/onboarding\?s=writing$/) });
  on(f, onb, "lookAction", (fn, t) => fn(t.tenantId, ["#123456", "#abcdef"]), { ok: writesAndRedirects(/\/onboarding\?s=words$/) });
  on(f, onb, "wordsAction", (fn, t) => fn(t.tenantId, ["plain", "direct"]), { ok: writesAndRedirects(/\/onboarding\?s=draft$/) });
  on(f, onb, "guideSeenAction", (fn, t) => fn(t.tenantId));
}

// -- workspace: plan (ideas, calendar, offers) ---------------------------------------------------------
{
  const f = "src/app/w/[id]/plan/actions.ts";
  on(f, plan, "captureIdeaAction", (fn, t) => fn(form({ tenantId: t.tenantId, text: "An idea about quotes" })));
  on(f, plan, "setIdeaPillarAction", (fn, t) => fn(form({ tenantId: t.tenantId, id: t.ideaId, pillarId: t.pillar2Id })));
  on(f, plan, "archiveIdeaAction", (fn, t) => fn(form({ tenantId: t.tenantId, id: t.ideaId })), { fresh: async (fx) => ({ ideaId: await newIdea(fx.scopeA) }) });
  on(f, plan, "convertIdeaAction", (fn, t) => fn(form({ tenantId: t.tenantId, id: t.ideaId, format: "linkedin_post" })), {
    fresh: async (fx) => ({ ideaId: await newIdea(fx.scopeA) }),
    ok: writesAndRedirects(/\/p\/[0-9a-f-]{36}\/ideate$/),
  });
  on(f, plan, "startFromSlotAction", (fn, t) => fn(form({ tenantId: t.tenantId, id: t.slotId })), {
    fresh: async (fx) => ({ slotId: await newSlot(fx.scopeA, fx.a.pillarId) }),
    ok: writesAndRedirects(/\/p\/[0-9a-f-]{36}\/ideate$/),
  });
  on(f, plan, "addCalendarEntryAction", (fn, t) => fn(form({ tenantId: t.tenantId, date: "2030-03-01", pillarId: t.pillarId, channel: "linkedin", topic: "Quotes" })));
  on(f, plan, "generateCalendarAction", (fn, t) => fn(t.tenantId, { start: "2031-01-06", perWeek: 1, channels: ["linkedin"] }), { ok: (o, changed) => { returns()(o); expect(changed.length).toBeGreaterThan(0); } });
  on(f, plan, "deleteCalendarEntryAction", (fn, t) => fn(form({ tenantId: t.tenantId, id: t.slotId })), { fresh: async (fx) => ({ slotId: await newSlot(fx.scopeA, null) }) });
  on(f, plan, "createOfferAction", (fn, t) => fn(form({ tenantId: t.tenantId, name: "Studio pricing day", format: "workshop" })));
  on(f, plan, "updateOfferAction", (fn, t) => fn(form({ tenantId: t.tenantId, id: t.offerId, name: "Renamed offer", promise: "less guessing" })), { ok: writesAndRedirects(/\/plan\/offers$/) });
  on(f, plan, "deleteOfferAction", (fn, t) => fn(form({ tenantId: t.tenantId, id: t.offerId })), { fresh: async (fx) => ({ offerId: await newOffer(fx.scopeA) }) });
}

// -- workspace: projects -----------------------------------------------------------------------------
{
  const f = "src/app/w/[id]/project-actions.ts";
  on(f, projects, "createProjectAction", (fn, t) => fn(form({ tenantId: t.tenantId, name: "Copied project", fromProject: t.projectId })), { ok: writesAndRedirects(/\/p\/[0-9a-f-]{36}\/ideate$/) });
  on(f, projects, "renameProjectAction", (fn, t) => fn(t.tenantId, t.projectId, "Renamed project"));
  on(f, projects, "duplicateProjectAction", (fn, t) => fn(t.tenantId, t.projectId, "Duplicate"));
  on(f, projects, "archiveProjectAction", (fn, t) => fn(t.tenantId, t.projectId), { fresh: async (fx) => ({ projectId: await newProject(fx) }) });
  on(f, projects, "deleteProjectAction", (fn, t) => fn(t.tenantId, t.projectId), { fresh: async (fx) => ({ projectId: await newProject(fx) }) });
  on(f, projects, "createFromPromptAction", (fn, t) => fn(form({ tenantId: t.tenantId, prompt: "I help design studios price their work. Founders, mostly." })), { ok: redirectsTo(/\/brand\/questions\?placed=/) });
  on(f, projects, "starProjectAction", (fn, t) => fn(t.tenantId, t.projectId, true));
  on(f, projects, "restoreProjectAction", (fn, t) => fn(t.tenantId, t.projectId), { fresh: async (fx) => ({ projectId: await newProject(fx, { archived: true }) }) });
}

// -- project: content, agent, ideate, visuals ---------------------------------------------------------
{
  const f = "src/app/w/[id]/p/[pid]/content/actions.ts";
  on(f, content, "checkContentItemAction", (fn, t) => fn(t.tenantId, t.projectId, t.itemId), { ok: returns((v) => typeof (v as { score?: unknown }).score === "number") });
  on(f, content, "draftAction", (fn, t) => fn(t.tenantId, t.projectId, { format: "linkedin_post", topic: "Quotes", pillarId: t.pillarId }));
  on(f, content, "steerAction", (fn, t) => fn(t.tenantId, t.projectId, t.itemId, "shorter"));
  on(f, content, "applyVariantAction", (fn, t) => fn(t.tenantId, t.projectId, t.itemId, t.generationId));
  on(f, content, "saveContentAction", (fn, t) => fn(t.tenantId, t.projectId, t.itemId, { hook: "Saved hook", body: "Saved body", cta: "Saved cta", pillarId: t.pillarId, status: "edited" }));
  on(f, content, "patchContentAction", (fn, t) => fn(t.tenantId, t.projectId, t.itemId, { cta: "Patched cta" }));
  on(f, content, "askRewriteAction", (fn, t) => fn(t.tenantId, t.projectId, t.itemId, { part: "hook", text: "A hook", instruction: "make it shorter" }), { ok: returns(isOk) });
  on(f, content, "deleteContentAction", (fn, t) => fn(t.tenantId, t.projectId, t.itemId), { fresh: async (fx) => ({ itemId: await newItem(fx.scopeA, fx.PA) }) });
  on(f, content, "ghostwriteAction", (fn, t) => fn(t.tenantId, t.projectId, { format: "linkedin_post", topic: "Quotes" }), { ok: (o, c) => { returns(isOk)(o); expect(c.length).toBeGreaterThan(0); } });
  on(f, content, "coWriteAction", (fn, t) => fn(t.tenantId, t.projectId, { format: "linkedin_post", topic: "Quotes", angle: null }), { ok: (o, c) => { returns(isOk)(o); expect(c.length).toBeGreaterThan(0); } });
  on(f, content, "ownDraftAction", (fn, t) => fn(t.tenantId, t.projectId, { format: "linkedin_post", topic: "Quotes", text: "My own words about quotes, plainly put." }), { ok: (o, c) => { returns(isOk)(o); expect(c.length).toBeGreaterThan(0); } });
  on(f, content, "judgeContentItemAction", (fn, t) => fn(t.tenantId, t.projectId, t.itemId), { ok: returns(isOk) });
  on(f, content, "applyFixAction", (fn, t) => fn(t.tenantId, t.projectId, t.itemId, "Second line of the post.", "A better second line."), {
    fresh: async (fx) => ({ itemId: await newItem(fx.scopeA, fx.PA) }),
    ok: (o, c) => { returns((v) => v === true)(o); expect(c.length).toBeGreaterThan(0); },
  });
  on(f, content, "rewriteContentItemAction", (fn, t) => fn(t.tenantId, t.projectId, t.itemId), { ok: (o, c) => { returns(isOk)(o); expect(c.length).toBeGreaterThan(0); } });
}
{
  const f = "src/app/w/[id]/p/[pid]/agent-actions.ts";
  on(f, agent, "askAgent", (fn, t) => fn(t.tenantId, t.projectId, "idea: quoting for retainers"));
  on(f, agent, "runAgentAction", (fn, t) => fn(t.tenantId, t.projectId, { type: "capture_idea", params: { text: "an idea from a button" } }));
}
{
  const f = "src/app/w/[id]/p/[pid]/ideate/actions.ts";
  on(f, ideate, "setIdeateAction", (fn, t) => fn(form({ tenantId: t.tenantId, projectId: t.projectId, topic: "New topic", format: "linkedin_post", pillarId: t.pillar2Id, ideaId: t.ideaId })));
}
{
  const f = "src/app/w/[id]/p/[pid]/pipeline-actions.ts";
  on(f, pipeline, "saveDesignAction", (fn, t) => fn(t.tenantId, t.projectId, t.itemId, DEFAULT_DESIGN, 1), { ok: (o, c) => { returns((v) => v === true)(o); expect(c.length).toBeGreaterThan(0); } });
  on(f, pipeline, "generateVisualsAction", (fn, t) => fn(form({ tenantId: t.tenantId, projectId: t.projectId, scheme: 0 })), { ok: writesAndRedirects(/\/visual\?generated=/) });
  on(f, pipeline, "deleteVisualsAction", (fn, t) => fn(t.tenantId, t.projectId, t.itemId));
}

// -- settings: connections, prompts, workspaces (admin console) ---------------------------------------------
{
  const f = "src/app/settings/connections/actions.ts";
  on(f, conn, "gmailPageAction", (fn, t) => fn(t.tenantId, { pageToken: null, scanned: 0, added: 0, months: 12 }), { alsoRefused: genericFailure, ok: pastGateTo("gmail") });
  on(f, conn, "gmailFinishAction", (fn, t) => fn(t.tenantId, { scanned: 0 }));
  on(f, conn, "removeImportedEmailAction", (fn, t) => fn(form({ tenantId: t.tenantId })), {
    fresh: async (fx) => {
      await ownerDb().query(
        "INSERT INTO voice_samples (tenant_id, pack_id, channel, source, visibility, body, word_count, external_id) VALUES ($1,$2,'email','connection','private',$3,5,$4)",
        [fx.A, fx.packA, `${MARK} an email I sent`, `gmail:${RUN}`],
      );
      return {};
    },
  });
  on(f, conn, "pickerConfigAction", (fn, t) => fn(t.tenantId), { alsoRefused: genericFailure, ok: pastGateTo("docs") });
  on(f, conn, "importDocsAction", (fn, t) => fn(t.tenantId, [{ id: "doc-1", channel: "blog", published: true }]));
  on(f, conn, "listEventsAction", (fn, t) => fn(t.tenantId));
  on(f, conn, "saveEventsAsIdeasAction", (fn, t) => fn(t.tenantId, [{ title: "Talk", date: "2030-05-01", description: "on pricing" }]));
  on(f, conn, "importYouTubeAction", (fn, t) => fn(t.tenantId));
  // A has no LinkedIn connection to record a sync on: the control stops at the capability check.
  on(f, conn, "importLinkedInPostsAction", (fn, t) => fn(t.tenantId), { ok: pastGateTo("posts") });
  on(f, conn, "disconnectAction", (fn, t) => fn(form({ tenantId: t.tenantId, provider: "google", remove: "1" })));
}
{
  const f = "src/app/settings/prompts/actions.ts";
  const key = TEMPLATE_CATALOG[0].key;
  on(f, prompts, "saveTemplateAction", (fn, t) => fn({ key, body: "A workspace override.", tenantId: t.tenantId }), { as: "admin" });
  on(f, prompts, "removeOverrideAction", (fn, t) => fn({ key, tenantId: t.tenantId }), { as: "admin" });
}
{
  const f = "src/app/settings/workspaces/actions.ts";
  // Aimed at no workspace: the refusal is by role. The control makes one (removed after the run).
  on(f, ws, "createWorkspaceAction", (fn) => fn(form({ name: `${RUN} made by admin` })), { as: "admin", ok: returns() });
  on(f, ws, "inviteUserAction", (fn, t) => fn(form({ tenantId: t.tenantId, email: `${RUN}-invited-${Math.random().toString(36).slice(2, 8)}@test.local`, role: "client" })), { as: "admin" });
  on(f, ws, "assignCoachAction", (fn, t) => fn(form({ tenantId: t.tenantId, coachUserId: t.coachId })), { as: "admin", fresh: async (fx) => ({ coachId: fx.coach2 }) });
  on(f, ws, "unassignCoachAction", (fn, t) => fn(form({ tenantId: t.tenantId, coachUserId: t.assignedCoachId })), { as: "admin" });
  on(f, ws, "memberAccessAction", (fn, t) => fn(form({ userId: t.memberId, on: "false" })), { as: "admin" });
  on(f, ws, "memberRoleAction", (fn, t) => fn(form({ userId: t.memberId, role: "owner_admin" })), {
    as: "admin",
    // Roles switch only inside the admins' organisation, so the control promotes one of its coaches.
    fresh: async (fx) => ({ memberId: await newOrgCoach(fx.ORG) }),
    ok: returns(),
  });
  on(f, ws, "renameWorkspaceAction", (fn, t) => fn(form({ tenantId: t.tenantId, name: `A ${MARK} renamed` })), { as: "admin" });
  on(f, ws, "accentAction", (fn, t) => fn(form({ tenantId: t.tenantId, accent: "#123456" })), { as: "admin" });
  on(f, ws, "setCapsAction", (fn, t) => fn(form({ tenantId: t.tenantId, textSoft: "", textHard: "", imageSoft: "", imageHard: "" })), { as: "admin" });
  // Refused callers ask to archive A; the control sets it active, which leaves A usable (and is audited).
  on(f, ws, "setStatusAction", (fn, t) => fn(form({ tenantId: t.tenantId, status: t.workspaceStatus })), { as: "admin", fresh: async () => ({ workspaceStatus: "active" }) });
}

// -- routes under a workspace ------------------------------------------------------------------------------
{
  on("src/app/w/[id]/brand/visual/tokens/route.ts", tokensRoute, "GET", (fn, t) => fn(request("GET", W(t, "/brand/visual/tokens")), params({ id: t.tenantId })), {
    ok: (o) => { status(200)(o); expect((o as { text: string }).text).toContain('"$schema": "huemen.visual-core/1"'); },
  });
  on("src/app/w/[id]/brand/voice/export/route.ts", voiceExport, "GET", (fn, t) => fn(request("GET", W(t, "/brand/voice/export")), params({ id: t.tenantId })), {
    ok: (o) => { status(200)(o); expect((o as { text: string }).text.toLowerCase()).toContain(MARK); },
  });
  on("src/app/w/[id]/onboarding/extract/route.ts", extract, "POST", (fn, t) => fn(request("POST", W(t, "/onboarding/extract"), { json: { key: t.incomingKey, name: "notes.pdf" } }), params({ id: t.tenantId })), {
    // The bytes are a PNG, not a document: read back, removed, and refused as unreadable.
    fresh: async (fx) => ({ incomingKey: await newIncoming(fx.A) }),
    ok: (o, c) => { status(200, 422)(o); expect(c).toContain("storage files"); },
  });
  on("src/app/w/[id]/onboarding/transcribe/route.ts", transcribe, "POST", (fn, t) => fn(request("POST", W(t, "/onboarding/transcribe"), { json: { key: t.incomingKey, name: "note.webm", type: "audio/webm" } }), params({ id: t.tenantId })), {
    fresh: async (fx) => ({ incomingKey: await newIncoming(fx.A, new Uint8Array([26, 69, 223, 163, 1, 2, 3, 4]), "note.webm") }),
    ok: (o, c) => { status(200, 502)(o); expect(c).toContain("storage files"); },
  });
  on("src/app/w/[id]/uploads/route.ts", uploads, "POST", (fn, t) => fn(request("POST", W(t, "/uploads"), { json: { purpose: "asset", name: "logo.png", size: 100, type: "image/png" } }), params({ id: t.tenantId })), {
    ok: (o, _c, fx) => { status(200)(o); expect((o as { text: string }).text).toContain(`tenants/${fx.A}/incoming/`); },
  });
  on("src/app/w/[id]/p/[pid]/agent/stream/route.ts", agentStream, "POST", (fn, t) => fn(request("POST", P(t, "/agent/stream"), { json: { message: "What should I post this week?" } }), params({ id: t.tenantId, pid: t.projectId })), {
    ok: (o, c) => { status(200)(o); expect((o as { text: string }).text).toContain('"t":"done"'); expect(c.length).toBeGreaterThan(0); },
  });
  on("src/app/w/[id]/p/[pid]/content/stream/route.ts", contentStream, "POST", (fn, t) => fn(request("POST", P(t, "/content/stream"), { json: { format: "linkedin_post", topic: "Quotes", pillarId: t.pillarId } }), params({ id: t.tenantId, pid: t.projectId })), {
    ok: (o, c) => { status(200)(o); expect((o as { text: string }).text).toContain('"t":"saved"'); expect(c).toContain("content_items"); },
  });
  on("src/app/w/[id]/p/[pid]/export/markdown/route.ts", mdExport, "GET", (fn, t) => fn(request("GET", P(t, "/export/markdown")), params({ id: t.tenantId, pid: t.projectId })), {
    ok: (o) => { status(200)(o); expect((o as { text: string }).text.toLowerCase()).toContain(MARK); },
  });
  on("src/app/w/[id]/p/[pid]/export/pdf/route.ts", pdfExport, "GET", (fn, t) => fn(request("GET", P(t, "/export/pdf")), params({ id: t.tenantId, pid: t.projectId })), {
    ok: (o) => { status(200)(o); expect((o as { type: string }).type).toBe("application/pdf"); },
  });
}

// ---- the run ------------------------------------------------------------------------------------

let FX: Fixture | null = null;
let ok = false;

beforeAll(async () => {
  ok = await dbReachable();
  if (!ok) return;
  FX = await buildFixture();
}, 60_000);

afterAll(async () => {
  if (!ok) return;
  await dropFixture(FX);
  await appPool().end();
});

const sentIds = (t: Target, seen: Set<string>) => [...seen].map((k) => t[k as keyof Target]).filter((v): v is string => typeof v === "string");

/** One attempt by someone who should get nothing of A's: what came back, and A before and after. */
async function attempt(c: Case, who: Person, target: Target, mustRefuse: boolean, before: Record<string, string>) {
  const fx = FX!;
  const seen = new Set<string>();
  const o = await runAs(who, () => c.call(watched(target, seen)));
  const where = `${c.key} by ${who.label} at ${target.tenantId === fx.A ? "A" : "B"}/${target.projectId === fx.PA ? "A's project" : "B's project"}: ${describeOutcome(o)}`;
  if (mustRefuse) expect(refused(o) || Boolean(c.alsoRefused?.(o)), `should be refused. ${where}`).toBe(true);
  expect(leaksOf(o, fx, sentIds(target, seen)), `nothing of A's in the answer. ${where}`).toEqual([]);
  expect(changedParts(before, await fingerprint(fx.A)), `nothing of A's changed. ${where}`).toEqual([]);
  return seen;
}

describe("cross-tenant: every endpoint, as people of B aimed at A", { timeout: 30_000 }, () => {
  it("the database is really tested (CI)", () => {
    if (process.env.CI) expect(ok).toBe(true);
  });

  it("every endpoint has a case here, or is public on purpose", () => {
    const all = endpointKeys();
    const covered = new Set([...CASES.map((c) => c.key), ...SPECIAL]);
    expect(all.filter((k) => !PUBLIC[k] && !covered.has(k)), "endpoints with no cross-tenant case").toEqual([]);
    expect([...covered].filter((k) => !all.includes(k)), "cases for endpoints that no longer exist").toEqual([]);
    expect(new Set(CASES.map((c) => c.key)).size).toBe(CASES.length);
  });

  for (const c of CASES) {
    it(`${c.key}: refused and nothing of A's read or changed`, async () => {
      if (!ok) return;
      const fx = FX!;
      const p = fx.people;
      // A as it is now; every attempt below is compared with it.
      const before = await fingerprint(fx.A);
      let seen = new Set<string>();
      for (const who of [p.clientB, p.coachB, p.disabledA, p.nobody]) seen = await attempt(c, who, fx.a, true, before);
      // From inside B's own workspace, reaching for A's objects or A's project.
      const objects = OBJECT_KEYS.some((k) => seen.has(k));
      for (const who of [p.clientB, p.coachB]) {
        if (objects) await attempt(c, who, { ...fx.a, tenantId: fx.B, projectId: fx.PB }, false, before);
        if (seen.has("projectId")) await attempt(c, who, { ...fx.a, tenantId: fx.B }, !c.projectEchoed, before);
      }
    });

    it(`${c.key}: positive control, works for ${c.as === "admin" ? "a platform admin" : "A's own client"}`, async () => {
      if (!ok) return;
      const fx = FX!;
      const t = { ...fx.a, ...(c.fresh ? await c.fresh(fx) : {}) };
      const who = c.as === "admin" ? fx.people.admin : fx.people.clientA;
      const before = await fingerprint(fx.A);
      const o = await runAs(who, () => c.call(t));
      const changed = changedParts(before, await fingerprint(fx.A));
      expect(refused(o), `not refused: ${describeOutcome(o)}`).toBe(false);
      expect(o.kind === "error" ? describeOutcome(o) : "no error").toBe("no error");
      if (c.ok) await c.ok(o, changed, fx);
      else expect(changed.length, `A's data should change: ${describeOutcome(o)}`).toBeGreaterThan(0);
    });
  }
});

// ---- endpoints gated by a signed link, not a workspace session ------------------------------------------

const SPECIAL = [
  "src/app/api/storage/[...key]/route.ts#GET",
  "src/app/api/storage/[...key]/route.ts#PUT",
  "src/app/auth/verify/route.ts#GET",
  "src/app/auth/verify/route.ts#POST",
  "src/app/connections/callback/[provider]/route.ts#GET",
  "src/app/settings/connections/[provider]/start/route.ts#GET",
  "src/app/invite/[token]/actions.ts#acceptInviteAction",
  "src/app/q/[token]/actions.ts#submitQuestionnaire",
];

describe("cross-tenant: endpoints opened by a signed link", { timeout: 30_000 }, () => {
  const keyOf = async (tenantId: string) => (await one<{ storage_key: string }>("SELECT storage_key FROM assets WHERE tenant_id=$1 ORDER BY created_at LIMIT 1", [tenantId])).storage_key;
  const keyParams = (key: string) => params({ key: key.split("/").map(encodeURIComponent) });
  const storageReq = (method: string, key: string, q: string, body?: Uint8Array) =>
    new NextRequest(new URL(`/api/storage/${key}?${q}`, getEnv().APP_URL), { method, body: body as BodyInit | undefined, headers: body ? { "content-length": String(body.byteLength) } : {} });

  it("api/storage GET: B's signed link opens B's file only, never A's", async () => {
    if (!ok) return;
    const fx = FX!;
    const aKey = await keyOf(fx.A);
    await newAsset(fx.scopeB);
    const bKey = await keyOf(fx.B);
    const bToken = signKey(bKey, Date.now() + 60_000);
    const before = await fingerprint(fx.A);
    for (const q of [`token=${bToken}`, "token=", `token=${signKey(aKey, Date.now() - 1000)}`]) {
      const o = await runAs(fx.people.clientB, () => storageRoute.GET(storageReq("GET", aKey, q), keyParams(aKey)));
      expect(o.kind === "response" && o.status, describeOutcome(o)).toBe(403);
    }
    expect(changedParts(before, await fingerprint(fx.A))).toEqual([]);
    // Controls: B's link opens B's file; A's link opens A's.
    const b = await runAs(fx.people.clientB, () => storageRoute.GET(storageReq("GET", bKey, `token=${bToken}`), keyParams(bKey)));
    status(200)(b);
    const a = await runAs(fx.people.clientA, () => storageRoute.GET(storageReq("GET", aKey, `token=${signKey(aKey, Date.now() + 60_000)}`), keyParams(aKey)));
    status(200)(a);
  });

  it("api/storage PUT: B's upload token can't write into A's incoming files", async () => {
    if (!ok) return;
    const fx = FX!;
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const bKey = `tenants/${fx.B}/incoming/${RUN}-b.bin`;
    const aKey = fx.a.incomingKey;
    const bToken = signPut(bKey, bytes.byteLength);
    const before = await fingerprint(fx.A);
    const o = await runAs(fx.people.clientB, () => storageRoute.PUT(storageReq("PUT", aKey, `put=${bToken}`, bytes), keyParams(aKey)));
    expect(o.kind === "response" && o.status, describeOutcome(o)).toBe(403);
    expect(changedParts(before, await fingerprint(fx.A))).toEqual([]);
    const control = await runAs(fx.people.clientB, () => storageRoute.PUT(storageReq("PUT", bKey, `put=${bToken}`, bytes), keyParams(bKey)));
    status(204)(control);
  });

  it("auth/verify: a link for someone else, or for A's disabled user, starts no session", async () => {
    if (!ok) return;
    const fx = FX!;
    const lastSeen = async (id: string) => (await getAccount(id))!.lastSeen;
    const disabled = fx.people.disabledA.session!.userId;
    const clientA = fx.people.clientA.session!.userId;
    // B's own valid link with the subject swapped for A's client: the signature no longer matches.
    const [body, sig] = signLink("signin", fx.people.clientB.session!.userId, "").split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const forged = `${Buffer.from(JSON.stringify({ ...payload, s: clientA })).toString("base64url")}.${sig}`;
    const disabledLink = signLink("signin", disabled, await lastSeen(disabled));
    const before = await fingerprint(fx.A);
    for (const token of [forged, disabledLink]) {
      for (const method of ["GET", "POST"] as const) {
        const o = await runAs(fx.people.clientB, async () => {
          const r = method === "GET"
            ? await verify.GET(new NextRequest(new URL(`/auth/verify?token=${encodeURIComponent(token)}`, getEnv().APP_URL)))
            : await verify.POST(new NextRequest(new URL("/auth/verify", getEnv().APP_URL), { method: "POST", body: form({ token }) }));
          // B's person is still B's person: no new session, for A's people or anyone.
          expect(jar.get(SESSION_COOKIE), "no new session").toBe(fx.people.clientB.cookie);
          return r;
        });
        expect(o.kind === "response" ? o.location ?? "" : describeOutcome(o)).toMatch(/\/auth\/(link-expired|disabled)/);
        // The disabled user's own valid link names its own address on the "access is off" page; nothing else.
        if (token === forged) expect(leaksOf(o, fx, [])).toEqual([]);
        else expect(textOf(o).replace(encodeURIComponent(fx.people.disabledA.session!.email), "")).not.toContain(MARK);
      }
    }
    expect(changedParts(before, await fingerprint(fx.A))).toEqual([]);
    // Control: A's client's own link signs them in.
    let started = false;
    const o = await runAs(fx.people.nobody, async () => {
      const r = await verify.POST(new NextRequest(new URL("/auth/verify", getEnv().APP_URL), { method: "POST", body: form({ token: signLink("signin", clientA, await lastSeen(clientA)) }) }));
      started = jar.has(SESSION_COOKIE);
      return r;
    });
    expect(o.kind === "response" && o.status, describeOutcome(o)).toBe(303);
    expect(started).toBe(true);
  });

  it("connections callback: a state signed for A's workspace is refused to B's people", async () => {
    if (!ok) return;
    const fx = FX!;
    const secret = getEnv().AUTH_SECRET;
    // With the oauth nonce cookie, plus the session cookie the jar adds.
    const withSession = (p: Person, state: string, nonce: string) => runAs(p, () => {
      const r = request("GET", "/");
      const cookie = `${r.headers.get("cookie") ?? ""}; huemen_oauth=${encodeURIComponent(JSON.stringify({ n: nonce, v: null }))}`;
      return callback.GET(new Request(new URL(`/connections/callback/google?state=${encodeURIComponent(state)}&code=abc`, getEnv().APP_URL), { headers: { cookie } }), params({ provider: "google" }));
    });
    const before = await fingerprint(fx.A);
    const clientA = fx.people.clientA.session!.userId;
    const coach = fx.people.coachB.session!.userId;
    const cases: [Person, string][] = [
      [fx.people.clientB, clientA], // A's state, B's session
      [fx.people.coachB, coach], // the coach's own state, aimed at A
      [fx.people.disabledA, fx.people.disabledA.session!.userId],
    ];
    for (const [who, u] of cases) {
      const state = encodeState({ t: fx.A, u, p: "google", c: "gmail", n: "nonce-1", r: "settings" }, secret);
      const o = await withSession(who, state, "nonce-1");
      expect(o.kind === "response" && [403, 404].includes(o.status), describeOutcome(o)).toBe(true);
      expect(leaksOf(o, fx, [fx.A, u])).toEqual([]);
    }
    expect(changedParts(before, await fingerprint(fx.A))).toEqual([]);
    // Control: the coach's own state for B passes the gates (then stops at the unconfigured provider, or the code exchange).
    const ownState = encodeState({ t: fx.B, u: coach, p: "google", c: "gmail", n: "nonce-2", r: "settings" }, secret);
    const o = await withSession(fx.people.coachB, ownState, "nonce-2");
    expect(o.kind === "response" && o.status, describeOutcome(o)).toBe(303);
  });

  it("connections start: always for the signed-in person's own workspace, never A's", async () => {
    if (!ok) return;
    const fx = FX!;
    const before = await fingerprint(fx.A);
    for (const who of [fx.people.clientB, fx.people.coachB, fx.people.disabledA, fx.people.nobody]) {
      const o = await runAs(who, () => connStart.GET(request("GET", `/settings/connections/google/start?cap=gmail&t=${fx.A}`), params({ provider: "google" })));
      expect(o.kind, describeOutcome(o)).toBe("response");
      expect((o as { location: string | null }).location ?? "", describeOutcome(o)).not.toContain(fx.A);
      expect(leaksOf(o, fx, [fx.A])).toEqual([]);
    }
    expect(changedParts(before, await fingerprint(fx.A))).toEqual([]);
    const o = await runAs(fx.people.clientA, () => connStart.GET(request("GET", "/settings/connections/google/start?cap=gmail"), params({ provider: "google" })));
    expect(o.kind === "response" && o.status, describeOutcome(o)).toBe(303);
    expect((o as { location: string }).location).not.toContain("/login");
  });

  it("invite: B's person can't accept an invite with a forged or someone else's token", async () => {
    if (!ok) return;
    const fx = FX!;
    const invited = (await one<{ id: string }>("INSERT INTO users (tenant_id, email, role, status) VALUES ($1,$2,'client','invited') RETURNING id", [fx.A, `${MARK}-invited@test.local`])).id;
    const [body] = signLink("invite", invited, "invited").split(".");
    const [, bSig] = signLink("invite", fx.people.clientB.session!.userId, "invited").split(".");
    const before = await fingerprint(fx.A);
    for (const token of [`${body}.${bSig}`, signLink("invite", fx.people.clientA.session!.userId, "invited"), "nonsense"]) {
      let cookie: string | undefined;
      const o = await runAs(fx.people.clientB, async () => {
        try {
          return await invite.acceptInviteAction(form({ token }));
        } finally {
          cookie = jar.get(SESSION_COOKIE);
        }
      });
      expect(o.kind === "redirect" && o.to.startsWith("/invite/"), describeOutcome(o)).toBe(true);
      expect(cookie, "no new session").toBe(fx.people.clientB.cookie);
    }
    expect(changedParts(before, await fingerprint(fx.A))).toEqual([]);
    const o = await runAs(fx.people.nobody, () => invite.acceptInviteAction(form({ token: signLink("invite", invited, "invited") })));
    expect(o.kind === "redirect" && o.to, describeOutcome(o)).toBe(`/w/${fx.A}?welcome=1`);
  });

  it("questionnaire: B's link can't be pointed at A", async () => {
    if (!ok) return;
    const fx = FX!;
    const bToken = signQuestionnaireToken(fx.B);
    const parts = bToken.split(".");
    const forged = [Buffer.from(fx.A).toString("base64url"), ...parts.slice(1)].join(".");
    const forged2 = bToken.replace(fx.B, fx.A);
    const before = await fingerprint(fx.A);
    for (const token of [forged, forged2, "nonsense"]) {
      const o = await runAs(fx.people.clientB, () => questionnaire.submitQuestionnaire(form({ token, niche: "B wrote this", samples: "a post" })));
      expect(o.kind === "error" && /invalid or expired/.test(String((o.error as Error).message)), describeOutcome(o)).toBe(true);
    }
    expect(changedParts(before, await fingerprint(fx.A))).toEqual([]);
    // B's own link writes B's workspace, and only B's.
    const b = await runAs(fx.people.nobody, () => questionnaire.submitQuestionnaire(form({ token: bToken, niche: "B's niche from the form", samples: "A post B wrote." })));
    expect(b.kind === "redirect" && b.to, describeOutcome(b)).toBe(`/q/${bToken}?done=1`);
    expect(changedParts(before, await fingerprint(fx.A))).toEqual([]);
    const a = await runAs(fx.people.nobody, () => questionnaire.submitQuestionnaire(form({ token: signQuestionnaireToken(fx.A), samples: "A post A wrote." })));
    expect(a.kind, describeOutcome(a)).toBe("redirect");
    expect(changedParts(before, await fingerprint(fx.A)).length).toBeGreaterThan(0);
  });
});
