// #338 — "Your CV, reviewed", walked the way a person walks it, over the REAL stack (fake model only):
//
//   1. she pastes her CV on the front door, says what she is going for, and answers the questions
//      the CV cannot answer (the floor is seeded over the wire — not under test here);
//   2. the LAST answer hands off to "Your CV, reviewed", not the jobs (AC1);
//   3. the paper: her letterhead first, then each job with its lines as read, all ticked (AC2);
//   4. she unticks a line (kept), reloads, re-ticks it, reloads — each tap is what the server stored (AC3);
//   5. a job with no end date asks on its own card; "Not sure" stores nothing; an answer corrects
//      the record (AC4);
//   6. the deck refuses her until she confirms — /deck sends her back here, the cards API holds — and
//      opens after "I'm done — show my jobs" (AC6);
//   7. she comes back to the review after confirming; a change made there persists (AC7).
//
// The import conflict (AC5) is not walked here: the fake miner's recording reads no field twice.
// apps/api/test/cvReview.test.ts proves it over HTTP and review.spec.ts proves the screen.
//
//   PORT=34101 node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 30338
//   BASE_URL=http://127.0.0.1:30338 node apps/web/e2e/cv-review-journey.mjs
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:30338';
const WIDTH = Number(process.env.QA_WIDTH ?? 390);
const ROLE = 'IT project manager';
const AREA = 'Singapore';

const CV_TEXT = [
  'Jane Doe',
  '+33 6 00 00 00 00 | jane.doe.338@example.com',
  'Warsaw, Poland',
  '',
  'EXPERIENCE',
  '',
  'IT Project Manager, Nordic Retail Group, Warsaw — Mar 2021 - Present',
  '- Led the checkout replatforming and delivered it two months ahead of plan.',
  '- Managed a budget of EUR 1.2M across three vendor teams.',
  '',
  'Project Coordinator, Baltic Software House, Warsaw — Jun 2017 - Feb 2021',
  '- Coordinated releases for four agile squads.',
  '',
  'EDUCATION',
  'MSc Management Information Systems, University of Warsaw, 2017',
].join('\n');

// The fake miner's recorded lines (apps/api/test/eval/recordings/clean-pdf.json).
const JOB_LINE = 'Managed a budget of EUR 1.2M across 3 vendor teams.';

const qa = await createSession(`cv-review-journey-${WIDTH}`, {
  baseURL: BASE,
  viewport: { width: WIDTH, height: WIDTH < 600 ? 844 : 900 },
});
const { page } = qa;
page.setDefaultTimeout(20_000);
const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
const json = (path, init) =>
  page.evaluate(
    async ([p, i]) => {
      const res = await fetch(`/api${p}`, { credentials: 'same-origin', ...(i ?? {}) });
      let body = null;
      try { body = await res.json(); } catch { /* no body */ }
      return { status: res.status, body };
    },
    [path, init ?? null],
  );
const reviewJobs = async () => (await json('/review')).body.sections.find((s) => s.tag === 'experience').jobs;
const lineState = async (id) =>
  (await reviewJobs()).flatMap((j) => j.lines).find((l) => l.id === id)?.state ?? null;
const sheet = page.getByRole('dialog');

// ---------------------------------------------------------------------------------------------
// 1. The CV, the job she is going for, and the questions the CV cannot answer.
// ---------------------------------------------------------------------------------------------
const jobId = await qa.frontDoorPaste(CV_TEXT, 'the front door — she pastes her CV');
await qa.waitForJobDone(jobId);
await qa.frontDoorContinueToIntent();
await qa.fill('#target-role', ROLE, `the job she is going for: "${ROLE}"`);
await qa.fill('#search-area', AREA, `where she wants to work: ${AREA}`);
await qa.click('button:has-text("Save and continue")', 'Save and continue');
await page.waitForTimeout(1500);

// A date hole to be asked about on the review: the product's own correction door, on her session.
const blocks = (await json('/job-blocks')).body?.blocks ?? [];
const bsh = blocks.find((b) => /baltic/i.test(b.employer.value));
await assert(!!bsh, `her dated job records were read (${blocks.length}) — the Baltic job among them`);
// The product's own name for that employer (the fake miner reads it its own way), never re-typed.
const BALTIC = bsh.employer.value;
const END_Q = `When did you leave ${BALTIC}?`;
await json(`/job-blocks/${bsh.id}/correct`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ key: 'end', value: { state: 'unknown' } }),
});

const seeded = await qa.seedFloorAnswers();
await qa.note(`floor answers seeded over the wire: ${seeded.length} (the floor leaves with #339)`);
await qa.goto('/discovery', 'the questions the CV cannot answer');
for (let i = 0; i < 8 && !/\/review/.test(page.url()); i += 1) {
  await page.waitForTimeout(1500);
  if (/\/review/.test(page.url())) break;
  const multiDone = page.locator('.discovery .elig-actions .go');
  if (await multiDone.count()) { await qa.click(multiDone.first(), 'finishes the multi-select question'); continue; }
  if (!(await qa.answerVisibleQuestion({ note: `answers the question on screen (${i + 1})` }))) {
    const later = page.getByRole('button', { name: 'Ask me later', exact: true });
    if (await later.count()) await qa.click(later.first(), 'ask me later');
    else break;
  }
}

// ---------------------------------------------------------------------------------------------
// 2. The last answer lands on "Your CV, reviewed", not the jobs. (AC1)
// ---------------------------------------------------------------------------------------------
await page.waitForURL(/\/review/, { timeout: 20_000 });
await assert(/\/review/.test(page.url()), `AC1 — after the last question she lands on the review (${new URL(page.url()).pathname})`);
await qa.expectText('h1', 'Your CV, reviewed', 'the screen names itself');
await qa.scrollThrough('she reads her CV on paper, top to bottom');

// ---------------------------------------------------------------------------------------------
// 3. Letterhead first, then job by job, lines as read and ticked. (AC2)
// ---------------------------------------------------------------------------------------------
const details = page.getByRole('button', { name: 'Your details' });
await qa.expectText(details, 'Jane Doe', 'her name, as read, at the top');
await qa.expectText(details, 'jane.doe.338@example.com', 'her email, as read');
const order = await page.locator('.paper .lhmark, .paper .pjob').evaluateAll((els) => els.map((el) => el.className.split(' ')[0]));
await assert(order[0] === 'lhmark' && order.filter((c) => c === 'pjob').length >= 2, `letterhead first, then the jobs (${order.join(' → ')})`);
const jobs = page.locator('.paper .pjob');
await qa.expectText(jobs.nth(0), 'Nordic Retail Group', 'the first job is the latest one, as on the CV');
await qa.expectText(jobs.nth(0), JOB_LINE, 'with its lines as read');
await qa.expectText(jobs.nth(1), BALTIC, 'then the earlier job');
const states = (await reviewJobs()).flatMap((j) => j.lines.map((l) => l.state));
await assert(states.length > 0 && states.every((s) => s === 'ticked'), `every line arrives ticked (${states.join(', ')})`);

// ---------------------------------------------------------------------------------------------
// 4. Untick → kept, re-tick → ticked, each surviving a reload. (AC3)
// ---------------------------------------------------------------------------------------------
const line = page.getByRole('button', { name: JOB_LINE });
await qa.click(line, 'taps a line');
await qa.expectText(sheet, 'On your CV', 'the sheet says where the line is');
await qa.click(sheet.getByRole('button', { name: 'Untick — keep it for when a job needs it' }), 'unticks it');
await qa.expectVisible(page.locator('.paper li.kept'), 'the line turns grey, marked kept');
const lineId = (await reviewJobs()).flatMap((j) => j.lines).find((l) => l.text === JOB_LINE)?.id;
await assert((await lineState(lineId)) === 'kept', 'the server stored the untick');
await qa.goto('/review', 'she reloads');
await qa.expectVisible(page.locator('.paper li.kept'), 'still kept after the reload');
await qa.click(page.locator('.paper li.kept .line'), 'taps the kept line');
await qa.expectText(sheet, 'Kept, not on your CV', 'the sheet says it is kept');
await qa.click(sheet.getByRole('button', { name: 'Tick — put it back on my CV' }), 're-ticks it');
await assert((await page.locator('.paper li.kept').count()) === 0, 'the line is back on the paper');
await qa.goto('/review', 'she reloads again');
await assert((await page.locator('.paper li.kept').count()) === 0 && (await lineState(lineId)) === 'ticked', 'the re-tick survived the reload');

// ---------------------------------------------------------------------------------------------
// 5. The missing end date, asked on the job's own card. (AC4)
// ---------------------------------------------------------------------------------------------
const pill = page.getByRole('button', { name: END_Q });
await qa.expectVisible(pill, 'the Baltic job wears an "end date?" pill in its date slot');
await qa.click(pill, 'taps the pill');
await qa.expectText(sheet, END_Q, 'the question, on that job');
await qa.click(sheet.getByRole('button', { name: 'Not sure' }), '"Not sure"');
await assert((await sheet.count()) === 0, 'the sheet closes');
const stillUnknown = (await json('/job-blocks')).body.blocks.find((b) => b.id === bsh.id).end.value.state;
await assert(stillUnknown === 'unknown', `"Not sure" stored nothing — the record still reads ${stillUnknown}`);
await qa.click(pill, 'taps the pill again');
await sheet.getByRole('combobox', { name: 'Month' }).selectOption('February');
await qa.fill(sheet.getByRole('textbox', { name: 'Year' }), '2021', 'the year she left');
await qa.click(sheet.getByRole('button', { name: 'Save' }), 'saves');
await page.waitForTimeout(1200);
const ended = (await json('/job-blocks')).body.blocks.find((b) => b.id === bsh.id).end;
await assert(
  ended.value.state === 'ended' && ended.value.date.year === 2021 && ended.value.date.month === 2 && ended.origin.kind === 'corrected',
  `the answer corrected the job record itself (${JSON.stringify(ended.value)})`,
);
await qa.expectText(jobs.nth(1), 'Feb 2021', 'the job now prints its end date');

// ---------------------------------------------------------------------------------------------
// 6. The jobs wait for the confirm. (AC6)
// ---------------------------------------------------------------------------------------------
const held = (await json('/onboarding/cards')).body;
await assert(held?.reviewPending === true && (held.cards ?? []).length === 0, `the cards API holds: ${JSON.stringify({ reviewPending: held?.reviewPending, cards: held?.cards?.length })}`);
await qa.goto('/deck', 'she tries the jobs directly');
await page.waitForURL(/\/review/, { timeout: 15_000 });
await assert(/\/review/.test(page.url()), 'the deck sends her back to the review');

await qa.click(page.getByRole('button', { name: "I'm done — show my jobs" }), '"I\'m done — show my jobs"');
await page.waitForURL(/\/deck/, { timeout: 15_000 });
await page.waitForTimeout(2500);
await assert(/\/deck/.test(page.url()), `she is on the jobs (${new URL(page.url()).pathname})`);
const opened = await qa.cardsWhenRetrieved();
await assert(opened?.reviewPending === undefined && (opened?.cards ?? []).length > 0, `the cards API opens: ${(opened?.cards ?? []).length} cards`);
await qa.scrollThrough('the reveal, as she sees it');

// ---------------------------------------------------------------------------------------------
// 7. Back to the review after confirming; a change made there persists. (AC7)
// ---------------------------------------------------------------------------------------------
await qa.goto('/review', 'she comes back to the review');
await qa.expectText('h1', 'Your CV, reviewed', 'it opens again');
await qa.click(page.getByRole('button', { name: JOB_LINE }), 'taps the same line');
await qa.click(sheet.getByRole('button', { name: 'Untick — keep it for when a job needs it' }), 'unticks it this time for good');
await assert((await lineState(lineId)) === 'kept', 'the server stored the change made after confirming');
const stillOpen = await qa.cardsWhenRetrieved();
await assert((stillOpen?.cards ?? []).length > 0 && stillOpen?.reviewPending === undefined, 'and the jobs stay open');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
