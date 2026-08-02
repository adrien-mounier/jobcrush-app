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
import type { CandidateClaim, MinedRole, RankBand, AdRequirementsV1 } from "@jobcrush/contracts";
import { requireUser, requireSession } from "../server.js";
import type { ClaimStore, ClaimRecord } from "../claims.js";
import type { JobStore } from "../jobs.js";
import type { SessionStore, SessionRecord } from "../sessions.js";
import { buildClaimGraph, kindTag } from "../graph.js";
import { renderRootCv, SECTIONS } from "../rootcv.js";
import { runGate } from "../gate.js";
import { answerToClaim, detectGaps, templateQuestion, type GrillPhraser } from "../grill.js";
import { auditRootCv, type CvAuditor } from "../audit.js";
import { loadFamilyFloor, loadAdRequirements } from "../e5stub.js";
import { eligiblePostings, type Posting } from "../preview.js";
import { readingLanguages, languageEligible } from "../language.js";
import { incrementCounter, recordReadFailure } from "../counters.js";
import { matchBreakdown, matchTick, uncoveredRequirements, pickHitClause, pickOpenClause, NOTHING_OPEN_CLAUSE } from "../matchtick.js";
import {
  judgedBreakdown,
  judgedMatchTick,
  judgedPickHitClause,
  judgedUncoveredRequirements,
} from "../judgedScore.js";
import type { JudgeFact, JudgeFn } from "../judge.js";
import type { JudgementRecord } from "../judgementStore.js";
import {
  composeCvLine,
  discoveryClaimId,
  discoveryCvLines,
  discoveryState,
  factCount,
  freeTextLine,
  isNoAnswer,
  READER_ROLE_ITEM_ID,
  readerQuestion,
  resolveFamily,
  type DiscoveryCvLine,
} from "../discovery.js";
import {
  buildTailorLedger,
  composeTailorLine,
  negativeRequirementIds,
  tailorClaimId,
  tailorCvLines,
  tailorQuestions,
  type LedgerLine,
  type TailorQuestion,
} from "../tailor.js";
import { FamilyPlacement } from "@jobcrush/contracts";
import {
  adaptiveDiscoveryState,
  confirmedFixtureFloorReference,
  fixtureDiscoveryClaimId,
} from "../adaptiveDiscovery.js";
import type { ProductionFamilyFloorStore, TestFixtureFamilyFloorStore } from "../familyFloors.js";

export interface OnboardingDeps {
  claims: ClaimStore;
  store: JobStore;
  sessions: SessionStore;
  familyFloors: TestFixtureFamilyFloorStore;
  productionFamilyFloors: ProductionFamilyFloorStore;
  placeFamily: (session: Readonly<SessionRecord>) => Promise<FamilyPlacement>;
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
    // requireUser — an unverified visitor can already open their own profile). Colour law: a fact is
    // gold iff its claim id appears in the rendered root CV's trace. That trace is derived from the
    // same confirmed renderable facts as /onboarding/build; grey otherwise means mined-but-not-yet-
    // confirmed, i.e. still `pending` in the deck. Rejected/negative claims are stripped entirely
    // (AC5): the profile never lists what the visitor lacks, while negatives still count in factCount.
    app.get("/profile", async (req) => {
      const session = requireSession(req);
      const facts = (await deps.claims.list(session.id)).filter(
        (c) => c.decision !== "rejected" && c.decision !== "negative",
      );
      const confirmed = facts.filter((c) => c.decision === "confirmed");
      const negatives = await deps.claims.negatives(session.id);
      const profileFactCount = await withFactFloor(deps.sessions, session, factCount(confirmed, negatives));
      const rootCv = renderRootCv(buildClaimGraph(confirmed));
      const goldIds = new Set(rootCv.trace.entries.flatMap((e) => e.nodeIds));

      const byTag = new Map<string, ProfileFact[]>();
      for (const c of facts) {
        const tag = kindTag(c);
        const bucket = byTag.get(tag) ?? [];
        bucket.push({
          id: c.id,
          text: c.text,
          colour: goldIds.has(c.id) ? "gold" : "grey",
          source: c.origin === "user-authored" ? "told" : "read",
        });
        byTag.set(tag, bucket);
      }

      const domains: ProfileDomain[] = SECTIONS.filter(([tag]) => byTag.has(tag)).map(([tag, heading]) => ({
        tag,
        heading,
        facts: byTag.get(tag)!,
      }));
      const payload: ProfileState = { domains, factCount: profileFactCount };
      return payload;
    });

    // --- #16 discovery (screen 1a): the answer→CV-line→section-bar loop -------------------------
    // Pre-wall, so it rides the ANONYMOUS session (requireSession, not requireUser): the account ask
    // is after the reveal (spec §12), and answers persist server-side from question 1 (story #76).
    // The whole screen is a pure function of the session's role (Q1) + its recorded discovery answers,
    // so every response is `discoveryState(...)` and GET resumes with no client state.

    // Third element (rejected) is #35's addition: no new store method — filter the existing list()
    // rather than add a ClaimStore.rejected(). Kept in this one Promise.all (not a separate serialized
    // read) so a Pg-backed read still fires all three queries in parallel; callers that don't need it
    // (cards, tailor) just destructure the first two.
    const discoveryReads = (sessionId: string) =>
      Promise.all([
        deps.claims.confirmed(sessionId),
        deps.claims.negatives(sessionId),
        deps.claims.list(sessionId).then((all) => all.filter((c) => c.decision === "rejected")),
      ]);

    // Load / resume: rebuild the state from the store. Before Q1 (no role) → the empty skeleton state.
    // #18 AC6: an optional ?job= prepends the ONE reader-only question — over the uploaded CV's mined
    // roles — as long as it's this session's job, it has mined roles, and it isn't answered yet (never
    // re-ask). A missing/foreign/role-less job just omits it; this route never errors on a bad ?job=.
    app.get(
      "/onboarding/discovery",
      { schema: { querystring: z.object({ job: z.string().optional() }) } },
      async (req) => {
        const session = requireSession(req);
        const [confirmed, negatives, rejected] = await discoveryReads(session.id);
        const state = discoveryState(session.targetTitles[0] ?? null, confirmed, negatives, rejected);

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
        const [confirmed, negatives, rejected] = await discoveryReads(session.id);
        const state = discoveryState(req.body.role, confirmed, negatives, rejected);
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
      { schema: { body: z.object({ itemId: z.string(), answer: z.string().trim().min(1) }) } },
      async (req, reply) => {
        const session = requireSession(req);
        const role = session.targetTitles[0] ?? null;
        if (!role)
          return reply.status(409).send({ error: { code: "no_role", message: "answer question 1 first" } });

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
            text: freeTextLine(req.body.answer),
            machine_touch: "verbatim",
            classification: "Verified",
            source_quote: req.body.answer.slice(0, 200),
            needs_grill: false,
            grill_hint: null,
          };
        } else {
          const { family } = resolveFamily(role);
          const item = loadFamilyFloor(family).items.find((i) => i.id === req.body.itemId);
          if (!item)
            return reply.status(404).send({ error: { code: "unknown_item", message: "no such floor item" } });

          no = isNoAnswer(req.body.answer);
        claim = {
          id: discoveryClaimId(item.id),
          semantic_key: discoveryClaimId(item.id),
          field_key: null,
          field_value: null,
          field_label: null,
            role: "profile",
            text: no ? `Not applicable — ${item.question}` : composeCvLine(item, req.body.answer),
            machine_touch: "verbatim", // the visitor's own answer
            classification: "Verified", // user-authored, they vouch for it
            source_quote: req.body.answer.slice(0, 200),
            needs_grill: false,
            grill_hint: null,
          };
        }
        if (no) await deps.claims.answerNegative(session.id, claim);
        else await deps.claims.add(session.id, claim);

        const [confirmed, negatives, rejected] = await discoveryReads(session.id);
        const state = discoveryState(role, confirmed, negatives, rejected);
        // #18 AC1: the essential band fully asked (yes or no) flips the session to the deck stage, so
        // a reload lands there too. essentialRemaining never climbs back up (#35: a deck reject still
        // counts as answered), so this never reverts.
        if (state.essentialRemaining === 0) await deps.sessions.setStage(session.id, "deck");
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
      const [confirmed, negatives] = await discoveryReads(session.id);
      const langs = readingLanguages(session);
      const postings = eligiblePostings(langs);
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
      // WORSE as the pool grows. judgeDeadline is a single wall-clock budget for the WHOLE request's
      // judging phase, computed once here and passed to every resolveJudgement call below — see
      // DECK_JUDGE_BUDGET_MS's own comment for the number and why. Ad reads keep their own unchanged
      // per-call READ_TIMEOUT_MS (they warm across every session that sees a given advert, so a cold
      // read is the rare case this fix isn't targeting, not the routine one judging's per-session
      // cache guarantees on every new visitor).
      const judgeDeadline = Date.now() + DECK_JUDGE_BUDGET_MS;
      const resolved = await mapWithConcurrency(postings, CARD_RESOLUTION_CONCURRENCY, async (posting) => {
        const adReq = await resolveAdRequirements(posting.id, deps.readAd, posting);
        // Same dual gate as before #104: the posting's own language (already true via
        // eligiblePostings) AND, separately, the requirement set's OWN stated language (#103 code
        // review finding 5) — unchanged by widening the source from "fixtures only" to
        // "fixture or freshly read".
        if (!adReq || !languageEligible(adReq.language, langs)) return null;
        // #105: judging is a SECOND per-posting async step, resolved only once the ad's own
        // requirements are known — absent deps.judge (or a failed/timed-out judgement) falls back
        // to today's deterministic tick inside buildJobCard, never dropping the card.
        const judgement = await resolveJudgement(adReq, confirmed, deps.judge, judgeDeadline);
        return { posting, adReq, judgement };
      });
      const cardCandidates = resolved
        .filter(
          (entry): entry is { posting: Posting; adReq: AdRequirementsV1; judgement: JudgementRecord | null } =>
            entry !== null,
        )
        .map((entry) => ({
          card: buildJobCard(entry.posting, entry.adReq, confirmed, negatives, entry.judgement),
          curated: entry.adReq.curated,
          // #105 review round 4: a card scored by a real judgement and one that fell back to the
          // deterministic tick come from two different scorers whose numbers are not comparable —
          // ranking them in one score-sorted list put an over-scoring fallback card (the one job we
          // had NO real verdict for) ahead of honestly-judged ones. orderCardsForReveal groups on
          // this before it sorts by score.
          judged: entry.judgement !== null,
        }));
      const cards = orderCardsForReveal(cardCandidates);
      // #22: authed tells the client whether the account wall at the reveal applies — false only
      // for a still-anonymous session, so a returning (claimed) visitor is never re-walled.
      return { stage: session.stage, cards, authed: session.claimedByUserId !== null };
    });

    app.post(
      "/onboarding/cards/:adId/want",
      { schema: { params: z.object({ adId: z.string() }) } },
      async (req, reply) => {
        const session = requireUser(req);
        // #103: an ad this session's languages can't read isn't a valid want target either, even if
        // guessed directly by id — same dual gate (posting AND requirement-set language) as the deck.
        const langs = readingLanguages(session);
        const posting = eligiblePostings(langs).find((p) => p.id === req.params.adId);
        const adReq = posting ? await resolveAdRequirements(posting.id, deps.readAd, posting) : null;
        const knownCard = !!adReq && languageEligible(adReq.language, langs);
        if (!knownCard)
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
      const target = await tailorTarget(session, adId, deps.readAd);
      if (!target)
        return reply.status(404).send({ error: { code: "not_found", message: "unknown card" } });
      const { posting, adReq } = target;
      const [confirmed, negatives] = await discoveryReads(session.id);
      const judgement = await resolveJudgement(adReq, confirmed, deps.judge);
      const state = buildTailorState(
        posting,
        adReq,
        confirmed,
        negatives,
        session.targetTitles[0] ?? null,
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
        const target = await tailorTarget(session, adId, deps.readAd);
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

        const [confirmed, negatives] = await discoveryReads(session.id);
        // #105 decision 7: the floor is raised from the HONEST number when a judgement is available
        // — the answer just added changed the fact set, so this is a fresh (adId, fingerprint), never
        // a cache hit reusing a stale judgement. Falls back to matchTick when no judge is wired.
        const judgement = await resolveJudgement(adReq, confirmed, deps.judge);
        await deps.sessions.raiseTailorFloor(
          session.id,
          judgement ? judgedMatchTick(judgement.verdicts, adReq) : matchTick(confirmed, adReq),
        );
        const state = buildTailorState(
          posting,
          adReq,
          confirmed,
          negatives,
          session.targetTitles[0] ?? null,
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

// --- #20 profile shape (the pinned frontend contract, apps/web/lib/api.ts) -------------------------
interface ProfileFact {
  id: string;
  text: string;
  colour: "gold" | "grey";
  source: "told" | "read";
}
interface ProfileDomain {
  tag: string;
  heading: string;
  facts: ProfileFact[];
}
interface ProfileState {
  domains: ProfileDomain[];
  factCount: number;
}

// --- #19 card shape (the pinned frontend contract) -----------------------------------------------
interface CardFact {
  id: string;
  text: string;
}
interface CardRequirement {
  id: string;
  band: RankBand;
  requirement: string;
}
interface JobCard {
  schemaVersion: "1";
  adId: string;
  title: string;
  company: string;
  place: string;
  salary: string | null; // absent in the stub postings — always null for now
  pattern: string | null; // absent in the stub postings — always null for now
  matchPct: number;
  breakdown: ReturnType<typeof matchBreakdown>;
  bubble: { hit: string; open: string };
  fit: CardFact[];
  dontYet: CardRequirement[];
  askedClosed: CardFact[];
  adExcerpt: string;
}

/** Score-sort the deck, with two exceptions, applied in order:
 *  1. #105 review round 4 — a JUDGED card ranks as a GROUP above every card that fell back to the
 *     deterministic tick. The two numbers come from different scorers (one meaning-aware, one
 *     token-overlap, which measurably over-scores) and are not comparable, so mixing them into one
 *     score-sorted list is apples-to-oranges — a fallback card floating to the top puts the visitor's
 *     headline card on the ONE job the deck understands least. Score order is preserved WITHIN each
 *     group; this is a grouping ahead of the score sort, not a replacement for it.
 *  2. The curated-opener promotion (#19, untouched by this review — #111/slice 10 owns retiring it):
 *     its opener is still the best launch-safe card, operating on the grouped-then-scored list exactly
 *     as it always has on the plain score-sorted one. */
export function orderCardsForReveal<T extends { matchPct: number }>(
  entries: Array<{ card: T; curated: boolean; judged: boolean }>,
): T[] {
  const scoreSorted = [...entries].sort((a, b) => {
    if (a.judged !== b.judged) return a.judged ? -1 : 1;
    return b.card.matchPct - a.card.matchPct;
  });
  const openerIndex = scoreSorted.findIndex((entry) => entry.curated);
  if (openerIndex > 0) {
    const [opener] = scoreSorted.splice(openerIndex, 1);
    scoreSorted.unshift(opener!);
  }
  return scoreSorted.map((entry) => entry.card);
}

// #105 review finding 5: the deck route's own concurrency cap over per-posting resolution (read +
// judge). A small, fixed number — not tuned against a measured provider limit, just enough to turn
// "one deck request" from an unbounded burst into a bounded one. Revisit alongside live retrieval
// (#99-#101), which will need real capacity numbers this fixture pool's size never forced.
const CARD_RESOLUTION_CONCURRENCY = 6;

// #105 review round 4: a SHARED wall-clock budget for the whole deck's judging phase, not an
// independent READ_TIMEOUT_MS handed to every card. CARD_RESOLUTION_CONCURRENCY creates WAVES — 15
// postings at a cap of 6 is three — and each wave used to get its own fresh 15s allowance, so the
// worst case stacked to wave-count × READ_TIMEOUT_MS (45s for 3 waves), well past the web proxy's 30s
// deadline, and getting worse as the pool grows. Because the judgement cache is keyed on the
// visitor's OWN fact set, it never warms across users the way the ad-read cache does — a cold judging
// phase isn't a rare edge case on staging, it's the ROUTINE case for a first-time visitor. 8s, not
// 15s and not per-wave: generous enough that a normally-responding judge call (low single-digit
// seconds against a live provider) still completes, small enough that even added to the read phase's
// own separate, unchanged worst case there is wide margin under 30s, and — the property that actually
// matters — a single WALL-CLOCK deadline shared across every card by resolveJudgement's optional
// `deadlineAt` param, so the total time this phase can spend is bounded by this one number regardless
// of how many waves the concurrency cap creates or how large the posting pool grows.
const DECK_JUDGE_BUDGET_MS = 8_000;

/** A tiny concurrency limiter — no new dependency, not a redesign. Runs `fn` over `items` with at
 *  most `limit` in flight at once, preserving each result at its original index regardless of which
 *  worker finished it. Exists because the judgement cache (unlike the ad-read cache) is keyed per
 *  SESSION fact set and never warms across users, so an uncapped Promise.all here turns concurrent
 *  visitors into a multiplied burst of model calls (see CARD_RESOLUTION_CONCURRENCY's use above). */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// #104 review finding 10: an injected reader has no timeout of its own (a real provider call could
// hang indefinitely), and the deck route awaits every posting's resolution before responding — one
// hung advert would hang the app's main screen for everyone hitting it, not just the one card.
// Exported so the race itself is directly testable with a short ms value; a real 15s wait has no
// place in this suite.
const READ_TIMEOUT_MS = 15_000;

/** Distinguishes withReadTimeout's OWN manufactured rejection from whatever `promise` itself might
 *  reject with (#115 AC2/#115 counter split) — resolveAdRequirements below tells a deadline from a
 *  genuine read failure by `instanceof`, not by matching the error's message text. With the real
 *  makeAdReader-built reader (adReader.ts), `promise` should never itself reject — every internal
 *  failure there is already caught and turned into a null return — so in practice this is expected
 *  to be the only way resolveAdRequirements's catch below fires. That is an expectation about
 *  today's ONE production wiring, not a guarantee this type enforces: `readAd` is a plain function
 *  type any implementation (a test fake, a future reader) can satisfy by rejecting, so the catch
 *  below still handles that case rather than assuming it away. */
export class ReadTimeoutError extends Error {}

export function withReadTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ReadTimeoutError(`ad read timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** #104: the ONE place a posting's requirements resolve — fixture first (hand-curated, pinned),
 *  else the injected reader. Used by the deck, /want, and tailorTarget so a card the user can see
 *  is always resolvable the same way everywhere, never a 404/500 for a job the deck itself just
 *  rendered because a different call site resolved it differently. `readAd` absent (no dep wired)
 *  or the read itself failing both fall through to "no requirements for this posting" rather than
 *  throwing — a route 500 is worse than one missing card. A read that hangs past READ_TIMEOUT_MS is
 *  dropped for THIS request exactly like any other unreadable advert, but it is not counted as one
 *  (#115): the underlying read (makeAdReader's own promise, still running — nothing here or in
 *  withReadTimeout cancels it) keeps going after the deadline fires, still validates, and still
 *  persists to the store on success, so the advert is cached for the next request. That is a slow
 *  first read, not a failed one — postings.read_failed (the read-failure alarm's numerator) is
 *  reserved for a read that produced nothing usable at all, same distinction #103 already drew for
 *  language skips. See counters.ts's header for the full reasoning. */
async function resolveAdRequirements(
  adId: string,
  readAd: OnboardingDeps["readAd"],
  posting: Posting,
): Promise<AdRequirementsV1 | null> {
  try {
    return loadAdRequirements(adId);
  } catch {
    if (!readAd) return null;
    try {
      const result = await withReadTimeout(readAd(posting), READ_TIMEOUT_MS);
      // Settled before the deadline — whatever it settled to (a real result, or a null already
      // counted as postings.read_failed inside makeAdReader). This is the timeout alarm's OTHER
      // half (counters.ts): a promptness signal, deliberately decoupled from validity.
      incrementCounter("postings.read_in_time");
      return result;
    } catch (err) {
      if (err instanceof ReadTimeoutError) {
        incrementCounter("postings.read_timed_out");
        recordReadFailure(adId, "timeout", err.message);
      } else {
        // Not the timeout — readAd itself rejected. The production reader never does this (see
        // ReadTimeoutError's doc above), so this branch is untested territory for it; classified
        // "reader-rejected" rather than "model-call-error" because this call site has no visibility
        // into WHY a non-standard readAd implementation rejected, and "model-call-error" is
        // adReader.ts's own claim about a specific, known cause this site cannot actually vouch for.
        incrementCounter("postings.read_failed");
        recordReadFailure(adId, "reader-rejected", err instanceof Error ? err.message : String(err));
      }
      return null;
    }
  }
}

/** #105: the ONE place a posting's judgement resolves for a session's current fact set — mirrors
 *  resolveAdRequirements's shape and reuses its withReadTimeout discipline (a hung judgement must not
 *  hang the whole deck for every card behind it). `judge` absent (no dep wired — every pre-#105 test)
 *  returns null with NO counter movement, same as deps.readAd being absent: that's a deployment/test
 *  configuration, not an operational failure. `judge` present but the call rejects (the timeout race)
 *  OR resolves to null (judge.ts's makeJudge already counted and logged WHY internally) both count
 *  judge.fallback_used — the fallback rate #105's AC asks to be observable — and both fall back to
 *  the caller using the deterministic tick rather than dropping the card or fabricating a number.
 *  judge.fallback_timeout is ADDITIONALLY counted on the timeout race specifically (#105 review,
 *  cheap fix): a judge hanging on every card and a judge cleanly returning null are different
 *  operational signals — one says the model/network is slow or down, the other says judging itself
 *  failed — and folding both into one counter made them indistinguishable, the same distinction
 *  resolveAdRequirements already draws between postings.read_timed_out and postings.read_failed.
 *  Note: unlike readAd's negatives param (dropped from judge.ts's own signature entirely — #105
 *  review finding 2, a negative never reaches the model and never belongs in the judgement cache
 *  key), this function only ever needs `confirmed`.
 *
 *  `deadlineAt` (#105 review round 4): an absolute epoch-ms deadline this call's own timeout budget
 *  is computed FROM, rather than a fixed READ_TIMEOUT_MS every call gets independently. Defaults to
 *  "a fresh READ_TIMEOUT_MS from right now" — today's exact single-card behavior — for the tailor
 *  routes below, which resolve one posting per request and have no wave-stacking problem to guard
 *  against. The deck route passes one deadline computed ONCE, shared across its whole fan-out
 *  (DECK_JUDGE_BUDGET_MS's own comment has the full reasoning): each call gets whatever's left of
 *  that ONE shared budget, so a card resolved in a later concurrency-cap wave gets correspondingly
 *  less time, and a call that starts after the budget is already spent gets ~0ms — an almost-instant
 *  fallback rather than another full wait. */
async function resolveJudgement(
  adReq: AdRequirementsV1,
  confirmed: JudgeFact[],
  judge: OnboardingDeps["judge"],
  deadlineAt: number = Date.now() + READ_TIMEOUT_MS,
): Promise<JudgementRecord | null> {
  if (!judge) return null;
  try {
    const remainingMs = Math.max(0, deadlineAt - Date.now());
    const result = await withReadTimeout(judge(adReq, confirmed), remainingMs);
    if (!result) incrementCounter("judge.fallback_used");
    return result;
  } catch (err) {
    incrementCounter("judge.fallback_used");
    if (err instanceof ReadTimeoutError) incrementCounter("judge.fallback_timeout");
    return null;
  }
}

/** Pure composition, no LLM: matchtick.ts (or, when a judgement is available, judgedScore.ts) scores
 *  + ranks, this just shapes the pinned JobCard. #105 decision 1: matchPct/breakdown/dontYet/bubble.hit
 *  all switch to the judged relation together when `judgement` is present, falling back to today's
 *  deterministic tick, byte-for-byte, when it's null (no judge wired, or this card's judgement fell
 *  back per resolveJudgement above). This card carries NO floor of its own (buildJobCard's matchPct
 *  is never clamped against a prior value) — #105 review: an earlier version of this comment claimed
 *  "never a decreasing floor", which is wrong and was corrected. That guarantee was never true here,
 *  and the spec deliberately does not want it to be: the OLD unconditional monotonic floor is
 *  superseded by persistence plus recompute-on-real-change (a correction that genuinely lowers fit
 *  DOES lower the score — "becomes a lie once corrections are honoured"). The one floor mechanism
 *  that still exists — buildTailorState's Math.max(…, tailorFloorPct) — is untouched by this slice,
 *  not extended to buildJobCard, and not removed (#105 out of scope; slice 10 owns retiring it).
 *  #29: the negative-filter lives HERE, not in the tailor assembly. A requirement answered "no" while
 *  tailoring is asked-and-closed on every surface that renders this ad — spec #37, "the list of open
 *  things only ever shrinks". #23 applied it in the tailor assembly alone, deliberately, to keep #19's
 *  deck payload byte-identical while that shipped; both callers want it now, so it moves down to the
 *  shared function rather than being duplicated in each. For an ad the visitor never tailored the set
 *  is empty (tailorClaimId is scoped by adId), so those cards are unchanged. This filter applies
 *  identically to a judged dontYet list — an explicit negative is answered-and-closed regardless of
 *  which relation produced the open list it's being filtered out of. */
function buildJobCard(
  posting: Posting,
  adReq: AdRequirementsV1,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  judgement: JudgementRecord | null,
): JobCard {
  const negativeIds = negativeRequirementIds(adReq, negatives);
  const dontYet = (judgement ? judgedUncoveredRequirements(judgement.verdicts, adReq) : uncoveredRequirements(confirmed, adReq))
    .filter((r) => !negativeIds.has(r.id))
    .map((r) => ({ id: r.id, band: r.band, requirement: r.requirement }));
  return {
    schemaVersion: "1",
    adId: posting.id,
    title: posting.title,
    company: posting.company,
    place: posting.location,
    salary: null,
    pattern: null,
    matchPct: judgement ? judgedMatchTick(judgement.verdicts, adReq) : matchTick(confirmed, adReq),
    breakdown: judgement ? judgedBreakdown(judgement.verdicts, adReq) : matchBreakdown(confirmed, adReq),
    // #23 D1, now shared: pickOpenClause is negative-blind (it only knows the ad/coverage relation),
    // so it can keep naming a requirement the visitor just declined. Take the open clause from the
    // already-filtered dontYet instead — same fallback as pickOpenClause's own.
    bubble: {
      hit: judgement ? judgedPickHitClause(judgement.verdicts, adReq, confirmed) : pickHitClause(confirmed, adReq),
      open: dontYet[0]?.requirement ?? NOTHING_OPEN_CLAUSE,
    },
    fit: confirmed.map((c) => ({ id: c.id, text: c.text })),
    dontYet,
    askedClosed: negatives.map((c) => ({ id: c.id, text: c.text })),
    adExcerpt: posting.excerpt,
  };
}

// --- #23 tailor shape (the pinned frontend contract) -----------------------------------------------
interface TailorState {
  card: JobCard;
  questions: TailorQuestion[];
  ledger: LedgerLine[];
  cvLines: DiscoveryCvLine[];
  closedGaps: { closed: number; asked: number };
  done: boolean;
  factCount: number;
}

/** This session's tailor target, resolved to its posting + requirements — or null if either is no
 *  longer present in the fixtures. tailorAdId is PERSISTED session state that can outlive the fixture
 *  pair that validated it at /onboarding/cards/:adId/want time (these are explicitly stubs awaiting
 *  E5, liable to be edited/reordered) — so a miss here is reachable, not impossible, and must fail
 *  closed with the same 404 that route already uses for an unknown card id. */
async function tailorTarget(
  session: Pick<SessionRecord, "id">,
  adId: string,
  readAd: OnboardingDeps["readAd"],
): Promise<{ posting: Posting; adReq: AdRequirementsV1 } | null> {
  // #103: same dual gate as the deck and /want — a persisted tailorAdId for a posting (or a
  // requirement set) this session's languages can no longer read (or never could) fails closed with
  // the existing "unknown card" 404.
  const langs = readingLanguages(session);
  const posting = eligiblePostings(langs).find((p) => p.id === adId);
  if (!posting) return null;
  // #104: a card the user can already see must be tailorable — fixture-or-reader via the same
  // shared resolver as the deck, so a newly-read (not hand-curated) advert doesn't 404 here just
  // because it never had a fixture.
  const adReq = await resolveAdRequirements(adId, readAd, posting);
  if (!adReq || !languageEligible(adReq.language, langs)) return null;
  return { posting, adReq };
}

/** Pure composition of TailorState — same split as buildJobCard: matchtick.ts (or judgedScore.ts,
 *  when `judgement` is available — #105 decision 1) + tailor.ts score/rank, this shapes the pinned
 *  response. matchPct obeys the monotonic floor (AC1): never the raw tick/judged score alone.
 *  tailorQuestions gets the SAME uncovered list buildJobCard's dontYet is built from, passed in
 *  explicitly (tailor.ts's own optional param) — a requirement the judge already considers met is
 *  never re-asked as a question just because the token-overlap tick alone wouldn't have covered it.
 *  The ledger (buildTailorLedger) is deliberately left untouched: it replays confirmed/negative
 *  answers ONE AT A TIME to say how many were still open at the moment each past answer landed, and a
 *  holistic per-request judgement has no equivalent historical snapshot to replay against — #105's
 *  own "explicitly out of scope" list names the ledger's BAND_WEIGHT shares for slice 10; the ledger
 *  as a whole stays on the deterministic path this slice, for the same reason. */
function buildTailorState(
  posting: Posting,
  adReq: AdRequirementsV1,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  role: string | null,
  floorPct: number,
  judgement: JudgementRecord | null,
): TailorState {
  const matchPct = Math.max(
    judgement ? judgedMatchTick(judgement.verdicts, adReq) : matchTick(confirmed, adReq),
    floorPct,
  );
  const uncovered = judgement
    ? judgedUncoveredRequirements(judgement.verdicts, adReq)
    : uncoveredRequirements(confirmed, adReq);
  const questions = tailorQuestions(adReq, confirmed, negatives, uncovered);
  const { ledger, closedGaps } = buildTailorLedger(adReq, confirmed, negatives);
  // B1 (a "no" closes the gap too, spec #37/#38) and D1 (the bubble's gap clause rewrites with it)
  // are both buildJobCard's job as of #29 — the deck card needs the same guarantee, so the filter
  // moved into the shared function instead of being applied here on top.
  const card = buildJobCard(posting, adReq, confirmed, negatives, judgement);

  // B2: "the CV below" must include tailor's own answers, not just discovery's — discoveryCvLines is
  // the narrow slice of discoveryState's work this needs (no railFill/essentialRemaining/questions
  // rebuild for fields tailor can't use). Before Q1 (role null — structurally unreachable in tailor,
  // since reaching it requires discovery's essential band asked, but kept honest) discovery contributes
  // nothing, same as discoveryState's own empty-skeleton branch.
  const discoveryLines = role ? discoveryCvLines(role, loadFamilyFloor(resolveFamily(role).family).items, confirmed) : [];
  const cvLines = [...discoveryLines, ...tailorCvLines(adReq, confirmed)];

  return {
    card: { ...card, matchPct },
    questions,
    ledger,
    cvLines,
    closedGaps,
    done: questions.length === 0,
    factCount: factCount(confirmed, negatives),
  };
}
