// #433 — the Tailor screen's suggestion numbers and approve moment, human-paced, over a REAL stack
// (qa-main's fake model: its stretch step now puts a PENDING suggestion on a bullet line). At 1280
// and at 390: every CV number sits clear of its bullet dot and inside the page; no DRAFT banner;
// Approve is the gold primary once no card is open, on screen without scrolling; the closed summary
// says plainly what is not used and keeps each number; The job renders the job's formatting with
// its numbers clear of the text. Ends by approving with suggestions unanswered (still allowed).
//
//   PORT=34181 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34181 npx next build && npx next start -p 34180
//   BASE_URL=http://127.0.0.1:34180 node apps/web/e2e/tailor-numbers-journey.mjs

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const EMAIL = `tailor-numbers-${Date.now()}@example.com`;
const APPROVE = 'Approve and email me this CV';
const NOT_USED = /not used — your CV keeps its own lines/;

const qa = await createSession('tailor-numbers-journey', { baseURL: BASE, viewport: { width: 1280, height: 800 } });
const { page } = qa;
const assert = (cond, note, target = 'body') => qa.expectText(target, cond ? '' : '\u0000-IMPOSSIBLE-', note);
const api = (p) => page.evaluate(async (u) => (await fetch(u)).json(), p);
const cv = () => page.frameLocator('.draft-frame');

// Seed: anonymous session, her CV, magic-link sign-in (as stretch-use-journey.mjs does).
await qa.goto('/discovery', 'land on discovery');
await page.evaluate(() =>
  fetch('/api/onboarding/discovery/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'IT project manager in Paris' }),
  }).then(() => undefined),
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
if (seeded !== 'ok') throw new Error(`could not seed the session: ${seeded}`);

await qa.goto('/deck', 'the reveal');
await qa.click(page.getByRole('button', { name: 'See them' }), 'See them');
await qa.click(page.getByRole('button', { name: 'I want this one, tailor this job' }), 'tailor the first job');
await page.waitForURL('**/tailor', { timeout: 15_000 });
await page.waitForTimeout(800);
if ((await page.locator('.tailor .ask .q').count()) > 0) {
  await qa.click(page.locator('.tailor .opts .opt').first(), 'answer the one profile question');
  await page.waitForTimeout(1400);
}

async function checkAt(label) {
  const card = page.getByRole('region', { name: /^Suggestion 1 of \d+$/ });
  await card.waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
  await qa.expectVisible(card, `${label}: the first suggestion is open`);
  const view = await api('/api/onboarding/tailor/draft');
  const pend = view.stretch.suggestions.map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => s.state === 'pending');
  await qa.note(`${label}: suggestions ${view.stretch.suggestions.map((s, i) => `#${i + 1} ${s.slot.kind}${s.slot.kind === 'bullet' ? `(${s.slot.role},${s.slot.bullet})` : ''} ${s.state}`).join(' · ')}`);
  const onBullet = pend.find(({ s, n }) => n > 1 && s.slot.kind === 'bullet');
  await assert(!!onBullet, `${label}: a PENDING suggestion sits on a bullet line (#${onBullet?.n})`);
  await assert((await cv().locator('.banner').count()) === 0, `${label}: no DRAFT banner on the Tailor screen`);

  // Geometry, inside the CV page itself.
  const pins = await cv().locator('body').evaluate((body) =>
    [...body.querySelectorAll('.pin')].map((pin) => {
      const b = pin.getBoundingClientRect();
      const ul = pin.closest('ul');
      return { n: pin.querySelector('.n')?.textContent, open: pin.classList.contains('open'), inLi: !!pin.closest('li'), left: b.left, right: b.right, top: b.top, ulLeft: ul ? ul.getBoundingClientRect().left : null, lineLeft: pin.parentElement.getBoundingClientRect().left, pageW: document.documentElement.clientWidth };
    }),
  );
  await qa.note(`${label}: pins ${JSON.stringify(pins.map((p) => ({ n: p.n, open: p.open, li: p.inLi, l: Math.round(p.left), r: Math.round(p.right), ul: p.ulLeft && Math.round(p.ulLeft) })))}`);
  for (const p of pins) {
    await assert(p.left >= 0 && p.right <= p.pageW, `${label}: number ${p.n} is inside the page (left ${Math.round(p.left)}px)`);
    await assert(p.right <= (p.ulLeft ?? p.lineLeft), `${label}: number ${p.n} is clear of ${p.inLi ? 'its bullet dot' : 'its line'} (${Math.round(p.right)} ≤ ${Math.round(p.ulLeft ?? p.lineLeft)})`);
  }
  const bulletPin = cv().locator('li > .pin:not(.open)').first();
  await assert((await bulletPin.count()) === 1, `${label}: a pending number is drawn on a bullet line`);
  await bulletPin.scrollIntoViewIfNeeded();
  await qa.expectText(bulletPin, String(onBullet?.n ?? ''), `${label}: EVIDENCE — pending number ${onBullet?.n} on its bullet line, clear of the dot`);
  await assert(!(await cv().locator('.pin').first().getAttribute('aria-hidden')), `${label}: the number is read out to a screen reader`);

  // Approve: quiet while a card is open, the gold primary once none is.
  const approve = page.getByRole('button', { name: APPROVE });
  await assert(!/\bgold\b/.test((await approve.getAttribute('class')) ?? ''), `${label}: Approve waits quietly while a card is open`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  if (await page.locator('.stretch-card').count()) {
    await qa.click(page.locator('.stretch-card').getByRole('button', { name: 'Skip the rest' }), `${label}: Skip the rest`);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await assert(/\bgold\b/.test((await approve.getAttribute('class')) ?? ''), `${label}: Approve is the gold primary once no card is open`);
  const inView = await approve.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
  await qa.expectVisible(approve, `${label}: EVIDENCE — Approve is on screen at the top of the page (${inView ? 'fully in view' : 'NOT in view'})`);
  await assert(inView, `${label}: Approve is reached without scrolling the page or the CV`);

  // The closed summary.
  const summary = page.getByRole('region', { name: NOT_USED });
  await qa.expectVisible(summary, `${label}: the closed summary is named by its honest line`);
  await qa.expectText(summary.getByRole('heading', { level: 2 }), `${pend.length} suggestions not used — your CV keeps its own lines`, `${label}: EVIDENCE — "${pend.length} suggestions not used — your CV keeps its own lines"`);
  await assert(!(await summary.innerText()).includes('Ready to send') && !(await summary.innerText()).includes('left out'), `${label}: no "Ready to send" above a "left out" count`);
  const nums = await summary.locator('.slist li .num').allTextContents();
  await assert(nums.join(',') === view.stretch.suggestions.map((_, i) => i + 1).join(','), `${label}: each row keeps its suggestion's number (${nums.join(',')})`);

  // The job tab.
  await qa.click(page.getByRole('tab', { name: 'The job' }), `${label}: open The job`);
  const job = page.locator('.jobtext');
  await qa.scrollThrough(`${label}: read down the job`);
  const jg = await job.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return [...el.querySelectorAll('.jl')].filter((l) => l.querySelector('.pins')).map((l) => {
      const t = l.querySelector('.jt').getBoundingClientRect();
      return [...l.querySelectorAll('.pins .num')].map((b) => { const r = b.getBoundingClientRect(); return { l: r.left, r: r.right, tl: t.left, jl: box.left, vw: innerWidth }; });
    }).flat();
  });
  await qa.note(`${label}: job numbers ${JSON.stringify(jg.map((g) => ({ l: Math.round(g.l), r: Math.round(g.r), text: Math.round(g.tl), box: Math.round(g.jl) })))}`);
  for (const g of jg) await assert(g.l >= 0 && g.r <= g.tl && g.l >= g.jl - 1, `${label}: a job number sits inside the job panel and clear of its text`);
  await assert(!(await job.innerText()).includes('**'), `${label}: no literal ** in The job`);
  const firstNum = job.locator('.pins .num').first();
  if (await firstNum.count()) await qa.expectVisible(firstNum, `${label}: EVIDENCE — a number on its job line`);
  else await qa.expectVisible(job, `${label}: EVIDENCE — The job (this job's lines carry no numbers)`);
  await qa.click(page.getByRole('tab', { name: 'Your CV' }), `${label}: back to Your CV`);
}

await checkAt('1280');

// The phone: same session, same draft.
await page.setViewportSize({ width: 390, height: 844 });
// Re-open the first suggestion so the CV carries its numbers again.
await page.reload();
await page.waitForTimeout(1500);
if (!(await page.getByRole('region', { name: /^Suggestion 1 of \d+$/ }).count())) {
  const answer = page.getByRole('region', { name: NOT_USED }).getByRole('button', { name: 'Answer' }).first();
  if (await answer.count()) await qa.click(answer, '390: reopen the first suggestion');
}
await checkAt('390');

// Approving with unanswered suggestions stays allowed.
await qa.click(page.getByRole('button', { name: APPROVE }), 'approve with suggestions unanswered');
await page.getByText('Done — your CV is made and the email is on its way.').waitFor({ timeout: 60_000 }).catch(() => {});
await qa.expectText('.tailor', 'Done — your CV is made and the email is on its way.', 'approving with unanswered suggestions is still allowed and sends');

process.exit((await qa.finish()) ? 0 : 1);
