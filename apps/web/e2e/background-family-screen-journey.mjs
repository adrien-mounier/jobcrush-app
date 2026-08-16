// #236 (spec #233, decided in #230) — the family-candidate screen that runs BY ITSELF while a
// word-search visitor browses her deck, and that she must never learn about.
//
// The ticket's behaviour is deliberately invisible, so the browser half of the gate is a negative
// one: on the path that now makes an extra model call, her screen must be exactly the screen she
// had before, and nothing about research, job families or vocabulary may appear on it.
//
// The real stack answers here (apps/api/dist/qa-main.js — real Fastify, real stores, real routes),
// and its fake model has NO branch for the candidate-screen prompt, so the screen THROWS. That is
// not a limitation of this run, it is the run's most valuable case: AC6 says a screen that errors
// persists nothing, is logged, and leaves the deck untouched — an internal fault never becomes a
// visible one. This journey proves exactly that end to end, and proves the watch really fired
// (qa-main's /qa/llm-calls `unknown` counter moves) rather than passing because nothing ran.
//
// NOT provable here: accepted / covered_role / equivalent need a screen that answers, i.e. a real
// model key. Those are covered by apps/api/test/familyCandidateIntake.test.ts.
//
// THIS IS A FAULT-PATH JOURNEY BY CONSTRUCTION. If qa-main.ts's fake ever gains a branch for the
// candidate-screen prompt, this file must be rewritten to the outcome that branch returns — the
// "nothing was persisted" assertions below would then be red for a good reason, not a bug.
//
// Run it:
//   PORT=34101 node apps/api/dist/qa-main.js                                  # API on :34101
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next dev -p 34878
//   BASE_URL=http://127.0.0.1:34878 node apps/web/e2e/background-family-screen-journey.mjs
//
// Ports are deliberately not 3000/3001 — another project on this machine defaults to those and the
// /api proxy would silently reach the wrong backend (SHARED_INFRA.md).

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34878';
const API = process.env.API_URL ?? 'http://127.0.0.1:34101';

// A role the published vocabulary cannot place — she gets the word search, so the screen runs.
const UNMAPPED_ROLE = 'sous vide pastry chef';
const AREA = 'Singapore';

// Words that must never reach her screen on this path.
const FORBIDDEN = ['job family', 'families', 'vocabulary', 'research', 'unmapped', 'word search', 'screening'];

const qa = await createSession('background-family-screen-journey', {
  baseURL: BASE,
  viewport: { width: 1280, height: 900 },
});
const { page } = qa;
page.setDefaultTimeout(20000);

let aborted = false;
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, async (e) => {
    console.error(`\n[${ev}]`, e?.stack ?? e);
    if (aborted) return;
    aborted = true;
    try { await qa.note(`RUN ABORTED (${ev}): ${e?.message ?? e}`); await qa.finish(); } catch {}
    process.exit(1);
  });
}

const assertTrue = (cond, note) => qa.expectText('body', cond ? '' : '-THIS-CANNOT-APPEAR-', note);

async function callAsVisitor(method, path, data) {
  const res = await page.request.fetch(`${BASE}/api${path}`, { method, ...(data ? { data } : {}) });
  const body = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { /* a non-JSON body is itself the finding */ }
  return { status: res.status(), body, json: parsed };
}
const json = async (path) => (await callAsVisitor('GET', path)).json;
const llmCalls = async () => (await (await page.request.fetch(`${API}/qa/llm-calls`)).json());

// =============================================================================================
// 1. A visitor whose target role no published family covers reaches her word-search deck.
// =============================================================================================
await qa.goto('/', 'the front door — where a real visitor starts');
await qa.scrollThrough('read the front door top to bottom, the way a first-time visitor would');

const ready = page.getByRole('button', { name: /Ready\?/ });
if (await ready.count()) await qa.click(ready.first(), 'open the front door');
const startQuestions = page.getByRole('button', { name: /Start questions instead/ });
if (await startQuestions.count()) await qa.click(startQuestions.first(), 'choose to start from questions');
if (await page.locator('#target-role').count()) {
  await qa.fill('#target-role', UNMAPPED_ROLE, `the role she is going for: "${UNMAPPED_ROLE}" — no published family covers it`);
  await qa.fill('#search-area', AREA, 'where she wants to work');
  await qa.click('button:has-text("Save and continue")', 'save what she wants next');
  await page.waitForTimeout(1200);
}

const intent = await json('/sessions/me/intent');
await assertTrue(
  intent?.intent?.targetRole === UNMAPPED_ROLE,
  `the front door recorded her target role (${JSON.stringify(intent?.intent?.targetRole)}) — the input the background screen judges`,
);

const before = await llmCalls();
await qa.note(`model calls before her deck loads: ${JSON.stringify(before)}`);

// =============================================================================================
// 2. Her deck. The background screen fires here — and fails, because this stack's model has no
//    answer for it. She must not be able to tell.
// =============================================================================================
await qa.goto('/deck', 'she opens her deck');
await page.waitForTimeout(2500);
await qa.scrollThrough('she reads the whole screen, top to bottom');

const deck = await callAsVisitor('GET', '/onboarding/cards');
await assertTrue(deck.status === 200, `AC5/AC6: her deck answers ${deck.status} — the deck she asked for, not an error`);

const after = await llmCalls();
await qa.note(`model calls after her deck loads: ${JSON.stringify(after)}`);
await assertTrue(
  after.unknown > before.unknown,
  `the background screen really ran on this path (unrecognised-prompt count ${before.unknown} -> ${after.unknown}) — this run proves a fault, not an absence`,
);

// AC6: nothing persisted, her plan untouched.
const learningReturn = await callAsVisitor('GET', '/family-learning/return');
await assertTrue(
  learningReturn.status === 404 || learningReturn.json?.attempt == null,
  `AC6: the failed screen recorded nothing against her session (${learningReturn.status} ${learningReturn.body.slice(0, 80)})`,
);
const production = await callAsVisitor('GET', '/onboarding/discovery/production');
await assertTrue(
  production.status === 409,
  `AC6: her plan is untouched — no family was pinned by a screen that never answered (${production.status} ${production.json?.error?.code})`,
);

// AC7: nothing on her screen, and nothing in the payload behind it, names any of this.
const bodyText = (await page.locator('body').innerText()).toLowerCase();
const leaked = FORBIDDEN.filter((word) => bodyText.includes(word));
if (leaked.length > 0) {
  await qa.expectVisible(
    `#screen-names-nothing-it-should-not-but-leaked-${leaked.join('-')}`,
    `FAIL (AC7): the screen names ${leaked.join(', ')}`,
  );
} else {
  await qa.note('PASS (AC7): no research, job family or vocabulary is named anywhere on her screen.');
}
const payloadLeak = FORBIDDEN.filter((word) => deck.body.toLowerCase().includes(word));
await assertTrue(
  payloadLeak.length === 0,
  `AC7: the deck payload behind the screen names none of it either${payloadLeak.length ? ` — leaked: ${payloadLeak.join(', ')}` : ''}`,
);

// AC5/AC6: she can still work her deck — a second load is the same screen, still hers.
await qa.goto('/deck', 'she reloads her deck, the way anyone does');
await page.waitForTimeout(2000);
await qa.scrollThrough('the second look at her deck — unchanged');
const deck2 = await callAsVisitor('GET', '/onboarding/cards');
await assertTrue(deck2.status === 200, `AC5: her deck still answers ${deck2.status} on a second visit`);
await assertTrue(
  (await callAsVisitor('GET', '/onboarding/discovery/production')).status === 409,
  'AC6: still no family pinned behind her back after a second deck load',
);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
