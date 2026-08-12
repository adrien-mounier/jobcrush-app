import { describe, expect, it } from "vitest";
import type { AdRequirementsV1 } from "@jobcrush/contracts";
import type { EligibilityFact } from "../src/eligibility.js";
import {
  LANGUAGE_LADDER,
  answerLanguageLevel,
  declaredLanguages,
  isDeclaredValue,
  languageLevelAsk,
  levelOf,
  withLanguageLevelAsks,
} from "../src/languageLevel.js";
import { InMemoryEligibilityStore } from "../src/eligibility.js";

// #165 — the language ladder (ADR-0003 clause 8a / ADR-0008 clause 6). A language and its level are
// two facts: the language is declared, the level is placed on a ladder of concrete situations, asked
// by the advert that makes it matter.

const requirement = (over: Partial<AdRequirementsV1["requirements"][number]> = {}) => ({
  id: "mandarin",
  band: "essential" as const,
  kind: "blocking" as const,
  requirement: "Fluent Mandarin required",
  eligibilityDimension: "language" as const,
  eligibilitySubject: "Mandarin",
  sourceSpan: "Fluent Mandarin is required",
  ...over,
});

const ad = (over: Partial<AdRequirementsV1> = {}): AdRequirementsV1 => ({
  schemaVersion: "1",
  adId: "ad-1",
  curated: false,
  language: "en",
  familyFit: { family: "IT Project Manager", confidence: 0.9 },
  requirements: [requirement()],
  ...over,
});

const fact = (over: Partial<EligibilityFact> = {}): EligibilityFact => ({
  dimension: "language",
  familyId: "Mandarin",
  value: "declared",
  label: "Speaks Mandarin",
  ...over,
});

describe("#165 the ladder itself", () => {
  // ADR-0003 clause 8(a) and ADR-0008 clause 6 both turn on this: the rungs are SITUATIONS, so a
  // person can place themselves without translating a grade. If a rung ever becomes a code or an
  // adjective, "fluent" starts being an answer again and clause 6 is broken.
  it("every rung is a situation a person can picture, never a code or an adjective", () => {
    for (const rung of LANGUAGE_LADDER) {
      expect(rung.situation.startsWith("I ")).toBe(true);
      expect(rung.situation).not.toMatch(/\b(fluent|native|basic|intermediate|advanced|[ABC][12])\b/i);
    }
    expect(LANGUAGE_LADDER[0]!.value).toBe("not-at-all"); // the ladder ascends from the explicit no
  });

  // #125 decision 3 pins the rungs themselves: "native · can negotiate a contract · can run a
  // meeting · gets by day to day · a few words · none". All six, no additions, no omissions — the
  // ticket names #125 normative ("all six"), and a ladder that quietly drops a rung changes what
  // people can say about themselves.
  it("is #125 decision 3's own six rungs, ascending, with none invented and none dropped", () => {
    expect(LANGUAGE_LADDER.map((r) => r.value)).toEqual([
      "not-at-all", // #125's `none` — renamed in storage ONLY, to avoid the pre-#165 "none" collision
      "a-few-words",
      "gets-by",
      "meetings",
      "negotiate",
      "native",
    ]);
  });

  it("reads a stored rung back as a level, and everything else as no level at all", () => {
    expect(levelOf("meetings")).toBe("meetings");
    expect(levelOf("native")).toBe("native");
    expect(levelOf("not-at-all")).toBe("not-at-all");
    expect(levelOf("declared")).toBeNull();
    expect(levelOf(undefined)).toBeNull();
  });

  // #165 point 6: the four languages answered under #123's binary tick-list carry the wrong SHAPE —
  // "professional" is an adjective and "none" may be a mistap. Neither is a level, so both read as
  // unknown and the ladder asks again.
  it("a pre-#165 answer is never read as a level — that is what makes the four get re-asked", () => {
    expect(levelOf("professional")).toBeNull();
    expect(levelOf("none")).toBeNull();
    expect(levelOf("conversational")).toBeNull();
  });

  it("a pre-#165 positive still counts as declared, but a pre-#165 'none' counts as nothing", () => {
    expect(isDeclaredValue("professional")).toBe(true);
    expect(isDeclaredValue("conversational")).toBe(true);
    expect(isDeclaredValue("declared")).toBe(true);
    expect(isDeclaredValue("meetings")).toBe(true);
    expect(isDeclaredValue("a-few-words")).toBe(true);
    // The mistap value: the person may never have meant to say anything at all about it.
    expect(isDeclaredValue("none")).toBe(false);
    // And the deliberate one: they said they don't speak it, so it is not theirs.
    expect(isDeclaredValue("not-at-all")).toBe(false);
  });

  it("declaredLanguages lists the person's own words, in stored order", () => {
    const facts = [
      fact({ familyId: "English" }),
      fact({ familyId: "French" }),
      fact({ familyId: "Mandarin", value: "not-at-all" }),
      { dimension: "work-rights" as const, familyId: "hong-kong", value: "eligible", label: "x" },
    ];
    expect(declaredLanguages(facts)).toEqual(["English", "French"]);
  });
});

describe("#165 AC3 — an advert triggers the level question at the moment it matters", () => {
  it("fires on a BLOCKING language requirement when the level is unknown, saying why this advert cares", () => {
    const ask = languageLevelAsk(ad(), [])!;
    expect(ask).not.toBeNull();
    expect(ask.language).toBe("Mandarin");
    expect(ask.question).toBe("How comfortable are you working in Mandarin?");
    // The reason is the ADVERT's own line, so the person can check it against the posting in front
    // of them rather than taking our word for it (#125 decision 4 / ADR-0011 clause 1).
    expect(ask.why).toContain("Fluent Mandarin required");
    expect(ask.why).toContain("Mandarin");
  });

  // The ticket is explicit: "including when the advert names the language only as a plus". A language
  // named as an advantage is exactly where a real level wins a job.
  it("fires on an ORDINARY requirement too — a language named as a plus still triggers the question", () => {
    const plus = ad({
      requirements: [requirement({ kind: "ordinary", requirement: "Mandarin an advantage" })],
    });
    expect(languageLevelAsk(plus, [])?.language).toBe("Mandarin");
  });

  it("names the advert's own bar when it stated one, and stays silent about a bar when it did not", () => {
    const withBar = ad({ requirements: [requirement({ eligibilityLevel: "meetings" })] });
    expect(languageLevelAsk(withBar, [])!.why).toContain("run a meeting in it");
    expect(languageLevelAsk(ad(), [])!.why).not.toContain("run a meeting in it");
  });

  // #125 decision 4: "answering `none` can lose her jobs… the screen must say so BEFORE she answers,
  // not after." The ask carries that sentence itself, so no client can render the rungs without it.
  it("says what an answer costs, and says it as part of the ask rather than leaving it to a client", () => {
    const ask = languageLevelAsk(ad(), [])!;
    expect(ask.consequence).toContain("takes jobs out of your deck");
    // …and says the others are free, so nobody answers defensively about their own ability.
    expect(ask.consequence).toContain("every other answer keeps them all");
  });

  // #125's "asked once per language ever", kept: an ANSWER closes the language for good, on this
  // advert and every other one.
  it("never fires again once the person has placed themselves on a rung", () => {
    for (const rung of LANGUAGE_LADDER.map((r) => r.value)) {
      expect(languageLevelAsk(ad(), [fact({ value: rung })])).toBeNull();
    }
  });

  it("still fires for a language merely DECLARED — declaring is not placing a level", () => {
    expect(languageLevelAsk(ad(), [fact({ value: "declared" })])?.language).toBe("Mandarin");
  });

  // #165 point 6, through the ask: the four already-answered languages get re-asked, because their
  // old values are not levels.
  it("fires again for a language answered under the pre-#165 shape", () => {
    expect(languageLevelAsk(ad(), [fact({ value: "professional" })])?.language).toBe("Mandarin");
    expect(languageLevelAsk(ad(), [fact({ value: "none" })])?.language).toBe("Mandarin");
  });

  it("uses the store's own casing for a language the person already declared, not the advert's", () => {
    const shouty = ad({ requirements: [requirement({ eligibilitySubject: "  mandarin " })] });
    expect(languageLevelAsk(shouty, [fact({ familyId: "Mandarin" })])?.language).toBe("Mandarin");
    expect(languageLevelAsk(shouty, [])?.language).toBe("mandarin"); // nothing stored — the advert's word
  });

  it("asks about at most one language per advert, in the advert's own rank order", () => {
    const two = ad({
      requirements: [
        requirement({ id: "cantonese", eligibilitySubject: "Cantonese" }),
        requirement({ id: "mandarin", eligibilitySubject: "Mandarin" }),
      ],
    });
    expect(languageLevelAsk(two, [])?.language).toBe("Cantonese");
  });

  it("never fires on a requirement that names no language, or on another dimension", () => {
    expect(languageLevelAsk(ad({ requirements: [requirement({ eligibilitySubject: undefined })] }), [])).toBeNull();
    expect(
      languageLevelAsk(
        ad({ requirements: [requirement({ eligibilityDimension: "work-rights", eligibilitySubject: "x" })] }),
        [],
      ),
    ).toBeNull();
  });

  // The offered ORDER matters as much as the rungs: #165 exists because the easiest tap used to be
  // the one that deleted jobs. It must never be the easiest tap again.
  it("offers the explicit 'I don't speak this one' LAST, never first", () => {
    const ask = languageLevelAsk(ad(), [])!;
    expect(ask.options[0]!.value).toBe("native");
    expect(ask.options[ask.options.length - 1]!.value).toBe("not-at-all");
    expect(ask.options).toHaveLength(LANGUAGE_LADDER.length); // every rung offered, none hidden
  });
});

describe("#165 withLanguageLevelAsks", () => {
  it("attaches each card's own ask, and leaves a card with nothing to ask untouched", () => {
    const cards = [{ adId: "ad-1" }, { adId: "ad-2" }];
    const candidates = [
      { posting: { id: "ad-1" }, adReq: ad() },
      { posting: { id: "ad-2" }, adReq: ad({ adId: "ad-2", requirements: [requirement({ eligibilityDimension: undefined, eligibilitySubject: undefined })] }) },
    ];
    const [first, second] = withLanguageLevelAsks(cards, candidates, []);
    expect(first!.levelAsk?.language).toBe("Mandarin");
    expect(second!.levelAsk).toBeUndefined();
  });
});

describe("#165 answerLanguageLevel", () => {
  it("stores the rung at the language's own scope and closes the question", async () => {
    const store = new InMemoryEligibilityStore();
    expect(await answerLanguageLevel(store, "s1", "Mandarin", "meetings")).toEqual({ ok: true });
    expect(await store.get("s1", "language", "Mandarin")).toMatchObject({ value: "meetings" });
    expect(languageLevelAsk(ad(), await store.list("s1"))).toBeNull();
  });

  it("writes at the scope the person's own declaration used, never a second row for one language", async () => {
    const store = new InMemoryEligibilityStore();
    await store.put("s1", fact({ familyId: "Mandarin" }));
    await answerLanguageLevel(store, "s1", "  mandarin ", "gets-by");
    const stored = (await store.list("s1")).filter((f) => f.dimension === "language");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ familyId: "Mandarin", value: "gets-by" });
  });

  it("refuses anything that isn't a rung — a grade or an adjective is never stored as a level", async () => {
    const store = new InMemoryEligibilityStore();
    for (const bad of ["fluent", "B2", "professional", "", "declared", "none", "work", "everyday"]) {
      expect(await answerLanguageLevel(store, "s1", "Mandarin", bad)).toMatchObject({ ok: false, status: 400 });
    }
    expect(await answerLanguageLevel(store, "s1", "  ", "work")).toMatchObject({ ok: false, status: 400 });
    expect(await store.list("s1")).toEqual([]);
  });
});
