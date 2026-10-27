// #338 — "Your CV, reviewed": its own plugin, because routes/onboarding.ts is a ratchet with no
// headroom and the review is its own subsystem (cvReview.ts). Session-authenticated (requireSession,
// not requireUser): the review sits before the jobs and the wall, like discovery and the profile.
// A line's tick/untick is PUT /cv/lines/:id (routes/cv.ts, #335) — the review calls it, it does not
// own it. #341 adds the fix's undo / use-again door and the lock on the confirm while the run goes.
// #342 adds the drafted line's two doors: its wording before the tick, and the tick itself — the
// one way a draft becomes a fact (the line door refuses a draft). #378 adds the third answer, No
// thanks, with its undo, and the complete's refusal while any suggestion is unanswered.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireSession } from "../server.js";
import { DRAFT_FLAGS, SUGGESTION_KINDS, VAGUE_SOURCES } from "../cvReviewStore.js";
import { answerWorkRights, WORK_RIGHTS_ANSWERS } from "../workRightsCard.js";
import {
  answerEligibilityItem,
  isValidLanguageSelection,
  languageDeclarationPlan,
  LANGUAGE_ITEM_ID,
  MAX_LANGUAGES,
} from "../eligibilityDiscovery.js";
import { declaredLanguages, MAX_LANGUAGE_WORD } from "../languageLevel.js";
import { resolvedMarketsFor } from "../postingRetrieval.js";
import { answerStatus, Refusal, refusal } from "./refusal.js";
import {
  answerReviewEndDate,
  buildReviewState,
  completeReview,
  dismissDraft,
  saveAbout,
  setDraftText,
  setReviewFixApplied,
  settleReviewConflict,
  tickDraft,
  type ReviewDeps,
} from "../cvReview.js";

// Response schemas (CODING_STANDARDS: every route declares one per status) — the wire shape of
// cvReview.ts's ReviewState, so a store record spread into it can never leak an internal field.
// `dismissed` (#378): a draft the person said No thanks to — on the paper, shown nowhere.
// `removal-suggested` (#380): an item the review proposes to remove, unanswered.
const LineState = z.enum(["ticked", "kept", "drafted", "dismissed", "removal-suggested"]);
// #341: the AI's marks on a line — a fix (applied, or undone by the person) and (#380) a removal suggestion.
const ReviewFix = z.object({ original: z.string(), corrected: z.string(), applied: z.boolean() });
const ReviewSuggestion = z.object({ kind: z.enum(SUGGESTION_KINDS), reason: z.string() });
// #342: a drafted line's source and flags. #343: its vague phrases, each with its choices.
const ReviewVague = z.object({
  phrase: z.string(),
  options: z.array(z.object({ text: z.string(), from: z.enum(VAGUE_SOURCES), quote: z.string().nullable() })),
});
const ReviewDraft = z.object({
  mustHave: z.string().nullable(),
  quote: z.string().nullable(),
  source: z.string().nullable(),
  flags: z.array(z.enum(DRAFT_FLAGS)),
  vague: z.array(ReviewVague),
});
const ReviewLine = z.object({
  id: z.string(),
  text: z.string(),
  state: LineState,
  fix: ReviewFix.nullable(),
  suggestion: ReviewSuggestion.nullable(),
  draft: ReviewDraft.nullable(),
  // #371: where the review moved the line from ("your summary").
  movedFrom: z.string().nullable(),
  // #383: present only on a copy — "Taken from <job>" rather than "Moved from <job>".
  copied: z.literal(true).optional(),
});
const ReviewJob = z.object({
  id: z.string(),
  blockId: z.string().nullable(),
  title: z.string(),
  employer: z.string(),
  dates: z.object({ start: z.string(), end: z.string().nullable() }).nullable(),
  endDateQuestion: z.string().nullable(),
  checking: z.boolean(),
  family: z.string().nullable(),
  lines: z.array(ReviewLine),
});
const ReviewSection = z.union([
  z.object({ tag: z.literal("experience"), heading: z.string(), jobs: z.array(ReviewJob) }),
  z.object({
    tag: z.string(),
    heading: z.string(),
    lines: z.array(ReviewLine),
    // #382: the Skills section's named groups, by line id. #394: the fallback group is `unnamed`
    // (the screen hides its heading while the run that names it goes).
    groups: z.array(z.object({ name: z.string(), ids: z.array(z.string()), unnamed: z.literal(true).optional() })).optional(),
  }),
]);
const LetterheadField = z.object({ value: z.string(), origin: z.enum(["read", "person-said"]) });
const ReviewStateSchema = z.object({
  completed: z.boolean(),
  // #381: Your details' fields.
  letterhead: z.object({
    name: LetterheadField.nullable(),
    email: LetterheadField.nullable(),
    phone: LetterheadField.nullable(),
    location: LetterheadField.nullable(),
  }),
  conflict: z.object({ fieldId: z.string(), question: z.string(), values: z.array(z.string()) }).nullable(),
  // #341: the run while it is going; null once finished — or failed, which the person is never told.
  progress: z.object({ done: z.number().int(), total: z.number().int(), minutesLeft: z.number().int() }).nullable(),
  // #362: some part of the CV has no review answer (still going, given up, or no run) — no finished-check claim.
  unchecked: z.boolean(),
  // #371: About you (the person's saved text, else the review's), beside the CV's own summary.
  about: z.object({ text: z.string(), original: z.string().nullable() }).nullable(),
  sections: z.array(ReviewSection),
  // #376: "Where you can work" — one row per target market; the answer is the stored one, the
  // proposal is what the CV implies (shown, never stored).
  workRights: z.array(
    z.object({
      market: z.string(),
      itemId: z.string(),
      answer: z.enum(WORK_RIGHTS_ANSWERS).nullable(),
      proposed: z.literal("eligible").nullable(),
      note: z.string().nullable(),
      source: z.string().nullable(),
    }),
  ),
  // #376: the languages the person said they speak — the Languages screen's card when the CV has none.
  languages: z.array(z.string()),
  // #376: what the languages card completes from — the product's own list; anything else is kept.
  languageOptions: z.array(z.string()),
  // #385: check mode brought back by a re-upload shows only these items; null for the first one.
  newItems: z.array(z.string()).nullable(),
});
const Ok = z.object({ ok: z.literal(true) });

export function reviewRoutes(deps: ReviewDeps) {
  return async function plugin(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    app.get("/review", { schema: { response: { 200: ReviewStateSchema } } }, async (req) =>
      buildReviewState(deps, requireSession(req)),
    );

    // The person reached the end and confirmed. Idempotent: a reopened review confirms again and
    // nothing moves — the jobs opened the first time and stay open. Refused (409) while the review
    // run is still going (#341) or a suggestion is unanswered (#378): the screen keeps the finish
    // locked until then, and this is the gate.
    app.post(
      "/review/complete",
      { schema: { response: { 200: z.object({ completed: z.literal(true) }), 409: Refusal } } },
      async (req, reply) => {
        const session = requireSession(req);
        const result = await completeReview(deps, session);
        if (!result.ok) return reply.status(409).send(refusal(result));
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
        if (!result.ok) return reply.status(404).send(refusal(result));
        return { id: req.params.lineId, text: result.text, applied: req.body.applied };
      },
    );

    // #342: the person's own wording for a draft they have not ticked yet. Only an unticked draft
    // answers here (404 otherwise): a line read from the CV is not edited on the review.
    app.put(
      "/review/drafts/:lineId",
      {
        schema: {
          params: z.object({ lineId: z.string().min(1) }),
          body: z.object({ text: z.string().trim().min(1).max(600) }),
          response: { 200: z.object({ id: z.string(), text: z.string() }), 404: Refusal },
        },
      },
      async (req, reply) => {
        const session = requireSession(req);
        const result = await setDraftText(deps, session.id, req.params.lineId, req.body.text);
        if (!result.ok) return reply.status(404).send(refusal(result));
        return { id: req.params.lineId, text: result.text };
      },
    );

    // #342: the tick — the draft becomes a confirmed, ticked, user-resolved fact (origin: drafted,
    // then accepted). The only door out of `drafted`; unticking afterwards is PUT /cv/lines/:id.
    app.post(
      "/review/drafts/:lineId/tick",
      {
        schema: {
          params: z.object({ lineId: z.string().min(1) }),
          response: { 200: z.object({ id: z.string(), text: z.string(), state: z.literal("ticked") }), 404: Refusal },
        },
      },
      async (req, reply) => {
        const session = requireSession(req);
        const result = await tickDraft(deps, session.id, req.params.lineId);
        if (!result.ok) return reply.status(404).send(refusal(result));
        return { id: req.params.lineId, text: result.text, state: "ticked" as const };
      },
    );

    // #371: check mode's About you footer — keep (the text unchanged) or save the person's words.
    app.put(
      "/review/about",
      {
        schema: {
          body: z.object({ text: z.string().trim().min(1).max(2000) }),
          response: { 200: z.object({ text: z.string() }) },
        },
      },
      async (req) => saveAbout(deps, requireSession(req).id, req.body.text),
    );

    // #378: No thanks (dismissed: true) — the draft is held, never proposed again, printed nowhere —
    // or its undo (dismissed: false), which puts the draft back unanswered. Only a draft in the
    // state the move leaves answers here (404 otherwise).
    app.put(
      "/review/drafts/:lineId/dismissed",
      {
        schema: {
          params: z.object({ lineId: z.string().min(1) }),
          body: z.object({ dismissed: z.boolean() }),
          response: { 200: z.object({ id: z.string(), state: z.enum(["drafted", "dismissed"]) }), 404: Refusal },
        },
      },
      async (req, reply) => {
        const session = requireSession(req);
        const result = await dismissDraft(deps, session.id, req.params.lineId, req.body.dismissed);
        if (!result.ok) return reply.status(404).send(refusal(result));
        return { id: req.params.lineId, state: result.state };
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
        if (!result.ok) return reply.status(result.status).send(refusal(result));
        return { ok: true as const };
      },
    );

    // #376: a tap on a "Where you can work" row — this session's own markets only (404 otherwise),
    // in the store's own two words. The write is the eligibility answer route's own.
    app.put(
      "/review/work-rights/:itemId",
      {
        schema: {
          params: z.object({ itemId: z.string().min(1) }),
          body: z.object({ answer: z.enum(WORK_RIGHTS_ANSWERS) }),
          response: { 200: Ok, 400: Refusal, 404: Refusal },
        },
      },
      async (req, reply) => {
        const session = requireSession(req);
        const result = await answerWorkRights(deps.eligibility, session.id, session.intent.searchAreas, req.params.itemId, req.body.answer);
        if (!result.ok) return reply.status(answerStatus(result)).send(refusal(result));
        return { ok: true as const };
      },
    );

    // #376: the Languages screen's card — the languages the person speaks, as a whole list. The write
    // is the languages question's own (a dropped language goes back to unknown, never to a "no").
    app.put(
      "/review/languages",
      {
        schema: {
          // Capped at the door like the languages question's own check (isValidLanguageSelection).
          body: z.object({ languages: z.array(z.string().max(MAX_LANGUAGE_WORD)).max(MAX_LANGUAGES) }),
          response: { 200: Ok, 400: Refusal, 404: Refusal },
        },
      },
      async (req, reply) => {
        const session = requireSession(req);
        const markets = resolvedMarketsFor(session.intent.searchAreas);
        const result = await answerEligibilityItem({ eligibility: deps.eligibility }, session.id, markets, LANGUAGE_ITEM_ID, {
          answers: req.body.languages,
        });
        if (!result.ok) return reply.status(answerStatus(result)).send(refusal(result));
        return { ok: true as const };
      },
    );

    // #425: the deck's "I speak it" — ONE language added to the list, never a whole list replaced
    // (the deck does not hold the list). The same declaration plan as above, so a language already
    // declared or placed on the ladder is left as it is, and a pre-#165 "none" is overwritten. The
    // whole list it would make passes the languages question's own check (a store key, and a cap).
    app.post(
      "/review/languages/spoken",
      {
        schema: {
          body: z.object({ language: z.string().trim().min(1).max(MAX_LANGUAGE_WORD) }),
          response: { 200: Ok, 400: Refusal },
        },
      },
      async (req, reply) => {
        const session = requireSession(req);
        const stored = await deps.eligibility.list(session.id);
        if (!isValidLanguageSelection([...new Set([...declaredLanguages(stored), req.body.language])]))
          return reply.status(400).send(refusal({ code: "invalid_answer", message: "unrecognized language" }));
        const { put } = languageDeclarationPlan([req.body.language], stored);
        for (const write of put) await deps.eligibility.put(session.id, { dimension: "language", ...write });
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
            .send(refusal(result));
        return { ok: true as const };
      },
    );
  };
}
