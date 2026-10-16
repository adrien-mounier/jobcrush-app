// #184 (#172) — search-area validation at entry, driven against the REAL stack.
//
// No route mocking: this flow exists to prove the SERVER-SIDE coverage gate, which the mocked
// front-door.spec.ts cannot. Run it with the real API + a built web app:
//   PORT=3011 node apps/api/dist/main.js
//   API_URL=http://127.0.0.1:3011 pnpm --filter @jobcrush/web build && npx next start -p 3010
//   BASE_URL=http://127.0.0.1:3010 node apps/web/e2e/search-area-coverage-journey.mjs
//
// Covers: AC1 (uncovered area blocked at the intent step, and STILL blocked after a cold reload —
// the slice's worst defect), AC2 (trailing country / alias / punctuation variants resolve and
// confirm with the canonical chip label, across a reload), AC5 (the placeholder example typed
// verbatim resolves), AC4 (the work-rights question's city is the resolved search area, never the
// city named in the role text).
//
// #214 updates (the amendment on #124's trail supersedes parts of #184's original expectations):
// - a typed CITY confirms back as the CITY label ("Sydney"), no longer its country;
// - an uncovered entry is REFUSED, never stored — so a cold reload shows a clean form with nothing
//   kept, rather than re-showing the coverage line for a stored-but-uncovered value;
// - the placeholder is "e.g. Hong Kong" (remote is not a location).

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3010';
const COVERAGE_LINE =
  'JobCrush is in early access — we currently cover Hong Kong, Singapore, Vietnam and Australia.';

const qa = await createSession('search-area-coverage', { baseURL: BASE });
const page = qa.page;

// An absence assertion that records a real PASS/FAIL in the report: `body` filtered to the case
// where it does NOT contain the given locator resolves to zero elements when the thing IS present,
// which fails the visibility check.
const expectAbsent = (inner, note) =>
  qa.expectVisible(page.locator('body').filter({ hasNot: inner }), note);

async function freshVisitor() {
  await qa.context.clearCookies();
  await qa.goto('/', 'a brand-new visitor lands on the front door');
}

async function openIntent(role) {
  await qa.click('button:has-text("Ready?")', 'open the front door');
  await qa.click('button:has-text("Start questions instead")', 'choose to start from questions');
  await qa.fill('#target-role', role, `type the target role: "${role}"`);
}

async function submitArea(area, { raw = false } = {}) {
  await qa.fill('#search-area', area, `type the search area exactly as a person would: "${area}"`);
  // #392: `raw` when the save walks on to discovery, which moves on by itself ~3 s later — a paced
  // qa.click (~1 s pause + screenshot) would miss the screen the caller reads next.
  if (raw) await page.click('button:has-text("Save and continue")');
  else await qa.click('button:has-text("Save and continue")', 'save and continue');
}

// ---------- AC1: an uncovered area is answered on the spot and never passes onward ----------

await freshVisitor();
await qa.scrollThrough('read the front door top to bottom');
await openIntent('IT project manager in Paris');
await qa.expectVisible(
  page.locator('#search-area[placeholder="e.g. Hong Kong"]'),
  'AC5 (#214): the placeholder suggests only a covered market — remote is not a location',
);
await submitArea('Bangkok');
await qa.expectText('.intent-coverage', COVERAGE_LINE, 'AC1: the early-access line shows at the intent step');
await expectAbsent(page.getByRole('heading', { name: 'Got it.' }), 'AC1: the visitor never advances past the intent step');
await qa.expectVisible('#search-area', 'the typed area is kept so it can be corrected');

await qa.goto('/', 'RELOAD the page — the worst defect this slice had');
await expectAbsent(page.getByRole('heading', { name: 'Got it.' }), 'AC1 reload: still blocked after a cold reload');
await expectAbsent(page.getByText('Bangkok', { exact: false }).locator('xpath=ancestor-or-self::p[contains(@class,"intent-confirmation")]'), 'AC1 reload: never "We’ll look for … in Bangkok"');
// #214: a refused entry is never stored, so a cold reload shows a clean form — no chip, no stored
// "Bangkok" anywhere — rather than re-showing the coverage line for a kept-but-uncovered value.
await expectAbsent(page.getByText('Bangkok', { exact: false }), 'AC1 reload (#214): the refused entry was never stored — nothing to re-display');
await qa.expectVisible('#search-area', 'the area field is still on screen for a correction');

// Adversarial: can the gate be walked around by going straight to the next screen? Recorded as
// evidence rather than asserted — the ticket puts the gate at the intent step, and the point here is
// that the uncovered area must not have become a location signal further in.
await qa.goto('/discovery', 'try to walk around the gate: go straight to discovery with Bangkok stored');
await qa.note('what a visitor sees when they skip the front door with an uncovered area stored');
await expectAbsent(
  page.getByText('Bangkok', { exact: false }),
  'the uncovered area never became a location signal on the next screen',
);

// ---------- AC2 + AC5: covered variants resolve to the canonical market, reload included ----------

// #214: a typed CITY now confirms back as the CITY label ("Sydney"), a country/alias as the market.
const VARIANTS = [
  ['hong kong,', 'Hong Kong', 'AC2: lowercase with a trailing comma'],
  ['Sydney, Australia', 'Sydney', 'AC2 (#214): a city with a trailing country keeps its city label'],
  ['HK', 'Hong Kong', 'AC2: a common alias'],
  ['Ho Chi Minh City, Vietnam.', 'Ho Chi Minh City', 'AC2 (#214): city + trailing country + a full stop keeps its city label'],
  ['Hong Kong', 'Hong Kong', 'AC5: the placeholder example, typed verbatim'],
  ['Remote in Vietnam', 'Vietnam', 'AC2: a remote phrasing still resolves to its market (remote is not a location)'],
];

// #257: a covered save advances her to discovery on its own, whose wait (#392) shows the confirmation
// sentence above the count before moving on by itself — read there with raw page calls; the stored
// label (intent.searchAreas[].label) is also checked server-side, as the server re-resolves it.
const savedAreas = () =>
  page.evaluate(async () => (await (await fetch('/api/sessions/me/intent')).json())?.intent?.searchAreas?.map((a) => a.label) ?? []);
const assertTrue = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
for (const [typed, label, why] of VARIANTS) {
  await freshVisitor();
  await openIntent('IT project manager');
  await submitArea(typed, { raw: true });
  await page.waitForURL(/\/discovery/);
  const shown = await page.locator('.intent-context').textContent({ timeout: 10_000 }).catch(() => null);
  await assertTrue(
    shown === `We’ll look for IT project manager in ${label}.`,
    `${why} — confirmed back as "${label}" on the discovery wait ("${shown}")`,
  );
  const areas = await savedAreas();
  await assertTrue(
    JSON.stringify(areas) === JSON.stringify([label]),
    `${why} — stored and read back as "${label}", never the raw typed text (${JSON.stringify(areas)})`,
  );
}

// ---------- AC4: one location signal — the work-rights question follows the search area ----------

await freshVisitor();
await openIntent('IT project manager in Paris'); // the role names a DIFFERENT city on purpose
await submitArea('Hong Kong', { raw: true });
await page.waitForURL(/\/discovery/); // #257: the save itself walks her on into discovery
// #322: the front door already took the role, so discovery opens without question 1 (and, #376,
// without any other question). #392: it shows only the job count, then moves on by itself (~2 s) —
// so the count is read with raw page calls before it goes, and the rest is asserted after.
await page.locator('.promise:not(.blind) p').waitFor({ timeout: 20_000 });
const countText = await page.locator('.promise').innerText();
const askedHere = await page.locator('.discovery .opts').count();
await page.waitForURL(/\/(deck|profile\/check)/, { timeout: 30_000 });
const areasAc4 = await savedAreas();
await assertTrue(
  JSON.stringify(areasAc4) === JSON.stringify(['Hong Kong']),
  `AC4 setup: the search area resolved to Hong Kong while the role text says Paris (${JSON.stringify(areasAc4)})`,
);
// #214 owner decision: the promise sentence names NO place — with up to 3 selected places, naming
// one was a half-truth. The location signal is proven by the work-rights question below instead.
await assertTrue(
  countText.includes('like yours found.') && !/hong kong|paris|jobs are open in/i.test(countText),
  `AC4 (#214): the discovery count names no place ("${countText.replace(/\s+/g, ' ').trim()}")`,
);

// #376 (ADR-0018 clause 8): discovery asks nothing after question 1 — work rights are a row on
// check mode's "Where you can work" card. The row is for the RESOLVED SEARCH AREA, never the role text.
await assertTrue(askedHere === 0, `#376: discovery asked nothing more and moved on by itself to ${new URL(page.url()).pathname} (#392)`);
await qa.goto('/profile/check', 'her profile in check mode, where work rights are asked now');
const checkHeading = page.getByRole('heading', { level: 1 });
for (let i = 0; i < 10 && (await checkHeading.innerText()) !== 'Additional information'; i += 1) {
  const before = await checkHeading.innerText();
  await qa.click('.foot .primary', `Next, from "${before}"`);
  await page.waitForFunction((t) => document.querySelector('h1')?.textContent !== t, before);
}
await qa.expectVisible('.wrrow', 'the work-rights row is the one being asked');
await qa.expectText('.wrrow legend', 'Hong Kong', 'AC4: the work-rights row asks about the RESOLVED SEARCH AREA, not the role text');
await expectAbsent(page.locator('.wrrow legend', { hasText: 'Paris' }), 'AC4: the two location signals can no longer disagree');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
