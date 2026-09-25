"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUp, Briefcase, Mic, Rocket, GraduationCap, Check, CircleDashed } from "lucide-react";
import { useFormStatus } from "react-dom";
import { AgentDots } from "@/components/ui";
import { useDraftPersist, clearDraft } from "@/components/persist";
import { parseIntake } from "@/lib/intake/parse";
import { submitIntakeAction } from "../brief/actions";

const FIELD_LABELS: Record<string, string> = {
  niche: "Niche", positioning: "Positioning", audience: "Audience", offers: "Offers",
  tone: "Tone", doWords: "Do-words", dontWords: "Don't-words", readingLevel: "Reading level",
  samplePosts: "Sample posts", palette: "Palette", fonts: "Fonts", imageStyleNotes: "Image style",
  ch0: "Story · origin", ch1: "Story · turning point", ch2: "Story · now",
};

const EXAMPLES: { label: string; icon: typeof Mic; text: string }[] = [
  {
    label: "Coach", icon: GraduationCap,
    text: `Niche: Leadership coaching for first-time managers
Positioning: I help new managers stop firefighting and start leading, in 90 days.
Audience: Engineers and designers promoted into their first management role at 50–500 person companies.
Offers: 1:1 coaching (3 months), a 6-week cohort, team workshops.
Origin: I was promoted to manager at 26 and nearly burned out my team.
Turning point: A mentor made me write down every decision I avoided for a month.
Now: I coach 40+ managers a year and run the "First 90 Days" cohort.
Tone: direct, warm, practical
Do words: clarity, ownership, trade-off
Don't words: synergy, hustle, leverage
Palette: #0A0A0A, #FFFFFF, #F4F4F4
Image style: Candid, natural light, real offices. No stock handshakes.`,
  },
  {
    label: "Consultant", icon: Briefcase,
    text: `Niche: Pricing strategy for B2B SaaS
Positioning: I help founders raise prices without losing customers.
Audience: Seed to Series B SaaS founders with 20–200 customers.
Tone: sharp, contrarian, evidence-led
Don't words: game-changer, disrupt`,
  },
  {
    label: "Founder", icon: Rocket,
    text: `Niche: Building a D2C skincare brand in India, in public
Audience: Aspiring D2C founders and early-stage operators.
Tone: honest, numbers-first, a little cheeky
Now: Year two, 12 people, profitable on contribution margin.`,
  },
  {
    label: "Speaker", icon: Mic,
    text: `Niche: Keynotes on resilience in high-growth teams
Audience: HR leaders and conference programme committees.
Offers: Keynote (45 min), half-day workshop.
Tone: story-led, energetic, grounded`,
  },
];

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} className="w-9 h-9 rounded-[9px] bg-ink text-on-ink flex items-center justify-center disabled:bg-field disabled:text-ink-faint transition-colors" aria-label="Build brief">
      {pending ? <AgentDots /> : <ArrowUp size={16} />}
    </button>
  );
}

export function IntakeForm({ tenantId, projectId }: { tenantId: string; projectId: string }) {
  const [text, setText] = useState("");
  const draftKey = `huemen:intake:${projectId}`;
  useDraftPersist(draftKey, text, setText);
  const parsed = useMemo(() => parseIntake(text), [text]);
  const placed = Object.keys(parsed.fields);
  const unplacedLines = parsed.unplaced ? parsed.unplaced.split("\n").length : 0;

  return (
    <div className="w-full max-w-[720px] mt-9 fade-up">
      <form action={submitIntakeAction} onSubmit={() => clearDraft(draftKey)} className="bg-paper border border-hairline rounded-[14px] shadow-[var(--shadow)] focus-within:border-line">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="projectId" value={projectId} />
        <textarea
          name="notes"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="Drop in your notes, transcript or brief…"
          className="w-full resize-none bg-transparent px-4 pt-4 text-[0.92rem] leading-relaxed outline-none placeholder:text-ink-faint"
        />
        <div className="flex items-center gap-2 px-3 pb-3">
          <span className="text-[0.78rem] text-ink-faint flex-1">
            {text.trim() ? `${placed.length} field${placed.length === 1 ? "" : "s"} recognised` : "Plain text · nothing is sent until you submit"}
          </span>
          <Link href={`/w/${tenantId}/p/${projectId}/brief/edit`} className="text-[0.8rem] text-ink-muted hover:text-ink px-2">Skip to editor</Link>
          <Submit disabled={!text.trim()} />
        </div>
      </form>

      {text.trim() ? (
        <div className="mt-4 bg-panel border border-hairline rounded-[12px] p-4 fade-in">
          <p className="label-mono text-ink-faint mb-2.5">Preview · what lands in the brief</p>
          <div className="flex flex-wrap gap-1.5">
            {placed.map((k) => (
              <span key={k} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-[7px] bg-paper border border-hairline text-[0.78rem]"><Check size={12} className="text-ok" /> {FIELD_LABELS[k] ?? k}</span>
            ))}
            {placed.length === 0 && <span className="text-[0.8rem] text-ink-muted">No labelled fields yet. Start lines with a label like “Niche:” or “Audience:”.</span>}
          </div>
          {unplacedLines > 0 && (
            <p className="mt-3 text-[0.8rem] text-warn flex items-start gap-1.5">
              <CircleDashed size={13} className="mt-0.5 shrink-0" />
              {unplacedLines} line{unplacedLines > 1 ? "s" : ""} can&apos;t be matched to a field and won&apos;t be saved. Add a label, or paste them into the editor afterwards.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-6 text-center">
          <p className="text-[0.8rem] text-ink-faint">Try an example</p>
          <div className="mt-2.5 flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((e) => {
              const Icon = e.icon;
              return (
                <button key={e.label} type="button" onClick={() => setText(e.text)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] border border-line bg-paper text-[0.82rem] hover:border-ink transition-colors">
                  <Icon size={14} /> {e.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
