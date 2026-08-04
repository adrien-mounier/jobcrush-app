// Production/dev entrypoint: local-disk blobs (R2 driver lands with JC-6 accounts) and the
// real LLM-backed pipeline steps (mine + preview). Tests build their own server with fakes.
import { join } from "node:path";
import { buildServer } from "./server.js";
import { storageFromEnv } from "./storage.js";
import { llmFromEnv } from "./llm.js";
import { makeMineStep } from "./miner.js";
import { makePreviewStep } from "./preview.js";
import { makeGrillPhraser } from "./grill.js";
import { makeCvAuditor } from "./audit.js";
import { sessionStoreFromEnv } from "./sessions.js";
import { claimStoreFromEnv } from "./claims.js";
import { authStoreFromEnv } from "./auth.js";
import { eligibilityStoreFromEnv } from "./eligibility.js";
import { adRequirementsStoreFromEnv } from "./adRequirementsStore.js";
import { makeAdReader } from "./adReader.js";
import { judgementStoreFromEnv } from "./judgementStore.js";
import { makeJudge, makeJudgePeek } from "./judge.js";
import { knownFamilies } from "./e5stub.js";
import {
  familyLearningStoreFromEnv,
  makeFamilyCandidateScreen,
} from "./familyLearning.js";
import { mailerFromEnv } from "./mailer.js";
import { runPurge } from "./purge.js";
import { getPool } from "./db.js";
import { usageLedgerStoreFromEnv } from "./usageLedgerStore.js";
import { postingStoreFromEnv } from "./postingStore.js";
import { pricingTableFromEnv } from "./llmPricing.js";
import { meterLlm } from "./llmMeter.js";
import type { LlmClient } from "./llm.js";
import type { LlmStage } from "./usageLedgerStore.js";

const llm = llmFromEnv();
// #105 AC: which model judges a card is configuration, never a code change — JUDGE_MODEL overrides
// the default (llmFromEnv's own DEFAULT_MODEL) with no edit needed here when it's changed.
const judgeLlm = llmFromEnv(process.env.JUDGE_MODEL);
const blobs = storageFromEnv(process.env.UPLOAD_DIR ?? join(process.cwd(), "data", "uploads"));

// #118: the durable, priced usage ledger — one metered client per spending stage, so a stage is
// structurally hard to spend unmetered (main.ts hands every step an already-wrapped client, never
// the raw driver). Both `llm` and `judgeLlm` above get wrapped once per stage they back, never
// shared unwrapped past this point.
const usageLedger = usageLedgerStoreFromEnv(process.env.DATABASE_URL);
const llmPricing = pricingTableFromEnv(process.env);
const metered = (stage: LlmStage, client: LlmClient): LlmClient => meterLlm(client, stage, usageLedger, llmPricing);

// JC-6 persistence: Postgres when DATABASE_URL is set (survives restart — accounts + claim graph),
// in-memory otherwise. Init (create tables) before serving; fail fast if the DB is unreachable.
const sessions = sessionStoreFromEnv(process.env.DATABASE_URL);
const claims = claimStoreFromEnv(process.env.DATABASE_URL);
const auth = authStoreFromEnv(process.env.DATABASE_URL);
const familyLearning = familyLearningStoreFromEnv(process.env.DATABASE_URL);
// #86 decisions 4 + 5. #106 asks the questions (threaded through buildServer below); #89 reads them
// while scoring, still to land.
const eligibility = eligibilityStoreFromEnv(process.env.DATABASE_URL);
// #104: the shared, persisted ad-requirements read cache — wired the same way as eligibility above.
const adRequirements = adRequirementsStoreFromEnv(process.env.DATABASE_URL);
// #105: the persisted judgement cache, keyed by (adId, factsFingerprint) rather than adId alone —
// see judgementStore.ts's header for why this one isn't shared the way adRequirements is.
const judgements = judgementStoreFromEnv(process.env.DATABASE_URL);
// #100: the provider-posting store — table creation only, here. Nothing calls .upsert() yet (the
// fetch->store wiring is #101's), but the table must exist before #101 needs it, same as every other
// store's own init() below — a store this ticket adds is this ticket's job to boot, not the ticket
// that first calls it.
const postingStore = postingStoreFromEnv(process.env.DATABASE_URL);
try {
  await sessions.init();
  await claims.init();
  await auth.init();
  await familyLearning.init();
  await eligibility.init();
  await adRequirements.init();
  await judgements.init();
  await usageLedger.init();
  await postingStore.init();
} catch (err) {
  console.error("store init failed", err);
  process.exit(1);
}

const { app } = buildServer({
  sessions,
  claims,
  eligibility,
  auth,
  familyLearning,
  screenFamilyCandidate: makeFamilyCandidateScreen(metered("family-screen", llm)),
  familyLearningOperatorKey: process.env.FAMILY_LEARNING_OPERATOR_KEY,
  mailer: mailerFromEnv(),
  webUrl: process.env.WEB_URL,
  blobs,
  pipeline: {
    mine: makeMineStep(metered("claim-mining", llm)),
    preview: makePreviewStep(metered("preview-tailor", llm)),
  },
  phraseGrill: makeGrillPhraser(metered("grill", llm)),
  auditCv: makeCvAuditor(metered("cv-audit", llm)),
  // #104: real reads only in production — never a buildServer default, so every test that doesn't
  // wire its own fake stays exactly at today's fixture-only behaviour.
  readAd: makeAdReader(metered("advert-reading", llm), adRequirements, knownFamilies()),
  // #105: same rule — real judging only in production; every test that doesn't wire its own fake
  // stays exactly at today's deterministic-tick behaviour. judgeLlm, not llm: JUDGE_MODEL can name a
  // different model than mine/preview/grill/audit/adReader use, with no code change.
  judge: makeJudge(metered("judging", judgeLlm), judgements),
  // #117 must-fix 1: the SAME judgements store, wired cache-only — a stored judgement (an earlier
  // visit, a tailored ad, another visitor's identical facts) resolves for free on the deck without
  // ever competing for DECK_JUDGE_MAX_CARDS's paid-judging bound.
  judgePeek: makeJudgePeek(judgements),
  // #117 AC4/AC8: the same ledger every metered() client above writes into, read back by /ops/spend.
  usageLedger,
});

// JC-20 purge: sweep unclaimed anonymous sessions/claims + spent tokens on boot and every 6h
// (Postgres only — in-memory data is wiped on restart).
if (process.env.DATABASE_URL) {
  const pool = getPool(process.env.DATABASE_URL);
  const sweep = () => void runPurge(pool).catch((err) => app.log.error(err, "purge failed"));
  sweep();
  setInterval(sweep, 6 * 60 * 60 * 1000).unref();
}

const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
