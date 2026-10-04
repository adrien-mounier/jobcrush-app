// #16 discovery (screen 1a) — the answer→CV-line→section-bar core loop, server side.
//
// The screen is a pure function of persisted state (spec story #76: answers persist server-side from
// question 1, never localStorage). This module holds the pure helpers the routes call:
//   - composeCvLine / composeRoleLine — cheap, deterministic CV text from an answer (spec §8.2:
//     "composed cheaply from my answer, polished later" — a later audit pass rewrites; prior art
//     grill.ts's answerToClaim, which composes claim text locally the same way).
//   - parseCity — #184 SUBORDINATED, not deleted: discoveryState/the eligibility questions no longer
//     call it (the ONE location signal is now the resolved search area — routes/onboarding.ts passes
//     it in, resolved via postingRetrieval.ts's resolveSearchArea over session.intent.searchArea).
//     Still exported and still tested as its own small text utility; nothing production reaches it.
//   - discoveryState — rebuilds the whole DiscoveryState from the session's role + its recorded
//     discovery answers (confirmed positives + negatives + #35's deck-rejected, all of which close a
//     question), so GET /discovery resumes with no client state.
import type { CvLanguage } from "./cvLanguages.js";
import type { CandidateClaim, FloorItem, CvSection, MinedRole, EligibilityDimension } from "@jobcrush/contracts";
import type { ClaimRecord, ClaimStore } from "./claims.js";

export const CV_SECTIONS = ["summary", "experience", "skills", "education"] as const;

// A discovery answer is persisted as a claim under this deterministic id, so answered-tracking and
// resume derive from the store alone (item answered ⇔ a `discovery-<itemId>` claim exists).
export const DISCOVERY_PREFIX = "discovery-";
export const discoveryClaimId = (itemId: string) => `${DISCOVERY_PREFIX}${itemId}`;
export const itemIdOf = (claimId: string) => claimId.slice(DISCOVERY_PREFIX.length);
export const isDiscoveryClaim = (claimId: string) => claimId.startsWith(DISCOVERY_PREFIX);

export interface DiscoveryFamily {
  label: string;
  familyId: string;
  items: readonly FloorItem[];
  suggestions: readonly string[];
}

/** The visitor's city, regex-guessed from the words after "in" in their typed job title. "…in Paris"
 *  → "Paris"; none → null. Deliberately simple — Q1 is free text, not a structured field.
 *
 *  #184 SUBORDINATED: this guess and the search area the visitor actually confirmed could disagree
 *  with nothing reconciling them (a role saying "…in Hong Kong" while search area was set to
 *  "Sydney"), which is exactly the two-signal bug #184 closes — production now has ONE location
 *  signal, the resolved search area (postingRetrieval.ts's resolveSearchArea over
 *  session.intent.searchArea), never this regex. Kept exported and independently tested as a small
 *  text utility; discoveryState/the eligibility questions no longer call it.
 *
 *  #182 QA round 3 (still true, for whatever DOES call this): the word after "in" no longer has to
 *  start capitalised — "IT PM in hong kong" used to match nothing (the old regex required a leading
 *  \p{Lu} on every word). The captured words are title-cased on the way out. */
export function parseCity(text: string): string | null {
  const m = text.match(/\bin\s+(\p{L}[\p{L}-]+(?:\s+\p{L}[\p{L}-]+)?)/u);
  if (!m) return null;
  return m[1]!
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** A deterministic, lowercase kebab slug from any free-text label — collapses case AND whitespace
 *  differences ("Hong Kong" / "HONG KONG" / "Hong  Kong" all → "hong-kong") into ONE canonical key.
 *  #182 QA round 3 must-fix: this is now the ONLY form a market ever reaches a store key or itemId
 *  as — eligibilityDiscovery.ts's work-rights question uses it for both, so two visitors (or one
 *  visitor typing the same city two different ways) are never split into separate markets. Also used
 *  by resolveEligibilityFamilyScope's own family-id derivation (formerly a private near-duplicate of
 *  this same logic), so there is exactly one slugging rule in this module, not two that could drift. */
export function slug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  /** #165: present (always `true`) only on the languages question. It changes what `options` MEAN —
   *  from the closed set of legal answers to a list of COMPLETIONS the client offers as the person
   *  types, with a word outside them kept rather than refused. The wire shape of the answer is
   *  unchanged (`answers: string[]`, exactly as `multiSelect` already implies), so a client that does
   *  not know this field still renders a working, if less helpful, control. */
  typeAhead?: true;
  /** #123: a line rendered between the stem and the options, at full weight — the UI design spec's
   *  requirement that the consequence of leaving an option unticked is stated in the question itself,
   *  never discovered later by a missing job. Present only alongside `multiSelect` today, but is its
   *  own field (not folded into `question`) so a future single-select question could carry one too. */
  consequence?: string;
  /** #336: the languages question only, and only when the CV lists languages — each with the CV's
   *  own level word and whether the screen pre-ticks it. A proposal: nothing is stored until the
   *  person submits the question. */
  cvLanguages?: CvLanguage[];
}
export interface DiscoveryCvLine {
  itemId: string; // "role" for the lead line, else the floor item id
  section: CvSection;
  text: string;
}
/** #246 — a number and nothing else. The sentence around it names no job family, no place and no
 *  vocabulary, so the promise carries neither for a client to render. `family` went because "IT
 *  project delivery" is our internal label, not her word (spec #233 decision 8 / #228 decision 7),
 *  AND because for a word-search visitor it named the family she is INTERVIEWED on while her deck
 *  searched the words she typed — a count drawn from a different search than the deck that has to
 *  keep it. `city` went with #214's own decision that the promise names no place; it had been null
 *  on every code path since.
 *
 *  Not a claim that the label is off the wire entirely: `DiscoveryState.family` below still carries
 *  it on the same payload. No client reads it (#246 QA checked), so nothing leaks today, but it is
 *  a latent one — deleting it drags `resolvedCity`/`DiscoveryState.city` and their tests with it,
 *  which is a tidy-up of its own rather than this ticket's. */
export interface DiscoveryPromise {
  count: number;
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
  floor: readonly FloorItem[],
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
 *
 *  #184: `resolvedCity` — the ONE location signal, the visitor's confirmed search area RESOLVED to a
 *  display name (postingRetrieval.ts's resolveSearchArea; `null` when unset or uncovered) — replaces
 *  the old internal parseCity(role) guess. The caller (routes/onboarding.ts) resolves it once from
 *  session.intent.searchArea and passes it in; this function does no resolving of its own, same as it
 *  never did any of its own IO. Pure + deterministic → GET resumes.
 *
 *  #246: `openJobs` — how many adverts HER OWN search returned (preview.ts's
 *  retrievedPostingCount), passed in for the same reason `resolvedCity` is. It used to be counted
 *  here, off the fixture pool, for the family the INTERVIEW asks about; for a word-search visitor
 *  that is not the family her deck searches, so the promise stated a count the deck could never
 *  keep. `null` means we could not look — the promise falls silent rather than guessing. */
export function discoveryState(
  role: string | null,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  rejected: ClaimRecord[] = [],
  resolvedCity: string | null = null,
  family: DiscoveryFamily | null = null,
  openJobs: number | null = null,
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

  const city = resolvedCity;
  const floor = family?.items ?? [];
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
    family: family?.label ?? null,
    city,
    // #246: no longer gated on a family — a visitor the product cannot name yet has a real search
    // and a real count, and gets the same sentence as everyone. A zero is not shown: silence is
    // honest, "0 new jobs are open right now" on question 1 is a verdict on a search she has not
    // finished describing (design §4c already drops the line rather than print a broken one).
    promise: openJobs !== null && openJobs > 0 ? { count: openJobs } : null,
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

/** #324: a typed non-answer ("I don't know", "not sure", "n/a", "idk", the Skip button's "Not sure")
 *  — it closes the question but is never a fact about the person. Whole-answer match only: "Not sure
 *  which, but the CFO and IT" asserts something and is conserved like any other answer. */
export const NON_ANSWER = /^(?:(?:i )?(?:do ?n[o']?t|dont) (?:know|remember|recall)|(?:i have )?no (?:idea|clue)|idk|dunno|(?:i'?m )?(?:not sure|unsure)(?: yet)?|n\.?\/?a\.?|not applicable|none|nothing|skip|pass|\?+|-+)$/;
export function isNonAnswer(answer: string): boolean {
  return NON_ANSWER.test(answer.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/[.!]+$/, "").replace(/\s+/g, " "));
}

/** #324: the one write path for a discovery answer. A non-answer is recorded REJECTED (#35's shape:
 *  closes the question, no CV line, no factCount, never confirmed) — so it also retracts a fact
 *  when someone corrects an earlier answer to "not sure". A bare "no" is a negative; else a fact.
 *  The skip lands as a negative first, so a failed reject leaves a "no", never a fact. */
export async function recordDiscoveryAnswer(
  claims: Pick<ClaimStore, "add" | "answerNegative" | "reject">,
  sessionId: string,
  claim: CandidateClaim,
  answer: string,
): Promise<void> {
  if (isNoAnswer(answer)) return claims.answerNegative(sessionId, claim);
  if (!isNonAnswer(answer)) return claims.add(sessionId, claim);
  await claims.answerNegative(sessionId, claim);
  await claims.reject(sessionId, claim.id);
}
