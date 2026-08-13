// Extract each corpus CV's text ONCE, using the product's own pdf-parse call
// (mirrors apps/api/src/extract.ts extractText()). Output: cvs.json in this dir.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const API = "C:/Users/adrie/AI/Projects/jobcrush-app/apps/api/package.json";
const require = createRequire(API);
const { PDFParse } = await import(pathToFileURL(require.resolve("pdf-parse")).href);

const CVDIR = "C:/Users/adrie/AI/Projects/jobcrush-app/data/cvs";
const out = {};
for (const f of readdirSync(CVDIR).filter((f) => f.toLowerCase().endsWith(".pdf"))) {
  const data = readFileSync(join(CVDIR, f));
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    const r = await parser.getText();
    out[f] = { text: r.text, pages: r.total ?? null, chars: r.text.trim().length };
    console.log(`${f}: ${out[f].chars} chars / ${out[f].pages} pages`);
  } finally {
    await parser.destroy?.();
  }
}
writeFileSync(new URL("./cvs.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("wrote cvs.json");
