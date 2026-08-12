// #154 — the owner's own BRED case, pinned.
//
// A role with 14 mined facts, four of them carrying a result, squeezed into a draft that cannot
// print them all: the tailor merged four bullets into one line, kept every keyword, and killed
// every outcome clause (514 characters -> 172). Nothing in the pipeline noticed, because
// conservationIssues() counted classes of fact and a merge preserves the class.
//
// These tests pin the arbitration decided in docs/cv-brain/cv-authoring-rules.md ("A merged bullet
// must keep a result, and the result must print"), and the disclosure that carries what the rule
// deliberately does not prevent — it guarantees ONE surviving result per line, not all of them.
import { describe, expect, it } from "vitest";
import { conservationIssues, Draft, draftDisclosure, tailorDraft } from "../src/preview.js";
import type { LlmClient } from "../src/llm.js";
import { bredClaims, BRED_POSTING } from "./fixtures/bred-dense-role.js";

/** A BRED draft whose one printed bullet is built from `claimIds` and declares `outcome`. */
function bredDraft(
  claimIds: string[],
  outcome: string,
  text: string,
  unprinted: string[] = [],
): Draft {
  return {
    name: "Adrien Mounier",
    headline: "Card services delivery",
    contact: "Phnom Penh",
    summary: "",
    experience: [
      {
        role: "Card Services Manager",
        employer: "BRED",
        location: "Phnom Penh",
        dates: "Mar 2021 - Present",
        bullets: [{ text, outcome, claimIds }],
        unprinted,
      },
    ],
    skills: [{ label: "Delivery", items: ["Card services"] }],
    certifications: [],
    education: [],
    additional: [],
  };
}

const MERGED_SCOPE_LIST =
  "Led PIN-code authentication and self-service card activation across retail card services.";

const llmReturning = (json: unknown): LlmClient => ({ complete: async () => JSON.stringify(json) });

describe("#154 a merged bullet must keep a result, and the result must print", () => {
  it("passes a merged bullet whose declared outcome is in the printed text", () => {
    const issues = conservationIssues(
      bredClaims(),
      bredDraft(
        ["bred-pin-rollout", "bred-self-service"],
        "strengthening customer security",
        "Led the PIN-code authentication rollout across retail card services, strengthening customer security.",
      ),
    );
    expect(issues).toEqual([]);
  });

  it("flags a merged bullet that declares no outcome — the scope-list failure #154 reported", () => {
    const issues = conservationIssues(
      bredClaims(),
      bredDraft(["bred-pin-rollout", "bred-self-service"], "", MERGED_SCOPE_LIST),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("declares no surviving outcome");
    expect(issues[0]!.visitor).toContain("keep what they achieved");
  });

  it("flags a declared outcome that never reaches the printed line", () => {
    // The decorative-field failure. Checking that the field is FILLED IN, instead of that its words
    // are IN the sentence, would pass this — a clean outcome in the data, a scope list on the page,
    // and nothing changed for the employer reading it.
    const issues = conservationIssues(
      bredClaims(),
      bredDraft(
        ["bred-pin-rollout", "bred-self-service"],
        "strengthening customer security",
        MERGED_SCOPE_LIST,
      ),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("is not in the bullet's own text");
  });

  it("leaves a single-claim bullet alone with an empty outcome", () => {
    expect(
      conservationIssues(
        bredClaims(),
        bredDraft(
          ["bred-pin-rollout"],
          "",
          "Led the PIN-code authentication rollout for retail cards.",
        ),
      ),
    ).toEqual([]);
  });

  it("tolerates three claims in one line, and warns at four", () => {
    // The rule is two; the alarm is four. Atomic mining splits one CV sentence into several claims,
    // so a line honestly drawing on three is common — and a false warning costs the reader's trust
    // in every true one.
    expect(
      conservationIssues(
        bredClaims(),
        bredDraft(
          ["bred-pin-rollout", "bred-self-service", "bred-duty-1"],
          "strengthening customer security",
          "Led card services across the retail portfolio, strengthening customer security.",
        ),
      ),
    ).toEqual([]);

    const four = conservationIssues(
      bredClaims(),
      bredDraft(
        ["bred-pin-rollout", "bred-self-service", "bred-duty-1", "bred-lao-forex"],
        "strengthening customer security",
        "Led card services across the retail portfolio, strengthening customer security.",
      ),
    );
    expect(four).toHaveLength(1);
    expect(four[0]!.message).toContain("The rule is two");
    expect(four[0]!.visitor).toContain("loses detail");
  });

  it("raises exactly one issue for a line that trips both rules", () => {
    // Two pushes would put two near-identical warnings on one screen about one sentence.
    expect(
      conservationIssues(
        bredClaims(),
        bredDraft(
          ["bred-pin-rollout", "bred-self-service", "bred-lao-forex", "bred-fraud-rules"],
          "",
          MERGED_SCOPE_LIST,
        ),
      ),
    ).toHaveLength(1);
  });
});

describe("#154 the person is shown what the rule could not prevent", () => {
  const acceptanceDraft = () =>
    bredDraft(
      ["bred-pin-rollout", "bred-self-service", "bred-lao-forex", "bred-fraud-rules"],
      "",
      MERGED_SCOPE_LIST,
      ["bred-duty-1", "bred-duty-2", "bred-duty-3", "bred-duty-4", "bred-duty-5", "bred-duty-6"],
    );

  it("the acceptance case: 14 facts, four outcome-bearing, top line carries no result", () => {
    const claims = bredClaims();
    expect(claims.claims).toHaveLength(14);
    expect(conservationIssues(claims, acceptanceDraft())).not.toEqual([]);
  });

  it("discloses the loss in the profile's own words, never a slug and never shortened", () => {
    const [block] = draftDisclosure(bredClaims(), acceptanceDraft());
    expect(block).toBeDefined();
    expect(block!.employer).toBe("BRED");
    expect(block!.factCount).toBe(14);
    expect(block!.heldBack).toHaveLength(6);
    expect(block!.heldBack[0]).toBe(
      "Managed card services workstream 1 across the retail portfolio.",
    );
    expect(block!.overfull).toHaveLength(1);
    expect(block!.overfull[0]!.count).toBe(4);
    expect(block!.overfull[0]!.lostResult).toBe(true);
    expect(block!.overfull[0]!.sources).toContain(
      "Led the PIN-code authentication rollout for retail cards, strengthening customer security.",
    );
  });

  it("says nothing about a job that printed everything it had", () => {
    // "Your profile holds N facts, they cannot all print" is a false statement about a clean job.
    expect(
      draftDisclosure(
        bredClaims(),
        bredDraft(
          ["bred-pin-rollout"],
          "",
          "Led the PIN-code authentication rollout for retail cards.",
        ),
      ),
    ).toEqual([]);
  });

  it("ships the CV and keeps the #154 warning out of the notices — the block is its surface", async () => {
    const lossy = bredDraft(["bred-pin-rollout", "bred-self-service"], "", MERGED_SCOPE_LIST);
    const result = await tailorDraft(bredClaims(), BRED_POSTING as never, llmReturning(lossy));
    // A person whose CV is all duties must still get a CV: the lossy lane, never the error page.
    expect(result.draft.experience[0]!.bullets[0]!.text).toBe(MERGED_SCOPE_LIST);
    // And the same sentence must not also appear as a loose notice above the block that says it
    // better, with their own wording beside it.
    expect(result.conservationNotices).toEqual([]);
  });
});
