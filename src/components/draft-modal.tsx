"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { FORMATS } from "@/lib/content/formats";
import { liveDraftHref } from "@/components/live-draft";

/** Pick format → optional topic → pillar; context is injected server-side (§4.2). */
export function DraftModal({
  open, onClose, tenantId, projectId, pillars, defaultPillar, defaultTopic = "", defaultFormat = "linkedin_post",
}: {
  open: boolean; onClose: () => void; tenantId: string; projectId: string; pillars: { id: string; name: string }[];
  defaultPillar?: string | null; defaultTopic?: string; defaultFormat?: string;
}) {
  const router = useRouter();
  const [format, setFormat] = useState(defaultFormat);
  const [topic, setTopic] = useState(defaultTopic);
  const [pillar, setPillar] = useState<string>(defaultPillar ?? "");
  // The draft is written live on the Content canvas (components/live-draft):
  // this dialog only says what to write, then hands over.
  const submit = () => {
    onClose();
    router.push(liveDraftHref(`/w/${tenantId}/p/${projectId}`, { format, topic, pillarId: pillar || null }));
  };

  return (
    <Modal open={open} onClose={onClose} title="Draft from your brief" width={520}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium mb-2">Format</p>
          <div className="flex flex-wrap gap-1.5">
            {FORMATS.map((f) => (
              <button key={f.key} type="button" onClick={() => setFormat(f.key)} aria-pressed={format === f.key} className={`min-h-11 px-4 rounded-full text-sm border transition-colors ${format === f.key ? "bg-ink text-on-ink border-ink" : "border-line hover:border-line-strong hover:bg-hover"}`}>{f.label}</button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="text-sm font-medium mb-1.5 block">Topic or idea <span className="text-ink-faint font-normal">(optional)</span></span>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} className="field" placeholder="e.g. Why I stopped offering discounts" />
        </label>
        {pillars.length > 0 && (
          <label className="block">
            <span className="hu-label !flex mb-2">Pillar</span>
            <select value={pillar} onChange={(e) => setPillar(e.target.value)} className="field">
              <option value="">No pillar</option>
              {pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <p className="text-xs text-ink-muted">No brand context to type: voice, story and guardrails come from the brief. You&apos;ll watch two variants being written on the canvas.</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnClass("ghost")}>Cancel</button>
          <button onClick={submit} className={btnClass("primary")}>Draft 2 variants</button>
        </div>
      </div>
    </Modal>
  );
}
