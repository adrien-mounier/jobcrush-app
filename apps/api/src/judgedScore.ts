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

/** #107 (E5 slice 6, D5), rule corrected in code review (M2) — a years-experience shortfall counts,
 *  proportionately, by ATTENUATING (never replacing, never inflating) the model's own graded fit for
 *  any requirement whose bar states a MINIMUM ("8+ years", op ">="):
 *
 *      fit = modelFit * min(1, userYears / bar)
 *
 *  Multiplicative, not a replacement: an outright replace (the ticket's original instruction) turns a
 *  judge's honest 0.2 on "8+ years of enterprise software delivery" into 1.0 for anyone who tapped
 *  "More than 10 years" — INFLATING a card the model correctly scored low, on a field the judge is
 *  meant to be the authority over. Multiplying instead can only ever LOWER or hold a score — the
 *  user's own stated years still moves it (5 years and 9 years never score identically for the same
 *  non-zero model fit, AC4's own requirement), but never past what the model already found credible.
 *
 *  Applied ONLY when `bar > 0` — a `comparable.value` of exactly 0 (a real, storable band lower bound:
 *  eligibilityDiscovery.ts's "Under 3 years" -> 0) would otherwise divide by zero, producing `NaN`
 *  that slips past judgedMatchTick's `< COVERAGE_THRESHOLD` guard (NaN compares false to everything)
 *  and serializes `matchPct` as `null` on a JobCard field the contract pins as a number. Left
 *  completely untouched in that case, same as any other requirement this function doesn't apply to.
 *
 *  userYears === null (never asked) leaves every verdict completely untouched — an unknown is never a
 *  penalty, same rule the withdrawal predicate (withdrawal.ts) applies on the other side of this exact
 *  fact. A `"<="`/`"=="` bar states no MINIMUM demand, so there is nothing a shortfall could mean
 *  against it — left untouched too, out of this ticket's scope.
 *
 *  ACCEPTED RESIDUAL (recorded, not fixed here): userYears is resolved at the VISITOR's own family
 *  scope (routes/onboarding.ts's resolveUserYears) and applied to every judged advert's years-bar
 *  requirement regardless of which family THAT advert belongs to — a years fact earned in one family
 *  can attenuate a requirement on an out-of-family advert. Acceptable specifically because this rule
 *  can now only ever LOWER a score: an out-of-family advert scoring down is the direction #86 wants
 *  anyway, not a new risk the old "replace" rule didn't already carry (and worse, in that direction).
 *
 *  Pure — no IO, called at READ TIME by the route (routes/onboarding.ts), never persisted: the cached
 *  judgement describes the advert and the fact set it was judged against; years-experience is session
 *  state that can change independently of that cache. Judged path only — matchTick/matchtick.ts (the
 *  deterministic `estimated` scorer) is untouched; slice 10 (#111) retires it separately. */
export function applyYearsShortfall(
  verdicts: JudgeVerdict[],
  adRequirements: AdRequirementsV1,
  userYears: number | null,
): JudgeVerdict[] {
  if (userYears === null) return verdicts;
  const byId = new Map(adRequirements.requirements.map((r) => [r.id, r]));
  return verdicts.map((v) => {
    const req = byId.get(v.requirementId);
    const bar = req?.comparable?.value;
    if (!req || req.eligibilityDimension !== "years-experience" || req.comparable?.op !== ">=" || !bar) {
      return v;
    }
    // Clamped to [0,1], not just capped at 1: the contract's `comparable.value` is any `number` (the
    // oracle never rules out a negative one), and years/NEGATIVE_BAR is itself negative — an
    // uncapped-below multiplier would send `fit` negative and render as a negative matchPct. An
    // impossible-in-practice input (nothing legitimate ever produces a negative years bar), refused
    // here rather than trusted to stay away.
    const multiplier = Math.max(0, Math.min(1, userYears / bar));
    return { ...v, fit: v.fit * multiplier };
  });
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
