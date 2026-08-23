// #278 — the work-history check gets a door on the real journey, and this is the journey that
// walks through it.
//
// The check (/job-blocks) is where a person puts right what the CV read got wrong about her dated
// jobs: the title, the dates, "that was education, not a job". Its ONLY entrance used to be a
// button on the draft screen, and #272 deleted that screen — after which five browser journeys
// reached it by TYPING ITS ADDRESS, which no real person does. A correction door nobody can find
// is not a correction door: the machine's mis-read simply stands, and the years total, the job
// family and the change-of-direction sentence all inherit it in silence.
//
// The new door is on the PROFILE, inside Professional Experience — the screen that already shows
// what was read from the CV with a door beside it (#190/#194). It is passive: always offered,
// never a nudge (nothing on that payload says which record looks doubtful, and inventing a doubt
// would be a "what you lack" list by another name).
//
// So this journey types no address after the front door:
//   front door -> paste a CV -> role and area -> discovery -> tap the pile of facts -> the profile
//   -> the work-history door -> correct a record -> back to the profile.
//
// What it proves, and what it deliberately leaves to other journeys:
//   PROVED HERE — every screen on that chain is reachable by clicking, the door exists where a
//   person will look for it, the way back out is visible from the first card (the exit is the whole
//   point of a door), and a correction made through it both lands on the record and moves
//   `countsTowardExperience` — the value her years total, her family years and her
//   change-of-direction sentence are ALL worked out from.
//   NOT RE-PROVED HERE — the arithmetic downstream of that value: what the deck then does with it.
//   years-worked-out-journey.mjs (#162), family-years-scope-journey.mjs (#222) and
//   change-of-direction-derived-journey.mjs (#256) each ride the same records into a scored card,
//   and every one of them needs a sign-in this journey has no reason to spend.
//
// Nothing is stubbed — real Fastify, real extraction, real miner parse, real job-block store, real
// Next build. Only the MODEL is faked (apps/api/dist/qa-main.js), so the run is free and
// deterministic.
//
// Run it:
//   PORT=34278 node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34278 npx next build && npx next start -p 30278
//   BASE_URL=http://127.0.0.1:30278 node apps/web/e2e/work-history-door-journey.mjs

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:30278';

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

const qa = await createSession('work-history-door-journey', { baseURL: BASE, viewport: { width: 1280, height: 950 } });
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

/** A hard assertion the driver records with a screenshot either way. */
const assertTrue = (cond, note) => qa.expectText('body', cond ? '' : '-THIS-CANNOT-APPEAR-', note);
const api = (method, path, data) => page.request.fetch(`${BASE}/api${path}`, { method, data });
const blocksNow = async () => ((await (await api('GET', '/job-blocks')).json()).blocks ?? []);

// ---------------------------------------------------------------------------------------------
// 1. The front door — she brings her CV in, then says what she is going for.
// ---------------------------------------------------------------------------------------------
await qa.frontDoorPaste(CV_TEXT, 'she pastes a CV with two dated jobs and a degree');

let mined = [];
for (let i = 0; i < 60; i++) {
  mined = await blocksNow();
  if (mined.length) break;
  await page.waitForTimeout(500);
}
await qa.note(`the read produced ${mined.length} dated records: ` +
  mined.map((b) => `${b.employer.value} / ${b.title.value} (${b.kind})`).join('; '));
await assertTrue(mined.length >= 2, 'the CV produced dated job records for her to check');

await qa.frontDoorContinueToIntent();
await qa.fill('#target-role', 'IT project manager', 'the job she is going for');
await qa.fill('#search-area', 'Hong Kong', 'where she wants to work');
await qa.click('button:has-text("Save and continue")', 'Save and continue');
await page.waitForURL(/\/discovery/, { timeout: 60000 });
await qa.note(`the front door handed her on by itself — she is now at ${new URL(page.url()).pathname}`);

// ---------------------------------------------------------------------------------------------
// 2. Discovery -> the profile. Clicked, never typed.
// ---------------------------------------------------------------------------------------------
// The pile of facts is the only visible way onto the profile, and #17 spec 6 renders it at 1 fact,
// never at 0 — a CV read alone does not mint one. So she answers a question first, the way she
// would anyway: this is the shape of the real journey, not a workaround for the test.
if (await page.locator('#q1-role').isVisible().catch(() => false)) {
  await qa.fill('#q1-role', 'IT project manager', 'the kind of job she is going for');
  await qa.click('button.go.wide', 'she answers the first question');
  await page.waitForTimeout(2500);
}
await qa.answerFloorOnScreen({ limit: 2 });
await page.locator('a.prof').waitFor({ state: 'visible', timeout: 60000 });
await qa.click('a.prof', 'she taps the pile of facts to see what the product now knows about her');
await page.waitForURL(/\/profile/, { timeout: 30000 });
await qa.expectVisible('.dom', 'her profile opens on what was read from her CV');
await qa.scrollThrough('reads her profile top to bottom, looking for her work history');

// ---------------------------------------------------------------------------------------------
// 3. THE DOOR. It is in Professional Experience, beside the jobs it is about.
// ---------------------------------------------------------------------------------------------
const experience = page.locator('.dom').filter({ has: page.locator('.dname', { hasText: 'Professional Experience' }) });
await assertTrue((await experience.count()) > 0, 'her CV produced a Professional Experience section on the profile');
const doorIn = () => experience.getByRole('link', { name: 'Check your work history' });
await assertTrue((await doorIn().count()) === 1, 'the work-history door sits inside Professional Experience, beside the jobs it is about');

await qa.click(doorIn(), 'she taps "Check your work history"');
await page.waitForURL(/\/job-blocks/, { timeout: 30000 });
await qa.expectVisible('.jb-card', 'the work-history check opens — reached by clicking, with no address typed');
await qa.expectText('h1', 'Check your work history', 'the screen names itself in plain words');

// A door she can walk back out of. Without this the only exit is swiping every card in the deck.
await qa.expectVisible('.jb-leave', 'the way back to her profile is visible from the very first card');

// ---------------------------------------------------------------------------------------------
// 4. She corrects a record — the whole reason the screen needed a door.
// ---------------------------------------------------------------------------------------------
const CORRECTED_TITLE = 'Senior IT Project Manager';
await qa.click('.jb-card', 'she taps the card to put it right');
await qa.expectVisible('.jb-back', 'the correction panel opens on the card');
const wrongTitle = await page.locator('#jb-title').inputValue();
await qa.note(`the machine read this record's title as "${wrongTitle}" — she has a correction to make`);
await qa.fill('#jb-title', CORRECTED_TITLE, 'she puts the title right');
await qa.click('.jb-backacts .btn:has-text("Save and continue")', 'saves the correction');
await page.waitForTimeout(1500);

const corrected = (await blocksNow()).find((b) => b.title.value === CORRECTED_TITLE);
await qa.note(`the record on the server now reads: ${JSON.stringify(corrected?.title, null, 2)}`);
await assertTrue(
  !!corrected && corrected.title.origin?.kind === 'corrected',
  'the correction reached the record on the server, marked as HER correction rather than a read',
);

// ---------------------------------------------------------------------------------------------
// 5. The correction that moves a NUMBER. Her degree line was a paid research post; the machine
//    filed it as education, so it adds nothing to her years. This is the ticket's own example
//    ("that was education, not a job"), and `countsTowardExperience` is the value the years total,
//    the family years and the change-of-direction sentence are all worked out from — so watching it
//    flip is watching the correction reach downstream, without a deck or a sign-in.
// ---------------------------------------------------------------------------------------------
const DEGREE = 'University of Warsaw';
const cardText = async () => ((await page.locator('.jb-card').textContent()) || '').replace(/\s+/g, ' ').trim();
let onDegree = false;
for (let i = 0; i < 8; i++) {
  if (!(await page.locator('.jb-card').count())) break;
  if ((await cardText()).includes(DEGREE)) { onDegree = true; break; }
  await qa.click('.jb-cbtn.yes', 'that one is right — she confirms it and moves on');
  await page.waitForTimeout(1400);
}
await assertTrue(onDegree, 'she reaches the record the machine filed as her education');

const before = (await blocksNow()).find((b) => b.employer.value === DEGREE);
await qa.note(`before she touches it: kind=${before?.kind}, counts toward experience=${before?.countsTowardExperience}`);
await assertTrue(before?.countsTowardExperience === false, 'as read, it adds nothing to her years of experience');

await qa.click('.jb-card', 'she taps it — that one was paid work, not a course');
await qa.expectVisible('.jb-back', 'the correction panel opens');
await qa.click('.jb-back .jb-choice button:has-text("A job")', 'she tells the product it was a job');
await page.waitForTimeout(600);
const consequence = ((await page.locator('.jb-consequence').textContent()) || '').trim();
await qa.note(`the screen tells her what this does: "${consequence}"`);
await assertTrue(/adds about/.test(consequence), 'the screen states the years consequence in her own words, before she commits to it');
await qa.click('.jb-backacts .btn:has-text("Save and continue")', 'saves the correction');
await page.waitForTimeout(1500);

const after = (await blocksNow()).find((b) => b.employer.value === DEGREE);
await qa.note(`after her correction: kind=${after?.kind}, counts toward experience=${after?.countsTowardExperience}, origin=${after?.kindDecision?.origin?.kind}`);
await assertTrue(
  after?.kind === 'job' && after?.countsTowardExperience === true && after?.kindDecision?.origin?.kind === 'corrected',
  'her correction flipped the value her years, her family years and her change-of-direction sentence are all worked out from',
);

// ---------------------------------------------------------------------------------------------
// 6. Back out the way she came in — and the correction is still there when she returns.
// ---------------------------------------------------------------------------------------------
await qa.click('.jb-leave', 'she taps "Back to your profile"');
await page.waitForURL(/\/profile/, { timeout: 30000 });
await qa.expectVisible('.dom', 'she is back on her profile, where she started');

await qa.click(doorIn(), 'she goes back in through the same door to check her work held');
await page.waitForURL(/\/job-blocks/, { timeout: 30000 });
await page.waitForTimeout(1200);
const stillThere = (await blocksNow()).some((b) => b.title.value === CORRECTED_TITLE);
await assertTrue(stillThere, 'her correction survived leaving the screen and coming back — it is a fact about her now');

// The gate reads the EXIT CODE, nothing else (run-tier2.mjs). Without this the whole journey is
// decorative: every assertion above can go red and the run still reports success.
const ok = await qa.finish();
process.exit(ok ? 0 : 1);
