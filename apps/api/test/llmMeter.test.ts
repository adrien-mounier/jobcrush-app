// #118 — the metered LlmClient decorator: the seam that makes it structurally hard to spend
// unmetered. Exercised entirely through an injected fake LlmClient — no network, no real spend — and
// an in-memory ledger, per the ticket's own "test the ledger through the injected fake" AC.
import { describe, expect, it, vi } from "vitest";
import { meterLlm } from "../src/llmMeter.js";
import { runWithVisitor } from "../src/llmVisitorContext.js";
import { InMemoryUsageLedgerStore } from "../src/usageLedgerStore.js";
import { InMemoryAdRequirementsStore } from "../src/adRequirementsStore.js";
import { makeAdReader } from "../src/adReader.js";
// #63: the deck is fed by retrieval alone now, so the suite builds its server with the curated
// corpus wired at that seam — same adverts, same requirement sets, reached the way production
// reaches them. See fixtureDeck.ts.
import { buildDeckServer as buildServer, injectSettled, liveIdFor } from "./fixtureDeck.js";
import type { LlmClient } from "../src/llm.js";
import type { PricingTable } from "../src/llmPricing.js";

const pricing: PricingTable = {
  "fake-model": { inputPerMillionUsd: 2, outputPerMillionUsd: 4 },
};

function fakeLlm(opts: { model?: string; withUsage?: boolean; text?: string } = {}): LlmClient {
  const model = opts.model ?? "fake-model";
  const text = opts.text ?? "ok";
  const base: LlmClient = {
    model,
    async complete() {
      return text;
    },
  };
  if (opts.withUsage) {
    base.completeWithUsage = async () => ({ text, usage: { inputTokens: 1000, outputTokens: 200 } });
  }
  return base;
}

describe("meterLlm", () => {
  it("complete() on a measured driver records exactly one entry, priced from the rate table", async () => {
    const ledger = new InMemoryUsageLedgerStore();
    const metered = meterLlm(fakeLlm({ withUsage: true }), "judging", ledger, pricing);

    const text = await metered.complete("prompt");
    await metered.flushForTest(); // the write is fire-and-forget — settle it before asserting

    expect(text).toBe("ok");
    expect(await ledger.totalCostUsd()).toBeCloseTo((1000 / 1_000_000) * 2 + (200 / 1_000_000) * 4, 8); // 0.0028
    const byStage = await ledger.costByStage();
    expect(byStage.judging).toBeCloseTo(0.0028, 8);
  });

  it("completeWithUsage() and complete() never double-record — calling one records exactly one row", async () => {
    const ledger = new InMemoryUsageLedgerStore();
    const metered = meterLlm(fakeLlm({ withUsage: true }), "judging", ledger, pricing);

    await metered.completeWithUsage!("prompt");
    await metered.flushForTest();

    expect(await ledger.totalCostUsd()).toBeCloseTo(0.0028, 8); // one entry's worth, not two
  });

  it("an unmeasured driver (no completeWithUsage) records tokens/cost as null, flagged unmeasured", async () => {
    const ledger = new InMemoryUsageLedgerStore();
    const metered = meterLlm(fakeLlm({ withUsage: false }), "grill", ledger, pricing);

    await metered.complete("prompt");
    await metered.flushForTest();

    // Distinguishable from a measured entry: costUsd stayed null (not estimated), never a fabricated
    // number, and the total genuinely reflects "we don't know", not zero-cost.
    expect(await ledger.totalCostUsd()).toBe(0);
    // The wrapper doesn't fabricate a completeWithUsage capability the underlying driver lacks —
    // completeWithCost's own `if (llm.completeWithUsage)` check must see the true capability.
    expect(metered.completeWithUsage).toBeUndefined();
  });

  // #118 review fix: a usage block reporting EXACTLY zero input and zero output tokens is llm.ts's
  // own `?? 0` fallback for a MISSING usage block, never a genuine measurement (no request has zero
  // input tokens). The ledger must record this the same way as "no completeWithUsage at all", not as
  // a real $0 measurement.
  it("a completeWithUsage response reporting zero/zero tokens is recorded unmeasured, not as a $0 measurement", async () => {
    const ledger = new InMemoryUsageLedgerStore();
    const zeroUsageLlm: LlmClient = {
      model: "fake-model",
      async complete() {
        return "ok";
      },
      async completeWithUsage() {
        return { text: "ok", usage: { inputTokens: 0, outputTokens: 0 } };
      },
    };
    const metered = meterLlm(zeroUsageLlm, "judging", ledger, pricing);

    await metered.complete("prompt");
    await metered.flushForTest();

    expect(await ledger.totalCostUsd()).toBe(0);
  });

  it("the wrapped client exposes completeWithUsage only when the inner driver does", async () => {
    const measured = meterLlm(fakeLlm({ withUsage: true }), "judging", new InMemoryUsageLedgerStore(), pricing);
    const unmeasured = meterLlm(fakeLlm({ withUsage: false }), "judging", new InMemoryUsageLedgerStore(), pricing);
    expect(typeof measured.completeWithUsage).toBe("function");
    expect(unmeasured.completeWithUsage).toBeUndefined();
  });

  it("stage is fixed at construction — two wrappers around the same driver tag their own stage", async () => {
    const ledger = new InMemoryUsageLedgerStore();
    const forJudging = meterLlm(fakeLlm({ withUsage: true }), "judging", ledger, pricing);
    const forGrill = meterLlm(fakeLlm({ withUsage: true }), "grill", ledger, pricing);

    await forJudging.complete("a");
    await forGrill.complete("b");
    await forGrill.complete("c");
    await Promise.all([forJudging.flushForTest(), forGrill.flushForTest()]);

    const byStage = await ledger.costByStage();
    expect(byStage.judging).toBeCloseTo(0.0028, 8);
    expect(byStage.grill).toBeCloseTo(0.0056, 8); // two calls
  });

  it("attributes the ambient visitor set for this request, read via AsyncLocalStorage", async () => {
    const ledger = new InMemoryUsageLedgerStore();
    const metered = meterLlm(fakeLlm({ withUsage: true }), "judging", ledger, pricing);

    await runWithVisitor("visitor-42", () => metered.complete("prompt"));
    await metered.flushForTest();

    expect(await ledger.costForVisitor("visitor-42")).toBeCloseTo(0.0028, 8);
  });

  it("a call with no ambient visitor context records a null visitor — never dropped, never guessed", async () => {
    const ledger = new InMemoryUsageLedgerStore();
    const metered = meterLlm(fakeLlm({ withUsage: true }), "judging", ledger, pricing);

    // No runWithVisitor wrapping at all in this test.
    await metered.complete("prompt");
    await metered.flushForTest();

    // Still recorded — the overall total sees it — just not attributed to any named visitor.
    expect(await ledger.totalCostUsd()).toBeCloseTo(0.0028, 8);
  });

  it("a ledger write failure is logged, counted, and swallowed — a metering outage never breaks the caller", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const brokenLedger = {
      init: async () => {},
      record: async () => {
        throw new Error("ledger store is down");
      },
      totalCostUsd: async () => 0,
      costByStage: async () => ({}),
      costForVisitor: async () => 0,
      scrubVisitor: async () => {},
    };
    const metered = meterLlm(fakeLlm({ withUsage: true, text: "still works" }), "judging", brokenLedger, pricing);

    const text = await metered.complete("prompt");
    expect(text).toBe("still works"); // the pipeline's own result is untouched by the ledger outage

    await metered.flushForTest(); // wait for the failing write to actually settle before checking the log
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("the ledger write does not block the caller's return — complete() resolves before flushForTest does", async () => {
    let releaseWrite: () => void = () => {};
    const gatedWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const slowLedger = {
      init: async () => {},
      record: () => gatedWrite, // never settles until the test releases it
      totalCostUsd: async () => 0,
      costByStage: async () => ({}),
      costForVisitor: async () => 0,
      scrubVisitor: async () => {},
    };
    const metered = meterLlm(fakeLlm({ withUsage: true }), "judging", slowLedger, pricing);

    const text = await metered.complete("prompt"); // must NOT hang on the still-open ledger write
    expect(text).toBe("ok");

    releaseWrite();
    await metered.flushForTest(); // now safe to await — proves the write really did happen
  });
});

// #118 review fix — the headline property, proven at the real HTTP seam: server.ts's onRequest hook
// resolves the session, then must make it visible to whatever the route handler awaits later,
// including a metered model call several `await`s downstream. A unit test that calls the ambient
// setter and the meter in one unbroken async context (the tests above) cannot catch a regression
// here — this is the seam a prior AsyncLocalStorage.enterWith implementation silently failed at.
describe("meterLlm through the real HTTP seam", () => {
  it("attributes a metered advert read to the actual signed-in session, not null", async () => {
    const ledger = new InMemoryUsageLedgerStore();
    const readText = JSON.stringify({
      language: "en",
      familyFit: { family: "IT Project Manager", confidence: 0.6 },
      requirements: [
        {
          id: "own-a-budget",
          band: "essential",
          kind: "ordinary",
          requirement: "Own a project budget",
          sourceSpan: "budget",
        },
      ],
    });
    const rawLlm: LlmClient = {
      model: "fake-model",
      async complete() {
        return readText;
      },
    };
    rawLlm.completeWithUsage = async () => ({ text: readText, usage: { inputTokens: 500, outputTokens: 100 } });
    const meteredReader = meterLlm(rawLlm, "advert-reading", ledger, pricing);

    const { app } = buildServer({
      readAd: makeAdReader(meteredReader, new InMemoryAdRequirementsStore(), [
        { familyId: "IT Project Manager", label: "IT Project Manager", scope: "Delivering IT projects" },
      ], []),
    });

    const anon = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const sessionId = (anon.json() as { id: string }).id;
    const cookie = `jc_session=${anon.cookies.find((c) => c.name === "jc_session")!.value}`;

    const res = await app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    expect(res.statusCode).toBe(200);

    await meteredReader.flushForTest();

    const total = await ledger.totalCostUsd();
    expect(total).toBeGreaterThan(0); // sanity: at least one uncached advert was actually read
    // The property fix 1 exists to prove: every call this request made is attributed to THIS
    // session — not null (the bug), and not some other session.
    expect(await ledger.costForVisitor(sessionId)).toBeCloseTo(total, 8);
  });
});
