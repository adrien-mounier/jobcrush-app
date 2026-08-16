// #234 (spec #233 decision 2/3) — the one function that decides which family floors the interview
// asks and which family retrieval searches with. Asserted at the seam, on what a caller observes:
// the pair it returns for a placement, a set of dated job records, and the published registry.
//
// Prior art: the adaptive-discovery tests. Every fixture here uses ENDED dates so the years are
// clock-independent — an ongoing job's length would move with today's date and the ranking under
// test with it.
import { describe, expect, it } from "vitest";
import type { FamilyPlacement, JobBlockView, MinedEndValue } from "@jobcrush/contracts";
import { discoveryPlan } from "../src/adaptiveDiscovery.js";
import {
  initialProductionFamilyFloors,
  type ProductionFamilyFloorStore,
  type ProductionFamilyPublicationValue,
} from "../src/familyFloors.js";

const placed = (familyIds: string[], outcome: FamilyPlacement["outcome"] = "confirmed"): FamilyPlacement => ({
  schemaVersion: "2",
  outcome,
  families: familyIds.map((familyId) => ({ familyId, version: 1 })),
  confidence: "certain",
});

const decision = <T>(value: T) => ({
  id: "decision",
  value,
  origin: { kind: "worked_out" as const },
  machine_touch: null,
  classification: null,
});

/** One dated job record placed in `familyIds`, worked from January `from` to December `to`. */
function block(
  id: string,
  familyIds: string[],
  from: number,
  to: number | "unknown",
  countsTowardExperience = true,
): JobBlockView {
  const end: MinedEndValue =
    to === "unknown"
      ? { state: "unknown" }
      : { state: "ended", date: { year: to, month: 12, precision: "month" } };
  return {
    id,
    kind: "job",
    countsTowardExperience,
    employer: decision(`Employer ${id}`),
    title: decision("Regional PM"),
    start: decision({ year: from, month: 1, precision: "month" as const }),
    end: decision(end),
    kindDecision: decision("job" as const),
    family: decision(familyIds.length ? placed(familyIds) : null),
    confirmed: true,
    matchState: "new",
    candidateBlockIds: [],
  };
}

/** Built from the one REAL published family, with only its identity (and, per case, the two fields
 *  eligibility turns on) swapped — so the eligibility assertions below are made against the shape
 *  `ProductionFamilyFloorStore.publish` actually produces, not a hand-written stand-in for it. */
const REAL = initialProductionFamilyFloors().get("it-project-delivery", 1)!;

const publication = (
  familyId: string,
  version = 1,
  over: Partial<Pick<ProductionFamilyPublicationValue, "publicationStatus">> &
    { productionRewardEligible?: boolean } = {},
): ProductionFamilyPublicationValue => ({
  ...REAL,
  publicationStatus: over.publicationStatus ?? REAL.publicationStatus,
  floor: {
    ...REAL.floor,
    familyId,
    version,
    productionRewardEligible: (over.productionRewardEligible ??
      true) as typeof REAL.floor.productionRewardEligible,
  },
});

const registry = (...publications: ProductionFamilyPublicationValue[]): Pick<ProductionFamilyFloorStore, "active" | "get"> => ({
  active: (familyId) => publications.find((p) => p.floor.familyId === familyId) ?? null,
  get: (familyId, version) =>
    publications.find((p) => p.floor.familyId === familyId && p.floor.version === version) ?? null,
});

const ids = (plan: ReturnType<typeof discoveryPlan>) => plan.questionFloors.map((f) => f.familyId);

describe("#234 the discovery plan", () => {
  it("gives a mapped target role that family as both the question floor and the search family", () => {
    const plan = discoveryPlan(
      placed(["it-project-delivery"]),
      [],
      registry(publication("it-project-delivery")),
    );

    expect(plan).toEqual({
      questionFloors: [{ familyId: "it-project-delivery", version: 1 }],
      searchFamily: { familyId: "it-project-delivery", version: 1 },
    });
  });

  // #235 (spec #233): one path, three causes — a NAMED family that is unpublished, reward-ineligible
  // or simply absent at the placed version behaves exactly like an unmapped role: interviewed on her
  // CV's floors, searched on her typed words.
  it.each([
    ["provisional", registry(publication("it-project-delivery", 1, { publicationStatus: "provisional" as const }), publication("alpha"))],
    ["reward-ineligible", registry(publication("it-project-delivery", 1, { productionRewardEligible: false }), publication("alpha"))],
    ["absent at the placed version", registry(publication("it-project-delivery", 2), publication("alpha"))],
  ])("sends a mapped role whose family is %s to the word search on her CV's floors", (_case, published) => {
    const plan = discoveryPlan(
      placed(["it-project-delivery"]),
      [block("b1", ["alpha"], 2015, 2020)],
      published,
    );

    expect(ids(plan)).toEqual(["alpha"]);
    expect(plan.searchFamily).toBeNull();
  });

  it("interviews an unmapped visitor on the two CV families she has the most years in, strongest first", () => {
    const plan = discoveryPlan(
      placed([], "unmapped"),
      [
        block("b1", ["beta"], 2020, 2021), // 2 years
        block("b2", ["alpha"], 2010, 2018), // 9 years
        block("b3", ["gamma"], 2023, 2023), // 1 year
      ],
      registry(publication("alpha"), publication("beta"), publication("gamma")),
    );

    expect(ids(plan)).toEqual(["alpha", "beta"]);
    expect(plan.searchFamily).toBeNull();
  });

  it("asks every usable target floor in placement order and follows the first family downstream", () => {
    const plan = discoveryPlan(
      placed(["it-project-delivery", "field-marketing"]),
      [block("b1", ["alpha"], 2015, 2020)],
      registry(
        publication("it-project-delivery"),
        publication("field-marketing"),
        publication("alpha"),
      ),
    );

    expect(plan).toEqual({
      questionFloors: [
        { familyId: "it-project-delivery", version: 1 },
        { familyId: "field-marketing", version: 1 },
      ],
      searchFamily: { familyId: "it-project-delivery", version: 1 },
    });
  });

  it("falls back as one unit when any family in a plural target has no usable floor", () => {
    const plan = discoveryPlan(
      placed(["it-project-delivery", "field-marketing"]),
      [block("b1", ["alpha"], 2015, 2020)],
      registry(publication("it-project-delivery"), publication("alpha")),
    );

    expect(ids(plan)).toEqual(["alpha"]);
    expect(plan.searchFamily).toBeNull();
  });

  it("breaks equal years by the most recent job in that family, then by family id", () => {
    const equalYears = discoveryPlan(
      placed([], "unmapped"),
      [
        block("b1", ["alpha"], 2010, 2011), // 2 years, older
        block("b2", ["beta"], 2020, 2021), // 2 years, more recent
      ],
      registry(publication("alpha"), publication("beta")),
    );
    expect(ids(equalYears)).toEqual(["beta", "alpha"]);

    // One job in three families: identical years AND identical recency, so only the id can order it.
    const equalEverything = discoveryPlan(
      placed([], "unmapped"),
      [block("b1", ["zulu", "mike", "alpha"], 2010, 2011)],
      registry(publication("alpha"), publication("mike"), publication("zulu")),
    );
    expect(ids(equalEverything)).toEqual(["alpha", "mike"]);
  });

  it("counts a job carrying two families fully toward each", () => {
    const plan = discoveryPlan(
      placed([], "unmapped"),
      [
        block("b1", ["alpha", "beta"], 2010, 2018), // 9 years toward BOTH, not split
        block("b2", ["gamma"], 2019, 2023), // 5 years
      ],
      registry(publication("alpha"), publication("beta"), publication("gamma")),
    );

    expect(ids(plan)).toEqual(["alpha", "beta"]);
  });

  it("never offers a family that is not published or not reward-eligible", () => {
    const plan = discoveryPlan(
      placed([], "unmapped"),
      [
        block("b1", ["alpha"], 2000, 2019), // most years, but provisional
        block("b2", ["beta"], 2020, 2021), // reward-ineligible
        block("b3", ["gamma"], 2022, 2022),
        block("b4", ["delta"], 2023, 2023), // in no registry at all
      ],
      registry(
        publication("alpha", 1, { publicationStatus: "provisional" as const }),
        publication("beta", 1, { productionRewardEligible: false }),
        publication("gamma"),
      ),
    );

    expect(ids(plan)).toEqual(["gamma"]);
    expect(plan.searchFamily).toBeNull();
  });

  it("asks today's active version of a family, not the version her job record was placed at", () => {
    const plan = discoveryPlan(
      placed([], "unmapped"),
      [block("b1", ["alpha"], 2015, 2020)],
      registry(publication("alpha", 3)),
    );

    expect(plan.questionFloors).toEqual([{ familyId: "alpha", version: 3 }]);
  });

  it("returns no question floors and no search family for a visitor with no usable job records", () => {
    const empty = discoveryPlan(placed([], "unmapped"), [], registry(publication("alpha")));
    expect(empty).toEqual({ questionFloors: [], searchFamily: null });

    const unplaced = discoveryPlan(
      placed([], "unmapped"),
      [
        block("b1", [], 2015, 2020), // never labeled
        block("b2", ["alpha"], 2010, 2012, false), // education — never counts as work
      ],
      registry(publication("alpha")),
    );
    expect(unplaced).toEqual({ questionFloors: [], searchFamily: null });
  });

  it("still ranks a family whose only job has an unstated end, on the years it can prove", () => {
    const plan = discoveryPlan(
      placed([], "unmapped"),
      [
        block("b1", ["alpha"], 2015, "unknown"), // contributes 0 years, but she worked in it
        block("b2", ["beta"], 2020, 2021),
      ],
      registry(publication("alpha"), publication("beta")),
    );

    expect(ids(plan)).toEqual(["beta", "alpha"]);
  });
});
