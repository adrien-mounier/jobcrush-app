// Accuracy spot-check: does every fact actually point at real words in the CV?
// (ADR-0004 clause 1a as a mechanical test.)
//   quote cells  -> is source_quote a real substring of the CV?
//   compact cell -> does the line pointer land on the right line? (and how far off when not?)
// Punctuation is normalised (typographic apostrophes/quotes/dashes/bullets) so that a model
// tidying ’ to ' is not scored as a fabrication -- we are testing grounding, not glyph fidelity.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const cvs = JSON.parse(readFileSync(join(HERE, "cvs.json"), "utf8"));

const norm = (s) =>
  String(s)
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[·•▪‣]/g, " ")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const extractJson = (raw) => JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
const CELLS = ["batched-rich", "perdecision-lean", "perdecision-rich", "compact"];

const only = process.argv[2];
const summary = {};
for (const f of readdirSync(OUT).filter((f) => f.endsWith("__1.json")).sort()) {
  const r = JSON.parse(readFileSync(join(OUT, f), "utf8"));
  if (only && !r.cv.includes(only)) continue;
  const text = norm(cvs[r.cv].text);
  const rawLines = cvs[r.cv].text.split(/\r?\n/);
  const lines = rawLines.map(norm);
  const doc = extractJson(r.text);
  let checked = 0, bad = 0;
  const offsets = [];
  const examples = [];

  const checkQuote = (q, label) => {
    checked++;
    const n = norm(q);
    if (!n || !text.includes(n.slice(0, 50))) {
      bad++;
      if (examples.length < 3) examples.push(`${label}: "${String(q).slice(0, 55)}"`);
    }
  };

  if (r.cell === "compact") {
    for (const [key, li] of [["j", 7], ["a", 2], ["e", 6], ["s", 2], ["c", 4], ["l", 2]]) {
      for (const row of doc[key] ?? []) {
        checked++;
        const L = Number(row[li]);
        // the record's headline value should appear on (or very near) the pointed-to line
        const probe = norm(row[0]).split(" ").filter((w) => w.length > 3)[0] ?? norm(row[0]);
        if (!probe) continue;
        // find the nearest line that actually contains it
        let best = null;
        lines.forEach((l, i) => {
          if (l.includes(probe)) {
            const d = Math.abs(i + 1 - L);
            if (best === null || d < best) best = d;
          }
        });
        if (best === null) {
          bad++;
          if (examples.length < 3) examples.push(`${key} "${String(row[0]).slice(0, 35)}" -> nowhere in CV`);
        } else {
          offsets.push(best);
          if (best !== 0) {
            bad++;
            if (examples.length < 3)
              examples.push(`${key} "${String(row[0]).slice(0, 32)}" -> said line ${L}, actually ${best} line(s) away`);
          }
        }
      }
    }
  } else if (r.cell === "batched-rich") {
    for (const c of doc.claims ?? []) checkQuote(c.source_quote, "claim");
  } else {
    for (const k of ["jobs", "achievements", "education", "skills", "certifications", "languages"])
      for (const rec of doc[k] ?? []) checkQuote(rec.source_quote, k);
  }

  const exact = offsets.filter((o) => o === 0).length;
  console.log(
    `${r.cv.slice(0, 24).padEnd(24)} ${r.cell.padEnd(17)} bad ${String(bad).padStart(3)}/${String(checked).padStart(3)} (${((bad / checked) * 100).toFixed(1)}%)` +
      (offsets.length ? `  pointer exact ${exact}/${offsets.length}, within1 ${offsets.filter((o) => o <= 1).length}, median off ${offsets.slice().sort((a, b) => a - b)[Math.floor(offsets.length / 2)]}` : ""),
  );
  examples.forEach((e) => console.log(`      ! ${e}`));
  (summary[r.cell] ??= { bad: 0, checked: 0 });
  summary[r.cell].bad += bad;
  summary[r.cell].checked += checked;
}
console.log("\n=== pooled ===");
for (const c of CELLS)
  if (summary[c]) console.log(`${c.padEnd(18)} ${summary[c].bad}/${summary[c].checked} (${((summary[c].bad / summary[c].checked) * 100).toFixed(1)}%) not correctly grounded`);
