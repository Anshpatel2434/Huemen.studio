"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "@/components/ui";
import { btnClass } from "@/components/btn";

/**
 * Permanent delete, GitHub-style: type the project name to confirm. Archive is
 * offered as the reversible alternative.
 */
export function DeleteProjectModal({ name, pending, onClose, onConfirm, onArchive }: {
  name: string; pending?: boolean; onClose: () => void; onConfirm: () => void; onArchive?: () => void;
}) {
  const [typed, setTyped] = useState("");
  const ok = typed.trim() === name.trim();
  return (
    <Modal open onClose={onClose} title="Delete project">
      <div className="flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <p className="text-[0.85rem] text-ink-muted leading-relaxed">
          This permanently deletes <span className="font-medium text-ink">{name}</span>: its brief, pillars, content and version history, visuals, ideas, calendar and offers. It can&apos;t be undone.
          {onArchive ? " To keep it out of the way instead, archive it." : " Archived projects can be restored; deleted ones can't."}
        </p>
        <label className="block">
          <span className="text-[0.8rem] mb-1.5 block">Type <span className="font-medium">{name}</span> to confirm</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && ok) onConfirm(); }} className="field" autoFocus aria-label="Project name" />
        </label>
        <div className="flex items-center gap-2">
          {onArchive && <button onClick={onArchive} className={btnClass("ghost")}>Archive instead</button>}
          <span className="flex-1" />
          <button onClick={onClose} className={btnClass("secondary")}>Cancel</button>
          <button disabled={!ok || pending} onClick={onConfirm} className={btnClass("primary")}><Trash2 size={14} /> Delete project</button>
        </div>
      </div>
    </Modal>
  );
}
