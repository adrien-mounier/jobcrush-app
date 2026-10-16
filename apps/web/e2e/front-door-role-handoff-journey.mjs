// #322 — "Discovery re-asks the job the front door just took".
//
// What this journey proves ON THE RENDERED SCREEN, against the Tier 2 stack (fake model, real routes):
//
//   1. A visitor who types a role + area at the front door and presses Save and continue lands on
//      discovery and is never asked "What kind of job are you going for?" (AC1). #376 (ADR-0018
//      clause 8): nothing else is asked either — #392: discovery shows the job count, then moves on
//      by itself. The role is recorded as if question 1 had been answered: target title set,
//      family placed (AC2, read off the visitor's own session record).
//   2. A reload re-asks nothing and keeps the same promise number (AC2 "never twice on a reload").
//   3. A brand-new visitor who opens /discovery directly (no role anywhere) is still asked question 1
//      (AC3).
//
//   OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js                      # API on :34101
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34100
//   BASE_URL=http://127.0.0.1:34100 node apps/web/e2e/front-door-role-handoff-journey.mjs
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const ROLE = 'project manager';
const AREA = 'Hong Kong';
const Q1 = 'What kind of job are you going for?';

const qa = await createSession('front-door-role-handoff-journey', { baseURL: BASE, viewport: { width: 1280, height: 900 } });
const { page } = qa;
page.setDefaultTimeout(20000);

const assertTrue = (cond, note) => qa.expectText('body', cond ? '' : '-THIS-CANNOT-APPEAR-', note);
const api = (path) =>
  page.evaluate((p) => fetch(`/api${p}`, { credentials: 'same-origin' }).then((r) => r.json()), path);

// ---------- 1. the front door takes the role and area ----------
await qa.context.clearCookies();
await qa.goto('/', 'a brand-new visitor lands on the front door');
await qa.scrollThrough('read the front door top to bottom');
await qa.click('button:has-text("Ready?")', 'open the front door');
await qa.click('button:has-text("Start questions instead")', 'choose to start from questions');
await qa.fill('#target-role', ROLE, `type the job: "${ROLE}"`);
await qa.fill('#search-area', AREA, `type where: "${AREA}"`);
await qa.press('#search-area', 'Enter', 'place the area chip');
// #392: a raw click — discovery moves on by itself ~3 s after this save, and a qa.* step pauses
// ~1 s and screenshots, so the paced click would miss the screen it is about to read.
await page.click('button:has-text("Save and continue")');
await page.waitForURL(/\/discovery/);
// #392: discovery shows only the job count (the wait box first), then moves on by itself within
// ~2 s — so the screen is read with raw page calls (every qa.* step pauses ~1 s) and asserted after.
const MOVED_ON = /\/(deck|profile\/check)/;
const readDiscovery = async () => ({
  wait: await page.locator('.discovery .loadstate').waitFor({ timeout: 10_000 }).then(() => 1, () => 0),
  intentLine: await page.locator('.intent-context').textContent({ timeout: 10_000 }).catch(() => null),
  roleBox: await page.locator('#q1-role').count(),
  q1: await page.getByText(Q1, { exact: true }).count(),
  opts: await page.locator('.discovery .opts').count(),
});
const seen = await readDiscovery();
await page.waitForURL(MOVED_ON, { timeout: 30_000 });
await assertTrue(seen.wait === 1, `discovery shows the count / wait box, then moves on by itself to ${new URL(page.url()).pathname} (#392)`);

// ---------- AC1: no role question — and, since #376, no other question ----------
await assertTrue(seen.roleBox === 0, 'AC1: there was no role box on the discovery screen');
await assertTrue(seen.q1 === 0, `AC1: "${Q1}" was not asked`);
const state = await api('/onboarding/discovery');
await qa.note(`server state: role=${state.role} stage=${state.stage} questions=${JSON.stringify(state.questions?.map((q) => q.itemId))}`);
await assertTrue(state.role === ROLE && state.stage === 'deck' && state.questions?.length === 0 && seen.opts === 0,
  `AC1 + #376: the role is taken and nothing is asked (role=${state.role}, ${state.questions?.length} questions)`);
// #257: the wait still reads back the saved job (#392 kept the line above the count).
await assertTrue((seen.intentLine ?? '').includes(ROLE), `the wait reads back the saved job: "${seen.intentLine}"`);

// ---------- AC2: recorded exactly as question 1 would ----------
const me = await api('/sessions/me');
await qa.note(`session record: targetTitles=${JSON.stringify(me.targetTitles)} stage=${me.stage} family=${JSON.stringify(me.discovery?.searchFamily)}`);
await assertTrue(Array.isArray(me.targetTitles) && me.targetTitles[0] === ROLE, 'AC2: the target title is set to the front-door role');
await assertTrue(!!me.discovery?.searchFamily?.familyId, `AC2: the family is placed (${me.discovery?.searchFamily?.familyId})`);
const promiseBefore = state.promise;
await qa.note(`promise after discovery: ${JSON.stringify(promiseBefore)}`);

// ---------- AC2: a reload re-asks nothing ----------
// #392: the page has already moved on, so "reload" is opening /discovery again: it must move on by
// itself again, asking nothing.
await page.goto(`${BASE}/discovery`);
const seenAgain = await readDiscovery();
await page.waitForURL(MOVED_ON, { timeout: 30_000 });
await assertTrue(seenAgain.roleBox === 0 && seenAgain.opts === 0 && seenAgain.q1 === 0,
  `AC2: reopening /discovery asks nothing and moves on by itself again (to ${new URL(page.url()).pathname})`);
const afterReload = await api('/onboarding/discovery');
await assertTrue(JSON.stringify(afterReload.promise) === JSON.stringify(promiseBefore) && afterReload.questions?.length === 0,
  `AC2: still nothing asked, and the same promise after reload (${JSON.stringify(afterReload.promise)})`);

// ---------- AC3: no role anywhere -> question 1 still asked ----------
await qa.context.clearCookies();
await qa.goto('/discovery', 'a different brand-new visitor opens /discovery directly');
await qa.expectText('label[for="q1-role"]', Q1, 'AC3: with no role anywhere, question 1 is still asked');
await qa.expectVisible('#q1-role', 'AC3: the role box is there to type into');
await qa.scrollThrough('read the question-1 screen');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
