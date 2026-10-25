// #428 (owner's call, 2026-10-24: "the CV and its suggestions arrive at once") — human-paced, over a
// REAL stack (live Fastify API on the fake-model QA entry, real job record, real event stream through
// the Next proxy, real draft reads). At a computer (1280px) and a phone (390px):
//   - while the server says the stretch step is running ("suggesting"), the wait screen stays and
//     nothing of the draft is read or shown;
//   - when the job completes, the CV and "Suggestion 1 of N" land in the SAME screen update, and the
//     "Ready to send" summary never shows (the owner's staging defect: every suggestion "Not answered,
//     left out");
//   - a reload lands the same way (the checkpoint path, no job);
//   - computer only: after a failed step, "Look again" opens the first suggestion it finds.
//
// The "suggesting" phase is only observable when the stretch step takes time. qa-main's fake answers
// in milliseconds, so the job usually completes before the browser's stream connects; the journey then
// notes that and still checks the landing. Set QA_EXPECT_SUGGESTING=1 to make an unobserved phase a
// failure — the #428 gate ran qa-main with its fake stretch step held for 15s by an in-memory ESM load
// hook (`node --import <hook> apps/api/dist/qa-main.js`, QA_STRETCH_DELAY_MS=15000), or point it at
// staging, where the real step takes ~40s.
//
// The failed step cannot be produced by the fake model, so step 5 rewrites ONE draft read in the
// browser to a failed step; "Look again" then goes to the real server, unrewritten.
//
//   PORT=34101 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34100
//   BASE_URL=http://127.0.0.1:34100 node e2e/stretch-arrive-at-once-journey.mjs
//
// Env: QA_HEADED=1 to watch, QA_PAUSE_MS to change pacing, BASE_URL to point elsewhere.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const EXPECT_SUGGESTING = process.env.QA_EXPECT_SUGGESTING === '1';
const ROLE = 'IT project manager in Paris';
const WAIT_LINE = 'Writing your CV for this job…';
const FAILED_LINE = 'We could not look for ways to stretch this CV just now.';

const qa = await createSession('stretch-arrive-at-once-journey', { baseURL: BASE, viewport: { width: 1280, height: 800 } });
const { page, context } = qa;

// Record a pass/fail without aborting the run ('' is always contained; the sentinel never is).
const assert = (cond, note) => qa.expectText('body', cond ? '' : '\u0000-IMPOSSIBLE-', note);
// In-page reads use the untapped fetch, so they never count as the screen reading the draft.
const api = (path) => page.evaluate(async (p) => (await (window.__qaFetch ?? fetch)(p)).json(), path);
const tap = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__qa428)));

// The tap, in every document: each job-stream message (with what the screen showed a beat later), each
// draft read the SCREEN makes, and the moment the CV frame, the first card, "Ready to send" and the
// retired "Looking for ways…" line first entered the page.
await context.addInitScript(() => {
  const fresh = () => ({ events: [], draftReads: [], frameAt: null, cardAt: null, cardLabel: null, readySeen: false, lookingSeen: false });
  window.__qa428 = fresh();
  window.__qa428reset = () => (window.__qa428 = fresh());
  const w = () => window.__qa428;
  const screen = () => ({
    wait: !!document.querySelector('.draft-wait-line'),
    frame: !!document.querySelector('.draft-frame'),
    card: !!document.querySelector('section.stretch-card'),
  });
  const NativeES = window.EventSource;
  window.EventSource = class extends NativeES {
    constructor(url, opts) {
      super(url, opts);
      this.addEventListener('message', (e) => {
        let s = null;
        try { s = JSON.parse(e.data); } catch { /* recorded as null */ }
        const ev = { at: performance.now(), url: String(url), status: s?.status ?? null, step: s?.progress?.tailorDraft?.step ?? null };
        w().events.push(ev);
        setTimeout(() => (ev.after = screen()), 400);
      });
    }
  };
  const nativeFetch = window.fetch.bind(window);
  window.__qaFetch = nativeFetch;
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = String(init?.method ?? (typeof input === 'object' ? input.method : 'GET') ?? 'GET').toUpperCase();
    if (/\/api\/onboarding\/tailor\/draft(\?|$)/.test(url) && method === 'GET') w().draftReads.push({ at: performance.now(), url });
    return nativeFetch(input, init);
  };
  const check = () => {
    const now = performance.now();
    if (w().frameAt === null && document.querySelector('.draft-frame')) w().frameAt = now;
    const card = document.querySelector('section.stretch-card[aria-label^="Suggestion 1 of"]');
    if (w().cardAt === null && card) {
      w().cardAt = now;
      w().cardLabel = card.getAttribute('aria-label');
    }
    if (document.querySelector('section.stretch[aria-labelledby]')) w().readySeen = true;
    if (document.body?.textContent?.includes('Looking for ways to stretch')) w().lookingSeen = true;
  };
  new MutationObserver(check).observe(document, { childList: true, subtree: true, characterData: true });
});

async function readThrough(note) {
  await qa.note(note);
  await page.evaluate(async () => {
    const el = document.querySelector('.tailor .dgrid') ?? document.scrollingElement;
    for (let y = 0; y < el.scrollHeight; y += 260) {
      el.scrollTo({ top: y, behavior: 'smooth' });
      await new Promise((r) => setTimeout(r, 260));
    }
    el.scrollTo({ top: 0, behavior: 'smooth' });
  });
  await page.waitForTimeout(900);
}

/** A fresh person: her CV read and reviewed, signed in, a job taken from the deck, on /tailor. */
async function freshPersonOnTailor(label) {
  await context.clearCookies();
  await qa.goto('/discovery', `${label}: land on discovery — a new anonymous session`);
  await page.waitForTimeout(700);
  await page.evaluate(
    async ({ role }) =>
      fetch('/api/onboarding/discovery/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }) }).then(() => undefined),
    { role: ROLE },
  );
  const facts = await qa.factsFromCv();
  if (!(facts > 0)) throw new Error(`her CV gave the session no facts (${facts})`);
  const email = `arrive-at-once-${label}-${Date.now()}@example.com`;
  const seeded = await page.evaluate(async ({ email }) => {
    const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const res = await post('/api/auth/request-link', { email });
    const link = await res.json();
    if (!link.devLink) return `sign-in failed (${res.status}): ${JSON.stringify(link)}`;
    await post('/api/auth/verify', { token: new URL('http://x' + link.devLink).searchParams.get('token') });
    return 'ok';
  }, { email });
  if (seeded !== 'ok') throw new Error(`could not seed the session: ${seeded}`);
  await qa.note(`${label}: her CV was read and reviewed (${facts} facts); signed in`);

  await qa.goto('/deck', `${label}: the reveal`);
  const seeThem = page.getByRole('button', { name: 'See them' });
  if (await seeThem.count()) await qa.click(seeThem, `${label}: See them`);
  await qa.expectVisible(page.getByRole('img', { name: /% match/ }), `${label}: the first card renders with its score`);
  const title = (await page.locator('.jobcard h2').first().textContent()).trim();
  await page.evaluate(() => window.__qa428reset());
  await qa.click(page.getByRole('button', { name: 'I want this one, tailor this job' }), `${label}: I want this one ("${title}")`);
  await page.waitForURL('**/tailor', { timeout: 15_000 });
  // A profile question this job may leave open is answered once; then the CV is written by itself.
  await page.waitForTimeout(500);
  if ((await page.locator('.tailor .ask .q').count()) > 0) {
    await qa.click(page.locator('.tailor .opts .opt').first(), `${label}: a profile question this job left open — answer it once`);
  }
  return title;
}

/** The core claim: the wait screen through "suggesting", then the CV and its first card at once. */
async function waitThenAtOnce(label) {
  const sawSuggesting = await page
    .waitForFunction(() => window.__qa428.events.some((e) => e.step === 'suggesting') || window.__qa428.cardAt !== null, null, { timeout: 90_000, polling: 100 })
    .then(() => page.evaluate(() => window.__qa428.events.some((e) => e.step === 'suggesting')))
    .catch(() => false);

  if (sawSuggesting) {
    await page.waitForTimeout(450); // let the screen answer the message
    await qa.note(`${label}: the server says the stretch step is running ("suggesting") — the job is not complete yet`);
    await qa.expectText('.draft-wait-line', WAIT_LINE, `${label}: AC1 — the wait screen stays while the step runs`);
    await assert((await page.locator('.draft-frame').count()) === 0, `${label}: AC1 — no CV on the page yet`);
    await assert((await page.locator('section.stretch-card, section.stretch').count()) === 0, `${label}: AC1 — no suggestion card, no "Ready to send", no step notice in the rail`);
    await readThrough(`${label}: she scrolls while she waits`);
    const mid = await tap();
    await assert(mid.draftReads.length === 0, `${label}: AC1 — nothing of the draft has been read (${mid.draftReads.length} reads)`);
    await qa.expectText('.draft-wait-line', WAIT_LINE, `${label}: AC1 — still the wait screen a few seconds on`);
    const done = (await tap()).events.some((e) => e.status === 'completed');
    await assert(!done, `${label}: the step was still running when the wait screen was checked`);
  } else {
    await qa.note(`${label}: "suggesting" never reached the browser — the job completed before its stream connected (a fast fake). The landing is still checked.`);
    await assert(
      !EXPECT_SUGGESTING,
      EXPECT_SUGGESTING ? `${label}: QA_EXPECT_SUGGESTING=1 — the "suggesting" phase was NOT observed live` : `${label}: QA_EXPECT_SUGGESTING unset — an unobserved "suggesting" phase is allowed on this stack`,
    );
  }

  const card = page.getByRole('region', { name: /^Suggestion 1 of \d+$/ });
  await card.waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
  await qa.expectVisible(card, `${label}: AC2 — the first suggestion's card is open`);
  await qa.expectVisible('.draft-frame', `${label}: AC2 — and the CV is on the page`);
  await assert((await page.getByRole('region', { name: /Ready to send|not used — your CV keeps its own lines/ }).count()) === 0, `${label}: AC2 — "Ready to send" is not shown`);
  const t = await tap();
  const delta = t.cardAt !== null && t.frameAt !== null ? Math.abs(t.cardAt - t.frameAt) : null;
  await assert(delta !== null && delta < 50, `${label}: AC2 — the CV and "${t.cardLabel}" entered the page in the same update (${delta === null ? 'one never appeared' : `${delta.toFixed(1)}ms apart`})`);
  await assert(!t.readySeen, `${label}: AC2 — "Ready to send" never appeared, not even for a moment`);
  await assert(!t.lookingSeen, `${label}: the retired "Looking for ways to stretch it…" line never appeared`);
  if (sawSuggesting) {
    const completedAt = t.events.find((e) => e.status === 'completed')?.at ?? Infinity;
    const firstRead = t.draftReads[0]?.at ?? -Infinity;
    await assert(firstRead >= completedAt, `${label}: AC1 — the first draft read came only after the job completed`);
    const midStep = t.events.filter((e) => e.step === 'suggesting');
    await assert(midStep.every((e) => e.after?.wait && !e.after?.frame && !e.after?.card), `${label}: AC1 — after each "suggesting" message the screen was the wait screen (${JSON.stringify(midStep.map((e) => e.after))})`);
  }
  await qa.note(`${label}: stream ${JSON.stringify(t.events.map((e) => `${e.status}${e.step ? `/${e.step}` : ''}`))}; screen draft reads ${t.draftReads.length}`);

  const view = await api('/api/onboarding/tailor/draft');
  const n = view.stretch?.status === 'ran' ? view.stretch.suggestions.length : 0;
  await assert(n > 0 && t.cardLabel === `Suggestion 1 of ${n}`, `API: the step ran and found ${n} suggestion(s); the card counts the same`);
  const src = await page.locator('.draft-frame').getAttribute('srcdoc');
  await assert(src.includes('<ins>'), `${label}: the open suggestion previews in place on the CV`);
  await readThrough(`${label}: she reads the CV and the suggestion beside (or under) it`);
  await qa.expectVisible(card, `${label}: the suggestion is still open after reading`);
}

// ---------------------------------------------------------------------------------------------
// 1. Computer.
// ---------------------------------------------------------------------------------------------
await freshPersonOnTailor('computer');
await waitThenAtOnce('computer');

// 2. A reload lands the same way (the checkpoint is current: no job, no stream).
await page.evaluate(() => window.__qa428reset());
await qa.goto('/tailor', 'computer: she reloads the page');
const reloadCard = page.getByRole('region', { name: /^Suggestion 1 of \d+$/ });
await reloadCard.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
await qa.expectVisible(reloadCard, 'reload: the first suggestion is open again');
const r = await tap();
await assert(r.frameAt !== null && r.cardAt !== null && Math.abs(r.cardAt - r.frameAt) < 50, `reload: the CV and the card arrived together (${r.frameAt !== null && r.cardAt !== null ? `${Math.abs(r.cardAt - r.frameAt).toFixed(1)}ms` : 'missing'})`);
await assert(!r.readySeen, 'reload: "Ready to send" never appeared');

// 3. AC3: a failed step, then "Look again". The fake model cannot fail the step, so the FIRST draft
//    read after this reload is rewritten in the browser to a failed step; Look again is real.
let rewrites = 0;
await page.route('**/api/onboarding/tailor/draft**', async (route) => {
  if (route.request().method() !== 'GET' || rewrites > 0) return route.continue();
  rewrites += 1;
  const res = await route.fetch();
  const body = await res.json();
  return route.fulfill({ response: res, json: { ...body, stretch: { status: 'failed' } } });
});
await qa.goto('/tailor', 'computer: she comes back to a job whose suggestion step had failed');
const failed = page.getByRole('status').filter({ hasText: FAILED_LINE });
await failed.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
await qa.expectVisible(failed, 'AC3 setup: the rail says the step could not look, with "Look again"');
await qa.expectVisible('.draft-frame', 'AC3 setup: the CV stands (it is complete without suggestions)');
await assert((await page.locator('section.stretch-card').count()) === 0, 'AC3 setup: no suggestion is open');
await qa.click(page.getByRole('button', { name: 'Look again' }), 'AC3: she presses Look again');
const againCard = page.getByRole('region', { name: /^Suggestion 1 of \d+$/ });
await againCard.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
await qa.expectVisible(againCard, 'AC3: Look again opens the first suggestion it finds');
await assert((await page.getByRole('region', { name: /Ready to send|not used — your CV keeps its own lines/ }).count()) === 0, 'AC3: "Ready to send" is not shown');
await assert(rewrites === 1, `AC3: exactly one read was rewritten to a failure (${rewrites}); Look again read the real server`);
await page.unroute('**/api/onboarding/tailor/draft**');

// ---------------------------------------------------------------------------------------------
// 4. Phone (390px): the rail sits under the CV; the same claim, a new person.
// ---------------------------------------------------------------------------------------------
await page.setViewportSize({ width: 390, height: 844 });
await freshPersonOnTailor('phone');
await waitThenAtOnce('phone');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
