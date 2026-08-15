import type { FamilyFloorV1, FamilyPlacement, JobBlockView } from "@jobcrush/contracts";
import type { ClaimRecord } from "./claims.js";
import { eligiblePublication, type ProductionFamilyFloorStore } from "./familyFloors.js";
import type { DiscoveryPlan } from "./sessions.js";
import { computeFamilyRecency, computeFamilyYears } from "./yearsWorked.js";

type AdaptiveDiscoveryFloor = Pick<
  FamilyFloorV1,
  "familyId" | "version" | "essentialItems"
>;

export const fixtureDiscoveryClaimId = (familyId: string, version: number, itemId: string) =>
  `fixture-discovery-${familyId}-${version}-${itemId}`;

export interface AdaptiveDiscoveryState {
  rewardEligible: false;
  floor: { familyId: string; version: number };
  progress: { complete: number; remaining: number };
  positiveEvidence: Array<{ itemId: string; claimId: string }>;
  rootCvLines: Array<{ itemId: string; section: string; text: string }>;
  nextQuestion: {
    itemId: string;
    prompt: string;
    form: "single_select" | "multi_select" | "free_text";
    options: Array<{ value: string; label: string }>;
  } | null;
}

const supports = (
  claim: ClaimRecord,
  floor: AdaptiveDiscoveryFloor,
  itemId: string,
): boolean =>
  claim.semantic_key === itemId ||
  claim.id === fixtureDiscoveryClaimId(floor.familyId, floor.version, itemId);

export function adaptiveDiscoveryState(
  floor: AdaptiveDiscoveryFloor,
  claims: ClaimRecord[],
  negatives: ClaimRecord[],
): AdaptiveDiscoveryState {
  const sourceSupported = claims.filter(
    (claim) =>
      (claim.decision === "pending" || claim.decision === "confirmed") &&
      claim.machine_touch !== "inferred",
  );
  const positiveEvidence = floor.essentialItems.flatMap((item) => {
    const correctionId = fixtureDiscoveryClaimId(floor.familyId, floor.version, item.id);
    if (negatives.some((claim) => claim.id === correctionId)) return [];
    const claim =
      sourceSupported.find((candidate) => candidate.id === correctionId) ??
      sourceSupported.find((candidate) => supports(candidate, floor, item.id));
    return claim ? [{ itemId: item.id, claimId: claim.id }] : [];
  });
  const negativeIds = new Set(
    floor.essentialItems
      .filter((item) => negatives.some((claim) => supports(claim, floor, item.id)))
      .map((item) => item.id),
  );
  const positiveByItem = new Map(positiveEvidence.map((evidence) => [evidence.itemId, evidence]));
  const completeIds = new Set([...positiveByItem.keys(), ...negativeIds]);
  const next = floor.essentialItems.find((item) => !completeIds.has(item.id)) ?? null;
  const rootCvLines = floor.essentialItems.flatMap((item) => {
    const evidence = positiveByItem.get(item.id);
    if (!evidence) return [];
    const claim = sourceSupported.find((candidate) => candidate.id === evidence.claimId)!;
    return [{
      itemId: item.id,
      section: item.evidenceDestination.section,
      text: claim.text,
    }];
  });

  return {
    rewardEligible: false,
    floor: { familyId: floor.familyId, version: floor.version },
    progress: {
      complete: completeIds.size,
      remaining: floor.essentialItems.length - completeIds.size,
    },
    positiveEvidence,
    rootCvLines,
    nextQuestion: next
      ? {
          itemId: next.id,
          prompt: next.question.prompt,
          form: next.question.form,
          options: next.question.options,
        }
      : null,
  };
}

/** The one family a floor can be selected for, or null.
 *
 *  #231 — a placement now carries one OR MORE families, but floor selection takes exactly one
 *  (`loadFamilyFloor(...)`, and a floor's essential items are what discovery asks). So a plural
 *  placement is refused here rather than silently reduced to its first entry: quietly picking one
 *  would pin a visitor's whole interview to a family nothing chose. This is the mechanical half of
 *  #231's scope boundary — every floor-selection path in the app goes through this function, so
 *  none of them can receive a plural placement. #232 merges the floors of several families and is
 *  where this stops being a constraint. */
export function soleConfirmedFamily(
  placement: FamilyPlacement,
): { familyId: string; version: number } | null {
  return placement.outcome === "confirmed" && placement.families.length === 1
    ? placement.families[0]!
    : null;
}

/** #230 decision 2 / spec #233 decision 3: at most two floors. A third buys little evidence and
 *  delays the deck; floor answers are true for ever, so the two she does answer are never wasted. */
export const MAX_QUESTION_FLOORS = 2;

const byDescending = (a: number, b: number) => (a === b ? 0 : a > b ? -1 : 1);

/** #234 — the ONE function that decides which floors the interview asks and which family retrieval
 *  searches with (spec #233 decision 2). It takes the target role's family placement, the visitor's
 *  dated job records with their own placements, and the published floor registry, and lives here
 *  beside floor selection rather than in a route.
 *
 *  A mapped target role returns that family as both, which is every visitor today — this ticket
 *  changes nobody's behaviour. Deliberately NOT checked here: whether that family is published and
 *  reward-eligible. The discovery route already tests that itself and answers with the accurate
 *  `production_floor_unavailable`; folding it in would turn that into "we cannot place you", which
 *  is a different and wrong thing to say. #235 is where an unpublished named family reaches the
 *  word search instead.
 *
 *  Anything else — unmapped, or a placement naming several families (until #232) — is interviewed
 *  on the families her own dated job records prove, at today's ACTIVE published version of each,
 *  and searched on her typed words (`searchFamily: null`, which #235 acts on). Zero candidates is a
 *  legitimate outcome, not a failure. */
export function discoveryPlan(
  placement: FamilyPlacement,
  blocks: readonly JobBlockView[],
  published: Pick<ProductionFamilyFloorStore, "active">,
): DiscoveryPlan {
  const target = soleConfirmedFamily(placement);
  if (target) return { questionFloors: [target], searchFamily: target };

  // Both maps are keyed by the families her COUNTING job records are confirmed into — a job
  // carrying two families counts fully toward each (ADR-0014 amendment 1 decision 4), so the years
  // read here are the same per-family numbers every other surface reads.
  const years = computeFamilyYears(blocks);
  const recency = computeFamilyRecency(blocks);
  const questionFloors = [...years.keys()]
    .flatMap((familyId) => {
      const publication = eligiblePublication(published.active(familyId));
      return publication ? [{ familyId, version: publication.floor.version }] : [];
    })
    .sort(
      (a, b) =>
        byDescending(years.get(a.familyId)!, years.get(b.familyId)!) ||
        byDescending(recency.get(a.familyId) ?? -Infinity, recency.get(b.familyId) ?? -Infinity) ||
        a.familyId.localeCompare(b.familyId, "en-US"),
    )
    .slice(0, MAX_QUESTION_FLOORS);
  return { questionFloors, searchFamily: null };
}
