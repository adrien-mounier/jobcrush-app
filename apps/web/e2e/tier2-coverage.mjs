// #264 — the Tier 2 coverage map: which source paths each gate journey can actually go red on.
//
// READ THIS BEFORE EDITING. This file is the one piece of machinery in the repo whose PURPOSE is
// running fewer tests, which is the exact accident run-mocked.mjs's header exists to prevent ("a
// rename can't silently shrink the gate"). Three rules keep it honest, and they are not polish:
//
//   1. FAIL OPEN. A changed path that matches nothing here selects EVERY journey. Unknown means
//      "unsafe to skip", never "safe to skip". A new subsystem nobody mapped must not fall out.
//   2. SELECTION IS NEVER THE FULL GATE. ci.yml runs `pnpm e2e:tier2` with no flag, so main and
//      every deploy still run all of them. --changed is a per-ticket convenience only.
//   3. A JOURNEY WITH NO ENTRY IS A HARD ERROR. Adding a journey to run-tier2.mjs without mapping
//      it here refuses to start, so it can never become quietly unselectable.
//
// What a COVERAGE entry means: "a change to this path can make this journey go red." Not "this
// journey's request eventually touches this file" — nearly every journey transitively touches
// sessions.ts and the onboarding route, which is why those live in SELECTS_ALL instead. The
// question each glob answers is whether the journey ASSERTS on that behaviour.
//
// The judgement call worth knowing about, recorded so a reviewer can disagree with it: the family
// registry (familyFloors.ts + research/*.json) is mapped to the journeys that read family IDENTITY
// back — the label on screen, the floor questions served, the placement stored, the family-scoped
// years — plus unmapped-label-feed, because the published set is precisely what decides whether a
// word counts as unmapped, and that feed is what it asserts on. Journeys that merely need SOME
// placement to succeed (credible-reveal, snapshot-is-not-permission, stale-search-tailor-return)
// are NOT selected by a registry edit, even though a drastic enough edit could reach them. That is
// a deliberate narrowing, and rule 2 is its net: the full gate still runs before anything deploys.
// Those same three DO carry CV_INTAKE: each pastes a real CV through the front door's paste tile
// (#271) and then asserts on what the parse produced, so the intake path is not a narrowing
// question — it is a path they genuinely walk.
//
// Note on this file and run-tier2.mjs themselves: both live under apps/web/e2e/**, so a diff that
// edits ONLY the map or the runner selects nothing and exits 0. That is right — neither can change
// what the product does — but it means editing the map does not re-prove the journeys it re-points.
//
// #271 discharged its obligation here: the re-pointed journeys enter through the front door, so
// CV_INTAKE now carries the front door's own files and no longer names the deleted screens. The
// replay proving a front-door diff selects every re-pointed journey lives in
// tier2-selection-check.mjs ("#271: a front-door diff...").

// ---------------------------------------------------------------------------------------------
// Shared areas. Named so a journey's entry reads as a list of subsystems, not a list of files.
// ---------------------------------------------------------------------------------------------
const FRONT_DOOR = ["apps/web/app/page.tsx", "apps/web/app/frontdoor.css"];
// #271: every journey that brings a CV in now walks the front door's paste tile to do it, so the
// front door IS the intake screen — a change to it can redden any CV_INTAKE journey. The old
// /paste, /import and /progress screens left this list the same day (SELECTS_NOTHING below).
const CV_INTAKE = [
  "apps/api/src/extract.ts",
  "apps/api/src/miner.ts",
  "apps/api/src/uploads.ts",
  "apps/api/src/rootcv.ts",
  "apps/api/src/routes/uploads.ts",
  "apps/api/src/routes/cv.ts",
  "apps/api/src/importReconciliation.ts",
  "apps/api/src/guestbook.ts",
  "apps/api/prompts/claim-miner.md",
  ...FRONT_DOOR,
];
const JOB_BLOCKS = [
  "apps/api/src/jobBlockMiner.ts",
  "apps/api/src/jobBlockStore.ts",
  "apps/api/src/jobBlockPlacementRetry.ts",
  "apps/api/src/routes/jobBlocks.ts",
  "apps/api/prompts/job-block-miner.md",
  "apps/web/app/job-blocks/**",
  "apps/web/app/job-blocks.css",
];
const DISCOVERY = [
  "apps/api/src/discovery.ts",
  "apps/api/src/discoveryEngine.ts",
  "apps/api/src/adaptiveDiscovery.ts",
  "apps/web/app/discovery/**",
  "apps/web/app/discovery.css",
];
const ELIGIBILITY = ["apps/api/src/eligibility.ts", "apps/api/src/eligibilityDiscovery.ts"];
const FAMILY_REGISTRY = ["apps/api/src/familyFloors.ts", "apps/api/research/*.json"];
const LABELER = [
  "apps/api/src/familyLabeler.ts",
  "apps/api/src/familyCandidateIntake.ts",
  "apps/api/src/qaFamilyAnswer.ts",
  "apps/api/prompts/family-labeler.md",
];
const VOCABULARY_FEED = [
  "apps/api/src/unmappedLabels.ts",
  "apps/api/src/familyLearning.ts",
  "apps/api/src/routes/familyLearning.ts",
];
const REVEAL_GATE = ["apps/api/src/gate.ts"];
const DECK = [
  "apps/api/src/deck.ts",
  "apps/api/src/deckFallback.ts",
  "apps/api/src/deckRetrieval.ts",
  "apps/api/src/judge*.ts",
  "apps/api/src/matchtick.ts",
  "apps/api/prompts/card-judge.md",
  "apps/web/app/deck/**",
  "apps/web/app/deck.css",
  "apps/web/app/jobcard.tsx",
];
const POSTINGS = [
  "apps/api/src/posting*.ts",
  "apps/api/src/adReader.ts",
  "apps/api/src/adRequirementsStore.ts",
  "apps/api/src/e5stub.ts",
  "apps/api/prompts/ad-reader.md",
  "apps/api/data/**",
];
const TAILOR = [
  "apps/api/src/tailor.ts",
  "apps/api/src/preview.ts",
  "apps/api/src/pipeline.ts",
  "apps/api/src/claims.ts",
  "apps/api/src/grill.ts",
  "apps/api/src/audit.ts",
  "apps/api/src/heldSentences.ts",
  "apps/api/src/graph.ts",
  "apps/api/prompts/preview-tailor.md",
  "apps/api/prompts/root-cv-audit.md",
  "apps/web/app/tailor/**",
  "apps/web/app/tailor.css",
];
const AUTH = [
  "apps/api/src/auth.ts",
  "apps/api/src/oauth.ts",
  "apps/api/src/mailer.ts",
  "apps/api/src/routes/auth.ts",
  "apps/web/app/auth/**",
  "apps/web/app/signup/**",
];
const PROFILE = ["apps/api/src/profile.ts", "apps/web/app/profile/**", "apps/web/app/profile.css"];
const FACTBADGE = ["apps/web/app/factbadge.tsx", "apps/web/app/factbadge.css"];
const YEARS = ["apps/api/src/yearsWorked.ts"];

const union = (...groups) => [...new Set(groups.flat())];

// ---------------------------------------------------------------------------------------------
// A change to one of these can reach any journey — the shared harness and the foundations every
// journey runs on top of. Matching here selects EVERYTHING, before any narrower rule is consulted.
// ---------------------------------------------------------------------------------------------
export const SELECTS_ALL = [
  "apps/web/e2e/qa-driver.mjs",
  // The other shared journey helper. Imported by family-years-scope and language-ladder (both in
  // the gate) and by uncurated-advert (not). Without this line it falls to the apps/web/e2e/**
  // inert rule below and a change to it selects NOTHING — the quietly-reduced gate this whole file
  // exists to prevent. Any new shared helper under e2e/ belongs here too.
  "apps/web/e2e/live-ad-id.mjs",
  "apps/api/src/server.ts",
  "apps/api/src/main.ts",
  "apps/api/src/qa-main.ts",
  "apps/api/src/sessions.ts",
  "apps/api/src/db.ts",
  "apps/api/src/storage.ts",
  "apps/api/src/llm*.ts",
  "apps/api/src/usageLedgerStore.ts",
  "apps/api/src/jobs.ts",
  "apps/api/src/routes/onboarding.ts",
  "apps/api/src/routes/sessions.ts",
  "apps/web/app/layout.tsx",
  "apps/web/app/globals.css",
  "apps/web/lib/**",
  "apps/web/next.config.*",
  "apps/web/playwright.config.ts",
  "packages/**",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "tsconfig.json",
  "apps/*/package.json",
  "apps/*/tsconfig.json",
];

// ---------------------------------------------------------------------------------------------
// A change to one of these cannot alter what any journey sees. Matching here selects nothing —
// and a diff made ENTIRELY of these exits clean with nothing to run (the local equivalent of
// ci.yml's paths-ignore). Deliberately NOT here: apps/api/prompts/*.md, which are the product.
// apps/web/e2e/** is inert only because it is consulted AFTER a journey has had the chance to
// select itself, and after qa-driver.mjs has claimed everything.
// ---------------------------------------------------------------------------------------------
export const SELECTS_NOTHING = [
  "docs/**",
  "*.md",
  "screenshots/**",
  ".claude/**",
  ".github/ISSUE_TEMPLATE/**",
  "**/README.md",
  "**/.gitignore",
  ".dockerignore",
  "apps/api/test/**",
  "apps/api/eval/**",
  "apps/api/vitest.eval.config.ts",
  "apps/api/scripts/**",
  "scripts/**",
  "research-data/**",
  "apps/web/e2e/**",
  "apps/web/prototypes/**",
  "apps/web/.impeccable/**",
  "apps/mobile/**",
  // No Tier 2 journey walks account withdrawal or the purge job — withdrawal-journey.mjs exists
  // but is not in the gate list. Listed rather than left unmapped so the judgement is visible: if
  // a journey for either is ever added to the gate, delete these two lines with it.
  "apps/api/src/withdrawal.ts",
  "apps/api/src/purge.ts",
  // #271: the old intake, wait and draft screens. No Tier 2 journey opens any of them any more —
  // every journey enters through the front door — so a change here cannot redden the gate. They
  // are deleted outright by #272; delete these four lines with them.
  "apps/web/app/paste/**",
  "apps/web/app/import/**",
  "apps/web/app/progress/**",
  "apps/web/app/preview/**",
];

// ---------------------------------------------------------------------------------------------
// journey -> the source paths it can go red on. Every journey in run-tier2.mjs needs an entry.
// ---------------------------------------------------------------------------------------------
export const COVERAGE = {
  // #190: phone/email captured from a CV header, corrected in the profile, carried into the draft.
  "contact-fact-journey.mjs": union(
    ["apps/api/src/contact.ts", "apps/api/src/routes/contact.ts"],
    CV_INTAKE,
    PROFILE,
    TAILOR,
    FRONT_DOOR,
  ),
  // #106: the eligibility block inside the placed family's floor, answered/declined/corrected.
  "eligibility-questions-journey.mjs": union(
    DISCOVERY,
    ELIGIBILITY,
    FAMILY_REGISTRY,
    LABELER,
    DECK,
    FRONT_DOOR,
  ),
  // #23: discovery -> reveal -> sign-in -> deck -> swipe -> tailor -> the ending and the exits.
  "tailor-journey.mjs": union(DISCOVERY, REVEAL_GATE, AUTH, DECK, TAILOR, POSTINGS),
  // #184/#172: the server-side search-area coverage gate at the front door, across a reload.
  "search-area-coverage-journey.mjs": union(FRONT_DOOR, DISCOVERY, POSTINGS, ELIGIBILITY),
  // #214: up to three location chips, city-vs-country resolution, per-market work rights.
  "target-locations-journey.mjs": union(FRONT_DOOR, DISCOVERY, ELIGIBILITY, POSTINGS, PROFILE),
  // #17: the fact badge's answer stream across discovery, profile, deck and tailor.
  "factbadge-journey.mjs": union(FACTBADGE, DISCOVERY, PROFILE, DECK, TAILOR, AUTH, REVEAL_GATE),
  // #102: the requirement-band rename staying invisible on the deck and in Tailor.
  "band-vocabulary-journey.mjs": union(POSTINGS, DECK, TAILOR, AUTH, DISCOVERY),
  // #162: years are derived from dated job records, never asked; a date hole is asked for instead.
  "years-worked-out-journey.mjs": union(CV_INTAKE, JOB_BLOCKS, DISCOVERY, DECK, YEARS),
  // #161/#157: the confirm-swipe deck for structured job records, undo and reload included.
  "job-blocks-confirm-journey.mjs": union(CV_INTAKE, JOB_BLOCKS, TAILOR, AUTH),
  // #165: a language and its level are two facts; the ladder on the deck's own cards.
  "language-ladder-journey.mjs": union(
    ["apps/api/src/language.ts", "apps/api/src/languageLevel.ts"],
    DISCOVERY,
    ELIGIBILITY,
    DECK,
    POSTINGS,
    PROFILE,
    AUTH,
  ),
  // #117: "Still scoring" / "Not scored" / "Estimate" — the judged score's three honest states.
  "pending-unscored-card-journey.mjs": union(DECK, POSTINGS, DISCOVERY, AUTH, TAILOR),
  // #159: the passive missing-dates note on the built master CV, and no uninvited "Present".
  "master-cv-dates-note-journey.mjs": union(CV_INTAKE, JOB_BLOCKS, TAILOR, AUTH),
  // #222: an advert's years bars read at their own scope — family years vs the career total.
  "family-years-scope-journey.mjs": union(
    CV_INTAKE,
    JOB_BLOCKS,
    FAMILY_REGISTRY,
    LABELER,
    DISCOVERY,
    DECK,
    YEARS,
  ),
  // #216/#234: the shipped interview writes the record the reveal is gated on.
  "discovery-plan-split-journey.mjs": union(
    DISCOVERY,
    FAMILY_REGISTRY,
    LABELER,
    REVEAL_GATE,
    DECK,
    AUTH,
    CV_INTAKE,
  ),
  // #216 gate: every floor answer is a real click on the screen's own button.
  "discovery-earns-reveal-gate.mjs": union(
    DISCOVERY,
    FAMILY_REGISTRY,
    LABELER,
    REVEAL_GATE,
    DECK,
    AUTH,
    CV_INTAKE,
  ),
  // #248: a fresh retrieval snapshot is not permission — every door onto the pool refuses.
  "snapshot-is-not-permission-journey.mjs": union(CV_INTAKE, REVEAL_GATE, POSTINGS, DECK, TAILOR, AUTH, DISCOVERY),
  // #63: the reveal is the server's to give; empty pool and provider outage read differently.
  "credible-reveal-journey.mjs": union(CV_INTAKE, REVEAL_GATE, POSTINGS, DECK, DISCOVERY, AUTH),
  // #63: changing her search area while tailoring must not dead-end her.
  "stale-search-tailor-return-journey.mjs": union(CV_INTAKE, POSTINGS, DECK, TAILOR, DISCOVERY, AUTH, REVEAL_GATE),
  // #246: the promise on question 1 counts her own search and names no job family.
  "promise-counts-her-own-search-journey.mjs": union(
    DISCOVERY,
    POSTINGS,
    FAMILY_REGISTRY,
    LABELER,
    CV_INTAKE,
    JOB_BLOCKS,
  ),
  // #243: family identity decides deletion, confidence decides order, on a real deck.
  "deck-family-fit-journey.mjs": union(
    DECK,
    POSTINGS,
    FAMILY_REGISTRY,
    LABELER,
    DISCOVERY,
    AUTH,
    // preview.ts is imported directly (loadPostings) — #264's gate found it missing here (#271).
    ["apps/api/src/counters.ts", "apps/api/src/preview.ts"],
  ),
  // #252/#251: the vocabulary-growth feed, its key, and the mark-harvested cycle.
  "unmapped-label-feed-journey.mjs": union(
    VOCABULARY_FEED,
    LABELER,
    FAMILY_REGISTRY,
    DISCOVERY,
    CV_INTAKE,
    JOB_BLOCKS,
  ),
  // #231/#235: a covered role placed, an unmapped one served without refusal, feed written.
  "family-placement-journey.mjs": union(FRONT_DOOR, DISCOVERY, FAMILY_REGISTRY, LABELER, VOCABULARY_FEED),
  // #256/#229: the change-of-direction sentence off a genuinely DERIVED known zero.
  "change-of-direction-derived-journey.mjs": union(
    CV_INTAKE,
    JOB_BLOCKS,
    FAMILY_REGISTRY,
    LABELER,
    DECK,
    AUTH,
    YEARS,
  ),
  // #260/#262: both published families read back at their active version, by name, on the screen.
  "family-role-name-journey.mjs": union(FAMILY_REGISTRY, LABELER, DISCOVERY, FRONT_DOOR),
};

const E2E_PREFIX = "apps/web/e2e/";

// Only the two `**` shapes this map actually uses (trailing "dir/**", leading "**/name") — a `**`
// in the middle would silently mis-match, so it is refused rather than half-supported.
function globToRegExp(glob) {
  const esc = (s) => s.replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, "[^/]*");
  if (glob.endsWith("/**")) return new RegExp(`^${esc(glob.slice(0, -3))}(?:/.*)?$`);
  if (glob.startsWith("**/")) return new RegExp(`^(?:.*/)?${esc(glob.slice(3))}$`);
  if (glob.includes("**")) throw new Error(`tier2-coverage.mjs: unsupported glob "${glob}"`);
  return new RegExp(`^${esc(glob)}$`);
}

const cache = new Map();
function matches(glob, path) {
  let re = cache.get(glob);
  if (!re) cache.set(glob, (re = globToRegExp(glob)));
  return re.test(path);
}

const firstMatch = (globs, path) => globs.find((g) => matches(g, path));

/** Throws if the map and the gate list have drifted apart (safety rule 3 / AC8). */
export function assertMapCoversGate(journeys) {
  const missing = journeys.filter((j) => !COVERAGE[j]);
  const stale = Object.keys(COVERAGE).filter((j) => !journeys.includes(j));
  if (missing.length || stale.length) {
    const lines = ["tier2-coverage.mjs is out of step with run-tier2.mjs's gate list:"];
    for (const j of missing) {
      lines.push(`  NO COVERAGE ENTRY: ${j} — map it, or it can never be selected`);
    }
    for (const j of stale) {
      lines.push(`  ENTRY FOR A JOURNEY NOT IN THE GATE: ${j} — delete it, or add the journey back`);
    }
    throw new Error(lines.join("\n"));
  }
}

/**
 * Decide which journeys a set of changed repo-relative paths can reach.
 * Fails open: anything unrecognised selects every journey.
 */
export function selectJourneys(changedPaths, journeys) {
  assertMapCoversGate(journeys);

  const reasons = new Map(); // journey -> why it was selected
  const inert = [];
  const unmatched = [];
  const select = (journey, why) => {
    if (!reasons.has(journey)) reasons.set(journey, why);
  };

  for (const path of changedPaths) {
    const shared = firstMatch(SELECTS_ALL, path);
    if (shared) {
      for (const j of journeys) select(j, `${path} matches ${shared} (shared foundation)`);
      continue;
    }
    // AC9: a journey file selects itself, rather than falling through to the catch-all.
    if (path.startsWith(E2E_PREFIX) && journeys.includes(path.slice(E2E_PREFIX.length))) {
      select(path.slice(E2E_PREFIX.length), `${path} is this journey`);
      continue;
    }
    const hits = journeys
      .map((j) => [j, firstMatch(COVERAGE[j], path)])
      .filter(([, glob]) => glob !== undefined);
    if (hits.length) {
      for (const [j, glob] of hits) select(j, `${path} matches ${glob}`);
      continue;
    }
    const nothing = firstMatch(SELECTS_NOTHING, path);
    if (nothing) {
      inert.push(`${path} matches ${nothing}`);
      continue;
    }
    unmatched.push(path);
  }

  // Safety rule 1: an unmapped path means we do not know what it can break, so run everything.
  if (unmatched.length) {
    for (const j of journeys) {
      if (!reasons.has(j)) reasons.set(j, `unmapped path ${unmatched[0]} — running everything`);
    }
  }

  return {
    selected: journeys.filter((j) => reasons.has(j)),
    skipped: journeys.filter((j) => !reasons.has(j)),
    reasons,
    inert,
    unmatched,
  };
}
