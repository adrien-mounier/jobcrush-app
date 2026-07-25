// #30 — "/tailor is never a dead end", the full journey over a REAL stack.
//
// tailor.spec.ts covers the signed-out redirect with route mocks. This drives the same ground with
// nothing stubbed except the two deliberate failure injections in part 5 (a 500 and a dropped
// connection — the errors that MUST still reach the retry screen, proving the fix routes away from
// the unretryable 401 without swallowing the retryable ones).
//
// Covers all three of #30's acceptance criteria plus the two traps the fix could relocate:
//   1. a cold signed-out visitor on /tailor  -> /deck -> "See them" -> the wall (AC1)
//   2. Back after that redirect escapes the site instead of bouncing forward again (router.replace)
//   3. a signed-in visitor with no tailor target -> /deck, unchanged (AC2)
//   4. a signed-in visitor mid-tailor -> the tailor screen loads, unchanged (AC3)
//   5. a 500 and a network drop on the same endpoint -> the retry screen is still reachable
//
// Needs no ANTHROPIC_API_KEY — every route it touches is arithmetic over the E5 stub fixtures.
//
//   PORT=30181 node apps/api/dist/main.js
//   API_URL=http://127.0.0.1:30181 npx next build && npx next start -p 30180   (from apps/web)
//   BASE_URL=http://127.0.0.1:30180 node apps/web/e2e/tailor-signedout-journey.mjs
//
// Env: QA_HEADED=1 to watch, QA_PAUSE_MS to change pacing, BASE_URL to point elsewhere.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const EMAIL = `tailor-signedout-${Date.now()}@example.com`;
const ERROR_COPY = "Couldn't open this job.";

const qa = await createSession('tailor-signedout', { baseURL: BASE, viewport: { width: 430, height: 932 } });
const { page } = qa;

// Record a pass/fail into the report without aborting the run (tailor-journey.mjs's own idiom):
// '' is always contained (pass); the sentinel never is (fail).
const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE- ', note);
const path = () => new URL(page.url()).pathname;

// ---------------------------------------------------------------------------------------------
// 1. AC1 — a cold, signed-out visitor opens /tailor directly. No cookies, no session, no referrer:
//    exactly the "pasted the link" case the ticket is about.
// ---------------------------------------------------------------------------------------------
await qa.note('cold start: no cookies, no session — a signed-out visitor pasting /tailor');
await page.context().clearCookies();

// Sample the error copy WHILE the page settles, so a flash of the dead end would be caught too.
const deadEndFlashed = page
  .getByText(ERROR_COPY)
  .waitFor({ state: 'visible', timeout: 6000 })
  .then(() => true)
  .catch(() => false);

await qa.goto('/tailor', 'AC1: open /tailor directly while signed out');
const redirected = await page
  .waitForURL('**/deck', { timeout: 10_000 })
  .then(() => true)
  .catch(() => false);

await assert(redirected, `AC1: /tailor routed away — landed on ${path()} (expected /deck)`);
await assert(!(await deadEndFlashed), `AC1: the retry-only error state never appeared (not even a flash)`);
await qa.expectVisible('.jobdeck', 'AC1: the deck screen rendered, not an error');
await qa.expectVisible(page.getByRole('heading', { name: /matched you/ }), 'AC1: the reveal headline is what the visitor meets');
await qa.scrollThrough('read the reveal the way a visitor would');

// ---------------------------------------------------------------------------------------------
// 2. AC1 continued — the destination is not a NEW dead end: the wall is genuinely reachable and
//    offers Google first, per spec §12.
// ---------------------------------------------------------------------------------------------
await qa.click(page.getByRole('button', { name: 'See them' }), 'AC1: "See them" — the wall gate');
await qa.expectVisible(page.getByRole('link', { name: 'Continue with Google' }), 'AC1: the wall offers "Continue with Google" (spec §12: Google leads)');
await qa.expectVisible(page.getByRole('button', { name: 'Email me a sign-in link' }), 'AC1: the magic link is offered as the secondary door');
await qa.scrollThrough('read the wall');

// ---------------------------------------------------------------------------------------------
// 3. The relocated-dead-end trap the fix was written for: router.replace, not push. Back from the
//    redirect must NOT return to /tailor and bounce forward again.
// ---------------------------------------------------------------------------------------------
await qa.note('Back-button trap: come to /tailor FROM another page, so there is real history behind it');
await qa.goto('/discovery', 'start somewhere real (/discovery)');
await qa.goto('/tailor', 'navigate on to /tailor (signed out) — history is now [/discovery, /tailor]');
await page.waitForURL('**/deck', { timeout: 10_000 }).catch(() => {});

// The assertion is `=== '/discovery'`, not `!== '/tailor'`, on purpose: with router.push the Back
// press lands on /tailor and is immediately bounced forward to /deck again, so a `!== '/tailor'`
// check would read /deck a moment later and pass on the very bug it is meant to catch.
await qa.note(`after the redirect the visitor is on ${path()} — now press Back`);
await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(2500); // give any forward-bounce time to happen before we judge
const afterBack = path();
await assert(afterBack === '/discovery', `Back escaped to ${afterBack} — expected /discovery (router.replace left no /tailor entry to bounce off)`);
await qa.expectVisible('body', `Back landed on ${afterBack}`);

// ---------------------------------------------------------------------------------------------
// 4. Sign in over the real magic-link path, then AC2 and AC3.
// ---------------------------------------------------------------------------------------------
await qa.goto('/deck', 'back to the deck to sign in for real');
const seeded = await page.evaluate(async (email) => {
  const post = (url, body) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const res = await post('/api/auth/request-link', { email });
  const link = await res.json();
  // /auth/request-link is rate-limited 5 per 15 min per IP — surface a 429 as itself rather than
  // letting every later step fail in a confusing way.
  if (!link.devLink) return `sign-in failed (${res.status}): ${JSON.stringify(link)}`;
  const token = new URL('http://x' + link.devLink).searchParams.get('token');
  const v = await post('/api/auth/verify', { token });
  return v.ok ? 'ok' : `verify failed (${v.status})`;
}, EMAIL);
if (seeded !== 'ok') throw new Error(`could not sign in: ${seeded}`);
await qa.note(`signed in as ${EMAIL} over the real magic-link path`);

// --- AC2: signed in, but nothing is being tailored -> still /deck, unchanged -------------------
const ac2DeadEnd = page
  .getByText(ERROR_COPY)
  .waitFor({ state: 'visible', timeout: 6000 })
  .then(() => true)
  .catch(() => false);
await qa.goto('/tailor', 'AC2: signed in with NO job being tailored, open /tailor');
const ac2Redirected = await page
  .waitForURL('**/deck', { timeout: 10_000 })
  .then(() => true)
  .catch(() => false);
await assert(ac2Redirected, `AC2: no tailor target still redirects to /deck — landed on ${path()}`);
await assert(!(await ac2DeadEnd), 'AC2: no error state on the way (the 409 path is unchanged)');
await qa.expectVisible('.jobdeck', 'AC2: the deck rendered');

// --- AC3: signed in, mid-tailor -> the tailor screen loads, unchanged --------------------------
const adId = await page.evaluate(async () => {
  const cards = await (await fetch('/api/onboarding/cards')).json();
  const id = cards.cards?.[0]?.adId;
  if (!id) return null;
  const want = await fetch(`/api/onboarding/cards/${encodeURIComponent(id)}/want`, { method: 'POST' });
  return want.ok ? id : null;
});
if (!adId) throw new Error('could not set a tailor target — AC3 cannot be driven');
await qa.note(`tailor target set to "${adId}" over the real /want route`);

await qa.goto('/tailor', 'AC3: signed in mid-tailor, open /tailor');
await page.waitForTimeout(1200);
await assert(path() === '/tailor', `AC3: stayed on /tailor (no redirect) — url is ${path()}`);
await qa.expectVisible('.jobdeck.tailor', 'AC3: the tailor screen mounted');
await qa.expectVisible('.tailor .live-card h2', 'AC3: the job title heads the live card');
await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'AC3: the score ring renders');
await qa.expectVisible('.tailor .q', 'AC3: the question dock is asking');
await qa.expectVisible(page.getByRole('button', { name: "I'm done — use this CV" }), 'AC3: the exits are intact');

// ---------------------------------------------------------------------------------------------
// 5. The fix must NOT have swallowed every error into a redirect. A 500 and a dropped connection
//    are retryable — the generic error state has to still be reachable, and retry has to work.
// ---------------------------------------------------------------------------------------------
await qa.note('inject a 500 on GET /onboarding/tailor — a retryable error must still reach the retry screen');
await page.route('**/api/onboarding/tailor', (route) =>
  route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal_error', message: 'boom' } }) }),
);
await qa.goto('/tailor', 'open /tailor with the endpoint 500ing');
await page.waitForTimeout(1500);
await assert(path() === '/tailor', `a 500 does NOT redirect — still on ${path()}`);
await qa.expectVisible(page.getByText(ERROR_COPY), 'a 500 still shows the retryable error state');
await qa.expectVisible(page.getByRole('button', { name: 'Try again' }), '"Try again" is offered for an error that CAN succeed on retry');

await qa.note('now a dropped connection (no code at all) — same requirement');
await page.unroute('**/api/onboarding/tailor');
await page.route('**/api/onboarding/tailor', (route) => route.abort('connectionfailed'));
await qa.click(page.getByRole('button', { name: 'Try again' }), 'retry into a network failure');
await page.waitForTimeout(1500);
await assert(path() === '/tailor', `a network failure does NOT redirect — still on ${path()}`);
await qa.expectVisible(page.getByText(ERROR_COPY), 'a network failure still shows the retryable error state');

await qa.note('lift the failure and retry for real — the retry screen must actually recover');
await page.unroute('**/api/onboarding/tailor');
await qa.click(page.getByRole('button', { name: 'Try again' }), 'retry with the API healthy again');
await page.waitForTimeout(1500);
await qa.expectVisible('.jobdeck.tailor', 'retry recovered onto the real tailor screen — the error state is honest');
await qa.scrollThrough('final read of the recovered tailor screen');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
