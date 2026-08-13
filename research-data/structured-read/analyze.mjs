// Parse every raw output, count facts per cell, price it, print per-CV and average tables.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const cvs = JSON.parse(readFileSync(join(HERE, "cvs.json"), "utf8"));
const PRICE_IN = 3.0 / 1e6, PRICE_OUT = 15.0 / 1e6;

// miner.ts extractJson(): first { … last }
const extractJson = (raw) => {
  const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
  if (s === -1 || e <= s) throw new Error("no JSON object");
  return JSON.parse(raw.slice(s, e + 1));
};

// A "fact" = one emitted record. For today's miner a claim IS the record (roles are a
// side blob discarded after one use, per ADR-0003 consequences) — so claims.length.
function countFacts(cell, doc) {
  if (cell === "batched-rich") return { total: doc.claims?.length ?? 0, skills: (doc.claims ?? []).filter((c) => String(c.id ?? "").startsWith("skill-")).length, jobs: doc.roles?.length ?? 0 };
  if (cell === "compact") {
    const n = (k) => (doc[k] ?? []).length;
    return { total: n("j") + n("a") + n("e") + n("s") + n("c") + n("l"), skills: n("s"), jobs: n("j") };
  }
  const n = (k) => (doc[k] ?? []).length;
  return {
    total: n("jobs") + n("achievements") + n("education") + n("skills") + n("certifications") + n("languages"),
    skills: n("skills"), jobs: n("jobs"),
  };
}

// Headline table stays BALANCED: samples 1-2 only, every cell x CV. A partial 3rd sample
// (collected until the API started returning 529s) would otherwise bias one cell's mean.
const MAXS = Number(process.env.MAXS ?? 2);
const rows = [];
for (const f of readdirSync(OUT).filter((f) => f.endsWith(".json"))) {
  const r = JSON.parse(readFileSync(join(OUT, f), "utf8"));
  if (r.sample > MAXS) continue;
  let facts = null, err = null;
  try { facts = countFacts(r.cell, extractJson(r.text)); } catch (e) { err = e.message; }
  rows.push({
    cell: r.cell, cv: r.cv, sample: r.sample,
    inTok: r.usage.input_tokens, outTok: r.usage.output_tokens,
    stop: r.stop_reason,
    usd: r.usage.input_tokens * PRICE_IN + r.usage.output_tokens * PRICE_OUT,
    facts, err,
  });
}

const CELLS = ["batched-rich", "perdecision-lean", "perdecision-rich", "compact"];
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

console.log("\n=== PER CALL ===");
for (const r of rows.sort((a, b) => a.cv.localeCompare(b.cv) || CELLS.indexOf(a.cell) - CELLS.indexOf(b.cell) || a.sample - b.sample))
  console.log(`${r.cv.slice(0, 26).padEnd(26)} ${r.cell.padEnd(17)} #${r.sample} in=${String(r.inTok).padStart(5)} out=${String(r.outTok).padStart(5)} $${r.usd.toFixed(4)} facts=${r.facts?.total ?? "ERR " + r.err} ${r.stop !== "end_turn" ? "STOP=" + r.stop : ""}`);

console.log("\n=== PER CV x CELL (mean of samples) ===");
console.log("CV".padEnd(28) + CELLS.map((c) => c.padStart(22)).join(""));
for (const cv of Object.keys(cvs)) {
  let line = cv.slice(0, 27).padEnd(28);
  for (const c of CELLS) {
    const rs = rows.filter((r) => r.cv === cv && r.cell === c && r.facts);
    line += rs.length ? `$${mean(rs.map((r) => r.usd)).toFixed(4)}/${Math.round(mean(rs.map((r) => r.facts.total)))}f`.padStart(22) : "-".padStart(22);
  }
  console.log(line);
}

console.log("\n=== CELL AVERAGES ===");
console.log("cell".padEnd(18) + "n".padStart(4) + "in".padStart(8) + "out".padStart(8) + "$/upload".padStart(11) + "facts".padStart(8) + "$/fact".padStart(10) + "out/fact".padStart(10) + "var%".padStart(8));
for (const c of CELLS) {
  const rs = rows.filter((r) => r.cell === c && r.facts);
  if (!rs.length) continue;
  // variance: mean per-CV spread between samples, as % of that CV's mean cost
  const spreads = Object.keys(cvs).map((cv) => {
    const s = rs.filter((r) => r.cv === cv).map((r) => r.usd);
    return s.length > 1 ? (Math.max(...s) - Math.min(...s)) / mean(s) : null;
  }).filter((x) => x !== null);
  const perUpload = mean(Object.keys(cvs).map((cv) => { const s = rs.filter((r) => r.cv === cv); return s.length ? mean(s.map((r) => r.usd)) : null; }).filter(Boolean));
  const perFacts = mean(Object.keys(cvs).map((cv) => { const s = rs.filter((r) => r.cv === cv); return s.length ? mean(s.map((r) => r.facts.total)) : null; }).filter(Boolean));
  console.log(
    c.padEnd(18) + String(rs.length).padStart(4) +
    String(Math.round(mean(rs.map((r) => r.inTok)))).padStart(8) +
    String(Math.round(mean(rs.map((r) => r.outTok)))).padStart(8) +
    `$${perUpload.toFixed(4)}`.padStart(11) +
    perFacts.toFixed(1).padStart(8) +
    `$${(perUpload / perFacts).toFixed(5)}`.padStart(10) +
    (mean(rs.map((r) => r.outTok)) / perFacts).toFixed(1).padStart(10) +
    (spreads.length ? (mean(spreads) * 100).toFixed(1) + "%" : "-").padStart(8),
  );
}
console.log(`\nTOTAL SPENT: $${rows.reduce((s, r) => s + r.usd, 0).toFixed(4)} over ${rows.length} calls`);
