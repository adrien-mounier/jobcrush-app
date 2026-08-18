// #216 - the ONE discovery INTERVIEW. (This file was `legacyDiscovery.ts` while there were two.)
// The shipped screen (GET/POST /onboarding/discovery*) is the only surface a visitor's interview is
// served through: the floor items it asks come from her plan's published family floors, and the
// coverage her answers earn is reconciled onto the session on the same request. The parallel
// /discovery/production/* interview that used to be the only writer is gone - it had no client and
// could not build the screen (CV lines, rail fill, eligibility questions, the promise), so
// reconciliation moved here.
//
// Not the only writer of `session.discovery`, and deliberately so: familyCandidateIntake.ts pins a
// family the background screen recognised (#236), and deckFallback.ts records the widening she
// accepted (#228). Both write facts the interview does not own. This module owns the interview.
import type { FamilyPlacement, JobBlockView } from "@jobcrush/contracts";
import { discoveryPlan, planDiscoveryState } from "./adaptiveDiscovery.js";
import type { ClaimRecord, ClaimStore } from "./claims.js";
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
import {
  eligiblePublication,
  productionDiscoveryFamily,
  type ProductionFamilyFloorStore,
} from "./familyFloors.js";
import type { JobBlockStore } from "./jobBlockStore.js";
import { minedRoles, type JobStore } from "./jobs.js";
import { resolvedMarketsFor } from "./postingRetrieval.js";
import { pinnedOrDerived, planPinned, planUpgradable, samePlan } from "./sessions.js";
import type { DiscoveryPlan, SessionRecord, SessionStore } from "./sessions.js";

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

export interface DiscoveryPlanDeps {
  sessions: Pick<SessionStore, "reconcileDiscoveryState">;
  claims: Pick<ClaimStore, "list" | "negatives">;
  jobBlocks: Pick<JobBlockStore, "list">;
  placeFamily: (session: Readonly<SessionRecord>) => Promise<FamilyPlacement>;
  productionFamilyFloors: ProductionFamilyFloorStore;
}

type PlanDeps = Pick<DiscoveryPlanDeps, "placeFamily" | "jobBlocks" | "productionFamilyFloors">;

/** The plan this session is interviewed and searched on: the stored pin where there is one, else
 *  today's derivation (adaptiveDiscovery.ts's `discoveryPlan` is the one decider of both facts).
 *
 *  #216: a derivation that CONFLICTS with an already pinned plan loses, and the visitor carries on.
 *  The retired production surface answered that conflict with a 409; the shipped screen cannot —
 *  mid-interview a 409 is a dead end, and the pinned plan is the one her recorded answers belong
 *  to. The pin stays one-way either way (sessions.ts `planUpgradable`): a word plan may still gain
 *  a search family, and a family plan never downgrades or swaps. */
async function currentPlan(session: SessionRecord, deps: PlanDeps): Promise<DiscoveryPlan> {
  const placementSession = session.intent.targetRole
    ? session
    : { ...session, intent: { ...session.intent, targetRole: session.targetTitles[0] ?? null } };
  const derived = discoveryPlan(
    await deps.placeFamily(placementSession),
    await deps.jobBlocks.list(session.id),
    deps.productionFamilyFloors,
  );
  const candidate = pinnedOrDerived(session.discovery, derived);
  return planPinned(session.discovery) &&
    !samePlan(session.discovery, candidate) &&
    !planUpgradable(session.discovery, candidate)
    ? {
        questionFloors: session.discovery.questionFloors,
        searchFamily: session.discovery.searchFamily,
      }
    : candidate;
}

/** The family the screen renders, touching nothing. This is the read for surfaces that are NOT the
 *  interview — the deck, the job card, the tailor: #235's rule is that nothing re-derives a plan
 *  while she is browsing a deck, so those reads must never write one either. */
export async function currentDiscoveryFamily(
  session: SessionRecord,
  deps: PlanDeps,
): Promise<DiscoveryFamily | null> {
  const plan = await currentPlan(session, deps);
  return productionDiscoveryFamily(deps.productionFamilyFloors, plan.questionFloors);
}

/** #216 — the same family, plus the write the interview owes the session. The plan is pinned and
 *  the coverage her recorded answers earn across its floors is stored, so
 *  `session.discovery.checkpoint` reaches `essential_floor_covered` through the flow she actually
 *  walks — and `/onboarding/cards` retrieves on the family she was interviewed on.
 *
 *  Recomputed from the claims on every call and never latched: an answer corrected so that an item
 *  falls out of coverage drops the checkpoint back on that same request, and the reveal with it. */
export async function reconcileSessionDiscovery(
  session: SessionRecord,
  deps: DiscoveryPlanDeps,
): Promise<DiscoveryFamily | null> {
  const plan = await currentPlan(session, deps);
  const publications = plan.questionFloors.map((reference) =>
    eligiblePublication(deps.productionFamilyFloors.get(reference.familyId, reference.version)),
  );
  // A publication pulled since the pin: nothing is asked, and the stored record is left exactly as
  // it was rather than rewritten - rewriting it would be claiming coverage over a floor nobody can
  // read any more. What that can leave behind is a stale `essential_floor_covered`. In FAMILY mode
  // it authorizes nothing: retrieval re-checks the publication and refuses a pulled family
  // (`family_not_published`, postingRetrieval.ts). In WORD mode the search family is null, so what
  // it authorizes is the word search she would have had anyway - never a family reveal she did not
  // earn. Same behaviour as the retired route, which refused the request outright at this point.
  if (publications.some((publication) => !publication)) return null;
  const [claims, negatives] = await Promise.all([
    deps.claims.list(session.id),
    deps.claims.negatives(session.id),
  ]);
  const calculated = planDiscoveryState(
    publications.map((publication) => publication!.floor),
    claims,
    negatives,
  );
  // An empty plan (the zero-history word search) has nothing to pin; its coverage is complete by
  // definition and is never persisted.
  if (planPinned(plan)) {
    await deps.sessions.reconcileDiscoveryState(
      session.id,
      plan,
      calculated.coveredItemIds,
      calculated.checkpoint === "essential_floor_covered",
    );
  }
  return productionDiscoveryFamily(deps.productionFamilyFloors, plan.questionFloors);
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
