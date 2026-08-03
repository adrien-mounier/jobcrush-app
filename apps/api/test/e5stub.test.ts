// #12: behaviour tests for the E5-facing stub provider fns, tested through the seam (the
// return value), never internals. The E5 boundary is the pinned fixture, not a third test
// seam, so these lean on the schemas (packages/contracts/test/stubSchemas.test.ts) for shape.
import { describe, expect, it } from "vitest";
import {
  knownFamilies,
  listAdRequirements,
  loadFamilyFloor,
  loadAdRequirements,
  lookupAdRequirements,
  withFixtureOverrideForTest,
} from "../src/e5stub.js";
import { matchTick, type ScoredFact } from "../src/matchtick.js";
import { readCounters } from "../src/counters.js";

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
    // #102: the fixture loader reads AdRequirementsV1 now — v0's schemaVersion "0" and its
    // must/should/nice vocabulary are retired from every real fixture.
    expect(reqs.schemaVersion).toBe("1");
    expect(reqs.adId).toBe("2026-07-05_manulife_senior-it-project-manager-delivery-manager");
    expect(reqs.requirements.length).toBeGreaterThan(0);
    expect(
      reqs.requirements.every((r) => ["essential", "standard", "nice-to-have"].includes(r.band)),
    ).toBe(true);
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

  it("knownFamilies returns every family name from the stubbed floors", () => {
    expect(knownFamilies()).toEqual(["IT Project Manager"]);
  });

  // #104 carry-forward from the #102 review: listAdRequirements() used to map(parse) across every
  // advert, so one unparseable entry threw out of the .map() and took the WHOLE list down. Fixed to
  // drop only the broken entry. #114 review: this used to be proven against a separate
  // parseAdRequirementsList helper's own seam instead of listAdRequirements itself — a second
  // implementation nothing in production called, deleted outright (see e5stub.ts's own doc). Proven
  // here against the REAL function production runs instead, via withFixtureOverrideForTest so the
  // shipped fixture file stays untouched.
  it("listAdRequirements drops an unparseable entry instead of taking the whole list down (#102 carry-forward), counted on its OWN counter (#104 review finding 6)", async () => {
    const good = loadAdRequirements("2026-07-05_manulife_senior-it-project-manager-delivery-manager");
    const bad = { ...good, adId: "broken-fixture-for-102-carry-forward", requirements: [] }; // min(1) violation
    await withFixtureOverrideForTest(
      (real) => [...real, bad],
      async () => {
        const before = readCounters()["postings.fixture_invalid"];
        const failedBefore = readCounters()["postings.read_failed"];
        const result = listAdRequirements();
        expect(result.map((r) => r.adId)).toContain(good.adId);
        expect(result.map((r) => r.adId)).not.toContain(bad.adId);
        expect(readCounters()["postings.fixture_invalid"]).toBe(before + 1);
        expect(readCounters()["postings.read_failed"]).toBe(failedBefore); // never poisons the alarm's numerator
      },
    );
  });

  // #114: lookupAdRequirements is the three-way answer resolveAdRequirements (routes/onboarding.ts)
  // needs — proven here at its own seam (a plain adId in, a status out), never touching the real
  // on-disk fixture the rest of this file depends on.
  describe("#114 lookupAdRequirements — found / missing / invalid", () => {
    it("reports 'found' for a real curated adId, same requirements loadAdRequirements returns", () => {
      const adId = "2026-07-05_manulife_senior-it-project-manager-delivery-manager";
      const result = lookupAdRequirements(adId);
      expect(result).toEqual({ status: "found", requirements: loadAdRequirements(adId) });
    });

    it("reports 'missing' for an adId nobody ever curated", () => {
      expect(lookupAdRequirements("not-a-real-ad-id")).toEqual({ status: "missing" });
    });

    it("reports 'invalid', not 'missing', for a curated adId whose entry fails validation — counted once, at index build, not on the lookup", async () => {
      const target = "corrupt-fixture-for-114";
      const good = loadAdRequirements("2026-07-05_manulife_senior-it-project-manager-delivery-manager");
      const corrupted = { ...good, adId: target, requirements: [] }; // min(1) violation
      await withFixtureOverrideForTest(
        (real) => [...real, corrupted],
        async () => {
          const before = readCounters()["postings.fixture_invalid"];
          // The FIRST lookup already sees "invalid" — the index (and its one-time count) was built
          // as soon as anything touched it, not lazily deferred to this call.
          expect(lookupAdRequirements(target)).toEqual({ status: "invalid" });
          expect(readCounters()["postings.fixture_invalid"]).toBe(before + 1);
          // A second lookup for the SAME adId must not count it again (#104 review finding 6's
          // "counted once" property, now enforced by the shared index rather than a per-call cache).
          lookupAdRequirements(target);
          expect(readCounters()["postings.fixture_invalid"]).toBe(before + 1);
        },
      );
    });

    it("still counts a broken fixture whose OWN adId is missing/unreadable, even though no lookup can ever find it", async () => {
      await withFixtureOverrideForTest(
        (real) => [...real, { schemaVersion: "1", curated: false, requirements: [] }], // no adId at all
        async () => {
          const before = readCounters()["postings.fixture_invalid"];
          // Nothing can look this one up by id — it has none — but building the index still counts
          // it once, the same as any other broken fixture (buildFixtureIndex's own doc).
          lookupAdRequirements("anything"); // triggers a lazy index build if one hasn't happened yet
          expect(readCounters()["postings.fixture_invalid"]).toBe(before + 1);
        },
      );
    });

    it("restores the real fixture set once the override ends", async () => {
      const realAdId = "2026-07-05_manulife_senior-it-project-manager-delivery-manager";
      await withFixtureOverrideForTest(
        () => [{ schemaVersion: "1", adId: "only-this-one", curated: false, requirements: [] }],
        async () => {
          expect(lookupAdRequirements(realAdId)).toEqual({ status: "missing" }); // real fixture shadowed
        },
      );
      expect(lookupAdRequirements(realAdId).status).toBe("found"); // back to normal
    });

    // #114 review must-fix 3: the first version of buildFixtureIndex just called index.set() in a
    // loop, so array order silently decided a duplicate adId's outcome (last entry wins) — a broken
    // copy-pasted duplicate AFTER a good one would shadow it and drop a resolvable card with no
    // signal beyond a counter bump. #86 names exactly that ("a winnable job silently disappears") as
    // this engine's worst failure, so it's pinned here at the lookup seam rather than left implicit.
    describe("duplicate adIds — a valid entry always wins over an invalid one", () => {
      const dup = "duplicate-adid-for-114";
      const good = () =>
        ({ ...loadAdRequirements("2026-07-05_manulife_senior-it-project-manager-delivery-manager"), adId: dup });
      const bad = () => ({ ...good(), requirements: [] }); // min(1) violation

      it("a good entry AFTER a broken duplicate still resolves — the broken one does not shadow it", async () => {
        await withFixtureOverrideForTest(
          (real) => [...real, bad(), good()],
          async () => {
            expect(lookupAdRequirements(dup)).toEqual({ status: "found", requirements: good() });
          },
        );
      });

      it("a good entry BEFORE a broken duplicate still resolves — order doesn't matter either way", async () => {
        await withFixtureOverrideForTest(
          (real) => [...real, good(), bad()],
          async () => {
            expect(lookupAdRequirements(dup)).toEqual({ status: "found", requirements: good() });
          },
        );
      });

      it("two broken duplicates still report 'invalid', never crash, and count once EACH at index build", async () => {
        await withFixtureOverrideForTest(
          (real) => [...real, bad(), bad()],
          async () => {
            const before = readCounters()["postings.fixture_invalid"];
            expect(lookupAdRequirements(dup)).toEqual({ status: "invalid" });
            // Each broken entry in the raw file is still its own parse failure — counted per entry,
            // same as any other pair of unrelated bad fixtures, just sharing an id.
            expect(readCounters()["postings.fixture_invalid"]).toBe(before + 2);
          },
        );
      });
    });
  });

  it("scores every new curated set as a varied, believable strong fit", () => {
    const added = listAdRequirements().filter((ad) => NEW_CURATED_AD_IDS.includes(ad.adId));
    expect(added).toHaveLength(NEW_CURATED_AD_IDS.length);
    const scores = added.map((ad) => matchTick(STRONG_SENIOR_IT_PM, ad));
    // #26's coherent clause fit plus deduplicated relevant-evidence breadth puts the current
    // curated minimum at 83; pin that honest floor so scorer drift cannot hide behind slack.
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(83);
    expect(new Set(scores).size).toBeGreaterThanOrEqual(3);
  });
});
