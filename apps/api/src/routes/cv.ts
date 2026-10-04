// The paste intake: the front door's "Paste my CV text" tile (#270) POSTs here, and an
// unparseable upload's failure screen offers the same route. Same job, same pipeline, same
// event stream as an uploaded file. #335 adds a line's tick: untick (→ kept) and re-tick.
//
// There is deliberately NO export, share, download, PDF, or DOCX route for unverified content
// anywhere on this API — a spec §8-3 acceptance criterion enforced server-side
// (see test/preview.test.ts, which asserts against the route table). The old GET /previews/:jobId
// route died with the draft screen it served (#272).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireSession } from "../server.js";
import type { ClaimStore } from "../claims.js";
import type { JobStore } from "../jobs.js";
import { runOnboardingJob, type PipelineDeps } from "../pipeline.js";

export interface CvDeps {
  store: JobStore;
  pipeline: PipelineDeps;
  claims: ClaimStore;
}

export function cvRoutes(deps: CvDeps) {
  return async function plugin(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    app.post(
      "/cv/paste",
      { schema: { body: z.object({ text: z.string().min(100).max(100_000) }) } },
      async (req, reply) => {
        const session = requireSession(req);
        const job = await deps.store.create("onboarding", session.id);
        void runOnboardingJob(
          deps.store,
          job.id,
          { type: "paste", text: req.body.text },
          deps.pipeline,
        );
        reply.status(201);
        return { jobId: job.id };
      },
    );

    // #335 (ADR-0016 clause 5): the person's untick or re-tick. Pre-wall like the review that calls
    // it. The print gate is the store's confirmed() — this only records the tap, so no request can
    // print a kept line, and a kept line is never deleted.
    app.put(
      "/cv/lines/:id",
      {
        schema: {
          params: z.object({ id: z.string() }),
          body: z.object({ state: z.enum(["ticked", "kept"]) }),
        },
      },
      async (req, reply) => {
        const session = requireSession(req);
        if (!(await deps.claims.setLineState(session.id, req.params.id, req.body.state)))
          return reply.status(404).send({ error: { code: "not_found", message: "unknown line" } });
        return { id: req.params.id, state: req.body.state };
      },
    );
  };
}
