// The deck's posting-retrieval coordinator — the distributed-claim half of GET /onboarding/cards,
// extracted verbatim from routes/onboarding.ts (2026-08-12 architecture pass, candidate 1). One
// entry point: ensureRetrieval() returns what THIS response should say about postings (a reusable
// snapshot, an in-progress marker, or an unavailable result) and fires the background claim →
// retrieve → reconcile work when this process should be the one paying for it. The route no longer
// knows the store's CAS/lease protocol; tests can exercise coalescing and lease edges without
// booting a server.
import { randomUUID } from "node:crypto";
import type { PostingRetrievalResultV1 } from "@jobcrush/contracts";
import {
  RETRIEVAL_CLAIM_LEASE_MS,
  retrievalClaimWindow,
  type SessionRecord,
  type SessionStore,
} from "./sessions.js";
import {
  deckReadIsAuthorized,
  floorNotCoveredResult,
  isReusableRetrievalSnapshot,
  logPostingRetrievalFailure,
  type RetrievalRequest,
} from "./postingRetrieval.js";

type RetrievalLog = Parameters<typeof logPostingRetrievalFailure>[0];

export interface RetrievalCoordinatorDeps {
  sessions: Pick<SessionStore, "beginRetrievalState" | "reconcileRetrievalState" | "getById">;
  retrievePostings: (input: RetrievalRequest) => Promise<PostingRetrievalResultV1>;
  log: RetrievalLog;
}

const retrievalInProgress = (): PostingRetrievalResultV1 => ({
  schemaVersion: "5",
  outcome: "provider_unavailable",
  coverage: {
    providersQueried: [],
    providersUnavailable: ["retrieval-in-progress"],
    complete: false,
  },
  reason: "posting retrieval is in progress",
  retryable: true,
});

/** #245: the one transient result that means work is active, not that retrieval has finished. */
export function retrievalIsInProgress(result: PostingRetrievalResultV1): boolean {
  return "coverage" in result && result.coverage.providersUnavailable.includes("retrieval-in-progress");
}

/** One coordinator per server instance (it owns the same-process coalescing map the plugin closure
 *  used to hold). §2.6 forbids provider latency on the cards request. §2.8's session snapshot is the
 *  handoff: the first uncached read fails closed while one background task runs; later reads use its
 *  CAS-persisted result. The map coalesces same-process duplicates, while SessionStore's atomic
 *  claim prevents another process from spending for the same observed session state. */
export function makeRetrievalCoordinator(deps: RetrievalCoordinatorDeps) {
  const retrievalsInFlight = new Map<
    string,
    { fingerprint: string; startedAtMs: number; result: Promise<PostingRetrievalResultV1> }
  >();

  type CoordinatedSession = Pick<
    SessionRecord,
    "id" | "retrieval" | "retrievalGeneration" | "retrievalCoordinationFingerprint"
  >;

  /** The fetch half, with no reveal check of its own — #248: fetching postings and being ALLOWED TO
   *  SEE them are different decisions. Returns what this response may say right now, plus the work
   *  in flight behind it (null when there is none) for a caller that can afford to wait — #246's
   *  question-1 promise is the one that can. */
  function beginRetrieval(
    session: CoordinatedSession,
    retrievalRequest: RetrievalRequest,
    requestFingerprint: string,
  ): { now: PostingRetrievalResultV1; inFlight: Promise<PostingRetrievalResultV1> | null } {
    if (isReusableRetrievalSnapshot(session.retrieval, requestFingerprint)) {
      return { now: session.retrieval!.result, inFlight: null };
    }
    const existing = retrievalsInFlight.get(session.id);
    if (
      existing?.fingerprint === requestFingerprint &&
      Date.now() - existing.startedAtMs < RETRIEVAL_CLAIM_LEASE_MS
    ) {
      return { now: retrievalInProgress(), inFlight: existing.result };
    }
    const generation = session.retrievalGeneration;
    const expectedSnapshotFingerprint = session.retrievalCoordinationFingerprint;
    const ownerToken = randomUUID();
    const claimWindow = retrievalClaimWindow();
    const result = (async () => {
      let claimed: boolean;
      try {
        claimed = await deps.sessions.beginRetrievalState(
          session.id,
          generation,
          requestFingerprint,
          expectedSnapshotFingerprint,
          ownerToken,
          claimWindow.claimedAt,
          claimWindow.staleBefore,
        );
      } catch {
        logPostingRetrievalFailure(deps.log, "claim_failed");
        return {
          schemaVersion: "5" as const,
          outcome: "provider_unavailable" as const,
          coverage: {
            providersQueried: [],
            providersUnavailable: ["retrieval-store"],
            complete: false,
          },
          reason: "posting retrieval is temporarily unavailable",
          retryable: true,
        };
      }
      if (!claimed) {
        try {
          const latest = await deps.sessions.getById(session.id);
          if (isReusableRetrievalSnapshot(latest?.retrieval ?? null, requestFingerprint)) {
            return latest!.retrieval!.result;
          }
        } catch {
          logPostingRetrievalFailure(deps.log, "snapshot_read_failed");
        }
        return retrievalInProgress();
      }
      let current: PostingRetrievalResultV1;
      try {
        current = await deps.retrievePostings(retrievalRequest);
      } catch {
        logPostingRetrievalFailure(deps.log, "retrieval_failed");
        current = {
          schemaVersion: "5",
          outcome: "provider_unavailable",
          coverage: {
            providersQueried: [],
            providersUnavailable: ["retrieval"],
            complete: false,
          },
          reason: "posting retrieval is temporarily unavailable",
          retryable: true,
        };
      }
      try {
        await deps.sessions.reconcileRetrievalState(
          session.id,
          generation,
          requestFingerprint,
          ownerToken,
          { requestFingerprint, recordedAt: new Date().toISOString(), result: current },
        );
      } catch {
        logPostingRetrievalFailure(deps.log, "reconciliation_failed");
      }
      return current;
    })();
    retrievalsInFlight.set(session.id, {
      fingerprint: requestFingerprint,
      startedAtMs: Date.parse(claimWindow.claimedAt),
      result,
    });
    void result.then(
      () => {
        if (retrievalsInFlight.get(session.id)?.result === result) retrievalsInFlight.delete(session.id);
      },
      () => {
        logPostingRetrievalFailure(deps.log, "background_failed");
        if (retrievalsInFlight.get(session.id)?.result === result) retrievalsInFlight.delete(session.id);
      },
    );
    return { now: retrievalInProgress(), inFlight: result };
  }

  /** What THIS deck response may say about postings. */
  function ensureRetrieval(
    session: CoordinatedSession,
    retrievalRequest: RetrievalRequest,
    requestFingerprint: string,
  ): PostingRetrievalResultV1 {
    // #248: FIRST, before the snapshot is even looked at, so an early snapshot cannot report itself
    // as a finished retrieval. This is only HALF the guard, and on its own it would be decoration:
    // it decides the payload's `retrieval` field, never the cards. The cards are gated in
    // preview.ts's sessionPostings, which every posting reader passes through.
    if (!deckReadIsAuthorized(retrievalRequest)) return floorNotCoveredResult();
    return beginRetrieval(session, retrievalRequest, requestFingerprint).now;
  }

  /** #246 — a fetch that WAITS, and that deliberately does NOT ask whether she may see the result.
   *  The name says both halves because the two exports here have the same signature and only one of
   *  them authorizes: read `ensureRetrieval` if you want a deck, this if you want a number.
   *
   *  The waiting is question 1's promise, whose whole job is to state a count on the screen it is
   *  printed on — a number that arrives one question later is not the promise she was made — so this
   *  pays the provider latency §2.6 forbids the cards route from paying. Its caller
   *  (discoveryEngine.ts's searchAtQuestionOne) bounds that wait.
   *
   *  The missing reveal check is #248: she has answered nothing at question 1 and would fail
   *  `deckReadIsAuthorized`, and #248 split fetching from being allowed to see precisely so that
   *  fetching is legal here. What still refuses her the CARDS is preview.ts's sessionPostings, which
   *  every posting reader passes through — never this. A failed background task degrades to whatever
   *  the immediate answer was, so the promise goes quiet rather than wrong. */
  async function awaitRetrievalWithoutReveal(
    session: CoordinatedSession,
    retrievalRequest: RetrievalRequest,
    requestFingerprint: string,
  ): Promise<PostingRetrievalResultV1> {
    const { now, inFlight } = beginRetrieval(session, retrievalRequest, requestFingerprint);
    if (!inFlight) return now;
    try {
      return await inFlight;
    } catch {
      return now;
    }
  }

  return { ensureRetrieval, awaitRetrievalWithoutReveal };
}
