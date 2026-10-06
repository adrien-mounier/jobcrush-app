// #338 — "Your CV, reviewed": its own plugin, because routes/onboarding.ts is a ratchet with no
// headroom and the review is its own subsystem (cvReview.ts). Session-authenticated (requireSession,
// not requireUser): the review sits before the jobs and the wall, like discovery and the profile.
// A line's tick/untick is PUT /cv/lines/:id (routes/cv.ts, #335) — the review calls it, it does not
// own it.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireSession } from "../server.js";
import {
  answerReviewEndDate,
  buildReviewState,
  completeReview,
  settleReviewConflict,
  type ReviewDeps,
} from "../cvReview.js";

// Response schemas (CODING_STANDARDS: every route declares one per status) — the wire shape of
// cvReview.ts's ReviewState, so a store record spread into it can never leak an internal field.
const LineState = z.enum(["ticked", "kept"]);
const ReviewLine = z.object({ id: z.string(), text: z.string(), state: LineState });
const ReviewJob = z.object({
  id: z.string(),
  blockId: z.string().nullable(),
  title: z.string(),
  employer: z.string(),
  dates: z.object({ start: z.string(), end: z.string().nullable() }).nullable(),
  endDateQuestion: z.string().nullable(),
  lines: z.array(ReviewLine),
});
const ReviewSection = z.union([
  z.object({ tag: z.literal("experience"), heading: z.string(), jobs: z.array(ReviewJob) }),
  z.object({ tag: z.string(), heading: z.string(), lines: z.array(ReviewLine) }),
]);
const LetterheadField = z.object({ value: z.string(), origin: z.enum(["read", "person-said"]) });
const ReviewStateSchema = z.object({
  completed: z.boolean(),
  letterhead: z.object({ header: z.string().nullable(), phone: LetterheadField.nullable(), email: LetterheadField.nullable() }),
  conflict: z.object({ fieldId: z.string(), question: z.string(), values: z.array(z.string()) }).nullable(),
  sections: z.array(ReviewSection),
});
const Refusal = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const Ok = z.object({ ok: z.literal(true) });

export function reviewRoutes(deps: ReviewDeps) {
  return async function plugin(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    app.get("/review", { schema: { response: { 200: ReviewStateSchema } } }, async (req) =>
      buildReviewState(deps, requireSession(req)),
    );

    // The person reached the end and confirmed. Idempotent: a reopened review confirms again and
    // nothing moves — the jobs opened the first time and stay open.
    app.post("/review/complete", { schema: { response: { 200: z.object({ completed: z.literal(true) }) } } }, async (req) => {
      const session = requireSession(req);
      await completeReview(deps, session);
      return { completed: true as const };
    });

    app.post(
      "/review/conflicts/:fieldId",
      {
        schema: {
          params: z.object({ fieldId: z.string().min(1) }),
          body: z.object({ value: z.string().trim().min(1) }),
          response: { 200: Ok, 400: Refusal, 404: Refusal },
        },
      },
      async (req, reply) => {
        const session = requireSession(req);
        const result = await settleReviewConflict(deps, session, req.params.fieldId, req.body.value);
        if (!result.ok) return reply.status(result.status).send({ error: { code: result.code, message: result.message } });
        return { ok: true as const };
      },
    );

    // "Not sure" has no endpoint on purpose: it stores nothing, so there is nothing to send.
    app.post(
      "/review/jobs/:blockId/end",
      {
        schema: {
          params: z.object({ blockId: z.string().min(1) }),
          body: z.object({ answer: z.string().trim().min(1) }),
          response: { 200: Ok, 400: Refusal, 404: Refusal },
        },
      },
      async (req, reply) => {
        const session = requireSession(req);
        const result = await answerReviewEndDate(deps, session.id, req.params.blockId, req.body.answer);
        if (!result.ok)
          return reply
            .status(result.code === "not_found" ? 404 : 400)
            .send({ error: { code: result.code, message: result.message } });
        return { ok: true as const };
      },
    );
  };
}
