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
import { chromium } from "playwright-core";
import { PDFParse } from "pdf-parse";

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

const html = renderPreviewHtml(draft, posting, { banner: false });
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

// #439: the letterhead as an ATS reads it — the PDF's text order is name, contact, headline.
const parser = new PDFParse({ data: new Uint8Array(pdf) });
const text = (await parser.getText()).text.toLowerCase();
await parser.destroy?.();
const at = [draft.name, draft.contact, draft.headline].map((s) => text.indexOf(s.toLowerCase()));
if (at.includes(-1) || !(at[0] < at[1] && at[1] < at[2])) {
  console.error(`GATE FAILED: the PDF's letterhead text is not name, contact, headline (positions ${at.join(", ")}).`);
  process.exit(1);
}
console.log("GATE PASSED: the PDF reads name, contact, headline, in that order.");

// #439: a long contact line wraps, centred, and stays inside the page — on A4 (print media at
// the printable width, 210mm less the 12mm margins) and on a 390px phone.
const longHtml = renderPreviewHtml(
  {
    ...draft,
    contact:
      "Lyon, France · +33 6 00 00 00 00 · +33 4 00 00 00 00 · maria.kowalski@example.com · linkedin.com/in/maria-kowalski-delivery-lead",
  },
  posting,
  { banner: false },
);
const browser = await chromium.launch();
try {
  for (const [name, width, media] of [["A4", 703, "print"], ["390px", 390, "screen"]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.emulateMedia({ media });
    await page.setContent(longHtml, { waitUntil: "load" });
    const m = await page.evaluate(() => {
      const el = document.querySelector(".contact");
      const r = el.getBoundingClientRect();
      return {
        lines: Math.round(r.height / parseFloat(getComputedStyle(el).lineHeight)),
        align: getComputedStyle(el).textAlign,
        overflow: el.scrollWidth > el.clientWidth || r.right > document.documentElement.clientWidth,
        pageScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    if (m.lines < 2 || m.align !== "center" || m.overflow || m.pageScroll) {
      console.error(`GATE FAILED (${name}): the long contact line must wrap centred inside the page — ${JSON.stringify(m)}`);
      process.exit(1);
    }
    console.log(`GATE PASSED (${name}): the long contact line wraps onto ${m.lines} centred lines inside the page.`);
    await page.close();
  }
} finally {
  await browser.close();
}
