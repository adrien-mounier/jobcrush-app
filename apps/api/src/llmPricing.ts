// #118 — per-model input/output pricing, held as configuration rather than folded into the meter
// itself. A rate changing (Anthropic re-prices a model, a new model joins the pipeline) needs an env
// var, never a code change — that is the AC this file exists to satisfy.
import { incrementCounter } from "./counters.js";

export interface PricingRate {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export type PricingTable = Record<string, PricingRate>;

// The one model actually in production today (llm.ts's DEFAULT_MODEL / canonicalModelName's target).
// Rate is Anthropic's published claude-sonnet-5 STANDARD per-million-token price, not the temporary
// introductory discount running through 2026-08-31 — a default tied to a promotion would quietly go
// stale the day it ends. Override via LLM_PRICING_JSON below to reflect the discount, or whenever
// Anthropic re-prices the model — either way, no code change.
// #220 adds the second: the job labeler runs on MiniMax M3 via Fireworks (llm.ts's
// FAMILY_PLACEMENT_MODEL), keyed by the full Fireworks model id because that is the string the
// driver reports as .model and therefore what the ledger records. Rate read from
// docs.fireworks.ai/serverless/pricing on 2026-08-15; same standing rule as the Anthropic line
// above — when it moves, LLM_PRICING_JSON, not a code change.
export const DEFAULT_PRICING: PricingTable = {
  "claude-sonnet-5": { inputPerMillionUsd: 3.0, outputPerMillionUsd: 15.0 },
  "accounts/fireworks/models/minimax-m3": { inputPerMillionUsd: 0.3, outputPerMillionUsd: 1.2 },
};

/** A JSON object in the `{key: value}` sense — not null, not an array. `JSON.parse` happily returns
 *  either for a top-level `null`/`[...]` payload, and `Object.entries` on the former throws straight
 *  out of pricingTableFromEnv (QA: `LLM_PRICING_JSON=null` took the whole API down on boot). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True only for a rate with both fields present, numeric, finite, and NOT NEGATIVE — a partial entry
 *  (one key missing, e.g. a typo'd field name), a NaN/Infinity value, or a negative number all fail
 *  this. Zero is legitimate (a free or promotional model) and passes. QA's own failure modes: a
 *  partial rate parses as valid JSON, so JSON validity alone isn't enough — the shape has to be
 *  checked too, or `computeCostUsd`'s arithmetic silently produces NaN; and a negative rate is
 *  numeric and finite, so it looks valid by shape alone while durably running the total the wrong
 *  way. */
function isValidRate(rate: unknown): rate is PricingRate {
  if (!isPlainObject(rate)) return false;
  return (
    typeof rate.inputPerMillionUsd === "number" &&
    Number.isFinite(rate.inputPerMillionUsd) &&
    rate.inputPerMillionUsd >= 0 &&
    typeof rate.outputPerMillionUsd === "number" &&
    Number.isFinite(rate.outputPerMillionUsd) &&
    rate.outputPerMillionUsd >= 0
  );
}

/** Reads a per-model rate override from LLM_PRICING_JSON — a JSON object shaped like DEFAULT_PRICING
 *  — and merges it over the in-repo default: a VALID entry for a given model replaces that model's
 *  default rate; every model the override doesn't mention, or mentions with an invalid rate, keeps
 *  its default (or stays unrated, for a model with no default) rather than merging a broken one in.
 *  Malformed JSON, or a malformed individual entry, is rejected loudly — a console.error plus
 *  usageLedger.pricing_override_rejected (counters.ts) — rather than silently poisoning every cost
 *  figure computed after boot. */
export function pricingTableFromEnv(env: NodeJS.ProcessEnv = process.env): PricingTable {
  const raw = env.LLM_PRICING_JSON;
  if (!raw) return { ...DEFAULT_PRICING };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(
      `[ops] LLM_PRICING_JSON is not valid JSON, using defaults: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ...DEFAULT_PRICING };
  }

  // A syntactically valid JSON value that isn't a {model: rate} object — `null`, an array, a bare
  // number/string/boolean — parses fine but has no per-model entries to read; Object.entries on it
  // either throws (null) or reads nonsense (an array's own indices as "model names"). Reject it the
  // same loud way as a bad individual entry, and boot on defaults rather than crash.
  if (!isPlainObject(parsed)) {
    incrementCounter("usageLedger.pricing_override_rejected");
    console.error(`[ops] LLM_PRICING_JSON is not a {model: rate} object, using defaults: ${JSON.stringify(parsed)}`);
    return { ...DEFAULT_PRICING };
  }
  const overrides = parsed;

  const table: PricingTable = { ...DEFAULT_PRICING };
  for (const [model, rate] of Object.entries(overrides)) {
    if (isValidRate(rate)) {
      table[model] = rate;
    } else {
      incrementCounter("usageLedger.pricing_override_rejected");
      console.error(
        `[ops] LLM_PRICING_JSON entry for "${model}" is not a valid {inputPerMillionUsd, outputPerMillionUsd} rate — ` +
          `keeping the existing rate for that model instead: ${JSON.stringify(rate)}`,
      );
    }
  }
  return table;
}

/** Money for one call, computed from the rate IN FORCE right now — the caller persists the result
 *  immediately alongside the token counts, so a later rate change never rewrites history (#118 AC).
 *  Null when `model` has no configured rate: an unpriced model's cost is real but unknown, and this
 *  never estimates one. Also null — never NaN or Infinity — if the arithmetic itself doesn't produce
 *  a finite number: pricingTableFromEnv already rejects a non-finite rate before it reaches a table,
 *  but this is the last line of defense for any table built another way, so a bad rate can never
 *  reach the ledger as a value that LOOKS like real money. Tokens are computed and returned by the
 *  caller regardless — only the money is ever withheld, so cost stays recomputable later. */
export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  table: PricingTable,
): number | null {
  const rate = table[model];
  if (!rate) return null;
  const cost = (inputTokens / 1_000_000) * rate.inputPerMillionUsd + (outputTokens / 1_000_000) * rate.outputPerMillionUsd;
  return Number.isFinite(cost) ? cost : null;
}
