// #321 — the work-rights door hands keyboard focus back to its OWN market's door button.
//
// The defect this guards: the focus-return ref used to sit on the CANCEL button INSIDE the open
// door, which unmounts the moment the door closes — so every close dropped focus to <body> and a
// keyboard person had to tab from the top of the page again. The fix keys the doors by market, so
// this flow only proves anything with TWO markets on the rail at once: a single shared ref would
// point at whichever row rendered last, and the first market's close would hand focus to the
// second market's door.
//
// Route-mocked, like the profile half of target-locations-journey.mjs — /profile needs a signed-in
// person, and what is under test is the focus behaviour of the render, not the auth path.
//
// Run it against a built, running web app (the CI recipe):
//   API_URL=http://127.0.0.1:34101 pnpm --filter @jobcrush/web build
//   pnpm --filter @jobcrush/web start                       # :3000
//   BASE_URL=http://127.0.0.1:3000 node apps/web/e2e/work-rights-focus-return-journey.mjs

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

const WR_CHANGE = 'Change this answer';
const WR_ASK = 'Answer it now';
const WR_KEEP = 'Keep my answer';

const area = (text, market, label) => ({ text, market, label });
const wr = (market, slug, answer) => ({
  market,
  answer,
  questionId: `eligibility-work-rights-${slug}`,
  question: `Can you already work in ${market} without visa sponsorship?`,
  options: ['Yes — no sponsorship needed', "Not yet — I'd need sponsorship", 'Ask me later'],
});

const AREAS = [area('Hong Kong', 'Hong Kong', 'Hong Kong'), area('Australia', 'Australia', 'Australia')];

// Hong Kong answered (its door reads "Change this answer"), Australia not yet asked (its door reads
// "Answer it now") — the two door shapes render DIFFERENT buttons under the same market key, which
// is the case the per-market ref map has to survive.
const baseProfile = (auAnswer) => ({
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
    areas: AREAS,
    workRights: [wr('Hong Kong', 'hong-kong', "Not yet — I'd need sponsorship"), wr('Australia', 'australia', auAnswer)],
  },
  languagesQuestion: {
    questionId: 'eligibility-languages',
    question: "Which languages do you speak? Start typing — I'll suggest as you go.",
    consequence: 'Nothing you leave out counts against you.',
    options: ['English', 'Mandarin', 'Cantonese', 'Vietnamese', 'Ask me later'],
    answer: null,
  },
});

let current = baseProfile(null);

const qa = await createSession('work-rights-focus-return', {
  baseURL: BASE,
  viewport: { width: 1280, height: 900 },
});
const page = qa.page;

await page.route('**/api/sessions/me', (r) => r.fulfill({ json: { ok: true } }));
await page.route('**/api/profile', (r) => r.fulfill({ json: current }));
await page.route('**/api/onboarding/cards', (r) =>
  r.fulfill({ json: { stage: 'deck', cards: [], authed: true, pendingCount: 0 } }),
);
await page.route('**/api/onboarding/discovery/answer', (r) => {
  current = baseProfile('Ask me later');
  return r.fulfill({ json: { ok: true } });
});
await page.route('**/api/sessions/me/intent', (r) =>
  r.fulfill({
    json: {
      intent: {
        targetRole: 'IT project manager',
        searchAreas: AREAS.map((a) => ({
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
      areaVocabulary: [
        { alias: 'hong kong', market: 'Hong Kong', label: 'Hong Kong' },
        { alias: 'australia', market: 'Australia', label: 'Australia' },
      ],
    },
  }),
);

// Every locator below is scoped to its market's OWN row. "the second door in DOM order" is a
// property the last-render-wins bug would also satisfy, so it is never used.
const loc = page.locator('.rloc');
const row = (market) => loc.locator('.rrow').filter({ hasText: `Work rights · ${market}` });
// A `:focus` selector resolves only while the element holds focus — so the highlighted screenshot
// the driver captures IS the focus-ring evidence, on the right market's door.
const focusedDoor = (market, name) =>
  row(market).locator('button.rdoor:focus').filter({ hasText: name });

await qa.goto('/profile', 'a keyboard person opens her profile');
await qa.scrollThrough('read the profile the way a person would, down to the Location rail');

await qa.expectVisible(page.getByText('Work rights · Hong Kong', { exact: true }), 'the rail carries a Hong Kong work-rights row');
await qa.expectVisible(page.getByText('Work rights · Australia', { exact: true }), 'and a second row for Australia — two markets on the rail at once');

// ---- 1. backing out of the SECOND market's door lands on that market's own door, not the first's
await qa.click(row('Australia').getByRole('button', { name: WR_ASK }), 'open the Australia work-rights door');
await qa.expectVisible(row('Australia').getByText('Can you already work in Australia without visa sponsorship?'), 'the Australia question is on screen');
await qa.click(row('Australia').getByRole('button', { name: 'Not now' }), 'back out of the Australia door without answering');
await qa.expectVisible(focusedDoor('Australia', WR_ASK), "#321: focus lands back on AUSTRALIA's own door button — not Hong Kong's, not nowhere");

// ---- 2. and the FIRST market's door, while the second is still on screen below it
await qa.click(row('Hong Kong').getByRole('button', { name: WR_CHANGE }), 'open the Hong Kong work-rights door');
await qa.expectVisible(row('Hong Kong').getByText('Can you already work in Hong Kong without visa sponsorship?'), 'the Hong Kong question is on screen');
await qa.click(row('Hong Kong').getByRole('button', { name: WR_KEEP }), 'keep the existing Hong Kong answer');
await qa.expectVisible(focusedDoor('Hong Kong', WR_CHANGE), "#321: focus lands back on HONG KONG's own door button, with Australia's row still below it");

// ---- 3. Escape is the third close path and returns focus the same way
await qa.click(row('Hong Kong').getByRole('button', { name: WR_CHANGE }), 'open the Hong Kong door again');
await qa.press('body', 'Escape', 'close it with the Escape key, the way a keyboard person would');
await qa.expectVisible(focusedDoor('Hong Kong', WR_CHANGE), '#321: Escape returns focus to the same door too');

// ---- 4. SAVING an answer returns focus to the door the answer belongs to, which has now changed shape
await qa.click(row('Australia').getByRole('button', { name: WR_ASK }), 'open the Australia door to actually answer it');
await qa.click(row('Australia').getByRole('button', { name: 'Ask me later' }), 'choose "Ask me later" — a real save');
await qa.expectVisible(focusedDoor('Australia', WR_CHANGE), '#321: after a save, focus lands on that market\'s door — now the "Change this answer" door');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
