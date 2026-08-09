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
// confirm with the canonical market name, across a reload), AC5 (both placeholder examples typed
// verbatim resolve), AC4 (the work-rights question's city is the resolved search area, never the
// city named in the role text).

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
  page.locator('#search-area[placeholder="e.g. Hong Kong, or Remote in Vietnam"]'),
  'AC5: the placeholder suggests only covered markets',
);
await submitArea('Bangkok');
await qa.expectText('.intent-coverage', COVERAGE_LINE, 'AC1: the early-access line shows at the intent step');
await expectAbsent(page.getByRole('heading', { name: 'Got it.' }), 'AC1: the visitor never advances past the intent step');
await qa.expectVisible('#search-area', 'the typed area is kept so it can be corrected');

await qa.goto('/', 'RELOAD the page — the worst defect this slice had');
await expectAbsent(page.getByRole('heading', { name: 'Got it.' }), 'AC1 reload: still blocked after a cold reload');
await expectAbsent(page.getByText('Bangkok', { exact: false }).locator('xpath=ancestor-or-self::p[contains(@class,"intent-confirmation")]'), 'AC1 reload: never "We’ll look for … in Bangkok"');
await qa.expectText('.intent-coverage', COVERAGE_LINE, 'AC1 reload: the coverage line is re-shown on its own');
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

const VARIANTS = [
  ['hong kong,', 'Hong Kong', 'AC2: lowercase with a trailing comma'],
  ['Sydney, Australia', 'Australia', 'AC2: a city with a trailing country'],
  ['HK', 'Hong Kong', 'AC2: a common alias'],
  ['Ho Chi Minh City, Vietnam.', 'Vietnam', 'AC2: city + trailing country + a full stop'],
  ['Hong Kong', 'Hong Kong', 'AC5: placeholder example 1, typed verbatim'],
  ['Remote in Vietnam', 'Vietnam', 'AC5: placeholder example 2, typed verbatim'],
];

for (const [typed, market, why] of VARIANTS) {
  await freshVisitor();
  await openIntent('IT project manager');
  await submitArea(typed);
  await qa.expectText(
    '.intent-confirmation',
    `We’ll look for IT project manager in ${market}.`,
    `${why} — confirmed back as "${market}"`,
  );
  await qa.goto('/', `reload after "${typed}"`);
  await qa.expectText(
    '.intent-confirmation',
    `We’ll look for IT project manager in ${market}.`,
    `the canonical market "${market}" survives a reload, never the raw typed text`,
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
await qa.expectText(
  'body',
  'jobs are open in Hong Kong right now',
  'AC4: the discovery promise counts jobs in the RESOLVED SEARCH AREA, not the city in the role text',
);

// Answer the questions one at a time, the way the screen serves them, until the work-rights
// question is the one on screen.
const workRights = page.locator('.opts[data-elig="work-rights"]');
for (let i = 0; i < 8 && (await workRights.count()) === 0; i += 1) {
  await qa.click('.opts .opt', `answer the question on screen (step ${i + 1}) to reach work rights`);
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
