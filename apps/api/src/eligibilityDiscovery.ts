// #106 — which eligibility dimensions (apps/api/src/eligibility.ts) discovery actually asks, built as
// DiscoveryQuestion[] the /onboarding/discovery* routes append to state.questions, plus the
// years-experience family-scope helper.
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
import type { EligibilityDimension } from "@jobcrush/contracts";
import type { SessionRecord } from "./sessions.js";
import type { ClaimRecord } from "./claims.js";
import {
  resolveFamily,
  isDiscoveryClaim,
  itemIdOf,
  slug,
  type DiscoveryQuestion,
  type DiscoveryState,
} from "./discovery.js";
import { loadFamilyFloor } from "./e5stub.js";
import { ANY_FAMILY } from "./eligibility.js";

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

// Step 1 derivation (docs/research/eligibility-dimensions-from-the-corpus.md): years-experience (6/17)
// and work-rights (0/17, included as a deliberate, owner-approved deviation — see the doc) and
// language (2/17) are asked; certification (1/17) and degree (4/17) are excluded because the live
// discovery floor (sample-family-floors.json) already asks both. Order matches the UI design spec's
// block order.
const ASK_DIMENSIONS: readonly EligibilityDimension[] = ["years-experience", "work-rights", "language"];

// years-experience is family-scoped (CONTEXT.md: "length of experience is always experience in a
// family, never a career total") — itemId()/FAMILY_SCOPED below exist for it. work-rights does NOT
// vary by job family (right to work doesn't depend on the role) but, per #182 / #180, DOES vary by
// PLACE: the question is already worded "Can you work in {city}...?", so its answer is a fact about
// that city, not a global one. FAMILY_SCOPED is reused rather than duplicated for this — it just
// means "this dimension's itemId/store-scope carries a suffix", and work-rights' suffix is a city
// instead of a job family. `eligibilityCandidates`'s `city` parameter supplies it; ANY_FAMILY remains
// the fallback when no city is known yet (buildQuestion's own null-city branch), and a null
// scopeLabel — scopeLabel is years-experience's own question-text field, unused here.
//
// language is NOT in this set (#123 supersedes #107 D2's use of it): the store's familyId column is
// still a free-text SCOPE for language, and a blocking requirement's eligibilitySubject ("Mandarin")
// is still looked up against exactly that column (withdrawal.ts, unchanged) — but the QUESTION is now
// one multi-select over every supported language (languagesUnion()), not one question per language,
// so there is no single familyId for itemId() to build a per-language itemId from. buildQuestion's own
// language branch below writes a fixed itemId (LANGUAGE_ITEM_ID) directly instead; the actual
// per-language store writes happen in routes/onboarding.ts via languageFacts(), each at its own
// language's scope, exactly like before — only the QUESTION shape and its itemId scheme changed.
const FAMILY_SCOPED: ReadonlySet<EligibilityDimension> = new Set(["years-experience", "work-rights"]);

// --- years-experience bands (UI design spec §2 — pinned, do not change without the spec) ---
const YEARS_OPTIONS = ["Under 3 years", "3–4 years", "5–7 years", "8–10 years", "More than 10 years"] as const;
// Each band's LOWER bound, never a midpoint (design spec: "never overstates what the visitor
// confirmed"). "Under 3 years" -> 0 is intentional, not a default: the true lower bound of an
// open-ended "under" band is 0, and the design spec explicitly rejected a midpoint guess here.
const YEARS_BAND_VALUES: Readonly<Record<string, number>> = {
  "Under 3 years": 0,
  "3–4 years": 3,
  "5–7 years": 5,
  "8–10 years": 8,
  "More than 10 years": 10,
};

// --- work-rights options (UI design spec §2) ---
const WORK_RIGHTS_YES = "Yes — no sponsorship needed";
const WORK_RIGHTS_NOT_YET = "Not yet — I'd need sponsorship";
// #185 code-review cheap weld: the store's own canonical value tokens, named once so
// mapEligibilityAnswer (answer text -> value, below) and workRightsAnswerLabel (value -> answer
// text, the profile rail's reverse lookup, below) share ONE vocabulary — a rename of either literal
// can no longer silently desync the two directions into "an answered market reads as unanswered".
const WORK_RIGHTS_ELIGIBLE_VALUE = "eligible";
const WORK_RIGHTS_NEEDS_SPONSORSHIP_VALUE = "needs-sponsorship";

// --- the languages question (#123 UI design spec — pinned copy, do not paraphrase) ---
//
// Code-review must-fix 1 (2026-08-04) — recorded here, not just inferred: a BINARY multi-select
// (tick = professional, unticked = none) has no third option, so it can never write the store's
// "conversational" value the way the old three-option single question could. That value is not
// removed from the vocabulary (withdrawal.ts's isExplicitNo still honours it for any fact stored
// before this change), but nothing built here can produce it going forward — the owner's sanctioned
// trade for option (a) over option (b) (per-language yes/no/some), recorded in full in
// docs/research/languages-from-the-corpus.md's "Decision taken" section. Its real risk: this
// question's own bar ("Tick every one you could run a meeting in") reads as excluding a visitor with
// solid-but-imperfect conversational fluency — ticking under that bar now records "professional" (a
// stronger claim than warranted), but NOT ticking records an explicit "none", which #107 treats as a
// real no and withdraws every mandatory-language posting. Mitigated below, deliberately, by ADDING to
// (never softening) the pinned consequence sentence: an unsure visitor is told to tick, because #86's
// rule is that never silently deleting a winnable job outranks precision — ticking can only ever keep
// a job in the deck, never remove one. Owner correction (2026-08-04): the first added clause spelled
// that reasoning out on-screen and QA flagged it as the longest thing on the screen, restating the
// first sentence in mirror form; trimmed to a three-word nudge that keeps the decision without
// re-arguing it — the reasoning stays recorded here and in the research doc, not on the visitor's screen.
const LANGUAGES_QUESTION =
  "Which of these can you work in professionally? Anything you leave unticked, I'll treat as a no.";
const LANGUAGES_CONSEQUENCE =
  "A no takes jobs that require that language out of your deck. Tick every one you could run a meeting in." +
  " Not sure? Tick it.";

// Code-review must-fix 6 (2026-08-03): a years-experience question scoped by a JOB TITLE ("...worked
// in IT Project Manager?") is ungrammatical and reads as the wrong thing — the ticket's central UX
// requirement is that the scope be tellable from the question alone, which needs a domain phrase, not
// a title. Keyed by whatever resolveEligibilityFamilyScope actually has on hand: the E5 stub's raw
// family name (e5stub.ts's STUB_FAMILY) on the path that runs today, or a pinned production familyId
// once that path is live. Both keys resolve to the SAME real domain — the stub's one family and the
// one published production family (apps/api/research/it-project-delivery-v1.json) describe the same
// real-world work.
const KNOWN_SCOPE_LABELS: Readonly<Record<string, string>> = {
  "IT Project Manager": "IT project delivery", // e5stub.ts's STUB_FAMILY — the path that runs today
  "it-project-delivery": "IT project delivery", // the one published production familyId
};

/** A generic, deterministic fallback for any key with no entry above — sentence-cases a hyphenated
 *  id, or returns a spaced human name as-is if it isn't hyphenated. Exercised only for a family this
 *  codebase does not yet know a domain phrase for. */
function scopeLabelFor(key: string): string {
  const known = KNOWN_SCOPE_LABELS[key];
  if (known) return known;
  const spaced = key.includes("-") ? key.replace(/-/g, " ").trim() : key.trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

/** A deterministic slug from the E5 stub's human family name ("IT Project Manager" -> "it-project-
 *  manager"), so the stub path has a stable id to key the eligibility store on without inventing one
 *  by hand. Not the same id as the published "it-project-delivery" family — the stub is a hand
 *  stand-in for a single family (e5stub.ts's own doc), not that production floor. #182 QA round 3:
 *  now a thin wrapper over discovery.ts's `slug()` — this used to duplicate the same lowercase/
 *  collapse-non-alnum logic locally; the work-rights market key needs the identical canonicalisation
 *  (buildQuestion's work-rights branch, below), so there is one slugging rule, not two. */
function stableFamilyId(familyName: string): string {
  return slug(familyName);
}

/** The ONE place that decides which family scopes years-experience (#106 step 3.3). Prefers the
 *  production-discovery pinned floor when the session has one (session.discovery.floor) — that path
 *  is not wired into the live discovery routes today (they run the E5 stub, e5stub.ts's
 *  loadFamilyFloor), but the check costs nothing and means nothing else has to change when it is.
 *  Otherwise derives a stable id from the live stub flow's resolveFamily(role), the path that
 *  actually runs today. `scopeLabel` is a bare domain phrase (never a job title, never a sentence) —
 *  the UI design spec renders it directly inside its own question templates (must-fix 6). */
export function resolveEligibilityFamilyScope(
  session: Pick<SessionRecord, "discovery">,
  role: string,
): { familyId: string; scopeLabel: string } {
  const pinned = session.discovery.floor;
  if (pinned) return { familyId: pinned.familyId, scopeLabel: scopeLabelFor(pinned.familyId) };
  const { family } = resolveFamily(role);
  return { familyId: stableFamilyId(family), scopeLabel: scopeLabelFor(family) };
}

function itemId(dimension: EligibilityDimension, familyId: string): string {
  return FAMILY_SCOPED.has(dimension)
    ? `${ELIGIBILITY_ITEM_PREFIX}${dimension}-${familyId}`
    : `${ELIGIBILITY_ITEM_PREFIX}${dimension}`;
}

function buildQuestion(
  dimension: EligibilityDimension,
  familyId: string,
  anyFamily: string,
  scopeLabel: string,
  city: string | null,
): DiscoveryQuestion {
  if (dimension === "years-experience") {
    const question = scopeLabel
      ? `How many years have you worked in ${scopeLabel}?`
      : "How many years have you worked in the kind of job you're going for?";
    return {
      itemId: itemId(dimension, familyId),
      question,
      options: [...YEARS_OPTIONS, DECLINE_OPTION],
      cvSection: "experience",
      eligibility: { dimension, familyId, scopeLabel: scopeLabel || null, declineOption: DECLINE_OPTION },
    };
  }
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
  // dimension === "language" — #123 supersedes #107 D2's single-English question with ONE
  // multi-select over every language in languagesUnion(). `familyId`/`scopeLabel` stay unused on this
  // branch (this question has no ONE family/language scope); `anyFamily` is used only as a required
  // placeholder for EligibilityAsk.familyId below — the route's real per-language writes (a full set
  // of facts, one per languagesUnion() entry, via languageFacts()) never read this field back.
  return {
    itemId: LANGUAGE_ITEM_ID,
    question: LANGUAGES_QUESTION,
    consequence: LANGUAGES_CONSEQUENCE,
    options: [...languagesUnion(), DECLINE_OPTION],
    multiSelect: true,
    cvSection: "skills",
    eligibility: { dimension, familyId: anyFamily, scopeLabel: null, declineOption: DECLINE_OPTION },
  };
}

/** Every eligibility question this session could be asked, unfiltered by what it has already
 *  answered — the answer route's find-by-itemId (including a CORRECTION of an already-closed
 *  question) needs the full set, not just what remains. `anyFamily` is the eligibility store's
 *  ANY_FAMILY constant, passed in by the caller rather than imported here, so this module stays
 *  decoupled from eligibility.ts's export surface beyond the one string value it needs. */
export function eligibilityCandidates(
  familyId: string,
  anyFamily: string,
  scopeLabel: string,
  city: string | null,
): DiscoveryQuestion[] {
  return ASK_DIMENSIONS.map((d) => buildQuestion(d, familyId, anyFamily, scopeLabel, city));
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
  session: Pick<SessionRecord, "discovery">,
  role: string,
  anyFamily: string,
  city: string | null,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  rejected: ClaimRecord[],
  facts: readonly { dimension: EligibilityDimension; familyId: string }[],
): DiscoveryQuestion[] {
  const { familyId, scopeLabel } = resolveEligibilityFamilyScope(session, role);
  const declined = claimsClosedEligibilityItemIds(confirmed, negatives, rejected);
  const resolved = factResolvedItemIds(facts);
  return eligibilityCandidates(familyId, anyFamily, scopeLabel, city).filter(
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
 *  discoveryState() one line earlier and keeps using it after. */
export function applyEligibilityQuestions(
  session: Pick<SessionRecord, "discovery">,
  role: string,
  state: DiscoveryState,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  rejected: ClaimRecord[],
  facts: readonly { dimension: EligibilityDimension; familyId: string }[],
): void {
  const eligQuestions = unresolvedEligibilityQuestions(
    session,
    role,
    ANY_FAMILY,
    state.city,
    confirmed,
    negatives,
    rejected,
    facts,
  );
  const { family } = resolveFamily(role);
  const standardIds = new Set(
    loadFamilyFloor(family).items.filter((i) => i.rankBand === "standard").map((i) => i.id),
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
  value: string; // canonical — a decimal string for years-experience, an opaque token otherwise
  label: string; // human-readable, for the EligibilityFact the store renders back to the user
}

/** A tapped option -> the store's canonical value, or null when the answer matches neither a known
 *  option nor the decline. Callers check the decline (item.eligibility.declineOption) themselves
 *  before calling this — decline never reaches here. */
export function mapEligibilityAnswer(
  dimension: EligibilityDimension,
  scopeLabel: string,
  answer: string,
): MappedEligibilityAnswer | null {
  if (dimension === "years-experience") {
    const years = YEARS_BAND_VALUES[answer];
    return years === undefined ? null : { value: String(years), label: `Years in ${scopeLabel}` };
  }
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
 *  as empty strings here, never fabricated values pretending to mean something. */
export function workRightsQuestionFor(city: string): DiscoveryQuestion {
  return buildQuestion("work-rights", "", "", "", city);
}

/** #185 — the profile rail's languages door needs the SAME re-open contract work-rights got: the
 *  ORIGINAL languages question (itemId, question/consequence text, option strings), so the client
 *  never re-declares LANGUAGES_QUESTION/languagesUnion()/DECLINE_OPTION itself, and never pre-ticks
 *  from CV-mined claim text (a save built on that would silently flip a real "no" to "yes" or vice
 *  versa). Thin wrapper over buildQuestion's own language branch — the ONE place this composition
 *  happens — mirroring workRightsQuestionFor above. `familyId`/`anyFamily`/`scopeLabel`/`city` are
 *  all dead parameters on that branch (see buildQuestion's own doc comment: the language branch
 *  reads nothing from any of them) — passed as empty/null placeholders, never fabricated. */
export function languagesQuestion(): DiscoveryQuestion {
  return buildQuestion("language", "", "", "", null);
}

export interface LanguageFactWrite {
  /** The eligibility store's scope column — the language's own name. */
  familyId: string;
  value: "professional" | "none";
  label: string;
}

/** #123 — every language fact one multi-select answer writes: ONE PER languagesUnion() ENTRY, not
 *  only the ticked ones. This full-set write (never a delta) is what makes a correction work:
 *  re-answering with Mandarin ticked flips its stored "none" back to "professional" in the same
 *  call that leaves every other language's fact untouched (still written, to the same value it
 *  already had) — there is no stale prior write left behind for anything to miss. `selected` need
 *  not be pre-validated; callers check isValidLanguageSelection first so an unrecognized value never
 *  reaches the store, but an unvalidated extra value here would simply be ignored (harmless, since
 *  the return is built by mapping languagesUnion(), never `selected`, into the result). */
export function languageFacts(selected: readonly string[]): LanguageFactWrite[] {
  const chosen = new Set(selected);
  return languagesUnion().map((language) => ({
    familyId: language,
    value: chosen.has(language) ? "professional" : "none",
    label: `Professional fluency in ${language}`,
  }));
}

/** True iff every element of `answers` is one of today's supported languages (languagesUnion()) —
 *  anything else (a typo, a stray value, a language this data file doesn't know yet) is a 400 at the
 *  route, never silently stored or silently dropped. An empty array is always valid — "I can't work
 *  in any of these" is a real, legal answer (#123 AC: `answers: []` is legal). */
export function isValidLanguageSelection(answers: readonly string[]): boolean {
  const valid = new Set(languagesUnion());
  return answers.every((a) => valid.has(a));
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
