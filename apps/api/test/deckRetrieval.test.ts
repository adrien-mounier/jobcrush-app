// Direct tests for the retrieval coordinator's seam (deckRetrieval.ts) — the claim/coalescing
// behaviour that previously was only reachable through buildServer() + timing. The full end-to-end
// behaviour (deck responses, snapshot handoff) stays covered by cards.test.ts.
import { describe, expect, it } from "vitest";
import type { PostingRetrievalResultV1 } from "@jobcrush/contracts";
import { makeRetrievalCoordinator, type RetrievalCoordinatorDeps } from "../src/deckRetrieval.js";
import type { RetrievalRequest } from "../src/postingRetrieval.js";

const unavailable: PostingRetrievalResultV1 = {
  schemaVersion: "5",
  outcome: "provider_unavailable",
  coverage: { providersQueried: [], providersUnavailable: ["x"], complete: false },
  reason: "test",
  retryable: true,
};

// #248: ensureRetrieval no longer passes this through untouched. It READS the coverage fields first,
// to decide whether this deck may be served at all — before it so much as looks at the snapshot.
// This fixture is an AUTHORIZED request (#235's empty plan, covered by definition), so the tests
// below stay about claiming, coalescing and spending rather than about authorization. The
// unauthorized case has its own test at the bottom of this file.
const request: RetrievalRequest = {
  targetRole: "IT project manager",
  searchAreas: ["Hong Kong"],
  family: null,
  fallback: false,
  questionFloors: [],
  checkpoint: null,
  confirmedEvidence: [],
  explicitNegatives: [],
};

/** A visitor who has not covered her floor: a family plan whose checkpoint has not got there. */
const unauthorizedRequest: RetrievalRequest = {
  ...request,
  family: { familyId: "it-project-delivery", version: 1 },
  questionFloors: [{ familyId: "it-project-delivery", version: 1 }],
  checkpoint: "family_confirmed",
};

function session(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "s1",
    retrieval: null,
    retrievalGeneration: 1,
    retrievalCoordinationFingerprint: null,
    ...over,
  } as never;
}

function makeDeps(over: Partial<RetrievalCoordinatorDeps> = {}) {
  const calls = { begin: 0, reconcile: 0, retrieve: 0 };
  let settle!: (r: PostingRetrievalResultV1) => void;
  const deps: RetrievalCoordinatorDeps = {
    sessions: {
      beginRetrievalState: async () => {
        calls.begin++;
        return true;
      },
      reconcileRetrievalState: async () => {
        calls.reconcile++;
        return true;
      },
      getById: async () => null,
    },
    retrievePostings: () => {
      calls.retrieve++;
      return new Promise((resolve) => {
        settle = resolve;
      });
    },
    log: { error: () => undefined },
    ...over,
  };
  return { deps, calls, settle: (r: PostingRetrievalResultV1) => settle(r) };
}

describe("makeRetrievalCoordinator", () => {
  it("first caller fails closed with in-progress and fires exactly one background retrieval", async () => {
    const { deps, calls } = makeDeps();
    const c = makeRetrievalCoordinator(deps);
    const result = c.ensureRetrieval(session(), request, "fp-1");
    expect(result.outcome).toBe("provider_unavailable");
    expect(result.retryable).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(calls.begin).toBe(1);
    expect(calls.retrieve).toBe(1);
  });

  it("a second caller with the same fingerprint coalesces — no second claim, no second spend", async () => {
    const { deps, calls } = makeDeps();
    const c = makeRetrievalCoordinator(deps);
    c.ensureRetrieval(session(), request, "fp-1");
    await new Promise((r) => setImmediate(r));
    c.ensureRetrieval(session(), request, "fp-1");
    await new Promise((r) => setImmediate(r));
    expect(calls.begin).toBe(1);
    expect(calls.retrieve).toBe(1);
  });

  it("a changed fingerprint is NOT coalesced — it claims and retrieves again", async () => {
    const { deps, calls, settle } = makeDeps();
    const c = makeRetrievalCoordinator(deps);
    c.ensureRetrieval(session(), request, "fp-1");
    await new Promise((r) => setImmediate(r));
    settle(unavailable);
    c.ensureRetrieval(session(), request, "fp-2");
    await new Promise((r) => setImmediate(r));
    expect(calls.begin).toBe(2);
    expect(calls.retrieve).toBe(2);
  });

  it("losing the store claim reads the latest snapshot instead of spending", async () => {
    const { deps, calls } = makeDeps({
      sessions: {
        beginRetrievalState: async () => false,
        reconcileRetrievalState: async () => true,
        getById: async () => null,
      },
    });
    const c = makeRetrievalCoordinator(deps);
    const result = c.ensureRetrieval(session(), request, "fp-1");
    expect(result.outcome).toBe("provider_unavailable");
    await new Promise((r) => setImmediate(r));
    expect(calls.retrieve).toBe(0);
  });

  it("a reusable session snapshot is returned as-is with no store or provider traffic", () => {
    const { deps, calls } = makeDeps();
    const c = makeRetrievalCoordinator(deps);
    const snapshot = {
      requestFingerprint: "fp-1",
      recordedAt: new Date().toISOString(),
      result: unavailable,
    };
    const result = c.ensureRetrieval(session({ retrieval: snapshot }), request, "fp-1");
    expect(result).toBe(unavailable);
    expect(calls.begin).toBe(0);
    expect(calls.retrieve).toBe(0);
  });
  // #248 — the property the move exists for. A snapshot is DATA, not permission: it can now be
  // fetched before she has earned anything (#246 fetches at question 1 so the promise can state a
  // true count), so the deck has to refuse on its own account, every read, snapshot or no. While the
  // coverage test lived inside the fetch this was unwritable — nothing could put a snapshot there.
  it("refuses an uncovered deck even when a reusable snapshot is already sitting there", () => {
    const { deps, calls } = makeDeps();
    const c = makeRetrievalCoordinator(deps);
    // The SAME snapshot shape the reusable-snapshot test above proves is honoured — otherwise this
    // test would pass for the boring reason that there was nothing usable there anyway.
    const snapshot = { requestFingerprint: "fp-1", recordedAt: new Date().toISOString(), result: unavailable };
    expect(c.ensureRetrieval(session({ retrieval: snapshot }), request, "fp-1")).toBe(unavailable);

    const result = c.ensureRetrieval(session({ retrieval: snapshot }), unauthorizedRequest, "fp-1");

    expect(result).toEqual({
      schemaVersion: "5",
      outcome: "invalid_request",
      code: "floor_not_covered",
    });
    // And it spends nothing to say so: no claim, no provider call.
    expect(calls).toMatchObject({ begin: 0, retrieve: 0 });
  });

  it("serves the same session the moment its floor is covered", () => {
    const { deps } = makeDeps();
    const c = makeRetrievalCoordinator(deps);
    const snapshot = { requestFingerprint: "fp-1", recordedAt: new Date().toISOString(), result: unavailable };

    const covered = c.ensureRetrieval(
      session({ retrieval: snapshot }),
      { ...unauthorizedRequest, checkpoint: "essential_floor_covered" },
      "fp-1",
    );

    // The very same snapshot the previous test refused to serve — coverage is the only thing that
    // changed, which is what makes it the authorization and not the snapshot.
    expect(covered).toBe(unavailable);
  });
});
