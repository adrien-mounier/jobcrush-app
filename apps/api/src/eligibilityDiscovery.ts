// #106 — which eligibility dimensions (apps/api/src/eligibility.ts) discovery actually asks, built as
// DiscoveryQuestion[] the /onboarding/discovery* routes append to state.questions, plus the write
// path an answer takes (answerEligibilityItem, at the foot of this file).
//
// #162: `years-experience` is NOT one of them and never can be — it is worked out, not asked
// (yearsWorked.ts, ADR-0008 clause 2). See ASK_DIMENSIONS below.
//
// Derivation: docs/research/eligibility-dimensions-from-the-corpus.md. Copy/order: the #106 UI design
// spec (pinned strings — do not paraphrase). Storage is eligibility.ts's job; this module only decides
// what to ask, in what shape, and how an answer maps onto that store's vocabulary.
//
// Code-review must-fix 1 (2026-08-03): an affirmative eligibility answer must NEVER reach
// graph.ts's buildClaimGraph — the oracle (packages/contracts/oracle/validate_graph.mjs) defines a
// Negative-classified node as a CONFIRMED GAP ("Tailor must never assert these"), so putting a real
// "Yes" through claims.add()/confirmed (renders unconditionally) OR claims.answerNegative() (a
// confirmed-gap node) both lie about the visitor. The fix: a REAL eligibility answer, of any kind,
// never touches the claims store at all — it lives ONLY in the eligibility store (put()/get()), which
// already answers "has this been asked" via a non-null read. Only a DECLINE still writes a claims-store
// record (answerNegative — "asked and closed, no fact"), reusing the one persistence this repo already
// has for that state; it stores no eligibility-store value, which is the whole point of a decline.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { EligibilityDimension, FloorItem, JobBlockView } from "@jobcrush/contracts";
import type { ClaimRecord, ClaimStore } from "./claims.js";
import {
  discoveryClaimId,
  isDiscoveryClaim,
  itemIdOf,
  slug,
  type DiscoveryQuestion,
  type DiscoveryState,
} from "./discovery.js";
import { ANY_FAMILY, type EligibilityFact, type EligibilityStore } from "./eligibility.js";
import { isDeclaredValue, LANGUAGE_DECLARED, levelOf, MAX_LANGUAGE_WORD } from "./languageLevel.js";
import { dateHoleQuestions } from "./yearsWorked.js";

export const DECLINE_OPTION = "Ask me later";

export const ELIGIBILITY_ITEM_PREFIX = "eligibility-";
export const isEligibilityItemId = (itemId: string): boolean => itemId.startsWith(ELIGIBILITY_ITEM_PREFIX);

// #123 — the languages question, market-keyed, not a hardcoded list. Mirrors e5stub.ts's own
// read+cache pattern (apps/api/data/*.json) rather than inventing a new one.
//
// Owner decision (2026-08-03), recorded here because the list this produces is NOT what the corpus
// measures: docs/research/languages-from-the-corpus.md finds advert-STATED language demand across
// the 17 real postings is ENGLISH ONLY (2/17, mandatory) — a strictly-measured list would contain
// exactly one entry, English, and #107's withdrawal engine would stay dormant for every language but
// a hypothetical non-English speaker. The per-market language sets below are instead grounded in the
// corpus's MEASURED MARKET MIX (Hong Kong SAR 9, Australia 4, Vietnam 2, China 1 of 17 postings) —
// which languages each market's jobs are plausibly worked in, NOT anything an advert states. This is
// the owner's call, the same shape as #106's own work-rights exception, and must never be described
// as corpus-derived when read back — only the MARKET COUNTS are measured; the LANGUAGES attached to
// each market are a product judgment.
//
// Why market-keyed rather than a flat list: the owner's explicit requirement (2026-08-03, mid-build)
// is that a new market (e.g. Laos) must be a DATA EDIT — one more entry in
// apps/api/data/languages-by-market.json — never a code change here. This also leaves the shape #124
// ("Where do you want to work?", open, unassigned) will need the day it lands a visitor's own target
// market: narrowing the question from today's union of every market down to just one visitor's own
// market(s) becomes a filter over this same per-market data, not a redesign of it. #124 itself is out
// of scope here — nothing below reads a visitor's target market, because no such fact exists in this
// codebase yet (confirmed in the research doc); no lookup accessor is exported for it either
// (code-review: don't expose API surface only #124 would call — that ticket can add its own one-liner
// over loadLanguageMarkets() when it actually needs one).
const LanguageMarketSchema = z.object({
  market: z.string().min(1),
  languages: z.array(z.string().min(1)).min(1),
});
type LanguageMarket = z.infer<typeof LanguageMarketSchema>;

const here = dirname(fileURLToPath(import.meta.url));

let cachedLanguageMarkets: LanguageMarket[] | null = null;
/** Code-review must-fix 4 (2026-08-04): this file is the owner's OWN hand-edit surface (they add
 *  markets to it directly) — a typo must produce one clear, named error, never a raw TypeError that
 *  500s every discovery request. Parses the top-level array shape AND every entry through
 *  LanguageMarketSchema, and — unlike e5stub.ts's bare `.parse()` — names the OFFENDING entry (its
 *  market name, or its index if the market name itself is what's malformed) in the thrown message. */
function loadLanguageMarkets(): LanguageMarket[] {
  if (!cachedLanguageMarkets) {
    const path = join(here, "..", "data", "languages-by-market.json");
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(raw)) {
      throw new Error(`${path}: expected a top-level array of market entries`);
    }
    cachedLanguageMarkets = raw.map((entry, index) => {
      const parsed = LanguageMarketSchema.safeParse(entry);
      if (parsed.success) return parsed.data;
      const label =
        entry && typeof entry === "object" && typeof (entry as { market?: unknown }).market === "string"
          ? (entry as { market: string }).market
          : `entry ${index}`;
      throw new Error(`${path}: invalid market entry "${label}" (index ${index}): ${parsed.error.message}`);
    });
  }
  return cachedLanguageMarkets;
}

let cachedLanguagesUnion: string[] | null = null;
/** Every language the languages question asks about today: the deduped union of every market's
 *  languages, in stable FIRST-DECLARED order (market order, then each market's own language order,
 *  in apps/api/data/languages-by-market.json) — never re-sorted or alphabetized, so this is
 *  deterministic across calls and across requests. With today's data file this comes out to exactly
 *  `["English", "Mandarin", "Cantonese", "Vietnamese"]` — the owner-approved list — so nothing about
 *  the pinned question contract below changes; only the SOURCE of that list does. Cached like
 *  loadLanguageMarkets() itself (the file doesn't change at runtime; a deploy restarts the process). */
export function languagesUnion(): readonly string[] {
  if (!cachedLanguagesUnion) {
    const seen = new Set<string>();
    const union: string[] = [];
    for (const m of loadLanguageMarkets()) {
      for (const language of m.languages) {
        if (seen.has(language)) continue;
        seen.add(language);
        union.push(language);
      }
    }
    cachedLanguagesUnion = union;
  }
  return cachedLanguagesUnion;
}

// #123: the ONE fixed itemId for the (single, multi-select) languages question — deliberately
// plural and distinct from the pre-#123 single-language itemId this module used to build
// (`eligibility-language-English`), so a session that answered under the old shape reads as
// unanswered under this one and is asked once, the same accepted-pre-launch consequence #107's own
// D2 comment already recorded for a different scope-key change. Not built from itemId()/FAMILY_SCOPED
// below — this question has no ONE family/language scope the way years-experience does; see
// buildQuestion's own language branch.
export const LANGUAGE_ITEM_ID = `${ELIGIBILITY_ITEM_PREFIX}languages`;

// Step 1 derivation (docs/research/eligibility-dimensions-from-the-corpus.md): work-rights (0/17,
// included as a deliberate, owner-approved deviation — see the doc) and language (2/17) are asked;
// certification (1/17) and degree (4/17) are excluded because credential questions belong to
// family floors when a family needs them, not to this cross-floor eligibility layer.
// Order matches the UI design spec's block order.
//
// 🚨 #162 / ADR-0008 clause 2 (the Mei rule) — `years-experience` MUST NEVER APPEAR HERE, for any
// reason, INCLUDING an unreadable work history. It is a WORKED-OUT value (apps/api/src/yearsWorked.ts
// computes it from the dated job records), so any answer a person typed would be deleted by the next
// recompute: the question is not merely redundant, it destroys what they typed. When the calculation
// cannot run, clause 3 says ask for the missing part UNDERNEATH — yearsWorked.ts's dateHoleQuestions,
// placed by applyEligibilityQuestions below. This line is the ADR's own falsifiable check; a test
// (eligibilityDiscovery.test.ts) fails if it is ever re-added.
const ASK_DIMENSIONS: readonly EligibilityDimension[] = ["work-rights", "language"];

// work-rights does NOT vary by job family (right to work doesn't depend on the role) but, per #182 /
// #180, DOES vary by PLACE: the question is already worded "Can you work in {city}...?", so its
// answer is a fact about that city, not a global one. FAMILY_SCOPED means "this dimension's
// itemId/store-scope carries a suffix", and work-rights' suffix is a city.
// `eligibilityCandidates`'s `city` parameter supplies it; ANY_FAMILY remains the fallback when no
// city is known yet (buildQuestion's own null-city branch).
//
// language is NOT in this set (#123 supersedes #107 D2's use of it): the store's familyId column is
// still a free-text SCOPE for language, and a blocking requirement's eligibilitySubject ("Mandarin")
// is still looked up against exactly that column (withdrawal.ts, unchanged) — but the QUESTION is now
// one multi-select over every supported language (languagesUnion()), not one question per language,
// so there is no single familyId for itemId() to build a per-language itemId from. buildQuestion's own
// language branch below writes a fixed itemId (LANGUAGE_ITEM_ID) directly instead; the actual
// per-language store writes happen in routes/onboarding.ts via languageFacts(), each at its own
// language's scope, exactly like before — only the QUESTION shape and its itemId scheme changed.
const FAMILY_SCOPED: ReadonlySet<EligibilityDimension> = new Set(["work-rights"]);

// --- work-rights options (UI design spec §2) ---
const WORK_RIGHTS_YES = "Yes — no sponsorship needed";
const WORK_RIGHTS_NOT_YET = "Not yet — I'd need sponsorship";
// #185 code-review cheap weld: the store's own canonical value tokens, named once so
// mapEligibilityAnswer (answer text -> value, below) and workRightsAnswerLabel (value -> answer
// text, the profile rail's reverse lookup, below) share ONE vocabulary — a rename of either literal
// can no longer silently desync the two directions into "an answered market reads as unanswered".
const WORK_RIGHTS_ELIGIBLE_VALUE = "eligible";
const WORK_RIGHTS_NEEDS_SPONSORSHIP_VALUE = "needs-sponsorship";

// --- the languages question (#165 — supersedes #123's pinned binary copy) -----------------------
//
// #123's question was a closed tick-list whose whole meaning was "unticked = no", and its consequence
// line said so out loud: *"A no takes jobs that require that language out of your deck."* That was
// honest about what the code did, and what the code did was the bug — one mistap wrote an explicit
// "none" and silently removed postings. #165 takes the withdrawal out of this question entirely, so
// the copy that warned about it has nothing left to warn about and would now be a lie.
//
// What replaces it: DECLARING a language is a type-ahead over a known list (languagesUnion() supplies
// the completions), and a word outside that list is KEPT rather than refused — a French speaker in
// Asia has somewhere to say so (#125), it simply cannot match an advert until the list learns it. The
// LEVEL is not asked here at all: it is a ladder an advert triggers at the moment it matters
// (languageLevel.ts / ADR-0011 clause 1), which is why this question can now be answered carelessly
// with no cost. The consequence line says exactly that, because "nothing here can hurt you" is the
// one thing a person needs to know to answer it honestly.
const LANGUAGES_QUESTION = "Which languages do you speak? Start typing — I'll suggest as you go.";
const LANGUAGES_CONSEQUENCE =
  "Nothing you leave out counts against you: a job wanting a language you didn't list still stays in your deck." +
  " When one of them matters for a real job, I'll ask how well you speak it, and say why.";

function itemId(dimension: EligibilityDimension, familyId: string): string {
  return FAMILY_SCOPED.has(dimension)
    ? `${ELIGIBILITY_ITEM_PREFIX}${dimension}-${familyId}`
    : `${ELIGIBILITY_ITEM_PREFIX}${dimension}`;
}

// #162: `familyId`/`scopeLabel` parameters are GONE, along with the years-experience branch that was
// the only thing that ever read them (and with resolveEligibilityFamilyScope, which existed only to
// produce them). Neither remaining question is job-family-scoped: work-rights keys on a city,
// language on a language. `EligibilityAsk.scopeLabel` stays on the wire, always null.
function buildQuestion(
  dimension: EligibilityDimension,
  anyFamily: string,
  city: string | null,
): DiscoveryQuestion {
  if (dimension === "work-rights") {
    // Must-fix 8: this text is recorded verbatim in a decline's claim text, so it must reflect the
    // CITY THE VISITOR WAS ACTUALLY ASKED ABOUT — callers must pass the real resolved city (#184:
    // routes/onboarding.ts's resolvedCityFor, over the confirmed search area — no longer
    // parseCity(role)), never a placeholder null, for that record to be honest.
    //
    // #182: the ANSWER is now a fact about that same city — `familyId` (the store's generic scope
    // column) carries it, falling back to ANY_FAMILY only when no city is known at all (never a
    // placeholder market). This changes the itemId's shape for work-rights (it now carries a city
    // suffix, even the ANY_FAMILY one) — an accepted pre-launch shape change, the same kind #123's
    // LANGUAGE_ITEM_ID already made for the same reason: no real session's answer predates this.
    //
    // #182 QA round 3 must-fix: the KEY is `slug(city)`, never the raw display string — a raw city
    // ("Hong Kong") breaks ClaimGraph's kebab-slug id contract the moment a decline's claim id
    // inherits it, and "Hong Kong" / "HONG KONG" / "Hong  Kong" would otherwise be three different
    // markets. `city` itself (unslugged) is used ONLY in `question`'s display text below.
    const marketId = city ? slug(city) : anyFamily;
    const question = city
      ? `Can you already work in ${city} without visa sponsorship?`
      : "Can you already work where you're job-hunting, without visa sponsorship?";
    return {
      itemId: itemId(dimension, marketId),
      question,
      options: [WORK_RIGHTS_YES, WORK_RIGHTS_NOT_YET, DECLINE_OPTION],
      cvSection: "experience",
      eligibility: { dimension, familyId: marketId, scopeLabel: null, declineOption: DECLINE_OPTION },
    };
  }
  // dimension === "language" — #165: still ONE question producing a set of answers (so the wire shape
  // and the route's `answers: string[]` path are unchanged), but `typeAhead` now marks `options` as
  // COMPLETIONS rather than the answer domain: a person may keep a word that isn't in them. `anyFamily`
  // is used only as a required placeholder for EligibilityAsk.familyId below — the route's real
  // per-language writes (languageDeclarationPlan()) never read this field back.
  return {
    itemId: LANGUAGE_ITEM_ID,
    question: LANGUAGES_QUESTION,
    consequence: LANGUAGES_CONSEQUENCE,
    options: [...languagesUnion(), DECLINE_OPTION],
    multiSelect: true,
    typeAhead: true,
    cvSection: "skills",
    eligibility: { dimension, familyId: anyFamily, scopeLabel: null, declineOption: DECLINE_OPTION },
  };
}

/** Every eligibility question this session could be asked, unfiltered by what it has already
 *  answered — the answer route's find-by-itemId (including a CORRECTION of an already-closed
 *  question) needs the full set, not just what remains. `anyFamily` is the eligibility store's
 *  ANY_FAMILY constant, passed in by the caller rather than imported here, so this module stays
 *  decoupled from eligibility.ts's export surface beyond the one string value it needs. */
export function eligibilityCandidates(anyFamily: string, markets: readonly string[]): DiscoveryQuestion[] {
  // #214: work-rights is asked once per selected MARKET (visas are national — up to 3 instances of
  // the existing per-market question, each independently answerable/declinable at its own market
  // scope). With no covered market yet, the single null-city fallback question stays as before.
  return ASK_DIMENSIONS.flatMap((d) =>
    d === "work-rights" && markets.length > 0
      ? markets.map((market) => buildQuestion(d, anyFamily, market))
      : [buildQuestion(d, anyFamily, null)],
  );
}

/** itemIds of every eligibility question DECLINED or otherwise claims-store-closed. A real answer
 *  never reaches the claims store under this module's design (see the header comment), so today this
 *  only ever finds decline markers — but it still checks confirmed/rejected too, for the same #35
 *  three-way union floor items get (a claims-store record moved to any of those buckets still closes
 *  its question). */
function claimsClosedEligibilityItemIds(
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  rejected: ClaimRecord[],
): Set<string> {
  return new Set(
    [...confirmed, ...negatives, ...rejected]
      .filter((c) => isDiscoveryClaim(c.id))
      .map((c) => itemIdOf(c.id))
      .filter(isEligibilityItemId),
  );
}

/** itemIds already carrying a real, stored eligibility fact — `facts` is whatever
 *  eligibility.list(sessionId) returned. Each itemId is rebuilt from the FACT's own recorded
 *  dimension+familyId (not the session's currently-resolved family), so a fact stays correctly
 *  attributed even if the resolved family ever changed between the answer and this read.
 *
 *  #123: language is special-cased, not run through itemId() — one multi-select question now
 *  produces up to languagesUnion().length facts (one per language), so no single fact's own
 *  (dimension, familyId) maps back onto the ONE question itemId the way years-experience/work-rights
 *  still do. The question is answered iff AT LEAST ONE language fact exists at all, at ANY scope.
 *
 *  Code-review must-fix 3 (2026-08-04) — stated honestly, not assumed: the write is NOT atomic.
 *  routes/onboarding.ts writes languageFacts()'s N entries as N separately-awaited put() calls (and a
 *  decline as N separately-awaited remove() calls), so a crash or store outage mid-loop CAN leave a
 *  genuine partial-write state — some languages written, some not. "At least one fact exists" means a
 *  partial write still closes the question early, with whichever languages never got written reading
 *  unknown at their own scope. That is the SAFE failure direction (#86): unknown never withdraws
 *  (withdrawal.ts), so a partial write can only ever leave MORE jobs in the deck than a completed
 *  write would — it fails toward keeping a job, never toward silently deleting one. A stray fact at
 *  the pre-#123 single-English scope also counts toward "at least one", so an old session that
 *  answered under the superseded single-English question is not re-asked either — the same accepted
 *  pre-launch outcome LANGUAGE_ITEM_ID's own doc records for the itemId change. */
function factResolvedItemIds(facts: readonly { dimension: EligibilityDimension; familyId: string }[]): Set<string> {
  const ids = new Set<string>();
  for (const f of facts) {
    if (f.dimension === "language") {
      ids.add(LANGUAGE_ITEM_ID);
      continue;
    }
    ids.add(itemId(f.dimension, f.familyId));
  }
  return ids;
}

/** The eligibility questions this session still needs asked — #106's addition to
 *  DiscoveryState.questions. Per code-review must-fix 2, callers append these UNCONDITIONALLY (from
 *  Q1, never gated on the floor's essential band) and rely on array ORDER — this function's own
 *  candidates are appended after the floor's own questions by the caller — to keep them "asked after
 *  the floor" without withholding them from the visible countdown. */
export function unresolvedEligibilityQuestions(
  anyFamily: string,
  markets: readonly string[],
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  rejected: ClaimRecord[],
  facts: readonly { dimension: EligibilityDimension; familyId: string }[],
): DiscoveryQuestion[] {
  const declined = claimsClosedEligibilityItemIds(confirmed, negatives, rejected);
  const resolved = factResolvedItemIds(facts);
  return eligibilityCandidates(anyFamily, markets).filter(
    (q) => !declined.has(q.itemId) && !resolved.has(q.itemId),
  );
}

/** #106: eligibility questions layered onto discoveryState()'s pure floor-only output, so
 *  essentialRemaining/railFill's floor-only meaning needs no new carve-out there. Code-review
 *  must-fix 2 (round 2): these are appended UNCONDITIONALLY (never gated on the essential band),
 *  and — round 3's funnel-regression fix — inserted right after the essential band and BEFORE the
 *  standard one, never after it. discoveryState() only ever gates `stage` on the essential band;
 *  the standard band has always been optional/loopback-reachable, never required to reach the deck.
 *  Putting eligibility after the WHOLE floor (round 2's shape) meant the ask dock — which only ever
 *  renders questions[0], one at a time, with no skip — forced a visitor through all 5 standard items
 *  just to REACH the 3 eligibility ones that actually gate the deck, tripling the pre-deck question
 *  count nobody asked for. Standard items are moved after eligibility instead; everything else
 *  (essential items, the reader-only question, in whatever relative order discoveryState()/the route
 *  already established) stays exactly where it was — only the standard-band entries move.
 *
 *  2026-08-12 (architecture pass candidate 6): lifted verbatim out of routes/onboarding.ts, where
 *  the rule that decides what the visitor is asked NEXT sat in a route-local closure post-processing
 *  discoveryState()'s output — untestable except through the HTTP funnel, and invisible from the
 *  module that owns eligibility questions. It lives here, beside unresolvedEligibilityQuestions
 *  (which generates the very questions it places), rather than in discovery.ts: this module already
 *  imports discovery.ts, so the reverse direction would be an import cycle.
 *
 *  Mutates `state` in place, as it always has — every call site builds a fresh DiscoveryState from
 *  discoveryState() one line earlier and keeps using it after.
 *
 *  #162: the date-hole questions (yearsWorked.ts) ride in the SAME band. They are ADR-0008 clause 3's
 *  replacement for the years-experience question this module no longer asks — the missing part
 *  underneath, asked where the answer it replaces used to be — and ADR-0011 clause 1's "asked now"
 *  channel: the answer moves the total, so it belongs before the deck, not after it. */
export function applyEligibilityQuestions(
  state: DiscoveryState,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  rejected: ClaimRecord[],
  facts: readonly { dimension: EligibilityDimension; familyId: string }[],
  markets: readonly string[],
  floor: readonly FloorItem[],
  blocks: readonly JobBlockView[] = [],
): void {
  // #214: `markets` (the session's resolved covered markets, up to 3) replaces state.city here —
  // work-rights is per selected market now, and the display city on `state` is a chip label, not
  // the visa scope.
  const eligQuestions = [
    ...unresolvedEligibilityQuestions(ANY_FAMILY, markets, confirmed, negatives, rejected, facts),
    ...dateHoleQuestions(blocks),
  ];
  const standardIds = new Set(
    floor.filter((i) => i.rankBand === "standard").map((i) => i.id),
  );
  const leading = state.questions.filter((q) => !standardIds.has(q.itemId));
  const standard = state.questions.filter((q) => standardIds.has(q.itemId));
  state.questions = [...leading, ...eligQuestions, ...standard];
  if (eligQuestions.length > 0) state.stage = "discovery";
}

/** Code-review must-fix 3: a decline ("Ask me later") is a refusal, not a recorded fact, and must not
 *  inflate the visible "pile that only grows" the profile badge shows (discovery.ts's factCount, which
 *  sums confirmed+negatives with no awareness of eligibility). Strips any claim whose itemId is
 *  eligibility-namespaced before it reaches that count. Non-discovery claims (mined, grill, tailor,
 *  floor items) pass through unaffected; only an eligibility decline is ever removed by this (a real
 *  eligibility answer is never in the claims store to begin with — see the header comment). */
export function excludingEligibility(claims: readonly ClaimRecord[]): ClaimRecord[] {
  return claims.filter((c) => !isDiscoveryClaim(c.id) || !isEligibilityItemId(itemIdOf(c.id)));
}

export interface MappedEligibilityAnswer {
  value: string; // canonical — an opaque token
  label: string; // human-readable, for the EligibilityFact the store renders back to the user
}

/** A tapped option -> the store's canonical value, or null when the answer matches neither a known
 *  option nor the decline. Callers check the decline (item.eligibility.declineOption) themselves
 *  before calling this — decline never reaches here. */
export function mapEligibilityAnswer(
  dimension: EligibilityDimension,
  answer: string,
): MappedEligibilityAnswer | null {
  if (dimension === "work-rights") {
    if (answer === WORK_RIGHTS_YES)
      return { value: WORK_RIGHTS_ELIGIBLE_VALUE, label: "Right to work without sponsorship" };
    if (answer === WORK_RIGHTS_NOT_YET)
      return { value: WORK_RIGHTS_NEEDS_SPONSORSHIP_VALUE, label: "Right to work without sponsorship" };
    return null;
  }
  // #123: language no longer has a single-value real answer to map — the languages question is
  // multi-select (LANGUAGE_ITEM_ID), and its real-answer path (routes/onboarding.ts) reads
  // `answers: string[]` through languageFacts()/isValidLanguageSelection() below, never through this
  // function. A language dimension therefore always falls through to null here, same as
  // certification/degree (neither of which this module ever builds a question for either).
  return null;
}

/** #185 — the profile rail's reverse lookup: a STORED work-rights fact's canonical value
 *  (mapEligibilityAnswer's own vocabulary above, shared via the two WORK_RIGHTS_*_VALUE constants)
 *  back to the display text it was answered with. Null for anything else (defensive; every real
 *  work-rights write today goes through mapEligibilityAnswer, so this only ever sees its two values). */
export function workRightsAnswerLabel(value: string): string | null {
  if (value === WORK_RIGHTS_ELIGIBLE_VALUE) return WORK_RIGHTS_YES;
  if (value === WORK_RIGHTS_NEEDS_SPONSORSHIP_VALUE) return WORK_RIGHTS_NOT_YET;
  return null;
}

/** #185 — the profile rail's re-open door needs the ORIGINAL work-rights question (itemId,
 *  question text, option strings) for the visitor's current (covered) market, so the client never
 *  composes the itemId itself — that would duplicate this module's own slug rule (#182 QA round 3's
 *  must-fix, the same one buildQuestion's own work-rights branch comment records). Thin wrapper over
 *  that branch — the ONE place this composition happens — so the itemId returned here is BY
 *  CONSTRUCTION the same one answerEligibilityItem (routes/onboarding.ts) looks up when the visitor
 *  answers through this door. `familyId`/`anyFamily`/`scopeLabel` are dead parameters on the
 *  work-rights branch (buildQuestion's own comment: its marketId comes from `city` alone) — passed
 *  as an empty string here, never a fabricated value pretending to mean something. */
export function workRightsQuestionFor(city: string): DiscoveryQuestion {
  return buildQuestion("work-rights", "", city);
}

/** #185 — the profile rail's languages door needs the SAME re-open contract work-rights got: the
 *  ORIGINAL languages question (itemId, question/consequence text, option strings), so the client
 *  never re-declares LANGUAGES_QUESTION/languagesUnion()/DECLINE_OPTION itself, and never pre-ticks
 *  from CV-mined claim text (a save built on that would silently flip a real "no" to "yes" or vice
 *  versa). Thin wrapper over buildQuestion's own language branch — the ONE place this composition
 *  happens — mirroring workRightsQuestionFor above. `familyId`/`anyFamily`/`scopeLabel`/`city` are
 *  dead parameters on that branch (see buildQuestion's own doc comment: the language branch reads
 *  nothing from either) — passed as empty/null placeholders, never fabricated. */
export function languagesQuestion(): DiscoveryQuestion {
  return buildQuestion("language", "", null);
}

export interface LanguageFactWrite {
  /** The eligibility store's scope column — the language's own name, in the words the person used. */
  familyId: string;
  value: string;
  label: string;
}

/** What one answer to the declaring question changes in the store — never a full-set overwrite.
 *
 *  #165 deletes #123's full-set write, and the deletion is the point. That write recorded "none" for
 *  every language the person did NOT tick, and "none" was read as an explicit "I don't speak this",
 *  which withdrew postings: the machine wrote a hard no the person never said. Here, an answer only
 *  ever records the languages they DID name.
 *
 *  Dropping a language from the list REMOVES its fact, returning it to unknown — never to a "no"
 *  (#125's own AC: "removing a volunteered language must return it to unknown"). Unknown never
 *  withdraws, so correcting a list can only ever put jobs back in the deck.
 *
 *  A language they keep is left ALONE when a fact for it already exists, which is what protects a
 *  level they already placed: re-answering the declaring question must not knock Mandarin back down
 *  from "I can run a meeting in it" to a bare declaration.
 *
 *  🚨 And a PLACED LEVEL is never retracted by this question at all, even when the language is absent
 *  from the answer. Two ways that bites otherwise, and the second is the dangerous one:
 *    - "I can run a meeting in Mandarin" is an answered question (#125: asked once per language
 *      EVER). Dropping the word from a list should not un-answer it and start asking again.
 *    - A deliberate "I don't speak this one" is, by design, NEVER shown in the declared list — so it
 *      is absent from every subsequent answer by construction. Retracting on absence would delete
 *      that answer the moment the person edited their languages for any other reason, and the ladder
 *      would ask them the same question forever.
 *  Bare declarations still retract on absence, which is what #125's own AC asks for ("removing a
 *  volunteered language must return it to unknown"). */
export function languageDeclarationPlan(
  answers: readonly string[],
  existing: readonly EligibilityFact[],
): { put: LanguageFactWrite[]; remove: string[] } {
  const named = new Map<string, string>(); // normalised -> the person's own words
  for (const raw of answers) {
    const word = raw.trim();
    if (word.length > 0) named.set(word.toLowerCase(), word);
  }
  const stored = existing.filter((f) => f.dimension === "language");
  // 🚨 #165 QA gate, DEFECT-2: "already stored" must mean "already says something we must keep" —
  // a placed rung, or an existing declaration — NOT merely "a row exists at this scope". A pre-#165
  // `"none"` row is stored and yet declares nothing (isDeclaredValue rejects it on purpose: it is
  // the mistap value). Keying off bare existence made that row swallow the write: the person typed
  // Mandarin, the screen said "Locked in — English, Mandarin", and Mandarin was never stored, never
  // shown, never reached their CV. A legacy row is overwritten by the declaration instead.
  const alreadySaid = new Set(
    stored
      .filter((f) => levelOf(f.value) !== null || isDeclaredValue(f.value))
      .map((f) => f.familyId.trim().toLowerCase()),
  );
  return {
    put: [...named.entries()]
      .filter(([key]) => !alreadySaid.has(key))
      .map(([, word]) => ({ familyId: word, value: LANGUAGE_DECLARED, label: `Speaks ${word}` })),
    remove: stored
      .filter((f) => levelOf(f.value) === null) // a placed level is an answer, not a declaration
      .filter((f) => !named.has(f.familyId.trim().toLowerCase()))
      .map((f) => f.familyId),
  };
}

/** A person naming forty languages is not a person, it is a script. The per-word cap lives in
 *  languageLevel.ts (MAX_LANGUAGE_WORD) — both doors into a language fact share it. */
const MAX_LANGUAGES = 20;

/** #165 — the list is no longer closed, so this no longer checks membership. An unknown word is KEPT
 *  (a French speaker in Asia, #125): it is stored, it shows on the profile, and it simply matches no
 *  advert until languages-by-market.json learns it. What is still refused is anything that isn't a
 *  plausible word at all — this is a trust boundary, and the value becomes a store key.
 *  An empty array stays legal: "none of these" is a real answer, and it now records nothing at all
 *  rather than a wall of "no"s. */
export function isValidLanguageSelection(answers: readonly string[]): boolean {
  if (answers.length > MAX_LANGUAGES) return false;
  return answers.every((a) => {
    const word = a.trim();
    return word.length > 0 && word.length <= MAX_LANGUAGE_WORD && !word.includes("\n");
  });
}

// --- code-review must-fix 7 (2026-08-03) -----------------------------------------------------
// The provider-signal seam (providerWorkRightsSignal / AC5) that previously lived here has been
// REMOVED, not fixed. Its value vocabulary (a canonicalised list of eligible locations, e.g. "HK,SG",
// read from a posting's applicantLocationRequirements) and the vocabulary a USER answers into
// (eligible / needs-sponsorship, a status relative to ONE city) are two different kinds of fact —
// "which countries this job accepts applicants from" does not resolve into "can THIS visitor work in
// THEIR city without sponsorship" without also knowing the visitor's own location, which nothing in
// this codebase collects today. Coercing the two into one store value would have been exactly the
// "invented policy" the parent research doc warns against, not a working seam. Reintroducing this
// (dimension.get() preferred over asking) is real work for #99-101 (live posting retrieval), once
// there is an actual visitor-location fact to compare a posting's requirement against. AC5 is
// reported as deferred to that ticket, not met here.

export interface EligibilityAnswerStores {
  eligibility: EligibilityStore;
  claims: ClaimStore;
}

export type EligibilityAnswerResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

const badAnswer = { ok: false as const, status: 400, code: "invalid_answer", message: "unrecognized eligibility answer" };

/** An eligibility answer's own write path. Code-review must-fix 1: a REAL answer (of any kind,
 *  including a "no"-shaped one like "Not yet — I'd need sponsorship") never touches the claims store
 *  — graph.ts's buildClaimGraph renders every claim in its first argument unconditionally, and
 *  stamps every claim in its `negatives` option classification "Negative", which the contract oracle
 *  (packages/contracts/oracle/validate_graph.mjs) defines as a CONFIRMED GAP Tailor must never
 *  assert. Either path would misrepresent a real answer. A real answer therefore lives ONLY in the
 *  eligibility store (put()); "already answered" is read back from THAT store, never from a claim.
 *  Only a DECLINE still writes a claims-store record (answerNegative — "asked and closed, no fact"),
 *  reusing the one persistence this repo already has for that state. Must-fix 5: correcting an answer
 *  TO a decline retracts any value a PRIOR real answer stored — eligibility.remove() runs
 *  unconditionally on a decline (a no-op if nothing was ever stored), so the dimension reads unknown
 *  again, never a retracted value. Must-fix 8: `city` is the visitor's REAL resolved city (#184:
 *  postingRetrieval.ts's resolvedCityFor, over the confirmed search area) — it's rebuilt into the
 *  question text a decline's claim records verbatim, so that record must match what the visitor was
 *  actually asked.
 *
 *  #123: `body` carries either a single `answer` (every single-select question, and every question's
 *  OWN decline) or `answers: string[]` (the multi-select languages question's real answer).
 *
 *  2026-08-12 (#162 architecture pass): lifted out of routes/onboarding.ts, where this sat as a
 *  route-local closure sending replies itself. It returns a plain result now — the route turns a
 *  failure into its own HTTP status — so the write path is testable without the HTTP funnel, beside
 *  the module that builds the very questions it answers. */
export async function answerEligibilityItem(
  stores: EligibilityAnswerStores,
  sessionId: string,
  markets: readonly string[],
  itemId: string,
  body: { answer?: string; answers?: string[] },
): Promise<EligibilityAnswerResult> {
  const question = eligibilityCandidates(ANY_FAMILY, markets).find((q) => q.itemId === itemId);
  if (!question) return { ok: false, status: 404, code: "unknown_item", message: "no such floor item" };
  const ask = question.eligibility!;

  if (body.answer !== undefined) {
    const answer = body.answer.trim();
    if (answer === ask.declineOption) {
      if (question.multiSelect) {
        // #123: a decline on the (multi-select) languages question retracts the languages this
        // question itself recorded, so they read as unknown again.
        //
        // Code-review must-fix 2 (2026-08-04): reads what this SESSION actually has stored (list())
        // and removes each language-dimension fact by its own recorded scope, rather than looping
        // over TODAY's languagesUnion() — languages-by-market.json is the owner's own hand-edit
        // surface, and the day a market is dropped or a language renamed there, a visitor who
        // answered under the OLD list and then declines would otherwise keep a stale fact at a scope
        // the union no longer contains: a decline that silently fails to fully retract.
        //
        // 🚨 #165 QA gate, DEFECT-1: a PLACED LEVEL survives a decline, exactly as it survives a
        // re-answer (languageDeclarationPlan's own rule — this loop is that rule's other half, and
        // shipping one without the other is what the gate caught). A rung is an answer to a
        // DIFFERENT question, asked by an advert and closed for good (#125: once per language ever;
        // ADR-0011 clause 4). Declining "which languages do you speak" says nothing about it.
        //
        // The path is not hypothetical: the web client sends this decline when a person confirms the
        // languages question with nothing listed ("I'd rather not list any"), so without this guard
        // an ordinary edit to a language list silently destroyed every level they had placed —
        // including the deliberate "I don't speak this one", which is never shown in that list and
        // so can never be re-stated through it.
        for (const fact of await stores.eligibility.list(sessionId)) {
          if (fact.dimension === ask.dimension && levelOf(fact.value) === null) {
            await stores.eligibility.remove(sessionId, fact.dimension, fact.familyId);
          }
        }
      } else {
        await stores.eligibility.remove(sessionId, ask.dimension, ask.familyId);
      }
      const claimId = discoveryClaimId(itemId);
      await stores.claims.answerNegative(sessionId, {
        id: claimId,
        semantic_key: claimId,
        field_key: null,
        field_value: null,
        field_label: null,
        role: "profile",
        text: `Declined — ${question.question}`,
        machine_touch: "verbatim",
        classification: "Verified",
        source_quote: answer.slice(0, 200),
        needs_grill: false,
        grill_hint: null,
      });
      return { ok: true };
    }

    // #123: a multi-select question only ever accepts a single `answer` for its decline (handled
    // above) — a REAL response is always `answers`. Falling through to the single-value mapper below
    // would be silently wrong (it knows nothing about this question's shape), so this is a 400.
    if (question.multiSelect) return badAnswer;

    const mapped = mapEligibilityAnswer(ask.dimension, answer);
    if (!mapped) return badAnswer;
    await stores.eligibility.put(sessionId, {
      dimension: ask.dimension,
      familyId: ask.familyId,
      value: mapped.value,
      label: mapped.label,
    });
    return { ok: true };
  }

  // #123: the multi-select real-answer path — `body.answers` (the caller checks exactly one of
  // answer/answers is present first). A single-select question never accepts this shape.
  if (!question.multiSelect || !body.answers || !isValidLanguageSelection(body.answers)) return badAnswer;
  // #165: a DELTA, not a full-set overwrite — see languageDeclarationPlan for why the overwrite had
  // to go (it was the thing writing the "no" nobody said). Reads this session's own stored facts so a
  // language dropped from the list is retracted to unknown and one kept keeps any level already placed.
  const plan = languageDeclarationPlan(body.answers, await stores.eligibility.list(sessionId));
  for (const familyId of plan.remove) {
    await stores.eligibility.remove(sessionId, ask.dimension, familyId);
  }
  for (const write of plan.put) {
    await stores.eligibility.put(sessionId, { dimension: ask.dimension, ...write });
  }
  return { ok: true };
}
