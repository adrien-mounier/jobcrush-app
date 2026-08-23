// #118 — meter every model call at the seam, by wrapping. main.ts hands each pipeline step an
// already-metered LlmClient rather than the raw driver, so a step can't spend without being counted:
// there is no second, unwrapped code path a caller could reach for instead. Mirrors the existing
// completeWithCost idiom (adReader.ts/judge.ts) for telling a measured driver from an unmeasured one,
// but writes to the durable ledger instead of a per-row cost object, and does it for every spending
// stage, not only the two (adReader, judge) that already track their own cost for other tickets' ACs.
import { canonicalModelName, type LlmClient } from "./llm.js";
import { computeCostUsd, type PricingTable } from "./llmPricing.js";
import { currentVisitorId } from "./llmVisitorContext.js";
import { incrementCounter } from "./counters.js";
import type { LlmStage, UsageLedgerStore } from "./usageLedgerStore.js";

/** A metered client, plus a test-only hook. Production code never calls flushForTest — see its own
 *  doc below for why. */
export interface MeteredLlmClient extends LlmClient {
  /** Test-only: resolves once every ledger write kicked off by a call so far has settled (success or
   *  failure — a failed write still resolves this, after logging + counting it). Lets a test observe
   *  the write deterministically without a sleep, without putting the write back on the model call's
   *  own return path in production. */
  flushForTest(): Promise<void>;
}

/**
 * Wraps `inner` so every completed call records exactly one ledger row, tagged with `stage` — fixed
 * at construction, never decided per call (main.ts builds one wrapper per spending stage, even when
 * several stages share the same underlying driver instance).
 *
 * `complete()` and `completeWithUsage()` never double-record each other: `complete()` reaches into
 * `inner.completeWithUsage` directly when it exists, never through this wrapper's own instrumented
 * method, so whichever one a caller uses, the call is recorded exactly once. adReader.ts's
 * completeWithCost picks between the two exactly the way it always has — this wrapper changes
 * nothing about that contract, only adds one ledger write alongside whichever path runs.
 *
 * A driver with no `completeWithUsage` (the CLI driver) records tokens and cost as null with
 * `measured: false` — never an estimate. The wrapped client only exposes `completeWithUsage` when
 * `inner` does, so a caller checking `if (llm.completeWithUsage)` (completeWithCost) still sees the
 * true capability of the underlying driver, not a capability this wrapper doesn't actually have.
 * A response that reports EXACTLY zero input AND zero output tokens is treated the same way — that
 * shape is llm.ts's own `?? 0` fallback for a genuinely MISSING usage block (AnthropicLlm.request),
 * never a real answer (no request has zero input tokens; the prompt alone is never empty), so
 * recording it as measured would durably store a $0 "measurement" that is actually an absent one.
 * Fixed here rather than in llm.ts: llm.ts's completeWithUsage return shape is depended on by
 * adReader.ts/judge.ts's own already-shipped per-row cost records (completeWithCost), and changing
 * it there would ripple into those tickets' committed behavior for no gain — the ledger is the only
 * thing that needs the "was this genuinely measured" distinction sharpened.
 *
 * The ledger write itself is fire-and-forget, never on the model call's own return path: `record()`
 * computes the row (including reading the ambient visitor) synchronously, then kicks off
 * `ledger.record(...)` without awaiting it. A slow or wedged store must never add latency to a paid
 * model call — this repo's own #115 read-timeout deadline would otherwise turn a slow ledger write
 * into a dropped card. A failure is logged AND counted (usageLedger.write_failed, counters.ts) so a
 * metering outage is an observable signal on /ops/counters, never just a swallowed log line — the
 * same resilience-with-observability convention adRequirementsStore/judgementStore already use for
 * their own store-write failures, extended here with the counter those write-failure paths already
 * pair a log with.
 *
 * Two accepted limits, carried deliberately rather than fixed in this slice:
 * - A driver call that THROWS (network error, provider timeout) records nothing at all — there is no
 *   partial row for a request that never produced a usable response. If the caller's own timeout
 *   fires before the provider's, the provider may still have served (and will still bill) the
 *   request; this under-reports true spend in that narrow window but never misattributes it to the
 *   wrong stage or visitor.
 * - #282 opened a SECOND recording path: employerLookup.ts writes its own ledger row, because
 *   Anthropic charges per web search on top of the tokens and PricingTable is per-token only. It
 *   deliberately mirrors this function's rules — fire-and-forget, usageLedger.write_failed on a
 *   failed write — but it is not this wrapper, so a change to the row shape has to be made in both.
 *   Recorded here rather than left for someone to find: the guarantee below is about call sites, and
 *   this is the first one that legitimately does not use this seam.
 * - The "impossible to spend unmetered" guarantee this file provides is only as good as every call
 *   site actually using it. Nothing enforces that main.ts hands each pipeline step a client that has
 *   been through meterLlm rather than the raw driver — a future stage wired directly to `llm` would
 *   spend unmetered with no test failing to say so. This rests on convention (main.ts's own
 *   wrap-everything pattern), not on the type system.
 */
export function meterLlm(
  inner: LlmClient,
  stage: LlmStage,
  ledger: UsageLedgerStore,
  pricing: PricingTable,
): MeteredLlmClient {
  // Tracks in-flight (fire-and-forgotten) ledger writes so flushForTest() can await them
  // deterministically — production code never reads this set.
  const pending = new Set<Promise<void>>();

  const record = (inputTokens: number | null, outputTokens: number | null, measured: boolean): void => {
    const model = canonicalModelName(inner.model ?? "unknown");
    const costUsd =
      measured && inputTokens !== null && outputTokens !== null
        ? computeCostUsd(model, inputTokens, outputTokens, pricing)
        : null;
    const write = ledger
      .record({
        visitorId: currentVisitorId(),
        stage,
        model,
        inputTokens,
        outputTokens,
        measured,
        costUsd,
        at: new Date().toISOString(),
      })
      .catch((err) => {
        incrementCounter("usageLedger.write_failed");
        console.error(
          `[ops] usage ledger record failed for stage ${stage}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    pending.add(write);
    void write.finally(() => pending.delete(write));
  };

  /** A measured usage block whose tokens are both exactly zero is llm.ts's missing-usage-block
   *  fallback, not a real measurement — see this function's own doc above. */
  const recordUsage = (usage: { inputTokens: number; outputTokens: number }): void => {
    if (usage.inputTokens === 0 && usage.outputTokens === 0) {
      record(null, null, false);
    } else {
      record(usage.inputTokens, usage.outputTokens, true);
    }
  };

  const metered: MeteredLlmClient = {
    model: inner.model,
    async complete(prompt, opts) {
      if (inner.completeWithUsage) {
        const { text, usage } = await inner.completeWithUsage(prompt, opts);
        recordUsage(usage);
        return text;
      }
      const text = await inner.complete(prompt, opts);
      record(null, null, false);
      return text;
    },
    async flushForTest() {
      await Promise.all([...pending]);
    },
  };

  if (inner.completeWithUsage) {
    metered.completeWithUsage = async (prompt, opts) => {
      const result = await inner.completeWithUsage!(prompt, opts);
      recordUsage(result.usage);
      return result;
    };
  }

  return metered;
}
