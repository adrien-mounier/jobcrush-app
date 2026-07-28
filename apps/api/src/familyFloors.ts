import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { FamilyFloorV1, type FamilyFloorV1 as FamilyFloorV1Value } from "@jobcrush/contracts";
import { z } from "zod";

const keyOf = (familyId: string, version: number) => `${familyId}@${version}`;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

/**
 * Isolated catalog for deterministic contract/integration fixtures.
 * It deliberately has no production publication path and cannot authorize a reward.
 */
export class TestFixtureFamilyFloorStore {
  private readonly floors = new Map<string, FamilyFloorV1Value>();

  add(input: unknown): FamilyFloorV1Value {
    const floor = deepFreeze(structuredClone(FamilyFloorV1.parse(input)));
    const key = keyOf(floor.familyId, floor.version);
    if (this.floors.has(key)) {
      throw new Error(`family floor version already exists: ${key}`);
    }
    this.floors.set(key, floor);
    return floor;
  }

  get(familyId: string, version: number): FamilyFloorV1Value | null {
    return this.floors.get(keyOf(familyId, version)) ?? null;
  }

  canUnlockProductionDiscoveryReward(): false {
    return false;
  }
}

const ProductionFloor = z.object({
  schemaVersion: z.literal("1"),
  familyId: z.string().min(1),
  version: z.number().int().positive(),
  source: z.literal("production_research"),
  productionRewardEligible: z.literal(true),
  essentialItems: z.custom<FamilyFloorV1Value["essentialItems"]>(
    (value) =>
      FamilyFloorV1.safeParse({
        schemaVersion: "1",
        familyId: "validation-placeholder",
        version: 1,
        source: "test_fixture",
        productionRewardEligible: false,
        essentialItems: value,
      }).success,
    "invalid production family floor items",
  ),
});

const PlacementOutcome = z.enum(["confirmed", "clarification", "unmapped"]);

const RawEvaluationCase = z.object({
  id: z.string().min(1),
  split: z.enum(["grouped_train", "held_out"]),
  targetRole: z.string().trim().min(2),
  evidence: z.object({
    signals: z.array(z.string().trim().min(1)).min(1),
    familyNeighborSupport: z.array(z.number().min(0).max(1)).min(3),
    competingFamilySupport: z.array(z.number().min(0).max(1)).min(1),
  }),
  expected: PlacementOutcome,
});

const GeneratedEvaluationCase = z.object({
  id: z.string().min(1),
  supportScore: z.number().min(0).max(1),
  runnerUpSupportScore: z.number().min(0).max(1),
  neighborhoodDensity: z.number().min(0).max(1),
  observed: PlacementOutcome,
});

const uniqueCaseIds = <T extends { id: string }>(cases: T[]) =>
  new Set(cases.map((item) => item.id)).size === cases.length;

export const ProductionFamilyPublication = z.object({
  publicationStatus: z.enum(["provisional", "failed", "published"]),
  reviewedBy: z.string().min(1),
  reviewedAt: z.string().datetime(),
  floor: ProductionFloor,
    postingEvidence: z.array(z.object({
      employer: z.string().trim().min(1),
      roleTitle: z.string().trim().min(1),
      location: z.string().trim().min(1),
      sourceUrl: z.string().trim().url(),
      capturedAt: z.string().trim().date(),
      normalizedRequirements: z.array(z.string().trim().min(1)).min(1),
  })).min(3),
  evaluation: z.object({
    evaluator: z.object({
      engine: z.literal("calibrated-family-placement"),
      version: z.literal("1"),
    }),
    thresholds: z.object({
      comparableAccuracy: z.number().min(0.95).max(1),
      unfamiliarRecall: z.number().min(0.9).max(1),
      familiarFalseUnknownRate: z.number().min(0).max(0.05),
    }),
    rawCases: z.array(RawEvaluationCase).min(6).refine(
      uniqueCaseIds,
      "evaluation case ids must be unique",
    ),
    generated: z.object({
      datasetHash: z.string().regex(/^[a-f0-9]{64}$/),
      cases: z.array(GeneratedEvaluationCase).min(6).refine(
        uniqueCaseIds,
        "evaluation case ids must be unique",
      ),
    }),
  }),
});

export type ProductionFamilyPublicationValue = z.infer<typeof ProductionFamilyPublication>;

export function generateFamilyEvaluation(
  input: unknown,
): ProductionFamilyPublicationValue["evaluation"]["generated"] {
  const rawCases = z.array(RawEvaluationCase).min(6).refine(
    uniqueCaseIds,
    "evaluation case ids must be unique",
  ).parse(structuredClone(input));
  return {
    datasetHash: createHash("sha256").update(JSON.stringify(rawCases)).digest("hex"),
    cases: rawCases.map((item) => {
      const supportScore = Math.max(...item.evidence.familyNeighborSupport);
      const runnerUpSupportScore = Math.max(...item.evidence.competingFamilySupport);
      const neighborhoodDensity = item.evidence.familyNeighborSupport.filter(
        (score) => score >= 0.6,
      ).length / item.evidence.familyNeighborSupport.length;
      const observed = supportScore < 0.6 || neighborhoodDensity < 0.35
        ? "unmapped"
        : supportScore - runnerUpSupportScore < 0.15
          ? "clarification"
          : "confirmed";
      return { id: item.id, supportScore, runnerUpSupportScore, neighborhoodDensity, observed };
    }),
  };
}

function evaluationRates(
  rawCases: z.infer<typeof RawEvaluationCase>[],
  generatedCases: z.infer<typeof GeneratedEvaluationCase>[],
) {
  const observedById = new Map(generatedCases.map((item) => [item.id, item.observed]));
  const heldOut = rawCases
    .filter((item) => item.split === "held_out")
    .map((item) => ({ ...item, observed: observedById.get(item.id) }));
  const comparable = heldOut.filter((item) => item.expected !== "unmapped");
  const unfamiliar = heldOut.filter((item) => item.expected === "unmapped");
  return {
    comparableAccuracy: comparable.filter((item) => item.observed === item.expected).length / comparable.length,
    unfamiliarRecall: unfamiliar.filter((item) => item.observed === "unmapped").length / unfamiliar.length,
    familiarFalseUnknownRate: comparable.filter((item) => item.observed === "unmapped").length / comparable.length,
  };
}

/** Production-only catalog. Publication is explicit; test fixtures cannot enter it. */
export class ProductionFamilyFloorStore {
  private readonly publications = new Map<string, ProductionFamilyPublicationValue>();
  private readonly activeVersions = new Map<string, number>();

  publish(input: unknown): ProductionFamilyPublicationValue {
    const publication = ProductionFamilyPublication.parse(structuredClone(input));
    if (publication.publicationStatus !== "published") {
      throw new Error("only reviewed, validated publications can be activated");
    }
    if (new Set(
      publication.postingEvidence.map((item) => item.employer.trim().toLocaleLowerCase("en-US")),
    ).size < 3) {
      throw new Error("production family requires at least three employers");
    }
    const regenerated = generateFamilyEvaluation(publication.evaluation.rawCases);
    if (JSON.stringify(publication.evaluation.generated) !== JSON.stringify(regenerated)) {
      throw new Error("generated placement evaluation does not match pinned dataset");
    }
    const heldOutExpectations = new Set(
      publication.evaluation.rawCases
        .filter((item) => item.split === "held_out")
        .map((item) => item.expected),
    );
    if (!heldOutExpectations.has("confirmed")
      || !heldOutExpectations.has("clarification")
      || !heldOutExpectations.has("unmapped")) {
      throw new Error(
        "held-out evaluation must record comparable, ambiguous, and near-OOD outcomes",
      );
    }
    const rates = evaluationRates(
      publication.evaluation.rawCases,
      publication.evaluation.generated.cases,
    );
    const thresholds = publication.evaluation.thresholds;
    if (rates.comparableAccuracy < thresholds.comparableAccuracy ||
        rates.unfamiliarRecall < thresholds.unfamiliarRecall ||
        rates.familiarFalseUnknownRate > thresholds.familiarFalseUnknownRate) {
      throw new Error("production family evaluation thresholds not met");
    }
    const key = keyOf(publication.floor.familyId, publication.floor.version);
    if (this.publications.has(key)) {
      throw new Error(`family floor version already exists: ${key}`);
    }
    const activeVersion = this.activeVersions.get(publication.floor.familyId);
    if (activeVersion !== undefined && publication.floor.version <= activeVersion) {
      throw new Error("family floor version must increase monotonically");
    }
    const frozen = deepFreeze(publication);
    this.publications.set(key, frozen);
    this.activeVersions.set(publication.floor.familyId, publication.floor.version);
    return frozen;
  }

  active(familyId: string): ProductionFamilyPublicationValue | null {
    const version = this.activeVersions.get(familyId);
    return version === undefined ? null : this.publications.get(keyOf(familyId, version)) ?? null;
  }
}

export function initialProductionFamilyFloors(): ProductionFamilyFloorStore {
  const store = new ProductionFamilyFloorStore();
  store.publish(
    JSON.parse(
      readFileSync(
        new URL("../research/it-project-delivery-v1.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  return store;
}
