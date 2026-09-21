"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionProjectScope } from "@/lib/auth/workspace";
import { loadFoundation, saveFoundation, type FoundationForm } from "@/lib/data/foundation";
import { uploadAsset, type AssetKind } from "@/lib/data/assets";
import { saveBriefAnswers, touchProject } from "@/lib/data/projects";
import { generatePillars } from "@/lib/data/pipeline";
import { loadBrandContext } from "@/lib/context/context-loader";
import { parseIntake, mergeIntake } from "@/lib/intake/parse";
import { applyAnswers, buildQuestions, MIN_SEEDS } from "@/lib/brief/questions";

async function ctx(fd: FormData) {
  const t = String(fd.get("tenantId"));
  const p = String(fd.get("projectId"));
  return { scope: await actionProjectScope(t, p), base: `/w/${t}/p/${p}` };
}

function formFrom(fd: FormData): FoundationForm {
  const g = (k: string) => String(fd.get(k) ?? "");
  return {
    niche: g("niche"), positioning: g("positioning"), offers: g("offers"), audience: g("audience"),
    chapters: [0, 1, 2].map((i) => ({ title: g(`ch${i}_title`), body: g(`ch${i}_body`) })),
    tone: g("tone"), doWords: g("doWords"), dontWords: g("dontWords"), readingLevel: g("readingLevel"),
    samplePosts: g("samplePosts"), palette: g("palette"), fonts: g("fonts"), imageStyleNotes: g("imageStyleNotes"),
  };
}

export async function saveFoundationAction(fd: FormData): Promise<void> {
  const { scope, base } = await ctx(fd);
  await saveFoundation(scope, formFrom(fd));
  await touchProject(scope);
  revalidatePath(base, "layout");
  redirect(`${base}/brief?saved=1`);
}

export async function uploadAssetAction(fd: FormData): Promise<void> {
  const { scope, base } = await ctx(fd);
  const file = fd.get("file") as File | null;
  const kind = String(fd.get("kind") ?? "reference_image") as AssetKind;
  if (file && file.size > 0) await uploadAsset(scope, file, kind);
  revalidatePath(base, "layout");
}

/** Intake: labelled notes → brief fields (only non-empty values overwrite). */
export async function submitIntakeAction(fd: FormData): Promise<void> {
  const { scope, base } = await ctx(fd);
  const text = String(fd.get("notes") ?? "");
  if (!text.trim()) redirect(`${base}/intake`);
  const parsed = parseIntake(text);
  await saveFoundation(scope, mergeIntake(await loadFoundation(scope), parsed));
  await touchProject(scope);
  revalidatePath(base, "layout");
  redirect(`${base}/brief/questions?placed=${parsed.placedCount}`);
}

/**
 * Step 1 → 2. Save the question answers (gap answers go INTO the brief; strategy
 * answers are kept as pillar seeds). With `generate`, pillars are generated from
 * brief + seeds and the Pillars step unlocks.
 */
export async function answerQuestionsAction(fd: FormData): Promise<void> {
  const { scope, base } = await ctx(fd);
  const foundation = await loadFoundation(scope);
  const questions = buildQuestions(foundation);
  const answers = Object.fromEntries(questions.map((q) => [q.key, String(fd.get(`q_${q.key}`) ?? "")]));
  const { foundation: next, seeds } = applyAnswers(foundation, questions, answers);
  await saveFoundation(scope, next);
  await saveBriefAnswers(scope, seeds);

  if (fd.get("intent") === "generate") {
    const context = await loadBrandContext(scope);
    if (context.degraded || seeds.length < MIN_SEEDS) {
      revalidatePath(base, "layout");
      redirect(`${base}/brief/questions?blocked=1`);
    }
    await generatePillars(scope);
    revalidatePath(base, "layout");
    redirect(`${base}/pillars?generated=1`);
  }
  revalidatePath(base, "layout");
  redirect(`${base}/brief/questions?saved=1`);
}
