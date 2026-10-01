// #312: the halves of the document maker CI can honestly test without a browser — the page-count
// read (against real PDFs built with pdf-lib, the fixtures' own generator) and the stand-in that
// stands where the browser goes. makeBrowserDocumentMaker itself is the release gate
// (scripts/print-gate.mjs), deliberately not a test.
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { countPdfPages, StandInDocumentMaker } from "../src/documentMaker.js";

async function pdfWithPages(n: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage();
  return Buffer.from(await doc.save());
}

describe("#312 document maker", () => {
  it("counts pages from the PDF bytes themselves, not a declaration", async () => {
    expect(await countPdfPages(await pdfWithPages(1))).toBe(1);
    expect(await countPdfPages(await pdfWithPages(3))).toBe(3);
  });

  it("the stand-in answers without a browser: %PDF bytes and a declared page count", async () => {
    const { pdf, pages } = await new StandInDocumentMaker().printCv("<html></html>");
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pages).toBe(2);
    expect((await new StandInDocumentMaker(3).printCv("<html></html>")).pages).toBe(3);
  });
});
