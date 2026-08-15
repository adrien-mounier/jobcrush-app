// Production/dev entrypoint: local-disk blobs (R2 driver lands with JC-6 accounts) and the
// real LLM-backed pipeline steps (mine + preview). Tests build their own server with fakes.
import { join } from "node:path";
import { buildServer } from "./server.js";
import { storageFromEnv } from "./storage.js";
import { familyPlacementLlm, llmFromEnv } from "./llm.js";
import { makeMineStep } from "./miner.js";
import { makePreviewStep } from "./preview.js";
import { makeGrillPhraser } from "./grill.js";
import { makeCvAuditor } from "./audit.js";
import { sessionStoreFromEnv } from "./sessions.js";
import { claimStoreFromEnv } from "./claims.js";
import { jobBlockStoreFromEnv } from "./jobBlockStore.js";
import { makeMineJobBlocksStep } from "./jobBlockMiner.js";
import { authStoreFromEnv } from "./auth.js";
import { eligibilityStoreFromEnv } from "./eligibility.js";
import { contactStoreFromEnv } from "./contact.js";
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
import { techmapProviderFromEnv } from "./postingProvider.js";
import { loadActivePostingProviders } from "./postings.js";
import {
  assertEveryActiveProviderIsImplemented,
  makePostingRetriever,
  storeBackedPostingProvidersFor,
} from "./postingRetrieval.js";
import { initialProductionFamilyFloors } from "./familyFloors.js";
import { makeFamilyPlacer, makeJobBlockLabeler, publishedFamilies } from "./familyLabeler.js";
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
const jobBlocks = jobBlockStoreFromEnv(process.env.DATABASE_URL);
const auth = authStoreFromEnv(process.env.DATABASE_URL);
const familyLearning = familyLearningStoreFromEnv(process.env.DATABASE_URL);
// #86 decisions 4 + 5. #106 asks the questions (threaded through buildServer below); #89 reads them
// while scoring, still to land.
const eligibility = eligibilityStoreFromEnv(process.env.DATABASE_URL);
// #190: phone/email + origin, wired the same way as eligibility above.
const contact = contactStoreFromEnv(process.env.DATABASE_URL);
// #104: the shared, persisted ad-requirements read cache — wired the same way as eligibility above.
const adRequirements = adRequirementsStoreFromEnv(process.env.DATABASE_URL);
// #105: the persisted judgement cache, keyed by (adId, factsFingerprint) rather than adId alone —
// see judgementStore.ts's header for why this one isn't shared the way adRequirements is.
const judgements = judgementStoreFromEnv(process.env.DATABASE_URL);
// #100/#101: provider records and the durable monthly call counter share this store. It must be
// initialized before the retrieval seam below can fetch, persist, or reserve a paid call.
const postingStore = postingStoreFromEnv(process.env.DATABASE_URL);
const productionFamilyFloors = initialProductionFamilyFloors();
const postingProviderPolicies = loadActivePostingProviders();
// #174 must-fix 1 (round 2): fail fast, naming the row, only when NO driver implementation exists
// anywhere for an active row (checked against real driver classes, not a hand-typed mirror — see
// assertEveryActiveProviderIsImplemented's own doc). Deliberately checked BEFORE constructing
// postingProviders below and takes the registry alone: a provider whose driver exists but declines
// for a config reason (e.g. TECHMAP_RAPIDAPI_KEY unset) must still boot normally and degrade honestly
// per-request (driver_missing -> provider_unavailable) — never take the whole API down over one
// paid provider's missing key.
try {
  assertEveryActiveProviderIsImplemented(postingProviderPolicies);
} catch (err) {
  console.error("posting provider wiring invalid", err);
  process.exit(1);
}
const postingProviders = [
  ...storeBackedPostingProvidersFor(postingProviderPolicies, postingStore),
  ...postingProviderPolicies
    .map((policy) => techmapProviderFromEnv(policy, postingStore))
    .filter((provider) => provider !== null),
];
const retrievePostings = makePostingRetriever({
  registry: postingProviderPolicies,
  providers: postingProviders,
  store: postingStore,
  productionFamilyFloors,
});
try {
  await sessions.init();
  await claims.init();
  await jobBlocks.init();
  await auth.init();
  await familyLearning.init();
  await eligibility.init();
  await contact.init();
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
  jobBlocks,
  eligibility,
  contact,
  productionFamilyFloors,
  // #220: the real job labeler, against the closed published vocabulary — the seam buildServer has
  // defaulted to unmapped-for-everyone since #61, which is why production discovery has answered 409
  // for every visitor who ever reached it. Wired here only (never a buildServer default), the same
  // rule readAd/judge follow: every test that doesn't inject its own placement stays at exactly
  // today's behaviour, and nothing makes a live placement call unless main.ts wires it.
  // The model is the one the #220 bake-off measured (MiniMax M3 via Fireworks), not the app's
  // default Claude client — see familyPlacementLlm's own doc. No key configured → falls back to
  // `llm`, so discovery still works, on a model this grid never measured.
  placeFamily: makeFamilyPlacer(
    metered("family-placement", familyPlacementLlm() ?? llm),
    publishedFamilies(productionFamilyFloors),
  ),
  retrievePostings,
  auth,
  familyLearning,
  screenFamilyCandidate: makeFamilyCandidateScreen(metered("family-screen", llm)),
  familyLearningOperatorKey: process.env.FAMILY_LEARNING_OPERATOR_KEY,
  mailer: mailerFromEnv(),
  webUrl: process.env.WEB_URL,
  blobs,
  pipeline: {
    mine: makeMineStep(metered("claim-mining", llm)),
    mineJobBlocks: makeMineJobBlocksStep(metered("job-block-mining", llm)),
    // #221: every mined job record is placed in a job family, on the same model the #220 grid
    // measured. Wired here only, like placeFamily above — a test that doesn't inject it leaves
    // every block unlabeled, which is exactly today's behaviour.
    labelJobBlocks: makeJobBlockLabeler(
      metered("family-placement", familyPlacementLlm() ?? llm),
      publishedFamilies(productionFamilyFloors),
      jobBlocks,
    ),
    // #163: the preview step reads which dimensions the matched posting gates on (a presentation
    // read of the ad-requirements store — never a fresh model call) so a declared fact the advert
    // tests can rise into the summary (ADR-0002 clause 4).
    preview: makePreviewStep(metered("preview-tailor", llm), {
      getAdRequirements: (adId) => adRequirements.get(adId),
    }),
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
