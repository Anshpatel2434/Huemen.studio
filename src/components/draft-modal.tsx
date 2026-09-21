"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Modal, AgentDots } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { FORMATS } from "@/lib/content/formats";
import { draftAction } from "@/app/w/[id]/p/[pid]/content/actions";

/** Pick format → optional topic → pillar; context is injected server-side (§4.2). */
export function DraftModal({
  open, onClose, tenantId, projectId, pillars, defaultPillar, defaultTopic = "", defaultFormat = "linkedin_post", onDone,
}: {
  open: boolean; onClose: () => void; tenantId: string; projectId: string; pillars: { id: string; name: string }[];
  defaultPillar?: string | null; defaultTopic?: string; defaultFormat?: string; onDone?: (id: string) => void;
}) {
  const router = useRouter();
  const [format, setFormat] = useState(defaultFormat);
  const [topic, setTopic] = useState(defaultTopic);
  const [pillar, setPillar] = useState<string>(defaultPillar ?? "");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError("");
      try {
        const id = await draftAction(tenantId, projectId, { format, topic, pillarId: pillar || null });
        onClose();
        if (onDone) onDone(id);
        else router.push(`/w/${tenantId}/p/${projectId}/content?item=${id}`);
      } catch {
        // Input is kept in the form — never lose a draft (brief §07).
        setError("Generation failed and was logged. Your input is still here, so try again.");
      }
    });

  return (
    <Modal open={open} onClose={() => !pending && onClose()} title="Draft from your brief" width={520}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-[0.8rem] font-medium mb-2">Format</p>
          <div className="flex flex-wrap gap-1.5">
            {FORMATS.map((f) => (
              <button key={f.key} type="button" onClick={() => setFormat(f.key)} className={`h-8 px-3 rounded-[8px] text-[0.8rem] border transition-colors ${format === f.key ? "bg-ink text-on-ink border-ink" : "border-line hover:border-ink"}`}>{f.label}</button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="text-[0.8rem] font-medium mb-1.5 block">Topic or idea <span className="text-ink-faint font-normal">(optional)</span></span>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} className="field" placeholder="e.g. Why I stopped offering discounts" />
        </label>
        {pillars.length > 0 && (
          <label className="block">
            <span className="text-[0.8rem] font-medium mb-1.5 block">Pillar</span>
            <select value={pillar} onChange={(e) => setPillar(e.target.value)} className="field">
              <option value="">No pillar</option>
              {pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <p className="text-[0.78rem] text-ink-muted">No brand context to type: voice, story and guardrails come from the brief. You&apos;ll get two variants.</p>
        {error && <p className="text-[0.8rem] text-accent-ink">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={pending} className={btnClass("ghost")}>Cancel</button>
          <button onClick={submit} disabled={pending} className={btnClass("primary")}>
            {pending ? <><AgentDots /> Drafting…</> : "Draft 2 variants"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
