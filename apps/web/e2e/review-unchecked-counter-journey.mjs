// #362 — "0 to check" is a claim that the CV was checked and nothing turned up. Walked over the
// REAL stack (fake model only), the way a person walks it:
//
//   1. she pastes her CV with the review run HELD on the QA stack (POST /qa/stack reviewHold), so
//      when she lands on "Your CV, reviewed" no job has a review answer yet;
//   2. while that is so, the counter never reads "0 to check" — nothing claims a finished check, and
//      nothing on the screen speaks of a failure; the wire says `unchecked: true`;
//   3. released, every job answers: the wire says `unchecked: false`, and the counter shows a real
//      count again ("N to check").
//
// The given-up path (a job that ran out of paid attempts) cannot be walked live: the QA stack's
// fake writer has no failure switch. apps/api/test/cvReviewRun.test.ts proves it over HTTP and
// e2e/review.spec.ts proves the screen.
//
//   PORT=34101 node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 30338
//   BASE_URL=http://127.0.0.1:30338 node apps/web/e2e/review-unchecked-counter-journey.mjs
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:30338';
const WIDTH = Number(process.env.QA_WIDTH ?? 390);
const ROLE = 'IT project manager';
const AREA = 'Singapore';

const CV_TEXT = [
  'Jane Doe',
  '+33 6 00 00 00 00 | jane.doe.362@example.com',
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
  // The marker that makes the fake miner read two of her lines with a mistake in them (#341).
  'REVIEWCHECK',
].join('\n');

const qa = await createSession(`review-unchecked-counter-${WIDTH}`, {
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
const holdReview = (on) =>
  json('/qa/stack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reviewHold: on }) });

try {
  // 1. The CV, the job she is going for, the questions the CV cannot answer — the review held.
  await qa.goto('/', 'the front door');
  await assert((await holdReview(true)).status === 200, 'the QA stack holds the review run');
  const jobId = await qa.frontDoorPaste(CV_TEXT, 'she pastes her CV');
  await qa.waitForJobDone(jobId);
  await qa.frontDoorContinueToIntent();
  await qa.fill('#target-role', ROLE, `the job she is going for: "${ROLE}"`);
  await qa.fill('#search-area', AREA, `where she wants to work: ${AREA}`);
  await qa.click('button:has-text("Save and continue")', 'Save and continue');
  await page.waitForTimeout(1500);
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
  await page.waitForURL(/\/review/, { timeout: 20_000 });
  await qa.expectText('h1', 'Your CV, reviewed', 'she lands on the review');

  // 2. No job has an answer yet: the counter never claims a finished check.
  const progress = page.getByRole('status');
  await qa.expectText(progress, 'Checking your CV…', 'the check is still going');
  const count = page.locator('.chud .count');
  const held = (await count.textContent()) ?? '';
  await assert(!/\b0 to check\b/.test(held), `the counter does not read "0 to check" while no job has an answer (reads "${held.trim()}")`);
  const before = (await json('/review')).body;
  await assert(before?.unchecked === true, `the server says part of her CV has no answer yet (unchecked: ${before?.unchecked})`);
  const mainText = (await page.locator('main').textContent()) ?? '';
  await assert(!/fail|error|try again/i.test(mainText), 'nothing on the screen speaks of a failure');
  await qa.scrollThrough('she reads her CV while it is checked');

  // 3. Released: every job answers, and the counter shows a real count again.
  await assert((await holdReview(false)).status === 200, 'the review run is let through');
  await progress.waitFor({ state: 'detached', timeout: 20_000 });
  await qa.note('the check finishes; the progress card goes');
  const after = (await json('/review')).body;
  await assert(after?.unchecked === false, `every part of her CV has an answer (unchecked: ${after?.unchecked})`);
  await qa.expectText(count, 'to check', 'the counter shows the count again');
  const done = (await count.textContent()) ?? '';
  await assert(/\b\d+ to check\b/.test(done), `the counter reads a number to check ("${done.trim()}")`);
  await qa.scrollThrough('she reads the checked CV');
} finally {
  await holdReview(false); // put the knob back for the next journey, whatever happened above
}
const ok = await qa.finish();
process.exit(ok ? 0 : 1);
