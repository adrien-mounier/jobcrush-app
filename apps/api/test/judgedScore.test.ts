// #105 (E5 slice 4) — judgedScore.ts's pure-function tests, same shape as matchtick.test.ts: no I/O,
// no LLM, just arithmetic over an already-resolved set of verdicts. HTTP-level proof that a real
// judgement drives a real card (the five regression rows, no-second-model-call caching, negatives
// staying answered-and-closed) lives in judgeCards.test.ts.
import { describe, expect, it } from "vitest";
import type { AdRequirementV1, AdRequirementsV1 } from "@jobcrush/contracts";
import {
  applyYearsShortfall,
  judgedBreakdown,
  judgedMatchTick,
  judgedPickHitClause,
  judgedUncoveredRequirements,
} from "../src/judgedScore.js";
import { COVERAGE_THRESHOLD, type JudgeFact, type JudgeVerdict } from "../src/judge.js";

const AD: AdRequirementsV1 = {
  schemaVersion: "1",
  adId: "test-ad",
  curated: true,
  language: "en",
  familyFit: { family: "IT Project Manager", confidence: 0.9 },
  requirements: [
    { id: "own-budget", band: "essential", requirement: "Own a project budget", sourceSpan: "Own a project budget" },
    { id: "lead-team", band: "essential", requirement: "Lead a cross-functional team", sourceSpan: "Lead a cross-functional team" },
    { id: "certification", band: "nice-to-have", requirement: "Hold a PM certification", sourceSpan: "Hold a PM certification" },
  ],
};

const verdict = (requirementId: string, fit: number, supportingFactId: string | null = null): JudgeVerdict => ({
  requirementId,
  fit,
  supportingFactId,
  reason: "test reason",
});

describe("#105 judgedMatchTick", () => {
  it("is a plain band-weighted average of the graded fits — 0 with no verdicts covering anything", () => {
    expect(judgedMatchTick([], AD)).toBe(0);
  });

  it("scores 100 only when every requirement's fit is 1", () => {
    const full = [verdict("own-budget", 1), verdict("lead-team", 1), verdict("certification", 1)];
    expect(judgedMatchTick(full, AD)).toBe(100);
  });

  // essential weight 3, nice-to-have weight 1 (BAND_WEIGHT) — a partial fit on an essential
  // requirement moves the score by more than the same partial fit on a nice-to-have would.
  it("weighs essential requirements more heavily than nice-to-have ones", () => {
    const partialEssential = [verdict("own-budget", 0.5), verdict("lead-team", 0), verdict("certification", 0)];
    const partialNice = [verdict("own-budget", 0), verdict("lead-team", 0), verdict("certification", 0.5)];
    expect(judgedMatchTick(partialEssential, AD)).toBeGreaterThan(judgedMatchTick(partialNice, AD));
  });

  it("is deterministic — the same verdicts always produce the same number (the AC this ticket hinges on)", () => {
    const verdicts = [verdict("own-budget", 0.7), verdict("lead-team", 0.3), verdict("certification", 0)];
    expect(judgedMatchTick(verdicts, AD)).toBe(judgedMatchTick(verdicts, AD));
    expect(judgedMatchTick(verdicts, AD)).toBe(judgedMatchTick([...verdicts], AD));
  });

  it("stays within 0..100 regardless of the fit values given", () => {
    const verdicts = [verdict("own-budget", 0.5), verdict("lead-team", 1), verdict("certification", 0)];
    const score = judgedMatchTick(verdicts, AD);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  // #105 review finding 4: matchTick's own Math.min(99, …) guard, restored. Enough fully-covered
  // essentials dilute one still-open requirement's weight share to where PLAIN ROUNDING ALONE would
  // read 100 — 14 essentials at fit 1 (weight 42) plus one nice-to-have at fit 0.79 (weight 1, below
  // COVERAGE_THRESHOLD — still open): raw = 42.79/43 = 99.51%, which Math.round alone would read as
  // 100. That is the exact contradiction the review flagged: a card reading "100%" while dontYet
  // still lists a gap.
  it("never reads 100 while a requirement is still open, even when rounding alone would reach it", () => {
    const manyEssentials: AdRequirementV1[] = Array.from({ length: 14 }, (_, i) => ({
      id: `req-${i}`,
      band: "essential" as const,
      requirement: `Requirement ${i}`,
      sourceSpan: `Requirement ${i}`,
    }));
    const ad: AdRequirementsV1 = {
      ...AD,
      requirements: [
        ...manyEssentials,
        { id: "open-one", band: "nice-to-have", requirement: "A nice-to-have", sourceSpan: "x" },
      ],
    };
    const verdicts = [...manyEssentials.map((r) => verdict(r.id, 1)), verdict("open-one", 0.79)];
    const score = judgedMatchTick(verdicts, ad);
    expect(score).toBeLessThanOrEqual(99);
    expect(judgedUncoveredRequirements(verdicts, ad).map((r) => r.id)).toContain("open-one");
  });
});

describe(`#105 judgedBreakdown / judgedUncoveredRequirements — the COVERAGE_THRESHOLD bar (${COVERAGE_THRESHOLD})`, () => {
  it("a fit of exactly 1 counts as met and drops out of uncovered", () => {
    const verdicts = [verdict("own-budget", 1), verdict("lead-team", 0), verdict("certification", 0)];
    expect(judgedBreakdown(verdicts, AD)).toEqual({ essential: { met: 1, total: 2 }, desirable: { met: 0, total: 1 } });
    expect(judgedUncoveredRequirements(verdicts, AD).map((r) => r.id)).toEqual(["lead-team", "certification"]);
  });

  // #105 review finding 1 — THE flagship case: a full meaning match expressed in the candidate's own
  // words (never a literal 1.0 from a real model) must still close the requirement. At-or-above
  // COVERAGE_THRESHOLD counts as met even though it isn't exactly 1.
  it("a fit AT the coverage threshold counts as met — 'own phrasing counts', not only a literal 1.0", () => {
    const verdicts = [verdict("own-budget", COVERAGE_THRESHOLD), verdict("lead-team", 0), verdict("certification", 0)];
    expect(judgedBreakdown(verdicts, AD).essential.met).toBe(1);
    expect(judgedUncoveredRequirements(verdicts, AD).map((r) => r.id)).not.toContain("own-budget");
  });

  // A genuinely PARTIAL fit — the "different domain" AC — never counts as met, and stays in the
  // open list, however real the credit, short of the threshold.
  it("a partial fit BELOW the threshold (0.6, adjacent-domain evidence) does NOT count as met", () => {
    const verdicts = [verdict("own-budget", 0.6), verdict("lead-team", 0), verdict("certification", 0)];
    expect(judgedBreakdown(verdicts, AD).essential.met).toBe(0);
    expect(judgedUncoveredRequirements(verdicts, AD).map((r) => r.id)).toContain("own-budget");
  });

  it("a requirement missing a verdict entirely reads as fit 0, never throws", () => {
    const verdicts = [verdict("own-budget", 1)]; // lead-team, certification unaccounted for
    expect(judgedUncoveredRequirements(verdicts, AD).map((r) => r.id)).toEqual(["lead-team", "certification"]);
  });
});

describe("#105 judgedPickHitClause", () => {
  const facts: JudgeFact[] = [
    { id: "fact-1", text: "Owned a $2M budget with vendor oversight." },
    { id: "fact-2", text: "Led a cross-functional team of 12." },
  ];

  it("quotes the top essential requirement's own supporting fact", () => {
    const verdicts = [verdict("own-budget", 1, "fact-1"), verdict("lead-team", 0), verdict("certification", 0)];
    expect(judgedPickHitClause(verdicts, AD, facts)).toBe("Owned a $2M budget with vendor oversight.");
  });

  // #105 review: this used to jump straight to confirmedFacts[0] whenever the top essential verdict
  // named no supporting fact — quoting the user's FIRST fact regardless of relevance. It must instead
  // search across all facts (pickHitClause's own token-overlap search) the same way the deterministic
  // tick's bubble always has.
  it("searches across ALL facts for relevance, not just the first one, when no supporting fact is named", () => {
    const irrelevantFirst: JudgeFact[] = [
      { id: "fact-1", text: "Enjoys painting on weekends." }, // facts[0] — must NOT be quoted here
      { id: "fact-2", text: "Owned a $2M project budget with vendor oversight." }, // actually relevant
    ];
    const verdicts = [verdict("own-budget", 0, null), verdict("lead-team", 0), verdict("certification", 0)];
    expect(judgedPickHitClause(verdicts, AD, irrelevantFirst)).toBe(irrelevantFirst[1]!.text);
  });

  it("falls back to the first confirmed fact when nothing overlaps the top essential requirement either", () => {
    const noOverlap: JudgeFact[] = [
      { id: "fact-1", text: "Enjoys painting on weekends." },
      { id: "fact-2", text: "Also plays the guitar." },
    ];
    const verdicts = [verdict("own-budget", 0, null), verdict("lead-team", 0), verdict("certification", 0)];
    expect(judgedPickHitClause(verdicts, AD, noOverlap)).toBe(noOverlap[0]!.text);
  });

  it("falls back to the generic line with no facts at all", () => {
    const verdicts = [verdict("own-budget", 0, null), verdict("lead-team", 0), verdict("certification", 0)];
    expect(judgedPickHitClause(verdicts, AD, [])).toBe("Let's find your strongest fit.");
  });
});

// #107 (E5 slice 6, D5) — the years shortfall counts proportionately, on the JUDGED path only.
describe("#107 applyYearsShortfall", () => {
  const yearsReq: AdRequirementV1 = {
    id: "years-bar",
    band: "nice-to-have",
    eligibilityDimension: "years-experience",
    comparable: { op: ">=", value: 8 },
    requirement: "8+ years of IT experience",
    sourceSpan: "8+ years of IT experience",
  };
  const adWithYears: AdRequirementsV1 = { ...AD, requirements: [...AD.requirements, yearsReq] };

  it("leaves every verdict untouched when userYears is null (never asked) — an unknown is never a penalty", () => {
    const verdicts = [verdict("own-budget", 1), verdict("lead-team", 1), verdict("certification", 1), verdict("years-bar", 0.5)];
    expect(applyYearsShortfall(verdicts, adWithYears, null)).toEqual(verdicts);
  });

  // code-review M2: ATTENUATES the model's own fit (modelFit * min(1, years/bar)), never replaces
  // it — 0.8 (not 1) as the base fit here is what proves multiplication, not a straight replace: a
  // replace would give 0.5 regardless of the base; attenuation gives 0.8 * 0.5 = 0.4.
  it("multiplies the model's own fit by min(1, userYears/bar) — attenuates, never replaces", () => {
    const verdicts = [verdict("years-bar", 0.8)];
    const [adjusted] = applyYearsShortfall(verdicts, adWithYears, 4);
    expect(adjusted!.fit).toBeCloseTo(0.4); // 0.8 * (4/8)
  });

  // AC4's own case: 5 years and 9 years never score identically for the same non-zero model fit.
  it("5 years and 9 years never score identically, for the same non-zero model fit — neither is zero", () => {
    const modestFit = [verdict("years-bar", 0.3)]; // a real, non-zero judged read
    const five = applyYearsShortfall(modestFit, adWithYears, 5)[0]!.fit;
    const nine = applyYearsShortfall(modestFit, adWithYears, 9)[0]!.fit;
    expect(five).toBeGreaterThan(0);
    expect(nine).toBeGreaterThan(0);
    expect(five).not.toBe(nine);
    expect(five).toBeLessThan(nine);
  });

  // code-review M2's central fix: the OLD "replace" rule turned a judge's honest low fit into 1.0 for
  // anyone at or over the bar — INFLATION. The corrected rule multiplies by at most 1, so a fit at or
  // over the bar is left EXACTLY as the model scored it, never raised.
  it("leaves the model's own fit EXACTLY unmodified at or over the bar — never inflates a low judged score", () => {
    const lowJudgedFit = [verdict("years-bar", 0.2)]; // the judge scored this low on its own merits
    const nine = applyYearsShortfall(lowJudgedFit, adWithYears, 9)[0]!.fit; // >= bar (8)
    const ten = applyYearsShortfall(lowJudgedFit, adWithYears, 10)[0]!.fit; // further over the bar
    expect(nine).toBe(0.2);
    expect(ten).toBe(0.2);
  });

  it("a bar of exactly 0 leaves the verdict untouched — never divides by zero", () => {
    const zeroBarReq: AdRequirementV1 = {
      id: "years-zero-bar",
      band: "nice-to-have",
      eligibilityDimension: "years-experience",
      comparable: { op: ">=", value: 0 },
      requirement: "Any amount of experience",
      sourceSpan: "any amount of experience",
    };
    const adWithZeroBar: AdRequirementsV1 = { ...AD, requirements: [...AD.requirements, zeroBarReq] };
    const verdicts = [verdict("years-zero-bar", 0.5)];
    expect(applyYearsShortfall(verdicts, adWithZeroBar, 5)).toEqual(verdicts);
  });

  // A negative comparable.value is impossible in practice, but the oracle's `isNumber` never rules it
  // out — the multiplier must clamp to [0,1] rather than trust `years/negativeBar` (itself negative)
  // to stay in range, or `fit` could go negative and render as a negative matchPct.
  it("a negative bar never sends the fit negative — the multiplier clamps at 0", () => {
    const negativeBarReq: AdRequirementV1 = {
      ...yearsReq,
      id: "years-negative-bar",
      comparable: { op: ">=", value: -5 },
    };
    const adWithNegativeBar: AdRequirementsV1 = { ...AD, requirements: [...AD.requirements, negativeBarReq] };
    const [adjusted] = applyYearsShortfall([verdict("years-negative-bar", 0.9)], adWithNegativeBar, 5);
    expect(adjusted!.fit).toBe(0);
  });

  it("zero years fully zeroes the fit (a 0 multiplier), regardless of the model's own fit", () => {
    const [adjusted] = applyYearsShortfall([verdict("years-bar", 0.9)], adWithYears, 0);
    expect(adjusted!.fit).toBe(0);
  });

  it("leaves a non-years-experience requirement's verdict untouched", () => {
    const verdicts = [verdict("own-budget", 0.4)];
    expect(applyYearsShortfall(verdicts, adWithYears, 5)).toEqual(verdicts);
  });

  it("leaves a years-experience requirement with a '<=' or '==' bar untouched — no MINIMUM demand to score a shortfall against", () => {
    const lteReq: AdRequirementV1 = {
      id: "years-lte",
      band: "nice-to-have",
      eligibilityDimension: "years-experience",
      comparable: { op: "<=", value: 3 },
      requirement: "No more than 3 years (a junior-band role)",
      sourceSpan: "no more than 3 years",
    };
    const adWithLte: AdRequirementsV1 = { ...AD, requirements: [...AD.requirements, lteReq] };
    const verdicts = [verdict("years-lte", 0.7)];
    expect(applyYearsShortfall(verdicts, adWithLte, 5)).toEqual(verdicts);
  });

  it("leaves a years-experience requirement with no comparable bar at all untouched", () => {
    const noBarReq: AdRequirementV1 = {
      id: "years-no-bar",
      band: "nice-to-have",
      eligibilityDimension: "years-experience",
      requirement: "Some IT experience",
      sourceSpan: "some IT experience",
    };
    const adNoBar: AdRequirementsV1 = { ...AD, requirements: [...AD.requirements, noBarReq] };
    const verdicts = [verdict("years-no-bar", 0.3)];
    expect(applyYearsShortfall(verdicts, adNoBar, 5)).toEqual(verdicts);
  });

  it("leaves reason and supportingFactId untouched — only fit changes", () => {
    const verdicts = [verdict("years-bar", 0.9, "some-fact")];
    const [adjusted] = applyYearsShortfall(verdicts, adWithYears, 4);
    expect(adjusted!.supportingFactId).toBe("some-fact");
    expect(adjusted!.reason).toBe("test reason");
  });
});
