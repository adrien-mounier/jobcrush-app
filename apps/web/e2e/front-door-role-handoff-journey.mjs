// #322 — "Discovery re-asks the job the front door just took".
//
// What this journey proves ON THE RENDERED SCREEN, against the Tier 2 stack (fake model, real routes):
//
//   1. A visitor who types a role + area at the front door and presses Save and continue lands on
//      discovery and sees the family checklist's first question — never "What kind of job are you
//      going for?" (AC1). The role is recorded as if question 1 had been answered: target title set,
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
const expectAbsent = (inner, note) => qa.expectVisible(page.locator('body').filter({ hasNot: inner }), note);
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
await qa.click('button:has-text("Save and continue")', 'Save and continue');
await page.waitForURL(/\/discovery/);
await qa.expectVisible('#ask-q', 'discovery opened on a checklist question');
await qa.scrollThrough('read the discovery screen the way a person would');

// ---------- AC1: no role question, the first question is the checklist's ----------
await expectAbsent(page.locator('#q1-role'), 'AC1: there is no role box on the screen');
await expectAbsent(page.getByText(Q1, { exact: true }), `AC1: "${Q1}" is not asked`);
const firstAsk = (await page.locator('#ask-q').textContent())?.trim();
const state = await api('/onboarding/discovery');
await qa.note(`first question on screen: ${JSON.stringify(firstAsk)}; server's first item: ${state.questions?.[0]?.itemId}`);
await assertTrue(state.role === ROLE && state.questions?.[0]?.question === firstAsk,
  `AC1: the question on screen is the checklist's first (role=${state.role}, item=${state.questions?.[0]?.itemId})`);
await qa.expectText('.intent-context', ROLE, 'the context line still reads back the saved job');

// ---------- AC2: recorded exactly as question 1 would ----------
const me = await api('/sessions/me');
await qa.note(`session record: targetTitles=${JSON.stringify(me.targetTitles)} stage=${me.stage} family=${JSON.stringify(me.discovery?.searchFamily)}`);
await assertTrue(Array.isArray(me.targetTitles) && me.targetTitles[0] === ROLE, 'AC2: the target title is set to the front-door role');
await assertTrue(!!me.discovery?.searchFamily?.familyId, `AC2: the family is placed (${me.discovery?.searchFamily?.familyId})`);
const promiseBefore = state.promise;
await qa.note(`promise after hand-off: ${JSON.stringify(promiseBefore)}`);

// ---------- AC2: a reload re-asks nothing ----------
await page.reload();
await page.locator('#ask-q').waitFor({ state: 'visible' }); // the screen fades in after "Loading your questions…"
await page.waitForTimeout(800);
await qa.expectVisible('#ask-q', 'after a reload: still on the checklist question');
await qa.scrollThrough('read it again after the reload');
await expectAbsent(page.locator('#q1-role'), 'AC2: the reload does not bring the role box back');
const afterReload = await api('/onboarding/discovery');
await assertTrue(JSON.stringify(afterReload.promise) === JSON.stringify(promiseBefore) &&
  afterReload.questions?.[0]?.itemId === state.questions?.[0]?.itemId,
  `AC2: same first question and same promise after reload (${JSON.stringify(afterReload.promise)})`);

// ---------- AC3: no role anywhere -> question 1 still asked ----------
await qa.context.clearCookies();
await qa.goto('/discovery', 'a different brand-new visitor opens /discovery directly');
await qa.expectText('label[for="q1-role"]', Q1, 'AC3: with no role anywhere, question 1 is still asked');
await qa.expectVisible('#q1-role', 'AC3: the role box is there to type into');
await qa.scrollThrough('read the question-1 screen');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
