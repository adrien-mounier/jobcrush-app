// The S1 onboarding pipeline job: extract → mine → preview, checkpointed into the job store
// (JC-9 rule: a retry never re-executes a completed step). Each step also appends a
// human-readable line to progress.feed — JC-15 renders those live over SSE; trust is built by
// showing real extracted facts, not a spinner.
import type { JobStore } from "./jobs.js";
import { buildRawCv, extractRawCv, type RawCv } from "./extract.js";
import type { CvKind } from "./uploads.js";

export type PipelineInput =
  | { type: "upload"; data: Buffer; kind: CvKind; key: string }
  | { type: "paste"; text: string };

/** One durable line per run (persisted by the guestbook). Debuggable: keeps the error + step feed,
 *  and the kept CV data: the original file's R2 key, the extracted CV, and the mined claims. */
export interface VisitRecord {
  jobId: string;
  sessionId: string | null;
  finished: boolean;
  stage: string; // last stage reached: extract | mine | preview | start
  minedClaims: number | null;
  roles: number | null;
  needsGrill: number | null;
  posting: string | null;
  durationMs: number;
  error: string | null;
  feed: string[];
  uploadKey: string | null; // R2 key of the original file (null for pasted text)
  kind: string | null; // pdf | docx | txt
  rawCv: unknown; // extracted CV (kept)
  claims: unknown; // mined claims (kept)
}

export interface PipelineDeps {
  /** JC-13 claim miner. Optional so the extract stage can ship/test on its own. */
  mine?: (rawCv: RawCv) => Promise<{ claims: unknown[]; needsGrill: number; roles: number }>;
  /** JC-16 preview: mined claims + target titles (+ raw CV for header data) → watermarked HTML. */
  preview?: (
    minerOutput: unknown,
    targetTitles: string[],
    rawCv: RawCv,
  ) => Promise<{ html: string; postingTitle: string; postingCompany: string }>;
  /** Best-effort guestbook write; called once on any terminal state. Never throws into the run. */
  recordVisit?: (visit: VisitRecord) => Promise<void>;
}

export const UNPARSEABLE_ERROR = "unparseable_cv";

async function appendFeed(store: JobStore, jobId: string, line: string): Promise<void> {
  const job = await store.get(jobId);
  const feed = Array.isArray(job?.progress.feed) ? (job.progress.feed as string[]) : [];
  await store.update(jobId, { progress: { feed: [...feed, line] } });
}

export async function runOnboardingJob(
  store: JobStore,
  jobId: string,
  input: PipelineInput,
  targetTitles: string[],
  deps: PipelineDeps = {},
): Promise<void> {
  const startedAt = Date.now();
  try {
    await store.update(jobId, { status: "running" });

    // Step 1 — extract (JC-12)
    let job = await store.get(jobId);
    let rawCv = job?.progress.rawCv as RawCv | undefined;
    if (!rawCv) {
      await appendFeed(store, jobId, "Reading your CV…");
      rawCv =
        input.type === "upload"
          ? await extractRawCv(input.data, input.kind)
          : buildRawCv("paste", input.text, null);
      await store.update(jobId, { progress: { rawCv } });
    }
    if (rawCv.status === "unparseable") {
      await appendFeed(
        store,
        jobId,
        "This looks like a scanned document with no selectable text — paste your CV text instead.",
      );
      await store.update(jobId, { status: "failed", error: UNPARSEABLE_ERROR });
      return;
    }
    await appendFeed(
      store,
      jobId,
      `Found ${rawCv.stats.roles} dated role${rawCv.stats.roles === 1 ? "" : "s"}, ` +
        `${rawCv.stats.bullets} bullet${rawCv.stats.bullets === 1 ? "" : "s"} across ` +
        `${rawCv.blocks.length} sections.`,
    );

    // Step 2 — mine (JC-13)
    if (deps.mine) {
      job = await store.get(jobId);
      let miner = job?.progress.miner;
      if (!miner) {
        await appendFeed(store, jobId, "Mining your experience into individual claims…");
        const mined = await deps.mine(rawCv);
        miner = mined;
        await store.update(jobId, { progress: { miner: mined } });
        await appendFeed(
          store,
          jobId,
          `Mined ${mined.claims.length} claims from ${mined.roles} roles — ` +
            `${mined.needsGrill} will need a quick check from you later.`,
        );
      }

      // Step 3 — preview (JC-16)
      if (deps.preview) {
        job = await store.get(jobId);
        if (!job?.progress.preview) {
          await appendFeed(store, jobId, "Picking a live posting that matches your targets…");
          const rendered = await deps.preview(miner, targetTitles, rawCv);
          await store.update(jobId, {
            progress: {
              preview: {
                postingTitle: rendered.postingTitle,
                postingCompany: rendered.postingCompany,
              },
              previewHtml: rendered.html,
            },
          });
          await appendFeed(
            store,
            jobId,
            `Tailored a draft for "${rendered.postingTitle}" at ${rendered.postingCompany}.`,
          );
        }
      }
    }

    await store.update(jobId, { status: "completed" });
  } catch (err) {
    await store.update(jobId, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    // One durable, debuggable line per run — reads the final job state, so every exit path
    // (success, unparseable, crash) is covered from a single place. Never disturbs the run.
    if (deps.recordVisit) {
      try {
        const final = await store.get(jobId);
        const p = final?.progress ?? {};
        const miner = p.miner as { claims?: unknown[]; roles?: number; needsGrill?: number } | undefined;
        const preview = p.preview as { postingTitle?: string; postingCompany?: string } | undefined;
        await deps.recordVisit({
          jobId,
          sessionId: final?.sessionId ?? null,
          finished: final?.status === "completed",
          stage: preview ? "preview" : miner ? "mine" : p.rawCv ? "extract" : "start",
          minedClaims: miner?.claims?.length ?? null,
          roles: miner?.roles ?? null,
          needsGrill: miner?.needsGrill ?? null,
          posting: preview ? `${preview.postingTitle} at ${preview.postingCompany}` : null,
          durationMs: Date.now() - startedAt,
          error: final?.error ?? null,
          feed: Array.isArray(p.feed) ? (p.feed as string[]) : [],
          uploadKey: input.type === "upload" ? input.key : null,
          kind: input.type === "upload" ? input.kind : null,
          rawCv: p.rawCv ?? null,
          claims: miner?.claims ?? null,
        });
      } catch {
        // guestbook is observability only; swallow anything so a run never fails because of it
      }
    }
  }
}
