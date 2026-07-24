// #19 the instant match tick — pure-function tests (prior art: preview.test.ts). Pins the two
// properties the spec calls out: deterministic, and conservative (never decreases as the
// confirmed fact set only grows).
import { describe, expect, it } from "vitest";
import type { AdRequirements } from "@jobcrush/contracts";
import {
  matchTick,
  pickHitClause,
  pickOpenClause,
  uncoveredRequirements,
  type ScoredFact,
} from "../src/matchtick.js";

const AD: AdRequirements = {
  schemaVersion: "0",
  adId: "test-ad",
  requirements: [
    { id: "own-budget", band: "must", requirement: "Own a project budget with vendor oversight" },
    { id: "lead-team", band: "must", requirement: "Lead a cross-functional delivery team" },
    { id: "certification", band: "nice", requirement: "Hold a project management certification" },
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
    expect(after).toBeGreaterThanOrEqual(before);
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
