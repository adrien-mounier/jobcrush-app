// JC-2 blind-rating prep: run one real CV through the actual S1 pipeline
// (extract → mine → match posting → tailor → render) entirely locally — personal data never
// leaves the machine and outputs land next to the input CV (a git-ignored folder).
//
//   node scripts/rate-cv.mjs <path-to-cv> [target titles, comma-separated]
//
// Outputs beside the CV: <name>.claims.json (mined claims), <name>.draft.html (the tailored
// draft — one half of the blind-rating pair; the original CV is the other half).
// Build first: pnpm --filter @jobcrush/api build
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiDist = (m) => pathToFileURL(join(here, "..", "apps", "api", "dist", m)).href;

const cvPath = process.argv[2];
if (!cvPath) {
  console.error("usage: node scripts/rate-cv.mjs <cv.pdf|.docx|.txt> [target titles]");
  process.exit(1);
}
const kind = { ".pdf": "pdf", ".docx": "docx", ".txt": "txt" }[extname(cvPath).toLowerCase()];
if (!kind) throw new Error("unsupported extension");

const { extractRawCv } = await import(apiDist("extract.js"));
const { mineClaims } = await import(apiDist("miner.js"));
const { llmFromEnv } = await import(apiDist("llm.js"));
const { matchPosting, tailorDraft, renderPreviewHtml } = await import(apiDist("preview.js"));

const t0 = Date.now();
const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;
const out = (suffix) => join(dirname(cvPath), basename(cvPath, extname(cvPath)) + suffix);

console.log(stamp(), "extracting", basename(cvPath));
const rawCv = await extractRawCv(readFileSync(cvPath), kind);
if (rawCv.status !== "ok") throw new Error("unparseable CV (scanned image?) — use the paste path");
console.log(
  stamp(),
  `extracted: ${rawCv.stats.roles} dated roles, ${rawCv.stats.bullets} bullets, ${rawCv.blocks.length} sections, ${rawCv.stats.chars} chars`,
);

const llm = llmFromEnv();
console.log(stamp(), "mining claims (sonnet)…");
const mined = await mineClaims(rawCv.fullText, llm);
const touch = mined.claims.reduce((m, c) => ((m[c.machine_touch] = (m[c.machine_touch] ?? 0) + 1), m), {});
const grill = mined.claims.filter((c) => c.needs_grill).length;
console.log(
  stamp(),
  `mined ${mined.claims.length} claims / ${mined.roles.length} roles —`,
  JSON.stringify(touch),
  `needs_grill=${grill}, parser_flags=${mined.parser_flags.length}`,
);
writeFileSync(out(".claims.json"), JSON.stringify(mined, null, 2), "utf8");

// Target titles: CLI arg, or fall back to the candidate's own mined role titles.
const targets = process.argv[3]
  ? process.argv[3].split(",").map((s) => s.trim())
  : mined.roles.map((r) => r.title);
const posting = matchPosting(targets);
console.log(stamp(), `matched posting: "${posting.title}" at ${posting.company} (targets: ${targets.join("; ")})`);

console.log(stamp(), "tailoring draft…");
const headerText = rawCv.blocks
  .filter((b) => b.kind === "contact" || b.kind === "other")
  .slice(0, 2)
  .map((b) => b.text)
  .join("\n");
const draft = await tailorDraft(mined, posting, llm, headerText);
writeFileSync(out(".draft.html"), renderPreviewHtml(draft, posting), "utf8");

console.log(stamp(), `done — rating pair ready:`);
console.log(`  original: ${cvPath}`);
console.log(`  draft:    ${out(".draft.html")}`);
console.log(`  claims:   ${out(".claims.json")} (review machine_touch + needs_grill here)`);
