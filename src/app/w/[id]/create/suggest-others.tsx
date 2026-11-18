"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { btnClass } from "@/components/btn";
import { suggestOthersAction } from "./actions";

export function SuggestOthers({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false); // `pending` is one render late; this stops a burst of clicks
  return (
    <div className="flex items-center gap-3">
      {error && <span role="alert" className="text-sm text-danger">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (busy.current) return;
          busy.current = true;
          start(async () => {
            try {
              setError(null);
              const r = await suggestOthersAction(tenantId);
              if (!r.ok) setError(r.error);
              router.refresh();
            } finally {
              busy.current = false;
            }
          });
        }}
        className={btnClass("ghost", "sm")}
      >
        <RefreshCw size={14} className={pending ? "animate-spin" : ""} aria-hidden="true" /> Suggest others
      </button>
    </div>
  );
}
