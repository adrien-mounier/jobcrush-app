// #86 decisions 4 + 5 — the eligibility-fact store, run against both drivers like the other stores
// (pg-mem is an in-process Postgres, so the real SQL is exercised without a live DB).
import { beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { EligibilityDimension } from "@jobcrush/contracts";
import {
  ANY_FAMILY,
  ELIGIBILITY_DIMENSIONS,
  InMemoryEligibilityStore,
  PgEligibilityStore,
  type EligibilityStore,
} from "../src/eligibility.js";

// #102 must-fix: packages/contracts/src/adRequirements.ts's EligibilityDimension duplicates this
// store's vocabulary rather than importing it (apps/api depends on @jobcrush/contracts, never the
// reverse). Nothing else keeps the two lists in sync, so a sixth dimension added here without a
// matching contract update would make loadAdRequirements() throw on any advert tagged with it —
// silently killing those cards with no message naming the cause. This is the drift guard.
it("the eligibility store's dimensions and the contract's EligibilityDimension stay identical (#102)", () => {
  expect([...EligibilityDimension.options].sort()).toEqual([...ELIGIBILITY_DIMENSIONS].sort());
});

function pgPool() {
  const { Pool } = newDb().adapters.createPg();
  return new Pool();
}

const drivers: [string, () => EligibilityStore][] = [
  ["in-memory", () => new InMemoryEligibilityStore()],
  ["postgres (pg-mem)", () => new PgEligibilityStore(pgPool())],
];

const IT = "it-project-delivery";
const CONSTRUCTION = "construction-project-management";

for (const [name, make] of drivers) {
  describe(`EligibilityStore contract — ${name}`, () => {
    let store: EligibilityStore;
    const sid = "sess-1";
    beforeEach(async () => {
      store = make();
      await store.init();
    });

    it("stores length of experience as a comparable number, per family", async () => {
      // The whole point: "3 years" and "10 years" currently score identically because the scorer
      // strips digits. A number in its own field is what makes 5-against-8 scoreable.
      await store.put(sid, {
        dimension: "years-experience",
        familyId: IT,
        value: "8",
        label: "Years in IT project delivery",
      });
      expect(await store.numeric(sid, "years-experience", IT)).toBe(8);
    });

    it("years are family-scoped — eight years of IT delivery is not eight years of anything", async () => {
      await store.put(sid, { dimension: "years-experience", familyId: IT, value: "8", label: "IT delivery" });
      await store.put(sid, {
        dimension: "years-experience",
        familyId: CONSTRUCTION,
        value: "2",
        label: "Construction PM",
      });

      expect(await store.numeric(sid, "years-experience", IT)).toBe(8);
      expect(await store.numeric(sid, "years-experience", CONSTRUCTION)).toBe(2);
      // The two never collide, and neither leaks into the global scope.
      expect(await store.numeric(sid, "years-experience")).toBeNull();
    });

    it("unknown reads as null — never as 'does not have it'", async () => {
      // #86 decision 3 rests on this: an unknown must never withdraw a card.
      expect(await store.get(sid, "work-rights")).toBeNull();
      expect(await store.numeric(sid, "years-experience", IT)).toBeNull();
    });

    it("non-family-scoped facts share one global scope", async () => {
      await store.put(sid, {
        dimension: "work-rights",
        familyId: ANY_FAMILY,
        value: "hk-permanent-resident",
        label: "Right to work in Hong Kong",
      });
      // Your visa does not change with the job family, so the default lookup finds it.
      expect(await store.get(sid, "work-rights")).toMatchObject({ value: "hk-permanent-resident" });
    });

    it("a correction overwrites in place rather than accumulating", async () => {
      await store.put(sid, { dimension: "years-experience", familyId: IT, value: "8", label: "IT" });
      await store.put(sid, { dimension: "years-experience", familyId: IT, value: "3", label: "IT" });

      expect(await store.numeric(sid, "years-experience", IT)).toBe(3);
      expect(await store.list(sid)).toHaveLength(1);
    });

    it("rejects a numeric dimension that could not be compared later", async () => {
      // Fail at the write, where the caller can still fix it — not silently at read.
      await expect(
        store.put(sid, {
          dimension: "years-experience",
          familyId: IT,
          value: "about 8 years",
          label: "IT",
        }),
      ).rejects.toThrow(/canonical decimal string/);
      expect(await store.numeric(sid, "years-experience", IT)).toBeNull();
    });

    it("sessions are isolated", async () => {
      await store.put(sid, { dimension: "years-experience", familyId: IT, value: "8", label: "IT" });
      expect(await store.numeric("other-session", "years-experience", IT)).toBeNull();
      expect(await store.list("other-session")).toEqual([]);
    });

    it("remove clears one fact without touching its neighbours", async () => {
      await store.put(sid, { dimension: "years-experience", familyId: IT, value: "8", label: "IT" });
      await store.put(sid, { dimension: "degree", familyId: ANY_FAMILY, value: "bachelor", label: "Degree" });

      await store.remove(sid, "years-experience", IT);
      expect(await store.numeric(sid, "years-experience", IT)).toBeNull();
      expect(await store.get(sid, "degree")).toMatchObject({ value: "bachelor" });
    });

    // #182 — work-rights becomes a fact about a place. The store itself is generic (the same familyId
    // column years-experience already scopes by family), so these pin the vocabulary this ticket
    // actually adds: a market, and non-destructive correction — via the SAME mechanics the tests above
    // already prove for family scoping and overwrite-vs-accumulate.
    it("#182 AC1: work-rights answers are keyed to the market they were asked about — Paris and Hong Kong never collide", async () => {
      await store.put(sid, {
        dimension: "work-rights",
        familyId: "Paris",
        value: "eligible",
        label: "Right to work without sponsorship",
      });
      // Hong Kong is unasked — unknown, never borrowed from Paris.
      expect(await store.get(sid, "work-rights", "Hong Kong")).toBeNull();
      expect(await store.get(sid, "work-rights", "Paris")).toMatchObject({ value: "eligible" });
    });

    it("#182 AC1/AC2: writing a Hong Kong answer leaves the Paris answer stored and unchanged", async () => {
      await store.put(sid, {
        dimension: "work-rights",
        familyId: "Paris",
        value: "eligible",
        label: "Right to work without sponsorship",
      });
      await store.put(sid, {
        dimension: "work-rights",
        familyId: "Hong Kong",
        value: "needs-sponsorship",
        label: "Right to work without sponsorship",
      });
      expect(await store.get(sid, "work-rights", "Paris")).toMatchObject({ value: "eligible" });
      expect(await store.get(sid, "work-rights", "Hong Kong")).toMatchObject({ value: "needs-sponsorship" });
    });

    it("#182 AC3: a fact stored for one market is invisible to a read scoped at a different market", async () => {
      await store.put(sid, {
        dimension: "work-rights",
        familyId: "Paris",
        value: "needs-sponsorship",
        label: "Right to work without sponsorship",
      });
      // Planted a conflicting ("no") answer in a market gating never reads for — no effect.
      expect(await store.get(sid, "work-rights", "Hong Kong")).toBeNull();
      expect(await store.numeric(sid, "work-rights", "Hong Kong")).toBeNull();
    });

    it("#182 AC5: a changed answer for the SAME market supersedes the previous value rather than deleting it", async () => {
      await store.put(sid, {
        dimension: "work-rights",
        familyId: "Hong Kong",
        value: "needs-sponsorship",
        label: "Right to work without sponsorship",
      });
      await store.put(sid, {
        dimension: "work-rights",
        familyId: "Hong Kong",
        value: "eligible",
        label: "Right to work without sponsorship",
      });

      // The current read reflects the correction...
      expect(await store.get(sid, "work-rights", "Hong Kong")).toMatchObject({ value: "eligible" });
      expect(await store.list(sid)).toHaveLength(1); // never accumulates a second visible row
      // ...but the prior value is provably kept, not deleted.
      const history = await store.history(sid, "work-rights", "Hong Kong");
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ value: "needs-sponsorship", label: "Right to work without sponsorship" });
      expect(typeof history[0]!.supersededAt).toBe("string");
    });

    // #182 code review must-fix: a decline (the discovery route's remove()) must never take a
    // superseded value down with it — driver-parity bug caught here because it's exercised on BOTH
    // drivers, not just in-memory. Real scenario: answer -> correct -> decline. QA round 3 small fix:
    // the decline itself ALSO supersedes (never deletes) the value it retracts, so history grows to
    // TWO entries here — the put()-superseded "needs-sponsorship" AND the remove()-superseded
    // "eligible", oldest first.
    it("#182: put -> put -> remove -> history() still returns every superseded value on both drivers", async () => {
      await store.put(sid, {
        dimension: "work-rights",
        familyId: "Hong Kong",
        value: "needs-sponsorship",
        label: "Right to work without sponsorship",
      });
      await store.put(sid, {
        dimension: "work-rights",
        familyId: "Hong Kong",
        value: "eligible",
        label: "Right to work without sponsorship",
      });
      await store.remove(sid, "work-rights", "Hong Kong");

      expect(await store.get(sid, "work-rights", "Hong Kong")).toBeNull(); // retracted, as before
      const history = await store.history(sid, "work-rights", "Hong Kong");
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({ value: "needs-sponsorship", label: "Right to work without sponsorship" });
      expect(history[1]).toMatchObject({ value: "eligible", label: "Right to work without sponsorship" });
    });

    it("history stays empty for a fact that has never been corrected", async () => {
      await store.put(sid, {
        dimension: "work-rights",
        familyId: "Paris",
        value: "eligible",
        label: "Right to work without sponsorship",
      });
      expect(await store.history(sid, "work-rights", "Paris")).toEqual([]);
    });

    it("re-storing the identical value/label does not grow history — only a real correction supersedes", async () => {
      const fact = {
        dimension: "work-rights" as const,
        familyId: "Paris",
        value: "eligible",
        label: "Right to work without sponsorship",
      };
      await store.put(sid, fact);
      await store.put(sid, { ...fact });
      expect(await store.history(sid, "work-rights", "Paris")).toEqual([]);
    });
  });
}
