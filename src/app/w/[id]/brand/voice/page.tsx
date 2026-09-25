import { Mic, ScanLine, Quote, Lock, AlertTriangle, CheckCircle2, Trash2, EyeOff, Eye } from "lucide-react";
import { workspaceScope } from "@/lib/auth/workspace";
import { listSamples, listVersions, loadPackForWorkspace } from "@/lib/data/voice-pack";
import { mechanicsLines } from "@/lib/voice/context";
import { corpusLevel, CORPUS_MINIMUM_PIECES, DIAL_LABELS, DIAL_KEYS } from "@/lib/voice/types";
import { PLATFORM_RULES } from "@/lib/voice/platforms";
import { DocPage } from "@/components/doc-page";
import { EmptyState, SubmitButton } from "@/components/ui";
import { BrandCoreCard } from "@/components/composites";
import {
  addSamplesAction, deleteSampleAction, excludeSampleAction, rescanAction,
  resolveSignatureAction, saveVoiceAction,
} from "./actions";

export const metadata = { title: "Voice" };
export const dynamic = "force-dynamic";

const Card = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <section className="bg-paper border border-hairline rounded-[14px] p-5">
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
      className={`label-mono text-[0.6rem] px-1.5 h-5 inline-flex items-center rounded-[4px] ${
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
export default async function VoicePage({ params }: PageProps<"/w/[id]/brand/voice">) {
  const { id } = await params;
  const { scope } = await workspaceScope(id);
  const pack = await loadPackForWorkspace(scope);

  if (!pack) {
    return (
      <DocPage eyebrow="Onboarding · Voice" title="No voice yet." accent="Let's build one." sub="A Voice Pack belongs to a person. Sign in as the person whose brand this is and it will be created for them.">
        <div className="bg-paper border border-hairline rounded-[14px]">
          <EmptyState icon={<Mic size={18} />} title="No pack on file" sub="Voice packs are created for the person whose writing they describe." />
        </div>
      </DocPage>
    );
  }

  const [samples, versions] = await Promise.all([
    listSamples(scope, pack.id, { includeExcluded: true }),
    listVersions(scope, pack.id, 8),
  ]);
  const level = corpusLevel(pack.corpusStats);
  const lines = mechanicsLines(pack);
  const never = pack.index.neverWords.length ? pack.index.neverWords : (pack.redPen.neverList?.value ?? []);
  const contexts = Object.values(pack.contexts);
  const signatures = pack.mechanics.signaturePhrases?.value ?? [];
  const Hidden = () => <input type="hidden" name="tenantId" value={id} />;

  // §15.1 brand core card — the coloured summary of the measured voice.
  const coreAttrs = (pack.identity.toneDescriptors?.value ?? []).slice(0, 5);
  const words = pack.corpusStats.words;
  const coreCard = {
    name: pack.displayName || "Your voice",
    seed: pack.id,
    subtitle: `${pack.corpusStats.channels[0] ? pack.corpusStats.channels.join(", ") + " · " : ""}core v${pack.version}${pack.scannedAt ? ` · measured ${new Date(pack.scannedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}`,
    trained: pack.status !== "provisional" && pack.corpusStats.pieces > 0,
    attributes: coreAttrs,
    confidence: Math.min(96, Math.round((pack.corpusStats.pieces / 13) * 100)),
    stats: [
      { label: "Samples", value: String(pack.corpusStats.pieces) },
      { label: "Words read", value: words >= 1000 ? `${(words / 1000).toFixed(1)}k` : String(words) },
      { label: "Channels", value: String(pack.corpusStats.channels.length) },
    ],
  };

  return (
    <DocPage
      eyebrow="Onboarding · Voice"
      title="How you"
      accent="actually sound."
      sub="Measured from your own writing, not guessed from adjectives. Every number here has a count and a quote behind it, and you can change any of it."
    >
      {/* ---- the brand core: the coloured summary of what was measured ---- */}
      <div className="mb-6"><BrandCoreCard {...coreCard} /></div>
      <div className="flex flex-col gap-5">
        <Card label="01 · Your writing">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[1.6rem] font-medium tabular-nums">{pack.corpusStats.pieces}</span>
            <span className="text-[0.85rem] text-ink-faint">
              {pack.corpusStats.pieces === 1 ? "piece" : "pieces"} · {pack.corpusStats.words.toLocaleString()} words
              {pack.corpusStats.channels.length > 0 && ` · ${pack.corpusStats.channels.join(", ")}`}
            </span>
            <span className="flex-1" />
            <form action={rescanAction}>
              <Hidden />
              <SubmitButton pendingLabel="Measuring…" size="sm" variant="ghost"><ScanLine size={13} /> Re-measure</SubmitButton>
            </form>
          </div>

          {level !== "good" && (
            <p className="mt-3 flex items-start gap-2 text-[0.82rem] text-ink-muted">
              <AlertTriangle size={14} className="text-warn mt-0.5 shrink-0" />
              {level === "empty" || level === "thin"
                ? `Under ${CORPUS_MINIMUM_PIECES} pieces, so this voice is provisional. Paste more and the numbers below stop being guesses.`
                : "Enough to write from. Around 30 pieces is where the rare habits become reliable."}
            </p>
          )}

          <form action={addSamplesAction} className="mt-4 flex flex-col gap-2">
            <Hidden />
            <textarea
              name="text"
              rows={5}
              required
              placeholder={"Paste your writing. Separate each piece with a blank line.\n\nA post keeps its own line breaks — only a blank line starts a new piece."}
              className="field font-[inherit] leading-relaxed"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <select name="channel" className="h-8 rounded-[7px] bg-field px-2 text-[0.78rem]">
                {Object.values(PLATFORM_RULES).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                <option value="unknown">Not sure</option>
              </select>
              <select name="visibility" className="h-8 rounded-[7px] bg-field px-2 text-[0.78rem]" defaultValue="public">
                <option value="public">Public writing</option>
                <option value="private">Private (email, chat)</option>
              </select>
              <SubmitButton pendingLabel="Measuring…" size="sm">Add and measure</SubmitButton>
              <span className="text-[0.72rem] text-ink-faint flex items-center gap-1">
                <Lock size={11} /> Private writing is measured but never quoted in a draft.
              </span>
            </div>
          </form>
        </Card>

        {/* ---- the measured fingerprint ---------------------------------- */}
        <Card label="02 · The fingerprint">
          {lines.length === 0 ? (
            <p className="text-[0.85rem] text-ink-faint">Nothing measured yet. Add some writing above.</p>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <Tag confidence={pack.mechanics.sentences?.confidence} count={pack.mechanics.sentences?.count} />
                {pack.scannedAt && (
                  <span className="text-[0.72rem] text-ink-faint">
                    last measured {new Date(pack.scannedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <ul className="flex flex-col gap-1.5 text-[0.88rem] leading-relaxed">
                {lines.map((l, i) => (
                  <li key={i} className={l.startsWith("  ·") ? "pl-4 text-ink-muted" : ""}>{l}</li>
                ))}
              </ul>
              {(pack.mechanics.punctuation?.evidence ?? []).length > 0 && (
                <div className="mt-4 pt-4 border-t border-hairline">
                  <p className="label-mono text-ink-faint mb-2">Why we think so</p>
                  {(pack.mechanics.punctuation?.evidence ?? []).map((e, i) => (
                    <p key={i} className="flex gap-2 text-[0.82rem] text-ink-muted italic">
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
            <p className="text-[0.82rem] text-ink-muted mb-3">
              A signature or a habit? Keeping one protects it from the anti-AI rules; dropping it adds it to your never-list.
            </p>
            <div className="flex flex-col gap-2">
              {signatures.slice(0, 6).map((s) => (
                <div key={s.phrase} className="flex items-center gap-2 border border-hairline rounded-[10px] px-3 py-2">
                  <span className="flex-1 text-[0.88rem]">&ldquo;{s.phrase}&rdquo;</span>
                  <span className="text-[0.72rem] text-ink-faint tabular-nums">{s.count} pieces</span>
                  <form action={resolveSignatureAction}><Hidden /><input type="hidden" name="phrase" value={s.phrase} /><input type="hidden" name="keep" value="1" />
                    <SubmitButton pendingLabel="…" size="sm" variant="ghost">Keep</SubmitButton>
                  </form>
                  <form action={resolveSignatureAction}><Hidden /><input type="hidden" name="phrase" value={s.phrase} /><input type="hidden" name="keep" value="0" />
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
            <Hidden />
            <div className="flex flex-col gap-4">
              <label className="block">
                <span className="label-mono text-ink-faint">Your voice in one line</span>
                <input name="voiceLine" defaultValue={pack.voiceLine} placeholder="An essayist who finds the big idea in a small moment." className="field mt-1.5" />
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
                <textarea name="hardRules" rows={3} defaultValue={pack.hardRules.join("\n")} placeholder="Never claim a title. Let the reader conclude it." className="field mt-1.5" />
              </label>
              <label className="block">
                <span className="label-mono text-ink-faint">Words you&apos;d never use</span>
                <input name="neverWords" defaultValue={never.join(", ")} placeholder="synergy, hustle, leverage" className="field mt-1.5" />
              </label>
              <div><SubmitButton pendingLabel="Saving…" size="md">Save</SubmitButton></div>
            </div>
          </Card>
        </form>

        {/* ---- per-platform, measured or inferred ------------------------ */}
        <Card label="05 · How you sound in each place">
          {contexts.length === 0 ? (
            <p className="text-[0.85rem] text-ink-faint">Nothing yet. Add writing from a platform and its block appears here.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {contexts.map((c) => (
                <div key={c.channel} className="border border-hairline rounded-[10px] px-3 py-2.5 flex items-center gap-2">
                  <span className="flex-1 text-[0.88rem]">{PLATFORM_RULES[c.channel]?.label ?? c.channel}</span>
                  <span className="text-[0.72rem] text-ink-faint tabular-nums">{c.pieceCount}</span>
                  <Tag confidence={c.tag === "measured" ? "measured" : "inferred"} count={c.pieceCount} />
                </div>
              ))}
            </div>
          )}
          <p className="text-[0.75rem] text-ink-faint mt-3">
            A block is only &ldquo;measured&rdquo; with five real pieces from that platform. Below that we write from your general voice and say so.
          </p>
        </Card>

        {/* ---- the dials, shown only when they've been set ---------------- */}
        {Object.keys(pack.index.dials).length > 0 && (
          <Card label="06 · Dials">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {DIAL_KEYS.filter((k) => pack.index.dials[k] != null).map((k) => (
                <div key={k} className="flex items-center gap-3 text-[0.8rem]">
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
            <p className="text-[0.85rem] text-ink-faint">Nothing yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {samples.map((s) => (
                <div key={s.id} className={`border border-hairline rounded-[10px] p-3 ${s.excluded ? "opacity-45" : ""}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="label-mono text-ink-faint">{PLATFORM_RULES[s.channel]?.label ?? s.channel}</span>
                    {s.visibility === "private" && (
                      <span className="label-mono text-[0.6rem] px-1.5 h-5 inline-flex items-center gap-1 rounded-[4px] bg-field text-ink-faint">
                        <Lock size={9} /> private
                      </span>
                    )}
                    <span className="text-[0.72rem] text-ink-faint tabular-nums">{s.wordCount} words</span>
                    <span className="flex-1" />
                    <form action={excludeSampleAction}>
                      <Hidden />
                      <input type="hidden" name="sampleId" value={s.id} />
                      <input type="hidden" name="excluded" value={s.excluded ? "0" : "1"} />
                      <SubmitButton pendingLabel="…" size="sm" variant="ghost">
                        {s.excluded ? <><Eye size={12} /> Use it</> : <><EyeOff size={12} /> Not mine</>}
                      </SubmitButton>
                    </form>
                    <form action={deleteSampleAction}>
                      <Hidden />
                      <input type="hidden" name="sampleId" value={s.id} />
                      <SubmitButton pendingLabel="…" size="sm" variant="ghost"><Trash2 size={12} /></SubmitButton>
                    </form>
                  </div>
                  <p className="text-[0.85rem] leading-relaxed whitespace-pre-wrap line-clamp-4">{s.body}</p>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ---- history: every save keeps what it replaced ----------------- */}
        <Card label="08 · History">
          <ul className="flex flex-col gap-2 text-[0.82rem]">
            {versions.map((v) => (
              <li key={v.version} className="flex items-center gap-2">
                <CheckCircle2 size={13} className="text-ink-faint shrink-0" />
                <span className="tabular-nums text-ink-faint w-8">v{v.version}</span>
                <span className="flex-1">{v.note ?? "Saved"}</span>
                <span className="text-ink-faint">{new Date(v.createdAt).toLocaleString()}</span>
              </li>
            ))}
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
