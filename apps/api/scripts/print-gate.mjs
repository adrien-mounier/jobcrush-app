// #312 release gate: the REAL browser prints a REAL PDF. Deliberately a gate script and not a
// test — CI never downloads a browser (the stand-in stands there, documentMaker.ts), so this is
// what /qa-gate runs locally and what staging proves after a deploy. It fails loudly if the
// document the fonts and print rules promise is not the document that comes out.
//
// Run after a build:  pnpm --filter @jobcrush/api build && pnpm --filter @jobcrush/api print-gate
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPreviewHtml } from "../dist/preview.js";
import { makeBrowserDocumentMaker } from "../dist/documentMaker.js";

// The repo's own documented two-page density (#156, measured in docs/research/pdf-in-container.md):
// 4 roles × 6 bullets = 24 experience bullets.
const role = (n) => ({
  role: `IT Project Manager ${n}`,
  employer: `Employer ${n} Group`,
  location: "Warsaw, Poland",
  dates: "Mar 2021 - Present",
  bullets: Array.from({ length: 6 }, (_, i) => ({
    text: `Led delivery stream ${i + 1}: replatformed the checkout across three vendor teams, a EUR 1.2M budget, and steering reporting to the CIO`,
    outcome: "",
    claimIds: [],
  })),
  unprinted: [],
});

const draft = {
  name: "Maria Kowalski",
  headline: "IT Project Manager for enterprise delivery",
  contact: "Warsaw · maria.kowalski@example.com · +48 600 000 000",
  summary:
    "Project manager with delivery accountability across vendors, budgets, and steering committees in enterprise retail environments.",
  experience: [role(1), role(2), role(3), role(4)],
  skills: [
    { label: "Delivery", items: ["Jira", "MS Project", "Confluence", "Azure DevOps"] },
    { label: "Methods", items: ["PRINCE2", "Scrum", "SAFe"] },
  ],
  certifications: [
    { name: "PRINCE2 Practitioner", date: "2019" },
    { name: "PSM I", date: "2020" },
  ],
  education: [{ institution: "University of Warsaw", detail: "MSc MIS", dates: "2017" }],
  additional: [{ label: "Languages", value: "Polish (Native), English (Fluent)" }],
};

const posting = {
  id: "print-gate",
  title: "Senior IT Project Manager",
  company: "Gate Check Ltd",
  location: "Singapore",
  keywords: [],
  excerpt: "",
  language: "en",
};

const html = renderPreviewHtml(draft, posting, { watermark: false });
const started = Date.now();
const { pdf, pages } = await makeBrowserDocumentMaker().printCv(html);
const elapsed = Date.now() - started;

const out = join(tmpdir(), "jobcrush-print-gate.pdf");
await writeFile(out, pdf);
console.log(`printed ${pages} page(s), ${pdf.length} bytes, in ${elapsed}ms → ${out}`);

if (pages !== 2) {
  console.error(
    `GATE FAILED: expected exactly 2 pages at the documented two-page density, got ${pages}. ` +
      "Fonts (Carlito/Liberation present?) and the print rules decide this number — inspect the PDF above.",
  );
  process.exit(1);
}
console.log("GATE PASSED: the real browser printed the real two-page document.");
