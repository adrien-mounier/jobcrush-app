// #63 QA GATE — she was tailoring a job, then changed where she is looking. She must not lose it.
//
// The defect this journey pins (found by the #63 gate, fixed in apps/web/app/tailor/page.tsx):
//
//   earn a deck -> swipe right on a card (tailoring starts) -> adjust her intent, which is AC4's
//   own flow -> come back to /tailor
//
// Changing her search areas correctly stales her retrieval snapshot, so the advert she was
// tailoring can no longer be served — that is #101's decided fail-closed rule and it is NOT what
// this journey argues with. What she used to get was a dead end: "Couldn't open this job." with a
// "Try again" button that re-sent the same doomed request for ever, and no link back to her jobs.
// She was one tap from her deck and had no way to know it.
//
// So this journey asserts BOTH halves, because fixing one by breaking the other is the obvious
// wrong fix:
//   1. the SERVER still refuses the stale advert (fail-closed, unchanged), and
//   2. the SCREEN no longer dead-ends her — she lands back where retrieval re-runs and her jobs are.
//
// Run it:
//   OPS_KEY=qa-ops-key PORT=34101 node apps/api/dist/qa-main.js       # fake-model API, no paid calls
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34333
//   BASE_URL=http://127.0.0.1:34333 node apps/web/e2e/stale-search-tailor-return-journey.mjs
//
// Ports are deliberately not 3000/3001 — another project on this machine defaults to those and the
// /api proxy would silently reach the wrong backend (SHARED_INFRA.md). API_URL is baked at BUILD
// time, so the API must be listening before `next build`.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34333';
const PLACED_ROLE = 'IT project manager';
const AREA = 'Hong Kong';
const MOVED_TO = 'Singapore';

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

const qa = await createSession('stale-search-tailor-return', {
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
    try { await qa.note(`RUN ABORTED (${ev}): ${e?.message ?? e}`); await qa.finish(); } catch {}
    process.exit(1);
  });
}

const assertTrue = (cond, note) => qa.expectText('body', cond ? '' : '-THIS-CANNOT-APPEAR-', note);

// Her own browser, her own cookie — in-page fetch, so the session cookie rides along.
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
const screenText = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();

// The QA entry's stand-in provider answers with a full deck unless a journey says otherwise; say so
// explicitly, because the knob is one global the whole tier-2 run shares.
await qa.goto('/', 'the front door');
await asVisitor('POST', '/qa/stack', { retrievalOutcome: 'relevant_postings' });

// =============================================================================================
// 1. WALK HER ALL THE WAY IN, the way a real visitor gets there: intent, CV, floor, sign-in, deck.
// =============================================================================================
const ready = page.getByRole('button', { name: /Ready\?/ });
if (await ready.count()) await qa.click(ready.first(), 'Ready? — open the front door');
const startQuestions = page.getByRole('button', { name: /Start questions instead/ });
if (await startQuestions.count()) await qa.click(startQuestions.first(), 'Start questions instead');
if (await page.locator('#target-role').count()) {
  await qa.fill('#target-role', PLACED_ROLE, `the job she is going for: "${PLACED_ROLE}"`);
  await qa.fill('#search-area', AREA, `where she is looking to start with: ${AREA}`);
  await qa.click('button:has-text("Save and continue")', 'Save and continue');
  await page.waitForTimeout(1200);
}

await qa.goto('/paste', 'she pastes her CV');
await qa.fill('textarea', CV_TEXT, 'the work history the deck will judge her against');
await qa.click('button.btn', 'send the CV to be read');
await page.waitForTimeout(2500);

await qa.goto('/discovery', 'into discovery — the family floor questions');
await qa.fill('#q1-role', PLACED_ROLE, 'answer question 1: the role she is going for');
await qa.click('button.go.wide', 'send question 1');
await page.waitForTimeout(2500);
const asked = await qa.answerFloorOnScreen();
await qa.note(`the questions her own screen put to her: ${asked.join(', ') || '(none)'}`);

const signIn = await asVisitor('POST', '/auth/request-link', { email: `stale-tailor-${Date.now()}@example.com` });
const devLink = signIn.json?.devLink;
await assertTrue(!!devLink, 'the sign-in link was issued over the real magic-link path');
await asVisitor('POST', '/auth/verify', { token: new URL(`http://x${devLink}`).searchParams.get('token') });

const earned = await cardsState();
await assertTrue(
  earned.retrieval?.outcome === 'relevant_postings' && earned.cards.length > 0,
  `she has earned a real deck to swipe on (${earned.cards.length} cards, ${earned.retrieval?.outcome})`,
);

// =============================================================================================
// 2. SHE SWIPES RIGHT. Tailoring starts on a specific advert — this is the job she must not lose.
// =============================================================================================
await qa.goto('/deck', 'the reveal');
const seeThem = page.getByRole('button', { name: 'See them' });
if (await seeThem.count()) await qa.click(seeThem.first(), 'See them — into the card deck');
await page.waitForTimeout(1500);
await qa.scrollThrough('read the top card top to bottom, the way a job seeker would');
await qa.click('button[aria-label="I want this one, tailor this job"]', 'she wants this one — tailor it');
await page.waitForTimeout(3000);

const tailoringNow = await json('/onboarding/tailor');
const targetAdId = tailoringNow?.card?.adId;
await qa.note(`she is tailoring: ${targetAdId}`);
await qa.scrollThrough('the tailoring screen she was handed to');
await assertTrue(
  /tailoring/i.test(await screenText()) && !!targetAdId,
  `TAILORING STARTED — she is on the tailor screen for a real advert (${targetAdId})`,
);

// =============================================================================================
// 3. SHE ADJUSTS HER INTENT — AC4's own flow, and the exact move that used to cost her the job.
// =============================================================================================
const changed = await asVisitor('PUT', '/sessions/me/intent', { searchAreas: [MOVED_TO] });
await assertTrue(changed.status === 200, `she moves her search to ${MOVED_TO} (${changed.status})`);

// 3a. THE SERVER HALF — unchanged and non-negotiable. A different search stales her snapshot, and a
//     posting she cannot currently be proved to have retrieved is not served to her. Fail-closed
//     (#101), pinned server-side by postingRetrievalHttp.test.ts. A "fix" that made this 200 would
//     be a leak, not a fix.
const staleTailor = await asVisitor('GET', '/onboarding/tailor');
await qa.note(`the server on her stale tailor target: ${staleTailor.status} ${staleTailor.text}`);
await assertTrue(
  staleTailor.status !== 200,
  `THE GATE HOLDS — the server still refuses the advert from her stale search (${staleTailor.status}, ${staleTailor.json?.error?.code})`,
);
const staleCard = await asVisitor('GET', `/onboarding/cards/${encodeURIComponent(targetAdId)}`);
await assertTrue(
  staleCard.status !== 200,
  `THE GATE HOLDS — naming that advert by id directly is refused too (${staleCard.status}, ${staleCard.json?.error?.code})`,
);

// 3b. THE SCREEN HALF — the defect. She comes back to the job she was working on.
await qa.goto('/tailor', 'she comes back to the job she was tailoring');
await page.waitForTimeout(2500);
await qa.scrollThrough('what she is actually looking at now');
const landedOn = new URL(page.url()).pathname;
const landedText = await screenText();
await qa.note(`she landed on ${landedOn} — the screen says: "${landedText.slice(0, 200)}"`);

await assertTrue(
  !/Couldn't open this job/i.test(landedText),
  `NO DEAD END — she is not told "Couldn't open this job." with nowhere to go: "${landedText.slice(0, 120)}"`,
);
await assertTrue(
  landedOn === '/deck',
  `SHE IS BACK WITH HER JOBS — /tailor sent her to the one screen that re-runs the search (landed on ${landedOn})`,
);

// And her jobs are genuinely there for the new place — not a second dead end wearing a different
// URL. This is what makes the redirect a way back rather than a way sideways.
const reRun = await cardsState();
await qa.note(`the deck after the move: ${reRun.retrieval?.outcome}, ${reRun.cards.length} cards`);
await assertTrue(
  reRun.retrieval?.outcome === 'relevant_postings' && reRun.cards.length > 0,
  `HER JOBS CAME BACK — the search re-ran for ${MOVED_TO} and she has a deck again (${reRun.cards.length} cards)`,
);
const backOnScreen = await screenText();
await assertTrue(
  /just matched you|Not for me|match/i.test(backOnScreen),
  `AND SHE CAN SEE THEM — the deck screen offers her jobs, not an error: "${backOnScreen.slice(0, 120)}"`,
);

// Nothing was reset on the way: her answers are hers, this was a redirect and not a fresh start.
const record = (await json('/sessions/me'))?.discovery;
await assertTrue(
  record?.checkpoint === 'essential_floor_covered',
  `NOTHING WAS TAKEN FROM HER — everything she answered survived the round trip (${record?.checkpoint})`,
);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
