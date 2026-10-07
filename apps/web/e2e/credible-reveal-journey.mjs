// #63 QA GATE — the reveal is the SERVER's to give, and an empty deck has three different meanings.
//
// What this journey exists to catch, in the words of the ticket it gates:
//   AC1  a truthful current match count may be revealed once the gates pass and retrieval succeeds
//   AC2  any gate absent -> the server refuses, and no client can talk it round (#339: the one gate
//        left is a brought CV's completed review; the floor-coverage gate is gone)
//   AC3  a search that found nothing shows no zero-match reward, and offers her a way to adjust
//   AC4  adjusting her intent re-runs the search without costing her the answers she already gave
//
// And the wording rule #174 handed this ticket, which no payload assertion can prove:
// `empty_pool` ("we asked and there was nothing") and `provider_unavailable` ("we could not ask")
// must read as DIFFERENT things on the screen. Every market we serve runs on one aggregator, so a
// screen that collapses them tells a job seeker her market is empty when our only supplier was
// offline. This journey reads both screens as she would and asserts they differ.
//
// Run it:
//   OPS_KEY=qa-ops-key PORT=34101 node apps/api/dist/qa-main.js       # fake-model API, no paid calls
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34333
//   BASE_URL=http://127.0.0.1:34333 node apps/web/e2e/credible-reveal-journey.mjs
//
// Ports are deliberately not 3000/3001 — another project on this machine defaults to those and the
// /api proxy would silently reach the wrong backend (SHARED_INFRA.md). API_URL is baked at BUILD
// time, so the API must be listening before `next build`.
//
// The empty-pool and outage screens are unreachable in any browser-runnable config without a paid
// provider key, so they are armed through qa-main's own POST /qa/stack knob — the same seam the
// fake model rides. The knob lives in the QA entry only; it authorizes nothing, it decides what the
// stand-in provider ANSWERS. Arm it BEFORE a session's first deck read: the snapshot is keyed by
// request fingerprint, so a session that already has a deck keeps it.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34333';
const PLACED_ROLE = 'IT project manager';
const AREA = 'Hong Kong';

const CV_TEXT = [
  'Marta Kowalska',
  'marta.kowalska@example.com',
  'Warsaw, Poland',
  '',
  'EXPERIENCE',
  '',
  'IT Project Manager, Nordic Retail Group, Warsaw — Mar 2016 - Present',
  '- Led the checkout replatforming end to end and delivered it two months ahead of plan.',
  '- Managed a budget of EUR 1.2M across three vendor teams and reported to the steering group.',
  '',
  'Project Coordinator, Baltic Software House, Warsaw — Jun 2011 - Feb 2016',
  '- Coordinated a team of twelve engineers and two business analysts.',
  '',
  'EDUCATION',
  'MSc Management Information Systems, University of Warsaw, 2011',
].join('\n');

const qa = await createSession('credible-reveal-journey', {
  baseURL: BASE,
  viewport: { width: 1280, height: 900 },
});
const { page } = qa;
page.setDefaultTimeout(20000);

let aborted = false;
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, async (e) => {
    console.error(`\n[${ev}]`, e?.stack ?? e);
    if (aborted) return;
    aborted = true;
    // The outcome knob is one global on a server the whole tier-2 run shares. A crash while it is
    // armed to empty_pool would hand every later journey a dark deck and a failure far from here,
    // so it is disarmed on the way out as well as at the end of a clean run.
    try { await armRetrieval('relevant_postings'); } catch {}
    try { await qa.note(`RUN ABORTED (${ev}): ${e?.message ?? e}`); await qa.finish(); } catch {}
    process.exit(1);
  });
}

// A hard assertion the driver records with a screenshot either way.
const assertTrue = (cond, note) => qa.expectText('body', cond ? '' : '-THIS-CANNOT-APPEAR-', note);

// Her own browser, her own cookie, the same server. In-page rather than page.request: the session
// cookie rides the loopback trustworthy-origin exception the request context does not get.
const asVisitor = (method, path, data) =>
  page.evaluate(
    async ([m, p, d]) => {
      const res = await fetch(`/api${p}`, {
        method: m,
        credentials: 'same-origin',
        headers: d ? { 'content-type': 'application/json' } : {},
        body: d ? JSON.stringify(d) : undefined,
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* a non-JSON body is itself the finding */ }
      return { status: res.status, json, text: text.slice(0, 400) };
    },
    [method, path, data ?? null],
  );
const json = async (path) => (await asVisitor('GET', path)).json;
const cardsState = async () => {
  for (let i = 0; i < 60; i += 1) {
    const body = await json('/onboarding/cards');
    if (body && body.searching !== true) return body;
    await page.waitForTimeout(400);
  }
  throw new Error('retrieval never settled');
};
const deckScreenText = async () =>
  (await page.locator('.jobdeck').first().innerText()).replace(/\s+/g, ' ').trim();

/** Which advert pool the QA stand-in provider answers with. See the header. */
async function armRetrieval(outcome) {
  // The knob rides the page's own /api proxy, so the page has to be somewhere first (a fresh
  // browser opens on about:blank, where a relative fetch has no origin to resolve against).
  if (!page.url().startsWith('http')) await page.goto('/');
  const res = await asVisitor('POST', '/qa/stack', { retrievalOutcome: outcome });
  if (res.status !== 200 || res.json?.retrievalOutcome !== outcome) {
    throw new Error(`could not arm retrievalOutcome=${outcome}: ${res.status} ${res.text}`);
  }
}

/** A brand-new visitor in the same browser: drop her cookies and walk the front door again. */
async function freshVisitor(label, { withCv = false } = {}) {
  await page.context().clearCookies();
  if (withCv) {
    // #271: her CV goes in first, through the front door's paste tile — the order a person walks
    // (the deleted /paste side entrance used to let the CV arrive mid-journey instead). Her review
    // is left OPEN on purpose: #339 made it the one gate left, and §1 attacks it.
    await qa.frontDoorPaste(CV_TEXT, `${label} — the front door: she pastes her CV, two dated jobs and one degree`);
    await qa.frontDoorContinueToIntent();
  } else {
    await qa.goto('/', `${label} — the front door`);
    const ready = page.getByRole('button', { name: /Ready\?/ });
    if (await ready.count()) await qa.click(ready.first(), 'Ready? — open the front door');
    const startQuestions = page.getByRole('button', { name: /Start questions instead/ });
    if (await startQuestions.count()) await qa.click(startQuestions.first(), 'Start questions instead');
  }
  if (await page.locator('#target-role').count()) {
    await qa.fill('#target-role', PLACED_ROLE, `the job she is going for: "${PLACED_ROLE}"`);
    await qa.fill('#search-area', AREA, `where she wants to work: ${AREA}`);
    await qa.click('button:has-text("Save and continue")', 'Save and continue');
    await page.waitForTimeout(1200);
  }
  await qa.goto('/discovery', 'into discovery — the sign-up questions');
  // #322: the role typed above answers question 1 — discovery opens on the checklist.
  await page.waitForTimeout(2500);
}

// =============================================================================================
// 1. AC2 — THE REFUSAL. She brought a CV and has not reviewed it yet — #339 made the completed
//    "Your CV, reviewed" the one gate left (the floor gate is gone). She goes straight to the deck,
//    then tries every client-side lever there is.
// =============================================================================================
await armRetrieval('relevant_postings'); // the provider is healthy: the ONLY thing missing is her review
await freshVisitor('a visitor who has not earned anything yet', { withCv: true });

const refused = await cardsState();
await qa.note(`the server's answer with her review still open: ${JSON.stringify({ reviewPending: refused.reviewPending, retrieval: refused.retrieval })}`);
await assertTrue(
  refused.cards.length === 0 && refused.reviewPending === true,
  `AC2 — the server refuses outright while a gate is absent: ${refused.cards.length} cards, reviewPending ${refused.reviewPending}`,
);

await qa.goto('/deck', 'she jumps straight to the deck anyway');
await page.waitForURL(/\/review/, { timeout: 20000 }).catch(() => {});
await qa.scrollThrough('read the screen she gets instead of a reveal');
const refusedText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
await qa.note(`she is at ${page.url()}; the screen says: "${refusedText.slice(0, 200)}"`);
await assertTrue(
  page.url().includes('/review') && !/just matched you/i.test(refusedText),
  `AC2 — the deck sends her to her CV review, and no reveal number is on the screen (${page.url()})`,
);

// Every lever a client actually has: the URL, a header, and the shape of the request.
const bypasses = [
  ['GET', '/onboarding/cards?reveal=1'],
  ['GET', '/onboarding/cards?checkpoint=essential_floor_covered'],
  ['GET', '/onboarding/cards?force=true&fixtures=1'],
  ['GET', '/onboarding/cards?reviewed=1'],
];
for (const [method, path] of bypasses) {
  const res = await asVisitor(method, path);
  await assertTrue(
    (res.json?.cards ?? []).length === 0,
    `AC2 — client bypass refused: ${method} ${path} -> ${res.status}, ${(res.json?.cards ?? []).length} cards, reviewPending ${res.json?.reviewPending}`,
  );
}
// #339: discovery takes nothing but eligibility answers, so a forged "coverage" answer or a floor
// answer is not even a question it knows.
for (const itemId of ['essential_floor_covered', 'end-to-end-delivery']) {
  const forged = await asVisitor('POST', '/onboarding/discovery/answer', { itemId, answer: 'Yes' });
  await assertTrue(forged.status === 404, `AC2 — a forged answer for "${itemId}" is rejected, not recorded (${forged.status})`);
}
const stillRefused = await cardsState();
await assertTrue(
  stillRefused.cards.length === 0 && stillRefused.reviewPending === true,
  `AC2 — nothing the client sent opened her deck (${stillRefused.cards.length} cards, reviewPending ${stillRefused.reviewPending})`,
);

// =============================================================================================
// 2. AC1 — THE EARNED REVEAL. She completes her CV review, and the count she is shown is built out
//    of retrieved adverts and nothing else.
// =============================================================================================
// #271: her CV came in on the front door when she arrived — nothing left to paste here.
await qa.completeReview(); // #338: confirming "Your CV, reviewed" — the gate #339 left standing

const earned = await cardsState();
await qa.note(`the server's answer once her review is complete: ${JSON.stringify(earned.retrieval?.outcome)}`);
await assertTrue(
  earned.retrieval?.outcome === 'relevant_postings' && earned.cards.length > 0,
  `AC1 — the gates passed and retrieval succeeded, so a count may be revealed (${earned.cards.length} cards)`,
);
// The mechanical proof that no hand-maintained fixture is in the number: a retrieved advert's id is
// `posting:<canonicalKey>` by contract, and the pool's own filename-shaped ids can never look like it.
const notRetrieved = earned.cards.filter((c) => !String(c.adId).startsWith('posting:'));
await assertTrue(
  notRetrieved.length === 0,
  `AC1 — every card in the count came from retrieval, none from the fixture pool (${notRetrieved.length} strays)`,
);

await qa.goto('/deck', 'the reveal');
await qa.scrollThrough('read the reveal the way a visitor decides whether to sign in');
const revealText = await deckScreenText();
await qa.note(`the reward on her screen: "${revealText}"`);
await assertTrue(
  new RegExp(`${earned.cards.length}\\s+jobs? just`, 'i').test(revealText),
  `AC1 — the number on screen is the number of retrieved adverts (${earned.cards.length}): "${revealText.slice(0, 120)}"`,
);

// Past the wall, into the cards themselves — the regression half: reveal -> deck -> swipe -> tailor.
const signIn = await asVisitor('POST', '/auth/request-link', { email: `credible-reveal-${Date.now()}@example.com` });
const devLink = signIn.json?.devLink;
await assertTrue(!!devLink, 'the sign-in link was issued over the real magic-link path');
await asVisitor('POST', '/auth/verify', { token: new URL(`http://x${devLink}`).searchParams.get('token') });
await qa.goto('/deck', 'back to the deck, now past the sign-in wall');
const seeThem = page.getByRole('button', { name: 'See them' });
if (await seeThem.count()) await qa.click(seeThem.first(), 'See them — into the card deck');
await page.waitForTimeout(1500);
await qa.expectVisible(page.getByRole('img', { name: /% match/ }), 'DECK: a real scored card, not a blank screen');
await qa.scrollThrough('read the first card top to bottom, the way a job seeker would');
await qa.click('button[aria-label="Not for me, show next job"]', 'she swipes the first job away');
await page.waitForTimeout(1500);
await qa.expectVisible('.jobcard', 'the next card came up behind it');
await qa.click('button[aria-label="I want this one, tailor this job"]', 'she wants this one — tailor it');
await page.waitForTimeout(3000);
await qa.scrollThrough('read the tailoring screen she was handed to');
const handoffText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
await assertTrue(
  /tailoring/i.test(handoffText),
  `the happy path still runs end to end — she is tailoring the job she wanted: "${handoffText.slice(0, 90)}"`,
);

// The other two doors onto the posting pool. A fixture id that was never retrieved must not resolve
// for her either — the guard lives in the one function all three readers pass through, and this is
// the browser-side proof that no client can name its way past it.
const strayWant = await asVisitor('POST', '/onboarding/cards/2026-07-13_bnp-paribas_senior-project-manager/want', {});
await assertTrue(
  strayWant.status === 404,
  `AC2 — a signed-in visitor naming a fixture advert by id gets nothing (${strayWant.status})`,
);

// =============================================================================================
// 3. AC4 — SHE ADJUSTS HER INTENT. A different place is a different search; her answers are hers.
// =============================================================================================
const factsBefore = (await json('/onboarding/discovery'))?.factCount;
const changed = await asVisitor('PUT', '/sessions/me/intent', { searchAreas: ['Singapore'] });
await assertTrue(changed.status === 200, `she moves her search to Singapore (${changed.status})`);
const afterChange = await cardsState();
const factsAfter = (await json('/onboarding/discovery'))?.factCount;
await qa.goto('/deck', 'the deck after she changed where she is looking');
await qa.scrollThrough('read the re-run deck');
await assertTrue(
  afterChange.retrieval?.outcome === 'relevant_postings',
  `AC4 — the search re-ran for the new place (${afterChange.retrieval?.outcome})`,
);
await assertTrue(
  factsAfter === factsBefore,
  `AC4 — everything she told the product survived the re-run (${factsBefore} facts before, ${factsAfter} after)`,
);
const reviewHeld = await cardsState();
await assertTrue(
  reviewHeld.reviewPending !== true,
  `AC4 — her completed review survived the re-run; only the dependent result re-ran (reviewPending ${reviewHeld.reviewPending})`,
);

// =============================================================================================
// 4. AC3 — WE ASKED AND THERE WAS NOTHING. No reward, no fake count, and a way to change it.
// =============================================================================================
await armRetrieval('empty_pool');
// #339: a visitor with no CV has nothing to review, so nothing holds her deck back.
await freshVisitor('a visitor whose search finds nothing');
const empty = await cardsState();
await assertTrue(
  empty.retrieval?.outcome === 'empty_pool' && empty.cards.length === 0,
  `AC3 — the search finished and found nothing (${empty.retrieval?.outcome}, ${empty.cards.length} cards)`,
);
await qa.goto('/deck', 'the screen she gets when the search comes back empty');
await qa.scrollThrough('read the empty-result screen the way a job seeker would');
const emptyText = await deckScreenText();
await qa.note(`the empty-result screen says: "${emptyText}"`);
await assertTrue(
  !/just matched you|0 jobs/i.test(emptyText),
  `AC3 — no zero-match reward appears: "${emptyText}"`,
);
await assertTrue(
  /answer a few more questions|try a different job title/i.test(emptyText),
  `AC3 — she is offered a way to adjust: "${emptyText}"`,
);
// #174's wording rule, half one: this screen may describe OUR SEARCH, never HER MARKET.
await assertTrue(
  !/no jobs (in|are)|there are no|market is empty/i.test(emptyText),
  `#174 — the empty screen never tells her the market is empty: "${emptyText}"`,
);

// =============================================================================================
// 5. THE OUTAGE. We could not ASK. Different fact, and it has to read as a different thing.
// =============================================================================================
await armRetrieval('provider_unavailable');
await freshVisitor('a visitor who arrives while our one supplier is down');
const down = await cardsState();
await assertTrue(
  down.retrieval?.outcome === 'provider_unavailable' && down.cards.length === 0,
  `the server reports the outage as an outage, never as an empty pool (${down.retrieval?.outcome})`,
);
await qa.goto('/deck', 'the screen she gets while our supplier is offline');
await qa.scrollThrough('read the outage screen the way a job seeker would');
const downText = await deckScreenText();
await qa.note(`the outage screen says: "${downText}"`);
await assertTrue(
  downText !== emptyText,
  `#174 — the outage screen and the empty-result screen are NOT the same words:\n    outage: "${downText}"\n    empty:  "${emptyText}"`,
);
await assertTrue(
  !/no matches|try a different job title|answer a few more questions/i.test(downText),
  `#174 — the outage screen says nothing about her search or her job title: "${downText}"`,
);
await assertTrue(
  !/just matched you/i.test(downText),
  `no reward is shown for a search that never ran: "${downText}"`,
);
await qa.expectVisible(page.getByRole('button', { name: /try again/i }), 'the outage screen gives her a way to retry');

// Leave the stand-in provider as every other journey expects to find it.
await armRetrieval('relevant_postings');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
