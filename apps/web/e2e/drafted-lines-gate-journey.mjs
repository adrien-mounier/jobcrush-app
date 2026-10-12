// #342 QA gate, moved onto check mode by #386 — the add suggestions' edges, walked over the REAL
// stack (fake model only), the parts check-mode-journey.mjs does not walk:
//
//   1. a reload while the review still runs shows no suggestion yet, and no half-drawn one;
//   2. once it lands, the cards sit in her placed job only, and the lead counts the exact number;
//   3. "Edit first" with spaces round her words stores them trimmed, and adds the line;
//   4. she adds the next with "Add it", then removes it with ⊖ (removed, never printed);
//   5. reloading twice shows the same wording and the writer is never asked again (/qa/llm-calls);
//   6. the wrong doors refuse over the wire: the line door cannot add a draft, a CV line is no
//      draft, an added draft is not re-worded here, an empty wording is refused, no session is 401;
//   7. she says No thanks to the rest and finishes; the profile shows the added one as hers and
//      none of the declined ones; her master CV prints the added one in her words, and neither the
//      removed one nor any declined one.
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

// Check mode's structure (check-mode.spec.ts selects the same way).
const h1 = page.locator('main h1');
const lead = page.locator('main .lead');
const primary = page.locator('.foot .primary');
const items = page.locator('main li.pt');
const cards = page.locator('main li.sg:not(.rmv)');
const card = (text) => cards.filter({ hasText: text }).first();
const removeCard = page.locator('main li.sg.rmv');
const tray = page.locator('main .tray');
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
async function reloadTo(re, note) {
  await qa.goto('/profile/check', note);
  await assert(await walkTo(re), `back on the screen ${re}`);
}

try {
  // -------------------------------------------------------------------------------------------
  // 0. Her CV, her target — the review held — then check mode.
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
  await qa.goto('/discovery', 'discovery — nothing is left to ask');
  await page.locator('.discovery .handoff .go').waitFor({ state: 'visible', timeout: 20_000 });
  await qa.click('.discovery .handoff .go', 'Continue');
  await page.waitForURL(/\/profile\/check/, { timeout: 20_000 });

  // -------------------------------------------------------------------------------------------
  // 1. Reload while the run is held: no suggestion yet, the job still being checked.
  // -------------------------------------------------------------------------------------------
  await assert(await walkTo(/Nordic/), 'Next, to her Nordic job');
  await qa.expectText(lead, 'still checking this job', 'the review is still running on it');
  await reloadTo(/Nordic/, 'she reloads while it runs');
  await qa.expectText(lead, 'still checking this job', 'still running after the reload');
  await assert((await cards.count()) === 0, 'no suggestion card while her job is still being checked');
  await assert((await allLines()).every((l) => l.state !== 'drafted'), 'and the server holds no draft yet');

  await assert((await holdReview(false)).status === 200, 'the review run is let through');
  for (let i = 0; i < 40 && (await cards.count()) === 0; i += 1) await page.waitForTimeout(500);
  const calls = await reviewCalls();
  await qa.note(`the review writer was asked ${calls} time(s) for this run`);

  // -------------------------------------------------------------------------------------------
  // 2. The cards, in her placed job only, counted by the lead.
  // -------------------------------------------------------------------------------------------
  const drafts = (await allLines()).filter((l) => l.state === 'drafted');
  const n = drafts.length;
  await assert(n > 2 && (await cards.count()) === n, `${n} add suggestions, all in her Nordic job`);
  // The REVIEWCHECK recording's date of birth wears a removal suggestion too; Keep it answers it.
  await qa.click(removeCard.locator('.row button.ghost'), 'Keep it — the removal suggestion is not this journey\'s');
  await qa.expectText(lead, `${n} suggestions below`, 'the lead names the exact number');
  await assert(await primary.isDisabled(), `the button waits for them ("${(await primary.textContent())?.trim()}")`);
  await qa.scrollThrough('she reads her job with its suggestions');

  // -------------------------------------------------------------------------------------------
  // 3. Edit first, with spaces round her words — stored trimmed, and added.
  // -------------------------------------------------------------------------------------------
  const [d1, d2, d3] = drafts;
  const MINE = 'Owned delivery of the checkout replatform from planning to go-live.';
  await qa.click(card(d1.text).locator('.row button').nth(1), 'Edit first');
  const editing = cards.filter({ has: page.locator('textarea') });
  await qa.fill(editing.locator('textarea'), `   ${MINE}   `, 'types her own words, with stray spaces round them');
  await qa.click(editing.locator('.row button.primary'), 'Add it');
  await page.waitForTimeout(800);
  const afterEdit = await line(d1.id);
  await assert(afterEdit.text === MINE && afterEdit.state === 'ticked', `stored trimmed and added ("${afterEdit.text}", ${afterEdit.state})`);
  await qa.expectVisible(items.filter({ hasText: MINE }).locator('.tag'), 'an ordinary item now, tagged new');

  // -------------------------------------------------------------------------------------------
  // 4. Add the next, then remove it: removed — it no longer prints.
  // -------------------------------------------------------------------------------------------
  await qa.click(card(d2.text).locator('.row button').nth(0), 'Add it');
  await assert((await line(d2.id)).state === 'ticked', 'the server holds that add');
  await qa.click(items.filter({ hasText: d2.text }).first().locator('.ib.rmv'), 'and removes it');
  await assert((await line(d2.id)).state === 'kept', 'removed — it no longer prints');
  await qa.click(tray.locator('button').first(), 'shows what was removed');
  await qa.expectText(tray, d2.text, 'it lists under the removed count');
  await qa.expectText(lead, `${n - 2} suggestions below`, 'the lead moved by two');

  // -------------------------------------------------------------------------------------------
  // 5. Reload twice: the same wording, and the writer is never asked again.
  // -------------------------------------------------------------------------------------------
  const snapshot = JSON.stringify((await allLines()).filter((l) => l.draft !== null));
  await reloadTo(/Nordic/, 'she reloads');
  await reloadTo(/Nordic/, 'and again');
  const again = JSON.stringify((await allLines()).filter((l) => l.draft !== null));
  if (again !== snapshot) {
    const [b, a] = [JSON.parse(snapshot), JSON.parse(again)];
    const moved = a.filter((l) => JSON.stringify(l) !== JSON.stringify(b.find((x) => x.id === l.id)));
    await qa.note(`changed by the reloads (${b.length} before, ${a.length} after):\n${moved.map((l) => `${JSON.stringify(b.find((x) => x.id === l.id))}\n→ ${JSON.stringify(l)}`).join('\n')}`);
  }
  await assert(again === snapshot, 'every suggested line reads exactly as before the reloads');
  await qa.expectVisible(items.filter({ hasText: MINE }), 'her wording, there after the reload');
  await assert((await reviewCalls()) === calls, `the writer was not asked again (${await reviewCalls()} = ${calls})`);

  // -------------------------------------------------------------------------------------------
  // 6. The wrong doors.
  // -------------------------------------------------------------------------------------------
  const asRead = (await allLines()).find((l) => l.draft === null);
  const r1 = await send('PUT', `/cv/lines/${d3.id}`, { state: 'ticked' });
  await assert(r1.status === 404, `the line door cannot add a draft (${r1.status})`);
  const r2 = await send('POST', `/review/drafts/${asRead.id}/tick`);
  await assert(r2.status === 404, `a line read from her CV is no draft to add (${r2.status})`);
  const r3 = await send('PUT', `/review/drafts/${asRead.id}`, { text: 'Rewritten.' });
  await assert(r3.status === 404, `nor to re-word here (${r3.status})`);
  const r4 = await send('PUT', `/review/drafts/${d1.id}`, { text: 'Changed after the add.' });
  await assert(r4.status === 404, `an added draft is not re-worded here (${r4.status})`);
  const r5 = await send('PUT', `/review/drafts/${d3.id}`, { text: '    ' });
  await assert(r5.status === 400, `empty wording is refused (${r5.status})`);
  const r6 = await send('POST', `/review/drafts/${d1.id}/tick`);
  await assert(r6.status === 404, `adding twice is nothing (${r6.status})`);
  const r7 = await page.evaluate(async (id) => (await fetch(`/api/review/drafts/${id}/tick`, { method: 'POST', credentials: 'omit' })).status, d3.id);
  await assert(r7 === 401, `no session, no add (${r7})`);
  const still = await line(d3.id);
  await assert(still.state === 'drafted' && still.text === d3.text && (await line(asRead.id)).text === asRead.text, 'nothing the wrong doors tried changed a line');

  // -------------------------------------------------------------------------------------------
  // 7. No thanks to the rest, the finish — then what prints.
  // -------------------------------------------------------------------------------------------
  const left = (await allLines()).filter((l) => l.state === 'drafted');
  for (const d of left) await qa.click(card(d.text).locator('.row button').nth(2), 'No thanks');
  await assert((await allLines()).filter((l) => l.state === 'dismissed').length === n - 2, `the ${n - 2} she declined are held, declined`);
  await walkTo(/^$/);
  const pill = page.locator('.wrrow .pill').filter({ has: page.locator('input[value=eligible]') }).first();
  if (await pill.count()) await qa.click(pill, 'where she can work: yes');
  await qa.click(primary, 'Finish my profile');
  await qa.expectText(h1, 'Your profile is ready', 'the done screen');
  const declined = (await allLines()).filter((l) => l.state === 'dismissed');

  await qa.goto('/profile', 'her profile');
  await qa.expectText('body', MINE, 'the added line is one of her facts');
  const profile = (await json('/profile')).body;
  const facts = profile.domains.flatMap((d) => d.facts);
  await assert(facts.find((f) => f.id === d1.id)?.source === 'told', 'shown as hers ("told")');
  await assert(facts.find((f) => f.id === d2.id)?.kept === true, 'the one she removed is shown removed');
  await assert(!facts.some((f) => declined.some((u) => u.id === f.id)), 'no declined suggestion is on her profile');
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
  await assert(built.status === 200 && md.includes(MINE), 'her master CV prints the added line, in her words');
  await assert(!md.includes(d2.text), 'not the one she removed');
  await assert(declined.every((u) => !md.includes(u.text)), `none of the ${declined.length} she declined`);
  await assert((await reviewCalls()) === calls, 'and the writer was never asked again');
} finally {
  await holdReview(false).catch(() => {});
  const ok = await qa.finish();
  process.exitCode = ok ? 0 : 1;
}
