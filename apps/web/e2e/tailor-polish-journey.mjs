// Spec #443 (#437 #438 #439 #424) — the whole-spec QA pass over the Tailor journey, driven as a
// person at 1280 and at 390, left by the #443 QA gate as a re-runnable flow.
//
//   COMPUTER (1280px), job A — pasted: the draft opens with suggestion 1 open and the rest waiting →
//   #439 the letterhead reads name / contact / headline, each centred, inside the page → #437 the
//   open number is gold on the CV and on the card, the waiting ones an outline, digits at AA, and
//   nothing else is gold-filled but the open card's own Use → #424 on The job the card says to switch
//   to Your CV (and the job's numbers carry the same colours); back on Your CV it points at the
//   struck-out line → Use for this job → #438 the changed line keeps a deep-gold ◆ named "Stretch:
//   this job only", the next suggestion opens gold, the last still waits → clicking the ◆ reopens
//   that answered suggestion, settled, taking no answer → Close → Approve → Done.
//
//   PHONE (390px), job B — pasted: same opening state → the letterhead centred inside the phone's
//   page → #424 "Read the job" brings the whole tab strip into view under the top bar → It's true →
//   #438 the ◆ is named "Added to your CV" → Enter on the ◆ reopens it.
//
//   THE FULL STATE (both widths): qa-main's fake suggests at most three, so "one open, two waiting,
//   one used" on one screen cannot come from the real stack. The last section shows it with the
//   API stubbed by the SERVER'S OWN render (renderPreviewHtml + stretchMarks + applyUsedStretches
//   from the built API, as tailor-numbers.spec.ts does), the page asking for ?open= as it does live.
//
//   pnpm --filter @jobcrush/api build
//   PORT=34181 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && rm -rf .next && API_URL=http://127.0.0.1:34181 npx next build && npx next start -p 34180
//   BASE_URL=http://127.0.0.1:34180 node apps/web/e2e/tailor-polish-journey.mjs
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const RUN = Date.now().toString(36);
const EMAIL = `tailor-polish-${RUN}@example.com`;
const API_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../api/dist');

// Colours the spec decides (DESIGN.md: gold = "on your CV right now"; Reserve Grey = "not on the page yet").
const GOLD = 'rgb(232, 163, 61)';
const GOLD_INK = 'rgb(26, 18, 6)';
const GOLD_EDGE = 'rgb(168, 118, 43)';
const RESERVE_GREY = 'rgb(151, 170, 188)';
const PAGE_MUTED = 'rgb(90, 102, 117)';
const CLEAR = 'rgba(0, 0, 0, 0)';
const K2 = 'On your CV it replaces the line struck out on the page.';
const K3 = 'It joins your skills line. Nothing leaves your CV.';
const J2 = 'Switch to Your CV to see the line it changes.';

const qa = await createSession('tailor-polish-journey', { baseURL: BASE, viewport: { width: 1280, height: 800 } });
const { page } = qa;
const check = (cond, note, target = 'body') => qa.expectText(target, cond ? '' : '\u0000-IMPOSSIBLE-', note);
const api = (path) => page.evaluate(async (p) => (await fetch(p)).json(), path);
const frame = page.frameLocator('.draft-frame');
const card = page.getByRole('region', { name: /^Suggestion \d+ of \d+$/ });
const tabs = page.getByRole('tablist', { name: 'What to show' });

/** Computed colours of a number, and its digits' contrast against what is really behind them. */
const look = (l) =>
  l.evaluate((el) => {
    const rgba = (c) => (c.match(/[\d.]+/g) ?? []).map(Number).concat([1]).slice(0, 4);
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = rgba(getComputedStyle(n).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    const ground = layers.reverse().reduce((a, [r, g, b, al]) => [r * al + a[0] * (1 - al), g * al + a[1] * (1 - al), b * al + a[2] * (1 - al)], [255, 255, 255]);
    const lum = ([r, g, b]) => [r, g, b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const s = getComputedStyle(el);
    const [a, b] = [lum(rgba(s.color)), lum(ground)].sort((x, y) => y - x);
    return { fill: s.backgroundColor, digits: s.color, border: s.borderTopColor, ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100 };
  });
const is = (got, want) => got.fill === want.fill && got.digits === want.digits && got.border === want.border;
const OPEN = { fill: GOLD, digits: GOLD_INK, border: GOLD_EDGE };

/** Every visible gold-filled thing on the screen outside the CV frame, named. */
const goldFills = () =>
  page.locator('body').evaluate((b, gold) =>
    [...b.querySelectorAll('*')]
      .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).backgroundColor === gold)
      .map((el) => (el.classList.contains('num') ? 'num' : (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40))), GOLD);
const frameGold = () =>
  frame.locator('body').evaluate((b, gold) => [...b.querySelectorAll('*')].filter((el) => getComputedStyle(el).backgroundColor === gold).map((el) => el.className), GOLD);

/** #439: the letterhead's three lines — order in the document and on the page, centring, inside the page. */
const letterhead = () =>
  frame.locator('body').evaluate((body) => {
    const doc = body.ownerDocument;
    const els = ['h1', '.contact', '.headline'].map((s) => doc.querySelector(s));
    if (els.some((e) => !e)) return { missing: els.map((e) => !!e) };
    const docOrder = !!(els[0].compareDocumentPosition(els[1]) & 4) && !!(els[1].compareDocumentPosition(els[2]) & 4);
    const boxes = els.map((e) => e.getBoundingClientRect());
    const stacked = boxes[0].bottom <= boxes[1].top + 1 && boxes[1].bottom <= boxes[2].top + 1;
    const vw = doc.documentElement.clientWidth;
    const lines = els.map((e, i) => {
      const r = doc.createRange();
      r.selectNodeContents(e);
      const rects = [...r.getClientRects()].filter((x) => x.width > 0);
      const mid = (boxes[i].left + boxes[i].right) / 2;
      return {
        align: getComputedStyle(e).textAlign,
        lines: new Set(rects.map((x) => Math.round(x.top))).size,
        offCentre: Math.max(...rects.map((x) => Math.abs((x.left + x.right) / 2 - mid))),
        inside: rects.every((x) => x.left >= -0.5 && x.right <= vw + 0.5) && e.scrollWidth <= e.clientWidth,
      };
    });
    return { docOrder, stacked, pageScroll: doc.documentElement.scrollWidth > vw, lines, text: els.map((e) => e.textContent) };
  });

async function checkLetterhead(label) {
  const m = await letterhead();
  await qa.note(`${label} letterhead measured: ${JSON.stringify(m)}`);
  await check(m.docOrder && m.stacked, `${label} #439: name, then contact, then headline — in the document and down the page`, frame.locator('h1'));
  for (const [i, part] of ['the name', 'the contact', 'the headline'].entries())
    await check(m.lines[i].align === 'center' && m.lines[i].offCentre <= 2 && m.lines[i].inside,
      `${label} #439: ${part} is centred (${m.lines[i].lines} line(s), ${m.lines[i].offCentre.toFixed(1)}px off centre) and inside the page`,
      frame.locator(['h1', '.contact', '.headline'][i]));
  await check(!m.pageScroll, `${label} #439: the CV page has no sideways scroll`, frame.locator('h1'));
}

async function paste(text) {
  return page.evaluate(async (text) => {
    const r = await fetch('/api/onboarding/paste', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    const { jobId } = await r.json();
    for (let i = 0; i < 400; i++) {
      const job = await (await fetch(`/api/jobs/${jobId}`)).json();
      if (job.status === 'completed' || job.status === 'failed') return job.progress?.paste?.result?.adId ?? null;
      await new Promise((res) => setTimeout(res, 400));
    }
    return null;
  }, text);
}
const advert = (title, company, place) =>
  [
    `${title} — ${company}`,
    `${place} · Hybrid`,
    '',
    'About the programme: four European sites move onto one finance platform.',
    '',
    'What you will do',
    '- Own the end-to-end delivery of a multi-year transformation programme.',
    '- Coordinate business and technical stakeholders and report to the steering committee monthly.',
    '- Identify, track and mitigate risks, issues and dependencies across four workstreams.',
    '- Govern three external vendor teams against one budget.',
    '',
    'What we are looking for',
    '- At least eight years managing IT projects.',
    '- Experience of Agile and Scrum delivery, and of PRINCE2 or PMP governance.',
  ].join('\n');

/** Pastes a job, opens it, presses "Write the tailored CV" and waits for the draft and its first card. */
async function tailorPasted(label, title) {
  const adId = await paste(advert(title, 'Helvara Group', 'Brussels, Belgium'));
  await check(!!adId, `${label}: the pasted job was read (${adId})`);
  await qa.goto(`/job/${encodeURIComponent(adId)}`, `${label}: the job he pasted, on its own screen`);
  await qa.click(page.getByRole('button', { name: 'Write the tailored CV' }), `${label}: Write the tailored CV`);
  await page.waitForURL('**/tailor', { timeout: 15_000 });
  await page.waitForTimeout(800);
  if ((await page.locator('.tailor .ask .q').count()) > 0) {
    await qa.click(page.locator('.tailor .opts .opt').first(), `${label}: a profile question — answered once`);
    await page.waitForTimeout(1400);
  }
  await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
  await card.waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
  await qa.expectVisible(card, `${label}: the draft is the page and suggestion 1 opened by itself`);
  const stretch = (await api('/api/onboarding/tailor/draft')).stretch;
  await qa.note(`${label}: the suggestion step found ${stretch?.suggestions?.length ?? 0} — ${JSON.stringify((stretch?.suggestions ?? []).map((s) => s.slot))}`);
  return stretch;
}

/** #437 on the CV and the card: the open number gold, the waiting ones an outline, digits at AA. */
async function openAndWaiting(label, waitingWanted) {
  const open = frame.locator('.pin.open');
  const waiting = frame.locator('.pin:not(.open):not(.used)');
  const o = await look(open);
  await check(is(o, OPEN) && o.ratio >= 4.5, `${label} #437: on the CV the open number is gold, gold-ink digits, deep-gold edge (${JSON.stringify(o)})`, open);
  const c = await look(page.locator('.stretch-card .h .num'));
  await check(is(c, OPEN) && c.ratio >= 4.5, `${label} #437: the card's own number is gold too (${JSON.stringify(c)})`, page.locator('.stretch-card .h .num'));
  const n = await waiting.count();
  await check(n === waitingWanted, `${label}: ${n} number(s) waiting on the CV (want ${waitingWanted})`, waiting.first());
  for (let i = 0; i < n; i++) {
    const w = await look(waiting.nth(i));
    await check(is(w, { fill: CLEAR, digits: PAGE_MUTED, border: PAGE_MUTED }) && w.ratio >= 4.5,
      `${label} #437: waiting number ${await waiting.nth(i).locator('.n').innerText()} is a muted outline, no fill (${JSON.stringify(w)})`, waiting.nth(i));
  }
  const gold = await goldFills();
  await check(gold.every((g) => g === 'num' || g.startsWith('Use for this job')) && gold.includes('num'),
    `${label} #437: with a card open, the only gold fills are its number and its own Use (${JSON.stringify(gold)}) — Use is the owner's open question, not a defect`, page.locator('.stretch-card'));
  const fg = await frameGold();
  await check(fg.length === 1 && fg[0] === 'pin open', `${label} #437: on the CV page the open number is the only gold fill (${JSON.stringify(fg)})`, open);
}

// ---------------------------------------------------------------------------------------------
// 0. Seed: a session with her CV read and reviewed, signed in through the real magic link.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'land on discovery');
await page.waitForTimeout(700);
await page.evaluate(async () =>
  fetch('/api/onboarding/discovery/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'IT project manager in Paris' }) }).then(() => undefined),
);
const facts = await qa.factsFromCv();
if (!(facts > 0)) throw new Error(`her CV gave the session no facts (${facts})`);
const seeded = await page.evaluate(async ({ email }) => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const link = await (await post('/api/auth/request-link', { email })).json();
  if (!link.devLink) return 'no dev link';
  await post('/api/auth/verify', { token: new URL('http://x' + link.devLink).searchParams.get('token') });
  return 'ok';
}, { email: EMAIL });
if (seeded !== 'ok') throw new Error(`could not sign in: ${seeded}`);
await qa.note(`signed in as ${EMAIL}; ${facts} facts on her record`);

// =============================================================================================
// COMPUTER (1280px) — job A
// =============================================================================================
const A = await tailorPasted('JOB A (1280)', `Senior IT Project Manager ${RUN}`);
const nA = A?.suggestions?.length ?? 0;
await checkLetterhead('JOB A (1280)');
await qa.expectVisible(frame.locator('.pin.open'), 'JOB A (1280): one card open, the others waiting — the opening state');
await openAndWaiting('JOB A (1280)', nA - 1);

// #424: on The job the card says to switch to Your CV; the job's numbers carry the same colours.
const struck = card.getByText(A.suggestions[0].lineOut ? K2 : K3, { exact: true });
const toCv = card.getByText(J2, { exact: true });
await check((await struck.isVisible()) && !(await toCv.isVisible()), 'JOB A #424: on Your CV the card points at the struck-out line', card.locator('.swap').first());
await qa.click(page.getByRole('tab', { name: 'The job' }), 'JOB A: open The job');
await qa.expectVisible(toCv, `JOB A #424: on The job the card says "${J2}"`);
await check(!(await struck.isVisible()), 'JOB A #424: and no longer the struck-out-line sentence', card);
const jobOpen = page.locator('.jobtext .pins .num:not(.idle)');
if (await jobOpen.count()) {
  const j = await look(jobOpen.first());
  await check(is(j, OPEN) && j.ratio >= 4.5, `JOB A #437: on The job the open number is gold (${JSON.stringify(j)})`, jobOpen.first());
} else await qa.note('JOB A: the open suggestion has no line on The job, so it carries no number there');
const jobIdle = page.locator('.jobtext .pins .num.idle');
for (let i = 0; i < (await jobIdle.count()); i++) {
  const j = await look(jobIdle.nth(i));
  await check(is(j, { fill: CLEAR, digits: RESERVE_GREY, border: RESERVE_GREY }) && j.ratio >= 4.5,
    `JOB A #437: on The job waiting number ${await jobIdle.nth(i).innerText()} is a Reserve Grey outline (${JSON.stringify(j)})`, jobIdle.nth(i));
}
for (const g of await goldFills()) await check(g === 'num' || g.startsWith('Use for this job'), `JOB A #437 (The job): gold fill on "${g}" is the open number or its Use`, card);
await qa.click(page.getByRole('tab', { name: 'Your CV' }), 'JOB A: back to Your CV');
await check((await struck.isVisible()) && !(await toCv.isVisible()), 'JOB A #424: back on Your CV the card points at the struck-out line again', card.locator('.swap').first());

// #438: Use for this job → the line keeps a ◆.
const s1 = A.suggestions[0];
await qa.click(card.getByRole('button', { name: /^Use for this job/ }), 'JOB A: Use for this job (suggestion 1)');
await frame.locator('.pin.used').first().waitFor({ timeout: 15_000 }).catch(() => {});
await page.waitForTimeout(1600);
const diamond = frame.getByRole('button', { name: 'Stretch: this job only, suggestion 1' });
await qa.expectVisible(diamond, 'JOB A #438: the used line keeps a ◆ named "Stretch: this job only, suggestion 1"');
const d = await diamond.evaluate((el) => ({ text: el.textContent, title: el.title, color: getComputedStyle(el).color, fill: getComputedStyle(el).backgroundColor, size: getComputedStyle(el).fontSize, line: el.parentElement.textContent }));
await check(d.text === '◆' && d.title === 'Stretch: this job only' && d.color === GOLD_EDGE && d.fill === CLEAR && d.line.includes(s1.claimText),
  `JOB A #438: deep gold, no fill, tooltip "Stretch: this job only", on the line he used (${JSON.stringify({ ...d, line: d.line.slice(0, 60) })})`, diamond);
await check((await frame.locator('.pin.used').count()) === 1, 'JOB A #438: no other line carries a ◆', frame.locator('.pin.used').first());
if (nA >= 3) {
  await card.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await qa.expectVisible(diamond, 'JOB A (1280): one used (◆), the next one open, the last waiting');
  await openAndWaiting('JOB A (1280) after Use', nA - 2);
}
// The ◆ reopens its suggestion, settled, and an answered card takes no answer.
await qa.click(diamond, 'JOB A #438: click the ◆');
const reopened = page.getByRole('region', { name: `Suggestion 1 of ${nA}` });
await qa.expectVisible(reopened, 'JOB A #438: the ◆ reopened suggestion 1');
await qa.expectText(reopened, 'Used for this job', 'JOB A #438: it says what the answer was, with its Undo');
const settled = await look(reopened.locator('.h .num'));
await check(settled.fill === CLEAR && settled.digits !== GOLD_INK, `JOB A #437: an answered card's number is settled, not gold (${JSON.stringify(settled)})`, reopened.locator('.h .num'));
const sent = [];
page.on('request', (r) => r.url().includes('/suggestions/') && sent.push(r.url()));
await page.keyboard.press('u');
await page.keyboard.press('n');
await page.waitForTimeout(800);
await check(sent.length === 0 && (await reopened.isVisible()), 'JOB A #438: U and N send nothing on an answered card', reopened);
await qa.click(reopened.getByRole('button', { name: 'Close', exact: true }), 'JOB A: Close');
await check((await card.count()) === 0, 'JOB A: no card open after Close');
await check((await frame.locator('.pin.used').count()) === 1, 'JOB A #438: with no card open the ◆ stays', frame.locator('.pin.used'));

await qa.click(page.getByRole('button', { name: 'Approve and email me this CV' }), 'JOB A: Approve and email me this CV');
await page.getByText('Done — your CV is made and the email is on its way.').waitFor({ timeout: 90_000 }).catch(() => {});
await qa.expectText('.draft-send', 'Done — your CV is made and the email is on its way.', 'JOB A: Done');

// =============================================================================================
// PHONE (390px) — job B
// =============================================================================================
await page.setViewportSize({ width: 390, height: 844 });
await qa.note('— the phone: 390 × 844 —');
const B = await tailorPasted('JOB B (390)', `IT Programme Manager ${RUN}`);
const nB = B?.suggestions?.length ?? 0;
await checkLetterhead('JOB B (390)');
await qa.expectVisible(frame.locator('.pin.open'), 'JOB B (390): one card open, the others waiting — the opening state');
await openAndWaiting('JOB B (390)', nB - 1);

// #424: "Read the job" lines up the whole strip under the bar.
await qa.note('JOB B #424: press "Read the job" (plain click, so the landing is what is measured)');
await page.getByRole('button', { name: 'Read the job' }).click({ timeout: 8000 });
await page.waitForTimeout(1200);
const bar = await page.locator('.tailor .dbar').boundingBox();
const strip = await tabs.boundingBox();
await check(strip.y >= bar.y + bar.height - 0.5, `JOB B #424: the tab strip's top (${strip.y.toFixed(1)}) is at or under the bar's bottom (${(bar.y + bar.height).toFixed(1)})`, tabs);
await check(await page.getByRole('tab', { name: 'The job', selected: true }).isVisible(), 'JOB B #424: The job is showing', tabs);
await check(!(await card.getByText(J2, { exact: true }).isVisible()), 'JOB B #424: on a phone the card keeps its own words (the switch line is for a computer)', card);
await qa.click(page.getByRole('tab', { name: 'Your CV' }), 'JOB B: back to Your CV');

// #438: It's true → the ◆ says "Added to your CV"; Enter on it reopens the suggestion.
const trueBtn = card.getByRole('button', { name: /^It's true/ });
await qa.click(trueBtn, "JOB B: It's true (suggestion 1)");
await frame.locator('.pin.used').first().waitFor({ timeout: 15_000 }).catch(() => {});
await page.waitForTimeout(1600);
const added = frame.getByRole('button', { name: 'Added to your CV, suggestion 1' });
await qa.expectVisible(added, 'JOB B #438: the line he kept carries a ◆ named "Added to your CV, suggestion 1"');
const box = await added.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, vw: el.ownerDocument.documentElement.clientWidth, title: el.title, color: getComputedStyle(el).color };
});
await check(box.left >= 0 && box.right <= box.vw && box.title === 'Added to your CV' && box.color === GOLD_EDGE,
  `JOB B #438: inside the phone's page, deep gold, tooltip "Added to your CV" (${JSON.stringify(box)})`, added);
if (nB >= 3) {
  await card.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await qa.expectVisible(added, 'JOB B (390): one used (◆), the next one open, the last waiting');
  await openAndWaiting('JOB B (390) after It\'s true', nB - 2);
}
const undoToast = page.getByRole('button', { name: 'Undo' });
if (await undoToast.first().isVisible()) await page.waitForTimeout(1200);
await added.focus();
await qa.note('JOB B #438: Enter on the focused ◆');
await page.keyboard.press('Enter');
const reopenedB = page.getByRole('region', { name: `Suggestion 1 of ${nB}` });
await qa.expectVisible(reopenedB, 'JOB B #438: Enter on the ◆ reopened suggestion 1');
await qa.expectText(reopenedB, 'Kept on your CV for every job', 'JOB B #438: it says what the answer was');
await qa.click(reopenedB.getByRole('button', { name: 'Close', exact: true }), 'JOB B: Close');

// =============================================================================================
// THE FULL STATE — one open, two waiting, one used — at both widths, from the server's own render.
// =============================================================================================
const { renderPreviewHtml } = await import(pathToFileURL(resolve(API_DIST, 'preview.js')).href);
const { stretchMarks, applyUsedStretches } = await import(pathToFileURL(resolve(API_DIST, 'stretchSuggestions.js')).href);
const SLOTS = [{ kind: 'bullet', role: 0, bullet: 0 }, { kind: 'summary' }, { kind: 'bullet', role: 0, bullet: 1 }, { kind: 'skill', group: 0 }];
const SUGG = SLOTS.map((slot, i) => ({
  schemaVersion: '2', id: `stretch-ad-x-r${i + 1}`, adId: 'ad-x', requirementId: `r${i + 1}`, why: 'The job asks for this.',
  claimText: ['Led the checkout replatforming end to end, two months early', 'Delivery lead for regulated finance programmes.', 'Governed three vendor teams against one budget', 'Vendor governance'][i],
  intendedClass: 'Partially-Supported', interviewNarrative: 'What to say if asked.', slot, lineOut: slot.kind === 'skill' ? null : 'Line out',
  derivedFrom: null, createdAt: '2026-10-26T09:00:00.000Z', state: i === 0 ? 'approved' : 'pending', decidedAt: i === 0 ? '2026-10-26T09:05:00.000Z' : null, scope: i === 0 ? 'this-job' : null,
}));
const CHECKPOINT = { status: 'ran', suggestions: SUGG };
const DRAFT = {
  name: 'Maria Kowalski', headline: 'Senior IT Project Manager',
  contact: 'Lyon, France · +33 6 00 00 00 00 · +33 4 00 00 00 00 · maria.kowalski@example.com · linkedin.com/in/maria-kowalski-delivery-lead',
  summary: 'Project manager with delivery accountability across vendors.',
  experience: [{ role: 'IT Project Manager', employer: 'Nordic Retail Group', location: 'Warsaw', dates: '2021 - Present', unprinted: [],
    bullets: [{ text: 'Led the checkout replatforming', outcome: '', claimIds: ['a'] }, { text: 'Managed a budget of EUR 1.2M across 3 vendor teams', outcome: '', claimIds: ['b'] }, { text: 'Reported weekly to the steering committee', outcome: '', claimIds: ['c'] }] }],
  skills: [{ label: 'Delivery', items: ['Jira', 'MS Project'] }], certifications: [], education: [], additional: [],
};
const CARD = { schemaVersion: '1', adId: 'ad-x', title: 'Senior IT Project Manager', company: 'Helvara Group', place: 'Brussels', salary: null, pattern: null, scored: 'judged', matchPct: 61,
  breakdown: { essential: { met: 0, total: 1 }, desirable: { met: 0, total: 1 } }, bubble: { hit: '', open: '' }, fit: [], dontYet: [], askedClosed: [], adExcerpt: 'About the role\n* Own vendor delivery' };
const STATE = { card: CARD, questions: [], requirements: SUGG.map((s, i) => ({ id: s.requirementId, text: `Requirement ${i + 1}`, state: 'gap' })), factCount: 24 };
const view = (open) => ({
  html: renderPreviewHtml(applyUsedStretches(DRAFT, CHECKPOINT), { title: CARD.title, company: CARD.company }, { banner: false, marks: stretchMarks(CHECKPOINT, open ?? undefined) }),
  disclosure: [], conservationNotices: [], draftedAt: '2026-10-26T08:00:00.000Z', stretch: CHECKPOINT,
});
await page.route('**/api/sessions/me', (r) => r.fulfill({ json: { ok: true } }));
await page.route('**/api/onboarding/tailor', (r) => r.fulfill({ json: STATE }));
await page.route('**/api/onboarding/tailor/draft**', (r) =>
  r.request().method() === 'POST' ? r.fulfill({ json: { ready: true } }) : r.fulfill({ json: view(new URL(r.request().url()).searchParams.get('open')) }));
for (const [label, width, height] of [['FULL STATE (1280)', 1280, 800], ['FULL STATE (390)', 390, 844]]) {
  await page.setViewportSize({ width, height });
  await qa.goto('/tailor', `${label}: the API answered by the server's own render — suggestion 1 used, 2 open, 3 and 4 waiting`);
  await card.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  await qa.expectVisible(frame.locator('.pin.used'), `${label}: one used (◆), one open (gold), two waiting (outline), the letterhead centred`);
  await checkLetterhead(label);
  await openAndWaiting(label, 2);
  await check((await frame.locator('.pin.used').count()) === 1, `${label}: exactly one ◆`, frame.locator('.pin.used'));
  await qa.expectVisible(frame.locator('.pin:not(.open):not(.used)').last(), `${label}: the last waiting number, in its margin column`);
}

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
