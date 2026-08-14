// QA entrypoint: a fake-model twin of main.ts, built for the real-stack journeys (#199, Tier 2) —
// scripts that drive genuine miner/tailor/grill/audit calls end to end with no paid key. Real
// Fastify, real routes, real extraction, real miner parsing, real Draft validation + conservation
// lint, real render; only `llm` is a stage-aware fake instead of llmFromEnv().
//
// This is NOT a twin of main.ts's full wiring. The CI Tier 1 gate (route-mocked specs) intercepts
// every PAID pipeline call at the browser's network layer before it reaches this process, and
// asserts GET /qa/llm-calls shows mine/tailor/grill/audit all zero after the run to prove it (see
// ci.yml). Measured 2026-08-13 (#209): `judge` is NOT zero after a Tier 1 run — some spec reaches
// the deck route unmocked, and with a judge wired that route now calls this fake ~8 times. That is
// free and deterministic (the fake answers instantly and no model exists to bill), which is why the
// zero-assertion deliberately still covers the four paid stages only. Do not add "judge":0 to it
// without first making the spec that reaches the deck mock its own call.
//
// Unwired relative to main.ts, so a route that depends on one of these can pass here and still fail
// on staging:
//   - claims / auth / eligibility / contact / familyLearning: in-memory only (server.ts's own
//     defaults), never Postgres — persistence-across-restart is untested.
//   - readAd / judge / judgePeek: wired (#209), but to canned data and the fake — never a paid call.
//     Judging runs the REAL makeJudge/makeJudgePeek over an in-memory store, answering instantly.
//     Advert-reading serves a three-entry table below and is DISARMED by default, so an unarmed run
//     sees exactly the fixture-only deck it saw before this ticket. Both knobs are armed per-journey
//     through POST /qa/stack — see their own comments for the measured reason they are not defaults.
//   - usage-ledger / cost metering: the fake is never wrapped in meterLlm, so no per-call cost
//     attribution path runs.
//   - postings retrieval / techmap providers: entirely absent — no provider registry, no store.
//   - the 6h purge sweep: absent (nothing to purge without DATABASE_URL).
//
// Deliberately a SEPARATE entry, not an `LLM_DRIVER=fake` branch inside main.ts/llmFromEnv(): a
// branch would put production one env var away from serving fabricated CV content. This file is
// never imported by main.ts, never referenced by any fly.*.toml, and pruned from the Docker image
// (Dockerfile, right after the api build step) — so the fake cannot reach a deployed process.
//
// Storage/mail/guestbook are constructed directly here (LocalDiskStorage, DevMailer,
// createGuestbook() with no DB url), never via storageFromEnv()/mailerFromEnv()/the
// DATABASE_URL-reading guestbook default — those read ambient R2_*/RESEND_API_KEY/DATABASE_URL
// unconditionally, and this repo's staging-ops shells export exactly those for the shared
// Cloudflare/Postgres accounts (SHARED_INFRA.md). A QA run must never be one exported env var away
// from writing to the real bucket, sending real email, or logging to the real visits table.
//
//   node dist/qa-main.js                 # API on :34101 (PORT overrides), no ANTHROPIC_API_KEY needed
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 3000
//
// :34101, not :3001 (main.ts's port), on purpose: if a real dev API is already up on 3001, both
// expose GET /healthz identically, so a health-wait against /healthz would pass against the WRONG
// server and a "never spend money" run would spend. A distinct port makes that collision impossible
// rather than merely unlikely.
//
// The fake is stage-aware: it reads the prompt it is handed and answers with a canned, valid
// payload for that stage — the same idiom apps/api/test uses (test/miner.test.ts fakeLlm,
// test/preview.test.ts llmReturning), just switched on the prompt's own content instead of a
// scripted call queue, because a live server cannot know the call order in advance. An unrecognized
// prompt throws rather than guessing: a guessed match (e.g. "any prompt with a trailing JSON array
// is the audit") is exactly the silent-drift shape this repo keeps writing down — rewording one
// stage's prompt could quietly misroute it into another stage's branch and still pass that branch's
// own shape checks.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AdRequirementsV1 } from "@jobcrush/contracts";
import { buildServer } from "./server.js";
import { LocalDiskStorage } from "./storage.js";
import { makeMineStep } from "./miner.js";
import { makeMineJobBlocksStep } from "./jobBlockMiner.js";
import { makePreviewStep, type Draft } from "./preview.js";
import { makeGrillPhraser } from "./grill.js";
import { makeCvAuditor } from "./audit.js";
import { initialProductionFamilyFloors } from "./familyFloors.js";
import { makeFamilyPlacer, publishedFamilies } from "./familyLabeler.js";
import { makeFamilyCandidateScreen } from "./familyLearning.js";
import { makeJudge, makeJudgePeek } from "./judge.js";
// InMemoryJudgementStore directly, never judgementStoreFromEnv(): that helper reads ambient
// DATABASE_URL and would write judgements to the real shared Postgres from a QA run.
import { InMemoryJudgementStore } from "./judgementStore.js";
import { DevMailer } from "./mailer.js";
import { createGuestbook } from "./guestbook.js";
import { IpRateLimiter } from "./sessions.js";
import type { LlmClient } from "./llm.js";

const here = dirname(fileURLToPath(import.meta.url));

// The recorded real-miner output apps/api/test/preview.test.ts rides on: a genuine CandidateClaims
// doc, so the miner's own parser/validator runs for real against it.
const MINED = readFileSync(join(here, "..", "test", "eval", "recordings", "clean-pdf.json"), "utf8");

// The SAME recorded doc with one role's dates removed, returned when the pasted CV carries the
// marker "DATESMISSING" (#209). `dates_missing` is the only signal the grill has for "this role has
// no dates" (grill.ts), so it is the only thing that makes a missing-dates question — and therefore
// the master CV's passive missing-dates note (#159) — reachable at all. Derived from the recording
// by changing that one field rather than hand-writing a second claims doc, so the miner's real
// parser/validator still runs against genuine recorded output.
const MINED_UNDATED_ROLE = (() => {
  const doc = JSON.parse(MINED) as { roles: Array<{ dates_as_written: string; dates_missing: boolean }> };
  const last = doc.roles[doc.roles.length - 1]!;
  last.dates_as_written = "";
  last.dates_missing = true;
  return JSON.stringify(doc);
})();

// The conserving draft from apps/api/test/preview.test.ts's sampleDraft: claim ids are real ids
// from the doc above, which is what conservationIssues() cross-checks.
const DRAFT: Draft = {
  name: "Maria Kowalski",
  headline: "IT Project Manager for enterprise delivery",
  contact: "Warsaw · maria.kowalski@example.com",
  summary: "Project manager with delivery accountability across vendors.",
  experience: [
    {
      role: "IT Project Manager",
      employer: "Nordic Retail Group",
      location: "Warsaw, Poland",
      dates: "Mar 2021 - Present",
      bullets: [
        { text: "Led the checkout replatforming, delivered 2 months early", outcome: "", claimIds: ["nrg-led-checkout-replatform"] },
        { text: "Managed a budget of EUR 1.2M across 3 vendor teams", outcome: "", claimIds: ["nrg-managed-budget"] },
        { text: "Ran steering committee reporting for the CIO", outcome: "", claimIds: ["nrg-steering-committee-reporting"] },
      ],
      unprinted: [],
    },
  ],
  skills: [{ label: "Delivery", items: ["Jira", "MS Project"] }],
  certifications: [
    { name: "PRINCE2 Practitioner", date: "2019" },
    { name: "PSM I", date: "2020" },
  ],
  education: [{ institution: "University of Warsaw", detail: "MSc MIS", dates: "2017" }],
  additional: [{ label: "Languages", value: "Polish (Native), English (Fluent)" }],
};

const seen = { mine: 0, tailor: 0, grill: 0, audit: 0, jobBlocks: 0, judge: 0, familyPlacement: 0, unknown: 0 };

// A canned, contract-valid MinedJobBlocks doc (#161): three dated blocks exercising the shapes the
// confirm deck cares about — a month-precision ended job, a year-precision ongoing job, and an
// education block (kind decides counting; education must not add to experience). Kept inline like
// DRAFT above rather than recorded: the job-block miner has no recorded real output yet.
const JOB_BLOCKS = JSON.stringify({
  schemaVersion: "1",
  blocks: [
    {
      id: "nordic-retail-it-pm",
      employer: { value: "Nordic Retail Group", source_quote: "Nordic Retail Group", machine_touch: "verbatim", classification: "Verified" },
      title: { value: "IT Project Manager", source_quote: "IT Project Manager", machine_touch: "verbatim", classification: "Verified" },
      start: { value: { year: 2021, month: 3, precision: "month" }, source_quote: "Mar 2021", machine_touch: "verbatim", classification: "Verified" },
      end: { value: { state: "ongoing" }, source_quote: "Present", machine_touch: "verbatim", classification: "Verified" },
      kind: { value: "job", source_quote: "IT Project Manager, Nordic Retail Group", machine_touch: "inferred", classification: "Derived" },
    },
    {
      id: "baltic-systems-coordinator",
      employer: { value: "Baltic Systems", source_quote: "Baltic Systems sp. z o.o.", machine_touch: "verbatim", classification: "Verified" },
      title: { value: "Project Coordinator", source_quote: "Project Coordinator", machine_touch: "verbatim", classification: "Verified" },
      start: { value: { year: 2018, month: null, precision: "year" }, source_quote: "2018 - 2021", machine_touch: "verbatim", classification: "Verified" },
      end: { value: { state: "ended", date: { year: 2021, month: null, precision: "year" } }, source_quote: "2018 - 2021", machine_touch: "verbatim", classification: "Verified" },
      kind: { value: "job", source_quote: "Project Coordinator, Baltic Systems", machine_touch: "inferred", classification: "Derived" },
    },
    {
      id: "university-of-warsaw-msc",
      employer: { value: "University of Warsaw", source_quote: "University of Warsaw", machine_touch: "verbatim", classification: "Verified" },
      title: { value: "MSc Management Information Systems", source_quote: "MSc MIS", machine_touch: "reworded", classification: "Verified" },
      start: { value: { year: 2015, month: null, precision: "year" }, source_quote: "2015 - 2017", machine_touch: "verbatim", classification: "Verified" },
      end: { value: { state: "ended", date: { year: 2017, month: null, precision: "year" } }, source_quote: "2015 - 2017", machine_touch: "verbatim", classification: "Verified" },
      kind: { value: "education", source_quote: "MSc MIS, University of Warsaw", machine_touch: "inferred", classification: "Verified" },
    },
  ],
  parser_flags: [],
});

// The RE-READ of the same CV, returned when the pasted text carries the marker "SECOND UPLOAD"
// (#209). A person who pastes their CV a second time is the only way the ambiguous-match state
// (jobBlockStore.ts's classifyIncoming: same employer + overlapping period + a DIFFERENT title) is
// reachable through the product at all — and the fake could never produce it, because it answered
// every job-block prompt with the identical ids above, which ingest() skips outright as collisions.
// That is why job-blocks-confirm-journey.mjs died on an empty deck at its second upload, NOT the
// unwired `mineJobBlocks` its own header used to blame (that step has always been wired, below).
//
// Content-triggered, and deliberately so: a live server cannot be told "answer differently on the
// second call" out of band, and a call COUNTER would make the fake's answer depend on how many
// other journeys had run first. The CV text is the one thing the journey controls and the fake
// already reads. Both markers are strings no real CV contains.
//
// Carries the three originals unchanged (their ids collide and are skipped — the re-read of a
// recognised job, exercised for free) plus ONE row: the same Nordic Retail Group period under a
// different title, which is the ambiguous case.
const JOB_BLOCKS_REREAD = JSON.stringify({
  ...JSON.parse(JOB_BLOCKS),
  blocks: [
    ...JSON.parse(JOB_BLOCKS).blocks,
    {
      id: "nordic-retail-delivery-lead",
      employer: { value: "Nordic Retail Group", source_quote: "Nordic Retail Group", machine_touch: "verbatim", classification: "Verified" },
      title: { value: "Delivery Lead", source_quote: "Delivery Lead", machine_touch: "verbatim", classification: "Verified" },
      start: { value: { year: 2021, month: 3, precision: "month" }, source_quote: "Mar 2021", machine_touch: "verbatim", classification: "Verified" },
      end: { value: { state: "ongoing" }, source_quote: "Present", machine_touch: "verbatim", classification: "Verified" },
      kind: { value: "job", source_quote: "Delivery Lead, Nordic Retail Group", machine_touch: "inferred", classification: "Derived" },
    },
  ],
});

// A history the read cannot make sense of, returned when the CV carries the marker "FAILTHISREAD"
// (#209). Structurally invalid, NOT a thrown error: mineJobBlocks retries once and then throws,
// pipeline.ts catches that and records a run that RAN and FAILED — the "not_run vs ran-and-failed"
// distinction the confirm screen's failed-read copy exists for (#161 AC8). Throwing here instead
// would fail the fake's own "never guess" contract for a case that is not a prompt-drift bug.
const JOB_BLOCKS_UNREADABLE = JSON.stringify({ schemaVersion: "1", blocks: "not a list of blocks" });

// Count the items in the trailing JSON array of a prompt (grill + audit both append one).
function trailingArrayLength(prompt: string): number {
  const start = prompt.indexOf("[");
  const end = prompt.lastIndexOf("]");
  if (start === -1 || end <= start) return 0;
  try {
    const parsed: unknown = JSON.parse(prompt.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

// #209 — the judge-delay knob. pending-unscored-card-journey.mjs exists to prove the three states a
// deck card can be in while the paid judging pass runs: "Still scoring" (a real attempt genuinely in
// flight), "Not scored" (deliberately never bought — outside DECK_JUDGE_MAX_CARDS), and the number
// filling in WITHOUT a reload. None of them are observable against a judge that answers instantly:
// every card lands `judged` before the reveal is even dismissed.
//
// So the fake judge can be made SLOWER than the deck's own DECK_JUDGE_BUDGET_MS (8s) — the deck then
// gives up waiting, renders `pending`, and the judgement lands in the store a few seconds later for
// the client's next poll to pick up.
//
// OFF BY DEFAULT, and that is not timidity. Measured 2026-08-13: with the delay on, the deck's top
// card is `pending`, which has no score ring — and tailor-journey.mjs (Tier 2, green for weeks)
// asserts that ring on its first screen. A knob that reshapes every OTHER journey's deck to fix one
// is not a fix. The journey that needs the delay ARMS it for its own run and puts it back
// afterwards, through the QA-only route below; run-tier2.mjs runs journeys sequentially (its own
// header says why), so a process-wide switch has exactly one owner at a time.
//
// QA_JUDGE_DELAY_MS sets the starting value for a run that wants it on from the first request.
let judgeDelayMs = Number(process.env.QA_JUDGE_DELAY_MS ?? 0);

// #209 — the same arming rule, for the canned language adverts below. Off by default and for the
// same measured reason: serving them adds three cards to EVERY deck, and tailor-journey.mjs (Tier 2,
// green for weeks) then tailors one of them and asks about a language requirement, which is not the
// screen it was written to walk. A fabricated advert should be visible to exactly the journey that
// asked for it. QA_LANGUAGE_ADVERTS=on starts a run with them already served.
let languageAdvertsOn = process.env.QA_LANGUAGE_ADVERTS === "on";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fakeLlm: LlmClient = {
  model: "qa-fake",
  async complete(prompt: string): Promise<string> {
    // BEFORE the claim-miner branch: both miners end in the same ===CV-TEXT=== data marker, so the
    // job-block miner needs its own affirmative match (its prompt's opening line) checked first —
    // the marker alone would misroute it into the claim-miner branch (the silent-drift shape again).
    if (prompt.includes("You are the job-block miner")) {
      seen.jobBlocks += 1;
      // The two CV-text markers, checked before the ordinary answer — see JOB_BLOCKS_REREAD.
      if (prompt.includes("FAILTHISREAD")) return JOB_BLOCKS_UNREADABLE;
      if (prompt.includes("SECOND UPLOAD")) return JOB_BLOCKS_REREAD;
      return JOB_BLOCKS;
    }
    if (prompt.includes("===CV-TEXT===")) {
      seen.mine += 1;
      return prompt.includes("DATESMISSING") ? MINED_UNDATED_ROLE : MINED;
    }
    if (prompt.includes("===JOB-POSTING===")) {
      seen.tailor += 1;
      // preview-tailor.md rule 3 tells the real tailor to carry the candidate's own header through
      // verbatim. The fake must do the same, or a flow that checks the rendered contact line is
      // grading the fake instead of the product.
      const header = (/===CANDIDATE-HEADER===\n([\s\S]*?)\n\n/.exec(prompt) ?? [, ""])[1]!.trim();
      const contact = header && header !== "(none captured)"
        ? header.split("\n").filter(Boolean).join(" · ")
        : DRAFT.contact;
      const name = header ? (header.split("\n")[0] || DRAFT.name).trim() : DRAFT.name;
      return JSON.stringify({ ...DRAFT, name, contact });
    }
    // card-judge.md's own opening line, checked like every other stage: one verdict per requirement
    // id, read back out of the prompt's own "- id: x" lines (buildJudgeInput's shape) so coverage is
    // always exact — verifyCoverage rejects a missing, duplicated or invented id, and a fake that
    // guessed the list would fail that check rather than the wrong thing.
    if (prompt.includes("You are grading how well ONE candidate's evidence supports")) {
      seen.judge += 1;
      if (judgeDelayMs > 0) await sleep(judgeDelayMs);
      // Only the half BEFORE the facts marker: the candidate's own facts are listed in the same
      // "- id:" shape, and a fact id that happened to equal a requirement id would otherwise be
      // graded as a requirement.
      const requirementHalf = prompt.split("===CANDIDATE FACTS===")[0]!;
      const ids = [...requirementHalf.matchAll(/^- id: (.+)$/gm)].map((m) => m[1]!.trim());
      return JSON.stringify({
        verdicts: ids.map((id, i) => ({
          requirementId: id,
          // Deterministic, and deliberately NOT all-or-nothing: the first requirement of each advert
          // clears COVERAGE_THRESHOLD and the rest sit below it, so a card has both a met
          // requirement and a "where you don't fit yet" list to render.
          fit: i === 0 ? 0.9 : 0.4,
          supportingFactId: null,
          reason: i === 0 ? "The evidence covers this requirement." : "Only partly supported by the evidence.",
        })),
      });
    }
    // family-labeler.md's own opening line (#220). Deliberately NOT always-confirmed: a QA journey
    // has to be able to walk both ends of this — discovery opening for a visitor the vocabulary
    // covers, and the honest "we don't cover this kind of work yet" for one it doesn't — and a fake
    // that confirmed everything would make the second path unreachable.
    if (prompt.includes("You place a job title into a job family")) {
      seen.familyPlacement += 1;
      // \s+ rather than \n\n: prompts/family-labeler.md is read straight off disk, and this repo's
      // git checkout rewrites line endings on Windows — a literal \n\n would quietly stop matching
      // there and place every role as unmapped.
      const role = (/## The role to place\s+(.+)/.exec(prompt) ?? [, ""])[1]!.toLowerCase();
      return /project|programme|program|delivery|scrum|\bpm\b/.test(role)
        ? JSON.stringify({ outcome: "confirmed", familyId: "it-project-delivery" })
        : JSON.stringify({ outcome: "unmapped" });
    }
    if (prompt.includes("Rephrase each item below")) {
      seen.grill += 1;
      const n = trailingArrayLength(prompt);
      return JSON.stringify(Array.from({ length: n }, (_, i) => `Could you tell me the dates for entry ${i + 1}?`));
    }
    // root-cv-audit.md's own opening line — an affirmative match, not "any prompt with a trailing
    // JSON array": grill's prompt ALSO ends in one ({i, about}[]), so that shape alone can't tell
    // the two apart. Echo the bullets' text back unchanged (a clean audit), a valid result of the
    // right length.
    if (prompt.includes("wording auditor for a verified CV")) {
      seen.audit += 1;
      const start = prompt.indexOf("[");
      const end = prompt.lastIndexOf("]");
      const bullets: unknown[] = JSON.parse(prompt.slice(start, end + 1));
      return JSON.stringify(bullets.map((b) => (typeof b === "string" ? b : String((b as { text?: unknown })?.text ?? b))));
    }
    seen.unknown += 1;
    // Never guess. A stage whose prompt wording drifted enough to stop matching its own marker
    // above must fail loudly here, not silently fall into another stage's branch and still pass
    // that branch's own shape checks (a misrouted grill prompt would satisfy audit's "array of the
    // right length" check while returning nonsense text).
    throw new Error(`qa-main fakeLlm: unrecognized prompt, first 200 chars: ${prompt.slice(0, 200)}`);
  },
};

// #209 — the three language adverts language-ladder-journey.mjs drives, served at the app's own
// pinned reader seam (BuildOptions.readAd) exactly as apps/api/test/cards.test.ts does.
//
// WHY NOT IN THE SHIPPED CORPUS: apps/api/data/sample-postings.json is real scraped adverts, and it
// mentions no language at ALL — measured 2026-08-13, zero hits for mandarin/cantonese/bilingual/
// fluent/native-speaker across all 17 postings, and sample-ad-requirements.json carries no language
// eligibility dimension either (its only three are years-experience). The nearest real thing is one
// line in the SOURCE advert these fixtures were distilled from, in the separate JobCrush repo
// (job_offers/2026-07-05_okx_…/offer.md:82, "Bilingual (English and Mandarin Chinese) proficiency
// is preferred") — and the excerpt in sample-postings.json is truncated well before it, so it is
// not in this repo at all. Writing these requirements into sample-ad-requirements.json would
// therefore put words into a real employer's advert — a fabricated requirement quoted as that
// advert's own `sourceSpan`, on a corpus staging serves to visitors.
// So the fabrication lives HERE instead, in the QA entry that is pruned from the Docker image and
// can never reach a deployed process. Production is untouched: these three adIds have no fixture,
// so main.ts still reads them with the real reader, and every other adId is answered by its
// existing fixture before this function is ever consulted (deck.ts's resolveAdRequirements).
//
// The journey needs three distinct shapes and names each one by adId (overridable via
// QA_MANDARIN_BLOCKING_AD / QA_CANTONESE_PLUS_AD / QA_CANTONESE_BLOCKING_AD): a language stated as
// mandatory (which must NOT withdraw when the person simply never listed it), a language named
// only as an advantage (which must still trigger the level question), and a second mandatory one
// (the only advert the deliberate "I don't speak this one" may ever remove).
const QA_LANGUAGE_ADVERTS: Record<string, unknown> = {
  "2026-07-05_okx_senior-strategy-project-manager-vip-institutions": {
    schemaVersion: "1",
    adId: "2026-07-05_okx_senior-strategy-project-manager-vip-institutions",
    curated: true,
    language: "en",
    familyFit: { family: "IT Project Manager", confidence: 0.85 },
    requirements: [
      {
        id: "strategic-initiatives-vip",
        band: "essential",
        requirement: "Drive strategic initiatives across VIP and institutional business domains",
        cvSection: "experience",
        sourceSpan: "Support strategic initiatives related to VIP and Institutional business growth",
      },
      {
        id: "mandarin-weekly-reviews",
        band: "essential",
        kind: "blocking",
        requirement: "Run the weekly reviews with the Mandarin-speaking institutional desks",
        cvSection: "experience",
        eligibilityDimension: "language",
        eligibilitySubject: "Mandarin",
        eligibilityLevel: "meetings",
        sourceSpan: "QA fixture (#209): Mandarin is required for the weekly reviews with institutional desks.",
      },
    ],
  },
  "2026-07-09_bnp-paribas_project-manager-lead-business-analyst-regulatory-reporting": {
    schemaVersion: "1",
    adId: "2026-07-09_bnp-paribas_project-manager-lead-business-analyst-regulatory-reporting",
    curated: true,
    language: "en",
    familyFit: { family: "IT Project Manager", confidence: 0.85 },
    requirements: [
      {
        id: "regulatory-reporting-delivery",
        band: "essential",
        requirement: "Manage end-to-end regulatory reporting projects across APAC locations",
        cvSection: "experience",
        sourceSpan: "Manage end‑to‑end regulatory reporting projects; Monitor milestones, dependencies, and resource allocation",
      },
      {
        id: "cantonese-an-advantage",
        band: "nice-to-have",
        // No `kind` — the default "ordinary" IS the point: an advantage never withdraws, and the
        // level question must fire on it anyway (#165 / languageLevel.ts).
        requirement: "Cantonese is an advantage when working with the local regulators",
        cvSection: "experience",
        eligibilityDimension: "language",
        eligibilitySubject: "Cantonese",
        sourceSpan: "QA fixture (#209): Cantonese is an advantage for liaison with local regulators.",
      },
    ],
  },
  "2026-07-13_bnp-paribas_senior-project-manager": {
    schemaVersion: "1",
    adId: "2026-07-13_bnp-paribas_senior-project-manager",
    curated: true,
    language: "en",
    familyFit: { family: "IT Project Manager", confidence: 0.85 },
    requirements: [
      {
        id: "run-drive-projects-end-to-end",
        band: "essential",
        requirement: "Run projects end to end across front office, operations, IT and Finance",
        cvSection: "experience",
        sourceSpan: "drive the project team to completion in close interaction with the Project Sponsor",
      },
      {
        id: "cantonese-front-office",
        band: "essential",
        kind: "blocking",
        requirement: "Work in Cantonese with the front-office teams day to day",
        cvSection: "experience",
        eligibilityDimension: "language",
        eligibilitySubject: "Cantonese",
        eligibilityLevel: "meetings",
        sourceSpan: "QA fixture (#209): Cantonese is required for day-to-day work with the front-office teams.",
      },
    ],
  },
};

// Parsed through the real contract, exactly like every other read — a fixture the schema rejects
// must fail here, loudly, not reach a card as an unvalidated object.
const qaReadAd = async (posting: { id: string }) => {
  if (!languageAdvertsOn) return null; // disarmed: exactly today's fixture-only deck
  const found = QA_LANGUAGE_ADVERTS[posting.id];
  return found ? AdRequirementsV1.parse(found) : null;
};

// A distinct dir/env-var name from main.ts's UPLOAD_DIR (not just a different default) so a real
// dev API and this fake one can never be pointed at the same on-disk uploads by accident.
// LocalDiskStorage directly, never storageFromEnv(): that helper reads ambient R2_ACCOUNT_ID/
// R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY unconditionally and, if all three are set (a normal staging-
// ops shell), silently ignores the path below and returns the REAL shared bucket driver instead.
const judgements = new InMemoryJudgementStore();

const blobs = new LocalDiskStorage(process.env.QA_UPLOAD_DIR ?? join(process.cwd(), "qa-uploads"));

// One store, read twice below: the routes serve floors from it, and #220's labeler places roles into
// the same published vocabulary. Two calls would build two catalogs that only happen to agree.
const qaProductionFamilyFloors = initialProductionFamilyFloors();

const { app } = buildServer({
  // Test-only: the production default (12 anonymous sessions/IP/hour, apps/api/src/sessions.ts) is
  // unchanged for main.ts and every other caller. A full Playwright run mints one real session per
  // test from 127.0.0.1 (ensureSession() is deliberately NOT route-mocked — see the spec headers),
  // which trips the production limit well inside a normal run and produces 429s indistinguishable
  // from a real defect. Never raise the production default to make tests pass; override it here
  // instead, in the one entry point that never ships.
  sessionRateLimiter: new IpRateLimiter(1000, 60 * 60 * 1000),
  // Same rule, for the magic-link limiter (#209): routes/auth.ts allows 5 sign-ins per 15 min per
  // IP, and a full Tier 2 run now mints six from 127.0.0.1 — the sixth journey lost its sign-in
  // link and the gate went red on a protection working exactly as designed. Raised HERE, in the
  // entry that never ships, never in routes/auth.ts.
  authRateLimiter: new IpRateLimiter(1000, 60 * 60 * 1000),
  productionFamilyFloors: qaProductionFamilyFloors,
  // #220: the real job labeler over the fake model, against the real published vocabulary — so a QA
  // journey can walk the production discovery checkpoint (open for a confirmed visitor, honestly
  // closed for an unmapped one) end to end without a paid call. Same seam main.ts uses.
  placeFamily: makeFamilyPlacer(fakeLlm, publishedFamilies(qaProductionFamilyFloors)),
  screenFamilyCandidate: makeFamilyCandidateScreen(fakeLlm),
  familyLearningOperatorKey: "qa-operator-key",
  // DevMailer directly, never mailerFromEnv(): that helper reads ambient RESEND_API_KEY
  // unconditionally, and a QA run must never be able to send a real email.
  mailer: new DevMailer(),
  webUrl: process.env.QA_WEB_URL,
  // createGuestbook() with no argument forces its own no-op path regardless of ambient
  // DATABASE_URL — server.ts's own default (opts.guestbook ?? createGuestbook(process.env.
  // DATABASE_URL)) would otherwise log real visit rows to the real shared Postgres.
  guestbook: createGuestbook(),
  blobs,
  pipeline: {
    mine: makeMineStep(fakeLlm),
    mineJobBlocks: makeMineJobBlocksStep(fakeLlm),
    preview: makePreviewStep(fakeLlm),
  },
  phraseGrill: makeGrillPhraser(fakeLlm),
  auditCv: makeCvAuditor(fakeLlm),
  // #209: readAd is wired to the CANNED table above, never to a model — advert-reading stays free
  // and deterministic, and only the three adIds with no shipped fixture are answered at all.
  readAd: qaReadAd,
  // #209: judging wired to the SAME fake, through the real makeJudge/makeJudgePeek pair and a real
  // (in-memory) judgement store — so the pending → judged transition a card renders is the product's
  // own, not a stub's. Wiring a judge at all is what makes a card `pending`/`unscored` instead of
  // `estimated` (deck.ts's judgeWired), which is the whole point: `estimated` is the shape of a
  // deployment with NO judge, and staging has one.
  judge: makeJudge(fakeLlm, judgements),
  judgePeek: makeJudgePeek(judgements),
});

// A QA-only probe so a run can prove the fake really answered (found-nothing vs did-not-run — the
// repo's own standing rule, ADR-0010 clause on the negative test). Two real readers today: ci.yml's
// health-wait (only qa-main.ts serves this route at all, so a response here — as opposed to 404 —
// proves this is the process that answered, not a same-port main.ts) and its post-run assertion
// that Tier 1 left every count at zero (proving the route-mocked specs never reached the fake).
app.get("/qa/llm-calls", async () => seen);

// #209 — the arming door for the two knobs above, so the ONE journey that needs each can turn it on
// for its own run instead of every other journey paying for it. run-tier2.mjs runs journeys
// sequentially (its own header says why), so a process-wide switch has exactly one owner at a time,
// and each journey puts its knob back when it finishes. QA-only, like the route above: it exists on
// this entry alone, and this entry is pruned from the Docker image.
//
// A junk `judgeDelayMs` is a 400, never a coerced number: `Number("fast")` is NaN, `NaN > 0` is
// false, and the delay would silently DISARM — the pending journey would then walk a deck of
// instantly-judged cards, find none of the states it exists to prove, note that judging beat the
// reveal, and pass. A knob that fails by quietly turning itself off is worse than no knob.
app.post<{ Body: { judgeDelayMs?: number; languageAdverts?: boolean } }>("/qa/stack", async (req, reply) => {
  if (req.body?.judgeDelayMs !== undefined) {
    const ms = Number(req.body.judgeDelayMs);
    if (!Number.isFinite(ms)) {
      return reply.status(400).send({ error: { code: "bad_request", message: "judgeDelayMs must be a number" } });
    }
    judgeDelayMs = Math.max(0, Math.min(ms, 60_000));
  }
  if (req.body?.languageAdverts !== undefined) {
    if (typeof req.body.languageAdverts !== "boolean") {
      return reply.status(400).send({ error: { code: "bad_request", message: "languageAdverts must be a boolean" } });
    }
    languageAdvertsOn = req.body.languageAdverts;
  }
  return { ok: true, judgeDelayMs, languageAdverts: languageAdvertsOn };
});

const port = Number(process.env.PORT ?? 34101);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
