// Golden tests: the zod ports and the copied .mjs oracle validators must agree on every fixture.
// The oracle is the spec — if these ever disagree, the zod port is wrong, not the oracle.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  AdRequirementsV1,
  CandidateClaims,
  ClaimGraph,
  FamilyFloorV1,
  FamilyPlacement,
  Inbox,
  IndustryPlacement,
  JobCardV1,
  MinedJobBlocks,
  PostingProviderPolicyV1,
  PostingRetrievalResultV1,
  ProviderPostingRecordV1,
} from "../src/index.js";
// @ts-expect-error — plain .mjs oracle, no types by design
import { validateCandidateClaims } from "../oracle/validate_candidate_claims.mjs";
// @ts-expect-error — plain .mjs oracle, no types by design
import { validateMinedJobBlocks } from "../oracle/validate_job_block.mjs";
// @ts-expect-error — plain .mjs oracle, no types by design
import { validateGraph } from "../oracle/validate_graph.mjs";
// @ts-expect-error — plain .mjs oracle, no types by design
import { validateInbox } from "../oracle/validate_proposal.mjs";
// @ts-expect-error — plain .mjs oracle, no types by design
import { validateJobCardV1 } from "../oracle/validate_job_card_v1.mjs";
// @ts-expect-error — plain .mjs oracle, no types by design
import { validateFamilyFloorV1 } from "../oracle/validate_family_floor_v1.mjs";
// @ts-expect-error — plain .mjs oracle, no types by design
import { validateFamilyPlacement } from "../oracle/validate_family_placement.mjs";
// @ts-expect-error — plain .mjs oracle, no types by design
import { validateIndustryPlacement } from "../oracle/validate_industry_placement.mjs";
// @ts-expect-error — plain .mjs oracle, no types by design
import { validateAdRequirementsV1 } from "../oracle/validate_ad_requirements_v1.mjs";
// @ts-expect-error — plain .mjs oracle, no types by design
import { validatePostingRetrievalResultV1, validateProviderPostingRecordV1, validatePostingProviderPolicyV1 } from "../oracle/validate_posting_retrieval_v1.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, "..", "fixtures", name), "utf8"));

describe("Family placement v2", () => {
  const placements = fixture("family-placement.valid.json");

  it("accepts only confirmed and unmapped outcomes in oracle and zod", () => {
    for (const placement of placements) {
      expect(validateFamilyPlacement(placement).ok).toBe(true);
      expect(FamilyPlacement.safeParse(placement).success).toBe(true);
    }
  });

  // #231 — a job can be in several families. The one thing the contract still refuses is an
  // ambiguous or unversioned reference; the COUNT is deliberately unbounded (ADR-0014 amendment 1
  // decision 3), so a three-family answer must be accepted and stay visible rather than clamped.
  it("carries one or more immutable family versions, distinct, with an ordinal confidence", () => {
    const [single, dual] = placements;
    expect(single.families).toEqual([{ familyId: "delivery-leadership-example", version: 1 }]);
    expect(dual.families).toHaveLength(2);

    const three = structuredClone(dual);
    three.families.push({ familyId: "third-family-example", version: 1 });
    expect(validateFamilyPlacement(three).ok).toBe(true);
    expect(FamilyPlacement.safeParse(three).success).toBe(true);

    for (const mutate of [
      (value: any) => delete value.families[0].version,
      (value: any) => (value.families = []),
      (value: any) => (value.families = null),
      (value: any) => (value.families = [null]),
      (value: any) => (value.families = "delivery-leadership-example"),
      // v1's singular key is not silently tolerated — a stale placement must FAIL, not half-parse.
      (value: any) => ((value.family = value.families[0]), delete value.families),
      (value: any) => (value.families = [value.families[0], { ...value.families[0] }]),
      (value: any) => (value.schemaVersion = "1"),
      (value: any) => (value.outcome = "needs_clarification"),
      (value: any) => (value.outcome = "retrieval_match"),
      (value: any) => delete value.confidence,
      (value: any) => (value.confidence = 0.8),
      (value: any) => (value.confidence = "quite sure"),
    ]) {
      const value = structuredClone(single);
      mutate(value);
      expect(FamilyPlacement.safeParse(value).success).toBe(
        validateFamilyPlacement(value).ok,
      );
      expect(validateFamilyPlacement(value).ok).toBe(false);
    }
  });

  it("unmapped carries nothing at all — no families, no confidence, no borrowed questions", () => {
    for (const mutate of [
      (value: any) => (value.questions = ["Nearest family's question"]),
      (value: any) => (value.confidence = "possible"),
      (value: any) => (value.families = [{ familyId: "delivery-leadership-example", version: 1 }]),
    ]) {
      const value = structuredClone(placements[2]);
      mutate(value);
      expect(FamilyPlacement.safeParse(value).success).toBe(
        validateFamilyPlacement(value).ok,
      );
      expect(validateFamilyPlacement(value).ok).toBe(false);
    }
  });
});

// #281 — the seventh fact's contract, the family placement's twin at its own version. Same two
// outcomes and no third: nobody is ever asked which industry their employer was in.
// #282 takes it to v2: confidence rides on EACH industry rather than on the placement, because the
// employer's own industry and the industry the work was served into are known to different
// strengths and one number for both lets the weaker ride on the stronger.
describe("Industry placement v2", () => {
  const placements = fixture("industry-placement.valid.json");

  it("accepts only confirmed and unmapped outcomes in oracle and zod", () => {
    for (const placement of placements) {
      expect(validateIndustryPlacement(placement).ok).toBe(true);
      expect(IndustryPlacement.safeParse(placement).success).toBe(true);
    }
  });

  it("carries one or more immutable industry versions, distinct, each with its own confidence", () => {
    const [single, dual] = placements;
    expect(single.industries).toEqual([
      { industryId: "banking", version: 1, confidence: "certain" },
    ]);
    // Two industries is the ORDINARY plural case (a consultancy job served into banking), not an
    // edge case — and the count stays unbounded so a labeler drifting to three stays visible.
    expect(dual.industries).toHaveLength(2);
    // The whole point of v2: the employer is known for certain, the served industry only possibly.
    expect(dual.industries.map((i: any) => i.confidence)).toEqual(["certain", "possible"]);
    // ...and nothing sits on the placement itself any more.
    expect(dual.confidence).toBeUndefined();

    const three = structuredClone(dual);
    three.industries.push({ industryId: "software", version: 1, confidence: "likely" });
    expect(validateIndustryPlacement(three).ok).toBe(true);
    expect(IndustryPlacement.safeParse(three).success).toBe(true);

    for (const mutate of [
      (value: any) => delete value.industries[0].version,
      (value: any) => (value.industries = []),
      (value: any) => (value.industries = null),
      (value: any) => (value.industries = [null]),
      (value: any) => (value.industries = "banking"),
      // The same industry named twice — a job that is two of the same thing is not a plural case,
      // and it stays one even when the labeler was differently sure the second time.
      (value: any) => (value.industries = [value.industries[0], { ...value.industries[0] }]),
      (value: any) =>
        (value.industries = [
          value.industries[0],
          { ...value.industries[0], confidence: "possible" },
        ]),
      // A family placement is NOT an industry placement, however alike they look.
      (value: any) => ((value.families = value.industries), delete value.industries),
      (value: any) => (value.industries[0].industryId = "Banking"),
      (value: any) => (value.industries[0].version = 0),
      (value: any) => (value.schemaVersion = "3"),
      // v1's shape is not v2's: a placement-level confidence, and industries without one.
      (value: any) => (value.schemaVersion = "1"),
      (value: any) => (value.outcome = "needs_clarification"),
      (value: any) => delete value.industries[0].confidence,
      (value: any) => (value.industries[0].confidence = 0.8),
      (value: any) => (value.industries[0].confidence = "quite sure"),
      // The old placement-level field is now a stray key, not a second opinion.
      (value: any) => (value.confidence = "certain"),
    ]) {
      const value = structuredClone(single);
      mutate(value);
      expect(IndustryPlacement.safeParse(value).success).toBe(
        validateIndustryPlacement(value).ok,
      );
      expect(validateIndustryPlacement(value).ok).toBe(false);
    }
  });

  it("unmapped carries nothing at all — no industries, no confidence", () => {
    for (const mutate of [
      (value: any) => (value.confidence = "possible"),
      (value: any) =>
        (value.industries = [{ industryId: "banking", version: 1, confidence: "certain" }]),
      (value: any) => (value.reason = "nothing fits"),
    ]) {
      const value = structuredClone(placements[2]);
      mutate(value);
      expect(IndustryPlacement.safeParse(value).success).toBe(
        validateIndustryPlacement(value).ok,
      );
      expect(validateIndustryPlacement(value).ok).toBe(false);
    }
  });
});

describe("Family floor v1", () => {
  const valid = fixture("family-floor-v1.test-fixture.json");

  it("validates ranked essentials, question metadata, evidence destination, and negative semantics", () => {
    expect(validateFamilyFloorV1(valid).ok).toBe(true);
    expect(FamilyFloorV1.safeParse(valid).success).toBe(true);
    expect(valid.essentialItems.map((item: any) => item.priority)).toEqual([1, 2]);
  });

  it("keeps oracle and zod aligned for every required structural invariant", () => {
    const mutations: Array<(value: any) => void> = [
      (value) => delete value.essentialItems[0].priority,
      (value) => (value.essentialItems[1].priority = 1),
      (value) => delete value.essentialItems[0].question.prompt,
      (value) => (value.essentialItems[0].question.options = []),
      (value) => (value.essentialItems[1].question.options = [
        { value: "x", label: "X" },
      ]),
      (value) => delete value.essentialItems[0].evidenceDestination,
      (value) => delete value.essentialItems[0].negativeSemantics,
      (value) => (value.source = "production"),
      (value) => (value.productionRewardEligible = true),
    ];

    for (const mutate of mutations) {
      const value = structuredClone(valid);
      mutate(value);
      const oracle = validateFamilyFloorV1(value).ok;
      expect(FamilyFloorV1.safeParse(value).success).toBe(oracle);
      expect(oracle).toBe(false);
    }
  });
});

describe("Ad requirements v1 (#102)", () => {
  const valid = fixture("ad-requirements-v1.valid.json");

  it("validates band, kind, comparable, eligibility dimension, and provenance", () => {
    expect(validateAdRequirementsV1(valid).ok).toBe(true);
    expect(AdRequirementsV1.safeParse(valid).success).toBe(true);
  });

  it("keeps oracle and zod aligned for every required structural invariant", () => {
    const mutations: Array<(value: any) => void> = [
      (value) => (value.schemaVersion = "0"),
      (value) => delete value.adId,
      (value) => (value.language = ""),
      (value) => delete value.familyFit,
      (value) => (value.familyFit.confidence = 1.5),
      (value) => (value.requirements = []),
      (value) => delete value.requirements[0].requirement,
      (value) => (value.requirements[0].band = "must"), // the retired v0 vocabulary
      (value) => (value.requirements[0].kind = "mandatory"),
      (value) => delete value.requirements[0].sourceSpan,
      (value) => (value.requirements[1].id = value.requirements[0].id), // duplicate id
      (value) => (value.requirements[2].comparable.op = "~"),
      (value) => (value.requirements[2].comparable.value = "8"),
      (value) => (value.requirements[2].eligibilityDimension = "citizenship"),
      (value) => (value.requirements[0].unknownField = true),
      // #107 (E5 slice 6, D1): eligibilitySubject must be a non-empty string when present.
      (value) => (value.requirements[3].eligibilitySubject = ""),
      // #165: eligibilityLevel is a rung of the ladder or nothing — never a grade ("B2"), never an
      // adjective ("fluent"), never an empty string.
      (value) => (value.requirements[3].eligibilityLevel = "fluent"),
      (value) => (value.requirements[3].eligibilityLevel = "B2"),
      (value) => (value.requirements[3].eligibilityLevel = "everyday"), // never a rung
      (value) => (value.requirements[3].eligibilityLevel = "work"), // never a rung
      (value) => (value.requirements[3].eligibilityLevel = ""),
    ];
    for (const mutate of mutations) {
      const value = structuredClone(valid);
      mutate(value);
      const oracle = validateAdRequirementsV1(value).ok;
      expect(AdRequirementsV1.safeParse(value).success).toBe(oracle);
      expect(oracle).toBe(false);
    }
  });

  // Regression, from #86's own measured failure: an essential-band CAPABILITY requirement must be
  // representable as ordinary, never forced into blocking — "communicate with stakeholders" is the
  // spec's own example of a requirement that was misclassified blocking when the definition was loose.
  it("an essential-band capability requirement represents as ordinary, never forced blocking", () => {
    const stakeholderComms = valid.requirements.find(
      (r: { id: string }) => r.id === "drive-stakeholder-communication",
    );
    expect(stakeholderComms.band).toBe("essential");
    expect(stakeholderComms.kind).toBe("ordinary");
    expect(validateAdRequirementsV1(valid).ok).toBe(true);
  });

  // Regression: a vague advert phrase ("Mandarin an advantage") must be representable as ordinary
  // WITHOUT the contract forcing a blocking/not-blocking guess — omitting `kind` entirely defaults to
  // "ordinary" in both oracle and zod, so silence is the safe reading, not an error.
  it("a vague requirement omits kind entirely and still validates, defaulting to ordinary", () => {
    const vague = structuredClone(valid);
    vague.requirements = [
      {
        id: "mandarin-advantage",
        band: "nice-to-have",
        requirement: "Mandarin an advantage",
        sourceSpan: "Mandarin an advantage",
      },
    ];
    expect(validateAdRequirementsV1(vague).ok).toBe(true);
    const parsed = AdRequirementsV1.parse(vague);
    expect(parsed.requirements[0]!.kind).toBe("ordinary");
  });

  // Regression: "8+ years" carries a value five can be compared against, not only a sentence.
  it("a years bar carries a comparable value, not only prose", () => {
    const yearsBar = valid.requirements.find((r: { id: string }) => r.id === "it-experience-years");
    expect(yearsBar.comparable).toEqual({ op: ">=", value: 8 });
    expect(5 >= yearsBar.comparable.value).toBe(false);
    expect(9 >= yearsBar.comparable.value).toBe(true);
  });

  // Regression, #107 (E5 slice 6): eligibilitySubject is what lets a blocking language/certification
  // requirement avoid being matched against the wrong subject — "Mandarin" is not "English", and
  // without a subject there is no way to tell them apart at the withdrawal check (apps/api/src/
  // withdrawal.ts). An additive v1 field: omitting it (every pre-#107 payload) still validates.
  it("a blocking language requirement carries the advert's own subject, not just the dimension", () => {
    const englishFluency = valid.requirements.find((r: { id: string }) => r.id === "english-fluency");
    expect(englishFluency.kind).toBe("blocking");
    expect(englishFluency.eligibilityDimension).toBe("language");
    expect(englishFluency.eligibilitySubject).toBe("English");

    const withoutSubject = structuredClone(valid);
    delete withoutSubject.requirements[3].eligibilitySubject;
    expect(validateAdRequirementsV1(withoutSubject).ok).toBe(true); // still a valid v1 payload
    expect(AdRequirementsV1.safeParse(withoutSubject).success).toBe(true);
  });

  // #165 AC5 — the advert side gains a LEVEL, in both contract homes at once. Additive to v1 exactly
  // as eligibilitySubject was: every already-stored payload validates unchanged with the field
  // absent, which is also the honest reading of an advert that names a language without saying what
  // it needs it for.
  it("a language requirement may carry the rung it tests, and both homes agree on the vocabulary", () => {
    const withLevel = structuredClone(valid);
    withLevel.requirements[3].eligibilityLevel = "meetings";
    expect(validateAdRequirementsV1(withLevel).ok).toBe(true);
    expect(AdRequirementsV1.safeParse(withLevel).success).toBe(true);
    expect(AdRequirementsV1.parse(withLevel).requirements[3]!.eligibilityLevel).toBe("meetings");

    for (const rung of ["not-at-all", "a-few-words", "gets-by", "meetings", "negotiate", "native"]) {
      const value = structuredClone(valid);
      value.requirements[3].eligibilityLevel = rung;
      expect(validateAdRequirementsV1(value).ok).toBe(true);
      expect(AdRequirementsV1.safeParse(value).success).toBe(true);
    }

    // Absent is valid, and stays the default: an advert that says "Mandarin" and nothing more has
    // stated no bar, and the contract must not invent one.
    expect(validateAdRequirementsV1(valid).ok).toBe(true);
    expect(AdRequirementsV1.parse(valid).requirements[3]!.eligibilityLevel).toBeUndefined();
  });

  // #222 — a years bar may name WHICH SCOPE of the visitor's worked-out years it tests ("family" =
  // years doing this advert's kind of work, "total" = the whole career). Additive to v1 exactly as
  // eligibilitySubject/eligibilityLevel were: every already-stored payload validates unchanged with
  // the field absent (which reads as family scope — the plain meaning of a years bar on a role
  // advert).
  it("a years bar may carry its scope, and both homes agree on the vocabulary", () => {
    for (const scope of ["family", "industry", "total"]) {
      const value = structuredClone(valid);
      value.requirements[2].yearsScope = scope;
      expect(validateAdRequirementsV1(value).ok).toBe(true);
      expect(AdRequirementsV1.safeParse(value).success).toBe(true);
      expect(AdRequirementsV1.parse(value).requirements[2]!.yearsScope).toBe(scope);
    }

    const junk = structuredClone(valid);
    junk.requirements[2].yearsScope = "career";
    expect(validateAdRequirementsV1(junk).ok).toBe(false);
    expect(AdRequirementsV1.safeParse(junk).success).toBe(false);

    // Absent is valid — the shape every pre-#222 stored payload has.
    expect(validateAdRequirementsV1(valid).ok).toBe(true);
    expect(AdRequirementsV1.parse(valid).requirements[2]!.yearsScope).toBeUndefined();
  });

  // #284 — the third scope names WHICH published industry, on its own field. Additive on the same
  // terms as every extension before it: absent is valid everywhere, including beside an "industry"
  // scope, because an advert naming an industry we do not publish carries none.
  it("an industry-scope years bar may name the published industry it is about", () => {
    const value = structuredClone(valid);
    value.requirements[2].yearsScope = "industry";
    value.requirements[2].yearsIndustry = "it-services";
    expect(validateAdRequirementsV1(value).ok).toBe(true);
    expect(AdRequirementsV1.parse(value).requirements[2]!.yearsIndustry).toBe("it-services");

    // An empty id is not "no industry" — absence is how none is said.
    const empty = structuredClone(value);
    empty.requirements[2].yearsIndustry = "";
    expect(validateAdRequirementsV1(empty).ok).toBe(false);
    expect(AdRequirementsV1.safeParse(empty).success).toBe(false);

    // The untestable bar: an industry scope carrying no id at all is a valid payload.
    const none = structuredClone(valid);
    none.requirements[2].yearsScope = "industry";
    expect(validateAdRequirementsV1(none).ok).toBe(true);
    expect(AdRequirementsV1.parse(none).requirements[2]!.yearsIndustry).toBeUndefined();
  });
});

describe("CandidateClaims v1", () => {
  const schema = JSON.parse(
    readFileSync(join(here, "..", "oracle", "candidate_claims.schema.json"), "utf8"),
  );
  const validateSchema = new Ajv2020({ allErrors: true }).compile(schema);
  const valid = {
    schemaVersion: "1",
    roles: [],
    claims: [{
      id: "acme-delivery",
      semantic_key: "experience-acme-delivery",
      field_key: null,
      field_value: null,
      field_label: null,
      role: "PM - Acme",
      text: "Led delivery",
      machine_touch: "verbatim",
      classification: "Verified",
      source_quote: "Led delivery",
      needs_grill: false,
      grill_hint: null,
    }],
    parser_flags: [],
  };

  it("keeps oracle and zod aligned on stable identity and paired fields", () => {
    expect(validateCandidateClaims(valid).ok).toBe(true);
    expect(CandidateClaims.safeParse(valid).success).toBe(true);
    expect(validateSchema(valid)).toBe(true);
    for (const mutate of [
      (doc: any) => { doc.schemaVersion = "0"; },
      (doc: any) => { delete doc.claims[0].semantic_key; },
      (doc: any) => { delete doc.claims[0].id; },
      (doc: any) => { doc.claims[0].semantic_key = "Bad Key"; },
      (doc: any) => { doc.claims[0].field_key = "role-title"; },
      (doc: any) => {
        doc.claims[0].field_key = null;
        doc.claims[0].field_value = "PM";
      },
      (doc: any) => { doc.claims[0].field_label = "Role title"; },
      (doc: any) => { doc.claims[0].id = "Bad ID"; },
      (doc: any) => { doc.claims[0].role = ""; },
      (doc: any) => { doc.claims[0].text = ""; },
      (doc: any) => { doc.claims[0].machine_touch = "unknown"; },
      (doc: any) => { doc.claims[0].classification = "Certified"; },
      (doc: any) => { doc.claims[0].source_quote = ""; },
      (doc: any) => { doc.claims[0].source_quote = "x".repeat(201); },
      (doc: any) => { doc.claims[0].needs_grill = "yes"; },
      (doc: any) => {
        doc.claims[0].machine_touch = "inferred";
        doc.claims[0].needs_grill = false;
      },
      (doc: any) => {
        doc.claims[0].needs_grill = true;
        doc.claims[0].grill_hint = null;
      },
      (doc: any) => { doc.claims = []; },
      (doc: any) => { doc.parser_flags = [1]; },
      (doc: any) => {
        doc.claims[0].field_key = "role-title";
        doc.claims[0].field_value = " ";
        doc.claims[0].field_label = "Role title";
      },
      (doc: any) => {
        doc.roles = [{ employer: "", title: "PM", dates_as_written: "", dates_missing: false }];
      },
      (doc: any) => {
        doc.roles = [{ employer: "Acme", title: "", dates_as_written: "", dates_missing: false }];
      },
      (doc: any) => {
        doc.roles = [{ employer: "Acme", title: "PM", dates_as_written: 2020, dates_missing: false }];
      },
      (doc: any) => {
        doc.roles = [{ employer: "Acme", title: "PM", dates_as_written: "", dates_missing: "no" }];
      },
    ]) {
      const doc = structuredClone(valid);
      mutate(doc);
      const oracle = validateCandidateClaims(doc).ok;
      expect(CandidateClaims.safeParse(doc).success).toBe(oracle);
      expect(validateSchema(doc)).toBe(oracle);
      expect(oracle).toBe(false);
    }
  });
});

describe("MinedJobBlocks v1 (#161)", () => {
  const employer = {
    value: "Standard Chartered",
    source_quote: "Standard Chartered Bank",
    machine_touch: "verbatim",
    classification: "Verified",
  };
  const title = {
    value: "Regional PM",
    source_quote: "Regional Project Manager",
    machine_touch: "verbatim",
    classification: "Verified",
  };
  const start = {
    value: { year: 2019, month: 1, precision: "month" },
    source_quote: "Jan 2019",
    machine_touch: "verbatim",
    classification: "Verified",
  };
  const end = {
    value: { state: "ended", date: { year: 2022, month: 3, precision: "month" } },
    source_quote: "Mar 2022",
    machine_touch: "verbatim",
    classification: "Verified",
  };
  const kind = {
    value: "job",
    source_quote: "Regional Project Manager, Standard Chartered",
    machine_touch: "verbatim",
    classification: "Verified",
  };
  const valid = {
    schemaVersion: "1",
    blocks: [{ id: "block-1", employer, title, start, end, kind }],
    parser_flags: [],
  };

  it("valid fixture passes both oracle and zod", () => {
    expect(validateMinedJobBlocks(valid).ok).toBe(true);
    expect(MinedJobBlocks.safeParse(valid).success).toBe(true);
  });

  it("a no-end-date job stores an explicit 'unknown' end, distinct from 'ongoing'", () => {
    const unknownEnd = structuredClone(valid);
    unknownEnd.blocks[0].end = {
      value: { state: "unknown" },
      source_quote: null,
      machine_touch: "verbatim",
      classification: "Verified",
    };
    expect(validateMinedJobBlocks(unknownEnd).ok).toBe(true);
    expect(MinedJobBlocks.safeParse(unknownEnd).success).toBe(true);

    const ongoing = structuredClone(valid);
    ongoing.blocks[0].end = {
      value: { state: "ongoing" },
      source_quote: "Present",
      machine_touch: "verbatim",
      classification: "Verified",
    };
    expect(validateMinedJobBlocks(ongoing).ok).toBe(true);
    expect(MinedJobBlocks.safeParse(ongoing).success).toBe(true);
  });

  it("a CV with no dated jobs is a valid empty-blocks doc, not a rejected one", () => {
    const empty = { schemaVersion: "1", blocks: [], parser_flags: ["no-dated-jobs-found"] };
    expect(validateMinedJobBlocks(empty).ok).toBe(true);
    expect(MinedJobBlocks.safeParse(empty).success).toBe(true);
  });

  it("keeps oracle and zod aligned for every required structural invariant", () => {
    const mutations: Array<(doc: any) => void> = [
      (doc) => (doc.schemaVersion = "2"),
      (doc) => (doc.blocks[0].id = "Not A Slug"),
      (doc) => (doc.blocks[0].employer.value = ""),
      (doc) => (doc.blocks[0].employer.source_quote = ""),
      (doc) => (doc.blocks[0].employer.source_quote = "x".repeat(201)),
      (doc) => (doc.blocks[0].employer.machine_touch = "typed"),
      (doc) => (doc.blocks[0].employer.classification = "Unsupported-but-Plausible"),
      (doc) => (doc.blocks[0].start.value.precision = "year"), // month set, precision says year — inconsistent
      (doc) => (doc.blocks[0].start.value.month = null), // month precision requires a month

      (doc) => (doc.blocks[0].start.value.year = 1899),
      (doc) => (doc.blocks[0].end.value = { state: "ended" }), // ended with no date
      (doc) => (doc.blocks[0].end.source_quote = null), // ended but no source quote
      (doc) => {
        doc.blocks[0].end.value = { state: "unknown" };
        doc.blocks[0].end.source_quote = "something"; // unknown must have nothing to quote
      },
      (doc) => (doc.blocks[0].end.value = { state: "sabbatical" }),
      (doc) => (doc.blocks[0].kind.value = "hobby"),
      (doc) => (doc.parser_flags = [1]),
    ];
    for (const mutate of mutations) {
      const doc = structuredClone(valid);
      mutate(doc);
      const oracle = validateMinedJobBlocks(doc).ok;
      expect(MinedJobBlocks.safeParse(doc).success, `zod/oracle disagree after ${mutate.toString()}`).toBe(oracle);
      expect(oracle).toBe(false);
    }
  });
});

describe("Contract 1 — claim graph", () => {
  it("valid fixture passes both oracle and zod", () => {
    const g = fixture("graph.valid.json");
    expect(validateGraph(g).ok).toBe(true);
    expect(ClaimGraph.safeParse(g).success).toBe(true);
  });

  it("invalid fixture fails both oracle and zod", () => {
    const g = fixture("graph.invalid.json");
    const oracle = validateGraph(g);
    const port = ClaimGraph.safeParse(g);
    expect(oracle.ok).toBe(false);
    expect(port.success).toBe(false);
    // the safety-critical invariant specifically: Negative => renderable=false
    expect(oracle.errors.join("\n")).toMatch(/renderable=false/);
    expect(JSON.stringify(port.error?.issues)).toMatch(/renderable=false/);
  });

  it("per-invariant mutations keep oracle and zod in agreement", () => {
    const base = fixture("graph.valid.json");
    const mutations: Array<(g: any) => void> = [
      (g) => (g.nodes[0].id = "Not A Slug"),
      (g) => (g.nodes[0].tags = []),
      (g) => (g.nodes[0].source_file = null), // Verified needs provenance
      (g) => (g.nodes[2].narrative_ref = null), // enrichment needs narrative
      (g) => (g.nodes[2].risk = null), // UbP needs risk
      (g) => (g.nodes[1].renderable = true), // Negative must not render
      (g) => (g.nodes[0].confirmed_date = "17-07-2026"), // ISO date
      (g) => g.nodes.push({ ...g.nodes[0] }), // duplicate id
      (g) => (g.graphVersion = 0),
    ];
    for (const mutate of mutations) {
      const g = JSON.parse(JSON.stringify(base));
      mutate(g);
      const oracle = validateGraph(g).ok;
      const port = ClaimGraph.safeParse(g).success;
      expect(port, `zod/oracle disagree after ${mutate.toString()}`).toBe(oracle);
      expect(oracle).toBe(false);
    }
  });
});

describe("Contract 3 — enrichment inbox", () => {
  it("valid fixture passes both oracle and zod", () => {
    const inbox = fixture("inbox.valid.json");
    expect(validateInbox(inbox).ok).toBe(true);
    expect(Inbox.safeParse(inbox).success).toBe(true);
  });

  it("invalid fixture fails both oracle and zod", () => {
    const inbox = fixture("inbox.invalid.json");
    expect(validateInbox(inbox).ok).toBe(false);
    expect(Inbox.safeParse(inbox).success).toBe(false);
  });

  it("per-invariant mutations keep oracle and zod in agreement", () => {
    const base = fixture("inbox.valid.json");
    const mutations: Array<(i: any) => void> = [
      (i) => (i.proposals[0].interviewNarrative = ""), // every stretch carries a narrative
      (i) => (i.proposals[0].state = "parked"), // bad enum
      (i) => (i.proposals[1].decidedAt = null), // approved needs decidedAt
      (i) => (i.proposals[0].narrativeAnchor = "Bad Anchor!"),
      (i) => i.proposals.push({ ...i.proposals[0] }), // duplicate id
    ];
    for (const mutate of mutations) {
      const inbox = JSON.parse(JSON.stringify(base));
      mutate(inbox);
      const oracle = validateInbox(inbox).ok;
      const port = Inbox.safeParse(inbox).success;
      expect(port, `zod/oracle disagree after ${mutate.toString()}`).toBe(oracle);
      expect(oracle).toBe(false);
    }
  });
});

describe("JobCard v1", () => {
  it("valid scored fixture passes both oracle and zod", () => {
    const card = fixture("job-card-v1.valid.json");
    expect(validateJobCardV1(card).ok).toBe(true);
    expect(JobCardV1.safeParse(card).success).toBe(true);
  });

  it("valid pending fixture passes both oracle and zod (#117: no number claimed)", () => {
    const card = fixture("job-card-v1.pending.json");
    expect(validateJobCardV1(card).ok).toBe(true);
    expect(JobCardV1.safeParse(card).success).toBe(true);
  });

  it("rejects invalid counts, ranges, and versions in both", () => {
    const mutations: Array<(card: any) => void> = [
      (card) => (card.schemaVersion = "2"),
      (card) => (card.matchPct = 101),
      (card) => (card.breakdown.essential.met = -1),
      (card) => (card.breakdown.desirable.total = 1.5),
      (card) => (card.breakdown.essential.met = card.breakdown.essential.total + 1),
      (card) => delete card.title,
      (card) => (card.salary = 42),
      (card) => delete card.bubble.open,
      (card) => (card.fit[0].text = null),
      (card) => (card.dontYet[0].band = "critical"),
      (card) => (card.askedClosed = {}),
      (card) => delete card.adExcerpt,
      // #117 provenance: absent or unknown `scored` is rejected, and a scored card never
      // carries the not-scored nulls.
      (card) => delete card.scored,
      (card) => (card.scored = "maybe"),
      (card) => ((card.scored = "pending"), void 0), // scored says pending but numbers still present
    ];
    for (const mutate of mutations) {
      const card = fixture("job-card-v1.valid.json");
      mutate(card);
      expect(JobCardV1.safeParse(card).success).toBe(validateJobCardV1(card).ok);
      expect(validateJobCardV1(card).ok).toBe(false);
    }
  });

  it("rejects a pending card that claims any number (#117 AC5) in both", () => {
    const mutations: Array<(card: any) => void> = [
      (card) => (card.matchPct = 50),
      (card) => (card.breakdown = { essential: { met: 0, total: 1 }, desirable: { met: 0, total: 0 } }),
      (card) => (card.bubble = { hit: "x", open: "y" }),
      (card) => (card.dontYet = [{ id: "r", band: "essential", requirement: "x" }]),
    ];
    for (const mutate of mutations) {
      const card = fixture("job-card-v1.pending.json");
      mutate(card);
      expect(JobCardV1.safeParse(card).success).toBe(validateJobCardV1(card).ok);
      expect(validateJobCardV1(card).ok).toBe(false);
    }
  });
});

describe("Posting retrieval v1 (#99)", () => {
  const valid = fixture("posting-retrieval-v1.valid.json");

  it("valid fixture passes oracle and zod", () => {
    expect(validatePostingRetrievalResultV1(valid).ok).toBe(true);
    expect(PostingRetrievalResultV1.safeParse(valid).success).toBe(true);
  });

  it("keeps oracle and zod aligned for every required structural invariant", () => {
    const mutations: Array<(value: any) => void> = [
      // top-level schemaVersion is pinned to "4" (#133) on every arm, not any prior version
      (value) => (value.schemaVersion = "1"),
      (value) => (value.schemaVersion = "2"),
      (value) => (value.schemaVersion = "3"),
      // unknown/extra keys rejected — same mechanism as the ad-requirements oracle
      (value) => (value.unknownField = true),
      (value) => (value.postings[0].unknownField = true),
      // applicantLocationRequirements was REMOVED (#133) — reintroducing it is now an unknown key
      (value) => (value.postings[0].applicantLocationRequirements = []),
      // PostingV1.id must equal "posting:" + canonicalKey — enforce the derivation
      (value) => (value.postings[0].id = "posting:not-the-real-key"),
      // PostingV1 carries schemaVersion "4" (#133), not any prior version
      (value) => (value.postings[0].schemaVersion = "1"),
      (value) => (value.postings[0].schemaVersion = "2"),
      (value) => (value.postings[0].schemaVersion = "3"),
      // PostingV1.sources has min length 1
      (value) => (value.postings[0].sources = []),
      // canonicalKey must actually BE sha256(normalize(company)+"|"+normalize(location)+"|"
      // +normalize(title)) — not just any non-empty string that happens to match `id`. Keep id and
      // canonicalKey consistent with EACH OTHER here so only the hash-derivation check fires, not
      // the separate id-derivation one.
      (value) => {
        const fakeKey = "0".repeat(64);
        value.postings[0].canonicalKey = fakeKey;
        value.postings[0].id = `posting:${fakeKey}`;
      },
      // PostingV1.language is required (#100)
      (value) => delete value.postings[0].language,
      // relevant_postings requires postings non-empty
      (value) => (value.postings = []),
      // coverage.complete === (providersUnavailable.length === 0) — an inconsistent pair is invalid
      (value) => {
        value.coverage.complete = true;
        value.coverage.providersUnavailable = ["techmap"];
      },
      // empty_pool requires coverage.complete === true — an empty result while a provider was
      // unavailable is not an empty pool. coverage is internally CONSISTENT here (complete=false
      // matches a non-empty providersUnavailable), so only the outcome-level rule can catch this.
      (value) => {
        value.outcome = "empty_pool";
        delete value.postings;
        value.coverage.complete = false;
        value.coverage.providersUnavailable = ["techmap"];
      },
      // invalid_request.code must be one of exactly the four named codes
      (value) => {
        value.outcome = "invalid_request";
        delete value.postings;
        delete value.coverage;
        delete value.retrievedAt;
        value.code = "not_a_real_code";
      },
      // empty_pool requires at least one provider to have been queried — a well-formed empty sweep
      // with zero providers asked (and none unavailable) is search_area_not_covered, not empty_pool.
      (value) => {
        value.outcome = "empty_pool";
        delete value.postings;
        value.coverage = { providersQueried: [], providersUnavailable: [], complete: true };
      },
    ];
    for (const mutate of mutations) {
      const value = structuredClone(valid);
      mutate(value);
      const oracle = validatePostingRetrievalResultV1(value).ok;
      expect(PostingRetrievalResultV1.safeParse(value).success, `zod/oracle disagree after ${mutate.toString()}`).toBe(oracle);
      expect(oracle).toBe(false);
    }
  });

  it("accepts every named invalid_request code", () => {
    for (const code of [
      "missing_intent",
      "family_not_published",
      "floor_not_covered",
      "search_area_not_covered",
    ]) {
      const invalidRequest = { schemaVersion: "4", outcome: "invalid_request", code };
      expect(validatePostingRetrievalResultV1(invalidRequest).ok).toBe(true);
      expect(PostingRetrievalResultV1.safeParse(invalidRequest).success).toBe(true);
    }
  });

  it("empty_pool with a fully complete coverage sweep validates in both", () => {
    const emptyPool = {
      schemaVersion: "4",
      outcome: "empty_pool",
      coverage: { providersQueried: ["curated-pool"], providersUnavailable: [], complete: true },
      retrievedAt: "2026-08-01T09:05:00Z",
    };
    expect(validatePostingRetrievalResultV1(emptyPool).ok).toBe(true);
    expect(PostingRetrievalResultV1.safeParse(emptyPool).success).toBe(true);
  });
});

describe("ProviderPostingRecordV1 (#99, #100, #133)", () => {
  const valid = {
    schemaVersion: "3",
    providerId: "curated-pool",
    providerPostingId: "curated-001",
    title: "Senior Project Manager",
    company: "BNP Paribas",
    location: "Hong Kong",
    sourceUrl: "https://example.com/jobs/senior-project-manager",
    excerpt: "Lead delivery of a portfolio of technology programs across APAC.",
    postedAt: "2026-07-28T00:00:00Z",
    capturedAt: "2026-07-29T09:00:00Z",
    verifiedLiveAt: "2026-08-01T09:00:00Z",
    expiresAt: "2026-09-01T00:00:00Z",
    attribution: null,
    skills: ["Agile delivery"],
    language: "en",
  };

  it("valid record passes oracle and zod", () => {
    expect(validateProviderPostingRecordV1(valid).ok).toBe(true);
    expect(ProviderPostingRecordV1.safeParse(valid).success).toBe(true);
  });

  it("keeps oracle and zod aligned for every required structural invariant", () => {
    const mutations: Array<(value: any) => void> = [
      (value) => (value.schemaVersion = "1"),
      (value) => (value.schemaVersion = "2"),
      (value) => delete value.providerId,
      (value) => (value.title = ""),
      (value) => (value.postedAt = ""), // non-empty string or null, not an empty string
      (value) => (value.attribution = { label: "via X" }), // missing url
      // applicantLocationRequirements was REMOVED (#133) — reintroducing it is now an unknown key
      (value) => (value.applicantLocationRequirements = ["Hong Kong"]),
      (value) => (value.skills = "Agile delivery"), // must be an array
      (value) => delete value.language, // #100: required
      (value) => (value.language = ""), // non-empty
      (value) => (value.unknownField = true),
    ];
    for (const mutate of mutations) {
      const value = structuredClone(valid);
      mutate(value);
      const oracle = validateProviderPostingRecordV1(value).ok;
      expect(ProviderPostingRecordV1.safeParse(value).success, `zod/oracle disagree after ${mutate.toString()}`).toBe(oracle);
      expect(oracle).toBe(false);
    }
  });
});

describe("PostingProviderPolicyV1 (#99, #100)", () => {
  const valid = {
    schemaVersion: "2",
    providerId: "curated-pool",
    regionsServed: ["*"],
    authorityRank: 0,
    permitsStorage: true,
    permitsMatching: true,
    attributionRequired: false,
    attributionTemplate: null,
    rateLimit: { perSecond: null, perMinute: null, perDay: null, perMonth: null },
    retry: { maxAttempts: 1, backoffMs: 0 },
    timeoutMs: 5000,
    costModel: { kind: "operatorHours" },
    freshnessTtlHours: 24,
  };

  it("valid policy passes oracle and zod", () => {
    expect(validatePostingProviderPolicyV1(valid).ok).toBe(true);
    expect(PostingProviderPolicyV1.safeParse(valid).success).toBe(true);
  });

  it("keeps oracle and zod aligned for every required structural invariant, including Infinity regression", () => {
    const mutations: Array<(value: any) => void> = [
      (value) => (value.schemaVersion = "1"),
      (value) => (value.regionsServed = []),
      // Regression: the oracle's isNumber requires Number.isFinite; a bare z.number() would have
      // silently accepted Infinity where the oracle rejects it. Every numeric field, checked.
      (value) => (value.authorityRank = Infinity),
      (value) => (value.freshnessTtlHours = Infinity),
      (value) => (value.rateLimit.perMinute = Infinity),
      (value) => (value.rateLimit.perSecond = Infinity), // #100
      (value) => {
        value.costModel = { kind: "perThousandPostings", amountUsd: Infinity };
      },
      (value) => {
        value.costModel = { kind: "flatMonthlyTier", amountUsd: 59, includedUnits: Infinity };
      },
      (value) => (value.costModel = { kind: "not-a-real-kind" }),
      (value) => (value.attributionTemplate = { label: "x" }), // missing url
      // #100: retry is bounded to 1-2 total attempts, backoffMs non-negative, timeoutMs positive
      (value) => (value.retry.maxAttempts = 3),
      (value) => (value.retry.maxAttempts = 0),
      (value) => (value.retry.backoffMs = -1),
      (value) => delete value.retry,
      (value) => (value.timeoutMs = 0),
      (value) => (value.timeoutMs = Infinity),
      (value) => delete value.timeoutMs,
      (value) => (value.unknownField = true),
    ];
    for (const mutate of mutations) {
      const value = structuredClone(valid);
      mutate(value);
      const oracle = validatePostingProviderPolicyV1(value).ok;
      expect(PostingProviderPolicyV1.safeParse(value).success, `zod/oracle disagree after ${mutate.toString()}`).toBe(oracle);
      expect(oracle).toBe(false);
    }
  });

  it("permitsStorage/permitsMatching default to false when absent, in both oracle and zod", () => {
    const { permitsStorage, permitsMatching, ...withoutDefaults } = valid;
    const rowWithBooleansFalse = { ...valid, permitsStorage: false, permitsMatching: false };
    expect(validatePostingProviderPolicyV1(withoutDefaults).ok).toBe(true);
    const parsed = PostingProviderPolicyV1.parse(withoutDefaults);
    expect(parsed.permitsStorage).toBe(false);
    expect(parsed.permitsMatching).toBe(false);
    expect(validatePostingProviderPolicyV1(rowWithBooleansFalse).ok).toBe(true);
  });
});
