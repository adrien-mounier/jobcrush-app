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

  // #373: a CV whose summary is followed by personal projects and a nationality line. Before, all
  // of those printed under the summary; the master CV now files each under its own heading, in the
  // order cv-authoring-rules.md fixes (Personal Projects right after the jobs, Additional last).
  it("#373: personal projects print after the jobs and the nationality line last; the summary keeps only its own sentences", () => {
    const summary = [
      claim({ id: "profile-years", role: "profile", text: "Delivery lead with 6 years in retail software." }),
      claim({ id: "profile-strength", role: "profile", text: "Known for calm vendor negotiations." }),
    ];
    const projects = [
      claim({ id: "project-garden-sensors", role: "profile", text: "Built a solar-powered garden sensor network with a small web dashboard." }),
      claim({ id: "project-recipe-wiki", role: "profile", text: "Maintain a family recipe wiki with 300 entries." }),
    ];
    const nationality = claim({ id: "additional-nationality", role: "profile", text: "Nationality: Portuguese, based in Lisbon, Portugal." });
    const { markdown, trace } = renderRootCv(buildClaimGraph([...summary, ...projects, nationality, ...confirmed]));

    const headings = markdown.split("\n").filter((l) => l.startsWith("## "));
    expect(headings).toEqual([
      "## Professional Summary",
      "## Professional Experience",
      "## Personal Projects",
      "## Certifications",
      "## Additional Information",
    ]);
    const under = (section: string) => trace.entries.filter((e) => e.section === section).map((e) => e.nodeIds[0]);
    expect(under("Professional Summary")).toEqual(["profile-years", "profile-strength", "profile-stakeholder"]);
    expect(under("Personal Projects")).toEqual(["project-garden-sensors", "project-recipe-wiki"]);
    expect(under("Additional Information")).toEqual(["additional-nationality"]);
    // Nothing lost on the way: every claim prints exactly once.
    expect(trace.entries).toHaveLength(summary.length + projects.length + 1 + confirmed.length);
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
