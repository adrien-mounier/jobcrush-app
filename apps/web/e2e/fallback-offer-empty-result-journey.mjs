// #228 (spec #241) — the QA gate's adversarial companion to fallback-offer-journey.mjs. That flow
// drives the happy widening (accept → a deck comes back). This one drives the three branches it
// does not, each of which is an acceptance criterion in its own right:
//
//   - AC 8 / story 16: she ACCEPTS and the widening search finds NOTHING. She must land on the same
//     honest dead end, with no further widening offered — after a real wait, not instantly.
//   - Story 21: she reloads the page mid-widening. The deck she asked for comes back; the refresh
//     does not undo her choice, and she is not re-asked.
//   - AC 2 (the client's half): while she still has cards on screen, the offer must never appear,
//     however available the server says it is.
//
// Route-mocked like its sibling and for the same reason: reaching a genuinely exhausted live deck
// needs a live posting provider no local config wires. Every injected field is the shape the real
// API returns (apps/api/src/deckFallback.ts, asserted in apps/api/test/deckFallback.test.ts).
//
//   cd apps/web && npx next dev -p 39411
//   BASE_URL=http://127.0.0.1:39411 node e2e/fallback-offer-empty-result-journey.mjs

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

const ROLE = 'Product Analytics Manager';
const Z1 = 'No matches yet.';
const Z3 = 'Try a different job title.';
const OFFER_2 = 'Your CV also proves other work. Do you want me to look there?';
const REOPEN = 'Look at the other work my CV proves';
const WAITING = 'Looking for the other work your CV proves…';

const card = (adId, title, matchPct) => ({
  schemaVersion: '1',
  adId,
  title,
  company: 'Acme',
  place: 'Hong Kong',
  salary: null,
  pattern: null,
  scored: 'judged',
  matchPct,
  breakdown: { essential: { met: 2, total: 3 }, desirable: { met: 1, total: 2 } },
  bubble: { hit: 'You match on delivery.', open: 'The gap is SAP.' },
  fit: [],
  dontYet: [],
  askedClosed: [],
  adExcerpt: 'excerpt',
});

const qa = await createSession('fallback-offer-empty-result-journey', {
  baseURL: BASE,
  viewport: { width: 1280, height: 900 },
});
const { page } = qa;
page.setDefaultTimeout(30000);

// The server's own state, mutated by her answers — and a count of every deck read, so "how many
// times did the screen go back for more?" is answerable from the drive itself.
let state = {
  cards: [card('ad-1', 'Product Analytics Manager', 71)],
  fallback: { offered: true, declined: false, active: false, targetRole: ROLE },
};
let deckReads = 0;
let fallbackPosts = 0;

await page.route('**/api/sessions/me', (route) => route.fulfill({ json: { ok: true } }));
await page.route('**/api/onboarding/cards', (route) => {
  deckReads += 1;
  return route.fulfill({
    json: {
      stage: 'deck',
      cards: state.cards,
      authed: true,
      pendingCount: 0,
      moreQuestions: false,
      fallback: state.fallback,
    },
  });
});
await page.route('**/api/onboarding/cards/fallback', async (route) => {
  fallbackPosts += 1;
  const accepted = JSON.parse(route.request().postData() ?? '{}').accepted === true;
  // The accepted widening runs — and comes back with nothing at all. The deck stays empty; the
  // session is latched into the widening it can no longer undo.
  state = accepted
    ? { cards: [], fallback: { offered: false, declined: false, active: true, targetRole: ROLE } }
    : { ...state, fallback: { offered: false, declined: true, active: false, targetRole: ROLE } };
  await route.fulfill({ json: { fallback: state.fallback } });
});

// --- Part 1: cards on screen never show the offer -----------------------------------------------
await qa.note(
  'The server says the widening is available. She still has a job in front of her, so she must ' +
    'not be asked about a dead end she has not reached.',
);
await qa.goto('/deck', 'she opens her deck');
await qa.click('button:has-text("See them")', 'she opens the cards');
await qa.expectVisible('h2:has-text("Product Analytics Manager")', 'her job is on screen');
const onDeck = await page.locator('body').innerText();
if (onDeck.includes(OFFER_2)) {
  await qa.expectVisible('#offer-must-not-appear-while-cards-remain', 'FAIL: offered a widening mid-deck');
} else {
  await qa.note('PASS: no widening offered while she still has a job to look at.');
}

// --- Part 2: the deck runs out, she accepts, and nothing comes back -----------------------------
await qa.click('button[aria-label="Not for me, show next job"]', 'she passes — the deck is done');
await qa.scrollThrough('she reads the dead end');
await qa.expectText('.loadstate', OFFER_2, 'now she is asked');
const readsBeforeAccept = deckReads;
await qa.click('button:has-text("Yes, look")', 'she accepts — the one extra search she paid for');
await qa.expectText('.loadstate', WAITING, 'she is told the look is happening, not that it failed');

// AC 8 / story 16: the search found nothing. The screen must settle on the honest ending rather
// than waiting forever or re-offering.
// The screen goes back to the deck several times before it accepts that nothing is coming, so this
// is a real ~10s wait a visitor sits through — waited out rather than asserted instantly.
await page.locator('.loadstate p', { hasText: Z3 }).waitFor({ state: 'visible', timeout: 30000 });
await qa.expectText('.loadstate p:not(.big)', Z3, 'the honest ending: nothing was found');
await qa.expectText('.loadstate .big', Z1, 'and her own plain result above it');
const afterEmpty = (await page.locator('body').innerText()).toLowerCase();
if (afterEmpty.includes(OFFER_2.toLowerCase()) || afterEmpty.includes(REOPEN.toLowerCase())) {
  await qa.expectVisible('#no-second-widening-after-an-empty-result', 'FAIL: a further widening was offered');
} else {
  await qa.note('PASS: an empty widening ends the journey — no third search is offered.');
}
await qa.note(
  `The screen went back to the deck ${deckReads - readsBeforeAccept} times while waiting, and ` +
    `answered the offer ${fallbackPosts} time(s). Deck reads are free; the ONE paid search is the ` +
    'acceptance, and the server serves its snapshot to every read after it.',
);

// --- Part 3: she reloads mid-widening ------------------------------------------------------------
await qa.note('She reloads the page. Her choice must survive it, and she must not be re-asked.');
state = { cards: [card('ad-widened', 'Delivery Manager', 78)], fallback: state.fallback };
await qa.goto('/deck', 'she reloads');
await qa.click('button:has-text("See them")', 'she opens the cards again');
await qa.expectVisible('h2:has-text("Delivery Manager")', 'the widened deck is still hers after a refresh');
const afterReload = (await page.locator('body').innerText()).toLowerCase();
if (afterReload.includes(OFFER_2.toLowerCase())) {
  await qa.expectVisible('#reload-must-not-re-raise-the-offer', 'FAIL: she was asked again after a reload');
} else {
  await qa.note('PASS: a refresh kept her choice and asked her nothing.');
}

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
