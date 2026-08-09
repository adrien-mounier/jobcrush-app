// #16 discovery (screen 1a) — the answer→CV-line→section-bar core loop, server side.
//
// The screen is a pure function of persisted state (spec story #76: answers persist server-side from
// question 1, never localStorage). This module holds the pure helpers the routes call:
//   - composeCvLine / composeRoleLine — cheap, deterministic CV text from an answer (spec §8.2:
//     "composed cheaply from my answer, polished later" — a later audit pass rewrites; prior art
//     grill.ts's answerToClaim, which composes claim text locally the same way).
//   - resolveFamily / parseCity — the family-placement + city stubs (the real family classifier is a
//     clustering model, out of scope — spec "the flow uses a hand list stand-in"). Behind functions so
//     E5 can replace the producer, exactly like e5stub.ts's loadFamilyFloor.
//   - discoveryState — rebuilds the whole DiscoveryState from the session's role + its recorded
//     discovery answers (confirmed positives + negatives + #35's deck-rejected, all of which close a
//     question), so GET /discovery resumes with no client state.
import type { FloorItem, CvSection, MinedRole, EligibilityDimension } from "@jobcrush/contracts";
import type { ClaimRecord } from "./claims.js";
import { loadFamilyFloor, lookupAdRequirements } from "./e5stub.js";
import { loadPostings } from "./preview.js";

export const CV_SECTIONS = ["summary", "experience", "skills", "education"] as const;

// A discovery answer is persisted as a claim under this deterministic id, so answered-tracking and
// resume derive from the store alone (item answered ⇔ a `discovery-<itemId>` claim exists).
export const DISCOVERY_PREFIX = "discovery-";
export const discoveryClaimId = (itemId: string) => `${DISCOVERY_PREFIX}${itemId}`;
export const itemIdOf = (claimId: string) => claimId.slice(DISCOVERY_PREFIX.length);
export const isDiscoveryClaim = (claimId: string) => claimId.startsWith(DISCOVERY_PREFIX);

// --- the E5 family-placement stub (hand stand-in; one family for now, like sample-family-floors.json) ---
const STUB_FAMILY = "IT Project Manager";
const KIN_TITLES = [
  "IT project manager",
  "programme manager",
  "delivery manager",
  "project lead",
  "PMO lead",
];
/** Q1 free text → its job family + the kin titles we search ("same kind of job"). A title that matches
 *  nothing is still placed (spec story #16: accepted in silence) — the stub always returns the family. */
export function resolveFamily(text: string): { family: string; suggestions: string[] } {
  return { family: STUB_FAMILY, suggestions: text.trim() ? KIN_TITLES : [] };
}

/** The visitor's city, lifted from Q1 for free (spec story #20: the promise carries my city). "…in Paris"
 *  → "Paris"; none → null. Deliberately simple — Q1 is free text, not a structured field. */
export function parseCity(text: string): string | null {
  const m = text.match(/\bin\s+(\p{Lu}[\p{L}-]+(?:\s+\p{Lu}[\p{L}-]+)?)/u);
  return m?.[1] ?? null;
}

/** #179: the open-jobs count per family — ONE producer for the onboarding promise and the profile
 *  rail's Job family section, replacing the hand STUB_COUNT (142). Counts postings in the live pool
 *  (preview.ts's loadPostings — the ingest point) whose read-stamped family fit names this family;
 *  the stamp is #104's ad-reader output, hand fixtures today (e5stub). A posting never read, or read
 *  into another family, does not count. Confidence is deliberately not thresholded: deciding what a
 *  weak family-fit verdict means for the feed is a separate decision that does not belong here
 *  (CONTEXT.md, posting family fit). 0 is a real answer — a family with nothing stamped for it. */
export function promiseCount(family: string): number {
  let count = 0;
  for (const posting of loadPostings()) {
    const lookup = lookupAdRequirements(posting.id);
    if (lookup.status === "found" && lookup.requirements.familyFit.family === family) count += 1;
  }
  return count;
}

/** The CV's lead line — the role the visitor typed is the first line on the page (spec story #18: never
 *  ask their name; the role line leads). First clause of Q1, cleaned. */
export function composeRoleLine(role: string): string {
  const head = (role.split(/[,.;]/)[0] ?? role).trim() || role.trim();
  return head.charAt(0).toUpperCase() + head.slice(1);
}

const stripAnswerLead = (answer: string) => answer.replace(/^(yes|no)\b[,\s]*/i, "").trim();
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** A free-text answer becomes the CV line verbatim (period-terminated). Shared by composeCvLine's
 *  no-options branch and #18's reader-only question (AC6), which has no FloorItem to key off. */
export function freeTextLine(answer: string): string {
  const trimmed = answer.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** A cheap, deterministic CV line from a floor answer. Not grammatically perfect by design — the spec
 *  wants it instant and unpolished, with a later audit pass doing the rewrite (§8.2). Three shapes:
 *    - a free-text item (no options): the answer IS the line (the visitor's own words, e.g. a headline).
 *    - a "Which/What X …?" item: "X: <answer>".
 *    - a "Have you / Do you …?" item: "<verb phrase> — <qualifier>." (dash form, like answerToClaim). */
export function composeCvLine(item: FloorItem, answer: string): string {
  if (item.options.length === 0) return freeTextLine(answer);

  const trimmed = answer.trim();
  const qualifier = stripAnswerLead(answer);
  if (/^(which|what)\b/i.test(item.question)) {
    const noun = item.question
      .replace(/^(which|what)\s+/i, "")
      .replace(/\b(have|do|did|are|were)\s+you\b.*$/i, "")
      .replace(/[?.]+$/, "")
      .trim();
    return `${cap(noun)}: ${qualifier || trimmed}.`;
  }
  const verbPhrase = item.question
    .replace(/^(have you|do you|did you|are you|were you|can you|could you)\b/i, "")
    .replace(/[?.]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const stem = cap(verbPhrase);
  return qualifier ? `${stem} — ${qualifier}.` : `${stem}.`;
}

// --- the DiscoveryState the screen renders (the pinned contract shared with the web client) ---

// #106: an eligibility question rides the SAME DiscoveryQuestion shape as a floor item — additive
// only, so every existing floor question still serialises byte-identically. Present ⇔ this is an
// eligibility question; see apps/api/src/eligibilityDiscovery.ts for how the field is populated and
// docs/research/eligibility-dimensions-from-the-corpus.md for which dimensions are actually asked.
export interface EligibilityAsk {
  dimension: EligibilityDimension; // one of the store's five (apps/api/src/eligibility.ts)
  familyId: string; // the pinned family id, or ANY_FAMILY ("*") for a dimension that holds regardless of role
  scopeLabel: string | null; // the human scope for a family-scoped question; null when global
  declineOption: string; // the exact option string meaning "not answering" — always options' last entry
}
export interface DiscoveryQuestion {
  itemId: string;
  question: string;
  options: string[];
  cvSection: CvSection;
  eligibility?: EligibilityAsk; // present ⇔ this is an eligibility question, never a floor item
  /** #123: present (always `true`) only on the languages question — a multi-select over `options`
   *  (minus the trailing decline entry) rather than a single tap. Every other question omits this
   *  field entirely, so byte-identical serialization holds for everything that isn't multi-select. */
  multiSelect?: true;
  /** #123: a line rendered between the stem and the options, at full weight — the UI design spec's
   *  requirement that the consequence of leaving an option unticked is stated in the question itself,
   *  never discovered later by a missing job. Present only alongside `multiSelect` today, but is its
   *  own field (not folded into `question`) so a future single-select question could carry one too. */
  consequence?: string;
}
export interface DiscoveryCvLine {
  itemId: string; // "role" for the lead line, else the floor item id
  section: CvSection;
  text: string;
}
export interface DiscoveryPromise {
  family: string;
  city: string | null;
  count: number | null;
}
export interface DiscoveryState {
  stage: "discovery" | "deck"; // #18 AC1: the essential band fully asked (yes or no) opens the deck
  role: string | null;
  family: string | null;
  city: string | null;
  promise: DiscoveryPromise | null;
  questions: DiscoveryQuestion[];
  railFill: Record<CvSection, number>;
  essentialRemaining: number;
  cvLines: DiscoveryCvLine[];
  factCount: number;
}

/** #17 profile badge / #23 factCount — "the pile that only grows": every recorded answer counts, a
 *  "no" included. Defined as confirmed positives + persisted negatives (session-wide, every source —
 *  discovery, grill, tailor). A correction (no<->yes) flips one record's `decision` in place rather
 *  than adding/removing a row, so this is monotonic non-decreasing across a normal answer/correction;
 *  only an independent deck reject (a different, S2 flow) can lower this RAW count. This function
 *  stays pure and unaware of that — #33's session-wide floor (routes/onboarding.ts's withFactFloor,
 *  sessions.ts's factFloor) is what callers apply on top so the number actually shown never drops. */
export function factCount(confirmed: ClaimRecord[], negatives: ClaimRecord[]): number {
  return confirmed.length + negatives.length;
}

const emptyRail = (): Record<CvSection, number> =>
  ({ summary: 0, experience: 0, skills: 0, education: 0 });

const toQuestion = (i: FloorItem): DiscoveryQuestion => ({
  itemId: i.id,
  question: i.question,
  options: i.options,
  cvSection: i.cvSection,
});

// #18 AC6: the one reader-only question — over CV facts only a reader of the uploaded CV could ask
// (bounded stub: derives from the first mined role only; the broader "CV auto-answers" mechanism,
// spec stories #8-11, is out of scope). Not a floor item, so it's never in essentialRemaining/railFill.
export const READER_ROLE_ITEM_ID = "reader-role";

export function readerQuestion(role: MinedRole): DiscoveryQuestion {
  return {
    itemId: READER_ROLE_ITEM_ID,
    question: `Your CV mentions "${role.title}" — what was your actual role there?`,
    options: [],
    cvSection: "experience",
  };
}

/** Discovery asks the leading bands (essential + standard); nice-to-have never gates the deck or the
 *  bars (spec: "the essential band alone is the discovery gate"). */
const asked = (i: FloorItem) => i.rankBand === "essential" || i.rankBand === "standard";

/** The CV lines discovery alone contributes: the role lead line, then each floor item's answered line
 *  in floor rank order, then any reader-only positive (#18 AC6 — synthetic, not a floor item). Split
 *  out of discoveryState (#23 B2 / standards finding): callers that only need cvLines — tailor is the
 *  first — get exactly this, not the full discoveryState rebuild (railFill, essentialRemaining,
 *  question/triggeredBy filtering, the promise) for fields they can't use. `floor` is passed in rather
 *  than re-derived so discoveryState itself doesn't load+parse the family floor twice. */
export function discoveryCvLines(
  role: string,
  floor: FloorItem[],
  confirmed: ClaimRecord[],
): DiscoveryCvLine[] {
  const positives = confirmed.filter((c) => isDiscoveryClaim(c.id));
  const cvLines: DiscoveryCvLine[] = [
    { itemId: "role", section: "summary", text: composeRoleLine(role) },
  ];
  for (const i of floor) {
    const claim = positives.find((c) => itemIdOf(c.id) === i.id);
    if (claim) cvLines.push({ itemId: i.id, section: i.cvSection, text: claim.text });
  }
  for (const claim of positives) {
    const itemId = itemIdOf(claim.id);
    if (itemId.startsWith("reader-") && !cvLines.some((l) => l.itemId === itemId)) {
      cvLines.push({ itemId, section: "experience", text: claim.text });
    }
  }
  return cvLines;
}

/** Rebuild the whole screen state from persisted facts. `role` is the Q1 text (null before Q1);
 *  `confirmed`/`negatives`/`rejected` are this session's recorded answers — `rejected` (#35: a claim
 *  the S2 deck rejected) still closes its question (the visitor was asked and answered; only the
 *  machine's phrasing of it was rejected), so it counts into `answeredIds` alongside negatives, but
 *  never into `positives` — no CV line (cvLines stays confirmed-only, unaffected) and no trigger
 *  (isTriggered keys off `positives`, so a rejected trigger does not surface an UNanswered triggered
 *  item — an already-answered one stays askable; see the isTriggered comment).
 *  Pure + deterministic → GET resumes. */
export function discoveryState(
  role: string | null,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  rejected: ClaimRecord[] = [],
): DiscoveryState {
  if (!role) {
    return {
      stage: "discovery",
      role: null,
      family: null,
      city: null,
      promise: null,
      questions: [],
      railFill: emptyRail(),
      essentialRemaining: 0,
      cvLines: [],
      factCount: factCount(confirmed, negatives),
    };
  }

  const { family } = resolveFamily(role);
  const city = parseCity(role);
  const floor = loadFamilyFloor(family).items;
  const byId = new Map(floor.map((i) => [i.id, i]));

  // An item is answered by a positive, a "no", OR a deck-rejected claim (#35 — all three close it).
  // Positives also carry a CV line; rejected does not (it's excluded from `positives` on purpose).
  const positives = confirmed.filter((c) => isDiscoveryClaim(c.id));
  const answeredIds = new Set(
    [
      ...positives,
      ...negatives.filter((c) => isDiscoveryClaim(c.id)),
      ...rejected.filter((c) => isDiscoveryClaim(c.id)),
    ].map((c) => itemIdOf(c.id)),
  );

  // #18 AC5: a triggered item is only askable once its trigger has a POSITIVE answer — a "no" on the
  // trigger does not surface it. Untriggered items are always askable. "askable" gates BOTH questions
  // and railFill, so an un-surfaced triggered item sits in neither's numerator nor denominator.
  // #35: `|| answeredIds.has(i.id)` — an already-answered item can never be un-asked. Without it,
  // rejecting the TRIGGER claim (moving it out of `positives`) would evict its already-answered
  // follow-up from `askable` too, dropping it from railFill's numerator AND denominator — the same
  // regression this ticket forbids, one step removed from the trigger claim itself.
  const isTriggered = (i: FloorItem) =>
    !i.triggeredBy || positives.some((c) => itemIdOf(c.id) === i.triggeredBy) || answeredIds.has(i.id);
  const askable = floor.filter((i) => asked(i) && isTriggered(i));

  const questions = askable.filter((i) => !answeredIds.has(i.id)).map(toQuestion);

  // rail fill: per section, the share of that section's askable items answered.
  const railFill = emptyRail();
  for (const section of CV_SECTIONS) {
    const inSection = askable.filter((i) => i.cvSection === section);
    if (inSection.length === 0) continue;
    const done = inSection.filter((i) => answeredIds.has(i.id)).length;
    railFill[section] = done / inSection.length;
  }

  // essentialRemaining is the discovery gate — the essential band alone, never a triggered item
  // (triggered items are always rankBand "standard"; see the family-floor stub).
  const essential = floor.filter((i) => i.rankBand === "essential");
  const essentialRemaining = essential.filter((i) => !answeredIds.has(i.id)).length;

  const cvLines = discoveryCvLines(role, floor, confirmed);

  return {
    stage: essentialRemaining === 0 ? "deck" : "discovery",
    role,
    family,
    city,
    promise: { family, city, count: promiseCount(family) },
    questions,
    railFill,
    essentialRemaining,
    cvLines,
    factCount: factCount(confirmed, negatives),
  };
}

/** True only for a BARE "no" — it closes the item but adds nothing to the CV (persisted as a negative
 *  via #13's answerNegative). A hedged option like "No, but a related certification" is NOT a "no": it
 *  asserts a real fact, so it must fall through to composeCvLine and be conserved (never dropped as a
 *  negative — CLAUDE.md conservation). The full "no" treatment — asked-and-closed, correction — is #18. */
export function isNoAnswer(answer: string): boolean {
  return /^no[.!]?$/i.test(answer.trim());
}
