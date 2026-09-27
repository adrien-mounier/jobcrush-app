// PROTOTYPE — throwaway. #293: what is in the application report, and what writes each part.
//
// Runs the REAL app pipeline over a REAL advert the owner actually applied to (cv-factory's
// GRADION run, 2026-07-28) and his REAL root CV, then makes ONE extra model call for the report's
// prose — and writes the raw material + the report to JSON so the comparison page
// (application-report.prototype.html, beside this file) can render the same payload three ways.
//
//   node apps/web/prototypes/application-report.prototype.mjs            # cached where possible
//   node apps/web/prototypes/application-report.prototype.mjs --fresh    # re-spend everything
//
// Needs a built API (pnpm build) and ANTHROPIC_API_KEY in .env (falls back to the Claude Code CLI).
// Every stage checkpoints to .application-report-cache/ so a re-run never re-spends a working stage.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", ".."); // repo root
const dist = join(root, "apps", "api", "dist");
const cacheDir = join(here, ".application-report-cache");
mkdirSync(cacheDir, { recursive: true });
const fresh = process.argv.includes("--fresh");

// .env by hand — this script never boots the server, so nothing else loads it.
for (const line of readFileSync(join(root, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const load = (file) => import(new URL(`file:///${join(dist, file).replace(/\\/g, "/")}`).href);
const { llmFromEnv, canonicalModelName } = await load("llm.js");
const { mineClaims } = await load("miner.js");
const { readAdvert } = await load("adReader.js");
const { publishedFamilies } = await load("familyLabeler.js");
const { initialProductionFamilyFloors } = await load("familyFloors.js");
const { publishedIndustryVocabulary } = await load("industryVocabulary.js");
const { tailorDraft, draftDisclosure, conservationIssues } = await load("preview.js");
const { buildJobCard } = await load("deck.js");
const { judgeFacts, judgeVersion } = await load("judge.js");

// ── the real inputs ────────────────────────────────────────────────────────────────────────────
const factory = "C:/Users/adrie/AI/cv-factory";
const offerDir = join(factory, "job_offers", "2026-07-28_gradion_it-project-manager-senior-project-manager");
const cvText = readFileSync(join(factory, "root_cv", "cv_mounier_root_v9.md"), "utf8");
const offerRaw = readFileSync(join(offerDir, "offer.md"), "utf8");
// cv-factory's offer.md is frontmatter + "## Raw Offer Text". The app reads ADVERTS, not their
// intake YAML, so only the raw half goes in — the same text a paste door would receive.
const adText = offerRaw.slice(offerRaw.indexOf("## Raw Offer Text")).replace("## Raw Offer Text", "").trim();

const posting = {
  id: "proto-gradion-293",
  title: "IT Project Manager / Senior Project Manager (English Speaking)",
  company: "GRADION",
  location: "Ho Chi Minh City, Vietnam",
  keywords: [],
  excerpt: adText,
  language: "en",
};

// ── metering: every call's tokens, so the report's cost is measured, never estimated ───────────
const spend = [];
const PRICE = { "claude-sonnet-5": { in: 3.0, out: 15.0 } };
function meter(label, client) {
  const wrapped = {
    model: client.model,
    async completeWithUsage(input) {
      const t0 = Date.now();
      const res = client.completeWithUsage
        ? await client.completeWithUsage(input)
        : { text: await client.complete(input), usage: { inputTokens: null, outputTokens: null } };
      spend.push({
        label,
        model: canonicalModelName(client.model ?? "unknown"),
        seconds: +((Date.now() - t0) / 1000).toFixed(1),
        inputChars: input.length,
        outputChars: res.text.length,
        ...res.usage,
      });
      return res;
    },
    async complete(input) {
      return (await wrapped.completeWithUsage(input)).text;
    },
  };
  return wrapped;
}
// --cli forces the Claude Code CLI driver (llm.ts's local fallback): free, but it reports no token
// usage, so the cost below is ESTIMATED from character counts and labelled as such.
if (process.argv.includes("--cli")) delete process.env.ANTHROPIC_API_KEY;
const llm = llmFromEnv();
console.log(`driver: ${llm.constructor.name} (${llm.model})`);

// A stage caches its RESULT and the calls it spent. Restoring the spend on a cache hit matters:
// without it a re-run reports "0 calls, $0.0000", which is the one number this prototype exists
// to answer.
async function stage(name, fn) {
  const file = join(cacheDir, `${name}.json`);
  if (!fresh && existsSync(file)) {
    const cached = JSON.parse(readFileSync(file, "utf8"));
    spend.push(...cached.spend);
    console.log(`  ${name}: cached (${cached.spend.length} call(s), not re-spent)`);
    return cached.value;
  }
  const t0 = Date.now();
  const before = spend.length;
  const value = await fn();
  writeFileSync(file, JSON.stringify({ value, spend: spend.slice(before) }, null, 2));
  console.log(`  ${name}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return value;
}

// 1. his real CV → the app's own mined claims
const claims = await stage("claims", () => mineClaims(cvText, meter("claim-mining", llm)));
console.log(`claims: ${claims.claims.length} facts, ${claims.roles.length} roles`);

// 2. the real advert → the app's own requirements read
const families = publishedFamilies(initialProductionFamilyFloors());
const industries = publishedIndustryVocabulary().activeIndustries();
const read = await stage("adread", () => readAdvert(posting, meter("advert-reading", llm), families, industries));
const adReq = read.requirements;
console.log(`requirements: ${adReq.requirements.length} (family: ${adReq.familyFit?.family ?? "none"})`);

// 3. the card. He has verified his profile, so every mined claim counts as confirmed; nothing is a
//    declared negative in this run (the askedClosed row of the report is therefore empty by
//    construction — noted on the page, not faked).
const confirmed = claims.claims.map((c, i) => ({ ...c, decision: "confirmed", origin: "mined", seq: i }));

// The card is JUDGED, as production judges it (main.ts wires makeJudge). This is not a detail: the
// deterministic fallback scorer answers an advert's requirements by keyword overlap, and on this
// advert it called 6 of 8 essentials uncovered — "Excellent international English communication"
// among them, for a man whose CV says fluent English. A report built on THAT card opens by telling
// him he cannot speak English. Both cards are kept so the page can show the difference.
const judgeFacts_ = confirmed.map((c) => ({ id: c.id, text: c.text }));
const judged = await stage("judgement", async () => {
  const result = await judgeFacts(adReq, judgeFacts_, meter("judging", llm));
  return { verdicts: result.verdicts, version: judgeVersion(), cost: result.cost, facts: judgeFacts_ };
});
const card = buildJobCard(posting, adReq, confirmed, [], judged, "estimated");
const estimatedCard = buildJobCard(posting, adReq, confirmed, [], null, "estimated");
console.log(`card (judged): ${card.matchPct}% (essential ${card.breakdown.essential.met}/${card.breakdown.essential.total}, open ${card.dontYet.length})`);
console.log(`card (no judge): ${estimatedCard.matchPct}% (essential ${estimatedCard.breakdown.essential.met}/${estimatedCard.breakdown.essential.total}, open ${estimatedCard.dontYet.length})`);

// 4. the real tailored draft
const advertTests = adReq.requirements.filter((r) => r.blocking).map((r) => r.requirement);
const headerText = cvText.slice(0, 600);
const tailored = await stage("draft", () =>
  tailorDraft(claims, posting, meter("preview-tailor", llm), headerText, { advertTests }),
);
const draft = tailored.draft;

// 5. the material the app already computes about that draft
const disclosure = draftDisclosure(claims, draft);
const lint = conservationIssues(claims, draft, [], advertTests);

// ── 6. THE ONE CALL ───────────────────────────────────────────────────────────────────────────
const byId = new Map(claims.claims.map((c) => [c.id, c.text]));
const reportInput =
  readFileSync(join(here, "application-report.prompt.md"), "utf8").replace(/^<!--[\s\S]*?-->\s*/, "") +
  `\n===ADVERT===\n${posting.title} at ${posting.company} (${posting.location})\n\n${adText}\n` +
  `\n===CARD===\n${JSON.stringify(
    {
      matchPct: card.matchPct,
      breakdown: card.breakdown,
      fit: card.fit.map((f) => f.text),
      dontYet: card.dontYet.map((r) => `[${r.band}] ${r.requirement}`),
      askedClosed: card.askedClosed.map((f) => f.text),
      notTested: (card.notTested ?? []).map((r) => r.requirement),
    },
    null,
    1,
  )}\n` +
  `\n===DRAFT===\n${JSON.stringify(
    {
      headline: draft.headline,
      summary: draft.summary,
      experience: draft.experience.map((r) => ({
        role: `${r.role} at ${r.employer}`,
        bullets: r.bullets.map((b) => ({
          printed: b.text,
          outcome: b.outcome,
          sources: b.claimIds.map((id) => byId.get(id)),
        })),
      })),
      skills: draft.skills,
    },
    null,
    1,
  )}\n` +
  `\n===HELD_BACK===\n${JSON.stringify(
    disclosure.map((d) => ({ job: `${d.role} at ${d.employer}`, factCount: d.factCount, heldBack: d.heldBack })),
    null,
    1,
  )}\n` +
  `\n===OVERFULL===\n${JSON.stringify(
    disclosure.flatMap((d) => d.overfull.map((o) => ({ job: d.employer, ...o }))),
    null,
    1,
  )}\n` +
  `\n===LOST===\n${JSON.stringify(tailored.conservationNotices, null, 1)}\n`;

const report = await stage("report", async () => {
  const raw = await meter("application-report", llm).complete(reportInput);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return JSON.parse(raw.slice(start, end + 1));
});

// ── 7. the payload the comparison page renders ─────────────────────────────────────────────────
// 3.7 chars per token: the ratio measured on this repo's own English prompts. Used ONLY when the
// driver reported no usage (the CLI fallback), and carried as `estimated: true` so the page never
// prints a guess as a measured number.
const CHARS_PER_TOKEN = 3.7;
const cost = spend.map((s) => {
  const estimated = s.inputTokens == null;
  const inTok = s.inputTokens ?? Math.round(s.inputChars / CHARS_PER_TOKEN);
  const outTok = s.outputTokens ?? Math.round(s.outputChars / CHARS_PER_TOKEN);
  const rate = PRICE[s.model] ?? PRICE["claude-sonnet-5"];
  return {
    ...s,
    estimated,
    inputTokens: inTok,
    outputTokens: outTok,
    usd: +((inTok * rate.in + outTok * rate.out) / 1e6).toFixed(4),
  };
});
const payload = {
  generatedAt: new Date().toISOString(),
  advert: { title: posting.title, company: posting.company, location: posting.location, text: adText },
  card: {
    matchPct: card.matchPct,
    breakdown: card.breakdown,
    bubble: card.bubble,
    fit: card.fit.map((f) => f.text),
    dontYet: card.dontYet,
    askedClosed: card.askedClosed.map((f) => f.text),
    notTested: card.notTested ?? [],
    salaryField: card.salary,
  },
  // The same card WITHOUT a judge — the deterministic scorer's own answer, kept to show what a
  // report built on it would have said.
  estimatedCard: {
    matchPct: estimatedCard.matchPct,
    breakdown: estimatedCard.breakdown,
    dontYet: estimatedCard.dontYet,
  },
  requirements: adReq.requirements,
  draft,
  disclosure,
  lint: lint.map((i) => ({ visitor: i.visitor, blockCovered: !!i.blockCovered })),
  conservationNotices: tailored.conservationNotices,
  report,
  reportInputChars: reportInput.length,
  cost,
  factoryReport: readFileSync(join(offerDir, "report.md"), "utf8"),
};
const out = join(here, "application-report.payload.json");
writeFileSync(out, JSON.stringify(payload, null, 2));

// The comparison page: one self-contained HTML file he double-clicks, the payload inlined (a
// file:// page cannot fetch a sibling JSON).
const page = join(here, "application-report.prototype.html");
const template = readFileSync(join(here, "application-report.template.html"), "utf8");
writeFileSync(
  page,
  template.replace(
    /\/\*PAYLOAD\*\/[\s\S]*?\/\*PAYLOAD\*\//,
    () => JSON.stringify(payload).replace(/<\/script/gi, "<\\/script"),
  ),
);
console.log(`wrote ${page}`);

const total = cost.reduce((a, s) => a + (s.usd ?? 0), 0);
console.log(`\nwrote ${out}`);
console.log(`spend: ${cost.length} calls`);
for (const s of cost) {
  console.log(
    `  ${s.label}: ${s.inputTokens}→${s.outputTokens} tok, ${s.seconds}s, $${s.usd}${s.estimated ? " (estimated from chars)" : ""}`,
  );
}
const reportCall = cost.find((s) => s.label === "application-report");
console.log(`  TOTAL $${total.toFixed(4)}  (report call alone: $${reportCall?.usd ?? "n/a"})`);
