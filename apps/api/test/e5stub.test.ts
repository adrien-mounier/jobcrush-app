// #12: behaviour tests for the E5-facing stub provider fns, tested through the seam (the
// return value), never internals. The E5 boundary is the pinned fixture, not a third test
// seam, so these lean on the schemas (packages/contracts/test/stubSchemas.test.ts) for shape.
import { describe, expect, it } from "vitest";
import { loadFamilyFloor, loadAdRequirements } from "../src/e5stub.js";

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
});
