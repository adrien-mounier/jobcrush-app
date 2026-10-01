// #312: the document maker — the seam where the two-page PDF is made. An injected dependency
// beside the mailer, the model client and the storage (server.ts BuildOptions): main.ts wires the
// real browser below, tests and the QA stack inject StandInDocumentMaker, so the approve → lint →
// document → email chain (#313) is testable on every push without CI ever downloading a browser.
// The real browser making a real PDF is a RELEASE GATE, not a test: scripts/print-gate.mjs, run
// by /qa-gate locally and provable on staging. Accepted cost, stated in the ticket: a font or
// page-break breakage surfaces at the gate rather than on the push that caused it.
//
// Settings per #295's measurements (docs/research/pdf-in-container.md, branch
// research/pdf-in-container): chrome-headless-shell in the API image (Dockerfile), apt deps
// hand-picked, Carlito/Liberation fonts for the metrics the CV's font stack asks for.
import { chromium } from "playwright-core";
import { PDFParse } from "pdf-parse";

export interface PrintedCv {
  pdf: Buffer;
  /** Measured from the produced bytes (countPdfPages below) — never declared by the renderer.
   *  #314's over-two-pages rule reads this. */
  pages: number;
}

export interface DocumentMaker {
  /** Print a self-contained HTML document (renderPreviewHtml's output) to an A4 PDF. */
  printCv(html: string): Promise<PrintedCv>;
}

/** Page count read back from our own PDF with pdf-parse — the same reader extract.ts already
 *  page-counts uploaded CVs with, so #156's measurement costs zero new dependencies. */
export async function countPdfPages(pdf: Buffer): Promise<number> {
  // pdfjs wants a plain Uint8Array, not a Node Buffer view (extract.ts's own idiom).
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  try {
    const result = await parser.getText();
    // Fail closed, never 0-and-carry-on: a PDF whose page count cannot be read must not sail
    // through #314's over-two-pages rule as if it were short.
    if (result.total == null) throw new Error("page count unreadable from the produced PDF");
    return result.total;
  } finally {
    await parser.destroy?.();
  }
}

/** The real maker. Launches per print rather than keeping a browser alive: one real user, and the
 *  ~200MB browser peak is handed back between prints (ponytail: per-print launch; keep a browser
 *  alive if prints ever queue behind each other).
 *
 *  - `--no-sandbox`: the image runs as root, where Chromium's sandbox is unavailable anyway.
 *    Defensible ONLY because the HTML is our own renderer's output, loaded via setContent and
 *    self-contained — it stops being defensible the moment the document embeds remote content.
 *  - `--disable-dev-shm-usage` must not run (#312 AC): /dev/shm on the 2GB machine is 985MB
 *    measured (SHARED_INFRA.md rule 7), and the flag would trade a non-problem for writes to the
 *    8MB/s-throttled disk. Not setting it is NOT enough — Playwright adds it to every Chromium
 *    launch by default (chromiumSwitches), so it must be stripped via ignoreDefaultArgs. Caught
 *    by the QA gate reading the real launch line (DEBUG=pw:browser). */
export function makeBrowserDocumentMaker(): DocumentMaker {
  return {
    async printCv(html) {
      const browser = await chromium.launch({
        args: ["--no-sandbox"],
        ignoreDefaultArgs: ["--disable-dev-shm-usage"],
      });
      try {
        // newContext() + newPage(), never browser.newPage() — Playwright's own docs scope the
        // latter to "single-page scenarios and short snippets".
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.setContent(html, { waitUntil: "load" });
        // Page count is a pure function of font metrics — never print before the fonts are in.
        await page.evaluate("document.fonts.ready.then(() => undefined)");
        const pdf = await page.pdf({
          format: "A4",
          margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
          // Background images (the DRAFT watermark is one) do not print at all without this.
          printBackground: true,
        });
        return { pdf, pages: await countPdfPages(pdf) };
      } finally {
        await browser.close();
      }
    },
  };
}

/** The CI stand-in: stands where the browser goes (#312) — deterministic %PDF-prefixed bytes and
 *  a declared page count, never a launch. DevMailer's role, for documents. */
export class StandInDocumentMaker implements DocumentMaker {
  constructor(private pages = 2) {}
  async printCv(_html: string): Promise<PrintedCv> {
    return { pdf: Buffer.from("%PDF-1.4 stand-in document — no browser ran\n"), pages: this.pages };
  }
}
