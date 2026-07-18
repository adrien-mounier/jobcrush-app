// JC-31 — the S2 quality gate. Mechanical, never a judgment of the user's career (S2 decision 5):
// it certifies OUR pipeline's output, so a thin-but-honest profile passes. Two checks:
//   1. the built graph passes the ported Contract-1 validator (the ClaimGraph zod port is proven
//      ≡ validate_graph.mjs by the contracts golden test);
//   2. trace-to-confirmed — every rendered bullet traces to a graph node that is renderable AND was
//      confirmed by the user (the anti-fabrication gate, §8-3). Errors name the offending node so the
//      caller can loop back to one card/grill question rather than dead-end.
import { ClaimGraph } from "@jobcrush/contracts";
import type { ClaimTrace } from "./rootcv.js";

export interface GateResult {
  ok: boolean;
  errors: string[];
}

export function runGate(
  graph: ClaimGraph,
  trace: ClaimTrace,
  confirmedIds: Iterable<string>,
): GateResult {
  const errors: string[] = [];

  // (1) structural validity — the ported validator.
  const parsed = ClaimGraph.safeParse(graph);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`graph invalid: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
  }

  // (2) trace-to-confirmed: nothing rendered that isn't a confirmed, renderable graph node.
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const confirmed = new Set(confirmedIds);
  trace.entries.forEach((en, i) => {
    for (const id of en.nodeIds) {
      const node = byId.get(id);
      if (!node) {
        errors.push(`entry[${i}] "${en.bullet}": nodeId "${id}" not in graph`);
        continue;
      }
      if (node.renderable === false) {
        errors.push(
          `entry[${i}] "${en.bullet}": nodeId "${id}" is renderable=false (${node.classification}) — must never render`,
        );
      }
      if (!confirmed.has(id)) {
        errors.push(`entry[${i}] "${en.bullet}": nodeId "${id}" is not user-confirmed`);
      }
    }
  });

  return { ok: errors.length === 0, errors };
}
