// #307 — "Asked once, remembered for every job": the Tailor queue's profile-level question,
// driven the way a person meets it.
//
// What this journey proves ON THE RENDERED SCREEN, against a real stack:
//
//   1. A job whose advert states a work-rights requirement asks about it IN THE TAILOR QUEUE,
//      FIRST — before any of the advert's own questions (AC1/AC3).
//   2. The line "I'll remember this for every job in Hong Kong." shows BEFORE he answers, and the
//      options carry no decline — "not sure yet" is #308's, and a skip may never harden (AC6).
//   3. Answering "Yes" prints the after-line and moves the queue on to the advert's own questions.
//   4. The NEXT Hong Kong job with the same stated gate asks NOTHING — answered once, ever (AC5).
//   5. A fresh person answering "Not yet — I'd need sponsorship" on a FOUND job sees the honest
//      consequence — "Hidden 2 Hong Kong jobs from your deck" — and both adverts are really gone.
//
//   PORT=34201 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34201 npx next build && npx next start -p 34200
//   BASE_URL=http://127.0.0.1:34200 node apps/web/e2e/asked-once-journey.mjs
//
// ADVERT NOTE — same shape as language-ladder-journey.mjs's (#209), same reason: the shipped
// corpus states work rights in 0 of 17 postings (the corpus research measured it), so the two
// adverts this journey needs are canned in qa-main.ts (QA_WORK_RIGHTS_ADVERTS), armed by this
// journey for this run only, and put back at the end. The VISITOR's side is never seeded: the
// discovery work-rights question is deliberately LEFT UNANSWERED (the floor seeding answers floor
// items only), because the queue exists precisely for the person who arrives at a job with the
// fact still unknown.
import { createSession } from './qa-driver.mjs';
import { liveAdId } from './live-ad-id.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34200';
const ROLE = 'IT project manager in Hong Kong';
const AD_A = liveAdId('2026-07-09_charterhouse-partnership-asia_senior-business-analyst-product-manager-1-year-contract');
const AD_B = liveAdId('2026-07-09_sanderson-ikas-hong-kong_business-analyst-product-manager-digital-transformation-mobile');

const REMEMBER = "I'll remember this for every job in Hong Kong.";
const QUESTION = 'Can you already work in Hong Kong without visa sponsorship?';
const AFTER_YES = 'Remembered: you can work in Hong Kong. No job will ask you this again.';
const AFTER_NO = 'Hidden 2 Hong Kong jobs from your deck — change this any time in your profile.';
// #309 AC3: the withdrawal names its reason — the line above the count on the gone screen.
const WITHDRAW_REASON =
  "This job needs the right to work in Hong Kong, and your answer says you don't have it — so it has come off your deck.";

const qa = await createSession('asked-once-journey', {
  baseURL: BASE,
  viewport: { width: 390, height: 844 },
});
const { page } = qa;
page.setDefaultTimeout(12000);

const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
const txt = async (sel) => (await page.locator(sel).count())
  ? (await page.locator(sel).first().textContent()).trim() : null;

const setWorkRightsAdverts = (on) =>
  page.evaluate(
    (workRightsAdverts) => fetch('/api/qa/stack', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workRightsAdverts }),
    }).then((r) => r.status).catch(() => 'unreachable'),
    on,
  );

/** Discovery start + floor seeding + real magic-link sign-in, all over the live routes — the
 *  tailor-journey pattern. The eligibility questions are deliberately not touched. */
async function seedSignedInSession(email) {
  await qa.goto('/discovery', 'land on discovery — establishes the anonymous session');
  await page.waitForTimeout(700);
  await page.evaluate(
    async ({ role }) =>
      fetch('/api/onboarding/discovery/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      }).then(() => undefined),
    { role: ROLE },
  );
  const seededItems = await qa.seedFloorAnswers();
  if (seededItems.length === 0) throw new Error('no floor questions were served - the session was never placed');
  await qa.note(`seeded the floor (floor items only — work-rights stays UNANSWERED): ${seededItems.join(', ')}`);
  const seeded = await page.evaluate(async ({ addr }) => {
    const post = (url, body) =>
      fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const res = await post('/api/auth/request-link', { email: addr });
    const link = await res.json().catch(() => ({}));
    if (!link.devLink) return `sign-in failed (${res.status}): ${JSON.stringify(link)}`;
    const token = new URL('http://x' + link.devLink).searchParams.get('token');
    await post('/api/auth/verify', { token });
    return 'ok';
  }, { addr: email });
  if (seeded !== 'ok') throw new Error(`could not seed the session: ${seeded}`);
}

const want = (adId) => page.evaluate(
  (id) => fetch(`/api/onboarding/cards/${encodeURIComponent(id)}/want`, { method: 'POST', credentials: 'same-origin' })
    .then((r) => r.status),
  adId,
);

// -------------------------------------------------------------------------------------------
// 0. Arm the QA work-rights adverts — asserted, not noted (a silently-failed arm would leave
//    this journey green while proving nothing; #209's own rule).
// -------------------------------------------------------------------------------------------
await qa.goto('/', 'the front door — where a real visitor starts');
const armed = await setWorkRightsAdverts(true);
await qa.note(`armed the QA work-rights adverts for this run: HTTP ${armed}`);
await assert(armed === 200, `the QA stack accepted the arming call (got ${armed})`);

// -------------------------------------------------------------------------------------------
// 1. Person one: discovery floor, sign in, deck up — work-rights never asked, never answered.
// -------------------------------------------------------------------------------------------
await seedSignedInSession(`asked-once-a-${Date.now()}@example.com`);
const deck = await qa.cardsWhenRetrieved();
await assert(
  deck && deck.cards?.some((c) => c.adId === AD_A) && deck.cards?.some((c) => c.adId === AD_B),
  'both Hong Kong work-rights adverts are in the deck (the arm really took)',
);

// -------------------------------------------------------------------------------------------
// 2. Open job A in the tailor. The PROFILE question comes first, with the remember line.
// -------------------------------------------------------------------------------------------
await assert((await want(AD_A)) === 200, 'job A becomes the tailor target');
await qa.goto('/tailor', 'the Tailor step for job A');
await qa.expectVisible('.jobdeck.tailor', 'the tailor screen mounted');
await qa.expectText('.tailor .ask .q', QUESTION,
  'AC1/AC3: the FIRST question in the queue is the profile-level work-rights question — asked here, before the draft, not on the paste door, the job screen or the profile');
await qa.expectText('.tailor .ask .notice', REMEMBER,
  'AC6: he is told BEFORE answering that the answer will be remembered for every job');
const options = await page.locator('.tailor .opts .opt').allTextContents();
await qa.note(`options offered: ${JSON.stringify(options)}`);
await assert(
  options.length === 2 && !options.some((o) => /ask me later/i.test(o)),
  'two answers, no decline — the discovery decline (which hardens into a blank) cannot be tapped here',
);
// #308: the way out is the skip, visibly apart from the answers — it stores nothing (person two
// below proves that live) and the question returns on the next job that asks.
await qa.expectText('.tailor .ask .skip', 'Not sure yet',
  "#308: the third option is there — 'Not sure yet', not one of the answers");
await qa.scrollThrough('read the queue screen the way a person would');

// -------------------------------------------------------------------------------------------
// 3. Answer "Yes". The after-line lands; the queue moves on to the advert's own questions.
// -------------------------------------------------------------------------------------------
await qa.click(page.getByRole('button', { name: 'Yes — no sponsorship needed' }), 'answer the permanent question with a yes');
await page.waitForTimeout(1400);
await qa.expectText('.tailor .ledger', AFTER_YES,
  'AC6: one line after, saying what changed — remembered, and never asked again');
const nextQ = await txt('.tailor .ask .q');
await qa.note(`the queue moved on to: ${JSON.stringify(nextQ)}`);
await assert(/^This job wants:/.test(nextQ ?? ''),
  "AC3: with the profile question answered, the advert's own questions follow in the same queue");
await assert((await page.locator('.tailor .ask .notice').count()) === 0,
  'the remember line belongs to the permanent question alone — an advert question carries none');

// -------------------------------------------------------------------------------------------
// 4. AC5 — the NEXT Hong Kong job with the same stated gate asks nothing.
// -------------------------------------------------------------------------------------------
await assert((await want(AD_B)) === 200, 'job B becomes the tailor target');
await qa.goto('/tailor', 'the Tailor step for job B — same market, same stated requirement');
await qa.expectVisible('.jobdeck.tailor', 'the tailor screen mounted for job B');
const firstQOnB = await txt('.tailor .ask .q');
await qa.note(`job B's first question: ${JSON.stringify(firstQOnB)}`);
await assert(/^This job wants:/.test(firstQOnB ?? ''),
  'AC5: the work-rights answer given on job A is never asked again — job B opens straight on its own questions');
await assert(firstQOnB !== QUESTION, 'the profile question specifically is gone');

// -------------------------------------------------------------------------------------------
// 5. Person two: "Not sure yet" first (#308 — stores nothing, returns on the next job), then
//    the "Not yet" path. A found job withdraws, honestly, with the count.
// -------------------------------------------------------------------------------------------
await qa.note('— a fresh person now, same deck, skipping first and then answering the other way —');
await page.context().clearCookies();
await seedSignedInSession(`asked-once-b-${Date.now()}@example.com`);
await qa.cardsWhenRetrieved();
await assert((await want(AD_A)) === 200, 'person two targets job A');
await qa.goto('/tailor', 'the Tailor step again, fresh session');
await qa.expectText('.tailor .ask .q', QUESTION, 'the question is asked afresh for a person who never answered');

// #308 AC1/AC2/AC5: the skip, live. Nothing saved, this job stops asking, the next one asks again.
await qa.click(page.locator('.tailor .ask .skip'), "person two is not sure — 'Not sure yet'");
await page.waitForTimeout(1400);
await qa.expectText('.tailor .ledger', 'Nothing saved — I\'ll ask again on another job in Hong Kong.',
  '#308: the skip says both halves out loud — nothing saved, and it will be asked again');
const afterSkipQ = await txt('.tailor .ask .q');
await qa.note(`the queue after the skip: ${JSON.stringify(afterSkipQ)}`);
await assert(/^This job wants:/.test(afterSkipQ ?? ''),
  "#308: the skipped question stepped aside — the advert's own questions follow, and this job never re-asks");

await assert((await want(AD_B)) === 200, 'person two moves to job B — the next job that states the gate');
await qa.goto('/tailor', 'the Tailor step for job B');
await qa.expectText('.tailor .ask .q', QUESTION,
  '#308 AC2: not now meant not now — the next job that needs the answer asks again');
await qa.click(page.getByRole('button', { name: "Not yet — I'd need sponsorship" }), 'answer the permanent question with a no');
await page.waitForTimeout(1400);
await qa.expectVisible(page.getByRole('heading', { name: 'Saved to your profile' }),
  'the answer is kept — the screen says so, and the job is not');
await qa.expectText('.jobdeck.tailor .loadstate .gone-reason', WITHDRAW_REASON,
  '#309 AC3: the job that vanished because he just answered says WHY — a rule he learns, not a bug he suspects');
await qa.expectText('.jobdeck.tailor .loadstate p:not(.gone-reason)', AFTER_NO,
  'AC6: the honest consequence, with the count — both Hong Kong work-rights jobs, this one included');
await qa.click(page.getByRole('button', { name: 'Back to the deck' }), 'the one door off the gone screen');
await page.waitForURL('**/deck', { timeout: 10_000 });

const after = await qa.cardsWhenRetrieved();
const idsAfter = (after?.cards ?? []).map((c) => c.adId);
await qa.note(`deck after the no: ${JSON.stringify(idsAfter)}`);
await assert(!idsAfter.includes(AD_A) && !idsAfter.includes(AD_B),
  'both Hong Kong work-rights adverts are really gone from the deck — the line told the truth');

// -------------------------------------------------------------------------------------------
// 6. Put the knob back.
// -------------------------------------------------------------------------------------------
const disarmed = await setWorkRightsAdverts(false);
await assert(disarmed === 200, `the QA work-rights adverts are disarmed again (got ${disarmed})`);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
