// JC-32 — server-side claim-graph build. The keystone of the S2 E4 spine: it turns the user's
// CONFIRMED candidate-claims (the deck's output) into a Contract-1 ClaimGraph that the frozen
// validate_graph.mjs oracle accepts. See docs/s2-kickoff.md.
//
// The caller passes ONLY confirmed claims — that is the mechanical enforcement of the product rule
// "the root CV renders only from confirmed facts" (spec §8-3). This transform never invents, drops,
// or reclassifies a claim: it maps 1:1 and fills the graph-only fields the deck doesn't carry
// (provenance label, a risk floor, renderable, confirmed_date). Conservation — every confirmed
// claim becomes exactly one node — is what keeps "tailor by emphasis, not amputation" true at the
// graph layer.
import type { CandidateClaim, ClaimGraph, ClaimNode } from "@jobcrush/contracts";

export interface BuildGraphOpts {
  /** Provenance label written to every node's source_file (the CV these claims came from). */
  source?: string;
  /** Header built_from_root_cv — the root-CV version this graph backs. */
  rootCvVersion?: string;
  /** Header graphVersion; bump on each rebuild. */
  graphVersion?: number;
  /** ISO YYYY-MM-DD stamped on every node; defaults to today (build == the confirmation moment). */
  confirmedDate?: string;
}

// Partially-Supported nodes MUST carry a risk (invariant 8). A claim the user confirmed in the deck
// is user-vouched, so it floors at Low. ponytail: flat per-class risk; enrich only if the audit ever
// needs a finer signal than "the user said yes".
const RISK_BY_CLASS: Record<CandidateClaim["classification"], ClaimNode["risk"]> = {
  Verified: null,
  Derived: null,
  "Partially-Supported": "Low",
};

// Every node needs a non-empty tag (schema: tags is a min-1 string[]). One kind tag lets the root-CV
// renderer bucket claims into sections without re-parsing. ponytail: single kind tag; richer semantic
// tagging (for S3 clustering) is a later pass.
function kindTag(claim: CandidateClaim): string {
  const prefix = claim.id.split("-", 1)[0];
  if (prefix === "cert" || prefix === "lang" || prefix === "skill" || prefix === "edu") return prefix;
  return claim.role === "profile" ? "profile" : "experience";
}

export function buildClaimGraph(claims: CandidateClaim[], opts: BuildGraphOpts = {}): ClaimGraph {
  const source = opts.source ?? "cv";
  const confirmed_date = opts.confirmedDate ?? new Date().toISOString().slice(0, 10);

  const nodes: ClaimNode[] = claims.map((c) => ({
    id: c.id,
    text: c.text,
    classification: c.classification, // Verified|Derived|Partially-Supported all pass straight through
    source_file: source, // provenance — required for every mineable class (invariant 7)
    source_quote: c.source_quote,
    inferred_from: null,
    tags: [kindTag(c)],
    risk: RISK_BY_CLASS[c.classification],
    renderable: true, // a confirmed positive fact renders in the root CV
    origin: "source", // CV-mined; deliberately-added enrichment stretches are a later (S3) origin
    narrative_ref: null,
    confirmed_date,
  }));

  return {
    schemaVersion: "1.0",
    graphVersion: opts.graphVersion ?? 1,
    built_from_root_cv: opts.rootCvVersion ?? "v1",
    built_at: confirmed_date,
    sources: [source],
    nodes,
  };
}
