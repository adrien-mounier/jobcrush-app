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
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { CandidateClaim, MinedRole, AdRequirementsV1 } from "@jobcrush/contracts";
import { requireUser, requireSession } from "../server.js";
import type { ClaimStore } from "../claims.js";
import { minedRoles, type JobStore } from "../jobs.js";
import { withFactFloor } from "../sessions.js";
import type { SessionStore, SessionRecord } from "../sessions.js";
import { buildClaimGraph } from "../graph.js";
import { renderRootCv } from "../rootcv.js";
import { buildProfileState, resolveProfileLocation, resolveLanguagesQuestion } from "../profile.js";
import { runGate } from "../gate.js";
import { answeredGrillIds, answerToClaim, detectGaps, templateQuestion, type GrillPhraser } from "../grill.js";
import { auditRootCv, type CvAuditor } from "../audit.js";
import { eligiblePostings, sessionPostings, type Posting } from "../preview.js";
import { ANY_FAMILY, type EligibilityStore } from "../eligibility.js";
import {
  answerEligibilityItem,
  excludingEligibility,
  isEligibilityItemId,
} from "../eligibilityDiscovery.js";
import {
  answerQuestionOne,
  buildDiscoveryRouteState,
  currentDiscoveryFamily,
  discoveryReads,
  prependReaderQuestionFromJob,
  productionDiscoveryFamilyLookup,
  reconcileSessionDiscovery,
} from "../discoveryEngine.js";
import { answerJobDateHole, isJobDateItemId } from "../yearsWorked.js";
import { readingLanguages, languageEligible } from "../language.js";
import type { JudgeFn, JudgePeekFn } from "../judge.js";
import {
  buildDeckResponse,
  claimTier,
  resolveAdRequirements,
} from "../deck.js";
import { applyFallbackChoice } from "../deckFallback.js";
import type { BroughtJobsFn } from "../broughtJobs.js";
import { makeRetrievalCoordinator } from "../deckRetrieval.js";
import { runLabelerRetry } from "../jobBlockPlacementRetry.js";
import { findWithdrawingRequirement } from "../withdrawal.js";
import {
  composeCvLine,
  discoveryClaimId,
  factCount,
  freeTextLine,
  isNoAnswer,
  recordDiscoveryAnswer,
  READER_ROLE_ITEM_ID,
} from "../discovery.js";
import { FamilyPlacement } from "@jobcrush/contracts";
import {
  fixtureDiscoveryClaimId,
  fixtureDiscoveryState,
  soleConfirmedFamily,
} from "../adaptiveDiscovery.js";
import type { ProductionFamilyFloorStore, TestFixtureFamilyFloorStore } from "../familyFloors.js";
import {
  resolvedMarketsFor,
  retrievalRequestForSession,
  retrievalFingerprint,
  unavailablePostingRetrieval,
  type RetrievalRequest,
} from "../postingRetrieval.js";
import type { PostingRetrievalResultV1 } from "@jobcrush/contracts";

export interface OnboardingDeps {
  claims: ClaimStore;
  store: JobStore;
  sessions: SessionStore;
  /** #106: the eligibility-fact store (#86 decisions 4+5, apps/api/src/eligibility.ts) — asked once in
   *  discovery, reused across every posting. */
  eligibility: EligibilityStore;
  /** #162: the dated job records years-of-experience is worked out from (yearsWorked.ts) — the
   *  source of both the total and the date-hole questions asked in its place. */
  jobBlocks: import("../jobBlockStore.js").JobBlockStore;
  contact: import("../contact.js").ContactStore; // #190: GET /profile reads it, additively.
  familyFloors: TestFixtureFamilyFloorStore;
  productionFamilyFloors: ProductionFamilyFloorStore;
  placeFamily: (session: Readonly<SessionRecord>) => Promise<FamilyPlacement>;
  retrievePostings?: (input: RetrievalRequest) => Promise<PostingRetrievalResultV1>;
  /** #236: fire-and-forget judgement of the word-search visitor's target role (makeFamilyCandidateWatch
   *  in familyCandidateIntake.ts). Never awaited, never visible; absent → nothing is screened. */
  watchFamilyCandidate?: (session: Readonly<SessionRecord>) => void;
  retryJobBlockLabels?: (sessionId: string) => Promise<void>;
  /** #305: the adverts THIS person pasted, stitched into the deck on every rebuild and resolvable as a
   *  want/tailor target — a pasted job has no provider to re-ask (broughtJobs.ts). Absent → no pasted
   *  advert is stitched anywhere, exactly the behaviour every pre-#305 test asserts. */
  broughtJobs?: BroughtJobsFn;
  /** JC-24: LLM phrasing for grill questions. Absent → template phrasing (tests + the safe fallback). */
  phraseGrill?: GrillPhraser;
  /** S2 decision #6: LLM wording audit of the built root CV. Absent → the CV ships unaudited. */
  auditCv?: CvAuditor;
  /** #104: reads an advert nobody hand-curated. Absent → today's fixture-only behaviour (every
   *  pre-#104 test stays valid; no route here ever makes a live call unless main.ts wires this). */
  readAd?: (posting: Posting) => Promise<AdRequirementsV1 | null>;
  /** #105: meaning-aware judging of this session's confirmed/negative facts against one ad's
   *  requirements — the persisted-cache-wrapped function judge.ts's makeJudge returns. Absent →
   *  today's deterministic tick (matchTick/uncoveredRequirements), unchanged: every pre-#105 test
   *  stays valid, and no route here ever makes a live judging call unless main.ts wires this. */
  judge?: JudgeFn;
  /** #117 must-fix 1: a CACHE-ONLY companion to `judge` — judge.ts's makeJudgePeek, structurally
   *  incapable of spending (it never receives an LlmClient). The deck route calls this for EVERY
   *  eligible card BEFORE deciding which still-unresolved ones are worth a fresh paid judging
   *  attempt, so a stored judgement (an earlier visit, a tailored ad, another visitor's
   *  byte-identical facts) costs nothing to read and never competes for DECK_JUDGE_MAX_CARDS's
   *  bound. Absent → every card is treated as "not yet resolved for free", identical to the deck's
   *  behaviour before this phase existed (every pre-#117-must-fix-1 test stays valid). */
  judgePeek?: JudgePeekFn;
  /** #117 (coordinator review) — an override for DECK_JUDGE_MAX_CARDS. Exists so a test can
   *  construct a "candidate pool exceeds the paid-judging ceiling" scenario against the REAL posting
   *  pool (data/sample-postings.json IS the live job pool, not a fixture — synthetic entries there
   *  would show fabricated listings to real visitors) rather than by inflating product data to fit a
   *  test. Absent → DECK_JUDGE_MAX_CARDS, exactly as today; main.ts never sets this, so production
   *  behaviour is unaffected. Also usable to tune the ceiling per deployment without a code change,
   *  should the owner want that later. */
  judgeMaxCards?: number;
}

// #103 (E5 slice 2): the pool-application half of the gate (eligiblePostings) lives beside
// loadPostings in preview.ts, not here — #103 code review finding 6, so slice 3's reader can reuse
// it without importing a routes module. Every route below composes readingLanguages(session) with
// eligiblePostings, and — for a card's requirement set — languageEligible(adReq.language, ...)
// directly (#103 code review finding 5): no other "=== 'en'" check exists anywhere in this file.

export function onboardingRoutes(deps: OnboardingDeps) {
  const retrievePostings = deps.retrievePostings ?? unavailablePostingRetrieval;
  return async function plugin(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    // The claim/lease/coalescing protocol lives in deckRetrieval.ts; the route only asks "what may
    // THIS response say about postings?" — one coordinator per server instance (it owns the
    // same-process coalescing map).
    const retrievalCoordinator = makeRetrievalCoordinator({
      sessions: deps.sessions,
      retrievePostings,
      log: app.log,
    });
    // Two reads of the same plan. `currentFamily` touches nothing - it is what the deck, the job
    // card and the tailor use, because #235's rule is that nothing re-derives a plan while she is
    // browsing. `reconciledFamily` is the interview's own read: #216, it also pins the plan and
    // writes the coverage her answers have earned. The three discovery routes below are the only
    // place a visitor's own ANSWERS move her discovery record - discoveryEngine.ts's header names
    // the two other writers and the different facts they own.
    const currentFamily = (session: SessionRecord) => currentDiscoveryFamily(session, deps);
    const reconciledFamily = (session: SessionRecord) => reconcileSessionDiscovery(session, deps);

    // #59's fixture seam — the policy lives in adaptiveDiscovery.ts (fixtureDiscoveryState); this
    // only turns its refusal into a reply.
    const fixtureState = async (sessionId: string, placement: FamilyPlacement, reply: FastifyReply) => {
      const state = await fixtureDiscoveryState(sessionId, placement, deps.familyFloors, deps.claims);
      return "status" in state ? reply.status(state.status).send(state.body) : state;
    };

    app.post(
      "/onboarding/discovery/fixture/evaluate",
      { schema: { body: z.object({ placement: FamilyPlacement }) } },
      async (req, reply) => {
        const session = requireSession(req);
        return fixtureState(session.id, req.body.placement, reply);
      },
    );

    app.post(
      "/onboarding/discovery/fixture/answer",
      {
        schema: {
          body: z.object({
            placement: FamilyPlacement,
            itemId: z.string().min(1),
            answer: z.string().trim().min(1),
          }),
        },
      },
      async (req, reply) => {
        const session = requireSession(req);
        const reference = soleConfirmedFamily(req.body.placement);
        if (!reference) return fixtureState(session.id, req.body.placement, reply);
        const floor = deps.familyFloors.get(reference.familyId, reference.version);
        const item = floor?.essentialItems.find((candidate) => candidate.id === req.body.itemId);
        if (!floor || !item) {
          return reply.status(404).send({
            error: { code: "fixture_item_not_found", message: "selected fixture item not found" },
            rewardEligible: false,
          });
        }
        const claim: CandidateClaim = {
          id: fixtureDiscoveryClaimId(floor.familyId, floor.version, item.id),
          semantic_key: item.id,
          field_key: null,
          field_value: null,
          field_label: null,
          role: "profile",
          text: req.body.answer,
          machine_touch: "verbatim",
          classification: "Verified",
          source_quote: req.body.answer.slice(0, 200),
          needs_grill: false,
          grill_hint: null,
        };
        await recordDiscoveryAnswer(deps.claims, session.id, claim, req.body.answer);
        return fixtureState(session.id, req.body.placement, reply);
      },
    );

    // Open the deck: seed this session's claim store from its onboarding job's mined claims, once.
    // The client holds the jobId from the paste/upload response; the job proves the mine finished.
    app.post(
      "/onboarding/deck",
      { schema: { body: z.object({ jobId: z.string() }) } },
      async (req, reply) => {
        const session = requireUser(req);
        const job = await deps.store.get(req.body.jobId);
        if (!job || job.sessionId !== session.id)
          return reply.status(404).send({ error: { code: "not_found", message: "unknown job" } });

        // #36: seed whenever mined claims are available — NOT only when the store is empty. Discovery
        // answers land in this same store, before the wall, so "empty" almost never holds by the time a
        // real visitor reaches the deck; gating on it meant the miner's claims were silently never
        // seeded. seed() is already idempotent on both drivers (ON CONFLICT DO NOTHING / Map guard), so
        // re-running this is safe and never clobbers an existing decision — including a discovery one.
        const mined = (job.progress.miner as { claims?: CandidateClaim[] } | undefined)?.claims;
        if (mined?.length) {
          await deps.claims.seed(session.id, mined);
        } else if ((await deps.claims.list(session.id)).length === 0) {
          return reply
            .status(409)
            .send({ error: { code: "not_ready", message: "claims not mined yet" } });
        }
        // #28: `seq` is an internal ordering ordinal, not payload — on Postgres it's a table-global
        // bigserial, so leaking it would disclose the delta in OTHER sessions' write volume between
        // two of a visitor's own requests. Strip it before it reaches the wire (prior art: server.ts's
        // job-progress redaction, sessions.ts's token redaction).
        const claims = (await deps.claims.list(session.id)).map((c) => {
          const { seq: _seq, decisionSeq: _decisionSeq, ...safe } = c;
          return { ...safe, tier: claimTier(c.machine_touch) };
        });
        return { stage: session.stage, claims };
      },
    );

    app.post(
      "/onboarding/claims/:id/confirm",
      { schema: { params: z.object({ id: z.string() }) } },
      async (req) => {
        const session = requireUser(req);
        await deps.claims.confirm(session.id, req.params.id);
        return { ok: true };
      },
    );

    app.post(
      "/onboarding/claims/:id/reject",
      { schema: { params: z.object({ id: z.string() }) } },
      async (req) => {
        const session = requireUser(req);
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
        const session = requireUser(req);
        await deps.claims.edit(session.id, req.params.id, req.body.text);
        return { ok: true };
      },
    );

    // Grill (JC-24): detect gaps in the confirmed set and return ~5 short questions to fill them.
    // Deterministic detection; LLM only phrases, with a template fallback so it never hard-fails.
    app.post(
      "/onboarding/grill",
      { schema: { body: z.object({ jobId: z.string() }) } },
      async (req, reply) => {
        const session = requireUser(req);
        const job = await deps.store.get(req.body.jobId);
        if (!job || job.sessionId !== session.id)
          return reply.status(404).send({ error: { code: "not_found", message: "unknown job" } });

        const confirmed = await deps.claims.confirmed(session.id);
        const answered = await answeredGrillIds(deps.claims, session.id, confirmed);
        const gaps = detectGaps(confirmed, minedRoles(job), { answered });
        await deps.sessions.setStage(session.id, "grill");
        if (gaps.length === 0) return { stage: "grill", questions: [] };

        let phrased: string[];
        try {
          phrased = deps.phraseGrill ? await deps.phraseGrill(gaps) : gaps.map(templateQuestion);
          if (phrased.length !== gaps.length) phrased = gaps.map(templateQuestion);
        } catch {
          phrased = gaps.map(templateQuestion); // the model is never allowed to take the grill down
        }
        return {
          stage: "grill",
          questions: gaps.map((g, i) => ({ gapId: g.id, type: g.type, question: phrased[i] })),
        };
      },
    );

    // A grill answer → a confirmed, user-authored claim. Skipping is just not answering (no endpoint).
    app.post(
      "/onboarding/grill/answer",
      { schema: { body: z.object({ jobId: z.string(), gapId: z.string(), answer: z.string().trim().min(1) }) } },
      async (req, reply) => {
        const session = requireUser(req);
        const job = await deps.store.get(req.body.jobId);
        if (!job || job.sessionId !== session.id)
          return reply.status(404).send({ error: { code: "not_found", message: "unknown job" } });

        // Re-detect (deterministic) to resolve the gap → the claim context to compose. Answering one
        // gap never removes another, so every open gapId stays resolvable across answers.
        const confirmed = await deps.claims.confirmed(session.id);
        const answered = await answeredGrillIds(deps.claims, session.id, confirmed);
        const gap = detectGaps(confirmed, minedRoles(job), { answered }).find(
          (g) => g.id === req.body.gapId,
        );
        if (!gap)
          return reply.status(404).send({ error: { code: "unknown_gap", message: "no such open gap" } });
        await deps.claims.add(session.id, answerToClaim(gap, req.body.answer));
        return { ok: true };
      },
    );

    // Build: the confirmed claims → graph → root CV → audit → gate. On a clean gate the session
    // flips to `ready`; a failing gate returns the errors (each names a node) and `loopback`.
    app.post("/onboarding/build", async (req) => {
      const session = requireUser(req);
      const confirmed = await deps.claims.confirmed(session.id);
      // #18 wiring note (carried from #13): thread persisted "no"s into the graph so a discovery "no"
      // becomes a Negative/renderable:false node — preserved in the graph, but absent from the root
      // CV and stripped from the profile screen (#20). Existing sessions have no negatives, so this is
      // a no-op for them.
      const negatives = await deps.claims.negatives(session.id);
      const graph = buildClaimGraph(confirmed, { negatives });
      let rootCv = renderRootCv(graph);
      // The audit (decision #6) polishes mined wording before the gate certifies. User-authored
      // claims are the user's own words — never audited. auditRootCv never throws: any failure
      // returns the unaudited CV, and nodeIds are untouched so the gate below still holds.
      if (deps.auditCv && confirmed.length > 0) {
        const userAuthored = new Set(confirmed.filter((c) => c.origin === "user-authored").map((c) => c.id));
        rootCv = await auditRootCv(rootCv, deps.auditCv, userAuthored);
      }
      // An empty confirmed set builds a structurally-valid but empty graph — the validator passes it,
      // yet a verified CV with nothing in it isn't "ready". Loop back to keep at least one fact
      // (a precise, non-dead-end loop-back, kickoff decision 5), never certify an empty CV. This is
      // deck policy, so it lives here — the validator stays structure-only (see lessons.md).
      const gate =
        confirmed.length === 0
          ? { ok: false, errors: ["Keep at least one fact — a verified CV can't be empty."] }
          : runGate(graph, rootCv.trace, confirmed.map((c) => c.id));
      const stage = gate.ok ? "ready" : "loopback";
      await deps.sessions.setStage(session.id, stage);
      return { stage, gate, rootCv };
    });

    // --- #20 the profile screen: session-authenticated, reachable pre-wall (requireSession, not
    // requireUser). Assembly + colour law live in profile.ts (#179 search, #190 contact block).
    app.get("/profile", async (req) => {
      const session = requireSession(req);
      const facts = (await deps.claims.list(session.id)).filter(
        (c) => c.decision !== "rejected" && c.decision !== "negative",
      );
      const confirmed = facts.filter((c) => c.decision === "confirmed");
      const negatives = await deps.claims.negatives(session.id);
      // #106 code-review D1 (2026-08-03, round 3): a decline is a refusal, not a recorded fact.
      const profileFactCount = await withFactFloor(
        deps.sessions,
        session,
        factCount(excludingEligibility(confirmed), excludingEligibility(negatives)),
      );
      return buildProfileState(facts, profileFactCount, session.targetTitles[0] ?? null, await deps.contact.getRecord(session.id), await resolveProfileLocation(deps.eligibility, session.id, session.intent.searchAreas), await resolveLanguagesQuestion(deps.eligibility, session.id));
    });

    // --- #16 discovery (screen 1a): the answer→CV-line→section-bar loop -------------------------
    // Pre-wall, so it rides the ANONYMOUS session (requireSession, not requireUser): the account ask
    // is after the reveal (spec §12), and answers persist server-side from question 1 (story #76).
    // The whole screen is a pure function of the session's role (Q1) + its recorded discovery answers,
    // so every response is `discoveryState(...)` and GET resumes with no client state.

    // #106: eligibility questions are layered onto discoveryState()'s pure floor-only output by
    // eligibilityDiscovery.ts's applyEligibilityQuestions — see its own doc for the band-interleaving
    // rule and the funnel regression that produced it.

    // Load / resume: rebuild the state from the store. Before Q1 (no role) → the empty skeleton state.
    // #18 AC6: an optional ?job= prepends the ONE reader-only question — over the uploaded CV's mined
    // roles — as long as it's this session's job, it has mined roles, and it isn't answered yet (never
    // re-ask). A missing/foreign/role-less job just omits it; this route never errors on a bad ?job=.
    app.get(
      "/onboarding/discovery",
      { schema: { querystring: z.object({ job: z.string().optional() }) } },
      async (req) => {
        // #322: a role the front door already took is question 1 answered — never asked twice.
        const opened = requireSession(req);
        const handedRole = opened.targetTitles.length === 0 ? opened.intent.targetRole : null;
        const handed = handedRole ? await answerQuestionOne(opened, handedRole, deps, retrievalCoordinator) : null;
        const session = handed?.session ?? opened;
        const role = session.targetTitles[0] ?? null;
        const reads = await discoveryReads(deps, session.id);
        const [confirmed, negatives, rejected] = reads;
        const family = handed ? handed.family : role ? await reconciledFamily(session) : null;
        const state = buildDiscoveryRouteState(role, reads, session, family);
        // #35/#324: a deck-rejected, skipped or "no" reader-role claim still closes the question — same
        // never-re-ask rule discoveryState applies internally; this check is separate (the reader
        // question isn't a floor item) so it needs its own look at `rejected` and `negatives`.
        await prependReaderQuestionFromJob(state, req.query.job, deps.store, session, confirmed, [...rejected, ...negatives]);
        state.factCount = await withFactFloor(deps.sessions, session, state.factCount);
        return state;
      },
    );

    // Q1 typing lookup: the "same kind of job" family + kin titles. A no-match is placed in silence
    // (story #16) — never a "not found"; an empty query just returns no suggestions.
    app.get(
      "/onboarding/discovery/family",
      { schema: { querystring: z.object({ q: z.string() }) } },
      async (req) => {
        requireSession(req);
        return productionDiscoveryFamilyLookup(deps.productionFamilyFloors, req.query.q);
      },
    );

    // Q1 submit: place the family, keep the role as the session's target title (persists the role for
    // resume), and return the seeded state (floor questions + the promise carrying the city).
    app.post(
      "/onboarding/discovery/start",
      { schema: { body: z.object({ role: z.string().trim().min(1) }) } },
      async (req) => {
        const session = requireSession(req);
        const searched = await answerQuestionOne(session, req.body.role, deps, retrievalCoordinator);
        const state = buildDiscoveryRouteState(req.body.role, await discoveryReads(deps, session.id), searched.session, searched.family);
        state.factCount = await withFactFloor(deps.sessions, session, state.factCount);
        return state;
      },
    );

    // Answer a floor item → a confirmed claim carrying its composed CV line (or, for a bare "no", a
    // negative via #13's answerNegative — it closes the item but adds no CV line). Returns the updated
    // state so the client types the new line + advances the bar/countdown from one response.
    //
    // #18 AC4: IDEMPOTENT — re-answering an already-answered item CORRECTS it (a mistapped fact or an
    // accidental "no"). No 409 guard: add()/answerNegative() upsert (ON CONFLICT DO UPDATE / Map.set),
    // so a positive<->negative flip is automatic, whichever way the correction goes.
    app.post(
      "/onboarding/discovery/answer",
      {
        schema: {
          body: z.object({
            itemId: z.string(),
            // #123: `answers` is new (the languages question's multi-select real answer) — every
            // existing single-answer caller (floor items, the reader-only question, every other
            // eligibility question, and every question's OWN decline) is unchanged and keeps sending
            // `answer` alone. Exactly one of the two must be present — checked below, not by the
            // schema, so the failure reuses this route's own `invalid_answer` error shape rather than
            // a generic schema-validation one.
            answer: z.string().trim().min(1).optional(),
            answers: z.array(z.string()).optional(),
          }),
        },
      },
      async (req, reply) => {
        const session = requireSession(req);
        const role = session.targetTitles[0] ?? null;
        if (!role)
          return reply.status(409).send({ error: { code: "no_role", message: "answer question 1 first" } });
        const hasAnswer = req.body.answer !== undefined;
        const hasAnswers = req.body.answers !== undefined;
        if (hasAnswer === hasAnswers) {
          return reply.status(400).send({
            error: { code: "invalid_answer", message: "exactly one of answer or answers is required" },
          });
        }

        if (isEligibilityItemId(req.body.itemId)) {
          // #162 (architecture pass): the whole eligibility write path now lives beside the module
          // that builds the questions (eligibilityDiscovery.ts's answerEligibilityItem) — see its own
          // doc for the never-a-claim rule and the decline/multi-select shapes.
          const result = await answerEligibilityItem(
            { eligibility: deps.eligibility, claims: deps.claims },
            session.id,
            resolvedMarketsFor(session.intent.searchAreas),
            req.body.itemId,
            req.body,
          );
          if (!result.ok)
            return reply.status(result.status).send({ error: { code: result.code, message: result.message } });
        } else if (isJobDateItemId(req.body.itemId)) {
          // #162 / ADR-0008 clause 3: the missing part underneath a worked-out total. The answer
          // corrects the job record itself (yearsWorked.ts owns parsing, the correction and the
          // recompute) — it is never stored as a claim, and never as a years total.
          const result = await answerJobDateHole(
            deps.jobBlocks,
            deps.eligibility,
            session.id,
            req.body.itemId,
            req.body.answer,
          );
          if (!result.ok)
            return reply
              .status(result.code === "not_found" ? 404 : 400)
              .send({ error: { code: result.code, message: result.message } });
        } else {
          // A floor item / the reader-only question predates `answers` entirely (#123) — neither ever
          // accepts a multi-select shape, so this is the same single-`answer` flow as before.
          const answer = req.body.answer;
          if (answer === undefined) {
            return reply
              .status(400)
              .send({ error: { code: "invalid_answer", message: "this item requires a single answer" } });
          }
          let claim: CandidateClaim;
          if (req.body.itemId === READER_ROLE_ITEM_ID) {
            // #18 AC6: the reader-only question has no floor item — the free-text answer IS the CV line.
            claim = {
              id: discoveryClaimId(req.body.itemId),
              semantic_key: discoveryClaimId(req.body.itemId),
              field_key: null,
              field_value: null,
              field_label: null,
              role: "profile",
              text: freeTextLine(answer),
              machine_touch: "verbatim",
              classification: "Verified",
              source_quote: answer.slice(0, 200),
              needs_grill: false,
              grill_hint: null,
            };
          } else {
            const family = await currentFamily(session);
            const item = family?.items.find((i) => i.id === req.body.itemId);
            if (!item)
              return reply.status(404).send({ error: { code: "unknown_item", message: "no such floor item" } });

            claim = {
              id: discoveryClaimId(item.id),
              semantic_key: item.id,
              field_key: null,
              field_value: null,
              field_label: null,
              role: "profile",
              text: isNoAnswer(answer) ? `Not applicable — ${item.question}` : composeCvLine(item, answer),
              machine_touch: "verbatim", // the visitor's own answer
              classification: "Verified", // user-authored, they vouch for it
              source_quote: answer.slice(0, 200),
              needs_grill: false,
              grill_hint: null,
            };
          }
          await recordDiscoveryAnswer(deps.claims, session.id, claim, answer);
        }

        const reads = await discoveryReads(deps, session.id);
        // #216: the closing read is the reconciling one, whichever branch above ran — the answer
        // just recorded is what moves coverage, so the session's checkpoint is rewritten from it
        // before this response leaves. placeFamily is cached per session+role (familyLabeler.ts),
        // so the second derivation on the floor-item branch costs nothing.
        const routeFamily = await reconciledFamily(session);
        const state = buildDiscoveryRouteState(role, reads, session, routeFamily);
        // #18 AC1 / #106: the essential band fully asked AND every eligibility question closed flips
        // the session to the deck stage, so a reload lands there too. Code-review must-fix 2: the
        // full set of remaining floor + eligibility items is visible from the very first response
        // (never gated on the essential band), so the combined countdown only ever counts down as
        // items are answered — it can no longer jump back up the way withholding eligibility until
        // essentialRemaining hit 0 once did.
        if (state.stage === "deck") await deps.sessions.setStage(session.id, "deck");
        state.factCount = await withFactFloor(deps.sessions, session, state.factCount);
        return state;
      },
    );

    // --- #19 the reveal + the job card (screen 2a): score-sorted card deck ----------------------
    // #305 lowered the ratchet by paying for its own lines: the whole payload — retrieval, the years
    // scope, the cards pass, the empty deck's copy rule and the fallback offer — moved to deck.ts
    // (buildDeckResponse), beside the card-shaping policy it composes. The spine calls it.
    app.get("/onboarding/cards", async (req) => {
      const session = requireSession(req);
      deps.watchFamilyCandidate?.(session); // #236 — background, never awaited, never user-visible.
      await runLabelerRetry(deps.retryJobBlockLabels, session.id, fastify.log);
      const reads = await discoveryReads(deps, session.id);
      return buildDeckResponse(session, reads, {
        ...deps,
        ensureRetrieval: retrievalCoordinator.ensureRetrieval,
        currentFamily,
      });
    });

    // #228: her answer to that offer. No provider call here — accepting only records the choice, and
    // the next deck read pays for the one extra search it implies (deckFallback.ts).
    app.post(
      "/onboarding/cards/fallback",
      { schema: { body: z.object({ accepted: z.boolean() }) } },
      async (req) => {
        const session = requireSession(req);
        await runLabelerRetry(deps.retryJobBlockLabels, session.id, fastify.log);
        const blocks = await deps.jobBlocks.list(session.id);
        return {
          fallback: await applyFallbackChoice(
            deps.sessions,
            session,
            req.body.accepted,
            blocks,
            deps.productionFamilyFloors,
          ),
        };
      },
    );

    app.post(
      "/onboarding/cards/:adId/want",
      { schema: { params: z.object({ adId: z.string() }) } },
      async (req, reply) => {
        const session = requireUser(req);
        // #103: an ad this session's languages can't read isn't a valid want target either, even if
        // guessed directly by id — same dual gate (posting AND requirement-set language) as the deck.
        const langs = readingLanguages(session);
        const [confirmed, negatives, , facts] = await discoveryReads(deps, session.id);
        const fingerprint = retrievalFingerprint(retrievalRequestForSession(session, confirmed, negatives));
        // #305: a job he brought is in no snapshot — it is stitched in from storage (broughtJobs.ts).
        const brought = (await deps.broughtJobs?.(session.id)) ?? [];
        const pool = sessionPostings(session, fingerprint, brought);
        const posting = eligiblePostings(langs, pool).find((p) => p.id === req.params.adId);
        const adReq = posting ? await resolveAdRequirements(posting.id, deps.readAd, posting) : null;
        // T3 (code review): guard on `posting`/`adReq` themselves, not a derived boolean, so TS
        // narrows both to non-null below without a `!` assertion — a later edit to this guard is then
        // a compile error if it stops guaranteeing that, not a runtime one. (#182: `posting` joined
        // the guard so its `.location` below is typed non-null, not just `adReq`'s.)
        if (!posting || !adReq || !languageEligible(adReq.language, langs))
          return reply.status(404).send({ error: { code: "not_found", message: "unknown card" } });
        // #107 (D4): a withdrawn ad is not a valid want target either — same 404 shape as an unknown
        // card, so a session can never distinguish "never existed" from "genuinely can't take it".
        // #305: `brought` is passed because a job he brought is never withdrawn (#294 c1) — the rule
        // lives in the predicate, so this door cannot hold a different opinion from the deck's.
        if (findWithdrawingRequirement(adReq, facts, posting.location, brought))
          return reply.status(404).send({ error: { code: "not_found", message: "unknown card" } });

        await deps.sessions.setTailorTarget(session.id, req.params.adId);
        return { stage: "tailor", adId: req.params.adId };
      },
    );

    // #307: the tailor step's own routes (GET /onboarding/tailor, answer, profile-answer, drop)
    // live in routes/tailor.ts now — the extraction that bought this ticket's queue its lines.
  };
}
