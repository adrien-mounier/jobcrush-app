// The S1 onboarding pipeline job: extract → mine, checkpointed into the job store
// (JC-9 rule: a retry never re-executes a completed step). Each step also appends a
// human-readable line to progress.feed — the front door renders those live over SSE; trust is
// built by showing real extracted facts, not a spinner.
//
// #272: the preview step (mine → tailored draft) is deleted — it built and stored a full tailored
// CV that no live screen ever read, at real model cost per upload. The tailoring engine itself
// (preview.ts) is kept for the post-deck tailored CV; see the note on makePreviewStep.
import type { JobStore } from "./jobs.js";
import { buildRawCv, extractContact, extractRawCv, type ContactExtraction, type RawCv } from "./extract.js";
import type { CvKind } from "./uploads.js";
import { CandidateClaim } from "@jobcrush/contracts";
import type { CandidateClaim as CandidateClaimType, MinedJobBlocks } from "@jobcrush/contracts";
import type { ImportProof } from "./sessions.js";

export type PipelineInput =
  | { type: "upload"; data: Buffer; kind: CvKind; key: string }
  | { type: "paste"; text: string };

/** One durable line per run (persisted by the guestbook). Debuggable: keeps the error + step feed,
 *  and the kept CV data: the original file's R2 key, the extracted CV, and the mined claims. */
export interface VisitRecord {
  jobId: string;
  sessionId: string | null;
  finished: boolean;
  stage: string; // last stage reached: extract | mine | start
  minedClaims: number | null;
  roles: number | null;
  needsGrill: number | null;
  /** Always null since #272 (the draft step is deleted); the column keeps the history. */
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
  mine?: (rawCv: RawCv) => Promise<{
    claims: unknown[];
    needsGrill: number;
    roles: number;
    doc?: { parser_flags?: string[] };
  }>;
  /** #270: seed the session's claims + import proof from what this run read. `sessionId` travels as
   *  a plain argument (the persistContact/persistJobBlocks convention) so BOTH intake paths — an
   *  uploaded file and pasted text — store facts against the session identically. It used to be a
   *  per-request closure bound only for uploads, which is why a paste left `session.importProof`
   *  null and never seeded a claim. */
  persistImport?: (
    sessionId: string,
    proof: ImportProof,
    claims: CandidateClaimType[],
  ) => Promise<ImportProof>;
  /** #190: persist phone/email parsed from the raw CV's contact block, once, right after extract —
   *  no LLM call. A "read" write here never overwrites a person-said correction; the contact store
   *  enforces that guard (ADR-0008 §3), not this pipeline. */
  persistContact?: (sessionId: string, extraction: ContactExtraction) => Promise<void>;
  /** #161 job-block miner: raw CV -> mined dated blocks (employer/title/start/end/kind, each with
   *  its own origin) plus the model's raw text for that run. Optional so extract/mine can ship on
   *  their own — same convention as `mine` above. */
  mineJobBlocks?: (rawCv: RawCv) => Promise<{ doc: MinedJobBlocks; rawOutput: string }>;
  /** #161: ingests one mining run into the durable job-block store (matches against what's already
   *  stored for this session; never duplicates a recognised job) and persists the raw output +
   *  schema version beside the parsed blocks. */
  persistJobBlocks?: (sessionId: string, doc: MinedJobBlocks, rawOutput: string) => Promise<void>;
  /** #161: the job-block miner failed validation twice (an unreadable history). Records that the
   *  read RAN and FAILED — distinct from both "never run" and "ran, found none" — and MUST NOT
   *  throw into the run: an unreadable work history is a question the store surfaces, never a
   *  reason to fail the whole upload (binding UX intent — claims mining still proceeds). */
  recordJobBlocksFailed?: (sessionId: string) => Promise<void>;
  /** #221: places every not-yet-placed job record of this session in a job family. Its own step,
   *  with its own checkpoint (the stored placement per block — familyLabeler.ts's own doc), so a
   *  retry re-spends nothing. Optional like the steps above; absent → blocks stay unlabeled, which
   *  reads as unmapped everywhere. */
  labelJobBlocks?: (sessionId: string) => Promise<void>;
  /** Best-effort guestbook write; called once on any terminal state. Never throws into the run. */
  recordVisit?: (visit: VisitRecord) => Promise<void>;
}

const proofKey = (claim: CandidateClaimType) => claim.field_key ?? claim.semantic_key;

export function buildImportProof(
  claims: CandidateClaimType[],
  parserFlags: string[] = [],
): ImportProof {
  const sourceSupported = claims.filter(
    (claim) =>
      claim.machine_touch !== "inferred" &&
      claim.classification !== "Derived" &&
      claim.source_quote.trim().length > 0,
  );
  const uniqueByFact = new Map<string, CandidateClaimType>();
  for (const claim of sourceSupported) {
    const key = claim.semantic_key;
    if (!uniqueByFact.has(key)) uniqueByFact.set(key, claim);
  }
  const unique = [...uniqueByFact.values()];
  const byField = new Map<string, CandidateClaimType[]>();
  for (const claim of sourceSupported) {
    if (claim.field_key) {
      byField.set(claim.field_key, [...(byField.get(claim.field_key) ?? []), claim]);
    }
  }
  const conflictEntry = [...byField].find(
    ([, fieldClaims]) => new Set(fieldClaims.map((claim) => claim.field_value)).size > 1,
  );
  const conflictClaim = conflictEntry?.[1][0];
  return {
    outcome:
      unique.length === 0
        ? "no_useful_facts"
        : parserFlags.length > 0
          ? "partial"
          : "success",
    usefulFactCount: unique.length,
    skippedQuestionCount: 0,
    representativeFacts: unique.slice(0, 4).map((claim) => ({
      id: proofKey(claim),
      text: claim.text,
      provenance: "cv" as const,
    })),
    conflict: conflictClaim
      ? {
          fieldId: conflictClaim.field_key!,
          label: conflictClaim.field_label!,
          userResolvedValue: null,
        }
      : null,
  };
}

const failedImportProof = (): ImportProof => ({
  outcome: "failed",
  usefulFactCount: 0,
  skippedQuestionCount: 0,
  representativeFacts: [],
  conflict: null,
});

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
        const importProof = deps.persistImport && job?.sessionId
          ? await deps.persistImport(job.sessionId, failedImportProof(), [])
          : failedImportProof();
        await store.update(jobId, {
          status: "failed",
          error: UNPARSEABLE_ERROR,
          progress: {
            importProof,
          },
        });
      return;
    }
    await appendFeed(
      store,
      jobId,
      `Found ${rawCv.stats.roles} dated role${rawCv.stats.roles === 1 ? "" : "s"}, ` +
        `${rawCv.stats.bullets} bullet${rawCv.stats.bullets === 1 ? "" : "s"} across ` +
        `${rawCv.blocks.length} sections.`,
    );

    // #190: parse phone/email out of the CV's own contact block, once, deterministically — no LLM
    // call. A "read" write here never overwrites a person-said correction (ADR-0008 §3); the guard
    // lives in the contact store itself (contact.ts's put()), not here.
    if (deps.persistContact && job?.sessionId) {
      await deps.persistContact(job.sessionId, extractContact(rawCv.blocks));
    }

    // Step 1.5 — job blocks (#161): independent of the sentence-level claim miner below, so it
    // runs (and checkpoints) on its own — a retry never re-mines it once it has landed. Binding UX
    // intent: "an unreadable history reads as a question, never as a failure" — a miner failure here
    // is caught and recorded, never allowed to fail the whole upload (claims mining still proceeds).
    if (deps.mineJobBlocks && job?.sessionId) {
      job = await store.get(jobId);
      if (!job?.progress.jobBlocks) {
        await appendFeed(store, jobId, "Reading your work history into job records…");
        try {
          const { doc, rawOutput } = await deps.mineJobBlocks(rawCv);
          if (deps.persistJobBlocks) await deps.persistJobBlocks(job!.sessionId!, doc, rawOutput);
          await appendFeed(
            store,
            jobId,
            `Found ${doc.blocks.length} dated block${doc.blocks.length === 1 ? "" : "s"} in your history.`,
          );
        } catch {
          if (deps.recordJobBlocksFailed) await deps.recordJobBlocksFailed(job!.sessionId!);
          await appendFeed(
            store,
            jobId,
            "Could not read your work history into job records — you can still continue; you can add it yourself later.",
          );
        }
        await store.update(jobId, { progress: { jobBlocks: true } });
      }
    }

    // Step 1.6 — family labels (#221): what KIND OF WORK each dated block is, worked out against
    // the closed published vocabulary. Deliberately outside the checkpoint above: its own checkpoint
    // is per block, in the store, so this runs on a retry only for the blocks still unanswered — and
    // it must still run when 1.5 was already done in an earlier attempt. A failure here is recorded
    // by the labeler and never fails the upload; the blocks simply stay unlabeled (= unmapped).
    if (deps.labelJobBlocks && job?.sessionId) {
      await appendFeed(store, jobId, "Working out what kind of work each job is…");
      try {
        await deps.labelJobBlocks(job.sessionId);
      } catch (err) {
        console.error("[pipeline] job-block labeling failed", err);
      }
    }

    // Step 2 — mine (JC-13)
    if (deps.mine) {
      job = await store.get(jobId);
      let miner = job?.progress.miner;
      if (!miner) {
        await appendFeed(store, jobId, "Mining your experience into individual claims…");
        const mined = await deps.mine(rawCv);
        miner = mined;
        const importedClaims = mined.claims.flatMap((claim) => {
          const parsed = CandidateClaim.safeParse(claim);
          return parsed.success ? [parsed.data] : [];
        });
        if (importedClaims.length === 0) throw new Error("miner returned no valid claims");
        const parserFlags = [
          ...(mined.doc?.parser_flags ?? []),
          ...(importedClaims.length < mined.claims.length ? ["invalid-miner-claim"] : []),
        ];
        let importProof = buildImportProof(importedClaims, parserFlags);
        if (deps.persistImport && job?.sessionId) {
          importProof = await deps.persistImport(
            job.sessionId,
            importProof,
            importedClaims,
          );
        }
        await store.update(jobId, { progress: { miner: mined, importProof } });
        await appendFeed(
          store,
          jobId,
          `Mined ${mined.claims.length} claims from ${mined.roles} roles — ` +
            `${mined.needsGrill} will need a quick check from you later.`,
        );
      }
    }

    await store.update(jobId, { status: "completed" });
  } catch (err) {
    const current = await store.get(jobId);
    if (!current?.progress.importProof) {
      const importProof = deps.persistImport && current?.sessionId
        ? await deps.persistImport(current.sessionId, failedImportProof(), [])
        : failedImportProof();
      await store.update(jobId, {
        progress: { importProof },
      });
    }
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
        await deps.recordVisit({
          jobId,
          sessionId: final?.sessionId ?? null,
          finished: final?.status === "completed",
          stage: miner ? "mine" : p.rawCv ? "extract" : "start",
          minedClaims: miner?.claims?.length ?? null,
          roles: miner?.roles ?? null,
          needsGrill: miner?.needsGrill ?? null,
          posting: null,
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
