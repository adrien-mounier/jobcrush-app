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
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { CandidateClaim, MinedRole, RequirementBand, AdRequirements } from "@jobcrush/contracts";
import { requireUser, requireSession } from "../server.js";
import type { ClaimStore, ClaimRecord } from "../claims.js";
import type { JobStore } from "../jobs.js";
import type { SessionStore } from "../sessions.js";
import { buildClaimGraph } from "../graph.js";
import { renderRootCv } from "../rootcv.js";
import { runGate } from "../gate.js";
import { answerToClaim, detectGaps, templateQuestion, type GrillPhraser } from "../grill.js";
import { auditRootCv, type CvAuditor } from "../audit.js";
import { loadFamilyFloor, listAdRequirements } from "../e5stub.js";
import { loadPostings, type Posting } from "../preview.js";
import { matchTick, uncoveredRequirements, pickHitClause, pickOpenClause } from "../matchtick.js";
import {
  composeCvLine,
  discoveryClaimId,
  discoveryState,
  freeTextLine,
  isNoAnswer,
  READER_ROLE_ITEM_ID,
  readerQuestion,
  resolveFamily,
} from "../discovery.js";

export interface OnboardingDeps {
  claims: ClaimStore;
  store: JobStore;
  sessions: SessionStore;
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

        // Idempotent: seed only if this session has no claims yet, so decisions survive a reopen.
        if ((await deps.claims.list(session.id)).length === 0) {
          const mined = (job.progress.miner as { claims?: CandidateClaim[] } | undefined)?.claims;
          if (!mined?.length)
            return reply
              .status(409)
              .send({ error: { code: "not_ready", message: "claims not mined yet" } });
          await deps.claims.seed(session.id, mined);
        }
        const claims = (await deps.claims.list(session.id)).map((c) => ({
          ...c,
          tier: claimTier(c.machine_touch),
        }));
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
      // becomes a Negative/renderable:false node — absent from the root CV, but visible to the profile
      // screen (#20). Existing sessions have no negatives, so this is a no-op for them.
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

    // --- #16 discovery (screen 1a): the answer→CV-line→section-bar loop -------------------------
    // Pre-wall, so it rides the ANONYMOUS session (requireSession, not requireUser): the account ask
    // is after the reveal (spec §12), and answers persist server-side from question 1 (story #76).
    // The whole screen is a pure function of the session's role (Q1) + its recorded discovery answers,
    // so every response is `discoveryState(...)` and GET resumes with no client state.

    const discoveryReads = (sessionId: string) =>
      Promise.all([deps.claims.confirmed(sessionId), deps.claims.negatives(sessionId)]);

    // Load / resume: rebuild the state from the store. Before Q1 (no role) → the empty skeleton state.
    // #18 AC6: an optional ?job= prepends the ONE reader-only question — over the uploaded CV's mined
    // roles — as long as it's this session's job, it has mined roles, and it isn't answered yet (never
    // re-ask). A missing/foreign/role-less job just omits it; this route never errors on a bad ?job=.
    app.get(
      "/onboarding/discovery",
      { schema: { querystring: z.object({ job: z.string().optional() }) } },
      async (req) => {
        const session = requireSession(req);
        const [confirmed, negatives] = await discoveryReads(session.id);
        const state = discoveryState(session.targetTitles[0] ?? null, confirmed, negatives);

        const jobId = req.query.job;
        const readerAnswered = confirmed.some((c) => c.id === discoveryClaimId(READER_ROLE_ITEM_ID));
        if (jobId && !readerAnswered) {
          const job = await deps.store.get(jobId);
          const roles = job && job.sessionId === session.id ? minedRoles(job) : [];
          if (roles.length > 0) state.questions = [readerQuestion(roles[0]!), ...state.questions];
        }
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
        const [confirmed, negatives] = await discoveryReads(session.id);
        return discoveryState(req.body.role, confirmed, negatives);
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

        const [confirmed, negatives] = await discoveryReads(session.id);
        const state = discoveryState(role, confirmed, negatives);
        // #18 AC1: the essential band fully asked (yes or no) flips the session to the deck stage, so
        // a reload lands there too. essentialRemaining only ever counts down, so this never reverts.
        if (state.essentialRemaining === 0) await deps.sessions.setStage(session.id, "deck");
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
      const cards = listAdRequirements()
        .map((adReq) => {
          const posting = postings.find((p) => p.id === adReq.adId);
          return posting ? buildJobCard(posting, adReq, confirmed, negatives) : null;
        })
        .filter((c): c is JobCard => c !== null)
        .sort((a, b) => b.matchPct - a.matchPct); // best first
      // #22: authed tells the client whether the account wall at the reveal applies — false only
      // for a still-anonymous session, so a returning (claimed) visitor is never re-walled.
      return { stage: session.stage, cards, authed: session.claimedByUserId !== null };
    });
  };
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
  adId: string;
  title: string;
  company: string;
  place: string;
  salary: string | null; // absent in the stub postings — always null for now
  pattern: string | null; // absent in the stub postings — always null for now
  matchPct: number;
  bubble: { hit: string; open: string };
  fit: CardFact[];
  dontYet: CardRequirement[];
  askedClosed: CardFact[];
  adExcerpt: string;
}

/** Pure composition, no LLM: matchtick.ts scores + ranks, this just shapes the pinned JobCard. */
function buildJobCard(
  posting: Posting,
  adReq: AdRequirements,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
): JobCard {
  return {
    adId: posting.id,
    title: posting.title,
    company: posting.company,
    place: posting.location,
    salary: null,
    pattern: null,
    matchPct: matchTick(confirmed, adReq),
    bubble: { hit: pickHitClause(confirmed, adReq), open: pickOpenClause(confirmed, adReq) },
    fit: confirmed.map((c) => ({ id: c.id, text: c.text })),
    dontYet: uncoveredRequirements(confirmed, adReq).map((r) => ({
      id: r.id,
      band: r.band,
      requirement: r.requirement,
    })),
    askedClosed: negatives.map((c) => ({ id: c.id, text: c.text })),
    adExcerpt: posting.excerpt,
  };
}
