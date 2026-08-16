import type { FamilyPlacement, JobBlockView } from "@jobcrush/contracts";
import { discoveryPlan } from "./adaptiveDiscovery.js";
import type { ClaimRecord } from "./claims.js";
import {
  discoveryClaimId,
  discoveryState,
  factCount,
  readerQuestion,
  READER_ROLE_ITEM_ID,
  type DiscoveryFamily,
  type DiscoveryState,
} from "./discovery.js";
import { applyEligibilityQuestions, excludingEligibility } from "./eligibilityDiscovery.js";
import type { EligibilityFact } from "./eligibility.js";
import { productionDiscoveryFamily, type ProductionFamilyFloorStore } from "./familyFloors.js";
import { minedRoles, type JobStore } from "./jobs.js";
import { resolvedMarketsFor } from "./postingRetrieval.js";
import { pinnedOrDerived } from "./sessions.js";
import type { SessionRecord } from "./sessions.js";

export function requireProductionDiscoveryFamily(
  floors: Pick<ProductionFamilyFloorStore, "activePublications" | "get">,
): DiscoveryFamily {
  const family = productionDiscoveryFamily(floors);
  if (!family) throw new Error("no active production family available for discovery");
  return family;
}

export function productionDiscoveryFamilyLookup(
  floors: Pick<ProductionFamilyFloorStore, "activePublications" | "get">,
  query: string,
): { family: string; suggestions: readonly string[] } {
  const family = requireProductionDiscoveryFamily(floors);
  return { family: family.label, suggestions: query.trim() ? family.suggestions : [] };
}

export async function currentDiscoveryFamily(
  session: SessionRecord,
  placeFamily: (session: Readonly<SessionRecord>) => Promise<FamilyPlacement>,
  blocksForSession: (sessionId: string) => Promise<readonly JobBlockView[]>,
  floors: ProductionFamilyFloorStore,
): Promise<DiscoveryFamily | null> {
  const placementSession = session.intent.targetRole
    ? session
    : { ...session, intent: { ...session.intent, targetRole: session.targetTitles[0] ?? null } };
  return discoveryFamilyForSessionPlan(
    placementSession,
    await placeFamily(placementSession),
    await blocksForSession(session.id),
    floors,
  );
}

export function discoveryFamilyForSessionPlan(
  session: Pick<SessionRecord, "discovery">,
  placement: FamilyPlacement,
  blocks: readonly JobBlockView[],
  floors: ProductionFamilyFloorStore,
): DiscoveryFamily | null {
  const plan = pinnedOrDerived(session.discovery, discoveryPlan(placement, blocks, floors));
  return productionDiscoveryFamily(floors, plan.questionFloors);
}

export function buildDiscoveryRouteState(
  role: string | null,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  rejected: ClaimRecord[],
  facts: readonly EligibilityFact[],
  session: Pick<SessionRecord, "intent">,
  family: DiscoveryFamily | null,
  blocks: readonly JobBlockView[],
): DiscoveryState {
  const state = discoveryState(role, confirmed, negatives, rejected, null, family);
  if (role) applyDiscoveryEligibility(state, session, confirmed, negatives, rejected, facts, family, blocks);
  state.factCount = factCount(excludingEligibility(confirmed), excludingEligibility(negatives));
  return state;
}

export async function prependReaderQuestionFromJob(
  state: DiscoveryState,
  jobId: string | undefined,
  jobs: JobStore,
  session: Pick<SessionRecord, "id">,
  confirmed: ClaimRecord[],
  rejected: ClaimRecord[],
): Promise<void> {
  const readerAnswered = [...confirmed, ...rejected].some((c) => c.id === discoveryClaimId(READER_ROLE_ITEM_ID));
  if (!jobId || readerAnswered) return;
  const job = await jobs.get(jobId);
  const roles = job && job.sessionId === session.id ? minedRoles(job) : [];
  if (roles.length > 0) state.questions = [readerQuestion(roles[0]!), ...state.questions];
}

export function applyDiscoveryEligibility(
  state: DiscoveryState,
  session: Pick<SessionRecord, "intent">,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  rejected: ClaimRecord[],
  facts: readonly EligibilityFact[],
  family: DiscoveryFamily | null,
  blocks: readonly JobBlockView[] = [],
): void {
  applyEligibilityQuestions(
    state,
    confirmed,
    negatives,
    rejected,
    facts,
    resolvedMarketsFor(session.intent.searchAreas),
    family?.items ?? [],
    blocks,
  );
}
