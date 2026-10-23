// #23 tailor (screen 3) — the pure, unit-testable primitives: the claim id scheme and the denial
// mapping the card, the report and the draft's never-print list all read. Same split as discovery.ts:
// this module holds pure helpers; routes/tailor.ts does the I/O and deck.ts (buildTailorState)
// assembles these into TailorState.
//
// #415 (ADR-0020 clauses 1, 2, 6): the requirement yes/no queue, its answer route, the "+N%" ledger
// and the "Changed? Add it" door are gone — the Tailor step asks only the profile questions
// (tailorProfile.ts) and then writes the CV. The claims past answers stored stay as they are (no data
// step), which is why the id scheme and the denial readers below still understand them.
import type { AdRequirementV1, AdRequirementsV1 } from "@jobcrush/contracts";
import type { ClaimRecord } from "./claims.js";
import { anyClauseAsked, phraseStated, textTokens, uncoveredRequirements } from "./matchtick.js";
import { excludingEligibility } from "./eligibilityDiscovery.js";

// A tailor answer was persisted under this deterministic id, scoped by ad — the card's denial rows
// and the retrieval request's claim filter key off (adId, requirementId) alone. The E5 stub's adIds
// carry underscores ("2026-07-05_manulife_…"), which CandidateClaim.id's kebab-case regex forbids, so
// slug it (same idea as grill.ts's local `slug`, one level up: here it's the id-scheme, not gap detection).
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const tailorClaimId = (adId: string, requirementId: string): string =>
  `tailor-${slug(adId)}-${requirementId}`;
export const isTailorClaimId = (claimId: string): boolean => claimId.startsWith("tailor-");

/** A denial's own words: the stored claim text minus the answer scaffolding — for a tailor "No"
 *  that is exactly the requirement's own words. */
export const deniedWords = (claimText: string): string => claimText.replace(/^Not applicable — /, "");

/** The live denials: eligibility declines out (a decline is a refusal, not a denial — it never
 *  names a gap), superseded denials out (a confirmed fact states the denial's own words, so the
 *  person now claims the capability and it is no longer a gap ANYWHERE). Both callers below share
 *  this filter so the card, the list and the page's never-print list can never disagree on what
 *  counts as denied. */
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
 *  open. Everything the card names a denial for comes from this one mapping.
 *    - this ad's own tailor "No"s match by claim id;
 *    - every other denial (discovery, another ad's tailor answer) matches by words: a requirement
 *      clause the denial's words would have covered had the answer been yes (#287 c2's ceiling:
 *      words, never paraphrase — a differently-worded ask goes unnamed, stated not papered over);
 *    - only UNCOVERED requirements count: once a confirmed fact covers the ask, the row leaves this
 *      list and the fact prints on its own merit in `fit`. */
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

/** #311 (#287 c1/c2): every denial whose words the finished page must not state — the page check's
 *  input and the draft prompt's never-print list. A denial fully covered by a confirmed claim's own
 *  words is superseded (the person vouched for the capability elsewhere) and drops out: the
 *  confirmed fact outranks the old "No" and prints on its own merit. */
export function deniedCapabilities(negatives: ClaimRecord[], confirmed: ClaimRecord[]): string[] {
  return liveDenials(negatives, confirmed).map(({ words }) => words);
}

/** Requirement ids this session has recorded a "no" against, for this ad — #23 B1: a "no" closes the
 *  GAP too (spec #37/#38, "the open list only ever shrinks"). uncoveredRequirements (shared with #19's
 *  card deck via buildJobCard) has no negative-awareness by design — it only knows the ad/coverage
 *  relationship — so the card subtracts this set on top rather than changing the shared primitive. */
export function negativeRequirementIds(adReq: AdRequirementsV1, negatives: ClaimRecord[]): Set<string> {
  const negativeClaimIds = new Set(negatives.map((c) => c.id));
  return new Set(
    adReq.requirements.filter((r) => negativeClaimIds.has(tailorClaimId(adReq.adId, r.id))).map((r) => r.id),
  );
}
