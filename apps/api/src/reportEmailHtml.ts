// #442 — the CV email's HTML part: the design the owner picked in #441 (B2, "night masthead" with
// icons and the score), ported from apps/api/prototypes/report-email.prototype.mjs on branch
// prototype/report-email-441 (`night(m, true)` + `scorePanel(card)`), markup and inline styles
// included. The plain text (applicationReport.ts reportEmailText) stays the fallback part, built
// from the same report, so the two never say different things.
//
// Email-safe by construction: table layout, inline styles, system fonts, no SVG, 600px at most.
// Every graphic is a table cell with a bgcolor; the four icons are PNGs sent inline (cid:), since
// Gmail strips SVG and data: images. Everything a person or an advert wrote is escaped.
//
// Two moves differ from the text part, in the HTML only: *Check before you send* is always shown
// and also carries the unchecked requirements and the market / location lines (so they leave
// sections 3 and 4), and *Be ready to explain* lists the lines the person added apart from the
// model's points.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPORT_LINES, type ApplicationReport, type ReportScore, type ScoreBlock } from "./applicationReport.js";
import type { InlineImage } from "./mailer.js";
import type { Posting } from "./preview.js";

/** Phosphor *filled* icons (@phosphor-icons/core 2.1.1, MIT), 40×40 shown at 20px. */
const ICON_ALT = { strong: "Strong", weak: "Not covered", attn: "Prepare", check: "Check" } as const;
type Icon = keyof typeof ICON_ALT;
const ICON_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "report-email-icons");
export const REPORT_EMAIL_ICONS: InlineImage[] = (Object.keys(ICON_ALT) as Icon[]).map((name) => ({
  contentId: name,
  filename: `${name}.png`,
  content: readFileSync(join(ICON_DIR, `${name}.png`)),
}));
/** The icons this HTML shows — only those travel with the mail: Gmail lists an inline image the
 *  HTML never references as an ordinary attachment (a report with nothing to check uses no warning). */
export const iconsFor = (html: string): InlineImage[] =>
  REPORT_EMAIL_ICONS.filter((icon) => html.includes(`src="cid:${icon.contentId}"`));

/** The job card's own words for its number (apps/web/app/jobcard.tsx matchQuality) — the same
 *  thresholds, so the email and the screen name the same band. The gauge draws the same zones. */
const BANDS = [[0, 50, "Weak"], [50, 70, "Partial"], [70, 100, "Strong"]] as const;
export function matchBand(pct: number): (typeof BANDS)[number][2] {
  return BANDS.filter(([from]) => pct >= from).at(-1)![2];
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const C = {
  gold: "#e8a33d", goldInk: "#1a1206",
  night: "#171c23", nightRaised: "#1f262f", nightInk: "#e8eaed", nightMuted: "#8a95a2",
  ground: "#faf9f7", white: "#ffffff", ink: "#1f2328", muted: "#59636e", line: "#d9d5cf",
};
/** Gold at .12 over the night surface: the card's .bd-pill.strong fill. */
const NIGHT_GOLD_TINT = "#33291b";
/** Solid gold = your facts; gold outline on the tint = a line you added (#418: still on the CV, so
 *  still gold); grey = not covered. Exported so the tests read the map's states off the product. */
export const SCORE_FILL: Record<ScoreBlock, string> = { facts: C.gold, added: NIGHT_GOLD_TINT, open: "#6f7d8c" };

const row = (html: string, style: string) => `<tr><td style="${style}">${html}</td></tr>`;
const t = (px: number, w: number, color: string, extra = "") => `font:${w} ${px}px/1.4 ${SANS};color:${color};${extra}`;

/** The dark panel's score: the number (how good?), a gauge cut at the card's own thresholds (why
 *  that word?), and a map of every requirement grouped Essential / Desirable (made of what?). */
function scorePanel(score: ReportScore): string {
  const pct = score.matchPct;
  const band = matchBand(pct);
  const block = (s: ScoreBlock, size = 20) =>
    `<td style="padding:0 4px 4px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${SCORE_FILL[s]}" width="${size}" height="${size}" style="width:${size}px;height:${size}px;line-height:${size}px;font-size:0;background:${SCORE_FILL[s]};border-radius:3px;${s === "added" ? `border:1px solid ${C.gold};width:${size - 2}px;height:${size - 2}px;line-height:${size - 2}px;` : ""}">&nbsp;</td></tr></table></td>`;
  const met = (blocks: ScoreBlock[]) => blocks.filter((s) => s !== "open").length;
  // An advert with no requirement in a band shows no empty row for it.
  const group = (label: string, blocks: ScoreBlock[]) =>
    blocks.length
      ? `<p style="margin:0 0 7px;${t(12.5, 400, C.nightMuted)}">${label} <span style="color:${C.nightInk};font-weight:600;">${met(blocks)} of ${blocks.length}</span></p>` +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${blocks.map((s) => block(s)).join("")}</tr></table>`
      : "";
  // The gauge: three zones at the card's thresholds, each filled gold up to the score.
  const zone = ([from, to]: (typeof BANDS)[number], i: number) => {
    const filled = Math.max(0, Math.min(pct, to) - from) / (to - from);
    const cell = (w: number, color: string) =>
      w > 0 ? `<td width="${(w * 100).toFixed(1)}%" bgcolor="${color}" height="8" style="height:8px;line-height:8px;font-size:0;background:${color};">&nbsp;</td>` : "";
    return `<td width="${to - from}%" style="padding:0 ${i < 2 ? 3 : 0}px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:4px;overflow:hidden;"><tr>${cell(filled, C.gold)}${cell(1 - filled, C.nightRaised)}</tr></table></td>`;
  };
  const all = [...score.essential, ...score.desirable];
  const count = (s: ScoreBlock) => all.filter((b) => b === s).length;
  const key = (s: ScoreBlock, label: string) =>
    `<td style="padding:0 16px 6px 0;white-space:nowrap;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${block(s, 10)}<td style="padding:0 0 4px 3px;${t(12.5, 400, C.nightInk)}">${count(s)} ${label}</td></tr></table></td>`;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle" style="white-space:nowrap;padding:0 16px 0 0;width:1%;${t(42, 660, C.nightInk, "line-height:1;letter-spacing:-.02em;")}">${pct}<span style="font-size:22px;color:${C.nightMuted};font-weight:600;">%</span></td>
      <td valign="middle">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${NIGHT_GOLD_TINT}" style="background:${NIGHT_GOLD_TINT};border:1px solid #8a6532;border-radius:999px;padding:5px 12px;${t(13, 700, C.gold, "line-height:1;white-space:nowrap;")}">${band} match</td></tr></table>
        <p style="margin:7px 0 0;${t(13, 400, C.nightMuted)}">${met(all)} of ${all.length} requirements covered</p>
      </td></tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;"><tr>${BANDS.map(zone).join("")}</tr>
      <tr>${BANDS.map(([from, to, label]) => `<td width="${to - from}%" style="padding:6px 0 0;${label === band ? t(12, 700, C.gold) : t(12, 400, C.nightMuted)}">${label}</td>`).join("")}</tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;border-top:1px solid ${C.nightRaised};"><tr><td style="padding:18px 0 0;">
      ${group("Essential", score.essential)}
      <div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>
      ${group("Desirable", score.desirable)}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 0;"><tr>${key("facts", "from your facts")}${key("added", count("added") === 1 ? "line you added" : "lines you added")}</tr><tr>${key("open", "not covered")}</tr></table>
    </td></tr></table>`;
}

/** The whole HTML part, top to bottom: the dark score panel, the intro, *Check before you send*
 *  (always), the job in short, strong, not strong, be ready to explain, salary, the footer. */
export function reportEmailHtml(
  report: ApplicationReport,
  score: ReportScore,
  posting: Posting,
  pages: number,
  notices: string[],
): string {
  const icon = (name: Icon) =>
    `<img src="cid:${name}" width="20" height="20" alt="${ICON_ALT[name]}" style="display:block;border:0;width:20px;height:20px;">`;
  const withIcon = (name: Icon, html: string) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="top" width="30" style="width:30px;padding-top:1px;">${icon(name)}</td><td>${html}</td></tr></table>`;
  const section = (title: string, body: string, edge = C.gold) =>
    row(
      `<p style="margin:0 0 14px;font:700 16px/1.3 ${SANS};color:${C.ink};">${esc(title)}</p>${body}`,
      `background:${C.white};border:1px solid ${C.line};border-top:3px solid ${edge};border-radius:6px;padding:22px 24px 10px;`,
    ) + `<tr><td style="height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr>`;
  const para = (text: string) => `<p style="margin:0 0 14px;font:14px/1.5 ${SANS};color:${C.ink};">${esc(text)}</p>`;
  // A requirement (or an added line) and what to say about it; a null sentence reads expect-it.
  const item = (iconName: Icon, title: string, say: string | null) =>
    withIcon(
      iconName,
      `<p style="margin:0 0 6px;font:600 14px/1.45 ${SANS};color:${C.ink};">${esc(title)}</p>` +
        (say === null
          ? `<p style="margin:0 0 16px;padding:10px 12px 10px 0;background:${C.white};border-radius:4px;font:14px/1.55 ${SANS};color:${C.muted};font-style:italic;">${esc(REPORT_LINES.expectIt)}</p>`
          : `<p style="margin:0 0 16px;padding:10px 12px;background:${C.ground};border-radius:4px;font:14px/1.55 ${SANS};color:#33393f;">Say: “${esc(say)}”</p>`),
    );
  const label = (text: string, top = 0) => `<p style="margin:${top}px 0 ${top ? 10 : 12}px;font:13px/1.5 ${SANS};color:${C.muted};">${text}</p>`;

  const checks = [
    ...notices,
    ...report.unchecked.map((u) => `${u} — ${REPORT_LINES.unchecked}`),
    ...(report.marketToCheck ? [REPORT_LINES.market(report.marketToCheck)] : []),
    ...(report.locationUnplaced ? [REPORT_LINES.locationUnknown] : []),
  ];
  const place = [posting.company, posting.location].filter(Boolean).map(esc).join(" · ");
  const apply = report.applicationUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;"><tr><td bgcolor="${C.gold}" style="background:${C.gold};border-radius:6px;"><a href="${esc(report.applicationUrl)}" style="display:inline-block;padding:12px 22px;font:700 15px/1 ${SANS};color:${C.goldInk};text-decoration:none;">Apply for this job</a></td></tr></table>`
    : `<p style="margin:20px 0 0;font:13px/1.5 ${SANS};color:${C.nightMuted};">${esc(REPORT_LINES.noLink)}</p>`;

  const inner = [
    `<tr><td bgcolor="${C.night}" style="background:${C.night};border-radius:8px;padding:28px 28px 26px;">
       <p style="margin:0 0 22px;font:700 13px/1 ${SANS};letter-spacing:.04em;color:${C.gold};">JobCrush</p>
       <p style="margin:0 0 6px;font:13px/1.4 ${SANS};color:${C.nightMuted};">Your CV is ready for</p>
       <h1 style="margin:0 0 4px;font:660 25px/1.25 ${SANS};color:${C.nightInk};">${esc(posting.title)}</h1>
       <p style="margin:0 0 22px;font:15px/1.5 ${SANS};color:${C.nightMuted};">${place}</p>
       ${scorePanel(score)}
       ${apply}</td></tr>`,
    `<tr><td style="padding:16px 4px 16px;font:14px/1.6 ${SANS};color:${C.muted};">${esc(REPORT_LINES.intro(posting, pages))}</td></tr>`,
    checks.length
      ? section("Check before you send", checks.map((c) => withIcon("check", `<p style="margin:0 0 12px;font:14px/1.5 ${SANS};color:${C.ink};">${esc(c)}</p>`)).join(""), "#cf222e")
      : section("Check before you send", withIcon("strong", para(REPORT_LINES.nothingToCheck))),
    section(
      "The job, in short",
      `<p style="margin:0 0 14px;font:15px/1.6 ${SANS};color:${C.ink};">${esc(report.jobInShort)}</p>` +
        (report.ageing ? `<p style="margin:0 0 14px;font:14px/1.5 ${SANS};color:${C.muted};">${esc(report.ageing)}</p>` : ""),
    ),
    section(
      "Where you are strong",
      report.strong.length ? report.strong.map((s) => item("strong", s.requirement, s.say)).join("") : para(REPORT_LINES.nothingStrong),
    ),
    section(
      "Where you are not, and what to say",
      report.gaps.length
        ? report.gaps.map((g) => item("weak", g.requirement, g.say)).join("")
        : para(report.unchecked.length ? REPORT_LINES.nothingElseOpen : REPORT_LINES.nothingOpen),
    ),
    section(
      "Be ready to explain",
      (report.stretches.length ? label("Lines you chose to add to this CV:") : "") +
        // The prototype set each added line as a heading, without the bullet's closing full stop.
        report.stretches.map((s) => item("attn", s.line.replace(/\.$/, ""), s.say)).join("") +
        (report.explain.length
          ? label("Also prepare:", 6) +
            report.explain.map((p) => withIcon("attn", `<p style="margin:0 0 12px;font:14px/1.55 ${SANS};color:${C.ink};">${esc(p)}</p>`)).join("")
          : "") +
        (report.stretches.length + report.explain.length ? "" : para(REPORT_LINES.nothingToExplain)),
    ),
    section("Salary", `<p style="margin:0 0 14px;font:15px/1.5 ${SANS};color:${C.ink};">${esc(report.salary ?? REPORT_LINES.noSalary)}</p>`),
    row(`Sent by JobCrush. Nothing has been sent to the employer.`, `padding:6px 4px;font:12px/1.5 ${SANS};color:${C.muted};text-align:center;`),
  ].join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(posting.title)}</title></head>
<body style="margin:0;padding:0;background:${C.ground};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.ground};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
${inner}
</table></td></tr></table></body></html>`;
}
