// The S1 onboarding pipeline job: extract → mine → preview, checkpointed into the job store
// (JC-9 rule: a retry never re-executes a completed step). Each step also appends a
// human-readable line to progress.feed — JC-15 renders those live over SSE; trust is built by
// showing real extracted facts, not a spinner.
import type { JobStore } from "./jobs.js";
import { buildRawCv, extractRawCv, type RawCv } from "./extract.js";
import type { CvKind } from "./uploads.js";

export type PipelineInput =
  | { type: "upload"; data: Buffer; kind: CvKind }
  | { type: "paste"; text: string };

export interface PipelineDeps {
  /** JC-13 claim miner. Optional so the extract stage can ship/test on its own. */
  mine?: (rawCv: RawCv) => Promise<{ claims: unknown[]; needsGrill: number; roles: number }>;
  /** JC-16 preview: mined claims + target titles → rendered watermarked HTML. */
  preview?: (
    minerOutput: unknown,
    targetTitles: string[],
  ) => Promise<{ html: string; postingTitle: string; postingCompany: string }>;
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
          const rendered = await deps.preview(miner, targetTitles);
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
  }
}
