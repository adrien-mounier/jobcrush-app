// #103 (E5 slice 2) — the posting-pool counters: a language skip is counted once, at ingest, never
// per deck request; "und" (undetermined) is counted separately from a confirmed non-served-language
// skip (code review finding 3); and both stay separate from the (currently always-zero) failure
// counter that #104 (slice 3) is the first to increment.
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";
import { loadPostings } from "../src/preview.js";
import {
  computeReadFailureAlarm,
  incrementCounter,
  readCounters,
  resetCountersForTest,
} from "../src/counters.js";

describe("#103 posting-pool counters", () => {
  it("counts the fixture's one non-English posting as a skip exactly once, no matter how many times the pool is read, and never as undetermined or a failure", () => {
    loadPostings();
    loadPostings();
    loadPostings();
    expect(readCounters()["postings.language_skipped"]).toBe(1);
    expect(readCounters()["postings.language_undetermined"]).toBe(0); // no terse/ambiguous fixtures
    expect(readCounters()["postings.read_failed"]).toBe(0); // #104 is the first writer
  });

  // #104 deliberately changes this contract (six more counters + the alarm's two derived fields) —
  // the "numbers only, no PII" property is what's pinned, not the exact key set.
  it("exposes every counter, numbers only, on the open ops route", async () => {
    loadPostings(); // ensure ingest has happened at least once in this test file's module instance
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/ops/counters" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      "postings.language_skipped": 1,
      "postings.language_undetermined": 0,
      "postings.read_failed": 0,
      "postings.fixture_invalid": 0,
      "adReader.read_succeeded": 0,
      "adReader.language_skipped": 0,
      "adReader.requirements_produced": 0,
      "adReader.requirements_blocking": 0,
      "adReader.blocking_clamped": 0,
      "adReader.cost_reads_recorded": 0,
      "adReader.cost_input_tokens_total": 0,
      "adReader.cost_output_tokens_total": 0,
      "adReader.read_failure_rate_per_mille": 0,
      "adReader.read_failure_alarm_firing": 0,
    });
  });
});

// #104 — the read-failure alarm. resetCountersForTest gives each test a clean slate: the alarm's
// firing state depends on absolute totals (not deltas), and counters.ts's counts object is a
// module-level singleton shared by every test in this file.
describe("#104 the ad-reader read-failure alarm", () => {
  it("stays not-firing below the minimum sample size, even at 100% failure", () => {
    expect(computeReadFailureAlarm(4, 0).firing).toBe(false); // 4 samples < minSamples (5)
  });

  it("stays not-firing exactly at the threshold rate — only OVER it fires", () => {
    expect(computeReadFailureAlarm(2, 8).firing).toBe(false); // 20% == threshold, not over
  });

  it("fires once both the sample size and the rate are crossed", () => {
    const alarm = computeReadFailureAlarm(3, 7);
    expect(alarm.firing).toBe(true); // 10 samples, 30% failure
    expect(alarm.rate).toBeCloseTo(0.3);
    expect(alarm.sampleSize).toBe(10);
  });

  it("logs once on the transition into firing, not again while it stays firing", () => {
    resetCountersForTest();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 2; i++) incrementCounter("adReader.read_succeeded");
    expect(spy).not.toHaveBeenCalled(); // no samples have failed yet
    for (let i = 0; i < 3; i++) incrementCounter("postings.read_failed"); // now 3/5 = 60% — fires
    expect(spy).toHaveBeenCalledTimes(1);
    incrementCounter("postings.read_failed"); // stays firing — must not log a second time
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("exposes firing + rate on /ops/counters, numbers only (firing as 0/1, rate as parts-per-mille)", async () => {
    resetCountersForTest();
    for (let i = 0; i < 2; i++) incrementCounter("adReader.read_succeeded");
    for (let i = 0; i < 3; i++) incrementCounter("postings.read_failed");
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/ops/counters" });
    const body = res.json() as Record<string, number>;
    expect(body["adReader.read_failure_alarm_firing"]).toBe(1);
    expect(body["adReader.read_failure_rate_per_mille"]).toBe(600);
  });
});
