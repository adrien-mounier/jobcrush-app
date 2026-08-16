// The deck + tailor composition layer — everything that shapes what a visitor sees on a card,
// extracted verbatim from routes/onboarding.ts (2026-08-12 architecture pass; the ratchet file may
// only shrink). No behaviour change: card shaping (buildJobCard, orderCardsForReveal), the shared
// ad-requirements/judgement resolvers with their timeout discipline, the years-shortfall read-time
// helpers, and the tailor-surface composition (tailorTarget, buildTailorState). The route file
// orchestrates; this module composes.
import type {
  AdRequirementsV1,
  CandidateClaim,
  CardScoreProvenance,
  FamilyPlacement,
  JobCardV1,
  PlacementConfidence,
  ScoredJobCardV1,
} from "@jobcrush/contracts";
import { soleConfirmedFamily } from "./adaptiveDiscovery.js";
import type { ClaimRecord } from "./claims.js";
import type { JobBlockView } from "./jobBlockStore.js";
import type { SessionRecord } from "./sessions.js";
import { familyPlacementConfidence, hasUnplacedWork } from "./yearsWorked.js";
import { lookupAdRequirements, loadFamilyFloor } from "./e5stub.js";
import { eligiblePostings, sessionPostings, type Posting } from "./preview.js";
import { ANY_FAMILY, type EligibilityFact } from "./eligibility.js";
import { applyEligibilityQuestions, excludingEligibility } from "./eligibilityDiscovery.js";
import { readingLanguages, languageEligible } from "./language.js";
import { addToCounter, incrementCounter, recordReadFailure } from "./counters.js";
import {
  matchBreakdown,
  matchTick,
  uncoveredRequirements,
  pickHitClause,
  NOTHING_OPEN_CLAUSE,
} from "./matchtick.js";
import {
  applyYearsShortfall,
  isFamilyScopeYearsBar,
  judgedBreakdown,
  judgedMatchTick,
  judgedPickHitClause,
  judgedUncoveredRequirements,
  type YearsAtScopes,
} from "./judgedScore.js";
import { attenuateForConfidence } from "./familyLabeler.js";
import type { JudgeFact, JudgeFn, JudgePeekFn } from "./judge.js";
import type { JudgementRecord } from "./judgementStore.js";
import {
  discoveryCvLines,
  discoveryState,
  factCount,
  resolveFamily,
  type DiscoveryCvLine,
} from "./discovery.js";
import { resolvedMarketsFor } from "./postingRetrieval.js";
import {
  buildTailorLedger,
  negativeRequirementIds,
  tailorCvLines,
  tailorQuestions,
  type LedgerLine,
  type TailorQuestion,
} from "./tailor.js";

/** #104's reader seam, named once here rather than via OnboardingDeps["readAd"] — structurally the
 *  same optional function the route deps carry. */
export type ReadAdFn = (posting: Posting) => Promise<AdRequirementsV1 | null>;

// --- #19 card shape (the pinned frontend contract) -----------------------------------------------
// 2026-08-12 (architecture pass candidate 2): the shape itself now lives in
// @jobcrush/contracts/src/jobCard.ts — the zod port golden-tested against the .mjs oracle — and this
// module aliases it. The web client imports the same definitions, so a card change is made once
// and every consumer follows or fails to type-check, instead of three hand-kept copies drifting.
export type JobCard = JobCardV1;
export type ScoredJobCard = ScoredJobCardV1;
export type { CardScoreProvenance };

// The deck's tiering policy (JC-22, kickoff decision #3), moved out of the spine by #236. A claim
// copied verbatim from the CV batch-approves as part of its section; anything the machine reworded
// or inferred gets an individual review card — those are the claims we might have gotten wrong.
// This lives here, not in the store, because it is deck policy (the store deliberately bakes none).
// ponytail: machine_touch split only; stakes-weighted ranking (titles/dates > tools) is the upgrade
// IF a CV ever overflows ~15 individual cards — the miner eval keeps the touched count under that, so
// there is nothing to rank yet.
export type DeckTier = "individual" | "batch";
export const claimTier = (touch: CandidateClaim["machine_touch"]): DeckTier =>
  touch === "verbatim" ? "batch" : "individual";

// #117 — the provenance discriminator, pinned identically for the frontend (do not deviate).
// `pending` and `unscored` were one state ("pending") until the coordinator's must-fix 2 review:
// a card that missed the shared judging budget IS still coming (the underlying call keeps running
// and self-heals into the store, same pattern as adReader.ts's read timeout — a later fetch resolves
// it for free via makeJudgePeek), but a card the bound never even attempted has NOTHING coming
// unless a later request happens to select it — collapsing the two meant the web deck's poll-while-
// pendingCount-is-nonzero loop could spin forever on a card that was never going to resolve.
//   - "judged": a real model verdict backed this card. matchPct/breakdown/bubble/dontYet are the
//     judged relation's numbers, unchanged from #105.
//   - "pending": a judge IS wired and a PAID judging attempt was made for this card THIS request,
//     but it missed the shared budget (DECK_JUDGE_BUDGET_MS) before landing. It is genuinely in
//     flight — the underlying call is still running and will persist when it completes — so a later
//     fetch resolves it for free. Counts toward the deck response's `pendingCount`, the signal the
//     client polls on.
//   - "unscored": a judge IS wired but this card fell outside DECK_JUDGE_MAX_CARDS's bound — no
//     judging attempt was made for it at all, deliberately, to cap spend. Nothing is "in flight" for
//     it; it resolves only if a LATER request's own bound happens to select it (or another visitor's
//     identical facts pay for it first). Does NOT count toward `pendingCount` — the client must not
//     poll waiting for something that was never bought.
//   Both "pending" and "unscored" claim NO number at all: matchPct/breakdown/bubble are null and
//   dontYet is empty, rather than silently substituting the deterministic scorer's number (the exact
//   lie AC5 exists to stop).
//   - "estimated": the deterministic scorer (matchtick.ts) produced the number and this field says
//     so. Emitted ONLY when no judge is wired at all (deps.judge absent — every pre-#105 test, local
//     dev with no key) or by the tailor surface's own always-falls-back-to-estimated behaviour
//     (buildTailorState, unchanged by this ticket). In this state matchPct/breakdown/bubble/dontYet
//     are byte-for-byte what they were before #117.

// #117: judged > estimated > pending > unscored. Lower ranks first. Extends #105 review round 4's
// judged-above-fallback grouping, then must-fix 2's pending/unscored split — a genuinely in-flight
// card ranks ahead of one that was never even attempted, for the same reason judged ranks ahead of
// either: they are not comparable states, and a flat score sort would treat them as if they were.
const SCORE_TIER: Record<CardScoreProvenance, number> = { judged: 0, estimated: 1, pending: 2, unscored: 3 };

/** Score-sort the deck, with two exceptions, applied in order:
 *  1. #105 review round 4, extended by #117 — cards group by provenance (SCORE_TIER's order) BEFORE
 *     they're score-sorted within each group. Different provenances come from different scorers (or
 *     none at all) and are not comparable, so mixing them into one flat score-sorted list is
 *     apples-to-oranges — a fallback card floating to the top puts the visitor's headline card on the
 *     ONE job the deck understands least, and a pending/unscored card has no score at all to be
 *     sorted by (kept stable, per #117's own AC).
 *  2. The curated-opener promotion (#19, untouched by #105's review — #111/slice 10 owns retiring
 *     it): the opener is still the best launch-safe card, operating on the grouped-then-scored list
 *     exactly as it always has — EXCEPT #117 adds one guard: a curated card with no verdict yet
 *     (pending OR unscored) is never promoted. Promoting it would put the deck's headline card in
 *     front with no number on it at all, exactly the lie AC5 forbids. Of the two options the ticket
 *     allows for this case (judge the opener regardless of rank, counted inside the bound — or leave
 *     it unpromoted), this picks the simpler one: leave it unpromoted, so it stays wherever the group
 *     sort placed it (the back) rather than adding bound-selection logic that special-cases curated
 *     ids. */
export function orderCardsForReveal<T extends { matchPct: number | null; scored: CardScoreProvenance }>(
  // #243 decision 2's second half — confidence decides ORDER (identity already decided deletion,
  // partitionByFamilyFit below). `familyConfidence` is the reader's own familyFit confidence,
  // passed only when this deck HAS a family (a word-search deck ranks exactly as before): within a
  // provenance tier a card ranks by matchPct × confidence, so an advert we are UNSURE belongs here
  // is shown last rather than destroyed — the displayed matchPct itself is never touched.
  entries: Array<{ card: T; curated: boolean; familyConfidence?: number }>,
): T[] {
  const rank = (entry: { card: T; familyConfidence?: number }) =>
    (entry.card.matchPct ?? 0) * (entry.familyConfidence ?? 1);
  const scoreSorted = [...entries].sort((a, b) => {
    const tierDiff = SCORE_TIER[a.card.scored] - SCORE_TIER[b.card.scored];
    if (tierDiff !== 0) return tierDiff;
    return rank(b) - rank(a);
  });
  const openerIndex = scoreSorted.findIndex(
    (entry) => entry.curated && entry.card.scored !== "pending" && entry.card.scored !== "unscored",
  );
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
export const CARD_RESOLUTION_CONCURRENCY = 6;

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
export const DECK_JUDGE_BUDGET_MS = 8_000;

// #117 AC1 — the stated bound: at most this many cards get a REAL judging attempt per deck request,
// regardless of how large the posting pool grows. It is NOT the pool size and must never be derived
// from it — AC1 is explicit that the bound has to be a fixed number, because #99-#101 (live
// retrieval) will grow the pool well past today's ~15 adverts, and a bound that scaled with the pool
// would stop being a bound at all.
//
// 8, chosen by measurement rather than by argument. THREE live staging runs settled it, and the third
// is the one worth remembering — raising this number makes the first deck WORSE, not better:
//
//   cap        cost/visitor   judged on first view   fallback rate   unearned numbers
//   (pre-#117) $0.29          6 of 15                9/15 (60%)      9 of 15
//   8          $0.1394        6 of 15                9/15 (60%)      0 of 15
//   20         $0.2985        3 of 15                12/15 (80%)     0 of 15
//
// At 20 nothing is bound-excluded (`judgeBoundHit` 0, `unscored` unreachable), so all ~15 adverts get
// a paid call — and 12 of them were still IN FLIGHT when DECK_JUDGE_BUDGET_MS expired. CARD_RESOLUTION_
// CONCURRENCY (6) turns 15 calls into three waves sharing ONE 8s wall, so later waves get almost no
// time and fewer finish. Buying more judgements moves a card from "never scored" to "not scored yet";
// it cannot move it to "scored in time". Paying 114% more bought HALF the first-view scores.
//
// The lesson this constant exists to carry: **the first-view score count is governed by
// DECK_JUDGE_BUDGET_MS against per-call latency, not by this bound.** Do not reach for this number to
// fix a deck that looks empty — it is the wrong lever and it moves the wrong way. The right fix is to
// stop scoring the whole deck up front and score just ahead of the visitor as they swipe (#121), which
// also retires the token-overlap pre-filter that currently picks WHICH cards are worth paying for.
//
// The bound is still a fixed number and must never be derived from the pool size — AC1 is explicit,
// and #99-#101 (live retrieval) will grow the pool well past today's ~15 adverts. At 8 it genuinely
// binds today, so `unscored` is reachable on a real cold deck and the honesty guarantee it carries
// (a card that claims no number rather than an unearned one) is exercised in production, not only in
// tests. CARD_RESOLUTION_CONCURRENCY and DECK_JUDGE_BUDGET_MS both still apply on top, unchanged.
//
// No logic anywhere is hardcoded around this value — changing this one constant is the whole review
// surface for a future revision, and OnboardingDeps.judgeMaxCards overrides it for tests that need a
// pool larger than the ceiling. See that field's own doc: data/sample-postings.json is the LIVE job
// pool, not a fixture, and must never carry synthetic entries just to make a pool exceed this number.
export const DECK_JUDGE_MAX_CARDS = 8;

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
 *  language skips. See counters.ts's header for the full reasoning.
 *
 *  #114: fixture resolution is a three-way lookupAdRequirements (e5stub.ts) now, not a bare
 *  try/catch around loadAdRequirements — a curated fixture that fails validation ("invalid") is no
 *  longer indistinguishable from an adId nobody ever curated ("missing"). "Invalid" drops the card
 *  and makes NO model call: the advert was already hand-curated, so re-deriving it from the model
 *  would be paying to redo work someone already did wrong, not work nobody did. Already counted
 *  (postings.fixture_invalid, e5stub.ts's buildFixtureIndex) once at index build, not counted again
 *  here. */
export async function resolveAdRequirements(
  adId: string,
  readAd: ReadAdFn | undefined,
  posting: Posting,
): Promise<AdRequirementsV1 | null> {
  const lookup = lookupAdRequirements(adId);
  if (lookup.status === "found") return lookup.requirements;
  if (lookup.status === "invalid") return null; // no fallback to the reader — see doc above
  // status === "missing" — unchanged fall-through to the injected reader.
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
 *  routes, which resolve one posting per request and have no wave-stacking problem to guard
 *  against. The deck route passes one deadline computed ONCE, shared across its whole fan-out
 *  (DECK_JUDGE_BUDGET_MS's own comment has the full reasoning): each call gets whatever's left of
 *  that ONE shared budget, so a card resolved in a later concurrency-cap wave gets correspondingly
 *  less time, and a call that starts after the budget is already spent gets ~0ms — an almost-instant
 *  fallback rather than another full wait. */
export async function resolveJudgement(
  adReq: AdRequirementsV1,
  confirmed: JudgeFact[],
  judge: JudgeFn | undefined,
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

/** #107 (E5 slice 6, D5) — the ONE place userYears is READ.
 *
 *  #162: the value is no longer a band the visitor tapped at a job-family scope; it is WORKED OUT
 *  from the dated job records (yearsWorked.ts) and stored as a regenerable copy at the GLOBAL scope
 *  (ANY_FAMILY) — the career total. #222 layers the family scope on top: see resolveSessionYears.
 *
 *  Reads `facts` — whatever the caller already fetched via discoveryReads — rather than its own
 *  eligibility.numeric() store call. Code review T1: the tailor path was making THREE serialised
 *  eligibility-store reads per request for data discoveryReads had already fetched once. Pure, no IO
 *  of its own — the same "facts is whatever the caller already read, never fetched here" contract
 *  withdrawal.ts's own findWithdrawingRequirement is held to.
 *
 *  null means UNTESTABLE — no usable work history yet (never uploaded, or a read that failed), which
 *  #86 decision 3 forbids from lowering anything: "leave the judged verdict untouched"
 *  (applyYearsShortfall's own null handling), and the card says the bar was not tested (buildJobCard).
 *  A CONFIDENT ZERO is a stored "0" and reads as the real number it is, never as null. */
export function resolveUserYears(facts: readonly EligibilityFact[]): number | null {
  const fact = facts.find((f) => f.dimension === "years-experience" && f.familyId === ANY_FAMILY);
  if (!fact) return null;
  const years = Number(fact.value);
  return Number.isFinite(years) ? years : null;
}

/** #222 — the visitor's years AT BOTH SCOPES, plus what the family number rests on. The one
 *  resolution of ADR-0014 amendment 1 decision 6, computed once per request and handed to every
 *  card. `familySource` says which rule produced `family`:
 *    - "fact":     the advert's family has a per-family years fact — placements back this number,
 *                  so their confidence (`familyConfidence`) may attenuate the CARD's score
 *                  (never the fact itself).
 *    - "zero":     every counting job is placed and none in the advert's family — a KNOWN zero,
 *                  scored as the real number it is, never softened to the career total.
 *    - "fallback": at least one counting job is unplaced/unmapped, so some years are genuinely
 *                  unaccounted for — the career total stands in (too generous, never too strict;
 *                  an unknown never lowers anything).
 *    - "unscoped": no advert family to read at (no confirmed session family) — the pre-#222
 *                  career-total reading, unchanged.
 *
 *  `advertFamilyId` comes from advertFamilyIdFor (below): the confirmed floor when one is pinned,
 *  else the target-role placement — the deck's own closed-vocabulary family. `adRequirements
 *  .familyFit` is still deliberately NOT used for the YEARS fact: #243 made it a closed-vocabulary
 *  answer (validated against the published list, so word-matching is no longer the objection) and
 *  consumes it for deck MEMBERSHIP and order (partitionByFamilyFit / orderCardsForReveal), but a
 *  years fact keys on the family the deck was searched for, which stays these two functions'
 *  resolution. */
export interface SessionYears extends YearsAtScopes {
  familySource: "fact" | "zero" | "fallback" | "unscoped";
  familyConfidence: PlacementConfidence | null;
}

/** #222 QA finding 1 — the advert's family must be resolvable on the SHIPPED journey, not only
 *  after the production-discovery flow (which the current web client never walks). The confirmed
 *  floor wins when the production checkpoint pinned one; otherwise the TARGET-ROLE placement from
 *  the same placeFamily seam the production checkpoint itself uses (makeFamilyPlacer: cached per
 *  session+role, degrades to unmapped on any failure, never throws). Null = no closed-vocabulary
 *  family for this session → resolveSessionYears's "unscoped" career-total fallback, the pre-#222
 *  reading. The deck being the target role's deck is the same assumption retrieval itself makes. */
export async function advertFamilyIdFor(
  session: Readonly<SessionRecord>,
  placeFamily: (session: Readonly<SessionRecord>) => Promise<FamilyPlacement>,
): Promise<string | null> {
  // #234: the SEARCH family, not the question floors — this resolves the family the deck's adverts
  // are about, and #235's word-search visitor is interviewed on floors nothing was searched with.
  if (session.discovery.searchFamily) return session.discovery.searchFamily.familyId;
  return soleConfirmedFamily(await placeFamily(session))?.familyId ?? null;
}

export function resolveSessionYears(
  facts: readonly EligibilityFact[],
  blocks: readonly JobBlockView[],
  advertFamilyId: string | null,
): SessionYears {
  const total = resolveUserYears(facts);
  if (total === null) return { total, family: null, familySource: "unscoped", familyConfidence: null };
  if (advertFamilyId === null) {
    return { total, family: total, familySource: "unscoped", familyConfidence: null };
  }
  const fact = facts.find(
    (f) => f.dimension === "years-experience" && f.familyId === advertFamilyId,
  );
  const factYears = fact === undefined ? null : Number(fact.value);
  if (factYears !== null && Number.isFinite(factYears)) {
    return {
      total,
      family: factYears,
      familySource: "fact",
      familyConfidence: familyPlacementConfidence(blocks, advertFamilyId),
    };
  }
  if (hasUnplacedWork(blocks)) {
    return { total, family: total, familySource: "fallback", familyConfidence: null };
  }
  return { total, family: 0, familySource: "zero", familyConfidence: null };
}

/** #107 (D5) — applies judgedScore.ts's applyYearsShortfall (see its own doc for the attenuation
 *  rule and why it can only ever lower a score) on top of whatever resolveJudgement returned, at READ
 *  TIME only; never persisted. A plain pass-through when there's nothing to adjust. */
export function withYearsShortfall(
  judgement: JudgementRecord | null,
  adReq: AdRequirementsV1,
  years: SessionYears,
): JudgementRecord | null {
  if (!judgement || (years.family === null && years.total === null)) return judgement;
  return { ...judgement, verdicts: applyYearsShortfall(judgement.verdicts, adReq, years) };
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
 *  which relation produced the open list it's being filtered out of.
 *  #117 adds the `scored` provenance discriminator (CardScoreProvenance) and the `unresolvedScored`
 *  param below: when `judgement` is null, the caller decides whether that means "pending" (a judge
 *  IS wired and a paid attempt was made this request but missed the shared budget — genuinely in
 *  flight, no number claimed), "unscored" (a judge is wired but the bound never attempted this card
 *  at all — nothing claimed, nothing in flight either), or "estimated" (no judge wired at all, or
 *  the tailor surface's own always-falls-back state — today's deterministic number, labelled
 *  honestly). matchPct/breakdown/bubble are null for both "pending" and "unscored". */
// Overloaded: a caller that always passes "estimated" (the tailor surface) structurally can never
// receive a pending/unscored card, and the narrower return type states that invariant — every use
// of `card.matchPct` there keeps type-checking as a plain number, no `!`/`as`.
export function buildJobCard(
  posting: Posting,
  adReq: AdRequirementsV1,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  judgement: JudgementRecord | null,
  unresolvedScored: "estimated",
  years?: SessionYears,
): ScoredJobCard;
export function buildJobCard(
  posting: Posting,
  adReq: AdRequirementsV1,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  judgement: JudgementRecord | null,
  unresolvedScored: "pending" | "unscored" | "estimated",
  years?: SessionYears,
): JobCard;
export function buildJobCard(
  posting: Posting,
  adReq: AdRequirementsV1,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  judgement: JudgementRecord | null,
  // #117 — what to claim when `judgement` is null: "pending"/"unscored" from the deck route when a
  // judge IS wired (must-fix 2's split — see CardScoreProvenance's own doc for which is which),
  // "estimated" from the tailor surface always, and from the deck route too when no judge is wired
  // at all.
  unresolvedScored: "pending" | "unscored" | "estimated",
  // #222 — the visitor's years at both scopes (resolveSessionYears). Absent = a caller with no
  // years context, which claims nothing new: every bar reads as tested (the pre-#162 default).
  // total === null is #162 AC6's "no usable work history": every years bar on this advert went
  // untested rather than unmet.
  years?: SessionYears,
): JobCard {
  const yearsTested = years === undefined || years.total !== null;
  const negativeIds = negativeRequirementIds(adReq, negatives);
  // Named on the card, never folded into the score: an unknown is not a shortfall.
  const notTested = yearsTested
    ? []
    : adReq.requirements
        .filter((r) => r.eligibilityDimension === "years-experience")
        .map((r) => ({ id: r.id, band: r.band, requirement: r.requirement }));
  const notTestedIds = new Set(notTested.map((r) => r.id));
  const base = {
    schemaVersion: "1" as const,
    adId: posting.id,
    title: posting.title,
    company: posting.company,
    place: posting.location,
    salary: null,
    pattern: null,
    // #106 code-review D1 (2026-08-03, round 3): unfiltered, this put every eligibility DECLINE on
    // EVERY card in the deck as if it were that ad's own "asked and closed" gap — an eligibility
    // decline has nothing to do with any one ad's requirements. `fit` needs the same guard for
    // symmetry even though nothing eligibility-related is ever in `confirmed` today (must-fix 1: a
    // real eligibility answer never enters the claims store at all).
    fit: excludingEligibility(confirmed).map((c) => ({ id: c.id, text: c.text })),
    askedClosed: excludingEligibility(negatives).map((c) => ({ id: c.id, text: c.text })),
    adExcerpt: posting.excerpt,
    ...(notTested.length > 0 ? { notTested } : {}),
  };
  if (!judgement && (unresolvedScored === "pending" || unresolvedScored === "unscored")) {
    // #117 AC5 — no number at all, rather than silently substituting the deterministic scorer's
    // number (the exact lie this ticket exists to stop). dontYet is empty, not "every requirement" —
    // an unscored/pending card has nothing yet to call an open gap either.
    return { ...base, scored: unresolvedScored, matchPct: null, breakdown: null, bubble: null, dontYet: [] };
  }
  // #162 AC6, review must-fix: an untested bar is listed ONCE, under `notTested`, never also here —
  // the same bar under "Where you don't — yet" AND "Not tested" tells the reader two things at once.
  // A DISPLAY move only: the requirement stays in every scored relation below, exactly as it was
  // before #162, because dropping it from the denominator would LOWER the score of anyone whose CV
  // evidence already covers it — the opposite of what this AC asks for.
  const dontYet = (judgement ? judgedUncoveredRequirements(judgement.verdicts, adReq) : uncoveredRequirements(confirmed, adReq))
    .filter((r) => !negativeIds.has(r.id) && !notTestedIds.has(r.id))
    .map((r) => ({ id: r.id, band: r.band, requirement: r.requirement }));
  // #222 / ADR-0014 amendment 1 decision 5 — the confidence attenuation's PRODUCTION CALLER (#231
  // AC6's other half). When this card's score leaned on a per-family years FACT (a family-scope
  // years bar tested against real placements), the weakest contributing placement's ordinal sinks
  // the whole card's score at the owner's weights (x1.0 / x0.9 / x0.75): an 80% card reads 72% at
  // `likely`, 60% at `possible`. Ranking only — the years fact is untouched, nothing is filtered,
  // and no surface prints the level. A zero, fallback, or unscoped family number rests on no
  // placement, so there is nothing for a confidence to hedge — left alone. Judged path only:
  // family-scoped years never reach the deterministic estimated tick.
  const leansOnFamilyFact =
    years?.familySource === "fact" &&
    years.familyConfidence !== null &&
    adReq.requirements.some(isFamilyScopeYearsBar);
  const attenuate = (pct: number): number =>
    leansOnFamilyFact && years?.familyConfidence ? attenuateForConfidence(pct, years.familyConfidence) : pct;
  return {
    ...base,
    scored: judgement ? "judged" : "estimated",
    matchPct: judgement ? attenuate(judgedMatchTick(judgement.verdicts, adReq)) : matchTick(confirmed, adReq),
    breakdown: judgement ? judgedBreakdown(judgement.verdicts, adReq) : matchBreakdown(confirmed, adReq),
    // #23 D1, now shared: pickOpenClause is negative-blind (it only knows the ad/coverage relation),
    // so it can keep naming a requirement the visitor just declined. Take the open clause from the
    // already-filtered dontYet instead — same fallback as pickOpenClause's own.
    bubble: {
      hit: judgement ? judgedPickHitClause(judgement.verdicts, adReq, confirmed) : pickHitClause(confirmed, adReq),
      open: dontYet[0]?.requirement ?? NOTHING_OPEN_CLAUSE,
    },
    dontYet,
  };
}

/** #243 decision 1/2 — identity decides DELETION: an advert whose read-stamped familyFit names
 *  another family, or "none of these", leaves the deck entirely (the owner rejected the sink-only
 *  shape: a construction job in an IT deck reads as a broken product). Confidence never deletes —
 *  an advert naming THIS deck's family is kept whatever its confidence, and a weak one sinks in the
 *  ranking instead (orderCardsForReveal). `deckFamilyId` is the family THIS DECK WAS SEARCHED FOR
 *  (advertFamilyIdFor — decision 4: #228's fallback deck is a different family on purpose, so its
 *  own cards survive); null (word search, no confirmed placement) compares nothing and keeps all.
 *  The dropped count is the ticket's own "without a number we will believe this worked" AC —
 *  counted on deck.family_dropped, observable on /ops/counters. */
export function partitionByFamilyFit<T extends { adReq: AdRequirementsV1 }>(
  candidates: T[],
  deckFamilyId: string | null,
): { kept: T[]; dropped: number } {
  if (deckFamilyId === null) return { kept: candidates, dropped: 0 };
  const kept = candidates.filter((entry) => entry.adReq.familyFit.family === deckFamilyId);
  const dropped = candidates.length - kept.length;
  if (dropped > 0) addToCounter("deck.family_dropped", dropped);
  return { kept, dropped };
}

/** The deck response's per-card provenance tally (#117 AC3/AC8), moved out of the route by #243 —
 *  observable on /ops/spend alongside cost per visitor. Returns pendingCount: ONLY genuinely
 *  in-flight (`pending`) cards, never `unscored` ones, so a client polling on it terminates
 *  instead of waiting forever on a card that was never bought (#117 must-fix 2). */
export function tallyCardProvenance(cards: Array<{ scored: CardScoreProvenance }>): number {
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
  return pendingCount;
}

export interface DeckJudgingDeps {
  judge?: JudgeFn;
  judgePeek?: JudgePeekFn;
  /** Overrides DECK_JUDGE_MAX_CARDS when set (test-only in practice — main.ts never sets it), so a
   *  test can construct a "pool exceeds the ceiling" scenario against the REAL posting pool instead
   *  of adding synthetic entries to product data (#117 review). */
  judgeMaxCards?: number;
}

export interface JudgedCandidate {
  posting: Posting;
  adReq: AdRequirementsV1;
  judgement: JudgementRecord | null;
  /** True only for a REAL paid judging attempt made this request — the pending/unscored split. */
  attempted: boolean;
}

/** The deck's whole judging pass — peek → rank → bound → budget → resolve — over candidates that
 *  already survived language eligibility and withdrawal. Extracted verbatim from GET
 *  /onboarding/cards (2026-08-12 architecture pass, candidate 1); the spend-bound properties
 *  (MF-A: repeated identical polls never pay more than the bound; the shared wall-clock budget)
 *  live here now.
 *
 *  #117 must-fix A (coordinator review, severe) — the PAID set is ranked over EVERY eligible
 *  candidate, not just whatever peek fails to resolve for free. Ranking over "unresolved" was the
 *  bug: request 1 pays for the top 8, some land in the store; request 2's free peek resolves those,
 *  which — if the paid set were re-derived from "still unresolved" — frees up 8 MORE slots for a
 *  fresh paid attempt, and a visitor who simply reloads the deck a few times walks the paid set
 *  down the entire pool, paying for all 15 by the third or fourth poll — exactly the ~$0.29
 *  cold-deck spend #117 exists to eliminate. Ranking over EVERY candidate makes the paid set a PURE
 *  FUNCTION of (this fact set, these requirement sets) alone: unchanged inputs always re-derive the
 *  IDENTICAL set, so once its members are stored, a repeat poll finds all of them cached and pays
 *  for nothing further — the poll converges instead of walking the pool.
 *
 *  KNOWN WEAKNESS, accepted deliberately: matchTick is the very token-overlap scorer #86/#105 exist
 *  to replace — it is blind to meaning (a candidate who "ran weekly steering meetings with the CFO"
 *  scores 0% against "coordinate business and technical stakeholders" on this same scorer, per
 *  #86's own Problem Statement). A genuinely strong match phrased in the candidate's own words can
 *  therefore rank low on vocabulary and never make the paid set. This is a CHEAP PRE-FILTER
 *  deciding what's worth paying to verify, not a verdict on the card itself — fixing the
 *  pre-filter's own blindness is out of scope here and belongs with family-fit ranking (#107). */
export async function judgeDeck(
  openCandidates: Array<{ posting: Posting; adReq: AdRequirementsV1 }>,
  confirmed: ClaimRecord[],
  deps: DeckJudgingDeps,
): Promise<{ entries: JudgedCandidate[]; judgeWired: boolean }> {
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

  const entries = await mapWithConcurrency(peeked, CARD_RESOLUTION_CONCURRENCY, async (entry) => {
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
  return { entries, judgeWired };
}

// --- #23 tailor shape (the pinned frontend contract) -----------------------------------------------
export interface TailorState {
  // Narrowed to the scored variant on purpose — tailor always calls buildJobCard with "estimated"
  // (the overload above), so a pending/unscored card is unrepresentable here, matching the web
  // client's own TailorState.card: ScoredJobCard.
  card: ScoredJobCard;
  questions: TailorQuestion[];
  ledger: LedgerLine[];
  cvLines: DiscoveryCvLine[];
  closedGaps: { closed: number; asked: number };
  done: boolean;
  factCount: number;
}

/** This session's tailor target, resolved to its posting + requirements — or null if either is no
 *  longer present in the session's posting pool. tailorAdId is PERSISTED session state that can
 *  outlive the pool entry that validated it at /onboarding/cards/:adId/want time — so a miss here is
 *  reachable, not impossible, and must fail
 *  closed with the same 404 that route already uses for an unknown card id. */
export async function tailorTarget(
  session: Pick<SessionRecord, "id" | "retrieval">,
  adId: string,
  readAd: ReadAdFn | undefined,
  requestFingerprint: string,
): Promise<{ posting: Posting; adReq: AdRequirementsV1 } | null> {
  // #103: same dual gate as the deck and /want — a persisted tailorAdId for a posting (or a
  // requirement set) this session's languages can no longer read (or never could) fails closed with
  // the existing "unknown card" 404.
  const langs = readingLanguages(session);
  const posting = eligiblePostings(langs, sessionPostings(session, requestFingerprint)).find((p) => p.id === adId);
  if (!posting) return null;
  // #104: a card the user can already see must be tailorable — fixture-or-reader via the same
  // shared resolver as the deck, so a newly-read (not hand-curated) advert doesn't 404 here just
  // because it never had a fixture.
  const adReq = await resolveAdRequirements(adId, readAd, posting);
  if (!adReq || !languageEligible(adReq.language, langs)) return null;
  return { posting, adReq };
}
// #107 (D4/M3, code review): withdrawal is checked by the two callers (GET /onboarding/tailor,
// POST /onboarding/tailor/answer) instead of here — a target that was resolvable but has since
// become withdrawn must behave EXACTLY like no target at all (M3), which needs deps.sessions to
// clear the persisted target, not just a null return this function has no session-mutation access
// to. Both callers already read this session's eligibility facts via discoveryReads (T1: one read,
// not tailorTarget's own extra eligibility.list() call), so the check costs nothing extra there.

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
export function buildTailorState(
  posting: Posting,
  adReq: AdRequirementsV1,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  role: string | null,
  floorPct: number,
  judgement: JudgementRecord | null,
  // #162 AC6, review must-fix: the tailor surface renders the SAME advert as the deck, so it must
  // reach the same verdict on whether the years bar could be tested. Without this it defaulted to
  // "tested" and one visitor saw the bar named untested on the deck and silently missing here.
  // #222: now the full years-at-scopes resolution, so family-scope bars test the same number here
  // as on the deck (the route applies withYearsShortfall before passing `judgement` in).
  years?: SessionYears,
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
  // #117 scope discipline: tailor ALWAYS falls back to "estimated", never "pending" — it judges one
  // card on demand with a full budget (resolveJudgement's default deadline above), so there is no
  // bound here to be excluded by; a failed/timed-out call still shows today's deterministic number,
  // now labelled rather than silent.
  // Confidence deliberately STRIPPED here: attenuation is a deck-RANKING device (ADR-0014
  // amendment 1 decision 5), and the tailor's monotonic floor (raiseTailorFloor stores the raw
  // judged number) would silently swallow it anyway — an attenuated card score under a raw floor
  // reads as the floor. One surface, one number.
  const card = buildJobCard(posting, adReq, confirmed, negatives, judgement, "estimated",
    years && { ...years, familyConfidence: null });

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
    // #106 code-review D1 (2026-08-03, round 3): a decline is a refusal, not a recorded fact.
    factCount: factCount(excludingEligibility(confirmed), excludingEligibility(negatives)),
  };
}

/** #235 — is there genuinely another discovery question this session could answer? Governs the empty
 *  deck's copy: "answer a few more questions and I'll widen the net" may only be shown when a
 *  question actually exists — a visitor whose word search returned nothing and whose questions are
 *  all answered is invited to try a different job title instead, never sent to an empty ask screen.
 *  Deck policy, so it lives here: the union of the fixture discovery loop's open questions (floor +
 *  eligibility, the same composition GET /onboarding/discovery serves) and an uncovered production
 *  question-floor checkpoint. */
export function hasOpenDiscoveryQuestions(
  session: Pick<SessionRecord, "targetTitles" | "intent" | "discovery">,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  rejected: ClaimRecord[],
  facts: readonly EligibilityFact[],
  blocks: readonly JobBlockView[],
): boolean {
  if (
    session.discovery.questionFloors.length > 0 &&
    session.discovery.checkpoint !== "essential_floor_covered"
  ) {
    return true;
  }
  const role = session.targetTitles[0] ?? null;
  if (!role) return true; // question 1 itself is still open
  const state = discoveryState(role, confirmed, negatives, rejected, null);
  applyEligibilityQuestions(
    role,
    state,
    confirmed,
    negatives,
    rejected,
    facts,
    resolvedMarketsFor(session.intent.searchAreas),
    blocks,
  );
  return state.questions.length > 0;
}
