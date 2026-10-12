// #338 QA gate, moved onto check mode by #386 — every door onto the jobs, tried with a CV whose
// check mode is not finished, then again after the finish. The companion to check-mode-journey.mjs
// (the happy walk). This one is adversarial, over the REAL stack (fake model only), at phone width:
//
//   1. she pastes her CV and says what she is going for — and before anything else she tries every
//      way onto a job: the deck screen, the cards API, the paste-a-job door, that job's own screen,
//      the want door on the job she brought, the tailor. Each must hold her (ADR-0016 c6, ADR-0018);
//   2. discovery asks nothing more and hands off to check mode;
//   3. moving past the end-date question sends nothing, and the question survives a reload;
//   4. her phone, corrected on Your details and saved by Next, survives a reload;
//   5. a removal survives a reload; the finish opens the jobs;
//   6. after the finish, the same doors open — the job she brought, and the want door on it;
//   7. check mode reopens, a put-back there persists.
//
//   PORT=34101 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34100
//   BASE_URL=http://127.0.0.1:34100 node apps/web/e2e/check-mode-gate-doors-journey.mjs
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

const qa = await createSession(`check-mode-gate-doors-${WIDTH}`, {
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
// Check mode's structure (check-mode.spec.ts selects the same way).
const h1 = page.locator('main h1');
const primary = page.locator('.foot .primary');
const items = page.locator('main li.pt');
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
  await check(await walkTo(re), `back on the screen ${re}`);
}

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
// 1. A CV brought, check mode not finished — every door onto a job must hold her.
// ---------------------------------------------------------------------------------------------
const jobId = await qa.frontDoorPaste(CV_TEXT, 'the front door — she pastes her CV');
await qa.waitForJobDone(jobId);
await qa.frontDoorContinueToIntent();
await qa.fill('#target-role', 'IT project manager', 'the job she is going for');
await qa.fill('#search-area', 'Singapore', 'where she wants to work');
await qa.click('button:has-text("Save and continue")', 'Save and continue');
await page.waitForTimeout(1500);

const held = (await api('/onboarding/cards')).body;
await check(held?.reviewPending === true && (held.cards ?? []).length === 0, `cards API holds before check mode: ${JSON.stringify({ reviewPending: held?.reviewPending, cards: held?.cards?.length })}`);

await qa.goto('/deck', 'she tries the jobs screen directly');
await page.waitForURL(/\/profile\/check/, { timeout: 15_000 });
await check(/\/profile\/check/.test(page.url()), `the deck sends her to check mode (${new URL(page.url()).pathname})`);

// The paste-a-job door: the read itself is allowed (the advert is stored), but no card may come back.
const pasted = await pasteAdvert();
const result = pasted.job?.progress?.paste?.result ?? null;
const adId = result?.adId ?? null;
await qa.note(`paste before the finish: POST ${pasted.status}, job ${pasted.job?.status}, failure ${JSON.stringify(pasted.job?.progress?.paste?.failure?.code ?? null)}, adId ${adId}, card ${result?.card ? `matchPct=${result.card.matchPct}` : 'none'}`);
await check(!result?.card, 'the paste read hands back no scored card while check mode is not finished');

if (adId) {
  const screen = await api(`/onboarding/jobs/${encodeURIComponent(adId)}`);
  await check(screen.status === 409 && screen.body?.error?.code === 'review_pending', `the job's own screen API holds: ${screen.status} ${screen.body?.error?.code}`);
  await qa.goto(`/job/${encodeURIComponent(adId)}`, 'she opens the job she brought');
  await page.waitForURL(/\/profile\/check/, { timeout: 15_000 });
  await check(/\/profile\/check/.test(page.url()), `the job's own screen sends her to check mode (${new URL(page.url()).pathname})`);
  const want = await api(`/onboarding/cards/${encodeURIComponent(adId)}/want`, { method: 'POST' });
  await check(want.status >= 400, `the want door on the job she brought refuses: ${want.status}`);
}
const tailor = await api('/onboarding/tailor');
await check(tailor.status >= 400, `the tailor refuses: ${tailor.status}`);

// ---------------------------------------------------------------------------------------------
// 2. Nothing asked after question 1 (#376): the hand-off, then check mode.
// ---------------------------------------------------------------------------------------------
const blocks = (await api('/job-blocks')).body?.blocks ?? [];
const baltic = blocks.find((b) => /baltic/i.test(b.employer.value));
await check(!!baltic, `her dated job records were read (${blocks.length})`);
const END_Q = `When did you leave ${baltic.employer.value}?`;
const balticRe = new RegExp(baltic.employer.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
await postJson(`/job-blocks/${baltic.id}/correct`, { key: 'end', value: { state: 'unknown' } });

await qa.goto('/discovery', 'discovery — nothing is left to ask');
await page.locator('.discovery .handoff .go').waitFor({ state: 'visible', timeout: 20_000 });
await qa.click('.discovery .handoff .go', 'Continue');
await page.waitForURL(/\/profile\/check/, { timeout: 20_000 });
await qa.expectText(h1, 'Your details', 'the hand-off lands on check mode');
await qa.scrollThrough('she reads her details');
// Her answers to the review's suggestions are check-mode.spec's and check-mode-journey's to walk; a
// job's open suggestions hold its button, so here they are answered over the wire (No thanks) once
// the run has landed them, and the walk is hers.
for (let i = 0; i < 60 && (await api('/review')).body?.progress; i += 1) await page.waitForTimeout(500);
for (const l of (await api('/review')).body.sections.flatMap((s) => ('jobs' in s ? s.jobs.flatMap((j) => j.lines) : s.lines))) {
  if (l.state === 'drafted') await api(`/review/drafts/${encodeURIComponent(l.id)}/dismissed`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dismissed: true }) });
}
await qa.goto('/profile/check', 'check mode, every suggestion answered');

// ---------------------------------------------------------------------------------------------
// 3. The end date: moving on sends nothing, and the question is still there after a reload.
// ---------------------------------------------------------------------------------------------
const writes = [];
page.on('request', (r) => { if (r.method() !== 'GET' && r.url().includes('/api/')) writes.push(`${r.method()} ${r.url()}`); });
await check(await walkTo(balticRe), 'Next, to the Baltic job');
await qa.expectText(page.locator('main .card.endq h3'), END_Q, 'the question, on that job');
writes.length = 0;
await qa.click(primary, 'she moves on without answering');
await page.waitForTimeout(1000);
await check(writes.length === 0, `moving on sent nothing (${JSON.stringify(writes)})`);
await reloadTo(balticRe, 'she reloads');
await qa.expectText(page.locator('main .card.endq h3'), END_Q, 'the question is still there — nothing was stored');
const endState = (await api('/job-blocks')).body.blocks.find((b) => b.id === baltic.id).end.value.state;
await check(endState === 'unknown', `the record still reads ${endState}`);

// ---------------------------------------------------------------------------------------------
// 4. Your details: a corrected phone, saved by Next, survives a reload.
// ---------------------------------------------------------------------------------------------
await qa.goto('/profile/check', 'back to the start of the walk');
await qa.fill('input[name=phone]', NEW_PHONE, 'types her Singapore number');
await qa.click(primary, 'Next saves it');
await page.waitForTimeout(1200);
await qa.goto('/profile/check', 'she reloads');
await check((await page.locator('input[name=phone]').inputValue()) === NEW_PHONE, 'the corrected phone is there after a reload');

// ---------------------------------------------------------------------------------------------
// 5. A removal survives a reload; the finish opens the jobs.
// ---------------------------------------------------------------------------------------------
await check(await walkTo(/Nordic/), 'Next, to her Nordic job');
const lineId = (await api('/review')).body.sections.find((s) => s.tag === 'experience').jobs.flatMap((j) => j.lines).find((l) => l.text === JOB_LINE)?.id;
await qa.click(items.filter({ hasText: JOB_LINE }).first().locator('.ib.rmv'), 'removes a line');
await reloadTo(/Nordic/, 'she reloads');
await qa.expectText(tray.locator('button').first(), '1 removed', 'the line is still removed after the reload');
const stillHeld = (await api('/onboarding/cards')).body;
await check(stillHeld?.reviewPending === true, 'the jobs still wait — nothing but the finish opens them');
await qa.goto('/profile/check', 'back to the walk');
await walkTo(/^$/);
const pill = page.locator('.wrrow .pill').filter({ has: page.locator('input[value=eligible]') }).first();
if (await pill.count()) await qa.click(pill, 'where she can work: yes');
await qa.expectText(primary, 'Finish my profile', 'the last screen');
await qa.click(primary, 'Finish my profile');
await qa.click('.donepanel .primary', 'Show me the job ads');
await page.waitForURL(/\/deck/, { timeout: 15_000 });
const opened = await qa.cardsWhenRetrieved();
await check((opened?.cards ?? []).length > 0 && opened?.reviewPending === undefined, `the jobs open: ${(opened?.cards ?? []).length} cards`);
await qa.scrollThrough('the jobs, as she sees them');

// ---------------------------------------------------------------------------------------------
// 6. After the finish, the doors that held her open.
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
// 7. Check mode reopens; a put-back there persists.
// ---------------------------------------------------------------------------------------------
await reloadTo(/Nordic/, 'she comes back to check mode');
await qa.click(tray.locator('button').first(), 'shows what was removed');
await qa.click(tray.locator('li button').first(), 'Put back');
await reloadTo(/Nordic/, 'she reloads');
await check((await tray.count()) === 0 && (await items.filter({ hasText: JOB_LINE }).count()) === 1, 'the put-back made after the finish persisted');
const review = (await api('/review')).body;
await check(review?.completed === true, 'check mode still reads finished');
await check(review.sections.flatMap((s) => ('jobs' in s ? s.jobs.flatMap((j) => j.lines) : s.lines)).find((l) => l.id === lineId)?.state === 'ticked', 'and the server holds the line in');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
