// #104 (E5 slice 3) — the shared ad-requirements read cache, run against both drivers like the
// other stores (pg-mem is an in-process Postgres, so the real SQL is exercised without a live DB).
import { beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import type { AdRequirementsV1 } from "@jobcrush/contracts";
import {
  InMemoryAdRequirementsStore,
  PgAdRequirementsStore,
  type AdRequirementsRecord,
  type AdRequirementsStore,
} from "../src/adRequirementsStore.js";

function pgPool() {
  const { Pool } = newDb().adapters.createPg();
  return new Pool();
}

const sampleReqs: AdRequirementsV1 = {
  schemaVersion: "1",
  adId: "ad-1",
  curated: false,
  language: "en",
  familyFit: { family: "IT Project Manager", confidence: 0.8 },
  requirements: [
    {
      id: "r1",
      band: "essential",
      kind: "ordinary",
      requirement: "Own a project budget",
      sourceSpan: "own a project budget",
    },
  ],
};

const record = (over: Partial<AdRequirementsRecord> = {}): AdRequirementsRecord => ({
  requirements: sampleReqs,
  version: "ad-reader/1+adreq/1",
  cost: { model: "claude-sonnet-5", inputTokens: 1200, outputTokens: 400, readAt: "2026-08-02T00:00:00.000Z" },
  ...over,
});

const drivers: [string, () => AdRequirementsStore][] = [
  ["in-memory", () => new InMemoryAdRequirementsStore()],
  ["postgres (pg-mem)", () => new PgAdRequirementsStore(pgPool())],
];

for (const [name, make] of drivers) {
  describe(`AdRequirementsStore contract — ${name}`, () => {
    let store: AdRequirementsStore;
    beforeEach(async () => {
      store = make();
      await store.init();
    });

    it("get on an unread ad is null", async () => {
      expect(await store.get("ad-1")).toBeNull();
    });

    it("put -> get round-trips the requirements, version, and full cost record", async () => {
      await store.put("ad-1", record());
      expect(await store.get("ad-1")).toEqual(record());
    });

    // #86's cost AC: real measured numbers, never an estimate presented as measured. A null token
    // count must round-trip as null, not silently become 0 or get dropped.
    it("a null token count round-trips as null, never a fabricated number", async () => {
      await store.put(
        "ad-1",
        record({
          cost: { model: "claude-sonnet-5", inputTokens: null, outputTokens: null, readAt: "2026-08-02T00:00:00.000Z" },
        }),
      );
      const got = await store.get("ad-1");
      expect(got?.cost.inputTokens).toBeNull();
      expect(got?.cost.outputTokens).toBeNull();
    });

    // #86: "nobody pays twice for the same advert" — one shared record per adId, and a version-bump
    // re-read replaces it in place rather than accumulating a history.
    it("put is keyed by adId alone; a re-read at a new version replaces the prior record", async () => {
      await store.put("ad-1", record({ version: "ad-reader/1+adreq/1" }));
      await store.put("ad-1", record({ version: "ad-reader/2+adreq/1" }));
      expect((await store.get("ad-1"))?.version).toBe("ad-reader/2+adreq/1");
    });

    it("different ads are independent", async () => {
      await store.put("ad-1", record());
      expect(await store.get("ad-2")).toBeNull();
    });

    // #104 review finding 3: a row written under a prior contract version that the CURRENT
    // AdRequirementsV1 schema now rejects used to throw straight out of get() — on Postgres this
    // happened BEFORE any version comparison could run, so the exact mechanism meant to catch a
    // stale row (its version field) never got a chance to fire; the in-memory driver never
    // re-parsed at all, so this bug was invisible in every test that only exercised it. Both
    // drivers must now treat an unparseable row as a plain cache miss, never a thrown error.
    it("a stored row the CURRENT schema rejects reads as a cache miss, not a thrown error", async () => {
      await store.put("ad-1", record({ requirements: { schemaVersion: "1", adId: "ad-1" } as unknown as AdRequirementsV1 }));
      await expect(store.get("ad-1")).resolves.toBeNull();
    });
  });
}
