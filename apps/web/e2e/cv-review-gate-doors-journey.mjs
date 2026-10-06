// #338 QA gate — every door onto the jobs, tried with an UNREVIEWED CV, then again after the confirm.
// The companion to cv-review-journey.mjs (the happy walk). This one is adversarial, over the REAL
// stack (fake model only), at phone width:
//
//   1. she pastes her CV and says what she is going for — and before answering anything she tries
//      every way onto a job: the deck screen, the cards API, the paste-a-job door, that job's own
//      screen, the want door on the job she brought, the tailor. Each must hold her (ADR-0016 c6);
//   2. she answers the questions and lands on "Your CV, reviewed";
//   3. "Not sure" on the end-date pill sends nothing and the pill survives a reload;
//   4. her letterhead phone is corrected in the sheet and survives a reload;
//   5. an untick survives a reload; the confirm opens the jobs;
//   6. after the confirm, the same doors open — the job she brought, and the want door on it;
//   7. the review reopens, a re-tick there persists.
//
//   PORT=34101 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34100
//   BASE_URL=http://127.0.0.1:34100 node apps/web/e2e/cv-review-gate-doors-journey.mjs
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34100';
const WIDTH = Number(process.env.QA_WIDTH ?? 390);

const CV_TEXT = [
  'Jane Doe',
  '+33 6 00 00 00 00 | jane.doors.338@example.com',
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

// qa-main's paste reader convention: line 1 "<title> — <company>", line 2 the location.
const ADVERT = `Senior IT Project Manager — Helvara Group
Singapore
Helvara Group is looking for a Senior IT Project Manager to lead a core banking migration.
- Own the end-to-end delivery of a multi-year transformation programme.
- Manage a budget of EUR 4-6 million and a mixed team of staff and vendors.
- At least eight years managing IT projects.
Applications close 2026-12-20.`;

const JOB_LINE = 'Managed a budget of EUR 1.2M across 3 vendor teams.';
const NEW_PHONE = '+65 8000 1234';

const qa = await createSession(`cv-review-gate-doors-${WIDTH}`, {
  baseURL: BASE,
  viewport: { width: WIDTH, height: WIDTH < 600 ? 844 : 900 },
});
const { page } = qa;
page.setDefaultTimeout(20_000);
const check = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
const api = (path, init) =>
  page.evaluate(
    async ([p, i]) => {
      const res = await fetch(`/api${p}`, { credentials: 'same-origin', ...(i ?? {}) });
      let body = null;
      try { body = await res.json(); } catch { /* no body */ }
      return { status: res.status, body };
    },
    [path, init ?? null],
  );
const postJson = (path, body) =>
  api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const sheet = page.getByRole('dialog');

/** Paste a job advert over the wire and wait for its read to end; returns the job record. */
async function pasteAdvert() {
  const { status, body } = await postJson('/onboarding/paste', { text: ADVERT });
  if (status !== 202) return { status, job: null };
  for (let i = 0; i < 40; i += 1) {
    const job = (await api(`/jobs/${body.jobId}`)).body;
    if (job && (job.status === 'completed' || job.status === 'failed')) return { status, job };
    await page.waitForTimeout(1000);
  }
  return { status, job: null };
}

// ---------------------------------------------------------------------------------------------
// 1. A CV brought, nothing reviewed — every door onto a job must hold her.
// ---------------------------------------------------------------------------------------------
const jobId = await qa.frontDoorPaste(CV_TEXT, 'the front door — she pastes her CV');
await qa.waitForJobDone(jobId);
await qa.frontDoorContinueToIntent();
await qa.fill('#target-role', 'IT project manager', 'the job she is going for');
await qa.fill('#search-area', 'Singapore', 'where she wants to work');
await qa.click('button:has-text("Save and continue")', 'Save and continue');
await page.waitForTimeout(1500);

const held = (await api('/onboarding/cards')).body;
await check(held?.reviewPending === true && (held.cards ?? []).length === 0, `cards API holds before the review: ${JSON.stringify({ reviewPending: held?.reviewPending, cards: held?.cards?.length })}`);

await qa.goto('/deck', 'she tries the jobs screen directly');
await page.waitForURL(/\/review/, { timeout: 15_000 });
await check(/\/review/.test(page.url()), `the deck sends her to the review (${new URL(page.url()).pathname})`);

// The paste-a-job door: the read itself is allowed (the advert is stored), but no card may come back.
const pasted = await pasteAdvert();
const result = pasted.job?.progress?.paste?.result ?? null;
const adId = result?.adId ?? null;
await qa.note(`paste before review: POST ${pasted.status}, job ${pasted.job?.status}, failure ${JSON.stringify(pasted.job?.progress?.paste?.failure?.code ?? null)}, adId ${adId}, card ${result?.card ? `matchPct=${result.card.matchPct}` : 'none'}`);
await check(!result?.card, 'the paste read hands back no scored card while the CV is unreviewed');

if (adId) {
  const screen = await api(`/onboarding/jobs/${encodeURIComponent(adId)}`);
  await check(screen.status === 409 && screen.body?.error?.code === 'review_pending', `the job's own screen API holds: ${screen.status} ${screen.body?.error?.code}`);
  await qa.goto(`/job/${encodeURIComponent(adId)}`, 'she opens the job she brought');
  await page.waitForURL(/\/review/, { timeout: 15_000 });
  await check(/\/review/.test(page.url()), `the job's own screen sends her to the review (${new URL(page.url()).pathname})`);
  const want = await api(`/onboarding/cards/${encodeURIComponent(adId)}/want`, { method: 'POST' });
  await check(want.status >= 400, `the want door on the job she brought refuses: ${want.status}`);
}
const tailor = await api('/onboarding/tailor');
await check(tailor.status >= 400, `the tailor refuses: ${tailor.status}`);

// ---------------------------------------------------------------------------------------------
// 2. The questions, then the review.
// ---------------------------------------------------------------------------------------------
const blocks = (await api('/job-blocks')).body?.blocks ?? [];
const baltic = blocks.find((b) => /baltic/i.test(b.employer.value));
await check(!!baltic, `her dated job records were read (${blocks.length})`);
const END_Q = `When did you leave ${baltic.employer.value}?`;
await postJson(`/job-blocks/${baltic.id}/correct`, { key: 'end', value: { state: 'unknown' } });

await qa.seedFloorAnswers();
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
await qa.expectText('h1', 'Your CV, reviewed', 'the last answer lands on the review');
await qa.scrollThrough('she reads her CV on paper, top to bottom');

// ---------------------------------------------------------------------------------------------
// 3. "Not sure" sends nothing, and the pill is still there after a reload.
// ---------------------------------------------------------------------------------------------
const writes = [];
page.on('request', (r) => { if (r.method() !== 'GET' && r.url().includes('/api/')) writes.push(`${r.method()} ${r.url()}`); });
const pill = page.getByRole('button', { name: END_Q });
await qa.click(pill, 'taps the "end date?" pill');
await qa.expectText(sheet, END_Q, 'the question, on that job');
writes.length = 0;
await qa.click(sheet.getByRole('button', { name: 'Not sure' }), '"Not sure"');
await page.waitForTimeout(1000);
await check(writes.length === 0, `"Not sure" sent nothing (${JSON.stringify(writes)})`);
await qa.goto('/review', 'she reloads');
await qa.expectVisible(page.getByRole('button', { name: END_Q }), 'the pill is still there — nothing was stored');
const endState = (await api('/job-blocks')).body.blocks.find((b) => b.id === baltic.id).end.value.state;
await check(endState === 'unknown', `the record still reads ${endState}`);

// ---------------------------------------------------------------------------------------------
// 4. The letterhead: a corrected phone survives a reload.
// ---------------------------------------------------------------------------------------------
await qa.click(page.getByRole('button', { name: 'Your details' }), 'taps her details');
await qa.expectText(sheet, 'Check these. They go at the top of every CV.', 'the details sheet');
await qa.click(sheet.getByRole('button', { name: 'Edit Phone' }), 'edits the phone');
await qa.fill(sheet.getByRole('textbox', { name: 'Phone' }), NEW_PHONE, 'types her Singapore number');
await qa.click(sheet.getByRole('button', { name: 'Save' }), 'saves');
await page.waitForTimeout(1200);
await qa.goto('/review', 'she reloads');
await qa.expectText(page.getByRole('button', { name: 'Your details' }), NEW_PHONE, 'the corrected phone is on the paper after a reload');

// ---------------------------------------------------------------------------------------------
// 5. Untick, reload, then confirm.
// ---------------------------------------------------------------------------------------------
await qa.click(page.getByRole('button', { name: JOB_LINE }), 'taps a line');
await qa.click(sheet.getByRole('button', { name: 'Untick — keep it for when a job needs it' }), 'unticks it');
await qa.goto('/review', 'she reloads');
await qa.expectVisible(page.locator('.paper li.kept'), 'the line is still kept after the reload');
const stillHeld = (await api('/onboarding/cards')).body;
await check(stillHeld?.reviewPending === true, 'the jobs still wait — nothing but the confirm opens them');
await qa.click(page.getByRole('button', { name: "I'm done — show my jobs" }), '"I\'m done — show my jobs"');
await page.waitForURL(/\/deck/, { timeout: 15_000 });
const opened = await qa.cardsWhenRetrieved();
await check((opened?.cards ?? []).length > 0 && opened?.reviewPending === undefined, `the jobs open: ${(opened?.cards ?? []).length} cards`);
await qa.scrollThrough('the jobs, as she sees them');

// ---------------------------------------------------------------------------------------------
// 6. After the confirm, the doors that held her open.
// ---------------------------------------------------------------------------------------------
const pastedAfter = await pasteAdvert();
const after = pastedAfter.job?.progress?.paste?.result ?? null;
await check(!!after?.card, `the paste door now hands back the job's card (adId ${after?.adId})`);
if (after?.adId) {
  const screen = await api(`/onboarding/jobs/${encodeURIComponent(after.adId)}`);
  await check(screen.status === 200 && !!screen.body?.card, `the job's own screen API opens: ${screen.status}`);
  await qa.goto(`/job/${encodeURIComponent(after.adId)}`, 'she opens the job she brought');
  await page.waitForTimeout(2500);
  await check(/\/job\//.test(page.url()), `she stays on the job's own screen (${new URL(page.url()).pathname})`);
  await qa.scrollThrough('the job she brought');
}

// ---------------------------------------------------------------------------------------------
// 7. The review reopens; a re-tick there persists.
// ---------------------------------------------------------------------------------------------
await qa.goto('/review', 'she comes back to the review');
await qa.click(page.locator('.paper li.kept .line'), 'taps the kept line');
await qa.click(sheet.getByRole('button', { name: 'Tick — put it back on my CV' }), 're-ticks it');
await qa.goto('/review', 'she reloads');
await check((await page.locator('.paper li.kept').count()) === 0, 'the re-tick made after the confirm persisted');
const review = (await api('/review')).body;
await check(review?.completed === true, 'the review still reads completed');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
