// #284 — the READING pass the unit tests structurally cannot do.
//
// Every test in adReader.test.ts injects a canned model answer, so the whole suite stays green
// whatever the prompt says. This file is the only place where a real model reads a real advert and
// the SCOPE it chooses is asserted.
//
// What it is honestly worth, measured rather than assumed (#284 QA gate, 2026-08-23): the cases that
// name an INDUSTRY ID — `compound`, `industry-alone`, `industry-banking`, `unpublished-industry` —
// are genuinely prompt-sensitive, because the model can only produce those ids from the injected
// vocabulary block, and `unpublished-industry` can only come back empty if the closed-list rule
// holds. The `bare-family` / `bare-total-overall` pair is NOT a discriminating guard: the gate put
// #284's shipped collision back into the prompt (the bare "N+ years' experience" form claimed by
// both the family and the total bullet) and the model still read all six samples correctly, at the
// harness digit and at a neutral one. So that collision was a latent TEXT defect a human found by
// reading, never an observed misread — and this file would not have caught it. The pair is kept as a
// live regression sample of the phrasing that shipped, not as proof it is guarded. A wording change
// that DOES flip a reading is what these cases would catch; the collision was not one.
//
// NOT fast-lane CI: every case is a real paid model call. Run it deliberately, before trusting a
// prompt edit that touches the scope bullets:
//   pnpm --filter @jobcrush/api eval:ad-reader-scopes
// with ANTHROPIC_API_KEY set (the .env at the repo root carries it; vitest does not load .env
// itself). Without the key the run FAILS before spending anything — the CLI fallback is a different
// driver, and a green from it would gate nothing while looking exactly like a gate.
//
// The bar is 100%, deliberately: these are not judgement calls about a messy advert, they are the
// prompt's own worked examples plus the one collision that shipped. A miss here means the wording is
// ambiguous, and the fix is the wording — never a looser bar.
import { describe, expect, it } from "vitest";
import { canonicalModelName, llmFromEnv } from "../src/llm.js";
import { computeCostUsd, pricingTableFromEnv } from "../src/llmPricing.js";
import { readAdvert, type ReaderIndustry } from "../src/adReader.js";
import { initialProductionFamilyFloors } from "../src/familyFloors.js";
import { publishedFamilies } from "../src/familyLabeler.js";
import { publishedIndustryVocabulary } from "../src/industryVocabulary.js";
import { perCase } from "./harness.js";
import type { Posting } from "../src/preview.js";

const FAMILIES = publishedFamilies(initialProductionFamilyFloors());
const INDUSTRIES: ReaderIndustry[] = publishedIndustryVocabulary().activeIndustries();

/** How many times each case is asked. One sample proves nothing about a non-deterministic reader —
 *  a wording that is merely AMBIGUOUS answers correctly some of the time, which is the failure mode
 *  this file exists to expose. */
const REPEATS = Number(process.env.EVAL_REPEATS ?? 3);
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 4);

/** One expected years bar: the number, the scope it must be read at, and (industry scope only) the
 *  published id it must name. `industry: null` means the bar must be at industry scope and name
 *  NOTHING — the untestable absence an unpublished industry produces. */
interface ExpectedBar {
  value: number;
  scope: "family" | "industry" | "total";
  industry?: string | null;
}

interface ScopeCase {
  id: string;
  /** Why this case exists — printed on a miss, so a failure explains itself. */
  why: string;
  title: string;
  excerpt: string;
  /** Every years bar the advert states, in any order. A reading that produces the right bars plus a
   *  spurious extra one is a miss: a compound sentence folded into three numbers is as wrong as one
   *  folded into a single number. */
  expected: ExpectedBar[];
}

const CASES: ScopeCase[] = [
  {
    id: "compound",
    why: "the motivating advert — one sentence, two bars, one per scope (#284's own AC4)",
    title: "Senior Project Manager",
    excerpt:
      "We are looking for a Senior Project Manager to own delivery across our platform teams. " +
      "8+ years of IT experience including 5+ years as a Project Manager. Strong stakeholder skills.",
    expected: [
      { value: 8, scope: "industry", industry: "it-services" },
      { value: 5, scope: "family" },
    ],
  },
  {
    id: "bare-family",
    why: "a bare 'N+ years' experience' on a role advert must read as family, never total (regression sample, not a discriminating guard — see the header)",
    title: "Project Manager",
    excerpt:
      "Project Manager wanted to run our client delivery programme. 5+ years' experience. " +
      "You will own budgets and report to the steering group.",
    expected: [{ value: 5, scope: "family" }],
  },
  {
    id: "bare-total-overall",
    why: "the other half of that pair: 'overall' is what makes a bare form a career bar (self-evident to the model — see the header)",
    title: "Delivery Lead",
    excerpt:
      "Delivery Lead for a growing consultancy. We are after a seasoned operator: 10+ years' " +
      "experience overall, across whatever mix of roles got you here.",
    expected: [{ value: 10, scope: "total" }],
  },
  {
    id: "professional-total",
    why: "the prompt's own total example — must not drift to industry now that a third scope exists",
    title: "Programme Manager",
    excerpt:
      "Programme Manager, financial crime remediation. 8+ years of professional experience required. " +
      "You will coordinate several workstreams at once.",
    expected: [{ value: 8, scope: "total" }],
  },
  {
    id: "industry-alone",
    why: "the bar that had no scope of its own before #284 — eight years in retail used to pass it",
    title: "IT Project Manager",
    excerpt:
      "IT Project Manager for a managed services provider. 8+ years of IT experience essential. " +
      "Comfortable owning a delivery plan end to end.",
    expected: [{ value: 8, scope: "industry", industry: "it-services" }],
  },
  {
    id: "industry-banking",
    why: "a second published industry, so the reading is not one memorised id",
    title: "Project Manager, Payments",
    excerpt:
      "Project Manager, Payments. 5+ years in banking is essential — you will be working directly " +
      "with our settlement and treasury teams.",
    expected: [{ value: 5, scope: "industry", industry: "banking" }],
  },
  {
    id: "unpublished-industry",
    why: "#284 AC6: an industry we do not publish must come back as an ABSENCE, never the nearest id",
    title: "Project Manager, Avionics",
    excerpt:
      "Project Manager for our avionics programme. 6+ years in the aerospace sector required. " +
      "You will manage certification milestones with the regulator.",
    expected: [{ value: 6, scope: "industry", industry: null }],
  },
];

interface Observed {
  value: number;
  scope: string;
  industry: string | null;
}

interface CaseRun {
  id: string;
  why: string;
  attempt: number;
  observed: Observed[];
  hit: boolean;
  degraded: boolean;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

const posting = (item: ScopeCase, attempt: number): Posting => ({
  id: `${item.id}-${attempt}`,
  title: item.title,
  company: "Acme",
  location: "Sydney, Australia",
  keywords: [],
  excerpt: item.excerpt,
  language: "en",
});

/** The bars an advert reading actually states: a years-experience requirement carrying a minimum.
 *  Everything else the reader produces (capabilities, preferences) is out of this file's scope —
 *  it measures WHERE a years bar is read, not what else the advert says. */
function yearsBars(requirements: { eligibilityDimension?: string; comparable?: { op: string; value: number }; yearsScope?: string; yearsIndustry?: string }[]): Observed[] {
  return requirements
    .filter((r) => r.eligibilityDimension === "years-experience" && r.comparable?.op === ">=")
    .map((r) => ({
      value: r.comparable!.value,
      // Absent reads as family — the plain meaning of a years bar on a role advert, and the shape
      // the prompt asks for in the ordinary case.
      scope: r.yearsScope ?? "family",
      industry: r.yearsIndustry ?? null,
    }));
}

/** Order-independent set comparison: the advert states its bars in whatever order it likes, but the
 *  SET must match exactly — a spurious extra bar is a miss, not a near-hit. */
function matches(expected: ExpectedBar[], observed: Observed[]): boolean {
  if (expected.length !== observed.length) return false;
  const remaining = [...observed];
  for (const want of expected) {
    const index = remaining.findIndex(
      (got) =>
        got.value === want.value &&
        got.scope === want.scope &&
        // Only an industry-scope bar is asked about an id at all; `industry: null` asserts the
        // absence explicitly rather than treating "no id" as "don't care".
        (want.scope !== "industry" || got.industry === (want.industry ?? null)),
    );
    if (index === -1) return false;
    remaining.splice(index, 1);
  }
  return true;
}

const describeBars = (bars: { value: number; scope: string; industry?: string | null }[]): string =>
  bars.length === 0
    ? "(no years bar)"
    : bars
        .map((bar) => `${bar.value}@${bar.scope}${bar.scope === "industry" ? `:${bar.industry ?? "(none)"}` : ""}`)
        .join(" + ");

describe("#284 the advert reader's years scopes, read by a real model", () => {
  it(
    "reads every phrasing at the scope the prompt asks for",
    { timeout: 60 * 60 * 1000 },
    async () => {
      // Fail before any spend: without the key llmFromEnv falls back to the local Claude Code CLI,
      // a different driver than production, and a green from it would gate nothing.
      expect(
        process.env.ANTHROPIC_API_KEY,
        "ANTHROPIC_API_KEY is not set — this pass measures the reader production wires, and the CLI fallback is not it",
      ).toBeTruthy();
      // Checked BEFORE any spend, and checked on REPEATS itself rather than on the result count:
      // EVAL_REPEATS=0 (or a non-numeric value, which is NaN) empties the queue, and every list this
      // test asserts on then comes back empty — including `results.length === CASES.length * REPEATS`,
      // which is 0 === 0 and passes. A green costing zero calls and proving zero things.
      expect(
        Number.isInteger(REPEATS) && REPEATS >= 1,
        `EVAL_REPEATS must be a positive integer, got ${process.env.EVAL_REPEATS}`,
      ).toBe(true);

      const llm = llmFromEnv();
      const model = canonicalModelName(llm.model ?? "(unknown)");
      const pricing = pricingTableFromEnv();
      console.log(
        `reading pass against: ${model} | ${FAMILIES.length} published families, ${INDUSTRIES.length} published industries | ${CASES.length} cases × ${REPEATS}`,
      );

      const queue: { item: ScopeCase; attempt: number }[] = CASES.flatMap((item) =>
        Array.from({ length: REPEATS }, (_unused, attempt) => ({ item, attempt })),
      );
      const results: CaseRun[] = [];
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          for (let next = queue.shift(); next; next = queue.shift()) {
            const { item, attempt } = next;
            const { wrapped, tally } = perCase(llm);
            let observed: Observed[] = [];
            let degraded = false;
            let error: string | undefined;
            try {
              const read = await readAdvert(posting(item, attempt), wrapped, FAMILIES, INDUSTRIES);
              // Null only happens on a language skip, which no case here can trigger — treat it as a
              // degradation rather than silently scoring it as "no bars found".
              if (!read) throw new Error("reader returned null (language skip?)");
              observed = yearsBars(read.requirements.requirements);
            } catch (err) {
              degraded = true;
              error = err instanceof Error ? err.message : String(err);
            }
            results.push({
              id: item.id,
              why: item.why,
              attempt,
              observed,
              hit: !degraded && matches(item.expected, observed),
              degraded,
              calls: tally.calls,
              inputTokens: tally.inputTokens,
              outputTokens: tally.outputTokens,
              error,
            });
          }
        }),
      );

      // A run whose calls failed measured the driver, not the reading. Say so and stop, rather than
      // reporting a rate built on it — harness.ts's own rule, for the same reason.
      // Every queued reading came back — a queue that silently drained short would understate the
      // miss list, which is the one list this test's verdict rests on.
      expect(results.length, "the queue drained short").toBe(CASES.length * REPEATS);

      const degraded = results.filter((run) => run.degraded);
      for (const run of degraded) console.error(`DEGRADED ${run.id} #${run.attempt}: ${run.error}`);
      expect(degraded.map((run) => run.id), "the run measured its own driver").toEqual([]);

      for (const item of CASES) {
        const runs = results.filter((run) => run.id === item.id);
        const hits = runs.filter((run) => run.hit).length;
        const line = `${item.id}: ${hits}/${runs.length} — want ${describeBars(item.expected)}`;
        if (hits === runs.length) {
          console.log(`  OK  ${line}`);
        } else {
          console.error(`  MISS ${line}\n       why it matters: ${item.why}`);
          for (const run of runs.filter((r) => !r.hit)) {
            console.error(`       attempt ${run.attempt} read ${describeBars(run.observed)}`);
          }
        }
      }

      const calls = results.reduce((sum, run) => sum + run.calls, 0);
      const inputTokens = results.reduce((sum, run) => sum + run.inputTokens, 0);
      const outputTokens = results.reduce((sum, run) => sum + run.outputTokens, 0);
      const usd = computeCostUsd(model, inputTokens, outputTokens, pricing);
      const hits = results.filter((run) => run.hit).length;
      console.log(
        `\n${hits}/${results.length} readings at the expected scope` +
          `\nspend: ${calls} calls (${inputTokens} in / ${outputTokens} out tokens` +
          `${usd === null ? ", unpriced model" : `, $${usd.toFixed(4)} at ${model}'s published rate`})`,
      );

      // 100%, deliberately — see this file's header. A miss is an ambiguous prompt, and the prompt
      // is what gets fixed.
      expect(results.filter((run) => !run.hit).map((run) => `${run.id}#${run.attempt}`)).toEqual([]);
    },
  );
});
