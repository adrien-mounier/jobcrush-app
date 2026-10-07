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
  languageDeclarationPlan,
  languagesUnion,
  mapEligibilityAnswer,
  unresolvedEligibilityQuestions,
} from "../src/eligibilityDiscovery.js";
import { discoveryState } from "../src/discovery.js";

const ROLE = "IT project manager in Paris";

describe("#106 eligibilityCandidates", () => {
  const candidates = eligibilityCandidates(ANY_FAMILY, ["Paris"]);

  // ADR-0008's own falsifiable check, in one line: "`years-experience` must never appear in
  // ASK_DIMENSIONS. If a build ticket adds a 'how many years of experience do you have?' question —
  // for any reason, including an unreadable work history — clause 2 was not read."
  it("never asks for a years-of-experience total, for any reason (ADR-0008 clause 2)", () => {
    for (const markets of [["Paris"], []] as const) {
      const qs = eligibilityCandidates(ANY_FAMILY, markets);
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

  // #214: with N selected markets, work-rights is asked once per market, each at its own scope.
  it("#214: two markets build two work-rights questions, one per market, in list order", () => {
    const qs = eligibilityCandidates(ANY_FAMILY, ["Hong Kong", "Australia"]);
    expect(qs.map((q) => q.eligibility?.dimension)).toEqual(["work-rights", "work-rights", "language"]);
    expect(qs.slice(0, 2).map((q) => q.eligibility!.familyId)).toEqual(["hong-kong", "australia"]);
    expect(qs.slice(0, 2).map((q) => q.question)).toEqual([
      "Can you already work in Hong Kong without visa sponsorship?",
      "Can you already work in Australia without visa sponsorship?",
    ]);
  });

  it("work-rights falls back to ANY_FAMILY and the generic phrasing when no market is known", () => {
    const [workRights] = eligibilityCandidates(ANY_FAMILY, []);
    expect(workRights!.question).toBe("Can you already work where you're job-hunting, without visa sponsorship?");
    expect(workRights!.eligibility).toMatchObject({ familyId: ANY_FAMILY, scopeLabel: null });
  });

  // #182 falsifiable checks (#180): a "yes" answered while searching Paris must read as unknown once
  // the search moves to Hong Kong, and switching back to Paris must find the original answer again,
  // never re-asking it. Exercised at this module's own seam (eligibilityCandidates/itemId), since the
  // store-level "which market a fact belongs to" is eligibility.test.ts's job.
  it("#182 AC1/AC2: work-rights gets a DIFFERENT itemId per city, so switching city never re-uses another city's answer", () => {
    const paris = eligibilityCandidates(ANY_FAMILY, ["Paris"]).find(
      (q) => q.eligibility?.dimension === "work-rights",
    )!;
    const hongKong = eligibilityCandidates(ANY_FAMILY, ["Hong Kong"]).find(
      (q) => q.eligibility?.dimension === "work-rights",
    )!;
    const parisAgain = eligibilityCandidates(ANY_FAMILY, ["Paris"]).find(
      (q) => q.eligibility?.dimension === "work-rights",
    )!;
    expect(paris.itemId).not.toBe(hongKong.itemId);
    expect(paris.itemId).toBe(parisAgain.itemId); // switching back resolves to the SAME question
  });

  // #165 (AC1): declaring a language is a TYPE-AHEAD over a known list. `options` still carries
  // languagesUnion() + the decline, but as completions — `typeAhead` is what tells the client they
  // are not the closed set of legal answers.
  it("language is a type-ahead over languagesUnion(), with its own itemId, question, and consequence", () => {
    const language = candidates.find((q) => q.eligibility?.dimension === "language")!;
    expect(language.itemId).toBe(LANGUAGE_ITEM_ID);
    expect(language.itemId).not.toBe(candidates.find((q) => q.eligibility?.dimension === "work-rights")!.itemId);
    expect(language.multiSelect).toBe(true);
    expect(language.typeAhead).toBe(true);
    expect(language.question).toBe("Which languages do you speak? Start typing — I'll suggest as you go.");
    // #165: the consequence line no longer warns about a removal, because listing languages no longer
    // causes one. It states the two things that are true instead — leaving one out costs nothing, and
    // the level gets asked later, by the advert that needs it.
    expect(language.consequence).toBe(
      "Nothing you leave out counts against you: a job wanting a language you didn't list still stays in your deck." +
        " When one of them matters for a real job, I'll ask how well you speak it, and say why.",
    );
    expect(language.options).toEqual([...languagesUnion(), DECLINE_OPTION]);
  });

  it("certification and degree are never built — credentials belong to family floors", () => {
    expect(candidates.some((q) => q.eligibility?.dimension === "certification")).toBe(false);
    expect(candidates.some((q) => q.eligibility?.dimension === "degree")).toBe(false);
  });
});

// #339: a question is closed by a stored eligibility fact and by nothing else — the claims store is
// no longer consulted, so a decline ("Ask me later"), which stores nothing, leaves its question open
// (the route-level proof that it is served again lives in discovery.test.ts's "#106" block).
describe("#106 unresolvedEligibilityQuestions — never re-asked once a fact is stored", () => {
  it("both are unresolved when nothing has been asked", () => {
    const qs = unresolvedEligibilityQuestions(ANY_FAMILY, [], []);
    expect(qs.map((q) => q.eligibility?.dimension)).toEqual(["work-rights", "language"]);
  });

  it("a stored eligibility fact (a real answer) also closes its question, with no claim involved", () => {
    const qs = unresolvedEligibilityQuestions(ANY_FAMILY, [], [
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
    const qs = unresolvedEligibilityQuestions(ANY_FAMILY, [], [
      { dimension: "language", familyId: "Mandarin" },
    ]);
    expect(qs.map((q) => q.eligibility?.dimension)).toEqual(["work-rights"]);
  });

  // #182 (#180's falsifiable checks), at this seam: a work-rights fact stored for one city never
  // closes another city's question, and switching back finds the original answer again. `familyId`
  // below is the SLUG a real write actually stores (QA round 3 must-fix) — the raw display city
  // ("Hong Kong"/"Paris") only ever appears in `markets` (this fn's 2nd arg) and in question text.
  it("#182 AC1: a Paris work-rights answer leaves Hong Kong's question open (unknown, not borrowed)", () => {
    const qs = unresolvedEligibilityQuestions(ANY_FAMILY, ["Hong Kong"], [
      { dimension: "work-rights", familyId: "paris" },
    ]);
    expect(qs.map((q) => q.eligibility?.dimension)).toContain("work-rights");
  });

  it("#182 AC2: switching back to Paris finds the stored Paris answer and does not re-ask it", () => {
    const qs = unresolvedEligibilityQuestions(ANY_FAMILY, ["Paris"], [
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
describe("#123/#165 languagesUnion / languageDeclarationPlan / isValidLanguageSelection", () => {
  it("the union is the owner-approved four-language list, in stable declared order", () => {
    expect(languagesUnion()).toEqual(["English", "Mandarin", "Cantonese", "Vietnamese"]);
  });

  it("is stable across calls — never re-sorted or shuffled between requests", () => {
    expect(languagesUnion()).toEqual(languagesUnion());
  });

  // #165 AC2 — the regression that mattered: nothing a person leaves out may ever be written as a
  // "no". #123's full-set write did exactly that, and it silently deleted winnable jobs.
  it("an answer writes ONLY what the person named — no 'none' is ever written for the rest", () => {
    const plan = languageDeclarationPlan(["Mandarin"], []);
    expect(plan.put).toEqual([{ familyId: "Mandarin", value: "declared", label: "Speaks Mandarin" }]);
    expect(plan.remove).toEqual([]);
    expect(plan.put.some((w) => w.value === "none")).toBe(false);
  });

  it("dropping a language RETRACTS its fact — back to unknown, never to a 'no'", () => {
    const stored = [
      { dimension: "language" as const, familyId: "Mandarin", value: "declared", label: "Speaks Mandarin" },
      { dimension: "language" as const, familyId: "English", value: "declared", label: "Speaks English" },
    ];
    const plan = languageDeclarationPlan(["English"], stored);
    expect(plan.remove).toEqual(["Mandarin"]);
    expect(plan.put).toEqual([]);
  });

  // 🚨 A placed level is an ANSWER (#125: asked once per language ever), not a declaration, so the
  // declaring question may never retract one. The dangerous half is the second case: "I don't speak
  // this one" is deliberately never shown in the declared list, so it is absent from every later
  // answer by construction — retracting on absence would delete it the moment the person edited
  // their languages for any other reason, and the ladder would ask them forever.
  it("never retracts a placed level, even when that language is absent from the answer", () => {
    const stored = [
      { dimension: "language" as const, familyId: "Mandarin", value: "meetings", label: "Mandarin" },
      { dimension: "language" as const, familyId: "Thai", value: "not-at-all", label: "Thai" },
      { dimension: "language" as const, familyId: "French", value: "declared", label: "Speaks French" },
    ];
    const plan = languageDeclarationPlan(["English"], stored);
    expect(plan.remove).toEqual(["French"]); // only the bare declaration retracts
    expect(plan.put).toEqual([{ familyId: "English", value: "declared", label: "Speaks English" }]);
  });

  it("re-answering never knocks a language back down from a level it was already placed at", () => {
    const stored = [
      { dimension: "language" as const, familyId: "Mandarin", value: "meetings", label: "Mandarin" },
    ];
    const plan = languageDeclarationPlan(["Mandarin", "French"], stored);
    expect(plan.remove).toEqual([]);
    expect(plan.put).toEqual([{ familyId: "French", value: "declared", label: "Speaks French" }]);
  });

  // 🚨 #165 QA gate, DEFECT-2: a pre-#165 "none" row is STORED but declares nothing. Keying the
  // write off bare existence made that row swallow the declaration — the person typed Mandarin, the
  // screen said "Locked in", and Mandarin never reached the store, their profile, or their CV.
  it("a language carrying only a pre-#165 'none' can be declared again — the legacy row is overwritten", () => {
    const stored = [
      { dimension: "language" as const, familyId: "English", value: "professional", label: "x" },
      { dimension: "language" as const, familyId: "Mandarin", value: "none", label: "x" },
    ];
    const plan = languageDeclarationPlan(["English", "Mandarin"], stored);
    expect(plan.put).toEqual([{ familyId: "Mandarin", value: "declared", label: "Speaks Mandarin" }]);
    expect(plan.remove).toEqual([]); // English already says something — left exactly as it was
  });

  it("answers: [] stays legal, and now records nothing at all rather than a wall of 'no's", () => {
    expect(isValidLanguageSelection([])).toBe(true);
    expect(languageDeclarationPlan([], [])).toEqual({ put: [], remove: [] });
  });

  // #165 AC1: a word outside the known list is KEPT, not refused — it simply matches no advert until
  // languages-by-market.json learns it. This is the French-speaker-in-Asia case (#125).
  it("isValidLanguageSelection accepts a language the list has never heard of", () => {
    expect(isValidLanguageSelection(["English"])).toBe(true);
    expect(isValidLanguageSelection([...languagesUnion()])).toBe(true);
    expect(isValidLanguageSelection(["French"])).toBe(true);
    expect(languageDeclarationPlan(["French"], []).put).toEqual([
      { familyId: "French", value: "declared", label: "Speaks French" },
    ]);
  });

  it("isValidLanguageSelection still refuses what isn't a word at all — it is a trust boundary", () => {
    expect(isValidLanguageSelection([""])).toBe(false);
    expect(isValidLanguageSelection(["   "])).toBe(false);
    expect(isValidLanguageSelection(["a".repeat(61)])).toBe(false);
    expect(isValidLanguageSelection(["Fren\nch"])).toBe(false);
    expect(isValidLanguageSelection(Array.from({ length: 21 }, (_, i) => `L${i}`))).toBe(false);
  });
});

// #339: the eligibility questions are the only ones discovery still asks — the floor questions and
// #106 round 3's band interleaving went with them. discoveryState() returns no questions and stage
// "deck" once a role exists; this layer is what holds the visitor in discovery while one is open.
describe("#106/#339 applyEligibilityQuestions — the whole question list", () => {
  it("the eligibility questions are the whole list, and they keep the visitor in discovery", () => {
    const state = discoveryState(ROLE, [], [], null);
    expect(state).toMatchObject({ stage: "deck", questions: [] }); // guard: nothing else is asked

    applyEligibilityQuestions(state, [], ["Paris"]);

    expect(state.questions.length).toBeGreaterThan(0);
    expect(state.questions.every((q) => isEligibilityItemId(q.itemId))).toBe(true);
    expect(state.stage).toBe("discovery");
  });

  it("adds nothing and leaves the stage at deck once every eligibility fact is resolved", () => {
    // The facts are derived from the questions this function itself asks, never from a hand-written
    // familyId: work-rights is market-scoped, and a fact stored at a DIFFERENT scope silently resolves
    // nothing. Deriving them is also the only way this test stays true if the scope derivation changes.
    const probe = discoveryState(ROLE, [], [], null);
    applyEligibilityQuestions(probe, [], ["Paris"]);
    const facts = probe.questions.map((q) => ({ dimension: q.eligibility!.dimension, familyId: q.eligibility!.familyId }));
    expect(facts).not.toHaveLength(0);

    const resolved = discoveryState(ROLE, [], [], null);
    applyEligibilityQuestions(resolved, facts, ["Paris"]);

    expect(resolved.questions).toEqual([]);
    expect(resolved.stage).toBe("deck");
  });
});
