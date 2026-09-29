// #307 — the Tailor step's own routes, out of the spine. The three pre-#307 endpoints moved here
// verbatim from routes/onboarding.ts (the ratchet's own remedy: extraction, not comment-shaving —
// the whole tailor step was the last sixth of the spine, and this ticket's queue had to live
// somewhere). /onboarding/tailor/profile-answer takes a permanent, profile-scoped answer, written
// to the ELIGIBILITY store — never a claim (#106 must-fix 1, #287 clause 5) — and, as of #308,
// also the skip ("not sure yet" / "not now"), which writes NOTHING but session queue state.
//
// The queue's rules live in tailorProfile.ts; the state composition in deck.ts (buildTailorState);
// the pure question/ledger helpers in tailor.ts. This file only turns requests into calls.
// composeTailorState below is the shared resolve-judgement → years → buildTailorState tail the
// #307 review deferred to this ticket.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { AdRequirementsV1, CandidateClaim, FamilyPlacement } from "@jobcrush/contracts";
import { requireUser } from "../server.js";
import type { ClaimRecord, ClaimStore } from "../claims.js";
import type { SessionRecord, SessionStore } from "../sessions.js";
import { withFactFloor } from "../sessions.js";
import type { EligibilityFact, EligibilityStore } from "../eligibility.js";
import type { JobBlockStore, JobBlockView } from "../jobBlockStore.js";
import type { ProductionFamilyFloorStore } from "../familyFloors.js";
import type { JudgeFn } from "../judge.js";
import { isBrought, type BroughtJobsFn } from "../broughtJobs.js";
import { currentDiscoveryFamily } from "../discoveryEngine.js";
import { readingLanguages, languageEligible } from "../language.js";
import { eligiblePostings, sessionPostings, type Posting } from "../preview.js";
import { marketForLocationText, retrievalRequestForSession, retrievalFingerprint } from "../postingRetrieval.js";
import {
  advertFamilyIdFor,
  advertYearsFamilyId,
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
import { answerLanguageLevel, rungForSituation } from "../languageLevel.js";
import { isNoAnswer } from "../discovery.js";
import { composeTailorLine, tailorClaimId } from "../tailor.js";
import {
  broughtStaysLine,
  languageChangeLine,
  newlyHiddenCount,
  profileChangeLine,
  profileOwnedRequirementIds,
  skippedLine,
  tailorProfileAsks,
  withdrawalReasonLine,
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

// #308: a skip is stored per-advert ("<adId>::<requirementId>", sessions.ts's tailorSkips) so
// ADR-0011 clause 4's "never twice for the same advert" survives reloads, drop + re-swipe AND a
// detour through another job — while a different advert raising the same question still asks.
// These two are the only places the key shape exists.
const tailorSkipKey = (adId: string, requirementId: string): string => `${adId}::${requirementId}`;
const tailorSkipsFor = (session: SessionRecord, adId: string): Set<string> =>
  new Set(
    session.tailorSkips
      .filter((key) => key.startsWith(`${adId}::`))
      .map((key) => key.slice(adId.length + 2)),
  );

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

    // #308 (the #307 review's own deferral): the resolve-judgement → years → buildTailorState tail
    // every state-returning handler used to repeat, extracted the moment a fourth caller (the skip
    // path) arrived. #309 removed the floor raise that used to sit between judgement and state —
    // the score is the raw honest number now, on every path.
    // `skips` is the session's queue state (#308): profile questions skipped on THIS job, left out
    // of the rebuilt queue so a skip never re-fires on the same job. `broughtJob` (#309) switches
    // the years scope to the advert's own family (AC5) and adds the stays-anyway line (AC4).
    const composeTailorState = async (
      session: SessionRecord,
      posting: Posting,
      adReq: AdRequirementsV1,
      confirmed: ClaimRecord[],
      negatives: ClaimRecord[],
      facts: EligibilityFact[],
      blocks: JobBlockView[],
      skips: ReadonlySet<string>,
      broughtJob: boolean,
    ) => {
      const role = session.targetTitles[0] ?? null;
      const rawJudgement = await resolveJudgement(adReq, confirmed, deps.judge);
      // #107 (D5) / #222: the years shortfall at the bar's own scope — see applyYearsShortfall
      // (judgedScore.ts) + resolveSessionYears (deck.ts). #162 AC6: null years means no readable
      // work history, so this surface reports the years bar untested exactly as the deck card does.
      // #309 AC5: a job he brought reads its years at ITS OWN advert family (advertYearsFamilyId),
      // so a field his work history does not cover scores an honest zero, never the career total.
      const years = resolveSessionYears(
        facts,
        blocks,
        advertYearsFamilyId(adReq, broughtJob, await advertFamilyIdFor(session, deps.placeFamily)),
      );
      const judgement = withYearsShortfall(rawJudgement, adReq, years);
      const family = role ? await currentFamily(session) : null;
      const state = buildTailorState(
        posting, adReq, confirmed, negatives, role, judgement, years,
        family?.items ?? [],
        // #307/#308: the profile-level questions THIS advert still has open, first in the queue.
        tailorProfileAsks(adReq, posting.location, facts, skips),
      );
      state.factCount = await withFactFloor(deps.sessions, session, state.factCount);
      // #309 AC4: a job he brought that the same answers WOULD withdraw were it found (the empty
      // brought list asks the predicate with nobody exempt) says in one line why it stays. Derived
      // from the stored facts on every compose, so it holds across reloads, not just the answer.
      if (broughtJob) {
        const gap = findWithdrawingRequirement(adReq, facts, posting.location);
        if (gap) state.stayed = broughtStaysLine(gap, marketForLocationText(posting.location ?? ""));
      }
      return state;
    };

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
      return composeTailorState(
        session, posting, adReq, confirmed, negatives, facts, blocks, tailorSkipsFor(session, adId),
        isBrought(brought, adId),
      );
    });

    // Idempotent, like #18's discovery answer: re-answering the same requirement CORRECTS it
    // (positive<->negative flip) via the same upserting add()/answerNegative() — no 409 guard needed.
    // #309: no floor holds the number up any more — a correction/"no" that lowers the real fit
    // lowers the responded matchPct, and the ledger line beside it names the answer that did it.
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
        const [targetConfirmed, targetNegatives, targetFacts] = await reads(session.id);
        const fingerprint = retrievalFingerprint(
          retrievalRequestForSession(session, targetConfirmed, targetNegatives),
        );
        const brought = (await deps.broughtJobs?.(session.id)) ?? []; // #305, as on /want.
        const target = await tailorTarget(session, adId, deps.readAd, fingerprint, brought);
        if (!target)
          return reply.status(404).send({ error: { code: "not_found", message: "unknown card" } });
        const { posting, adReq } = target;
        // #107 (M3): a target that has since become withdrawn behaves EXACTLY like no target at
        // all — checked BEFORE the requirement lookup (#308 moved it up: a profile-owned
        // requirement's 404 must never outrank the dead-target 409). This handler's own write can
        // never cause a withdrawal — only eligibility facts withdraw, and a tailor answer writes a
        // claim — so checking on the pre-write facts decides exactly what a post-write check did.
        // #305: never for a job he brought — it stays, whatever his own answers say (#294 c1).
        if (findWithdrawingRequirement(adReq, targetFacts, posting.location, brought)) {
          await deps.sessions.clearTailorTarget(session.id);
          return reply
            .status(409)
            .send({ error: { code: "no_tailor_target", message: "no job being tailored" } });
        }
        const requirement = adReq.requirements.find((r) => r.id === req.body.requirementId);
        // #307: a requirement the PROFILE question owns is refused here outright — answering it
        // through this door would write the advert-scoped claim AC4 forbids (#287 clause 5). Same
        // fail-closed 404 as a requirement that does not exist, because for this door it doesn't.
        // #308: that now covers subject-carrying language requirements too — the graded ladder is
        // the only door a language answer may take.
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
        // The answer just changed the fact set, so this is a fresh (adId, fingerprint), never a
        // cache hit reusing a stale judgement — the re-score is the honest number (#105 decision 7).
        return composeTailorState(
          session, posting, adReq, confirmed, negatives, facts, blocks,
          tailorSkipsFor(session, adId), isBrought(brought, adId),
        );
      },
    );

    // #307 — a PROFILE-LEVEL answer: permanent, profile-scoped, told before and after.
    //
    // The write path is answerEligibilityItem — the same one discovery's work-rights question uses,
    // so the option strings, the canonical store values and the "a real answer never touches the
    // claims store" rule (#106 must-fix 1) are all inherited, never re-implemented. The response
    // carries `changed` (AC6's after-line: what this answer just did) and the rebuilt state — or
    // `state: null` when the answer withdrew the very job being tailored (a found job only; one he
    // brought never withdraws, #294 c1), with `withdrawal` naming the reason (#309 AC3).
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
        // for anything else (never asked, already answered, skipped on this job, or not this
        // advert's market) is a 404, the same fail-closed shape as /tailor/answer's.
        const skips = tailorSkipsFor(session, adId);
        const ask = tailorProfileAsks(adReq, posting.location, factsBefore, skips).find(
          (a) => a.requirementId === req.body.requirementId,
        );
        if (!ask)
          return reply
            .status(404)
            .send({ error: { code: "unknown_question", message: "no such question" } });

        // #308 AC1/AC2/AC5 — the skip. Writes NOTHING to any fact store: not a value, not a
        // sentinel, not a claims decline (that is the "skip hardens into a blank" ADR-0011
        // clause 4 forbids). The only record is the session's own queue state, so the question
        // steps aside for THIS job and the next job that raises it asks again.
        if (req.body.answer.trim() === ask.skip) {
          await deps.sessions.addTailorSkip(session.id, tailorSkipKey(adId, ask.requirementId));
          skips.add(ask.requirementId);
          const state = await composeTailorState(
            session, posting, adReq, confirmed, negatives, factsBefore, blocks, skips,
            isBrought(brought, adId),
          );
          return { changed: skippedLine(ask), state };
        }

        // A real answer, written at the ask's own dimension. Both paths refuse anything that does
        // not map to a canonical value — which covers the discovery decline too ("Ask me later"
        // maps to nothing). The value each branch captures feeds the after-line below, so the
        // yes/no branch is derived from the answer he actually gave — never a store re-read that
        // could miss on a scope mismatch and tell a "No" answerer the yes-line.
        let changedFor: (hidden: number) => string;
        if (ask.dimension === "language") {
          // #308 AC4: a language answer is a RUNG (graded), written through the ladder's own
          // write path — the same answerLanguageLevel the retired card ladder used, so the scope
          // rules and the claims-store ban are inherited, never re-implemented.
          const rung = rungForSituation(req.body.answer);
          if (!rung)
            return reply
              .status(400)
              .send({ error: { code: "invalid_answer", message: "unrecognized language level" } });
          const written = await answerLanguageLevel(deps.eligibility, session.id, ask.language, rung);
          if (!written.ok)
            return reply
              .status(written.status)
              .send({ error: { code: written.code, message: written.message } });
          changedFor = (hidden) => languageChangeLine(ask.language, rung, hidden);
        } else {
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
          changedFor = (hidden) => profileChangeLine(mapped.value, ask.market, hidden);
        }

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
        const changed = changedFor(hidden);

        // The answer may have withdrawn the very job being tailored — a found one only (#294 c1).
        // Same clear as GET's M3 rule; the client gets `state: null` and the deck to go back to.
        // #309 AC3: the withdrawal names its reason — he just answered, so silence here would read
        // as a bug, not a rule. The reason is the withdrawing requirement itself, in his own terms.
        const withdrawing = findWithdrawingRequirement(adReq, factsAfter, posting.location, brought);
        if (withdrawing) {
          await deps.sessions.clearTailorTarget(session.id);
          return {
            changed,
            state: null,
            withdrawal: withdrawalReasonLine(withdrawing, marketForLocationText(posting.location ?? "")),
          };
        }
        // The answered question is gone from the rebuilt queue (its fact is stored now).
        const state = await composeTailorState(
          session, posting, adReq, confirmed, negatives, factsAfter, blocks, skips,
          isBrought(brought, adId),
        );
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
