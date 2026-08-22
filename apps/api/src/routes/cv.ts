// The paste intake: the front door's "Paste my CV text" tile (#270) POSTs here, and an
// unparseable upload's failure screen offers the same route. Same job, same pipeline, same
// event stream as an uploaded file.
//
// There is deliberately NO export, share, download, PDF, or DOCX route for unverified content
// anywhere on this API — a spec §8-3 acceptance criterion enforced server-side
// (see test/preview.test.ts, which asserts against the route table). The old GET /previews/:jobId
// route died with the draft screen it served (#272).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireSession } from "../server.js";
import type { JobStore } from "../jobs.js";
import { runOnboardingJob, type PipelineDeps } from "../pipeline.js";

export interface CvDeps {
  store: JobStore;
  pipeline: PipelineDeps;
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
  };
}
