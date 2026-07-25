// #12: behaviour tests for the E5-facing stub provider fns, tested through the seam (the
// return value), never internals. The E5 boundary is the pinned fixture, not a third test
// seam, so these lean on the schemas (packages/contracts/test/stubSchemas.test.ts) for shape.
import { describe, expect, it } from "vitest";
import { listAdRequirements, loadFamilyFloor, loadAdRequirements } from "../src/e5stub.js";
import { matchTick, type ScoredFact } from "../src/matchtick.js";

const NEW_CURATED_AD_IDS = [
  "2026-06-30_schneider-electric_senior-project-manager",
  "2026-07-01_transunion_senior-project-manager-6-months-contract",
  "2026-07-05_computershare-hong-kong_business-readiness-senior-project-manager-9-month-contract",
  "2026-07-05_synpulse_business-analyst-project-manager-wealth-management-data",
  "2026-07-05_hire-feed_project-manager-remote",
];

// docs/card-quality-taste-test.md's strong, on-target senior IT-PM profile, made concrete
// at the exact ScoredFact seam consumed by matchTick.
const STRONG_SENIOR_IT_PM: ScoredFact[] = [
  { text: "Owned a $2M project budget across four cross-functional teams." },
  { text: "Led vendor and system integrator delivery against SOWs and performance outcomes." },
  { text: "Presented executive SteerCo reporting to C-suite stakeholders." },
  { text: "Delivered end-to-end IT transformation programs." },
  { text: "Managed project risks, RAID logs, dependencies, and mitigation." },
  { text: "PMP-certified senior IT Project Manager with Delivery Manager experience." },
  { text: "Led Agile Scrum delivery using Jira and Microsoft Project." },
  { text: "Managed the full project lifecycle from planning through completion." },
  { text: "Coordinated business, technical, and client stakeholders." },
  { text: "Drove data migration and digital transformation initiatives." },
];

describe("E5 stub providers (#12)", () => {
  it("loadFamilyFloor returns a schema-valid FamilyFloor for the stubbed family", () => {
    const floor = loadFamilyFloor("IT Project Manager");
    expect(floor.schemaVersion).toBe("0");
    expect(floor.family).toBe("IT Project Manager");
    expect(floor.items.length).toBeGreaterThan(0);
    expect(
      floor.items.every((i) => ["essential", "standard", "nice-to-have"].includes(i.rankBand)),
    ).toBe(true);
  });

  it("loadFamilyFloor throws on an unknown family", () => {
    expect(() => loadFamilyFloor("Underwater Basket Weaver")).toThrow();
  });

  it("loadAdRequirements returns a schema-valid ranked list for a real posting id", () => {
    const reqs = loadAdRequirements(
      "2026-07-05_manulife_senior-it-project-manager-delivery-manager",
    );
    expect(reqs.schemaVersion).toBe("0");
    expect(reqs.adId).toBe("2026-07-05_manulife_senior-it-project-manager-delivery-manager");
    expect(reqs.requirements.length).toBeGreaterThan(0);
    expect(reqs.requirements.every((r) => ["must", "should", "nice"].includes(r.band))).toBe(
      true,
    );
  });

  it("loadAdRequirements throws on an unknown adId", () => {
    expect(() => loadAdRequirements("not-a-real-ad-id")).toThrow();
  });

  it("validates every hand-authored ad requirement set and keeps curation explicit", () => {
    const all = listAdRequirements();
    expect(all.length).toBeGreaterThan(3);
    expect(all.every((ad) => typeof ad.curated === "boolean")).toBe(true);
    expect(all.filter((ad) => ad.curated).length).toBeGreaterThan(3);
  });

  it("scores every new curated set as a varied, believable strong fit", () => {
    const added = listAdRequirements().filter((ad) => NEW_CURATED_AD_IDS.includes(ad.adId));
    expect(added).toHaveLength(NEW_CURATED_AD_IDS.length);
    const scores = added.map((ad) => matchTick(STRONG_SENIOR_IT_PM, ad));
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(70);
    expect(new Set(scores).size).toBeGreaterThanOrEqual(3);
  });
});
