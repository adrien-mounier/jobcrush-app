// Shared grid machinery for the INDUSTRY labeler's eval lane (#283): load the hand-labeled cases,
// run one model over them with the real employer lookup in front, score the three ADR-0014 rates,
// and read the closeness pairs off the published group tree.
//
// harness.ts (the family half) is the prior art and carries the design rule this file inherits: a
// run must be able to tell a labeler ANSWER apart from a labeler FAILURE. Here that distinction is
// simpler to hold, because placeJobIndustry returns it directly — its `degraded` flag is true
// exactly when the unmapped is one we manufactured (two unusable outputs) rather than one the model
// gave. A driver throw (network, auth) is caught per case and is a degradation too.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LlmClient } from "../src/llm.js";
import type { EmployerLookup } from "../src/employerLookup.js";
import { perCase, sameSet } from "./harness.js";
import { placeJobIndustry } from "../src/industryLabeler.js";
import {
  publishedIndustryVocabulary,
  type Industry,
  type IndustryVocabulary,
} from "../src/industryVocabulary.js";

const GRID_PATH = join(dirname(fileURLToPath(import.meta.url)), "industry-labeler-grid.json");

export interface IndustryGridCase {
  id: string;
  employer: string;
  title: string;
  lines: string[];
  expected: "confirmed" | "unmapped";
  /** Every industry the case should come back with, in any order — a SET: the right industries
   *  plus a spurious extra is a miss, exactly as a wrong single industry is. */
  expectedIndustries?: string[];
  /** Per-industry ordinals (contract v2 carries confidence on each industry), asserted only where
   *  the right ordinal is not in doubt, and REPORTED rather than barred — the industries are the
   *  gate. Only the industries named here are checked. */
  expectedConfidence?: Record<string, "certain" | "likely" | "possible">;
  arbitration?: boolean;
  note?: string;
}

/** A closeness pair read off the published group tree — pure data, no model call, no cost. This is
 *  the section that catches a group drawn too wide: a far pair reading near means split the group,
 *  re-publish, re-run. */
export interface ClosenessPairCase {
  id: string;
  held: string;
  required: string;
  expected: "near" | "far";
  arbitration?: boolean;
  note?: string;
}

const grid = JSON.parse(readFileSync(GRID_PATH, "utf8")) as {
  cases: IndustryGridCase[];
  pairs: ClosenessPairCase[];
};
export const industryGridCases: IndustryGridCase[] = grid.cases;
export const closenessPairs: ClosenessPairCase[] = grid.pairs;

export const VOCABULARY: IndustryVocabulary = publishedIndustryVocabulary();
export const INDUSTRIES: Industry[] = VOCABULARY.activeIndustries();

export interface IndustryGridResult extends IndustryGridCase {
  observed: string;
  observedIndustries?: string[];
  observedConfidences?: Record<string, string>;
  hit: boolean;
  /** How many model calls this case actually made — the measured number the spend line reports,
   *  never re-derived from `retried`. */
  calls: number;
  /** The answer came out of the retry path — the model's first attempt was unusable. */
  retried: boolean;
  /** Not a labeler answer: the driver threw, or both attempts were unusable. A run with any of
   *  these measured its own driver and its rates mean nothing. */
  degraded: boolean;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

export async function runIndustryGrid(
  llm: LlmClient,
  {
    concurrency = 1,
    lookupEmployer,
  }: { concurrency?: number; lookupEmployer?: EmployerLookup } = {},
): Promise<IndustryGridResult[]> {
  const results: IndustryGridResult[] = [];
  const queue = [...industryGridCases];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const { wrapped, tally } = perCase(llm);
        let observed = "unmapped";
        let observedIndustries: string[] | undefined;
        let observedConfidences: Record<string, string> | undefined;
        let degraded = false;
        let error: string | undefined;
        try {
          const outcome = await placeJobIndustry(
            {
              employer: item.employer,
              title: item.title,
              lines: item.lines,
              // The second evidence source, exactly as production wires it: one live web lookup per
              // employer, cached in-run so a repeated employer is paid for once. Absent (no key),
              // every case degrades to CV evidence alone — the eval says so in its output.
              lookup: lookupEmployer ? await lookupEmployer(item.employer) : null,
            },
            INDUSTRIES,
            wrapped,
          );
          degraded = outcome.degraded;
          observed = outcome.placement.outcome;
          if (outcome.placement.outcome === "confirmed") {
            observedIndustries = outcome.placement.industries.map((entry) => entry.industryId);
            observedConfidences = Object.fromEntries(
              outcome.placement.industries.map((entry) => [entry.industryId, entry.confidence]),
            );
          }
        } catch (err) {
          // The driver itself threw (network, auth, rate limit). Never a labeler result.
          error = err instanceof Error ? err.message : String(err);
          degraded = true;
        }
        results.push({
          ...item,
          observed,
          observedIndustries,
          observedConfidences,
          hit:
            !degraded &&
            observed === item.expected &&
            (item.expected !== "confirmed" || sameSet(observedIndustries, item.expectedIndustries)),
          calls: tally.calls,
          retried: tally.calls > 1,
          degraded,
          inputTokens: tally.inputTokens,
          outputTokens: tally.outputTokens,
          error,
        });
      }
    }),
  );
  return results.sort((a, b) => a.id.localeCompare(b.id));
}

export interface IndustryGridRates {
  comparableAccuracy: number;
  strangerRecall: number;
  falseUnknownRate: number;
  /** Of the per-industry ordinals the grid declares, how many came back exactly right. Reported,
   *  never barred. */
  confidenceAccuracy: number;
  /** How many placements named more than one industry — the "no cap, but watch the number" signal:
   *  nothing clamps it, so this is what says whether the instruction holds the line at two. */
  multiIndustryCount: number;
}

export function rateIndustryGrid(results: IndustryGridResult[]): IndustryGridRates {
  const comparable = results.filter((item) => item.expected !== "unmapped");
  const strangers = results.filter((item) => item.expected === "unmapped");
  const declaredOrdinals = results.flatMap((item) =>
    Object.entries(item.expectedConfidence ?? {}).map(
      ([industryId, expected]) => item.observedConfidences?.[industryId] === expected,
    ),
  );
  return {
    comparableAccuracy: comparable.filter((item) => item.hit).length / comparable.length,
    strangerRecall: strangers.filter((item) => item.hit).length / strangers.length,
    falseUnknownRate:
      comparable.filter((item) => item.observed === "unmapped").length / comparable.length,
    confidenceAccuracy: declaredOrdinals.length
      ? declaredOrdinals.filter(Boolean).length / declaredOrdinals.length
      : 1,
    multiIndustryCount: results.filter((item) => (item.observedIndustries?.length ?? 0) > 1).length,
  };
}

/** Hits per grid category, read off the id prefix — the ticket's own list, reported separately:
 *  consultants (multi-*), the one-client controls (ctrl-*), unknown small employers (unk-*),
 *  strangers (str-*), and the rest. A ctrl-* case sprouting a spurious second industry shows up
 *  here as "ctrl 3/4", not only as one MISS line in a long list. */
export function describeCategories(results: IndustryGridResult[]): string {
  const categories = new Map<string, { hits: number; total: number }>();
  for (const item of results) {
    const prefix = item.id.split("-")[0]!;
    const tally = categories.get(prefix) ?? { hits: 0, total: 0 };
    tally.total++;
    if (item.hit) tally.hits++;
    categories.set(prefix, tally);
  }
  return [...categories.entries()]
    .map(([prefix, tally]) => `${prefix} ${tally.hits}/${tally.total}`)
    .join(" · ");
}

export function describeIndustryMisses(results: IndustryGridResult[]): string[] {
  return results
    .filter((item) => !item.hit)
    .map(
      (item) =>
        `MISS ${item.id} "${item.employer} — ${item.title}": expected ${item.expected}${item.expectedIndustries ? ` (${item.expectedIndustries.join(" + ")})` : ""}, got ${item.error ? `ERROR ${item.error.slice(0, 120)}` : `${item.observed}${item.observedIndustries ? ` (${item.observedIndustries.join(" + ")})` : ""}`}${item.arbitration ? " [owner-arbitrated case]" : ""}`,
    );
}

export interface ClosenessPairResult extends ClosenessPairCase {
  observed: string;
  hit: boolean;
}

/** The vocabulary side of the grid: no model, no spend — just the published tree answering the
 *  pairs. Runs against the SAME vocabulary object the labeler cases place into. */
export function runClosenessPairs(
  vocabulary: IndustryVocabulary = VOCABULARY,
): ClosenessPairResult[] {
  return closenessPairs.map((pair) => {
    const observed = vocabulary.closeness(pair.held, pair.required);
    return { ...pair, observed, hit: observed === pair.expected };
  });
}
