// #338 — "Your CV, reviewed", walked the way a person walks it, over the REAL stack (fake model only):
//
//   1. she pastes her CV on the front door, says what she is going for, and answers the questions
//      the CV cannot answer (#339: work rights and languages — discovery asks nothing else);
//   2. the LAST answer hands off to "Your CV, reviewed", not the jobs (AC1);
//   3. the paper: her letterhead first, then each job with its lines as read, all ticked (AC2);
//   4. she unticks a line (kept), reloads, re-ticks it, reloads — each tap is what the server stored (AC3);
//   5. a job with no end date asks on its own card; "Not sure" stores nothing; an answer corrects
//      the record (AC4);
//   6. the deck refuses her until she confirms — /deck sends her back here, the cards API holds — and
//      opens after "I'm done — show my jobs" (AC6);
//   7. she comes back to the review after confirming; a change made there persists (AC7).
//
// #341 — the review runs in the background, walked in the same pass: the run is HELD on the QA
// stack (POST /qa/stack reviewHold) from before the paste, so when she lands on the review it is
// still going — the progress card, the jobs greyed and "still being checked", the confirm locked;
// released, the card goes and the marks land: the fix (its word green on the paper, original →
// corrected and Undo / Use fix in the sheet, undo surviving a reload), and the amber suggestion
// band with its reason, unticked in one tap. Both marks come from the REVIEWCHECK recording
// (qa-main.ts): a misspelt word and an aim with no result on two of her lines.
//
// #342 — the drafted lines, in the same pass: the fake drafts one line per must-have of the IT
// project manager family that her Nordic job does not show (qaReviewAnswer.ts), plus an OPTIONAL
// and an INDUSTRY GUESS line. She sees them as dashed boxes at the end of that job, each with its
// source under it; the Baltic job (no family) gets none. She ticks one with the +, edits another's
// wording in the sheet and ticks it there, reloads, and the server holds what she did; the unticked
// ones never print (apps/api/test/cvReviewRun.test.ts proves the print gate through each door).
//
// The import conflict (AC5) is not walked here: the fake miner's recording reads no field twice.
// apps/api/test/cvReview.test.ts proves it over HTTP and review.spec.ts proves the screen. The
// COMPLETE stamp is not walked either: the recording's lines show none of the must-haves.
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
  '',
  // #341: the marker that makes the fake miner read two of her lines with a mistake in them.
  'REVIEWCHECK',
].join('\n');

// The fake miner's recorded lines (apps/api/test/eval/recordings/clean-pdf.json), as the
// REVIEWCHECK recording reads them: the budget line misspelt (the review fixes it back to the
// recorded text), the steering line stating an aim with no result (the review suggests unticking it).
const JOB_LINE = 'Managed a budget of EUR 1.2M across 3 vendor teams.';
const JOB_LINE_AS_READ = 'Managed a budget of EUR 1.2M accross 3 vendor teams.';
const AIM_LINE = 'Set up steering committee reporting intended to keep the CIO informed.';

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
const lineText = async (id) =>
  (await reviewJobs()).flatMap((j) => j.lines).find((l) => l.id === id)?.text ?? null;
const sheet = page.getByRole('dialog');
// #341: the review run's hold on the QA stack. Armed before the paste, released once she has seen
// the progress card, and put back at the end whatever happened (run-tier2.mjs's one-owner rule).
const holdReview = (on) =>
  json('/qa/stack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reviewHold: on }) });

// ---------------------------------------------------------------------------------------------
// 1. The CV, the job she is going for, and the questions the CV cannot answer.
// ---------------------------------------------------------------------------------------------
await qa.goto('/', 'the front door');
await assert((await holdReview(true)).status === 200, 'the QA stack holds the review run until she has seen it running');
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

// #339: what is left to ask is eligibility — work rights for her market, then languages.
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

// ---------------------------------------------------------------------------------------------
// 2b. #341 — the review is still running: the progress card, the jobs greyed, the confirm locked.
// ---------------------------------------------------------------------------------------------
const progress = page.getByRole('status');
await qa.expectText(progress, 'Checking your CV…', 'the progress card: the review runs in the background');
await qa.expectText(progress, 'jobs ready', 'it counts the jobs that are ready');
await qa.expectText(progress, 'You can start with the parts that are ready.', 'and says she can start');
const busyJobs = page.locator('.paper .pjob.busy');
await assert((await busyJobs.count()) > 0, `her jobs are greyed while they are checked (${await busyJobs.count()} of ${await page.locator('.paper .pjob').count()})`);
await qa.expectText(busyJobs.first(), 'Still checking this job', 'each says it is still being checked');
await qa.expectText(busyJobs.first(), JOB_LINE_AS_READ, 'with its lines as read, meanwhile — the misspelling included');
const cta = page.getByRole('button', { name: "I'm done — show my jobs" });
await assert(await cta.isDisabled(), 'the confirm is locked while the check runs');
await qa.expectText('.foot p', 'Your jobs open when the check is finished.', 'and says why');
const refused = await json('/review/complete', { method: 'POST' });
await assert(refused.status === 409 && refused.body?.error?.code === 'review_running', `the server refuses the confirm too (${refused.status} ${refused.body?.error?.code})`);
await qa.scrollThrough('she reads her CV on paper while it is checked');

await assert((await holdReview(false)).status === 200, 'the review run is let through');
await progress.waitFor({ state: 'detached', timeout: 20_000 });
await qa.note('the progress card goes when the check is finished');
await assert((await page.locator('.paper .pjob.busy').count()) === 0, 'no job is greyed any more');
await assert(await cta.isEnabled(), 'the confirm opens');
await qa.expectText('.foot p', 'You can come back to this page at any time.', 'the footer says so');

// ---------------------------------------------------------------------------------------------
// 2c. #341 — the fix: its word green on the paper, original → corrected in the sheet, Undo, Use fix.
// ---------------------------------------------------------------------------------------------
await qa.expectText('.legend', 'fixed', 'the legend names the marks');
const fixedLine = page.getByRole('button', { name: JOB_LINE });
await qa.expectVisible(fixedLine, 'the budget line reads correctly now: the fix was applied for her');
await qa.expectText(fixedLine.locator('mark.fx'), 'across', 'the corrected word is marked');
const budgetId = (await reviewJobs()).flatMap((j) => j.lines).find((l) => l.text === JOB_LINE)?.id;
await assert(!!budgetId && (await lineText(budgetId)) === JOB_LINE, 'the server holds the corrected text');
await qa.click(fixedLine, 'taps the mark');
await qa.expectText(sheet, 'We fixed a small mistake', 'the sheet shows the fix');
await qa.expectText(sheet.locator('.fixdiff s'), 'accross', 'the original, struck');
await qa.expectText(sheet.locator('.fixdiff .to'), 'across', 'the correction');
await qa.click(sheet.getByRole('button', { name: 'Undo' }), 'undoes it');
await qa.expectText(sheet.locator('.quote'), JOB_LINE_AS_READ, 'the line reads her exact original again');
await assert((await lineText(budgetId)) === JOB_LINE_AS_READ, 'the server stored the undo, to the letter');
await qa.click(sheet.getByRole('button', { name: 'Close' }), 'closes the sheet');
await qa.goto('/review', 'she reloads');
await qa.expectVisible(page.getByRole('button', { name: JOB_LINE_AS_READ }), 'still her original after the reload');
await assert((await page.locator('.paper mark.fx').count()) === 0, 'and no fix mark on it');
await qa.click(page.getByRole('button', { name: JOB_LINE_AS_READ }), 'taps the line');
await qa.click(sheet.getByRole('button', { name: 'Use fix' }), 'uses the fix after all');
await qa.expectText(sheet.locator('.quote'), JOB_LINE, 'the line reads the correction again');
await qa.click(sheet.getByRole('button', { name: 'Close' }), 'closes the sheet');
await assert((await lineText(budgetId)) === JOB_LINE, 'the server stored that too');

// ---------------------------------------------------------------------------------------------
// 2d. #341 — the suggestion: the amber band, the reason in the sheet, one tap unticks.
// ---------------------------------------------------------------------------------------------
const band = page.locator('.paper li.sg');
await qa.expectVisible(band, 'one line wears the amber band: the review suggests unticking it');
await qa.expectText(band, AIM_LINE, 'the line that states an aim and no result');
const aimId = (await reviewJobs()).flatMap((j) => j.lines).find((l) => l.text === AIM_LINE)?.id;
await assert((await lineState(aimId)) === 'ticked', 'it is still ticked: the machine removed nothing');
await qa.click(band.getByRole('button', { name: AIM_LINE }), 'taps the band');
await qa.expectText(sheet.locator('.sugg'), 'Suggestion: untick this line.', 'the sheet says what it suggests');
await qa.expectText(sheet.locator('.sugg'), 'States an aim and no delivered result.', 'and why, in one sentence');
await qa.click(sheet.getByRole('button', { name: 'Untick — keep it for when a job needs it' }), 'she unticks it');
await assert((await lineState(aimId)) === 'kept', 'the server stored her untick');
await assert((await page.locator('.paper li.sg').count()) === 0, 'the band is gone; the line is kept, grey');
// Unticking is never a one-way door: she puts it back, and the suggestion is there again for her to judge.
await qa.click(page.locator('.paper li.kept .line'), 'taps the kept line');
await qa.click(sheet.getByRole('button', { name: 'Tick — put it back on my CV' }), 're-ticks it');
await assert((await lineState(aimId)) === 'ticked' && (await page.locator('.paper li.sg').count()) === 1, 'the line is back on her CV, the band with it');
await qa.scrollThrough('she reads her CV on paper, top to bottom');

// ---------------------------------------------------------------------------------------------
// 2e. #342 — the drafted lines: dashed boxes at the end of the placed job, each with its source;
// the + ticks one; Edit then Tick in the sheet; nothing drafted prints until she ticks it.
// ---------------------------------------------------------------------------------------------
await qa.expectText('.legend', 'new line', 'the legend names the new lines');
const nordic = page.locator('.paper .pjob').filter({ hasText: 'Nordic' }).first();
const boxes = nordic.locator('li.nl');
await assert((await boxes.count()) > 0, `her Nordic job ends with new-line boxes to tick or leave (${await boxes.count()})`);
const baltic = page.locator('.paper .pjob').filter({ hasText: BALTIC }).first();
await assert((await baltic.locator('li.nl').count()) === 0, 'the Baltic job, in a family we do not cover, gets none — and nothing says why');
await qa.expectText(boxes.first().locator('.src'), 'jobs ask:', 'each box shows its source under it, without a tap');
await qa.expectText(nordic, 'OPTIONAL', 'a duty that varies by person is flagged OPTIONAL');
await qa.expectText(nordic, 'INDUSTRY GUESS', 'a guess from the industry is flagged INDUSTRY GUESS');
await qa.expectText('.chud .count', 'to tick or leave', 'the counter counts them');
await qa.expectText('.foot p', 'They will not go on your CV.', 'the footer says the unticked ones will not print');
const draftLines = (await reviewJobs()).flatMap((j) => j.lines).filter((l) => l.draft !== null);
await assert(draftLines.length === (await boxes.count()) && draftLines.every((l) => l.state === 'drafted'), `the server holds every one of them unticked (${draftLines.length})`);
const [firstDraft, secondDraft] = draftLines;

await qa.click(boxes.first().getByRole('button', { name: 'Tick — put it on my CV' }), 'she ticks the first one with the +');
await assert((await lineState(firstDraft.id)) === 'ticked', 'the server stored her tick');
await qa.expectVisible(nordic.getByRole('button', { name: `${firstDraft.text} new` }), 'it is an ordinary line now, tagged new');
await assert((await boxes.count()) === draftLines.length - 1, 'one box fewer');

await qa.click(boxes.first().getByRole('button', { name: secondDraft.text }), 'she taps the next box');
await qa.expectText(sheet, 'New line, not on your CV yet', 'the sheet says it is not on her CV');
await qa.expectText(sheet.locator('.why'), 'Why:', 'and why it was offered, in full');
await qa.click(sheet.getByRole('button', { name: 'Edit' }), 'she edits it');
const MINE = 'Coordinated the business and IT groups through every release of the checkout replatform.';
await qa.fill(sheet.getByRole('textbox', { name: 'New line, not on your CV yet' }), MINE, 'in her own words');
await qa.click(sheet.getByRole('button', { name: 'Save' }), 'saves the wording');
await assert((await lineText(secondDraft.id)) === MINE && (await lineState(secondDraft.id)) === 'drafted', 'the server holds her wording — still unticked');
await qa.click(sheet.getByRole('button', { name: 'Tick — put it on my CV' }), 'and ticks it');
await assert((await lineState(secondDraft.id)) === 'ticked', 'the server stored that tick too');
await qa.goto('/review', 'she reloads');
await qa.expectVisible(page.getByRole('button', { name: `${MINE} new` }), 'her wording is on the paper after the reload, tagged new');
await assert((await page.locator('.paper li.nl').count()) === draftLines.length - 2, 'the ones she left are still boxes, still unticked');
await qa.scrollThrough('the new lines, as she left them');

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
// The lines as read, that is — a drafted line she has not ticked is a proposal, not a line (#342).
const states = (await reviewJobs()).flatMap((j) => j.lines.filter((l) => l.draft === null).map((l) => l.state));
await assert(states.length > 0 && states.every((s) => s === 'ticked'), `every line as read arrives ticked (${states.join(', ')})`);

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

await holdReview(false); // put the knob back for the next journey, whatever happened above
const ok = await qa.finish();
process.exit(ok ? 0 : 1);
