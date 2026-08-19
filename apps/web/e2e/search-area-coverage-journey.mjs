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

async function submitArea(area) {
  await qa.fill('#search-area', area, `type the search area exactly as a person would: "${area}"`);
  await qa.click('button:has-text("Save and continue")', 'save and continue');
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

for (const [typed, label, why] of VARIANTS) {
  await freshVisitor();
  await openIntent('IT project manager');
  await submitArea(typed);
  await qa.expectText(
    '.intent-confirmation',
    `We’ll look for IT project manager in ${label}.`,
    `${why} — confirmed back as "${label}"`,
  );
  await qa.goto('/', `reload after "${typed}"`);
  await qa.expectText(
    '.intent-confirmation',
    `We’ll look for IT project manager in ${label}.`,
    `the canonical label "${label}" survives a reload, never the raw typed text`,
  );
}

// ---------- AC4: one location signal — the work-rights question follows the search area ----------

await freshVisitor();
await openIntent('IT project manager in Paris'); // the role names a DIFFERENT city on purpose
await submitArea('Hong Kong');
await qa.expectText(
  '.intent-confirmation',
  'in Hong Kong.',
  'AC4 setup: the search area resolved to Hong Kong while the role text says Paris',
);

await qa.goto('/discovery', 'walk on into discovery');
await qa.fill('#q1-role', 'IT project manager in Paris', 'answer Q1 with a role naming Paris again');
await qa.click('button.go.wide', "confirm the role — \"That's me\"");
await qa.scrollThrough('read the page the way a person would');
// #214 owner decision: the promise sentence names NO place — with up to 3 selected places, naming
// one was a half-truth. The location signal is proven by the work-rights question below instead.
await qa.expectText('body', 'new jobs are open right now', 'the discovery promise counts jobs without naming a place');
await expectAbsent(
  page.getByText('jobs are open in', { exact: false }),
  'AC4 (#214): the promise never names one place while several can be selected',
);

// Answer the questions one at a time, the way the screen serves them, until the work-rights
// question is the one on screen.
const workRights = page.locator('.opts[data-elig="work-rights"]');
// #216: the researched floor mixes tap-an-option and type-your-own items, so a loop that only
// clicks `.opts .opt` stalls on the free-text ones. answerVisibleQuestion handles both shapes.
for (let i = 0; i < 8 && (await workRights.count()) === 0; i += 1) {
  const answered = await qa.answerVisibleQuestion({
    note: `answer the question on screen (step ${i + 1}) to reach work rights`,
  });
  if (!answered) break;
}
await qa.expectVisible(workRights, 'the work-rights question is now the one being asked');
await qa.expectText(
  'body',
  'Can you already work in Hong Kong without visa sponsorship?',
  'AC4: the work-rights question asks about the RESOLVED SEARCH AREA, not the role text',
);
await expectAbsent(
  page.getByText('Can you already work in Paris without visa sponsorship?'),
  'AC4: the two location signals can no longer disagree',
);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
