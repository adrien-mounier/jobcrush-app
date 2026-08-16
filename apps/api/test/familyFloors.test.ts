import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  generateFamilyEvaluation,
  initialProductionFamilyFloors,
  productionDiscoveryFamily,
  ProductionFamilyFloorStore,
  TestFixtureFamilyFloorStore,
} from "../src/familyFloors.js";
import { buildServer } from "../src/server.js";
import { discoveryFamilyForSessionPlan } from "../src/legacyDiscovery.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = () =>
  JSON.parse(
    readFileSync(
      join(
        here,
        "..",
        "..",
        "..",
        "packages",
        "contracts",
        "fixtures",
        "family-floor-v1.test-fixture.json",
      ),
      "utf8",
    ),
  );

describe("test-fixture family floor store", () => {
  it("stores and retrieves one immutable family version", () => {
    const store = new TestFixtureFamilyFloorStore();
    const floor = store.add(fixture());

    expect(store.get(floor.familyId, floor.version)).toEqual(floor);
    expect(() => store.add(fixture())).toThrow(
      "family floor version already exists",
    );
  });

  it("protects stored contents from aliases returned by add and get", () => {
    const store = new TestFixtureFamilyFloorStore();
    const added = store.add(fixture());
    const stored = store.get(added.familyId, added.version);

    expect(() => {
      added.essentialItems[0]!.question.prompt = "Mutated through add";
    }).toThrow();
    expect(() => {
      stored!.essentialItems[0]!.question.prompt = "Mutated through get";
    }).toThrow();
    expect(store.get(added.familyId, added.version)?.essentialItems[0]?.question.prompt).toBe(
      "Which example scope applies?",
    );
  });

  it("rejects malformed floors at the store boundary", () => {
    const store = new TestFixtureFamilyFloorStore();
    const invalid = fixture();
    delete invalid.essentialItems[0].evidenceDestination;

    expect(() => store.add(invalid)).toThrow();
  });

  it("test examples cannot unlock the production discovery reward", () => {
    const store = new TestFixtureFamilyFloorStore();
    store.add(fixture());

    expect(store.canUnlockProductionDiscoveryReward()).toBe(false);
  });
});

const productionPublication = () =>
  JSON.parse(readFileSync(join(here, "..", "research", "it-project-delivery-v1.json"), "utf8"));

// #244: a re-publication must carry re-measured market words, so a v2 fixture bumps its dates.
const remeasure = (
  input: ReturnType<typeof productionPublication>,
  date: string,
  markets?: string[],
) => {
  for (const [code, entries] of Object.entries(input.marketSearchTitles)) {
    if (markets && !markets.includes(code)) continue;
    for (const entry of entries as Array<{ measuredOn: string }>) entry.measuredOn = date;
  }
};

describe("production family floor publication", () => {
  it("serves only the active production version at the HTTP seam", async () => {
    const { app } = buildServer({
      productionFamilyFloors: initialProductionFamilyFloors(),
    });
    const active = await app.inject({
      method: "GET",
      url: "/family-floors/it-project-delivery/active",
    });
    expect(active.statusCode).toBe(200);
    expect(active.json()).toMatchObject({
      familyId: "it-project-delivery",
      version: 1,
      source: "production_research",
      productionRewardEligible: true,
    });
    const unavailable = await app.inject({
      method: "GET",
      url: "/family-floors/not-published/active",
    });
    expect(unavailable.statusCode).toBe(404);
  });

  it("publishes reviewed evidence only after held-out gates pass", () => {
    const store = new ProductionFamilyFloorStore();
    const publication = store.publish(productionPublication());
    expect(store.active("it-project-delivery")).toEqual(publication);
  });

  it("adapts explicit question-floor references in order and de-duplicates shared items (#223)", () => {
    const base = productionPublication();
    const shared = { ...base.floor.essentialItems[0], id: "shared-item" };
    const alphaOnly = { ...base.floor.essentialItems[1], id: "alpha-only" };
    const betaOnly = { ...base.floor.essentialItems[2], id: "beta-only" };
    const publicationFor = (familyId: string, label: string, title: string, items: unknown[]) => {
      const publication = productionPublication();
      return {
        ...publication,
        floor: { ...publication.floor, familyId, label, essentialItems: items },
        marketSearchTitles: { HK: [{ title, adverts: 1, measuredOn: "2026-08-16" }] },
      };
    };
    const alpha = publicationFor("alpha", "Alpha", "alpha title", [shared, alphaOnly]);
    const beta = publicationFor("beta", "Beta", "beta title", [shared, betaOnly]);
    const catalog = {
      activePublications: () => [alpha, beta],
      get: (familyId: string) => ({ alpha, beta })[familyId as "alpha" | "beta"] ?? null,
    };

    const adapted = productionDiscoveryFamily(catalog, [
      { familyId: "beta", version: 1 },
      { familyId: "alpha", version: 1 },
    ]);

    expect(adapted).toMatchObject({ familyId: "beta", label: "Beta" });
    expect(adapted?.suggestions).toEqual(["beta title", "alpha title"]);
    expect(adapted?.items.map((item) => item.id)).toEqual(["shared-item", "beta-only", "alpha-only"]);
  });

  it("adapts the discovery plan's question floors instead of the first active publication (#223)", () => {
    const publicationFor = (familyId: string, label: string, title: string) => {
      const publication = productionPublication();
      return {
        ...publication,
        floor: { ...publication.floor, familyId, label },
        marketSearchTitles: { HK: [{ title, adverts: 1, measuredOn: "2026-08-16" }] },
      };
    };
    const alpha = publicationFor("alpha", "Alpha", "alpha title");
    const beta = publicationFor("beta", "Beta", "beta title");
    const catalog = {
      activePublications: () => [alpha, beta],
      get: (familyId: string) => ({ alpha, beta })[familyId as "alpha" | "beta"] ?? null,
    } as unknown as ProductionFamilyFloorStore;

    const adapted = discoveryFamilyForSessionPlan(
      {
        discovery: {
          questionFloors: [],
          searchFamily: null,
          coveredItemIds: [],
          checkpoint: null,
          fallback: { declined: false, family: null },
        },
      },
      {
        schemaVersion: "2",
        outcome: "confirmed",
        families: [{ familyId: "beta", version: 1 }],
        confidence: "certain",
      },
      [],
      catalog,
    );

    expect(adapted).toMatchObject({ familyId: "beta", label: "Beta" });
    expect(adapted?.suggestions).toEqual(["beta title"]);
  });

  it("counts employer diversity after trimming and case folding", () => {
    const store = new ProductionFamilyFloorStore();
    const duplicatedEmployer = productionPublication();
    duplicatedEmployer.postingEvidence.forEach(
      (item: { employer: string }, index: number) => {
        item.employer = index % 2 === 0 ? "Datadog" : " datadog ";
      },
    );

    expect(() => store.publish(duplicatedEmployer)).toThrow(
      "production family requires at least three employers",
    );
  });

  it.each([
    (input: ReturnType<typeof productionPublication>) => { input.postingEvidence[0].employer = "   "; },
    (input: ReturnType<typeof productionPublication>) => { input.postingEvidence[0].roleTitle = "   "; },
    (input: ReturnType<typeof productionPublication>) => { input.postingEvidence[0].location = "   "; },
    (input: ReturnType<typeof productionPublication>) => { input.postingEvidence[0].sourceUrl = "   "; },
    (input: ReturnType<typeof productionPublication>) => { input.postingEvidence[0].capturedAt = "   "; },
    (input: ReturnType<typeof productionPublication>) => {
      input.postingEvidence[0].normalizedRequirements[0] = "   ";
    },
  ])("rejects whitespace-only posting evidence strings", (makeInvalid) => {
    const input = productionPublication();
    makeInvalid(input);
    expect(() => new ProductionFamilyFloorStore().publish(input)).toThrow();
  });

  it.each(["provisional", "failed"])("keeps %s research unavailable", (publicationStatus) => {
    const store = new ProductionFamilyFloorStore();
    const input = productionPublication();
    input.publicationStatus = publicationStatus;
    expect(() => store.publish(input)).toThrow("only reviewed, validated publications can be activated");
    expect(store.active("it-project-delivery")).toBeNull();
  });

  it("rejects failed held-out evaluation and fixture promotion", () => {
    const store = new ProductionFamilyFloorStore();
    const failed = productionPublication();
    failed.evaluation.generated.cases.find(
      (item: { id: string }) => item.id === "heldout-data-scientist",
    ).observed = "confirmed";
    expect(() => store.publish(failed)).toThrow(
      "generated placement evaluation does not match pinned dataset",
    );
    expect(() => store.publish(fixture())).toThrow();
  });

  it("reproduces the checked-in generated evaluation from raw cases", () => {
    const publication = productionPublication();
    expect(generateFamilyEvaluation(publication.evaluation.rawCases)).toEqual(
      publication.evaluation.generated,
    );
  });

  it("rejects changed raw placement inputs that were not regenerated", () => {
    const changed = productionPublication();
    changed.evaluation.rawCases[0].evidence.familyNeighborSupport[0] = 0.1;
    expect(() => new ProductionFamilyFloorStore().publish(changed)).toThrow(
      "generated placement evaluation does not match pinned dataset",
    );
  });

  it("rejects duplicate evaluation case IDs before metrics are calculated", () => {
    const duplicated = productionPublication();
    duplicated.evaluation.rawCases[1].id = duplicated.evaluation.rawCases[0].id;

    expect(() => new ProductionFamilyFloorStore().publish(duplicated)).toThrow(
      "evaluation case ids must be unique",
    );
  });

  it("rejects evaluation cases without reproducible placement evidence", () => {
    const store = new ProductionFamilyFloorStore();
    const ungrounded = productionPublication();
    delete ungrounded.evaluation.rawCases[0].evidence;

    expect(() => store.publish(ungrounded)).toThrow();
  });

  it("requires held-out comparable, ambiguous, and near-OOD evaluation groups", () => {
    const store = new ProductionFamilyFloorStore();
    const missingAmbiguous = productionPublication();
    missingAmbiguous.evaluation.rawCases = missingAmbiguous.evaluation.rawCases.filter(
      (item: { id: string }) => item.id !== "heldout-product-manager"
        && item.id !== "heldout-engineering-manager",
    );
    missingAmbiguous.evaluation.generated = generateFamilyEvaluation(
      missingAmbiguous.evaluation.rawCases,
    );

    expect(() => store.publish(missingAmbiguous)).toThrow(
      "held-out evaluation must record comparable, ambiguous, and near-OOD outcomes",
    );
  });

  it("keeps consumed versions immutable and activates changes as a new version", () => {
    const store = new ProductionFamilyFloorStore();
    const first = store.publish(productionPublication());
    expect(() => store.publish(productionPublication())).toThrow("family floor version already exists");
    const next = productionPublication();
    next.floor.version = 2;
    next.floor.essentialItems[0].question.prompt = "Have you owned end-to-end delivery?";
    remeasure(next, "2026-08-16");
    store.publish(next);
    expect(first.floor.version).toBe(1);
    expect(first.floor.essentialItems[0].question.prompt).not.toBe(next.floor.essentialItems[0].question.prompt);
    expect(store.active("it-project-delivery")?.floor.version).toBe(2);
  });

  it("never activates a version older than the current publication", () => {
    const store = new ProductionFamilyFloorStore();
    const versionTwo = productionPublication();
    versionTwo.floor.version = 2;
    store.publish(versionTwo);

    expect(() => store.publish(productionPublication())).toThrow(
      "family floor version must increase monotonically",
    );
    expect(store.active("it-project-delivery")?.floor.version).toBe(2);
  });
});

describe("market search vocabulary (#242)", () => {
  it("a published family carries the job titles each served market uses", () => {
    const publication = initialProductionFamilyFloors().active("it-project-delivery")!;
    expect(Object.keys(publication.marketSearchTitles).sort()).toEqual(["AU", "HK", "SG", "VN"]);
    expect(publication.marketSearchTitles.HK.map((item) => item.title)).toContain("project manager");
  });

  it("refuses publication for a served market with no search words", () => {
    const input = productionPublication();
    delete input.marketSearchTitles.HK;
    expect(() => new ProductionFamilyFloorStore().publish(input)).toThrow(
      "family cannot be published for served markets with no search words: HK",
    );
  });

  it("refuses an empty title list for a market", () => {
    const emptied = productionPublication();
    emptied.marketSearchTitles.VN = [];
    expect(() => new ProductionFamilyFloorStore().publish(emptied)).toThrow(/at least 1/);
  });

  it("refuses a title measured to catch no adverts", () => {
    const unmeasured = productionPublication();
    unmeasured.marketSearchTitles.HK = [
      { title: "delivery lead", adverts: 0, measuredOn: "2026-08-14" },
    ];
    expect(() => new ProductionFamilyFloorStore().publish(unmeasured)).toThrow(/greater than 0/);
  });

  it("re-runs the market-words gate on every re-publication", () => {
    const store = new ProductionFamilyFloorStore();
    store.publish(productionPublication());
    const gapped = productionPublication();
    gapped.floor.version = 2;
    delete gapped.marketSearchTitles.VN;
    expect(() => store.publish(gapped)).toThrow(
      "family cannot be published for served markets with no search words: VN",
    );
    const complete = productionPublication();
    complete.floor.version = 2;
    remeasure(complete, "2026-08-16");
    store.publish(complete);
    expect(store.active("it-project-delivery")?.floor.version).toBe(2);
  });

  it("refuses a re-publication whose market words were not re-measured (#244)", () => {
    const store = new ProductionFamilyFloorStore();
    store.publish(productionPublication());
    const copied = productionPublication();
    copied.floor.version = 2;
    expect(() => store.publish(copied)).toThrow(
      /family market words were not re-measured since the previous publication: HK, SG, VN, AU$/,
    );
    expect(store.active("it-project-delivery")?.floor.version).toBe(1);
  });

  it("refuses a re-publication naming only the markets whose words were copied (#244)", () => {
    const store = new ProductionFamilyFloorStore();
    store.publish(productionPublication());
    const partial = productionPublication();
    partial.floor.version = 2;
    remeasure(partial, "2026-08-16", ["HK", "SG", "VN"]);
    expect(() => store.publish(partial)).toThrow(
      /family market words were not re-measured since the previous publication: AU$/,
    );
  });

  it("anchors freshness on the previous ACTIVE version, never the first (#244)", () => {
    const store = new ProductionFamilyFloorStore();
    store.publish(productionPublication());
    const second = productionPublication();
    second.floor.version = 2;
    remeasure(second, "2026-08-16");
    store.publish(second);
    const between = productionPublication();
    between.floor.version = 3;
    remeasure(between, "2026-08-15"); // newer than v1's dates, older than active v2's
    expect(() => store.publish(between)).toThrow(
      /family market words were not re-measured since the previous publication: HK, SG, VN, AU$/,
    );
  });

  it("publishes a re-publication whose every served market was re-measured (#244)", () => {
    const store = new ProductionFamilyFloorStore();
    store.publish(productionPublication());
    const fresh = productionPublication();
    fresh.floor.version = 2;
    remeasure(fresh, "2026-08-16");
    store.publish(fresh);
    expect(store.active("it-project-delivery")?.floor.version).toBe(2);
  });
});
