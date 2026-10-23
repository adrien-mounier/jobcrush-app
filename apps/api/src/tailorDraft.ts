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
import { deniedCapabilities, negativeRequirementIds } from "./tailor.js";
import type { TailorDraftRecord, TailorDraftStore } from "./tailorDraftStore.js";
import type { TailorRequirement } from "./deck.js";
import {
  applyUsedStretches,
  carryAnswers,
  stretchFingerprint,
  stretchInputFor,
  stretchView,
  suggestStretches,
  type StretchCheckpoint,
  type StretchView,
} from "./stretchSuggestions.js";
import {
  applyStoredContact,
  buildTailorInput,
  draftDisclosure,
  renderPreviewHtml,
  tailorDraft,
  type Draft,
  type JobDisclosure,
  type StretchMarks,
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
  const negativeIds = negativeRequirementIds(adReq, negatives);
  return draftInputsFor(
    confirmed,
    negatives,
    blocks,
    posting,
    headerText,
    // The dimensions the advert gates on — the essential band, same reading the card's own
    // essential/desirable split already makes.
    adReq.requirements.filter((r) => r.band === "essential").map((r) => r.requirement),
    // Open points: neither covered by a confirmed fact nor answered "No" — the unanswered gaps.
    uncoveredRequirements(confirmed, adReq)
      .filter((r) => !negativeIds.has(r.id))
      .map((r) => r.requirement),
  );
}

/** The engine's inputs with the advert already read into its tests and open points — shared with
 *  the profile's Preview as CV (#390), whose "advert" is the person's own job and has no open
 *  points to tell. */
export function draftInputsFor(
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  blocks: JobBlockView[],
  posting: Posting,
  headerText: string,
  advertTests: string[],
  openPoints: string[] = [],
): DraftInputs {
  const claimsDoc: CandidateClaims = {
    schemaVersion: "1",
    roles: [],
    claims: confirmed,
    parser_flags: [],
  };
  const opts: TailorInputOpts = {
    jobBlocks: blocks,
    advertTests,
    // #311 (#287 c1/c2): EVERY unsuperseded denial in the session, in its own words — not only this
    // advert's — because the page must never state a denied capability whichever job asked about
    // it. Feeds the prompt's never-print block AND the mechanical page check (conservationIssues).
    // A denial a confirmed fact now covers (he grew) is superseded and drops out — the new fact
    // prints on its own merit. Eligibility declines are refusals, not denials, and never enter.
    negatives: deniedCapabilities(negatives, confirmed),
    openPoints,
  };
  const input = buildTailorInput(claimsDoc, posting, headerText, opts);
  return { claimsDoc, opts, headerText, fingerprint: createHash("sha256").update(input).digest("hex") };
}

export interface TailorDraftJobDeps {
  jobs: JobStore;
  tailorDrafts: TailorDraftStore;
  tailorLlm: LlmClient;
  /** #417: the stretch suggestion step's client. Absent ⇒ the step does not run and the record
   *  carries no `stretch` field (told apart from "ran, found none"). */
  stretchLlm?: LlmClient;
}

/** #417: what the stretch step needs beyond the draft's own inputs — the job's requirements with
 *  the card's verdicts (routes/tailor.ts composes them the way the screen's list is composed). */
export interface StretchContext {
  requirements: TailorRequirement[];
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
  // #417: the stretch step runs after the draft when a context is given. `existing` is the stored
  // draft that already matches the facts — only the suggestions are (re)made then.
  stretch?: StretchContext,
  existing?: TailorDraftRecord,
): Promise<void> {
  try {
    await deps.jobs.update(jobId, { status: "running" });
    let record = existing;
    if (!record) {
      const { draft, conservationNotices } = await tailorDraft(
        inputs.claimsDoc,
        posting,
        deps.tailorLlm,
        inputs.headerText,
        inputs.opts,
      );
      record = {
        draft,
        conservationNotices,
        inputFingerprint: inputs.fingerprint,
        draftedAt: new Date().toISOString(),
        // #313: a fresh draft is a fresh document — approval never carries over to words he has
        // not seen. The approve press stamps this.
        approvedAt: null,
      };
      // Checkpointed BEFORE the suggestion step: a failure there never costs the draft.
      await deps.tailorDrafts.put(sessionId, posting.id, record);
    }
    if (stretch && deps.stretchLlm) {
      await deps.jobs.update(jobId, { progress: { tailorDraft: { step: "suggesting" } } });
      await deps.tailorDrafts.put(sessionId, posting.id, {
        ...record,
        // A draft that stands keeps the answers to the suggestions that come back (carryAnswers).
        stretch: await stretchStep(deps.stretchLlm, posting, stretch, record.draft, inputs, existing?.stretch),
      });
    }
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

/** #417: the one call, checkpointed by its input. A step that does not finish is stored as
 *  `failed` — told apart from "ran, found none" (ADR-0005's negative-test warning) — and the next
 *  POST /draft looks again; the draft itself is already safe. */
async function stretchStep(
  llm: LlmClient,
  posting: Posting,
  stretch: StretchContext,
  draft: Draft,
  inputs: DraftInputs,
  previous?: StretchCheckpoint,
): Promise<StretchCheckpoint> {
  const input = stretchInputFor(posting, stretch.requirements, draft, inputs);
  const fingerprint = stretchFingerprint(input);
  try {
    const denied = inputs.opts.negatives ?? [];
    const suggestions = await suggestStretches(llm, input, draft, stretch.requirements, denied, posting.id);
    return { fingerprint, status: "ran", suggestions: carryAnswers(suggestions, previous) };
  } catch (err) {
    console.error(`[ops] stretch suggestions failed: ${err instanceof Error ? err.message : String(err)}`);
    return { fingerprint, status: "failed" };
  }
}

export interface TailorDraftView {
  html: string;
  /** #154, re-homed onto the Tailor step's ending: what the draft held back and why. */
  disclosure: JobDisclosure[];
  conservationNotices: string[];
  draftedAt: string;
  /** #417: the stretch suggestions beside this draft, with their answers — `ran` (possibly with
   *  none), `failed`, or null when the step never ran. The screen never reads null or failed as
   *  "nothing to suggest". */
  stretch: StretchView;
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
  // #313: the approved export prints the same render WITHOUT the DRAFT watermark/banner — the
  // document leaving the app is no longer a draft. Every screen read keeps the default.
  opts: { watermark?: boolean; marks?: StretchMarks } = {},
): TailorDraftView {
  // #418: the lines the person chose to use for this job print in place of the lines they push out
  // (applyUsedStretches — at read time, the stored draft untouched).
  const draft = {
    ...applyUsedStretches(record.draft, record.stretch),
    contact: applyStoredContact(record.draft.contact, contact),
  };
  return {
    html: renderPreviewHtml(draft, posting, opts),
    disclosure: draftDisclosure(claimsDoc, draft),
    // The lint speaks once per finding, so three untraceable lines in one role produce the same
    // visitor sentence three times — on screen that reads as a stutter, not three facts. Display
    // shaping only: the stored record keeps every notice.
    conservationNotices: [...new Set(record.conservationNotices)],
    draftedAt: record.draftedAt,
    stretch: stretchView(record.stretch),
  };
}
