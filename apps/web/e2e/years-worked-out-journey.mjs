// #162 — "Years of experience is worked out, never asked": the whole journey a real person walks.
//
// Paste a CV with dated jobs -> the product mines dated job records -> walk the ENTIRE discovery
// ask-list and prove no question ever asks for a years-of-experience TOTAL (ADR-0008 clause 2, the
// ticket's own falsifiable check) -> open a date hole underneath (an unknown end) and prove the
// product asks for THAT date instead, saying why it matters (clause 3 / AC4) -> answer it and prove
// the correction sticks on the record underneath (AC5) -> then a second visitor with NO readable
// work history, whose deck must say the years bar was not tested rather than mark them down (AC6).
//
// Nothing is stubbed — real Fastify, real extraction, real miner parse, real job-block store, real
// Next build. Only the MODEL is faked (apps/api/dist/qa-main.js), so the run is free and
// deterministic. State that the UI has no affordance for (opening an unknown end) is set through the
// product's OWN correction endpoint, on the browser's own session cookie — never by reaching past it.
//
// Run it:
//   PORT=34101 node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 30162
//   BASE_URL=http://127.0.0.1:30162 node apps/web/e2e/years-worked-out-journey.mjs
//
// Run serially: every run mints an anonymous session and the API caps those per IP per hour.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:30162';
const ROLE = 'IT project manager in Singapore';

const CV_TEXT = [
  'Jane Doe',
  'jane.doe@example.com',
  'Warsaw, Poland',
  '',
  'EXPERIENCE',
  '',
  'IT Project Manager, Nordic Retail Group, Warsaw — Mar 2021 - Present',
  '- Led the checkout replatforming and delivered it two months ahead of plan.',
  '- Managed a budget of EUR 1.2M across three vendor teams.',
  '',
  'Project Coordinator, Baltic Software House, Warsaw — Jun 2017 - Feb 2021',
  '- Coordinated a team of twelve engineers and two business analysts.',
  '',
  'EDUCATION',
  'MSc Management Information Systems, University of Warsaw, 2017',
].join('\n');

const qa = await createSession('years-worked-out-journey', {
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

// A hard assertion the driver records with a screenshot either way.
const assertTrue = (cond, note) => qa.expectText('body', cond ? '' : '-THIS-CANNOT-APPEAR-', note);
const api = (method, path, data) => page.request.fetch(`${BASE}/api${path}`, { method, data });
const txt = async (sel) => ((await page.locator(sel).count()) ? (await page.locator(sel).first().innerText()).trim() : null);

// ---------------------------------------------------------------------------------------------
// 1. The front door, then the CV a real person pastes in.
// ---------------------------------------------------------------------------------------------
await qa.goto('/', 'the front door — where a real visitor starts');
await qa.scrollThrough('read the front door top to bottom');

// #271: the CV comes in through the front door's paste tile, the way a person brings one.
await qa.frontDoorPaste(CV_TEXT, 'pastes the dated work history the total will be worked out from');

// Wait for the product to have mined dated job records.
let blocks = [];
for (let i = 0; i < 60; i++) {
  const r = await api('GET', '/job-blocks');
  if (r.ok()) { const j = await r.json(); if ((j.blocks ?? []).length) { blocks = j.blocks; break; } }
  await page.waitForTimeout(500);
}
await qa.note(`the product read ${blocks.length} dated records: ` +
  blocks.map((b) => `${b.employer.value} — ${b.kind}, counts toward experience: ${b.countsTowardExperience}`).join('; '));
await assertTrue(blocks.length === 3, 'three dated records landed, one of them education');
await assertTrue(
  blocks.some((b) => b.kind === 'education' && b.countsTowardExperience === false),
  'AC2 — the education block is marked as NOT counting toward experience',
);

// ---------------------------------------------------------------------------------------------
// 2. Discovery — walk the WHOLE ask-list. No question may ask for a years TOTAL. (AC3, falsifiable)
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'into discovery — the sign-up questions');
await qa.fill('#q1-role', ROLE, 'the role this visitor is going for');
await qa.click('button.go.wide', 'answer the role question');
await page.waitForTimeout(2500);

const askedOnScreen = [];
for (let i = 0; i < 14; i++) {
  const q = await txt('.discovery #ask-q, .discovery legend.q, .discovery label.q');
  if (!q) break;
  if (askedOnScreen.includes(q)) break;
  askedOnScreen.push(q);
  await qa.scrollThrough(`question ${askedOnScreen.length} on screen: "${q}"`);
  // Skip forward without answering, so the walk sees every question the dock would show.
  const declineable = page.getByRole('button', { name: 'Ask me later', exact: true });
  const skip = page.getByRole('button', { name: /^(Skip|Not sure|Ask me later)$/i });
  if (await declineable.count()) await qa.click(declineable.first(), 'ask me later');
  else if (await skip.count()) await qa.click(skip.first(), 'skip this one');
  else break;
  await page.waitForTimeout(800);
}
await qa.note(`questions this visitor was actually shown:\n- ${askedOnScreen.join('\n- ')}`);

const wire = await (await api('GET', '/onboarding/discovery')).json();
const everyQuestion = (wire.questions ?? []);
const yearsTotalAsk = everyQuestion.filter(
  (q) => q.eligibility?.dimension === 'years-experience' || /how many years/i.test(q.question ?? ''),
);
await qa.note('every question still on the ask-list:\n- ' +
  everyQuestion.map((q) => `${q.itemId}: ${q.question}`).join('\n- '));
await assertTrue(
  yearsTotalAsk.length === 0 && !askedOnScreen.some((q) => /how many years/i.test(q)),
  'AC3 + ADR-0008 falsifiable check — nothing anywhere asks for a years-of-experience TOTAL',
);

// ---------------------------------------------------------------------------------------------
// 3. Open a date hole underneath, and see where the product asks instead. (AC3b, AC4)
//    #338: the question left the discovery ask-list for "Your CV, reviewed", where it sits on the
//    job's own card (ADR-0016 clause 2) — still before the deck, which the review now gates.
// ---------------------------------------------------------------------------------------------
await api('POST', '/job-blocks/nordic-retail-it-pm/correct', { key: 'end', value: { state: 'unknown' } });
await qa.note("the end date of the Nordic Retail job is now unknown — the hole ADR-0008 clause 3 says to ask about");

const holeInDiscovery = ((await (await api('GET', '/onboarding/discovery')).json()).questions ?? [])
  .filter((q) => q.itemId.startsWith('job-date-'));
await assertTrue(holeInDiscovery.length === 0, 'AC3b — discovery no longer asks for the date; the review does');
const reviewJobs = async () =>
  (await (await api('GET', '/review')).json()).sections.find((s) => s.tag === 'experience').jobs;
const holeOnWire = (await reviewJobs()).find((j) => j.blockId === 'nordic-retail-it-pm');
await qa.note(`the job as the review has it ready: ${JSON.stringify(holeOnWire, null, 2)}`);
await assertTrue(
  holeOnWire?.endDateQuestion === 'When did you leave Nordic Retail Group?',
  "AC3b — with a date missing, the product asks for THAT date, on the job's own card",
);

await qa.goto('/review', 'into "Your CV, reviewed" with a date hole open');
const pill = page.getByRole('button', { name: 'When did you leave Nordic Retail Group?' });
await qa.expectVisible(pill, 'the job wears a gold "end date?" pill in its date slot');
await qa.scrollThrough('the paper as the person actually sees it');
await qa.click(pill, 'taps the pill');
const sheet = page.getByRole('dialog');
await qa.expectText(sheet, 'When did you leave Nordic Retail Group?', 'AC3b on screen — the person is asked for the date');

// AC4 — the reason must be SAID ALOUD to the person, not merely carried on the wire.
const sheetText = await sheet.innerText();
await qa.note(`everything the sheet says to the person right now:\n${sheetText}`);
await assertTrue(/years of experience/i.test(sheetText), 'AC4 — the screen tells the person WHY this date matters');

// ---------------------------------------------------------------------------------------------
// 4. Answer it — the correction must stick on the record underneath. (AC5)
// ---------------------------------------------------------------------------------------------
await sheet.getByRole('combobox', { name: 'Month' }).selectOption('December');
await qa.fill(sheet.getByRole('textbox', { name: 'Year' }), '2024', 'the person types the year they left');
await qa.click(sheet.getByRole('button', { name: 'Save' }), 'saves the date');
await page.waitForTimeout(1500);
const corrected = ((await (await api('GET', '/job-blocks')).json()).blocks ?? [])
  .find((b) => b.id === 'nordic-retail-it-pm');
await qa.note(`the record underneath now reads: ${JSON.stringify(corrected?.end, null, 2)}`);
await assertTrue(
  corrected?.end?.value?.state === 'ended' &&
    corrected.end.value.date.year === 2024 && corrected.end.value.date.month === 12 &&
    corrected.end.origin?.kind === 'corrected',
  "AC5 — the answer corrected the job record itself, marked as the person's own correction",
);
const stillAsking = (await reviewJobs()).filter((j) => j.endDateQuestion);
await assertTrue(stillAsking.length === 0, 'AC5 — the question closes; the person is not asked twice');
await qa.expectText(page.locator('.paper'), 'Dec 2024', 'AC5 on screen — the job now prints its end date');

// ---------------------------------------------------------------------------------------------
// 5. A second visitor with NO readable work history — the deck must not mark them down. (AC6)
// ---------------------------------------------------------------------------------------------
// A like-for-like control: a visitor with a readable work history, against one with none — so the
// difference between the two decks that matters is whether the years bar was testable.
//
// #339: both used to answer the same discovery floor, which is gone. A visitor with NO facts at all
// is graded 0 on every requirement (judge.ts short-circuits), which would make "not lowered"
// meaningless, so the no-history visitor gets her one fact the way a visitor without a CV now does:
// a "Yes" to a requirement in the tailor step. The QA judge grades by requirement position, never by
// the facts' content, so any non-empty fact set scores an advert alike — the years bar is what
// can still move a score, and that is what this checks.
await page.context().clearCookies();
await qa.goto('/', 'a control visitor: a readable work history, no discovery answers');
await api('POST', '/sessions/anonymous', {});
await api('POST', '/cv/paste', { text: CV_TEXT });
await api('POST', '/review/complete'); // #338
for (let i = 0; i < 60; i++) {
  const r = await api('GET', '/job-blocks');
  if (r.ok() && ((await r.json()).blocks ?? []).length) break;
  await page.waitForTimeout(500);
}
await api('POST', '/onboarding/discovery/start', { role: ROLE });
const withHistory = await qa.cardsWhenRetrieved();
const scoredWith = Object.fromEntries((withHistory.cards ?? []).map((c) => [c.adId, c.matchPct]));
await qa.note(`control (a readable history, its CV's facts confirmed) scores: ${JSON.stringify(scoredWith)}`);
await assertTrue(
  !(withHistory.cards ?? []).some((c) => (c.notTested ?? []).length > 0),
  'AC6 — with a readable history nothing is marked untested; the bar is measured for real',
);

await page.context().clearCookies();
await qa.goto('/', 'a brand-new visitor, no CV, no work history at all');
await api('POST', '/sessions/anonymous', {});
await api('POST', '/onboarding/discovery/start', { role: ROLE });
// Her one fact: sign in (the tailor step is past the wall), want a job, say "Yes" to its first question.
const link = await (await api('POST', '/auth/request-link', { email: `years-nohistory-${Date.now()}@example.com` })).json();
await api('POST', '/auth/verify', { token: new URL(`http://x${link.devLink}`).searchParams.get('token') });
const firstDeck = await qa.cardsWhenRetrieved();
await api('POST', `/onboarding/cards/${encodeURIComponent(firstDeck.cards[0].adId)}/want`, {});
const tailorQ = ((await (await api('GET', '/onboarding/tailor')).json()).questions ?? []).find((q) => q.kind !== 'profile');
const told = await api('POST', '/onboarding/tailor/answer', { requirementId: tailorQ?.requirementId, answer: 'Yes, across three vendor teams' });
await qa.note(`the no-history visitor's one fact: "Yes" to "${tailorQ?.requirementId}" in the tailor step (HTTP ${told.status()})`);
const noHistory = await qa.cardsWhenRetrieved();
const untestedCard = (noHistory.cards ?? []).find((c) => (c.notTested ?? []).length > 0);
await qa.note(`the advert with a years bar, for a visitor with no history: ${JSON.stringify(
  untestedCard && { adId: untestedCard.adId, matchPct: untestedCard.matchPct, notTested: untestedCard.notTested }, null, 2)}`);
await assertTrue(!!untestedCard, 'AC6 — a years bar on an unreadable history is marked NOT TESTED');
await assertTrue(
  !!untestedCard && untestedCard.matchPct >= (scoredWith[untestedCard.adId] ?? 0),
  'AC6 — and the score is NOT lowered relative to the same advert for a visitor who had a history',
);
await assertTrue(
  !!untestedCard && !(untestedCard.dontYet ?? []).some((r) => (untestedCard.notTested ?? []).some((n) => n.id === r.id)),
  'AC6 — the untested bar is named once, never also as a gap the person failed',
);

// And on the screen the person actually looks at.
// The swipe deck. An anonymous visitor hits the sign-in wall first, so sign in the way a person
// does (the dev mailer's own link), then swipe forward to the one advert that states a years bar.
await qa.goto('/deck', 'the deck, as a visitor with no work history sees it');
await page.waitForTimeout(2000);
await qa.click(page.getByRole('button', { name: /See them/i }).first(), 'press "See them"');
await page.waitForTimeout(2000);
const email = page.locator('input[type="email"]');
if (await email.count()) {
  await qa.fill(email.first(), `qa162+${Date.now()}@example.com`, 'the wall asks for an email to keep the matches');
  await qa.click(page.getByRole('button', { name: /Email me a sign-in link/i }).first(), 'ask for the sign-in link');
  await page.waitForTimeout(2500);
  const dev = page.getByRole('link', { name: /Open your sign-in link \(dev\)/i })
    .or(page.getByRole('button', { name: /Open your sign-in link \(dev\)/i }));
  if (await dev.count()) { await qa.click(dev.first(), 'open the sign-in link'); await page.waitForTimeout(4000); }
}
const again = page.getByRole('button', { name: /See them/i });
if (await again.count()) { await qa.click(again.first(), 'open the deck'); await page.waitForTimeout(3000); }

let onYearsAd = false;
for (let i = 0; i < 12; i++) {
  const title = await page.locator('.jobcard h2').first().innerText().catch(() => '');
  if (/8\+ years of IT experience/i.test(await page.locator('body').innerText())) { onYearsAd = true; break; }
  const next = page.getByRole('button', { name: /Not for me/i });
  if (!(await next.count())) break;
  await qa.click(next.first(), `not for me ("${title.trim()}") — show the next job`);
  await page.waitForTimeout(1600);
}
await qa.note(`reached the advert that states a years bar: ${onYearsAd ? 'YES' : 'NO'}`);
await qa.scrollThrough('read the card top to bottom, the way a person does');
const deckText = await page.locator('body').innerText();
await qa.note(`does the deck say the bar was not tested? ${/not tested/i.test(deckText) ? 'YES' : 'NO'}`);
await assertTrue(/not tested/i.test(deckText), 'AC6 on screen — the card tells the person the bar was not tested');
await assertTrue(
  /couldn't measure you against this one/i.test(deckText),
  'AC6 on screen — and says, in plain words, that adding the dates is what changes it',
);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
