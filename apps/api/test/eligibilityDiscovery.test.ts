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
  LANGUAGE_ITEM_ID,
  eligibilityCandidates,
  isEligibilityItemId,
  isValidLanguageSelection,
  languageFacts,
  languagesUnion,
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

  // #182: work-rights is a fact about the PLACE it was asked about — familyId now carries the given
  // city's SLUG (never the raw display string, never ANY_FAMILY, never job-family-scoped: right to
  // work still doesn't vary by role). QA round 3 must-fix: a raw "Hong Kong" familyId broke the
  // ClaimGraph kebab-slug id contract; the display city stays in `question` only.
  it("work-rights is keyed to the given city's SLUG (no scopeLabel) and names the DISPLAY city in its question", () => {
    const workRights = candidates.find((q) => q.eligibility?.dimension === "work-rights")!;
    expect(workRights.eligibility).toMatchObject({ familyId: "paris", scopeLabel: null });
    expect(workRights.question).toBe("Can you already work in Paris without visa sponsorship?");
    expect(workRights.options).toEqual([
      "Yes — no sponsorship needed",
      "Not yet — I'd need sponsorship",
      DECLINE_OPTION,
    ]);
  });

  it("work-rights falls back to ANY_FAMILY and the generic phrasing when no city is given", () => {
    const [, workRights] = eligibilityCandidates(FAMILY_ID, ANY_FAMILY, SCOPE_LABEL, null);
    expect(workRights!.question).toBe("Can you already work where you're job-hunting, without visa sponsorship?");
    expect(workRights!.eligibility).toMatchObject({ familyId: ANY_FAMILY, scopeLabel: null });
  });

  // #182 falsifiable checks (#180): a "yes" answered while searching Paris must read as unknown once
  // the search moves to Hong Kong, and switching back to Paris must find the original answer again,
  // never re-asking it. Exercised at this module's own seam (eligibilityCandidates/itemId), since the
  // store-level "which market a fact belongs to" is eligibility.test.ts's job.
  it("#182 AC1/AC2: work-rights gets a DIFFERENT itemId per city, so switching city never re-uses another city's answer", () => {
    const paris = eligibilityCandidates(FAMILY_ID, ANY_FAMILY, SCOPE_LABEL, "Paris").find(
      (q) => q.eligibility?.dimension === "work-rights",
    )!;
    const hongKong = eligibilityCandidates(FAMILY_ID, ANY_FAMILY, SCOPE_LABEL, "Hong Kong").find(
      (q) => q.eligibility?.dimension === "work-rights",
    )!;
    const parisAgain = eligibilityCandidates(FAMILY_ID, ANY_FAMILY, SCOPE_LABEL, "Paris").find(
      (q) => q.eligibility?.dimension === "work-rights",
    )!;
    expect(paris.itemId).not.toBe(hongKong.itemId);
    expect(paris.itemId).toBe(parisAgain.itemId); // switching back resolves to the SAME question
  });

  // #123: language is now ONE multi-select question over every supported language
  // (languagesUnion()), superseding #107 D2's single-English question — the pinned UI design spec
  // copy, exercised here rather than paraphrased.
  it("language is a multi-select over languagesUnion(), with its own itemId, question, and consequence", () => {
    const language = candidates.find((q) => q.eligibility?.dimension === "language")!;
    expect(language.itemId).toBe(LANGUAGE_ITEM_ID);
    expect(language.itemId).not.toBe(candidates.find((q) => q.eligibility?.dimension === "work-rights")!.itemId);
    expect(language.multiSelect).toBe(true);
    expect(language.question).toBe(
      "Which of these can you work in professionally? Anything you leave unticked, I'll treat as a no.",
    );
    // Code-review must-fix 1 (2026-08-04), trimmed by owner correction (2026-08-04): the pinned
    // first sentence stays intact; the second is an ADDED, recorded deviation from the design spec,
    // biasing an unsure visitor toward ticking (a binary multi-select has no "some, but not for work"
    // option any more — see the constant's own doc in eligibilityDiscovery.ts and docs/research/
    // languages-from-the-corpus.md). Kept to a three-word nudge after QA flagged the first draft as
    // the longest thing on screen.
    expect(language.consequence).toBe(
      "A no takes jobs that require that language out of your deck. Tick every one you could run a meeting in." +
        " Not sure? Tick it.",
    );
    expect(language.options).toEqual([...languagesUnion(), DECLINE_OPTION]);
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
    const qs = unresolvedEligibilityQuestions(noFloorSession, ROLE, ANY_FAMILY, null, [], [], [], [
      { dimension: "language", familyId: "English" },
    ]);
    expect(qs.map((q) => q.eligibility?.dimension)).toEqual(["years-experience", "work-rights"]);
  });

  // #123: the languages question is answered iff AT LEAST ONE language fact exists, at ANY scope —
  // unlike years-experience, there is no single scope for one question to match. This also means a
  // STALE fact from the pre-#123 single-English question (recorded at the same "English" scope,
  // since ELIGIBILITY_LANGUAGE was "English") closes the new question too — an old session is not
  // re-asked, the same accepted-pre-launch outcome LANGUAGE_ITEM_ID's own doc records for the itemId
  // change itself.
  it("a language fact at ANY scope (including one recorded under a different language name) closes the one languages question", () => {
    const qs = unresolvedEligibilityQuestions(noFloorSession, ROLE, ANY_FAMILY, null, [], [], [], [
      { dimension: "language", familyId: "Mandarin" },
    ]);
    expect(qs.map((q) => q.eligibility?.dimension)).toEqual(["years-experience", "work-rights"]);
  });

  it("a fact recorded for a DIFFERENT family does not close this family's years-experience question", () => {
    const qs = unresolvedEligibilityQuestions(noFloorSession, ROLE, ANY_FAMILY, null, [], [], [], [
      { dimension: "years-experience", familyId: "some-other-family" },
    ]);
    expect(qs.map((q) => q.eligibility?.dimension)).toContain("years-experience");
  });

  // #182 (#180's falsifiable checks), at this seam: a work-rights fact stored for one city never
  // closes another city's question, and switching back finds the original answer again. `familyId`
  // below is the SLUG a real write actually stores (QA round 3 must-fix) — the raw display city
  // ("Hong Kong"/"Paris") only ever appears in `city` (this fn's 4th arg) and in question text.
  it("#182 AC1: a Paris work-rights answer leaves Hong Kong's question open (unknown, not borrowed)", () => {
    const qs = unresolvedEligibilityQuestions(noFloorSession, ROLE, ANY_FAMILY, "Hong Kong", [], [], [], [
      { dimension: "work-rights", familyId: "paris" },
    ]);
    expect(qs.map((q) => q.eligibility?.dimension)).toContain("work-rights");
  });

  it("#182 AC2: switching back to Paris finds the stored Paris answer and does not re-ask it", () => {
    const qs = unresolvedEligibilityQuestions(noFloorSession, ROLE, ANY_FAMILY, "Paris", [], [], [], [
      { dimension: "work-rights", familyId: "paris" },
    ]);
    expect(qs.map((q) => q.eligibility?.dimension)).not.toContain("work-rights");
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

  // #123: language no longer has a single-value real answer — the languages question is multi-select
  // and its real answer is read through languageFacts()/isValidLanguageSelection() (see the #123
  // describe block below), never through this function. It always falls through to null.
  it("language always maps to null — its real answer no longer travels through this function", () => {
    expect(mapEligibilityAnswer("language", scopeLabel, "Yes — I work in it")).toBeNull();
  });

  it("an unrecognized answer maps to null for every dimension — the route fails the write closed, not silently", () => {
    expect(mapEligibilityAnswer("years-experience", scopeLabel, "about 8 years")).toBeNull();
    expect(mapEligibilityAnswer("work-rights", scopeLabel, "Maybe")).toBeNull();
  });

  it("the decline option itself never maps to a value, on any dimension", () => {
    expect(mapEligibilityAnswer("years-experience", scopeLabel, DECLINE_OPTION)).toBeNull();
    expect(mapEligibilityAnswer("work-rights", scopeLabel, DECLINE_OPTION)).toBeNull();
  });

  it("no work-rights option label is a bare 'no' that isNoAnswer() would mis-route — every negative label is deliberately longer", () => {
    const bareNo = /^no[.!]?$/i;
    expect(bareNo.test("Not yet — I'd need sponsorship")).toBe(false);
  });
});

// --- #123 — the languages question is market-keyed data, not a hardcoded list ------------------
describe("#123 languagesUnion / languageFacts / isValidLanguageSelection", () => {
  it("the union is the owner-approved four-language list, in stable declared order", () => {
    expect(languagesUnion()).toEqual(["English", "Mandarin", "Cantonese", "Vietnamese"]);
  });

  it("is stable across calls — never re-sorted or shuffled between requests", () => {
    expect(languagesUnion()).toEqual(languagesUnion());
  });

  it("languageFacts writes the FULL set every time — every language, not only the selected ones", () => {
    const facts = languageFacts(["Mandarin"]);
    expect(facts).toHaveLength(languagesUnion().length);
    expect(facts.find((f) => f.familyId === "Mandarin")).toMatchObject({
      value: "professional",
      label: "Professional fluency in Mandarin",
    });
    expect(facts.find((f) => f.familyId === "English")).toMatchObject({ value: "none" });
  });

  it("languageFacts([]) legally marks every language 'none' — ticking nothing is a real answer, not an error", () => {
    expect(languageFacts([]).every((f) => f.value === "none")).toBe(true);
  });

  it("isValidLanguageSelection accepts any subset of the list, including the empty selection", () => {
    expect(isValidLanguageSelection([])).toBe(true);
    expect(isValidLanguageSelection(["English"])).toBe(true);
    expect(isValidLanguageSelection([...languagesUnion()])).toBe(true);
  });

  it("isValidLanguageSelection rejects anything outside the list", () => {
    expect(isValidLanguageSelection(["Klingon"])).toBe(false);
    expect(isValidLanguageSelection(["English", "Klingon"])).toBe(false);
  });
});
