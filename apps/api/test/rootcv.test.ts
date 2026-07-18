// JC-27 — the renderer emits a bullet per renderable node under its kind-tag section, with a trace
// pointing each bullet back to its node. A non-renderable (gap) node is never rendered (§8-3).
import { describe, expect, it } from "vitest";
import type { CandidateClaim, ClaimNode } from "@jobcrush/contracts";
import { buildClaimGraph } from "../src/graph.js";
import { renderRootCv } from "../src/rootcv.js";

const claim = (over: Partial<CandidateClaim>): CandidateClaim => ({
  id: "acme-led-migration",
  role: "Acme — PM",
  text: "Led the checkout replatform.",
  machine_touch: "verbatim",
  classification: "Verified",
  source_quote: "Led checkout replatform.",
  needs_grill: false,
  grill_hint: null,
  ...over,
});

const confirmed: CandidateClaim[] = [
  claim({ id: "acme-led-migration" }),
  claim({ id: "profile-stakeholder", role: "profile", text: "Stakeholder management." }),
  claim({ id: "cert-pmp-2021", role: "profile", text: "PMP, 2021." }),
];

describe("JC-27 renderRootCv", () => {
  it("renders one traced bullet per renderable node, bucketed by section", () => {
    const { markdown, trace } = renderRootCv(buildClaimGraph(confirmed));
    expect(markdown).toContain("## Professional Experience");
    expect(markdown).toContain("- Led the checkout replatform.");
    expect(markdown).toContain("## Certifications");
    // trace covers every renderable node 1:1, each bullet → exactly its own node
    expect(trace.entries).toHaveLength(confirmed.length);
    expect(trace.entries.every((e) => e.nodeIds.length === 1 && e.bullet.length > 0)).toBe(true);
    expect(new Set(trace.entries.flatMap((e) => e.nodeIds))).toEqual(
      new Set(confirmed.map((c) => c.id)),
    );
  });

  it("never renders a non-renderable (gap) node", () => {
    const graph = buildClaimGraph(confirmed);
    const gap: ClaimNode = {
      id: "gap-no-degree",
      text: "No formal degree.",
      classification: "Negative",
      source_file: "cv",
      source_quote: null,
      inferred_from: null,
      tags: ["profile"],
      risk: null,
      renderable: false,
      origin: "source",
      narrative_ref: null,
      confirmed_date: null,
    };
    graph.nodes.push(gap);
    const { markdown, trace } = renderRootCv(graph);
    expect(markdown).not.toContain("No formal degree.");
    expect(trace.entries.some((e) => e.nodeIds.includes("gap-no-degree"))).toBe(false);
  });
});
