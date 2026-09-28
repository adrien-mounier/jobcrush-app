import { z } from "zod";
import { RankBand } from "./familyFloor.js";

const Count = z.number().int().nonnegative();
const BandBreakdown = z.object({ met: Count, total: Count }).superRefine((value, ctx) => {
  if (value.met > value.total) {
    ctx.addIssue({ code: "custom", message: "met must not exceed total" });
  }
});

export const CardFact = z.object({ id: z.string(), text: z.string() });
export type CardFact = z.infer<typeof CardFact>;

// band: the SAME RankBand used by AdRequirementV1.band and FloorItem.rankBand (#86 decision, #102) —
// not rendered by the web app (jobcard.tsx renders only .requirement), so carrying the unified
// vocabulary here is invisible on screen.
export const CardRequirement = z.object({ id: z.string(), band: RankBand, requirement: z.string() });
export type CardRequirement = z.infer<typeof CardRequirement>;

// #117's provenance discriminator, pinned identically on both sides of the seam. 2026-08-12
// (architecture pass candidate 2): this contract catches up to the shape schemaVersion "1" has
// ALREADY meant on the wire since #117 shipped — the discriminated union below, with matchPct/
// breakdown/bubble nullable on the two not-scored variants. The pre-#117 flat shape this file used
// to pin was a fossil nothing emitted or imported. Same version on purpose: the wire did not change
// today, the contract stopped lying about it.
export const CardScoreProvenance = z.enum(["judged", "pending", "unscored", "estimated"]);
export type CardScoreProvenance = z.infer<typeof CardScoreProvenance>;

const JobCardCommon = z.object({
  schemaVersion: z.literal("1"),
  adId: z.string().min(1),
  title: z.string(),
  company: z.string(),
  place: z.string(),
  salary: z.string().nullable(),
  pattern: z.string().nullable(),
  fit: z.array(CardFact),
  dontYet: z.array(CardRequirement),
  askedClosed: z.array(CardFact),
  adExcerpt: z.string(),
  /** #162 AC6 — requirements this card could NOT test, because the fact they gate on is unknown
   *  rather than absent (today: a years-of-experience bar with no readable work history). An unknown
   *  never lowers a score (#86 decision 3), so the honest thing is to say the bar was not tested
   *  instead of letting silence read as a pass or a fail. Optional and additive: a card with nothing
   *  untested omits it entirely, so every pre-#162 payload stays byte-identical. */
  notTested: z.array(CardRequirement).optional(),
  /** #305 (#294 c3) — the ageing line on a job HE BROUGHT: how long ago this person pasted it and that
   *  we cannot check whether it is still open, or the closing date the employer stated when the advert
   *  states one. Optional and additive, exactly like `notTested` above: absent on every job we found
   *  ourselves (there is nothing to say — it was re-asked of its provider this minute) and absent on a
   *  pasted job through its silent first week, so every pre-#305 payload stays byte-identical.
   *  A whole sentence, composed server-side (broughtJobs.ts): the screen prints it and decides
   *  nothing, so the deck card and the job's own screen cannot drift apart on the wording or the day
   *  it starts. */
  ageing: z.string().min(1).optional(),
});

/** A real score: judged against the candidate's evidence, or — only when no judge is wired at all —
 *  the deterministic fallback scorer, labelled honestly. */
export const ScoredJobCardV1 = JobCardCommon.extend({
  scored: z.enum(["judged", "estimated"]),
  matchPct: z.number().min(0).max(100),
  breakdown: z.object({ essential: BandBreakdown, desirable: BandBreakdown }),
  bubble: z.object({ hit: z.string(), open: z.string() }),
});
export type ScoredJobCardV1 = z.infer<typeof ScoredJobCardV1>;

// #117 AC5 — a card with no verdict claims NO number at all (matchPct/breakdown/bubble null, dontYet
// empty), never the deterministic scorer's number unlabelled. "pending" is genuinely in flight and
// self-heals via the client's poll; "unscored" was deliberately never bought this request.
const NotScoredCommon = JobCardCommon.extend({
  matchPct: z.null(),
  breakdown: z.null(),
  bubble: z.null(),
  dontYet: z.array(CardRequirement).length(0),
});
export const PendingJobCardV1 = NotScoredCommon.extend({ scored: z.literal("pending") });
export type PendingJobCardV1 = z.infer<typeof PendingJobCardV1>;
export const UnscoredJobCardV1 = NotScoredCommon.extend({ scored: z.literal("unscored") });
export type UnscoredJobCardV1 = z.infer<typeof UnscoredJobCardV1>;

export const JobCardV1 = z.union([ScoredJobCardV1, PendingJobCardV1, UnscoredJobCardV1]);
export type JobCardV1 = z.infer<typeof JobCardV1>;
