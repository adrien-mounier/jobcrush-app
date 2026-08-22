// Shared grid machinery for the eval lane (#220): load the hand-labeled cases, run one model over
// them, score the three ADR-0014 rates.
//
// The one design rule here, learned the hard way on 2026-08-15: **a run must be able to tell a
// labeler ANSWER apart from a labeler FAILURE.** Both arrive as `unmapped`. The first version of
// this harness could not, so a driver that was quietly failing under concurrency produced a report
// saying the labeler turned away "Senior IT Project Manager" — a role that answered perfectly the
// moment it was asked on its own. Degradation is detected per case, by counting the calls that case
// actually made through its own wrapper, so it stays exact no matter how many run at once.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LlmClient } from "../src/llm.js";
import { initialProductionFamilyFloors } from "../src/familyFloors.js";
import { placeJobTitle, publishedFamilies, type PublishedFamily } from "../src/familyLabeler.js";

const GRID_PATH = join(dirname(fileURLToPath(import.meta.url)), "family-labeler-grid.json");

export interface GridCase {
  id: string;
  targetRole: string;
  vocabulary: "published" | "two-family";
  expected: "confirmed" | "unmapped";
  /** Every family the case should come back with, in any order. #231: a job can be in more than
   *  one, so this is a SET — a placement that names the right families plus a spurious extra is a
   *  miss, exactly as a wrong single family always was. */
  expectedFamilies?: string[];
  /** #231 — asserted where the right answer is not in doubt, and reported as its own rate rather
   *  than folded into `hit`. The families are the gate; confidence is measured beside it, so a
   *  labeler that places perfectly but hedges everything is visible without failing the run on an
   *  ordinal one step out. */
  expectedConfidence?: "certain" | "likely" | "possible";
  arbitration?: boolean;
  note?: string;
}

export const gridCases: GridCase[] = (
  JSON.parse(readFileSync(GRID_PATH, "utf8")) as { cases: GridCase[] }
).cases;

export const PUBLISHED = publishedFamilies(initialProductionFamilyFloors());

// Defined HERE, never in the production registry: product-management is not published, so the
// dual-family cases that need it beside it-project-delivery cannot run on the real vocabulary.
// They measure that the prompt names both families only when both are real, ahead of that
// family publishing for real.
export const TWO_FAMILIES: PublishedFamily[] = [
  ...PUBLISHED,
  {
    familyId: "product-management",
    version: 1,
    label: "Product management",
    scope:
      "Deciding what a product should be and why: its direction and roadmap, which problems it solves, what gets built and in what order, and the trade-offs between them, using customer and market evidence. The work is deciding what to build and proving it was worth building. Outside it: running the delivery of what was decided, and building the thing itself.",
    exampleTitles: ["Product Manager", "Senior Product Manager", "Group Product Manager"],
    coreWork: [
      "Have you decided what a product should do and why?",
      "Have you owned a product's roadmap and its trade-offs?",
      "Have you taken customer and market evidence into product decisions?",
    ],
  },
];

export interface GridResult extends GridCase {
  observed: string;
  observedFamilies?: string[];
  observedConfidence?: string;
  hit: boolean;
  /** The answer came out of the retry path — the model's first attempt was unusable. */
  retried: boolean;
  /** Both attempts were unusable, so `unmapped` here is a DEGRADATION, not an answer. A run with
   *  any of these measured its own driver and its rates mean nothing. */
  degraded: boolean;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

/** ADR-0014 decision 6's bars, in one place: the gate asserts them and the model bake-off reports
 *  PASS/FAIL against them, and a gate that could drift from the report would make the report a lie. */
export const BARS = {
  comparableAccuracy: 0.95,
  strangerRecall: 0.9,
  falseUnknownRate: 0.05,
} as const;

export interface GridRates {
  comparableAccuracy: number;
  strangerRecall: number;
  falseUnknownRate: number;
  /** #231 — of the cases that declare an expected confidence, how many got it exactly. Reported,
   *  not barred: see GridCase.expectedConfidence. */
  confidenceAccuracy: number;
  /** #231 — how many placements named more than one family. The number amendment 1 decision 3
   *  wants watched: no cap is enforced anywhere, so this is what says whether the instruction is
   *  actually holding the line at two. */
  multiFamilyCount: number;
}

/** Wraps a shared client so ONE case's calls and tokens are counted on their own, whatever else is
 *  running concurrently. */
function perCase(llm: LlmClient) {
  const tally = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const wrapped: LlmClient = {
    model: llm.model,
    async complete(prompt, opts) {
      tally.calls++;
      if (llm.completeWithUsage) {
        const { text, usage } = await llm.completeWithUsage(prompt, opts);
        tally.inputTokens += usage.inputTokens;
        tally.outputTokens += usage.outputTokens;
        return text;
      }
      return llm.complete(prompt, opts);
    },
  };
  return { wrapped, tally };
}

export async function runGrid(
  llm: LlmClient,
  { concurrency = 1 }: { concurrency?: number } = {},
): Promise<GridResult[]> {
  const results: GridResult[] = [];
  const queue = [...gridCases];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const families = item.vocabulary === "two-family" ? TWO_FAMILIES : PUBLISHED;
        const { wrapped, tally } = perCase(llm);
        let observed = "unmapped";
        let observedFamilies: string[] | undefined;
        let observedConfidence: string | undefined;
        let error: string | undefined;
        try {
          // The PLURAL path, deliberately: it is the one a visitor's job records go through, and
          // the target-role path is a constrained special case of it until #232.
          const placement = await placeJobTitle(item.targetRole, families, wrapped);
          observed = placement.outcome;
          if (placement.outcome === "confirmed") {
            observedFamilies = placement.families.map((family) => family.familyId);
            observedConfidence = placement.confidence;
          }
        } catch (err) {
          // The driver itself threw (network, auth, rate limit). Never a labeler result.
          error = err instanceof Error ? err.message : String(err);
        }
        results.push({
          ...item,
          observed,
          observedFamilies,
          observedConfidence,
          // A confirmation into the WRONG families is a miss, not partial credit — and so is one
          // that names the right family plus a second the work does not actually include.
          hit:
            !error &&
            observed === item.expected &&
            (item.expected !== "confirmed" || sameSet(observedFamilies, item.expectedFamilies)),
          retried: tally.calls > 1,
          degraded: !!error || (tally.calls > 1 && observed === "unmapped"),
          inputTokens: tally.inputTokens,
          outputTokens: tally.outputTokens,
          error,
        });
      }
    }),
  );
  return results.sort((a, b) => a.id.localeCompare(b.id));
}

const sameSet = (a: string[] | undefined, b: string[] | undefined): boolean =>
  !!a && !!b && a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

export function rateGrid(results: GridResult[]): GridRates {
  const comparable = results.filter((item) => item.expected !== "unmapped");
  const strangers = results.filter((item) => item.expected === "unmapped");
  const graded = results.filter((item) => item.expectedConfidence);
  return {
    comparableAccuracy: comparable.filter((item) => item.hit).length / comparable.length,
    strangerRecall: strangers.filter((item) => item.hit).length / strangers.length,
    falseUnknownRate:
      comparable.filter((item) => item.observed === "unmapped").length / comparable.length,
    confidenceAccuracy: graded.length
      ? graded.filter((item) => item.observedConfidence === item.expectedConfidence).length / graded.length
      : 1,
    multiFamilyCount: results.filter((item) => (item.observedFamilies?.length ?? 0) > 1).length,
  };
}

export function describeMisses(results: GridResult[]): string[] {
  return results
    .filter((item) => !item.hit)
    .map(
      (item) =>
        `MISS ${item.id} "${item.targetRole}": expected ${item.expected}${item.expectedFamilies ? ` (${item.expectedFamilies.join(" + ")})` : ""}, got ${item.error ? `ERROR ${item.error.slice(0, 120)}` : `${item.observed}${item.observedFamilies ? ` (${item.observedFamilies.join(" + ")})` : ""}`}${item.arbitration ? " [owner-arbitrated case]" : ""}`,
    );
}
