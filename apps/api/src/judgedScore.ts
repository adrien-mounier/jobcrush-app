// #105 (E5 slice 4) — pure arithmetic over a judgement's per-requirement verdicts, replacing
// matchtick.ts's token-overlap `requirementFit` with the model's graded `fit` when a judgement is
// available. Deliberately its own file, not an edit to matchtick.ts: matchtick.ts stays untouched
// and every route that doesn't wire a judge (every pre-#105 test, and slice 10's own re-baselining
// work) keeps today's deterministic tick byte-for-byte. Same "no IO, no store, no LLM" shape as
// matchtick.ts — these functions only ever read an already-resolved JudgementRecord.
import type { AdRequirementV1, AdRequirementsV1, JobBlockView, CardFact, PlacementConfidence } from "@jobcrush/contracts";
import { BAND_WEIGHT, type MatchBreakdown } from "./matchtick.js";
import { COVERAGE_THRESHOLD, type JudgeVerdict } from "./judge.js";

function verdictMap(verdicts: JudgeVerdict[]): Map<string, JudgeVerdict> {
  return new Map(verdicts.map((v) => [v.requirementId, v]));
}

/** The judged analogue of matchTick: a plain band-weighted average of the model's own graded fits.
 *  No evidentiary-breadth bonus (matchTick's diminishing bonus for distinct relevant facts) — that
 *  heuristic exists to reward breadth a TOKEN scorer can't otherwise see; a meaning-aware verdict
 *  already accounts for how well the evidence supports each requirement, so layering a second,
 *  token-shaped bonus on top would just reintroduce the vocabulary-coincidence bias this ticket
 *  removes. Deterministic and stable: called only on an already-persisted verdict array, so the same
 *  verdicts always produce the same number (the AC this whole ticket hinges on). */
export function judgedMatchTick(verdicts: JudgeVerdict[], adRequirements: AdRequirementsV1): number {
  const byId = verdictMap(verdicts);
  let total = 0;
  let fit = 0;
  let everyCovered = true;
  for (const req of adRequirements.requirements) {
    const weight = BAND_WEIGHT[req.band];
    const reqFit = byId.get(req.id)?.fit ?? 0;
    total += weight;
    fit += weight * reqFit;
    if (reqFit < COVERAGE_THRESHOLD) everyCovered = false;
  }
  if (total === 0) return 0;
  const score = Math.round((fit / total) * 100);
  // #105 review finding 4: matchTick's own guard, restored — without it, a heavily weight-diluted
  // still-open requirement (e.g. 1, 1, 0.7 on weights 3, 3, 1) can round to 100 while that
  // requirement is still sitting in dontYet. A card must never read "100%" while listing a gap.
  return everyCovered ? score : Math.min(99, score);
}

/** matchBreakdown's judged analogue — same essential/desirable display rollup (#102's one sanctioned
 *  hand-written translation), "met" now decided by the judged fit crossing COVERAGE_THRESHOLD rather
 *  than a token-overlap fraction reaching 1. */
export function judgedBreakdown(verdicts: JudgeVerdict[], adRequirements: AdRequirementsV1): MatchBreakdown {
  const byId = verdictMap(verdicts);
  const breakdown: MatchBreakdown = {
    essential: { met: 0, total: 0 },
    desirable: { met: 0, total: 0 },
  };
  for (const requirement of adRequirements.requirements) {
    const band = requirement.band === "essential" ? breakdown.essential : breakdown.desirable;
    band.total += 1;
    if ((byId.get(requirement.id)?.fit ?? 0) >= COVERAGE_THRESHOLD) band.met += 1;
  }
  return breakdown;
}

/** uncoveredRequirements's judged analogue — the card's "Where you don't — yet" list, now driven by
 *  the judged fit instead of token-overlap coverage. A requirement missing a verdict entirely (should
 *  never happen — judge.ts's verifyCoverage rejects that shape before it's ever persisted) reads as
 *  fit 0, the same fail-safe default judgedMatchTick uses, rather than throwing on a malformed record. */
export function judgedUncoveredRequirements(
  verdicts: JudgeVerdict[],
  adRequirements: AdRequirementsV1,
): AdRequirementV1[] {
  const byId = verdictMap(verdicts);
  return adRequirements.requirements.filter((r) => (byId.get(r.id)?.fit ?? 0) < COVERAGE_THRESHOLD);
}

/** #413 — the years shortfall itself moved to recordBars.ts (applyRecordBars): a years bar is decided
 *  by the worked-out years alone, never by the scorer's fit. The scope predicates and the industry
 *  answer stay here, shared with deck.ts's rankAttenuation. */
/** #285 — everything an industry-scope bar needs to be answered, as plain data resolved once per
 *  request (deck.ts's resolveSessionYears). `groupOf` is the published vocabulary's active group
 *  tree, which is what makes closeness (exact / near / far) a pure lookup here — no model, no IO. */
export interface IndustryYearsContext {
  /** Her years per industry — the stored per-industry facts, full credit, never split. */
  years: ReadonlyMap<string, number>;
  /** The weakest contributing placement confidence per industry (yearsWorked.ts). */
  confidence: ReadonlyMap<string, PlacementConfidence>;
  /** True while any counting job carries no confirmed industry — the fallback condition. */
  hasUnplaced: boolean;
  /** Published industry id -> its group id, at active versions. */
  groupOf: ReadonlyMap<string, string>;
}

export interface YearsAtScopes {
  /** Years tested by a family-scope bar. Null = untestable (no usable work history). */
  family: number | null;
  /** Years tested by a total-scope bar — the career total. Null = untestable. */
  total: number | null;
  /** #285 — what answers an industry-scope bar. Absent = a caller with no industry context, which
   *  keeps the pre-#285 reading (the career total) rather than inventing a zero. */
  industries?: IndustryYearsContext;
  /** #413 — the job records the facts were derived from, so a bar naming several families can be
   *  answered by the merged months of every job in any of them (recordBars.ts). Absent = a caller
   *  with no records in hand, which keeps the single-family reading. */
  blocks?: readonly JobBlockView[];
}

/** The ONE definition of "a years bar that tests the family scope" — shared with buildJobCard's
 *  attenuation guard (deck.ts) so the two sites can never drift on what counts as one. Absent
 *  yearsScope reads as family: the plain meaning of a years bar on a role advert. */
export function isFamilyScopeYearsBar(req: AdRequirementV1): boolean {
  return (
    req.eligibilityDimension === "years-experience" &&
    req.comparable?.op === ">=" &&
    (req.yearsScope ?? "family") === "family"
  );
}

/** isFamilyScopeYearsBar's twin for the third scope — shared with buildJobCard's closeness/
 *  confidence attenuation (deck.ts) on the same never-drift terms. */
export function isIndustryScopeYearsBar(req: AdRequirementV1): boolean {
  return (
    req.eligibilityDimension === "years-experience" &&
    req.comparable?.op === ">=" &&
    req.yearsScope === "industry"
  );
}

/** #285 — the closeness half of the attenuation table (spec #279; the confidence half is
 *  familyLabeler.ts's CONFIDENCE_WEIGHT, and the two compose by multiplication — a `possible`
 *  placement in a near industry reads ×0.675). Owner's weights, not defaults to tune. `far` has no
 *  row because far years never answer the bar at all. */
export const CLOSENESS_WEIGHT = { exact: 1, near: 0.9 } as const;

/** What one industry-scope bar is answered with. `years` null = UNTESTABLE, verdict untouched.
 *  `closeness` is set only when a per-industry FACT answered the bar — a fallback or known-zero
 *  answer rests on no placement, so there is nothing for an attenuation to hedge. */
export interface IndustryBarAnswer {
  years: number | null;
  closeness: keyof typeof CLOSENESS_WEIGHT | null;
  confidence: PlacementConfidence | null;
}

/** #285 — how an industry bar is answered (spec #279):
 *    exact industry match — her years in that industry, at full weight;
 *    near (same group)   — the SAME whole years number; the card's deck rank sinks ×0.9 (#397: the rank, never the displayed score), the fact never;
 *    far                 — those years do not answer this bar at all;
 *  a known zero when every job carries an industry and none is in the advert's industry or group;
 *  the generous career total while any job's industry is unaccounted for; and UNTESTABLE (null,
 *  verdict untouched) when the advert names no published industry — our missing vocabulary is
 *  never charged to the person. */
export function answerIndustryBar(years: YearsAtScopes, req: AdRequirementV1): IndustryBarAnswer {
  const untouched: IndustryBarAnswer = { years: null, closeness: null, confidence: null };
  const ctx = years.industries;
  // No industry context wired at all: the pre-#285 reading (career total), never an invented zero.
  if (!ctx) return { years: years.total, closeness: null, confidence: null };
  const required = req.yearsIndustry;
  // An unmapped or unpublished advert industry is an untestable bar — completely untouched.
  if (!required || !ctx.groupOf.has(required)) return untouched;
  const exact = ctx.years.get(required);
  if (exact !== undefined) {
    // ponytail: exact wins outright even when a near industry holds more years — the literal
    // reading of the spec's table; revisit only if a real deck shows it under-crediting.
    return { years: exact, closeness: "exact", confidence: ctx.confidence.get(required) ?? null };
  }
  const requiredGroup = ctx.groupOf.get(required);
  let near: { industryId: string; years: number } | null = null;
  for (const [industryId, held] of ctx.years) {
    if (ctx.groupOf.get(industryId) !== requiredGroup) continue;
    if (!near || held > near.years) near = { industryId, years: held };
  }
  if (near) {
    return { years: near.years, closeness: "near", confidence: ctx.confidence.get(near.industryId) ?? null };
  }
  // No industry of hers answers this bar. Unaccounted years keep the generous total; a fully
  // placed history makes the answer a KNOWN zero, and zero is what scoring uses.
  if (ctx.hasUnplaced) return { years: years.total, closeness: null, confidence: null };
  return { years: 0, closeness: null, confidence: null };
}

/** #407 — the card's "Where you fit": this advert's requirements the scorer counts as met, in the
 *  advert's own order, each with the scorer's one-sentence reason. Never a CV line: until #407 `fit`
 *  was every confirmed fact unfiltered, and the owner read his whole CV back on every card. */
export function judgedFitRows(verdicts: JudgeVerdict[], adRequirements: AdRequirementsV1): CardFact[] {
  const byId = verdictMap(verdicts);
  return adRequirements.requirements.flatMap((r) => {
    const v = byId.get(r.id);
    // #418: a row met by a used stretch says so (CardFact.stretched) — the label every surface reads.
    return v && v.fit >= COVERAGE_THRESHOLD
      ? [{ id: r.id, text: r.requirement, reason: v.reason, ...(v.stretched ? { stretched: true as const } : {}) }]
      : [];
  });
}

/** #407 — the bubble's first half: one sentence on why the job fits, in the scorer's words. The top
 *  essential requirement's reason when it is met, else the first met requirement's, else "" — the
 *  half is dropped rather than filled with a CV fact (the pre-#407 behaviour: the supporting fact's
 *  full text, which for a broad requirement was the About-you paragraph). The gap half is untouched. */
export function judgedHitClause(verdicts: JudgeVerdict[], adRequirements: AdRequirementsV1): string {
  const met = judgedFitRows(verdicts, adRequirements);
  const topEssential = adRequirements.requirements.find((r) => r.band === "essential");
  return (met.find((row) => row.id === topEssential?.id) ?? met[0])?.reason ?? "";
}
