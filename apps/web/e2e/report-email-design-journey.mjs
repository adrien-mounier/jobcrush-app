// #442 "The CV email is sent as a designed digest (B2)" — the live journey, human-paced, over the
// REAL fake-model QA stack (qa-main: stage-aware fake model incl. the stretch step and the report
// call, StandInDocumentMaker, DevMailer). Nothing leaves the machine: no real email, no paid call.
//
// What it proves, in the order he meets it:
//   1  a pasted job (title and company with <, & and quotes): its own screen -> Write the tailored
//      CV -> the draft; a suggested line is offered and he uses it, and the score on the screen moves
//   2  the number he reads on the Tailor screen, and the word + counts on the job's own screen
//   3  one press "Approve and email me this CV" -> Done
//   4  (only when MAIL_DIR names the folder a mail-recording wrapper writes, see below) the email the
//      API handed the mailer: a plain-text part AND an HTML part; the PDF attached (no content id);
//      each icon the HTML shows travels inline (a content id, referenced as cid:), no unused one
//   5  the HTML, opened in a browser with each cid: swapped for its PNG: the score panel carries the
//      screen's %, the screen's word, its essential / desirable counts, one map block per advert
//      requirement and the used line counted as "line you added"; every section in order; Check
//      before you send carries the unchecked / market / location lines the text part keeps in
//      sections 3-4; the HTML and the text say the same things; at 375px nothing scrolls sideways;
//      under a dark colour scheme it renders unchanged (it declares none — the mail app decides)
//
// The DevMailer prints only the subject. MAIL_DIR is optional so this journey also runs in CI
// against plain qa-main, where steps 1-3 still hold and 4-5 are noted as skipped. The wrapper's
// contract, per CV mail N it records (preloaded with `node --import` around dist/mailer.js's
// DevMailer.prototype.sendTailoredCv):
//   mail-N.json       { to, subject, filename, pdfBytes, pdfMagic, images: [{contentId, filename, bytes}],
//                       text, resend: { keys, attachments: [{ filename, content (truncated), content_id? }] } }
//                     — `resend` is the body ResendMailer would POST, captured with fetch stubbed
//   mail-N.raw.html   the HTML part as sent;   mail-N-<contentId>.png   each inline image's bytes
//
//   PORT=34442 OPS_KEY=qa-ops-key node --import <wrapper> apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34442 npx next build && npx next start -p 34443
//   BASE_URL=http://127.0.0.1:34443 [MAIL_DIR=<folder>] node apps/web/e2e/report-email-design-journey.mjs

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const MAIL_DIR = process.env.MAIL_DIR ?? null;
const ROLE = 'IT project manager in Brussels';
const EMAIL = `report-email-${Date.now()}@example.com`;
const LINK = `https://careers.example.com/jobs/${Date.now()}/apply?ref=jc&src=paste`;
// qa-main's fake header reader: line 1 "<title> — <company>", line 2 the location. qa-main placed neither
// a pasted Brussels nor a pasted Paris (measured 2026-10-26), so "Job location unknown" always lands in Check before
// you send here: the empty state ("Nothing to check") is pinned by reportEmailHtml.test.ts instead.
const TITLE = 'Senior IT Project Manager (R&D <Atlas> "Core")';
// Unique per run: a pasted advert is one posting across sessions (its id is the canonical key), and
// a re-paste of the same advert keeps the apply link stored first — measured 2026-10-26.
const COMPANY = `O'Brien & Sons ${Date.now() % 100000}`;
const ADVERT = `${TITLE} — ${COMPANY}
Brussels, Belgium · Hybrid

O'Brien & Sons is looking for a Senior IT Project Manager to lead the delivery of our ERP rollout.

What you will do
- Own the end-to-end delivery of the programme, from the business case through to go-live.
- Coordinate business and technical stakeholders and report progress to the steering committee.
- Identify, track and mitigate risks, issues and dependencies.

What we are looking for
- At least six years managing IT projects.
- Excellent stakeholder communication at executive level.

Apply at ${LINK}`;

const USE = 'Use for this job';
const APPROVE = 'Approve and email me this CV';
const DONE = 'Done — your CV is made and the email is on its way.';
const TEXT_HEADINGS = ['1. The job, in short', '2. Where you are strong', '3. Where you are not, and what to say', '4. Be ready to explain', '5. Salary'];
const HTML_SECTIONS = ['Check before you send', 'The job, in short', 'Where you are strong', 'Where you are not, and what to say', 'Be ready to explain', 'Salary'];
const NOT_CHECKED = 'Not checked: you have not told us either way. Check it before you apply.';
const MARKET = /^This job is in .+\. We have not checked whether you can work there — check it before you apply\.$/;
const LOCATION_UNKNOWN = 'Job location unknown. We have not checked whether you can work there. Check it before you apply.';
const NOTHING_TO_CHECK = 'Nothing to check. The CV is exactly as you approved it, and nothing in this job was left unchecked.';
// The job card's own thresholds (apps/web/app/jobcard.tsx matchQuality).
const band = (pct) => (pct >= 70 ? 'Strong' : pct >= 50 ? 'Partial' : 'Weak');

const qa = await createSession('report-email-design-journey', { baseURL: BASE, viewport: { width: 1280, height: 800 } });
const { page } = qa;
const assert = (cond, note) => qa.expectText('body', cond ? '' : '\u0000-IMPOSSIBLE-', note);
const api = (path) => page.evaluate(async (p) => (await fetch(p)).json(), path);
const ringPct = async () => Number(((await page.locator('.dbar .score').getAttribute('aria-label')) ?? '').replace(/\D/g, ''));

// ---------------------------------------------------------------------------------------------
// 0. Seed: discovery, his CV's facts (review completed), the real magic-link sign-in.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'land on discovery — establishes the anonymous session');
await page.evaluate(
  (role) => fetch('/api/onboarding/discovery/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }) }).then(() => undefined),
  ROLE,
);
const facts = await qa.factsFromCv();
if (!(facts > 0)) throw new Error(`his CV gave the session no facts (${facts})`);
const seeded = await page.evaluate(async (email) => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const link = await (await post('/api/auth/request-link', { email })).json();
  if (!link.devLink) return `sign-in failed: ${JSON.stringify(link)}`;
  await post('/api/auth/verify', { token: new URL('http://x' + link.devLink).searchParams.get('token') });
  return 'ok';
}, EMAIL);
if (seeded !== 'ok') throw new Error(seeded);
await qa.note(`signed in as ${EMAIL}, ${facts} facts on his record`);

// ---------------------------------------------------------------------------------------------
// 1. A pasted job (v1's door) -> its own screen -> the Tailor screen -> the draft -> use the
//    suggested line if one is offered. Its title and company carry <, & and quotes.
// ---------------------------------------------------------------------------------------------
await qa.goto('/paste', 'the paste door');
await qa.fill(page.locator('#advert'), ADVERT, 'paste a real-looking advert, its title and company carrying <, & and quotes');
await qa.click(page.getByRole('button', { name: 'Read it' }), "press 'Read it'");
await page.waitForURL(/\/job\//, { timeout: 180_000 }).catch(() => {});
const jobPath = new URL(page.url()).pathname;
await page.locator('.onejob .jobcard').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
await qa.expectVisible('.onejob .jobcard', `the pasted job's own screen (${jobPath})`);
await qa.expectVisible(page.getByRole('heading', { name: TITLE }), `the title reads literally: ${TITLE}`);
await qa.scrollThrough('read the pasted job');
await qa.click(page.getByRole('button', { name: 'Write the tailored CV' }), 'Write the tailored CV');
await page.waitForURL('**/tailor', { timeout: 15_000 });
if ((await page.locator('.tailor .ask .q').count()) > 0) {
  await qa.click(page.locator('.tailor .opts .opt').first(), 'a profile question this job left open — answer it once');
  await page.waitForTimeout(1400);
}
await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
await qa.expectVisible('.draft-frame', 'the tailored CV draft is the page');
const before = await api('/api/onboarding/tailor');
const pctBefore = await ringPct();
await qa.expectVisible('.dbar .score', `the Tailor screen shows the score: ${pctBefore}%`);

const suggestion = page.getByRole('region', { name: /^Suggestion 1 of \d+$/ });
await suggestion.waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
let used = null;
if (await suggestion.isVisible()) {
  const view = await api('/api/onboarding/tailor/draft');
  used = view.stretch?.suggestions?.[0] ?? null;
  await qa.expectVisible(suggestion, `a suggested line is offered: "${used?.claimText}"`);
  await qa.click(suggestion.getByRole('button', { name: new RegExp(`^${USE}`) }), 'Use for this job');
  await page.locator('.dbar .score').locator(`xpath=self::*[not(@aria-label="${pctBefore}% match")]`).waitFor({ timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1600); // let the roll-up land before reading the number
  await page.keyboard.press('Escape'); // close the next card that opens by itself
} else {
  await qa.note('no suggested line was offered on this stack — the map will hold no "line you added"');
}
const state = await api('/api/onboarding/tailor');
const card = state.card;
const screenPct = await ringPct();
await qa.expectVisible('.dbar .score', `the Tailor screen's number after the answer: ${screenPct}%`);
await assert(screenPct === card.matchPct, `the ring shows the server's card number (${screenPct}% = ${card.matchPct}%)`);
if (used) await assert(card.matchPct > before.card.matchPct, `using the line moved the score (${before.card.matchPct}% -> ${card.matchPct}%)`);
const stretchedRows = card.fit.filter((f) => f.stretched).length;
await qa.note(`card: ${card.matchPct}% · essential ${JSON.stringify(card.breakdown.essential)} · desirable ${JSON.stringify(card.breakdown.desirable)} · ${card.fit.length} met (${stretchedRows} by a line he added)`);

// ---------------------------------------------------------------------------------------------
// 2. The job's own screen: the word and the counts a person reads there for this draft.
// ---------------------------------------------------------------------------------------------
await qa.goto(jobPath, "back to the job's own screen, now the line is used");
await page.locator('.bd-pill').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
await qa.scrollThrough("read the job's own screen");
const jobWord = ((await page.locator('.bd-pill').first().textContent().catch(() => '')) ?? '').trim();
const cells = (await page.locator('.bd-n').allTextContents().catch(() => [])).map((s) => s.trim());
await qa.expectVisible(page.locator('.bd-pill').first(), `the job's own screen names the match "${jobWord}" (cells ${cells.join(' · ')})`);
await assert(jobWord === band(card.matchPct), `the screen's word is the card band of ${card.matchPct}% ("${jobWord}")`);
const { essential, desirable } = card.breakdown;
await assert(
  cells.join() === [`${essential.met + desirable.met}/${essential.total + desirable.total}`, `${essential.met}/${essential.total}`, `${desirable.met}/${desirable.total}`].join(),
  `the job's own screen counts the same as the card (${cells.join(' · ')})`,
);

// ---------------------------------------------------------------------------------------------
// 3. Back to the draft: one press -> Done.
// ---------------------------------------------------------------------------------------------
await qa.goto('/tailor', 'back to the Tailor screen to approve');
await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
await qa.scrollThrough('read down to the send block');
const reportBefore = (await api('/api/qa/llm-calls')).report ?? 0;
await qa.click(page.getByRole('button', { name: APPROVE }), APPROVE);
await page.getByText(DONE).waitFor({ timeout: 90_000 }).catch(() => {});
await qa.expectText('.draft-send', DONE, 'Done — the document is made and the email is on its way');
const reportAfter = (await api('/api/qa/llm-calls')).report ?? 0;
await assert(reportAfter === reportBefore + 1, `one report call was spent (${reportBefore} -> ${reportAfter}); the score panel added none`);

// ---------------------------------------------------------------------------------------------
// 4. The mail as the API handed it to the mailer.
// ---------------------------------------------------------------------------------------------
const mailFiles = MAIL_DIR && existsSync(MAIL_DIR)
  ? readdirSync(MAIL_DIR).filter((f) => /^mail-\d+\.json$/.test(f)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
  : [];
const mine = mailFiles.map((f) => ({ f, m: JSON.parse(readFileSync(join(MAIL_DIR, f), 'utf8')) })).filter(({ m }) => m.to === EMAIL);
if (!MAIL_DIR) await qa.note('MAIL_DIR not set — the email is not readable on this stack; steps 4-5 skipped');
else {
  await assert(mine.length === 1, `one CV email reached his address (got ${mine.length})`);
  const { f, m: mail } = mine.at(-1);
  const n = f.match(/\d+/)[0];
  const html = readFileSync(join(MAIL_DIR, `mail-${n}.raw.html`), 'utf8');
  await qa.note(`mail-${n}: "${mail.subject}" · ${mail.filename} (${mail.pdfBytes} bytes, starts "${mail.pdfMagic}") · inline ${mail.images.map((i) => i.contentId).join(', ')} · Resend keys ${mail.resend.keys.join(', ')}`);
  await assert(mail.resend.keys.includes('text') && mail.resend.keys.includes('html'), 'both parts go to the mail service: text and html');
  await assert(mail.pdfMagic === '%PDF-' && mail.pdfBytes > 0, 'the PDF is attached and is a PDF');
  const [pdf, ...rest] = mail.resend.attachments;
  await assert(pdf.filename === mail.filename && !('content_id' in pdf), `the PDF is an ordinary attachment (no content id): "${pdf.filename}"`);
  const cids = [...new Set([...html.matchAll(/src="cid:([^"]+)"/g)].map((x) => x[1]))].sort();
  await assert(JSON.stringify(rest.map((a) => a.content_id).sort()) === JSON.stringify(cids),
    `every icon the HTML shows rides inline with its content id, and no other (${cids.join(', ')})`);
  await assert(rest.every((a) => a.filename === `${a.content_id}.png`), 'each inline image is its named PNG');
  await assert(!/<svg|<script|<style|data:image/.test(html), 'email-safe HTML: no SVG, script, style block or data: image');

  // The text part: still the five-section fallback.
  const text = mail.text;
  const at = TEXT_HEADINGS.map((h) => text.indexOf(h));
  await assert(at.every((i) => i >= 0) && [...at].sort((a, b) => a - b).join() === at.join(), 'the plain-text part keeps its five sections, in order');
  writeFileSync(join(qa.runDir, 'mail-text.txt'), text);
  await qa.note(`text part:\n${text}`);

  // ---------------------------------------------------------------------------------------------
  // 5. The HTML part in a browser, each cid: swapped for its PNG (browsers do not resolve cid:).
  // ---------------------------------------------------------------------------------------------
  let view = html;
  for (const id of cids) view = view.split(`cid:${id}`).join(`data:image/png;base64,${readFileSync(join(MAIL_DIR, `mail-${n}-${id}.png`)).toString('base64')}`);
  const viewFile = join(qa.runDir, 'mail-view.html');
  writeFileSync(viewFile, view);
  await qa.goto(pathToFileURL(viewFile).href, 'open the HTML part (desktop width) — icons swapped in from their attachments');
  await assert(await page.evaluate(() => [...document.images].every((i) => i.complete && i.naturalWidth === 40)), 'every icon loads (40x40 PNG, shown at 20px)');
  await assert(await page.evaluate(() => [...document.images].every((i) => i.alt.length > 0)), 'every icon has alt text');

  // The score panel against the screens.
  const pct = card.matchPct;
  const word = band(pct);
  await qa.expectVisible(page.getByText(`${pct}%`, { exact: true }), `the panel's number is the Tailor screen's: ${pct}%`);
  await qa.expectVisible(page.getByText(`${jobWord} match`, { exact: true }), `the panel's word is the job screen's: "${jobWord} match"`);
  await qa.expectVisible(page.getByText(`${essential.met + desirable.met} of ${essential.total + desirable.total} requirements covered`), 'requirements covered, as the card counts them');
  if (essential.total) await qa.expectVisible(page.getByText(`Essential ${essential.met} of ${essential.total}`), `Essential ${essential.met} of ${essential.total}`);
  if (desirable.total) await qa.expectVisible(page.getByText(`Desirable ${desirable.met} of ${desirable.total}`), `Desirable ${desirable.met} of ${desirable.total}`);
  const blocks = await page.locator('td[bgcolor][width="20"]').count();
  await assert(blocks === essential.total + desirable.total, `one map block per advert requirement (${blocks} = ${essential.total + desirable.total})`);
  const outlined = await page.locator('td[bgcolor][width="20"][style*="border:1px solid"]').count();
  await assert(outlined === stretchedRows, `blocks outlined as "a line you added" = rows met by a used line (${outlined} = ${stretchedRows})`);
  await qa.expectVisible(page.getByText(`${card.fit.length - stretchedRows} from your facts`), `${card.fit.length - stretchedRows} from your facts`);
  await qa.expectVisible(page.getByText(`${stretchedRows} ${stretchedRows === 1 ? 'line' : 'lines'} you added`), `${stretchedRows} line(s) you added`);
  await qa.expectVisible(page.getByText(`${essential.total + desirable.total - card.fit.length} not covered`), 'and the rest not covered');
  const lit = await page.locator('td[style*="padding:6px 0 0;font:700"]').allTextContents();
  await assert(lit.join() === word, `the gauge lights the "${word}" band only (${lit.join()})`);
  await qa.expectVisible(page.getByRole('link', { name: 'Apply for this job' }), 'the gold apply button');
  await assert((await page.getByRole('link', { name: 'Apply for this job' }).getAttribute('href')) === LINK, 'it opens the advert\'s own apply link, & and all');
  // What the advert wrote is escaped: it reads literally and never becomes markup.
  await qa.expectText('h1', TITLE, `the title reads literally in the panel: ${TITLE}`);
  await qa.expectVisible(page.getByText(`${COMPANY} · `, { exact: false }), `the company reads literally: ${COMPANY}`);
  await assert(html.includes('R&amp;D &lt;Atlas&gt; &quot;Core&quot;') && !html.includes('<Atlas>') && html.includes('O&#39;Brien &amp; Sons'), 'in the HTML source: &amp; &lt; &gt; &quot; &#39; — no raw tag from the advert');
  await assert((await page.locator('atlas').count()) === 0, 'and no <atlas> element exists in the rendered mail');

  // Every section, in order, and the moves out of 3-4.
  const body = await page.evaluate(() => document.body.innerText);
  const pos = HTML_SECTIONS.map((s) => body.indexOf(`\n${s}\n`));
  await assert(pos.every((i) => i >= 0) && [...pos].sort((a, b) => a - b).join() === pos.join(), `the sections, in order: ${HTML_SECTIONS.join(' > ')}`);
  await assert(body.indexOf('Your CV is ready for') < body.indexOf('Your CV for') && body.indexOf('Your CV for') < pos[0], 'the score panel first, then the intro, then Check before you send');
  await assert(body.trim().endsWith('Sent by JobCrush. Nothing has been sent to the employer.'), 'the footer closes it');
  const sectionOf = (i) => body.slice(pos[i], i + 1 < pos.length ? pos[i + 1] : undefined);
  const checkHtml = sectionOf(0);
  const textS3 = text.slice(at[2], at[3]);
  const textS4 = text.slice(at[3], at[4]);
  const top = text.slice(0, at[0]);
  const expectedChecks = [
    ...(top.includes('Check before you send the CV:') ? top.split('Check before you send the CV:')[1].split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2)) : []),
    ...textS3.split('\n').filter((l) => l.endsWith(NOT_CHECKED)).map((l) => l.replace(/^- /, '')),
    ...textS4.split('\n').map((l) => l.replace(/^- /, '')).filter((l) => MARKET.test(l) || l === LOCATION_UNKNOWN),
  ];
  await qa.note(`checks the text part carries (notices + section 3 unchecked + section 4 market/location): ${JSON.stringify(expectedChecks)}`);
  const checkTitle = page.getByText('Check before you send', { exact: true });
  if (expectedChecks.length) {
    await qa.expectVisible(checkTitle, `Check before you send is populated (${expectedChecks.length} line(s))`);
    await assert(expectedChecks.every((c) => checkHtml.includes(c)), 'every one of them is in Check before you send');
    await assert(!checkHtml.includes(NOTHING_TO_CHECK), 'and the empty line is not');
    await assert(expectedChecks.every((c) => !sectionOf(3).includes(c) && !sectionOf(4).includes(c)), 'none of them is repeated in "not strong" or "be ready to explain"');
    await assert((await page.locator('img[alt="Check"]').count()) === expectedChecks.length, 'one red warning icon per line to check');
  } else {
    await qa.expectVisible(page.getByText(NOTHING_TO_CHECK), 'Check before you send is shown, empty: the gold tick and its one line');
  }
  // The HTML says what the text says.
  const strongReqs = text.slice(at[1], at[2]).split('\n').filter((l) => l.startsWith('- ') && l.includes(' — say: ')).map((l) => l.slice(2).split(' — say: ')[0]);
  await assert(strongReqs.every((r) => sectionOf(2).includes(r)), `"Where you are strong" lists the text part's ${strongReqs.length} requirement(s)`);
  if (used) {
    const explainHtml = sectionOf(4);
    await qa.expectVisible(page.getByText('Lines you chose to add to this CV:'), 'Be ready to explain: the line he added, listed apart');
    await assert(explainHtml.includes(used.claimText.replace(/\.$/, '')) && textS4.includes(used.claimText), 'the used line is in both parts');
    await assert(!explainHtml.split('Also prepare:')[1]?.includes(used.claimText.replace(/\.$/, '')), 'and never again under "Also prepare"');
  }
  const salaryLine = text.slice(at[4] + TEXT_HEADINGS[4].length).trim().split('\n')[0].replace(/^- /, '');
  await assert(sectionOf(5).includes(salaryLine), `Salary says what the text says ("${salaryLine}")`);
  await qa.scrollThrough('read the whole HTML email at desktop width');
  await page.screenshot({ path: join(qa.runDir, 'screenshots', 'mail-desktop-full.png'), fullPage: true });

  // A phone: 375px wide, nothing scrolls sideways.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(800);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await assert(overflow <= 0, `at 375px nothing scrolls sideways (overflow ${overflow}px)`);
  await qa.expectVisible(page.locator('td[bgcolor="#171c23"]').first(), 'the dark score panel at 375px');
  await qa.scrollThrough('read the whole HTML email on a phone');
  await page.screenshot({ path: join(qa.runDir, 'screenshots', 'mail-phone-full.png'), fullPage: true });

  // A dark colour scheme: the HTML declares none, so a browser renders it unchanged; Gmail's own
  // dark mode (which recolours on its side) is the owner's manual check on a real phone.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(500);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await assert(bg === 'rgb(250, 249, 247)', `under a dark colour scheme the page is unchanged (body ${bg}) — no half-applied dark styles`);
  await qa.expectVisible(page.locator('td[bgcolor="#171c23"]').first(), 'dark scheme, phone: the panel and the light cards as designed');
  await page.screenshot({ path: join(qa.runDir, 'screenshots', 'mail-phone-dark-full.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await qa.expectVisible(page.locator('h1'), 'dark scheme, desktop');
  await page.screenshot({ path: join(qa.runDir, 'screenshots', 'mail-desktop-dark-full.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
}

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
