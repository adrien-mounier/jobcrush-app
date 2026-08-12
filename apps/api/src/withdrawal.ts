// #107 (E5 slice 6, D3) — the withdrawal predicate. Pure arithmetic over one advert's own requirement
// set and a session's ALREADY-READ eligibility facts; no IO of its own. Consumed by every surface that
// renders an advert (routes/onboarding.ts: the deck, /want, and tailorTarget) so the same rule holds
// wherever a posting could otherwise reach a visitor — never re-derived per call site.
//
// CONTEXT.md's own definition: a blocking requirement is established ONLY when the advert states it
// as mandatory AND the user has explicitly said they do not meet it — a vague advert or an unasked
// question never establishes one. This function is that definition made real. All three conditions
// below must hold for one requirement, or nothing withdraws:
//   1. kind === "blocking" — the advert was explicit (the reader's own clampBlocking, adReader.ts,
//      already guarantees a blocking requirement carries a hard-gate eligibilityDimension, and — as
//      of #107, D1 — a language/certification one also carries an eligibilitySubject).
//   2. a STORED fact exists at this requirement's (dimension, scope). No fact at all — never asked,
//      or asked at a DIFFERENT scope — reads as unknown, and an unknown never withdraws. Always.
//   3. that fact's value is an EXPLICIT "no" (isExplicitNo below) for the dimension. "Some, but not
//      for work" is not "I don't speak it" and must never withdraw (the spec's own regression case).
import type { AdRequirementV1, AdRequirementsV1, EligibilityDimension } from "@jobcrush/contracts";
import { incrementCounter } from "./counters.js";
import { ANY_FAMILY, type EligibilityFact } from "./eligibility.js";
import { LANGUAGE_NOT_AT_ALL } from "./languageLevel.js";
import { regionsForLocationText } from "./postingRetrieval.js";

/** The eligibility-store scope one (language/certification) requirement's blocking check reads at, or
 *  null when there is no safe way to resolve one — a null scope means "cannot determine, never
 *  withdraw", never "fall back to the global scope". Read at their own eligibilitySubject — absent (a
 *  fixture predating #107, or a reader output the clamp somehow missed) means there is no safe way to
 *  know WHICH language/certification is meant, so this requirement can never withdraw anything rather
 *  than risk matching the wrong subject. years-experience/degree are never blocking (adReader.ts's own
 *  hard-gate clamp), so they fall through to null defensively rather than being special-cased out.
 *  work-rights is NOT resolved here — see findWorkRightsFact below, its own dedicated match. */
function scopeFor(dimension: EligibilityDimension, subject: string | undefined): string | null {
  if (dimension === "language" || dimension === "certification") return subject ?? null;
  return null;
}

/** #182 QA round 2 M1 / round 3 HIGH: work-rights matches by REGION, not by exact scope string. The
 *  discovery question is city-scoped ("Can you already work in {city}...?") and the store now keys an
 *  answer by that city's slug (eligibilityDiscovery.ts's buildQuestion) — but a POSTING's own market
 *  is a free-text `location` field ("Wan Chai District, Hong Kong SAR"), never the visitor's own typed
 *  city string, so exact-matching the two would almost never fire and matching on the SESSION's
 *  current city (the round-2 shape) applied one answer to every posting regardless of where it
 *  actually was — a Hong Kong "no" wrongly withdrew Sydney postings. Both sides are instead resolved
 *  to REGION CODES via postingRetrieval.ts's shared AREA_REGIONS vocabulary (regionsForLocationText —
 *  substring-safe for free text, de-hyphenating a stored slug back to space form first) and matched on
 *  overlap. Either side resolving to no region at all (an "APAC"-only posting, a market outside
 *  today's four, e.g. Shenzhen; or a market this store never learned a region for, e.g. Paris) means
 *  no safe way to place it — fails OPEN, the same "unknown never withdraws" rule as every other
 *  dimension, never a guess. A legacy ANY_FAMILY-scoped fact (predating #182) is skipped outright: it
 *  was never about one place, so it must never apply to one. */
function findWorkRightsFact(
  facts: readonly EligibilityFact[],
  postingLocation: string | null | undefined,
): EligibilityFact | null {
  if (!postingLocation) return null;
  const postingRegions = new Set(regionsForLocationText(postingLocation));
  if (postingRegions.size === 0) return null; // cannot place the posting — never guess
  for (const fact of facts) {
    if (fact.dimension !== "work-rights") continue;
    if (fact.familyId === ANY_FAMILY) continue;
    const factRegions = regionsForLocationText(fact.familyId.replace(/-/g, " "));
    if (factRegions.some((r) => postingRegions.has(r))) return fact;
  }
  return null;
}

/** Trimmed + case-folded — code-review M4: a reader-produced eligibilitySubject ("english", "
 *  Mandarin ") must still match the store's canonical scope ("English") or this whole rule silently
 *  never fires. A safe direction on its own (never-withdraws is always the fail-safe outcome), but a
 *  needless no-op worth the one-line fix.
 *
 *  Exported (2026-08-04, no behaviour change) so routes/onboarding.ts's withdrawal-reporting tally
 *  (the reveal's "N jobs needed Mandarin" line) can re-derive the SAME match this function's own
 *  caller (findWithdrawingRequirement) already made, to recover the fact's exact canonical casing —
 *  never a second predicate, never a re-decision of any posting's fate. */
export function normalizeScope(s: string): string {
  return s.trim().toLowerCase();
}

/** True when `value` is an EXPLICIT "no" for `dimension` — the one thing that may ever withdraw a
 *  posting (#86 decision 3). Every other recorded value (and, per the caller, every UNRECORDED one)
 *  leaves the job in the deck. */
function isExplicitNo(dimension: EligibilityDimension, value: string): boolean {
  if (dimension === "work-rights") return value === "needs-sponsorship";
  // #165 — the language "no" is now ONE deliberately-tapped rung of the ladder (languageLevel.ts),
  // and nothing else. Every other value a language fact can carry — every rung above it, the bare
  // `declared`, and every PRE-#165 value ("professional", "conversational", and critically "none") —
  // leaves the job in the deck.
  //
  // 🚨 "none" dropping out of this check IS the fix, not an oversight. #123's binary tick-list wrote
  // "none" for every language the person left UNTICKED, which this line then read as "I don't speak
  // it" and used to silently delete winnable jobs — a mistap cost real postings. Under the ladder no
  // silence writes anything, so the only way to reach a withdrawal is to tap "I don't speak this
  // one". Legacy "none" facts are read as unknown here AND everywhere else (levelOf), so the four
  // languages answered under the old shape are re-asked on the ladder rather than migrated: unknown
  // never withdraws, so the wrong-shape answers cannot hurt anyone while they are being re-asked.
  if (dimension === "language") return value === LANGUAGE_NOT_AT_ALL;
  // certification is wired through on purpose (D3: "don't special-case it away") even though no
  // product surface today ever WRITES a certification eligibility fact — see eligibilityDiscovery.ts's
  // ASK_DIMENSIONS. This branch is reachable the day that changes; until then a fact for this
  // dimension is simply never found (condition 2 above already short-circuits), so this is dead in
  // practice, not silently absent from the switch.
  if (dimension === "certification") return false;
  return false; // years-experience/degree are never blocking
}

/** The first requirement (in the advert's own rank order) that genuinely withdraws THIS posting from
 *  this session's deck, or null when nothing does. `facts` is whatever the caller already read
 *  (EligibilityFact[]) — never fetched here. `postingLocation` (#182 QA round 3) is THIS posting's own
 *  `location` field — never the session's current city; work-rights is gated per-posting (findWork
 *  RightsFact above), because a session may hold answers for several markets and only the posting's
 *  OWN market's answer may ever apply to it. Optional and defaulting to null so a caller that cannot
 *  supply it (or predates this) safely never withdraws on work-rights, same as no fact at all. */
/** The reveal's undo line ("2 more needed Mandarin — I left them out"). `byLanguage` names ONLY
 *  languages that actually caused a removal, sorted desc by count then name asc; empty (never
 *  omitted) when nothing was withdrawn, so a client can key "render no notice at all" off an
 *  unambiguous empty array rather than a missing field. */
export interface WithdrawnSummary {
  total: number;
  byLanguage: Array<{ language: string; count: number }>;
}

/**
 * Splits this session's already-resolved candidates into the ones that survive and the tally of what
 * was removed — one pass, one decision per posting, no second eligibility read.
 *
 * 2026-08-12 (#165): lifted verbatim out of routes/onboarding.ts's deck route, where it sat as an
 * inline filter closure. It is the rule that decides whether a person ever sees a job, and it was
 * only reachable through the HTTP funnel; it belongs beside the predicate it accumulates.
 *
 * `deck.cards_withdrawn` (counters.ts) is #107 AC6's own number: over-firing shows up as a rising
 * count an operator can see, rather than as jobs quietly disappearing. The per-language tally is
 * separate because that counter is process-wide and names no language.
 *
 * Scoping matters and is deliberate: `candidates` are postings already past every OTHER exclusion, so
 * a posting dropped for an unrelated reason (an unreadable advert) can never be miscounted here. The
 * number must mean "this cost you a job", not "absent for any reason while a language answer existed".
 */
export function partitionByWithdrawal<T extends { posting: { location?: string | null }; adReq: AdRequirementsV1 }>(
  candidates: readonly T[],
  facts: readonly EligibilityFact[],
): { open: T[]; withdrawn: WithdrawnSummary } {
  let total = 0;
  const byLanguage = new Map<string, number>();
  const open = candidates.filter((entry) => {
    const req = findWithdrawingRequirement(entry.adReq, facts, entry.posting.location ?? null);
    if (!req) return true;
    incrementCounter("deck.cards_withdrawn");
    total++;
    if (req.eligibilityDimension === "language" && req.eligibilitySubject) {
      // Render-ready casing: the requirement's own eligibilitySubject is whatever the ad reader
      // produced ("mandarin", " Mandarin "), not how the person wrote it. The matching fact's
      // familyId is the STORE's own scope — their own spelling. This re-derives the SAME normalized
      // match findWithdrawingRequirement already made internally, over the identical `facts` array,
      // so it always succeeds; it never re-decides any posting's fate.
      const subject = normalizeScope(req.eligibilitySubject);
      const fact = facts.find((f) => f.dimension === "language" && normalizeScope(f.familyId) === subject);
      const language = fact?.familyId ?? req.eligibilitySubject.trim();
      byLanguage.set(language, (byLanguage.get(language) ?? 0) + 1);
    }
    return false;
  });
  return {
    open,
    withdrawn: {
      total,
      byLanguage: [...byLanguage.entries()]
        .map(([language, count]) => ({ language, count }))
        .sort((a, b) => b.count - a.count || a.language.localeCompare(b.language)),
    },
  };
}

export function findWithdrawingRequirement(
  adReq: AdRequirementsV1,
  facts: readonly EligibilityFact[],
  postingLocation: string | null = null,
): AdRequirementV1 | null {
  for (const req of adReq.requirements) {
    if (req.kind !== "blocking") continue;
    const dimension = req.eligibilityDimension;
    if (!dimension) continue; // defensive — the reader's clamp already guarantees this is set
    if (dimension === "work-rights") {
      const fact = findWorkRightsFact(facts, postingLocation);
      if (fact && isExplicitNo(dimension, fact.value)) return req;
      continue;
    }
    const scope = scopeFor(dimension, req.eligibilitySubject);
    if (scope === null) continue;
    const fact = facts.find(
      (f) => f.dimension === dimension && normalizeScope(f.familyId) === normalizeScope(scope),
    );
    if (!fact) continue; // never asked (or asked at a different scope) — unknown, never withdraws
    if (isExplicitNo(dimension, fact.value)) return req;
  }
  return null;
}
