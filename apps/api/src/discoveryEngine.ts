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
import type { FamilyPlacement } from "@jobcrush/contracts";
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
import { withReadTimeout, type DeckDiscoveryReads } from "./deck.js";
import type { makeRetrievalCoordinator } from "./deckRetrieval.js";
import { cvLanguages, type CvLanguage } from "./cvLanguages.js";
import { applyEligibilityQuestions, excludingEligibility, LANGUAGE_ITEM_ID } from "./eligibilityDiscovery.js";
import type { EligibilityFact, EligibilityStore } from "./eligibility.js";
import {
  eligiblePublication,
  productionDiscoveryFamily,
  type ProductionFamilyFloorStore,
} from "./familyFloors.js";
import type { JobBlockStore } from "./jobBlockStore.js";
import { minedRoles, type JobStore } from "./jobs.js";
import { readingLanguages } from "./language.js";
import { retrievalFingerprint, retrievalRequestForSession, resolvedMarketsFor, reviewOpensJobs } from "./postingRetrieval.js";
import { retrievedPostingCount } from "./preview.js";
import { pinnedOrDerived, planPinned, planUpgradable, samePlan } from "./sessions.js";
import type { DiscoveryPlan, SessionRecord, SessionStore } from "./sessions.js";

export function productionDiscoveryFamilyLookup(
  floors: Pick<ProductionFamilyFloorStore, "activePublications" | "get">,
  query: string,
): { family: string; suggestions: readonly string[] } {
  // #255: with more than one active family, "the" family is decided by the QUERY — the family
  // whose label or market titles the typed words overlap. One family made the old first-family
  // default invisible; the second made it wrong (typing "project manager" answered "Business
  // analysis"). An UNMATCHED query gets `suggestions: []` — the documented silent no-match
  // (lib/api.ts's contract): the web renders whatever arrives under "same kind of job" as one-tap
  // role submissions, so serving a fallback family's words there is one tap from a wrong
  // placement (#255's QA gate proved it live with "scrum master"). A query overlapping BOTH
  // families resolves to the first match in familyId order, deterministic.
  const q = query.trim().toLocaleLowerCase("en-US");
  const active = floors.activePublications()
    .sort((a, b) => a.floor.familyId.localeCompare(b.floor.familyId, "en-US"));
  if (active.length === 0) throw new Error("no active production family available for discovery");
  const titlesOf = (publication: (typeof active)[number]): string[] => {
    const titles: string[] = [];
    const seen = new Set<string>();
    for (const entries of Object.values(publication.marketSearchTitles)) {
      for (const entry of entries) {
        const key = entry.title.trim().toLocaleLowerCase("en-US");
        if (!key || seen.has(key)) continue;
        seen.add(key);
        titles.push(entry.title);
      }
    }
    return titles;
  };
  const overlaps = (a: string, b: string) => a.includes(b) || b.includes(a);
  const matchesQuery = (value: string) => overlaps(value.toLocaleLowerCase("en-US"), q);
  // #258: aliases join the same match under the same rule and the same familyId tie-break. They are
  // the titles a family's SCOPE names as inside it — a scrum master is placed in IT project delivery
  // by the labeler, but "scrum master" is neither the label nor a market word, so the hint was the
  // one thing that did not recognise her. What comes BACK is unchanged: the family's market titles,
  // never the alias she just typed (a suggestion is a one-tap role submission, so it has to be a
  // word the product can search with).
  const matched = q
    ? active.find((publication) =>
        matchesQuery(publication.floor.label) ||
        titlesOf(publication).some(matchesQuery) ||
        publication.aliases.some(matchesQuery))
    : undefined;
  const chosen = matched ?? active[0]!;
  return { family: chosen.floor.label, suggestions: matched ? titlesOf(matched) : [] };
}

export interface DiscoveryPlanDeps {
  // #246 widened this from "reconcileDiscoveryState" alone: question 1's search re-reads the session
  // it has just pinned, and records the number it found (searchAtQuestionOne).
  sessions: Pick<SessionStore, "reconcileDiscoveryState" | "getById" | "setPromiseOpenJobs">;
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

/** #246 — how long question 1 may hold the screen waiting for its search. Deliberately far below
 *  the provider's own ceiling: the number is worth a short wait and nothing more. */
const PROMISE_SEARCH_TIMEOUT_MS = 4_000;

/** #246 — question 1, and only question 1, pays for a real search, and waits for it — and only the
 *  FIRST question 1 of a session does (`firstAsk`; see the quota note inside).
 *
 *  Order matters and is the whole bug this closes. `reconcileSessionDiscovery` PINS the plan first,
 *  and only then is the session re-read and searched: search before the pin and a visitor whose CV
 *  proves a family would be searched as if she had none, which is the mismatched-promise defect
 *  wearing different clothes. What comes back is the session carrying the snapshot her own search
 *  just produced, so the promise on this response counts the deck she will actually be served.
 *
 *  She has earned nothing at question 1 and cannot be shown any of it — #248's split is what makes
 *  fetching legal here, and preview.ts's sessionPostings is what still refuses her the cards. */
export async function searchAtQuestionOne(
  session: SessionRecord,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  deps: DiscoveryPlanDeps,
  coordinator: Pick<ReturnType<typeof makeRetrievalCoordinator>, "awaitRetrievalWithoutReveal">,
  firstAsk: boolean,
): Promise<{ session: SessionRecord; family: DiscoveryFamily | null }> {
  const family = await reconcileSessionDiscovery(session, deps);
  const pinned = (await deps.sessions.getById(session.id)) ?? session;
  // #246 QA finding 2 — ONE search per session, ever. This endpoint is anonymous, needs nothing
  // earned, and every distinct role string is a distinct query: left ungated, one visitor retyping
  // her job title is an open tap into the provider's monthly call quota, and a single IP could drain
  // the month in under an hour. The owner bought one search per genuine visitor, and that is exactly
  // what this spends.
  //
  // A re-submitted question 1 CLEARS the number rather than keeping it. Her previous number counted
  // a search for the job she just stopped asking for, and showing it against her new words would be
  // this very ticket's defect with the families swapped. Silence is the honest answer; her deck
  // still searches her new words when she gets there.
  if (!firstAsk) {
    await deps.sessions.setPromiseOpenJobs(pinned.id, null);
    return { session: { ...pinned, promiseOpenJobs: null }, family };
  }
  const request = retrievalRequestForSession(pinned, confirmed, negatives);
  // Bounded, because this one is on the visitor's critical path: she has just submitted question 1
  // and is watching "Finding jobs like yours…". The provider's own worst case is two 10s attempts
  // plus a retry, and making her hold the screen for that is a worse screen than one with no number
  // on it. On the deadline the search carries on in the background and still feeds her deck — all
  // that is lost is the count, which falls to null and prints nothing.
  const result = await withReadTimeout(
    coordinator.awaitRetrievalWithoutReveal(pinned, request, retrievalFingerprint(request)),
    PROMISE_SEARCH_TIMEOUT_MS,
  ).catch(() => null);
  // Counted here and stored, not left on the retrieval snapshot: reconcileDiscoveryState drops that
  // snapshot on every answer she gives, and a promise that vanishes on the first tap is worse than
  // the wrong number this ticket came to fix.
  const promiseOpenJobs = retrievedPostingCount(result, readingLanguages(pinned));
  await deps.sessions.setPromiseOpenJobs(pinned.id, promiseOpenJobs);
  return { session: { ...pinned, promiseOpenJobs }, family };
}

/** Question 1, answered: the role becomes the target title and the intent's role, the session
 *  enters discovery, and the first ask buys its one search. #322 — the one path for both doors:
 *  question 1 typed on this screen, and the role the front door already took (discovery GET). */
export async function answerQuestionOne(
  session: SessionRecord,
  role: string,
  deps: DiscoveryPlanDeps & {
    sessions: Pick<SessionStore, "setTargetTitles" | "setIntent" | "setStage">;
    claims: Pick<ClaimStore, "confirmed">;
  },
  coordinator: Pick<ReturnType<typeof makeRetrievalCoordinator>, "awaitRetrievalWithoutReveal">,
): Promise<{ session: SessionRecord; family: DiscoveryFamily | null }> {
  // #246 QA finding 2: read BEFORE the write below — this is the only thing that tells a
  // genuine first question 1 from a re-submit, and only the first one may buy a search.
  const firstAsk = session.targetTitles.length === 0;
  await deps.sessions.setTargetTitles(session.id, [role]);
  const intent = await deps.sessions.setIntent(session.id, { targetRole: role });
  await deps.sessions.setStage(session.id, "discovery");
  const [confirmed, negatives] = await Promise.all([deps.claims.confirmed(session.id), deps.claims.negatives(session.id)]);
  return searchAtQuestionOne({ ...session, intent, targetTitles: [role] }, confirmed, negatives, deps, coordinator, firstAsk);
}

/** Every read the discovery screen and the deck are built from, fired in parallel. Third element
 *  (rejected) is #35's — no new store method, just the existing list() filtered. Fourth (facts) is
 *  #106's stored eligibility facts. Fifth (blocks) is #162's dated job records, whose unknown ends
 *  are asked instead of a years total (ADR-0008 clause 3). Callers that need fewer destructure fewer.
 *
 *  #336: `cvLanguages` rides on the same tuple — the CV's languages, read off the very list() the
 *  rejected filter already pays for — so the deck keeps taking it as plain DeckDiscoveryReads. */
export type DiscoveryReads = DeckDiscoveryReads & { cvLanguages: CvLanguage[] };

export async function discoveryReads(
  deps: { claims: Pick<ClaimStore, "confirmed" | "negatives" | "list">; eligibility: Pick<EligibilityStore, "list">; jobBlocks: Pick<JobBlockStore, "list"> },
  sessionId: string,
): Promise<DiscoveryReads> {
  const [confirmed, negatives, all, facts, blocks] = await Promise.all([
    deps.claims.confirmed(sessionId),
    deps.claims.negatives(sessionId),
    deps.claims.list(sessionId),
    deps.eligibility.list(sessionId),
    deps.jobBlocks.list(sessionId),
  ]);
  const reads: DeckDiscoveryReads = [confirmed, negatives, all.filter((c) => c.decision === "rejected"), facts, blocks];
  return Object.assign(reads, { cvLanguages: cvLanguages(all) });
}

/** #246 — the promise's number is read off the session, where question 1's search recorded it
 *  (`searchAtQuestionOne` above). Every later discovery response — an answer, a resume — restates
 *  the same number for free; only question 1 ever pays a provider to find it.
 *
 *  #336: the languages question carries the CV's languages, so the screen can pre-tick the ones the
 *  CV says the person works in. A proposal only — nothing is stored until the person submits. */
export function buildDiscoveryRouteState(
  role: string | null,
  reads: DiscoveryReads,
  session: Pick<SessionRecord, "intent" | "promiseOpenJobs" | "importProof" | "reviewCompletedAt">,
  family: DiscoveryFamily | null,
): DiscoveryState {
  const [confirmed, negatives, rejected, facts] = reads;
  const state = discoveryState(role, confirmed, negatives, rejected, null, family, session.promiseOpenJobs);
  if (role) applyDiscoveryEligibility(state, session, confirmed, negatives, rejected, facts, family);
  const languages = state.questions.find((q) => q.itemId === LANGUAGE_ITEM_ID);
  if (languages && reads.cvLanguages.length > 0) languages.cvLanguages = reads.cvLanguages;
  state.factCount = factCount(excludingEligibility(confirmed), excludingEligibility(negatives));
  // #338: where the last answer hands off — "Your CV, reviewed" while a brought CV is unreviewed,
  // the jobs otherwise. The server owns the gate (postingRetrieval.ts); this only tells the screen.
  state.reviewPending = !reviewOpensJobs(session);
  return state;
}

export async function prependReaderQuestionFromJob(
  state: DiscoveryState,
  jobId: string | undefined,
  jobs: JobStore,
  session: Pick<SessionRecord, "id">,
  confirmed: ClaimRecord[],
  closed: ClaimRecord[], // rejected + negatives: asked and closed, no CV line
): Promise<void> {
  const readerAnswered = [...confirmed, ...closed].some((c) => c.id === discoveryClaimId(READER_ROLE_ITEM_ID));
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
): void {
  applyEligibilityQuestions(
    state,
    confirmed,
    negatives,
    rejected,
    facts,
    resolvedMarketsFor(session.intent.searchAreas),
    family?.items ?? [],
  );
}
