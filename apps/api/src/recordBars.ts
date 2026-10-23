// #413 (ADR-0020 clause 5) — a bar the record answers is decided by the record, never by the scorer.
//
// A years bar is met or short on the worked-out years alone: its fit is min(1, years / bar), which
// REPLACES the scorer's fit for that requirement. Until #413 the scorer rated a years bar on CV text
// it cannot date (0.5, "no explicit total years") and the years multiplied that, so a bar the dates
// met read 0.475, and a 10-year bar could never pass. The scorer's reading of a CV sentence never
// moves a years verdict now.
//
// Which number answers a bar is answerYearsBar below: a family-scope bar naming fields reads the
// merged months of every job placed in ANY published family it names, each job once
// (computeYearsInFamilies); one naming no field reads the advert's own family, as before; an
// industry bar is answerIndustryBar's; a total bar the career total. A bar the record cannot answer
// (no usable history, every named field unpublished, an unpublished industry) is null — the
// verdict stays untouched and the card lists it under "Not tested" (deck.ts), never as a zero.
//
// Pure, applied at READ TIME, never persisted: the cached judgement describes the advert and the
// fact set it was judged against; the record is session state that moves independently of it.
// #416 adds the degree rule beside this one.
import type { AdRequirementV1, AdRequirementsV1 } from "@jobcrush/contracts";
import type { JudgeVerdict } from "./judge.js";
import { answerIndustryBar, type YearsAtScopes } from "./judgedScore.js";
import { computeYearsInFamilies, hasUnplacedWork } from "./yearsWorked.js";

/** The worked-out years a years-experience requirement is tested against, or null when the record
 *  cannot answer it (untestable — never a penalty, #86 decision 3). */
export function answerYearsBar(req: AdRequirementV1, years: YearsAtScopes): number | null {
  if (years.total === null) return null;
  if (req.yearsScope === "industry") return answerIndustryBar(years, req).years;
  if ((req.yearsScope ?? "family") !== "family") return years.total;
  const named = req.yearsFamilies;
  // Absent: a bar naming no field, or a read cached before #413 — the advert's own family answers it.
  // A caller carrying no job records (a hand-built struct) reads the same number.
  if (named === undefined || years.blocks === undefined) return years.family;
  if (named.length === 0) return null; // every named field unpublished: not tested
  // The existing rules stand: an unplaced job keeps the generous career-total fallback, and a fully
  // placed history with nothing in the named fields is a KNOWN zero (ADR-0014 amendment 1 decision 6).
  return computeYearsInFamilies(years.blocks, named) ?? (hasUnplacedWork(years.blocks) ? years.total : 0);
}

/** Replaces the scorer's fit on every years bar stating a MINIMUM (op ">=", bar > 0) with
 *  min(1, years / bar). A bar of 0 would divide by zero and a "<="/"==" bar states no minimum, so
 *  both stay untouched; a negative bar (the contract never rules one out) clamps at 0 rather than
 *  rendering a negative matchPct. */
export function applyRecordBars(
  verdicts: JudgeVerdict[],
  adRequirements: AdRequirementsV1,
  years: YearsAtScopes,
): JudgeVerdict[] {
  if (years.family === null && years.total === null) return verdicts;
  const byId = new Map(adRequirements.requirements.map((r) => [r.id, r]));
  return verdicts.map((v) => {
    const req = byId.get(v.requirementId);
    const bar = req?.comparable?.value;
    if (!req || req.eligibilityDimension !== "years-experience" || req.comparable?.op !== ">=" || !bar) return v;
    const userYears = answerYearsBar(req, years);
    if (userYears === null) return v;
    return { ...v, fit: Math.max(0, Math.min(1, userYears / bar)) };
  });
}
