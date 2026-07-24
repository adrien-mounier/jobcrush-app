// #19 the reveal + the job card (screen 2a) — the instant match tick: a deterministic, IO-free
// score against an ad's ranked requirements (e5stub.ts's AdRequirements). Prior art: preview.ts's
// matchPosting (title/keyword token overlap, no LLM). The E5 boundary is the pinned fixture; this
// file is pure arithmetic over it, so it needs no store, no network, no LLM.
import type { AdRequirement, AdRequirements } from "@jobcrush/contracts";

/** Anything with CV-line-shaped text — a confirmed claim, a negative claim, or a plain fixture in
 *  tests. Deliberately looser than ClaimRecord: matchTick only ever reads `.text`. */
export interface ScoredFact {
  text: string;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "your", "you", "are", "our",
  "all", "has", "have", "will", "across", "through", "of", "to", "in", "on", "a", "an", "is",
  "or", "as", "at", "by", "be", "not",
]);

/** Lowercase word tokens, length > 2, common function words stripped — the same shape as
 *  matchPosting's targetWords, reused here for requirement/fact sentences instead of titles. */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/** Band weights for the instant tick — "must" counts 3x a "nice", "should" 2x. Fixed, not
 *  learned: the whole tick is a cheap stand-in for E5's real scoring (S3/JC-31). */
const BAND_WEIGHT: Record<AdRequirement["band"], number> = { must: 3, should: 2, nice: 1 };

/** The union of every fact's tokens. Union-based on purpose: it only ever grows as facts are
 *  added, which is exactly what makes matchTick's carried-risk property (never decreases) hold. */
function factTokenSet(facts: ScoredFact[]): Set<string> {
  return tokenize(facts.map((f) => f.text).join(" "));
}

/** True once the union of confirmed-fact tokens sufficiently overlaps the requirement's tokens.
 *  Short requirements (< 2 meaningful tokens) need only 1 hit; longer ones need 2, so a single
 *  stray shared word ("project") never claims coverage of a whole multi-clause requirement. */
export function requirementCovered(requirement: AdRequirement, factTokens: Set<string>): boolean {
  const reqTokens = tokenize(requirement.requirement);
  const threshold = Math.min(2, reqTokens.size || 1);
  return overlapCount(reqTokens, factTokens) >= threshold;
}

/**
 * The instant match tick (#19): a deterministic, IO-free 0..100 score against an ad's ranked,
 * band-weighted requirements.
 *
 * Coverage heuristic: band-weighted token overlap. A requirement counts as "covered" once the
 * union of all confirmed facts' words shares enough meaningful tokens with it (requirementCovered
 * above); the score is the covered requirements' weight share of the ad's total weight.
 *
 * Conservative by construction: adding a confirmed fact only grows the token union, so a covered
 * requirement can never become uncovered again — the score is monotonic non-decreasing in the
 * fact set, which is the property the unit seam pins.
 */
export function matchTick(confirmedFacts: ScoredFact[], adRequirements: AdRequirements): number {
  const factTokens = factTokenSet(confirmedFacts);
  let total = 0;
  let covered = 0;
  for (const req of adRequirements.requirements) {
    const weight = BAND_WEIGHT[req.band];
    total += weight;
    if (requirementCovered(req, factTokens)) covered += weight;
  }
  return total === 0 ? 0 : Math.round((covered / total) * 100);
}

/** The ad's requirements not covered by any confirmed fact, in the ad's own rank (array) order —
 *  the card's "Where you don't — yet" list. */
export function uncoveredRequirements(
  confirmedFacts: ScoredFact[],
  adRequirements: AdRequirements,
): AdRequirement[] {
  const factTokens = factTokenSet(confirmedFacts);
  return adRequirements.requirements.filter((r) => !requirementCovered(r, factTokens));
}

/** The strongest single fact toward the ad's top "must" requirement (falls back to the top-ranked
 *  fact, then a generic line) — the deterministic, cheap "hit" half of the card's bubble. Clause
 *  *generation* is E5/S3 scope; picking among facts the visitor already gave is not. */
export function pickHitClause(confirmedFacts: ScoredFact[], adRequirements: AdRequirements): string {
  const topMust = adRequirements.requirements.find((r) => r.band === "must");
  if (topMust) {
    const reqTokens = tokenize(topMust.requirement);
    const match = confirmedFacts.find((f) => overlapCount(tokenize(f.text), reqTokens) > 0);
    if (match) return match.text;
  }
  return confirmedFacts[0]?.text ?? "Let's find your strongest fit.";
}

/** The biggest open gap — the top-ranked uncovered requirement's own text — the "open" half of
 *  the card's bubble. */
export function pickOpenClause(confirmedFacts: ScoredFact[], adRequirements: AdRequirements): string {
  const [top] = uncoveredRequirements(confirmedFacts, adRequirements);
  return top?.requirement ?? "You're covering everything we can see so far.";
}
