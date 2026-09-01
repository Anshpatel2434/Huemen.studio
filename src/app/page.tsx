import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function Home() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <main className="flex-1 flex flex-col justify-center max-w-3xl mx-auto px-8 py-20">
      <p className="eyebrow mb-6">Huemen.studio</p>
      <h1 className="text-5xl sm:text-6xl leading-[1.05] tracking-tight">
        Your brand, defined once.{" "}
        <span className="serif-accent">Generated everywhere.</span>
      </h1>
      <p className="mt-6 text-lg text-ink-muted max-w-xl">
        Fill your brand foundation once. Every post and image is generated from
        that stored context — no re-briefing an AI from scratch.
      </p>
      <div className="mt-10">
        <Link
          href="/login"
          className="inline-flex items-center gap-2 bg-ink text-paper px-6 py-3 text-sm font-medium hover:bg-accent transition-colors"
        >
          Sign in <span aria-hidden>↗</span>
        </Link>
      </div>
    </main>
  );
}
