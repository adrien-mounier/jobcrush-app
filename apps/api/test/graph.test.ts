// JC-32 — the built graph must satisfy the frozen Contract-1 validator. The contracts golden test
// proves ClaimGraph (zod) ≡ validate_graph.mjs (oracle), so parsing with the zod port here is the
// same check the oracle would make on the API server.
import { describe, expect, it } from "vitest";
import { ClaimGraph, type CandidateClaim } from "@jobcrush/contracts";
import { buildClaimGraph } from "../src/graph.js";
import { renderRootCv } from "../src/rootcv.js";
import { runGate } from "../src/gate.js";

const claim = (over: Partial<CandidateClaim>): CandidateClaim => ({
  id: "acme-led-migration",
  role: "Acme — PM",
  text: "Led the checkout replatform, delivered two months early.",
  machine_touch: "verbatim",
  classification: "Verified",
  source_quote: "Led checkout replatform; delivered 2 months early.",
  needs_grill: false,
  grill_hint: null,
  ...over,
});

// A realistic confirmed set spanning all three mineable classes + a profile-section cert.
const confirmed: CandidateClaim[] = [
  claim({ id: "acme-led-migration", classification: "Verified" }),
  claim({ id: "acme-team-capability", classification: "Derived", text: "Cross-functional delivery leadership." }),
  claim({
    id: "profile-stakeholder-mgmt",
    role: "profile",
    classification: "Partially-Supported",
    text: "Experienced in stakeholder management.",
  }),
  claim({ id: "cert-pmp-2021", role: "profile", text: "PMP, 2021.", classification: "Verified" }),
];

describe("JC-32 buildClaimGraph", () => {
  it("produces a graph the frozen validator accepts", () => {
    const g = buildClaimGraph(confirmed, { confirmedDate: "2026-07-18" });
    const parsed = ClaimGraph.safeParse(g);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("floors Partially-Supported risk so invariant 8 holds", () => {
    const g = buildClaimGraph(confirmed, { confirmedDate: "2026-07-18" });
    const ps = g.nodes.find((n) => n.classification === "Partially-Supported")!;
    expect(ps.risk).not.toBeNull();
    expect(ps.renderable).toBe(true); // confirmed => renders in the root CV
  });

  it("conserves every confirmed claim as exactly one renderable source node", () => {
    const g = buildClaimGraph(confirmed, { confirmedDate: "2026-07-18" });
    expect(g.nodes).toHaveLength(confirmed.length);
    expect(g.nodes.every((n) => n.renderable && n.origin === "source")).toBe(true);
    // ids preserved 1:1 — nothing dropped, nothing invented
    expect(g.nodes.map((n) => n.id).sort()).toEqual(confirmed.map((c) => c.id).sort());
  });

  it("stamps a non-empty kind tag on every node", () => {
    const g = buildClaimGraph(confirmed, { confirmedDate: "2026-07-18" });
    expect(g.nodes.every((n) => n.tags.length >= 1 && n.tags[0].length > 0)).toBe(true);
    expect(g.nodes.find((n) => n.id === "cert-pmp-2021")!.tags).toEqual(["cert"]);
  });
});

// #13 — persisted "no" answers become Negative nodes that must never render.
describe("JC-32 buildClaimGraph negatives (#13)", () => {
  const negative = claim({
    id: "grill-gap-info-cert",
    role: "profile",
    text: "No PMP certification.",
    source_quote: "no",
  });

  it("emits a Negative, renderable:false node with provenance set; positives are conserved unchanged", () => {
    const g = buildClaimGraph(confirmed, { confirmedDate: "2026-07-18", negatives: [negative] });
    const node = g.nodes.find((n) => n.id === "grill-gap-info-cert")!;
    expect(node).toMatchObject({
      classification: "Negative",
      renderable: false,
      risk: null,
      source_file: "cv",
      origin: "source",
    });
    expect(g.nodes.filter((n) => n.classification !== "Negative")).toHaveLength(confirmed.length);
  });

  it("validates clean against the frozen ClaimGraph validator", () => {
    const g = buildClaimGraph(confirmed, { confirmedDate: "2026-07-18", negatives: [negative] });
    const parsed = ClaimGraph.safeParse(g);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("the gate never renders a Negative node — the root CV has no bullet for it", () => {
    const g = buildClaimGraph(confirmed, { confirmedDate: "2026-07-18", negatives: [negative] });
    const { markdown, trace } = renderRootCv(g);
    expect(markdown).not.toContain(negative.text);
    // Real call site never confirms a negative (claims.confirmed() excludes them) — confirmedIds is
    // the positive-only set, and the gate is still clean because the trace never references the
    // negative at all (renderRootCv already dropped it).
    const r = runGate(g, trace, confirmed.map((c) => c.id));
    expect(r).toEqual({ ok: true, errors: [] });
  });
});
