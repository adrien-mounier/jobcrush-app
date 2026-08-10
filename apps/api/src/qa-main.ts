// QA entrypoint: a fake-model twin of main.ts, built for the real-stack journeys (#199, Tier 2) —
// scripts that drive genuine miner/tailor/grill/audit calls end to end with no paid key. Real
// Fastify, real routes, real extraction, real miner parsing, real Draft validation + conservation
// lint, real render; only `llm` is a stage-aware fake instead of llmFromEnv().
//
// This is NOT a twin of main.ts's full wiring, and the CI Tier 1 gate (route-mocked specs) never
// exercises this fake at all — every pipeline call in those 8 specs is intercepted at the browser's
// network layer before it reaches this process (the gate asserts GET /qa/llm-calls is all-zero
// after the run specifically to prove that; see ci.yml). Unwired relative to main.ts, so a route
// that depends on one of these can pass here and still fail on staging:
//   - claims / auth / eligibility / contact / familyLearning: in-memory only (server.ts's own
//     defaults), never Postgres — persistence-across-restart is untested.
//   - readAd / judge / judgePeek: absent, so advert-reading and judging stay on their deterministic
//     fixture/tick path — never even the fake model, real or otherwise.
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
import { buildServer } from "./server.js";
import { LocalDiskStorage } from "./storage.js";
import { makeMineStep } from "./miner.js";
import { makePreviewStep, type Draft } from "./preview.js";
import { makeGrillPhraser } from "./grill.js";
import { makeCvAuditor } from "./audit.js";
import { initialProductionFamilyFloors } from "./familyFloors.js";
import { makeFamilyCandidateScreen } from "./familyLearning.js";
import { DevMailer } from "./mailer.js";
import { createGuestbook } from "./guestbook.js";
import { IpRateLimiter } from "./sessions.js";
import type { LlmClient } from "./llm.js";

const here = dirname(fileURLToPath(import.meta.url));

// The recorded real-miner output apps/api/test/preview.test.ts rides on: a genuine CandidateClaims
// doc, so the miner's own parser/validator runs for real against it.
const MINED = readFileSync(join(here, "..", "test", "eval", "recordings", "clean-pdf.json"), "utf8");

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
        { text: "Led the checkout replatforming, delivered 2 months early", claimIds: ["nrg-led-checkout-replatform"] },
        { text: "Managed a budget of EUR 1.2M across 3 vendor teams", claimIds: ["nrg-managed-budget"] },
        { text: "Ran steering committee reporting for the CIO", claimIds: ["nrg-steering-committee-reporting"] },
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

const seen = { mine: 0, tailor: 0, grill: 0, audit: 0, unknown: 0 };

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

const fakeLlm: LlmClient = {
  model: "qa-fake",
  async complete(prompt: string): Promise<string> {
    if (prompt.includes("===CV-TEXT===")) {
      seen.mine += 1;
      return MINED;
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

// A distinct dir/env-var name from main.ts's UPLOAD_DIR (not just a different default) so a real
// dev API and this fake one can never be pointed at the same on-disk uploads by accident.
// LocalDiskStorage directly, never storageFromEnv(): that helper reads ambient R2_ACCOUNT_ID/
// R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY unconditionally and, if all three are set (a normal staging-
// ops shell), silently ignores the path below and returns the REAL shared bucket driver instead.
const blobs = new LocalDiskStorage(process.env.QA_UPLOAD_DIR ?? join(process.cwd(), "qa-uploads"));

const { app } = buildServer({
  // Test-only: the production default (12 anonymous sessions/IP/hour, apps/api/src/sessions.ts) is
  // unchanged for main.ts and every other caller. A full Playwright run mints one real session per
  // test from 127.0.0.1 (ensureSession() is deliberately NOT route-mocked — see the spec headers),
  // which trips the production limit well inside a normal run and produces 429s indistinguishable
  // from a real defect. Never raise the production default to make tests pass; override it here
  // instead, in the one entry point that never ships.
  sessionRateLimiter: new IpRateLimiter(1000, 60 * 60 * 1000),
  productionFamilyFloors: initialProductionFamilyFloors(),
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
    preview: makePreviewStep(fakeLlm),
  },
  phraseGrill: makeGrillPhraser(fakeLlm),
  auditCv: makeCvAuditor(fakeLlm),
  // readAd / judge deliberately UNWIRED, exactly as every apps/api/test build leaves them: that
  // keeps advert-reading and judging on their deterministic fixture/tick path rather than a model.
});

// A QA-only probe so a run can prove the fake really answered (found-nothing vs did-not-run — the
// repo's own standing rule, ADR-0010 clause on the negative test). Two real readers today: ci.yml's
// health-wait (only qa-main.ts serves this route at all, so a response here — as opposed to 404 —
// proves this is the process that answered, not a same-port main.ts) and its post-run assertion
// that Tier 1 left every count at zero (proving the route-mocked specs never reached the fake).
app.get("/qa/llm-calls", async () => seen);

const port = Number(process.env.PORT ?? 34101);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
