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
//
// #264 added `--changed=<ref>`: run only the journeys the diff since <ref> can actually reach, per
// tier2-coverage.mjs. NO FLAG STILL RUNS EVERY JOURNEY, which is how ci.yml invokes it, so main and
// every deploy keep the full gate. Read tier2-coverage.mjs's header before trusting a selected run.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";
import { assertMapCoversGate, selectJourneys } from "./tier2-coverage.mjs";

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
export const JOURNEYS = [
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
  // #222: the only journey that can catch the family-scoped years reading going dead on the
  // shipped journey — the exact regression its own QA gate found once already (a production
  // caller whose guard could never be true). A/B: a placed target role reads family years, an
  // unmapped one falls back to the career total. ~3 min against the fake-model API.
  "family-years-scope-journey.mjs",
  // #216 (over #234): the only journey that walks the shipped discovery screen and then reads back
  // the record HER OWN answers wrote - the plan pinned to her session and the coverage checkpoint
  // the reveal is gated on. It is the guard against the two engines growing back (it asserts the
  // retired /onboarding/discovery/production/* routes are gone) and against #235's word search
  // regressing into a refusal for the visitor no published family covers. ~2 min against the
  // fake-model API; one magic-link sign-in.
  "discovery-plan-split-journey.mjs",
  // #216: the only journey that answers every floor question by PRESSING THE SCREEN'S OWN BUTTONS
  // (option buttons and the free-text items alike) and then reads back the record those presses
  // wrote. That is the ticket's whole claim - the questions she is asked are the questions the
  // reveal is earned from - and a payload-level POST cannot prove it, which is exactly why the
  // defect survived a green suite for so long. Also drives BOTH ends of the labeler in real
  // browsers and probes #59's fixture seam for a reveal it must not be able to authorize.
  // Measured ~3 min against the fake-model API; one magic-link sign-in.
  "discovery-earns-reveal-gate.mjs",
  // #282, added on its own QA gate's finding: the industry axis's real-stack journeys were in NO
  // tier, so the only end-to-end proof of the second label axis ran when somebody remembered to run
  // it. That is the fourth time this repo has hit the same shape (see lessons.md), and it bit here
  // for real — the gate found every industry correction failing with a 400 against the live stack
  // while `pnpm test` stayed green, because nothing in a tier ever pressed Save.
  //   job-blocks-industry — #281's walk: a placed job, an honestly unplaced one, a correction that
  //                         survives a reload, and the degree that is never labeled at all.
  //   ...-lookup          — #282's: the same CV where one employer HAS a web lookup behind it and
  //                         one has none, asserting the v2 stored shape on the wire and watching
  //                         the correction's response STATUS, which the older journey could not see.
  "job-blocks-industry-journey.mjs",
  "job-blocks-industry-lookup-journey.mjs",
  // #248: the only journey that attacks the reveal authorization instead of walking it. It plants a
  // real, fresh, fingerprint-matching advert snapshot on a session whose floor is NOT covered - the
  // state #246 creates on purpose - and then tries every door onto the posting pool: the deck, a
  // guessed advert id at the want route, the tailor target, and her own session record. The guard
  // was wrong once in exactly this way (it covered the deck's status field but not its cards), so
  // the property needs a journey that would go red rather than a reviewer who happens to look.
  // ~2 min against the fake-model API; one magic-link sign-in.
  "snapshot-is-not-permission-journey.mjs",
  // #63: the only journey that proves a card cannot exist without a retrieval result. It earns the
  // reveal, counts the number on screen against the adverts actually fetched (none carrying a
  // fixture id), and then attacks the gate from the client - ?reveal=1, ?checkpoint=..., forged
  // headers, naming a stored advert by id at the want route. It is ALSO the only test anywhere that
  // looks at the empty-pool and outage screens, whose whole reason for existing is that they must
  // never share words (#174): "we asked and found nothing" and "we could not ask" are different
  // facts, and every market runs on a single provider, so collapsing them tells someone her market
  // is empty when our one supplier was offline. Reachable only via POST /qa/stack's
  // retrievalOutcome knob. ~2 min against the fake-model API; one magic-link sign-in.
  "credible-reveal-journey.mjs",
  // #63: the regression guard for the defect that cost that ticket its first QA gate - a visitor who
  // changed where she was looking WHILE tailoring a job lost it, to a "Try again" that 404s for ever
  // with no way back to her deck. The server is right to refuse a job from a search that no longer
  // applies (#101's fail-closed rule); the stored-advert pool had been hiding that refusal for
  // years. Only a browser can prove the recovery, because the fix is a redirect and every
  // server-side assertion still (correctly) sees a 404. ~2 min against the fake-model API; one
  // magic-link sign-in.
  "stale-search-tailor-return-journey.mjs",
  // #246: the only test anywhere that reads the discovery promise off a RENDERED screen. Everything
  // else that touches that sentence is server-side, and the one Tier 1 spec that asserted it
  // (discovery.spec.ts) is `test.skip` — so without this entry the copy rule the ticket exists to
  // enforce would ship guarded by nothing, which is the exact rot this file's header describes. It
  // proves the sentence names no job family, vocabulary, research or place, for a MAPPED visitor and
  // for a word-search visitor alike; that the number she is promised is the one her own search
  // returned and holds across four answers and a reload; and that an empty search and a provider
  // outage each leave no promise line at all rather than a broken one or a zero. ~2 min against the
  // fake-model API; no sign-in, so it spends none of auth's 5-per-15-min limiter budget.
  "promise-counts-her-own-search-journey.mjs",
  // #247 (owner: "I want a high quality QA", 2026-08-20): the only test anywhere that proves #243's
  // confidence rule off a REAL deck response end to end — same-family deletion counted on
  // /ops/counters, a word-search deck deleting nothing, and the confidence server's converged
  // one-score deck where a weak read sinks below every strong card without its score moving. Was
  // the exact journey this file's header warns about: red in no tier, claiming more than its
  // harness proved, until its pool moved to the retrieval seam. ~3 min; one magic-link sign-in.
  "deck-family-fit-journey.mjs",
  // #252/#253 (same owner call): the only end-to-end proof of the vocabulary-growth feed a run
  // harvests — an unmapped role recorded with person link and reason, the waiting counts, the
  // mark-harvested cycle (idempotent, first harvest time survives, nothing deleted). Sat in no
  // tier, which is how its OPS_KEY requirement went unnoticed until a hand-run 403'd: both these
  // journeys read /ops/unmapped-labels, so ci.yml now starts the fake-model API with
  // OPS_KEY=qa-ops-key (the journeys' documented default). ~2 min; no sign-in.
  "unmapped-label-feed-journey.mjs",
  // #231/#235 (same owner call): the family-placement walk a visitor takes — a covered role placed,
  // an unmapped one served without refusal, the unmapped label landing in the feed (its AC7 reads
  // the feed, hence OPS_KEY above). ORDER CONSTRAINT: must run AFTER unmapped-label-feed-journey —
  // that one performs a real, irreversible harvest write on the shared API, and this one's feed
  // read looks for a label minted after it. ~2 min; no sign-in.
  "family-placement-journey.mjs",
  // #256: the only asset anywhere that can catch #229's derivation going dead. The three
  // deck.spec.ts tests for the change-of-direction sentence all HAND the browser newToFamily, so
  // they would stay green if the server stopped working it out. This one corrects her dated jobs
  // into a second published family through the real correction door and reads the sentence off a
  // populated deck, with an A/B control that skips the correction and must be told nothing. Only
  // possible since the second family published (#255) — with one family the fallback always
  // carried a years fact. ~2 min against the fake-model API; no sign-in.
  "change-of-direction-derived-journey.mjs",
  // family-role-name-journey.mjs added 2026-08-21 (#260 rename), written by the QA gate that found
  // the rename's stale version pins. It earns its slot on the same "a specific real-stack
  // regression it alone can catch" rule: it is the ONLY journey that drives question 1's type-ahead
  // for BOTH published families and all four scope aliases through the real screen and asserts the
  // family NAME a visitor is shown, not just the API payload. Every other check of the published
  // label is either an API-level unit test or a negative ("the label never appears"), and negatives
  // cannot catch a family being renamed to the wrong thing — they go green when the name is absent
  // for any reason at all. 67 assertions; mutation-proven to fail (63/4) when the label is wrong.
  "family-role-name-journey.mjs",
  // #278: the only journey that reaches the work-history check the way a PERSON reaches it. Every
  // other journey that touches that screen types its address, which is exactly how it went four
  // days without anyone noticing #272 had deleted its only door. It walks front door -> role and
  // area -> discovery -> the fact pile -> the profile -> the work-history door, corrects a record
  // through it and reads the correction back off the server, then leaves by the way out and comes
  // back in. A door is only a door if it is reachable AND exitable, and no address-typing journey
  // can go red when either half breaks. ~2 min against the fake-model API; no sign-in.
  "work-history-door-journey.mjs",
  // The two paste-door journeys, added 2026-09-28 (#304, owner's call recorded on the ticket).
  // They earn their slots on this file's own rule — a specific real-stack regression each alone can
  // catch — and #303 supplied the proof rather than the argument: an adId encoded twice made EVERY
  // paste 404 on the job's own screen while 1721 unit tests stayed green. That class of bug is only
  // visible in a browser, and #304, #305 and #306 all change either the paste screen or the job
  // screen, so this is a regression net under work already queued.
  //   paste-door  — the door in every top-bar slot, the link pre-fill, one advert shared by two
  //                 people, the landing on the job's own screen. ~2 min; TWO sign-ins per run,
  //                 against the generous limiter qa-main.ts already passes.
  //   paste-wait  — #304's own render test: the three named steps in order, the requirements on the
  //                 paste screen before anything is scored, and the failure screen that keeps his
  //                 text. Every one of those is proved server-side in pasteAdvert.test.ts and none
  //                 of that proves a screen. ~50s; no sign-in, so it spends no limiter budget.
  "paste-door-journey.mjs",
  "paste-wait-journey.mjs",
];

// Only run when invoked directly — the selection self-check imports JOURNEYS from here.
//
// Compared by BASENAME, and the name is DERIVED from this file rather than typed as a literal. Both
// halves matter, and the first version of this guard got both wrong:
//   - an exact full-path compare is a false green waiting to happen (a symlinked checkout or a
//     drive-letter case difference on Windows skips main() and exits 0 — a gate that runs nothing
//     and reports success);
//   - a hardcoded "run-tier2.mjs" literal reintroduces the exact hazard run-mocked.mjs's header
//     warns about, that "a rename can't silently shrink the gate" — renaming this file would make
//     every future run a silent no-op.
// A missing argv[1] (imported through `node -e`) is UNDECIDABLE — it could be a direct run or an
// import — so it refuses loudly instead of guessing. Guessing "skip" is the silent green this whole
// guard exists to prevent; guessing "run" ambushes an importer with the hour-long sweep. The one
// outcome this gate may never have is running nothing while exiting 0.
const invokedAs = basename(process.argv[1] ?? "").toLowerCase();
const thisFile = basename(fileURLToPath(import.meta.url)).toLowerCase();
if (invokedAs === "") {
  console.error(
    `run-tier2.mjs: cannot tell a direct run from an import with no argv[1] — refusing rather than silently running nothing. Invoke it as \`node <path>/${thisFile}\`.`,
  );
  process.exit(1);
}
if (invokedAs === thisFile) {
  main();
}

function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8", cwd: e2eDir });
  if (r.status !== 0) {
    console.error(`run-tier2.mjs: \`git ${args.join(" ")}\` failed — refusing to guess what changed`);
    if (r.stderr) console.error(r.stderr.trim());
    process.exit(1);
  }
  return r.stdout;
}

// Committed changes since <ref>, PLUS the working tree — a ticket's work is usually uncommitted when
// the gate runs, and a selection blind to it would run the wrong journeys (or none).
function changedPathsSince(ref) {
  const paths = new Set();
  for (const line of git(["diff", "--name-only", `${ref}...HEAD`]).split("\n")) {
    if (line.trim()) paths.add(line.trim());
  }
  // -z, so git never quotes or backslash-escapes a path: a non-ASCII or odd filename reaches us
  // intact instead of arriving mangled. Fields are NUL-separated; a status field reads "XY path",
  // and a rename's SOURCE follows as a bare field. Both sides matter (the old path may have been a
  // journey), and adding every field covers both without parsing the rename shape.
  for (const field of git(["status", "--porcelain", "-z", "--untracked-files=all"]).split("\u0000")) {
    if (!field) continue;
    paths.add(/^[ MADRCU?!]{2} /.test(field) ? field.slice(3) : field);
  }
  return [...paths].sort();
}

function main() {
  // AC8, whether or not selection is being used: a journey nobody mapped must not reach the gate.
  assertMapCoversGate(JOURNEYS);

  const flag = process.argv.slice(2).find((a) => a === "--changed" || a.startsWith("--changed="));
  let journeys = JOURNEYS;

  if (flag) {
    // Safety rule 2, enforced rather than written: selection is a per-ticket convenience, and a
    // deploy is only ever allowed to depend on the full gate. ci.yml passes no flag today; this
    // refuses to let a future edit narrow the deploy gate quietly.
    if (process.env.CI) {
      console.error(
        "run-tier2.mjs: --changed is refused on CI. The deploy gate is all the journeys, always — run it with no flag.",
      );
      process.exit(1);
    }
    // No default ref on purpose. Defaulting to "main" is wrong in THIS repo, where ordinary work
    // happens ON main: the merge-base is then HEAD, so the committed half of the diff is always
    // empty and work already committed for the ticket goes invisible — under-selection, silently.
    const ref = flag.includes("=") ? flag.slice(flag.indexOf("=") + 1) : "";
    if (!ref) {
      console.error(
        "run-tier2.mjs: --changed needs an explicit base, e.g. --changed=HEAD~3 or --changed=origin/main",
      );
      process.exit(1);
    }
    const changed = changedPathsSince(ref);

    if (changed.length === 0) {
      console.error(
        `run-tier2.mjs: nothing has changed since ${ref}, so there is nothing to select. Run without --changed for the full gate.`,
      );
      process.exit(1);
    }

    const { selected, skipped, reasons, inert, unmatched } = selectJourneys(changed, JOURNEYS);

    console.log(`\nTier 2 selection: ${changed.length} changed path(s) since ${ref}`);
    if (unmatched.length > 0) {
      console.log("\n  !!  UNMAPPED PATHS — RUNNING EVERY JOURNEY  !!");
      console.log("  Nothing in tier2-coverage.mjs claims these, so we cannot know what they break:");
      for (const p of unmatched) console.log(`    ${p}`);
      console.log("  Map them in tier2-coverage.mjs to get selection back on this kind of change.");
    }
    console.log(`\n  SELECTED (${selected.length}):`);
    for (const j of selected) console.log(`    ${j}  <-  ${reasons.get(j)}`);
    console.log(`\n  SKIPPED (${skipped.length}): nothing in this diff can reach them`);
    for (const j of skipped) console.log(`    ${j}`);
    if (inert.length > 0) {
      console.log(`\n  CHANGED BUT INERT (${inert.length}): cannot alter what a journey sees`);
      for (const line of inert) console.log(`    ${line}`);
    }
    console.log(
      "\n  Selection is NOT the gate: ci.yml runs this with no flag, so main and every deploy still run all " +
        `${JOURNEYS.length}.\n`,
    );

    if (selected.length === 0) {
      // Every changed path was inert (docs, unit tests, non-gate e2e files) — the local equivalent
      // of ci.yml's paths-ignore. Anything else reaching zero is a bug in the map, not a fast pass.
      if (inert.length === changed.length) {
        console.log("Tier 2: no journey can be reached by this diff — nothing to run.");
        process.exit(0);
      }
      console.error(
        "run-tier2.mjs: selected ZERO journeys from a diff that is not entirely inert — that is a hole in tier2-coverage.mjs, not a pass.",
      );
      process.exit(1);
    }
    journeys = selected;
  }

  let failed = 0;
  for (const file of journeys) {
    console.log(`\n=== Tier 2: ${file} ===`);
    // shell:true only for the Windows-vs-POSIX node shim question moot here (node is invoked directly,
    // not via a .cmd wrapper) — kept false, matching run-mocked's own reasoning against the CVE-2024-27980
    // .cmd/.bat concern, which does not apply to a plain "node" binary.
    const result = spawnSync("node", [`${e2eDir}${file}`], { stdio: "inherit" });
    if (result.status !== 0) failed += 1;
  }

  const scope = journeys.length === JOURNEYS.length ? "all" : `${journeys.length} selected of`;
  if (failed > 0) {
    console.error(`\nTier 2: ${failed} of ${journeys.length} journeys failed`);
    process.exit(1);
  }
  console.log(`\nTier 2: ${scope} ${journeys.length} journeys passed`);
}
