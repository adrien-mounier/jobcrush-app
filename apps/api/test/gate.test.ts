// JC-31 — the gate passes a validator-clean graph whose rendered bullets all trace to confirmed
// nodes, and fails on (a) an unconfirmed rendered node, (b) a renderable=false node rendered,
// (c) a structurally invalid graph.
import { describe, expect, it } from "vitest";
import type { CandidateClaim, ClaimNode } from "@jobcrush/contracts";
import { buildClaimGraph } from "../src/graph.js";
import { renderRootCv, type ClaimTrace } from "../src/rootcv.js";
import { runGate } from "../src/gate.js";

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
  claim({ id: "cert-pmp-2021", role: "profile", text: "PMP, 2021." }),
];
const confirmedIds = confirmed.map((c) => c.id);

describe("JC-31 runGate", () => {
  it("passes when the built graph is valid and every bullet traces to a confirmed node", () => {
    const graph = buildClaimGraph(confirmed);
    const { trace } = renderRootCv(graph);
    expect(runGate(graph, trace, confirmedIds)).toEqual({ ok: true, errors: [] });
  });

  it("fails a bullet that traces to a node the user did not confirm", () => {
    const graph = buildClaimGraph(confirmed);
    const { trace } = renderRootCv(graph);
    const r = runGate(graph, trace, ["acme-led-migration"]); // cert-pmp not confirmed
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/cert-pmp-2021.*not user-confirmed/);
  });

  it("fails if a renderable=false node is ever rendered", () => {
    const graph = buildClaimGraph(confirmed);
    const gap: ClaimNode = {
      id: "gap-x",
      text: "No degree.",
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
    const trace: ClaimTrace = {
      graphVersion: graph.graphVersion,
      cvFile: "root-cv.md",
      entries: [{ bullet: "No degree.", section: "x", nodeIds: ["gap-x"], classifications: ["Negative"] }],
      gaps: [],
    };
    const r = runGate(graph, trace, [...confirmedIds, "gap-x"]);
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/renderable=false/);
  });

  it("fails a structurally invalid graph (duplicate node id)", () => {
    const graph = buildClaimGraph(confirmed);
    graph.nodes.push({ ...graph.nodes[0] }); // duplicate id
    const { trace } = renderRootCv(graph);
    const r = runGate(graph, trace, confirmedIds);
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/graph invalid/);
  });
});
