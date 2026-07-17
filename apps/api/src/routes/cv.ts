// JC-17 paste fallback + JC-16 preview delivery.
//
// The preview route serves the watermarked HTML for in-app viewing ONLY. There is
// deliberately NO export, share, download, PDF, or DOCX route for unverified content
// anywhere on this API — that is a JC-16 acceptance criterion enforced server-side
// (see test/preview.test.ts, which asserts against the route table).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireSession } from "../server.js";
import type { JobStore } from "../jobs.js";
import { buildRawCv } from "../extract.js";
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
          session.targetTitles,
          deps.pipeline,
        );
        reply.status(201);
        return { jobId: job.id };
      },
    );

    app.get(
      "/previews/:jobId",
      { schema: { params: z.object({ jobId: z.string() }) } },
      async (req, reply) => {
        const session = requireSession(req);
        const job = await deps.store.get(req.params.jobId);
        if (!job || job.sessionId !== session.id)
          return reply.status(404).send({ error: { code: "not_found", message: "unknown preview" } });
        const html = job.progress.previewHtml as string | undefined;
        if (!html)
          return reply.status(404).send({ error: { code: "not_ready", message: "preview not ready" } });
        reply
          .header("content-type", "text/html; charset=utf-8")
          .header("content-disposition", "inline")
          .header("x-robots-tag", "noindex")
          .header("cache-control", "private, no-store");
        return reply.send(html);
      },
    );
  };
}
