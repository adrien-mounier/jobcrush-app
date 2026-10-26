// #442 — the CV email's HTML part (B2, chosen in #441), pure: every section present and in order,
// *Check before you send* populated and empty, the score panel's number, word and map, the inline
// icons, and escaping. The route-level proof that the panel is the card the screen shows lives in
// stretchSuggestions.test.ts (a used stretch counted); the send itself in mailer.test.ts.
import { describe, expect, it } from "vitest";
import { REPORT_LINES, type ApplicationReport, type ReportScore, type ScoreBlock } from "../src/applicationReport.js";
import { REPORT_EMAIL_ICONS, SCORE_FILL, iconsFor, matchBand, reportEmailHtml } from "../src/reportEmailHtml.js";
import type { Posting } from "../src/preview.js";
import { emailText as textOf } from "./reportFakes.js";

const posting: Posting = {
  id: "ad-442",
  title: `R&D <Lead> "Delivery"`,
  company: "O'Brien & Sons",
  location: "Hong Kong",
  keywords: [],
  excerpt: "",
  language: "en",
};
const report: ApplicationReport = {
  applicationUrl: "https://jobs.example/apply?a=1&b=2",
  ageing: "You pasted this 9 days ago. We cannot check whether it is still open.",
  marketToCheck: "Hong Kong",
  locationUnplaced: false,
  jobInShort: "A delivery role for a client-facing project manager.",
  salary: null,
  strong: [{ requirement: "Lead <Agile> delivery & ceremonies", say: `I ran the "Atlas" programme end to end.` }],
  gaps: [
    { requirement: "Scrum ceremonies", say: "I ran stand-ups on a Kanban team." },
    { requirement: "SAP migration", say: null },
  ],
  unchecked: ["Fluent Cantonese"],
  stretches: [{ line: "Led the vendor governance board.", say: "I chaired the monthly vendor review." }],
  explain: ["Have the launch figures ready."],
};
const score: ReportScore = { matchPct: 64, essential: ["facts", "added", "open"], desirable: ["facts", "open"] };
const notices = ["Your approved draft ran to 3 pages, so we shortened it to fit two."];
const html = reportEmailHtml(report, score, posting, 2, notices);

const inOrder = (text: string, lines: string[]) => {
  const positions = lines.map((line) => {
    const i = text.indexOf(line);
    expect(i, line).toBeGreaterThanOrEqual(0);
    return i;
  });
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
};

describe("#442 reportEmailHtml — the B2 design, top to bottom", () => {
  it("every section, in this order: score panel, intro, check before you send, the job, strong, not, explain, salary, footer", () => {
    inOrder(textOf(html), [
      "JobCrush",
      "Your CV is ready for",
      posting.title,
      `${posting.company} · ${posting.location}`,
      "64% Partial match",
      "3 of 5 requirements covered",
      "Weak Partial Strong",
      "Essential 2 of 3",
      "Desirable 1 of 2",
      "2 from your facts",
      "1 line you added",
      "2 not covered",
      "Apply for this job",
      REPORT_LINES.intro(posting, 2),
      "Check before you send",
      notices[0]!,
      `Fluent Cantonese — ${REPORT_LINES.unchecked}`,
      REPORT_LINES.market("Hong Kong"),
      "The job, in short",
      report.jobInShort,
      report.ageing!,
      "Where you are strong",
      report.strong[0]!.requirement,
      `Say: “${report.strong[0]!.say}”`,
      "Where you are not, and what to say",
      "Scrum ceremonies",
      "Say: “I ran stand-ups on a Kanban team.”",
      "SAP migration",
      REPORT_LINES.expectIt,
      "Be ready to explain",
      "Lines you chose to add to this CV:",
      "Led the vendor governance board",
      "Say: “I chaired the monthly vendor review.”",
      "Also prepare:",
      "Have the launch figures ready.",
      "Salary",
      REPORT_LINES.noSalary,
      "Sent by JobCrush. Nothing has been sent to the employer.",
    ]);
  });

  it("the unchecked, market and location lines move up into Check before you send — they leave sections 3 and 4", () => {
    const text = textOf(reportEmailHtml({ ...report, marketToCheck: null, locationUnplaced: true }, score, posting, 2, []));
    const check = text.split("Check before you send")[1]!.split("The job, in short")[0]!;
    expect(check).toContain(`Fluent Cantonese — ${REPORT_LINES.unchecked}`);
    expect(check).toContain(REPORT_LINES.locationUnknown);
    const rest = text.split("The job, in short")[1]!;
    expect(rest).toContain("SAP migration");
    expect(rest).not.toContain("Fluent Cantonese");
    expect(rest).not.toContain(REPORT_LINES.locationUnknown);
  });

  it("Check before you send is always there: a red warning per line when populated, the gold tick and one line when empty", () => {
    expect(html.split('src="cid:check"')).toHaveLength(4); // the notice, the unchecked requirement, the market
    expect(textOf(html)).not.toContain(REPORT_LINES.nothingToCheck);

    const clean = reportEmailHtml({ ...report, unchecked: [], marketToCheck: null, locationUnplaced: false }, score, posting, 2, []);
    const check = clean.split("Check before you send")[1]!.split("The job, in short")[0]!;
    expect(textOf(check)).toContain(REPORT_LINES.nothingToCheck);
    expect(check).toContain('src="cid:strong"');
    expect(clean).not.toContain('src="cid:check"');
  });

  it("an empty section says so in the product's own words, never an empty card", () => {
    const empty = { ...report, strong: [], gaps: [], stretches: [], explain: [] };
    const text = textOf(reportEmailHtml(empty, score, posting, 2, []));
    expect(text).toContain(REPORT_LINES.nothingStrong);
    // The one unchecked requirement sits above, so "every requirement is covered" would be untrue.
    expect(text).toContain(REPORT_LINES.nothingElseOpen);
    expect(text).not.toContain(REPORT_LINES.nothingOpen);
    expect(textOf(reportEmailHtml({ ...empty, unchecked: [] }, score, posting, 2, []))).toContain(REPORT_LINES.nothingOpen);
    expect(text).toContain(REPORT_LINES.nothingToExplain);
    expect(text).not.toContain("Lines you chose to add to this CV:");
    expect(text).not.toContain("Also prepare:");
  });

  it("no apply link and no location: the honest line, no button, no stray separator", () => {
    const text = textOf(reportEmailHtml({ ...report, applicationUrl: null }, score, { ...posting, location: "" }, 1, []));
    expect(text).toContain(REPORT_LINES.noLink);
    expect(text).not.toContain("Apply for this job");
    expect(text).toContain(` ${posting.company} 64%`);
    expect(text).toContain("(1 page, PDF)");
  });

  it("everything a person or an advert wrote is escaped: <, &, and quotes in the title, the company, a requirement, a sentence and the link", () => {
    expect(html).toContain("<title>R&amp;D &lt;Lead&gt; &quot;Delivery&quot;</title>");
    expect(html).toContain(">R&amp;D &lt;Lead&gt; &quot;Delivery&quot;</h1>");
    expect(html).toContain("O&#39;Brien &amp; Sons");
    expect(html).toContain("Lead &lt;Agile&gt; delivery &amp; ceremonies");
    expect(html).toContain("&quot;Atlas&quot;");
    expect(html).toContain('href="https://jobs.example/apply?a=1&amp;b=2"');
    expect(html).not.toContain("<Lead>");
    expect(html).not.toContain("<Agile>");
  });

  it("email-safe: tables and inline styles only — no SVG, no style block, no script, 600px at most", () => {
    expect(html).toContain("max-width:600px");
    expect(html).not.toMatch(/<svg|<style|<script|data:image/);
  });
});

describe("#442 the score panel", () => {
  it("the card's own words for its number, at the card's thresholds", () => {
    expect([0, 49, 50, 69, 70, 100].map(matchBand)).toEqual(["Weak", "Weak", "Partial", "Partial", "Strong", "Strong"]);
    const at = (pct: number) => reportEmailHtml(report, { ...score, matchPct: pct }, posting, 2, []);
    expect(textOf(at(70))).toContain("70% Strong match");
    expect(textOf(at(49))).toContain("49% Weak match");
    // The gauge lights the current band's label (bold, gold), and only that one.
    const lit = (h: string) => [...h.matchAll(/<td width="\d+%" style="padding:6px 0 0;font:700[^"]*">(\w+)<\/td>/g)].map((m) => m[1]);
    expect(lit(html)).toEqual(["Partial"]);
    expect(lit(at(70))).toEqual(["Strong"]);
  });

  it("one block per advert requirement, in order, in its state: facts solid gold, a line he added outlined, not covered grey", () => {
    const stateOf = Object.fromEntries(Object.entries(SCORE_FILL).map(([state, fill]) => [fill, state]));
    const blocks = [...html.matchAll(/<td bgcolor="(#[0-9a-f]{6})" width="20" height="20"([^>]*)>/g)];
    expect(blocks.map((b) => stateOf[b[1]!])).toEqual([...score.essential, ...score.desirable] satisfies ScoreBlock[]);
    expect(blocks.filter((b) => b[2]!.includes("border:1px solid"))).toHaveLength(1); // only the added line is outlined
  });

  it("a band the advert has no requirement in shows no empty row", () => {
    const text = textOf(reportEmailHtml(report, { ...score, desirable: [] }, posting, 2, []));
    expect(text).toContain("Essential 2 of 3");
    expect(text).not.toContain("Desirable");
  });
});

describe("#442 the inline icons", () => {
  it("every icon the HTML shows travels with the mail as a PNG, and every one has alt text", () => {
    const ids = REPORT_EMAIL_ICONS.map((i) => i.contentId);
    expect(ids).toEqual(["strong", "weak", "attn", "check"]);
    for (const icon of REPORT_EMAIL_ICONS) expect(icon.content.subarray(1, 4).toString()).toBe("PNG");
    const shown = [...html.matchAll(/<img src="cid:(\w+)"[^>]* alt="([^"]+)"/g)];
    expect(new Set(shown.map((m) => m[1]))).toEqual(new Set(ids));
    expect(shown.every((m) => m[2]!.length > 0)).toBe(true);
    expect(html.split("<img")).toHaveLength(shown.length + 1);
    expect(iconsFor(html)).toEqual(REPORT_EMAIL_ICONS);
  });

  it("only the icons the HTML shows travel — an unused one would sit in Gmail as an attachment", () => {
    // The owner's common case: nothing to check, no gap, nothing more to prepare.
    const quiet = reportEmailHtml(
      { ...report, unchecked: [], marketToCheck: null, gaps: [], stretches: [], explain: [] },
      score,
      posting,
      2,
      [],
    );
    expect(iconsFor(quiet).map((i) => i.contentId)).toEqual(["strong"]);
    expect(quiet).toContain('src="cid:strong"');
    expect(quiet).not.toMatch(/cid:(weak|attn|check)/);
  });
});
