// #386 — check mode, walked the way a person walks it, over the REAL stack (fake model only). It
// replaces cv-review-journey.mjs (#338/#341/#342, "Your CV, reviewed") and
// review-unchecked-counter-journey.mjs (#362): every claim those two made, made on check mode.
//
//   1. she pastes her CV on the front door and says what she is going for; nothing is asked after
//      that (#376) — discovery moves her on by itself (#392) to check mode, not the jobs (AC1);
//   2. #341/#362 — the review runs in the background, HELD on the QA stack (POST /qa/stack
//      reviewHold) from before the paste: Your details shows her letterhead as read (AC2); her job
//      screen says it is still being checked and offers nothing to answer; the last screen holds
//      Finish while the run goes and the server refuses the finish too; nothing on the screen speaks
//      of a failure; the wire says `unchecked: true`. Released, Finish unlocks and `unchecked` clears;
//   3. #341/#384 — the fix: the budget line reads corrected, wears the Fixed tag, the tag opens
//      original → corrected; Undo restores her words to the letter and survives a reload; the fix
//      can be used again;
//   4. #380 — the "Remove this?" suggestion on her date-of-birth line holds the job's button: Remove
//      it lists it as removed, Put back brings it in, the server stores each;
//   5. #342/#378 — the add suggestions: cards on the placed job only (the Baltic job, in no family,
//      gets none and nothing says why), each with its source; she adds one, edits another first,
//      says No thanks to the rest — and a reload shows what she did;
//   6. an item removed with ⊖ survives a reload in the removed tray; Put back survives one too (AC3);
//   7. the Baltic job's missing end date is asked on its own screen; moving on stores nothing; an
//      answer corrects the job record (AC4);
//   8. the jobs wait for the finish — the cards API holds and /deck sends her back here — and open
//      after "Finish my profile" and the done screen (AC6);
//   9. she comes back to check mode after finishing; a change made there persists (AC7).
//
// The import conflict is not walked: the fake miner's recording reads no field twice
// (apps/api/test/cvReview.test.ts proves it over HTTP; check-mode.spec.ts the screen). The given-up
// path (a job that ran out of paid attempts) cannot be walked live either: the fake writer has no
// failure switch — cvReviewRun.test.ts proves it over HTTP, check-mode.spec.ts the screen.
//
//   PORT=34101 node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 30338
//   BASE_URL=http://127.0.0.1:30338 node apps/web/e2e/check-mode-journey.mjs
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
  // The marker that makes the fake miner read a misspelt word and a date of birth on two lines.
  'REVIEWCHECK',
].join('\n');

// The fake miner's recorded lines (apps/api/test/eval/recordings/clean-pdf.json), as the
// REVIEWCHECK recording reads them (qa-main.ts): the budget line misspelt (the review fixes it back
// to the recorded text), a date of birth on another (the review suggests removing it).
const JOB_LINE = 'Managed a budget of EUR 1.2M across 3 vendor teams.';
const JOB_LINE_AS_READ = 'Managed a budget of EUR 1.2M accross 3 vendor teams.';
const DOB_LINE = 'Date of birth: 12 March 1988.';
const MINE = 'Coordinated the business and IT groups through every release of the checkout replatform.';

const qa = await createSession(`check-mode-journey-${WIDTH}`, {
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
const jobLines = async () => (await reviewJobs()).flatMap((j) => j.lines);
const lineState = async (id) => (await jobLines()).find((l) => l.id === id)?.state ?? null;
const lineText = async (id) => (await jobLines()).find((l) => l.id === id)?.text ?? null;
const holdReview = (on) =>
  json('/qa/stack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reviewHold: on }) });

// Check mode's structure (check-mode.spec.ts selects the same way): the screen's heading, its lead,
// the footer's one primary button and Back, the items, the suggestion cards, the removed tray.
const h1 = page.locator('main h1');
const lead = page.locator('main .lead');
const primary = page.locator('.foot .primary');
const items = page.locator('main li.pt');
const item = (text) => items.filter({ hasText: text }).first();
const addCards = page.locator('main li.sg:not(.rmv)');
const removeCard = page.locator('main li.sg.rmv');
const tray = page.locator('main .tray');
/** From wherever the walk is, Next until the heading matches (false when held before it). */
async function walkTo(re) {
  await h1.waitFor();
  for (let i = 0; i < 14; i += 1) {
    if (re.test((await h1.textContent()) ?? '')) return true;
    if ((await primary.isDisabled()) || !/^Next:/.test((await primary.textContent()) ?? '')) return false;
    await primary.click();
    await page.waitForTimeout(250);
  }
  return false;
}
/** A reload starts the walk again at its first screen; this walks back to `re`. */
async function reloadTo(re, note) {
  await qa.goto('/profile/check', note);
  await assert(await walkTo(re), `back on the screen ${re}`);
}

try {
  // -------------------------------------------------------------------------------------------
  // 1. The CV, the job she is going for — and nothing asked after it. (AC1)
  // -------------------------------------------------------------------------------------------
  await qa.goto('/', 'the front door');
  await assert((await holdReview(true)).status === 200, 'the QA stack holds the review run until she has seen it running');
  const jobId = await qa.frontDoorPaste(CV_TEXT, 'the front door — she pastes her CV');
  await qa.waitForJobDone(jobId);
  await qa.frontDoorContinueToIntent();
  await qa.fill('#target-role', ROLE, `the job she is going for: "${ROLE}"`);
  await qa.fill('#search-area', AREA, `where she wants to work: ${AREA}`);
  await qa.click('button:has-text("Save and continue")', 'Save and continue');
  await page.waitForTimeout(1500);

  // A date hole to be asked about: the product's own correction door, on her session.
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

  await qa.goto('/discovery', 'discovery — nothing is left to ask');
  // #392: no hand-off — the count shows, then discovery moves on by itself.
  await assert((await page.locator('.discovery .opts').count()) === 0, 'no question was put on screen');
  await page.waitForURL(/\/profile\/check/, { timeout: 30_000 });
  await assert(/\/profile\/check/.test(page.url()), `AC1 — after question 1 she lands on check mode, not the jobs (${new URL(page.url()).pathname})`);

  // -------------------------------------------------------------------------------------------
  // 2. Your details as read (AC2); the check still running (#341/#362).
  // -------------------------------------------------------------------------------------------
  await qa.expectText(h1, 'Your details', 'the walk opens at her details');
  await assert((await page.locator('input[name=name]').inputValue()).includes('Jane Doe'), 'her name, as read, at the top');
  await assert((await page.locator('input[name=email]').inputValue()) === 'jane.doe.338@example.com', 'her email, as read');
  const before = (await json('/review')).body;
  await assert(before?.progress !== null && before?.unchecked === true, `the server says the check is going and part of her CV has no answer yet (unchecked: ${before?.unchecked})`);

  await assert(await walkTo(/Nordic/), 'Next, screen by screen, to her Nordic job');
  await qa.expectText(lead, 'still checking this job', 'her job says it is still being checked — never "nothing to answer"');
  await assert((await addCards.count()) === 0 && (await removeCard.count()) === 0, 'no suggestion while the job has no answer');
  await qa.expectVisible(item(JOB_LINE_AS_READ), 'her lines as read, meanwhile — the misspelling included');
  await qa.scrollThrough('she reads her job while it is checked');

  await walkTo(/^$/); // as far as the walk goes
  const last = (await h1.textContent()) ?? '';
  await qa.note(`the last screen: "${last}"`);
  const pill = page.locator('.wrrow .pill').filter({ has: page.locator('input[value=eligible]') }).first();
  if (await pill.count()) await qa.click(pill, 'where she can work: yes, she can work there');
  await qa.expectText(primary, 'Finish my profile', 'the last screen offers the finish');
  await assert(await primary.isDisabled(), 'the finish is held while the check runs');
  await qa.expectText('main .hint', 'Checking your CV…', 'and says why');
  const refused = await json('/review/complete', { method: 'POST' });
  await assert(refused.status === 409 && refused.body?.error?.code === 'review_running', `the server refuses the finish too (${refused.status} ${refused.body?.error?.code})`);
  const mainText = (await page.locator('main').textContent()) ?? '';
  await assert(!/fail|error|try again|couldn't/i.test(mainText), 'nothing on the screen speaks of a failure');

  await assert((await holdReview(false)).status === 200, 'the review run is let through');
  await primary.waitFor({ state: 'visible' });
  for (let i = 0; i < 40 && (await primary.isDisabled()); i += 1) await page.waitForTimeout(500);
  await assert(await primary.isEnabled(), 'the finish unlocks when the check is finished');
  await assert((await page.locator('main .hint').count()) === 0, 'and the "Checking your CV…" line goes');
  const after = (await json('/review')).body;
  await assert(after?.progress === null && after?.unchecked === false, `every part of her CV has an answer (unchecked: ${after?.unchecked})`);

  // -------------------------------------------------------------------------------------------
  // 3. The fix (#341/#384).
  // -------------------------------------------------------------------------------------------
  await reloadTo(/Nordic/, 'she goes back to her Nordic job');
  const budget = item(JOB_LINE);
  await qa.expectVisible(budget, 'the budget line reads correctly now: the fix was applied for her');
  const budgetId = (await jobLines()).find((l) => l.text === JOB_LINE)?.id;
  await assert(!!budgetId && (await lineText(budgetId)) === JOB_LINE, 'the server holds the corrected text');
  await qa.click(budget.locator('.tag.fixed'), 'taps its Fixed tag');
  await qa.expectText(budget.locator('.fixrow s'), 'accross', 'the original, struck');
  await qa.expectText(budget.locator('.fixrow .to'), 'across', 'the correction');
  await qa.click(budget.locator('.fixrow button'), 'Undo');
  await qa.expectVisible(item(JOB_LINE_AS_READ), 'the line reads her exact original again');
  await assert((await lineText(budgetId)) === JOB_LINE_AS_READ, 'the server stored the undo, to the letter');
  await reloadTo(/Nordic/, 'she reloads');
  const undone = item(JOB_LINE_AS_READ);
  await qa.expectVisible(undone, 'still her original after the reload');
  await qa.click(undone.locator('.tag.fixed'), 'taps the tag again');
  await qa.click(undone.locator('.fixrow button'), 'Use the fix');
  await qa.expectVisible(item(JOB_LINE), 'the line reads the correction again');
  await assert((await lineText(budgetId)) === JOB_LINE, 'the server stored that too');

  // -------------------------------------------------------------------------------------------
  // 4. "Remove this?" (#380): held until answered; Remove it, then Put back.
  // -------------------------------------------------------------------------------------------
  await qa.expectText(removeCard, DOB_LINE, 'her date of birth wears the coral "Remove this?" card');
  const dobId = (await jobLines()).find((l) => l.text === DOB_LINE)?.id;
  await assert((await lineState(dobId)) === 'removal-suggested', 'unanswered: the machine removed nothing');
  await assert(await primary.isDisabled(), `the job's button waits for the answers ("${(await primary.textContent())?.trim()}")`);
  await qa.click(removeCard.locator('.row button').first(), 'Remove it');
  await assert((await lineState(dobId)) === 'kept', 'the server stored her removal');
  await qa.expectText(tray.locator('button').first(), '1 removed', 'it lists under the removed count');
  await qa.click(tray.locator('button').first(), 'shows what was removed');
  await qa.click(tray.locator('li button').first(), 'Put back');
  await assert((await lineState(dobId)) === 'ticked', 'never a one-way door: it is back in, as an ordinary item');
  await qa.expectVisible(item(DOB_LINE), 'and on the screen');

  // -------------------------------------------------------------------------------------------
  // 5. The add suggestions (#342/#378): on the placed job only, each answered.
  // -------------------------------------------------------------------------------------------
  const drafts = (await jobLines()).filter((l) => l.state === 'drafted');
  const n = drafts.length;
  await assert(n > 2 && (await addCards.count()) === n, `${n} suggestions to add, inline in her Nordic job`);
  await qa.expectText(addCards.first().locator('.meta'), 'jobs ask:', 'each says why, without a tap');
  await assert((await addCards.locator('.hd b').count()) === 2, 'the OPTIONAL and the INDUSTRY GUESS ones say "Only if true"');
  await qa.expectText(lead, `${n} suggestions`, 'the lead counts them');
  const [first, second, ...rest] = drafts;
  await qa.click(addCards.filter({ hasText: first.text }).locator('.row button').nth(0), 'Add it');
  await assert((await lineState(first.id)) === 'ticked', 'the server stored the add');
  await qa.expectVisible(item(first.text).locator('.tag'), 'it is an ordinary item now, tagged new');
  await qa.click(addCards.filter({ hasText: second.text }).locator('.row button').nth(1), 'Edit first');
  const card2 = addCards.filter({ has: page.locator('textarea') }); // the card being edited
  await qa.fill(card2.locator('textarea'), MINE, 'in her own words');
  await qa.click(card2.locator('.row button.primary'), 'Add it');
  await assert((await lineText(second.id)) === MINE && (await lineState(second.id)) === 'ticked', 'the server holds her wording, added');
  for (const d of rest) {
    await qa.click(addCards.filter({ hasText: d.text }).locator('.row button').nth(2), 'No thanks');
    await assert((await lineState(d.id)) === 'dismissed', 'the server holds the No thanks');
  }
  await assert(await primary.isEnabled(), `every suggestion answered: the button lets her through ("${(await primary.textContent())?.trim()}")`);
  await reloadTo(/Nordic/, 'she reloads');
  await qa.expectVisible(item(MINE).locator('.tag'), 'her wording is there after the reload, tagged new');
  await assert((await addCards.count()) === 0 && (await page.locator('main li.gone').count()) === 0, 'the ones she said No thanks to never come back');
  await assert(await walkTo(new RegExp(BALTIC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))), 'Next, to the Baltic job');
  await assert((await addCards.count()) === 0, 'the Baltic job, in a family we do not cover, gets none — and nothing says why');

  // -------------------------------------------------------------------------------------------
  // 6. ⊖ and Put back, each surviving a reload. (AC3)
  // -------------------------------------------------------------------------------------------
  await reloadTo(/Nordic/, 'back to the Nordic job');
  await qa.click(item(JOB_LINE).locator('.ib.rmv'), 'removes the budget line');
  await assert((await lineState(budgetId)) === 'kept', 'the server stored the removal');
  await reloadTo(/Nordic/, 'she reloads');
  await qa.expectText(tray.locator('button').first(), '1 removed', 'still removed after the reload');
  await assert((await item(JOB_LINE).count()) === 0, 'and not among her items');
  await qa.click(tray.locator('button').first(), 'shows what was removed');
  await qa.click(tray.locator('li button').first(), 'Put back');
  await reloadTo(/Nordic/, 'she reloads again');
  await assert((await tray.count()) === 0 && (await lineState(budgetId)) === 'ticked', 'the put-back survived the reload');

  // -------------------------------------------------------------------------------------------
  // 7. The missing end date, asked on the job's own screen. (AC4)
  // -------------------------------------------------------------------------------------------
  const balticRe = new RegExp(BALTIC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  await assert(await walkTo(balticRe), 'Next, to the Baltic job');
  const endq = page.locator('main .card.endq');
  await qa.expectText(endq.locator('h3'), END_Q, 'the question, on that job');
  await qa.expectText(endq, 'years of experience', 'and why it matters');
  await assert(await primary.isEnabled(), 'it never holds the button');
  await qa.click(primary, 'she moves on without answering');
  const stillUnknown = (await json('/job-blocks')).body.blocks.find((b) => b.id === bsh.id).end.value.state;
  await assert(stillUnknown === 'unknown', `moving on stored nothing — the record still reads ${stillUnknown}`);
  await qa.click('.foot .ghost', 'Back');
  await endq.locator('select').selectOption('February');
  await qa.fill(endq.locator('input'), '2021', 'the year she left');
  await qa.click(endq.locator('button[type=submit]'), 'Save');
  await page.waitForTimeout(1200);
  const ended = (await json('/job-blocks')).body.blocks.find((b) => b.id === bsh.id).end;
  await assert(
    ended.value.state === 'ended' && ended.value.date.year === 2021 && ended.value.date.month === 2 && ended.origin.kind === 'corrected',
    `the answer corrected the job record itself (${JSON.stringify(ended.value)})`,
  );
  await qa.expectText('main .bigsub', 'Feb 2021', 'the job now reads its end date');
  await assert((await endq.count()) === 0, 'and the question is gone');

  // -------------------------------------------------------------------------------------------
  // 8. The jobs wait for the finish. (AC6)
  // -------------------------------------------------------------------------------------------
  const held = (await json('/onboarding/cards')).body;
  await assert(held?.reviewPending === true && (held.cards ?? []).length === 0, `the cards API holds: ${JSON.stringify({ reviewPending: held?.reviewPending, cards: held?.cards?.length })}`);
  await qa.goto('/deck', 'she tries the jobs directly');
  await page.waitForURL(/\/profile\/check/, { timeout: 15_000 });
  await assert(/\/profile\/check/.test(page.url()), 'the deck sends her back to check mode');
  await walkTo(/^$/);
  await qa.expectText(primary, 'Finish my profile', 'the last screen');
  await qa.click(primary, 'Finish my profile');
  await qa.expectText(h1, 'Your profile is ready', 'the done screen');
  await qa.expectText('.tally', 'added', 'it counts what is in, added and removed');
  await qa.click('.donepanel .primary', 'Show me the job ads');
  await page.waitForURL(/\/deck/, { timeout: 15_000 });
  await page.waitForTimeout(2500);
  const opened = await qa.cardsWhenRetrieved();
  await assert(opened?.reviewPending === undefined && (opened?.cards ?? []).length > 0, `the cards API opens: ${(opened?.cards ?? []).length} cards`);
  await qa.scrollThrough('the reveal, as she sees it');

  // -------------------------------------------------------------------------------------------
  // 9. Back to check mode after finishing; a change made there persists. (AC7)
  // -------------------------------------------------------------------------------------------
  await reloadTo(/Nordic/, 'she comes back to check mode');
  await qa.click(item(JOB_LINE).locator('.ib.rmv'), 'removes the budget line, this time for good');
  await assert((await lineState(budgetId)) === 'kept', 'the server stored the change made after finishing');
  const stillOpen = await qa.cardsWhenRetrieved();
  await assert((stillOpen?.cards ?? []).length > 0 && stillOpen?.reviewPending === undefined, 'and the jobs stay open');
} finally {
  await holdReview(false).catch(() => {}); // put the knob back for the next journey, whatever happened above
  const ok = await qa.finish();
  process.exitCode = ok ? 0 : 1;
}
