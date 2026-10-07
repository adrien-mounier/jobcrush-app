// #264 — the runnable check on Tier 2 selection. `pnpm --filter @jobcrush/web test` runs this, so
// it rides the same gate as everything else; before #264 that script was a no-op echo.
//
// No framework and no fixtures on purpose: apps/web has no test runner, and the thing under test is
// a pure function over a list of paths. node:assert is enough.
//
// The centre of it is the #262 replay. A coverage map is easy to make LOOK complete and hard to make
// CORRECT, and #262 is the instrument the ticket picked because its failures are already recorded:
// five journeys went red on that change, and a map that fails to select those five would have let it
// push a broken deploy while reporting green.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JOURNEYS } from "./run-tier2.mjs";
import { assertMapCoversGate, selectJourneys, COVERAGE, SELECTS_ALL } from "./tier2-coverage.mjs";

const run = (paths) => selectJourneys(paths, JOURNEYS);
const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// AC8 — the map and the gate list agree, in both directions.
check("every gate journey has a coverage entry", () => {
  assertMapCoversGate(JOURNEYS);
  assert.equal(Object.keys(COVERAGE).length, JOURNEYS.length);
});

check("a journey with no entry is a hard error, not a silent skip", () => {
  assert.throws(
    () => assertMapCoversGate([...JOURNEYS, "brand-new-journey.mjs"]),
    /NO COVERAGE ENTRY: brand-new-journey\.mjs/,
  );
});

// AC3 — fail open. An unmapped path cannot be reasoned about, so it runs everything.
check("an unmapped path selects every journey and says so", () => {
  const r = run(["apps/api/src/somethingNobodyMapped.ts"]);
  assert.equal(r.selected.length, JOURNEYS.length);
  assert.equal(r.skipped.length, 0);
  assert.deepEqual(r.unmatched, ["apps/api/src/somethingNobodyMapped.ts"]);
});

check("the shared harness selects every journey", () => {
  assert.equal(run(["apps/web/e2e/qa-driver.mjs"]).selected.length, JOURNEYS.length);
  assert.equal(run(["apps/api/src/sessions.ts"]).selected.length, JOURNEYS.length);
});

// AC6 — a docs-only diff reaches nothing, and nothing is left unexplained.
check("a docs-only diff selects nothing, with every path accounted for as inert", () => {
  const paths = ["docs/adr/ADR-0014.md", "roadmap.md", "session-log.md", "screenshots/deck.png"];
  const r = run(paths);
  assert.equal(r.selected.length, 0);
  assert.equal(r.unmatched.length, 0);
  assert.equal(r.inert.length, paths.length, "every docs path must match an inert rule");
});

// AC9 — a journey file selects itself, rather than falling through to the catch-all or to nothing.
check("editing a journey file selects that journey and nothing else", () => {
  const r = run(["apps/web/e2e/family-role-name-journey.mjs"]);
  assert.deepEqual(r.selected, ["family-role-name-journey.mjs"]);
  assert.equal(r.unmatched.length, 0);
});

check("a non-gate e2e file is inert, and never selects everything", () => {
  const r = run(["apps/web/e2e/second-family-typeahead-journey.mjs", "apps/web/e2e/deck.spec.ts"]);
  assert.equal(r.selected.length, 0);
  assert.equal(r.unmatched.length, 0);
});

// AC2 — a narrow source change selects a narrow set, each with the rule that matched it.
check("a narrow source change selects a narrow set, with a reason for each", () => {
  const r = run(["apps/api/src/contact.ts"]);
  assert.deepEqual(r.selected, ["contact-fact-journey.mjs"]);
  assert.match(r.reasons.get("contact-fact-journey.mjs"), /apps\/api\/src\/contact\.ts matches /);
});

check("a glob rule matches the whole directory beneath it", () => {
  const r = run(["apps/web/app/discovery/page.tsx"]);
  assert.ok(r.selected.includes("discovery-plan-split-journey.mjs"));
  assert.ok(!r.selected.includes("contact-fact-journey.mjs"));
  assert.equal(r.unmatched.length, 0);
});

// AC5 — the real test. Every non-docs path of commit 8e7a9a5 ("both families are named after the
// role, not the activity", #262), verbatim from `git show --stat --format= 8e7a9a5`.
const DIFF_262 = [
  "apps/api/research/business-analysis-v2.json",
  "apps/api/research/it-project-delivery-v2.json",
  "apps/api/src/familyFloors.ts",
  "apps/api/test/discovery.test.ts",
  "apps/api/test/familyCandidateIntake.test.ts",
  "apps/api/test/familyFloors.test.ts",
  "apps/api/test/familyLabeler.test.ts",
  "apps/api/test/familyYears.test.ts",
  "apps/api/test/placedServer.ts",
  "apps/api/test/qaFamilyAnswer.test.ts",
  "apps/web/e2e/change-of-direction-derived-journey.mjs",
  "apps/web/e2e/deck-family-fit-journey.mjs",
  "apps/web/e2e/discovery-earns-reveal-gate.mjs",
  "apps/web/e2e/discovery-plan-split-journey.mjs",
  "apps/web/e2e/eligibility-questions-journey.mjs",
  "apps/web/e2e/family-placement-journey.mjs",
  "apps/web/e2e/family-role-name-journey.mjs",
  "apps/web/e2e/family-years-scope-journey.mjs",
  "apps/web/e2e/job-blocks-family.spec.ts",
  "apps/web/e2e/job-blocks-no-family-question-journey.mjs",
  "apps/web/e2e/promise-counts-her-own-search-journey.mjs",
  "apps/web/e2e/run-tier2.mjs",
  "apps/web/e2e/second-family-typeahead-journey.mjs",
  "docs/vocabulary-proposals/business-analysis-v1/corpus/README.md",
  "docs/vocabulary-proposals/business-analysis-v1/method-test-2026-08-22.md",
  "docs/vocabulary-proposals/family-rename-2026-08-21.md",
  "docs/vocabulary-proposals/it-project-delivery-product-ownership-widening-REJECTED/it-project-delivery-v2.json",
  "docs/vocabulary-proposals/it-project-delivery-product-ownership-widening-REJECTED/summary.md",
];

// The five that were genuinely red in #262's first QA gate run — four of them, since #339 retired
// the fifth (discovery-earns-reveal-gate.mjs: its floor-earns-the-reveal claim went with the floor
// questions, and the file is gone). If selection ever stops picking these, it would have let that
// change deploy while reporting green.
const RED_IN_262 = [
  "family-years-scope-journey.mjs",
  "discovery-plan-split-journey.mjs",
  "family-placement-journey.mjs",
  "change-of-direction-derived-journey.mjs",
];

// AC5 says "the 9 family-reachable journeys". It was TEN, and the extra one is deliberate:
// unmapped-label-feed-journey.mjs asserts that a word no published family covers reaches the
// vocabulary feed, and the registry is exactly what decides whether a word is covered — a review of
// this map caught the omission. Selecting it is the fail-open direction (safety rule 1), it costs
// ~2 minutes, and AC5's actual substance is untouched: every journey that went red in #262 and is
// still in the gate is still selected. #339 retired discovery-earns-reveal-gate.mjs, so it is NINE
// now. If the owner wants the AC's own count back, drop FAMILY_REGISTRY from unmapped-label-feed.
check("#262's own diff selects the 9 family-reachable journeys and skips the rest", () => {
  const r = run(DIFF_262);
  assert.equal(r.unmatched.length, 0, `unmapped: ${r.unmatched.join(", ")}`);
  assert.deepEqual(
    [...r.selected].sort(),
    [
      "change-of-direction-derived-journey.mjs",
      "deck-family-fit-journey.mjs",
      "discovery-plan-split-journey.mjs",
      "eligibility-questions-journey.mjs",
      "family-placement-journey.mjs",
      "family-role-name-journey.mjs",
      "family-years-scope-journey.mjs",
      "promise-counts-her-own-search-journey.mjs",
      "unmapped-label-feed-journey.mjs",
    ],
  );
  assert.equal(r.skipped.length, JOURNEYS.length - 9);
});

// The map must be RIGHT, not merely present. #262's diff edits exactly the journey files it can
// reach, so AC9 self-selection alone would produce almost the same answer and hide a useless map.
// This drives the three NON-journey paths on their own: the map has to earn the answer.
check("#262's source paths alone select the family journeys, with no help from self-selection", () => {
  const r = run([
    "apps/api/src/familyFloors.ts",
    "apps/api/research/business-analysis-v2.json",
    "apps/api/research/it-project-delivery-v2.json",
  ]);
  assert.equal(r.unmatched.length, 0);
  assert.equal(r.selected.length, 9);
  for (const j of RED_IN_262) assert.ok(r.selected.includes(j), `${j} must be reachable by the map alone`);
});

check("#262's genuinely red journeys still in the gate are all inside the selected set", () => {
  const { selected } = run(DIFF_262);
  for (const j of RED_IN_262) {
    assert.ok(selected.includes(j), `${j} went red in #262 and selection must not skip it`);
  }
});

// #271 (inherited from #264's gate): the shared-helper rule, as a check instead of a comment. A
// non-journey e2e helper imported by a gate journey MUST sit in SELECTS_ALL — otherwise it falls to
// the apps/web/e2e/** inert rule and editing it selects NOTHING while exiting 0, the silent-green
// this file exists to prevent. Found twice during #264 (qa-driver.mjs in design, live-ad-id.mjs
// only by the gate); this closes the class. Walks imports transitively.
check("every shared e2e helper a gate journey imports is in SELECTS_ALL", () => {
  const e2eDir = fileURLToPath(new URL("./", import.meta.url));
  const localImports = (file) =>
    [...readFileSync(e2eDir + file, "utf8").matchAll(/from\s+['"]\.\/([^'"]+\.mjs)['"]/g)].map((m) => m[1]);
  const seen = new Set(JOURNEYS);
  const queue = [...JOURNEYS];
  while (queue.length) {
    for (const dep of localImports(queue.pop())) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      queue.push(dep);
      assert.ok(
        SELECTS_ALL.includes(`apps/web/e2e/${dep}`),
        `${dep} is imported by a gate journey but missing from SELECTS_ALL — editing it would select nothing while exiting 0`,
      );
    }
  }
});

// #271 — the replay its AC demands. Every gate journey re-pointed at the front door must be
// SELECTED by a front-door diff: a journey that enters through the front door but is skipped on a
// front-door change is a hole in the gate, not a saving. The list is the 13 gate journeys #271
// re-pointed (job-blocks-no-family-question-journey.mjs was re-pointed too, but is in no tier) —
// twelve now: #339 retired discovery-earns-reveal-gate.mjs.
const REPOINTED_271 = [
  "change-of-direction-derived-journey.mjs",
  "contact-fact-journey.mjs",
  "credible-reveal-journey.mjs",
  "discovery-plan-split-journey.mjs",
  "family-years-scope-journey.mjs",
  "job-blocks-confirm-journey.mjs",
  "master-cv-dates-note-journey.mjs",
  "promise-counts-her-own-search-journey.mjs",
  "snapshot-is-not-permission-journey.mjs",
  "stale-search-tailor-return-journey.mjs",
  "unmapped-label-feed-journey.mjs",
  "years-worked-out-journey.mjs",
];

check("#271: a front-door diff selects every journey that now enters through it", () => {
  const r = run(["apps/web/app/page.tsx", "apps/web/app/frontdoor.css"]);
  assert.equal(r.unmatched.length, 0);
  for (const j of REPOINTED_271) {
    assert.ok(r.selected.includes(j), `${j} enters through the front door and must be selected by a front-door change`);
  }
});

// AC4 — the only route to zero is a diff that is entirely inert. Anything else must reach a journey
// or fail open; run-tier2.mjs turns any other zero into a hard error.
check("zero selected only ever means every changed path was inert", () => {
  const r = run([...DIFF_262, "apps/api/src/familyFloors.ts"]);
  assert.ok(r.selected.length > 0);
  const codeOnly = run(["apps/api/src/deck.ts"]);
  assert.ok(codeOnly.selected.length > 0, "a mapped code path must never select nothing");
});

let failed = 0;
for (const [name, fn] of checks) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${err.message.split("\n").join("\n       ")}`);
  }
}

if (failed > 0) {
  console.error(`\nTier 2 selection: ${failed} of ${checks.length} checks failed`);
  process.exit(1);
}
console.log(`\nTier 2 selection: all ${checks.length} checks passed`);
