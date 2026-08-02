// #118 — request-scoped ambient visitor id for LLM usage metering. The LLM clients main.ts builds
// (llm, judgeLlm) are process-level singletons constructed once at boot, so the visitor making any
// given call is only knowable per REQUEST, not per client. server.ts's onRequest hook — the same
// place the session is already resolved — establishes the ambient visitor via runWithVisitor();
// llmMeter.ts reads it via currentVisitorId() when a metered call completes, wherever in the
// request's async chain that happens to be.
//
// runWithVisitor(), not AsyncLocalStorage.enterWith(): enterWith called AFTER an await inside an
// async onRequest hook does not propagate into the route handler's continuation on this Fastify
// version — verified empirically (a hook setting the store before any await reaches the handler;
// after an await it does not, on sequential, concurrent, and keep-alive requests). The reason is
// Fastify's own hook-runner: for a plain `async (request) => {...}` hook, Fastify attaches its
// "proceed to the next phase" continuation to the promise the hook function returns the INSTANT it
// calls that function — before the hook body has done anything, including any later enterWith call.
// That continuation's ambient context is therefore whatever was active at call time, never updated
// by something the hook does after an await.
//
// The fix is the `(request, reply, done)` callback-style hook (server.ts): resolve the session with
// normal async/await, then call `runWithVisitor(visitorId, done)` as the LAST synchronous action.
// Because `done()` is invoked synchronously from inside `storage.run()`'s callback, Fastify's own
// continuation — the rest of the hook chain, then the route handler, then everything the handler
// itself awaits — runs as a direct descendant of that synchronous call and correctly inherits the
// context for its whole lifetime, including calls made deep inside an awaited model request.
//
// A call with no ambient context — a background job, a test that never goes through the HTTP seam —
// reads back null: the system/unattributed bucket, never dropped, never guessed (#118 AC).
import { AsyncLocalStorage } from "node:async_hooks";

interface VisitorContext {
  visitorId: string | null;
}

const storage = new AsyncLocalStorage<VisitorContext>();

/** Runs `fn` with `visitorId` as the ambient visitor for `fn`'s entire execution, including every
 *  asynchronous continuation reachable from it — this is the ONLY reliable way to set the ambient
 *  visitor (see this file's header for why AsyncLocalStorage.enterWith doesn't work across Fastify's
 *  hook-to-handler transition). Call once, where the session is already resolved. */
export function runWithVisitor<T>(visitorId: string | null, fn: () => T): T {
  return storage.run({ visitorId }, fn);
}

/** The ambient visitor for whatever call is in flight right now, or null when there is none — no
 *  request context at all, or a resolved-but-anonymous session both read the same way. */
export function currentVisitorId(): string | null {
  return storage.getStore()?.visitorId ?? null;
}
