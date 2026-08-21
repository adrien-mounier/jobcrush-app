import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { FamilyFloorV1, type FamilyFloorV1 as FamilyFloorV1Value, type FloorItem } from "@jobcrush/contracts";
import { z } from "zod";
import type { DiscoveryFamily } from "./discovery.js";
// Safe direction: postingRetrieval's own import of this module is type-only (erased at compile),
// so this runtime edge creates no cycle — keep it that way if that import ever changes.
import { coveredRegionCodes } from "./postingRetrieval.js";

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
  // #220: the family's visitor-facing name. Published data, not derived from the id and never
  // model-authored — a clarification choice ("which kind of work is this?") is display copy a person
  // reads and picks from, so it belongs to the publication the same way its floor items do.
  label: z.string().trim().min(1),
  // #220: what this family covers, and where its edge is. Also published data, and load-bearing:
  // measured on the grid, a family described only by its evidence questions has no findable
  // boundary — the labeler swung from taking in event managers to turning away cloud migration
  // managers on the same evidence. A closed vocabulary has to say what its words mean.
  scope: z.string().trim().min(1),
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

// Historical calibration bucket only. This is not the public FamilyPlacement outcome; ADR-0014
// amendment #231 deleted `needs_clarification` from that contract.
const PlacementOutcome = z.enum(["confirmed", "needs_clarification", "unmapped"]);

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
  // #242: search area → the job titles that market actually uses for this family's work. Keys are
  // the registry's region codes (the same vocabulary regionsServed and the provider fetch use).
  // Each title carries the probe measurement that put it on the list — quoted title, one market,
  // advert count — so a word the market does not use ("delivery lead" in Hong Kong: 0 adverts)
  // cannot be published as a search word. `measuredOn` is the advert day the probe sampled, not
  // the day it ran. The field holds the truth about the market; what a search SENDS is #240's
  // rule, kept deliberately out of this field.
  marketSearchTitles: z.record(
    z.string().regex(/^[A-Z]{2}$/),
    z.array(z.object({
      title: z.string().trim().min(1),
      adverts: z.number().int().positive(),
      measuredOn: z.string().trim().date(),
    })).min(1),
  ),
  // #258: the job titles this family's SCOPE names as inside it (scrum master, agile coach) but
  // which are not market search words. Hint-only, in the strongest sense: matched by question 1's
  // type-ahead so a visitor typing one is offered this family's market titles, and nothing else —
  // never sent to a provider (postingRetrieval reads marketSearchTitles), never shown to the
  // labeler (familyLabeler builds its description from label/scope/evidence/floor), never gated on
  // advert counts. Optional: a family without the field behaves exactly as it did before #258.
  aliases: z.array(z.string().trim().min(1)).default([]),
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
          ? "needs_clarification"
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
    // #242 decision 5: a served market with no search words would surface as a quietly empty deck,
    // never an error — so the gap refuses the publication instead. Served is the registry retrieval
    // already trusts, and the check runs on every (re-)publication: that re-check at the gate is
    // what keeps a family's market words from going stale silently (decision 4). Consequence, by
    // design: adding a region to the provider registry refuses boot until every published family
    // names that market's words — loud, never a quietly empty market.
    const missingMarkets = coveredRegionCodes().filter(
      (code) => !publication.marketSearchTitles[code]?.length,
    );
    if (missingMarkets.length > 0) {
      throw new Error(
        `family cannot be published for served markets with no search words: ${missingMarkets.join(", ")}`,
      );
    }
    // #258 decision 6: an alias is a way of FINDING a family by typing, so two families claiming
    // the same one means one silently steals the other's hint — #255's defect returning through a
    // different door. An alias colliding with another family's label or market title is refused for
    // the same reason. Trim + case-fold, the normalisation the type-ahead lookup uses, and WHOLE
    // words: the lookup then matches on substring overlap, so this gate catches an alias that is
    // another family's word, not one that merely contains it ("delivery" would still shadow
    // "delivery manager"). Deliberate — the owner specced the comparison (#258 decision 6).
    const fold = (value: string) => value.trim().toLocaleLowerCase("en-US");
    const findableTitles = (item: ProductionFamilyPublicationValue) => [
      item.floor.label,
      ...Object.values(item.marketSearchTitles).flat().map((entry) => entry.title),
    ].map(fold);
    const myAliases = publication.aliases.map(fold);
    const myTitles = findableTitles(publication);
    for (const other of this.activePublications()) {
      if (other.floor.familyId === publication.floor.familyId) continue;
      const otherAliases = other.aliases.map(fold);
      const otherTitles = findableTitles(other);
      const clashes = new Set([
        ...myAliases.filter((alias) => otherAliases.includes(alias) || otherTitles.includes(alias)),
        ...otherAliases.filter((alias) => myTitles.includes(alias)),
      ]);
      if (clashes.size > 0) {
        throw new Error(
          `alias is already findable in ${other.floor.familyId}: ${[...clashes].sort().join(", ")}`,
        );
      }
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
      || !heldOutExpectations.has("needs_clarification")
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
    // #244: a re-publication must carry re-measured market words — copied rows keep their dates
    // and are refused, so a publisher (a person today, #218's machinery tomorrow) that skipped the
    // provider re-run CANNOT publish. Per served market the previous version also carries: the new
    // version's newest measuredOn must be strictly newer than the old one's. ISO dates compare
    // lexicographically. A first publication, or a newly served market, has nothing to compare.
    const previous = this.active(publication.floor.familyId);
    if (previous) {
      const newestMeasuredOn = (entries: ReadonlyArray<{ measuredOn: string }>) =>
        entries.reduce((max, entry) => (entry.measuredOn > max ? entry.measuredOn : max), "");
      const staleMarkets = coveredRegionCodes().filter((code) => {
        const prior = previous.marketSearchTitles[code];
        return prior !== undefined && prior.length > 0 &&
          newestMeasuredOn(publication.marketSearchTitles[code] ?? []) <= newestMeasuredOn(prior);
      });
      if (staleMarkets.length > 0) {
        throw new Error(
          `family market words were not re-measured since the previous publication: ${staleMarkets.join(", ")}`,
        );
      }
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

  get(familyId: string, version: number): ProductionFamilyPublicationValue | null {
    return this.publications.get(keyOf(familyId, version)) ?? null;
  }

  /** Every family at its ACTIVE version — the closed vocabulary #220's labeler places roles into.
   *  Superseded versions are deliberately excluded: a stored placement keeps the version it was made
   *  with (ADR-0014 decision 7), but a NEW placement is only ever made against what is current. */
  activePublications(): ProductionFamilyPublicationValue[] {
    return Array.from(this.activeVersions, ([familyId, version]) => this.get(familyId, version))
      .filter((publication): publication is ProductionFamilyPublicationValue => publication !== null);
  }
}

/** #234 — the one "may this family be used?" test, shared by the discovery route (which looks a
 *  stored version up by number) and the discovery plan (which looks today's active version up by
 *  family). `publish` already enforces all three, but a catalog adapter injected in a test — or a
 *  future non-publishing source — does not, so the check stays at the point of use. */
export function eligiblePublication(
  publication: ProductionFamilyPublicationValue | null | undefined,
): ProductionFamilyPublicationValue | null {
  return publication?.publicationStatus === "published" &&
    publication.floor.source === "production_research" &&
    publication.floor.productionRewardEligible
    ? publication
    : null;
}

export function initialProductionFamilyFloors(): ProductionFamilyFloorStore {
  const store = new ProductionFamilyFloorStore();
  // #262 rename (out of #260), owner-approved: a family is named for the ROLE a person holds, not
  // for the activity ("Business Analyst", not "Business analysis" — the same reason we say Product
  // Owner, not Product Ownership). The label reaches the LABELER'S OWN PROMPT (familyLabeler.ts's
  // describeFamilies) and the question-1 type-ahead, so it is data that can move a placement — a
  // version, not an in-place amendment (#258 decision 3 draws exactly that line). Both v2s carry
  // freshly measured market words (2026-08-21) so #244's gate below is satisfied honestly. Floor
  // items, aliases, posting evidence and the evaluation are byte-identical to v1. ONE scope edit was
  // needed and is deliberate: business-analysis's scope drew its edge by naming the sibling family
  // ("owning the delivery schedule (IT project delivery)"), so leaving it byte-identical would have
  // shipped a half-renamed labeler prompt — the heading saying IT Project Manager and the sentence
  // the prompt calls decisive still saying the old name, twenty lines apart. Caught by /qa-gate.
  //
  // EVERY version is loaded, oldest first, not just the active one. A stored family placement keeps
  // the version it was made under (ADR-0014 decision 7) and is later read back by
  // `floors.get(familyId, version)` — so dropping v1 here would strand every placement already made
  // against it (`family_not_published`). `publish()` refuses a version that does not increase, so
  // the order below is load-bearing: v1, then v2, which leaves v2 active and v1 retrievable.
  for (const file of [
    "../research/it-project-delivery-v1.json",
    "../research/it-project-delivery-v2.json",
    // #255 pilot run, owner-approved 2026-08-20: the second family, harvested from the real
    // unmapped-label feed and published through the same gates. Renamed at v2.
    "../research/business-analysis-v1.json",
    "../research/business-analysis-v2.json",
  ]) {
    store.publish(JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8")));
  }
  return store;
}

function productionFloorItem(item: FamilyFloorV1Value["essentialItems"][number]): FloorItem {
  return {
    id: item.id,
    rankBand: "essential",
    question: item.question.prompt,
    options: item.question.options.map((option) => option.label),
    cvSection: item.evidenceDestination.section,
    noIsFatal: true,
  };
}

/** #223 — the legacy discovery surface now gets its single-family data from the production
 *  registry. The production floor contract only carries essential items, so no hand-authored
 *  standard/triggered list is merged back in here; additional families still contribute only their
 *  essential items through discoveryPlan(). */
type DiscoveryFamilyReference = { familyId: string; version: number };

export function productionDiscoveryFamily(
  floors: Pick<ProductionFamilyFloorStore, "activePublications" | "get">,
  references?: readonly DiscoveryFamilyReference[],
): DiscoveryFamily | null {
  const referenced = references?.map((reference) =>
    eligiblePublication(floors.get(reference.familyId, reference.version))
  );
  if (referenced?.some((publication) => !publication)) return null;
  const publications = referenced
    ? (referenced as ProductionFamilyPublicationValue[])
    : floors.activePublications()
      .sort((a, b) => a.floor.familyId.localeCompare(b.floor.familyId, "en-US"))
      .slice(0, 1);
  if (publications.length === 0) return null;
  const suggestions: string[] = [];
  const seenSuggestions = new Set<string>();
  for (const publication of publications) {
    for (const entries of Object.values(publication.marketSearchTitles)) {
      for (const entry of entries) {
        const key = entry.title.trim().toLocaleLowerCase("en-US");
        if (!key || seenSuggestions.has(key)) continue;
        seenSuggestions.add(key);
        suggestions.push(entry.title);
      }
    }
  }
  const items: FloorItem[] = [];
  const seenItems = new Set<string>();
  for (const publication of publications) {
    for (const item of publication.floor.essentialItems) {
      if (seenItems.has(item.id)) continue;
      seenItems.add(item.id);
      items.push(productionFloorItem(item));
    }
  }
  const primary = publications[0]!;
  return {
    label: primary.floor.label,
    familyId: primary.floor.familyId,
    items,
    suggestions,
  };
}
