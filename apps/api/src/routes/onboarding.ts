// JC-21/27/31 — the S2 onboarding deck + build API. This is the first HTTP surface over the E4
// spine: the deck confirms/rejects/edits mined claims, then build runs the pure pipeline
// buildClaimGraph → renderRootCv → runGate and flips the session to `ready` (or `loopback`).
//
// Slice A wiring (docs/s2-kickoff.md decisions, the grill-session plan):
//   - Rides the anonymous session (no auth yet — E2). Claims are stored per session.
//   - Every deck decision is a plain synchronous store write; no job/SSE, because the spine is pure
//     arithmetic (no LLM). The "state machine" is a single `stage` field on the session.
//   - No claim tiering and no grill yet — every claim is a plain confirm. That intelligence is the
//     next E3 pass; this slice exists to exercise the untouched spine end to end.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { CandidateClaim } from "@jobcrush/contracts";
import { requireSession } from "../server.js";
import type { ClaimStore } from "../claims.js";
import type { JobStore } from "../jobs.js";
import type { SessionStore } from "../sessions.js";
import { buildClaimGraph } from "../graph.js";
import { renderRootCv } from "../rootcv.js";
import { runGate } from "../gate.js";

export interface OnboardingDeps {
  claims: ClaimStore;
  store: JobStore;
  sessions: SessionStore;
}

// The deck's tiering policy (JC-22, kickoff decision #3). A claim copied verbatim from the CV
// batch-approves as part of its section; anything the machine reworded or inferred gets an individual
// review card — those are the claims we might have gotten wrong. This lives here, not in the store,
// because it is deck policy (the store deliberately bakes none).
// ponytail: machine_touch split only; stakes-weighted ranking (titles/dates > tools) is the upgrade
// IF a CV ever overflows ~15 individual cards — the miner eval keeps the touched count under that, so
// there is nothing to rank yet.
export type DeckTier = "individual" | "batch";
export const claimTier = (touch: CandidateClaim["machine_touch"]): DeckTier =>
  touch === "verbatim" ? "batch" : "individual";

export function onboardingRoutes(deps: OnboardingDeps) {
  return async function plugin(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    // Open the deck: seed this session's claim store from its onboarding job's mined claims, once.
    // The client holds the jobId (same as GET /previews/:jobId); the job proves the mine finished.
    app.post(
      "/onboarding/deck",
      { schema: { body: z.object({ jobId: z.string() }) } },
      async (req, reply) => {
        const session = requireSession(req);
        const job = await deps.store.get(req.body.jobId);
        if (!job || job.sessionId !== session.id)
          return reply.status(404).send({ error: { code: "not_found", message: "unknown job" } });

        // Idempotent: seed only if this session has no claims yet, so decisions survive a reopen.
        if ((await deps.claims.list(session.id)).length === 0) {
          const mined = (job.progress.miner as { claims?: CandidateClaim[] } | undefined)?.claims;
          if (!mined?.length)
            return reply
              .status(409)
              .send({ error: { code: "not_ready", message: "claims not mined yet" } });
          await deps.claims.seed(session.id, mined);
        }
        const claims = (await deps.claims.list(session.id)).map((c) => ({
          ...c,
          tier: claimTier(c.machine_touch),
        }));
        return { stage: session.stage, claims };
      },
    );

    app.post(
      "/onboarding/claims/:id/confirm",
      { schema: { params: z.object({ id: z.string() }) } },
      async (req) => {
        const session = requireSession(req);
        await deps.claims.confirm(session.id, req.params.id);
        return { ok: true };
      },
    );

    app.post(
      "/onboarding/claims/:id/reject",
      { schema: { params: z.object({ id: z.string() }) } },
      async (req) => {
        const session = requireSession(req);
        await deps.claims.reject(session.id, req.params.id);
        return { ok: true };
      },
    );

    // Deck edit → user-authored, auto-confirmed (the store enforces that; the user vouched for it).
    app.put(
      "/onboarding/claims/:id",
      {
        schema: {
          params: z.object({ id: z.string() }),
          body: z.object({ text: z.string().trim().min(1) }),
        },
      },
      async (req) => {
        const session = requireSession(req);
        await deps.claims.edit(session.id, req.params.id, req.body.text);
        return { ok: true };
      },
    );

    // Build: the confirmed claims → graph → root CV → gate. Pure + synchronous. On a clean gate the
    // session flips to `ready`; a failing gate returns the errors (each names a node) and `loopback`.
    app.post("/onboarding/build", async (req) => {
      const session = requireSession(req);
      const confirmed = await deps.claims.confirmed(session.id);
      const graph = buildClaimGraph(confirmed);
      const rootCv = renderRootCv(graph);
      const gate = runGate(
        graph,
        rootCv.trace,
        confirmed.map((c) => c.id),
      );
      const stage = gate.ok ? "ready" : "loopback";
      await deps.sessions.setStage(session.id, stage);
      return { stage, gate, rootCv };
    });
  };
}
