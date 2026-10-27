// #452 (spec #450, owner decisions on #446) — the letterhead reading's regression set: the real
// model reads ~80 letterhead layouts through #451's own step, and EVERY row must be right on name
// and city. Re-run before believing a change to prompts/letterhead-reader.md is an improvement.
//
// NOT fast-lane CI: every row is a real model call. Run it deliberately
//   pnpm --filter @jobcrush/api eval:letterhead
// (llmForStep: ANTHROPIC_API_KEY when set, otherwise the local Claude Code CLI, which costs nothing).
// Price the API route from llmPricing.ts before a run: ~1100 in / 100 out per row on claude-sonnet-5.
//
// The 2026-08-15 lesson (harness.ts): a thrown or unparseable call is an ERROR, reported on its own
// line and never counted as a wrong answer — the two must not share a representation. The run
// fails on any error and on any wrong row; the results are written to letterhead-result.json so the
// receipt survives stdout.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RawCv } from "../src/extract.js";
import { makeReadLetterheadStep } from "../src/letterheadReader.js";
import { llmForStep } from "../src/llm.js";
import { perCase } from "./harness.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GRID_PATH = join(HERE, "letterhead-grid.json");
const RESULT_PATH = join(HERE, "letterhead-result.json");

// One call at a time by default: the local CLI driver drops calls when several run at once
// (measured 2026-08-15 on the labeler grid). Raise with EVAL_CONCURRENCY against the API.
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 1);

/** The same short Experience block the source table (t/409-letterhead) put under every letterhead,
 *  so the model always sees a CV, not a bare header. */
const EXPERIENCE_TAIL = "\n\nExperience\nPM at X, Jan 2020 - Present\n- Led delivery";

interface GridCase {
  id: string;
  letterhead: string;
  name: string | null;
  location: string | null;
  note?: string;
}

interface CaseResult extends GridCase {
  observedName: string | null;
  observedLocation: string | null;
  /** The answer matched on both fields. Never true when `error` is set. */
  hit: boolean;
  /** The call threw or its answer could not be read. Not a wrong answer: the driver, not the prompt. */
  error?: string;
  /** The model's last reply, verbatim, so a wrong row can be told from a guard drop without a re-run. */
  raw: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

const allCases = (JSON.parse(readFileSync(GRID_PATH, "utf8")) as { cases: GridCase[] }).cases;
// EVAL_ONLY=id1,id2 re-runs a few rows while tuning the prompt; a full run is still the gate.
const only = process.env.EVAL_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
const cases = only?.length ? allCases.filter((c) => only.includes(c.id)) : allCases;

const rawCv = (text: string): RawCv => ({
  source: "paste",
  status: "ok",
  fullText: text,
  blocks: [],
  stats: { roles: 0, bullets: 0, chars: text.length, pages: null },
});

describe("#452 the letterhead grid", () => {
  it("every row is right on name and city, and no call failed", { timeout: 60 * 60 * 1000 }, async () => {
    const llm = llmForStep("letterhead-reading");
    console.log(`grid running against: ${llm.constructor.name} (${llm.model ?? "unknown model"}), ${cases.length} rows, concurrency ${CONCURRENCY}`);
    const started = Date.now();

    const results: CaseResult[] = [];
    const queue = [...cases];
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let item = queue.shift(); item; item = queue.shift()) {
          const { wrapped: counted, tally } = perCase(llm);
          let raw = "";
          const wrapped = { ...counted, complete: async (p: string, o?: Parameters<typeof counted.complete>[1]) => (raw = await counted.complete(p, o)) };
          let observedName: string | null = null;
          let observedLocation: string | null = null;
          let error: string | undefined;
          try {
            // The real step, exactly as main.ts wires it: prompt, the 2000-char cut, the quote guard.
            const read = await makeReadLetterheadStep(wrapped)(rawCv(item.letterhead + EXPERIENCE_TAIL));
            observedName = read.name?.value ?? null;
            observedLocation = read.location?.value ?? null;
          } catch (err) {
            error = err instanceof Error ? err.message : String(err);
          }
          results.push({
            ...item,
            observedName,
            observedLocation,
            hit: !error && observedName === item.name && observedLocation === item.location,
            error,
            raw,
            calls: tally.calls,
            inputTokens: tally.inputTokens,
            outputTokens: tally.outputTokens,
          });
        }
      }),
    );
    results.sort((a, b) => cases.findIndex((c) => c.id === a.id) - cases.findIndex((c) => c.id === b.id));

    const errors = results.filter((r) => r.error);
    const wrong = results.filter((r) => !r.error && !r.hit);
    const spent = results.reduce(
      (sum, r) => ({ calls: sum.calls + r.calls, input: sum.input + r.inputTokens, output: sum.output + r.outputTokens }),
      { calls: 0, input: 0, output: 0 },
    );
    const receipt = {
      ranAt: new Date().toISOString(),
      driver: llm.constructor.name,
      model: llm.model ?? null,
      rows: results.length,
      hits: results.filter((r) => r.hit).length,
      wrong: wrong.length,
      errors: errors.length,
      calls: spent.calls,
      inputTokens: spent.input,
      outputTokens: spent.output,
      elapsedMs: Date.now() - started,
    };
    writeFileSync(RESULT_PATH, `${JSON.stringify({ receipt, results }, null, 2)}\n`, "utf8");

    for (const r of errors) console.error(`ERROR ${r.id}: ${r.error!.slice(0, 160)}`);
    for (const r of wrong) {
      console.error(`WRONG ${r.id}: expected ${JSON.stringify([r.name, r.location])}, got ${JSON.stringify([r.observedName, r.observedLocation])}`);
    }
    console.log(
      `\n${receipt.rows} rows | ${receipt.hits} right | ${receipt.wrong} wrong | ${receipt.errors} errors | ${receipt.calls} calls, ${receipt.inputTokens} in / ${receipt.outputTokens} out tokens (0 on the CLI route) | ${(receipt.elapsedMs / 1000).toFixed(0)}s | ${receipt.driver} ${receipt.model}\n`,
    );

    expect(errors.map((r) => r.id), "calls failed or came back unreadable — the run measured its driver").toEqual([]);
    expect(wrong.map((r) => r.id), "rows read wrong").toEqual([]);
  });
});
