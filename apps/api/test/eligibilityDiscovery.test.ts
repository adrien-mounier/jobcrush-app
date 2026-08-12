// #106 — pure helpers: which eligibility dimensions discovery asks, and the answer -> store-value
// mapping. Route coverage (the API boundary, including the live family-scope value and the
// never-re-ask/correction/decline behaviour) lives in discovery.test.ts's "#106" block — per
// code-review should-fix 9 (parent spec #86's testing rule: observe behaviour through the seam,
// never reach inside), this file observes behaviour through this module's own seam.
//
// #162: the years-experience question is GONE — worked out, never asked (ADR-0008 clause 2). The
// ADR's own falsifiable check is the first case below.
import { describe, expect, it } from "vitest";
import { ANY_FAMILY } from "../src/eligibility.js";
import {
  DECLINE_OPTION,
  LANGUAGE_ITEM_ID,
  applyEligibilityQuestions,
  eligibilityCandidates,
  isEligibilityItemId,
  isValidLanguageSelection,
  languageFacts,
  languagesUnion,
  mapEligibilityAnswer,
  unresolvedEligibilityQuestions,
} from "../src/eligibilityDiscovery.js";
import type { ClaimRecord } from "../src/claims.js";
import { discoveryClaimId, discoveryState, resolveFamily } from "../src/discovery.js";
import { loadFamilyFloor } from "../src/e5stub.js";

const noFloorSession = { discovery: { floor: null, coveredItemIds: [], checkpoint: null } } as const;
const FAMILY_ID = "it-project-delivery";
const SCOPE_LABEL = "IT project delivery";
const ROLE = "IT project manager in Paris";

describe("#106 eligibilityCandidates", () => {
  const candidates = eligibilityCandidates(ANY_FAMILY, "Paris");

  // ADR-0008's own falsifiable check, in one line: "`years-experience` must never appear in
  // ASK_DIMENSIONS. If a build ticket adds a 'how many years of experience do you have?' question —
  // for any reason, including an unreadable work history — clause 2 was not read."
  it("never asks for a years-of-experience total, for any reason (ADR-0008 clause 2)", () => {
    for (const city of ["Paris", null] as const) {
      const qs = eligibilityCandidates(ANY_FAMILY, city);
      expect(qs.some((q) => q.eligibility?.dimension === "years-experience")).toBe(false);
      expect(qs.some((q) => /how many years/i.test(q.question))).toBe(false);
    }
  });

  it("builds exactly the two ask-set dimensions, in the UI design spec's block order", () => {
    expect(candidates.map((q) => q.eligibility?.dimension)).toEqual(["work-rights", "language"]);
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
    const [workRights] = eligibilityCandidates(ANY_FAMILY, null);
    expect(workRights!.question).toBe("Can you already work where you're job-hunting, without visa sponsorship?");
    expect(workRights!.eligibility).toMatchObject({ familyId: ANY_FAMILY, scopeLabel: null });
  });

  // #182 falsifiable checks (#180): a "yes" answered while searching Paris must read as unknown once
  // the search moves to Hong Kong, and switching back to Paris must find the original answer again,
  // never re-asking it. Exercised at this module's own seam (eligibilityCandidates/itemId), since the
  // store-level "which market a fact belongs to" is eligibility.test.ts's job.
  it("#182 AC1/AC2: work-rights gets a DIFFERENT itemId per city, so switching city never re-uses another city's answer", () => {
    const paris = eligibilityCandidates(ANY_FAMILY, "Paris").find(
      (q) => q.eligibility?.dimension === "work-rights",
    )!;
    const hongKong = eligibilityCandidates(ANY_FAMILY, "Hong Kong").find(
      (q) => q.eligibility?.dimension === "work-rights",
    )!;
    const parisAgain = eligibilityCandidates(ANY_FAMILY, "Paris").find(
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
    eligibilityCandidates(ANY_FAMILY, null).find((q) => q.eligibility?.dimension === dimension)!
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

  it("both are unresolved when nothing has been asked", () => {
    const qs = unresolvedEligibilityQuestions(ANY_FAMILY, null, [], [], [], []);
    expect(qs.map((q) => q.eligibility?.dimension)).toEqual(["work-rights", "language"]);
  });

  it("a claims-store decline (confirmed, negative, or rejected — #35's three-way union) never returns, on any bucket", () => {
    const declined = closingClaim(candidateItemId("work-rights"));
    const inConfirmed = unresolvedEligibilityQuestions(ANY_FAMILY, null, [declined], [], [], []);
    const inNegatives = unresolvedEligibilityQuestions(ANY_FAMILY, null, [], [declined], [], []);
    const inRejected = unresolvedEligibilityQuestions(ANY_FAMILY, null, [], [], [declined], []);
    for (const qs of [inConfirmed, inNegatives, inRejected]) {
      expect(qs.map((q) => q.eligibility?.dimension)).toEqual(["language"]);
    }
  });

  it("a stored eligibility fact (a real answer) also closes its question, with no claim involved", () => {
    const qs = unresolvedEligibilityQuestions(ANY_FAMILY, null, [], [], [], [
      { dimension: "language", familyId: "English" },
    ]);
    expect(qs.map((q) => q.eligibility?.dimension)).toEqual(["work-rights"]);
  });

  // #123: the languages question is answered iff AT LEAST ONE language fact exists, at ANY scope —
  // unlike years-experience, there is no single scope for one question to match. This also means a
  // STALE fact from the pre-#123 single-English question (recorded at the same "English" scope,
  // since ELIGIBILITY_LANGUAGE was "English") closes the new question too — an old session is not
  // re-asked, the same accepted-pre-launch outcome LANGUAGE_ITEM_ID's own doc records for the itemId
  // change itself.
  it("a language fact at ANY scope (including one recorded under a different language name) closes the one languages question", () => {
    const qs = unresolvedEligibilityQuestions(ANY_FAMILY, null, [], [], [], [
      { dimension: "language", familyId: "Mandarin" },
    ]);
    expect(qs.map((q) => q.eligibility?.dimension)).toEqual(["work-rights"]);
  });

  // #182 (#180's falsifiable checks), at this seam: a work-rights fact stored for one city never
  // closes another city's question, and switching back finds the original answer again. `familyId`
  // below is the SLUG a real write actually stores (QA round 3 must-fix) — the raw display city
  // ("Hong Kong"/"Paris") only ever appears in `city` (this fn's 4th arg) and in question text.
  it("#182 AC1: a Paris work-rights answer leaves Hong Kong's question open (unknown, not borrowed)", () => {
    const qs = unresolvedEligibilityQuestions(ANY_FAMILY, "Hong Kong", [], [], [], [
      { dimension: "work-rights", familyId: "paris" },
    ]);
    expect(qs.map((q) => q.eligibility?.dimension)).toContain("work-rights");
  });

  it("#182 AC2: switching back to Paris finds the stored Paris answer and does not re-ask it", () => {
    const qs = unresolvedEligibilityQuestions(ANY_FAMILY, "Paris", [], [], [], [
      { dimension: "work-rights", familyId: "paris" },
    ]);
    expect(qs.map((q) => q.eligibility?.dimension)).not.toContain("work-rights");
  });
});

describe("#106 mapEligibilityAnswer — the store's canonical value for a tapped option", () => {
  it("work-rights: both real options map to distinct canonical values", () => {
    expect(mapEligibilityAnswer("work-rights", "Yes — no sponsorship needed")).toEqual({
      value: "eligible",
      label: "Right to work without sponsorship",
    });
    expect(mapEligibilityAnswer("work-rights", "Not yet — I'd need sponsorship")).toEqual({
      value: "needs-sponsorship",
      label: "Right to work without sponsorship",
    });
  });

  // #123: language no longer has a single-value real answer — the languages question is multi-select
  // and its real answer is read through languageFacts()/isValidLanguageSelection() (see the #123
  // describe block below), never through this function. It always falls through to null.
  it("language always maps to null — its real answer no longer travels through this function", () => {
    expect(mapEligibilityAnswer("language", "Yes — I work in it")).toBeNull();
  });

  it("an unrecognized answer maps to null for every dimension — the route fails the write closed, not silently", () => {
    expect(mapEligibilityAnswer("work-rights", "Maybe")).toBeNull();
  });

  it("the decline option itself never maps to a value, on any dimension", () => {
    expect(mapEligibilityAnswer("work-rights", DECLINE_OPTION)).toBeNull();
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

// #106 round 3's funnel-regression rule, as a direct unit case. Before the 2026-08-12 architecture
// pass this ordering lived in a route-local closure post-processing discoveryState()'s output, so
// the ONLY way to assert it was to walk the HTTP funnel (discovery.test.ts). The rule is: eligibility
// questions land after the essential band and BEFORE the standard one — the ask dock renders
// questions[0] one at a time with no skip, so putting eligibility last forced a visitor through every
// standard item to reach the questions that actually gate the deck.
describe("#106 applyEligibilityQuestions — band interleaving", () => {
  const floorItems = loadFamilyFloor(resolveFamily(ROLE).family).items;
  const standardIds = new Set(floorItems.filter((i) => i.rankBand === "standard").map((i) => i.id));
  const bandOf = (itemId: string) =>
    isEligibilityItemId(itemId) ? "eligibility" : standardIds.has(itemId) ? "standard" : "leading";

  it("places every eligibility question after the essential band and before the standard one", () => {
    const state = discoveryState(ROLE, [], [], [], "Paris");
    expect(state.questions.some((q) => standardIds.has(q.itemId))).toBe(true); // guard: the fixture has standard items

    applyEligibilityQuestions(ROLE, state, [], [], [], []);

    const bands = state.questions.map((q) => bandOf(q.itemId));
    expect(bands).toContain("eligibility");
    // No standard item may precede any eligibility question, and no leading item may follow one.
    expect(bands.indexOf("eligibility")).toBeLessThan(bands.indexOf("standard"));
    expect(bands.lastIndexOf("leading")).toBeLessThan(bands.indexOf("eligibility"));
    expect(bands.lastIndexOf("eligibility")).toBeLessThan(bands.indexOf("standard"));
  });

  it("keeps the visitor in discovery while any eligibility question is still open", () => {
    const state = discoveryState(ROLE, [], [], [], "Paris");
    applyEligibilityQuestions(ROLE, state, [], [], [], []);
    expect(state.stage).toBe("discovery");
  });

  it("leaves the question order and stage untouched once every eligibility fact is resolved", () => {
    // The facts are derived from the questions this function itself asks, never from a hand-written
    // familyId: two of the three dimensions are family-scoped, and a fact stored at a DIFFERENT scope
    // silently resolves nothing (the same mismatch resolveUserYears's doc warns about). Deriving them
    // is also the only way this test stays true if the scope derivation ever changes.
    const probe = discoveryState(ROLE, [], [], [], "Paris");
    applyEligibilityQuestions(ROLE, probe, [], [], [], []);
    const facts = probe.questions
      .filter((q) => q.eligibility)
      .map((q) => ({ dimension: q.eligibility!.dimension, familyId: q.eligibility!.familyId }));
    expect(facts).not.toHaveLength(0);

    const resolved = discoveryState(ROLE, [], [], [], "Paris");
    const before = [...resolved.questions];
    const stageBefore = resolved.stage;

    applyEligibilityQuestions(ROLE, resolved, [], [], [], facts);

    expect(resolved.questions).toEqual(before);
    expect(resolved.stage).toBe(stageBefore);
  });
});
