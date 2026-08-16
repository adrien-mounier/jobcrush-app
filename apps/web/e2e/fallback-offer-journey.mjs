// #228 (spec #241) — the whole path, on the real screen, at a human pace: she works through her
// deck, it runs out, she is ASKED whether to look at the work her CV proves, she says no, changes
// her mind, accepts, gets a different deck, and works through that one too.
//
// The ticket's own AC 11 is that this is proven in a browser with evidence, not only in an API
// payload — a passing server assertion has hidden a blank screen in this repo before (#162). What a
// visitor must see:
//   - the last card of her deck does NOT send her back to the questions when there are none left;
//   - the offer names her own typed words, asks a question, and promises no jobs;
//   - "no" costs nothing, leaves an honest dead end, and leaves the way back on the screen;
//   - the offer is not raised again by itself;
//   - "yes" replaces the deck with jobs her CV proves — her old cards do not come back;
//   - that deck runs out too, and ends at the same honest dead end. No third widening.
//
// The DECK PAYLOAD is route-mocked, the screen is the real screen — the repo's established
// mocked-e2e pattern (deck.spec.ts, empty-deck-word-search-journey.mjs): reaching a genuinely
// exhausted live deck twice over needs two live provider round-trips the QA harness has no
// providers for. Every field injected here is the shape the real API returns (apps/api's
// deckFallback.ts DeckFallbackState, asserted in apps/api/test/deckFallback.test.ts).
//
// No API process is needed. Run it from apps/web (that is where @playwright/test resolves from):
//   cd apps/web
//   npx next dev -p 34878
//   BASE_URL=http://127.0.0.1:34878 node e2e/fallback-offer-journey.mjs

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

const ROLE = 'Product Analytics Manager';
const Z1 = 'No matches yet.';
const Z3 = 'Try a different job title.';
const OFFER_1 = `There are no more jobs for "${ROLE}".`;
const OFFER_2 = 'Your CV also proves other work. Do you want me to look there?';
const REOPEN = 'Look at the other work my CV proves';
const LOOPBACK = "I scored the three closest — tell me more and I'll score them better";

// Words the offer must never reach the screen with: our own label for her career, the machinery
// behind it, and any claim that jobs exist before we have looked.
const FORBIDDEN = ['family', 'vocabulary', 'research', 'strong matches', 'awaiting'];

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

const qa = await createSession('fallback-offer-journey', {
  baseURL: BASE,
  viewport: { width: 1280, height: 900 },
});
const { page } = qa;
page.setDefaultTimeout(20000);

// One mutable server: the deck it serves, and the fallback state, change as she answers — the same
// transitions the real API makes.
let state = {
  cards: [card('ad-1', 'Product Analytics Manager', 71), card('ad-2', 'Insights Manager', 66)],
  fallback: { offered: true, declined: false, active: false, targetRole: ROLE },
};

await page.route('**/api/sessions/me', (route) => route.fulfill({ json: { ok: true } }));
await page.route('**/api/onboarding/cards', (route) =>
  route.fulfill({
    json: {
      stage: 'deck',
      cards: state.cards,
      authed: true,
      pendingCount: 0,
      moreQuestions: false, // every question is answered — this is the dead end, not the loopback
      fallback: state.fallback,
    },
  }),
);
await page.route('**/api/onboarding/cards/fallback', async (route) => {
  const accepted = JSON.parse(route.request().postData() ?? '{}').accepted === true;
  state = accepted
    ? {
        // Accepting replaces the deck: her target-family cards are gone, and the search her CV
        // proves has returned one advert.
        cards: [card('ad-widened', 'Delivery Manager', 78)],
        fallback: { offered: false, declined: false, active: true, targetRole: ROLE },
      }
    : { ...state, fallback: { offered: false, declined: true, active: false, targetRole: ROLE } };
  await route.fulfill({ json: { fallback: state.fallback } });
});

// --- Part 1: she works through her own deck --------------------------------------------------
await qa.note(
  `A career changer typed "${ROLE}". We searched the job family that role belongs to and ranked ` +
    'what we found. She has answered every question we have. Now she works through the deck.',
);
await qa.goto('/deck', 'she opens her deck');
await qa.click('button:has-text("See them")', 'she opens the cards');
await qa.expectVisible('h2:has-text("Product Analytics Manager")', 'her first job is on screen');
await qa.click('button[aria-label="Not for me, show next job"]', 'not this one');
await qa.expectVisible('h2:has-text("Insights Manager")', 'the second job');
await qa.click('button[aria-label="Not for me, show next job"]', 'nor this one — the deck is done');

// --- Part 2: the dead end asks, and never promises ---------------------------------------------
await qa.scrollThrough('she reads the whole screen, top to bottom');
await qa.expectText('.loadstate .big', Z1, 'her own result, stated plainly');
await qa.expectText('.loadstate', OFFER_1, 'it names the words SHE typed, and no job family');
await qa.expectText('.loadstate', OFFER_2, 'and it asks — it does not act, and it promises nothing');
await qa.expectVisible('button:has-text("Yes, look")', 'she can say yes');
await qa.expectVisible('button:has-text("No thanks")', 'and she can say no');

const body = (await page.locator('body').innerText()).toLowerCase();
const leaked = FORBIDDEN.filter((word) => body.includes(word));
if (leaked.length > 0) {
  await qa.expectVisible(
    `#offer-names-nothing-it-should-not-but-leaked-${leaked.join('-')}`,
    `FAIL: the offer names ${leaked.join(', ')}`,
  );
} else {
  await qa.note('PASS: no job family, no vocabulary, no research, and no promise of jobs found.');
}
if (body.includes(LOOPBACK.toLowerCase())) {
  await qa.expectVisible(
    '#no-loopback-invitation-when-nothing-is-left-to-answer',
    'FAIL: she was sent back to questions that do not exist',
  );
} else {
  await qa.note('PASS: the deck did not send her back to an empty ask screen.');
}

// --- Part 3: she says no — and the way back stays on the screen ---------------------------------
await qa.click('button:has-text("No thanks")', 'she declines: she asked for this work, not other work');
await qa.expectText('.loadstate p:not(.big)', Z3, 'the honest dead end, and nothing was searched');
await qa.expectVisible(`button:has-text("${REOPEN}")`, 'the offer stays reachable — she can change her mind');

const afterDecline = (await page.locator('body').innerText()).toLowerCase();
if (afterDecline.includes(OFFER_2.toLowerCase())) {
  await qa.expectVisible(
    '#offer-is-not-re-raised-by-itself-after-a-no',
    'FAIL: the question was asked again although she said no',
  );
} else {
  await qa.note('PASS: she is not nagged — the question is not re-raised by itself.');
}

// --- Part 4: she changes her mind, and gets a different deck ------------------------------------
await qa.click(`button:has-text("${REOPEN}")`, 'she reconsiders');
await qa.expectText('.loadstate', OFFER_2, 'the same question, asked because she asked for it');
await qa.click('button:has-text("Yes, look")', 'she accepts — this is the one extra search');
await qa.expectVisible('h2:has-text("Delivery Manager")', 'a job her own CV proves is on screen');

const widened = await page.locator('body').innerText();
if (widened.includes('Insights Manager') || widened.includes('Product Analytics Manager')) {
  await qa.expectVisible(
    '#fallback-deck-replaces-it-does-not-append',
    'FAIL: a card she already swiped through came back',
  );
} else {
  await qa.note('PASS: the widened deck replaced the old one — nothing she has seen came back.');
}

// --- Part 5: the widened deck runs out too — the same honest ending -----------------------------
await qa.click('button[aria-label="Not for me, show next job"]', 'she works through this deck as well');
await qa.scrollThrough('she reads the ending');
await qa.expectText('.loadstate .big', Z1, 'the same plain result');
await qa.expectText('.loadstate p:not(.big)', Z3, 'and the same honest ending — no third widening');

const ending = (await page.locator('body').innerText()).toLowerCase();
if (ending.includes(OFFER_2.toLowerCase()) || ending.includes(REOPEN.toLowerCase())) {
  await qa.expectVisible(
    '#no-third-widening-after-the-fallback-deck-runs-out',
    'FAIL: a further widening was offered after the fallback deck ran out',
  );
} else {
  await qa.note('PASS: the product stops when it genuinely has nothing left.');
}

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
