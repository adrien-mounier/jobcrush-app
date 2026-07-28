import type { FamilyFloorV1, FamilyPlacement } from "@jobcrush/contracts";
import type { ClaimRecord } from "./claims.js";

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
  floor: FamilyFloorV1,
  itemId: string,
): boolean =>
  claim.semantic_key === itemId ||
  claim.id === fixtureDiscoveryClaimId(floor.familyId, floor.version, itemId);

export function adaptiveDiscoveryState(
  floor: FamilyFloorV1,
  claims: ClaimRecord[],
  negatives: ClaimRecord[],
): AdaptiveDiscoveryState {
  const sourceSupported = claims.filter(
    (claim) => claim.decision === "pending" || claim.decision === "confirmed",
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

export function confirmedFixtureFloorReference(
  placement: FamilyPlacement,
): { familyId: string; version: number } | null {
  return placement.outcome === "confirmed" ? placement.family : null;
}
