"use client";

import { Copy } from "lucide-react";
import { useToast } from "@/components/ui";

export function CopyField({ value }: { value: string }) {
  const toast = useToast();
  return (
    <div className="flex items-center gap-2 bg-hover border border-hairline rounded-sm pl-3 pr-1 min-h-12 min-w-0">
      <span className="text-xs text-accent-ink truncate flex-1 min-w-0">{value}</span>
      <button
        type="button"
        onClick={async () => {
          try { await navigator.clipboard.writeText(value); toast("Link copied"); } catch { toast("Copy failed — select and copy manually", "danger"); }
        }}
        className="hu-iconbtn"
        title="Copy"
      >
        <Copy size={13} />
      </button>
    </div>
  );
}
