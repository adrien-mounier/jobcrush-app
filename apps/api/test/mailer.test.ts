// #442 — the CV email as Resend receives it: the plain-text and the HTML part, the PDF attached,
// and the four icons inline (a content_id each, referenced as cid:), never listed beside the PDF.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResendMailer } from "../src/mailer.js";
import { REPORT_EMAIL_ICONS } from "../src/reportEmailHtml.js";

afterEach(() => vi.unstubAllGlobals());

describe("#442 ResendMailer.sendTailoredCv", () => {
  it("sends both parts, the PDF as an attachment, and each icon inline by its content id", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 200 });
    });
    const pdf = Buffer.from("%PDF-1.7 test");
    await new ResendMailer("re_test", "JobCrush <test@jobcrush.app>").sendTailoredCv("person@example.com", {
      subject: "Your CV for Lead at Acme",
      text: "plain part",
      html: "<p>designed part</p>",
      images: REPORT_EMAIL_ICONS,
      filename: "CV - Lead.pdf",
      pdf,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    const body = calls[0]!.body;
    expect(body).toMatchObject({ to: ["person@example.com"], subject: "Your CV for Lead at Acme", text: "plain part", html: "<p>designed part</p>" });
    // The PDF has no content_id, so it stays a listed attachment; every icon has one, so it is inline.
    expect(body.attachments).toEqual([
      { filename: "CV - Lead.pdf", content: pdf.toString("base64") },
      ...REPORT_EMAIL_ICONS.map((i) => ({ filename: i.filename, content: i.content.toString("base64"), content_id: i.contentId })),
    ]);
  });
});
