// #106 — pure helpers: which eligibility dimensions discovery asks, and the answer -> store-value
// mapping. Route coverage (the API boundary, including the live family-scope value and the
// never-re-ask/correction/decline behaviour) lives in discovery.test.ts's "#106" block — per
// code-review should-fix 9 (parent spec #86's testing rule: observe behaviour through the seam,
// never reach inside), this file no longer pins resolveEligibilityFamilyScope's exact derived ids or
// its humanizer fallback directly; those are only ever consumed by the route, and the route is where
// they're tested.
import { describe, expect, it } from "vitest";
import { ANY_FAMILY } from "../src/eligibility.js";
import {
  DECLINE_OPTION,
  ELIGIBILITY_LANGUAGE,
  eligibilityCandidates,
  isEligibilityItemId,
  mapEligibilityAnswer,
  unresolvedEligibilityQuestions,
} from "../src/eligibilityDiscovery.js";
import type { ClaimRecord } from "../src/claims.js";
import { discoveryClaimId } from "../src/discovery.js";

const noFloorSession = { discovery: { floor: null, coveredItemIds: [], checkpoint: null } } as const;
const FAMILY_ID = "it-project-delivery";
const SCOPE_LABEL = "IT project delivery";
const ROLE = "IT project manager in Paris";

describe("#106 eligibilityCandidates", () => {
  const candidates = eligibilityCandidates(FAMILY_ID, ANY_FAMILY, SCOPE_LABEL, "Paris");

  it("builds exactly the three ask-set dimensions, in the UI design spec's block order", () => {
    expect(candidates.map((q) => q.eligibility?.dimension)).toEqual(["years-experience", "work-rights", "language"]);
  });

  it("every question's options end with the exact decline string, last", () => {
    for (const q of candidates) {
      expect(q.options.at(-1)).toBe(DECLINE_OPTION);
      expect(q.eligibility?.declineOption).toBe(DECLINE_OPTION);
    }
  });

  it("every itemId is namespaced so the answer route can tell it apart from a floor item", () => {
    for (const q of candidates) expect(isEligibilityItemId(q.itemId)).toBe(true);
  });

  it("years-experience carries the given family scope in both the question text and its eligibility block", () => {
    const years = candidates.find((q) => q.eligibility?.dimension === "years-experience")!;
    expect(years.eligibility).toMatchObject({ familyId: FAMILY_ID, scopeLabel: SCOPE_LABEL });
    expect(years.question).toBe(`How many years have you worked in ${SCOPE_LABEL}?`);
    expect(years.options).toEqual(["Under 3 years", "3–4 years", "5–7 years", "8–10 years", "More than 10 years", DECLINE_OPTION]);
  });

  it("years-experience falls back to the generic phrasing when scopeLabel is empty", () => {
    const [years] = eligibilityCandidates(FAMILY_ID, ANY_FAMILY, "", null);
    expect(years!.question).toBe("How many years have you worked in the kind of job you're going for?");
    expect(years!.eligibility?.scopeLabel).toBeNull();
  });

  it("work-rights is global (ANY_FAMILY, no scopeLabel) and names the given city in its question", () => {
    const workRights = candidates.find((q) => q.eligibility?.dimension === "work-rights")!;
    expect(workRights.eligibility).toMatchObject({ familyId: ANY_FAMILY, scopeLabel: null });
    expect(workRights.question).toBe("Can you already work in Paris without visa sponsorship?");
    expect(workRights.options).toEqual([
      "Yes — no sponsorship needed",
      "Not yet — I'd need sponsorship",
      DECLINE_OPTION,
    ]);
  });

  it("work-rights falls back to the generic phrasing when no city is given", () => {
    const [, workRights] = eligibilityCandidates(FAMILY_ID, ANY_FAMILY, SCOPE_LABEL, null);
    expect(workRights!.question).toBe("Can you already work where you're job-hunting, without visa sponsorship?");
  });

  // #107 (E5 slice 6, D2): language is scoped by the LANGUAGE NAME, not ANY_FAMILY — a blocking
  // requirement's eligibilitySubject ("Mandarin") is looked up against this exact scope column
  // (withdrawal.ts), so a second language answered at its own scope would never collide with this one.
  it("language names English — the only language the corpus demands — and is scoped by that name, not ANY_FAMILY", () => {
    const language = candidates.find((q) => q.eligibility?.dimension === "language")!;
    expect(language.eligibility).toMatchObject({ familyId: ELIGIBILITY_LANGUAGE, scopeLabel: null });
    expect(language.itemId).not.toBe(candidates.find((q) => q.eligibility?.dimension === "work-rights")!.itemId);
    expect(language.question).toBe(`Can you work professionally in ${ELIGIBILITY_LANGUAGE}?`);
    expect(language.options).toEqual(["Yes — I work in it", "Some, but not for work", "No, I don't", DECLINE_OPTION]);
  });

  it("certification and degree are never built — both are already asked by the live floor", () => {
    expect(candidates.some((q) => q.eligibility?.dimension === "certification")).toBe(false);
    expect(candidates.some((q) => q.eligibility?.dimension === "degree")).toBe(false);
  });
});

describe("#106 unresolvedEligibilityQuestions — never re-asked", () => {
  // Derives real itemIds from the candidates themselves (never a hand-typed copy of the naming
  // scheme) — the point of this suite is to observe closing behaviour, not to re-encode the id shape.
  const candidateItemId = (dimension: string) =>
    eligibilityCandidates(FAMILY_ID, ANY_FAMILY, SCOPE_LABEL, null).find((q) => q.eligibility?.dimension === dimension)!
      .itemId;

  const closingClaim = (itemId: string): ClaimRecord => ({
    id: discoveryClaimId(itemId),
    semantic_key: discoveryClaimId(itemId),
    field_key: null,
    field_value: null,
    field_label: null,
    role: "profile",
    text: "x",
    machine_touch: "verbatim",
    classification: "Verified",
    source_quote: "x",
    needs_grill: false,
    grill_hint: null,
    decision: "negative",
    origin: "user-authored",
  });

  it("all three are unresolved when nothing has been asked", () => {
    const qs = unresolvedEligibilityQuestions(noFloorSession, ROLE, ANY_FAMILY, null, [], [], [], []);
    expect(qs.map((q) => q.eligibility?.dimension)).toEqual(["years-experience", "work-rights", "language"]);
  });

  it("a claims-store decline (confirmed, negative, or rejected — #35's three-way union) never returns, on any bucket", () => {
    const declined = closingClaim(candidateItemId("work-rights"));
    const inConfirmed = unresolvedEligibilityQuestions(noFloorSession, ROLE, ANY_FAMILY, null, [declined], [], [], []);
    const inNegatives = unresolvedEligibilityQuestions(noFloorSession, ROLE, ANY_FAMILY, null, [], [declined], [], []);
    const inRejected = unresolvedEligibilityQuestions(noFloorSession, ROLE, ANY_FAMILY, null, [], [], [declined], []);
    for (const qs of [inConfirmed, inNegatives, inRejected]) {
      expect(qs.map((q) => q.eligibility?.dimension)).toEqual(["years-experience", "language"]);
    }
  });

  it("a stored eligibility fact (a real answer) also closes its question, with no claim involved", () => {
    // #107 (D2): language's real scope is the language name (ELIGIBILITY_LANGUAGE), not ANY_FAMILY —
    // a fact recorded at the wrong scope would never close this question (see the next test below).
    const qs = unresolvedEligibilityQuestions(noFloorSession, ROLE, ANY_FAMILY, null, [], [], [], [
      { dimension: "language", familyId: ELIGIBILITY_LANGUAGE },
    ]);
    expect(qs.map((q) => q.eligibility?.dimension)).toEqual(["years-experience", "work-rights"]);
  });

  // #107 (D2) regression: a language fact recorded at the OLD ANY_FAMILY scope (a session that
  // answered before this change) does NOT close the question — it reads as unknown and is asked
  // once more, the accepted consequence #107's own report names.
  it("a language fact recorded at the old ANY_FAMILY scope does not close the (now language-scoped) question", () => {
    const qs = unresolvedEligibilityQuestions(noFloorSession, ROLE, ANY_FAMILY, null, [], [], [], [
      { dimension: "language", familyId: ANY_FAMILY },
    ]);
    expect(qs.map((q) => q.eligibility?.dimension)).toContain("language");
  });

  it("a fact recorded for a DIFFERENT family does not close this family's years-experience question", () => {
    const qs = unresolvedEligibilityQuestions(noFloorSession, ROLE, ANY_FAMILY, null, [], [], [], [
      { dimension: "years-experience", familyId: "some-other-family" },
    ]);
    expect(qs.map((q) => q.eligibility?.dimension)).toContain("years-experience");
  });
});

describe("#106 mapEligibilityAnswer — the store's canonical value for a tapped option", () => {
  const scopeLabel = "IT project delivery";

  it("years-experience: each band maps to its LOWER bound, never a midpoint", () => {
    expect(mapEligibilityAnswer("years-experience", scopeLabel, "Under 3 years")).toEqual({
      value: "0",
      label: `Years in ${scopeLabel}`,
    });
    expect(mapEligibilityAnswer("years-experience", scopeLabel, "3–4 years")?.value).toBe("3");
    expect(mapEligibilityAnswer("years-experience", scopeLabel, "5–7 years")?.value).toBe("5");
    expect(mapEligibilityAnswer("years-experience", scopeLabel, "8–10 years")?.value).toBe("8");
    expect(mapEligibilityAnswer("years-experience", scopeLabel, "More than 10 years")?.value).toBe("10");
  });

  it("work-rights: both real options map to distinct canonical values", () => {
    expect(mapEligibilityAnswer("work-rights", scopeLabel, "Yes — no sponsorship needed")).toEqual({
      value: "eligible",
      label: "Right to work without sponsorship",
    });
    expect(mapEligibilityAnswer("work-rights", scopeLabel, "Not yet — I'd need sponsorship")).toEqual({
      value: "needs-sponsorship",
      label: "Right to work without sponsorship",
    });
  });

  it("language: all three real options map to distinct canonical values", () => {
    expect(mapEligibilityAnswer("language", scopeLabel, "Yes — I work in it")?.value).toBe("professional");
    expect(mapEligibilityAnswer("language", scopeLabel, "Some, but not for work")?.value).toBe("conversational");
    expect(mapEligibilityAnswer("language", scopeLabel, "No, I don't")?.value).toBe("none");
  });

  it("an unrecognized answer maps to null for every dimension — the route fails the write closed, not silently", () => {
    expect(mapEligibilityAnswer("years-experience", scopeLabel, "about 8 years")).toBeNull();
    expect(mapEligibilityAnswer("work-rights", scopeLabel, "Maybe")).toBeNull();
    expect(mapEligibilityAnswer("language", scopeLabel, "Fluent")).toBeNull();
  });

  it("the decline option itself never maps to a value, on any dimension", () => {
    expect(mapEligibilityAnswer("years-experience", scopeLabel, DECLINE_OPTION)).toBeNull();
    expect(mapEligibilityAnswer("work-rights", scopeLabel, DECLINE_OPTION)).toBeNull();
    expect(mapEligibilityAnswer("language", scopeLabel, DECLINE_OPTION)).toBeNull();
  });

  it("no option label is a bare 'no' that isNoAnswer() would mis-route — every negative label is deliberately longer", () => {
    const bareNo = /^no[.!]?$/i;
    expect(bareNo.test("Not yet — I'd need sponsorship")).toBe(false);
    expect(bareNo.test("No, I don't")).toBe(false);
  });
});
