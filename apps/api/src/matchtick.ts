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

const IRREGULAR_ROOT: Record<string, string> = {
  drove: "drive",
  held: "hold",
  led: "lead",
};

/** Cheap inflection folding so "managed"/"manage" and "risks"/"risk" count as the same evidence.
 *  This is deliberately not a synonym table: the instant scorer stays explainable and domain-free. */
function tokenRoot(token: string): string {
  let root = IRREGULAR_ROOT[token] ?? token;
  if (root.endsWith("ies") && root.length > 5) root = `${root.slice(0, -3)}y`;
  else if (root.endsWith("ing") && root.length > 6) root = root.slice(0, -3);
  else if (root.endsWith("ed") && root.length > 5) root = root.slice(0, -2);
  else if (root.endsWith("s") && root.length > 4) root = root.slice(0, -1);
  if (root.endsWith("e") && root.length > 4) root = root.slice(0, -1);
  return root;
}

/** Lowercase word tokens, length > 2, common function words stripped — the same shape as
 *  matchPosting's targetWords, reused here for requirement/fact sentences instead of titles. */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      .map(tokenRoot),
  );
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/** Band weights for the instant tick — "must" counts 3x a "nice", "should" 2x. Fixed, not
 *  learned: the whole tick is a cheap stand-in for E5's real scoring (S3/JC-31). Exported: #23's
 *  ledger derivation needs the same weights to compute each answer's "+N%" share. */
export const BAND_WEIGHT: Record<AdRequirement["band"], number> = { must: 3, should: 2, nice: 1 };
export interface MatchBreakdown {
  essential: { met: number; total: number };
  desirable: { met: number; total: number };
}

/** Keep each fact's evidence separate: unrelated lines must not pool stray words inside one idea.
 *  Adding a fact only appends a candidate fit, preserving monotonicity. */
function factTokenSets(facts: ScoredFact[]): Set<string>[] {
  return facts.map((fact) => tokenize(fact.text));
}

/** Punctuation and explicit conjunctions mark independently supportable ideas. Prepositional
 *  phrases stay attached to their governing idea instead of becoming cheap one-token clauses. */
function requirementClauses(requirement: string): Set<string>[] {
  const clauses = requirement
    .split(/\s*(?:[,;:]|\s(?:and|or)\s)\s*/i)
    .map(tokenize)
    .filter((tokens) => tokens.size > 0);
  return clauses.length > 0 ? clauses : [tokenize(requirement)];
}

/** One clause is decided by one fact. Half its meaningful terms is a full cheap-token hit. */
function bestClauseFit(clauseTokens: Set<string>, facts: Set<string>[]): number {
  return facts.reduce(
    (best, factTokens) =>
      Math.max(
        best,
        Math.min(1, (overlapCount(clauseTokens, factTokens) / clauseTokens.size) * 2),
      ),
    0,
  );
}

/** Clause fits combine by meaningful-token weight; different clauses may use different facts. */
function requirementFit(requirement: AdRequirement, facts: Set<string>[]): number {
  const clauses = requirementClauses(requirement.requirement);
  const totalTokens = clauses.reduce((sum, tokens) => sum + tokens.size, 0);
  const weightedFit = clauses.reduce(
    (sum, tokens) => sum + bestClauseFit(tokens, facts) * tokens.size,
    0,
  );
  return totalTokens === 0 ? 0 : weightedFit / totalTokens;
}

export function matchBreakdown(
  confirmedFacts: ScoredFact[],
  adRequirements: AdRequirements,
): MatchBreakdown {
  const facts = factTokenSets(confirmedFacts);
  const breakdown: MatchBreakdown = {
    essential: { met: 0, total: 0 },
    desirable: { met: 0, total: 0 },
  };
  for (const requirement of adRequirements.requirements) {
    const band = requirement.band === "must" ? breakdown.essential : breakdown.desirable;
    band.total += 1;
    if (requirementFit(requirement, facts) === 1) band.met += 1;
  }
  return breakdown;
}

/** Independent relevant-evidence breadth at ad level. Facts are identified only by the normalized
 *  tokens they share with this ad, so irrelevant filler cannot manufacture breadth. Each distinct
 *  relevant signature contributes only its strongest single-fact requirement fit; facts never pool
 *  to close a clause. The ad-size denominator makes the bonus diminish naturally. */
function evidenceBreadth(facts: Set<string>[], requirements: AdRequirement[]): number {
  const relevantTokens = new Set(
    requirements.flatMap((requirement) =>
      requirementClauses(requirement.requirement).flatMap((clause) => [...clause]),
    ),
  );
  const uniqueFacts = new Map<string, Set<string>>();
  for (const fact of facts) {
    const relevantSignature = [...fact]
      .filter((token) => relevantTokens.has(token))
      .sort()
      .join(" ");
    if (relevantSignature) uniqueFacts.set(relevantSignature, fact);
  }
  const support = [...uniqueFacts.values()].reduce(
    (sum, fact) =>
      sum +
      requirements.reduce(
        (best, requirement) => Math.max(best, requirementFit(requirement, [fact])),
        0,
      ),
    0,
  );
  return support === 0 ? 0 : support / (support + requirements.length);
}

/** Compatibility seam for one coherent evidence set. Production scoring instead selects the best
 *  individual confirmed fact independently for each non-trivial clause. */
export function requirementCovered(requirement: AdRequirement, factTokens: Set<string>): boolean {
  return requirementFit(requirement, [factTokens]) === 1;
}

/**
 * The instant match tick (#19): a deterministic, IO-free 0..100 score against an ad's ranked,
 * band-weighted requirements.
 *
 * Fit heuristic: split each requirement at textual idea boundaries. Each clause takes its strongest
 * individual fact; clause fits combine by meaningful-token weight, then the requirement takes its
 * band weight. A diminishing ad-level breadth term rewards distinct relevant facts without changing
 * clause closure. Facts never pool tokens within a clause, and an open requirement caps the score
 * below 100.
 *
 * Conservative by construction: adding a confirmed fact can only preserve or improve each clause's
 * best fit, so the score is monotonic non-decreasing in the fact set.
 */
export function matchTick(confirmedFacts: ScoredFact[], adRequirements: AdRequirements): number {
  const facts = factTokenSets(confirmedFacts);
  let total = 0;
  let fit = 0;
  const requirementFits: number[] = [];
  for (const req of adRequirements.requirements) {
    const weight = BAND_WEIGHT[req.band];
    const reqFit = requirementFit(req, facts);
    total += weight;
    fit += weight * reqFit;
    requirementFits.push(reqFit);
  }
  if (total === 0) return 0;
  const baseFit = fit / total;
  const breadth = evidenceBreadth(facts, adRequirements.requirements);
  const score = Math.round((baseFit + (1 - baseFit) * breadth) * 100);
  return requirementFits.every((reqFit) => reqFit === 1) ? score : Math.min(99, score);
}

/** The ad's requirements not fully covered by confirmed evidence, in the ad's rank order —
 *  the card's "Where you don't — yet" list. */
export function uncoveredRequirements(
  confirmedFacts: ScoredFact[],
  adRequirements: AdRequirements,
): AdRequirement[] {
  const facts = factTokenSets(confirmedFacts);
  return adRequirements.requirements.filter(
    (requirement) => requirementFit(requirement, facts) < 1,
  );
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

// Exported (not just used below): #23's tailor assembly reuses this exact fallback when it recomputes
// the bubble's open clause over a negative-filtered dontYet — see routes/onboarding.ts D1.
export const NOTHING_OPEN_CLAUSE = "You're covering everything we can see so far.";

/** The biggest open gap — the top-ranked uncovered requirement's own text — the "open" half of
 *  the card's bubble. */
export function pickOpenClause(confirmedFacts: ScoredFact[], adRequirements: AdRequirements): string {
  const [top] = uncoveredRequirements(confirmedFacts, adRequirements);
  return top?.requirement ?? NOTHING_OPEN_CLAUSE;
}
