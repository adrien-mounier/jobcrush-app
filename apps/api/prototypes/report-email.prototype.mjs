// PROTOTYPE — throwaway (#441). What should the CV email look like once it is a designed digest
// instead of plain text? Three directions over the owner's REAL report (report-email.payload.json,
// the newest application report on staging), rendered as email HTML: tables, inline styles, no
// web fonts, 600px max, the plain-text report kept as the fallback part.
//
//   node apps/api/prototypes/report-email.prototype.mjs          → writes report-email.preview.html
//   node apps/api/prototypes/report-email.prototype.mjs send A   → sends direction A to the owner
//                                                                  through staging's real Resend key
//
// Design moves shared by all three (each is a proposal for #442, not decided until he picks):
//   - "At a glance" first: N of M requirements covered, counted from the report itself (the report
//     carries no card score; showing the card's % would mean passing it in).
//   - "Check before you send" second: the ship-and-tell notices AND the unchecked requirements AND
//     the market / location lines — everything that says "check it" moves up out of sections 3-4.
//   - Section 4 splits in two: the lines he chose to add (line + what to say), then the rest.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const ICONS = ["strong", "weak", "attn", "check"];
const ICON_ALT = { strong: "Strong", weak: "Not covered", attn: "Prepare", check: "Check" };
const iconPng = (name) => readFileSync(join(HERE, "report-email-icons", `${name}.png`));
// Preview: inline data. Send: cid: references to inline attachments (Gmail renders those, not data:).
let ICON_SRC = (name) => `data:image/png;base64,${iconPng(name).toString("base64")}`;
const P = JSON.parse(readFileSync(join(HERE, "report-email.payload.json"), "utf8"));
const OWNER = "adrien.mounier91@gmail.com";
const FLY = join(process.env.USERPROFILE ?? process.env.HOME, ".fly", "bin", "flyctl.exe");

// The product's own fixed sentences, copied from applicationReport.ts REPORT_LINES.
const L = {
  noLink: "No apply link was saved for this job.",
  expectIt: "You have nothing close to this. Expect it to come up.",
  unchecked: "Not checked: you have not told us either way. Check it before you apply.",
  noSalary: "The advert does not state a salary.",
  market: (m) => `This job is in ${m}. We have not checked whether you can work there — check it before you apply.`,
  locationUnknown: "Job location unknown. We have not checked whether you can work there. Check it before you apply.",
};

function model(p, { sampleChecks = false } = {}) {
  const r = p.report;
  const stretches = [];
  const prepare = [];
  for (const line of r.explain) {
    const m = /^You chose to say "([\s\S]*)" on this CV — say: "([\s\S]*)"$/.exec(line);
    m ? stretches.push({ line: m[1].replace(/\.$/, ""), say: m[2] }) : prepare.push(line);
  }
  const checks = [
    ...p.notices,
    ...r.unchecked.map((u) => `${u} — ${L.unchecked}`),
    ...(r.marketToCheck ? [L.market(r.marketToCheck)] : []),
    ...(r.locationUnplaced ? [L.locationUnknown] : []),
  ];
  if (sampleChecks)
    checks.push(
      "SAMPLE — The CV was over two pages, so the app shortened it to fit. Read the last role before you send.",
      "SAMPLE — Fluent Cantonese — Not checked: you have not told us either way. Check it before you apply.",
    );
  const total = r.strong.length + r.gaps.length + r.unchecked.length;
  return { ...p.posting, pages: p.pages, card: p.card, r, stretches, prepare, checks, total, covered: r.strong.length };
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
const C = {
  gold: "#e8a33d", goldDeep: "#a8762b", goldLight: "#ffd9a0", goldInk: "#1a1206",
  night: "#171c23", nightRaised: "#1f262f", nightInk: "#e8eaed", nightMuted: "#8a95a2",
  paper: "#f6f2ea", paperEdge: "#e2dacb", paperInk: "#16150f", paperMuted: "#6b6455",
  ground: "#faf9f7", white: "#ffffff", ink: "#1f2328", muted: "#59636e", line: "#d9d5cf",
};
const shell = (title, bg, inner) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bg};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
${inner}
</table></td></tr></table></body></html>`;
const row = (html, style = "") => `<tr><td style="${style}">${html}</td></tr>`;
const intro = (m) =>
  `Your CV for ${esc(m.title)} at ${esc(m.company)} is attached (${m.pages} pages, PDF). Read it, then send it yourself when you are ready.`;

// ─── A · PAPER ─────────────────────────────────────────────────────────────────────────────────
// The email is one more sheet of the same paper the CV is printed on: cream, serif headings,
// numbered sections in deep gold, quotes set like a margin note. Quiet, a letter that is a digest.
function paper(m) {
  const h = (n, t) =>
    `<p style="margin:30px 0 10px;font:600 11px/1.4 ${SANS};letter-spacing:.12em;text-transform:uppercase;color:${C.goldDeep};">${n} &nbsp;·&nbsp; ${esc(t)}</p>`;
  const req = (t) => `<p style="margin:0 0 4px;font:600 15px/1.45 ${SANS};color:${C.paperInk};">${esc(t)}</p>`;
  const say = (t) =>
    `<p style="margin:0 0 18px;padding:2px 0 2px 14px;border-left:2px solid ${C.gold};font:italic 15px/1.55 ${SERIF};color:#3d3a30;">“${esc(t)}”</p>`;
  const plain = (t, extra = "") => `<p style="margin:0 0 12px;font:15px/1.6 ${SANS};color:${C.paperInk};${extra}">${esc(t)}</p>`;
  const r = m.r;
  return shell(m.title, "#ebe6dc", [
    row(
      `<p style="margin:0 0 18px;font:600 12px/1 ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${C.paperMuted};">JobCrush &nbsp;·&nbsp; Application report</p>
       <h1 style="margin:0 0 6px;font:400 27px/1.25 ${SERIF};color:${C.paperInk};">${esc(m.title)}</h1>
       <p style="margin:0 0 20px;font:15px/1.5 ${SANS};color:${C.paperMuted};">${esc(m.company)} &nbsp;·&nbsp; ${esc(m.location)}</p>
       <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:2px solid ${C.gold};border-bottom:1px solid ${C.paperEdge};"><tr>
         <td style="padding:16px 0;font:400 34px/1 ${SERIF};color:${C.paperInk};width:1%;white-space:nowrap;">${m.covered}<span style="color:${C.paperMuted};font-size:22px;"> of ${m.total}</span></td>
         <td style="padding:16px 0 16px 16px;font:15px/1.45 ${SANS};color:${C.paperInk};">of the job's requirements are covered by your facts.<br><span style="color:${C.paperMuted};">${r.gaps.length} to prepare an answer for${r.unchecked.length ? ` · ${r.unchecked.length} not checked` : ""}.</span></td>
       </tr></table>
       <p style="margin:18px 0 0;font:14px/1.6 ${SANS};color:${C.paperMuted};">${intro(m)}</p>
       ${r.applicationUrl ? `<p style="margin:16px 0 0;"><a href="${esc(r.applicationUrl)}" style="font:600 15px/1 ${SANS};color:${C.paperInk};text-decoration:underline;text-decoration-color:${C.gold};">Apply for this job →</a></p>` : `<p style="margin:12px 0 0;font:14px/1.5 ${SANS};color:${C.paperMuted};">${L.noLink}</p>`}
       ${m.checks.length ? `${h("!", "Check before you send")}${m.checks.map((c) => `<p style="margin:0 0 8px;padding:10px 14px;background:#fbf0dc;border-left:3px solid ${C.gold};font:14px/1.5 ${SANS};color:${C.paperInk};">${esc(c)}</p>`).join("")}` : ""}
       ${h(1, "The job, in short")}${plain(r.jobInShort)}${r.ageing ? plain(r.ageing, `color:${C.paperMuted};`) : ""}
       ${h(2, "Where you are strong")}${r.strong.map((s) => req(s.requirement) + say(s.say)).join("")}
       ${h(3, "Where you are not, and what to say")}${r.gaps.map((g) => req(g.requirement) + (g.say ? say(g.say) : plain(L.expectIt, `color:${C.paperMuted};font-style:italic;margin-bottom:18px;`))).join("")}
       ${h(4, "Be ready to explain")}
       ${m.stretches.length ? `<p style="margin:0 0 12px;font:14px/1.5 ${SANS};color:${C.paperMuted};">Lines you chose to add to this CV, and what to say if asked:</p>` : ""}
       ${m.stretches.map((s) => `<p style="margin:0 0 4px;font:14px/1.5 ${SANS};color:${C.paperInk};">${esc(s.line)}</p>${say(s.say)}`).join("")}
       ${m.prepare.length ? `<p style="margin:8px 0 10px;font:14px/1.5 ${SANS};color:${C.paperMuted};">Also prepare:</p>${m.prepare.map((t) => plain("— " + t)).join("")}` : ""}
       ${h(5, "Salary")}${plain(r.salary ?? L.noSalary)}`,
      `background:${C.paper};border:1px solid ${C.paperEdge};padding:36px 36px 30px;`,
    ),
    row(`Sent by JobCrush. The CV is attached; nothing has been sent to the employer.`, `padding:16px 8px;font:12px/1.5 ${SANS};color:${C.paperMuted};text-align:center;`),
  ].join("\n"));
}

// ─── B · NIGHT MASTHEAD ─────────────────────────────────────────────────────────────────────────
// The app's dark room as a masthead band: job title in white, the tally lit in gold. Below it,
// white cards, one per section, each with a gold edge. The most "this is the product" of the three.
// B2's score panel (owner, 2026-10-26: "add the score % with a mention like strong, partial").
// The job card's own number and words (jobcard.tsx matchQuality: ≥70 Strong, ≥50 Partial, else
// Weak), drawn three ways that each answer one question: the number (how good?), a gauge cut at
// the card's own thresholds (why that word?), and a map of every requirement grouped Essential /
// Desirable (made of what?) — solid gold = your facts, gold outline = a line you added (#418:
// met by a stretch, still on the CV, so still gold), grey = not covered.
const NIGHT_GOLD_TINT = "#33291b"; // gold at .12 over night-surface: the card's .bd-pill.strong fill
function scorePanel(card) {
  const pct = card.matchPct;
  const band = pct >= 70 ? "Strong" : pct >= 50 ? "Partial" : "Weak";
  const t = (px, w, color, extra = "") => `font:${w} ${px}px/1.4 ${SANS};color:${color};${extra}`;
  const fill = { facts: C.gold, added: NIGHT_GOLD_TINT, open: "#6f7d8c" };
  const block = (s, size = 20) =>
    `<td style="padding:0 4px 4px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${fill[s]}" width="${size}" height="${size}" style="width:${size}px;height:${size}px;line-height:${size}px;font-size:0;background:${fill[s]};border-radius:3px;${s === "added" ? `border:1px solid ${C.gold};width:${size - 2}px;height:${size - 2}px;line-height:${size - 2}px;` : ""}">&nbsp;</td></tr></table></td>`;
  const group = (label, b, states) =>
    `<p style="margin:0 0 7px;${t(12.5, 400, C.nightMuted)}">${label} <span style="color:${C.nightInk};font-weight:600;">${b.met} of ${b.total}</span></p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${states.map((s) => block(s)).join("")}</tr></table>`;
  // The gauge: three zones at the card's thresholds, each filled gold up to the score.
  const zones = [[0, 50, "Weak"], [50, 70, "Partial"], [70, 100, "Strong"]];
  const zone = ([from, to], i) => {
    const filled = Math.max(0, Math.min(pct, to) - from) / (to - from);
    const cell = (w, color) => (w > 0 ? `<td width="${(w * 100).toFixed(1)}%" bgcolor="${color}" height="8" style="height:8px;line-height:8px;font-size:0;background:${color};">&nbsp;</td>` : "");
    return `<td width="${to - from}%" style="padding:0 ${i < 2 ? 3 : 0}px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:4px;overflow:hidden;"><tr>${cell(filled, C.gold)}${cell(1 - filled, C.nightRaised)}</tr></table></td>`;
  };
  const counts = { facts: 0, added: 0, open: 0 };
  for (const s of [...card.rows.essential, ...card.rows.desirable]) counts[s]++;
  const met = card.essential.met + card.desirable.met;
  const total = card.essential.total + card.desirable.total;
  const key = (s, n, label) =>
    `<td style="padding:0 16px 6px 0;white-space:nowrap;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${block(s, 10)}<td style="padding:0 0 4px 3px;${t(12.5, 400, C.nightInk)}">${n} ${label}</td></tr></table></td>`;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle" style="white-space:nowrap;padding:0 16px 0 0;width:1%;${t(42, 660, C.nightInk, "line-height:1;letter-spacing:-.02em;")}">${pct}<span style="font-size:22px;color:${C.nightMuted};font-weight:600;">%</span></td>
      <td valign="middle">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${NIGHT_GOLD_TINT}" style="background:${NIGHT_GOLD_TINT};border:1px solid #8a6532;border-radius:999px;padding:5px 12px;${t(13, 700, C.gold, "line-height:1;white-space:nowrap;")}">${band} match</td></tr></table>
        <p style="margin:7px 0 0;${t(13, 400, C.nightMuted)}">${met} of ${total} requirements covered</p>
      </td></tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;"><tr>${zones.map(zone).join("")}</tr>
      <tr>${zones.map(([from, to, label]) => `<td width="${to - from}%" style="padding:6px 0 0;${label === band ? t(12, 700, C.gold) : t(12, 400, C.nightMuted)}">${label}</td>`).join("")}</tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;border-top:1px solid ${C.nightRaised};"><tr><td style="padding:18px 0 0;">
      ${group("Essential", card.essential, card.rows.essential)}
      <div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>
      ${group("Desirable", card.desirable, card.rows.desirable)}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 0;"><tr>${key("facts", counts.facts, "from your facts")}${key("added", counts.added, "lines you added")}</tr><tr>${key("open", counts.open, "not covered")}</tr></table>
    </td></tr></table>`;
}

// B2 (owner's pick, 2026-10-26): B plus Phosphor filled icons — strong, weak, and every point under
// "Be ready to explain". Icons are 2x PNGs (report-email-icons/, rendered from @phosphor-icons/core
// 2.1.1, MIT): Gmail strips SVG, so the send attaches them inline (cid:) and the preview inlines them.
function night(m, icons = false) {
  const r = m.r;
  const ic = (name) =>
    `<img src="${ICON_SRC(name)}" width="20" height="20" alt="${ICON_ALT[name]}" style="display:block;border:0;width:20px;height:20px;">`;
  const withIcon = (name, html) =>
    icons
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="top" width="30" style="width:30px;padding-top:1px;">${ic(name)}</td><td>${html}</td></tr></table>`
      : html;
  const card = (title, body, edge = C.gold) =>
    row(
      `<p style="margin:0 0 14px;font:700 16px/1.3 ${SANS};color:${C.ink};">${esc(title)}</p>${body}`,
      `background:${C.white};border:1px solid ${C.line};border-top:3px solid ${edge};border-radius:6px;padding:22px 24px 10px;`,
    ) + `<tr><td style="height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr>`;
  const item = (t, s, sMuted = false, iconName = null) =>
    withIcon(iconName, `<p style="margin:0 0 6px;font:600 14px/1.45 ${SANS};color:${C.ink};">${esc(t)}</p>` +
    `<p style="margin:0 0 16px;padding:10px 12px;background:${sMuted ? C.white : C.ground};border-radius:4px;font:14px/1.55 ${SANS};color:${sMuted ? C.muted : "#33393f"};${sMuted ? "font-style:italic;padding-left:0;" : ""}">${sMuted ? esc(s) : `Say: “${esc(s)}”`}</p>`);
  const pill = (n, label, bg, fg) =>
    `<td style="padding:0 8px 0 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${bg};color:${fg};border-radius:999px;padding:7px 14px;font:600 13px/1 ${SANS};white-space:nowrap;">${n} ${label}</td></tr></table></td>`;
  return shell(m.title, C.ground, [
    row(
      `<p style="margin:0 0 22px;font:700 13px/1 ${SANS};letter-spacing:.04em;color:${C.gold};">JobCrush</p>
       <p style="margin:0 0 6px;font:13px/1.4 ${SANS};color:${C.nightMuted};">Your CV is ready for</p>
       <h1 style="margin:0 0 4px;font:660 25px/1.25 ${SANS};color:${C.nightInk};">${esc(m.title)}</h1>
       <p style="margin:0 0 22px;font:15px/1.5 ${SANS};color:${C.nightMuted};">${esc(m.company)} · ${esc(m.location)}</p>
       ${icons ? scorePanel(m.card) : `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
         ${pill(`${m.covered} of ${m.total}`, "covered", C.gold, C.goldInk)}
         ${pill(m.r.gaps.length, "to prepare", C.nightRaised, C.nightInk)}
         ${m.r.unchecked.length ? pill(m.r.unchecked.length, "not checked", C.nightRaised, C.nightInk) : ""}
       </tr></table>`}
       ${r.applicationUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;"><tr><td style="background:${C.gold};border-radius:6px;"><a href="${esc(r.applicationUrl)}" style="display:inline-block;padding:12px 22px;font:700 15px/1 ${SANS};color:${C.goldInk};text-decoration:none;">Apply for this job</a></td></tr></table>` : `<p style="margin:20px 0 0;font:13px/1.5 ${SANS};color:${C.nightMuted};">${L.noLink}</p>`}`,
      `background:${C.night};border-radius:8px;padding:28px 28px 26px;`,
    ),
    `<tr><td style="padding:16px 4px 16px;font:14px/1.6 ${SANS};color:${C.muted};">${intro(m)}</td></tr>`,
    m.checks.length
      ? card("Check before you send", m.checks.map((c) => (icons ? withIcon("check", `<p style="margin:0 0 12px;font:14px/1.5 ${SANS};color:${C.ink};">${esc(c)}</p>`) : `<p style="margin:0 0 12px;font:14px/1.5 ${SANS};color:${C.ink};">⚠&nbsp; ${esc(c)}</p>`)).join(""), "#cf222e")
      : "",
    card("The job, in short", `<p style="margin:0 0 14px;font:15px/1.6 ${SANS};color:${C.ink};">${esc(r.jobInShort)}</p>${r.ageing ? `<p style="margin:0 0 14px;font:14px/1.5 ${SANS};color:${C.muted};">${esc(r.ageing)}</p>` : ""}`),
    card("Where you are strong", r.strong.map((s) => item(s.requirement, s.say, false, "strong")).join("")),
    card("Where you are not, and what to say", r.gaps.map((g) => (g.say ? item(g.requirement, g.say, false, "weak") : item(g.requirement, L.expectIt, true, "weak"))).join("")),
    card(
      "Be ready to explain",
      (m.stretches.length ? `<p style="margin:0 0 12px;font:13px/1.5 ${SANS};color:${C.muted};">Lines you chose to add to this CV:</p>` : "") +
        m.stretches.map((s) => item(s.line, s.say, false, "attn")).join("") +
        (m.prepare.length ? `<p style="margin:6px 0 10px;font:13px/1.5 ${SANS};color:${C.muted};">Also prepare:</p>${icons ? m.prepare.map((t) => withIcon("attn", `<p style="margin:0 0 12px;font:14px/1.55 ${SANS};color:${C.ink};">${esc(t)}</p>`)).join("") : `<ul style="margin:0 0 14px;padding-left:20px;">${m.prepare.map((t) => `<li style="margin:0 0 8px;font:14px/1.55 ${SANS};color:${C.ink};">${esc(t)}</li>`).join("")}</ul>`}` : ""),
    ),
    card("Salary", `<p style="margin:0 0 14px;font:15px/1.5 ${SANS};color:${C.ink};">${esc(r.salary ?? L.noSalary)}</p>`),
    row(`Sent by JobCrush. Nothing has been sent to the employer.`, `padding:6px 4px;font:12px/1.5 ${SANS};color:${C.muted};text-align:center;`),
  ].join("\n"));
}

// ─── C · SCORECARD ──────────────────────────────────────────────────────────────────────────────
// Built to be read in ten seconds: every requirement is one row with a status mark, the sentence
// to say tucked under it in small grey. Least prose, most glance. The report reads like a checklist.
function scorecard(m) {
  const r = m.r;
  const head = (t, n) =>
    `<tr><td colspan="2" style="padding:26px 0 8px;border-bottom:1px solid ${C.line};font:700 12px/1.4 ${SANS};letter-spacing:.08em;text-transform:uppercase;color:${C.muted};">${esc(t)}${n !== undefined ? ` <span style="color:${C.ink};">· ${n}</span>` : ""}</td></tr>`;
  const mark = (kind) =>
    ({
      ok: `<span style="display:inline-block;width:20px;height:20px;line-height:20px;border-radius:10px;background:${C.gold};color:${C.goldInk};text-align:center;font:700 12px/20px ${SANS};">✓</span>`,
      prep: `<span style="display:inline-block;width:18px;height:18px;line-height:18px;border-radius:10px;border:1px solid ${C.goldDeep};color:${C.goldDeep};text-align:center;font:700 12px/18px ${SANS};">!</span>`,
      none: `<span style="display:inline-block;width:18px;height:18px;line-height:18px;border-radius:10px;border:1px solid ${C.muted};color:${C.muted};text-align:center;font:700 12px/18px ${SANS};">–</span>`,
      check: `<span style="display:inline-block;width:20px;height:20px;line-height:20px;border-radius:10px;background:#cf222e;color:#fff;text-align:center;font:700 12px/20px ${SANS};">?</span>`,
    })[kind];
  const line = (kind, title, sub) =>
    `<tr><td valign="top" style="width:30px;padding:12px 0 12px;">${mark(kind)}</td><td style="padding:12px 0;border-bottom:1px solid #eeebe6;">` +
    `<p style="margin:0;font:600 14px/1.45 ${SANS};color:${C.ink};">${esc(title)}</p>` +
    (sub ? `<p style="margin:4px 0 0;font:13px/1.5 ${SANS};color:${C.muted};">${sub}</p>` : "") +
    `</td></tr>`;
  const bar = Math.round((m.covered / Math.max(m.total, 1)) * 100);
  return shell(m.title, "#f1efeb", [
    row(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td colspan="2" style="font:700 12px/1 ${SANS};color:${C.goldDeep};letter-spacing:.06em;padding-bottom:16px;">JOBCRUSH · YOUR CV IS ATTACHED</td></tr>
        <tr><td colspan="2"><h1 style="margin:0;font:660 22px/1.3 ${SANS};color:${C.ink};">${esc(m.title)}</h1>
          <p style="margin:4px 0 18px;font:14px/1.5 ${SANS};color:${C.muted};">${esc(m.company)} · ${esc(m.location)} · ${m.pages}-page PDF attached</p></td></tr>
        <tr><td colspan="2" style="padding-bottom:6px;font:14px/1.4 ${SANS};color:${C.ink};"><b style="font-size:20px;">${m.covered}/${m.total}</b>&nbsp; requirements covered by your facts</td></tr>
        <tr><td colspan="2" style="padding-bottom:4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ece8e1;border-radius:4px;"><tr><td width="${bar}%" style="background:${C.gold};height:8px;line-height:8px;font-size:0;border-radius:4px;">&nbsp;</td><td style="font-size:0;">&nbsp;</td></tr></table></td></tr>
        <tr><td colspan="2" style="padding-top:14px;font:13px/1.5 ${SANS};color:${C.muted};">${r.applicationUrl ? `<a href="${esc(r.applicationUrl)}" style="color:${C.ink};font-weight:700;">Apply for this job →</a>` : L.noLink} Read the CV, then send it yourself when you are ready.</td></tr>
        ${m.checks.length ? head("Check before you send", m.checks.length) + m.checks.map((c) => line("check", c)).join("") : ""}
        ${head("The job, in short")}
        <tr><td colspan="2" style="padding:12px 0 0;font:14px/1.6 ${SANS};color:${C.ink};">${esc(r.jobInShort)}${r.ageing ? `<br><span style="color:${C.muted};">${esc(r.ageing)}</span>` : ""}<br><span style="color:${C.muted};">Salary: ${esc(r.salary ?? L.noSalary)}</span></td></tr>
        ${head("Covered", r.strong.length)}${r.strong.map((s) => line("ok", s.requirement, `Say: “${esc(s.say)}”`)).join("")}
        ${head("Not covered — what to say", r.gaps.length)}${r.gaps.map((g) => line(g.say ? "prep" : "none", g.requirement, g.say ? `Say: “${esc(g.say)}”` : `<i>${L.expectIt}</i>`)).join("")}
        ${m.stretches.length ? head("Lines you added — if asked", m.stretches.length) + m.stretches.map((s) => line("prep", s.line, `Say: “${esc(s.say)}”`)).join("") : ""}
        ${m.prepare.length ? head("Also prepare", m.prepare.length) + m.prepare.map((t) => line("none", t)).join("") : ""}
      </table>`,
      `background:${C.white};border:1px solid ${C.line};border-radius:8px;padding:28px 28px 22px;`,
    ),
    row(`Sent by JobCrush. Nothing has been sent to the employer.`, `padding:14px 4px;font:12px/1.5 ${SANS};color:${C.muted};text-align:center;`),
  ].join("\n"));
}

// ─── D · DASHBOARD (owner's ask, via /impeccable) ───────────────────────────────────────────────
// The Night Desk as a one-screen dashboard: the whole email is the dark room. The hero is a
// requirement map — one block per advert requirement, lit gold where covered (the Gold Law: gold
// = on your CV), Night Weak where not, outlined where nobody checked — so the fit reads before a
// word does. Four status tiles, then the detail row by row with the same marks. The lines he chose
// to add are cream paper slips in the serif: they are literally his CV (the Serif Means Her rule).
// Every graphic is a table cell with a bgcolor — no SVG, no images, nothing Gmail strips.
function dashboard(m) {
  const r = m.r;
  const D = { floor: "#101419", surface: "#171c23", raised: "#1f262f", line: "#2b333d", weak: "#6f7d8c", reserve: "#97aabc", settled: "#4d5865", warn: "#e0876c" };
  const gap = (h) => `<tr><td style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</td></tr>`;
  const t = (px, w, color, extra = "") => `font:${w} ${px}px/1.5 ${SANS};color:${color};${extra}`;
  // One block per requirement, in the order the sections list them.
  const states = [
    ...r.strong.map(() => "met"),
    ...r.gaps.map((g) => (g.say ? "gap" : "none")),
    ...r.unchecked.map(() => "unchecked"),
  ];
  const fill = { met: C.gold, gap: D.weak, none: D.settled, unchecked: D.surface };
  const strip = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${states
    .map(
      (s, i) =>
        `<td width="${(100 / states.length).toFixed(2)}%" style="padding:0 ${i === states.length - 1 ? 0 : 4}px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${fill[s]}" height="34" style="height:34px;line-height:34px;font-size:0;background:${fill[s]};border-radius:4px;${s === "unchecked" ? `border:1px dashed ${D.reserve};` : ""}">&nbsp;</td></tr></table></td>`,
    )
    .join("")}</tr></table>`;
  const dot = (s) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${fill[s]}" width="10" height="10" style="width:10px;height:10px;line-height:10px;font-size:0;background:${fill[s]};border-radius:2px;${s === "unchecked" ? `border:1px dashed ${D.reserve};` : ""}">&nbsp;</td></tr></table>`;
  const legend = (s, n, label) =>
    n ? `<td style="padding:0 18px 0 0;white-space:nowrap;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:0 7px 0 0;">${dot(s)}</td><td style="${t(13, 400, C.nightInk)}">${n} ${label}</td></tr></table></td>` : "";
  const counts = { met: r.strong.length, gap: r.gaps.filter((g) => g.say).length, none: r.gaps.filter((g) => !g.say).length, unchecked: r.unchecked.length };
  const tile = (side, label, value, note, alert = false) =>
    `<td width="50%" valign="top" style="padding:${side ? "0 0 10px 5px" : "0 5px 10px 0"};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${D.raised}" style="background:${D.raised};border:1px solid ${alert ? D.warn : D.line};border-radius:10px;padding:14px 16px;">` +
    `<p style="margin:0 0 4px;${t(12.5, 400, C.nightMuted)}">${esc(label)}</p>` +
    `<p style="margin:0;${t(17, 620, alert ? D.warn : C.nightInk, "line-height:1.3;")}">${esc(value)}</p>` +
    (note ? `<p style="margin:3px 0 0;${t(12.5, 400, C.nightMuted)}">${esc(note)}</p>` : "") +
    `</td></tr></table></td>`;
  const head = (title, aside = "") =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid ${D.line};"><tr><td style="padding:0 0 10px;${t(15, 620, C.nightInk)}">${esc(title)}</td><td align="right" style="padding:0 0 10px;${t(12.5, 400, C.nightMuted)}">${aside}</td></tr></table>`;
  const reqRow = (s, title, body) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid ${D.line};"><tr>` +
    `<td valign="top" width="22" style="width:22px;padding:17px 0 0;">${dot(s)}</td>` +
    `<td style="padding:13px 0 14px;"><p style="margin:0;${t(14, 600, C.nightInk, "line-height:1.45;")}">${esc(title)}</p>${body}</td></tr></table>`;
  const say = (text) => `<p style="margin:6px 0 0;${t(13.5, 400, "#c3c9d1")}"><span style="color:${C.nightMuted};">Say:</span> “${esc(text)}”</p>`;
  const slip = (line, answer) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;"><tr><td bgcolor="${C.paper}" style="background:${C.paper};border:1px solid ${C.paperEdge};border-radius:6px 6px 0 0;padding:12px 14px;font:15px/1.5 ${SERIF};color:${C.paperInk};">${esc(line)}</td></tr>` +
    `<tr><td bgcolor="${D.raised}" style="background:${D.raised};border:1px solid ${D.line};border-top:0;border-radius:0 0 6px 6px;padding:10px 14px;${t(13.5, 400, "#c3c9d1")}"><span style="color:${C.nightMuted};">If asked:</span> “${esc(answer)}”</td></tr></table>`;
  const nChecks = m.checks.length;
  const toPrepare = m.stretches.length + m.prepare.length;

  return shell(m.title, D.floor, [
    // Masthead + map
    row(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:0 0 18px;${t(13, 700, C.nightInk, "letter-spacing:.02em;")}">JobCrush <span style="font-weight:400;color:${C.nightMuted};">· your CV is attached, ${m.pages}-page PDF</span></td></tr>
        <tr><td><h1 style="margin:0;${t(24, 660, C.nightInk, "line-height:1.2;letter-spacing:-.015em;")}">${esc(m.title)}</h1>
          <p style="margin:4px 0 0;${t(14, 400, C.nightMuted)}">${esc(m.company)} · ${esc(m.location)}</p></td></tr>
        ${gap(26)}
        <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="bottom" style="${t(38, 660, C.nightInk, "line-height:1;letter-spacing:-.02em;")}">${m.covered}<span style="font-size:19px;color:${C.nightMuted};font-weight:400;"> / ${m.total}</span></td>
          <td valign="bottom" align="right" style="${t(13, 400, C.nightMuted)}">requirements covered<br>by your facts</td></tr></table></td></tr>
        ${gap(12)}
        <tr><td>${strip}</td></tr>
        ${gap(12)}
        <tr><td><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${legend("met", counts.met, "covered")}${legend("gap", counts.gap, "answer ready")}</tr><tr><td style="height:6px;font-size:0;">&nbsp;</td></tr><tr>${legend("none", counts.none, "nothing close")}${legend("unchecked", counts.unchecked, "not checked")}</tr></table></td></tr>
      </table>`,
      `background:${D.surface};border:1px solid ${D.line};border-radius:16px;padding:26px 26px 22px;`,
    ),
    gap(12),
    // Status tiles
    row(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>${tile(0, "Check before you send", nChecks ? `${nChecks} to check` : "Nothing to check", nChecks ? "See below, before the PDF" : "", nChecks > 0)}${tile(1, "Apply link", r.applicationUrl ? "Saved" : "Not saved", r.applicationUrl ? "" : "Find the job's page yourself")}</tr>
        <tr>${tile(0, "Salary", r.salary ?? "Not stated", r.salary ? "As the advert states it" : "The advert gives no figure")}${tile(1, "To prepare", `${toPrepare} points`, `${m.stretches.length} lines you added · ${m.prepare.length} more`)}</tr>
      </table>`,
      `padding:0;`,
    ),
    r.applicationUrl
      ? row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${C.gold}" align="center" style="background:${C.gold};border-radius:10px;"><a href="${esc(r.applicationUrl)}" style="display:block;padding:14px;${t(15, 700, C.goldInk)}text-decoration:none;">Apply for this job</a></td></tr></table>`, `padding:0 0 12px;`)
      : "",
    // Detail
    row(
      [
        nChecks
          ? `${head("Check before you send")}${m.checks.map((c) => `<p style="margin:12px 0 0;${t(14, 400, D.warn)}">${esc(c)}</p>`).join("")}<div style="height:30px;line-height:30px;font-size:0;">&nbsp;</div>`
          : "",
        `${head("The job, in short")}<p style="margin:12px 0 0;${t(14.5, 400, C.nightInk, "line-height:1.6;")}">${esc(r.jobInShort)}</p>${r.ageing ? `<p style="margin:6px 0 0;${t(13, 400, C.nightMuted)}">${esc(r.ageing)}</p>` : ""}`,
        `<div style="height:30px;line-height:30px;font-size:0;">&nbsp;</div>${head("Requirement by requirement", `${m.covered} of ${m.total} covered`)}`,
        ...r.strong.map((s) => reqRow("met", s.requirement, say(s.say))),
        ...r.gaps.map((g) => reqRow(g.say ? "gap" : "none", g.requirement, g.say ? say(g.say) : `<p style="margin:6px 0 0;${t(13.5, 400, C.nightMuted)}">${L.expectIt}</p>`)),
        ...r.unchecked.map((u) => reqRow("unchecked", u, `<p style="margin:6px 0 0;${t(13.5, 400, C.nightMuted)}">${L.unchecked}</p>`)),
        m.stretches.length
          ? `<div style="height:30px;line-height:30px;font-size:0;">&nbsp;</div>${head("Lines you added to this CV", `${m.stretches.length}`)}<div style="height:14px;font-size:0;">&nbsp;</div>${m.stretches.map((s) => slip(s.line, s.say)).join("")}`
          : "",
        m.prepare.length
          ? `<div style="height:18px;line-height:18px;font-size:0;">&nbsp;</div>${head("Also prepare", `${m.prepare.length}`)}${m.prepare.map((p) => `<p style="margin:0;padding:12px 0;border-bottom:1px solid ${D.line};${t(14, 400, C.nightInk)}">${esc(p)}</p>`).join("")}`
          : "",
      ].join(""),
      `background:${D.surface};border:1px solid ${D.line};border-radius:16px;padding:24px 26px 18px;`,
    ),
    row(`Read the CV, then send it yourself when you are ready. Nothing has been sent to the employer.`, `padding:18px 8px 4px;${t(12.5, 400, C.nightMuted)}text-align:center;`),
  ].join("\n"));
}

const DIRECTIONS = {
  A: { name: "Paper", render: paper },
  B: { name: "Night masthead", render: (m) => night(m) },
  B2: { name: "B with icons + score", render: (m) => night(m, true) },
  C: { name: "Scorecard", render: scorecard },
  D: { name: "Dashboard", render: dashboard },
};

// The plain-text fallback part is the product's own, from the built module.
async function textPart() {
  const { reportEmailText } = await import("../dist/applicationReport.js");
  return reportEmailText(P.report, P.posting, P.pages, P.notices);
}

async function send(key) {
  const d = DIRECTIONS[key];
  if (!d) throw new Error(`send ${Object.keys(DIRECTIONS).join("|")}`);
  const m = model(P);
  const mail = {
    to: [OWNER],
    subject: `[Prototype ${key} · ${d.name}] Your CV for ${P.posting.title} at ${P.posting.company}`,
    html: (ICON_SRC = (name) => `cid:${name}`, d.render(m)),
    text: await textPart(),
    // Resend: an attachment with a content_id is inline, referenced as cid:<id>.
    ...(key === "B2" && { attachments: ICONS.map((n) => ({ filename: `${n}.png`, content: iconPng(n).toString("base64"), content_id: n })) }),
  };
  const z = gzipSync(JSON.stringify(mail)).toString("base64");
  // Runs on the staging machine: the Resend key never leaves it. No PDF attached (prototype).
  const remote = `const m=JSON.parse(require('zlib').gunzipSync(Buffer.from(process.argv[2],'base64')));
fetch('https://api.resend.com/emails',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.RESEND_API_KEY},
body:JSON.stringify({from:process.env.MAIL_FROM||'JobCrush <login@jobcrush.app>',...m})}).then(async r=>console.log('resend',r.status,await r.text()));`;
  const b64 = Buffer.from(remote).toString("base64");
  const out = execFileSync(
    FLY,
    ["ssh", "console", "-a", "jobcrush-api-staging", "-C", `node -e eval(Buffer.from(process.argv[1],String.fromCharCode(98,97,115,101,54,52)).toString()) ${b64} ${z}`],
    { encoding: "utf8" },
  );
  console.log(out.trim().split("\n").pop());
}

function preview() {
  const variants = Object.fromEntries(
    Object.entries(DIRECTIONS).flatMap(([k, d]) => [
      [k, d.render(model(P))],
      [k + "+", d.render(model(P, { sampleChecks: true }))],
    ]),
  );
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PROTOTYPE #441 — CV email</title>
<style>body{margin:0;background:#2b333d;font:14px/1.4 ${SANS};color:#e8eaed}
#frame{display:block;margin:0 auto 90px;border:0;background:#fff;transition:width .2s}
.bar{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#101419;border:1px solid #4d5865;border-radius:999px;padding:8px;display:flex;gap:6px;box-shadow:0 6px 24px #0008}
.bar button{font:600 13px/1 ${SANS};padding:9px 14px;border-radius:999px;border:0;background:#1f262f;color:#e8eaed;cursor:pointer}
.bar button[aria-pressed=true]{background:#e8a33d;color:#1a1206}.sep{width:1px;background:#4d5865;margin:0 4px}
.note{max-width:760px;margin:0 auto;padding:16px;color:#8a95a2}</style></head><body>
<p class="note">PROTOTYPE (#441). Your real MSCI report from staging, in three email designs. "Sample checks" adds two made-up
"check before you send" lines so you can see that block — your real report had none. Phone = 375px wide.</p>
<iframe id="frame" title="email"></iframe>
<div class="bar">${Object.entries(DIRECTIONS).map(([k, d]) => `<button data-v="${k}">${k} · ${d.name}</button>`).join("")}
<span class="sep"></span><button data-t="phone">Phone</button><button data-t="checks">Sample checks</button></div>
<script>const V=${JSON.stringify(variants).replace(/</g, "\\u003c")};
const q=new URLSearchParams(location.search);let v=q.get("variant")||"A",phone=q.has("phone"),checks=q.has("checks");
const f=document.getElementById("frame");
function draw(){f.srcdoc=V[v+(checks?"+":"")];f.style.width=phone?"375px":"760px";
document.querySelectorAll("[data-v]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===v));
document.querySelector("[data-t=phone]").setAttribute("aria-pressed",phone);document.querySelector("[data-t=checks]").setAttribute("aria-pressed",checks);
const u=new URL(location);u.searchParams.set("variant",v);phone?u.searchParams.set("phone",""):u.searchParams.delete("phone");checks?u.searchParams.set("checks",""):u.searchParams.delete("checks");history.replaceState(0,"",u)}
f.onload=()=>{f.style.height=f.contentDocument.documentElement.scrollHeight+"px"};
document.querySelector(".bar").onclick=e=>{const b=e.target.closest("button");if(!b)return;if(b.dataset.v)v=b.dataset.v;if(b.dataset.t==="phone")phone=!phone;if(b.dataset.t==="checks")checks=!checks;draw()};
addEventListener("keydown",e=>{const k=Object.keys(${JSON.stringify(Object.keys(DIRECTIONS))});const i=k.indexOf(v);if(e.key==="ArrowRight")v=k[(i+1)%k.length];else if(e.key==="ArrowLeft")v=k[(i+k.length-1)%k.length];else return;draw()});
draw();</script></body></html>`;
  writeFileSync(join(HERE, "report-email.preview.html"), page);
  console.log("wrote", join(HERE, "report-email.preview.html"));
}

process.argv[2] === "send" ? await send(process.argv[3]) : preview();
