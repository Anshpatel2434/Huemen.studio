"use client";

/**
 * A consistent back control for every screen. Prefer an explicit `href` (the
 * known parent) so back is deterministic; without one it falls back to browser
 * history. Styled as a secondary button so it clears the 44px tap floor.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { btnClass } from "@/components/btn";

export function BackButton({
  href,
  label = "Back",
  size = "sm",
}: {
  href?: string;
  label?: string;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const cls = btnClass("secondary", size);
  const inner = (
    <>
      <ArrowLeft size={14} /> {label}
    </>
  );
  if (href) return <Link href={href} className={cls}>{inner}</Link>;
  return (
    <button type="button" onClick={() => router.back()} className={cls} aria-label={label}>
      {inner}
    </button>
  );
}
