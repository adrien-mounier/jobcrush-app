// #17 the profile badge — the full answer-stream journey, human-paced, over a REAL stack.
//
// Nothing is stubbed: discovery (0 facts, and #339: question 1 and the eligibility answers add none)
// -> /tailor (the first fact -> a "no" -> reload) -> /profile -> discovery and back -> the word
// collapse, more answers, a round trip through the deck — all against the live Fastify API. The
// flying chip is caught with a MutationObserver rather than a screenshot race, so the assertions are
// about whether a chip existed at all, not whether we photographed it.
//
// #339 moved where the badge is born: discovery no longer asks the floor, so a visitor with no CV
// tells us her first fact in the tailor step. The delta-0 "a correction flies nothing" step went
// with discovery's correctable CV lines ("Fix this line"), which #339 removed.
//
//   OPS_KEY=qa-ops-key PORT=30181 node apps/api/dist/qa-main.js
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
// 3. #339: an eligibility answer is not a fact either. After Q1 discovery asks work rights and
//    languages only — neither is counted — so the badge stays unborn and no chip flies.
// ---------------------------------------------------------------------------------------------
await resetChips();
const eligOpt = page.locator('.discovery .opts .opt').first();
await eligOpt.waitFor({ state: 'visible', timeout: 15000 });
const eligText = (await eligOpt.textContent()).trim();
await qa.click(eligOpt, `answer the work-rights question: "${eligText}"`);
await page.waitForTimeout(1800);
await assert(
  (await page.locator('a.prof').count()) === 0 && (await chips()).length === 0,
  `#339: an eligibility answer mints no fact — still no badge, no chip (chips=${(await chips()).length})`,
);

// ---------------------------------------------------------------------------------------------
// 4. Sign in and reach /tailor — where a visitor without a CV now tells us facts.
// ---------------------------------------------------------------------------------------------
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

await qa.goto('/tailor', 'open the tailor screen');
await watchChips();
await page.waitForTimeout(1600);
await assert((await page.locator('a.prof').count()) === 0, 'still 0 facts on /tailor — no badge there either (spec §6)');
// A profile-level question (a language ladder, when an earlier journey left the QA stack's language
// adverts armed) has no Yes/No and adds no counted fact — put it off so a Yes/No requirement is up.
for (let i = 0; i < 3 && !(await page.getByRole('button', { name: 'Yes', exact: true }).count()); i++) {
  const notNow = page.getByRole('button', { name: 'Not now', exact: true });
  if (!(await notNow.count())) break;
  await qa.click(notNow.first(), 'a profile-level question first — "Not now", it adds no counted fact');
  await page.waitForTimeout(1200);
}

// ---------------------------------------------------------------------------------------------
// 5. AC1 — the first answer that IS a fact: 0 -> 1. The answer the badge is born on.
// ---------------------------------------------------------------------------------------------
await resetChips();
await qa.click(page.getByRole('button', { name: 'Yes', exact: true }).first(), 'the first fact: "Yes" to a requirement');
await page.waitForTimeout(1900);
const c1 = await chips();
const b1 = await badge();
await qa.note(`0->1: chips=${JSON.stringify(c1)} badge=${JSON.stringify(b1)}`);
await assert(c1.length === 1, `AC1 (0->1): exactly one chip flew on the very first fact (flew ${c1.length})`);
await assert(c1[0]?.text === '+ Yes', `AC1: the chip carries the visitor's own answer — ${JSON.stringify(c1[0]?.text)}`);
await assert(b1?.count === 1, `AC1: the badge was born and reads ${b1?.count}`);
await assert(b1?.unit === 'fact' && !b1.unitGone, `AC2: at 1 it reads the singular "fact"`);
await assert(b1?.layers === 1, `AC3: 1 fact draws 1 layer`);
await qa.expectVisible('a.prof', 'the badge at 1 fact — count plus the word "fact"');

// ---------------------------------------------------------------------------------------------
// 6. AC1 on a "no" — a recorded "No" counts too, so the chip flies and the pile grows by one.
// ---------------------------------------------------------------------------------------------
await resetChips();
const beforeNo = (await badge()).count;
await qa.click(page.getByRole('button', { name: 'No', exact: true }).first(), 'answer "No" — it still counts as something she told us');
await page.waitForTimeout(1900);
const cNo = await chips();
const bNo = await badge();
await assert(cNo.length === 1, `AC1: a "no" flew a chip (flew ${cNo.length}) — the badge is what pays for a "no"`);
await assert(bNo.count === beforeNo + 1, `AC1: the pile grew on a "no" (${beforeNo} -> ${bNo.count})`);
await assert(bNo.unit === 'facts' && !bNo.unitGone, `AC2: at ${bNo.count} the plural "facts" is still shown`);
await qa.expectVisible('a.prof', `the badge at ${bNo.count} facts, grown by a "no"`);

// ---------------------------------------------------------------------------------------------
// 7. Reload — the count holds and no stale chip replays (spec §6, the resume state).
// ---------------------------------------------------------------------------------------------
const beforeReload = (await badge()).count;
await qa.goto('/tailor', 'reload mid-flow');
await watchChips();
await page.waitForTimeout(1500);
const afterReload = await badge();
const reloadChips = await chips();
await assert(afterReload?.count >= beforeReload, `the count held across a reload (${beforeReload} -> ${afterReload?.count})`);
await assert(reloadChips.length === 0, `a resume replays no chip and no pulse (chips=${reloadChips.length})`);

// ---------------------------------------------------------------------------------------------
// 8. AC5 — tapping the badge opens the profile as its own screen.
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
// 9. Both screens — the badge renders on discovery too, at the count tailor reached.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'over to discovery');
await page.waitForTimeout(1500);
const bD = await badge();
await assert(!!bD && bD.count >= afterReload.count, `the badge renders on discovery too, without falling (${afterReload.count} -> ${bD?.count})`);
await qa.goto('/tailor', 'back to tailor');
await watchChips();
await page.waitForTimeout(1600);
const bT = await badge();
await assert(bT?.count >= (bD?.count ?? 0), `the count carried across discovery -> tailor without falling (${bD?.count} -> ${bT?.count})`);
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
