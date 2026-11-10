"use client";

import type { ReactNode } from "react";
import { Modal } from "@/components/ui";
import { btnClass } from "@/components/btn";

/**
 * The one confirm dialog (design system §13). It replaces the browser's own
 * confirm(), which is unstyled, unbranded and blocks the whole tab. The
 * question is the title; the body says what the action does and whether it
 * can be undone; the primary button names the action, never "OK".
 */
export function ConfirmModal({ open, title, children, confirmLabel, danger = false, pending = false, onClose, onConfirm }: {
  open: boolean;
  title: string;
  children?: ReactNode;
  /** The verb on the button: "Delete pillar", "Archive project". */
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" onClick={onClose} className={btnClass("secondary")} disabled={pending}>Cancel</button>
          <button type="button" onClick={onConfirm} className={btnClass(danger ? "danger" : "primary")} disabled={pending} autoFocus>
            {confirmLabel}
          </button>
        </>
      }
    >
      {children && <div className="text-sm text-ink-muted leading-relaxed">{children}</div>}
    </Modal>
  );
}
