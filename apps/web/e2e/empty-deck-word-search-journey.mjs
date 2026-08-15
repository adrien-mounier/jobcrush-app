// #235 (spec #233 decision 8) — the empty deck after a WORD SEARCH, on the real screen.
//
// The ticket's own acceptance criterion is that this case is "proven in the browser with evidence,
// not only in an API payload": a passing server assertion has hidden a blank screen before in this
// repo (#162), and the whole point of #235's empty state is a line the visitor READS.
//
// What a visitor must see when her typed words return nothing and she has nothing left to answer:
//   - her own result ("No matches yet.");
//   - her own way to change it ("Try a different job title.");
//   - NOT "Answer a few more questions and I'll widen the net." — there are no more questions, so
//     that line would send her to an empty ask screen;
//   - no job family, no vocabulary, no research named anywhere on the screen (spec #233 decision 8:
//     both causes of an unmapped role are faults she can do nothing about, so naming them only
//     makes the product look weak).
// And the other half, so this is a real gate and not a one-sided one: when a question DOES remain,
// the widen-the-net invitation is still the line she gets.
//
// The DECK PAYLOAD is route-mocked, the screen is the real screen. The repo's established mocked-e2e
// pattern (apps/web/e2e/deck.spec.ts, job-blocks-no-family-question-journey.mjs): reaching a
// genuinely empty live deck needs a live provider round-trip the QA harness has no providers for.
// The `moreQuestions` flag injected here is NOT invented — it was observed coming out of the real
// API on a real word-search session (unmapped target role, no search family, empty question floors),
// flipping true -> false exactly as the discovery loop ran out of questions.
//
// No API process is needed — both endpoints the deck screen calls are fulfilled at the browser's
// network layer. Run it from apps/web (that is where @playwright/test resolves from):
//   cd apps/web
//   npx next dev -p 34878
//   BASE_URL=http://127.0.0.1:34878 node e2e/empty-deck-word-search-journey.mjs
//
// CI: the durable twin of these four assertions is already in deck.spec.ts, which run-mocked.mjs
// (the Tier 1 gate) discovers automatically. This journey is the human-paced, screenshotted form —
// Tier 2's list is hand-picked by product judgement, so adding it there is the owner's call.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

const Z1 = 'No matches yet.';
const Z2 = "Answer a few more questions and I'll widen the net.";
const Z3 = 'Try a different job title.';

// Words that must never reach the screen on this path — the family we could not place her into, the
// vocabulary that failed, and the research that might one day fix it.
const FORBIDDEN = ['family', 'vocabulary', 'research', 'unmapped', 'word search', 'keyword'];

const qa = await createSession('empty-deck-word-search-journey', {
  baseURL: BASE,
  viewport: { width: 1280, height: 900 },
});
const { page } = qa;
page.setDefaultTimeout(20000);

async function stub(moreQuestions) {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.route('**/api/sessions/me', (route) => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/onboarding/cards', (route) =>
    route.fulfill({
      json: { stage: 'deck', cards: [], authed: true, pendingCount: 0, moreQuestions },
    }),
  );
}

// --- Part 1: nothing left to answer -----------------------------------------------------------
await qa.note(
  'A visitor typed a target role we cannot place in any published job family. Her deck was built ' +
    'from the words she typed, and it came back empty. Every question we had for her is answered.',
);
await stub(false);
await qa.goto('/deck', 'she opens her deck');
await qa.scrollThrough('she reads the whole screen, top to bottom');

await qa.expectText('.loadstate .big', Z1, 'her own result is stated plainly');
await qa.expectText('.loadstate p:not(.big)', Z3, 'and she is invited to try a different job title');

const body1 = (await page.locator('body').innerText()).toLowerCase();
if (body1.includes(Z2.toLowerCase())) {
  await qa.expectVisible(
    '#no-widen-the-net-line-when-nothing-is-left-to-answer',
    'FAIL: the widen-the-net line is shown although no question remains',
  );
} else {
  await qa.note('PASS: the widen-the-net line is absent — no dead-end invitation.');
}

const leaked = FORBIDDEN.filter((word) => body1.includes(word));
if (leaked.length > 0) {
  await qa.expectVisible(
    `#screen-names-nothing-it-should-not-but-leaked-${leaked.join('-')}`,
    `FAIL: the screen names ${leaked.join(', ')}`,
  );
} else {
  await qa.note('PASS: no job family, vocabulary or research is named anywhere on the screen.');
}

// --- Part 2: a question still remains ---------------------------------------------------------
await qa.note(
  'The other half of the rule: a different visitor, same empty deck, but a question she has not ' +
    'answered yet. She must still be invited to answer it — the net can genuinely be widened.',
);
await stub(true);
await qa.goto('/deck', 'the second visitor opens her deck');
await qa.scrollThrough('she reads the whole screen too');

await qa.expectText('.loadstate .big', Z1, 'the same honest result');
await qa.expectText('.loadstate p:not(.big)', Z2, 'and the widen-the-net invitation is back');

const body2 = (await page.locator('body').innerText()).toLowerCase();
if (body2.includes(Z3.toLowerCase())) {
  await qa.expectVisible(
    '#no-try-a-different-title-line-while-a-question-remains',
    'FAIL: the try-a-different-title line replaced an answerable question',
  );
} else {
  await qa.note('PASS: the try-a-different-title line is absent while a question remains.');
}

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
