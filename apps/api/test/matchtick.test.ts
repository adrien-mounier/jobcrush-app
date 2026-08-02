// #19 the instant match tick — pure-function tests (prior art: preview.test.ts). Pins the two
// properties the spec calls out: deterministic, and conservative (never decreases as the
// confirmed fact set only grows).
import { describe, expect, it } from "vitest";
import type { AdRequirementsV1 } from "@jobcrush/contracts";
import {
  matchBreakdown,
  matchTick,
  pickHitClause,
  pickOpenClause,
  uncoveredRequirements,
  type ScoredFact,
} from "../src/matchtick.js";
import { loadAdRequirements } from "../src/e5stub.js";
import {
  DERIVED_TASTE_TEST_ADS,
  TASTE_TEST_CVS,
} from "./fixtures/matchtick-taste-test.js";

const AD: AdRequirementsV1 = {
  schemaVersion: "1",
  adId: "test-ad",
  curated: true,
  language: "en",
  familyFit: { family: "IT Project Manager", confidence: 0.9 },
  requirements: [
    {
      id: "own-budget",
      band: "essential",
      requirement: "Own a project budget with vendor oversight",
      sourceSpan: "Own a project budget with vendor oversight",
    },
    {
      id: "lead-team",
      band: "essential",
      requirement: "Lead a cross-functional delivery team",
      sourceSpan: "Lead a cross-functional delivery team",
    },
    {
      id: "certification",
      band: "nice-to-have",
      requirement: "Hold a project management certification",
      sourceSpan: "Hold a project management certification",
    },
  ],
};

const NONE: ScoredFact[] = [];
const budgetFact: ScoredFact = { text: "Owned a project budget of $2M with vendor oversight." };
const teamFact: ScoredFact = { text: "Led a cross-functional delivery team across three vendors." };
const certFact: ScoredFact = { text: "Holds a PMP project management certification." };
const ONE = [budgetFact];
const TWO = [budgetFact, teamFact];
const THREE = [budgetFact, teamFact, certFact];

describe("#19 matchTick", () => {
  it("counts fully covered requirements by essential and desirable band", () => {
    expect(matchBreakdown([budgetFact, certFact], AD)).toEqual({
      essential: { met: 1, total: 2 },
      desirable: { met: 1, total: 1 },
    });
  });

  it("is deterministic — same facts + same ad yield the same score every call", () => {
    expect(matchTick(ONE, AD)).toBe(matchTick(ONE, AD));
    expect(matchTick(ONE, AD)).toBe(matchTick([...ONE], AD));
  });

  it("scores 0 with no confirmed facts and 100 once every requirement is covered", () => {
    expect(matchTick(NONE, AD)).toBe(0);
    expect(matchTick(THREE, AD)).toBe(100);
  });

  it("never decreases as the confirmed fact set only grows (the carried-risk property)", () => {
    const scores = [NONE, ONE, TWO, THREE].map((facts) => matchTick(facts, AD));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]!);
    }
    // Concretely increasing here (each fact closes a distinct requirement), not just non-decreasing.
    expect(scores[1]).toBeGreaterThan(scores[0]!);
    expect(scores[3]).toBeGreaterThan(scores[1]!);
  });

  it("stays within 0..100 regardless of how many/which facts are confirmed", () => {
    for (const facts of [NONE, ONE, TWO, THREE]) {
      const score = matchTick(facts, AD);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("adding an irrelevant fact never lowers the score (monotonic, not just growing on-topic facts)", () => {
    const irrelevant: ScoredFact = { text: "Enjoys hiking on weekends." };
    const before = matchTick(ONE, AD);
    const after = matchTick([...ONE, irrelevant], AD);
    expect(after).toBe(before);
  });

  it("rewards independent relevant evidence without combining facts to close a clause", () => {
    const requirement: AdRequirementsV1 = {
      schemaVersion: "1",
      adId: "breadth",
      curated: false,
      language: "en",
      familyFit: { family: "IT Project Manager", confidence: 0.9 },
      requirements: [
        {
          id: "commercial-ownership",
          band: "essential",
          requirement:
            "Own enterprise project budget with external vendor contract governance oversight",
          sourceSpan:
            "Own enterprise project budget with external vendor contract governance oversight",
        },
      ],
    };
    const budget = { text: "Owned enterprise project budget." };
    const vendors = { text: "Led external vendor contract governance." };
    const oneFactScore = matchTick([budget], requirement);
    const twoFactScore = matchTick([budget, vendors], requirement);

    expect(twoFactScore).toBeGreaterThan(oneFactScore);
    expect(twoFactScore).toBeLessThan(100);
    expect(uncoveredRequirements([budget, vendors], requirement)).toHaveLength(1);
  });

  it("deduplicates repeated evidence when measuring relevant breadth", () => {
    expect(matchTick([...ONE, ...ONE], AD)).toBe(matchTick(ONE, AD));
  });

  it("ignores filler differences when deduplicating the same relevant evidence", () => {
    const requirement: AdRequirementsV1 = {
      schemaVersion: "1",
      adId: "near-duplicate-breadth",
      curated: false,
      language: "en",
      familyFit: { family: "IT Project Manager", confidence: 0.9 },
      requirements: [
        {
          id: "commercial-ownership",
          band: "essential",
          requirement:
            "Own enterprise project budget with external vendor contract governance oversight",
          sourceSpan:
            "Own enterprise project budget with external vendor contract governance oversight",
        },
      ],
    };
    const alpha = { text: "Owned enterprise project budget for Alpha." };
    const fillerVariants = [
      { text: "Owned enterprise project budget for Bravo." },
      { text: "Owned enterprise project budget for Charlie." },
    ];

    expect(matchTick([alpha, ...fillerVariants], requirement)).toBe(
      matchTick([alpha], requirement),
    );
  });

  it("does not combine stray words from unrelated facts into the same fit as one coherent fact", () => {
    const requirement: AdRequirementsV1 = {
      schemaVersion: "1",
      adId: "split-evidence",
      curated: false,
      language: "en",
      familyFit: { family: "IT Project Manager", confidence: 0.9 },
      requirements: [
        {
          id: "budget-vendor",
          band: "essential",
          requirement: "Own project budget with vendor oversight",
          sourceSpan: "Own project budget with vendor oversight",
        },
      ],
    };
    const splitEvidence = [
      { text: "Scheduled project milestones." },
      { text: "Reviewed vendor invoices." },
    ];
    const coherentEvidence = [{ text: "Owned the project budget with vendor oversight." }];

    expect(matchTick(splitEvidence, requirement)).toBeLessThan(100);
    expect(uncoveredRequirements(splitEvidence, requirement)).toHaveLength(1);
    expect(matchTick(coherentEvidence, requirement)).toBe(100);
    expect(uncoveredRequirements(coherentEvidence, requirement)).toHaveLength(0);
  });

  it("allows separate coherent facts to support separate clauses of one requirement", () => {
    const requirement: AdRequirementsV1 = {
      schemaVersion: "1",
      adId: "clause-evidence",
      curated: false,
      language: "en",
      familyFit: { family: "IT Project Manager", confidence: 0.9 },
      requirements: [
        {
          id: "budget-and-vendors",
          band: "essential",
          requirement: "Own project budget and lead vendor contract negotiations",
          sourceSpan: "Own project budget and lead vendor contract negotiations",
        },
      ],
    };
    const clauseEvidence = [
      { text: "Owned the project budget." },
      { text: "Led vendor contract negotiations." },
    ];

    expect(matchTick(clauseEvidence, requirement)).toBeGreaterThan(
      matchTick([clauseEvidence[0]!], requirement),
    );
    expect(matchTick(clauseEvidence, requirement)).toBeGreaterThan(
      matchTick([clauseEvidence[1]!], requirement),
    );
    expect(matchTick(clauseEvidence, requirement)).toBe(100);
    expect(uncoveredRequirements(clauseEvidence, requirement)).toEqual([]);
  });

  it("does not promote one-word preposition fragments into independently coverable clauses", () => {
    const requirement: AdRequirementsV1 = {
      schemaVersion: "1",
      adId: "preposition-fragments",
      curated: false,
      language: "en",
      familyFit: { family: "IT Project Manager", confidence: 0.9 },
      requirements: [
        {
          id: "delivery-lifecycle",
          band: "essential",
          requirement: "Lead delivery from initiation to completion",
          sourceSpan: "Lead delivery from initiation to completion",
        },
      ],
    };
    const fragmentedEvidence = [
      { text: "Tracked delivery." },
      { text: "Recorded initiation." },
      { text: "Tracked completion." },
    ];

    expect(matchTick(fragmentedEvidence, requirement)).toBeLessThan(100);
    expect(uncoveredRequirements(fragmentedEvidence, requirement)).toHaveLength(1);
    expect(matchTick([{ text: "Led delivery from initiation to completion." }], requirement)).toBe(
      100,
    );
  });

  it("never reports 100 for a one-requirement ad while still listing that requirement as open", () => {
    for (const facts of [NONE, ONE, TWO, THREE]) {
      for (const requirement of AD.requirements) {
        const oneRequirementAd: AdRequirementsV1 = {
          ...AD,
          requirements: [requirement],
        };
        if (matchTick(facts, oneRequirementAd) === 100) {
          expect(uncoveredRequirements(facts, oneRequirementAd)).toEqual([]);
        }
      }
    }
  });
});

describe("#26 taste-test regressions", () => {
  const originalFixtureIds = [
    "2026-07-05_manulife_senior-it-project-manager-delivery-manager",
    "2026-07-05_endava-vietnam_senior-project-manager",
    "2026-07-09_luvo-talent_senior-project-manager",
  ];
  const matrix = [
    ...originalFixtureIds.map(loadAdRequirements),
    ...DERIVED_TASTE_TEST_ADS,
  ];

  it("ranks strong > average > weak on all 20 ads from the recovered taste-test matrix", () => {
    expect(matrix).toHaveLength(20);
    const failures = matrix.flatMap((ad) => {
      const strong = matchTick(TASTE_TEST_CVS.strong, ad);
      const average = matchTick(TASTE_TEST_CVS.average, ad);
      const weak = matchTick(TASTE_TEST_CVS.weak, ad);
      return strong > average && average > weak
        ? []
        : [{ adId: ad.adId, strong, average, weak }];
    });
    expect(failures).toEqual([]);
  });

  it("discriminates strong, average, and weak candidates on the recovered OKX ad", () => {
    const okx = DERIVED_TASTE_TEST_ADS.find((ad) => ad.adId === "okx")!;
    const scores = [
      matchTick(TASTE_TEST_CVS.strong, okx),
      matchTick(TASTE_TEST_CVS.average, okx),
      matchTick(TASTE_TEST_CVS.weak, okx),
    ];
    expect(new Set(scores).size).toBe(3);
  });

  it("never decreases as each taste-test fact is appended one at a time", () => {
    for (const ad of matrix) {
      for (const facts of Object.values(TASTE_TEST_CVS)) {
        const scores = Array.from({ length: facts.length + 1 }, (_, count) =>
          matchTick(facts.slice(0, count), ad),
        );
        for (let index = 1; index < scores.length; index++) {
          expect(scores[index]).toBeGreaterThanOrEqual(scores[index - 1]!);
        }
      }
    }
  });
});

describe("#19 uncoveredRequirements — the card's 'don't fit yet' list, rank order", () => {
  it("lists every requirement when nothing is confirmed, in the ad's own rank order", () => {
    expect(uncoveredRequirements(NONE, AD).map((r) => r.id)).toEqual([
      "own-budget",
      "lead-team",
      "certification",
    ]);
  });

  it("drops a requirement once a confirmed fact covers it, keeping the rest in order", () => {
    expect(uncoveredRequirements(ONE, AD).map((r) => r.id)).toEqual(["lead-team", "certification"]);
    expect(uncoveredRequirements(TWO, AD).map((r) => r.id)).toEqual(["certification"]);
    expect(uncoveredRequirements(THREE, AD)).toEqual([]);
  });
});

describe("#19 bubble clauses — cheap, deterministic composition (no LLM)", () => {
  it("pickHitClause picks the confirmed fact that matches the top 'must' requirement", () => {
    expect(pickHitClause(ONE, AD)).toBe(budgetFact.text);
  });

  it("pickHitClause falls back to a generic line with no confirmed facts", () => {
    expect(pickHitClause(NONE, AD)).toBe("Let's find your strongest fit.");
  });

  it("pickOpenClause surfaces the top-ranked uncovered requirement's own text", () => {
    expect(pickOpenClause(NONE, AD)).toBe("Own a project budget with vendor oversight");
  });

  it("pickOpenClause falls back to a generic line once everything is covered", () => {
    expect(pickOpenClause(THREE, AD)).toBe("You're covering everything we can see so far.");
  });
});
