// #17 the profile badge — the full answer-stream journey, human-paced, over a REAL stack.
//
// Nothing is stubbed: discovery (0 facts -> the first fact -> a "no" -> a correction -> reload)
// -> /profile -> the deck -> /tailor (the word collapse, more answers, a round trip), all against
// the live Fastify API. The flying chip is caught with a MutationObserver rather than a screenshot
// race, so the assertions are about whether a chip existed at all, not whether we photographed it.
//
// Shape of the real fixtures this rides: discovery's essential floor is 3 items, so /discovery can
// only reach 3 facts before it hands off to /deck (which deliberately carries no badge, spec §11).
// Counts of 4+ — and therefore the word collapse — are reached on /tailor.
//
//   PORT=30181 node apps/api/dist/main.js
//   cd apps/web && API_URL=http://127.0.0.1:30181 npx next build && npx next start -p 30180
//   BASE_URL=http://127.0.0.1:30180 node apps/web/e2e/factbadge-journey.mjs
//
// Run this driver serially: every run creates an anonymous session, and the API intentionally limits
// anonymous sessions to 12 per IP per hour.
//
// Ports are deliberately not 3000/3001 — another project on this machine defaults to those and the
// /api proxy would silently reach the wrong backend. API_URL is baked at `next build` time, and
// turbo does not forward it, so build apps/web directly.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:30180';
const ROLE = 'IT project manager in Paris';

const qa = await createSession('factbadge-journey', { baseURL: BASE, viewport: { width: 430, height: 932 } });
const { page } = qa;

const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);

// Records every .factchip ever added to the DOM, so a 700ms flight can't be missed by a slow poll.
async function watchChips() {
  await page.evaluate(() => {
    window.__chips = [];
    window.__chipObs?.disconnect();
    window.__chipObs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1 && node.classList?.contains('factchip')) {
            const r = node.getBoundingClientRect();
            window.__chips.push({ text: node.textContent, x: Math.round(r.left), y: Math.round(r.top) });
          }
        }
      }
    });
    window.__chipObs.observe(document.body, { childList: true, subtree: true });
  });
}
const chips = () => page.evaluate(() => window.__chips ?? []);
const resetChips = () => page.evaluate(() => { window.__chips = []; });

// The badge as a user reads it.
const badge = () =>
  page.evaluate(() => {
    const el = document.querySelector('a.prof');
    if (!el) return null;
    return {
      count: Number(el.querySelector('.n')?.textContent ?? '0'),
      unit: el.querySelector('.unit')?.textContent ?? '',
      unitGone: !!el.querySelector('.unit')?.classList.contains('gone'),
      label: el.getAttribute('aria-label'),
      href: el.getAttribute('href'),
      layers: el.querySelectorAll('svg rect').length,
    };
  });

// ---------------------------------------------------------------------------------------------
// 1. A brand-new visitor: 0 facts means no badge at all (spec §6 — no element, no zero).
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'a brand-new visitor lands on discovery');
await watchChips();
await assert(
  (await page.locator('a.prof').count()) === 0,
  'AC4/§6: at 0 facts the badge is not rendered at all — no element, no zero, no empty container to be short of',
);

// ---------------------------------------------------------------------------------------------
// 2. Q1 — the role. On this server the role is session state, not a claim: factCount stays 0.
// ---------------------------------------------------------------------------------------------
await qa.fill(page.getByRole('textbox', { name: /What kind of job are you going for/ }), ROLE, 'type the role into Q1');
await qa.click(page.getByRole('button', { name: "That's me" }), "Q1: submit the role (That's me)");
await page.waitForTimeout(1400);
const q1Badge = await badge();
const q1Chips = await chips();
await qa.note(
  `after Q1: badge=${JSON.stringify(q1Badge)} chips=${q1Chips.length} — Q1 mints no fact on this server, ` +
    `so by the "chip follows growth" rule nothing flies`,
);

// ---------------------------------------------------------------------------------------------
// 3. AC1 — the first FLOOR answer: 0 -> 1. The answer the badge is born on.
// ---------------------------------------------------------------------------------------------
await resetChips();
const firstOpt = page.locator('.discovery .opts .opt').first();
const firstOptText = (await firstOpt.textContent()).trim();
await qa.click(firstOpt, `the first floor answer: "${firstOptText}"`);
await page.waitForTimeout(1800);
const c1 = await chips();
const b1 = await badge();
await qa.note(`0->1: chips=${JSON.stringify(c1)} badge=${JSON.stringify(b1)}`);
await assert(c1.length === 1, `AC1 (0->1): exactly one chip flew on the very first fact (flew ${c1.length})`);
await assert(c1[0]?.text === `+ ${firstOptText}`, `AC1: the chip carries the visitor's own answer — ${JSON.stringify(c1[0]?.text)}`);
await assert(b1?.count === 1, `AC1: the badge was born and reads ${b1?.count}`);
await assert(b1?.unit === 'fact' && !b1.unitGone, `AC2: at 1 it reads the singular "fact"`);
await assert(b1?.layers === 1, `AC3: 1 fact draws 1 layer`);
await qa.expectVisible('a.prof', 'the badge at 1 fact — count plus the word "fact"');

// ---------------------------------------------------------------------------------------------
// 4. AC1 on a "no" — it types no CV line, so the chip is its only reward.
// ---------------------------------------------------------------------------------------------
// #216: this step needs a "No" specifically, and the researched floor alternates shapes - items 1
// and 3 are tap-an-option (Yes/No), items 2 and 4 are type-your-own. After item 1 the question on
// screen is a free-text one with no buttons at all, so waiting for a "No" here timed out at 8s and
// took three dependent assertions down with it. Clear the free-text item first - and only THEN
// reset the chips and read the badge, because this step's assertions are that ONE "no" flew ONE
// chip and grew the pile by exactly one. Counting the clearing answer would break both.
let noBtn = page.getByRole('button', { name: 'No', exact: true });
if ((await noBtn.count()) === 0) {
  await qa.answerVisibleQuestion({
    freeText: 'I ran the weekly steering update myself',
    note: 'clear the type-your-own question to reach the next yes/no one',
  });
  await page.waitForTimeout(1800);
  noBtn = page.getByRole('button', { name: 'No', exact: true });
}
await resetChips();
const beforeNo = (await badge()).count;
await qa.click(noBtn, 'answer "No" - no CV line types, so the chip is the whole reward');
await page.waitForTimeout(1800);
const cNo = await chips();
const bNo = await badge();
await assert(cNo.length === 1, `AC1: a "no" flew a chip (flew ${cNo.length}) — the badge is what pays for a "no"`);
await assert(bNo.count === beforeNo + 1, `AC1: the pile grew on a "no" (${beforeNo} -> ${bNo.count})`);
await assert(bNo.unit === 'facts' && !bNo.unitGone, `AC2: at ${bNo.count} the plural "facts" is still shown`);
await qa.expectVisible('a.prof', `the badge at ${bNo.count} facts, grown by a "no"`);

// ---------------------------------------------------------------------------------------------
// 5. A correction must fly NOTHING (delta 0) — a chip here would lie about the count.
// ---------------------------------------------------------------------------------------------
await resetChips();
const fixLine = page.getByRole('button', { name: /Fix this line/i }).first();
if (await fixLine.count()) {
  const beforeC = (await badge()).count;
  await qa.click(fixLine, 'open a correction on an answered CV line');
  // #216: the researched floor mixes tap-an-option and type-your-own items, so the control this
  // correction reopens is whichever shape the answered line used. A bare option click stalls 8s and
  // aborts the run on a free-text line.
  const alt = page.locator('.discovery .opts .opt').nth(1);
  if (await alt.count()) {
    await qa.click(alt, 'commit the correction with a different option');
  } else {
    await qa.answerVisibleQuestion({
      freeText: 'Corrected: two programmes, not one',
      note: 'commit the correction by retyping the answer',
    });
  }
  await page.waitForTimeout(2000);
  const cC = await chips();
  const bC = await badge();
  await assert(cC.length === 0, `a correction flies NO chip (flew ${cC.length}) — nothing was added, so nothing may fly`);
  await assert(bC.count === beforeC, `a correction leaves the count alone and never lowers it (${beforeC} -> ${bC.count})`);
  await qa.expectVisible('a.prof', 'the badge, untouched by the correction');
} else {
  await qa.note('no correctable CV line on the dock at this point — the API probe covers the delta-0 case');
}

// ---------------------------------------------------------------------------------------------
// 6. Reload — the count holds and no stale chip replays (spec §6, the resume state).
// ---------------------------------------------------------------------------------------------
const beforeReload = (await badge()).count;
await qa.goto('/discovery', 'reload mid-flow');
await watchChips();
await page.waitForTimeout(1500);
const afterReload = await badge();
const reloadChips = await chips();
await assert(afterReload?.count >= beforeReload, `the count held across a reload (${beforeReload} -> ${afterReload?.count})`);
await assert(reloadChips.length === 0, `a resume replays no chip and no pulse (chips=${reloadChips.length})`);

// ---------------------------------------------------------------------------------------------
// 7. AC5 — tapping the badge opens the profile as its own screen.
// ---------------------------------------------------------------------------------------------
await assert(
  /^Your profile — \d+ facts? about you$/.test(afterReload?.label ?? ''),
  `a11y: the accessible name carries the count — "${afterReload?.label}"`,
);
await qa.click('a.prof', 'AC5: tap the badge');
await page.waitForURL('**/profile', { timeout: 10_000 });
const profileHeading = page.locator('.profile .pcount');
await qa.expectVisible(profileHeading, 'AC5: the current Profile screen opens with the fact-count heading');
await qa.expectText(
  profileHeading,
  `${afterReload.count} ${afterReload.count === 1 ? "thing you've told me" : "things you've told me"}`,
  'the Profile heading carries the same fact count as the badge',
);
await assert(await profileHeading.evaluate((el) => el === document.activeElement), 'focus lands on the Profile heading');
await qa.click(page.getByRole('button', { name: 'Constellation' }), 'switch Profile to Constellation');
await qa.expectVisible('.profile .sky', 'the Constellation view is visible');
await qa.click(page.getByRole('button', { name: 'Sorted' }), 'switch Profile back to Sorted');
await qa.expectVisible('.profile .sheetwrap', 'the Sorted profile is visible again');
await qa.scrollThrough('read the current Sorted profile');
await qa.click(page.getByRole('button', { name: 'Back' }), 'Back returns to the screen that sent us');
await page.waitForTimeout(1400);

// ---------------------------------------------------------------------------------------------
// 8. Finish discovery's floor, then sign in and reach /tailor.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'back to discovery to finish the floor');
await watchChips();
await page.waitForTimeout(1200);
let discPeak = (await badge())?.count ?? 0;
for (let i = 0; i < 5; i++) {
  await resetChips();
  // #216: answer whichever shape is on screen - the old option-only click quietly stopped the loop
  // at the first free-text item, so the floor was never finished and the peak was under-reported.
  if (!(await qa.answerVisibleQuestion({ note: `finish the floor (step ${i + 1})` }))) break;
  await page.waitForTimeout(2200);
  if (!page.url().includes('/discovery')) break; // the floor is done — discovery hands off to /deck
  const b = await badge();
  if (b) discPeak = Math.max(discPeak, b.count);
}
await qa.note(`discovery's floor tops out at ${discPeak} facts, then it hands off to /deck (which carries no badge, spec §11)`);

const signedIn = await page.evaluate(async (email) => {
  const post = (u, b) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const res = await post('/api/auth/request-link', { email });
  const link = await res.json();
  if (!link.devLink) return `sign-in failed (${res.status}) — /auth/request-link is 5 per 15 min per IP; restart the API`;
  await post('/api/auth/verify', { token: new URL('http://x' + link.devLink).searchParams.get('token') });
  // #63: adverts reach a session through retrieval, and the FIRST deck read returns an empty deck
  // while that is still in flight (#245). Before #63 the fixture pool answered instantly and this
  // read never had to wait; now an unwaited read makes cards[0] undefined.
  let cards = null;
  for (const deadline = Date.now() + 20000; Date.now() < deadline; ) {
    cards = await (await fetch('/api/onboarding/cards')).json();
    if (cards.searching !== true) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!cards?.cards?.length) return `no deck to want from (${JSON.stringify(cards?.retrieval)})`;
  await fetch(`/api/onboarding/cards/${encodeURIComponent(cards.cards[0].adId)}/want`, { method: 'POST' });
  return 'ok';
}, `badge-journey-${Date.now()}@example.com`);
if (signedIn !== 'ok') throw new Error(signedIn);

// ---------------------------------------------------------------------------------------------
// 9. Both screens — the badge renders and animates on /tailor too.
// ---------------------------------------------------------------------------------------------
await qa.goto('/tailor', 'open the tailor screen');
await watchChips();
await page.waitForTimeout(1600);
const bT = await badge();
await assert(!!bT, `the badge renders on /tailor too, at ${bT?.count}`);
await assert(bT?.count >= discPeak, `the count carried across discovery -> tailor without falling (${discPeak} -> ${bT?.count})`);
await assert((await chips()).length === 0, 'arriving on /tailor replays no chip');
await qa.expectVisible('a.prof', `the badge in the tailor topbar at ${bT?.count}`);

// ---------------------------------------------------------------------------------------------
// 10. AC2's second half — past 3 the word collapses and the count remains.
// ---------------------------------------------------------------------------------------------
const climb = [bT.count];
for (let i = 0; i < 4; i++) {
  const yes = page.getByRole('button', { name: 'Yes', exact: true });
  if (!(await yes.count())) break;
  await resetChips();
  const before = (await badge()).count;
  await qa.click(yes, `tailor answer ${i + 1}`);
  await page.waitForTimeout(1900);
  const c = await chips();
  const b = await badge();
  climb.push(b.count);
  await assert(c.length === 1 && b.count > before, `AC1 on /tailor: answer ${i + 1} flew a chip and grew the badge (${before} -> ${b.count})`);
  if (b.count === 4) {
    await assert(b.unitGone, `AC2: at 4 the word has collapsed and only the count remains (unit collapsed=${b.unitGone})`);
    await qa.expectVisible('a.prof', 'AC2: the badge at 4 — the word is gone, the count remains');
  }
}
const bFinal = await badge();
await qa.note(`AC1/AC3: the count across the whole run — ${climb.join(' -> ')}; layers now ${bFinal.layers}`);
await assert(climb.every((v, i) => i === 0 || v >= climb[i - 1]), `the count never fell at any step (${climb.join(' -> ')})`);
await assert(bFinal.unitGone, `AC2: past the threshold the word stays gone (count=${bFinal.count})`);
await qa.expectVisible('a.prof', `the badge at ${bFinal.count} facts, ${bFinal.layers} layers`);

// ---------------------------------------------------------------------------------------------
// 11. "It only ever grows" — a round trip through the deck.
// ---------------------------------------------------------------------------------------------
const peak = bFinal.count;
await qa.goto('/deck', 'over to the deck');
await assert((await page.locator('a.prof').count()) === 0, 'the deck deliberately carries no badge this slice (spec §11)');
await qa.goto('/tailor', 'back to tailor');
await watchChips();
await page.waitForTimeout(1500);
const afterTrip = await badge();
await assert(afterTrip?.count >= peak, `the count never fell across tailor -> deck -> tailor (${peak} -> ${afterTrip?.count})`);
await assert((await chips()).length === 0, 'returning replays no chip');
await qa.expectVisible('a.prof', `back on tailor, still ${afterTrip?.count} facts`);

// ---------------------------------------------------------------------------------------------
// 12. Keyboard — the badge is a real link: Tab reaches it, Enter activates it.
// ---------------------------------------------------------------------------------------------
// Tab order is DOM order, so "first tab stop" is a structural fact: read the focusable elements in
// document order rather than pressing Tab from wherever the last click left focus.
// Scoped to the screen root: the root layout's own `.brandbar` link precedes every screen's content
// app-wide (pre-existing chrome, nothing to do with the badge), so "first tab stop" is asserted
// within the screen, which is what the spec's §8.4 claim is actually about.
const tabOrder = await page.evaluate(() =>
  [...document.querySelectorAll('.jobdeck a[href],.jobdeck button:not([disabled]),.jobdeck input,.jobdeck textarea,.jobdeck summary')]
    .slice(0, 4)
    .map((el) => `${el.tagName.toLowerCase()}.${el.className || '-'}`),
);
await qa.note(`focusable elements in DOM order inside the tailor screen: ${JSON.stringify(tabOrder)}`);
await assert(tabOrder[0] === 'a.prof', `keyboard: the badge is the first tab stop within the screen (order: ${tabOrder.join(' -> ')})`);

// Shift+Tab from the first question option must reach the badge (spec §8.4's stated route).
await page.getByRole('button', { name: 'Yes', exact: true }).first().focus().catch(() => {});
await page.keyboard.press('Shift+Tab');
const backStop = await page.evaluate(() => document.activeElement?.className ?? '(none)');
await qa.note(`Shift+Tab from an option lands on: "${backStop}"`);

await page.locator('a.prof').focus();
const focusedIsBadge = await page.evaluate(() => document.activeElement?.className === 'prof');
await assert(focusedIsBadge, 'keyboard: the badge takes focus');
await page.keyboard.press('Enter');
const reachedProfile = await page
  .waitForURL('**/profile', { timeout: 10_000 })
  .then(() => true)
  .catch(() => false);
await assert(reachedProfile, `AC5 by keyboard: Enter on the focused badge opens /profile (reached: ${reachedProfile})`);
if (reachedProfile) {
  await qa.expectVisible('.profile .pcount', 'AC5 by keyboard: the current Profile screen');
  const focusOnProfile = await page.evaluate(() => document.activeElement?.tagName?.toLowerCase());
  await assert(focusOnProfile === 'h1', `focus lands on the profile heading, not the body (got ${focusOnProfile})`);
}

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
