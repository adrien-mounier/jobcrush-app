// Tier 2 gate file list — #199. Unlike run-mocked.mjs's computed Tier 1 list, this is a deliberately
// HAND-PICKED five: these journeys ride the real Fastify server, real stores, real extraction, real
// render (faking only the model, via the #198 fake-model API entry already running when this is
// invoked from ci.yml), and each was chosen for a specific real-stack regression it alone can catch.
// A computed glob is wrong here on purpose — the exclusions are deliberate product judgement calls
// (see each journey's own header and ticket #199), not "whatever file happens to match a pattern".
//
// factbadge-floor-journey.mjs — named in #199 as the first cut if the budget/reliability bites — is
// deliberately NOT here: measured 2026-08-11/12, it failed 2 of 6 timed attempts with an identical
// signature (the discovery Q1 submission hangs, two 8s locator timeouts, then the #197 crash guard
// aborts the run) while the other five produced byte-identical PASS verdicts across three separate
// clean full-stack runs. Re-add it once that hang is root-caused and fixed.
//
// Sequential, not parallel: these six (five, post-cut) journeys share one fake-model API process and
// one web process, and several mint real magic-link sign-ins against auth's 5-per-15-min-per-IP
// limiter (routes/auth.ts) — running them concurrently would burn that budget for no wall-clock win
// worth the risk. Continues through a failure so every journey still gets its HTML report (the #197
// crash guard covers the in-process crash case; this covers the "don't let one red journey hide the
// rest" case), then exits non-zero if anything failed — same contract as run-mocked.mjs.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const e2eDir = fileURLToPath(new URL("./", import.meta.url));

const JOURNEYS = [
  "contact-fact-journey.mjs",
  "tailor-journey.mjs",
  "search-area-coverage-journey.mjs",
  "factbadge-journey.mjs",
  "band-vocabulary-journey.mjs",
];

let failed = 0;
for (const file of JOURNEYS) {
  console.log(`\n=== Tier 2: ${file} ===`);
  // shell:true only for the Windows-vs-POSIX node shim question moot here (node is invoked directly,
  // not via a .cmd wrapper) — kept false, matching run-mocked's own reasoning against the CVE-2024-27980
  // .cmd/.bat concern, which does not apply to a plain "node" binary.
  const result = spawnSync("node", [`${e2eDir}${file}`], { stdio: "inherit" });
  if (result.status !== 0) failed += 1;
}

if (failed > 0) {
  console.error(`\nTier 2: ${failed} of ${JOURNEYS.length} journeys failed`);
  process.exit(1);
}
console.log(`\nTier 2: all ${JOURNEYS.length} journeys passed`);
