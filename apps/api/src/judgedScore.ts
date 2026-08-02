// #105 (E5 slice 4) — pure arithmetic over a judgement's per-requirement verdicts, replacing
// matchtick.ts's token-overlap `requirementFit` with the model's graded `fit` when a judgement is
// available. Deliberately its own file, not an edit to matchtick.ts: matchtick.ts stays untouched
// and every route that doesn't wire a judge (every pre-#105 test, and slice 10's own re-baselining
// work) keeps today's deterministic tick byte-for-byte. Same "no IO, no store, no LLM" shape as
// matchtick.ts — these functions only ever read an already-resolved JudgementRecord.
import type { AdRequirementV1, AdRequirementsV1 } from "@jobcrush/contracts";
import { BAND_WEIGHT, pickHitClause, type MatchBreakdown } from "./matchtick.js";
import { COVERAGE_THRESHOLD, type JudgeFact, type JudgeVerdict } from "./judge.js";

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

/** pickHitClause's judged analogue: the top essential requirement's OWN verdict names the fact that
 *  actually supported it (supportingFactId), so the bubble quotes the fact the judge relied on rather
 *  than re-deriving a guess via token overlap. When that verdict names no fact (or it can't be found
 *  in this exact fact list) this does NOT jump straight to the first confirmed fact — #105 review: an
 *  unmet top essential requirement used to quote the user's first fact regardless of relevance. It
 *  falls back to pickHitClause's own token-overlap search across ALL facts instead, mirroring the
 *  original's full fallback chain (search all facts, then the first confirmed fact, then the generic
 *  line) rather than truncating it. */
export function judgedPickHitClause(
  verdicts: JudgeVerdict[],
  adRequirements: AdRequirementsV1,
  confirmedFacts: JudgeFact[],
): string {
  const topEssential = adRequirements.requirements.find((r) => r.band === "essential");
  if (topEssential) {
    const verdict = verdictMap(verdicts).get(topEssential.id);
    const fact = verdict?.supportingFactId
      ? confirmedFacts.find((f) => f.id === verdict.supportingFactId)
      : undefined;
    if (fact) return fact.text;
  }
  return pickHitClause(confirmedFacts, adRequirements);
}
