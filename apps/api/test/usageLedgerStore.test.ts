// #118 — the durable usage ledger, run against both drivers like every other store in this repo
// (pg-mem is an in-process Postgres, so the real SQL is exercised without a live DB).
import { beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import {
  InMemoryUsageLedgerStore,
  PgUsageLedgerStore,
  type UsageLedgerEntry,
  type UsageLedgerStore,
} from "../src/usageLedgerStore.js";

function pgPool() {
  const { Pool } = newDb().adapters.createPg();
  return new Pool();
}

const entry = (over: Partial<UsageLedgerEntry> = {}): UsageLedgerEntry => ({
  visitorId: "visitor-1",
  stage: "judging",
  model: "claude-sonnet-5",
  inputTokens: 1000,
  outputTokens: 200,
  measured: true,
  costUsd: 0.006,
  at: "2026-08-02T00:00:00.000Z",
  ...over,
});

const drivers: [string, () => UsageLedgerStore][] = [
  ["in-memory", () => new InMemoryUsageLedgerStore()],
  ["postgres (pg-mem)", () => new PgUsageLedgerStore(pgPool())],
];

for (const [name, make] of drivers) {
  describe(`UsageLedgerStore contract — ${name}`, () => {
    let store: UsageLedgerStore;
    beforeEach(async () => {
      store = make();
      await store.init();
    });

    it("totals start at zero with nothing recorded", async () => {
      expect(await store.totalCostUsd()).toBe(0);
      expect(await store.costByStage()).toEqual({});
      expect(await store.costForVisitor("nobody")).toBe(0);
    });

    it("record → totalCostUsd sums a single entry's cost", async () => {
      await store.record(entry());
      expect(await store.totalCostUsd()).toBeCloseTo(0.006, 8);
    });

    it("totalCostUsd sums across multiple entries", async () => {
      await store.record(entry({ costUsd: 0.01 }));
      await store.record(entry({ costUsd: 0.02 }));
      expect(await store.totalCostUsd()).toBeCloseTo(0.03, 8);
    });

    it("an unmeasured entry (costUsd null) contributes 0 to the total, not an estimate", async () => {
      await store.record(entry({ measured: false, inputTokens: null, outputTokens: null, costUsd: null }));
      expect(await store.totalCostUsd()).toBe(0);
    });

    it("costByStage breaks spend down per stage", async () => {
      await store.record(entry({ stage: "judging", costUsd: 0.01 }));
      await store.record(entry({ stage: "advert-reading", costUsd: 0.02 }));
      await store.record(entry({ stage: "judging", costUsd: 0.005 }));
      const byStage = await store.costByStage();
      expect(byStage.judging).toBeCloseTo(0.015, 8);
      expect(byStage["advert-reading"]).toBeCloseTo(0.02, 8);
    });

    it("costForVisitor sums only that visitor's own entries", async () => {
      await store.record(entry({ visitorId: "v1", costUsd: 0.01 }));
      await store.record(entry({ visitorId: "v2", costUsd: 0.02 }));
      await store.record(entry({ visitorId: "v1", costUsd: 0.005 }));
      expect(await store.costForVisitor("v1")).toBeCloseTo(0.015, 8);
      expect(await store.costForVisitor("v2")).toBeCloseTo(0.02, 8);
    });

    it("a null visitor id (unattributed call) is a legitimate, distinct bucket", async () => {
      await store.record(entry({ visitorId: null, costUsd: 0.03 }));
      // Not attributed to any named visitor, but still counted in the overall total.
      expect(await store.totalCostUsd()).toBeCloseTo(0.03, 8);
      expect(await store.costForVisitor("visitor-1")).toBe(0);
    });

    // #118 owner decision AC: an explicit deletion request nulls the visitor id and keeps the money —
    // totals before and after are identical.
    it("scrubVisitor nulls the visitor id and keeps the cost — totals unchanged before/after", async () => {
      await store.record(entry({ visitorId: "leaving", costUsd: 0.01 }));
      await store.record(entry({ visitorId: "staying", costUsd: 0.02 }));
      const before = await store.totalCostUsd();

      await store.scrubVisitor("leaving");

      const after = await store.totalCostUsd();
      expect(after).toBeCloseTo(before, 8);
      expect(await store.costForVisitor("leaving")).toBe(0); // the pseudonym is gone
      expect(await store.costForVisitor("staying")).toBeCloseTo(0.02, 8); // untouched
    });
  });
}

// #118 owner decision AC: "a ledger row carries no CV text, no user answer text, no requirement or
// advert text and no model-written prose — proven by test, not by review." Proven for the in-memory
// driver by reaching into its internal array: record()'s field-by-field copy (never `{...entry}`)
// means a smuggled extra field never survives even here, where nothing forces the shape the way a Pg
// column list does.
describe("InMemoryUsageLedgerStore — the row payload is a privacy boundary here too", () => {
  it("a stored entry has exactly the allowed fields, even if the caller's object carried more", async () => {
    const store = new InMemoryUsageLedgerStore();
    await store.init();

    const smuggled = {
      ...entry(),
      cvText: "This is my whole CV, verbatim.",
      requirementText: "Must have 8 years of budget ownership",
      reason: "Model-written verdict prose that must never be persisted here.",
    } as unknown as UsageLedgerEntry;
    await store.record(smuggled);

    const stored = (store as unknown as { entries: UsageLedgerEntry[] }).entries;
    expect(stored).toHaveLength(1);
    expect(Object.keys(stored[0]!).sort()).toEqual(
      ["visitorId", "stage", "model", "inputTokens", "outputTokens", "measured", "costUsd", "at"].sort(),
    );
  });
});

// Same proof against the Pg driver's actual persisted columns.
describe("PgUsageLedgerStore — the row payload is a privacy boundary, not a convention", () => {
  it("a stored row has exactly the allowed columns, even if the caller's object carried more", async () => {
    const pool = pgPool();
    const store = new PgUsageLedgerStore(pool);
    await store.init();

    const smuggled = {
      ...entry(),
      cvText: "This is my whole CV, verbatim.",
      requirementText: "Must have 8 years of budget ownership",
      reason: "Model-written verdict prose that must never be persisted here.",
    } as unknown as UsageLedgerEntry;
    await store.record(smuggled);

    const { rows } = await pool.query(`SELECT * FROM llm_usage_ledger`);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      ["id", "visitor_id", "stage", "model", "input_tokens", "output_tokens", "measured", "cost_usd", "created_at"].sort(),
    );
  });
});
