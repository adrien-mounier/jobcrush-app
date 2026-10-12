// The paste intake: the front door's "Paste my CV text" tile (#270) POSTs here, and an
// unparseable upload's failure screen offers the same route. Same job, same pipeline, same
// event stream as an uploaded file. #335 adds a line's tick: untick (→ kept) and re-tick. #382
// adds the skills groups' two doors: rename a group, move one skill to another group.
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
import { kindTag } from "../graph.js";
import { groupOf } from "../skillsSplit.js";
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

    const GroupName = z.string().trim().min(1).max(60);
    const Refusal = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
    const notFound = { error: { code: "not_found", message: "unknown group or skill" } };

    // #382 (ADR-0018 clause 6): rename a skills group — every skill of the session in it. A skill
    // stored without a group reads under the fallback name, so it is given that name first and the
    // rename finds it like any other. Renaming onto a name in use merges the two groups.
    app.put(
      "/cv/skills/groups/:name",
      {
        schema: {
          params: z.object({ name: z.string().min(1) }),
          body: z.object({ name: GroupName }),
          response: { 200: z.object({ name: z.string(), moved: z.number().int() }), 404: Refusal },
        },
      },
      async (req, reply) => {
        const session = requireSession(req);
        const skills = (await deps.claims.list(session.id)).filter((c) => kindTag(c) === "skill");
        for (const c of skills) if (c.groupName === null) await deps.claims.setGroup(session.id, c.id, groupOf(c));
        const moved = await deps.claims.renameGroup(session.id, req.params.name, req.body.name);
        if (moved === 0) return reply.status(404).send(notFound);
        return { name: req.body.name, moved };
      },
    );

    // #382: move one skill to another group (an existing one, or a new name). A line that is not a
    // skill has no group to move to.
    app.put(
      "/cv/lines/:id/group",
      {
        schema: {
          params: z.object({ id: z.string() }),
          body: z.object({ group: GroupName }),
          response: { 200: z.object({ id: z.string(), group: z.string() }), 404: Refusal },
        },
      },
      async (req, reply) => {
        const session = requireSession(req);
        const line = (await deps.claims.list(session.id)).find((c) => c.id === req.params.id);
        if (!line || kindTag(line) !== "skill") return reply.status(404).send(notFound);
        await deps.claims.setGroup(session.id, line.id, req.body.group);
        return { id: line.id, group: req.body.group };
      },
    );
  };
}
