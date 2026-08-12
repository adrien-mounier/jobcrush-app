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
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { CandidateClaim, MinedRole, AdRequirementsV1 } from "@jobcrush/contracts";
import { requireUser, requireSession } from "../server.js";
import type { ClaimStore, ClaimRecord } from "../claims.js";
import type { JobStore } from "../jobs.js";
import {
  RETRIEVAL_CLAIM_LEASE_MS,
  retrievalClaimWindow,
  type SessionStore,
  type SessionRecord,
} from "../sessions.js";
import { buildClaimGraph } from "../graph.js";
import { renderRootCv } from "../rootcv.js";
import { buildProfileState, resolveProfileLocation, resolveLanguagesQuestion } from "../profile.js";
import { runGate } from "../gate.js";
import { answerToClaim, detectGaps, templateQuestion, type GrillPhraser } from "../grill.js";
import { auditRootCv, type CvAuditor } from "../audit.js";
import { loadFamilyFloor } from "../e5stub.js";
import { eligiblePostings, sessionPostings, type Posting } from "../preview.js";
import { ANY_FAMILY, type EligibilityFact, type EligibilityStore } from "../eligibility.js";
import {
  eligibilityCandidates,
  excludingEligibility,
  isEligibilityItemId,
  isValidLanguageSelection,
  languageFacts,
  mapEligibilityAnswer,
  resolveEligibilityFamilyScope,
  unresolvedEligibilityQuestions,
} from "../eligibilityDiscovery.js";
import { readingLanguages, languageEligible } from "../language.js";
import { incrementCounter } from "../counters.js";
import { matchTick } from "../matchtick.js";
import { judgedMatchTick } from "../judgedScore.js";
import type { JudgeFn, JudgePeekFn } from "../judge.js";
import {
  buildJobCard,
  buildTailorState,
  CARD_RESOLUTION_CONCURRENCY,
  DECK_JUDGE_BUDGET_MS,
  DECK_JUDGE_MAX_CARDS,
  mapWithConcurrency,
  orderCardsForReveal,
  resolveAdRequirements,
  resolveJudgement,
  resolveUserYears,
  tailorTarget,
  withYearsShortfall,
} from "../deck.js";
import { findWithdrawingRequirement, normalizeScope } from "../withdrawal.js";
import {
  composeCvLine,
  discoveryClaimId,
  discoveryState,
  factCount,
  freeTextLine,
  isNoAnswer,
  READER_ROLE_ITEM_ID,
  readerQuestion,
  resolveFamily,
  type DiscoveryState,
} from "../discovery.js";
import { composeTailorLine, tailorClaimId } from "../tailor.js";
import { FamilyPlacement } from "@jobcrush/contracts";
import {
  adaptiveDiscoveryState,
  confirmedFixtureFloorReference,
  fixtureDiscoveryClaimId,
} from "../adaptiveDiscovery.js";
import type { ProductionFamilyFloorStore, TestFixtureFamilyFloorStore } from "../familyFloors.js";
import {
  isReusableRetrievalSnapshot,
  logPostingRetrievalFailure,
  resolvedCityFor,
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
  contact: import("../contact.js").ContactStore; // #190: GET /profile reads it, additively.
  familyFloors: TestFixtureFamilyFloorStore;
  productionFamilyFloors: ProductionFamilyFloorStore;
  placeFamily: (session: Readonly<SessionRecord>) => Promise<FamilyPlacement>;
  retrievePostings?: (input: RetrievalRequest) => Promise<PostingRetrievalResultV1>;
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

/** The miner stores its full doc (incl. per-role date flags) under progress.miner.doc. */
const minedRoles = (job: { progress: Record<string, unknown> }): MinedRole[] =>
  ((job.progress.miner as { doc?: { roles?: MinedRole[] } } | undefined)?.doc?.roles) ?? [];

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
  const retrievePostings = deps.retrievePostings ?? unavailablePostingRetrieval;
  const retrievalsInFlight = new Map<
    string,
    { fingerprint: string; startedAtMs: number; result: Promise<PostingRetrievalResultV1> }
  >();
  const retrievalInProgress = (): PostingRetrievalResultV1 => ({
    schemaVersion: "4",
    outcome: "provider_unavailable",
    coverage: {
      providersQueried: [],
      providersUnavailable: ["retrieval-in-progress"],
      complete: false,
    },
    reason: "posting retrieval is in progress",
    retryable: true,
  });
  return async function plugin(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    const fixtureState = async (
      sessionId: string,
      placement: FamilyPlacement,
      reply: FastifyReply,
    ) => {
      const reference = confirmedFixtureFloorReference(placement);
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

    const calculateProductionState = async (
      session: SessionRecord,
      reference: { familyId: string; version: number },
      reply: FastifyReply,
    ) => {
      const publication = eligibleProductionPublication(reference);
      if (!publication) {
        return reply.status(409).send({
          error: { code: "production_floor_unavailable", message: "published family version required" },
          rewardEligible: false,
        });
      }
      const [claims, negatives] = await Promise.all([
        deps.claims.list(session.id),
        deps.claims.negatives(session.id),
      ]);
      const state = adaptiveDiscoveryState(publication.floor, claims, negatives);
      const coveredItemIds = publication.floor.essentialItems
        .filter((item) =>
          state.positiveEvidence.some((evidence) => evidence.itemId === item.id) ||
          negatives.some(
            (claim) =>
              claim.semantic_key === item.id ||
              claim.id === fixtureDiscoveryClaimId(reference.familyId, reference.version, item.id),
          ),
        )
        .map((item) => item.id);
      const checkpoint =
        coveredItemIds.length === publication.floor.essentialItems.length
          ? ("essential_floor_covered" as const)
          : ("family_confirmed" as const);
      return { state, coveredItemIds, checkpoint };
    };

    const eligibleProductionPublication = (
      reference: { familyId: string; version: number },
    ) => {
      const publication = deps.productionFamilyFloors.get(reference.familyId, reference.version);
      return publication?.publicationStatus === "published" &&
        publication.floor.source === "production_research" &&
        publication.floor.productionRewardEligible
        ? publication
        : null;
    };

    const productionResponse = async (
      session: SessionRecord,
      reference: { familyId: string; version: number },
      reply: FastifyReply,
      persist: boolean,
    ) => {
      const calculated = await calculateProductionState(session, reference, reply);
      if ("sent" in calculated) return calculated;
      if (!persist) return { ...calculated.state, checkpoint: calculated.checkpoint };
      const discovery = await deps.sessions.reconcileDiscoveryState(
        session.id,
        reference,
        calculated.coveredItemIds,
        calculated.checkpoint === "essential_floor_covered",
      );
      return { ...calculated.state, checkpoint: discovery.checkpoint };
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
      "/onboarding/discovery/production/evaluate",
      {},
      async (req, reply) => {
        const session = requireSession(req);
        const placement = await deps.placeFamily(session);
        if (placement.outcome !== "confirmed") {
          return reply.status(409).send({
            error: { code: "placement_not_confirmed", message: "confirmed family placement required" },
            rewardEligible: false,
          });
        }
        if (
          session.discovery.floor &&
          (session.discovery.floor.familyId !== placement.family.familyId ||
            session.discovery.floor.version !== placement.family.version)
        ) {
          return reply.status(409).send({
            error: { code: "production_floor_already_pinned", message: "production family version already selected" },
            rewardEligible: false,
          });
        }
        return productionResponse(session, placement.family, reply, true);
      },
    );

    app.get("/onboarding/discovery/production", async (req, reply) => {
      const session = requireSession(req);
      if (!session.discovery.floor) {
        return reply.status(409).send({
          error: { code: "production_discovery_not_started", message: "production discovery not started" },
          rewardEligible: false,
        });
      }
      // Resume re-derives coverage from authoritative claims and reconciles the durable snapshot.
      // This is idempotent, but prevents a previously covered checkpoint surviving a correction.
      return productionResponse(session, session.discovery.floor, reply, true);
    });

    app.post(
      "/onboarding/discovery/production/answer",
      {
        schema: {
          body: z.object({
            itemId: z.string().min(1),
            answer: z.string().trim().min(1),
          }),
        },
      },
      async (req, reply) => {
        const session = requireSession(req);
        const reference = session.discovery.floor;
        if (!reference) {
          return reply.status(409).send({
            error: { code: "production_discovery_not_started", message: "production discovery not started" },
            rewardEligible: false,
          });
        }
        const publication = eligibleProductionPublication(reference);
        const item = publication?.floor.essentialItems.find(
          (candidate) => candidate.id === req.body.itemId,
        );
        if (!publication) {
          return reply.status(409).send({
            error: { code: "production_floor_unavailable", message: "published family version required" },
            rewardEligible: false,
          });
        }
        if (!item) {
          return reply.status(404).send({
            error: { code: "production_item_not_found", message: "selected production item not found" },
            rewardEligible: false,
          });
        }
        const claim: CandidateClaim = {
          id: fixtureDiscoveryClaimId(reference.familyId, reference.version, item.id),
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
        return productionResponse(session, reference, reply, true);
      },
    );

    app.post("/onboarding/discovery/production/complete", async (req, reply) => {
      const session = requireSession(req);
      const reference = session.discovery.floor;
      if (!reference) {
        return reply.status(409).send({
          error: { code: "essential_floor_not_covered", message: "essential family floor not covered" },
          rewardEligible: false,
        });
      }
      const calculated = await calculateProductionState(session, reference, reply);
      if ("sent" in calculated) return calculated;
      if (calculated.checkpoint !== "essential_floor_covered") {
        return reply.status(409).send({
          error: { code: "essential_floor_not_covered", message: "essential family floor not covered" },
          rewardEligible: false,
        });
      }
      if (!eligibleProductionPublication(reference)) {
        return reply.status(409).send({
          error: { code: "production_floor_unavailable", message: "published family version required" },
          rewardEligible: false,
        });
      }
      return { checkpoint: "essential_floor_covered", floor: reference };
    });

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
        const reference = confirmedFixtureFloorReference(req.body.placement);
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
      return buildProfileState(facts, confirmed, profileFactCount, session.targetTitles[0] ?? null, await deps.contact.getRecord(session.id), await resolveProfileLocation(deps.eligibility, session.id, session.intent.searchArea), await resolveLanguagesQuestion(deps.eligibility, session.id));
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
      ]);

    // #106: eligibility questions layered onto discoveryState()'s pure floor-only output, mirroring
    // the reader-only-question pattern just below rather than touching discoveryState() itself — so
    // essentialRemaining/railFill's floor-only meaning needs no new carve-out there. Code-review
    // must-fix 2 (round 2): these are appended UNCONDITIONALLY (never gated on the essential band),
    // and — round 3's funnel-regression fix — inserted right after the essential band and BEFORE the
    // standard one, never after it. discoveryState() only ever gates `stage` on the essential band
    // (below); the standard band has always been optional/loopback-reachable, never required to reach
    // the deck. Putting eligibility after the WHOLE floor (round 2's shape) meant the ask dock — which
    // only ever renders questions[0], one at a time, with no skip — forced a visitor through all 5
    // standard items just to REACH the 3 eligibility ones that actually gate the deck, tripling the
    // pre-deck question count nobody asked for. Standard items are moved after eligibility instead;
    // everything else (essential items, the reader-only question, in whatever relative order
    // discoveryState()/the GET route already established) stays exactly where it was — only the
    // standard-band entries move.
    const applyEligibility = (
      session: SessionRecord,
      role: string,
      state: DiscoveryState,
      confirmed: ClaimRecord[],
      negatives: ClaimRecord[],
      rejected: ClaimRecord[],
      facts: EligibilityFact[],
    ) => {
      const eligQuestions = unresolvedEligibilityQuestions(
        session,
        role,
        ANY_FAMILY,
        state.city,
        confirmed,
        negatives,
        rejected,
        facts,
      );
      const { family } = resolveFamily(role);
      const standardIds = new Set(
        loadFamilyFloor(family).items.filter((i) => i.rankBand === "standard").map((i) => i.id),
      );
      const leading = state.questions.filter((q) => !standardIds.has(q.itemId));
      const standard = state.questions.filter((q) => standardIds.has(q.itemId));
      state.questions = [...leading, ...eligQuestions, ...standard];
      if (eligQuestions.length > 0) state.stage = "discovery";
    };

    // #106: an eligibility answer's own write path. Code-review must-fix 1: a REAL answer (of any
    // kind, including a "no"-shaped one like "Not yet — I'd need sponsorship") never touches the
    // claims store — graph.ts's buildClaimGraph renders every claim in its first argument
    // unconditionally, and stamps every claim in its `negatives` option classification "Negative",
    // which the contract oracle (packages/contracts/oracle/validate_graph.mjs) defines as a CONFIRMED
    // GAP Tailor must never assert. Either path would misrepresent a real answer. A real answer
    // therefore lives ONLY in the eligibility store (put()); "already answered" is read back from
    // THAT store (this route's own `facts`), never from a claim. Only a DECLINE still writes a
    // claims-store record (answerNegative — "asked and closed, no fact"), reusing the one persistence
    // this repo already has for that state. Must-fix 5: correcting an answer TO a decline retracts
    // any value a PRIOR real answer stored — eligibility.remove() runs unconditionally on a decline (a
    // no-op if nothing was ever stored), so the dimension reads unknown again, never a retracted
    // value. Must-fix 8: `city` is the visitor's REAL resolved city (#184: postingRetrieval.ts's
    // resolvedCityFor, over the confirmed search area — no longer parseCity(role), never a
    // placeholder) — it's rebuilt into the question text a decline's claim records verbatim, so that
    // record must match what the visitor was actually asked. Returns a reply already sent on failure,
    // undefined on success — mirrors this file's other early-return route helpers (e.g. fixtureState
    // above).
    //
    // #123: `body` replaces the old single `rawAnswer` string — the languages question is
    // multi-select, so its real answer arrives as `answers: string[]`, never a single `answer`. Every
    // other eligibility question (years-experience, work-rights) and every question's OWN decline
    // still arrive as a single `answer`, exactly as before.
    const answerEligibilityItem = async (
      session: SessionRecord,
      role: string,
      itemId: string,
      body: { answer?: string; answers?: string[] },
      reply: FastifyReply,
    ): Promise<FastifyReply | undefined> => {
      const { familyId, scopeLabel } = resolveEligibilityFamilyScope(session, role);
      const city = resolvedCityFor(session.intent.searchArea);
      const question = eligibilityCandidates(familyId, ANY_FAMILY, scopeLabel, city).find(
        (q) => q.itemId === itemId,
      );
      if (!question) {
        return reply.status(404).send({ error: { code: "unknown_item", message: "no such floor item" } });
      }
      const ask = question.eligibility!;

      if (body.answer !== undefined) {
        const answer = body.answer.trim();
        if (answer === ask.declineOption) {
          if (question.multiSelect) {
            // #123: a decline on the (multi-select) languages question retracts EVERY language's
            // stored fact, not just one scope — must-fix 5's rule, applied across the whole list, so
            // a prior real answer is fully erased and every language reads as unknown again.
            //
            // Code-review must-fix 2 (2026-08-04): loops over languagesUnion() (TODAY's list), not
            // whatever is actually stored — eligibility.remove() defaults its familyId to ANY_FAMILY,
            // so it can't clear "every scope" in one call, and languages-by-market.json is the
            // owner's own hand-edit surface (must-fix 4): the day a market is dropped or a language
            // renamed there, a visitor who answered under the OLD list and then declines would keep a
            // stale fact at a scope the union no longer contains — a decline that silently fails to
            // fully retract. Reads what this SESSION actually has stored (list()) and removes each
            // language-dimension fact by its own recorded scope instead, so a decline always fully
            // retracts regardless of how the list has changed since the visitor answered.
            const stored = await deps.eligibility.list(session.id);
            for (const fact of stored) {
              if (fact.dimension === ask.dimension) {
                await deps.eligibility.remove(session.id, fact.dimension, fact.familyId);
              }
            }
          } else {
            await deps.eligibility.remove(session.id, ask.dimension, ask.familyId);
          }
          const claimId = discoveryClaimId(itemId);
          await deps.claims.answerNegative(session.id, {
            id: claimId,
            semantic_key: claimId,
            field_key: null,
            field_value: null,
            field_label: null,
            role: "profile",
            text: `Declined — ${question.question}`,
            machine_touch: "verbatim",
            classification: "Verified",
            source_quote: answer.slice(0, 200),
            needs_grill: false,
            grill_hint: null,
          });
          return undefined;
        }

        // #123: a multi-select question only ever accepts a single `answer` for its decline (handled
        // above) — a REAL response is always `answers`. Falling through to the single-value mapper
        // below would be silently wrong (it knows nothing about this question's shape), so this is a
        // 400, not a fall-through.
        if (question.multiSelect) {
          return reply
            .status(400)
            .send({ error: { code: "invalid_answer", message: "unrecognized eligibility answer" } });
        }

        const mapped = mapEligibilityAnswer(ask.dimension, scopeLabel, answer);
        if (!mapped) {
          return reply
            .status(400)
            .send({ error: { code: "invalid_answer", message: "unrecognized eligibility answer" } });
        }
        await deps.eligibility.put(session.id, {
          dimension: ask.dimension,
          familyId: ask.familyId,
          value: mapped.value,
          label: mapped.label,
        });
        return undefined;
      }

      // #123: the multi-select real-answer path — `body.answers` (the route only reaches here once
      // it has already checked exactly one of answer/answers is present). A single-select question
      // never accepts this shape.
      if (!question.multiSelect || !body.answers || !isValidLanguageSelection(body.answers)) {
        return reply
          .status(400)
          .send({ error: { code: "invalid_answer", message: "unrecognized eligibility answer" } });
      }
      // Write the FULL set on every answer — every language, not only the ticked ones (AC6: this is
      // what makes a correction work — re-answering with Mandarin ticked flips its stored "none" back
      // to "professional" in the same call, rather than leaving a stale "none" for nothing to revisit).
      for (const write of languageFacts(body.answers)) {
        await deps.eligibility.put(session.id, { dimension: ask.dimension, ...write });
      }
      return undefined;
    };

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
        const [confirmed, negatives, rejected, facts] = await discoveryReads(session.id);
        const state = discoveryState(role, confirmed, negatives, rejected, resolvedCityFor(session.intent.searchArea));

        const jobId = req.query.job;
        // #35: a deck-rejected reader-role claim still closes the question — same never-re-ask rule
        // discoveryState now applies internally; this check is separate (the reader question isn't a
        // floor item) so it needs its own look at `rejected`.
        const readerAnswered = [...confirmed, ...rejected].some(
          (c) => c.id === discoveryClaimId(READER_ROLE_ITEM_ID),
        );
        if (jobId && !readerAnswered) {
          const job = await deps.store.get(jobId);
          const roles = job && job.sessionId === session.id ? minedRoles(job) : [];
          if (roles.length > 0) state.questions = [readerQuestion(roles[0]!), ...state.questions];
        }
        if (role) applyEligibility(session, role, state, confirmed, negatives, rejected, facts);
        // #106 must-fix 3: a decline is a refusal, not a recorded fact — strip it before it inflates
        // the profile badge's "pile that only grows".
        state.factCount = factCount(excludingEligibility(confirmed), excludingEligibility(negatives));
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
        return resolveFamily(req.query.q);
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
        await deps.sessions.setStage(session.id, "discovery");
        const [confirmed, negatives, rejected, facts] = await discoveryReads(session.id);
        const state = discoveryState(req.body.role, confirmed, negatives, rejected, resolvedCityFor(session.intent.searchArea));
        applyEligibility(session, req.body.role, state, confirmed, negatives, rejected, facts);
        state.factCount = factCount(excludingEligibility(confirmed), excludingEligibility(negatives));
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

        // #106: an eligibility item is a separate answer shape (see answerEligibilityItem's own doc
        // comment above) — handled as its own path rather than forced through the shared claim/no
        // branches below.
        if (isEligibilityItemId(req.body.itemId)) {
          const errorReply = await answerEligibilityItem(session, role, req.body.itemId, req.body, reply);
          if (errorReply) return errorReply;
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
            const { family } = resolveFamily(role);
            const item = loadFamilyFloor(family).items.find((i) => i.id === req.body.itemId);
            if (!item)
              return reply.status(404).send({ error: { code: "unknown_item", message: "no such floor item" } });

            no = isNoAnswer(answer);
            claim = {
              id: discoveryClaimId(item.id),
              semantic_key: discoveryClaimId(item.id),
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

        const [confirmed, negatives, rejected, facts] = await discoveryReads(session.id);
        const state = discoveryState(role, confirmed, negatives, rejected, resolvedCityFor(session.intent.searchArea));
        applyEligibility(session, role, state, confirmed, negatives, rejected, facts);
        // #18 AC1 / #106: the essential band fully asked AND every eligibility question closed flips
        // the session to the deck stage, so a reload lands there too. Code-review must-fix 2: the
        // full set of remaining floor + eligibility items is visible from the very first response
        // (never gated on the essential band), so the combined countdown only ever counts down as
        // items are answered — it can no longer jump back up the way withholding eligibility until
        // essentialRemaining hit 0 once did.
        if (state.stage === "deck") await deps.sessions.setStage(session.id, "deck");
        state.factCount = factCount(excludingEligibility(confirmed), excludingEligibility(negatives));
        state.factCount = await withFactFloor(deps.sessions, session, state.factCount);
        return state;
      },
    );

    // --- #19 the reveal + the job card (screen 2a): instant-tick, score-sorted card deck --------
    // Rides the anonymous session like discovery (requireSession, not requireUser — the wall is
    // after the reveal). Meaningful once session.stage === "deck", but never gated server-side:
    // the client decides when to show it. Cards = every posting with a stubbed AdRequirementsV1
    // entry (the E5 boundary, e5stub.ts), joined by adId and scored by matchtick.ts against this
    // session's confirmed/negative claims — no LLM, no IO beyond the two fixture loads.
    app.get("/onboarding/cards", async (req) => {
      const session = requireSession(req);
      const [confirmed, negatives, , facts] = await discoveryReads(session.id);
      const retrievalRequest = retrievalRequestForSession(session, confirmed, negatives);
      const requestFingerprint = retrievalFingerprint(retrievalRequest);
      let retrieval: PostingRetrievalResultV1;
      if (isReusableRetrievalSnapshot(session.retrieval, requestFingerprint)) {
        retrieval = session.retrieval!.result;
      } else {
        const existing = retrievalsInFlight.get(session.id);
        if (
          existing?.fingerprint === requestFingerprint &&
          Date.now() - existing.startedAtMs < RETRIEVAL_CLAIM_LEASE_MS
        ) {
          retrieval = retrievalInProgress();
        } else {
          const generation = session.retrievalGeneration;
          const expectedSnapshotFingerprint = session.retrievalCoordinationFingerprint;
          const ownerToken = randomUUID();
          const claimWindow = retrievalClaimWindow();
          const result = (async () => {
            let claimed: boolean;
            try {
              claimed = await deps.sessions.beginRetrievalState(
                session.id,
                generation,
                requestFingerprint,
                expectedSnapshotFingerprint,
                ownerToken,
                claimWindow.claimedAt,
                claimWindow.staleBefore,
              );
            } catch {
              logPostingRetrievalFailure(app.log, "claim_failed");
              return {
                schemaVersion: "4" as const,
                outcome: "provider_unavailable" as const,
                coverage: {
                  providersQueried: [],
                  providersUnavailable: ["retrieval-store"],
                  complete: false,
                },
                reason: "posting retrieval is temporarily unavailable",
                retryable: true,
              };
            }
            if (!claimed) {
              try {
                const latest = await deps.sessions.getById(session.id);
                if (isReusableRetrievalSnapshot(latest?.retrieval ?? null, requestFingerprint)) {
                  return latest!.retrieval!.result;
                }
              } catch {
                logPostingRetrievalFailure(app.log, "snapshot_read_failed");
              }
              return retrievalInProgress();
            }
            let current: PostingRetrievalResultV1;
            try {
              current = await retrievePostings(retrievalRequest);
            } catch {
              logPostingRetrievalFailure(app.log, "retrieval_failed");
              current = {
                schemaVersion: "4",
                outcome: "provider_unavailable",
                coverage: {
                  providersQueried: [],
                  providersUnavailable: ["retrieval"],
                  complete: false,
                },
                reason: "posting retrieval is temporarily unavailable",
                retryable: true,
              };
            }
            try {
              await deps.sessions.reconcileRetrievalState(
                session.id,
                generation,
                requestFingerprint,
                ownerToken,
                { requestFingerprint, recordedAt: new Date().toISOString(), result: current },
              );
            } catch {
              logPostingRetrievalFailure(app.log, "reconciliation_failed");
            }
            return current;
          })();
          retrievalsInFlight.set(session.id, {
            fingerprint: requestFingerprint,
            startedAtMs: Date.parse(claimWindow.claimedAt),
            result,
          });
          void result.then(
            () => {
              if (retrievalsInFlight.get(session.id)?.result === result) retrievalsInFlight.delete(session.id);
            },
            () => {
              logPostingRetrievalFailure(app.log, "background_failed");
              if (retrievalsInFlight.get(session.id)?.result === result) retrievalsInFlight.delete(session.id);
            },
          );
          // §2.6 forbids provider latency on the cards request. §2.8's session snapshot is the handoff:
          // the first uncached read fails closed while this one background task runs; later reads use
          // its CAS-persisted result. The map coalesces same-process duplicates, while SessionStore's
          // atomic claim prevents another process from spending for the same observed session state.
          retrieval = retrievalInProgress();
        }
      }
      // #107 (E5 slice 6, D5): the SAME (dimension, familyId) scope eligibilityDiscovery.ts's
      // years-experience question WRITES a real answer at — see resolveUserYears's own doc for why a
      // mismatched scope would silently do nothing. Reads `facts` (already fetched above by
      // discoveryReads) rather than a second store call — T1 (code review): one eligibility read per
      // request, not one per thing that needs it.
      const role = session.targetTitles[0] ?? null;
      const userYears = resolveUserYears(facts, session, role);
      const langs = readingLanguages(session);
      const postings = eligiblePostings(langs, sessionPostings(session, requestFingerprint));
      // #104: every eligible posting gets a requirement set now, not only the hand-curated ones —
      // resolveAdRequirements is fixture-first, reader-second, so the demo-8-cards-to-16 growth is
      // exactly this loop widening from "the fixture set" to "every posting the session can read".
      // #105 review finding 5: unlike the ad-read cache (shared across every session that sees a
      // given advert — one visitor's read warms the cache for the next), the judgement cache is keyed
      // per-SESSION fact set and never warms across users. An uncapped Promise.all here turns "N
      // concurrent visitors load the deck" into N × pool-size simultaneous model calls, and the
      // failure mode is what makes this worth capping now rather than at the live-retrieval ticket: a
      // rate-limit storm makes judging fail, which silently falls back to the deterministic tick,
      // exactly under the load where the honest number matters most. mapWithConcurrency below is a
      // small local limiter, not a redesign — it still resolves every posting, just not all at once.
      //
      // #105 review round 4: that same concurrency cap creates WAVES (15 postings at a cap of 6 is
      // three), and each wave used to get its own fresh READ_TIMEOUT_MS allowance for judging — worst
      // case, wave-count × READ_TIMEOUT_MS, comfortably over the web proxy's 30s deadline, and getting
      // WORSE as the pool grows. judgeDeadline (computed below, AFTER the free peek phase — #117
      // must-fix C) is a single wall-clock budget for the PAID judging phase, passed to every
      // resolveJudgement call — see DECK_JUDGE_BUDGET_MS's own comment for the number and why. Ad
      // reads keep their own unchanged per-call READ_TIMEOUT_MS (they warm across every session that
      // sees a given advert, so a cold read is the rare case this fix isn't targeting, not the
      // routine one judging's per-session cache guarantees on every new visitor).
      // Phase 1, unchanged from before #117: resolve EVERY eligible posting's OWN requirements.
      // Reading an advert is shared across every visitor who ever sees it (adRequirementsStore's own
      // cache), so there is no cost reason to bound THIS step — only the per-session judging step
      // below is capped.
      const resolvedReqs = await mapWithConcurrency(postings, CARD_RESOLUTION_CONCURRENCY, async (posting) => {
        const adReq = await resolveAdRequirements(posting.id, deps.readAd, posting);
        // Same dual gate as before #104: the posting's own language (already true via
        // eligiblePostings) AND, separately, the requirement set's OWN stated language (#103 code
        // review finding 5) — unchanged by widening the source from "fixtures only" to
        // "fixture or freshly read".
        if (!adReq || !languageEligible(adReq.language, langs)) return null;
        return { posting, adReq };
      });
      const candidates = resolvedReqs.filter(
        (entry): entry is { posting: Posting; adReq: AdRequirementsV1 } => entry !== null,
      );

      // #107 (E5 slice 6, D3/D4) — withdraw a posting from THIS session's deck BEFORE it costs
      // anything: right after requirements resolve, before ranking, the free peek, or a paid judging
      // attempt ever sees it. Matches AC1's "the posting does not appear... whatever its score" and
      // the AC that a withdrawn card must never cost a model call. findWithdrawingRequirement
      // (withdrawal.ts) is pure — it only reads `facts`, this session's ALREADY-READ eligibility
      // facts (discoveryReads above), against each candidate's own requirement set; no IO of its own.
      // deck.cards_withdrawn (counters.ts) is AC6's own number: over-firing shows up as a rising
      // count an operator can see, not as jobs quietly disappearing.
      //
      // #123 (coordinator, 2026-08-04) — the reveal's "N jobs needed Mandarin" undo line needs the
      // withdrawal COUNT, not just an operator metric (deck.cards_withdrawn is process-wide, not
      // per-response, and names no language). Tallied HERE, inside the SAME filter pass that already
      // decides a posting's fate — no second pass over `candidates`, no second eligibility read; this
      // only ACCUMULATES what findWithdrawingRequirement reports, never re-decides anything. Scoped to
      // `candidates` (postings already past every OTHER exclusion) means a posting excluded for any
      // other reason can never be miscounted as a language withdrawal (this must mean "cost you a
      // job", not "excluded, for any reason, and also happened to have a language answer").
      const withdrawnTotal = { count: 0 };
      const withdrawnByLanguage = new Map<string, number>();
      const openCandidates = candidates.filter((entry) => {
        const req = findWithdrawingRequirement(entry.adReq, facts, entry.posting.location);
        if (!req) return true;
        incrementCounter("deck.cards_withdrawn");
        withdrawnTotal.count++;
        if (req.eligibilityDimension === "language" && req.eligibilitySubject) {
          // Render-ready casing: the requirement's OWN eligibilitySubject is whatever the ad reader
          // produced ("mandarin", " Mandarin "), not necessarily how the visitor's tick-box read. The
          // matching fact's `familyId` is the STORE's own canonical scope — exactly what
          // languageFacts() wrote from languagesUnion() — so it's the same word the visitor ticked.
          // This re-derives the SAME (normalized) match findWithdrawingRequirement already made
          // internally; `facts` is the identical array it was given, so the match always succeeds.
          const normalizedSubject = normalizeScope(req.eligibilitySubject);
          const matchingFact = facts.find(
            (f) => f.dimension === "language" && normalizeScope(f.familyId) === normalizedSubject,
          );
          const language = matchingFact?.familyId ?? req.eligibilitySubject.trim();
          withdrawnByLanguage.set(language, (withdrawnByLanguage.get(language) ?? 0) + 1);
        }
        return false;
      });

      // #117 must-fix A (coordinator review, severe) — the PAID set is ranked over EVERY eligible
      // candidate, not just whatever peek (below) fails to resolve for free. Ranking over "unresolved"
      // was the bug: request 1 pays for the top 8, some land in the store; request 2's free peek
      // resolves those, which — if the paid set were re-derived from "still unresolved" — frees up 8
      // MORE slots for a fresh paid attempt, and a visitor who simply reloads the deck a few times
      // walks the paid set down the entire pool, paying for all 15 by the third or fourth poll —
      // exactly the ~$0.29 cold-deck spend this ticket exists to eliminate. Ranking over EVERY
      // candidate makes the paid set a PURE FUNCTION of (this fact set, these requirement sets) alone:
      // unchanged inputs always re-derive the IDENTICAL set, so once its members are stored, a repeat
      // poll finds all of them cached and pays for nothing further — the poll converges instead of
      // walking the pool. See DECK_JUDGE_MAX_CARDS's own comment for the bound; see the test
      // "MF-A: repeated identical polls never pay for more than the bound" for the property this fixes.
      //
      // KNOWN WEAKNESS, accepted deliberately: matchTick is the very token-overlap scorer #86/#105
      // exist to replace — it is blind to meaning (a candidate who "ran weekly steering meetings with
      // the CFO" scores 0% against "coordinate business and technical stakeholders" on this same
      // scorer, per #86's own Problem Statement). A genuinely strong match phrased in the candidate's
      // own words can therefore rank low on vocabulary and never make the paid set. This is a CHEAP
      // PRE-FILTER deciding what's worth paying to verify, not a verdict on the card itself — fixing
      // the pre-filter's own blindness is out of scope here and belongs with family-fit ranking
      // (#107), not this cost ticket.
      // deps.judgeMaxCards overrides DECK_JUDGE_MAX_CARDS when set (test-only in practice — main.ts
      // never sets it), so a test can construct a "pool exceeds the ceiling" scenario against the
      // REAL posting pool instead of adding synthetic entries to product data (#117 review).
      const judgeMaxCards = deps.judgeMaxCards ?? DECK_JUDGE_MAX_CARDS;
      const rankedAll = [...openCandidates].sort(
        (a, b) => matchTick(confirmed, b.adReq) - matchTick(confirmed, a.adReq),
      );
      if (rankedAll.length > judgeMaxCards) incrementCounter("deck.judge_bound_hit");
      const paidSet = new Set(rankedAll.slice(0, judgeMaxCards).map((entry) => entry.adReq.adId));

      // #117 must-fix 1 — peek is UNBOUNDED and runs over EVERY candidate, in or out of the paid set:
      // a stored judgement (an earlier visit, this exact ad tailored already, or another visitor with
      // byte-identical facts) costs nothing to read, so it must resolve for free regardless of rank.
      // deps.judgePeek (judge.ts's makeJudgePeek) is structurally incapable of spending, and absent
      // (every pre-must-fix-1 test) simply means nothing resolves for free, identical to before this
      // phase existed.
      const peeked = await mapWithConcurrency(openCandidates, CARD_RESOLUTION_CONCURRENCY, async (entry) => {
        const judgement = deps.judgePeek ? await deps.judgePeek(entry.adReq, confirmed) : null;
        return { ...entry, judgement };
      });

      // #117 must-fix C — the paid budget starts AFTER the free peek phase, not before it. Peek is up
      // to two store round-trips per candidate at CARD_RESOLUTION_CONCURRENCY; starting the deadline
      // earlier (as before this fix) charged that free work against the PAID budget, so a slow store
      // could exhaust judgeDeadline before a single paid call even began — every bounded card would
      // then be paid for AND still render `pending` (resolveJudgement's own remainingMs already 0).
      const judgeDeadline = Date.now() + DECK_JUDGE_BUDGET_MS;
      // Whether a judge is wired at all is a per-DEPLOYMENT fact (deps.judge), not a per-card one —
      // it decides whether an unresolved card claims the old deterministic number (today's
      // `estimated` behaviour, byte-for-byte, when no judge exists to be honest about) or claims none
      // at all (`pending`/`unscored`, once a judge is wired).
      const judgeWired = !!deps.judge;

      const resolved = await mapWithConcurrency(peeked, CARD_RESOLUTION_CONCURRENCY, async (entry) => {
        if (entry.judgement) return { ...entry, attempted: false }; // resolved for free above
        if (!paidSet.has(entry.adReq.adId)) {
          // #117 must-fix 2: deliberately never bought this request — `unscored`, not `pending`.
          return { ...entry, attempted: false };
        }
        // #105: judging is a SECOND per-posting async step, resolved only once the ad's own
        // requirements are known — but now ONLY for a candidate the paid set selected. Absent
        // deps.judge (or a failed/timed-out judgement) falls back per buildJobCard's own rule.
        const judgement = await resolveJudgement(entry.adReq, confirmed, deps.judge, judgeDeadline);
        return { ...entry, judgement, attempted: true };
      });
      const cardCandidates = resolved.map((entry) => ({
        card: buildJobCard(
          entry.posting,
          entry.adReq,
          confirmed,
          negatives,
          // #107 (D5): the years-experience shortfall, applied at read time — see withYearsShortfall's
          // own doc. A no-op pass-through when there's no judgement or the visitor's years were never
          // asked, so every pre-#107 case is byte-for-byte unchanged.
          withYearsShortfall(entry.judgement, entry.adReq, userYears),
          // #117 must-fix 2: a real paid attempt that missed the budget is `pending` (genuinely in
          // flight, will self-heal into the store); one the bound never attempted at all is
          // `unscored` (nothing coming unless a later request's own bound selects it).
          !judgeWired ? "estimated" : entry.attempted ? "pending" : "unscored",
        ),
        curated: entry.adReq.curated,
      }));
      const cards = orderCardsForReveal(cardCandidates);
      // #117 AC3/AC8 — the deck's own card-provenance tally, observable on /ops/spend (server.ts)
      // alongside cost per visitor from the SAME run. pendingCount also rides on the response itself
      // so the client can decide what to do about a still-scoring deck without polling counters —
      // must-fix 2: it counts ONLY genuinely in-flight (`pending`) cards, never `unscored` ones, so a
      // client polling on it terminates instead of waiting forever on a card that was never bought.
      let pendingCount = 0;
      for (const card of cards) {
        if (card.scored === "judged") incrementCounter("deck.cards_judged");
        else if (card.scored === "estimated") incrementCounter("deck.cards_estimated");
        else if (card.scored === "unscored") incrementCounter("deck.cards_unscored");
        else {
          incrementCounter("deck.cards_pending");
          pendingCount++;
        }
      }
      // #22: authed tells the client whether the account wall at the reveal applies — false only
      // for a still-anonymous session, so a returning (claimed) visitor is never re-walled.
      //
      // #123: `withdrawn` — the reveal's undo line reads this. `byLanguage` names ONLY languages that
      // actually caused a removal (a decline that removed nothing never appears), sorted desc by
      // count then language name asc; empty (never omitted) when nothing was withdrawn, so the client
      // can key "render no notice at all" off an unambiguous empty array rather than a missing field.
      const withdrawn = {
        total: withdrawnTotal.count,
        byLanguage: [...withdrawnByLanguage.entries()]
          .map(([language, count]) => ({ language, count }))
          .sort((a, b) => b.count - a.count || a.language.localeCompare(b.language)),
      };
      return {
        stage: session.stage,
        cards,
        pendingCount,
        authed: session.claimedByUserId !== null,
        withdrawn,
        retrieval,
      };
    });

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
      const [confirmed, negatives, , facts] = await discoveryReads(session.id);
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
      // #107 (D5): the years-experience shortfall, applied at read time — see applyYearsShortfall's
      // own doc (judgedScore.ts). Reads `facts` already fetched above — T1: one eligibility read.
      const judgement = withYearsShortfall(rawJudgement, adReq, resolveUserYears(facts, session, role));
      const state = buildTailorState(
        posting,
        adReq,
        confirmed,
        negatives,
        role,
        session.tailorFloorPct,
        judgement,
      );
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

        const [confirmed, negatives, , facts] = await discoveryReads(session.id);
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
        // #107 (D5): the years-experience shortfall, applied at read time — see applyYearsShortfall's
        // own doc (judgedScore.ts). Reads `facts` already fetched above — T1: one eligibility read.
        const judgement = withYearsShortfall(rawJudgement, adReq, resolveUserYears(facts, session, role));
        await deps.sessions.raiseTailorFloor(
          session.id,
          judgement ? judgedMatchTick(judgement.verdicts, adReq) : matchTick(confirmed, adReq),
        );
        const state = buildTailorState(
          posting,
          adReq,
          confirmed,
          negatives,
          role,
          session.tailorFloorPct,
          judgement,
        );
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
