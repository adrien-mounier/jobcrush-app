// #107 (E5 slice 6, D3) — withdrawal.ts's own pure-function tests, in ADDITION to (never instead of)
// the HTTP boundary proof in cards.test.ts (spec #86's primary testing seam, and AC5's own explicit
// "the test observes the card's absence from the deck through the API, not an internal predicate").
// These exist only to pin the predicate's exact shape at low cost per case; every user-visible AC
// still gets its own boundary test.
//
// #425 rewrote the language cases: a blocking language that is on neither the CV nor the profile
// withdraws now (owner decision 1, 2026-10-24). The cases that pinned "an unknown language never
// withdraws" are rewritten below to the new rule, each beside the case that shows what still keeps.
import { describe, expect, it } from "vitest";
import type { AdRequirementsV1 } from "@jobcrush/contracts";
import type { EligibilityFact } from "../src/eligibility.js";
import { LANGUAGE_LADDER, LANGUAGE_NOT_AT_ALL } from "../src/languageLevel.js";
import { findWithdrawingRequirement, partitionByWithdrawal } from "../src/withdrawal.js";
import type { BroughtJob } from "../src/broughtJobs.js";
import { LANGUAGE_CLAIM_PREFIX } from "../src/cvLanguages.js";

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

/** An advert whose one blocking requirement names `subject` — the reader's eligibilitySubject. */
const needs = (subject: string, adId = "test-ad"): AdRequirementsV1 =>
  ad({ adId, requirements: [{ ...ad().requirements[0]!, id: "language-required", eligibilitySubject: subject }] });

// #165: the language "no" is the ladder's own bottom rung — a value a person can only reach by
// deliberately tapping "I don't speak this one".
const fact = (over: Partial<EligibilityFact>): EligibilityFact => ({
  dimension: "language",
  familyId: "Mandarin",
  value: "not-at-all",
  label: "Mandarin — I don't speak this one",
  ...over,
});

/** The CV's language lines, as the miner stores them (one `lang-` claim per language). */
const cv = (...lines: string[]) => lines.map((text, i) => ({ id: `${LANGUAGE_CLAIM_PREFIX}${i}`, text, decision: "confirmed" as const }));
// The owner's own CV on the 2026-10-24 re-proof.
const OWNER_CV = cv("French (Native)", "English (Fluent)", "Spanish (Conversational)", "Thai (Beginner)");

describe("#107 findWithdrawingRequirement", () => {
  it("withdraws on a blocking requirement with an explicit 'no' at the matching (dimension, subject) scope", () => {
    const req = findWithdrawingRequirement(ad(), [fact({ value: "not-at-all" })], []);
    expect(req?.id).toBe("mandarin-required");
  });

  // The spec's own second regression case: "conversational" ("Some, but not for work") is not "I
  // don't speak it" — and as a pre-#165 positive it still declares the language (isDeclaredValue).
  it("keeps the job on 'conversational' — only the ladder's own bottom rung is a no", () => {
    expect(findWithdrawingRequirement(ad(), [fact({ value: "conversational" })], [])).toBeNull();
  });

  // #165 AC2 / #425: #123's tick-list wrote "none" for every language left UNTICKED. It is still not
  // a no — but it declares nothing either, so the language is not on the profile and the job leaves
  // as "not on your profile", which the deck names with a one-tap "I speak it" (tally test below).
  it("#425: a pre-#165 'none' declares nothing — the job leaves as missing, never as a no", () => {
    expect(findWithdrawingRequirement(ad(), [fact({ value: "none" })], [])?.id).toBe("mandarin-required");
    const { withdrawn } = partitionByWithdrawal([{ posting: {}, adReq: ad() }], [fact({ value: "none" })], []);
    expect(withdrawn.byLanguage).toEqual([{ language: "Mandarin", count: 1, missing: true }]);
  });

  it("keeps the job on a pre-#165 'professional' — an old answer still declares the language", () => {
    expect(findWithdrawingRequirement(ad(), [fact({ value: "professional" })], [])).toBeNull();
  });

  // ADR-0003 clause 8(a), stated as a test: "being below the bar never withdraws a job". Every rung
  // above the bottom one leaves the posting in the deck, however demanding the advert is.
  // Iterates LANGUAGE_LADDER itself rather than a hand-copied list.
  it("does not withdraw on ANY rung above the bottom one — below the bar is not a no", () => {
    const aboveTheBottom = LANGUAGE_LADDER.map((r) => r.value).filter((v) => v !== LANGUAGE_NOT_AT_ALL);
    expect(aboveTheBottom.length).toBe(LANGUAGE_LADDER.length - 1);
    for (const rung of [...aboveTheBottom, "declared"]) {
      expect(findWithdrawingRequirement(ad(), [fact({ value: rung })], [])).toBeNull();
    }
  });

  // #425 AC1 — rewritten from "no fact at all never withdraws".
  it("#425: withdraws when the language is on neither the CV nor the profile", () => {
    expect(findWithdrawingRequirement(ad(), [], [])?.id).toBe("mandarin-required");
    expect(findWithdrawingRequirement(ad(), [], OWNER_CV)?.id).toBe("mandarin-required");
  });

  it("#425: keeps the job when the CV lists the language, whatever its level word — or none", () => {
    for (const line of ["Mandarin (Native)", "Mandarin (Beginner)", "Mandarin - conversational", "Mandarin"]) {
      expect(findWithdrawingRequirement(ad(), [], cv(line))).toBeNull();
    }
  });

  it("#425: a rejected CV language line is not the person's — it withdraws like no line at all", () => {
    const rejected = [{ id: `${LANGUAGE_CLAIM_PREFIX}0`, text: "Mandarin (Fluent)", decision: "rejected" as const }];
    expect(findWithdrawingRequirement(ad(), [], rejected)?.id).toBe("mandarin-required");
    expect(findWithdrawingRequirement(ad(), [], [{ ...rejected[0]!, decision: "confirmed" as const }])).toBeNull();
  });

  // #425 AC3 — an explicit answer beats the CV, both ways.
  it("#425: 'I don't speak this one' withdraws even when the CV lists the language", () => {
    expect(findWithdrawingRequirement(ad(), [fact({ value: "not-at-all" })], cv("Mandarin (Native)"))?.id).toBe(
      "mandarin-required",
    );
  });

  it("#425: a ladder rung or a Languages-screen declaration keeps the job the CV does not list", () => {
    for (const value of ["declared", "gets-by"]) {
      expect(findWithdrawingRequirement(ad(), [fact({ value })], OWNER_CV)).toBeNull();
    }
  });

  // Rewritten from "a fact for a DIFFERENT subject does not withdraw": it still says nothing about
  // Mandarin — and so Mandarin is not on the profile.
  it("#425: a fact for a DIFFERENT language says nothing about this one", () => {
    const facts = [fact({ familyId: "English", value: "declared" })];
    expect(findWithdrawingRequirement(ad(), facts, [])?.id).toBe("mandarin-required");
  });

  it("does not withdraw an 'ordinary' requirement — not even one the same facts would withdraw if blocking", () => {
    const advertisement = ad({
      requirements: [{ ...ad().requirements[0]!, kind: "ordinary" }],
    });
    expect(findWithdrawingRequirement(ad(), [], [])).not.toBeNull(); // the blocking twin goes
    expect(findWithdrawingRequirement(advertisement, [], [])).toBeNull();
    expect(findWithdrawingRequirement(advertisement, [fact({ value: "not-at-all" })], [])).toBeNull();
  });

  // #107 D1's own safety net: a blocking language/certification requirement with NO
  // eligibilitySubject can never withdraw anything — there is no safe way to know WHICH is meant.
  it("does not withdraw a blocking language requirement with no eligibilitySubject at all", () => {
    const advertisement = ad({
      requirements: [{ ...ad().requirements[0]!, eligibilitySubject: undefined }],
    });
    expect(findWithdrawingRequirement(advertisement, [fact({ familyId: "Mandarin", value: "not-at-all" })], [])).toBeNull();
    expect(findWithdrawingRequirement(advertisement, [], [])).toBeNull();
  });

  // #425 AC4: a brought (pasted) job is never withdrawn (#305 stands), whatever the languages say.
  it("#425: a job he brought is never withdrawn, missing language or explicit no", () => {
    const brought = [{ posting: { id: "test-ad" } }] as unknown as BroughtJob[];
    expect(findWithdrawingRequirement(ad(), [], [], null, brought)).toBeNull();
    expect(findWithdrawingRequirement(ad(), [fact({ value: "not-at-all" })], [], null, brought)).toBeNull();
    expect(findWithdrawingRequirement(ad(), [], [], null, [])).not.toBeNull(); // the same job, found
  });

  // #182 resolves code-review M1: work-rights reads at the posting's own location, passed as
  // findWithdrawingRequirement's fourth argument, never resolved inside this pure function.
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
    for (const value of ["needs-sponsorship", "eligible"]) {
      const facts = [{ dimension: "work-rights" as const, familyId: "Hong Kong", value, label: "Right to work" }];
      expect(findWithdrawingRequirement(workRightsAd(), facts, [])).toBeNull();
    }
  });

  it("#182 AC: withdraws on an explicit 'no' stored for the SAME market gating is running for", () => {
    const facts = [
      { dimension: "work-rights" as const, familyId: "Hong Kong", value: "needs-sponsorship", label: "Right to work" },
    ];
    expect(findWithdrawingRequirement(workRightsAd(), facts, [], "Hong Kong")?.id).toBe("work-rights-required");
  });

  it("#182 AC3: a conflicting answer stored for a DIFFERENT market has no effect on this market's gate", () => {
    const facts = [
      { dimension: "work-rights" as const, familyId: "Paris", value: "needs-sponsorship", label: "Right to work" },
    ];
    expect(findWithdrawingRequirement(workRightsAd(), facts, [], "Hong Kong")).toBeNull();
  });

  it("#182 AC4: an unanswered market reads unknown and never withdraws, even with facts stored for other markets", () => {
    const facts = [
      { dimension: "work-rights" as const, familyId: "Paris", value: "needs-sponsorship", label: "Right to work" },
      { dimension: "work-rights" as const, familyId: "Hong Kong", value: "eligible", label: "Right to work" },
    ];
    expect(findWithdrawingRequirement(workRightsAd(), facts, [], "Singapore")).toBeNull();
  });

  it("#182: matches the market case-insensitively and trimmed, same as language/certification scope", () => {
    const facts = [
      { dimension: "work-rights" as const, familyId: " Hong Kong ", value: "needs-sponsorship", label: "Right to work" },
    ];
    expect(findWithdrawingRequirement(workRightsAd(), facts, [], "hong kong")?.id).toBe("work-rights-required");
  });

  // certification is wired through the predicate (D3: "don't special-case it away") even though no
  // product surface today ever writes a certification eligibility fact. #425 changed language only.
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
    const facts = [{ dimension: "certification" as const, familyId: "PMP", value: "none", label: "PMP" }];
    expect(findWithdrawingRequirement(advertisement, facts, [])).toBeNull();
    expect(findWithdrawingRequirement(advertisement, [], [])).toBeNull();
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
    expect(findWithdrawingRequirement(advertisement, facts, [])?.id).toBe("cantonese-required");
  });

  // code-review M4: trimmed + case-folded on both sides — a model emitting "mandarin" (lowercase) or
  // " Mandarin " (whitespace) must still match the store's canonical "Mandarin" scope.
  it("matches the subject scope case-insensitively and trimmed (M4)", () => {
    for (const familyId of ["mandarin", " Mandarin ", "MANDARIN"]) {
      expect(findWithdrawingRequirement(ad(), [fact({ familyId, value: "not-at-all" })], [])?.id).toBe(
        "mandarin-required",
      );
      expect(findWithdrawingRequirement(ad(), [fact({ familyId, value: "declared" })], [])).toBeNull();
    }
  });
});

// #425 AC2 — a subject naming several languages, and the language-name rules.
describe("#425 the languages a requirement names", () => {
  it("'Cantonese and English' withdraws when any one of them is missing", () => {
    expect(findWithdrawingRequirement(needs("Cantonese and English"), [], OWNER_CV)?.id).toBe("language-required");
    expect(findWithdrawingRequirement(needs("Cantonese and English"), [], cv("Cantonese (Native)"))?.id).toBe(
      "language-required",
    );
    expect(findWithdrawingRequirement(needs("Cantonese and English"), [], cv("Cantonese (Native)", "English (Fluent)"))).toBeNull();
    expect(findWithdrawingRequirement(needs("Cantonese & English"), [], cv("Cantonese (Native)", "English (Fluent)"))).toBeNull();
    expect(findWithdrawingRequirement(needs("Cantonese & English"), [], cv("Cantonese (Native)"))?.id).toBe("language-required");
    expect(findWithdrawingRequirement(needs("English, Cantonese, and Mandarin"), [], cv("English", "Cantonese"))?.id).toBe(
      "language-required",
    );
  });

  it("'English or Mandarin' is met by either one", () => {
    expect(findWithdrawingRequirement(needs("English or Mandarin"), [], cv("Mandarin (Native)"))).toBeNull();
    expect(findWithdrawingRequirement(needs("English and/or Mandarin"), [], OWNER_CV)).toBeNull();
    expect(findWithdrawingRequirement(needs("Cantonese or Mandarin"), [], OWNER_CV)?.id).toBe("language-required");
    // Names no list knows are still split on "or", each kept as written.
    expect(findWithdrawingRequirement(needs("Hokkien or Teochew"), [fact({ familyId: "Hokkien", value: "declared" })], [])).toBeNull();
  });

  it("Putonghua means Mandarin, both ways", () => {
    expect(findWithdrawingRequirement(needs("Putonghua"), [], cv("Mandarin (Fluent)"))).toBeNull();
    expect(findWithdrawingRequirement(needs("Mandarin"), [], cv("Putonghua (Native)"))).toBeNull();
    expect(findWithdrawingRequirement(needs("Putonghua"), [fact({ familyId: "Mandarin", value: "declared" })], [])).toBeNull();
    expect(findWithdrawingRequirement(needs("Putonghua"), [fact({ familyId: "Mandarin", value: "not-at-all" })], cv("Putonghua"))?.id).toBe(
      "language-required",
    );
  });

  it("a job asking for Chinese is met by Mandarin or Cantonese — but Chinese on a CV does not say which", () => {
    expect(findWithdrawingRequirement(needs("Chinese"), [], cv("Cantonese (Native)"))).toBeNull();
    expect(findWithdrawingRequirement(needs("Chinese"), [], cv("Mandarin (Fluent)"))).toBeNull();
    expect(findWithdrawingRequirement(needs("Chinese"), [], cv("Chinese (Native)"))).toBeNull();
    expect(findWithdrawingRequirement(needs("Mandarin"), [], cv("Chinese (Native)"))?.id).toBe("language-required");
  });

  it("a CV line naming two languages counts both", () => {
    expect(findWithdrawingRequirement(needs("French"), [], cv("English & French (Fluent)"))).toBeNull();
  });

  // QA gate note: a reader that writes a word around the language must not hide every job needing it,
  // nor make the deck say "I left out 1 job that needs written".
  it("a word around the language is not a language: 'fluent English', 'written and spoken Chinese'", () => {
    for (const subject of ["fluent English", "Business English", "English (business level)"]) {
      expect(findWithdrawingRequirement(needs(subject), [], OWNER_CV)).toBeNull();
    }
    expect(findWithdrawingRequirement(needs("written and spoken Chinese"), [], cv("Cantonese (Native)"))).toBeNull();
    const { withdrawn } = partitionByWithdrawal([{ posting: {}, adReq: needs("written and spoken Chinese") }], [], OWNER_CV);
    expect(withdrawn.byLanguage).toEqual([{ language: "Chinese", count: 1, missing: true }]);
  });

  it("every language a CV line names counts: a variety in brackets, two languages on one line", () => {
    expect(findWithdrawingRequirement(needs("Mandarin"), [], cv("Chinese (Mandarin) – Native"))).toBeNull();
    expect(findWithdrawingRequirement(needs("French"), [], cv("English, French – Fluent"))).toBeNull();
  });

  // A sentence-style line the parser reads as the language "Fluent in English" (preview.ts calls
  // this shape unreadable) is read word by word instead; a word no list knows is kept as written.
  it("a line the parser cannot split still counts every language it names; an unlisted word is kept", () => {
    const sentence = cv("Fluent in English, French and German");
    for (const language of ["English", "French", "German"]) {
      expect(findWithdrawingRequirement(needs(language), [], sentence)).toBeNull();
    }
    expect(findWithdrawingRequirement(needs("Spanish"), [], sentence)?.id).toBe("language-required");
    expect(findWithdrawingRequirement(needs("Hokkien"), [], cv("Hokkien (Native)"))).toBeNull();
  });

  // Every blocking language subject stored on staging on 2026-10-24 (the reader's own words), run
  // against the owner's CV and against a Hong Kong trilingual CV: the second is the table of
  // real-world inputs the new block must let through.
  it("the staging subjects: the owner's CV loses exactly the jobs he cannot take; a trilingual CV keeps all", () => {
    const subjects = ["Cantonese", "Cantonese and English", "Chinese", "English", "Mandarin", "Putonghua"];
    const verdicts = (claims: ReturnType<typeof cv>) =>
      subjects.map((s) => (findWithdrawingRequirement(needs(s), [], claims) ? "out" : "kept"));
    expect(verdicts(OWNER_CV)).toEqual(["out", "out", "out", "kept", "out", "out"]);
    expect(verdicts(cv("Cantonese (Native)", "English (Fluent)", "Mandarin (Professional)"))).toEqual([
      "kept", "kept", "kept", "kept", "kept", "kept",
    ]);
  });
});

describe("#425 partitionByWithdrawal's tally", () => {
  const entry = (subject: string, adId: string) => ({ posting: {}, adReq: needs(subject, adId) });

  it("names each language with its own count, and says which are missing and which were a no", () => {
    const candidates = [
      entry("Cantonese", "a"),
      entry("Cantonese and English", "b"),
      entry("Putonghua", "c"),
      entry("Thai", "d"),
      entry("English", "e"),
    ];
    const facts = [fact({ familyId: "Thai", value: "not-at-all" })];
    const { open, withdrawn } = partitionByWithdrawal(candidates, facts, OWNER_CV);
    expect(open.map((c) => c.adReq.adId)).toEqual(["e"]);
    expect(withdrawn).toEqual({
      total: 4,
      byLanguage: [
        { language: "Cantonese", count: 2, missing: true },
        { language: "Mandarin", count: 1, missing: true },
        { language: "Thai", count: 1, missing: false },
      ],
    });
  });

  it("is empty — never omitted — when nothing was withdrawn", () => {
    expect(partitionByWithdrawal([entry("English", "e")], [], OWNER_CV).withdrawn).toEqual({ total: 0, byLanguage: [] });
  });
});
