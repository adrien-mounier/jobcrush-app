// #220 / ADR-0014 decision 6 — the labeler is trusted only after it passes this.
//
// NOT fast-lane CI: every case is a real model call against the live prompt, so it runs deliberately
//   pnpm --filter @jobcrush/api eval:labeler
// (uses llmFromEnv: ANTHROPIC_API_KEY when set, otherwise the local Claude Code CLI). It is also the
// permanent regression harness: change a word in prompts/family-labeler.md and re-run this before
// believing the change was an improvement.
//
// Which MODEL should sit behind the labeler at all is a separate question, answered by its own
// report — eval/modelBakeoff.eval.ts. This file is the gate for whichever model production wires.
//
// The three bars are the ones the repo already enforces before publishing a family
// (familyFloors.ts's ProductionFamilyPublication thresholds), applied here to the labeler itself:
//   comparable accuracy   >= 0.95   of the cases that DO belong somewhere, how many landed right
//   stranger recall       >= 0.90   of the roles no family covers, how many were honestly unmapped
//   false-unknown rate    <= 0.05   of the cases that belong somewhere, how many went unmapped
import { describe, expect, it } from "vitest";
import { FireworksLlm, llmForStep } from "../src/llm.js";
import { BARS, describeMisses, rateGrid, runGrid } from "./harness.js";

// One call at a time by default. Measured 2026-08-15: the local Claude Code CLI driver (the
// no-API-key fallback) fails roughly a third of its calls when five run at once. An API driver
// survives concurrency fine — raise this with EVAL_CONCURRENCY when running against one.
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 1);

describe("#220 the labeler measurement grid", () => {
  it(
    "meets the bars ADR-0014 requires before the labeler is trusted",
    { timeout: 60 * 60 * 1000 },
    async () => {
      // The client production actually wires (llm.ts's llmForStep), never a stand-in — a gate that
      // measures a different model than the one serving visitors proves nothing. llmForStep falls
      // back to the app's ordinary client only when no Fireworks key is configured; say so.
      const llm = llmForStep("family-placement");
      console.log(`grid running against: ${llm instanceof FireworksLlm ? llm.model : "default Claude fallback (NO FIREWORKS KEY — not the production model)"}`);
      const results = await runGrid(llm, { concurrency: CONCURRENCY });

      // Before any rate is believed: a run where calls failed or came back unparseable measured the
      // driver, not the prompt. Say so and stop, rather than reporting a number built on it.
      const degraded = results.filter((item) => item.degraded);
      if (degraded.length > 0) {
        console.error(
          `${degraded.length} of ${results.length} cases DEGRADED (call failed or output unparseable): ${degraded.map((item) => item.id).join(", ")}`,
        );
      }
      expect(degraded.map((item) => item.id), "the run measured its own driver").toEqual([]);

      const rates = rateGrid(results);
      for (const line of describeMisses(results)) console.error(line);
      console.log(
        `\n${results.length} cases | comparable accuracy ${(rates.comparableAccuracy * 100).toFixed(1)}% (bar 95) | stranger recall ${(rates.strangerRecall * 100).toFixed(1)}% (bar 90) | false-unknown ${(rates.falseUnknownRate * 100).toFixed(1)}% (bar 5)` +
          // #231: reported, never barred. Confidence is measured so a labeler that hedges
          // everything is visible; multi-family count is amendment 1 decision 3's own signal —
          // nothing caps it, so this is what says whether the instruction holds the line at two.
          ` | confidence ${(rates.confidenceAccuracy * 100).toFixed(1)}% (reported, no bar) | ${rates.multiFamilyCount} placements named more than one family\n`,
      );

      expect(rates.comparableAccuracy).toBeGreaterThanOrEqual(BARS.comparableAccuracy);
      expect(rates.strangerRecall).toBeGreaterThanOrEqual(BARS.strangerRecall);
      expect(rates.falseUnknownRate).toBeLessThanOrEqual(BARS.falseUnknownRate);
    },
  );
});
