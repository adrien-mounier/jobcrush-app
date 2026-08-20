// #254 (spec #251, part of #218) — the vocabulary proposal package template, rehearsed against the
// REAL publish gates. The runbook (docs/vocabulary-growth-runbook.md) tells a vocabulary-growth run
// to draft every proposal from apps/api/research/vocabulary-proposal-template.json; these tests keep
// that template a package the gates actually accept, and rehearse the two refusals the runbook warns
// about. The gates themselves (familyFloors.ts) are untouched by this slice — that is AC6.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { initialProductionFamilyFloors, ProductionFamilyFloorStore } from "../src/familyFloors.js";

const here = dirname(fileURLToPath(import.meta.url));
const template = () =>
  JSON.parse(
    readFileSync(join(here, "..", "research", "vocabulary-proposal-template.json"), "utf8"),
  );

describe("vocabulary proposal rehearsal (#254)", () => {
  it("a rehearsal package built from the template passes the real publish gates", () => {
    const store = new ProductionFamilyFloorStore();
    const published = store.publish(template());
    expect(store.active("rehearsal-harbour-pilotage")).toEqual(published);
    expect(published.floor.version).toBe(1);
  });

  it("the rehearsal family is never part of the production boot catalog", () => {
    // Pins the template's own claim: it sits beside the real publication in apps/api/research/,
    // marked "published" so the gates accept it — so a loader that ever globbed the directory
    // would ship a fictitious family silently. This is the tripwire for that.
    expect(initialProductionFamilyFloors().active("rehearsal-harbour-pilotage")).toBeNull();
  });

  it("an under-evidenced rehearsal (fewer than three distinct employers) is refused", () => {
    const underEvidenced = template();
    for (const item of underEvidenced.postingEvidence) item.employer = "Rehearsal Port Authority";
    expect(() => new ProductionFamilyFloorStore().publish(underEvidenced)).toThrow(
      "production family requires at least three employers",
    );
  });

  it("a widening rehearsal with copied measurements is refused; fresh measurements pass", () => {
    const store = new ProductionFamilyFloorStore();
    store.publish(template());

    // A new version widening the family's scope, with the market words copied unchanged from v1 —
    // the runbook's named failure: a widening that skipped the provider re-run cannot publish.
    const widened = () => {
      const next = template();
      next.floor.version = 2;
      next.floor.scope += " Also covers mooring masters conducting ship-to-ship transfer moorings.";
      return next;
    };
    expect(() => store.publish(widened())).toThrow(
      /family market words were not re-measured since the previous publication/,
    );
    expect(store.active("rehearsal-harbour-pilotage")?.floor.version).toBe(1);

    // The same widening with every served market freshly re-measured passes.
    const fresh = widened();
    for (const entries of Object.values(fresh.marketSearchTitles)) {
      for (const entry of entries as Array<{ measuredOn: string }>) entry.measuredOn = "2026-08-21";
    }
    store.publish(fresh);
    expect(store.active("rehearsal-harbour-pilotage")?.floor.version).toBe(2);
  });
});
