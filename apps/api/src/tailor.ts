// #23 tailor (screen 3) — the pure, unit-testable primitives: the claim id scheme, the question
// template, the composed CV line, and the ledger derivation. Same split as discovery.ts: this module
// holds pure helpers; the route (routes/onboarding.ts, alongside buildJobCard) does the I/O and
// assembles these into TailorState.
import type { AdRequirementV1, AdRequirementsV1 } from "@jobcrush/contracts";
import type { ClaimRecord } from "./claims.js";
import { BAND_WEIGHT, uncoveredRequirements } from "./matchtick.js";
import { freeTextLine, type DiscoveryCvLine } from "./discovery.js";

export interface TailorQuestion {
  requirementId: string;
  question: string;
  options: string[];
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

const isBareYes = (answer: string) => /^yes[.!]?$/i.test(answer.trim());

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
): boolean => {
  const id = tailorClaimId(adId, reqId);
  return confirmed.some((c) => c.id === id) || negatives.some((c) => c.id === id);
};

/** The ad's ranked requirements, minus any this session already answered (yes or no) — #13's
 *  never-re-ask rule. A requirement stays a question until it's BOTH uncovered and unanswered; a "no"
 *  leaves it uncovered forever but excluded here, so it never resurfaces (only a correction reopens
 *  it, same as discovery). Empty ⇒ the ending (TailorState.done). */
export function tailorQuestions(
  adReq: AdRequirementsV1,
  confirmed: ClaimRecord[],
  negatives: ClaimRecord[],
): TailorQuestion[] {
  return uncoveredRequirements(confirmed, adReq)
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
    const claim = confirmed.find((c) => c.id === tailorClaimId(adReq.adId, req.id));
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
    const req = adReq.requirements.find((r) => tailorClaimId(adReq.adId, r.id) === claim.id);
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
    const isPositive = confirmed.some((c) => c.id === id);
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
