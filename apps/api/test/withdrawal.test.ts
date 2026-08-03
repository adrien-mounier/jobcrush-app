// #107 (E5 slice 6, D3) — withdrawal.ts's own pure-function tests, in ADDITION to (never instead of)
// the HTTP boundary proof in cards.test.ts (spec #86's primary testing seam, and AC5's own explicit
// "the test observes the card's absence from the deck through the API, not an internal predicate").
// These exist only to pin the predicate's exact three-condition shape at low cost per case; every
// user-visible AC still gets its own boundary test.
import { describe, expect, it } from "vitest";
import type { AdRequirementsV1 } from "@jobcrush/contracts";
import { ANY_FAMILY, type EligibilityFact } from "../src/eligibility.js";
import { findWithdrawingRequirement } from "../src/withdrawal.js";

const ad = (over: Partial<AdRequirementsV1> = {}): AdRequirementsV1 => ({
  schemaVersion: "1",
  adId: "test-ad",
  curated: false,
  language: "en",
  familyFit: { family: "IT Project Manager", confidence: 0.9 },
  requirements: [
    {
      id: "mandarin-required",
      band: "essential",
      kind: "blocking",
      requirement: "Fluent Mandarin required",
      eligibilityDimension: "language",
      eligibilitySubject: "Mandarin",
      sourceSpan: "Fluent Mandarin is required",
    },
  ],
  ...over,
});

const fact = (over: Partial<EligibilityFact>): EligibilityFact => ({
  dimension: "language",
  familyId: "Mandarin",
  value: "none",
  label: "Professional fluency in Mandarin",
  ...over,
});

describe("#107 findWithdrawingRequirement", () => {
  it("withdraws on a blocking requirement with an explicit 'no' at the matching (dimension, subject) scope", () => {
    const req = findWithdrawingRequirement(ad(), [fact({ value: "none" })]);
    expect(req?.id).toBe("mandarin-required");
  });

  // The spec's own second regression case: "conversational" ("Some, but not for work") is not "I
  // don't speak it" and must never withdraw.
  it("does not withdraw on 'conversational' — only an explicit 'none' counts", () => {
    expect(findWithdrawingRequirement(ad(), [fact({ value: "conversational" })])).toBeNull();
  });

  it("does not withdraw when no fact exists at all — unknown is never a no", () => {
    expect(findWithdrawingRequirement(ad(), [])).toBeNull();
  });

  it("does not withdraw when a fact exists for a DIFFERENT subject — Mandarin is not English", () => {
    const facts = [fact({ familyId: "English", value: "none" })];
    expect(findWithdrawingRequirement(ad(), facts)).toBeNull();
  });

  it("does not withdraw an 'ordinary' requirement, however explicit the recorded 'no' is", () => {
    const advertisement = ad({
      requirements: [{ ...ad().requirements[0]!, kind: "ordinary" }],
    });
    expect(findWithdrawingRequirement(advertisement, [fact({ value: "none" })])).toBeNull();
  });

  // #107 D1's own safety net: a blocking language/certification requirement with NO
  // eligibilitySubject (a fixture predating #107, or a reader output the clamp somehow missed) can
  // never withdraw anything — there is no safe way to know WHICH subject is meant.
  it("does not withdraw a blocking language requirement with no eligibilitySubject at all", () => {
    const advertisement = ad({
      requirements: [{ ...ad().requirements[0]!, eligibilitySubject: undefined }],
    });
    // Even a matching-dimension fact at a plausible scope must not fire — there is nothing to match
    // it against.
    expect(findWithdrawingRequirement(advertisement, [fact({ familyId: "Mandarin", value: "none" })])).toBeNull();
  });

  it("work-rights never withdraws, on any value (M1) — no visitor-location fact exists to scope it safely", () => {
    const advertisement = ad({
      requirements: [
        {
          id: "work-rights-required",
          band: "essential",
          kind: "blocking",
          requirement: "Right to work required",
          eligibilityDimension: "work-rights",
          sourceSpan: "must already have the right to work",
        },
      ],
    });
    // code-review M1: work-rights can NEVER withdraw — the discovery answer is stored globally
    // (ANY_FAMILY) but the QUESTION is city-scoped, so there is no visitor-location fact to tell
    // apart "can't work in Hong Kong" from "can't work in Australia" (see scopeFor's own doc). An
    // explicit "no" here must still leave the posting in the deck, on every value.
    for (const value of ["needs-sponsorship", "eligible"]) {
      const facts = [{ dimension: "work-rights" as const, familyId: ANY_FAMILY, value, label: "Right to work" }];
      expect(findWithdrawingRequirement(advertisement, facts)).toBeNull();
    }
  });

  // certification is wired through the predicate (D3: "don't special-case it away") even though no
  // product surface today ever writes a certification eligibility fact — condition 2 (no stored fact)
  // already keeps this from ever firing in practice.
  it("certification never withdraws today — no product surface ever records a certification fact", () => {
    const advertisement = ad({
      requirements: [
        {
          id: "pmp-required",
          band: "essential",
          kind: "blocking",
          requirement: "PMP certification required",
          eligibilityDimension: "certification",
          eligibilitySubject: "PMP",
          sourceSpan: "must hold a valid PMP certification",
        },
      ],
    });
    // Even if something DID write a fact here, isExplicitNo("certification", …) is always false.
    const facts = [{ dimension: "certification" as const, familyId: "PMP", value: "none", label: "PMP" }];
    expect(findWithdrawingRequirement(advertisement, facts)).toBeNull();
  });

  it("returns the FIRST withdrawing requirement in the advert's own rank order when more than one qualifies", () => {
    const advertisement = ad({
      requirements: [
        {
          id: "cantonese-required",
          band: "essential",
          kind: "blocking",
          requirement: "Fluent Cantonese required",
          eligibilityDimension: "language",
          eligibilitySubject: "Cantonese",
          sourceSpan: "Fluent Cantonese is required",
        },
        { ...ad().requirements[0]! }, // mandarin-required
      ],
    });
    const facts = [fact({ familyId: "Cantonese", value: "none" }), fact({ value: "none" })];
    expect(findWithdrawingRequirement(advertisement, facts)?.id).toBe("cantonese-required");
  });

  // code-review M4: trimmed + case-folded on both sides — a model emitting "mandarin" (lowercase) or
  // " Mandarin " (whitespace) must still match the store's canonical "Mandarin" scope.
  it("matches the subject scope case-insensitively and trimmed (M4)", () => {
    for (const familyId of ["mandarin", " Mandarin ", "MANDARIN"]) {
      expect(findWithdrawingRequirement(ad(), [fact({ familyId, value: "none" })])?.id).toBe("mandarin-required");
    }
  });
});
