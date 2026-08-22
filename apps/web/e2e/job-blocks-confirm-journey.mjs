// #161 AC7 / #157 Design A — the confirm-swipe deck for structured job records, driven as a human
// against a REAL full stack (real Fastify, real extract, real miner parse, real job-block store;
// only the MODEL is faked via apps/api/dist/qa-main.js, so the run is free and deterministic).
//
// The journey: paste a CV with dated jobs on the front door (#271) -> the work-history
// confirm deck. Read card 1, swipe RIGHT to confirm (chip flies, counter bumps) -> swipe LEFT to
// skip and prove the card comes back at the END of the deck -> TAP to correct: change a title,
// change the kind and watch the consequence copy answer honestly -> UNDO and RELOAD to prove the
// undo reached the server -> finish the deck and hand over to /deck/<jobId>.
//
// This header used to claim qa-main.ts does not wire the job-block miner. THAT WAS NEVER TRUE —
// `mineJobBlocks` has been wired there since #199 — and the false claim was copied into ticket #209
// and read by two people before anyone checked the code. What actually broke (fixed in #209): the
// fake answered every job-block prompt with the same three block ids, so section 11b's SECOND
// upload was all id-collisions, ingest() skipped every row, and the deck stood empty. The fake now
// answers a CV carrying "SECOND UPLOAD" with a re-read that includes one ambiguous row, and one
// carrying "FAILTHISREAD" with an unreadable payload — both markers this journey types itself.
//
// Run it (Tier 2 runs it against the shared fake-model stack ci.yml already has up):
//   PORT=34877 node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34877 npx next build && npx next start -p 34878
//   BASE_URL=http://127.0.0.1:34878 node apps/web/e2e/job-blocks-confirm-journey.mjs

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

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
  '',
  'SKILLS',
  'Jira, MS Project, stakeholder management',
].join('\n');

const qa = await createSession('job-blocks-confirm-journey', { baseURL: BASE, viewport: { width: 1440, height: 950 } });
const { page } = qa;
page.setDefaultTimeout(20000);

let aborted = false;
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, async (e) => {
    console.error(`\n[${ev}]`, e?.stack ?? e);
    if (aborted) return;
    aborted = true;
    try {
      await qa.note(`RUN ABORTED (${ev}): ${e?.message ?? e}`);
      await qa.finish();
    } catch { /* report already closed */ }
    process.exit(1);
  });
}

/** Record a boolean verdict as a real PASS/FAIL step with a screenshot. */
async function verdict(ok, note) {
  if (ok) return qa.expectVisible('body', note);
  await qa.note(`FAIL: ${note}`);
  return qa.expectText('body', '__this_check_failed__', note);
}

/** #157 Design A §3: the horizontal axis is confirm-only and TAP is what corrects. A swipe must
 *  never also count as a tap — if it does, the person is dropped into the correction panel for a
 *  card she just swiped away. Closes the panel if it opened, so the drive can carry on. */
async function assertNoAccidentalCorrectionPanel(what) {
  const opened = await page.locator('.jb-back').count();
  await verdict(opened === 0, `${what} does not also open the correction panel`);
  if (opened) {
    await qa.click('.jb-backacts .btn:has-text("Cancel")', 'closes the correction panel it should never have opened');
    await page.waitForTimeout(600);
  }
}

const card = () => page.locator('.jb-card');
const cardText = async () => ((await card().textContent()) || '').replace(/\s+/g, ' ').trim();
const progress = () => page.locator('.jb-prog');

/** A human swipe: press on the card, drag past the 90px commit threshold, release. */
async function swipe(dir, note) {
  const box = await card().boundingBox();
  const y = box.y + Math.min(120, box.height / 2);
  const x0 = box.x + box.width / 2;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x0 + (dir === 'right' ? 1 : -1) * i * 20, y, { steps: 3 });
  await qa.note(note);
  await page.mouse.up();
  await page.waitForTimeout(1200);
}

// -------------------------------------------------------------------------------------------
// 1. Paste the CV on the front door, ride the pipeline, and open the work-history check.
// -------------------------------------------------------------------------------------------
// #271: the CV comes in through the front door's paste tile, and the jobId comes off the front
// door's own paste response — the deleted draft screen's address was the old way to learn it.
const jobId = await qa.frontDoorPaste(CV_TEXT, 'the person pastes a CV with two dated jobs and a degree on the front door');
await qa.waitForJobDone(jobId);
await qa.goto(`${BASE}/job-blocks/${jobId}`, 'opens the work-history check for that read');
await qa.expectVisible('.jb-card', 'the confirm deck opens on the first card');
await qa.scrollThrough('reads the whole screen once, card and progress panel');

/** #271: a SECOND read on the same session has no screen — the product offers none (the front door
 *  restores the finished proof and moves on). It goes through the same POST /cv/paste route the
 *  front door's own tile calls, so nothing deleted is exercised and the read is the real one. */
const pasteAgain = (text) =>
  page.evaluate(async (t) => {
    const res = await fetch('/api/cv/paste', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: t }),
    });
    if (res.status !== 201) throw new Error(`paste refused: ${res.status}`);
    return (await res.json()).jobId;
  }, text);

// -------------------------------------------------------------------------------------------
// 2. What the screen says before she touches anything.
// -------------------------------------------------------------------------------------------
await qa.expectText('h1', 'Check your work history', 'the screen names itself in plain words');
await qa.expectText('.lede', 'Everything here stays on your CV', 'the load-bearing reassurance is on the front screen');
await qa.expectText('.jb-prog', 'checked', 'the progress panel counts what is checked');
await qa.expectText('.jb-prog', 'experience confirmed', 'and shows experience confirmed');
await qa.expectText('.jb-prog', 'you put right', 'and things you put right');
const TOTAL = Number(((await page.locator('.jb-prog .jb-stat .v').first().textContent()) || '0 of 0').split(' of ')[1]);
await qa.note(`the CV produced ${TOTAL} dated blocks to check`);
await qa.expectText('.jb-kicker', `of ${TOTAL}`, 'the deck counts the dated blocks it found');

const bodyText = async () => ((await page.locator('body').textContent()) || '').toLowerCase();
await verdict(!(await bodyText()).includes('count as work'), 'nothing on the screen is worded "does this count as work?"');

// Only one card is in front of the person at a time.
await verdict((await page.locator('.jb-card').count()) === 1, 'exactly one block is in front of her at a time');

// -------------------------------------------------------------------------------------------
// 3. Card 1: read it, then swipe RIGHT — "that's right".
// -------------------------------------------------------------------------------------------
const first = await cardText();
await qa.note(`card 1 reads: ${first}`);
await qa.expectText('.jb-readback', 'years of experience', 'the card states what the kind means for her experience');
await qa.expectText('.jb-quote', 'From your CV', 'and shows the words it read this from');
await swipe('right', 'she swipes it right — "that\'s right"');
await assertNoAccidentalCorrectionPanel('a right swipe');
await qa.expectVisible('.jb-undo', 'an undo is offered straight after the action');
await qa.expectText('.jb-prog', `1 of ${TOTAL}`, `the checked counter moved to 1 of ${TOTAL}`);
await qa.expectVisible('.jb-prog', 'the reward beat lands on the progress panel');

const expAfterFirst = ((await progress().textContent()) || '').match(/([\d.]+ years?|none yet)/);
await qa.note(`experience confirmed after card 1: ${expAfterFirst?.[0] ?? 'unreadable'}`);

// -------------------------------------------------------------------------------------------
// 4. Card 2: swipe LEFT — "skip for now". It must come back at the END of the deck.
// -------------------------------------------------------------------------------------------
const skipped = await cardText();
await qa.note(`card 2 (about to be skipped) reads: ${skipped}`);
await swipe('left', 'she swipes it left — "skip for now"');
await assertNoAccidentalCorrectionPanel('a left swipe');
await qa.expectText('.jb-prog', 'to come back to', 'the panel says there is one to come back to');
await qa.expectText('.jb-prog', `1 of ${TOTAL}`, 'a skip is not a decision — the checked count is unchanged');
const afterSkip = await cardText();
await verdict(afterSkip !== skipped, 'the skipped card stepped aside and the next one came forward');

// -------------------------------------------------------------------------------------------
// 5. Card 3: TAP the card to correct it. Change the title, then the kind.
// -------------------------------------------------------------------------------------------
await qa.click('.jb-card', 'she taps the card to put it right');
await qa.expectVisible('.jb-back', 'the correction panel opens on the card');
await qa.expectText('.jb-back', 'What is this?', 'the kind is asked as "What is this?"');
for (const k of ['A job', 'Education', 'A project', 'A client you worked for', 'Volunteering'])
  await qa.expectText('.jb-back', k, `the kinds offered include "${k}"`);
await qa.expectText(
  '.jb-note',
  'Everything here stays on your CV. The kind only decides what adds to your years of experience',
  'the load-bearing line sits right beside the kind choice, verbatim',
);
// All five machine decisions are individually correctable on this one panel.
for (const f of ['#jb-employer', '#jb-title', 'select[aria-label="Start year"]', '.jb-choice'])
  await qa.expectVisible(f, `the panel exposes ${f} as its own correctable control`);

const consequenceBefore = (await page.locator('.jb-consequence').textContent()) || '';
await qa.note(`consequence line before any edit: "${consequenceBefore.trim()}"`);

await qa.fill('#jb-title', 'MSc Information Systems (corrected)', 'she corrects the title');
await qa.click('.jb-back .jb-choice button:has-text("A job")', 'and tells us this one is a job after all');
await page.waitForTimeout(600);
const consequenceAfterKind = (await page.locator('.jb-consequence').textContent()) || '';
await qa.note(`consequence line after switching the kind to "a job": "${consequenceAfterKind.trim()}"`);
await verdict(
  consequenceAfterKind !== consequenceBefore && /adds about/.test(consequenceAfterKind),
  'switching the kind updates the consequence immediately and honestly (it now adds experience)',
);
await qa.expectText('.jb-note', 'and this one does', 'the note beside the kinds agrees with the consequence');

await qa.click('.jb-back .jb-choice button:has-text("Education")', 'she puts it back to education');
await page.waitForTimeout(500);
await qa.expectText('.jb-consequence', "doesn't change your confirmed experience", 'and the consequence honestly says nothing changes');
await qa.click('.jb-backacts .btn:has-text("Save and continue")', 'saves the correction');
await page.waitForTimeout(1500);
await qa.expectText('.jb-prog', 'you put right', 'the panel counts the thing she put right');
const correctionsShown = ((await progress().textContent()) || '').match(/(\d+)\s*thing/)?.[1];
await verdict(correctionsShown === '1', `the panel says she put ${correctionsShown} thing right`);

// -------------------------------------------------------------------------------------------
// 6. Keep going through the rest of the deck — and the skipped card must still be there at the end.
// -------------------------------------------------------------------------------------------
let sawSkippedAgain = false;
for (let i = 0; i < TOTAL + 2; i++) {
  if (!(await page.locator('.jb-card').count())) break;
  const t = await cardText();
  if (t === skipped) {
    sawSkippedAgain = true;
    await verdict(true, 'the card she skipped came back — it is still in the deck at the end, unchanged');
    break;
  }
  await qa.note(`next card: ${t.slice(0, 90)}`);
  await qa.click('.jb-cbtn.yes', "confirms it — \"that's right\"");
  await page.waitForTimeout(1400);
  await qa.expectVisible('.jb-undo', 'every finished card leaves an undo behind');
}
if (!sawSkippedAgain) await verdict(false, 'the skipped card should still be in the deck at the end');

// -------------------------------------------------------------------------------------------
// 7. Undo has to reach the SERVER: confirm the last card, undo it, then RELOAD.
// -------------------------------------------------------------------------------------------
const checkedBefore = ((await progress().textContent()) || '').match(/(\d+) of (\d+)/)?.[1];
await qa.click('.jb-cbtn.yes', 'she confirms the last card');
await page.waitForTimeout(1500);
const checkedAfter = ((await progress().textContent()) || '').match(/(\d+) of (\d+)/)?.[1];
await qa.note(`checked went from ${checkedBefore} to ${checkedAfter}`);
await qa.expectVisible('.jb-undo', 'the undo is offered on the very last card too');
await qa.click('.jb-undo button', 'she changes her mind and taps Undo');
await page.waitForTimeout(1200);
await qa.goto(`${BASE}/job-blocks/${jobId}`, 'she reloads the page — did the undo actually reach the server?');
const afterReload = ((await progress().textContent()) || '').match(/(\d+) of (\d+)/)?.[1];
await verdict(
  afterReload === checkedBefore,
  `the undo survived a reload — after reloading the deck reads ${afterReload} checked, not ${checkedAfter}`,
);
await qa.expectVisible('.jb-card', 'and the undone card is back in front of her');

// -------------------------------------------------------------------------------------------
// 8. Keyboard: the correct action is reachable without a mouse.
// -------------------------------------------------------------------------------------------
await page.keyboard.press('Tab');
const focusName = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 40) ?? '');
await qa.note(`first tab stop on the deck: "${focusName}"`);
const reachable = await page.evaluate(() =>
  [...document.querySelectorAll('.jb-swipehint button')].map((b) => b.textContent.trim()),
);
await verdict(
  reachable.some((t) => /right/i.test(t)) && reachable.some((t) => /skip/i.test(t)) && reachable.some((t) => /put it right/i.test(t)),
  `all three actions are real buttons, reachable without a mouse: ${reachable.join(' · ')}`,
);

// -------------------------------------------------------------------------------------------
// 9. Finish the deck and hand over.
// -------------------------------------------------------------------------------------------
for (let i = 0; i < 4 && (await page.locator('.jb-cbtn.yes').count()); i++) {
  await qa.click('.jb-cbtn.yes', `confirms the remaining card ${i + 1}`);
  await page.waitForTimeout(1400);
}
await qa.expectVisible('.jb-done', 'the deck ends on a finished state, not an empty screen');
await qa.expectText('.jb-done', "That's your history straight", 'and says so in her own words');
await qa.expectText('.jb-done', 'confirmed', 'summing up the experience she confirmed');
await qa.click('.jb-done .btn:has-text("Continue")', 'she continues to the next screen');
// /deck/<jobId> is behind the sign-up wall, so the handover legitimately lands either on the
// sentence deck itself or on the wall that guards it — never back where she started.
await page.waitForURL((u) => /\/deck\//.test(u.toString()) || /signup|auth/.test(u.toString()), { timeout: 25000 });
await page.waitForTimeout(1500);
const landed = page.url();
await verdict(
  /\/deck\//.test(landed) || /signup|auth/.test(landed),
  `the handover carries her on to the next step of the journey: ${landed}`,
);

// -------------------------------------------------------------------------------------------
// 10. Nothing on this screen is red — nothing on it destroys anything.
// -------------------------------------------------------------------------------------------
await qa.goto(`${BASE}/job-blocks/${jobId}`, 'back to the confirm screen for the colour audit');
const reds = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('main.jobblocks *')) {
    const s = getComputedStyle(el);
    for (const prop of ['color', 'backgroundColor', 'borderTopColor']) {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s[prop]);
      if (!m) continue;
      const [r, g, b] = [+m[1], +m[2], +m[3]];
      if (r > 130 && r - g > 60 && r - b > 60) out.push(`${el.className || el.tagName} ${prop}=${s[prop]}`);
    }
  }
  return [...new Set(out)];
});
await verdict(reds.length === 0, `no red anywhere on the screen${reds.length ? ` — found: ${reds.join(', ')}` : ''}`);

// -------------------------------------------------------------------------------------------
// 11. Reduced motion: the deck still works with animation switched off.
// -------------------------------------------------------------------------------------------
await page.emulateMedia({ reducedMotion: 'reduce' });
await qa.goto(`${BASE}/job-blocks/${jobId}`, 'she has "reduce motion" switched on in her system');
await qa.expectVisible('.jb-prog', 'the deck renders the same with motion reduced');
const stillWorks = await page.locator('.jb-done, .jb-card').count();
await verdict(stillWorks > 0, 'the deck is usable with reduced motion — no animation is load-bearing');
await page.emulateMedia({ reducedMotion: 'no-preference' });

// -------------------------------------------------------------------------------------------
// 11b. She uploads her CV again, and this time the read calls the same job by a different title.
//      An ambiguous match must read as a QUESTION on the card, and answering it must work.
// -------------------------------------------------------------------------------------------
await qa.note('she hands her CV over a second time, slightly reworded (#271: same route the front door tile calls)');
const jobId2 = await pasteAgain(`SECOND UPLOAD\n${CV_TEXT}`);
await qa.waitForJobDone(jobId2);
await qa.goto(`${BASE}/job-blocks/${jobId2}`, 'and comes back to check her work history');
await qa.expectVisible('.jb-card', 'the deck opens on the entry we could not place');
const ambiguous = await cardText();
await qa.note(`the unsure card reads: ${ambiguous}`);
await verdict(
  /we weren't sure|is that the same/i.test(ambiguous),
  'an entry we could not place reads as a question, never as a failure',
);
if (await page.locator('.jb-card button:has-text("Yes, the same job")').count()) {
  await qa.click('.jb-card button:has-text("Yes, the same job")', 'she answers: yes, that is the same job');
  await page.waitForTimeout(1500);
  await verdict(!(await page.locator('.jb-card:has-text("same job as")').count()), 'answering it clears the question');
} else {
  await verdict(false, 'the ambiguous card should offer a same-job / different-job answer');
}

// -------------------------------------------------------------------------------------------
// 11c. A CV whose work history could not be read at all — an invitation, never an error.
// -------------------------------------------------------------------------------------------
await qa.context.clearCookies();
// #271: a different person is a fresh session, so she walks in through the front door like anyone.
const jobId3 = await qa.frontDoorPaste(
  `FAILTHISREAD\n${CV_TEXT}`,
  'a different person, whose history the read cannot make sense of, pastes on the front door',
);
await qa.waitForJobDone(jobId3);
await qa.goto(`${BASE}/job-blocks/${jobId3}`, 'opens the confirm screen after a failed read');
const failedText = ((await page.locator('main.jobblocks').textContent()) || '').trim();
await qa.note(`the failed-read screen says: "${failedText}"`);
await verdict(
  !/error|failed|failure|sorry|went wrong/i.test(failedText) && /add your work history|yourself/i.test(failedText),
  'a work history we could not read reads as an invitation to add it, never as a failure',
);

// -------------------------------------------------------------------------------------------
// 12. A fresh visitor who has uploaded nothing: an invitation, never a failure.
// -------------------------------------------------------------------------------------------
await qa.context.clearCookies();
await qa.goto(`${BASE}/job-blocks/nothing-here`, 'a brand-new visitor opens the screen with no CV read yet');
const emptyText = ((await page.locator('main.jobblocks').textContent()) || '').toLowerCase();
await qa.note(`the not-run screen says: "${emptyText.trim()}"`);
await verdict(
  !/(error|failed|failure|sorry|problem)/.test(emptyText),
  'a read that has not run reads as an invitation, never as a failure',
);
await qa.expectVisible('button:has-text("Continue"), .btn', 'and still offers a way forward');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
