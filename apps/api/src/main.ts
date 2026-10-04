// Production/dev entrypoint: local-disk blobs (R2 driver lands with JC-6 accounts) and the
// real LLM-backed pipeline steps (mine + preview). Tests build their own server with fakes.
import { join } from "node:path";
import { buildServer } from "./server.js";
import { storageFromEnv } from "./storage.js";
import { llmForStep } from "./llm.js";
import { makeMineStep } from "./miner.js";
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
import {
  familyLearningStoreFromEnv,
  makeFamilyCandidateScreen,
} from "./familyLearning.js";
import { mailerFromEnv } from "./mailer.js";
import { makeBrowserDocumentMaker } from "./documentMaker.js";
import { runPurge } from "./purge.js";
import { getPool } from "./db.js";
import { usageLedgerStoreFromEnv } from "./usageLedgerStore.js";
import { postingStoreFromEnv } from "./postingStore.js";
import { pasteRecordStoreFromEnv } from "./pasteRecordStore.js";
import { tailorDraftStoreFromEnv } from "./tailorDraftStore.js";
import { makePastedAdvertReader } from "./pastedAdvert.js";
import { unmappedLabelStoreFromEnv } from "./unmappedLabels.js";
import { techmapProviderFromEnv } from "./postingProvider.js";
import { loadActivePostingProviders } from "./postings.js";
import {
  assertEveryActiveProviderIsImplemented,
  makePostingRetriever,
  storeBackedPostingProvidersFor,
} from "./postingRetrieval.js";
import { initialProductionFamilyFloors } from "./familyFloors.js";
import { makeFamilyPlacer, makeJobBlockLabeler, publishedFamilies } from "./familyLabeler.js";
import { makeJobBlockIndustryLabeler } from "./industryLabeler.js";
import { employerLookupStoreFromEnv, makeEmployerLookup } from "./employerLookup.js";
import { publishedIndustryVocabulary } from "./industryVocabulary.js";
import { pricingTableFromEnv } from "./llmPricing.js";
import { meterLlm } from "./llmMeter.js";
import type { AiStep, LlmClient } from "./llm.js";

const blobs = storageFromEnv(process.env.UPLOAD_DIR ?? join(process.cwd(), "data", "uploads"));

// #118: the durable, priced usage ledger — one metered client per spending stage, so a stage is
// structurally hard to spend unmetered (main.ts hands every step an already-wrapped client, never
// the raw driver).
// #334: and each step's client is built from its own entry in data/ai-steps.json — provider, model,
// reasoning level, output cap, deadline — so switching a step's model is a settings change.
const usageLedger = usageLedgerStoreFromEnv(process.env.DATABASE_URL);
const llmPricing = pricingTableFromEnv(process.env);
const step = (name: AiStep): LlmClient => meterLlm(llmForStep(name), name, usageLedger, llmPricing);

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
// #303 (#294 clause 11): who pasted which advert, and when — the per-person record the ageing
// clock (#305) counts from. Session-keyed and swept with the session; see purge.ts.
const pasteRecords = pasteRecordStoreFromEnv(process.env.DATABASE_URL);
// #310: the tailored-draft checkpoint — durable so leaving the app never costs him the draft.
const tailorDrafts = tailorDraftStoreFromEnv(process.env.DATABASE_URL);
// #252: the vocabulary-growth feed survives a deploy — one store, shared by both labeler halves
// and by the ops route that reads it back.
const unmappedLabels = unmappedLabelStoreFromEnv(process.env.DATABASE_URL);
// #282: what each employer actually IS, looked up on the web once per company and SHARED by
// everyone — a company is paid for once, ever. Not per-session and not personal data, which is what
// makes one durable table the right home for it.
const employerLookups = employerLookupStoreFromEnv(process.env.DATABASE_URL);
// The lookup itself, or undefined when no real Anthropic key is configured. Never llmFromEnv()'s
// client: web search is a SERVER-SIDE tool on Anthropic's own API, which the local Claude Code CLI
// fallback cannot run. Priced into the same ledger as every other paid stage — tokens plus
// Anthropic's per-search charge, which the per-token table alone would under-report.
const employerLookup = process.env.ANTHROPIC_API_KEY
  ? makeEmployerLookup({
      apiKey: process.env.ANTHROPIC_API_KEY,
      store: employerLookups,
      ledger: usageLedger,
      pricing: llmPricing,
    })
  : undefined;
const productionFamilyFloors = initialProductionFamilyFloors();
// #281 — ONE published vocabulary for this process: the labeler places into it and the correction
// door checks against it, and two independent reads would let the door refuse an industry the
// labeler had just stored.
const industryVocabulary = publishedIndustryVocabulary();
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
  await pasteRecords.init();
  await unmappedLabels.init();
  await employerLookups.init();
  await tailorDrafts.init();
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
  industryVocabulary,
  // #220: the real job labeler, against the closed published vocabulary — the seam buildServer has
  // defaulted to unmapped-for-everyone since #61, which is why production discovery has answered 409
  // for every visitor who ever reached it. Wired here only (never a buildServer default), the same
  // rule readAd/judge follow: every test that doesn't inject its own placement stays at exactly
  // today's behaviour, and nothing makes a live placement call unless main.ts wires it.
  // The model is the one the #220 bake-off measured (MiniMax M3 via Fireworks), not the app's
  // default Claude client — see data/ai-steps.json. No Fireworks key configured → llmForStep falls
  // back to the default Claude client, so discovery still works, on a model this grid never measured.
  placeFamily: makeFamilyPlacer(
    step("family-placement"),
    publishedFamilies(productionFamilyFloors),
    unmappedLabels,
  ),
  unmappedLabels,
  retrievePostings,
  auth,
  familyLearning,
  screenFamilyCandidate: makeFamilyCandidateScreen(step("family-screen")),
  familyLearningOperatorKey: process.env.FAMILY_LEARNING_OPERATOR_KEY,
  mailer: mailerFromEnv(),
  webUrl: process.env.WEB_URL,
  blobs,
  pipeline: {
    mine: makeMineStep(step("claim-mining")),
    mineJobBlocks: makeMineJobBlocksStep(step("job-block-mining")),
    // #221: every mined job record is placed in a job family, on the same model the #220 grid
    // measured. Wired here only, like placeFamily above — a test that doesn't inject it leaves
    // every block unlabeled, which is exactly today's behaviour.
    labelJobBlocks: makeJobBlockLabeler(
      step("family-placement"),
      publishedFamilies(productionFamilyFloors),
      jobBlocks,
      // #222: labeling changes what the per-family years facts should say — the labeler re-derives
      // them itself, like every other door that changes a job record.
      eligibility,
      unmappedLabels,
    ),
    // #281: and every mined JOB is placed in an industry — the second axis, its own vocabulary, its
    // own call. Deliberately on the DEFAULT (Anthropic) client rather than the Fireworks family
    // model: #282's employer web lookup is a server-side tool on Anthropic's own API.
    labelJobBlockIndustries: makeJobBlockIndustryLabeler(
      step("industry-placement"),
      industryVocabulary.activeIndustries(),
      jobBlocks,
      // The person's own CV lines — what makes an employer nobody has heard of placeable at all.
      claims,
      unmappedLabels,
      // #282: and what the employer IS, from the web. Wired ONLY when a real Anthropic key is
      // configured — the local Claude Code CLI fallback cannot run a server-side tool, and a lookup
      // that only works on a laptop is worse than none: it would let the feature look alive in dev
      // and be silently absent in production. No key → every job is placed on CV evidence alone.
      employerLookup,
      // #285: labeling changes what the per-industry years facts should say — the labeler
      // re-derives them itself, like its family twin above.
      eligibility,
    ),
    // #272: no preview step. The upload pipeline used to end by tailoring a full draft here — a
    // paid `preview-tailor` model call per upload whose output no live screen read. The engine
    // (makePreviewStep, preview.ts) is kept for the post-deck tailored CV, deliberately unbound.
  },
  phraseGrill: makeGrillPhraser(step("grill")),
  auditCv: makeCvAuditor(step("cv-audit")),
  // #104: real reads only in production — never a buildServer default, so every test that doesn't
  // wire its own fake stays exactly at today's fixture-only behaviour.
  // #243: the reader's closed family list is the PUBLISHED production vocabulary — the same
  // registry placeFamily above answers from — never e5stub's fixture names, so the reader's
  // familyFit and the deck's own family finally speak one vocabulary.
  // #284: and the closed INDUSTRY list, the same published vocabulary the industry labeler places
  // into — so an advert's industry bar and a person's job label always name the same words.
  readAd: makeAdReader(
    step("advert-reading"),
    adRequirements,
    publishedFamilies(productionFamilyFloors),
    industryVocabulary.activeIndustries(),
  ),
  // #105: same rule — real judging only in production; every test that doesn't wire its own fake
  // stays exactly at today's deterministic-tick behaviour. JUDGE_MODEL still overrides the judging
  // step's model, with no code change.
  judge: makeJudge(step("judging"), judgements),
  // #117 must-fix 1: the SAME judgements store, wired cache-only — a stored judgement (an earlier
  // visit, a tailored ad, another visitor's identical facts) resolves for free on the deck without
  // ever competing for DECK_JUDGE_MAX_CARDS's paid-judging bound.
  judgePeek: makeJudgePeek(judgements),
  // #117 AC4/AC8: the same ledger every step() client above writes into, read back by /ops/spend.
  usageLedger,
  // #303: the paste door writes into the SAME provider-record store the retrieval seam above was
  // built with — a pasted advert is an ordinary provider record, and two stores would mean the deck
  // could never see one.
  postings: postingStore,
  pasteRecords,
  // #303: same rule as readAd/judge — the real reader is wired here and nowhere else, so no test
  // can make a live call by accident and a build without it answers honestly instead of inventing
  // a posting.
  readPastedAdvert: makePastedAdvertReader(step("pasted-advert-reading")),
  // #310: the CV brain's draft call — bound at last (#272 unbound it). Same metering stage the old
  // upload-pipeline binding used, so /ops/spend keeps one name for the same work.
  tailorLlm: step("preview-tailor"),
  tailorDrafts,
  // #312: the real document maker — chrome-headless-shell, installed in the API image
  // (Dockerfile) and nowhere else. Constructing it launches nothing; the browser runs only when
  // #313's approve route asks for a document.
  documentMaker: makeBrowserDocumentMaker(),
  // #304: the paste door's "looking up the employer" step, and it is the SAME lookup the industry
  // labeler uses — one shared cache, one payment per company ever, whichever of the two asks
  // first. Wired only with a real Anthropic key, for #282's own reason: the lookup is a
  // server-side tool on Anthropic's API and the local CLI fallback cannot run one.
  employerLookup,
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
