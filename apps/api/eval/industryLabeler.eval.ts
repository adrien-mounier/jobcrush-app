// #283 / ADR-0014 decision 6, spec #279 — the INDUSTRY labeler is trusted only after it passes
// this, and every later prompt or vocabulary change re-runs it before it is believed.
//
// NOT fast-lane CI: every case is a real model call, and every distinct employer is a real, paid
// web lookup through the same makeEmployerLookup production wires — both evidence sources, because
// a grid that measures a different setup than the one serving visitors proves nothing. Run it
// deliberately:
//   pnpm --filter @jobcrush/api eval:industry-labeler
// with ANTHROPIC_API_KEY set (the .env at the repo root carries it; vitest does not load .env
// itself). Without the key the model run FAILS before spending anything: the CLI fallback is a
// different driver with no employer lookup, so a green from it would gate nothing while looking
// exactly like a gate — spec #279's own trap note, enforced.
//
// The pairs test costs nothing and needs no key: closeness is data read off the published group
// tree. It is the check that catches a group drawn too wide — a far pair reading near fails here,
// and the fix is to split the group and re-publish the vocabulary, never to delete the pair.
import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, canonicalModelName, llmFromEnv } from "../src/llm.js";
import { computeCostUsd, pricingTableFromEnv } from "../src/llmPricing.js";
import {
  InMemoryEmployerLookupStore,
  makeEmployerLookup,
  webSearchUsdPerSearch,
} from "../src/employerLookup.js";
import { InMemoryUsageLedgerStore, type UsageLedgerEntry } from "../src/usageLedgerStore.js";
import { BARS } from "./harness.js";
import {
  describeCategories,
  describeIndustryMisses,
  rateIndustryGrid,
  runClosenessPairs,
  runIndustryGrid,
} from "./industryHarness.js";

// One call at a time by default, for harness.ts's measured reason (the CLI fallback fails under
// concurrency). Against the real API, EVAL_CONCURRENCY=4 is safe and much faster — each case waits
// on a web lookup before its labeler call.
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 1);

/** Counts the lookup's billed calls beside the dollars the ledger already carries, so the spend
 *  line can report both — calls, not dollars, is usually the tighter cap. */
class CountingLedger extends InMemoryUsageLedgerStore {
  billedCalls = 0;
  override async record(entry: UsageLedgerEntry): Promise<void> {
    this.billedCalls++;
    return super.record(entry);
  }
}

describe("#283 the industry labeler measurement grid", () => {
  it("reads every near pair near and every far pair far off the published group tree", () => {
    const results = runClosenessPairs();
    const near = results.filter((pair) => pair.expected === "near");
    const far = results.filter((pair) => pair.expected === "far");
    for (const pair of results.filter((item) => !item.hit)) {
      console.error(
        `PAIR MISS ${pair.id}: ${pair.held} vs ${pair.required} expected ${pair.expected}, reads ${pair.observed}` +
          (pair.expected === "far"
            ? " — a group is drawn too wide: split it, re-publish the vocabulary, re-run"
            : " — these industries are no longer grouped together"),
      );
    }
    console.log(
      `closeness pairs: ${near.filter((pair) => pair.hit).length}/${near.length} near pairs read near | ${far.filter((pair) => pair.hit).length}/${far.length} far pairs read far`,
    );
    expect(results.filter((pair) => !pair.hit).map((pair) => pair.id)).toEqual([]);
  });

  it(
    "meets the bars ADR-0014 requires before the labeler is trusted",
    { timeout: 60 * 60 * 1000 },
    async () => {
      // The setup production actually wires (main.ts): the app's default Anthropic client for the
      // placement call, and makeEmployerLookup — web search on Anthropic's own API — in front of
      // it. The Fireworks family model is deliberately NOT this labeler's model.
      const apiKey = process.env.ANTHROPIC_API_KEY;
      // Fail before any spend, not after: without the key llmFromEnv falls back to the local CLI —
      // a different driver with no server-side web search — and a green from that setup would look
      // like a gate while measuring nothing production runs.
      expect(
        apiKey,
        "ANTHROPIC_API_KEY is not set — this grid measures the setup production wires (the API model plus the real employer lookup), and the CLI fallback is neither",
      ).toBeTruthy();
      const llm = llmFromEnv();
      const model = canonicalModelName(llm.model ?? "(unknown)");
      const pricing = pricingTableFromEnv();
      const ledger = new CountingLedger();
      const lookupEmployer = makeEmployerLookup({
        apiKey: apiKey!,
        store: new InMemoryEmployerLookupStore(),
        ledger,
        pricing,
      });
      console.log(
        `grid running against: ${model} (AnthropicLlm) with the real employer web lookup — the setup production wires for industry-placement`,
      );

      const results = await runIndustryGrid(llm, { concurrency: CONCURRENCY, lookupEmployer });

      // Before any rate is believed: a run where calls failed or came back unparseable measured the
      // driver, not the labeler. Say so and stop, rather than reporting a number built on it.
      const degraded = results.filter((item) => item.degraded);
      if (degraded.length > 0) {
        console.error(
          `${degraded.length} of ${results.length} cases DEGRADED (call failed or output unparseable): ${degraded.map((item) => item.id).join(", ")}`,
        );
      }
      expect(degraded.map((item) => item.id), "the run measured its own driver").toEqual([]);

      const rates = rateIndustryGrid(results);
      for (const line of describeIndustryMisses(results)) console.error(line);
      console.log(
        `\n${results.length} cases | comparable accuracy ${(rates.comparableAccuracy * 100).toFixed(1)}% (bar 95) | stranger catch-rate ${(rates.strangerRecall * 100).toFixed(1)}% (bar 90) | false-unknown ${(rates.falseUnknownRate * 100).toFixed(1)}% (bar 5)` +
          // Reported, never barred: the industries are the gate. The multi-industry count is the
          // signal that says whether the instruction is holding the line at two.
          ` | confidence ${(rates.confidenceAccuracy * 100).toFixed(1)}% (reported, no bar) | ${rates.multiIndustryCount} placements named more than one industry\n`,
      );
      // The ticket's own categories, each on its own number: consultants (multi), the one-client
      // controls (ctrl), unknown small employers (unk), strangers (str), and the rest.
      console.log(`by category: ${describeCategories(results)}`);

      // The spend, as a call count and a dollar figure, priced from the providers' published prices
      // as this repo holds them (llmPricing.ts's table, employerLookup.ts's per-search rate — both
      // env-overridable the day a provider re-prices).
      const labelerCalls = results.reduce((sum, item) => sum + item.calls, 0);
      const inputTokens = results.reduce((sum, item) => sum + item.inputTokens, 0);
      const outputTokens = results.reduce((sum, item) => sum + item.outputTokens, 0);
      const labelerUsd = computeCostUsd(model, inputTokens, outputTokens, pricing);
      const lookupUsd = await ledger.totalCostUsd();
      console.log(
        `spend: ${labelerCalls} labeler calls (${inputTokens} in / ${outputTokens} out tokens${labelerUsd === null ? ", unpriced model" : `, $${labelerUsd.toFixed(4)} at ${model}'s published rate`}) + ${ledger.billedCalls} billed employer lookups ($${lookupUsd.toFixed(4)}: tokens plus $${webSearchUsdPerSearch().toFixed(2)}/search)` +
          ` = $${((labelerUsd ?? 0) + lookupUsd).toFixed(4)}${labelerUsd === null ? " plus unpriced labeler tokens" : ""}`,
      );

      expect(rates.comparableAccuracy).toBeGreaterThanOrEqual(BARS.comparableAccuracy);
      expect(rates.strangerRecall).toBeGreaterThanOrEqual(BARS.strangerRecall);
      expect(rates.falseUnknownRate).toBeLessThanOrEqual(BARS.falseUnknownRate);
    },
  );
});
