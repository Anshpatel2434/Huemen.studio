/**
 * Shapes shared by the queue, its handlers and the pages that show a job.
 * Pure: safe to import from client components (JobView only).
 */
import type { SessionScope } from "@/db/session";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "dead";

/** A row of `jobs` as the database returns it. */
export interface JobRecord {
  id: string;
  tenant_id: string;
  kind: string;
  label: string;
  payload: Record<string, unknown> | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  result: unknown;
  progress: Record<string, unknown> | null;
  run_after: Date;
  locked_until: Date | null;
  created_by: string | null;
  created_at: Date;
  finished_at: Date | null;
}

/** What a page sees. */
export interface JobView {
  id: string;
  kind: string;
  label: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  progress: Record<string, unknown>;
  result: unknown;
  error: string | null;
  runAfter: string;
  createdAt: string;
  finishedAt: string | null;
  needsWorker: boolean;
}

export interface JobContext {
  /** The person who started the job, re-checked for access before every slice. */
  scope: SessionScope & { tenantId: string };
  payload: Record<string, unknown>;
  /** What earlier slices and attempts already did. */
  progress: Record<string, unknown>;
  /** Keep progress now (also renews the lease), so a failure later loses none of it. */
  save: (progress: Record<string, unknown>) => Promise<void>;
  /**
   * Epoch ms after which the handler should stop starting new work and return
   * { done: false }. Always do at least one unit of work first.
   */
  deadline: number;
}

export type JobOutcome = { done: true; result?: unknown } | { done: false };

export type JobHandler = (ctx: JobContext) => Promise<JobOutcome>;

/** A failure no retry can fix: the job stops at once with this message. */
export class JobStop extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobStop";
  }
}
