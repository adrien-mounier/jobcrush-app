// #335 — ticked and kept CV lines, driven as a person over the REAL stack (fake model only).
//
// Every CV line is ticked (prints) or kept (the person unticked it: never printed, never deleted,
// re-tickable). The review screen that will offer the tick is a later ticket, so this journey calls
// the untick API from the page exactly as that screen will (PUT /api/cv/lines/:id), and drives every
// screen that already exists:
//
//   1. a CV is read; before the deck is decided its lines are grey "Not on your CV yet";
//   2. two lines are unticked — one in a job, one in "About you"; on reload each sits grey under
//      "Kept for when a job needs it", apart from the not-yet-confirmed grey;
//   3. the person confirms every line in the deck and builds the master CV — confirming a kept line
//      does not force it on: neither kept line prints;
//   4. re-ticking one restores it: gold on the profile, back on the rebuilt master CV;
//   5. over the wire: no session -> 401, another person's line -> 404, a state that is not a tap -> 400.
//
// The tailored draft and the export are NOT asserted here: qa-main's fake tailor returns a canned
// draft, so a "kept line absent" check would grade the fake. apps/api/test/tickedLines.test.ts
// covers both with a fake that prints whatever it is handed.
//
//   OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js                       (fake-model API, :34101)
//   API_URL=http://127.0.0.1:34101 pnpm --filter @jobcrush/web build && pnpm --filter @jobcrush/web start
//   node apps/web/e2e/ticked-kept-lines-journey.mjs

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

const CV = [
  'Jane Doe',
  '+33 6 00 00 00 00 | jane.doe.335@example.com',
  'Paris, France',
  '',
  'EXPERIENCE',
  '',
  'IT Project Manager, Nordic Retail Group, Warsaw — Mar 2021 - Present',
  '- Led the checkout replatforming and delivered it two months ahead of plan.',
  '- Managed a budget of EUR 1.2M across three vendor teams.',
  '- Ran steering committee reporting for the CIO every month.',
  '',
  'Project Coordinator, Baltic Software House, Warsaw — 2018 - 2021',
  '- Coordinated releases for 4 agile squads.',
  '- Introduced RAID logging, cutting escalations by a third.',
  '',
  'EDUCATION',
  'MSc Management Information Systems, University of Warsaw, 2017',
  '',
  'CERTIFICATIONS',
  'PRINCE2 Practitioner (2019), PSM I (2020)',
].join('\n');

// The fake miner's recorded lines (apps/api/test/eval/recordings/clean-pdf.json).
const JOB_LINE = 'Managed a budget of EUR 1.2M across 3 vendor teams.';
const JOB_SIBLING = 'Led the replatforming of the e-commerce checkout';
const ABOUT_LINE = 'Holds PSM I certification, obtained 2020.';
const KEPT = 'Kept for when a job needs it';
const PENDING = 'Not on your CV yet';

const qa = await createSession('ticked-kept-lines-journey', { baseURL: BASE, viewport: { width: 1280, height: 900 } });
const { page } = qa;
page.setDefaultTimeout(20_000);

const check = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
const profileJson = () => page.evaluate(async () => (await fetch('/api/profile', { credentials: 'include' })).json());
const factId = async (text) => {
  const p = await profileJson();
  return p.domains.flatMap((d) => d.facts).find((f) => f.text === text)?.id ?? null;
};
const setLine = (id, state) =>
  page.evaluate(
    async ([lineId, s]) => {
      const res = await fetch(`/api/cv/lines/${encodeURIComponent(lineId)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: s }),
      });
      return { status: res.status, body: await res.text() };
    },
    [id, state],
  );
const jobBlock = () => page.locator('.jblk').filter({ has: page.locator('.jhead', { hasText: 'Nordic Retail Group' }) });
const aboutYou = () => page.locator('.dom').filter({ has: page.locator('.dname', { hasText: 'About you' }) });
const runOrder = (loc) => loc.locator('.frow, .fact, .krun').allInnerTexts();
/** The caption a row sits under: the nearest `.krun` before it inside the same container. */
const captionAbove = (container, text) =>
  container.evaluate((el, t) => {
    let caption = null;
    for (const node of el.querySelectorAll('.frow, .fact, .krun')) {
      if (node.classList.contains('krun')) caption = node.textContent.trim();
      else if (node.textContent.includes(t)) return caption;
    }
    return 'ROW-NOT-FOUND';
  }, text);

async function buildMasterCv(jobId, note) {
  await qa.goto(`/deck/${jobId}`, note);
  await page.locator('h1', { hasText: 'Confirm your facts' }).waitFor({ timeout: 60_000 });
  for (let guard = 0; guard < 40; guard++) {
    const btn = page.locator('button:has-text("Looks right")').first();
    if (!(await btn.count())) break;
    await qa.click(btn, 'confirms a fact that came from the CV — including a kept one, if the deck asks');
  }
  await qa.click('button:has-text("Continue")', 'continue — every fact reviewed');
  const grill = page.locator('button:has-text("Build my verified CV")');
  const built = page.locator('h1:has-text("You own your facts")');
  await grill.or(built).first().waitFor({ timeout: 120_000 });
  if (await grill.isVisible().catch(() => false)) {
    await qa.click(grill, 'leaves the gap questions blank and builds the master CV');
  }
  await built.waitFor({ timeout: 180_000 });
  await qa.scrollThrough('reads the master CV top to bottom');
  return page.locator('main').innerText();
}

// ---------------------------------------------------------------------------------------------
// 1. Read a CV, through the work-history check and the wall, to the deck (which seeds the lines).
// ---------------------------------------------------------------------------------------------
const jobId = await qa.frontDoorPaste(CV, 'pastes her CV on the front door');
await qa.waitForJobDone(jobId);
await qa.goto(`/job-blocks/${jobId}`, 'opens the work-history check for that read');
await qa.expectVisible('.jb-card, .jb-done', 'the work-history check opens');
for (let i = 0; i < 8 && (await page.locator('.jb-cbtn.yes').count()); i++) {
  await qa.click('.jb-cbtn.yes', `confirms work-history card ${i + 1}`);
  await page.waitForTimeout(1200);
}
await qa.click('.jb-done .btn:has-text("Continue")', 'continues towards the verified CV');
await page.waitForURL(/\/signup/, { timeout: 60_000 });
await qa.fill('input[aria-label="Email address"]', `qa335+${Date.now()}@example.com`, 'gives an email address');
await qa.click('button:has-text("Email me a sign-in link")', 'asks for the sign-in link');
await qa.click('a:has-text("Open your sign-in link")', 'opens the emailed sign-in link');
await page.waitForURL(/\/deck\//, { timeout: 60_000 });
await qa.expectText('h1', 'Confirm your facts', 'signed in, on the claim deck — her lines are read');

const deck = await page.evaluate(async (id) => {
  const r = await fetch('/api/onboarding/deck', {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: id }),
  });
  return (await r.json()).claims.map((c) => c.lineState);
}, jobId);
await qa.note(`line states as read: ${JSON.stringify(deck)}`);
await check(deck.length > 0 && deck.every((s) => s === 'ticked'), 'every line read from the CV arrives ticked');

// ---------------------------------------------------------------------------------------------
// 2. Before deciding anything: the profile's grey is "Not on your CV yet". Untick two lines.
// ---------------------------------------------------------------------------------------------
await qa.goto('/profile', 'opens her profile before deciding the deck');
await qa.expectVisible(jobBlock(), 'the Nordic Retail Group job block is on the profile');
await qa.expectText(jobBlock().locator('.krun').first(), PENDING, 'undecided lines are grey under "Not on your CV yet"');
// The hero counts confirmed facts only, so before the deck it reads "All 0 make your CV…" (true on
// HEAD too, not #335's). Its not-on-your-CV-yet wording is asserted after the build, in step 3.
await qa.note(`hero before the deck: ${JSON.stringify(await page.locator('.pwait').innerText())}`);

const jobLineId = await factId(JOB_LINE);
const aboutLineId = await factId(ABOUT_LINE);
await qa.note(`line ids: job=${jobLineId} about=${aboutLineId}`);
const u1 = await setLine(jobLineId, 'kept');
const u2 = await setLine(aboutLineId, 'kept');
await qa.note(`untick responses: ${JSON.stringify([u1, u2])}`);
await check(u1.status === 200 && u2.status === 200, 'both unticks are accepted (200)');

await qa.goto('/profile', 'reloads the profile after unticking two lines');
await qa.scrollThrough('reads the whole profile');
const jobRun = await runOrder(jobBlock());
await qa.note(`Nordic Retail block, top to bottom: ${JSON.stringify(jobRun)}`);
await qa.expectText(jobBlock(), KEPT, 'the job block now carries a "Kept for when a job needs it" caption');
await check((await captionAbove(jobBlock(), JOB_LINE)) === KEPT, 'the unticked job line sits under "Kept for when a job needs it", inside its own job');
await check((await captionAbove(jobBlock(), JOB_SIBLING)) === PENDING, 'its undecided sibling stays under "Not on your CV yet" — the two greys apart');
await check(
  ((await jobBlock().locator('.frow', { hasText: JOB_LINE }).getAttribute('class')) ?? '').includes('grey'),
  'the kept line is grey',
);

const aboutRun = await runOrder(aboutYou());
await qa.note(`About you, top to bottom: ${JSON.stringify(aboutRun)}`);
await qa.expectText(aboutYou(), KEPT, 'About you: the unticked line is shown under "Kept for when a job needs it"');
await check((await captionAbove(aboutYou(), ABOUT_LINE)) === KEPT, 'About you: the unticked line sits under the kept caption, apart from undecided lines');

await qa.click(jobBlock().locator('.frow', { hasText: JOB_LINE }), 'opens the kept line');
await qa.expectText('dialog.detail', `${KEPT}. Read from your CV.`, 'the detail says it is kept, and read from her CV');
await qa.click('dialog.detail button:has-text("Close")', 'closes the detail');
await qa.click(jobBlock().locator('.frow', { hasText: JOB_SIBLING }), 'opens an undecided line');
await qa.expectText('dialog.detail', `${PENDING}. Read from your CV.`, 'an undecided line says "Not on your CV yet" — never "kept"');
await qa.click('dialog.detail button:has-text("Close")', 'closes the detail');

const body = await page.evaluate(() => document.body.innerText);
await check(!/kept for when a job needs them/i.test(body), 'the old "kept for when a job needs them" summary wording is gone');
const keptCaptionsOk = await page.evaluate((k) => {
  // Every row under a "Kept…" caption must be a kept line (aria-label says so), never an undecided one.
  const bad = [];
  for (const run of document.querySelectorAll('.krun')) {
    if (run.textContent.trim() !== k) continue;
    let n = run.nextElementSibling;
    while (n && !n.classList.contains('krun')) {
      for (const b of n.matches('button') ? [n] : n.querySelectorAll('button')) {
        if (!(b.getAttribute('aria-label') ?? '').endsWith(k)) bad.push(b.getAttribute('aria-label'));
      }
      n = n.nextElementSibling;
    }
  }
  return bad;
}, KEPT);
await check(keptCaptionsOk.length === 0, `nothing undecided is listed under a "Kept" caption (${JSON.stringify(keptCaptionsOk)})`);

// ---------------------------------------------------------------------------------------------
// 3. Confirm everything in the deck and build: neither kept line prints.
// ---------------------------------------------------------------------------------------------
const master1 = await buildMasterCv(jobId, 'back to the deck to confirm every fact and build');
await qa.expectText('main', 'replatforming', 'the master CV prints her ticked lines');
await check(!master1.includes('EUR 1.2M'), 'the kept job line is NOT on the master CV, though she confirmed it in the deck');
await check(!master1.includes('PSM I'), 'the kept About-you line is NOT on the master CV');

await qa.goto('/profile', 'back to the profile after building');
await check((await captionAbove(jobBlock(), JOB_LINE)) === KEPT, 'confirmed in the deck, the kept line is still kept — confirming never re-ticks');
await qa.expectText('.pwait', 'make your CV right now', 'the summary now counts what is on the CV');
await qa.expectText('.pwait', 'The rest are not on your CV yet', 'and the rest are "not on your CV yet"');

// ---------------------------------------------------------------------------------------------
// 4. Re-tick the job line: gold again, back on the master CV. The About-you line stays kept.
// ---------------------------------------------------------------------------------------------
const r1 = await setLine(jobLineId, 'ticked');
await check(r1.status === 200, `re-tick accepted (${r1.status})`);
await qa.goto('/profile', 'reloads the profile after re-ticking the job line');
await check(
  ((await jobBlock().locator('.frow', { hasText: JOB_LINE }).getAttribute('class')) ?? '').includes('gold'),
  'the re-ticked line is gold again',
);
await check(!(await jobBlock().innerText()).includes(KEPT), 'the job block no longer has a kept caption');
await qa.expectVisible(jobBlock().locator('.frow.gold', { hasText: JOB_LINE }), 'the re-ticked line, on the CV');

const master2 = await buildMasterCv(jobId, 'rebuilds the master CV');
await check(master2.includes('EUR 1.2M'), 'the re-ticked line is back on the master CV');
await check(!master2.includes('PSM I'), 'the still-kept line is still off it');
await qa.expectText('main', 'EUR 1.2M', 'the re-ticked line, printed');

// ---------------------------------------------------------------------------------------------
// 5. Over the wire: the tick is the session's own, and only a tap.
// ---------------------------------------------------------------------------------------------
const wire = await page.evaluate(async (id) => {
  const put = async (state) =>
    (await fetch(`/api/cv/lines/${encodeURIComponent(id)}`, {
      method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state }),
    })).status;
  return { drafted: await put('drafted'), unknown: (await fetch('/api/cv/lines/no-such-line', {
    method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: 'kept' }),
  })).status };
}, jobLineId);
await qa.note(`own session: bad state -> ${wire.drafted}, unknown line -> ${wire.unknown}`);
await check(wire.drafted === 400 && wire.unknown === 404, 'a state that is not a tap is refused (400); an unknown line is 404');

const stranger = await page.context().browser().newContext({ baseURL: BASE });
const noSession = await stranger.request.put(`/api/cv/lines/${jobLineId}`, { data: { state: 'kept' } });
await stranger.request.post('/api/sessions/anonymous');
const otherPerson = await stranger.request.put(`/api/cv/lines/${jobLineId}`, { data: { state: 'kept' } });
await qa.note(`stranger: no session -> ${noSession.status()}, another session -> ${otherPerson.status()}`);
await stranger.close();
await check(noSession.status() === 401, 'with no session the untick is refused (401)');
await check(otherPerson.status() === 404, "another person cannot untick her line (404)");
const after = (await profileJson()).domains.flatMap((d) => d.facts).find((f) => f.id === jobLineId);
await check(after?.colour === 'gold' && !after.kept, "her line is untouched by the stranger's attempt");

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
