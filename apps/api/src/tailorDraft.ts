// #310 — the CV brain's caller. The engine (preview.ts: tailorDraft, the conservation lint, the
// retry, the plain-words notices, the HTML render) is bound to THE JOB BEING TAILORED: the input is
// the session's own confirmed facts (corrections included — the stored job records), the card's
// negatives and open points ride along as never-print / never-satisfied context (#66, #287), and
// the result checkpoints per (session, advert) keyed by a fingerprint of the exact input, so a
// retry, a reload, or leaving and coming back never re-spends the model call — while a supported
// answer changes the input, which changes the fingerprint, which redrafts.
//
// The engine is NOT rewritten here — this module composes its inputs, runs it detached from the
// request (the paste door's job-record pattern: a draft is a multi-second model call, and a
// synchronous route would gamble on the web proxy's deadline), and shapes what the screen reads.
import { createHash } from "node:crypto";
import type { AdRequirementsV1, CandidateClaims } from "@jobcrush/contracts";
import type { ClaimRecord } from "./claims.js";
import type { JobBlockView } from "./jobBlockStore.js";
import type { JobStore } from "./jobs.js";
import type { LlmClient } from "./llm.js";
import { uncoveredRequirements } from "./matchtick.js";
import { negativeRequirementIds } from "./tailor.js";
import type { TailorDraftRecord, TailorDraftStore } from "./tailorDraftStore.js";
import {
  applyStoredContact,
  buildTailorInput,
  draftDisclosure,
  renderPreviewHtml,
  tailorDraft,
  type JobDisclosure,
  type Posting,
  type StoredContact,
  type TailorInputOpts,
} from "./preview.js";

export interface DraftInputs {
  claimsDoc: CandidateClaims;
  opts: TailorInputOpts;
  /** The CV's own letterhead (stored at mine time, contact.ts's "header" field) — what the engine
   *  prints the name and city from (preview-tailor.md rule 3). "" is an honest absence. */
  headerText: string;
  /** sha256 of the exact input string the engine will be handed — the checkpoint key. The input
   *  embeds the prompt text itself (buildTailorInput prepends it), so a prompt change redrafts
   *  without a separate version field. */
  fingerprint: string;
}

/**
 * The engine's inputs for one (session fact set, advert) pair. Confirmed claims are the material
 * (negatives never enter confirmed(), so a "No" structurally cannot become a printed line — the
 * lint's provenance check then flags any cited id that is not in this list). Roles come from the
 * stored, corrected job records (buildTailorInput's #163 path); the card's negatives and still-open
 * requirements travel as context the tailor must respect, never render from.
 */
export function composeDraftInputs(
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  blocks: JobBlockView[],
  posting: Posting,
  adReq: AdRequirementsV1,
  headerText = "",
): DraftInputs {
  const claimsDoc: CandidateClaims = {
    schemaVersion: "1",
    roles: [],
    claims: confirmed,
    parser_flags: [],
  };
  const negativeIds = negativeRequirementIds(adReq, negatives);
  const opts: TailorInputOpts = {
    jobBlocks: blocks,
    // The dimensions the advert gates on — the essential band, same reading the card's own
    // essential/desirable split already makes.
    advertTests: adReq.requirements.filter((r) => r.band === "essential").map((r) => r.requirement),
    negatives: adReq.requirements.filter((r) => negativeIds.has(r.id)).map((r) => r.requirement),
    // Open points: neither covered by a confirmed fact nor answered "No" — the unanswered gaps.
    openPoints: uncoveredRequirements(confirmed, adReq)
      .filter((r) => !negativeIds.has(r.id))
      .map((r) => r.requirement),
  };
  const input = buildTailorInput(claimsDoc, posting, headerText, opts);
  return { claimsDoc, opts, headerText, fingerprint: createHash("sha256").update(input).digest("hex") };
}

export interface TailorDraftJobDeps {
  jobs: JobStore;
  tailorDrafts: TailorDraftStore;
  tailorLlm: LlmClient;
}

/** One plain-words failure, job-record shaped like the paste door's: what came back, and the one
 *  thing he can act on. The retry is honest — every completed stage is checkpointed upstream (the
 *  ad read, the judgement) and the draft itself never got stored, so pressing again re-spends
 *  nothing that already landed. */
export const DRAFT_FAILURE = {
  cameBack: "We could not finish writing this CV.",
  fix: "Press Try again — everything you answered is saved, and nothing already done is re-done.",
};

/**
 * The detached draft run (the paste door's runPaste shape): reports only into the job record the
 * screen watches over the existing `GET /jobs/:id/events` stream, and never leaves the job
 * `running` for ever. On success the draft is checkpointed BEFORE the job completes, so a watcher
 * that sees "completed" can never then miss the draft.
 */
export async function runTailorDraftJob(
  deps: TailorDraftJobDeps,
  sessionId: string,
  jobId: string,
  posting: Posting,
  inputs: DraftInputs,
): Promise<void> {
  try {
    await deps.jobs.update(jobId, { status: "running" });
    const { draft, conservationNotices } = await tailorDraft(
      inputs.claimsDoc,
      posting,
      deps.tailorLlm,
      inputs.headerText,
      inputs.opts,
    );
    const record: TailorDraftRecord = {
      draft,
      conservationNotices,
      inputFingerprint: inputs.fingerprint,
      draftedAt: new Date().toISOString(),
    };
    await deps.tailorDrafts.put(sessionId, posting.id, record);
    await deps.jobs.update(jobId, { status: "completed", progress: { tailorDraft: { ready: true } } });
  } catch (err) {
    console.error(`[ops] tailor draft failed: ${err instanceof Error ? err.message : String(err)}`);
    await deps.jobs.update(jobId, {
      status: "failed",
      error: "draft_failed",
      progress: { tailorDraft: { failure: DRAFT_FAILURE } },
    });
  }
}

export interface TailorDraftView {
  html: string;
  /** #154, re-homed onto the Tailor step's ending: what the draft held back and why. */
  disclosure: JobDisclosure[];
  conservationNotices: string[];
  draftedAt: string;
}

/** What the ending renders. Disclosure is derived at read time from the same claims the draft was
 *  built from (the route serves a record only when its fingerprint matches the current fact set),
 *  because the page only ever receives the finished document — a claim id would be an unresolvable
 *  slug out there. The stored, corrected phone/email are applied HERE, at read time (#190), so a
 *  contact correction made after drafting still reaches every later read of the checkpoint —
 *  deterministic, and deliberately outside the fingerprint: a contact change must never re-spend a
 *  model call it cannot alter the substance of. */
export function tailorDraftView(
  record: TailorDraftRecord,
  claimsDoc: CandidateClaims,
  posting: Posting,
  contact: StoredContact = { phone: null, email: null },
): TailorDraftView {
  const draft = {
    ...record.draft,
    contact: applyStoredContact(record.draft.contact, contact),
  };
  return {
    html: renderPreviewHtml(draft, posting),
    disclosure: draftDisclosure(claimsDoc, draft),
    // The lint speaks once per finding, so three untraceable lines in one role produce the same
    // visitor sentence three times — on screen that reads as a stutter, not three facts. Display
    // shaping only: the stored record keeps every notice.
    conservationNotices: [...new Set(record.conservationNotices)],
    draftedAt: record.draftedAt,
  };
}
