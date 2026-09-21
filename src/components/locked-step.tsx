import Link from "next/link";
import { Lock } from "lucide-react";
import { btnClass } from "@/components/btn";

/** Shown in place of a step that isn't unlocked yet — steps never skip. */
export function LockedStep({ step, title, needs, href, cta }: { step: number; title: string; needs: string; href: string; cta: string }) {
  return (
    <div className="absolute inset-0 canvas-dots flex items-center justify-center p-6">
      <div className="bg-paper border border-hairline rounded-[14px] max-w-md w-full shadow-[var(--shadow)] p-8 text-center">
        <span className="mx-auto w-11 h-11 rounded-[10px] bg-field flex items-center justify-center text-ink-muted"><Lock size={18} /></span>
        <p className="label-mono text-ink-faint mt-4">Step {step} of 4</p>
        <p className="text-[1.15rem] font-medium mt-1">{title} is locked</p>
        <p className="text-[0.85rem] text-ink-muted mt-1.5 leading-relaxed">{needs}</p>
        <Link href={href} className={`${btnClass("primary")} mt-5`}>{cta}</Link>
      </div>
    </div>
  );
}
