// #107 (E5 slice 6, D3) — the withdrawal predicate. Pure arithmetic over one advert's own requirement
// set and a session's ALREADY-READ eligibility facts; no IO of its own. Consumed by every surface that
// renders an advert (routes/onboarding.ts: the deck, /want, and tailorTarget) so the same rule holds
// wherever a posting could otherwise reach a visitor — never re-derived per call site.
//
// GLOSSARY.md's definition ("Blocking requirement"): the advert states it as mandatory, and the
// person's own record says they do not meet it. This function is that definition made real. For one
// requirement to withdraw, the advert must be explicit — kind === "blocking" (the reader's own
// clampBlocking, adReader.ts, already guarantees a blocking requirement carries a hard-gate
// eligibilityDimension, and — as of #107, D1 — a language/certification one an eligibilitySubject)
// — and then, per dimension:
//   - work-rights / certification: a STORED fact at this requirement's scope is an EXPLICIT "no"
//     (isExplicitNo below). No fact — never asked, or asked for a DIFFERENT market — is unknown,
//     and an unknown never withdraws.
//   - language (#425, owner decision 1, 2026-10-24): every language the requirement names must be the
//     person's — on the CV (any language line not rejected) or declared on the profile, the ladder's
//     rungs included (languageLevel.ts spokenLanguages). A language that is neither withdraws, and
//     the deck says so with a one-tap "I speak it" (partitionByWithdrawal's tally). An explicit "I
//     don't speak this one" withdraws even when the CV lists it. This is #123's original rule come
//     back: #165 had made an unknown language never withdraw (the tick-list's mistap was silently
//     deleting jobs), and once #376 moved the languages question off the start, a job requiring
//     Cantonese reached every new deck. The tally line is what keeps a removal from being silent.
//     How well they speak it never withdraws — below the bar is not a no (ADR-0003 clause 8a).
import type { AdRequirementV1, AdRequirementsV1, EligibilityDimension } from "@jobcrush/contracts";
import { incrementCounter } from "./counters.js";
import { ANY_FAMILY, type EligibilityFact } from "./eligibility.js";
import { groupMet, LANGUAGE_NOT_AT_ALL, languageFactsFor, languagesNamed, spokenLanguages } from "./languageLevel.js";
import type { LanguageClaim } from "./cvLanguages.js";
import { regionsForLocationText } from "./postingRetrieval.js";
import { isBrought, type BroughtJob } from "./broughtJobs.js";

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
// Exported (#307): the tailor queue's "has he already answered for this posting's market?" is BY
// DESIGN the same match this predicate makes — one lookup, so "answered" on the queue side and
// "actionable" on the withdrawal side can never disagree about which fact covers which posting.
export function findWorkRightsFact(
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
 *  needless no-op worth the one-line fix. (#425: language matches through languageLevel.ts's
 *  meetsLanguage now; this is the certification scope's.) */
function normalizeScope(s: string): string {
  return s.trim().toLowerCase();
}

/** True when `value` is an EXPLICIT "no" for `dimension` — the one thing that may ever withdraw a
 *  posting (#86 decision 3). Every other recorded value (and, per the caller, every UNRECORDED one)
 *  leaves the job in the deck. */
// Exported (#307): the tailor queue's after-line branches on "was that answer a no?" — the same
// judgment, from the one place that owns the canonical value vocabulary, never a second literal.
export function isExplicitNo(dimension: EligibilityDimension, value: string): boolean {
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
  // languages answered under the old shape are re-asked on the ladder rather than migrated. #425: an
  // unknown language that is not on the CV now withdraws — but as "not on your profile", which the
  // deck names with a one-tap "I speak it", never as a no the person cannot see.
  if (dimension === "language") return value === LANGUAGE_NOT_AT_ALL;
  // certification is wired through on purpose (D3: "don't special-case it away") even though no
  // product surface today ever WRITES a certification eligibility fact — see eligibilityDiscovery.ts's
  // ASK_DIMENSIONS. This branch is reachable the day that changes; until then a fact for this
  // dimension is simply never found (no stored fact never withdraws, see the header), so this is dead in
  // practice, not silently absent from the switch.
  if (dimension === "certification") return false;
  return false; // years-experience/degree are never blocking
}

/** #425 — the one language a blocking requirement withdraws a job over. `missing`: simply not the
 *  person's — the deck offers "I speak it". Not missing: they said "I don't speak this one", and
 *  `language` is their own spelling. */
export interface LanguageGap {
  language: string;
  missing: boolean;
}

/** The LanguageGap for one requirement subject, or null when every language it names is the
 *  person's (spokenLanguages). */
function languageGap(
  subject: string,
  facts: readonly EligibilityFact[],
  claims: readonly LanguageClaim[],
): LanguageGap | null {
  const spoken = spokenLanguages(facts, claims);
  for (const group of languagesNamed(subject)) {
    if (groupMet(group, spoken)) continue;
    const no = languageFactsFor(group, facts).find((f) => isExplicitNo("language", f.value));
    return no ? { language: no.familyId.trim(), missing: false } : { language: group[0]!, missing: true };
  }
  return null;
}

/** The reveal's line per language ("I left out 12 jobs that need Cantonese, which isn't on your
 *  profile"). `byLanguage` names ONLY languages that actually caused a removal, sorted desc by count
 *  then name asc; empty (never omitted) when nothing was withdrawn, so a client can key "render no
 *  notice at all" off an unambiguous empty array rather than a missing field. #425: `missing` is true
 *  when the language is not the person's (the screen offers "I speak it"), false when they said
 *  "I don't speak this one". */
export interface WithdrawnSummary {
  total: number;
  byLanguage: Array<{ language: string; count: number; missing: boolean }>;
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
  /** #425: the CV's claims, read for their language lines — see findWithdrawingRequirement. */
  claims: readonly LanguageClaim[],
  /** #305: forwarded to the predicate, so a brought job passes this filter and is never tallied. */
  brought: readonly BroughtJob[] = [],
): { open: T[]; withdrawn: WithdrawnSummary } {
  let total = 0;
  // Keyed case-folded, per reason: "Cantonese" from one reader read and "cantonese" from another
  // are one line, shown in the first spelling seen.
  const byLanguage = new Map<string, WithdrawnSummary["byLanguage"][number]>();
  const open = candidates.filter((entry) => {
    const found = findWithdrawal(entry.adReq, facts, claims, entry.posting.location ?? null, brought);
    if (!found) return true;
    incrementCounter("deck.cards_withdrawn");
    total++;
    if (found.gap) {
      const key = `${found.gap.missing}:${found.gap.language.toLowerCase()}`;
      const tally = byLanguage.get(key) ?? { ...found.gap, count: 0 };
      tally.count++;
      byLanguage.set(key, tally);
    }
    return false;
  });
  return {
    open,
    withdrawn: {
      total,
      byLanguage: [...byLanguage.values()].sort((a, b) => b.count - a.count || a.language.localeCompare(b.language)),
    },
  };
}

/** The first requirement (in the advert's own rank order) that genuinely withdraws THIS posting from
 *  this session's deck, or null when nothing does. `facts` is whatever the caller already read
 *  (EligibilityFact[]) — never fetched here. #425: `claims` likewise — every claim (printed or not), whose
 *  language lines (cvLanguages.ts) count as the person's languages. `postingLocation` (#182 QA round
 *  3) is THIS posting's own `location` field — never the session's current city; work-rights is
 *  gated per-posting (findWorkRightsFact above), because a session may hold answers for several
 *  markets and only the posting's OWN market's answer may ever apply to it. Optional and defaulting
 *  to null so a caller that cannot supply it safely never withdraws on work-rights. */
export function findWithdrawingRequirement(
  adReq: AdRequirementsV1,
  facts: readonly EligibilityFact[],
  claims: readonly LanguageClaim[],
  postingLocation: string | null = null,
  // #305 (#294 c1): the adverts HE BROUGHT. A job he brought is NEVER withdrawn, and the rule lives
  // here rather than at each door for this function's own stated reason — it is consumed by every
  // surface that renders an advert, so a rule kept at the call sites is a rule the next door forgets.
  // Absent → nobody is exempt, which is every pre-#305 caller's behaviour unchanged.
  brought: readonly BroughtJob[] = [],
): AdRequirementV1 | null {
  return findWithdrawal(adReq, facts, claims, postingLocation, brought)?.req ?? null;
}

/** findWithdrawingRequirement's body, plus the language the requirement is over — the deck's tally
 *  and the Tailor step's two lines (tailorProfile.ts) name it, and re-deriving it would be a second
 *  predicate. */
export function findWithdrawal(
  adReq: AdRequirementsV1,
  facts: readonly EligibilityFact[],
  claims: readonly LanguageClaim[],
  postingLocation: string | null = null,
  brought: readonly BroughtJob[] = [],
): { req: AdRequirementV1; gap: LanguageGap | null } | null {
  // Keyed on the advert's own id, which for every caller here IS the posting's canonical id
  // (resolveAdRequirements stamps it). Checked FIRST: there is no state of his answers that can take a
  // job he chose off his own deck — it stays, and its card says what it can about its age instead.
  if (isBrought(brought, adReq.adId)) return null;
  for (const req of adReq.requirements) {
    if (req.kind !== "blocking") continue;
    const dimension = req.eligibilityDimension;
    if (!dimension) continue; // defensive — the reader's clamp already guarantees this is set
    if (dimension === "work-rights") {
      const fact = findWorkRightsFact(facts, postingLocation);
      if (fact && isExplicitNo(dimension, fact.value)) return { req, gap: null };
      continue;
    }
    if (dimension === "language") {
      // No subject (a fixture predating #107): no safe way to know WHICH language — never withdraws.
      const gap = req.eligibilitySubject ? languageGap(req.eligibilitySubject, facts, claims) : null;
      if (gap) return { req, gap };
      continue;
    }
    const scope = scopeFor(dimension, req.eligibilitySubject);
    if (scope === null) continue;
    const fact = facts.find(
      (f) => f.dimension === dimension && normalizeScope(f.familyId) === normalizeScope(scope),
    );
    if (!fact) continue; // never asked (or asked at a different scope) — unknown, never withdraws
    if (isExplicitNo(dimension, fact.value)) return { req, gap: null };
  }
  return null;
}
