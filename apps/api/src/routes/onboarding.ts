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
import type { CandidateClaim, MinedRole, RequirementBand, AdRequirements } from "@jobcrush/contracts";
import { requireUser, requireSession } from "../server.js";
import type { ClaimStore, ClaimRecord } from "../claims.js";
import type { JobStore } from "../jobs.js";
import type { SessionStore, SessionRecord } from "../sessions.js";
import { buildClaimGraph, kindTag } from "../graph.js";
import { renderRootCv, SECTIONS } from "../rootcv.js";
import { runGate } from "../gate.js";
import { answerToClaim, detectGaps, templateQuestion, type GrillPhraser } from "../grill.js";
import { auditRootCv, type CvAuditor } from "../audit.js";
import { loadFamilyFloor, listAdRequirements, loadAdRequirements } from "../e5stub.js";
import { loadPostings, type Posting } from "../preview.js";
import { matchBreakdown, matchTick, uncoveredRequirements, pickHitClause, pickOpenClause, NOTHING_OPEN_CLAUSE } from "../matchtick.js";
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
    // the client decides when to show it. Cards = every posting with a stubbed AdRequirements
    // entry (the E5 boundary, e5stub.ts), joined by adId and scored by matchtick.ts against this
    // session's confirmed/negative claims — no LLM, no IO beyond the two fixture loads.
    app.get("/onboarding/cards", async (req) => {
      const session = requireSession(req);
      const [confirmed, negatives] = await discoveryReads(session.id);
      const postings = loadPostings();
      const cardCandidates = listAdRequirements()
        .map((adReq) => {
          const posting = postings.find((p) => p.id === adReq.adId);
          return posting
            ? { card: buildJobCard(posting, adReq, confirmed, negatives), curated: adReq.curated }
            : null;
        })
        .filter((entry): entry is { card: JobCard; curated: boolean } => entry !== null);
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
        const postingIds = new Set(loadPostings().map((p) => p.id));
        const knownCard = listAdRequirements().some(
          (adReq) => adReq.adId === req.params.adId && postingIds.has(adReq.adId),
        );
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
      const target = tailorTarget(adId);
      if (!target)
        return reply.status(404).send({ error: { code: "not_found", message: "unknown card" } });
      const { posting, adReq } = target;
      const [confirmed, negatives] = await discoveryReads(session.id);
      const state = buildTailorState(
        posting,
        adReq,
        confirmed,
        negatives,
        session.targetTitles[0] ?? null,
        session.tailorFloorPct,
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
        const target = tailorTarget(adId);
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
        await deps.sessions.raiseTailorFloor(session.id, matchTick(confirmed, adReq));
        const state = buildTailorState(
          posting,
          adReq,
          confirmed,
          negatives,
          session.targetTitles[0] ?? null,
          session.tailorFloorPct,
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
  band: RequirementBand;
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

/** Score-sort the deck, with one exception: its opener is the best launch-safe card. */
export function orderCardsForReveal<T extends { matchPct: number }>(
  entries: Array<{ card: T; curated: boolean }>,
): T[] {
  const scoreSorted = [...entries].sort((a, b) => b.card.matchPct - a.card.matchPct);
  const openerIndex = scoreSorted.findIndex((entry) => entry.curated);
  if (openerIndex > 0) {
    const [opener] = scoreSorted.splice(openerIndex, 1);
    scoreSorted.unshift(opener!);
  }
  return scoreSorted.map((entry) => entry.card);
}

/** Pure composition, no LLM: matchtick.ts scores + ranks, this just shapes the pinned JobCard.
 *  #29: the negative-filter lives HERE, not in the tailor assembly. A requirement answered "no" while
 *  tailoring is asked-and-closed on every surface that renders this ad — spec #37, "the list of open
 *  things only ever shrinks". #23 applied it in the tailor assembly alone, deliberately, to keep #19's
 *  deck payload byte-identical while that shipped; both callers want it now, so it moves down to the
 *  shared function rather than being duplicated in each. For an ad the visitor never tailored the set
 *  is empty (tailorClaimId is scoped by adId), so those cards are unchanged. */
function buildJobCard(
  posting: Posting,
  adReq: AdRequirements,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
): JobCard {
  const negativeIds = negativeRequirementIds(adReq, negatives);
  const dontYet = uncoveredRequirements(confirmed, adReq)
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
    matchPct: matchTick(confirmed, adReq),
    breakdown: matchBreakdown(confirmed, adReq),
    // #23 D1, now shared: pickOpenClause is negative-blind (it only knows the ad/coverage relation),
    // so it can keep naming a requirement the visitor just declined. Take the open clause from the
    // already-filtered dontYet instead — same fallback as pickOpenClause's own.
    bubble: {
      hit: pickHitClause(confirmed, adReq),
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
function tailorTarget(adId: string): { posting: Posting; adReq: AdRequirements } | null {
  const posting = loadPostings().find((p) => p.id === adId);
  if (!posting) return null;
  try {
    return { posting, adReq: loadAdRequirements(adId) };
  } catch {
    return null;
  }
}

/** Pure composition of TailorState — same split as buildJobCard: matchtick.ts + tailor.ts score/rank,
 *  this shapes the pinned response. matchPct obeys the monotonic floor (AC1): never the raw tick alone. */
function buildTailorState(
  posting: Posting,
  adReq: AdRequirements,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  role: string | null,
  floorPct: number,
): TailorState {
  const matchPct = Math.max(matchTick(confirmed, adReq), floorPct);
  const questions = tailorQuestions(adReq, confirmed, negatives);
  const { ledger, closedGaps } = buildTailorLedger(adReq, confirmed, negatives);
  // B1 (a "no" closes the gap too, spec #37/#38) and D1 (the bubble's gap clause rewrites with it)
  // are both buildJobCard's job as of #29 — the deck card needs the same guarantee, so the filter
  // moved into the shared function instead of being applied here on top.
  const card = buildJobCard(posting, adReq, confirmed, negatives);

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
