// #105 (E5 slice 4) — the opt-in, network-gated certification of the five regression-row failure
// classes against a REAL model. judgeCards.test.ts's scripted-fake tests prove the pipeline honors
// whatever verdict it's given; only this file can show the real judge actually reaches the correct
// verdict. Skipped entirely unless ANTHROPIC_API_KEY is set — never part of the default suite (no
// network, no cost in CI), same "measurement gate, not a commit gate" split #86/#105's spec draws for
// model quality.
//
// #105 review round 3 — MUST use HOLD_OUT_REGRESSION_ROWS, never CANONICAL_REGRESSION_ROWS /
// JUDGE_REGRESSION_ROWS here: the canonical rows' evidence strings (and, for the construction row,
// its target band) are quoted or closely paraphrased as WORKED EXAMPLES inside card-judge.md itself —
// a model judged against them has already been shown the answer in its own instructions. The hold-out
// rows cover the same five failure classes in a different domain, with wording the prompt has never
// seen, so this is the only set that can actually fail when judging is wrong. See
// judge-regression-rows.ts's header for the full contamination account.
//
// Run explicitly with: ANTHROPIC_API_KEY=... pnpm --filter @jobcrush/api test judge.live
import { describe, expect, it } from "vitest";
import type { AdRequirementsV1 } from "@jobcrush/contracts";
import { judgeFacts, COVERAGE_THRESHOLD, type JudgeFact } from "../src/judge.js";
import { llmFromEnv } from "../src/llm.js";
import { HOLD_OUT_REGRESSION_ROWS } from "./fixtures/judge-regression-rows.js";

const adFor = (requirement: string): AdRequirementsV1 => ({
  schemaVersion: "1",
  adId: "live-test-ad",
  curated: false,
  language: "en",
  familyFit: { family: "IT Project Manager", confidence: 0.8 },
  requirements: [{ id: "the-req", band: "essential", kind: "ordinary", requirement, sourceSpan: requirement }],
});

describe.runIf(!!process.env.ANTHROPIC_API_KEY)("#105 live judge — the hold-out regression rows against a real model (uncontaminated)", () => {
  // #105 review, cheap fix: JUDGE_MODEL, matching main.ts's real wiring exactly — llmFromEnv() alone
  // would certify whatever model mine/preview/grill/audit use, not the model that actually judges
  // cards in production, which defeats the point of a gate slice 9 uses to CHOOSE the judging model.
  const llm = llmFromEnv(process.env.JUDGE_MODEL);

  for (const row of HOLD_OUT_REGRESSION_ROWS) {
    it(
      `${row.id}: ${row.label}`,
      async () => {
        const facts: JudgeFact[] = [{ id: "fact-1", text: row.evidence }];
        const result = await judgeFacts(adFor(row.requirement), facts, llm);
        const verdict = result.verdicts.find((v) => v.requirementId === "the-req");
        expect(verdict).toBeDefined();

        // The SAME bar production scoring uses (judgedScore.ts's COVERAGE_THRESHOLD) — a live test
        // asserting a different cutoff than the one that actually decides "covered" on a real card
        // would certify a number nothing downstream agrees with.
        if (row.expected === "covered") {
          expect(verdict!.fit, row.note).toBeGreaterThanOrEqual(COVERAGE_THRESHOLD);
        } else if (row.expected === "not-covered") {
          expect(verdict!.fit, row.note).toBeLessThanOrEqual(0.3);
        } else {
          // partial: real credit, but never scored as if it fully satisfied the requirement
          expect(verdict!.fit, row.note).toBeGreaterThan(0.25);
          expect(verdict!.fit, row.note).toBeLessThan(COVERAGE_THRESHOLD);
        }
      },
      60_000,
    );
  }
});
