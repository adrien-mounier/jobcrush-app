// S2 decision #6 — the audit polishes mined wording; mechanics decide what sticks. The guards are
// the contract: numbers conserved exactly, no forbidden glyphs, user-authored bullets untouched,
// and no failure mode that takes the build down.
import { describe, expect, it } from "vitest";
import type { CandidateClaim } from "@jobcrush/contracts";
import { buildClaimGraph } from "../src/graph.js";
import { renderRootCv } from "../src/rootcv.js";
import { auditRootCv, makeCvAuditor, type CvAuditor } from "../src/audit.js";

const claim = (over: Partial<CandidateClaim>): CandidateClaim => ({
  id: "acme-led-migration",
  role: "Acme — PM",
  text: "Was responsible for successfully leading the checkout replatform with 3 vendor teams.",
  machine_touch: "reworded",
  classification: "Verified",
  source_quote: "led checkout replatform",
  needs_grill: false,
  grill_hint: null,
  ...over,
});

const CLAIMS: CandidateClaim[] = [
  claim({ id: "acme-led-migration" }),
  claim({ id: "grill-budget", role: "profile", text: "Managed a EUR 1.2M budget." }),
];
const cv = () => renderRootCv(buildClaimGraph(CLAIMS));
const NONE: ReadonlySet<string> = new Set();

describe("auditRootCv (decision #6)", () => {
  it("applies a clean polish and rebuilds markdown + trace, nodeIds untouched", async () => {
    const auditor: CvAuditor = async (bullets) =>
      bullets.map((b) => b.text.replace("Was responsible for successfully leading", "Led"));
    const out = await auditRootCv(cv(), auditor, NONE);
    expect(out.markdown).toContain("- Led the checkout replatform with 3 vendor teams.");
    expect(out.markdown).not.toContain("Was responsible");
    const en = out.trace.entries.find((e) => e.nodeIds.includes("acme-led-migration"))!;
    expect(en.bullet).toMatch(/^Led the checkout/);
    // trace still points at the same confirmed nodes — the gate's invariant.
    expect(out.trace.entries.map((e) => e.nodeIds[0]).sort()).toEqual(
      ["acme-led-migration", "grill-budget"].sort(),
    );
  });

  it("never sends user-authored bullets to the model and never changes them", async () => {
    const seen: string[] = [];
    const auditor: CvAuditor = async (bullets) => {
      bullets.forEach((b) => seen.push(b.text));
      return bullets.map(() => "Polished.");
    };
    const out = await auditRootCv(cv(), auditor, new Set(["grill-budget"]));
    expect(seen.join(" ")).not.toContain("EUR 1.2M");
    expect(out.trace.entries.find((e) => e.nodeIds.includes("grill-budget"))!.bullet).toBe(
      "Managed a EUR 1.2M budget.",
    );
  });

  it("rejects a polish that adds or drops a number (per bullet, others still apply)", async () => {
    const auditor: CvAuditor = async (bullets) =>
      bullets.map((b) =>
        b.text.includes("vendor")
          ? "Led the checkout replatform with 4 vendor teams." // invented figure → rejected
          : "Owned a EUR 1.2M delivery budget.", // numbers conserved → accepted
      );
    const out = await auditRootCv(cv(), auditor, NONE);
    expect(out.trace.entries.find((e) => e.nodeIds.includes("acme-led-migration"))!.bullet).toContain(
      "Was responsible", // fell back to the original
    );
    expect(out.trace.entries.find((e) => e.nodeIds.includes("grill-budget"))!.bullet).toBe(
      "Owned a EUR 1.2M delivery budget.",
    );
  });

  it("rejects a polish that introduces forbidden glyphs or comes back empty", async () => {
    const auditor: CvAuditor = async (bullets) =>
      bullets.map((b) => (b.text.includes("vendor") ? "Led the replatform — 3 vendor teams." : "  "));
    const out = await auditRootCv(cv(), auditor, NONE);
    for (const e of out.trace.entries) expect(e.bullet).toBe(cv().trace.entries.find((o) => o.nodeIds[0] === e.nodeIds[0])!.bullet);
  });

  it("returns the CV unchanged when the auditor throws or miscounts", async () => {
    const original = cv();
    const thrown = await auditRootCv(original, async () => { throw new Error("model down"); }, NONE);
    expect(thrown).toBe(original);
    const short = await auditRootCv(original, async () => ["only one"].slice(0, 1), NONE);
    expect(short).toBe(original);
  });
});

describe("makeCvAuditor", () => {
  it("parses a JSON array out of prose and rejects a mismatched one", async () => {
    const good = makeCvAuditor({ complete: async () => 'Here you go:\n["A.", "B."]' });
    expect(await good([{ i: 0, section: "S", text: "a" }, { i: 1, section: "S", text: "b" }])).toEqual(["A.", "B."]);
    const bad = makeCvAuditor({ complete: async () => '["only one"]' });
    await expect(bad([{ i: 0, section: "S", text: "a" }, { i: 1, section: "S", text: "b" }])).rejects.toThrow();
  });
});
