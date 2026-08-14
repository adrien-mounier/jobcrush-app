// Which model should sit behind the job labeler? (#220, owner request 2026-08-15.)
//
// A REPORT, not a gate — it asserts nothing about which model wins, it runs the same 60-case grid
// against each candidate and prints score against cost so the owner can decide. The gate is
// familyLabeler.eval.ts, run against whichever model production ends up wiring.
//
//   FIREWORKS_API_KEY=... pnpm --filter @jobcrush/api eval:bakeoff
//
// Every Fireworks candidate is billed to the owner's own account, so keep the set deliberate: one
// run is 60 calls per model, a few cents each at these rates.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import type { LlmClient } from "../src/llm.js";
import { ClaudeCliLlm, AnthropicLlm, FireworksLlm, DEFAULT_MODEL } from "../src/llm.js";
import { BARS, describeMisses, rateGrid, runGrid } from "./harness.js";

interface Candidate {
  name: string;
  /** USD per million tokens. Source: docs.fireworks.ai/serverless/pricing + Anthropic's published
   *  standard rate, both read 2026-08-15. Rates move — re-read before quoting these at anyone. */
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  /** Absent → this candidate is skipped (no key for it in this environment), and the report says so
   *  rather than silently reporting a shorter table. */
  build: () => LlmClient | null;
  note?: string;
}

const fireworks = (name: string, model: string, input: number, output: number, note?: string): Candidate => ({
  name,
  inputPerMillionUsd: input,
  outputPerMillionUsd: output,
  note,
  build: () => {
    const key = process.env.FIREWORKS_API_KEY;
    return key ? new FireworksLlm(`accounts/fireworks/models/${model}`, key) : null;
  },
});

const CANDIDATES: Candidate[] = [
  // --- the owner's three ---
  fireworks("GLM 5.2", "glm-5p2", 1.4, 4.4),
  fireworks("Kimi K2.6", "kimi-k2p6", 0.95, 4.0),
  fireworks("DeepSeek V4 Pro", "deepseek-v4-pro", 1.74, 3.48),
  // --- added on cost/quality grounds: this job is closed-list classification with a short answer,
  // which is the shape small models are usually good at. If one of these clears the bar, the app's
  // labeling cost drops by more than an order of magnitude against the frontier tier. ---
  fireworks("DeepSeek V4 Flash", "deepseek-v4-flash", 0.14, 0.28, "12x cheaper than GLM 5.2"),
  fireworks("Qwen 3.7 Plus", "qwen3p7-plus", 0.4, 1.6),
  fireworks("MiniMax M3", "minimax-m3", 0.3, 1.2),
  fireworks("GPT-OSS 120B", "gpt-oss-120b", 0.15, 0.6),
  fireworks("Nemotron 3.5 Lightning 30B", "nemotron-lightning-3p5-30b-a3b", 0.05, 0.2, "cheapest on the menu"),
  // --- the baseline the prompts were actually written against ---
  {
    name: "Claude Sonnet 5 (API)",
    inputPerMillionUsd: 3.0,
    outputPerMillionUsd: 15.0,
    build: () => {
      const key = process.env.ANTHROPIC_API_KEY;
      return key ? new AnthropicLlm(key, DEFAULT_MODEL) : null;
    },
  },
  {
    name: "Claude Sonnet (local CLI)",
    // Free at the point of use (it rides the developer's Claude Code subscription), which is
    // exactly why its cost column is meaningless — shown as 0 and not comparable to the rest.
    inputPerMillionUsd: 0,
    outputPerMillionUsd: 0,
    note: "not the production path — a proxy baseline, and it fails under concurrency",
    build: () => (process.env.BAKEOFF_INCLUDE_CLI === "1" ? new ClaudeCliLlm() : null),
  },
];

const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 6);

describe("#220 which model should label jobs", () => {
  it("scores every candidate against the same grid", { timeout: 2 * 60 * 60 * 1000 }, async () => {
    const rows: string[] = [];
    // Written to disk as well as printed: a ten-minute paid run whose only record is a console line
    // is one truncated pipe away from having to be paid for again (it was, once).
    const report: unknown[] = [];
    for (const candidate of CANDIDATES) {
      const llm = candidate.build();
      if (!llm) {
        rows.push(`${candidate.name.padEnd(28)} SKIPPED (no key in this environment)`);
        report.push({ model: candidate.name, skipped: true });
        continue;
      }
      const started = Date.now();
      const results = await runGrid(llm, { concurrency: CONCURRENCY });
      const rates = rateGrid(results);
      const inputTokens = results.reduce((sum, item) => sum + item.inputTokens, 0);
      const outputTokens = results.reduce((sum, item) => sum + item.outputTokens, 0);
      const usd =
        (inputTokens / 1_000_000) * candidate.inputPerMillionUsd +
        (outputTokens / 1_000_000) * candidate.outputPerMillionUsd;
      const degraded = results.filter((item) => item.degraded).length;
      const passes =
        degraded === 0 &&
        rates.comparableAccuracy >= BARS.comparableAccuracy &&
        rates.strangerRecall >= BARS.strangerRecall &&
        rates.falseUnknownRate <= BARS.falseUnknownRate;

      console.error(`\n--- ${candidate.name} ---`);
      const misses = describeMisses(results);
      for (const line of misses) console.error(line);
      report.push({
        model: candidate.name,
        passes,
        ...rates,
        degraded,
        retried: results.filter((r) => r.retried).length,
        inputTokens,
        outputTokens,
        usdPer60: Number(usd.toFixed(5)),
        usdPer1000Visitors: Number(((usd / 60) * 1000).toFixed(3)),
        seconds: Math.round((Date.now() - started) / 1000),
        misses,
      });

      rows.push(
        [
          candidate.name.padEnd(28),
          passes ? "PASS" : "FAIL",
          `acc ${(rates.comparableAccuracy * 100).toFixed(1).padStart(5)}%`,
          `strangers ${(rates.strangerRecall * 100).toFixed(1).padStart(5)}%`,
          `false-unknown ${(rates.falseUnknownRate * 100).toFixed(1).padStart(5)}%`,
          `degraded ${String(degraded).padStart(2)}`,
          `retried ${String(results.filter((r) => r.retried).length).padStart(2)}`,
          `$${usd.toFixed(4)}/60`,
          `${Math.round((Date.now() - started) / 1000)}s`,
          candidate.note ?? "",
        ].join("  "),
      );
    }
    const out = join(dirname(fileURLToPath(import.meta.url)), "bakeoff-result.json");
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(
      `\n=== labeler model bake-off, 60 hand-labeled cases each ===\nbars: accuracy >= 95%, strangers >= 90%, false-unknown <= 5%, degraded = 0\n\n${rows.join("\n")}\n\nfull report: ${out}\n`,
    );
  });
});
