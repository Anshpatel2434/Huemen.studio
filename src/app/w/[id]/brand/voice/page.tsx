import { Mic, ScanLine, Quote, Lock, AlertTriangle, CheckCircle2, Circle, Trash2, EyeOff, Eye, Download } from "lucide-react";
import { workspaceScope } from "@/lib/auth/workspace";
import { listSamples, listVersions, loadPackForWorkspace, previewRescan } from "@/lib/data/voice-pack";
import { coreState, diffPacks, rescanDue } from "@/lib/voice/lifecycle";
import { CoreWatcher } from "@/components/core-watcher";
import { mechanicsLines } from "@/lib/voice/context";
import { corpusLevel, CORPUS_MINIMUM_PIECES, DIAL_LABELS, DIAL_KEYS } from "@/lib/voice/types";
import { PLATFORM_RULES } from "@/lib/voice/platforms";
import { DocPage } from "@/components/doc-page";
import { btnClass } from "@/components/btn";
import { EmptyState, SubmitButton, Alert } from "@/components/ui";
import Link from "next/link";
import { BrandCoreCard } from "@/components/composites";
import { coreCardFacts } from "@/lib/voice/core-card";
import { confidence, deriveHardRules, deriveSelfCheck, readyChecklist, skipDeep, suggestVoiceLine, voiceMeter } from "@/lib/voice/derive";
import { nextDeepQuestions, QUESTIONS } from "@/lib/voice/questions";
import { VOICE_FILES } from "@/lib/voice/export";
import { approvedPieceCount, approvedSince, listEditProposals, listProposals, ownsVoice } from "@/lib/data/training";
import { QuestionField } from "../../onboarding/steps";
import {
  addSamplesAction, decideEditAction, decidePatternAction, decideProposalAction, deleteSampleAction, excludeSampleAction, previewRescanAction, rescanAction,
  resolveSignatureAction, restoreVersionAction, saveSelfCheckAction, saveVoiceAction, setAntiSampleAction, setBenchmarkNoteAction,
} from "./actions";
import { patternsFor } from "@/lib/data/patterns";
import { learningLog } from "@/lib/data/learning";
import { LEARN_MIN_EDIT, RELEARN_EVERY } from "@/lib/voice/learn";

export const metadata = { title: "Voice" };
export const dynamic = "force-dynamic";

const Card = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <section className="border-t border-hairline pt-6">
    <p className="label-mono text-ink-faint mb-3">{label}</p>
    {children}
  </section>
);

/** Where a value came from. The spec's rule: no trait without its evidence. */
function Tag({ confidence, count }: { confidence?: string; count?: number }) {
  if (!confidence) return null;
  const measured = confidence === "measured";
  return (
    <span
      className={`label-mono px-1.5 h-5 inline-flex items-center rounded-xs ${
        measured ? "bg-ok-soft text-ok" : "bg-field text-ink-faint"
      }`}
      title={measured ? `Measured across ${count ?? 0} pieces of your writing` : "Not measured — you told us, or we inferred it"}
    >
      {measured ? `measured · ${count ?? 0}` : confidence}
    </span>
  );
}

/**
 * The Voice Pack, as editable cards rather than eight markdown files.
 *
 * The spec chose markdown partly so a person can open and edit their own voice.
 * Our interface is a canvas, not a file browser, so every file becomes a card —
 * and every measured value shows its count and the quote behind it, which is
 * the part that makes the difference between a voice file that works and one
 * that just asserts things.
 */
export default async function VoicePage({ params, searchParams }: PageProps<"/w/[id]/brand/voice">) {
  const { id } = await params;
  const sp = await searchParams;
  const { session, scope } = await workspaceScope(id);
  const pack = await loadPackForWorkspace(scope);

  if (!pack) {
    return (
      <DocPage eyebrow="Brand core · Voice" title="No voice yet." accent="Let's build one." sub="A Voice Pack belongs to a person. Sign in as the person whose brand this is and it will be created for them.">
        <div className="border-y border-hairline">
          <EmptyState icon={<Mic size={18} />} title="No pack on file" sub="Voice packs are created for the person whose writing they describe." />
        </div>
      </DocPage>
    );
  }

  const [samples, versions, proposals, learned, approved, sinceScan, preview, studio] = await Promise.all([
    listSamples(scope, pack.id, { includeExcluded: true }),
    listVersions(scope, pack.id, 8),
    listProposals(scope, pack.id),
    listEditProposals(scope, pack.id),
    approvedPieceCount(scope),
    approvedSince(scope, pack.scannedAt),
    sp.preview ? previewRescan(scope, pack.id) : Promise.resolve(null),
    learningLog(scope, pack.id),
  ]);
  const now = await requestTime();
  const state = coreState(pack, now);
  const due = rescanDue(pack, sinceScan, now);
  // Each saved version is the state a change replaced; diff it against the
  // state that came after (the next version, or now).
  const changedFrom = (i: number) => diffPacks(versions[i].snapshot, i === 0 ? pack : versions[i - 1].snapshot);
  const owner = ownsVoice({ userId: session.userId, role: session.role }, pack);
  const conf = confidence(pack);
  const deep = nextDeepQuestions(pack.onboarding.answered ?? [], approved, 3, skipDeep(pack));
  const moved = ([] as string[]).concat(sp.moved ?? []);
  const level = corpusLevel(pack.corpusStats);
  const lines = mechanicsLines(pack);
  const never = pack.index.neverWords.length ? pack.index.neverWords : (pack.redPen.neverList?.value ?? []);
  const contexts = Object.values(pack.contexts);
  const signatures = pack.mechanics.signaturePhrases?.value ?? [];
  // Across sources: phrases they use in more than one place, said publicly at least once.
  const noticed = await patternsFor(scope, pack, samples);

  // §15.1 brand core card — the coloured summary of the measured voice.
  const coreCard = coreCardFacts(pack, now);

  // The meter (Core = 70%, Deep fills the rest) and what "ready to write" still needs.
  const meter = voiceMeter(pack, QUESTIONS.filter((q) => q.tier === "deep").length);
  const ready = readyChecklist(pack, CORPUS_MINIMUM_PIECES);
  const benchmarks = samples.filter((s) => s.kind === "benchmark" && s.visibility === "public");
  const notes = pack.onboarding.benchmarkNotes ?? {};
  const anti = pack.onboarding.antiSample;
  // Candidates for the anti-sample: public pieces that aren't benchmarks. Quoted in prompts, so never private.
  const antiPool = samples.filter((s) => s.visibility === "public" && s.kind !== "benchmark" && (!s.excluded || s.id === anti?.sampleId)).slice(0, 8);
  const selfCheck = pack.redPen.selfCheck?.value?.length ? pack.redPen.selfCheck.value : deriveSelfCheck(pack);
  const suggestedLine = pack.voiceLine.trim() ? "" : suggestVoiceLine(pack);
  const rules = pack.hardRules.length ? pack.hardRules : deriveHardRules(pack);

  return (
    <DocPage
      eyebrow="Brand core · Voice"
      title="How you"
      accent="actually sound."
      sub="Measured from your own writing, not guessed from adjectives. Every number here has a count and a quote behind it, and you can change any of it."
    >
      {/* ---- the brand core: the coloured summary of what was measured ---- */}
      <div className="mb-6 flex flex-col gap-3"><BrandCoreCard {...coreCard} /><CoreWatcher state={state} pieces={pack.corpusStats.pieces} /></div>
      <div className="flex flex-col gap-5">
        {due.due && !preview && (
          <Alert tone="info" action={<form action={previewRescanAction}><Hidden id={id} /><SubmitButton pendingLabel="Measuring…" size="sm" variant="secondary">See what would change</SubmitButton></form>}>
            It&apos;s been {due.days} days since we measured your writing, and you&apos;ve approved {sinceScan} new {sinceScan === 1 ? "piece" : "pieces"} since. Worth a fresh look?
          </Alert>
        )}
        {preview && (
          <div id="remeasure" role="status" className="text-sm bg-field rounded-md px-4 py-3 flex flex-col gap-2">
            <p className="font-medium">{preview.length ? "If we re-measure now:" : "Re-measuring now would change nothing."}</p>
            {preview.length > 0 && <ul className="flex flex-col gap-0.5 text-ink-muted">{preview.map((m) => <li key={m}>{m}</li>)}</ul>}
            <p className="text-xs text-ink-faint">Only what was measured changes. Anything you typed or decided stays yours.</p>
            <div className="flex flex-wrap gap-2">
              {preview.length > 0 && (
                <form action={rescanAction}><Hidden id={id} /><SubmitButton pendingLabel="Applying…" size="sm">Apply</SubmitButton></form>
              )}
              <a href={`/w/${id}/brand/voice`} className={btnClass("ghost", "sm")}>{preview.length ? "Keep it as it is" : "Close"}</a>
            </div>
          </div>
        )}
        {sp.proposed && (
          <p role="status" className="text-sm bg-field rounded-md px-4 py-3">Sent to {pack.displayName || "the owner"} to approve. It&apos;s their voice, so a coach&apos;s change waits for a yes.</p>
        )}
        {sp.scanned && (
          <div role="status" className="text-sm bg-field rounded-md px-4 py-3">
            <p className="font-medium">{moved.length ? "Re-measured. What moved:" : "Re-measured. Nothing moved."}</p>
            {moved.length > 0 && <ul className="mt-1.5 flex flex-col gap-0.5 text-ink-muted">{moved.map((m) => <li key={m}>{m}</li>)}</ul>}
          </div>
        )}

        {conf.score < 70 && (
          <Alert tone="warning" title={`${conf.score}% confident, so still learning`}>
            {conf.missing.slice(0, 2).map((m) => `${m}.`).join(" ")}{" "}
            {!pack.onboarding.completedAt && <Link href={`/w/${id}/onboarding`}>Carry on setting up</Link>}
          </Alert>
        )}

        <Card label="Ready to write">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xl font-medium tabular-nums">{meter.score}%</span>
            <span className="flex-1 h-1.5 bg-field rounded-full overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter.score} aria-label="How complete your voice is">
              <span className="block h-full bg-ink rounded-full" style={{ width: `${meter.score}%` }} />
            </span>
            <span className="text-xs text-ink-faint tabular-nums">core {meter.coreDone}/{meter.coreTotal}</span>
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {ready.map((r) => (
              <li key={r.label} className={`flex items-start gap-2 ${r.done ? "text-ink-muted" : ""}`}>
                {r.done ? <CheckCircle2 size={14} className="text-ok mt-0.5 shrink-0" /> : <Circle size={14} className="text-ink-faint mt-0.5 shrink-0" />}
                {r.label}
              </li>
            ))}
          </ul>
          <div className="mt-4 pt-3 border-t border-hairline flex flex-wrap items-center gap-2">
            <span className="label-mono text-ink-faint mr-1">Download</span>
            <a href={`/w/${id}/brand/voice/export`} className={btnClass("secondary", "sm")}><Download size={12} /> Whole pack</a>
            {VOICE_FILES.map((f) => (
              <a key={f} href={`/w/${id}/brand/voice/export?file=${encodeURIComponent(f)}`} className={btnClass("ghost", "sm")}>{f}</a>
            ))}
          </div>
          <p className="text-xs text-ink-faint mt-2">The same pack, as the eight files. Private writing is counted in them, never included.</p>
        </Card>

        {(proposals.length > 0 || learned.length > 0) && (
          <Card label="Waiting for a decision">
            <div className="flex flex-col gap-2">
              {proposals.map((p) => (
                <div key={p.id} className="border border-hairline rounded-md px-3 py-2.5 flex flex-wrap items-center gap-2">
                  <span className="flex-1 min-w-0 text-sm">
                    {p.note ?? "A change"} <span className="text-ink-faint">· from {p.proposedBy ?? "a coach"} · {p.fields.join(", ")}</span>
                  </span>
                  {owner ? (
                    <>
                      <form action={decideProposalAction}><Hidden id={id} /><input type="hidden" name="proposalId" value={p.id} /><input type="hidden" name="approve" value="1" />
                        <SubmitButton pendingLabel="…" size="sm">Approve</SubmitButton>
                      </form>
                      <form action={decideProposalAction}><Hidden id={id} /><input type="hidden" name="proposalId" value={p.id} /><input type="hidden" name="approve" value="0" />
                        <SubmitButton pendingLabel="…" size="sm" variant="ghost">Reject</SubmitButton>
                      </form>
                    </>
                  ) : (
                    <span className="label-mono text-ink-faint">Waiting for the owner</span>
                  )}
                </div>
              ))}
              {learned.map((l) => (
                <div key={l.id} className="border border-hairline rounded-md px-3 py-2.5 flex flex-wrap items-center gap-2">
                  <span className="flex-1 min-w-0 text-sm">
                    You&apos;ve cut &ldquo;{l.value}&rdquo; from {l.count} drafts. Never use it?
                  </span>
                  <form action={decideEditAction}><Hidden id={id} /><input type="hidden" name="signalId" value={l.id} /><input type="hidden" name="accept" value="1" />
                    <SubmitButton pendingLabel="…" size="sm">Add to never-list</SubmitButton>
                  </form>
                  <form action={decideEditAction}><Hidden id={id} /><input type="hidden" name="signalId" value={l.id} /><input type="hidden" name="accept" value="0" />
                    <SubmitButton pendingLabel="…" size="sm" variant="ghost">It was a one-off</SubmitButton>
                  </form>
                </div>
              ))}
            </div>
          </Card>
        )}

        {deep.length > 0 && (
          <Card label="A few deeper questions">
            <p className="text-sm text-ink-muted mb-3">
              You&apos;ve approved {approved} {approved === 1 ? "piece" : "pieces"}. These are the next few that sharpen your voice. Answer any, skip the rest.
            </p>
            <div className="flex flex-col gap-4">
              {deep.map((q) => (
                <QuestionField key={q.id} tenantId={id} q={q} keys={q.id === "C7" ? (pack.identity.personalityWords?.value ?? []).map((w) => w.word) : undefined} />
              ))}
            </div>
          </Card>
        )}
        {noticed.everywhere.length > 0 && (
          <div id="noticed">
            <Card label="What we noticed">
              <p className="text-[0.82rem] text-ink-muted mb-3">
                Phrases you use across your writing, in more than one place. Keep what&apos;s really you; anything you say no to won&apos;t come back.
              </p>
              <div className="flex flex-col gap-2">
                {noticed.everywhere.map((e) => (
                  <div key={e.phrase} className="border border-hairline rounded-[10px] px-3 py-2.5 flex flex-wrap items-center gap-2">
                    <span className="flex-1 min-w-0 text-[0.88rem]">
                      &ldquo;{e.phrase}&rdquo;{" "}
                      <span className="text-ink-faint">· {e.pieces} pieces across {e.channels.map((c) => PLATFORM_RULES[c]?.label ?? c).join(", ")}</span>
                    </span>
                    {owner && (
                      <>
                        <form action={decidePatternAction}><Hidden id={id} /><input type="hidden" name="value" value={e.phrase} /><input type="hidden" name="keep" value="1" />
                          <SubmitButton pendingLabel="…" size="sm">Keep it</SubmitButton>
                        </form>
                        <form action={decidePatternAction}><Hidden id={id} /><input type="hidden" name="value" value={e.phrase} /><input type="hidden" name="keep" value="0" />
                          <SubmitButton pendingLabel="…" size="sm" variant="ghost">Not me</SubmitButton>
                        </form>
                      </>
                    )}
                  </div>
                ))}
                <p className="text-[0.75rem] text-ink-faint">Only phrases you&apos;ve also said publicly are shown. Kept phrases become signature phrases: drafts use one now and then, never in every piece.</p>
              </div>
            </Card>
          </div>
        )}

        {/* The voice keeps learning from use (lib/voice/learn): approvals in your own words feed it. */}
        <Card label="Learning from you">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-muted max-w-[68ch]">
              When you approve a piece you wrote, or rewrote at least {Math.round(LEARN_MIN_EDIT * 100)}% of, it joins your writing here and every {RELEARN_EVERY} such pieces your voice re-measures itself. Drafts approved as written don&apos;t count, so the voice never learns its own habits. A coach&apos;s approvals don&apos;t count either: only your words teach your voice.
            </p>
            {studio.total === 0 ? (
              <p className="text-sm text-ink-faint">Nothing learned from the studio yet. Edit a draft until it sounds like you, then approve it.</p>
            ) : (
              <>
                <p className="text-sm"><span className="num font-medium">{studio.total}</span> {studio.total === 1 ? "piece" : "pieces"} learned from the studio</p>
                <ul className="flex flex-col divide-y divide-[var(--hairline)] border-y border-hairline">
                  {studio.pieces.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 py-2.5 text-sm">
                      <span className="flex-1 min-w-0 truncate">{p.excerpt}</span>
                      <span className="text-xs text-ink-faint num shrink-0">{p.words} words · {new Date(p.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </Card>

        <Card label="01 · Your writing">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xl font-medium tabular-nums">{pack.corpusStats.pieces}</span>
            <span className="text-sm text-ink-faint">
              {pack.corpusStats.pieces === 1 ? "piece" : "pieces"} · {pack.corpusStats.words.toLocaleString()} words
              {pack.corpusStats.channels.length > 0 && ` · ${pack.corpusStats.channels.join(", ")}`}
            </span>
            <span className="flex-1" />
            <form action={previewRescanAction}>
              <Hidden id={id} />
              <SubmitButton pendingLabel="Measuring…" size="sm" variant="ghost"><ScanLine size={13} /> Re-measure</SubmitButton>
            </form>
          </div>

          {level !== "good" && (
            <p className="mt-3 flex items-start gap-2 text-sm text-ink-muted">
              <AlertTriangle size={14} className="text-warn mt-0.5 shrink-0" />
              {level === "empty" || level === "thin"
                ? `Under ${CORPUS_MINIMUM_PIECES} pieces, so this voice is provisional. Paste more and the numbers below stop being guesses.`
                : "Enough to write from. Around 30 pieces is where the rare habits become reliable."}
            </p>
          )}

          <form action={addSamplesAction} className="mt-4 flex flex-col gap-2">
            <Hidden id={id} />
            <textarea
              name="text"
              rows={5}
              required
              placeholder={"Paste your writing. Put a line with --- between pieces.\n\nA post keeps its own paragraphs: a single blank line never splits it."}
              className="field font-[inherit] leading-relaxed"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <select name="channel" aria-label="Channel">
                {Object.values(PLATFORM_RULES).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                <option value="unknown">Not sure</option>
              </select>
              <select name="visibility" aria-label="Who can see it" defaultValue="public">
                <option value="public">Public writing</option>
                <option value="private">Private (email, chat)</option>
              </select>
              <SubmitButton pendingLabel="Measuring…" size="sm">Add and measure</SubmitButton>
              <span className="text-xs text-ink-faint flex items-center gap-1">
                <Lock size={11} /> Private writing is measured but never quoted in a draft.
              </span>
            </div>
          </form>
        </Card>

        {/* ---- the measured fingerprint ---------------------------------- */}
        <Card label="02 · The fingerprint">
          {lines.length === 0 ? (
            <p className="text-sm text-ink-faint">Nothing measured yet. Add some writing above.</p>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <Tag confidence={pack.mechanics.sentences?.confidence} count={pack.mechanics.sentences?.count} />
                {pack.scannedAt && (
                  <span className="text-xs text-ink-faint">
                    last measured {new Date(pack.scannedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <ul className="flex flex-col gap-1.5 text-sm leading-relaxed">
                {lines.map((l, i) => (
                  <li key={i} className={l.startsWith("  ·") ? "pl-4 text-ink-muted" : ""}>{l}</li>
                ))}
              </ul>
              {(pack.mechanics.punctuation?.evidence ?? []).length > 0 && (
                <div className="mt-4 pt-4 border-t border-hairline">
                  <p className="label-mono text-ink-faint mb-2">Why we think so</p>
                  {(pack.mechanics.punctuation?.evidence ?? []).map((e, i) => (
                    <p key={i} className="flex gap-2 text-sm text-ink-muted italic">
                      <Quote size={12} className="mt-1 shrink-0 text-ink-faint" />
                      {e.quote}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </Card>

        {/* ---- signature phrases: keep or drop --------------------------- */}
        {signatures.length > 0 && (
          <Card label="03 · Phrases you repeat">
            <p className="text-sm text-ink-muted mb-3">
              A signature or a habit? Keeping one protects it from the anti-AI rules; dropping it adds it to your never-list.
            </p>
            <div className="flex flex-col gap-2">
              {signatures.slice(0, 6).map((s) => (
                <div key={s.phrase} className="flex items-center gap-2 border border-hairline rounded-md px-3 py-2">
                  <span className="flex-1 text-sm">&ldquo;{s.phrase}&rdquo;</span>
                  <span className="text-xs text-ink-faint tabular-nums">{s.count} pieces</span>
                  <form action={resolveSignatureAction}><Hidden id={id} /><input type="hidden" name="phrase" value={s.phrase} /><input type="hidden" name="keep" value="1" />
                    <SubmitButton pendingLabel="…" size="sm" variant="ghost">Keep</SubmitButton>
                  </form>
                  <form action={resolveSignatureAction}><Hidden id={id} /><input type="hidden" name="phrase" value={s.phrase} /><input type="hidden" name="keep" value="0" />
                    <SubmitButton pendingLabel="…" size="sm" variant="ghost">Drop</SubmitButton>
                  </form>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ---- the parts a person writes themselves ---------------------- */}
        <form action={saveVoiceAction}>
          <Card label="04 · In your words">
            <Hidden id={id} />
            <div className="flex flex-col gap-4">
              <label className="block">
                <span className="label-mono text-ink-faint">Your voice in one line</span>
                <input name="voiceLine" defaultValue={pack.voiceLine || suggestedLine} placeholder="An essayist who finds the big idea in a small moment." className="field mt-1.5" />
                {suggestedLine && <span className="block text-xs text-ink-faint mt-1">Suggested from your answers. Rewrite it in your words, or save it as it is.</span>}
              </label>
              <label className="block">
                <span className="label-mono text-ink-faint">The one reader you picture</span>
                <input name="reader" defaultValue={pack.identity.reader?.value ?? ""} placeholder="A newly promoted engineering manager, on a Tuesday afternoon, avoiding a hard conversation." className="field mt-1.5" />
              </label>
              <label className="block">
                <span className="label-mono text-ink-faint">The one idea every piece carries</span>
                <input name="carries" defaultValue={pack.identity.carries?.value ?? ""} placeholder="Most brand problems are not brand problems. They are clarity problems." className="field mt-1.5" />
              </label>
              <label className="block">
                <span className="label-mono text-ink-faint">Hard rules — one per line. These beat every other instruction.</span>
                <textarea name="hardRules" rows={3} defaultValue={rules.join("\n")} placeholder="Never claim a title. Let the reader conclude it." className="field mt-1.5" />
                {!pack.hardRules.length && <span className="block text-xs text-ink-faint mt-1">Drafted from your lines and habits. The facts rule always stays one of the three.</span>}
              </label>
              <label className="block">
                <span className="label-mono text-ink-faint">Words you&apos;d never use</span>
                <input name="neverWords" defaultValue={never.join(", ")} placeholder="synergy, hustle, leverage" className="field mt-1.5" />
              </label>
              <div><SubmitButton pendingLabel="Saving…" size="md">Save</SubmitButton></div>
            </div>
          </Card>
        </form>

        {/* ---- G3: why these three are them ------------------------------ */}
        {benchmarks.length > 0 && (
          <Card label="Your benchmarks · why they're you">
            <p className="text-sm text-ink-muted mb-3">We drafted a line for each from what the piece does. Put it in your words: drafts are matched against these.</p>
            <div className="flex flex-col gap-3">
              {benchmarks.map((b) => (
                <form key={b.id} action={setBenchmarkNoteAction} className="border border-hairline rounded-md p-3 flex flex-col gap-2">
                  <Hidden id={id} /><input type="hidden" name="sampleId" value={b.id} />
                  <div className="flex items-center gap-2">
                    <span className="label-mono text-ink-faint">{PLATFORM_RULES[b.channel]?.label ?? b.channel}</span>
                    {notes[b.id]?.confirmed && <span className="label-mono px-1.5 h-5 inline-flex items-center rounded-xs bg-ok-soft text-ok">confirmed</span>}
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap line-clamp-3 text-ink-muted">{b.body}</p>
                  <textarea name="note" rows={2} defaultValue={notes[b.id]?.note ?? ""} placeholder="What makes this one unmistakably you?" className="field font-[inherit]" readOnly={!owner} />
                  {owner && <div><SubmitButton pendingLabel="Saving…" size="sm" variant={notes[b.id]?.confirmed ? "ghost" : "secondary"}>{notes[b.id]?.confirmed ? "Update" : "That's it"}</SubmitButton></div>}
                </form>
              ))}
            </div>
          </Card>
        )}

        {/* ---- G4: the one that isn't them ------------------------------- */}
        {(anti || (owner && antiPool.length > 0)) && (
          <Card label="The one that isn't you">
            {anti && (
              <div className="mb-4 border border-hairline rounded-md p-3 text-sm flex flex-col gap-1.5">
                <p className="whitespace-pre-wrap line-clamp-3 text-ink-muted">{anti.text}</p>
                <p><span className="text-ink-faint">What&apos;s off:</span> {anti.off}</p>
                {anti.fixed && <p><span className="text-ink-faint">How you&apos;d write it:</span> {anti.fixed}</p>}
              </div>
            )}
            {owner && antiPool.length > 0 && (
              <details open={!anti}>
                <summary className="cursor-pointer min-h-11 flex items-center text-sm text-ink-muted">{anti ? "Pick a different one" : "Pick a piece that sounds almost like you, but not quite"}</summary>
                <form action={setAntiSampleAction} className="flex flex-col gap-2 pt-1">
                  <Hidden id={id} />
                  <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Piece">
                    {antiPool.map((s, i) => (
                      <label key={s.id} className="border border-hairline rounded-md px-3 py-2 text-sm cursor-pointer has-[:checked]:border-ink has-[:checked]:bg-field has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink">
                        <input type="radio" name="sampleId" value={s.id} required defaultChecked={s.id === anti?.sampleId || (!anti && i === 0)} className="sr-only" />
                        <span className="label-mono text-ink-faint mr-2">{PLATFORM_RULES[s.channel]?.label ?? s.channel}</span>
                        <span className="line-clamp-2">{s.body}</span>
                      </label>
                    ))}
                  </div>
                  <input name="off" required placeholder="What's off about it? (too salesy, too formal, not how I'd open)" className="field" />
                  <textarea name="fixed" rows={2} placeholder="Optional: the first line, the way you'd actually write it" className="field font-[inherit]" />
                  <p className="text-xs text-ink-faint">It stops shaping your measured voice, and drafts are told to avoid exactly this.</p>
                  <div><SubmitButton pendingLabel="Saving…" size="sm">Save</SubmitButton></div>
                </form>
              </details>
            )}
          </Card>
        )}

        {/* ---- the red-pen self-check ------------------------------------ */}
        <form action={saveSelfCheckAction}>
          <Card label="Self-check · run on every draft">
            <Hidden id={id} />
            <p className="text-sm text-ink-muted mb-2">
              {pack.redPen.selfCheck?.value?.length ? "Your questions." : "Drafted from your measurements. Edit any line, add your own, or clear it to go back to the drafted list."}
            </p>
            <textarea name="selfCheck" rows={Math.min(10, selfCheck.length + 1)} defaultValue={selfCheck.join("\n")} className="field font-[inherit] leading-relaxed" />
            <div className="mt-2"><SubmitButton pendingLabel="Saving…" size="sm" variant="secondary">Save self-check</SubmitButton></div>
          </Card>
        </form>

        {/* ---- per-platform, measured or inferred ------------------------ */}
        <Card label="05 · How you sound in each place">
          {contexts.length === 0 ? (
            <p className="text-sm text-ink-faint">Nothing yet. Add writing from a platform and its block appears here.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {contexts.map((c) => (
                <div key={c.channel} className="border border-hairline rounded-md px-3 py-2.5 flex items-center gap-2">
                  <span className="flex-1 text-sm">{PLATFORM_RULES[c.channel]?.label ?? c.channel}</span>
                  <span className="text-xs text-ink-faint tabular-nums">{c.pieceCount}</span>
                  <Tag confidence={c.tag === "measured" ? "measured" : "inferred"} count={c.pieceCount} />
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-ink-faint mt-3">
            A block is only &ldquo;measured&rdquo; with five real pieces from that platform. Below that we write from your general voice and say so.
          </p>
        </Card>

        {/* ---- the dials, shown only when they've been set ---------------- */}
        {Object.keys(pack.index.dials).length > 0 && (
          <Card label="06 · Dials">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {DIAL_KEYS.filter((k) => pack.index.dials[k] != null).map((k) => (
                <div key={k} className="flex items-center gap-3 text-sm">
                  <span className="w-24 text-right text-ink-faint">{DIAL_LABELS[k][0]}</span>
                  <span className="flex-1 h-1 bg-field rounded-full relative">
                    <span className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-ink" style={{ left: `${((pack.index.dials[k]! - 1) / 9) * 100}%` }} />
                  </span>
                  <span className="w-24 text-ink-faint">{DIAL_LABELS[k][1]}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ---- the corpus itself ----------------------------------------- */}
        <Card label={`07 · On file · ${samples.length}`}>
          {samples.length === 0 ? (
            <p className="text-sm text-ink-faint">Nothing yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {samples.map((s) => (
                <div key={s.id} className={`border border-hairline rounded-md p-3 ${s.excluded ? "opacity-45" : ""}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="label-mono text-ink-faint">{PLATFORM_RULES[s.channel]?.label ?? s.channel}</span>
                    {s.visibility === "private" && (
                      <span className="label-mono px-1.5 h-5 inline-flex items-center gap-1 rounded-xs bg-field text-ink-faint">
                        <Lock size={9} /> private
                      </span>
                    )}
                    <span className="text-xs text-ink-faint tabular-nums">{s.wordCount} words</span>
                    <span className="flex-1" />
                    <form action={excludeSampleAction}>
                      <Hidden id={id} />
                      <input type="hidden" name="sampleId" value={s.id} />
                      <input type="hidden" name="excluded" value={s.excluded ? "0" : "1"} />
                      <SubmitButton pendingLabel="…" size="sm" variant="ghost">
                        {s.excluded ? <><Eye size={12} /> Use it</> : <><EyeOff size={12} /> Not mine</>}
                      </SubmitButton>
                    </form>
                    <form action={deleteSampleAction}>
                      <Hidden id={id} />
                      <input type="hidden" name="sampleId" value={s.id} />
                      <SubmitButton pendingLabel="…" size="sm" variant="ghost"><Trash2 size={12} /></SubmitButton>
                    </form>
                  </div>
                  {s.visibility === "private" && !owner ? (
                    <p className="text-sm text-ink-faint italic">Private writing. Measured, but only its owner can read it.</p>
                  ) : (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap line-clamp-4">{s.body}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ---- history: every save keeps what it replaced ----------------- */}
        <Card label="08 · History">
          <ul className="flex flex-col gap-2 text-sm">
            {versions.map((v, i) => {
              const changed = changedFrom(i);
              const back = diffPacks(pack, v.snapshot);
              return (
                <li key={v.version} className="flex flex-col gap-1 border-b border-hairline pb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CheckCircle2 size={13} className="text-ink-faint shrink-0" />
                    <span className="tabular-nums text-ink-faint w-14">v{v.version} → v{i === 0 ? pack.version : versions[i - 1].version}</span>
                    <span className="flex-1 min-w-0">{v.note ?? "Saved"}</span>
                    <span className="text-ink-faint">{new Date(v.createdAt).toLocaleString()}</span>
                  </div>
                  {changed.length > 0 && (
                    <ul className="pl-6 text-ink-muted flex flex-col gap-0.5">{changed.slice(0, 6).map((c) => <li key={c}>{c}</li>)}</ul>
                  )}
                  <details className="pl-6">
                    <summary className="cursor-pointer min-h-11 flex items-center text-ink-faint">Restore v{v.version}</summary>
                    <div className="flex flex-col gap-2 pt-1">
                      {back.length ? (
                        <>
                          <p className="text-ink-muted">Restoring brings back:</p>
                          <ul className="flex flex-col gap-0.5 text-ink-muted">{back.slice(0, 8).map((c) => <li key={c}>{c}</li>)}</ul>
                        </>
                      ) : (
                        <p className="text-ink-muted">Nothing you decided differs from now.</p>
                      )}
                      <form action={restoreVersionAction}><Hidden id={id} /><input type="hidden" name="version" value={v.version} />
                        <SubmitButton pendingLabel="Restoring…" size="sm" variant="secondary">Restore this version</SubmitButton>
                      </form>
                    </div>
                  </details>
                </li>
              );
            })}
            <li className="flex items-center gap-2 font-medium">
              <CheckCircle2 size={13} className="text-ok shrink-0" />
              <span className="tabular-nums text-ink-faint w-8">v{pack.version}</span>
              <span className="flex-1">Now</span>
            </li>
          </ul>
        </Card>
      </div>
    </DocPage>
  );
}

/** The workspace every form on this page acts in. */
function Hidden({ id }: { id: string }) {
  return <input type="hidden" name="tenantId" value={id} />;
}

/** One clock for the whole render, read outside it (render stays pure). */
async function requestTime(): Promise<number> {
  return Date.now();
}
