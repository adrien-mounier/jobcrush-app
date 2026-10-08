// #338 — "Your CV, reviewed": its own plugin, because routes/onboarding.ts is a ratchet with no
// headroom and the review is its own subsystem (cvReview.ts). Session-authenticated (requireSession,
// not requireUser): the review sits before the jobs and the wall, like discovery and the profile.
// A line's tick/untick is PUT /cv/lines/:id (routes/cv.ts, #335) — the review calls it, it does not
// own it. #341 adds the fix's undo / use-again door and the lock on the confirm while the run goes.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireSession } from "../server.js";
import { SUGGESTION_KINDS } from "../cvReviewStore.js";
import {
  answerReviewEndDate,
  buildReviewState,
  completeReview,
  setReviewFixApplied,
  settleReviewConflict,
  type ReviewDeps,
} from "../cvReview.js";

// Response schemas (CODING_STANDARDS: every route declares one per status) — the wire shape of
// cvReview.ts's ReviewState, so a store record spread into it can never leak an internal field.
const LineState = z.enum(["ticked", "kept"]);
// #341: the AI's marks on a line — a fix (applied, or undone by the person) and an untick suggestion.
const ReviewFix = z.object({ original: z.string(), corrected: z.string(), applied: z.boolean() });
const ReviewSuggestion = z.object({ kind: z.enum(SUGGESTION_KINDS), reason: z.string() });
const ReviewLine = z.object({
  id: z.string(),
  text: z.string(),
  state: LineState,
  fix: ReviewFix.nullable(),
  suggestion: ReviewSuggestion.nullable(),
});
const ReviewJob = z.object({
  id: z.string(),
  blockId: z.string().nullable(),
  title: z.string(),
  employer: z.string(),
  dates: z.object({ start: z.string(), end: z.string().nullable() }).nullable(),
  endDateQuestion: z.string().nullable(),
  checking: z.boolean(),
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
  // #341: the run while it is going; null once finished — or failed, which the person is never told.
  progress: z.object({ done: z.number().int(), total: z.number().int(), minutesLeft: z.number().int() }).nullable(),
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
    // nothing moves — the jobs opened the first time and stay open. Refused (409) while the review
    // run is still going (#341): the screen keeps the confirm locked until then, and this is the gate.
    app.post(
      "/review/complete",
      { schema: { response: { 200: z.object({ completed: z.literal(true) }), 409: Refusal } } },
      async (req, reply) => {
        const session = requireSession(req);
        const result = await completeReview(deps, session);
        if (!result.ok) return reply.status(409).send({ error: { code: result.code, message: result.message } });
        return { completed: true as const };
      },
    );

    // #341: undo a fix (applied: false) — the line reads its exact original again — or use it again
    // (applied: true). The fix is on the run's checkpoints; the text is the line's own.
    app.put(
      "/review/fixes/:lineId",
      {
        schema: {
          params: z.object({ lineId: z.string().min(1) }),
          body: z.object({ applied: z.boolean() }),
          response: { 200: z.object({ id: z.string(), text: z.string(), applied: z.boolean() }), 404: Refusal },
        },
      },
      async (req, reply) => {
        const session = requireSession(req);
        const result = await setReviewFixApplied(deps, session.id, req.params.lineId, req.body.applied);
        if (!result.ok) return reply.status(404).send({ error: { code: result.code, message: result.message } });
        return { id: req.params.lineId, text: result.text, applied: req.body.applied };
      },
    );

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
