"use server";

/**
 * Try again and Stop on a queued job (components/job-status). Workspace access
 * as everywhere; RLS keeps another workspace's job out of reach.
 */
import { revalidatePath } from "next/cache";
import { actionScope } from "@/lib/auth/workspace";
import { cancelJob, retryJob, startWorker } from "@/lib/jobs";

export async function retryJobAction(tenantId: string, jobId: string): Promise<boolean> {
  const scope = await actionScope(tenantId);
  const ok = await retryJob(scope, jobId);
  if (ok) startWorker();
  return ok;
}

export async function cancelJobAction(tenantId: string, jobId: string): Promise<boolean> {
  const scope = await actionScope(tenantId);
  const ok = await cancelJob(scope, jobId);
  revalidatePath(`/w/${tenantId}`, "layout");
  return ok;
}
