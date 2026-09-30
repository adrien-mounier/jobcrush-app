// #23 tailor (screen 3) — the pure, unit-testable primitives: the claim id scheme, the question
// template, the composed CV line, and the ledger derivation. Same split as discovery.ts: this module
// holds pure helpers; the route (routes/onboarding.ts, alongside buildJobCard) does the I/O and
// assembles these into TailorState.
import type { AdRequirementV1, AdRequirementsV1, CandidateClaim } from "@jobcrush/contracts";
import type { ClaimRecord } from "./claims.js";
import { anyClauseAsked, BAND_WEIGHT, phraseStated, textTokens, uncoveredRequirements } from "./matchtick.js";
import { excludingEligibility } from "./eligibilityDiscovery.js";
import { freeTextLine, type DiscoveryCvLine } from "./discovery.js";

export interface TailorQuestion {
  requirementId: string;
  question: string;
  options: string[];
  /** #307: present on a PROFILE-LEVEL question (tailorProfile.ts) — the client posts those to
   *  /onboarding/tailor/profile-answer, and the answer becomes a permanent profile fact. Absent on
   *  every advert-requirement question, whose shape is unchanged. */
  kind?: "profile";
  /** #307 AC6: the said-before-answering line ("I'll remember this for every job in Hong Kong."). */
  remember?: string;
  /** #307: the market a profile answer is a fact about — display name, for the after-line. */
  market?: string;
  /** #308: present on a profile question — the skip's label ("Not sure yet" / "Not now"). Posted
   *  as an answer it stores nothing, and the question returns on the next job that raises it. */
  skip?: string;
  /** #308: the language ladder's own lines, present on a language profile question only — why THIS
   *  advert asks (its own requirement, quoted) and what answering costs, both shown BEFORE the
   *  rungs (#125 decision 4). */
  why?: string;
  consequence?: string;
}
export interface LedgerLine {
  requirementId: string;
  text: string;
}

// A tailor answer is persisted under this deterministic id, scoped by ad — never-re-ask and the
// ledger/closedGaps derivation all key off (adId, requirementId) alone. The E5 stub's adIds carry
// underscores ("2026-07-05_manulife_…"), which CandidateClaim.id's kebab-case regex forbids, so slug
// it (same idea as grill.ts's local `slug`, one level up: here it's the id-scheme, not gap detection).
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const tailorClaimId = (adId: string, requirementId: string): string =>
  `tailor-${slug(adId)}-${requirementId}`;
export const isTailorClaimId = (claimId: string): boolean => claimId.startsWith("tailor-");

const isBareYes = (answer: string) => /^yes[.!]?$/i.test(answer.trim());

// --- #311 (#287 c6-c10): the "Changed? Add it" door -------------------------------------------
//
// A denied capability's row carries a door back into the existing answer path. Answering it never
// touches the stored "No" (the record keeps its original date); it adds a NEW claim under its own
// id, dated by asking him when — never by stamping the day he told us (#287 c10).

/** The coarse date choices. Asked, never stamped: "since September 2026" over a capability held
 *  since 2024 makes a true line read weaker than it is (cv-authoring-rules.md's "never infer a
 *  month", applied to an asked fact).
 *  ⚠️ These strings are also the WIRE PROTOCOL: the server offers them on the door and recognises
 *  them back on /tailor/answer (growSinceYear), so a copy change here stays consistent end to end —
 *  but the web e2e fixtures hardcode them and must move with it. */
export const GROW_SINCE_OPTIONS = ["This year", "1-2 years ago", "3 or more years ago"] as const;

/** The year the grown line prints, from the tapped choice — the CONSERVATIVE bound of what he said
 *  ("1-2 years ago" prints last year: he claimed at least that, never more). Null for anything that
 *  is not a door answer, which is how the route tells a grow from an ordinary yes/no. */
export function growSinceYear(answer: string, now = new Date()): number | null {
  const year = now.getFullYear();
  switch (answer.trim()) {
    case GROW_SINCE_OPTIONS[0]:
      return year;
    case GROW_SINCE_OPTIONS[1]:
      return year - 1;
    case GROW_SINCE_OPTIONS[2]:
      return year - 3;
    default:
      return null;
  }
}

/** The grown fact's own id — NEVER tailorClaimId: writing under the denial's id would upsert the
 *  "No" away, and the record would claim he always had it (#287 c9). The mistap flip through
 *  /tailor/answer's plain yes/no path still overwrites; the two stay distinguishable events. */
export const grownTailorClaimId = (adId: string, requirementId: string): string =>
  `${tailorClaimId(adId, requirementId)}-grew`;

/** Is this claim an answer to (adId, requirementId) — plain or grown? The one place both id shapes
 *  are known, so no reader has to remember the grown id exists. */
const isAnswerClaimId = (claimId: string, adId: string, requirementId: string): boolean =>
  claimId === tailorClaimId(adId, requirementId) || claimId === grownTailorClaimId(adId, requirementId);

/** One user-answered tailor claim, fully shaped — the route's two write branches (plain answer,
 *  grow) differ only in id and text, and the claim composition belongs here, not in the route. */
export function userAnswerClaim(id: string, text: string, sourceQuote: string): CandidateClaim {
  return {
    id,
    semantic_key: id,
    field_key: null,
    field_value: null,
    field_label: null,
    role: "profile",
    text,
    machine_touch: "verbatim", // the visitor's own answer — the tap is the warrant
    classification: "Verified", // user-authored, they vouch for it
    source_quote: sourceQuote.slice(0, 200),
    needs_grill: false,
    grill_hint: null,
  };
}

/** The dated CV line a grow lands: the requirement restated (the tap is the warrant, same as a bare
 *  "Yes") plus the asked date — a recently acquired skill reads as someone still learning (#287 c9). */
export function composeGrownLine(requirement: AdRequirementV1, sinceYear: number): string {
  return freeTextLine(`${requirement.requirement} (since ${sinceYear})`);
}

/** A denial's own words: the stored claim text minus the answer scaffolding — for a tailor "No"
 *  that is exactly the requirement's own words. */
export const deniedWords = (claimText: string): string => claimText.replace(/^Not applicable — /, "");

/** The live denials: eligibility declines out (a decline is a refusal, not a denial — it never
 *  names a gap), superseded denials out (a confirmed fact — a grow included — states the denial's
 *  own words, so he now claims the capability and it is no longer a gap ANYWHERE). Both callers
 *  below share this filter so the card, the doors, and the page's never-print list can never
 *  disagree on what counts as denied. */
function liveDenials(
  negatives: ClaimRecord[],
  confirmed: ClaimRecord[],
): { claim: ClaimRecord; words: string }[] {
  const confirmedTokens = confirmed.map((c) => textTokens(c.text));
  return excludingEligibility(negatives)
    .map((claim) => ({ claim, words: deniedWords(claim.text) }))
    .filter(({ words }) => !confirmedTokens.some((tokens) => phraseStated(words, tokens)));
}

/** #311 (#287 c4): the denials THIS advert actually asks about, and only while the ask is still
 *  open. Everything the card names a denial for — and every door — comes from this one mapping, so
 *  the row and its door can never disagree.
 *    - this ad's own tailor "No"s match by claim id;
 *    - every other denial (discovery, another ad's tailor answer) matches by words: a requirement
 *      clause the denial's words would have covered had the answer been yes (#287 c2's ceiling:
 *      words, never paraphrase — a differently-worded ask goes unnamed, stated not papered over);
 *    - only UNCOVERED requirements count: once a confirmed fact (a grow included) covers the ask,
 *      the row leaves this list and the fact prints on its own merit in `fit`. */
export function advertDeniedRows(
  adReq: AdRequirementsV1,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
): { claim: ClaimRecord; requirement: AdRequirementV1 }[] {
  const open = uncoveredRequirements(confirmed, adReq);
  return liveDenials(negatives, confirmed).flatMap(({ claim, words }) => {
    const tokens = textTokens(words);
    const requirement = open.find(
      (r) => claim.id === tailorClaimId(adReq.adId, r.id) || anyClauseAsked(r.requirement, tokens),
    );
    return requirement ? [{ claim, requirement }] : [];
  });
}

/** One "Changed? Add it" door — TailorState carries one per named denial. It rides WITH the
 *  questions, before the draft is written (#287 c8): the client renders it through the same
 *  question dock and posts the tapped choice to the same /tailor/answer door every other
 *  requirement answer takes. */
export interface GrowDoor {
  /** The askedClosed row this door sits on — the denial claim's own id. */
  claimId: string;
  requirementId: string;
  question: string;
  options: string[];
}

export function growDoors(
  adReq: AdRequirementsV1,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
): GrowDoor[] {
  return advertDeniedRows(adReq, confirmed, negatives).map(({ claim, requirement }) => {
    const denied = deniedWords(claim.text);
    // #311 QA gate defect 1 (second half): a word-matched row must never claim he denied THIS
    // requirement — he denied something LIKE it, in his own words, and the question quotes those
    // words so nothing is ever put in his mouth. Answering still grows the requirement shown (the
    // dated line he is looking at IS what a tap vouches for — the machine never adds silently).
    const saidNo =
      denied === requirement.requirement
        ? "You told me you don't have this."
        : `You said no to: "${/[.!?]$/.test(denied) ? denied : `${denied}.`}"`;
    return {
      claimId: claim.id,
      requirementId: requirement.id,
      question: `This job wants: "${requirement.requirement}." ${saidNo} Changed? Since when?`,
      options: [...GROW_SINCE_OPTIONS],
    };
  });
}

/** #311 (#287 c1/c2): every denial whose words the finished page must not state — the page check's
 *  input and the draft prompt's never-print list. A denial fully covered by a confirmed claim's own
 *  words is superseded (he grew, or he vouched for the capability elsewhere) and drops out: the
 *  confirmed fact outranks the old "No" and prints on its own merit. */
export function deniedCapabilities(negatives: ClaimRecord[], confirmed: ClaimRecord[]): string[] {
  return liveDenials(negatives, confirmed).map(({ words }) => words);
}

/** A cheap, deterministic CV line from a tailor answer — same "instant, unpolished, audited later"
 *  contract as discovery.ts's composeCvLine. A tapped "Yes" restates the requirement itself as a CV
 *  bullet (the tap IS the warrant) — NOT first-person: a bullet reads like discovery's own lines
 *  ("Managed a €2M budget across 4 teams"), never "I …" (D3: "I experience driving digital
 *  transformation initiatives" read as broken English). This guarantees the composed line shares the
 *  requirement's own words, so matchTick's token-overlap coverage check fires and the tick actually
 *  moves — the AC1 hinge. Free text is the visitor's own words, verbatim (freeTextLine) — it may or may
 *  not cover the requirement, same as any other free-text fact. */
export function composeTailorLine(requirement: AdRequirementV1, answer: string): string {
  return freeTextLine(isBareYes(answer) ? requirement.requirement : answer);
}

/** The next question over an ad requirement — deterministic template, tap-first (prior art: grill.ts's
 *  templateQuestion). No LLM call: E5 owns real phrasing (spec §Out of Scope). */
export function tailorQuestion(req: AdRequirementV1): TailorQuestion {
  return {
    requirementId: req.id,
    question: `This job wants: "${req.requirement}." Does that describe you?`,
    options: ["Yes", "No"],
  };
}

const answered = (
  adId: string,
  reqId: string,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
): boolean =>
  // #311: a grown fact is an answer too (isAnswerClaimId) — without it, a judge that still reads
  // the requirement as uncovered would re-ask a question the door just closed.
  confirmed.some((c) => isAnswerClaimId(c.id, adId, reqId)) ||
  negatives.some((c) => c.id === tailorClaimId(adId, reqId));

/** The ad's ranked requirements, minus any this session already answered (yes or no) — #13's
 *  never-re-ask rule. A requirement stays a question until it's BOTH uncovered and unanswered; a "no"
 *  leaves it uncovered forever but excluded here, so it never resurfaces (only a correction reopens
 *  it, same as discovery). Empty ⇒ the ending (TailorState.done).
 *
 *  `uncovered` defaults to the deterministic tick's own uncoveredRequirements (every pre-#105 caller,
 *  unchanged) — #105 decision 1: when a judgement is available, routes/onboarding.ts passes
 *  judgedScore.ts's judgedUncoveredRequirements instead, so a requirement the judge already considers
 *  fully met is never re-asked as a tailor question just because the token-overlap tick alone
 *  wouldn't have covered it. */
export function tailorQuestions(
  adReq: AdRequirementsV1,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
  uncovered: AdRequirementV1[] = uncoveredRequirements(confirmed, adReq),
): TailorQuestion[] {
  return uncovered
    .filter((req) => !answered(adReq.adId, req.id, confirmed, negatives))
    .map(tailorQuestion);
}

/** B2: this ad's tailor-confirmed answers, as CV lines — without this, an answer that raises the score
 *  never reaches "the CV below" (ticket #23's own framing) or survives "I'm done — use this CV".
 *  cvSection comes from the requirement's own AdRequirementV1.cvSection (the E5 contract makes it
 *  optional for the handful of requirements that don't carry one; falls back to "experience", the
 *  overwhelmingly common case in the stub — see sample-ad-requirements.json). */
export function tailorCvLines(adReq: AdRequirementsV1, confirmed: ClaimRecord[]): DiscoveryCvLine[] {
  return adReq.requirements.flatMap((req) => {
    // #311: a grown fact (the door's dated claim) is this requirement's CV line exactly as a plain
    // answer is — "the line appears in the CV beside her" (#287 c7).
    const claim = confirmed.find((c) => isAnswerClaimId(c.id, adReq.adId, req.id));
    return claim ? [{ itemId: claim.id, section: req.cvSection ?? "experience", text: claim.text }] : [];
  });
}

/** Requirement ids this session has recorded a "no" against, for this ad — #23 B1: a "no" closes the
 *  GAP too (spec #37/#38, "the open list only ever shrinks"), not just the question. uncoveredRequirements
 *  (shared with #19's card deck via buildJobCard) has no negative-awareness by design — it only knows
 *  the ad/coverage relationship — so tailor subtracts this set on top, in its own assembly and ledger,
 *  rather than changing the shared primitive (#19's deck payload must stay byte-identical). */
export function negativeRequirementIds(adReq: AdRequirementsV1, negatives: ClaimRecord[]): Set<string> {
  const negativeClaimIds = new Set(negatives.map((c) => c.id));
  return new Set(
    adReq.requirements.filter((r) => negativeClaimIds.has(tailorClaimId(adReq.adId, r.id))).map((r) => r.id),
  );
}

/** One ledger line per requirement this session has answered for this ad, in the ad's rank order, plus
 *  the closedGaps tally — one pass so both stay in lock-step (never re-derive one from the other's
 *  rendered text). Derived, never stored: reload-stable and order-free because it's a pure function of
 *  (this ad, this session's claims) — #28 keeps this true while fixing the count each line reports.
 *   - a positive answer that now covers its requirement -> "+N% · <requirement>", N = that
 *     requirement's band-weight share of the ad's total weight.
 *   - a negative, or a positive that still doesn't cover it -> "asked and closed · <k> still open",
 *     k = the number still open the instant THAT answer landed (#28) — not today's count. Rebuilding
 *     the ledger later (a reload, or a further answer) must never re-stamp an already-answered line
 *     with a smaller number just because more has closed since.
 *  closedGaps counts "asked" as every requirement with a ledger line, "closed" as the "+N%" ones only
 *  — a "no" closes the QUESTION (never re-asked) but not the GAP (still uncovered), so the ending's
 *  "closed 2 of 3" can be less than "asked 3". */
export function buildTailorLedger(
  adReq: AdRequirementsV1,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
): { ledger: LedgerLine[]; closedGaps: { asked: number; closed: number } } {
  const totalWeight = adReq.requirements.reduce((sum, r) => sum + BAND_WEIGHT[r.band], 0);
  const uncovered = uncoveredRequirements(confirmed, adReq);
  const uncoveredIds = new Set(uncovered.map((r) => r.id));

  // #37: replay confirmed + negatives as ONE merged decision order (`decisionSeq`, with `seq` as the
  // fallback for older hand-built fixtures), recomputing coverage
  // one claim at a time so each of THIS ad's requirements gets the open count at the moment it landed,
  // not the final one. B1 still holds at each step: subtract negativeRequirementIds on top of plain
  // coverage, same as the final-state check below.
  // ponytail: O(n²) — recomputes uncoveredRequirements from scratch per answer; the replay walks
  // EVERY confirmed+negative claim in the session (mined, deck, discovery, other ads' tailor answers),
  // not just this ad's requirements, so its depth is confirmed.length + negatives.length. Fine at a
  // CV's claim-count scale (tens), revisit (incremental coverage instead of a full recompute per step)
  // if that ever grows into the hundreds.
  const answerOrder = (claim: ClaimRecord): number => claim.decisionSeq ?? claim.seq ?? 0;
  const answeredInOrder = [
    ...confirmed.map((claim) => ({ claim, isNegative: false as const })),
    ...negatives.map((claim) => ({ claim, isNegative: true as const })),
  ].sort((a, b) => answerOrder(a.claim) - answerOrder(b.claim) || (a.claim.seq ?? 0) - (b.claim.seq ?? 0));
  const openCountAtAnswerTime = new Map<string, number>();
  const confirmedSoFar: ClaimRecord[] = [];
  const negativesSoFar: ClaimRecord[] = [];
  for (const { claim, isNegative } of answeredInOrder) {
    if (isNegative) negativesSoFar.push(claim);
    else confirmedSoFar.push(claim);
    const req = adReq.requirements.find((r) => isAnswerClaimId(claim.id, adReq.adId, r.id));
    if (!req) continue; // not this ad's requirement (a discovery claim, or another ad's tailor claim)
    const uncoveredSoFar = uncoveredRequirements(confirmedSoFar, adReq);
    const negIdsSoFar = negativeRequirementIds(adReq, negativesSoFar);
    openCountAtAnswerTime.set(req.id, uncoveredSoFar.filter((r) => !negIdsSoFar.has(r.id)).length);
  }

  const ledger: LedgerLine[] = [];
  let asked = 0;
  let closed = 0;
  for (const req of adReq.requirements) {
    const id = tailorClaimId(adReq.adId, req.id);
    const isNegative = negatives.some((c) => c.id === id);
    // #311: a grown fact is a positive answer (isAnswerClaimId) — the requirement it covers earns
    // its "+N%" line even though the old "No" is (deliberately) still on the record beside it.
    const isPositive = confirmed.some((c) => isAnswerClaimId(c.id, adReq.adId, req.id));
    if (!isNegative && !isPositive) continue; // never answered — no ledger line
    asked++;
    if (isPositive && !uncoveredIds.has(req.id)) {
      closed++;
      // ponytail: each line's % is rounded independently, so the ledger's shares won't sum exactly
      // to card.matchPct (computed once over the whole weighted set) — a display-only rounding
      // ceiling, not a scoring bug.
      const pct = Math.round((BAND_WEIGHT[req.band] / totalWeight) * 100);
      ledger.push({ requirementId: req.id, text: `+${pct}% · ${req.requirement}` });
    } else {
      // Never undefined: isNegative/isPositive above already proved this req.id has a matching claim
      // in `negatives` or `confirmed`, so the replay above set this entry on that claim's own step.
      // A silent `?? 0` fallback here would be worse than a crash — "0 still open" reads as "nothing
      // left", the most misleading possible value for a line that failed to compute one.
      const openCount = openCountAtAnswerTime.get(req.id)!;
      ledger.push({ requirementId: req.id, text: `asked and closed · ${openCount} still open` });
    }
  }
  return { ledger, closedGaps: { asked, closed } };
}
