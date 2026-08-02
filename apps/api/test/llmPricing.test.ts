// #118 — pricing is configuration: a per-model rate table with a documented in-repo default, and an
// env override that changes a rate with no code change. Pure functions, tested directly.
import { afterEach, describe, expect, it, vi } from "vitest";
import { newDb } from "pg-mem";
import { DEFAULT_PRICING, computeCostUsd, pricingTableFromEnv } from "../src/llmPricing.js";
import { readCounters } from "../src/counters.js";
import { InMemoryUsageLedgerStore, PgUsageLedgerStore, type UsageLedgerStore } from "../src/usageLedgerStore.js";

function pgPool() {
  const { Pool } = newDb().adapters.createPg();
  return new Pool();
}

describe("DEFAULT_PRICING", () => {
  it("covers the one model actually in production today", () => {
    expect(DEFAULT_PRICING["claude-sonnet-5"]).toEqual({ inputPerMillionUsd: 3.0, outputPerMillionUsd: 15.0 });
  });
});

describe("pricingTableFromEnv", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns the default table when no override is set", () => {
    expect(pricingTableFromEnv({})).toEqual(DEFAULT_PRICING);
  });

  it("an override for one model replaces its rate and leaves every other model's default alone", () => {
    const table = pricingTableFromEnv({
      LLM_PRICING_JSON: JSON.stringify({ "claude-sonnet-5": { inputPerMillionUsd: 1, outputPerMillionUsd: 2 } }),
    });
    expect(table["claude-sonnet-5"]).toEqual({ inputPerMillionUsd: 1, outputPerMillionUsd: 2 });
  });

  it("an override can also ADD a rate for a model with no in-repo default", () => {
    const table = pricingTableFromEnv({
      LLM_PRICING_JSON: JSON.stringify({ "claude-opus-5": { inputPerMillionUsd: 5, outputPerMillionUsd: 25 } }),
    });
    expect(table["claude-opus-5"]).toEqual({ inputPerMillionUsd: 5, outputPerMillionUsd: 25 });
    expect(table["claude-sonnet-5"]).toEqual(DEFAULT_PRICING["claude-sonnet-5"]);
  });

  it("malformed JSON falls back to the default table rather than crashing boot", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const table = pricingTableFromEnv({ LLM_PRICING_JSON: "{not json" });
    expect(table).toEqual(DEFAULT_PRICING);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  // QA's own failure mode: a PARTIAL entry is perfectly valid JSON, so JSON.parse alone can't catch
  // it — the shape has to be validated too, or computeCostUsd silently divides by nothing into NaN.
  describe("a malformed individual entry (valid JSON, invalid rate) is rejected, not merged", () => {
    it("a partial rate (missing outputPerMillionUsd) for a model WITH a default keeps that default", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const before = readCounters()["usageLedger.pricing_override_rejected"];

      const table = pricingTableFromEnv({
        LLM_PRICING_JSON: JSON.stringify({ "claude-sonnet-5": { inputPerMillionUsd: 3 } }),
      });

      expect(table["claude-sonnet-5"]).toEqual(DEFAULT_PRICING["claude-sonnet-5"]); // untouched, not merged-broken
      expect(errorSpy).toHaveBeenCalled();
      expect(readCounters()["usageLedger.pricing_override_rejected"]).toBe(before + 1);
      errorSpy.mockRestore();
    });

    it("a partial rate for a model with NO default leaves that model unrated, not NaN-rated", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const table = pricingTableFromEnv({
        LLM_PRICING_JSON: JSON.stringify({ "claude-opus-5": { outputPerMillionUsd: 25 } }),
      });
      expect(table["claude-opus-5"]).toBeUndefined();
      expect(computeCostUsd("claude-opus-5", 1000, 1000, table)).toBeNull(); // unpriced, never NaN
      errorSpy.mockRestore();
    });

    it.each([
      ["a non-finite rate (NaN)", { inputPerMillionUsd: NaN, outputPerMillionUsd: 15 }],
      ["a non-finite rate (Infinity)", { inputPerMillionUsd: 3, outputPerMillionUsd: Infinity }],
      ["a rate given as a string", { inputPerMillionUsd: "3", outputPerMillionUsd: 15 }],
      ["an empty object", {}],
      // QA: numeric and finite passes the shape check on its own — a negative number needs its own
      // rejection, or a stray minus sign durably runs the running total the wrong way.
      ["a negative input rate", { inputPerMillionUsd: -3, outputPerMillionUsd: 15 }],
      ["a negative output rate", { inputPerMillionUsd: 3, outputPerMillionUsd: -0.006 }],
    ])("%s is rejected, keeping the existing default", (_label, badRate) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const table = pricingTableFromEnv({
        LLM_PRICING_JSON: JSON.stringify({ "claude-sonnet-5": badRate }),
      });
      expect(table["claude-sonnet-5"]).toEqual(DEFAULT_PRICING["claude-sonnet-5"]);
      errorSpy.mockRestore();
    });

    // Zero is legitimate money (a free or promotional model) — must NOT be caught by the negative-rate
    // rejection above.
    it("a zero rate is accepted, not rejected as invalid", () => {
      const table = pricingTableFromEnv({
        LLM_PRICING_JSON: JSON.stringify({ "claude-opus-5": { inputPerMillionUsd: 0, outputPerMillionUsd: 0 } }),
      });
      expect(table["claude-opus-5"]).toEqual({ inputPerMillionUsd: 0, outputPerMillionUsd: 0 });
    });

    // QA: `LLM_PRICING_JSON=null` (the literal string) parses to the JSON value `null`, and
    // Object.entries(null) throws straight out of this function, uncaught at main.ts's call site —
    // a config typo took the whole API down on boot rather than falling back to defaults.
    it.each([
      ["the literal JSON null", "null"],
      ["a JSON array instead of an object", "[1,2,3]"],
      ["a bare JSON string", '"just a string"'],
      ["a bare JSON number", "42"],
      ["a bare JSON boolean", "true"],
    ])("%s does not throw — falls back to defaults, logged and counted", (_label, jsonPayload) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const before = readCounters()["usageLedger.pricing_override_rejected"];

      expect(() => pricingTableFromEnv({ LLM_PRICING_JSON: jsonPayload })).not.toThrow();
      const table = pricingTableFromEnv({ LLM_PRICING_JSON: jsonPayload });

      expect(table).toEqual(DEFAULT_PRICING);
      expect(errorSpy).toHaveBeenCalled();
      expect(readCounters()["usageLedger.pricing_override_rejected"]).toBeGreaterThan(before);
      errorSpy.mockRestore();
    });
  });
});

describe("computeCostUsd", () => {
  const table = { "claude-sonnet-5": { inputPerMillionUsd: 3, outputPerMillionUsd: 15 } };

  it("computes money from the per-million rate", () => {
    // 1,000,000 input tokens @ $3/M + 500,000 output tokens @ $15/M = $3 + $7.5 = $10.50
    expect(computeCostUsd("claude-sonnet-5", 1_000_000, 500_000, table)).toBeCloseTo(10.5, 6);
  });

  it("returns null for a model with no configured rate — never an estimate", () => {
    expect(computeCostUsd("some-unpriced-model", 1000, 1000, table)).toBeNull();
  });

  // Defense in depth, independent of pricingTableFromEnv's own validation — a table built any other
  // way (a future caller, a test) still can never produce a value that looks like real money.
  it("returns null, never NaN, if a table entry somehow carries a non-finite rate", () => {
    const brokenTable = { "claude-sonnet-5": { inputPerMillionUsd: NaN, outputPerMillionUsd: 15 } };
    const cost = computeCostUsd("claude-sonnet-5", 1000, 1000, brokenTable);
    expect(cost).toBeNull();
    expect(Number.isNaN(cost)).toBe(false);
  });
});

// #118 review fix — the end-to-end guarantee QA's fix demands: a malformed pricing override must
// never let a non-finite value reach a stored row, on EITHER driver (pg-mem accepts a NaN insert
// differently than real Postgres does — this is the seam the bug hid behind).
describe("a malformed pricing override can never produce a non-finite value in a stored row", () => {
  const drivers: [string, () => UsageLedgerStore][] = [
    ["in-memory", () => new InMemoryUsageLedgerStore()],
    ["postgres (pg-mem)", () => new PgUsageLedgerStore(pgPool())],
  ];

  for (const [name, make] of drivers) {
    it(`${name}: a partial override falls back to the default rate rather than storing NaN`, async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const table = pricingTableFromEnv({
        LLM_PRICING_JSON: JSON.stringify({ "claude-sonnet-5": { inputPerMillionUsd: 3 } }), // missing key
      });
      const cost = computeCostUsd("claude-sonnet-5", 1_000_000, 1_000_000, table);
      expect(cost).not.toBeNull();
      expect(Number.isFinite(cost as number)).toBe(true);

      const store = make();
      await store.init();
      await store.record({
        visitorId: "v1",
        stage: "judging",
        model: "claude-sonnet-5",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        measured: true,
        costUsd: cost,
        at: "2026-08-02T00:00:00.000Z",
      });

      const total = await store.totalCostUsd();
      expect(Number.isNaN(total)).toBe(false);
      expect(Number.isFinite(total)).toBe(true);
      expect(total).toBeCloseTo(cost as number, 8);
      errorSpy.mockRestore();
    });
  }
});
