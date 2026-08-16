// #236 — the ONE family-candidate intake: screen a target role, validate what the screen said
// against what it was actually shown, and record the attempt. Two callers use it and must not
// drift apart:
//   - POST /family-learning/candidates (routes/familyLearning.ts) — the explicit ask;
//   - the word-search deck's background watch below — the visitor never asks and is never told.
//
// The screen only ever returns a decision about a JOB TARGET. Nothing it produces reaches the
// visitor: no copy about research, job families or vocabulary exists on this path (spec #233).
import {
  type FamilyCandidateScreen,
  type FamilyLearningAttempt,
  type FamilyLearningStore,
  type FamilyScreeningDecision,
} from "./familyLearning.js";
import type { FamilyReference, SessionRecord, SessionStore } from "./sessions.js";

export interface FamilyCandidateIntakeDeps {
  store: FamilyLearningStore;
  screen: FamilyCandidateScreen;
  /** Read at call time, not at wiring time — publishing a family changes this list under a
   *  long-lived server, and covered_role is only trustworthy against the CURRENT published set. */
  knownFamilies: () => FamilyReference[];
}

export interface FamilyCandidateIntakeInput {
  sessionId: string;
  targetRole: string;
  searchArea: string | null;
  /** abuse / non_job: the explicit ask records its rejection (the visitor is answered with it); the
   *  background watch persists nothing at all — she asked for nothing, so nothing is written.
   *  Required, not defaulted: it decides whether an attempt comes back at all. */
  persistDiscarded: boolean;
}

/** #214: the store and the screen both take one search-area string — the words as typed, joined
 *  ("Melbourne, Vietnam"), null when none are set. One producer, both callers. */
export const searchAreaText = (session: Pick<SessionRecord, "intent">): string | null =>
  session.intent.searchAreas.map((entry) => entry.text).join(", ") || null;

const DISCARDED: ReadonlySet<FamilyScreeningDecision["outcome"]> = new Set(["abuse", "non_job"]);

/** The screen itself failed, or answered with a reference it was never shown. Distinct from a store
 *  fault so the route answers 503 "screening unavailable" for exactly the screening half, and lets a
 *  storage fault surface as the error it is rather than blaming the model. */
export class FamilyScreeningUnavailable extends Error {}

/** Screen → validate → record. Throws if the screen fails or answers with a reference it was never
 *  shown; callers decide what an unavailable screen means for their own response. */
export async function intakeFamilyCandidate(
  deps: FamilyCandidateIntakeDeps,
  input: FamilyCandidateIntakeInput,
): Promise<{ decision: FamilyScreeningDecision; attempt: FamilyLearningAttempt | null }> {
  const canonicalCandidates = await deps.store.acceptedCanonicalCandidates();
  const knownFamilies = deps.knownFamilies();
  let decision: FamilyScreeningDecision;
  try {
    decision = await deps.screen({
      targetRole: input.targetRole,
      searchArea: input.searchArea,
      canonicalCandidates,
      knownFamilies,
    });
  } catch (error) {
    throw new FamilyScreeningUnavailable(`family screening failed: ${String(error)}`);
  }
  if (
    decision.outcome === "equivalent" &&
    !canonicalCandidates.some((candidate) => candidate.id === decision.canonicalAttemptId)
  ) {
    throw new FamilyScreeningUnavailable("screening referenced unknown canonical attempt");
  }
  if (
    decision.outcome === "covered_role" &&
    !knownFamilies.some(
      (family) =>
        family.familyId === decision.coveredFamily?.familyId &&
        family.version === decision.coveredFamily.version,
    )
  ) {
    throw new FamilyScreeningUnavailable("screening referenced unknown family");
  }
  if (DISCARDED.has(decision.outcome) && !input.persistDiscarded) {
    return { decision, attempt: null };
  }
  // The store owns dedupe: an equivalent decision carries the canonical attempt id, and a second
  // accepted attempt on the same normalized role collapses to `duplicate` against the canonical one.
  const attempt = await deps.store.submit(
    input.sessionId,
    input.targetRole,
    decision,
    input.searchArea,
  );
  return { decision, attempt };
}

export interface FamilyCandidateWatchDeps extends FamilyCandidateIntakeDeps {
  sessions: Pick<SessionStore, "reconcileDiscoveryState">;
  log: { warn: (context: unknown, message: string) => void };
}

/** The background judgement that rides the word-search deck. Fire-and-forget: the deck response is
 *  never delayed by it, never changed by it, and an internal fault never becomes a visible one. */
export function makeFamilyCandidateWatch(deps: FamilyCandidateWatchDeps) {
  // ponytail: one screening attempt per session per process, no retry — a failed screen costs that
  // session its recovery rather than costing every later deck load another model call. Move to a
  // durable marker if the miss rate ever matters.
  const seen = new Set<string>();
  return function watchFamilyCandidate(session: SessionRecord): void {
    const targetRole = session.intent.targetRole?.trim();
    // Only the word search is judged. A session already searching a family — including one this
    // watch pinned earlier — has its answer, so the screen is never consulted again for it.
    if (!targetRole || session.discovery.searchFamily !== null || seen.has(session.id)) return;
    seen.add(session.id);
    void (async () => {
      if (await deps.store.latestForSession(session.id)) return;
      const { decision } = await intakeFamilyCandidate(deps, {
        sessionId: session.id,
        targetRole,
        searchArea: searchAreaText(session),
        persistDiscarded: false,
      });
      const family = decision.outcome === "covered_role" ? decision.coveredFamily : null;
      if (!family) return;
      // The free second chance at placement: the screen saw the whole published list and recognised
      // a family the labeler missed. It becomes both the question floor and the search family, so
      // she is interviewed and searched exactly like any placed visitor. The word plan's pin allows
      // this one upgrade (sessions.ts planUpgradable); coverage restarts with the new floor.
      await deps.sessions.reconcileDiscoveryState(
        session.id,
        { questionFloors: [family], searchFamily: family },
        [],
        false,
      );
    })().catch((error) => {
      deps.log.warn({ err: error, sessionId: session.id }, "family candidate screening failed");
    });
  };
}
