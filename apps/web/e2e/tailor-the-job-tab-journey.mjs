// #423 — the Tailor screen in the #408 prototype's layout, driven as a person against the real stack
// (qa-main's fake model; no ANTHROPIC_API_KEY). Left by the #423 QA gate as a re-runnable flow.
//
//   COMPUTER (1280px), job A — found on the deck: the deck card keeps its breakdown and "Read the ad
//   in full" → /tailor: only "Your CV | The job" between the top bar and the page, the tagline kept
//   → The job: the job's text line for line, each pending suggestion's numeral on its line, the open
//   one lit → a numeral opens its suggestion → Your CV: the preview of that suggestion in place →
//   keyboard: Tab reaches the tabs, they are announced, arrows switch them; E / Esc / J / N / U /
//   Undo / T on Your CV, each read back off the server → an answered suggestion loses its numeral.
//
//   PHONE (390px), job B — pasted, with a long title: the job's own screen keeps its breakdown and
//   "Read the ad in full" → /tailor: the bar one line (title cut with an ellipsis, no tagline), only
//   the tabs above the page → "See where the job asks this" opens The job scrolled to the lit line
//   → numerals on their lines at this width → Your CV → "Read the job" opens The job at the top,
//   where the full title reads.
//
//   COMPUTER, job C — pasted, its first requirement with no words to match a line: that suggestion
//   offers no "See where the job asks this", carries no numeral, lights nothing, and still answers.
//
//   pnpm --filter @jobcrush/api build
//   PORT=34431 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && rm -rf .next && API_URL=http://127.0.0.1:34431 npx next build && npx next start -p 34430
//   BASE_URL=http://127.0.0.1:34430 node apps/web/e2e/tailor-the-job-tab-journey.mjs
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const RUN = Date.now().toString(36);
const EMAIL = `job-tab-${RUN}@example.com`;
const SEE = 'See where the job asks this';

const qa = await createSession('tailor-the-job-tab-journey', { baseURL: BASE, viewport: { width: 1280, height: 800 } });
const { page } = qa;
/** A computed check, recorded with the element it is about outlined in the screenshot. */
const check = (cond, note, target = 'body') => qa.expectText(target, cond ? '' : '\u0000-IMPOSSIBLE-', note);
const api = (path) => page.evaluate(async (p) => (await fetch(p)).json(), path);
const box = (l) => l.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height }; });
// The screen root is fixed and `.dgrid` (under the bar) is what scrolls, so "on the screen" means
// inside that scroller's visible box, and a reading pass scrolls it — the window never moves here.
const dgrid = page.locator('.tailor .dgrid');
const onScreen = (l) => l.evaluate((el) => {
  const r = el.getBoundingClientRect();
  const v = document.querySelector('.tailor .dgrid').getBoundingClientRect();
  return r.height > 0 && r.top >= v.top - 1 && r.bottom <= v.bottom + 1;
});
async function readThrough(note) {
  await qa.note(note);
  await dgrid.evaluate(async (el) => {
    for (let y = 0; y < el.scrollHeight - el.clientHeight; y += 320) {
      el.scrollTo({ top: y });
      await new Promise((r) => setTimeout(r, 350));
    }
    el.scrollTo({ top: 0 });
  });
}
/** A press whose landing is the point: the driver re-scrolls to what it clicked for its screenshot,
 *  which would undo a jump, so this clicks plainly and the next check shows where it landed. */
async function pressAndLand(target, note) {
  await qa.note(note);
  await target.click({ timeout: 8000 });
  await page.waitForTimeout(1200);
}
const tabs = page.getByRole('tablist', { name: 'What to show' });
const cvTab = page.getByRole('tab', { name: 'Your CV' });
const jobTab = page.getByRole('tab', { name: 'The job' });
const jobPanel = page.getByRole('tabpanel', { name: 'The job' });
const frame = page.locator('.draft-frame');
const stretchOf = async () => (await api('/api/onboarding/tailor/draft')).stretch;

/** The paper column's shown blocks, top to bottom. */
const paperOrder = () =>
  page.locator('.paper-col').evaluate((col) =>
    [...col.children].filter((el) => !el.hidden).map((el) =>
      el.matches('[role=tablist]') ? 'tabs' : el.querySelector('.draft-frame') ? 'draft' : el.className || el.tagName));

/** AC1: the bar, then the tabs, then the CV page — in the document and on the screen. */
async function nothingBetweenBarAndPage(label) {
  await dgrid.evaluate((el) => el.scrollTo({ top: 0 })); // as he lands on it: the top of the screen
  await page.waitForTimeout(400);
  const order = await paperOrder();
  await check(order.join(' → ') === 'tabs → draft', `${label} AC1: under the top bar only the tabs, then the CV page (${order.join(' → ')})`, '.paper-col');
  const bar = await box(page.locator('.tailor .dbar'));
  const t = await box(tabs);
  const f = await box(frame);
  const gapBarTabs = Math.round(t.top - bar.bottom);
  const gapTabsPage = Math.round(f.top - t.bottom);
  await check(gapBarTabs >= 0 && gapBarTabs <= 24 && gapTabsPage >= 0 && gapTabsPage <= 12,
    `${label} AC1: on the screen the tabs sit ${gapBarTabs}px under the bar and the page ${gapTabsPage}px under the tabs`, tabs);
  const retired = await page.locator('.tailor .breakdown, .tailor details.ad').count();
  const text = await page.locator('.tailor').innerText();
  await check(retired === 0 && !text.includes('Read the ad in full'), `${label} AC1: no Match breakdown and no "Read the ad in full" on the Tailor screen`, '.tailor .dbar');
}

/** AC3: on The job, a numeral on the line of each pending suggestion that has one; the open one lit. */
async function numeralsOnTheirLines(label, st, stretch, openId) {
  const lineOf = (s) => st.requirements.find((r) => r.id === s.requirementId)?.line;
  const pending = stretch.suggestions.map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => s.state === 'pending');
  const marked = pending.filter(({ s }) => lineOf(s) !== undefined);
  const lines = jobPanel.locator('.jl');
  await check((await lines.count()) === st.card.adExcerpt.split('\n').length,
    `${label} AC2: The job shows the job's text line for line (${await lines.count()} lines)`, jobPanel);
  await check((await jobPanel.locator('.pins .num').count()) === marked.length,
    `${label} AC3: ${marked.length} numeral(s) for ${pending.length} pending suggestion(s) with a job line`, jobPanel);
  for (const { s, n } of marked) {
    const pin = lines.nth(lineOf(s)).getByRole('button', { name: `Suggestion ${n}`, exact: true });
    await qa.expectVisible(pin, `${label} AC3: numeral ${n} sits on job line ${lineOf(s)} ("${(await lines.nth(lineOf(s)).innerText()).replace(/^\d+\s*/, '').slice(0, 60)}")`);
  }
  const open = pending.find(({ s }) => s.id === openId);
  const lit = jobPanel.locator('.jl.hl');
  if (open && lineOf(open.s) !== undefined) {
    await check((await lit.count()) === 1 && (await lines.nth(lineOf(open.s)).getAttribute('class')).includes('hl'),
      `${label} AC3: the open suggestion's line (${open.n}) is the one lit`, lines.nth(lineOf(open.s)));
  } else {
    await check((await lit.count()) === 0, `${label} AC3: the open suggestion has no job line, so nothing is lit`, jobPanel);
  }
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

/** Lands on /tailor and waits for the draft and its first suggestion card. */
async function onTailor(label) {
  await page.waitForURL('**/tailor', { timeout: 15_000 });
  await page.waitForTimeout(800);
  if ((await page.locator('.tailor .ask .q').count()) > 0) {
    await qa.click(page.locator('.tailor .opts .opt').first(), `${label}: a profile question — answered once`);
    await page.waitForTimeout(1400);
  }
  await frame.waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
  await qa.expectVisible(frame, `${label}: the draft is the page`);
  await page.locator('.stretch-card').waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
  await qa.expectVisible('.stretch-card', `${label}: the first suggestion opened by itself`);
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

// =============================================================================================
// COMPUTER — job A, found on the deck
// =============================================================================================
await qa.goto('/deck', 'JOB A: the deck');
const seeThem = page.getByRole('button', { name: 'See them' });
if (await seeThem.count()) await qa.click(seeThem, 'See them');
await qa.expectVisible(page.locator('.jobcard .breakdown').first(), 'the deck card keeps its Match breakdown (out of #423 scope)');
await qa.expectVisible(page.locator('.jobcard details.ad summary').first(), 'the deck card keeps "Read the ad in full"');
await qa.click(page.getByRole('button', { name: 'I want this one, tailor this job' }), 'JOB A: I want this one');
await onTailor('JOB A (computer)');

const stA = await api('/api/onboarding/tailor');
await qa.note(`job A ${stA.card.adId}: lines per requirement ${JSON.stringify(stA.requirements.map((r) => [r.id, r.line ?? null]))}`);
await nothingBetweenBarAndPage('JOB A (1280)');
await qa.expectVisible(page.locator('.tailor .dbar .tagline'), 'JOB A (1280): the computer bar keeps its tagline');
await check(!(await page.getByRole('button', { name: 'Read the job' }).isVisible()), 'JOB A (1280): no "Read the job" beside the page — the tabs are the way to the job', tabs);
await qa.expectVisible(cvTab, 'JOB A: "Your CV" is the tab shown');
await check((await cvTab.getAttribute('aria-selected')) === 'true', 'JOB A: "Your CV" starts selected', cvTab);
await readThrough('JOB A: read the draft page top to bottom');

let stretchA = await stretchOf();
await check(stretchA?.status === 'ran' && stretchA.suggestions.length >= 2, `JOB A: the stretch step ran (${stretchA?.suggestions?.length} suggestions)`, '.stretch-card');
const [a1, a2] = stretchA.suggestions;
const lineOfA = (s) => stA.requirements.find((r) => r.id === s.requirementId)?.line;

// AC2 + AC3: The job — the job's text with its breaks; numerals; the open one lit.
await qa.click(jobTab, 'JOB A: open "The job"');
await qa.expectVisible(jobPanel, 'JOB A AC2: The job shows in place of the CV');
await check(!(await frame.isVisible()), 'JOB A AC2: the CV page is not beside it — The job replaces it', jobPanel);
const tops = await jobPanel.locator('.jl').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
await check(tops.every((t, i) => i === 0 || t > tops[i - 1]), `JOB A AC2: each of the ${tops.length} lines is its own row, top to bottom`, jobPanel);
await numeralsOnTheirLines('JOB A', stA, stretchA, a1.id);
await readThrough('JOB A: read the job in full');

// A numeral opens its suggestion, and the light moves with it.
if (lineOfA(a2) !== undefined) {
  await qa.click(jobPanel.getByRole('button', { name: 'Suggestion 2', exact: true }), 'JOB A: press numeral 2 on The job');
  await qa.expectVisible(page.getByRole('region', { name: `Suggestion 2 of ${stretchA.suggestions.length}` }), 'JOB A: suggestion 2 is the open card');
  await qa.expectVisible(jobPanel.locator('.jl').nth(lineOfA(a2)).and(page.locator('.jl.hl')), "JOB A AC3: suggestion 2's line is now the lit one");
} else {
  await qa.note('JOB A: suggestion 2 has no job line on this job — pressing a numeral is covered by stretch.spec.ts');
  await page.keyboard.press('j');
}

// AC2: Your CV brings the page back, previewing the open suggestion in place.
await qa.click(cvTab, 'JOB A: back to "Your CV"');
await qa.expectVisible(frame, 'JOB A AC2: Your CV brings the page back');
await page.waitForTimeout(800);
const srcA = await frame.getAttribute('srcdoc');
const insA = srcA.match(/<ins>([^<]*)<\/ins>/)?.[1] ?? '';
await check(insA.length > 0 && a2.claimText.includes(insA.replace(/&amp;/g, '&').slice(0, 30)),
  `JOB A AC2: the open suggestion's preview is still in place on the page ("${insA.slice(0, 60)}")`, frame);

// AC6: keyboard — the tabs reached by Tab and announced, arrows switch them.
await page.locator('.tailor .dbar h1').focus();
let reached = false;
for (let i = 0; i < 10 && !reached; i++) {
  await page.keyboard.press('Tab');
  reached = await page.evaluate(() => document.activeElement?.getAttribute('role') === 'tab');
}
await page.waitForTimeout(600);
await check(reached && (await cvTab.evaluate((el) => el === document.activeElement)), 'JOB A AC6: Tab from the title reaches the "Your CV" tab', cvTab);
const aria = await tabs.ariaSnapshot();
await qa.note(`JOB A AC6: what a screen reader is told — ${aria.replace(/\n/g, ' ')}`);
await check(/tablist "What to show"/.test(aria) && /tab "Your CV" \[selected\]/.test(aria) && /tab "The job"/.test(aria), 'JOB A AC6: announced as a tab list, "Your CV" selected', tabs);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(800);
await check((await jobTab.evaluate((el) => el === document.activeElement)) && (await jobTab.getAttribute('aria-selected')) === 'true' && (await jobPanel.isVisible()),
  'JOB A AC6: → moves to "The job" and shows it', jobTab);
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(800);
await check((await cvTab.evaluate((el) => el === document.activeElement)) && (await frame.isVisible()), 'JOB A AC6: ← comes back to "Your CV"', cvTab);

// AC6: the keys on Your CV. K back to suggestion 1, E edits the line in place, Esc ends the edit,
// Esc closes the card, J opens it again, N answers No, U answers Use, Undo, then T.
const regionN = (n) => page.getByRole('region', { name: `Suggestion ${n} of ${stretchA.suggestions.length}` });
await page.keyboard.press('k');
await page.waitForTimeout(900);
await qa.expectVisible(regionN(1), 'JOB A AC6: K opens suggestion 1');
await page.keyboard.press('e');
const ins = page.frameLocator('.draft-frame').locator('ins');
await page.waitForTimeout(900);
await check((await ins.getAttribute('contenteditable')) === 'true', 'JOB A AC6: E makes the line editable where it stands on the page', frame);
await page.keyboard.press('Escape');
await page.waitForTimeout(900);
await check((await ins.getAttribute('contenteditable').catch(() => null)) !== 'true', 'JOB A AC6: Esc ends the edit', frame);
await page.keyboard.press('Escape');
await page.waitForTimeout(900);
await check((await page.locator('.stretch-card').count()) === 0, 'JOB A AC6: Esc closes the card', '.tailor .rail');
await page.keyboard.press('j');
await page.waitForTimeout(900);
await qa.expectVisible(regionN(1), 'JOB A AC6: J opens suggestion 1 again');
await page.keyboard.press('n');
await page.waitForTimeout(1500);
stretchA = await stretchOf();
await check(stretchA.suggestions[0].state === 'declined', `JOB A AC6: N answered suggestion 1 No (server: ${stretchA.suggestions[0].state})`, '.tailor .rail');

// An answered suggestion is no longer pending, so its numeral goes.
await qa.click(jobTab, 'JOB A: The job again, after answering suggestion 1');
await check((await jobPanel.getByRole('button', { name: 'Suggestion 1', exact: true }).count()) === 0, 'JOB A AC3: answered, suggestion 1 carries no numeral any more', jobPanel);
await numeralsOnTheirLines('JOB A (after N)', stA, stretchA, a2.id);
await qa.click(cvTab, 'JOB A: back to "Your CV"');

await qa.expectVisible(regionN(2), 'JOB A: suggestion 2 is open');
await page.locator('.tailor .dbar h1').focus();
await page.keyboard.press('u');
await page.waitForTimeout(3000);
stretchA = await stretchOf();
await check(stretchA.suggestions[1].state === 'approved' && stretchA.suggestions[1].scope === 'this-job', `JOB A AC6: U answered suggestion 2 Use (server: ${stretchA.suggestions[1].state}, ${stretchA.suggestions[1].scope})`, '.tailor .dbar .score');
const summary = page.getByRole('region', { name: 'Ready to send' });
await qa.click(summary.getByRole('button', { name: 'Undo' }).last(), 'JOB A: Undo suggestion 2 from "Ready to send"');
await page.waitForTimeout(2000);
await qa.expectVisible(regionN(2), 'JOB A: suggestion 2 is pending again');
await page.locator('.tailor .dbar h1').focus();
await page.keyboard.press('t');
await page.waitForTimeout(3000);
stretchA = await stretchOf();
await check(stretchA.suggestions[1].state === 'approved' && stretchA.suggestions[1].scope === 'every-job', `JOB A AC6: T answered suggestion 2 "It's true" (server: ${stretchA.suggestions[1].state}, ${stretchA.suggestions[1].scope})`, '.tailor .rail');

// =============================================================================================
// PHONE (390px) — job B, pasted, with a long title
// =============================================================================================
await page.setViewportSize({ width: 390, height: 844 });
await qa.note('— the phone: 390 × 844 —');
const TITLE_B = `Senior IT Project Manager, Digital Transformation and Core Banking Programmes, Asia-Pacific ${RUN}`;
// qa-main's canned header reader: line 1 is "<title> — <company>", line 2 the place.
const ADVERT_B = [
  `${TITLE_B} — Helvara Group`,
  'Brussels, Belgium · Hybrid',
  '',
  ...Array.from({ length: 12 }, (_, i) => `About the programme, part ${i + 1}: four European sites move onto one finance platform.`),
  '',
  'What you will do',
  '- Own the end-to-end delivery of a multi-year transformation programme.',
  '- Coordinate business and technical stakeholders and report to the steering committee monthly.',
  '- Identify, track and mitigate risks, issues and dependencies across four workstreams.',
  '',
  'What we are looking for',
  '- At least eight years managing IT projects.',
  '- Experience of Agile and Scrum delivery, and of PRINCE2 or PMP governance.',
].join('\n');
const adB = await paste(ADVERT_B);
await check(!!adB, `JOB B pasted and read (${adB})`);
await qa.goto(`/job/${encodeURIComponent(adB)}`, 'JOB B (phone): the job he pasted, on its own screen');
await qa.expectVisible(page.locator('.breakdown').first(), "JOB B: the job's own screen keeps its Match breakdown");
await qa.expectVisible(page.getByText('Read the ad in full').first(), "JOB B: the job's own screen keeps \"Read the ad in full\"");
await qa.click(page.getByRole('button', { name: 'Write the tailored CV' }), 'Write the tailored CV');
await onTailor('JOB B (phone)');
const stB = await api('/api/onboarding/tailor');
await qa.note(`job B ${stB.card.adId}: lines per requirement ${JSON.stringify(stB.requirements.map((r) => [r.id, r.line ?? null]))}`);

// AC5: the bar is one line — the long title cut with an ellipsis, no tagline.
const h1 = page.locator('.tailor .dbar h1');
const fit = await h1.evaluate((el) => {
  const s = getComputedStyle(el);
  return { h: el.getBoundingClientRect().height, lh: parseFloat(s.lineHeight), cut: el.scrollWidth > el.clientWidth, overflow: s.textOverflow };
});
const barB = await box(page.locator('.tailor .dbar'));
await check(fit.h <= fit.lh + 1 && fit.cut && fit.overflow === 'ellipsis',
  `JOB B AC5: the title is one line (${Math.round(fit.h)}px, line ${fit.lh}px), cut with an ellipsis`, h1);
await check(!(await page.locator('.tailor .dbar .tagline').isVisible()) && barB.h <= 64, `JOB B AC5: no tagline; the bar is ${Math.round(barB.h)}px tall (was ~230px, #422)`, '.tailor .dbar');
await nothingBetweenBarAndPage('JOB B (390)');

// AC5: "See where the job asks this" opens The job scrolled to the lit line.
const stretchB = await stretchOf();
const cardB = page.locator('.stretch-card');
await pressAndLand(cardB.getByRole('button', { name: SEE }), 'JOB B AC5: press "See where the job asks this" on the card');
const litB = jobPanel.locator('.jl.hl');
// Where it landed, measured before any check below scrolls to its own element for the screenshot.
const landed = {
  selected: (await jobTab.getAttribute('aria-selected')) === 'true',
  lit: await litB.count(),
  litOnScreen: await onScreen(litB),
  litFocused: await litB.evaluate((el) => el === document.activeElement),
  tabsOnScreen: await onScreen(tabs),
  litText: await litB.innerText(),
};
await qa.note(`JOB B AC5: where "See where the job asks this" landed — ${JSON.stringify(landed)}`);
await check(landed.selected, 'JOB B AC5: The job is the tab shown', litB);
await check(landed.lit === 1 && landed.litOnScreen, 'JOB B AC5: the lit line is on the screen', litB);
await check(landed.litFocused, 'JOB B AC5: and it holds the focus', litB);
await check(!landed.tabsOnScreen, 'JOB B AC5: the screen really scrolled down to it (the tabs were off the top)', litB);
const reqB1 = stB.requirements.find((r) => r.id === stretchB.suggestions[0].requirementId);
await check(landed.litText.includes(reqB1.text), `JOB B AC5: the lit line is the one suggestion 1 answers ("${reqB1.text.slice(0, 50)}")`, litB);
await numeralsOnTheirLines('JOB B (390)', stB, stretchB, stretchB.suggestions[0].id);
await readThrough('JOB B: read the job on the phone');

await qa.click(cvTab, 'JOB B: back to "Your CV"');
await qa.expectVisible(frame, 'JOB B: the CV page is back');
// AC5: "Read the job", under the CV, opens The job at the top.
const readJob = page.getByRole('button', { name: 'Read the job' });
await qa.expectVisible(readJob, 'JOB B: "Read the job" sits in the rail, under the CV');
await pressAndLand(readJob, 'JOB B AC5: press "Read the job"');
const top = {
  selected: (await jobTab.getAttribute('aria-selected')) === 'true',
  focused: await jobTab.evaluate((el) => el === document.activeElement),
  tabOnScreen: await onScreen(jobTab),
  titleOnScreen: await onScreen(page.locator('.jobtext .jt-title')),
  // How far the tab strip's own top edge sits under the bar (negative: clipped by that many px).
  stripGap: Math.round((await box(tabs)).top - (await box(page.locator('.tailor .dbar'))).bottom),
};
await qa.note(`JOB B AC5: where "Read the job" landed — ${JSON.stringify(top)}`);
await check(top.selected && top.focused, 'JOB B AC5: The job is shown, its tab focused', jobTab);
await check(top.tabOnScreen && top.titleOnScreen, 'JOB B AC5: at the top of the job — the tab and the title in sight under the bar', '.jobtext .jt-title');
await check((await page.locator('.jobtext .jt-title').innerText()) === TITLE_B, 'JOB B: the title the bar cuts short reads here in full', '.jobtext .jt-title');
await qa.click(cvTab, 'JOB B: back to "Your CV"');

// =============================================================================================
// COMPUTER — job C: a requirement with no words to find a line by
// =============================================================================================
await page.setViewportSize({ width: 1280, height: 800 });
await qa.note('— back at the computer: 1280 × 800 —');
const ADVERT_C = [
  `IT Delivery Lead — Norvik Systems ${RUN}`,
  'Ghent, Belgium',
  '',
  'Must have',
  '- ★ ★ ★',
  '- Run quarterly planning for six product teams.',
  '- Negotiate tenders and statements of work with vendors.',
].join('\n');
const adC = await paste(ADVERT_C);
await check(!!adC, `JOB C pasted and read (${adC})`);
await qa.goto(`/job/${encodeURIComponent(adC)}`, "JOB C: the job's own screen");
await qa.click(page.getByRole('button', { name: 'Write the tailored CV' }), 'Write the tailored CV');
await onTailor('JOB C (computer)');
const stC = await api('/api/onboarding/tailor');
const stretchC = await stretchOf();
await qa.note(`job C: lines ${JSON.stringify(stC.requirements.map((r) => [r.id, r.text, r.line ?? null]))} · suggestions for ${JSON.stringify(stretchC.suggestions.map((s) => s.requirementId))}`);
const unlined = stretchC.suggestions.map((s, i) => ({ s, n: i + 1 })).find(({ s }) => stC.requirements.find((r) => r.id === s.requirementId)?.line === undefined);
if (!unlined) {
  // The fake model aimed no suggestion at the line-less requirement; still, its presence must break
  // nothing on The job. (A pending suggestion with no line: stretch.spec.ts.)
  await qa.note('JOB C: no suggestion answers the line-less requirement on this run — checking The job still renders around it');
  await check(stC.requirements.some((r) => r.line === undefined), 'JOB C AC4: the server gives the line-less requirement no line', '.tailor .dbar');
  await qa.click(jobTab, 'JOB C: open "The job"');
  await numeralsOnTheirLines('JOB C', stC, stretchC, stretchC.suggestions[0].id);
  const starLine = jobPanel.locator('.jl').filter({ hasText: '★ ★ ★' });
  await check((await starLine.locator('.pins').count()) === 0, 'JOB C AC4: the line-less requirement\'s line carries no numeral', starLine);
  await qa.click(cvTab, 'JOB C: back to "Your CV"');
} else {
  const total = stretchC.suggestions.length;
  if (unlined.n !== 1) await page.keyboard.press('j');
  const card = page.getByRole('region', { name: `Suggestion ${unlined.n} of ${total}` });
  await qa.expectVisible(card, `JOB C AC4: suggestion ${unlined.n} answers a requirement with no job line`);
  await check((await card.getByRole('button', { name: SEE }).count()) === 0, `JOB C AC4: its card offers no "${SEE}"`, card);
  await qa.click(jobTab, 'JOB C: open "The job"');
  await check((await jobPanel.getByRole('button', { name: `Suggestion ${unlined.n}`, exact: true }).count()) === 0, `JOB C AC4: no numeral ${unlined.n} anywhere on The job`, jobPanel);
  await check((await jobPanel.locator('.jl.hl').count()) === 0, 'JOB C AC4: nothing is lit (the open one has no line)', jobPanel);
  await numeralsOnTheirLines('JOB C', stC, stretchC, unlined.s.id);
  await qa.click(cvTab, 'JOB C: back to "Your CV"');
  await page.locator('.tailor .dbar h1').focus();
  await page.keyboard.press('n');
  await page.waitForTimeout(1500);
  const after = await stretchOf();
  await check(after.suggestions[unlined.n - 1].state === 'declined', `JOB C AC4: it still answers like any other (N → ${after.suggestions[unlined.n - 1].state})`, '.tailor .rail');
}

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
