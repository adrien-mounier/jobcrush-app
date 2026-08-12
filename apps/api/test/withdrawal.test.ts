// #107 (E5 slice 6, D3) — withdrawal.ts's own pure-function tests, in ADDITION to (never instead of)
// the HTTP boundary proof in cards.test.ts (spec #86's primary testing seam, and AC5's own explicit
// "the test observes the card's absence from the deck through the API, not an internal predicate").
// These exist only to pin the predicate's exact three-condition shape at low cost per case; every
// user-visible AC still gets its own boundary test.
import { describe, expect, it } from "vitest";
import type { AdRequirementsV1 } from "@jobcrush/contracts";
import type { EligibilityFact } from "../src/eligibility.js";
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

// #165: the language "no" is now the ladder's own bottom rung — a value a person can only reach by
// deliberately tapping "I don't speak this one". The pre-#165 "none" (which an UNTICKED checkbox
// wrote for them) no longer withdraws anything; that regression has its own case below.
const fact = (over: Partial<EligibilityFact>): EligibilityFact => ({
  dimension: "language",
  familyId: "Mandarin",
  value: "not-at-all",
  label: "Mandarin — I don't speak this one",
  ...over,
});

describe("#107 findWithdrawingRequirement", () => {
  it("withdraws on a blocking requirement with an explicit 'no' at the matching (dimension, subject) scope", () => {
    const req = findWithdrawingRequirement(ad(), [fact({ value: "not-at-all" })]);
    expect(req?.id).toBe("mandarin-required");
  });

  // The spec's own second regression case: "conversational" ("Some, but not for work") is not "I
  // don't speak it" and must never withdraw.
  it("does not withdraw on 'conversational' — only the ladder's own bottom rung counts", () => {
    expect(findWithdrawingRequirement(ad(), [fact({ value: "conversational" })])).toBeNull();
  });

  // 🚨 #165 AC2, the live bug this ticket exists to kill. #123's tick-list wrote "none" for every
  // language the person left UNTICKED, and this predicate read that as "I don't speak it" — so one
  // mistap removed real jobs. Under the ladder no silence writes anything, and every fact left over
  // from the old shape reads as unknown. If this test ever goes green-to-red, the mistap is back.
  it("does not withdraw on a pre-#165 'none' — an unticked box is not an answer", () => {
    expect(findWithdrawingRequirement(ad(), [fact({ value: "none" })])).toBeNull();
  });

  it("does not withdraw on a pre-#165 'professional' either — an old answer is not a level", () => {
    expect(findWithdrawingRequirement(ad(), [fact({ value: "professional" })])).toBeNull();
  });

  // ADR-0003 clause 8(a), stated as a test: "being below the bar never withdraws a job". Every rung
  // above the bottom one leaves the posting in the deck, however demanding the advert is.
  it("does not withdraw on ANY rung above the bottom one — below the bar is not a no", () => {
    for (const rung of ["everyday", "work", "meetings", "negotiate", "declared"]) {
      expect(findWithdrawingRequirement(ad(), [fact({ value: rung })])).toBeNull();
    }
  });

  it("does not withdraw when no fact exists at all — unknown is never a no", () => {
    expect(findWithdrawingRequirement(ad(), [])).toBeNull();
  });

  it("does not withdraw when a fact exists for a DIFFERENT subject — Mandarin is not English", () => {
    const facts = [fact({ familyId: "English", value: "not-at-all" })];
    expect(findWithdrawingRequirement(ad(), facts)).toBeNull();
  });

  it("does not withdraw an 'ordinary' requirement, however explicit the recorded 'no' is", () => {
    const advertisement = ad({
      requirements: [{ ...ad().requirements[0]!, kind: "ordinary" }],
    });
    expect(findWithdrawingRequirement(advertisement, [fact({ value: "not-at-all" })])).toBeNull();
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
    expect(
      findWithdrawingRequirement(advertisement, [fact({ familyId: "Mandarin", value: "not-at-all" })]),
    ).toBeNull();
  });

  // #182 resolves code-review M1: work-rights now reads at `market`, the caller's own current place
  // (routes/onboarding.ts derives it via discovery.ts's parseCity(role), the same city the question
  // is worded about) — passed as findWithdrawingRequirement's third argument, never resolved inside
  // this pure function.
  const workRightsAd = () =>
    ad({
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

  it("work-rights never withdraws with no market given (M1's original safety net, still true)", () => {
    // A caller that never learned the visitor's place (or predates #182) passes no third argument —
    // scopeFor's own doc: null market must never fall back to ANY_FAMILY or any other scope.
    for (const value of ["needs-sponsorship", "eligible"]) {
      const facts = [{ dimension: "work-rights" as const, familyId: "Hong Kong", value, label: "Right to work" }];
      expect(findWithdrawingRequirement(workRightsAd(), facts)).toBeNull();
    }
  });

  it("#182 AC: withdraws on an explicit 'no' stored for the SAME market gating is running for", () => {
    const facts = [
      { dimension: "work-rights" as const, familyId: "Hong Kong", value: "needs-sponsorship", label: "Right to work" },
    ];
    expect(findWithdrawingRequirement(workRightsAd(), facts, "Hong Kong")?.id).toBe("work-rights-required");
  });

  it("#182 AC3: a conflicting answer stored for a DIFFERENT market has no effect on this market's gate", () => {
    // The falsifiable check from #180/#182: a Paris "no" must never gate a Hong Kong deck.
    const facts = [
      { dimension: "work-rights" as const, familyId: "Paris", value: "needs-sponsorship", label: "Right to work" },
    ];
    expect(findWithdrawingRequirement(workRightsAd(), facts, "Hong Kong")).toBeNull();
  });

  it("#182 AC4: an unanswered market reads unknown and never withdraws, even with facts stored for other markets", () => {
    const facts = [
      { dimension: "work-rights" as const, familyId: "Paris", value: "needs-sponsorship", label: "Right to work" },
      { dimension: "work-rights" as const, familyId: "Hong Kong", value: "eligible", label: "Right to work" },
    ];
    expect(findWithdrawingRequirement(workRightsAd(), facts, "Singapore")).toBeNull();
  });

  it("#182: matches the market case-insensitively and trimmed, same as language/certification scope", () => {
    const facts = [
      { dimension: "work-rights" as const, familyId: " Hong Kong ", value: "needs-sponsorship", label: "Right to work" },
    ];
    expect(findWithdrawingRequirement(workRightsAd(), facts, "hong kong")?.id).toBe("work-rights-required");
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
    const facts = [fact({ familyId: "Cantonese", value: "not-at-all" }), fact({ value: "not-at-all" })];
    expect(findWithdrawingRequirement(advertisement, facts)?.id).toBe("cantonese-required");
  });

  // code-review M4: trimmed + case-folded on both sides — a model emitting "mandarin" (lowercase) or
  // " Mandarin " (whitespace) must still match the store's canonical "Mandarin" scope.
  it("matches the subject scope case-insensitively and trimmed (M4)", () => {
    for (const familyId of ["mandarin", " Mandarin ", "MANDARIN"]) {
      expect(findWithdrawingRequirement(ad(), [fact({ familyId, value: "not-at-all" })])?.id).toBe(
        "mandarin-required",
      );
    }
  });
});
