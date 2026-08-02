// #86 decisions 4 + 5 — the eligibility-fact store, run against both drivers like the other stores
// (pg-mem is an in-process Postgres, so the real SQL is exercised without a live DB).
import { beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import {
  ANY_FAMILY,
  InMemoryEligibilityStore,
  PgEligibilityStore,
  type EligibilityStore,
} from "../src/eligibility.js";

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
  });
}
