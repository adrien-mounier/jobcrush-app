// #307 — the Tailor queue's PROFILE-LEVEL questions (#292 rulings 1, 3, 4, 7, 9).
//
// A profile-level question is one whose answer outlives the advert that raised it: today that is
// work rights (the one dimension ADR-0008 clause 5 marks "asked, always" with no other home once
// discovery is over). The answer writes to the ELIGIBILITY store at the posting's own market scope
// — never the claims store (#106 must-fix 1: a real eligibility answer rendered as a claim lies
// about the visitor) and never an advert-scoped tailor claim (#287 clause 5's "written, not
// enforced" fix, enforced here).
//
// The three rules this module owns, each a #307 acceptance criterion:
//   - Asked only when THE ADVERT states the requirement (#292 ruling 9): an unfamiliar market
//     raises no question on its own — inventing a requirement manufactures a gap, and a "No" to a
//     manufactured gap manufactures a deck deletion.
//   - Asked once EVER per market: a stored fact at the posting's region means no question, on this
//     job or any later one. The lookup is withdrawal.ts's own findWorkRightsFact — the same match
//     the withdrawal engine makes, so "answered" here and "actionable" there can never disagree.
//   - NEVER years of experience (ADR-0008 clause 2, the Mei rule): years are worked out from dated
//     job blocks. There is no years branch below, and tailorProfile.test.ts pins that an advert's
//     years bar produces no question — the queue-side half of AC8's "no family-floor question".
//
// The language ladder stays on the card for now — #308 retires it into this queue. This module's
// shape (one question kind, prepended before the advert's own) is what #308 extends.
//
// DELIBERATELY UNTOUCHED (spec review, recorded so nobody "fixes" it silently): the card's own gap
// row for a profile-answered requirement. A work-rights bar answered "yes" stays listed under
// "Where you don't — yet", because coverage is read off claims and judgements, which an
// eligibility fact never enters — the SAME display shape every eligibility bar (language included)
// has today. Feeding the fact back into the number/row is #292 ruling 10 and req 10 ("the number
// names what it could not test; a movement is narrated"), which the V4 order places after this
// ticket — and open thread: the owner may rule on that wording (#306 handoff §8.2).
import type { AdRequirementsV1 } from "@jobcrush/contracts";
import type { EligibilityFact } from "./eligibility.js";
import { DECLINE_OPTION, workRightsQuestionFor } from "./eligibilityDiscovery.js";
import { findWithdrawingRequirement, findWorkRightsFact, isExplicitNo } from "./withdrawal.js";
import { marketForLocationText } from "./postingRetrieval.js";
import type { BroughtJob } from "./broughtJobs.js";
import type { Posting } from "./preview.js";

/** One profile-level queue entry. Rides in TailorState.questions AHEAD of the advert's own
 *  questions (#292 ruling 3: he never answers five requirement questions about a job he cannot
 *  legally take). `requirementId` carries the eligibility itemId — the client posts it back to
 *  /onboarding/tailor/profile-answer untouched, and it can never collide with an advert
 *  requirement id (those are the reader's own kebab ids, never "eligibility-" prefixed). */
export interface ProfileAsk {
  requirementId: string;
  kind: "profile";
  /** The eligibility dimension the answer writes to — the route maps the tapped option through
   *  mapEligibilityAnswer at THIS dimension, so the after-line's yes/no branch is derived from the
   *  answer he actually gave, never from a store re-read that could miss on a scope mismatch. */
  dimension: "work-rights";
  question: string;
  options: string[];
  /** AC6's before-line: said BEFORE he answers, because the answer is permanent. */
  remember: string;
  /** The market the answer is a fact about — display name ("Hong Kong"), for the after-line. */
  market: string;
}

/** The profile-level questions THIS advert raises for THIS session — [] when the advert asks for
 *  nothing profile-level, when the posting's market cannot be placed (never guess a market to ask
 *  about), or when the fact is already stored (asked once, ever). At most one per kind per advert
 *  (#292 ruling 3's cap): work rights is per-market and a posting has one market.
 *
 *  No decline option in #307 — a decline here would close the question through the claims store,
 *  which is exactly the "skip hardens into a blank" ADR-0011 clause 4 forbids. The third option
 *  ("not sure yet", stores nothing, returns) is #308's. Until then the exits stay open: nothing
 *  forces an answer — "I'm done — use this CV" and "Drop this job" both stand. */
export function tailorProfileAsks(
  adReq: AdRequirementsV1,
  postingLocation: string | null | undefined,
  facts: readonly EligibilityFact[],
): ProfileAsk[] {
  if (!adReq.requirements.some((r) => r.eligibilityDimension === "work-rights")) return [];
  const market = marketForLocationText(postingLocation ?? "");
  if (!market) return [];
  if (findWorkRightsFact(facts, postingLocation)) return []; // answered once — never again
  const question = workRightsQuestionFor(market);
  return [
    {
      requirementId: question.itemId,
      kind: "profile",
      dimension: "work-rights",
      question: question.question,
      options: question.options.filter((o) => o !== DECLINE_OPTION),
      remember: `I'll remember this for every job in ${market}.`,
      market,
    },
  ];
}

/** Requirement ids whose question IS the profile question — one queue means one question. Without
 *  this, the advert's own work-rights requirement would also surface as a plain "This job wants:
 *  …" Yes/No (tailorQuestions has no eligibility awareness by design), one screen after the
 *  permanent ask: the indistinguishable-twin defect #292 ruling 2 exists to close — and answering
 *  THAT one would write the advert-scoped claim AC4 forbids. buildTailorState subtracts this set
 *  from the advert's questions, and the answer route refuses these ids outright.
 *
 *  Scoped to a PLACEABLE market: when the posting's market cannot be resolved, no profile question
 *  exists to own the requirement, so it stays an ordinary advert question — the pre-#307
 *  behaviour, unchanged, rather than a requirement with no door to answer it at all. */
export function profileOwnedRequirementIds(
  adReq: AdRequirementsV1,
  postingLocation: string | null | undefined,
): Set<string> {
  if (!marketForLocationText(postingLocation ?? "")) return new Set();
  return new Set(
    adReq.requirements.filter((r) => r.eligibilityDimension === "work-rights").map((r) => r.id),
  );
}

/** How many jobs THIS answer just removed from his deck — the honest number the after-line carries.
 *  Counted as "withdraws under the new facts but not the old", so a job already gone for another
 *  reason (a language "no") is never re-counted, and a brought job — which never withdraws — never
 *  counts. Pure; the caller resolves the candidates. */
export function newlyHiddenCount(
  candidates: ReadonlyArray<{ posting: Posting; adReq: AdRequirementsV1 }>,
  factsBefore: readonly EligibilityFact[],
  factsAfter: readonly EligibilityFact[],
  brought: readonly BroughtJob[],
): number {
  return candidates.filter(
    (entry) =>
      findWithdrawingRequirement(entry.adReq, factsBefore, entry.posting.location ?? null, brought) === null &&
      findWithdrawingRequirement(entry.adReq, factsAfter, entry.posting.location ?? null, brought) !== null,
  ).length;
}

/** AC6's after-line: what changed because he answered. The undo it points at already exists — the
 *  profile's per-market work-rights door (#292 ruling 7). `value` is the store's own canonical
 *  token; withdrawal.ts's isExplicitNo is the one place that knows which value is a "no". */
export function profileChangeLine(value: string, market: string, hidden: number): string {
  if (!isExplicitNo("work-rights", value)) {
    return `Remembered: you can work in ${market}. No job will ask you this again.`;
  }
  if (hidden > 0) {
    const jobs = hidden === 1 ? "job" : "jobs";
    return `Hidden ${hidden} ${market} ${jobs} from your deck — change this any time in your profile.`;
  }
  return `Remembered. Jobs in ${market} that need sponsorship will stay off your deck — change this any time in your profile.`;
}
