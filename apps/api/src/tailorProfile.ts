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
// #308 adds the second kind — the graded language ladder, retired off the deck card into this
// queue (rungs and "Not now" intact; languageLevel.ts still owns the rungs and the write path) —
// and the queue's way out: a skip ("Not sure yet" / "Not now") that stores NOTHING, on either
// path. Not a fact, not a sentinel, not a decline marker — skip memory is QUEUE state
// (SessionRecord.tailorSkips, keyed per advert), so a skipped question returns on the next job
// that raises it and never re-fires on the job it was skipped on (ADR-0011 clause 4).
//
// DELIBERATELY UNTOUCHED (spec review, recorded so nobody "fixes" it silently): the card's own gap
// row for a profile-answered requirement. A work-rights bar answered "yes" stays listed under
// "Where you don't — yet", because coverage is read off claims and judgements, which an
// eligibility fact never enters — the SAME display shape every eligibility bar (language included)
// has today. Feeding the fact back into the number/row is #292 ruling 10 and req 10 ("the number
// names what it could not test; a movement is narrated"), which the V4 order places after this
// ticket — and open thread: the owner may rule on that wording (#306 handoff §8.2).
import type { AdRequirementV1, AdRequirementsV1, LanguageLevel } from "@jobcrush/contracts";
import type { EligibilityFact } from "./eligibility.js";
import { DECLINE_OPTION, workRightsQuestionFor } from "./eligibilityDiscovery.js";
import { findWithdrawingRequirement, findWorkRightsFact, isExplicitNo } from "./withdrawal.js";
import { marketForLocationText } from "./postingRetrieval.js";
import { LANGUAGE_LADDER, LANGUAGE_NOT_AT_ALL, languageLevelAsk } from "./languageLevel.js";
import type { BroughtJob } from "./broughtJobs.js";
import type { Posting } from "./preview.js";

/** #308 AC1 — the third option on a permanent question. Not an answer: the route stores NOTHING
 *  when it is tapped (AC5), and the question returns on the next job that raises it. */
export const NOT_SURE_YET = "Not sure yet";

interface ProfileAskBase {
  requirementId: string;
  kind: "profile";
  question: string;
  options: string[];
  /** AC6's before-line: said BEFORE he answers, because the answer is permanent. */
  remember: string;
  /** #308 AC2 — the way out. Tapping it writes nothing anywhere but the session's own queue
   *  state (tailorSkips), so the question steps aside for THIS job only and comes back on the
   *  next one that asks (ADR-0011 clause 4: a skip is "not now", never "stop asking"). */
  skip: string;
}

/** One profile-level queue entry. Rides in TailorState.questions AHEAD of the advert's own
 *  questions (#292 ruling 3: he never answers five requirement questions about a job he cannot
 *  legally take). Discriminated on `dimension` — the route dispatches the write path on it, so
 *  the after-line is always derived from the answer he actually gave, never a store re-read.
 *
 *  `requirementId` is what the client posts back untouched: the eligibility itemId for
 *  work-rights (never collides with a reader id — those are kebab ids, never "eligibility-"
 *  prefixed), and the advert requirement's own id for a language (the same id
 *  profileOwnedRequirementIds subtracts from the advert's questions). */
export interface WorkRightsProfileAsk extends ProfileAskBase {
  dimension: "work-rights";
  /** The market the answer is a fact about — display name ("Hong Kong"), for the after-line. */
  market: string;
}

/** #308 AC3/AC4 — the ladder, in the queue: `options` are the six rungs' SITUATIONS in the
 *  ladder's own offered order (descending, so "I don't speak this one" sits last, where a
 *  distracted thumb does not land), so a language answer is graded, never a Yes/No.
 *  languageLevelAsk composes every line of it — languageLevel.ts stays the one module that owns
 *  the ladder's rules, and the deck card that used to render this ask no longer asks at all. */
export interface LanguageProfileAsk extends ProfileAskBase {
  dimension: "language";
  /** The language, in the store's canonical casing when declared — shown to a person. */
  language: string;
  /** Why THIS advert cares, quoting its own requirement line. */
  why: string;
  /** What answering costs, said BEFORE the rungs (#125 decision 4). */
  consequence: string;
}

export type ProfileAsk = WorkRightsProfileAsk | LanguageProfileAsk;

/** The profile-level questions THIS advert raises for THIS session — [] when the advert asks for
 *  nothing profile-level or every question is already answered (asked once, ever). At most one per
 *  KIND per advert (#292 ruling 3's cap): work-rights first (never five questions about a job he
 *  cannot legally take), then the language ladder (#308 — one language per advert, the first
 *  unknown in the advert's own rank order, languageLevelAsk's rule unchanged by the move).
 *
 *  The discovery decline never appears here — it would close the question through the claims
 *  store, the exact "skip hardens into a blank" ADR-0011 clause 4 forbids. The way out is `skip`
 *  (#308): stores nothing, returns on the next job that asks.
 *
 *  `skips` (#308) is the session's queue state, already narrowed to the CURRENT tailor target by
 *  the caller (routes/tailor.ts's tailorSkipsFor) — requirementIds he said "not now" to on THIS
 *  job. A skipped ask is left out here, so it never re-fires on the job it was skipped on; a
 *  different job raising the same question carries a different key, so it asks. */
export function tailorProfileAsks(
  adReq: AdRequirementsV1,
  postingLocation: string | null | undefined,
  facts: readonly EligibilityFact[],
  skips: ReadonlySet<string> = new Set(),
): ProfileAsk[] {
  const asks: ProfileAsk[] = [];
  const market = marketForLocationText(postingLocation ?? "");
  if (
    adReq.requirements.some((r) => r.eligibilityDimension === "work-rights") &&
    market && // never guess a market for a permanent question
    !findWorkRightsFact(facts, postingLocation) // answered once — never again
  ) {
    const question = workRightsQuestionFor(market);
    asks.push({
      requirementId: question.itemId,
      kind: "profile",
      dimension: "work-rights",
      question: question.question,
      options: question.options.filter((o) => o !== DECLINE_OPTION),
      remember: `I'll remember this for every job in ${market}.`,
      skip: NOT_SURE_YET,
      market,
    });
  }
  const lang = languageLevelAsk(adReq, facts); // null once answered — asked once per language ever
  if (lang) {
    asks.push({
      requirementId: lang.requirementId,
      kind: "profile",
      dimension: "language",
      language: lang.language,
      question: lang.question,
      why: lang.why,
      consequence: lang.consequence,
      remember: "I'll remember this for every job.",
      options: lang.options.map((rung) => rung.situation),
      skip: lang.skipOption,
    });
  }
  return asks.filter((ask) => !skips.has(ask.requirementId));
}

/** Requirement ids whose question IS the profile question — one queue means one question. Without
 *  this, the advert's own work-rights requirement would also surface as a plain "This job wants:
 *  …" Yes/No (tailorQuestions has no eligibility awareness by design), one screen after the
 *  permanent ask: the indistinguishable-twin defect #292 ruling 2 exists to close — and answering
 *  THAT one would write the advert-scoped claim AC4 forbids. buildTailorState subtracts this set
 *  from the advert's questions, and the answer route refuses these ids outright.
 *
 *  Work-rights is scoped to a PLACEABLE market: when the posting's market cannot be resolved, no
 *  profile question exists to own the requirement, so it stays an ordinary advert question — the
 *  pre-#307 behaviour, unchanged, rather than a requirement with no door to answer it at all.
 *
 *  #308: a language requirement WITH a subject is owned unconditionally — the graded ladder is the
 *  only door a language answer may take (AC4: graded, never yes-or-no), its door needs no market,
 *  and once the level is answered the question is closed everywhere (asked once per language
 *  ever), never reopened as a Yes/No. A language requirement with NO subject stays an ordinary
 *  advert question: there is no safe way to know which language is meant. Ownership deliberately
 *  ignores skips — a skipped ladder must step aside, not reappear as its own Yes/No twin. */
export function profileOwnedRequirementIds(
  adReq: AdRequirementsV1,
  postingLocation: string | null | undefined,
): Set<string> {
  const marketPlaced = marketForLocationText(postingLocation ?? "") !== null;
  return new Set(
    adReq.requirements
      .filter(
        (r) =>
          (marketPlaced && r.eligibilityDimension === "work-rights") ||
          (r.eligibilityDimension === "language" && r.eligibilitySubject),
      )
      .map((r) => r.id),
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

/** #308 — the language answer's after-line, profileChangeLine's sibling. `rung` is the stored
 *  ladder value the tapped situation mapped to; every rung above "I don't speak this one" keeps
 *  every job (the ladder's own promise), so only that one branches on the hidden count. No
 *  profile-undo clause here, deliberately: unlike work-rights (#292 ruling 7's per-market door),
 *  the profile has no surface today that changes a placed level, and the line must not promise
 *  one. */
export function languageChangeLine(language: string, rung: LanguageLevel, hidden: number): string {
  if (rung !== LANGUAGE_NOT_AT_ALL) {
    const situation = LANGUAGE_LADDER.find((r) => r.value === rung)!.situation;
    return `Remembered for ${language}: ${situation}. No job will ask you this again.`;
  }
  if (hidden > 0) {
    const jobs = hidden === 1 ? "job that needs" : "jobs that need";
    return `Hidden ${hidden} ${jobs} ${language} from your deck.`;
  }
  return `Remembered. Jobs that need ${language} will stay off your deck.`;
}

/** #308 AC1/AC2 — what a skip answers back. Honest about both halves: nothing was saved, and the
 *  question is not gone for good — the next job that raises it asks again. */
export function skippedLine(ask: ProfileAsk): string {
  return ask.dimension === "language"
    ? `Nothing saved — I'll ask about ${ask.language} again on another job that needs it.`
    : `Nothing saved — I'll ask again on another job in ${ask.market}.`;
}

/** #309 — the blocking gap, named in the person's own terms, for the two lines below. `market` is
 *  the posting's placed market display name (marketForLocationText), null when it cannot be placed
 *  — defensive only: a work-rights withdrawal needs a placed region to fire at all. */
function gapNoun(req: AdRequirementV1, market: string | null): string {
  if (req.eligibilityDimension === "work-rights") {
    return market ? `the right to work in ${market}` : "the right to work where it is based";
  }
  // language/certification carry the subject the withdrawal matched on (withdrawal.ts's scopeFor).
  return req.eligibilitySubject?.trim() ?? req.requirement;
}

/** #309 AC3 — a FOUND job withdrawn by the answer he just gave names its reason. The old deliberate
 *  silence (#107 M3) was designed for a job the app quietly noticed; a job that vanishes because he
 *  just answered says why, so the disappearance is a rule he learns rather than a bug he suspects. */
export function withdrawalReasonLine(req: AdRequirementV1, market: string | null): string {
  return `This job needs ${gapNoun(req, market)}, and your answer says you don't have it — so it has come off your deck.`;
}

/** #309 AC4 — a job HE BROUGHT stays despite the same answer, and says why in one line, so the
 *  asymmetry with a found job reads as a promise rather than an inconsistency (#294 c1). */
export function broughtStaysLine(req: AdRequirementV1, market: string | null): string {
  return `You brought this job, so it stays and I'll draft for it — but it needs ${gapNoun(req, market)}, and that gap is real.`;
}
