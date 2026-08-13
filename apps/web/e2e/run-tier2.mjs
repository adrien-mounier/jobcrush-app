// Tier 2 gate file list — #199. Unlike run-mocked.mjs's computed Tier 1 list, this is a deliberately
// HAND-PICKED set: these journeys ride the real Fastify server, real stores, real extraction, real
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
// Sequential, not parallel: these journeys share one fake-model API process and
// one web process, and several mint real magic-link sign-ins against auth's 5-per-15-min-per-IP
// limiter (routes/auth.ts) — running them concurrently would burn that budget for no wall-clock win
// worth the risk. Continues through a failure so every journey still gets its HTML report (the #197
// crash guard covers the in-process crash case; this covers the "don't let one red journey hide the
// rest" case), then exits non-zero if anything failed — same contract as run-mocked.mjs.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const e2eDir = fileURLToPath(new URL("./", import.meta.url));

//
// years-worked-out-journey.mjs added 2026-08-12 (#162), and it earns its slot on the same
// "a specific real-stack regression it alone can catch" rule: it is the only journey that walks a
// real CV through the real miner into the real job records and reads the number ADVERTS GATE ON back
// off a rendered card. It caught this exact class of defect on its first run — every server-side test
// for the date question's "why this matters" line passed while the line never reached the screen,
// because nothing else drives that render. Measured cost: ~90s, no sign-in, so it spends none of
// auth's 5-per-15-min limiter budget.
// eligibility-questions-journey.mjs added 2026-08-13 (#205), and it earns its slot on the same rule:
// it is the ONLY journey that walks the eligibility block as a person does — answer, correct the
// answer, retract it to "ask me later", and reach the deck — against real stores. It had been red
// for weeks precisely because it was in no tier: Tier 1 globs *.spec.ts and never sees a .mjs
// journey, so the single end-to-end proof of the gate questions rotted unwatched. Measured cost:
// ~3.5min, no sign-in, so it spends none of auth's 5-per-15-min limiter budget (it does mint two
// anonymous sessions, well inside qa-main.ts's 1000/hr).
// The four journeys added 2026-08-13 (#209) were the last ones sitting in NO tier — each declared a
// stack this repo could not run, so each rotted unwatched, and two had header comments that were
// simply false by the time anyone read them. What each one needed, and now has, is in qa-main.ts:
//   job-blocks-confirm  — the fake job-block miner answered every re-upload with the SAME block ids,
//                         so the second upload was all id-collisions and the deck stood empty. (Its
//                         old header blamed an unwired `mineJobBlocks`; that was never true.)
//   language-ladder     — no advert in the shipped corpus states a language requirement of any kind,
//                         so the deck half could not run. Three canned ones are served at the app's
//                         own readAd seam, in the QA entry only.
//   pending-unscored    — "Still scoring" is unobservable against a judge that answers instantly, so
//                         the fake judge is deliberately slower than the deck's own budget.
//   master-cv-dates-note — was written against the REAL paid model and was separately rotted (#157
//                         moved the door it clicked). Rewritten against the fake.
// Measured on this machine 2026-08-13, they add roughly 6 minutes between them — the wall-clock the
// ticket's owner accepted when they asked for all four to be fixed rather than retired.
const JOURNEYS = [
  "contact-fact-journey.mjs",
  "eligibility-questions-journey.mjs",
  "tailor-journey.mjs",
  "search-area-coverage-journey.mjs",
  // #214: the only end-to-end proof that a typed city stays a city-level target (chips, cap,
  // refusal, per-market work-rights). ~2 min against the fake-model API.
  "target-locations-journey.mjs",
  "factbadge-journey.mjs",
  "band-vocabulary-journey.mjs",
  "years-worked-out-journey.mjs",
  "job-blocks-confirm-journey.mjs",
  "language-ladder-journey.mjs",
  "pending-unscored-card-journey.mjs",
  "master-cv-dates-note-journey.mjs",
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
