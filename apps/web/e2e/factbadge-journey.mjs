// #17 the profile badge — the full journey, human-paced, over a REAL stack.
//
// Nothing is stubbed: discovery (0 facts, and #339: question 1 and the eligibility answers add none)
// -> her CV read and reviewed (the facts the badge counts) -> /tailor -> /profile -> discovery and
// back -> a round trip through the deck — all against the live Fastify API.
//
// #339 moved where the badge is born: discovery no longer asks the floor. #415 (ADR-0020) moved it
// again: the Tailor step takes no answer that writes a fact any more (the requirement yes/no queue
// is gone; a profile answer never moves the count), so the badge is born of her CV, and no chip
// flies on any screen this journey walks — the MutationObserver below is kept to prove that.
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
// 3. #376/#386: nothing is asked after Q1 any more (work rights and languages moved into the
//    profile's check mode) — #392: discovery shows the job count and moves on by itself; the badge
//    stays unborn and no chip flies. (The chip observer survives the client-side move.)
// ---------------------------------------------------------------------------------------------
await resetChips();
const askedAfterQ1 = await page.locator('.discovery .opts').count();
await page.waitForURL(/\/(deck|profile\/check)/, { timeout: 30_000 });
const servedAfterQ1 = await page.evaluate(async () => (await (await fetch('/api/onboarding/discovery')).json())?.questions ?? []);
await assert(
  askedAfterQ1 === 0 && servedAfterQ1.length === 0 && (await chips()).length === 0,
  `nothing asked, no fact minted — discovery moved on by itself to ${new URL(page.url()).pathname}, no chip (chips=${(await chips()).length})`,
);

// ---------------------------------------------------------------------------------------------
// 4. Her CV, read and reviewed — the facts the badge counts (#339/#415). Then sign in and reach
//    /tailor (past the wall), where the badge sits in the topbar.
// ---------------------------------------------------------------------------------------------
const facts = await qa.factsFromCv();
await assert(facts > 0, `her CV gave the record ${facts} facts — the badge is born of her CV, not of a tap`);
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
// A profile question this job left open (work rights, a language) comes first and adds no counted
// fact — answer it once, and the draft follows (#415).
if ((await page.locator('.tailor .ask .q').count()) > 0) {
  await qa.click(page.locator('.tailor .opts .opt').first(), 'a profile question first — it adds no counted fact');
  await page.waitForTimeout(1400);
}
await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
const b1 = await badge();
await qa.note(`on /tailor: badge=${JSON.stringify(b1)} chips=${(await chips()).length}`);
await assert(b1?.count === facts, `AC1: the badge reads her CV's ${facts} facts (${b1?.count})`);
await assert(b1?.layers >= 1, `AC3: ${b1?.count} facts draw ${b1?.layers} layer(s)`);
await assert((await chips()).length === 0, 'no chip flies on /tailor — nothing here records a fact (#415)');
await qa.expectVisible('a.prof', `the badge in the tailor topbar at ${b1?.count}`);

// ---------------------------------------------------------------------------------------------
// 5. AC2 — the word: "fact"/"facts" up to 3, collapsed past it (the CV's count decides which).
// ---------------------------------------------------------------------------------------------
if (b1.count <= 3) {
  await assert(b1.unit === (b1.count === 1 ? 'fact' : 'facts') && !b1.unitGone, `AC2: at ${b1.count} the word "${b1.unit}" is shown`);
} else {
  await assert(b1.unitGone, `AC2: past 3 the word has collapsed and only the count remains (unit collapsed=${b1.unitGone})`);
}

// ---------------------------------------------------------------------------------------------
// 6. Reload — the count holds and no stale chip replays (spec §6, the resume state).
// ---------------------------------------------------------------------------------------------
await qa.goto('/tailor', 'reload');
await watchChips();
await page.waitForTimeout(1500);
const afterReload = await badge();
const reloadChips = await chips();
await assert(afterReload?.count >= b1.count, `the count held across a reload (${b1.count} -> ${afterReload?.count})`);
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
// 8. A trip through discovery. #392: once the role is known discovery shows only the job count and
//    moves on by itself — no topbar, so no badge there any more; the badge after the trip must not
//    have fallen below the one read before it.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'over to discovery');
await page.waitForURL(/\/(deck|profile\/check)/, { timeout: 30_000 });
await qa.goto('/tailor', 'back to tailor');
await watchChips();
await page.waitForTimeout(1600);
const bT = await badge();
await assert(bT?.count >= afterReload.count, `the count carried across discovery -> tailor without falling (badge before the trip ${afterReload.count} -> ${bT?.count})`);
await assert((await chips()).length === 0, 'arriving on /tailor replays no chip');
await qa.expectVisible('a.prof', `the badge in the tailor topbar at ${bT?.count}`);

// ---------------------------------------------------------------------------------------------
// 9. "It only ever grows" — a round trip through the deck.
// ---------------------------------------------------------------------------------------------
const peak = bT.count;
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
// 10. Keyboard — the badge is a real link: Tab reaches it, Enter activates it.
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
