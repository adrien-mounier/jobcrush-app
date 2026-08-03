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
import type { EligibilityDimension } from "@jobcrush/contracts";
import type { SessionRecord } from "./sessions.js";
import type { ClaimRecord } from "./claims.js";
import { resolveFamily, isDiscoveryClaim, itemIdOf, type DiscoveryQuestion } from "./discovery.js";

export const DECLINE_OPTION = "Ask me later";

export const ELIGIBILITY_ITEM_PREFIX = "eligibility-";
export const isEligibilityItemId = (itemId: string): boolean => itemId.startsWith(ELIGIBILITY_ITEM_PREFIX);

// The one language the corpus actually demands (both language-citing postings name English
// specifically) — see the derivation doc's "language is a list, not a value" note. #107 (E5 slice 6,
// D2) scopes the store's (session, dimension, family) key by the LANGUAGE NAME now (FAMILY_SCOPED
// above), so a different language answered at its own scope would no longer collide with this one —
// but the live discovery flow below only ever asks about English; nothing here builds a question for
// a second language. A session that already answered English at the OLD scope (ANY_FAMILY, before
// #107) simply reads as unknown again and gets asked once more — accepted pre-launch, not migrated.
export const ELIGIBILITY_LANGUAGE = "English";

// Step 1 derivation (docs/research/eligibility-dimensions-from-the-corpus.md): years-experience (6/17)
// and work-rights (0/17, included as a deliberate, owner-approved deviation — see the doc) and
// language (2/17) are asked; certification (1/17) and degree (4/17) are excluded because the live
// discovery floor (sample-family-floors.json) already asks both. Order matches the UI design spec's
// block order.
const ASK_DIMENSIONS: readonly EligibilityDimension[] = ["years-experience", "work-rights", "language"];

// years-experience is family-scoped (CONTEXT.md: "length of experience is always experience in a
// family, never a career total"). #107 (E5 slice 6, D2) adds language: the store's familyId column
// is a free-text SCOPE, not only a job family, and for language that scope is the language name
// itself (ELIGIBILITY_LANGUAGE, "English") rather than ANY_FAMILY — a blocking requirement's
// eligibilitySubject ("Mandarin") is looked up against exactly this same column (withdrawal.ts), so
// two different languages must never collide into one fact the way a single ANY_FAMILY value would.
// Reuses this SAME FAMILY_SCOPED/itemId mechanism rather than inventing a parallel one (#107's own
// instruction). work-rights alone still holds regardless of role — right to work doesn't vary by
// subject — so it keeps using the store's ANY_FAMILY (passed in by callers — see
// eligibilityCandidates) and a null scopeLabel.
const FAMILY_SCOPED: ReadonlySet<EligibilityDimension> = new Set(["years-experience", "language"]);

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

// --- language options (UI design spec §2) ---
const LANGUAGE_YES = "Yes — I work in it";
const LANGUAGE_SOME = "Some, but not for work";
const LANGUAGE_NO = "No, I don't";

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
 *  stand-in for a single family (e5stub.ts's own doc), not that production floor. */
function stableFamilyId(familyName: string): string {
  return familyName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
    // CITY THE VISITOR WAS ACTUALLY ASKED ABOUT — callers must pass the real parseCity(role) result,
    // never a placeholder null, for that record to be honest.
    const question = city
      ? `Can you already work in ${city} without visa sponsorship?`
      : "Can you already work where you're job-hunting, without visa sponsorship?";
    return {
      itemId: itemId(dimension, anyFamily),
      question,
      options: [WORK_RIGHTS_YES, WORK_RIGHTS_NOT_YET, DECLINE_OPTION],
      cvSection: "experience",
      eligibility: { dimension, familyId: anyFamily, scopeLabel: null, declineOption: DECLINE_OPTION },
    };
  }
  // dimension === "language" — #107 (D2): scoped by the language name itself (ELIGIBILITY_LANGUAGE),
  // not anyFamily — see FAMILY_SCOPED's own doc for why. `anyFamily` stays unused on this branch;
  // work-rights (above) is the only remaining caller of it.
  return {
    itemId: itemId(dimension, ELIGIBILITY_LANGUAGE),
    question: `Can you work professionally in ${ELIGIBILITY_LANGUAGE}?`,
    options: [LANGUAGE_YES, LANGUAGE_SOME, LANGUAGE_NO, DECLINE_OPTION],
    cvSection: "skills",
    eligibility: { dimension, familyId: ELIGIBILITY_LANGUAGE, scopeLabel: null, declineOption: DECLINE_OPTION },
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
 *  attributed even if the resolved family ever changed between the answer and this read. */
function factResolvedItemIds(facts: readonly { dimension: EligibilityDimension; familyId: string }[]): Set<string> {
  return new Set(facts.map((f) => itemId(f.dimension, f.familyId)));
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
    if (answer === WORK_RIGHTS_YES) return { value: "eligible", label: "Right to work without sponsorship" };
    if (answer === WORK_RIGHTS_NOT_YET) return { value: "needs-sponsorship", label: "Right to work without sponsorship" };
    return null;
  }
  if (dimension === "language") {
    if (answer === LANGUAGE_YES) return { value: "professional", label: `Professional fluency in ${ELIGIBILITY_LANGUAGE}` };
    if (answer === LANGUAGE_SOME) return { value: "conversational", label: `Professional fluency in ${ELIGIBILITY_LANGUAGE}` };
    if (answer === LANGUAGE_NO) return { value: "none", label: `Professional fluency in ${ELIGIBILITY_LANGUAGE}` };
    return null;
  }
  return null;
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
