// #214 — target locations: up to three chips, one deck over the union, per-market work rights.
//
// Two halves, deliberately:
//   1. The FRONT DOOR against the REAL stack (no route mocking) — the server is the gate for
//      coverage and for the city-vs-country resolution the 2026-08-13 owner amendment on #124
//      introduced, so a mocked vocabulary would prove nothing about it. This half is the only
//      end-to-end proof that a typed CITY comes back as a CITY chip ("Melbourne", not "Australia").
//   2. The PROFILE RAIL against a route-mocked payload — /profile needs a signed-in person, and the
//      thing under test here is the RENDER (chips listed, the edit door, one work-rights row per
//      selected market), not the auth path. Same fixture shape profile.spec.ts pins.
//
// Run it with the real API + a built web app (the CI recipe):
//   node apps/api/dist/qa-main.js                       # :34101
//   API_URL=http://127.0.0.1:34101 pnpm --filter @jobcrush/web build && npx next start -p 3000
//   BASE_URL=http://127.0.0.1:3000 node apps/web/e2e/target-locations-journey.mjs

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const COVERAGE_LINE =
  'JobCrush is in early access — we currently cover Hong Kong, Singapore, Vietnam and Australia.';
const CAP_LINE = 'Three places is the limit — remove one to add another.';
const ROLE = 'IT project manager';

const qa = await createSession('target-locations', { baseURL: BASE, viewport: { width: 1280, height: 900 } });
const page = qa.page;

const expectAbsent = (inner, note) =>
  qa.expectVisible(page.locator('body').filter({ hasNot: inner }), note);

const chipLabels = () => page.locator('[data-testid="area-chips"] .chips .lbl');

async function addPlace(text, note) {
  await qa.fill('#search-area', text, `type "${text}"`);
  await qa.press('#search-area', 'Enter', note ?? `press Enter to place "${text}"`);
}

// ---------------------------------------------------------------- 1. the front door, real stack

await qa.context.clearCookies();
await qa.goto('/', 'a brand-new visitor lands on the front door');
await qa.scrollThrough('read the front door top to bottom');
await qa.click('button:has-text("Ready?")', 'open the front door');
await qa.click('button:has-text("Start questions instead")', 'choose to start from questions');
await qa.fill('#target-role', ROLE, `type the target role: "${ROLE}"`);

// AC8 — remote is not a location: the old placeholder example is gone.
await qa.expectVisible(
  page.locator('#search-area[placeholder="e.g. Hong Kong"]'),
  'AC8: the placeholder suggests one covered market and no longer says "or Remote in Vietnam"',
);
await qa.expectText('#search-area-helper', 'Type a city or country — up to three places.', 'the helper invites up to three places');

// AC1 + the #124 amendment — a typed CITY becomes a CITY chip, never silently corrected upward.
await addPlace('Melbourne');
await qa.expectText(
  chipLabels().first(),
  'Melbourne',
  '#124 amendment: a typed city shows the CITY name on the chip — not "Australia"',
);

// A typed country stays a country chip.
await addPlace('Hong Kong');
await qa.expectText(chipLabels().nth(1), 'Hong Kong', 'AC1: a typed country resolves to the canonical market name');

// AC1 — an uncovered place is refused on the spot with the early-access line, and is NOT kept.
await addPlace('Paris', 'try an uncovered place');
await qa.expectText('.intent-coverage', COVERAGE_LINE, 'AC1: an uncovered place is refused with the early-access coverage line');
await expectAbsent(chipLabels().filter({ hasText: 'Paris' }), 'AC1: the refused place never becomes a chip');

// AC1 — the cap. A third chip fills it; the input then closes and the limit line reads out.
await addPlace('Vietnam');
await qa.expectText(chipLabels().nth(2), 'Vietnam', 'the third place is placed');
await qa.expectText('#search-area-helper', CAP_LINE, 'AC1: at three chips the limit line reads out, verbatim');
await qa.expectVisible('#search-area[disabled]', 'AC1: the input closes at the cap — a fourth place cannot be typed');

// Removal is the chip\'s own ✕, and it re-opens the input.
await qa.click('button[aria-label="Remove Vietnam"]', 'remove Vietnam with the chip’s ✕');
await qa.expectText('#search-area-helper', 'Type a city or country — up to three places.', 'removing a chip re-opens the input');
await addPlace('Vietnam', 'put Vietnam back so the save carries all three');

// AC2 — save; the checkpoint advances and the confirmation sentence pluralises with the CHIP LABELS
// (Oxford-less join), which for a city chip is the city.
await qa.click('button:has-text("Save and continue")', 'save and continue');
// #257: the save advances the checkpoint AND walks her on to the discovery questions, where the
// confirmation sentence now lives persistently (.intent-context).
await page.waitForURL(/\/discovery/);
await qa.expectText(
  '.intent-context',
  `We’ll look for ${ROLE} in Melbourne, Hong Kong and Vietnam.`,
  'AC2: the checkpoint advances, and the confirmation pluralises over the chip labels, Oxford-less',
);

await qa.goto('/discovery', 'cold reload — the server re-resolves from what was stored');
await qa.expectText(
  '.intent-context',
  `We’ll look for ${ROLE} in Melbourne, Hong Kong and Vietnam.`,
  'AC7: the stored entries survive a reload and still resolve to the same labels',
);
await expectAbsent(
  page.locator('.intent-context', { hasText: 'Australia' }),
  '#124 amendment: the city chip is never confirmed back as its country',
);

// AC4 — the work-rights question is asked once per selected MARKET (Melbourne and Vietnam are two
// different markets; visas are national, so the Melbourne chip asks about Australia). #257 already
// landed her on discovery, where the eligibility questions are asked.
// #322: the front door already took the role, so discovery opens on the checklist - no question 1.
await qa.scrollThrough('read the discovery page the way a person would');

const workRights = page.locator('.opts[data-elig="work-rights"]');
// #339: work rights comes straight after question 1 (no floor ahead of it); the loop answers
// anything that is ahead of it the way the screen serves it.
for (let i = 0; i < 10 && (await workRights.count()) === 0; i += 1) {
  const answered = await qa.answerVisibleQuestion({
    note: `answer the question on screen (step ${i + 1}) to reach work rights`,
  });
  if (!answered) break;
}
await qa.expectVisible(workRights, 'AC4: a work-rights question is reached');
await qa.note(
  `the work-rights question on screen reads: ${await page.locator('.opts[data-elig="work-rights"]').locator('xpath=preceding::*[self::p or self::h2][1]').first().innerText().catch(() => '(not captured)')}`,
);
await expectAbsent(
  page.getByText('Can you already work in Melbourne without visa sponsorship?'),
  '#124 amendment: work rights stays MARKET-level — nobody is asked about a visa for a city',
);

// ------------------------------------------------------- 2. the profile rail, route-mocked render

const VOCAB = [
  { alias: 'hong kong', market: 'Hong Kong', label: 'Hong Kong' },
  { alias: 'melbourne', market: 'Australia', label: 'Melbourne' },
  { alias: 'australia', market: 'Australia', label: 'Australia' },
  { alias: 'vietnam', market: 'Vietnam', label: 'Vietnam' },
];
const area = (text, market, label) => ({ text, market, label });
const wr = (market, slug, answer) => ({
  market,
  answer,
  questionId: `eligibility-work-rights-${slug}`,
  question: `Can you already work in ${market} without visa sponsorship?`,
  options: ['Yes — no sponsorship needed', "Not yet — I'd need sponsorship", 'Ask me later'],
});

// Same ProfileState shape profile.spec.ts pins.
const PROFILE = {
  factCount: 2,
  search: { role: 'IT project manager', family: null, siblingTitles: [], openJobs: null },
  domains: [
    {
      tag: 'experience',
      heading: 'Professional Experience',
      facts: [{ id: 'e1', text: 'Managed a team of six engineers.', colour: 'gold', source: 'told', job: null }],
    },
  ],
  contact: { phone: null, email: null },
  location: {
    areas: [area('Melbourne', 'Australia', 'Melbourne'), area('Hong Kong', 'Hong Kong', 'Hong Kong')],
    // Two chips, two markets → two rows. Hong Kong answered "needs sponsorship" (the #107 case),
    // Australia unanswered — the exact split AC5 names.
    workRights: [wr('Hong Kong', 'hong-kong', "Not yet — I'd need sponsorship"), wr('Australia', 'australia', null)],
  },
  languagesQuestion: {
    questionId: 'eligibility-languages',
    question: "Which languages do you speak? Start typing — I'll suggest as you go.",
    consequence: 'Nothing you leave out counts against you.',
    options: ['English', 'Mandarin', 'Cantonese', 'Vietnamese', 'Ask me later'],
    answer: null,
  },
};

await page.route('**/api/sessions/me', (r) => r.fulfill({ json: { ok: true } }));
await page.route('**/api/profile', (r) => r.fulfill({ json: PROFILE }));
await page.route('**/api/sessions/me/intent', (r) =>
  r.fulfill({
    json: {
      intent: {
        targetRole: 'IT project manager',
        searchAreas: PROFILE.location.areas.map((a) => ({
          text: a.text,
          marketKey: a.market.toLowerCase().replace(/\s+/g, '-'),
          statedAt: '2026-08-13T00:00:00.000Z',
          market: a.market,
          label: a.label,
        })),
      },
      missing: [],
      checkpoint: 'intent_known',
      refused: [],
      coverage: ['Hong Kong', 'Singapore', 'Vietnam', 'Australia'],
      areaVocabulary: VOCAB,
    },
  }),
);

await qa.goto('/profile', 'Mei opens her profile');
await qa.scrollThrough('read the profile rail the way a person would');

const loc = page.locator('.rloc');
await qa.expectText(loc.locator('.rchips .lbl').first(), 'Melbourne', 'the rail lists the chosen places as chips — the city among them');
await qa.expectText(loc.locator('.rchips .lbl').nth(1), 'Hong Kong', 'the rail lists the second chosen place');
await qa.expectVisible(loc.getByRole('button', { name: 'Change', exact: true }), 'the rail offers the edit door');

// AC4/AC6 on the rail: one work-rights row per selected market, each independently answerable, and
// the Hong Kong answer visible alongside an unanswered Australia.
await qa.expectVisible(page.getByText('Work rights · Hong Kong', { exact: true }), 'AC4: a work-rights row for Hong Kong');
await qa.expectVisible(page.getByText('Work rights · Australia', { exact: true }), 'AC4: a second work-rights row for the Melbourne chip’s market, Australia');

await qa.click('.rloc button:has-text("Change")', 'open the edit door to correct the places');
await qa.expectText(page.locator('.rloc .rqq'), 'Where should JobCrush look?', 'the edit door asks the same question the front door asked');
await qa.expectVisible(page.locator('#loc-area-again'), 'the same chips-plus-type-ahead widget is behind the door');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
