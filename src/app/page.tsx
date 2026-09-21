import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LogoMark } from "@/components/ui";
import { btnClass } from "@/components/btn";
import { StageChips } from "@/components/stage-chips";
import { ThemeToggle } from "@/components/theme";

export default async function Home() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <main className="flex-1 flex flex-col">
      <header className="flex items-center justify-between px-5 h-14">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark size={26} />
          <span className="text-[0.95rem] font-medium tracking-tight">Huemen<span className="text-accent">.</span>studio</span>
        </Link>
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <Link href="/login" className={btnClass("secondary", "sm")}>Sign in</Link>
        </div>
      </header>

      <section className="flex-1 flex flex-col items-center justify-center text-center px-6 pb-24">
        <div className="fade-up">
          <StageChips active="brief" />
        </div>
        <h1 className="mt-8 text-[2.6rem] sm:text-[3.4rem] leading-[1.05] max-w-3xl fade-up">
          Define your brand once.
          <br />
          <span className="serif-accent">Everything else follows.</span>
        </h1>
        <p className="mt-5 text-[1rem] text-ink-muted max-w-xl leading-relaxed fade-up">
          Your story, voice and visual identity become one stored brief. Every post, carousel
          and quote card is generated from it, so you never re-brief an AI from scratch.
        </p>
        <div className="mt-8 flex items-center gap-2 fade-up">
          <Link href="/login" className={btnClass("primary")}>Open the studio</Link>
        </div>
        <p className="mt-6 label-mono text-ink-faint">Invite only · accounts are set up by your coach</p>
      </section>
    </main>
  );
}
