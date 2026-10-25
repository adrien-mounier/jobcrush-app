// #307 — the Tailor step's own routes, out of the spine (the ratchet's own remedy: extraction, not
// comment-shaving). /onboarding/tailor/profile-answer takes a permanent, profile-scoped answer,
// written to the ELIGIBILITY store — never a claim (#106 must-fix 1, #287 clause 5) — and, as of
// #308, also the skip ("not sure yet" / "not now"), which writes NOTHING but session queue state.
// #415 (ADR-0020): the requirement answer route is gone — the profile door is the only answer the
// Tailor step takes, and the draft doors below write the CV from true facts alone.
//
// The queue's rules live in tailorProfile.ts; the state composition in deck.ts (buildTailorState);
// the claim-id scheme and the denial readers in tailor.ts. This file only turns requests into calls.
// composeTailorState below is the shared resolve-judgement → years → buildTailorState tail the
// #307 review deferred to this ticket.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { StretchProposalV2, type AdRequirementsV1, type FamilyPlacement } from "@jobcrush/contracts";
import { requireUser } from "../server.js";
import { Refusal } from "./refusal.js";
import type { ClaimRecord, ClaimStore } from "../claims.js";
import type { SessionRecord, SessionStore } from "../sessions.js";
import { withFactFloor } from "../sessions.js";
import type { EligibilityFact, EligibilityStore } from "../eligibility.js";
import type { JobBlockStore, JobBlockView } from "../jobBlockStore.js";
import type { ProductionFamilyFloorStore } from "../familyFloors.js";
import type { JudgeFn } from "../judge.js";
import { isBrought, type BroughtJob, type BroughtJobsFn } from "../broughtJobs.js";
import { readingLanguages, languageEligible } from "../language.js";
import { eligiblePostings, lastSearchPostings, type Posting } from "../preview.js";
import { marketForLocationText, retrievalRequestForSession, retrievalFingerprint } from "../postingRetrieval.js";
import {
  advertFamilyIdFor,
  advertYearsFamilyId,
  buildJobCard,
  buildTailorState,
  partitionByFamilyFit,
  resolveAdRequirements,
  resolveJudgement,
  resolveSessionYears,
  tailorTarget,
  withYearsShortfall,
  type ReadAdFn,
} from "../deck.js";
import { findWithdrawal, findWithdrawingRequirement } from "../withdrawal.js";
import { answerEligibilityItem, mapEligibilityAnswer } from "../eligibilityDiscovery.js";
import { answerLanguageLevel, rungForSituation } from "../languageLevel.js";
import type { JobStore } from "../jobs.js";
import { letterheadText, type ContactStore } from "../contact.js";
import type { LlmClient } from "../llm.js";
import type { TailorDraftRecord, TailorDraftStore } from "../tailorDraftStore.js";
import { composeDraftInputs, runTailorDraftJob, tailorDraftView, type DraftInputs, type StretchContext } from "../tailorDraft.js";
import {
  RESAY_LIMIT,
  STRETCH_ANSWERS,
  answerSuggestion,
  buildResayInput,
  editableSuggestion,
  resayStretch,
  rewordSuggestion,
  stretchIsCurrent,
  stretchMarks,
  stretchView,
  withStretchedVerdicts,
} from "../stretchSuggestions.js";
import { countedStretch, draftFacts, saveAnswer } from "../stretchFact.js";
import { exportGate, runTailorExportJob } from "../tailorExport.js";
import { reportContext, reportGate } from "../applicationReport.js";
import type { AuthStore } from "../auth.js";
import type { Mailer } from "../mailer.js";
import type { DocumentMaker } from "../documentMaker.js";
import {
  broughtStaysLine,
  languageChangeLine,
  newlyHiddenCount,
  profileChangeLine,
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
  /** #310 — the draft endpoints' own deps. `jobs` is the SAME job/progress store the front door and
   *  the paste door narrate over, so the ending watches `GET /jobs/:id/events` and nothing new had
   *  to be built. `tailorLlm` follows the readPastedAdvert rule: real model calls are wired in
   *  main.ts (and qa-main's fake) only, never defaulted here — absent, the draft door answers 503. */
  jobs: JobStore;
  contact: ContactStore;
  tailorDrafts: TailorDraftStore;
  tailorLlm?: LlmClient;
  /** #315 — the application report's one model call. Same rule as tailorLlm: wired in main.ts
   *  (metered) and qa-main's fake only; absent, the approve press answers 503. */
  reportLlm?: LlmClient;
  /** #417 — the stretch suggestion step's one call, same rule: wired in main.ts (metered) and
   *  qa-main's fake only; absent, the draft is written and the step is recorded as not run. */
  stretchLlm?: LlmClient;
  /** #313 — the approve-is-send press's own deps. `auth` resolves the signed-in account's email
   *  (the document goes to HIM). `documentMaker` follows the readPastedAdvert rule: the real
   *  browser is wired in main.ts, the stand-in in qa-main/tests — absent, the press answers 503
   *  rather than inventing a document. `mailer` always exists (DevMailer in dev/CI). */
  auth: AuthStore;
  mailer: Mailer;
  documentMaker?: DocumentMaker;
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

    // The tailor slice of the spine's discoveryReads, in its own order. #425: `claims` (LAST here,
    // third there) is every claim, for the CV's language lines, printed or not.
    const reads = (sessionId: string) =>
      Promise.all([
        deps.claims.confirmed(sessionId),
        deps.claims.negatives(sessionId),
        deps.eligibility.list(sessionId),
        deps.jobBlocks.list(sessionId),
        deps.claims.list(sessionId),
      ]);

    // #308 (the #307 review's own deferral): the resolve-judgement → years → buildTailorState tail
    // every state-returning handler used to repeat, extracted the moment a fourth caller (the skip
    // path) arrived. #309 removed the floor raise that used to sit between judgement and state —
    // the score is the raw honest number now, on every path.
    // `skips` is the session's queue state (#308): profile questions skipped on THIS job, left out
    // of the rebuilt queue so a skip never re-fires on the same job. `broughtJob` (#309) switches
    // the years scope to the advert's own family (AC5) and adds the stays-anyway line (AC4).
    // #315 split this head off composeTailorState: the approve press needs the same judged
    // card the screen showed (reportGate) without rebuilding the queue and the ledger.
    const judgeAndYears = async (
      session: SessionRecord,
      adReq: AdRequirementsV1,
      confirmed: ClaimRecord[],
      facts: EligibilityFact[],
      blocks: JobBlockView[],
      broughtJob: boolean,
    ) => {
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
      return { judgement: withYearsShortfall(rawJudgement, adReq, years), years };
    };

    const composeTailorState = async (
      session: SessionRecord,
      posting: Posting,
      adReq: AdRequirementsV1,
      confirmed: ClaimRecord[],
      negatives: ClaimRecord[],
      facts: EligibilityFact[],
      blocks: JobBlockView[],
      claims: ClaimRecord[],
      skips: ReadonlySet<string>,
      broughtJob: boolean,
    ) => {
      const { judgement: judged, years } = await judgeAndYears(session, adReq, confirmed, facts, blocks, broughtJob);
      // #418 (ADR-0020 clause 4): the stretches used on THIS job count as met on its card, read from
      // the record beside its draft. Not in judgeAndYears: the stretch step's own input
      // (stretchContext) must read the facts alone, or every answer would re-key the step. Only while
      // that draft is the one that would print (countedStretch).
      const counted = await countedStretch(deps, session.id, posting, adReq, { confirmed, negatives, blocks });
      const judgement = withStretchedVerdicts(judged, counted);
      const state = buildTailorState(
        posting, adReq, confirmed, negatives, judgement, years,
        // #307/#308: the profile-level questions THIS advert still has open — #415: the whole queue.
        tailorProfileAsks(adReq, posting.location, facts, claims, skips),
      );
      state.factCount = await withFactFloor(deps.sessions, session, state.factCount);
      // #309 AC4: a job he brought that the same answers WOULD withdraw were it found (the empty
      // brought list asks the predicate with nobody exempt) says in one line why it stays. Derived
      // from the stored facts on every compose, so it holds across reloads, not just the answer.
      if (broughtJob) {
        const gap = findWithdrawal(adReq, facts, claims, posting.location);
        if (gap) state.stayed = broughtStaysLine(gap.req, marketForLocationText(posting.location ?? ""), gap.gap);
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
      const [confirmed, negatives, facts, blocks, claims] = await reads(session.id);
      const fingerprint = retrievalFingerprint(retrievalRequestForSession(session, confirmed, negatives));
      const brought = (await deps.broughtJobs?.(session.id)) ?? []; // #305, as on /want.
      const target = await tailorTarget(session, adId, deps.readAd, fingerprint, facts, brought);
      if (!target)
        return reply.status(404).send({ error: { code: "not_found", message: "unknown card" } });
      const { posting, adReq } = target;
      // #107 (M3, code review): a target that has since become withdrawn behaves EXACTLY like no
      // target at all — no rejection message, no error screen (the ticket's own UX intent: "It does
      // not appear as a greyed-out card, a 'you can't apply' state, or a rejection message"). Clearing
      // it here means a reload doesn't keep landing back on the same dead target.
      // #305: and never for a job he brought — it stays, whatever his own answers say (#294 c1).
      if (findWithdrawingRequirement(adReq, facts, claims, posting.location, brought)) {
        await deps.sessions.clearTailorTarget(session.id);
        return reply
          .status(409)
          .send({ error: { code: "no_tailor_target", message: "no job being tailored" } });
      }
      return composeTailorState(
        session, posting, adReq, confirmed, negatives, facts, blocks, claims, tailorSkipsFor(session, adId),
        isBrought(brought, adId),
      );
    });

    // #415 (ADR-0020 clause 1): there is no /onboarding/tailor/answer any more — a requirement is
    // never a question, so nothing writes an advert-scoped claim. The profile door below is the
    // only answer the Tailor step takes.

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
        const [confirmed, negatives, factsBefore, blocks, claims] = await reads(session.id);
        const fingerprint = retrievalFingerprint(retrievalRequestForSession(session, confirmed, negatives));
        const brought = (await deps.broughtJobs?.(session.id)) ?? [];
        const target = await tailorTarget(session, adId, deps.readAd, fingerprint, factsBefore, brought);
        if (!target)
          return reply.status(404).send({ error: { code: "not_found", message: "unknown card" } });
        const { posting, adReq } = target;
        // Only a question this advert actually raises, still open, may be answered here — an itemId
        // for anything else (never asked, already answered, skipped on this job, or not this
        // advert's market) is a 404, the same fail-closed shape as /tailor/answer's.
        const skips = tailorSkipsFor(session, adId);
        const ask = tailorProfileAsks(adReq, posting.location, factsBefore, claims, skips).find(
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
            session, posting, adReq, confirmed, negatives, factsBefore, blocks, claims, skips,
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
            { eligibility: deps.eligibility },
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
        // withdraw under the new facts but not the old. #431: the session's last search, as the
        // target itself is read — inside the deck's 5-minute window it is the deck's pool, and past
        // it the deck's own pool is empty until the deck searches again, which would count 0. Resolution is fixture-first and cached
        // (resolveAdRequirements), the same per-posting read the deck already performs.
        const langs = readingLanguages(session);
        const pool = eligiblePostings(langs, lastSearchPostings(session, fingerprint, factsAfter, brought));
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
          claims,
          brought,
        );
        const changed = changedFor(hidden);

        // The answer may have withdrawn the very job being tailored — a found one only (#294 c1).
        // Same clear as GET's M3 rule; the client gets `state: null` and the deck to go back to.
        // #309 AC3: the withdrawal names its reason — he just answered, so silence here would read
        // as a bug, not a rule. The reason is the withdrawing requirement itself, in his own terms.
        const withdrawing = findWithdrawal(adReq, factsAfter, claims, posting.location, brought);
        if (withdrawing) {
          await deps.sessions.clearTailorTarget(session.id);
          return {
            changed,
            state: null,
            withdrawal: withdrawalReasonLine(withdrawing.req, marketForLocationText(posting.location ?? ""), withdrawing.gap),
          };
        }
        // The answered question is gone from the rebuilt queue (its fact is stored now).
        const state = await composeTailorState(
          session, posting, adReq, confirmed, negatives, factsAfter, blocks, claims, skips,
          isBrought(brought, adId),
        );
        return { changed, state };
      },
    );

    // --- #310: the draft — the CV brain, bound to the job being tailored ------------------------

    // The same resolve-and-guard tail GET /onboarding/tailor opens with, shared by the two draft
    // doors: no target and a withdrawn target both behave exactly like no target at all (#107 M3),
    // and a job he brought is never withdrawn (#294 c1). Returns the reads the draft needs so the
    // doors never read twice.
    interface DraftTarget {
      posting: Posting;
      adReq: AdRequirementsV1;
      confirmed: ClaimRecord[];
      negatives: ClaimRecord[];
      blocks: JobBlockView[];
      /** #315: the report's deterministic facts read these — the eligibility facts (unchecked,
       *  the market to check) and the brought job (apply link, ageing line). */
      facts: EligibilityFact[];
      /** #425: every claim — the report reads the CV's language lines as the Tailor queue does. */
      claims: ClaimRecord[];
      brought: BroughtJob[];
      /** #419: the facts this job's draft is written from — every confirmed fact but the lines its
       *  own "It's true" answers added (stretchFact.ts draftFacts) — the draft input composed from
       *  them, the stored draft, and the letterhead the input carries. */
      draftConfirmed: ClaimRecord[];
      inputs: DraftInputs;
      stored: TailorDraftRecord | null;
      header: string;
    }
    type DraftTargetResult =
      | { refused: { status: 404 | 409; code: string; message: string }; target?: undefined }
      | { refused?: undefined; target: DraftTarget };
    const NO_TARGET = { status: 409 as const, code: "no_tailor_target", message: "no job being tailored" };
    const resolveDraftTarget = async (session: SessionRecord): Promise<DraftTargetResult> => {
      const adId = session.tailorAdId;
      if (!adId) return { refused: NO_TARGET };
      const [confirmed, negatives, facts, blocks, claims] = await reads(session.id);
      const fingerprint = retrievalFingerprint(retrievalRequestForSession(session, confirmed, negatives));
      const brought = (await deps.broughtJobs?.(session.id)) ?? [];
      const target = await tailorTarget(session, adId, deps.readAd, fingerprint, facts, brought);
      if (!target)
        return { refused: { status: 404, code: "not_found", message: "unknown card" } };
      if (findWithdrawingRequirement(target.adReq, facts, claims, target.posting.location, brought)) {
        await deps.sessions.clearTailorTarget(session.id);
        return { refused: NO_TARGET };
      }
      // #310 (QA gate D1): the CV's letterhead, stored at mine time — without it the engine's own
      // rule 3 prints "Your name here" on a real person's CV.
      const header = letterheadText(await deps.contact.getRecord(session.id)); // #381: the saved fields
      const stored = await deps.tailorDrafts.get(session.id, target.posting.id);
      const { claims: draftConfirmed, inputs } = draftFacts(confirmed, stored, (claims) =>
        composeDraftInputs(claims, negatives, blocks, target.posting, target.adReq, header),
      );
      return { target: { ...target, confirmed, negatives, blocks, facts, claims, brought, draftConfirmed, inputs, stored, header } };
    };

    // #417: the requirements with the card's verdicts, composed exactly as the screen's own list
    // is (buildTailorState's reading of the judged card) — the stretch step suggests only for the
    // ones it does not read as met.
    const stretchContext = async (session: SessionRecord, t: DraftTarget): Promise<StretchContext | undefined> => {
      if (!deps.stretchLlm) return undefined;
      // #419: read from the draft's own facts, so a fact this draft's "It's true" answer added
      // never re-keys the suggestions it came from.
      const { judgement, years } = await judgeAndYears(
        session, t.adReq, t.draftConfirmed, t.facts, t.blocks, isBrought(t.brought, t.posting.id),
      );
      return { requirements: buildTailorState(t.posting, t.adReq, t.draftConfirmed, t.negatives, judgement, years).requirements };
    };

    // #310: one in-flight run per (session, advert, fact set) — a reload mid-write joins the run
    // already paying instead of starting a second one. ponytail: per-process only; a multi-process
    // deploy would need the job store to arbitrate, which one machine does not.
    const draftRuns = new Map<string, string>();

    /** Starts (or joins, or short-circuits) the draft for the job being tailored. `{ ready: true }`
     *  on a checkpoint hit — the stored draft matches the current fact set and nothing is spent —
     *  otherwise 202 + the job to watch over `GET /jobs/:id/events`, the paste door's own shape. */
    app.post("/onboarding/tailor/draft", async (req, reply) => {
      const session = requireUser(req);
      const resolved = await resolveDraftTarget(session);
      if (resolved.refused) {
        const { status, code, message } = resolved.refused;
        return reply.status(status).send({ error: { code, message } });
      }
      // The readPastedAdvert rule: no model client wired ⇒ refuse honestly, never invent a draft.
      if (!deps.tailorLlm)
        return reply.status(503).send({
          error: { code: "draft_unavailable", message: "writing the tailored CV is switched off on this deployment" },
        });
      let target = resolved.target;
      const { posting, confirmed, stored } = target;
      // CandidateClaims requires at least one claim; structurally unreachable through the product
      // (reaching tailor means discovery answered), kept honest rather than thrown from the engine.
      if (confirmed.length === 0)
        return reply
          .status(409)
          .send({ error: { code: "no_facts", message: "no confirmed facts to draft from" } });
      let stretch = await stretchContext(session, target);
      // #417: a draft that matches the facts is ready only once its suggestions are current too;
      // otherwise the job below re-makes the suggestions alone, the draft untouched and unspent.
      let draftCurrent = stored?.inputFingerprint === target.inputs.fingerprint;
      if (draftCurrent && (!stretch || stretchIsCurrent(stored!, posting, stretch.requirements, target.inputs))) return { ready: true };
      // #419: re-made suggestions keep only the answers whose suggestion comes back (carryAnswers), so
      // a draft that stands only without its own "It's true" lines could then match no fact set — it
      // is written again from every fact. Those lines stay on the master CV; the profile removes them.
      if (draftCurrent && target.draftConfirmed !== confirmed) {
        const { negatives, blocks, adReq, header } = target;
        target = { ...target, draftConfirmed: confirmed, inputs: composeDraftInputs(confirmed, negatives, blocks, posting, adReq, header) };
        stretch = await stretchContext(session, target);
        draftCurrent = false;
      }
      const { inputs } = target;
      const runKey = JSON.stringify([session.id, posting.id, inputs.fingerprint]);
      const running = draftRuns.get(runKey);
      if (running) return reply.status(202).send({ jobId: running });
      const job = await deps.jobs.create("tailor-draft", session.id);
      draftRuns.set(runKey, job.id);
      void runTailorDraftJob(
        { jobs: deps.jobs, tailorDrafts: deps.tailorDrafts, tailorLlm: deps.tailorLlm, stretchLlm: deps.stretchLlm },
        session.id,
        job.id,
        posting,
        inputs,
        stretch,
        draftCurrent ? stored! : undefined,
      ).finally(() => draftRuns.delete(runKey));
      return reply.status(202).send({ jobId: job.id });
    });

    /** The checkpointed draft for the job being tailored: the rendered document, the #154
     *  disclosure (what it held back and why), and the conservation notices when it shipped lossy.
     *  Reading spends nothing — that is what makes exiting free: the supported draft stays here,
     *  behind no further gate (#66's fourth criterion). */
    // #417: `?open=<suggestion id>` previews that pending suggestion in place on the page (line
    // out struck, line in marked) and numbers the other pending ones in the margin. Reading spends
    // nothing and changes nothing stored.
    app.get(
      "/onboarding/tailor/draft",
      { schema: { querystring: z.object({ open: z.string().optional() }) } },
      async (req, reply) => {
      const session = requireUser(req);
      const resolved = await resolveDraftTarget(session);
      if (resolved.refused) {
        const { status, code, message } = resolved.refused;
        return reply.status(status).send({ error: { code, message } });
      }
      const { posting, inputs, stored } = resolved.target;
      // A stored draft whose fingerprint no longer matches the current fact set reads as no draft
      // at all — "a supported answer changes the draft consistently" holds on EVERY door, not only
      // the POST the shipped screen happens to call first. The remedy is the same as a plain miss:
      // ask for the draft again, and only the changed input is re-spent.
      if (!stored || stored.inputFingerprint !== inputs.fingerprint)
        return reply
          .status(404)
          .send({ error: { code: "no_draft", message: "no draft for this job's current facts" } });
      const contact = await deps.contact.getRecord(session.id);
      return tailorDraftView(
        stored,
        inputs.claimsDoc,
        posting,
        { phone: contact.phone?.value ?? null, email: contact.email?.value ?? null },
        { marks: stretchMarks(stored.stretch, req.query.open) },
      );
      },
    );

    // #418 (ADR-0005 clause 6: written once, frozen at render): approving freezes the used lines, so the
    // approved CV takes no answer, no Undo and no edited wording. A redraft is a fresh, unapproved CV.
    const FROZEN = { error: { code: "draft_approved", message: "This CV is approved, so its lines can no longer change." } };
    // What both suggestion doors answer with: the suggestions as the next read shows them
    // (stretchView), and every refusal in its one shape.
    const SuggestionsReply = z.object({
      stretch: z
        .discriminatedUnion("status", [
          z.object({ status: z.literal("ran"), suggestions: z.array(StretchProposalV2) }),
          z.object({ status: z.literal("failed") }),
        ])
        .nullable(),
    });

    // #417 (ADR-0020 clause 4): an answer to one stretch suggestion beside the current draft. "No"
    // declines it for this job only — the record lives beside THIS draft, so nothing else moves and
    // another job's run may suggest the same line again. Spends nothing; answers the suggestions
    // as the next read would show them. A suggestion the current draft does not carry (an old
    // draft's, a typo) is a 404, the same fail-closed shape as the other doors.
    app.post(
      "/onboarding/tailor/suggestions/:id",
      {
        schema: {
          params: z.object({ id: z.string().min(1) }),
          body: z.object({ answer: z.enum(STRETCH_ANSWERS) }),
          response: { 200: SuggestionsReply.extend({ keptUnder: z.string().optional() }), 400: Refusal, 404: Refusal, 409: Refusal },
        },
      },
      async (req, reply) => {
        const session = requireUser(req);
        const resolved = await resolveDraftTarget(session);
        if (resolved.refused) {
          const { status, code, message } = resolved.refused;
          return reply.status(status).send({ error: { code, message } });
        }
        const { posting, confirmed, inputs, stored } = resolved.target;
        if (stored?.approvedAt && stored.inputFingerprint === inputs.fingerprint) return reply.status(409).send(FROZEN);
        const answered =
          stored && stored.inputFingerprint === inputs.fingerprint
            ? answerSuggestion(stored.stretch, req.params.id, req.body.answer, new Date().toISOString())
            : null;
        if (!stored || !answered)
          return reply.status(404).send({ error: { code: "unknown_suggestion", message: "no such suggestion for this draft" } });
        // #419: "It's true" adds the line to the master CV (and Undo takes it off) — stretchFact.ts.
        const { keptUnder } = await saveAnswer(deps, session.id, posting, stored, answered, req.params.id, confirmed);
        return { stretch: stretchView(answered), ...(keptUnder ? { keptUnder } : {}) };
      },
    );

    // #420 (ADR-0020 clause 3; ADR-0005 clause 6): an edited wording on one pending suggestion. The
    // edited line and what to say if asked, rewritten for it by the step's re-say mode, are stored
    // together on the suggestion — so Use prints the edited line and "It's true" keeps it. The
    // checkpoint: a line that already reads so spends nothing (the stored pair was written for
    // exactly this line, on the facts of this current draft). Bounded per session by RESAY_LIMIT.
    app.post(
      "/onboarding/tailor/suggestions/:id/wording",
      {
        schema: {
          params: z.object({ id: z.string().min(1) }),
          body: z.object({ text: z.string().trim().min(1).max(600) }),
          response: { 200: SuggestionsReply, 400: Refusal, 404: Refusal, 409: Refusal, 429: Refusal, 502: Refusal },
        },
      },
      async (req, reply) => {
        const session = requireUser(req);
        const resolved = await resolveDraftTarget(session);
        if (resolved.refused) {
          const { status, code, message } = resolved.refused;
          return reply.status(status).send({ error: { code, message } });
        }
        // #419: the draft's own input (draftFacts), so a line another suggestion's "It's true" put on
        // the master CV never reads this draft as stale.
        const { posting, inputs } = resolved.target;
        const current = async () => {
          const stored = await deps.tailorDrafts.get(session.id, posting.id);
          return stored && stored.inputFingerprint === inputs.fingerprint ? stored : null;
        };
        const unknown = () =>
          reply.status(404).send({ error: { code: "unknown_suggestion", message: "no such open suggestion for this draft" } });
        const stored = await current();
        if (stored?.approvedAt) return reply.status(409).send(FROZEN);
        const target = editableSuggestion(stored?.stretch, req.params.id);
        // A suggestion exists only where the step ran, so stretchLlm is wired whenever target is.
        if (!stored || !target || !deps.stretchLlm) return unknown();
        const text = req.body.text.replace(/\s+/g, " ");
        if (text === target.claimText) return { stretch: stretchView(stored.stretch) };
        // Counted before the call, so a rewrite that then fails is counted too: it was paid for.
        if ((await deps.sessions.countStretchRewrite(session.id)) > RESAY_LIMIT)
          return reply.status(429).send({ error: { code: "rewrite_limit", message: "Your wording edits are used up." } });
        let say: string;
        try {
          say = await resayStretch(deps.stretchLlm, buildResayInput(text, inputs.claimsDoc));
        } catch (err) {
          console.error(`[ops] stretch re-say failed: ${err instanceof Error ? err.message : String(err)}`);
          return reply.status(502).send({ error: { code: "rewrite_failed", message: "could not rewrite what to say for this wording" } });
        }
        // Applied to what is stored NOW: an answer may have landed while the call ran.
        const fresh = await current();
        const edited = fresh ? rewordSuggestion(fresh.stretch, req.params.id, text, say) : null;
        if (!fresh || !edited) return unknown();
        await deps.tailorDrafts.put(session.id, posting.id, { ...fresh, stretch: edited });
        return { stretch: stretchView(edited) };
      },
    );

    // --- #313: approving is sending — one press, server-side gates, narrated wait --------------

    // Same per-process in-flight guard as draftRuns: a double press (or a reload mid-wait) joins
    // the send already running instead of emailing twice.
    const exportRuns = new Map<string, string>();

    /** The press. Body names the draftedAt of the document on his screen — that IS the approval,
     *  and it provably belongs to this draft (exportGate). Gates refused synchronously; the slow
     *  part (a ~33s cold browser start, then the mail) runs detached, narrated over
     *  `GET /jobs/:id/events` — the same stream every other wait uses. */
    app.post(
      "/onboarding/tailor/approve",
      { schema: { body: z.object({ draftedAt: z.string().min(1) }) } },
      async (req, reply) => {
        const session = requireUser(req);
        const resolved = await resolveDraftTarget(session);
        if (resolved.refused) {
          const { status, code, message } = resolved.refused;
          return reply.status(status).send({ error: { code, message } });
        }
        // The readPastedAdvert rule: no document maker wired ⇒ refuse honestly, never invent a PDF.
        if (!deps.documentMaker)
          return reply.status(503).send({
            error: { code: "export_unavailable", message: "making the PDF is switched off on this deployment" },
          });
        const { posting, adReq, confirmed, negatives, blocks, facts, claims, brought, inputs, stored } = resolved.target;
        // Both server-side gates — the current draft carries his approval AND the conservation
        // lint raises nothing fatal — live in exportGate, pure and directly tested.
        const refused = exportGate(stored, inputs, req.body.draftedAt);
        if (refused)
          return reply.status(refused.status).send({ error: { code: refused.code, message: refused.message } });
        // #315, the readPastedAdvert rule again: no report model wired ⇒ no press, never an email
        // without its report. Behind the draft gates, so a missing or unapproved draft still
        // answers as itself.
        if (!deps.reportLlm)
          return reply.status(503).send({
            error: { code: "report_unavailable", message: "writing the application report is switched off on this deployment" },
          });
        // #315 — the report's hard precondition, decided on the SAME judged card the screen shows
        // (judgeAndYears is composeTailorState's own head): an unjudged card refuses the press
        // before anything slow starts, and the states every section is built from are resolved
        // here, from the verdicts and his own answers — never by the model.
        const broughtJob = brought.find((job) => job.posting.id === posting.id);
        const { judgement: judged, years } = await judgeAndYears(session, adReq, confirmed, facts, blocks, broughtJob !== undefined);
        // #418: the card the screen showed counts the used stretches as met by a stretch; the report
        // reads the same verdicts and carries each used line to "Be ready to explain".
        const judgement = withStretchedVerdicts(judged, stored!.stretch);
        const card = buildJobCard(posting, adReq, confirmed, negatives, judgement, "estimated", years);
        const unjudged = reportGate(card);
        if (unjudged)
          return reply.status(unjudged.status).send({ error: { code: unjudged.code, message: unjudged.message } });
        const report = reportContext({
          posting, adReq, card, verdicts: judgement!.verdicts, confirmed, negatives, facts, claims, broughtJob, stretch: stored!.stretch,
        });
        const runKey = JSON.stringify([session.id, posting.id]);
        const running = exportRuns.get(runKey);
        if (running) return reply.status(202).send({ jobId: running });
        // requireUser guarantees a claimed session; a claimed session with no account row is a
        // store inconsistency and surfaces as our 500, never a silent mis-send.
        const user = await deps.auth.getUserById(session.claimedByUserId!);
        if (!user) throw new Error("claimed session has no account");
        // The approval record, durable before anything slow starts (spec #301's store test).
        const approved = { ...stored!, approvedAt: new Date().toISOString() };
        await deps.tailorDrafts.put(session.id, posting.id, approved);
        const contact = await deps.contact.getRecord(session.id);
        const job = await deps.jobs.create("tailor-export", session.id);
        exportRuns.set(runKey, job.id);
        void runTailorExportJob(
          {
            jobs: deps.jobs,
            documentMaker: deps.documentMaker,
            mailer: deps.mailer,
            tailorLlm: deps.tailorLlm,
            reportLlm: deps.reportLlm,
            tailorDrafts: deps.tailorDrafts,
          },
          job.id,
          {
            sessionId: session.id,
            record: approved,
            inputs,
            posting,
            contact: { phone: contact.phone?.value ?? null, email: contact.email?.value ?? null },
            email: user.email,
            report,
          },
        ).finally(() => exportRuns.delete(runKey));
        return reply.status(202).send({ jobId: job.id });
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
