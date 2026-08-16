// JC-9 job queue — store + progress events. In-memory driver for tests/dev; the BullMQ/Redis
// driver lands when infra exists (JC-6 is blocked on account creation — see docs/deploy.md).
// The interface is the contract: pipeline stages checkpoint their outputs into `progress` so a
// retry never re-executes a completed LLM call (the spine's orchestratorRuntime checkpoint rule).
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { MinedRole } from "@jobcrush/contracts";

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface JobRecord {
  id: string;
  type: string;
  sessionId: string | null;
  status: JobStatus;
  progress: Record<string, unknown>; // checkpointed per-step outputs
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobStore {
  create(type: string, sessionId?: string | null): Promise<JobRecord>;
  get(id: string): Promise<JobRecord | null>;
  update(id: string, patch: Partial<Pick<JobRecord, "status" | "progress" | "error">>): Promise<JobRecord>;
  /** Subscribe to updates for one job. Returns unsubscribe. */
  subscribe(id: string, listener: (job: JobRecord) => void): () => void;
}

export class InMemoryJobStore implements JobStore {
  private jobs = new Map<string, JobRecord>();
  private emitter = new EventEmitter();

  async create(type: string, sessionId: string | null = null): Promise<JobRecord> {
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: randomUUID(),
      type,
      sessionId,
      status: "queued",
      progress: {},
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async get(id: string): Promise<JobRecord | null> {
    return this.jobs.get(id) ?? null;
  }

  async update(
    id: string,
    patch: Partial<Pick<JobRecord, "status" | "progress" | "error">>,
  ): Promise<JobRecord> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`unknown job ${id}`);
    const next: JobRecord = {
      ...job,
      ...patch,
      progress: { ...job.progress, ...(patch.progress ?? {}) },
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(id, next);
    this.emitter.emit(id, next);
    return next;
  }

  subscribe(id: string, listener: (job: JobRecord) => void): () => void {
    this.emitter.on(id, listener);
    return () => this.emitter.off(id, listener);
  }
}

/** The miner stores its full doc (incl. per-role date flags) under progress.miner.doc. Reads a job
 *  record's own shape, so it lives with the record (moved out of the route spine by #236). */
export const minedRoles = (job: { progress: Record<string, unknown> }): MinedRole[] =>
  ((job.progress.miner as { doc?: { roles?: MinedRole[] } } | undefined)?.doc?.roles) ?? [];

export function isTerminal(status: JobStatus): boolean {
  return status === "completed" || status === "failed";
}

// The demo-job the S0 exit review calls for: three checkpointed steps with visible progress.
export async function runDemoJob(store: JobStore, jobId: string): Promise<void> {
  await store.update(jobId, { status: "running" });
  for (const step of ["extract", "mine", "render"] as const) {
    const current = await store.get(jobId);
    if (current?.progress[step]) continue; // checkpoint rule: never redo a completed step
    await new Promise((r) => setTimeout(r, 25));
    await store.update(jobId, { progress: { [step]: `${step}-done` } });
  }
  await store.update(jobId, { status: "completed" });
}
