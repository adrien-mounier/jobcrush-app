// #307 — the Tailor step's own routes, out of the spine. The three pre-#307 endpoints moved here
// verbatim from routes/onboarding.ts (the ratchet's own remedy: extraction, not comment-shaving —
// the whole tailor step was the last sixth of the spine, and this ticket's queue had to live
// somewhere). The one new endpoint is /onboarding/tailor/profile-answer: a permanent, profile-
// scoped answer, written to the ELIGIBILITY store — never a claim (#106 must-fix 1, #287 clause 5).
//
// The queue's rules live in tailorProfile.ts; the state composition in deck.ts (buildTailorState);
// the pure question/ledger helpers in tailor.ts. This file only turns requests into calls.
//
// Known duplication, deferred on purpose (code review, 2026-09-29): all three state-returning
// handlers share the same resolve-target → judge → years → buildTailorState tail. The two moved
// handlers are verbatim moves and the review chose not to refactor them in the same change that
// moved them; #308 adds the next endpoint here and is the moment to extract the shared tail.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { AdRequirementsV1, CandidateClaim, FamilyPlacement } from "@jobcrush/contracts";
import { requireUser } from "../server.js";
import type { ClaimStore } from "../claims.js";
import type { SessionRecord, SessionStore } from "../sessions.js";
import { withFactFloor } from "../sessions.js";
import type { EligibilityStore } from "../eligibility.js";
import type { JobBlockStore } from "../jobBlockStore.js";
import type { ProductionFamilyFloorStore } from "../familyFloors.js";
import type { JudgeFn } from "../judge.js";
import { isBrought, type BroughtJobsFn } from "../broughtJobs.js";
import { currentDiscoveryFamily } from "../discoveryEngine.js";
import { readingLanguages, languageEligible } from "../language.js";
import { eligiblePostings, sessionPostings, type Posting } from "../preview.js";
import { retrievalRequestForSession, retrievalFingerprint } from "../postingRetrieval.js";
import { matchTick } from "../matchtick.js";
import { judgedMatchTick } from "../judgedScore.js";
import {
  advertFamilyIdFor,
  buildTailorState,
  partitionByFamilyFit,
  resolveAdRequirements,
  resolveJudgement,
  resolveSessionYears,
  tailorTarget,
  withYearsShortfall,
  type ReadAdFn,
} from "../deck.js";
import { findWithdrawingRequirement } from "../withdrawal.js";
import { answerEligibilityItem, mapEligibilityAnswer } from "../eligibilityDiscovery.js";
import { isNoAnswer } from "../discovery.js";
import { composeTailorLine, tailorClaimId } from "../tailor.js";
import {
  newlyHiddenCount,
  profileChangeLine,
  profileOwnedRequirementIds,
  tailorProfileAsks,
} from "../tailorProfile.js";

export interface TailorRouteDeps {
  claims: ClaimStore;
  sessions: SessionStore;
  eligibility: EligibilityStore;
  jobBlocks: JobBlockStore;
  productionFamilyFloors: ProductionFamilyFloorStore;
  placeFamily: (session: Readonly<SessionRecord>) => Promise<FamilyPlacement>;
  /** #305: the adverts this person pasted — a tailor target too (see routes/onboarding.ts's doc). */
  broughtJobs?: BroughtJobsFn;
  /** #104/#105, the same optional seams the deck route carries. */
  readAd?: ReadAdFn;
  judge?: JudgeFn;
}

export function tailorRoutes(deps: TailorRouteDeps) {
  return async function plugin(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    // The tailor slice of the spine's discoveryReads — same one Promise.all shape, minus the
    // rejected-claims read nothing here consumes.
    const reads = (sessionId: string) =>
      Promise.all([
        deps.claims.confirmed(sessionId),
        deps.claims.negatives(sessionId),
        deps.eligibility.list(sessionId),
        deps.jobBlocks.list(sessionId),
      ]);

    const currentFamily = (session: SessionRecord) => currentDiscoveryFamily(session, deps);

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
      const [confirmed, negatives, facts, blocks] = await reads(session.id);
      const fingerprint = retrievalFingerprint(retrievalRequestForSession(session, confirmed, negatives));
      const brought = (await deps.broughtJobs?.(session.id)) ?? []; // #305, as on /want.
      const target = await tailorTarget(session, adId, deps.readAd, fingerprint, brought);
      if (!target)
        return reply.status(404).send({ error: { code: "not_found", message: "unknown card" } });
      const { posting, adReq } = target;
      // #107 (M3, code review): a target that has since become withdrawn behaves EXACTLY like no
      // target at all — no rejection message, no error screen (the ticket's own UX intent: "It does
      // not appear as a greyed-out card, a 'you can't apply' state, or a rejection message"). Clearing
      // it here means a reload doesn't keep landing back on the same dead target.
      // #305: and never for a job he brought — it stays, whatever his own answers say (#294 c1).
      if (findWithdrawingRequirement(adReq, facts, posting.location, brought)) {
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
      const state = buildTailorState(
        posting, adReq, confirmed, negatives, role, session.tailorFloorPct, judgement, years,
        family?.items ?? [],
        // #307: the profile-level questions THIS advert raises, first in the queue.
        tailorProfileAsks(adReq, posting.location, facts),
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
        const brought = (await deps.broughtJobs?.(session.id)) ?? []; // #305, as on /want.
        const target = await tailorTarget(session, adId, deps.readAd, fingerprint, brought);
        if (!target)
          return reply.status(404).send({ error: { code: "not_found", message: "unknown card" } });
        const { posting, adReq } = target;
        const requirement = adReq.requirements.find((r) => r.id === req.body.requirementId);
        // #307: a requirement the PROFILE question owns is refused here outright — answering it
        // through this door would write the advert-scoped claim AC4 forbids (#287 clause 5). Same
        // fail-closed 404 as a requirement that does not exist, because for this door it doesn't.
        if (!requirement || profileOwnedRequirementIds(adReq, posting.location).has(requirement.id))
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

        const [confirmed, negatives, facts, blocks] = await reads(session.id);
        // #107 (M3, code review): a target that has become withdrawn (this answer's own claim is
        // still recorded — harmless, tied to this ad's own claim id) behaves EXACTLY like no target
        // at all from here on: no rejection message, nothing further asserted about a job the visitor
        // can no longer take. Cleared so a reload doesn't keep landing back on the same dead target.
        // #305: never for a job he brought — it stays, whatever his own answers say (#294 c1).
        if (findWithdrawingRequirement(adReq, facts, posting.location, brought)) {
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
        const state = buildTailorState(
          posting, adReq, confirmed, negatives, role, session.tailorFloorPct, judgement, years,
          family?.items ?? [],
          tailorProfileAsks(adReq, posting.location, facts), // #307
        );
        state.factCount = await withFactFloor(deps.sessions, session, state.factCount);
        return state;
      },
    );

    // #307 — a PROFILE-LEVEL answer: permanent, profile-scoped, told before and after.
    //
    // The write path is answerEligibilityItem — the same one discovery's work-rights question uses,
    // so the option strings, the canonical store values and the "a real answer never touches the
    // claims store" rule (#106 must-fix 1) are all inherited, never re-implemented. The response
    // carries `changed` (AC6's after-line: what this answer just did) and the rebuilt state — or
    // `state: null` when the answer withdrew the very job being tailored (a found job only; one he
    // brought never withdraws, #294 c1). #309 owns naming the withdrawal's reason; here the client
    // gets the honest signal and the deck to go back to.
    app.post(
      "/onboarding/tailor/profile-answer",
      { schema: { body: z.object({ requirementId: z.string(), answer: z.string().trim().min(1) }) } },
      async (req, reply) => {
        const session = requireUser(req);
        const adId = session.tailorAdId;
        if (!adId)
          return reply
            .status(409)
            .send({ error: { code: "no_tailor_target", message: "no job being tailored" } });
        const [confirmed, negatives, factsBefore, blocks] = await reads(session.id);
        const fingerprint = retrievalFingerprint(retrievalRequestForSession(session, confirmed, negatives));
        const brought = (await deps.broughtJobs?.(session.id)) ?? [];
        const target = await tailorTarget(session, adId, deps.readAd, fingerprint, brought);
        if (!target)
          return reply.status(404).send({ error: { code: "not_found", message: "unknown card" } });
        const { posting, adReq } = target;
        // Only a question this advert actually raises, still open, may be answered here — an itemId
        // for anything else (never asked, already answered, or not this advert's market) is a 404,
        // the same fail-closed shape as an unknown requirement on /tailor/answer.
        const ask = tailorProfileAsks(adReq, posting.location, factsBefore).find(
          (a) => a.requirementId === req.body.requirementId,
        );
        if (!ask)
          return reply
            .status(404)
            .send({ error: { code: "unknown_question", message: "no such question" } });
        // Map the tapped option to the store's canonical value FIRST, and refuse anything that
        // does not map — which covers the discovery decline too ("Ask me later" maps to nothing):
        // the tailor queue has no decline (#308 owns "not sure yet"), and letting one through
        // would close the question via a claims record, the exact "skip hardens into a blank"
        // ADR-0011 clause 4 forbids. The mapped value also feeds the after-line below, so the
        // yes/no branch is derived from the answer he actually gave — never a store re-read that
        // could miss on a scope mismatch and tell a "No" answerer the yes-line.
        const mapped = mapEligibilityAnswer(ask.dimension, req.body.answer.trim());
        if (!mapped)
          return reply
            .status(400)
            .send({ error: { code: "invalid_answer", message: "unrecognized eligibility answer" } });
        const written = await answerEligibilityItem(
          { eligibility: deps.eligibility, claims: deps.claims },
          session.id,
          [ask.market],
          ask.requirementId,
          { answer: req.body.answer },
        );
        if (!written.ok)
          return reply
            .status(written.status)
            .send({ error: { code: written.code, message: written.message } });

        const factsAfter = await deps.eligibility.list(session.id);
        // What this answer changed, counted over the SAME pool the deck renders: candidates that
        // withdraw under the new facts but not the old. Resolution is fixture-first and cached
        // (resolveAdRequirements), the same per-posting read the deck already performs.
        const langs = readingLanguages(session);
        const pool = eligiblePostings(langs, sessionPostings(session, fingerprint, brought));
        const candidates = (
          await Promise.all(
            pool.map(async (p: Posting) => {
              const resolved = await resolveAdRequirements(p.id, deps.readAd, p);
              return resolved && languageEligible(resolved.language, langs)
                ? { posting: p, adReq: resolved }
                : null;
            }),
          )
        ).filter((entry): entry is { posting: Posting; adReq: AdRequirementsV1 } => entry !== null);
        // Same deck membership buildDeckCards applies before ITS withdrawal pass: a wrong-family
        // advert was never in his deck, so it can never be counted as hidden from it — and a job he
        // brought skips the family gate (#294 c1), exactly as it does there.
        const deckFamilyId = await advertFamilyIdFor(session, deps.placeFamily);
        const { kept } = partitionByFamilyFit(
          candidates.filter((c) => !isBrought(brought, c.posting.id)),
          deckFamilyId,
        );
        const hidden = newlyHiddenCount(
          [...candidates.filter((c) => isBrought(brought, c.posting.id)), ...kept],
          factsBefore,
          factsAfter,
          brought,
        );
        const changed = profileChangeLine(mapped.value, ask.market, hidden);

        // The answer may have withdrawn the very job being tailored — a found one only (#294 c1).
        // Same clear as GET's M3 rule; the client gets `state: null` and the deck to go back to.
        if (findWithdrawingRequirement(adReq, factsAfter, posting.location, brought)) {
          await deps.sessions.clearTailorTarget(session.id);
          return { changed, state: null };
        }
        const role = session.targetTitles[0] ?? null;
        const rawJudgement = await resolveJudgement(adReq, confirmed, deps.judge);
        const years = resolveSessionYears(factsAfter, blocks, deckFamilyId);
        const judgement = withYearsShortfall(rawJudgement, adReq, years);
        const family = role ? await currentFamily(session) : null;
        const state = buildTailorState(
          posting, adReq, confirmed, negatives, role, session.tailorFloorPct, judgement, years,
          family?.items ?? [],
          tailorProfileAsks(adReq, posting.location, factsAfter), // the answered one is gone now
        );
        state.factCount = await withFactFloor(deps.sessions, session, state.factCount);
        return { changed, state };
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
