// #342 QA gate — the drafted lines' edges, walked over the REAL stack (fake model only), the parts
// cv-review-journey.mjs does not walk:
//
//   1. a reload while the review still runs shows no new-line box yet, and no half-drawn one;
//   2. once it lands, the counter and the footer name the exact number of boxes;
//   3. her edit, typed with spaces round it, is stored trimmed and stays unticked;
//   4. she ticks one in the sheet and one with the +, then unticks the second (kept, still "new");
//   5. reloading twice shows the same wording and the writer is never asked again (/qa/llm-calls);
//   6. the wrong doors refuse over the wire: the line door cannot tick a draft, a CV line is no
//      draft, a ticked draft is not edited here, an empty wording is refused, no session is 401;
//   7. "I'm done" leaves the unticked drafts unticked; the profile shows the ticked one as hers and
//      none of the unticked ones; her master CV prints the ticked one in her words, and neither the
//      kept one nor any unticked one.
//
//   PORT=34101 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 30338
//   BASE_URL=http://127.0.0.1:30338 node apps/web/e2e/drafted-lines-gate-journey.mjs
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:30338';
const WIDTH = Number(process.env.QA_WIDTH ?? 390);
const ROLE = 'IT project manager';
const AREA = 'Singapore';
const EMAIL = `drafted-gate-${Date.now()}@example.com`;

const CV_TEXT = [
  'Jane Doe',
  '+33 6 00 00 00 00 | jane.doe.342@example.com',
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
  'REVIEWCHECK',
].join('\n');

const qa = await createSession(`drafted-lines-gate-journey-${WIDTH}`, {
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
const send = (method, path, body) =>
  json(path, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const reviewJobs = async () => (await json('/review')).body.sections.find((s) => s.tag === 'experience').jobs;
const allLines = async () => (await reviewJobs()).flatMap((j) => j.lines);
const line = async (id) => (await allLines()).find((l) => l.id === id) ?? null;
const reviewCalls = async () => (await json('/qa/llm-calls')).body.review;
const holdReview = (on) => send('POST', '/qa/stack', { reviewHold: on });
const sheet = page.getByRole('dialog');

try {
  // -------------------------------------------------------------------------------------------
  // 0. Her CV, her target, the questions the CV cannot answer — the review held.
  // -------------------------------------------------------------------------------------------
  await qa.goto('/', 'the front door');
  await assert((await holdReview(true)).status === 200, 'the QA stack holds the review run');
  const jobId = await qa.frontDoorPaste(CV_TEXT, 'she pastes her CV');
  await qa.waitForJobDone(jobId);
  await qa.frontDoorContinueToIntent();
  await qa.fill('#target-role', ROLE, `the job she is going for: "${ROLE}"`);
  await qa.fill('#search-area', AREA, `where: ${AREA}`);
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

  // -------------------------------------------------------------------------------------------
  // 1. Reload while the run is held: no box yet, the job still being checked.
  // -------------------------------------------------------------------------------------------
  await qa.expectText(page.getByRole('status'), 'Checking your CV…', 'the review is still running');
  await qa.goto('/review', 'she reloads while it runs');
  await qa.expectText(page.getByRole('status'), 'Checking your CV…', 'still running after the reload');
  await assert((await page.locator('.paper li.nl').count()) === 0, 'no new-line box while her job is still being checked');
  await assert((await allLines()).every((l) => l.state !== 'drafted'), 'and the server holds no draft yet');

  await assert((await holdReview(false)).status === 200, 'the review run is let through');
  await page.getByRole('status').waitFor({ state: 'detached', timeout: 20_000 });
  const calls = await reviewCalls();
  await qa.note(`the review writer was asked ${calls} time(s) for this run`);

  // -------------------------------------------------------------------------------------------
  // 2. The boxes, counted on the counter and in the footer.
  // -------------------------------------------------------------------------------------------
  const nordic = page.locator('.paper .pjob').filter({ hasText: 'Nordic' }).first();
  const boxes = page.locator('.paper li.nl');
  const drafts = (await allLines()).filter((l) => l.state === 'drafted');
  const n = drafts.length;
  await assert(n > 2 && (await boxes.count()) === n && (await nordic.locator('li.nl').count()) === n, `${n} new-line boxes, all at the end of her Nordic job`);
  await qa.expectText('.chud .count', `${n} new lines to tick or leave`, 'the counter names the exact number');
  await qa.expectText('.foot p', `${n} new lines are not ticked. They will not go on your CV.`, 'the footer counts them too');
  await qa.expectVisible(page.getByRole('button', { name: 'Next ↓' }), 'Next ↓ is offered');
  await qa.scrollThrough('she reads the paper with its new lines');

  // -------------------------------------------------------------------------------------------
  // 3. Edit with spaces round it — stored trimmed, still unticked. Then tick it in the sheet.
  // -------------------------------------------------------------------------------------------
  const [d1, d2, d3] = drafts;
  const MINE = 'Owned delivery of the checkout replatform from planning to go-live.';
  await qa.click(boxes.first().getByRole('button', { name: d1.text }), 'she taps the first new line');
  await qa.expectText(sheet, 'New line, not on your CV yet', 'the sheet says it is not on her CV');
  await qa.click(sheet.getByRole('button', { name: 'Edit' }), 'Edit');
  await qa.fill(sheet.getByRole('textbox'), `   ${MINE}   `, 'types her own words, with stray spaces round them');
  await qa.click(sheet.getByRole('button', { name: 'Save' }), 'Save');
  await page.waitForTimeout(800);
  const afterEdit = await line(d1.id);
  await assert(afterEdit.text === MINE && afterEdit.state === 'drafted', `stored trimmed and still unticked ("${afterEdit.text}", ${afterEdit.state})`);
  await qa.expectText(sheet.locator('.quote'), MINE, 'the sheet shows her wording');
  await qa.click(sheet.getByRole('button', { name: 'Tick — put it on my CV' }), 'she ticks it in the sheet');
  await assert((await line(d1.id)).state === 'ticked', 'the server holds the tick');
  await qa.expectVisible(nordic.getByRole('button', { name: `${MINE} new` }), 'an ordinary line now, tagged new');

  // -------------------------------------------------------------------------------------------
  // 4. Tick the next with the +, then untick it: kept, still tagged new, its source still there.
  // -------------------------------------------------------------------------------------------
  await qa.click(page.locator('.paper li.nl').filter({ hasText: d2.text }).getByRole('button', { name: 'Tick — put it on my CV' }), 'she ticks the next one with the +');
  await assert((await line(d2.id)).state === 'ticked', 'the server holds that tick');
  await qa.click(nordic.getByRole('button', { name: `${d2.text} new` }), 'she opens it again');
  await qa.expectText(sheet, 'On your CV', 'the sheet says it is on her CV');
  await qa.click(sheet.getByRole('button', { name: /^Untick/ }), 'and unticks it');
  await assert((await line(d2.id)).state === 'kept', 'kept — it no longer prints');
  await qa.expectText(nordic.locator('li', { hasText: d2.text }), 'kept ·', 'the paper shows it kept');
  await qa.expectText('.chud .count', `${n - 2} new lines to tick or leave`, 'the counter moved by two');

  // -------------------------------------------------------------------------------------------
  // 5. Reload twice: the same wording, and the writer is never asked again.
  // -------------------------------------------------------------------------------------------
  const snapshot = JSON.stringify((await allLines()).filter((l) => l.draft !== null));
  await qa.goto('/review', 'she reloads');
  await qa.goto('/review', 'and again');
  await assert(JSON.stringify((await allLines()).filter((l) => l.draft !== null)) === snapshot, 'every new line reads exactly as before the reloads');
  await qa.expectVisible(page.getByRole('button', { name: `${MINE} new` }), 'her wording, on the paper after the reload');
  await assert((await reviewCalls()) === calls, `the writer was not asked again (${await reviewCalls()} = ${calls})`);

  // -------------------------------------------------------------------------------------------
  // 6. The wrong doors.
  // -------------------------------------------------------------------------------------------
  const asRead = (await allLines()).find((l) => l.draft === null);
  const r1 = await send('PUT', `/cv/lines/${d3.id}`, { state: 'ticked' });
  await assert(r1.status === 404, `the line door cannot tick a draft (${r1.status})`);
  const r2 = await send('POST', `/review/drafts/${asRead.id}/tick`);
  await assert(r2.status === 404, `a line read from her CV is no draft to tick (${r2.status})`);
  const r3 = await send('PUT', `/review/drafts/${asRead.id}`, { text: 'Rewritten.' });
  await assert(r3.status === 404, `nor to re-word here (${r3.status})`);
  const r4 = await send('PUT', `/review/drafts/${d1.id}`, { text: 'Changed after the tick.' });
  await assert(r4.status === 404, `a ticked draft is not re-worded here (${r4.status})`);
  const r5 = await send('PUT', `/review/drafts/${d3.id}`, { text: '    ' });
  await assert(r5.status === 400, `empty wording is refused (${r5.status})`);
  const r6 = await send('POST', `/review/drafts/${d1.id}/tick`);
  await assert(r6.status === 404, `ticking twice is nothing (${r6.status})`);
  const r7 = await page.evaluate(async (id) => (await fetch(`/api/review/drafts/${id}/tick`, { method: 'POST', credentials: 'omit' })).status, d3.id);
  await assert(r7 === 401, `no session, no tick (${r7})`);
  const still = await line(d3.id);
  await assert(still.state === 'drafted' && still.text === d3.text && (await line(asRead.id)).text === asRead.text, 'nothing the wrong doors tried changed a line');

  // -------------------------------------------------------------------------------------------
  // 7. "I'm done" — then what prints.
  // -------------------------------------------------------------------------------------------
  await qa.click(page.getByRole('button', { name: "I'm done — show my jobs" }), "I'm done — show my jobs");
  await page.waitForURL((u) => !/\/review/.test(u.pathname), { timeout: 20_000 });
  const unticked = (await allLines()).filter((l) => l.state === 'drafted');
  await assert(unticked.length === n - 2, `the ${n - 2} she left are still unticked after the confirm`);

  await qa.goto('/profile', 'her profile');
  await qa.expectText('body', MINE, 'the ticked new line is one of her facts');
  const profile = (await json('/profile')).body;
  const facts = profile.domains.flatMap((d) => d.facts);
  await assert(facts.find((f) => f.id === d1.id)?.source === 'told', 'shown as hers ("told")');
  await assert(facts.find((f) => f.id === d2.id)?.kept === true, 'the unticked-again one is kept');
  await assert(!facts.some((f) => unticked.some((u) => u.id === f.id)), 'no unticked new line is on her profile');
  await qa.scrollThrough('her profile, top to bottom');

  const signed = await page.evaluate(async ({ email }) => {
    const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const res = await post('/api/auth/request-link', { email });
    const link = await res.json();
    if (!link.devLink) return `sign-in failed (${res.status})`;
    await post('/api/auth/verify', { token: new URL('http://x' + link.devLink).searchParams.get('token') });
    return 'ok';
  }, { email: EMAIL });
  await assert(signed === 'ok', `she signs in (${signed})`);
  const built = await send('POST', '/onboarding/build');
  const md = built.body?.rootCv?.markdown ?? '';
  await assert(built.status === 200 && md.includes(MINE), 'her master CV prints the ticked new line, in her words');
  await assert(!md.includes(d2.text), 'not the one she unticked again');
  await assert(unticked.every((u) => !md.includes(u.text)), `none of the ${unticked.length} unticked ones`);
  await assert((await reviewCalls()) === calls, 'and the writer was never asked again');
} finally {
  await holdReview(false).catch(() => {});
  const ok = await qa.finish();
  process.exitCode = ok ? 0 : 1;
}
