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
  schemaVersion: "4",
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

  function ensureRetrieval(
    session: Pick<
      SessionRecord,
      "id" | "retrieval" | "retrievalGeneration" | "retrievalCoordinationFingerprint"
    >,
    retrievalRequest: RetrievalRequest,
    requestFingerprint: string,
  ): PostingRetrievalResultV1 {
    if (isReusableRetrievalSnapshot(session.retrieval, requestFingerprint)) {
      return session.retrieval!.result;
    }
    const existing = retrievalsInFlight.get(session.id);
    if (
      existing?.fingerprint === requestFingerprint &&
      Date.now() - existing.startedAtMs < RETRIEVAL_CLAIM_LEASE_MS
    ) {
      return retrievalInProgress();
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
          schemaVersion: "4" as const,
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
          schemaVersion: "4",
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
    return retrievalInProgress();
  }

  return { ensureRetrieval };
}
