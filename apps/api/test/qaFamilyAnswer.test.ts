// #231 — the QA stack's fake labeler must speak the dialect the REAL labeler parses.
//
// Written because it didn't, and nothing noticed. When #231 changed the answer shape, qa-main.ts's
// fake kept emitting the old singular `familyId`. The real parser rejected it, retried once, and
// degraded to unmapped — so against the QA stack no job and no target role could be placed at all,
// while every CI tier stayed green (no tier drives qa-main). It took a human-paced browser drive to
// find it. This test is what makes the next shape change loud instead of dark.
//
// It deliberately goes through `place()` via the public entry points rather than parsing the JSON by
// hand: the thing that has to hold is not "this string looks right", it is "the real labeler, real
// contract and real published registry accept what this fake says".
import { describe, expect, it } from "vitest";
import { initialProductionFamilyFloors } from "../src/familyFloors.js";
import { placeJobTitle, placeTargetRole, publishedFamilies } from "../src/familyLabeler.js";
import { QA_FAMILY_ID, qaFamilyAnswer, roleFromLabelerPrompt } from "../src/qaFamilyAnswer.js";
import type { LlmClient } from "../src/llm.js";

const PUBLISHED = publishedFamilies(initialProductionFamilyFloors());

/** qa-main's own wiring, minus the server: read the role out of the prompt, answer with the fake. */
const fake: LlmClient = {
  async complete(prompt: string) {
    return qaFamilyAnswer(roleFromLabelerPrompt(prompt));
  },
};

/** One call only. Two means the first answer failed validation and was re-prompted — the exact
 *  silent degradation this file exists to catch, so it is asserted, not just implied by the outcome. */
function counting(): { llm: LlmClient; calls: () => number } {
  let calls = 0;
  return {
    llm: {
      async complete(prompt: string) {
        calls++;
        return fake.complete(prompt);
      },
    },
    calls: () => calls,
  };
}

describe("#231 the QA stack's fake labeler answers in a shape the real labeler accepts", () => {
  it("places a past job first time, with no wasted retry", async () => {
    const { llm, calls } = counting();
    const placement = await placeJobTitle("IT Project Manager", PUBLISHED, llm);

    expect(placement).toEqual({
      schemaVersion: "2",
      outcome: "confirmed",
      families: [{ familyId: QA_FAMILY_ID, version: 1 }],
      confidence: "certain",
    });
    expect(calls()).toBe(1);
  });

  it("places a target role first time too — the single-family shape accepts the same answer", async () => {
    const { llm, calls } = counting();
    const placement = await placeTargetRole("IT Project Manager", PUBLISHED, llm);

    expect(placement).toMatchObject({ outcome: "confirmed", confidence: "certain" });
    expect(calls()).toBe(1);
  });

  it("still leaves the one canned unplaced title unplaced — both ends stay walkable", async () => {
    const placement = await placeJobTitle("Project Coordinator", PUBLISHED, fake);
    expect(placement).toEqual({ schemaVersion: "2", outcome: "unmapped" });
  });

  // The fake can only ever name a family the production registry actually publishes; anything else
  // fails the closed-vocabulary check and degrades to unmapped — reintroducing the same blindness.
  it("only ever names a published family", () => {
    expect(PUBLISHED.map((family) => family.familyId)).toContain(QA_FAMILY_ID);
  });

  it("reads the role out of the prompt whatever the checkout did to line endings", () => {
    expect(roleFromLabelerPrompt("## The role to place\r\n\r\nIT Project Manager\r\n")).toBe(
      "it project manager",
    );
    expect(roleFromLabelerPrompt("## The role to place\n\nPastry Chef\n")).toBe("pastry chef");
  });
});
