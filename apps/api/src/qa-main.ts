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
//   - postings retrieval: NO provider registry and no store, but since #63 a stand-in retriever
//     serves the curated corpus at the same injected seam main.ts hands the real provider — the
//     deck has no other way to receive an advert now, so without it every browser journey that
//     renders a deck goes dark. Never a paid call, same rule as the fake model. Its OUTCOME is a
//     /qa/stack knob (`retrievalOutcome`) so a journey can also drive the empty-pool and outage
//     screens; it defaults to a full deck, so an unarmed run sees what it always saw.
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
import { AdRequirementsV1, canonicalKeyOf, type PostingRetrievalResultV1 } from "@jobcrush/contracts";
import { buildServer } from "./server.js";
import { LocalDiskStorage } from "./storage.js";
import { makeMineStep } from "./miner.js";
import { makeMineJobBlocksStep } from "./jobBlockMiner.js";
import { loadPostings, type Draft, type Posting } from "./preview.js";
import { lookupAdRequirements } from "./e5stub.js";
import { makeGrillPhraser } from "./grill.js";
import { makeCvAuditor } from "./audit.js";
import { initialProductionFamilyFloors } from "./familyFloors.js";
import { makeFamilyPlacer, makeJobBlockLabeler, publishedFamilies } from "./familyLabeler.js";
import { makeJobBlockIndustryLabeler } from "./industryLabeler.js";
import { publishedIndustryVocabulary } from "./industryVocabulary.js";
import { normaliseEmployerKey } from "./employerLookup.js";
import { InMemoryJobBlockStore } from "./jobBlockStore.js";
import { InMemoryEligibilityStore } from "./eligibility.js";
import { InMemoryUnmappedLabelStore } from "./unmappedLabels.js";
import { makeFamilyCandidateScreen } from "./familyLearning.js";
import { makeJudge, makeJudgePeek } from "./judge.js";
// InMemoryJudgementStore directly, never judgementStoreFromEnv(): that helper reads ambient
// DATABASE_URL and would write judgements to the real shared Postgres from a QA run.
import { InMemoryJudgementStore } from "./judgementStore.js";
import { InMemoryPostingStore } from "./postingStore.js";
import { InMemoryPasteRecordStore, type PasteRecordStore } from "./pasteRecordStore.js";
import { pastedPostings } from "./pastedAdvert.js";
import { DevMailer } from "./mailer.js";
import { StandInDocumentMaker } from "./documentMaker.js";
import { createGuestbook } from "./guestbook.js";
import { IpRateLimiter } from "./sessions.js";
import type { LlmClient } from "./llm.js";
import { qaFamilyAnswer, roleFromLabelerPrompt } from "./qaFamilyAnswer.js";

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
  additional: [{ label: "Languages", value: "Polish (Native), English (Fluent), German (B1)" }],
};

const seen = { mine: 0, tailor: 0, grill: 0, audit: 0, jobBlocks: 0, judge: 0, familyPlacement: 0, industryPlacement: 0, unknown: 0 };

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

// #116 — the read-delay knob, the judge knob's twin for the OTHER half of a cold deck. The canned
// reader below answers instantly, so no journey could ever see what a brand-new visitor on staging
// sees: every advert still being read when the first deck request runs out of budget. With this
// armed above the deck's read budget (15s), the first read of each advert takes this long and the
// deck says "still looking" instead of revealing; later requests JOIN the running read (the same
// in-flight map adReader.ts keeps, so re-asking never starts a second read) and reveal once it
// lands — the whole count, once. Each advert is slowed exactly once per arming, like a real cold
// read that is then cached. Same off-by-default rule and the same arming door as judgeDelayMs.
let readDelayMs = Number(process.env.QA_READ_DELAY_MS ?? 0);

// #209 — the same arming rule, for the canned language adverts below. Off by default and for the
// same measured reason: serving them adds three cards to EVERY deck, and tailor-journey.mjs (Tier 2,
// green for weeks) then tailors one of them and asks about a language requirement, which is not the
// screen it was written to walk. A fabricated advert should be visible to exactly the journey that
// asked for it. QA_LANGUAGE_ADVERTS=on starts a run with them already served.
let languageAdvertsOn = process.env.QA_LANGUAGE_ADVERTS === "on";
// #307: the work-rights adverts' own arm switch, same rules — a fabricated advert is visible to
// exactly the journey that asked for it. QA_WORK_RIGHTS_ADVERTS=on starts a run with them served.
let workRightsAdvertsOn = process.env.QA_WORK_RIGHTS_ADVERTS === "on";

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
      // #310: "(none captured)" is buildTailorInput's OWN empty-header marker (the draft door
      // passes no header text) — it must read as "no header", never be printed as a person's name.
      const rawHeader = (/===CANDIDATE-HEADER===\n([\s\S]*?)\n\n/.exec(prompt) ?? [, ""])[1]!.trim();
      const header = rawHeader === "(none captured)" ? "" : rawHeader;
      const contact = header ? header.split("\n").filter(Boolean).join(" · ") : DRAFT.contact;
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
    // family-labeler.md's own opening line (#220). The answer itself lives in qaFamilyAnswer.ts —
    // #231 moved it there so it could be parsed by the real contract in a test, after this fake
    // spent a commit answering in a shape the parser rejected with nothing to catch it.
    if (prompt.includes("You place a job title into a job family")) {
      seen.familyPlacement += 1;
      return qaFamilyAnswer(roleFromLabelerPrompt(prompt));
    }
    // #281 — industry-labeler.md's own opening line. Answers by EMPLOYER, and deliberately walks
    // both branches the screen has to render: the retail employer is placed, the unfamiliar systems
    // house is honestly unplaced ("we couldn't work this one out"), and the degree never reaches
    // here at all because non-jobs are never labeled.
    if (prompt.includes("You place one job into the industry its employer was in")) {
      seen.industryPlacement += 1;
      const employer = (/^Employer: (.*)$/m.exec(prompt) ?? [, ""])[1]!.trim();
      if (employer === "Nordic Retail Group") {
        // #282 (contract v2): a confidence PER INDUSTRY. Certain, because the canned employer lookup
        // above says plainly what this business is — which is the whole point of the second
        // evidence source, and something a QA journey can see on the screen.
        return JSON.stringify({
          why: "A retail group — it sells goods to the public.",
          outcome: "confirmed",
          industries: [{ industryId: "retail-and-consumer", confidence: "certain" }],
        });
      }
      return JSON.stringify({ why: "Nothing here says what this business is.", outcome: "unmapped" });
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
    familyFit: { family: "it-project-delivery", confidence: 0.85 },
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
    familyFit: { family: "it-project-delivery", confidence: 0.85 },
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
    familyFit: { family: "it-project-delivery", confidence: 0.85 },
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

// #307 — the two work-rights adverts asked-once-journey.mjs drives, served at the same pinned
// reader seam as QA_LANGUAGE_ADVERTS above, gated by their own knob (`workRightsAdverts` on
// POST /qa/stack) so an unarmed run sees exactly the curated deck.
//
// WHY NOT IN THE SHIPPED CORPUS — the same reason as #209's language adverts, measured again for
// this dimension: the corpus research (docs/research/eligibility-dimensions-from-the-corpus.md)
// found work-rights stated in 0 of 17 postings, so writing this requirement into
// sample-ad-requirements.json would put words into a real employer's advert. The fabrication lives
// HERE, in the QA entry that is pruned from the Docker image; these two adIds have no curated
// fixture, so production still reads them with the real reader.
//
// The journey needs two distinct Hong Kong adverts with the same stated gate: the first is where
// the queue's question is asked and answered, the second is the proof it is never asked again.
const QA_WORK_RIGHTS_ADVERTS: Record<string, unknown> = {
  "2026-07-09_charterhouse-partnership-asia_senior-business-analyst-product-manager-1-year-contract": {
    schemaVersion: "1",
    adId: "2026-07-09_charterhouse-partnership-asia_senior-business-analyst-product-manager-1-year-contract",
    curated: true,
    language: "en",
    familyFit: { family: "it-project-delivery", confidence: 0.85 },
    // Requirement ORDER is load-bearing for the journey: the fake judge covers requirements[0]
    // and leaves the rest open, so the work-rights bar goes first (its question is the queue's
    // profile ask, never a Yes/No) and the ordinary requirement stays open behind it — the real
    // advert question the journey must see FOLLOW the profile one.
    requirements: [
      {
        id: "right-to-work-hong-kong",
        band: "essential",
        kind: "blocking",
        requirement: "Hold the right to work in Hong Kong without sponsorship",
        cvSection: "experience",
        eligibilityDimension: "work-rights",
        sourceSpan: "QA fixture (#307): applicants must already hold the right to work in Hong Kong.",
      },
      {
        id: "product-delivery-analysis",
        band: "essential",
        requirement: "Drive product delivery and business analysis across front-to-back teams",
        cvSection: "experience",
        sourceSpan: "QA fixture (#307): senior business analyst / product manager, front-to-back delivery.",
      },
    ],
  },
  "2026-07-09_sanderson-ikas-hong-kong_business-analyst-product-manager-digital-transformation-mobile": {
    schemaVersion: "1",
    adId: "2026-07-09_sanderson-ikas-hong-kong_business-analyst-product-manager-digital-transformation-mobile",
    curated: true,
    language: "en",
    familyFit: { family: "it-project-delivery", confidence: 0.85 },
    // Same order rule as the entry above: work-rights first (profile-owned), the open ordinary
    // requirement behind it.
    requirements: [
      {
        id: "right-to-work-hong-kong",
        band: "essential",
        kind: "blocking",
        requirement: "Hold the right to work in Hong Kong without sponsorship",
        cvSection: "experience",
        eligibilityDimension: "work-rights",
        sourceSpan: "QA fixture (#307): applicants must already hold the right to work in Hong Kong.",
      },
      {
        id: "mobile-transformation-delivery",
        band: "essential",
        requirement: "Deliver digital transformation programmes for mobile channels",
        cvSection: "experience",
        sourceSpan: "QA fixture (#307): business analyst / product manager, digital transformation, mobile.",
      },
    ],
  },
};

// #63 — the QA entry's stand-in for a paid posting provider.
//
// The deck is fed by retrieval and nothing else now: preview.ts's sessionPostings no longer reads
// sample-postings.json off disk, because a fixture reaching a session unretrieved is a fixture
// authorizing a reveal. That is the defect the ticket closes, and it leaves this entry — which
// deliberately wires no provider registry, no store and no TECHMAP_RAPIDAPI_KEY — with no way to
// put a single advert on a screen. Every browser journey that renders a deck would go dark, and
// with them the e2e job that gates the staging deploy.
//
// So the curated corpus is served HERE, at the same injected `retrievePostings` seam main.ts hands
// the real provider, for exactly the reason the fake model is wired the same way: a QA run must
// never make a paid call. This is NOT the fixture escape hatch the ticket forbids — that would be a
// flag in the shipped server letting fixtures bypass the reveal gate. Nothing is bypassed: these
// adverts are a retrieval RESULT, and a session still has to pass every gate (published family,
// covered essential floor, liveness, language) before one becomes a card. The refusal is the same
// code, answering the same way, on data that costs nothing. And like the fake model, it can never
// reach production: this file is imported by nothing, referenced by no fly.*.toml, and pruned from
// the Docker image.
const qaPostingsV1 = () => {
  const now = new Date().toISOString();
  return loadPostings().map((posting) => {
    const canonicalKey = canonicalKeyOf(posting.company, posting.location, posting.title);
    return {
      schemaVersion: "5" as const,
      id: `posting:${canonicalKey}`,
      canonicalKey,
      title: posting.title,
      company: posting.company,
      location: posting.location,
      sourceUrl: `https://qa.invalid/${encodeURIComponent(posting.id)}`,
      applicationUrl: null, // #302: the fixture pool carries no separate apply link
      excerpt: posting.excerpt,
      postedAt: null,
      capturedAt: now,
      verifiedLiveAt: now,
      expiresAt: null,
      attribution: [],
      // The one provider this build's ACTIVE registry carries: curated-pool is operationally
      // disabled (postings.ts) until it has a production region-refresh caller, and a snapshot whose
      // sources name a provider the registry does not carry is never reusable.
      sources: [{ providerId: "techmap", providerPostingId: posting.id }],
      skills: posting.keywords,
      language: posting.language,
    };
  });
};

// #303 — the pasted-advert header reader, canned. Without it the paste door answers 503 on this
// entry and NO browser journey of the door can run in CI at all, which would leave the feature
// proved only by a run against a real-keyed API on somebody's laptop.
//
// It reads the header off the pasted text with plain string work rather than answering one fixed
// advert: a journey has to be able to paste two DIFFERENT adverts and get two different jobs (the
// "same advert twice reuses the reading" case is only meaningful against a reader that would
// otherwise have produced something else). Deterministic, instant, and free, on exactly the same
// terms as the fake model — and the real reading is still proved by the unit suite's own fake and
// by a QA run against a keyed API.
//
// Convention the journeys write against: line 1 is "<title> — <company>", line 2 is the location,
// and a line matching "applications close <date>" gives the closing date. An advert that does not
// follow it reads as unreadable, which is what drives #304's failure screen.
/** #304 — how long each faked step of a pasted read is made to take on this entry.
 *
 *  Deliberate, and the same reasoning `pending-unscored-card-journey` already runs on: a narrated
 *  wait is UNOBSERVABLE against a reader that answers instantly. The three steps would flash past
 *  between two frames, and a browser journey could only ever prove that the screen ends up
 *  somewhere — never that the person was shown the work happening, which is the whole ticket.
 *  Long enough for a browser driver paced at ~1s per action to land inside a step, short enough
 *  that the four pastes across the two paste journeys cost about twelve seconds between them.
 *  It can no more reach production than the rest of this file can. */
const QA_PASTE_STEP_MS = 1500;
const qaPause = () => new Promise((resolve) => setTimeout(resolve, QA_PASTE_STEP_MS));

const qaReadPastedAdvert = async (text: string) => {
  await qaPause();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const [heading, location] = lines;
  const [title, company] = (heading ?? "").split(/\s+[—-]\s+/);
  if (!title || !company || !location) return null;
  const close = text.match(/applications?\s+close[^\r\n]*?(\d{4}-\d{2}-\d{2})/i);
  return { title, company, location, closingDate: close?.[1] ?? null };
};

// #63 — which outcome the stand-in provider reports. `relevant_postings` is the default because
// every existing journey needs a deck; the other two exist because #63 built two SCREENS that
// nothing else can reach. A retrieval that finishes empty and a retrieval that could not run are
// deliberately different words to a visitor (#174's warning, and the reason this ticket exists), and
// a payload assertion does not prove a screen — so a journey has to be able to drive both. Armed
// per-journey through POST /qa/stack, never a default: an unarmed run sees exactly the full deck.
let qaRetrievalOutcome: "relevant_postings" | "empty_pool" | "provider_unavailable" = "relevant_postings";

const qaRetrievePostings = async (): Promise<PostingRetrievalResultV1> => {
  const retrievedAt = new Date().toISOString();
  if (qaRetrievalOutcome === "provider_unavailable") {
    return {
      schemaVersion: "5",
      outcome: "provider_unavailable",
      coverage: { providersQueried: [], providersUnavailable: ["techmap"], complete: false },
      reason: "qa-main: provider forced unavailable via POST /qa/stack",
      retryable: true,
    };
  }
  if (qaRetrievalOutcome === "empty_pool") {
    return {
      schemaVersion: "5",
      outcome: "empty_pool",
      // complete: the one source we have WAS asked and answered with nothing — which is exactly the
      // state whose wording #174 warned about, and the state a journey needs to be able to look at.
      coverage: { providersQueried: ["techmap"], providersUnavailable: [], complete: true },
      retrievedAt,
    };
  }
  return {
    schemaVersion: "5",
    outcome: "relevant_postings",
    postings: qaPostingsV1(),
    coverage: { providersQueried: ["techmap"], providersUnavailable: [], complete: true },
    retrievedAt,
  };
};

/** The pool advert a RETRIEVED posting id came from. Both tables this entry answers reads out of —
 *  the curated corpus and QA_LANGUAGE_ADVERTS — are keyed by the fixture's own filename-shaped id,
 *  while a retrieved advert's id is `posting:<canonicalKey>` by contract, so every lookup has to
 *  come back through here. */
const qaPoolSourceOf = (postingId: string) =>
  loadPostings().find((p) => `posting:${canonicalKeyOf(p.company, p.location, p.title)}` === postingId) ?? null;

/** The hand-curated requirement set for a retrieved advert. Without this, resolveAdRequirements'
 *  fixture-first lookup finds none of them and every card in a QA deck is an unreadable advert. */
const qaCuratedRequirements = (postingId: string) => {
  const source = qaPoolSourceOf(postingId);
  if (!source) return null;
  const lookup = lookupAdRequirements(source.id);
  return lookup.status === "found" ? { ...lookup.requirements, adId: postingId } : null;
};

/** #303 — requirements for an advert somebody PASTED, read off its own text with plain string work.
 *
 *  Both fixture tables above are keyed by a pool advert's filename-shaped id, and a pasted advert's
 *  id is a fingerprint of text nobody shipped — so without this, `qaReadAd` answers null for a
 *  pasted job forever and the paste door can never produce a card on this entry. That was measured:
 *  four presses, four `read_incomplete`, no self-heal, so no browser journey of the door could run
 *  in CI at all.
 *
 *  Convention the journeys write against: a line starting with "- " is a requirement; the first two
 *  are essential, the rest standard. An advert with none reads as unreadable, which is the state
 *  #304's failure screen needs to be drivable. Deterministic, instant, free — the same terms as the
 *  fake model, and it can no more reach production than the rest of this file can. */
function qaPastedRequirements(posting: Posting) {
  const bullets = posting.excerpt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
  if (bullets.length === 0) return null;
  return {
    schemaVersion: "1" as const,
    adId: posting.id,
    curated: false,
    language: posting.language,
    familyFit: { family: "it-project-delivery", confidence: 0.9 },
    requirements: bullets.map((requirement, index) => ({
      id: `pasted-${index + 1}`,
      // RankBand is ["essential","standard","nice-to-have"] (packages/contracts/src/familyFloor.ts)
      // — "desirable" is the word the CARD prints, not a band the contract has.
      band: index < 2 ? ("essential" as const) : ("standard" as const),
      kind: "ordinary" as const,
      requirement,
      sourceSpan: requirement,
    })),
  };
}

// Parsed through the real contract, exactly like every other read — a fixture the schema rejects
// must fail here, loudly, not reach a card as an unvalidated object.
const qaReadAd = async (posting: Posting) => {
  const curated = qaCuratedRequirements(posting.id);
  if (curated) return AdRequirementsV1.parse(curated);
  // #303: a pasted advert is not in either fixture table by construction — its id is a fingerprint
  // of text nobody shipped. Checked BEFORE the language-advert knob so the paste door works on an
  // unarmed run, the same way the curated deck does.
  const pasted = (await pastedPostings(qaPostingStore)).some((p) => p.id === posting.id);
  if (pasted) {
    const read = qaPastedRequirements(posting);
    return read ? AdRequirementsV1.parse(read) : null;
  }
  if (!languageAdvertsOn && !workRightsAdvertsOn) return null; // disarmed: exactly today's curated-only deck
  // #63: these tables are keyed by the fixture id their comments above cite, and the reader is
  // handed the RETRIEVED advert - so the lookup goes back through the pool, and the entry is
  // re-stamped onto the advert as retrieval actually delivered it. Each table answers only while
  // its own knob is armed; the two share no adId, so precedence never decides anything.
  const source = qaPoolSourceOf(posting.id);
  const found = source
    ? ((languageAdvertsOn ? QA_LANGUAGE_ADVERTS[source.id] : undefined) ??
      (workRightsAdvertsOn ? QA_WORK_RIGHTS_ADVERTS[source.id] : undefined))
    : undefined;
  return found
    ? AdRequirementsV1.parse({ ...(found as Record<string, unknown>), adId: posting.id })
    : null;
};

// #116 — the read-delay knob's seam (see readDelayMs above): a cold read, once per advert per
// arming, with the in-flight join adReader.ts gives production so a poll made during the read
// waits on it rather than starting over.
const readsSlowedOnce = new Set<string>();
const readsInFlight = new Map<string, Promise<AdRequirementsV1 | null>>();
const qaReadAdWithDelay = (posting: Posting): Promise<AdRequirementsV1 | null> => {
  const existing = readsInFlight.get(posting.id);
  if (existing) return existing;
  const promise = (async () => {
    if (readDelayMs > 0 && !readsSlowedOnce.has(posting.id)) {
      readsSlowedOnce.add(posting.id);
      await sleep(readDelayMs);
    }
    return qaReadAd(posting);
  })().finally(() => readsInFlight.delete(posting.id));
  readsInFlight.set(posting.id, promise);
  return promise;
};

// A distinct dir/env-var name from main.ts's UPLOAD_DIR (not just a different default) so a real
// dev API and this fake one can never be pointed at the same on-disk uploads by accident.
// LocalDiskStorage directly, never storageFromEnv(): that helper reads ambient R2_ACCOUNT_ID/
// R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY unconditionally and, if all three are set (a normal staging-
// ops shell), silently ignores the path below and returns the REAL shared bucket driver instead.
const judgements = new InMemoryJudgementStore();
// #303: the paste door's two stores. In-memory like every other store on this entry — a QA run has
// no DATABASE_URL, so nothing here survives a restart, which is the documented ceiling of this
// whole file, not a property of the paste door.
const qaPostingStore = new InMemoryPostingStore();

// #305 — the ageing line is the one thing in the product that can only be SEEN after days have
// passed, and a browser journey cannot wait a week. So this entry (and this entry only — it is pruned
// from the Docker image) can move the paste clock BACKWARDS on the read side: the stored record is
// untouched, `listBySession` simply reports it as older. That is exactly the input the ageing line
// takes, so the journey drives the real screen with the real rule and nothing about the rule is faked.
// Off by default (0 days), armed per-run through POST /qa/stack's `pasteDaysAgo`, like every other knob.
let qaPasteDaysAgo = 0;
const qaPasteRecordsInner = new InMemoryPasteRecordStore();
const qaPasteRecords: PasteRecordStore = {
  durable: qaPasteRecordsInner.durable,
  init: () => qaPasteRecordsInner.init(),
  record: (sessionId, adId, pastedAt) => qaPasteRecordsInner.record(sessionId, adId, pastedAt),
  listBySession: async (sessionId) =>
    (await qaPasteRecordsInner.listBySession(sessionId)).map((row) =>
      qaPasteDaysAgo === 0
        ? row
        : { ...row, pastedAt: new Date(Date.parse(row.pastedAt) - qaPasteDaysAgo * 86_400_000).toISOString() },
    ),
};

const blobs = new LocalDiskStorage(process.env.QA_UPLOAD_DIR ?? join(process.cwd(), "qa-uploads"));

// One store, read twice below: the routes serve floors from it, and #220's labeler places roles into
// the same published vocabulary. Two calls would build two catalogs that only happen to agree.
const qaProductionFamilyFloors = initialProductionFamilyFloors();
// #281 — one vocabulary, shared by the labeler below and the correction door, as in main.ts.
const qaIndustryVocabulary = publishedIndustryVocabulary();

/** #282's employer lookup, canned. Deliberately NOT makeEmployerLookup: that one needs a real
 *  Anthropic key and would make a QA run cost money and vary between runs. Returning null for
 *  everything else is the honest degraded path this ticket is written to survive. */
const QA_EMPLOYER_LOOKUPS: Record<string, string> = {
  "nordic retail group":
    "Nordic Retail Group runs a chain of supermarkets and convenience stores across Sweden and " +
    "Denmark, selling groceries directly to households. It is a mid-size national retailer.",
};
const qaEmployerLookup = async (employer: string): Promise<string | null> =>
  QA_EMPLOYER_LOOKUPS[normaliseEmployerKey(employer)] ?? null;

// #221: same reasoning — the labeling step writes placements into the very store the /job-blocks
// route reads back, so both must be handed the one instance.
const qaJobBlocks = new InMemoryJobBlockStore();

// #222: same reasoning again — the labeler now re-derives the per-family years facts, so it must
// write into the very eligibility store the deck routes read, not a private one.
const qaEligibility = new InMemoryEligibilityStore();

// #252: same reasoning once more — the vocabulary-growth feed the labeler writes must be the one
// /ops/unmapped-labels reads back, or a QA journey's unmapped placement looks like it recorded
// nothing.
const qaUnmappedLabels = new InMemoryUnmappedLabelStore();

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
  industryVocabulary: qaIndustryVocabulary,
  // #220: the real job labeler over the fake model, against the real published vocabulary — so a QA
  // journey can walk the production discovery checkpoint (open for a confirmed visitor, honestly
  // closed for an unmapped one) end to end without a paid call. Same seam main.ts uses.
  // #252: the QA stack owns the vocabulary-growth feed store explicitly, so both labeler halves and
  // /ops/unmapped-labels read the SAME one — a QA journey that ends unmapped can be shown to have
  // actually recorded it. In-memory here, like every other QA store: a QA run writes to no database.
  placeFamily: makeFamilyPlacer(fakeLlm, publishedFamilies(qaProductionFamilyFloors), qaUnmappedLabels),
  unmappedLabels: qaUnmappedLabels,
  // #221: the labeler needs the same store the routes read, so the QA entry owns it explicitly
  // instead of letting buildServer make its own.
  jobBlocks: qaJobBlocks,
  eligibility: qaEligibility,
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
    // #221: past-job labeling over the fake model — the canned CV mines to two placeable jobs and
    // one degree the vocabulary does not cover, so a QA journey can walk both the confident case
    // (no question asked) and the "we couldn't place this" question on the review screen.
    labelJobBlocks: makeJobBlockLabeler(fakeLlm, publishedFamilies(qaProductionFamilyFloors), qaJobBlocks, qaEligibility, qaUnmappedLabels),
    // #281: the seventh fact over the same fake model — the canned CV places one job and honestly
    // fails to place the other, so a QA journey walks both states of the work-history screen.
    labelJobBlockIndustries: makeJobBlockIndustryLabeler(
      fakeLlm,
      qaIndustryVocabulary.activeIndustries(),
      qaJobBlocks,
      // No claim store to read lines from in the QA build (it never wires one), so the fake places
      // on employer + title alone — which is exactly the degraded "small unknown employer" path.
      undefined,
      qaUnmappedLabels,
      // #282: a CANNED employer lookup, never the real web-search one — the QA build has no paid
      // key and must never acquire one. It answers for the retail employer and NOT for the systems
      // firm, so one journey walks both halves: a job with web evidence behind it, and a job whose
      // lookup came back empty and was placed on the CV alone.
      qaEmployerLookup,
      // #285: the labeling door re-derives the per-industry years facts, same as production.
      qaEligibility,
    ),
    // #272: no preview step, mirroring main.ts — the upload pipeline no longer tailors a draft.
  },
  phraseGrill: makeGrillPhraser(fakeLlm),
  auditCv: makeCvAuditor(fakeLlm),
  // #209: readAd is wired to the CANNED table above, never to a model — advert-reading stays free
  // and deterministic, and only the three adIds with no shipped fixture are answered at all.
  readAd: qaReadAdWithDelay,
  // #63: see qaRetrievePostings' own comment — the curated corpus at the provider seam, because
  // this entry has no provider registry and the deck now has no other way to receive an advert.
  retrievePostings: qaRetrievePostings,
  // #209: judging wired to the SAME fake, through the real makeJudge/makeJudgePeek pair and a real
  // (in-memory) judgement store — so the pending → judged transition a card renders is the product's
  // own, not a stub's. Wiring a judge at all is what makes a card `pending`/`unscored` instead of
  // `estimated` (deck.ts's judgeWired), which is the whole point: `estimated` is the shape of a
  // deployment with NO judge, and staging has one.
  judge: makeJudge(fakeLlm, judgements),
  judgePeek: makeJudgePeek(judgements),
  // #303: the paste door. Its two stores are in-memory (this entry has no DATABASE_URL, same as
  // every other store here), and the header reader is the canned one above — so a browser journey
  // can drive the whole door, free and deterministic, and the deploy gate can run it.
  postings: qaPostingStore,
  pasteRecords: qaPasteRecords,
  readPastedAdvert: qaReadPastedAdvert,
  // #310: the draft door over the SAME stage-aware fake — its ===JOB-POSTING=== branch already
  // answers a conserving draft, so a browser journey can watch the CV brain's ending, free. The
  // checkpoint store stays buildServer's in-memory default, like every other QA store.
  tailorLlm: fakeLlm,
  // #312: the stand-in stands where the browser goes — this stack runs in CI on every push, and
  // the one thing it must never do is download a 114MB browser to print a deterministic fixture.
  // The real browser making a real PDF is the release gate (scripts/print-gate.mjs), not a test.
  documentMaker: new StandInDocumentMaker(),
  // #304: the narrated wait's second step, off the SAME canned table the industry labeler reads
  // (#282) — one fake employer answer on this entry, not two that could disagree. Paced only HERE,
  // where a person is watching a step go by; the labeler's own path runs at its old speed, so no
  // CV journey pays for this. An employer the table does not carry answers null, which is the real
  // degraded path and is what the screen must survive.
  employerLookup: async (employer: string) => {
    await qaPause();
    return qaEmployerLookup(employer);
  },
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
app.post<{
  Body: {
    judgeDelayMs?: number;
    readDelayMs?: number;
    languageAdverts?: boolean;
    workRightsAdverts?: boolean;
    retrievalOutcome?: string;
    pasteDaysAgo?: number;
  };
}>("/qa/stack", async (req, reply) => {
  if (req.body?.judgeDelayMs !== undefined) {
    const ms = Number(req.body.judgeDelayMs);
    if (!Number.isFinite(ms)) {
      return reply.status(400).send({ error: { code: "bad_request", message: "judgeDelayMs must be a number" } });
    }
    judgeDelayMs = Math.max(0, Math.min(ms, 60_000));
  }
  // #116: same number discipline as judgeDelayMs — a junk value refuses, never disarms. Re-arming
  // forgets which adverts were already slowed, so a second journey gets its own cold deck.
  if (req.body?.readDelayMs !== undefined) {
    const ms = Number(req.body.readDelayMs);
    if (!Number.isFinite(ms)) {
      return reply.status(400).send({ error: { code: "bad_request", message: "readDelayMs must be a number" } });
    }
    readDelayMs = Math.max(0, Math.min(ms, 60_000));
    readsSlowedOnce.clear();
  }
  if (req.body?.languageAdverts !== undefined) {
    if (typeof req.body.languageAdverts !== "boolean") {
      return reply.status(400).send({ error: { code: "bad_request", message: "languageAdverts must be a boolean" } });
    }
    languageAdvertsOn = req.body.languageAdverts;
  }
  // #307: same boolean discipline as languageAdverts — a junk value must refuse, never disarm.
  if (req.body?.workRightsAdverts !== undefined) {
    if (typeof req.body.workRightsAdverts !== "boolean") {
      return reply.status(400).send({ error: { code: "bad_request", message: "workRightsAdverts must be a boolean" } });
    }
    workRightsAdvertsOn = req.body.workRightsAdverts;
  }
  // #63: lets a journey drive the empty-result and outage screens, which are otherwise unreachable
  // in any browser-runnable config. Changing it invalidates nothing by itself — the session's stored
  // snapshot is keyed by request fingerprint, so a session that already has a deck keeps it until
  // its own inputs change. Set this BEFORE the session's first deck read.
  if (req.body?.retrievalOutcome !== undefined) {
    const allowed = ["relevant_postings", "empty_pool", "provider_unavailable"] as const;
    const wanted = allowed.find((value) => value === req.body.retrievalOutcome);
    if (!wanted) {
      return reply.status(400).send({
        error: { code: "bad_request", message: `retrievalOutcome must be one of ${allowed.join(", ")}` },
      });
    }
    qaRetrievalOutcome = wanted;
  }
  // #305: how many days ago this run's pastes should read as. A junk value is a 400 for the same
  // reason judgeDelayMs's is: a silently-coerced NaN would disarm the knob, and the ageing journey
  // would then walk a deck of brand-new pastes, find no notice, and pass.
  if (req.body?.pasteDaysAgo !== undefined) {
    const days = Number(req.body.pasteDaysAgo);
    // Out of range is a REFUSAL, not a clamp, for the same reason a junk value is: a run that asked for
    // 9999 days and silently got 365 would report a verdict about a day count nobody applied.
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      return reply
        .status(400)
        .send({ error: { code: "bad_request", message: "pasteDaysAgo must be a whole number of days, 0-365" } });
    }
    qaPasteDaysAgo = days;
  }
  return {
    ok: true,
    judgeDelayMs,
    readDelayMs,
    languageAdverts: languageAdvertsOn,
    workRightsAdverts: workRightsAdvertsOn,
    retrievalOutcome: qaRetrievalOutcome,
    pasteDaysAgo: qaPasteDaysAgo,
  };
});

const port = Number(process.env.PORT ?? 34101);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
