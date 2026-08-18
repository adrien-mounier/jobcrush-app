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
import type { ClaimStore, ClaimRecord } from "../claims.js";
import { minedRoles, type JobStore } from "../jobs.js";
import type { SessionStore, SessionRecord } from "../sessions.js";
import { buildClaimGraph } from "../graph.js";
import { renderRootCv } from "../rootcv.js";
import { buildProfileState, resolveProfileLocation, resolveLanguagesQuestion } from "../profile.js";
import { runGate } from "../gate.js";
import { answerToClaim, detectGaps, templateQuestion, type GrillPhraser } from "../grill.js";
import { auditRootCv, type CvAuditor } from "../audit.js";
import { eligiblePostings, sessionPostings, type Posting } from "../preview.js";
import { ANY_FAMILY, type EligibilityStore } from "../eligibility.js";
import {
  answerEligibilityItem,
  excludingEligibility,
  isEligibilityItemId,
} from "../eligibilityDiscovery.js";
import {
  buildDiscoveryRouteState,
  currentDiscoveryFamily,
  prependReaderQuestionFromJob,
  productionDiscoveryFamilyLookup,
  reconcileSessionDiscovery,
} from "../discoveryEngine.js";
import { answerJobDateHole, isJobDateItemId } from "../yearsWorked.js";
import { readingLanguages, languageEligible } from "../language.js";
import { matchTick } from "../matchtick.js";
import { judgedMatchTick } from "../judgedScore.js";
import type { JudgeFn, JudgePeekFn } from "../judge.js";
import {
  advertFamilyIdFor,
  buildDeckCards,
  buildJobCard,
  buildTailorState,
  claimTier,
  hasOpenDiscoveryQuestions,
  resolveAdRequirements,
  resolveJudgement,
  resolveSessionYears,
  tailorTarget,
  withYearsShortfall,
} from "../deck.js";
import { applyFallbackChoice, fallbackOffer } from "../deckFallback.js";
import { makeRetrievalCoordinator, retrievalIsInProgress } from "../deckRetrieval.js";
import { answerLanguageLevel, LanguageLevelBody, withLanguageLevelAsks } from "../languageLevel.js";
import { retryJobBlockLabels } from "../jobBlockPlacementRetry.js";
import { findWithdrawingRequirement, partitionByWithdrawal } from "../withdrawal.js";
import {
  composeCvLine,
  discoveryClaimId,
  factCount,
  freeTextLine,
  isNoAnswer,
  READER_ROLE_ITEM_ID,
} from "../discovery.js";
import { composeTailorLine, tailorClaimId } from "../tailor.js";
import { FamilyPlacement } from "@jobcrush/contracts";
import {
  adaptiveDiscoveryState,
  soleConfirmedFamily,
  fixtureDiscoveryClaimId,
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

// #13 never-re-ask: a gap is closed by EITHER a confirmed "yes" or a persisted "no" — pending/rejected
// must NOT count, or a reopen() (a corrected "no") would stay silently answered instead of resurfacing.
async function answeredGrillIds(
  claims: ClaimStore,
  sessionId: string,
  confirmed: ClaimRecord[],
): Promise<Set<string>> {
  const negatives = await claims.negatives(sessionId);
  return new Set(
    [...confirmed, ...negatives].map((c) => c.id).filter((id) => id.startsWith("grill-")),
  );
}

// #33: the profile badge's factCount is a session-wide monotonic floor, same pattern as #23's tailor
// match floor — raise then clamp at every emission point, so a claim rejected in the S2 deck (which
// really does lower confirmed+negatives) can never make a fresh read (discovery OR tailor) show a
// drop. `session.factFloor` is a snapshot taken before the raise — on Pg that's pre-raise, on the
// in-memory store `raiseFactFloor` mutates the same object so it's already post-raise by the time we
// read it — but Math.max(computed, session.factFloor) gives the identical, correct result either way,
// so no re-fetch is needed on either driver.
async function withFactFloor(sessions: SessionStore, session: SessionRecord, computed: number): Promise<number> {
  await sessions.raiseFactFloor(session.id, computed);
  return Math.max(computed, session.factFloor);
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

    const fixtureState = async (
      sessionId: string,
      placement: FamilyPlacement,
      reply: FastifyReply,
    ) => {
      const reference = soleConfirmedFamily(placement);
      if (!reference) {
        return reply.status(409).send({
          error: { code: "placement_not_confirmed", message: "confirmed family placement required" },
          rewardEligible: false,
        });
      }
      const floor = deps.familyFloors.get(reference.familyId, reference.version);
      if (!floor) {
        return reply.status(404).send({
          error: { code: "fixture_floor_not_found", message: "selected fixture floor not found" },
          rewardEligible: false,
        });
      }
      const [claims, negatives] = await Promise.all([
        deps.claims.list(sessionId),
        deps.claims.negatives(sessionId),
      ]);
      return adaptiveDiscoveryState(floor, claims, negatives);
    };

    // #59's fixture seam — NOT a visitor surface and never a second discovery engine: it answers
    // only for a placement handed to it in the request body, reads the isolated fixture catalog
    // (empty in production — main.ts never populates it), and can never authorize a reward. The
    // visitor's own interview is the /onboarding/discovery routes below, and only those.
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
        if (isNoAnswer(req.body.answer)) await deps.claims.answerNegative(session.id, claim);
        else await deps.claims.add(session.id, claim);
        return fixtureState(session.id, req.body.placement, reply);
      },
    );

    // Open the deck: seed this session's claim store from its onboarding job's mined claims, once.
    // The client holds the jobId (same as GET /previews/:jobId); the job proves the mine finished.
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
      return buildProfileState(facts, confirmed, profileFactCount, session.targetTitles[0] ?? null, await deps.contact.getRecord(session.id), await resolveProfileLocation(deps.eligibility, session.id, session.intent.searchAreas), await resolveLanguagesQuestion(deps.eligibility, session.id));
    });

    // --- #16 discovery (screen 1a): the answer→CV-line→section-bar loop -------------------------
    // Pre-wall, so it rides the ANONYMOUS session (requireSession, not requireUser): the account ask
    // is after the reveal (spec §12), and answers persist server-side from question 1 (story #76).
    // The whole screen is a pure function of the session's role (Q1) + its recorded discovery answers,
    // so every response is `discoveryState(...)` and GET resumes with no client state.

    // Third element (rejected) is #35's addition: no new store method — filter the existing list()
    // rather than add a ClaimStore.rejected(). Fourth element (facts) is #106's: the session's stored
    // eligibility facts, read the same way for the same reason — kept in this one Promise.all (not a
    // separate serialized read) so a Pg-backed read still fires every query in parallel; callers that
    // don't need the extras (cards, tailor) just destructure the first two.
    const discoveryReads = (sessionId: string) =>
      Promise.all([
        deps.claims.confirmed(sessionId),
        deps.claims.negatives(sessionId),
        deps.claims.list(sessionId).then((all) => all.filter((c) => c.decision === "rejected")),
        deps.eligibility.list(sessionId),
        // #162: the dated job records the years-of-experience total is worked out from — and whose
        // unknown ends are the questions asked instead of that total (ADR-0008 clause 3).
        deps.jobBlocks.list(sessionId),
      ]);

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
        const session = requireSession(req);
        const role = session.targetTitles[0] ?? null;
        const [confirmed, negatives, rejected, facts, blocks] = await discoveryReads(session.id);
        const family = role ? await reconciledFamily(session) : null;
        const state = buildDiscoveryRouteState(role, confirmed, negatives, rejected, facts, session, family, blocks);
        // #35: a deck-rejected reader-role claim still closes the question — same never-re-ask rule
        // discoveryState now applies internally; this check is separate (the reader question isn't a
        // floor item) so it needs its own look at `rejected`.
        await prependReaderQuestionFromJob(state, req.query.job, deps.store, session, confirmed, rejected);
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
        await deps.sessions.setTargetTitles(session.id, [req.body.role]);
        const intent = await deps.sessions.setIntent(session.id, { targetRole: req.body.role });
        await deps.sessions.setStage(session.id, "discovery");
        const sessionWithRole = { ...session, intent, targetTitles: [req.body.role] };
        const [confirmed, negatives, rejected, facts, blocks] = await discoveryReads(session.id);
        const family = await reconciledFamily(sessionWithRole);
        const state = buildDiscoveryRouteState(req.body.role, confirmed, negatives, rejected, facts, session, family, blocks);
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
          let no = false;
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

            no = isNoAnswer(answer);
            claim = {
              id: discoveryClaimId(item.id),
              semantic_key: item.id,
              field_key: null,
              field_value: null,
              field_label: null,
              role: "profile",
              text: no ? `Not applicable — ${item.question}` : composeCvLine(item, answer),
              machine_touch: "verbatim", // the visitor's own answer
              classification: "Verified", // user-authored, they vouch for it
              source_quote: answer.slice(0, 200),
              needs_grill: false,
              grill_hint: null,
            };
          }
          if (no) await deps.claims.answerNegative(session.id, claim);
          else await deps.claims.add(session.id, claim);
        }

        const [confirmed, negatives, rejected, facts, blocks] = await discoveryReads(session.id);
        // #216: the closing read is the reconciling one, whichever branch above ran — the answer
        // just recorded is what moves coverage, so the session's checkpoint is rewritten from it
        // before this response leaves. placeFamily is cached per session+role (familyLabeler.ts),
        // so the second derivation on the floor-item branch costs nothing.
        const routeFamily = await reconciledFamily(session);
        const state = buildDiscoveryRouteState(role, confirmed, negatives, rejected, facts, session, routeFamily, blocks);
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
    app.get("/onboarding/cards", async (req) => {
      const session = requireSession(req);
      deps.watchFamilyCandidate?.(session); // #236 — background, never awaited, never user-visible.
      await retryJobBlockLabels(deps.retryJobBlockLabels, session.id, fastify.log);
      const [confirmed, negatives, rejected, facts, blocks] = await discoveryReads(session.id);
      const retrievalRequest = retrievalRequestForSession(session, confirmed, negatives);
      const requestFingerprint = retrievalFingerprint(retrievalRequest);
      // deckRetrieval.ts returns the response snapshot and starts background work when this process owns it.
      const retrieval = retrievalCoordinator.ensureRetrieval(session, retrievalRequest, requestFingerprint);
      // #222: years at BOTH scopes — the advert's family (advertFamilyIdFor: the confirmed floor,
      // else the target-role placement) and the career total. Known zero vs unmapped fallback is
      // resolveSessionYears's rule (deck.ts / ADR-0014 amendment 1 decision 6). Reads `facts` +
      // `blocks` already fetched above by discoveryReads — one eligibility read per request.
      const role = session.targetTitles[0] ?? null;
      // #243: the deck's family — read by the years scope AND the family-fit deletion/ranking.
      const deckFamilyId = await advertFamilyIdFor(session, deps.placeFamily);
      const years = resolveSessionYears(facts, blocks, deckFamilyId);
      const langs = readingLanguages(session);
      const postings = eligiblePostings(langs, sessionPostings(session, requestFingerprint));
      // deck.ts's buildDeckCards: read → delete wrong-family → withdraw → judge within the paid
      // bound → shape + order. See its own doc (and judgeDeck's) for the spend-bound properties.
      const { cards, pendingCount, withdrawn } = await buildDeckCards(
        postings,
        { confirmed, negatives, facts, years, deckFamilyId, langs },
        deps,
      );
      // #235: whether the empty deck may say "answer a few more questions" (deck.ts owns the rule).
      const moreQuestions = hasOpenDiscoveryQuestions(
        session,
        confirmed,
        negatives,
        rejected,
        facts,
        blocks,
        await currentFamily(session),
      );
      // #22: authed tells the client whether the account wall at the reveal applies — false only
      // for a still-anonymous session, so a returning (claimed) visitor is never re-walled.
      return {
        stage: session.stage,
        cards,
        pendingCount,
        authed: session.claimedByUserId !== null,
        withdrawn,
        retrieval,
        searching: retrievalIsInProgress(retrieval),
        moreQuestions,
        // #228: the dead end's offer — server-owned, so the screen renders and never decides
        // (deckFallback.ts owns the four preconditions).
        fallback: fallbackOffer(session, moreQuestions, blocks, deps.productionFamilyFloors),
      };
    });

    // #228: her answer to that offer. No provider call here — accepting only records the choice, and
    // the next deck read pays for the one extra search it implies (deckFallback.ts).
    app.post(
      "/onboarding/cards/fallback",
      { schema: { body: z.object({ accepted: z.boolean() }) } },
      async (req) => {
        const session = requireSession(req);
        await retryJobBlockLabels(deps.retryJobBlockLabels, session.id, fastify.log);
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

    // #165 — the ladder's answer; write path in languageLevel.ts. Pre-wall, like the deck that fires it.
    app.post(
      "/onboarding/language-level",
      { schema: { body: LanguageLevelBody } },
      async (req, reply) => {
        const session = requireSession(req);
        const r = await answerLanguageLevel(deps.eligibility, session.id, req.body.language, req.body.level);
        if (!r.ok) return reply.status(r.status).send({ error: { code: r.code, message: r.message } });
        return { ok: true };
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
        const [confirmed, negatives, , facts] = await discoveryReads(session.id);
        const fingerprint = retrievalFingerprint(retrievalRequestForSession(session, confirmed, negatives));
        const posting = eligiblePostings(langs, sessionPostings(session, fingerprint)).find((p) => p.id === req.params.adId);
        const adReq = posting ? await resolveAdRequirements(posting.id, deps.readAd, posting) : null;
        // T3 (code review): guard on `posting`/`adReq` themselves, not a derived boolean, so TS
        // narrows both to non-null below without a `!` assertion — a later edit to this guard is then
        // a compile error if it stops guaranteeing that, not a runtime one. (#182: `posting` joined
        // the guard so its `.location` below is typed non-null, not just `adReq`'s.)
        if (!posting || !adReq || !languageEligible(adReq.language, langs))
          return reply.status(404).send({ error: { code: "not_found", message: "unknown card" } });
        // #107 (D4): a withdrawn ad is not a valid want target either — same 404 shape as an unknown
        // card, so a session can never distinguish "never existed" from "genuinely can't take it".
        if (findWithdrawingRequirement(adReq, facts, posting.location))
          return reply.status(404).send({ error: { code: "not_found", message: "unknown card" } });

        await deps.sessions.setTailorTarget(session.id, req.params.adId);
        return { stage: "tailor", adId: req.params.adId };
      },
    );

    // --- #23 tailor (screen 3): re-score, the live card, and the exits -------------------------
    // Post-wall (requireUser, like #21's want route) — reached only after signing in at the reveal.
    // The whole screen is a pure function of (this ad's requirements, this session's confirmed/
    // negative facts, this session's tailor floor), so GET is a plain re-derive — same resume story
    // as #16 discovery. card.bubble/fit/dontYet come straight from buildJobCard recomputed on the
    // CURRENT fact set — that IS AC2's "?→✓ flip" and "bubble's gap clause rewritten"; no new state.

    app.get("/onboarding/tailor", async (req, reply) => {
      const session = requireUser(req);
      const adId = session.tailorAdId;
      if (!adId)
        return reply
          .status(409)
          .send({ error: { code: "no_tailor_target", message: "no job being tailored" } });
      const [confirmed, negatives, , facts, blocks] = await discoveryReads(session.id);
      const fingerprint = retrievalFingerprint(retrievalRequestForSession(session, confirmed, negatives));
      const target = await tailorTarget(session, adId, deps.readAd, fingerprint);
      if (!target)
        return reply.status(404).send({ error: { code: "not_found", message: "unknown card" } });
      const { posting, adReq } = target;
      // #107 (M3, code review): a target that has since become withdrawn behaves EXACTLY like no
      // target at all — no rejection message, no error screen (the ticket's own UX intent: "It does
      // not appear as a greyed-out card, a 'you can't apply' state, or a rejection message"). Clearing
      // it here means a reload doesn't keep landing back on the same dead target.
      if (findWithdrawingRequirement(adReq, facts, posting.location)) {
        await deps.sessions.clearTailorTarget(session.id);
        return reply
          .status(409)
          .send({ error: { code: "no_tailor_target", message: "no job being tailored" } });
      }
      const role = session.targetTitles[0] ?? null;
      const rawJudgement = await resolveJudgement(adReq, confirmed, deps.judge);
      // #107 (D5) / #222: the years shortfall at the bar's own scope — see applyYearsShortfall
      // (judgedScore.ts) + resolveSessionYears (deck.ts). Reads `facts` + `blocks` fetched above.
      // #162 AC6: null years means no readable work history, so this surface must report the years
      // bar untested exactly as the deck card does.
      const years = resolveSessionYears(facts, blocks, await advertFamilyIdFor(session, deps.placeFamily));
      const judgement = withYearsShortfall(rawJudgement, adReq, years);
      const family = role ? await currentFamily(session) : null;
      const state = buildTailorState(posting, adReq, confirmed, negatives, role, session.tailorFloorPct, judgement, years, family?.items ?? []);
      state.factCount = await withFactFloor(deps.sessions, session, state.factCount);
      return state;
    });

    // Idempotent, like #18's discovery answer: re-answering the same requirement CORRECTS it
    // (positive<->negative flip) via the same upserting add()/answerNegative() — no 409 guard needed.
    // The floor only ever rises (raiseTailorFloor: Math.max/GREATEST), so a correction/"no" right
    // after can never make the responded matchPct lower than a prior response's (AC1).
    app.post(
      "/onboarding/tailor/answer",
      { schema: { body: z.object({ requirementId: z.string(), answer: z.string().trim().min(1) }) } },
      async (req, reply) => {
        const session = requireUser(req);
        const adId = session.tailorAdId;
        if (!adId)
          return reply
            .status(409)
            .send({ error: { code: "no_tailor_target", message: "no job being tailored" } });
        const [targetConfirmed, targetNegatives] = await Promise.all([
          deps.claims.confirmed(session.id),
          deps.claims.negatives(session.id),
        ]);
        const fingerprint = retrievalFingerprint(
          retrievalRequestForSession(session, targetConfirmed, targetNegatives),
        );
        const target = await tailorTarget(session, adId, deps.readAd, fingerprint);
        if (!target)
          return reply.status(404).send({ error: { code: "not_found", message: "unknown card" } });
        const { posting, adReq } = target;
        const requirement = adReq.requirements.find((r) => r.id === req.body.requirementId);
        if (!requirement)
          return reply
            .status(404)
            .send({ error: { code: "unknown_requirement", message: "no such requirement" } });

        const no = isNoAnswer(req.body.answer);
      const claim: CandidateClaim = {
        id: tailorClaimId(adReq.adId, requirement.id),
        semantic_key: tailorClaimId(adReq.adId, requirement.id),
        field_key: null,
        field_value: null,
        field_label: null,
          role: "profile",
          text: no
            ? `Not applicable — ${requirement.requirement}`
            : composeTailorLine(requirement, req.body.answer),
          machine_touch: "verbatim", // the visitor's own answer
          classification: "Verified", // user-authored, they vouch for it
          source_quote: req.body.answer.slice(0, 200),
          needs_grill: false,
          grill_hint: null,
        };
        if (no) await deps.claims.answerNegative(session.id, claim);
        else await deps.claims.add(session.id, claim);

        const [confirmed, negatives, , facts, blocks] = await discoveryReads(session.id);
        // #107 (M3, code review): a target that has become withdrawn (this answer's own claim is
        // still recorded — harmless, tied to this ad's own claim id) behaves EXACTLY like no target
        // at all from here on: no rejection message, nothing further asserted about a job the visitor
        // can no longer take. Cleared so a reload doesn't keep landing back on the same dead target.
        if (findWithdrawingRequirement(adReq, facts, posting.location)) {
          await deps.sessions.clearTailorTarget(session.id);
          return reply
            .status(409)
            .send({ error: { code: "no_tailor_target", message: "no job being tailored" } });
        }
        const role = session.targetTitles[0] ?? null;
        // #105 decision 7: the floor is raised from the HONEST number when a judgement is available
        // — the answer just added changed the fact set, so this is a fresh (adId, fingerprint), never
        // a cache hit reusing a stale judgement. Falls back to matchTick when no judge is wired.
        const rawJudgement = await resolveJudgement(adReq, confirmed, deps.judge);
        // #107 (D5) / #222: the years-experience shortfall at the bar's own scope — see
        // applyYearsShortfall (judgedScore.ts). Reads `facts` + `blocks` already fetched above.
        const years = resolveSessionYears(facts, blocks, await advertFamilyIdFor(session, deps.placeFamily));
        const judgement = withYearsShortfall(rawJudgement, adReq, years);
        await deps.sessions.raiseTailorFloor(
          session.id,
          judgement ? judgedMatchTick(judgement.verdicts, adReq) : matchTick(confirmed, adReq),
        );
        const family = role ? await currentFamily(session) : null;
        const state = buildTailorState(posting, adReq, confirmed, negatives, role, session.tailorFloorPct, judgement, years, family?.items ?? []);
        state.factCount = await withFactFloor(deps.sessions, session, state.factCount);
        return state;
      },
    );

    // Drop: back to the deck, never touching a claim — "everything you told me stays on your profile."
    app.post("/onboarding/tailor/drop", async (req) => {
      const session = requireUser(req);
      await deps.sessions.clearTailorTarget(session.id);
      return { stage: "deck" };
    });
  };
}
