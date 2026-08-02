// #103 (E5 slice 2) — the posting-pool counters: a language skip is counted once, at ingest, never
// per deck request; "und" (undetermined) is counted separately from a confirmed non-served-language
// skip (code review finding 3); and both stay separate from the (currently always-zero) failure
// counter that #104 (slice 3) is the first to increment.
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";
import { loadPostings } from "../src/preview.js";
import {
  computeReadFailureAlarm,
  computeReadTimeoutAlarm,
  incrementCounter,
  readCounters,
  readTimeoutAlarm,
  resetCountersForTest,
} from "../src/counters.js";
import { InMemoryUsageLedgerStore } from "../src/usageLedgerStore.js";

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
      "postings.read_timed_out": 0,
      "postings.fixture_invalid": 0,
      "adReader.read_succeeded": 0,
      "adReader.language_skipped": 0,
      "adReader.requirements_produced": 0,
      "adReader.requirements_blocking": 0,
      "adReader.blocking_clamped": 0,
      "adReader.cost_reads_recorded": 0,
      "adReader.cost_input_tokens_total": 0,
      "adReader.cost_output_tokens_total": 0,
      "postings.read_in_time": 0,
      "adReader.read_failure_rate_per_mille": 0,
      "adReader.read_failure_alarm_firing": 0,
      "adReader.read_timeout_rate_per_mille": 0,
      "adReader.read_timeout_alarm_firing": 0,
      // #105 (E5 slice 4) — see counters.ts's own header for what each one means.
      "judge.judged_succeeded": 0,
      "judge.judge_failed": 0,
      "judge.cost_reads_recorded": 0,
      "judge.cost_input_tokens_total": 0,
      "judge.cost_output_tokens_total": 0,
      "judge.fallback_used": 0,
      "judge.fallback_timeout": 0,
      // #118 — see counters.ts's own header for what these mean.
      "usageLedger.write_failed": 0,
      "usageLedger.pricing_override_rejected": 0,
      // #117 — see counters.ts's own header for what these mean.
      "judge.subset_reused": 0,
      "deck.cards_judged": 0,
      "deck.cards_pending": 0,
      "deck.cards_unscored": 0,
      "deck.cards_estimated": 0,
      "deck.judge_bound_hit": 0,
    });
  });
});

// #117 AC4/AC6/AC8 — /ops/spend: cost per visitor and the deck's fallback rate, together, from one
// run. Same OPS_KEY gate as /ops/read-failures — proven directly rather than assumed.
describe("#117 GET /ops/spend", () => {
  const OPS_KEY = "test-ops-key-117-spend";

  it("refuses without OPS_KEY set, and refuses without the right ?key= once it is", async () => {
    const { app } = buildServer();
    const noKeyAtAll = await app.inject({ method: "GET", url: "/ops/spend" });
    expect(noKeyAtAll.statusCode).toBe(403);

    const previous = process.env.OPS_KEY;
    process.env.OPS_KEY = OPS_KEY;
    try {
      const wrongKey = await app.inject({ method: "GET", url: "/ops/spend?key=nope" });
      expect(wrongKey.statusCode).toBe(403);
    } finally {
      if (previous === undefined) delete process.env.OPS_KEY;
      else process.env.OPS_KEY = previous;
    }
  });

  it("reports total spend, spend by stage, spend for a given visitor, and the deck's provenance tally together", async () => {
    const usageLedger = new InMemoryUsageLedgerStore();
    await usageLedger.record({
      visitorId: "visitor-1",
      stage: "judging",
      model: "claude-sonnet-5",
      inputTokens: 1000,
      outputTokens: 200,
      measured: true,
      costUsd: 0.05,
      at: new Date().toISOString(),
    });
    resetCountersForTest();
    incrementCounter("deck.cards_judged");
    incrementCounter("deck.cards_judged");
    incrementCounter("deck.cards_pending");
    incrementCounter("deck.cards_unscored");
    const { app } = buildServer({ usageLedger });
    const previous = process.env.OPS_KEY;
    process.env.OPS_KEY = OPS_KEY;
    try {
      const res = await app.inject({ method: "GET", url: `/ops/spend?key=${OPS_KEY}&visitorId=visitor-1` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        totalCostUsd: number;
        costByStage: Record<string, number>;
        visitorCostUsd: number | null;
        deck: { cardsJudged: number; cardsPending: number; cardsUnscored: number; fallbackRatePerMille: number };
      };
      expect(body.totalCostUsd).toBeCloseTo(0.05);
      expect(body.costByStage.judging).toBeCloseTo(0.05);
      expect(body.visitorCostUsd).toBeCloseTo(0.05);
      expect(body.deck.cardsJudged).toBe(2);
      expect(body.deck.cardsPending).toBe(1);
      expect(body.deck.cardsUnscored).toBe(1);
      // #117 must-fix D: denominator is EVERY card (judged+pending+unscored+estimated = 4);
      // numerator is every card with no honest number (pending+unscored = 2) — (1+1)/4 = 50%.
      expect(body.deck.fallbackRatePerMille).toBe(500);
    } finally {
      if (previous === undefined) delete process.env.OPS_KEY;
      else process.env.OPS_KEY = previous;
    }
  });

  it("omits visitorCostUsd (null) when no ?visitorId= is given", async () => {
    const { app } = buildServer();
    const previous = process.env.OPS_KEY;
    process.env.OPS_KEY = OPS_KEY;
    try {
      const res = await app.inject({ method: "GET", url: `/ops/spend?key=${OPS_KEY}` });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { visitorCostUsd: number | null }).visitorCostUsd).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.OPS_KEY;
      else process.env.OPS_KEY = previous;
    }
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

// #115 finding 1 — a systemic TIMEOUT spike must be as loud as a systemic validation-failure spike
// (spec story 26), on its OWN threshold (60% — see READ_TIMEOUT_ALARM's comment in counters.ts) so
// it isn't drowned out by, or confused with, the alarm above. Same shape of tests as "#104 the
// ad-reader read-failure alarm", mirroring it 1:1 — denominator is postings.read_in_time, NOT
// adReader.read_succeeded (round 2 of review: read_succeeded is a self-heal signal that arrives
// AFTER the deadline, on whatever later request triggers it, and using it as the denominator made
// the alarm asymptote toward its own threshold under a sustained incident instead of crossing it).
describe("#115 the read-timeout alarm", () => {
  it("stays not-firing below the minimum sample size, even at 100% timeouts", () => {
    expect(computeReadTimeoutAlarm(4, 0).firing).toBe(false); // 4 samples < minSamples (5)
  });

  it("stays not-firing exactly at the threshold rate — only OVER it fires", () => {
    expect(computeReadTimeoutAlarm(6, 4).firing).toBe(false); // 60% == threshold, not over
  });

  it("fires once both the sample size and the rate are crossed", () => {
    const alarm = computeReadTimeoutAlarm(7, 3);
    expect(alarm.firing).toBe(true); // 10 samples, 70% timed out
    expect(alarm.rate).toBeCloseTo(0.7);
    expect(alarm.sampleSize).toBe(10);
  });

  it("logs once on the transition into firing, not again while it stays firing, and independently of the failure alarm's own latch", () => {
    resetCountersForTest();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 3; i++) incrementCounter("postings.read_in_time"); // in time, never timed out
    expect(spy).not.toHaveBeenCalled();
    for (let i = 0; i < 7; i++) incrementCounter("postings.read_timed_out"); // now 7/10 = 70% — fires
    expect(spy).toHaveBeenCalledTimes(1);
    incrementCounter("postings.read_timed_out"); // stays firing — must not log a second time
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  // The regression this exists to prevent (#115 round 2): a self-healing read incrementing
  // adReader.read_succeeded used to recompute and dilute THIS alarm's rate too. It must not anymore.
  it("a self-heal (adReader.read_succeeded) never moves the timeout alarm's rate or firing state", () => {
    resetCountersForTest();
    for (let i = 0; i < 7; i++) incrementCounter("postings.read_timed_out");
    for (let i = 0; i < 3; i++) incrementCounter("postings.read_in_time"); // 70% — firing
    const before = readTimeoutAlarm();
    expect(before.firing).toBe(true);
    for (let i = 0; i < 50; i++) incrementCounter("adReader.read_succeeded"); // many self-heals land
    const after = readTimeoutAlarm();
    expect(after).toEqual(before); // completely unmoved
  });

  it("exposes firing + rate on /ops/counters, numbers only, without moving the read-failure alarm's own fields", async () => {
    resetCountersForTest();
    for (let i = 0; i < 3; i++) incrementCounter("postings.read_in_time");
    for (let i = 0; i < 7; i++) incrementCounter("postings.read_timed_out");
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/ops/counters" });
    const body = res.json() as Record<string, number>;
    expect(body["adReader.read_timeout_alarm_firing"]).toBe(1);
    expect(body["adReader.read_timeout_rate_per_mille"]).toBe(700);
    expect(body["adReader.read_failure_alarm_firing"]).toBe(0); // a timeout never moves this one
    expect(body["adReader.read_failure_rate_per_mille"]).toBe(0);
  });

  // The exact incident this alarm was designed against, replayed at its own numbers (#115 round 2
  // must-fix): total degradation reads 100% and fires; today's measured warm-up shape (3 timed out
  // of 7 deadline-bound attempts) reads 43% and stays quiet.
  it("total degradation (100% timed out) fires; the ticket's own measured warm-up shape (3/7 ≈ 43%) stays quiet", () => {
    const totalDegradation = computeReadTimeoutAlarm(7, 0);
    expect(totalDegradation.rate).toBe(1);
    expect(totalDegradation.firing).toBe(true);

    const measuredWarmup = computeReadTimeoutAlarm(3, 4);
    expect(measuredWarmup.rate).toBeCloseTo(3 / 7);
    expect(measuredWarmup.firing).toBe(false);
  });
});
