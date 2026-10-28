// Read-only replay of the stretch step on staging, for one stored draft (lessons.md "Read-only probe
// recipe", #427; written for #457's re-proof). Runs INSIDE the staging API machine, never locally:
//   1. flyctl machine start <id> -a jobcrush-api-staging; flyctl machine update <id> --autostop=off -y
//   2. upload this file, the shipped prompt as /tmp/old-prompt.md (git show <deployed sha>:apps/api/
//      prompts/stretch-suggestions.md), and any changed prompt or dist file over the machine's copy,
//      each with `fly ssh console -C "sh -c 'echo <base64> | base64 -d > <path>'"` — a file over
//      ~24 KB exceeds the command-line limit; append it in two halves to a .b64 file first
//   3. fly ssh console -C "sh -c 'cd /app/apps/api && RUNS=2 AD_PREFIX=posting:<hash prefix>
//      PGOPTIONS=\"-c default_transaction_read_only=on\" node /tmp/stretch-replay-staging.mjs'"
//   4. flyctl machine update <id> --autostop=stop -y; the next deploy restores every uploaded file.
// Every DB write is refused (the store init errors in the log are those refusals). The step's input
// is rebuilt through the real POST /onboarding/tailor/draft with the draft kept and its stretch
// record hidden, so the route re-makes the suggestions alone; its sha256, with the shipped prompt put
// back, must match the stored fingerprint. Each run is one paid call plus the step's own one retry.
// The output names requirement ids and the model's comparison sentences (a comparison can describe
// the line it would push out), never a line in, a draft line or a fact.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const D = "/app/apps/api/dist/";
const { buildServer } = await import(D + "server.js");
const { getPool } = await import(D + "db.js");
const { llmForStep } = await import(D + "llm.js");
const { sessionStoreFromEnv } = await import(D + "sessions.js");
const { claimStoreFromEnv } = await import(D + "claims.js");
const { jobBlockStoreFromEnv } = await import(D + "jobBlockStore.js");
const { eligibilityStoreFromEnv } = await import(D + "eligibility.js");
const { contactStoreFromEnv } = await import(D + "contact.js");
const { adRequirementsStoreFromEnv } = await import(D + "adRequirementsStore.js");
const { makeAdReader } = await import(D + "adReader.js");
const { judgementStoreFromEnv } = await import(D + "judgementStore.js");
const { makeJudge, makeJudgePeek } = await import(D + "judge.js");
const { postingStoreFromEnv } = await import(D + "postingStore.js");
const { pasteRecordStoreFromEnv } = await import(D + "pasteRecordStore.js");
const { tailorDraftStoreFromEnv } = await import(D + "tailorDraftStore.js");
const { loadActivePostingProviders } = await import(D + "postings.js");
const { makePostingRetriever, storeBackedPostingProvidersFor } = await import(D + "postingRetrieval.js");
const { initialProductionFamilyFloors } = await import(D + "familyFloors.js");
const { publishedFamilies } = await import(D + "familyLabeler.js");
const { publishedIndustryVocabulary } = await import(D + "industryVocabulary.js");
const { extractJson } = await import(D + "miner.js");
const { STRETCH_PROMPT_HEADING, STRETCH_REQUIREMENT_LINE } = await import(D + "stretchSuggestions.js");
const { computeCostUsd, pricingTableFromEnv } = await import(D + "llmPricing.js");

const RUNS = Number(process.env.RUNS ?? 2);
const AD_PREFIX = process.env.AD_PREFIX ?? "posting:e80f4b13";
const dbUrl = process.env.DATABASE_URL;
const pool = getPool(dbUrl);
const ro = (await pool.query("SHOW default_transaction_read_only")).rows[0].default_transaction_read_only;
if (ro !== "on") throw new Error(`refusing: database session is not read-only (${ro})`);
console.log("read-only:", ro);
const { rows } = await pool.query(
  "SELECT session_id, ad_id, drafted_at FROM tailor_drafts WHERE ad_id LIKE $1 ORDER BY drafted_at DESC LIMIT 1",
  [AD_PREFIX + "%"],
);
if (!rows[0]) throw new Error("no draft for " + AD_PREFIX);
const { session_id: SID, ad_id: AD, drafted_at } = rows[0];
console.log("ad", AD, "drafted", drafted_at);
const realNow = Date.now;
const pinned = new Date(drafted_at).getTime() - 30_000;
Date.now = () => pinned;

const strip = (s) => s.replace(/^<!--[\s\S]*?-->\s*/, "");
const oldPrompt = strip(readFileSync("/tmp/old-prompt.md", "utf8"));
const newPrompt = strip(readFileSync("/app/apps/api/prompts/stretch-suggestions.md", "utf8"));
console.log("prompt changed on machine:", oldPrompt !== newPrompt);

const deny = { complete: async () => { throw new Error("probe: no paid call here"); } };
let resolveDone; let done = new Promise((r) => (resolveDone = r));
const real = llmForStep("stretch-suggestions");
let calls = 0, inTok = 0, outTok = 0; const captured = [];
const stretchLlm = new Proxy(real, { get(t, k) {
  const v = t[k];
  if (typeof v !== "function") return v;
  return async (...args) => {
    calls++;
    const out = await v.apply(t, args);
    if (out?.usage) { inTok += out.usage.inputTokens ?? 0; outTok += out.usage.outputTokens ?? 0; }
    captured.push({ prompt: String(args[0]?.prompt ?? args[0]), out });
    return out;
  };
} });

const sessions0 = sessionStoreFromEnv(dbUrl);
const sessions = new Proxy(sessions0, { get(t, k) {
  if (k === "getByToken") return () => t.getById(SID);
  if (k === "touch") return async () => {};
  const v = t[k]; return typeof v === "function" ? v.bind(t) : v;
} });
const drafts0 = tailorDraftStoreFromEnv(dbUrl);
const stored = await drafts0.get(SID, AD);
console.log("stored stretch:", stored?.stretch?.status, stored?.stretch?.suggestions?.length);
const tailorDrafts = new Proxy(drafts0, { get(t, k) {
  if (k === "get") return async (...a) => { const r = await t.get(...a); if (r) delete r.stretch; return r; };
  if (k === "put") return async (rec) => { resolveDone(rec); };
  const v = t[k]; return typeof v === "function" ? v.bind(t) : v;
} });
const floors = initialProductionFamilyFloors();
const ind = publishedIndustryVocabulary();
const judgements = judgementStoreFromEnv(dbUrl);
const postingStore = postingStoreFromEnv(dbUrl);
const policies = loadActivePostingProviders();
const { app } = buildServer({
  sessions, claims: claimStoreFromEnv(dbUrl), jobBlocks: jobBlockStoreFromEnv(dbUrl),
  eligibility: eligibilityStoreFromEnv(dbUrl), contact: contactStoreFromEnv(dbUrl),
  productionFamilyFloors: floors, industryVocabulary: ind,
  retrievePostings: makePostingRetriever({ registry: policies, providers: storeBackedPostingProvidersFor(policies, postingStore), store: postingStore, productionFamilyFloors: floors }),
  readAd: makeAdReader(deny, adRequirementsStoreFromEnv(dbUrl), publishedFamilies(floors), ind.activeIndustries()),
  judge: makeJudge(deny, judgements), judgePeek: makeJudgePeek(judgements),
  postings: postingStore, pasteRecords: pasteRecordStoreFromEnv(dbUrl),
  tailorLlm: deny, stretchLlm, tailorDrafts,
});
await app.ready();

const records = [];
for (let run = 0; run < RUNS; run++) {
  done = new Promise((r) => (resolveDone = r));
  const res = await app.inject({ method: "POST", url: "/onboarding/tailor/draft", headers: { authorization: "Bearer probe" } });
  console.log(`RUN ${run} POST /draft`, res.statusCode, res.body.slice(0, 200));
  if (res.statusCode !== 202) break;
  const rec = await Promise.race([done, new Promise((r) => setTimeout(() => r(null), 170_000))]);
  records.push(rec);
  console.log(`RUN ${run} stored-would-be:`, rec?.stretch?.status, rec?.stretch?.suggestions?.length);
}
Date.now = realNow;

const input = captured[0]?.prompt ?? "";
console.log("heading ok:", input.includes(STRETCH_PROMPT_HEADING));
const withOldPrompt = input.replace(newPrompt, oldPrompt);
console.log("fingerprint (old prompt put back) matches stored:", createHash("sha256").update(withOldPrompt).digest("hex") === stored?.stretch?.fingerprint);
const states = new Map([...input.matchAll(STRETCH_REQUIREMENT_LINE)].map((m) => [m[1].trim(), m[2]]));
console.log("requirements:", states.size, "unmet:", [...states.values()].filter((s) => s !== "met").length);
const denied = (input.split("===NEVER-SUGGEST===\n")[1] ?? "").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
console.log("denied:", denied.length);
for (const [i, c] of captured.entries()) {
  const text = typeof c.out === "string" ? c.out : (c.out?.text ?? JSON.stringify(c.out));
  const retry = c.prompt.includes("===RETRY===");
  let doc; try { doc = extractJson(text); } catch { console.log(`answer ${i}${retry ? " (retry)" : ""}: not JSON`); continue; }
  console.log(`answer ${i}${retry ? " (retry)" : ""}: ${doc.suggestions?.length ?? "no list"} suggestions`);
  for (const s of doc.suggestions ?? []) {
    console.log(JSON.stringify({ req: s.requirementId, state: states.get(s.requirementId), better: s.better, cls: s.intendedClass, comparison: String(s.comparison ?? "") }));
  }
}
const usd = computeCostUsd(real.model, inTok, outTok, pricingTableFromEnv());
console.log(`CALLS ${calls} tokens ${inTok} in / ${outTok} out = $${usd === null ? "unpriced" : usd.toFixed(3)} (${real.model}, llmPricing's table)`);
process.exit(0);
