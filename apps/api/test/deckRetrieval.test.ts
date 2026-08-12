// Direct tests for the retrieval coordinator's seam (deckRetrieval.ts) — the claim/coalescing
// behaviour that previously was only reachable through buildServer() + timing. The full end-to-end
// behaviour (deck responses, snapshot handoff) stays covered by cards.test.ts.
import { describe, expect, it } from "vitest";
import type { PostingRetrievalResultV1 } from "@jobcrush/contracts";
import { makeRetrievalCoordinator, type RetrievalCoordinatorDeps } from "../src/deckRetrieval.js";

const unavailable: PostingRetrievalResultV1 = {
  schemaVersion: "4",
  outcome: "provider_unavailable",
  coverage: { providersQueried: [], providersUnavailable: ["x"], complete: false },
  reason: "test",
  retryable: true,
};

const request = {} as never; // ensureRetrieval passes it through untouched

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
});
