// #375 whole-spec QA pass (ADR-0018) — check mode walked end to end, every screen, over the REAL
// stack (fake model only), then the server-side rules ADR-0018's Verification section names,
// tried over the wire. Left by the spec's final QA gate as a re-runnable flow. It complements
// check-mode-journey.mjs (the run held then released, the end date) and
// check-mode-gate-doors-journey.mjs (every door before the finish): this one is the only flow that
// walks EVERY screen — Your details' five fields, About you (edit), each job (add: Add it / Edit
// first / No thanks + Undo; removal: Remove it or Keep it; ⊖ + "N removed · Show" + Put back; ✎),
// Skills (rename), Languages, Additional information (Where you can work holds the finish) — then
// the done screen's counts against the server, the deck, the master CV, a re-upload of the same CV,
// and the work-rights rule after the finish (a market added, an answer taken back).
//
// Run it at both widths (QA_WIDTH=1280 default, QA_WIDTH=390 for a phone). At 390 the removal
// suggestion is answered "Keep it" instead of "Remove it", so the two runs together cover both.
//
// What the fake stack cannot show (its miner answers one recorded CV, whatever is pasted): a
// Personal projects screen (the recording has none — miner-eval's personal-projects recording and
// check-mode.spec.ts cover it), a second skills group to move a skill into (skillsGroups.test.ts,
// check-mode.spec.ts), and "See what your CV said" (the recording has no summary — check-mode.spec).
//
//   PORT=34101 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34100
//   BASE_URL=http://127.0.0.1:34100 node apps/web/e2e/check-mode-full-walk-journey.mjs
//   QA_WIDTH=390 BASE_URL=http://127.0.0.1:34100 node apps/web/e2e/check-mode-full-walk-journey.mjs
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34100';
const WIDTH = Number(process.env.QA_WIDTH ?? 1280);
const PHONE = WIDTH < 600;
const RUN = `${Date.now().toString(36)}${WIDTH}`;
const EMAIL = `full.walk.${RUN}@example.com`;
const ROLE = 'IT project manager';
const AREA = 'Singapore';

const cvText = (marker) =>
  [
    'Jane Doe',
    `+33 6 00 00 00 00 | ${EMAIL}`,
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
    marker,
  ].join('\n');
// REVIEWCHECK makes the fake miner read a misspelt budget line and a date of birth (qa-main.ts).
const CV_FIRST = cvText('REVIEWCHECK');
// The changed CV: without the marker the recording reads the steering-committee line where the
// date of birth was — one new item in the Nordic job, nothing else new.
const CV_CHANGED = cvText('');

const BUDGET = 'Managed a budget of EUR 1.2M across 3 vendor teams.';
const DOB = 'Date of birth: 12 March 1988.';
const LED = 'Led the replatforming of the e-commerce checkout, delivered 2 months early.';
const RAID = 'Introduced RAID logging, cutting escalations by a third.';
const RAID_EDITED = 'Introduced RAID logging across four squads, cutting escalations by a third.';
const STEERING = 'Ran steering committee reporting for the CIO.';
const MINE = 'Aligned the business and IT groups through every checkout release.';
const ABOUT_MINE = 'Delivered the checkout replatform two months early and ran EUR 1.2M across three vendors.';
const NEW_TITLE = 'Senior IT Project Manager';

const ADVERT = `Senior IT Project Manager — Helvara Group ${RUN}
Singapore
Helvara Group is looking for a Senior IT Project Manager to lead a core banking migration.
- Own the end-to-end delivery of a multi-year transformation programme.
- Manage a budget of EUR 4-6 million and a mixed team of staff and vendors.
- At least eight years managing IT projects.
Applications close 2026-12-20.`;

const qa = await createSession(`check-mode-full-walk-${WIDTH}`, {
  baseURL: BASE,
  viewport: { width: WIDTH, height: PHONE ? 844 : 900 },
});
const { page } = qa;
page.setDefaultTimeout(20_000);
const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
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
const send = (method, path, body) =>
  api(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

const review = async () => (await api('/review')).body;
const allLines = (r) => r.sections.flatMap((s) => ('jobs' in s ? s.jobs.flatMap((j) => j.lines) : s.lines));
const lineBy = async (pred) => allLines(await review()).find(pred) ?? null;
const waitForRun = async () => {
  for (let i = 0; i < 120; i += 1) {
    const r = await review();
    if (r && r.progress === null) return r;
    await page.waitForTimeout(500);
  }
  return review();
};
const buildMaster = async () => {
  const built = await send('POST', '/onboarding/build');
  return { status: built.status, md: built.body?.rootCv?.markdown ?? '' };
};

// Check mode's structure (check-mode.spec.ts selects the same way).
const h1 = page.locator('main h1');
const lead = page.locator('main .lead');
const primary = page.locator('.foot .primary');
const back = page.locator('.foot .ghost');
const items = page.locator('main li.pt');
const item = (text) => items.filter({ hasText: text }).first();
const addCards = page.locator('main li.sg:not(.rmv)');
const removeCard = page.locator('main li.sg.rmv');
const tray = page.locator('main .tray');
const label = async () => ((await primary.textContent()) ?? '').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function walkTo(re) {
  await h1.waitFor();
  for (let i = 0; i < 16; i += 1) {
    if (re.test((await h1.textContent()) ?? '')) return true;
    if ((await primary.isDisabled()) || !/^Next:/.test(await label())) return false;
    await qa.click(primary, `Next (${await label()})`);
  }
  return false;
}
async function reloadTo(re, note) {
  await qa.goto('/profile/check', note);
  await assert(await walkTo(re), `back on the screen ${re}`);
}
/** The copy rule: plain words, never "ticked", "kept" or "reviewed" on screen. */
async function copyRule(where) {
  const root = (await page.locator('main').count()) ? page.locator('main').first() : page.locator('body');
  const text = (await root.innerText().catch(() => '')) ?? '';
  const hit = /\b(ticked|kept|reviewed)\b/i.exec(text);
  await assert(!hit, `copy rule on ${where}: no "ticked", "kept" or "reviewed" on screen${hit ? ` — found "${hit[0]}"` : ''}`);
}
async function noSideScroll(where) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  await assert(sw <= iw, `no horizontal page scroll on ${where} (${sw} <= ${iw})`);
}
async function pasteAdvert() {
  const { status, body } = await send('POST', '/onboarding/paste', { text: ADVERT });
  if (status !== 202) return { status, result: null };
  for (let i = 0; i < 60; i += 1) {
    const job = (await api(`/jobs/${body.jobId}`)).body;
    if (job && (job.status === 'completed' || job.status === 'failed')) return { status, result: job.progress?.paste?.result ?? null, job };
    await page.waitForTimeout(1000);
  }
  return { status, result: null };
}
async function reupload(text) {
  const { status, body } = await send('POST', '/cv/paste', { text });
  if (status !== 202 && status !== 200) return status;
  for (let i = 0; i < 120; i += 1) {
    const job = (await api(`/jobs/${body.jobId}`)).body;
    if (job && (job.status === 'completed' || job.status === 'failed')) break;
    await page.waitForTimeout(1000);
  }
  await waitForRun();
  return status;
}

try {
  // -------------------------------------------------------------------------------------------
  // 1. The CV, question 1, and nothing asked after it (#376, ADR-0018 clause 8).
  // -------------------------------------------------------------------------------------------
  const jobId = await qa.frontDoorPaste(CV_FIRST, 'the front door — she pastes her CV');
  await qa.waitForJobDone(jobId);
  await qa.frontDoorContinueToIntent();
  await qa.fill('#target-role', ROLE, `question 1 — the job she is going for: "${ROLE}"`);
  await qa.fill('#search-area', AREA, `where she wants to work: ${AREA}`);
  await qa.click('button:has-text("Save and continue")', 'Save and continue');
  await page.waitForTimeout(2000);
  await qa.note(`after question 1 she is on ${new URL(page.url()).pathname}`);
  if (!/\/discovery/.test(page.url())) await qa.goto('/discovery', 'discovery');
  await page.locator('.discovery .handoff .go').waitFor({ state: 'visible', timeout: 30_000 });
  await qa.expectVisible('.discovery .handoff', 'owner decision pending (#376 deviation 1): the discovery screen stays up with Continue');
  await assert((await page.locator('.discovery .opts, .discovery textarea, .discovery input').count()) === 0, 'nothing is asked: no question, no field on the hand-off');
  await qa.note(`hand-off reads: "${(await page.locator('.discovery .handoff').innerText()).replace(/\s+/g, ' ')}"`);

  // Signed in now (the master CV and the tailor need a user), over the dev magic link.
  const signed = await page.evaluate(async ({ email }) => {
    const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const res = await post('/api/auth/request-link', { email });
    const link = await res.json();
    if (!link.devLink) return `sign-in failed (${res.status})`;
    await post('/api/auth/verify', { token: new URL('http://x' + link.devLink).searchParams.get('token') });
    return 'ok';
  }, { email: EMAIL });
  await assert(signed === 'ok', `she signs in (${signed})`);

  await qa.click('.discovery .handoff .go', 'Continue');
  await page.waitForURL(/\/profile\/check/, { timeout: 20_000 });
  await assert(/\/profile\/check/.test(page.url()), `Continue opens check mode (${new URL(page.url()).pathname})`);
  const r0 = await waitForRun();
  await assert(r0?.progress === null && r0?.completed === false, 'the review run has landed; check mode is not finished');

  // The jobs are shut while suggestions are open — over the wire.
  const cards0 = (await api('/onboarding/cards')).body;
  await assert(cards0?.reviewPending === true && (cards0.cards ?? []).length === 0, `deck (cards API) holds: ${JSON.stringify({ reviewPending: cards0?.reviewPending, cards: cards0?.cards?.length })}`);
  const done0 = await send('POST', '/review/complete');
  await assert(done0.status === 409, `finishing is refused server-side while suggestions and work rights are open: ${done0.status} ${done0.body?.error?.code}`);
  const p0 = await pasteAdvert();
  const adId = p0.result?.adId ?? null;
  await assert(!!adId && !p0.result?.card, `the paste door stores the job but hands back no card (adId ${adId})`);
  if (adId) {
    const js = await api(`/onboarding/jobs/${encodeURIComponent(adId)}`);
    await assert(js.status === 409, `that job's own screen API holds: ${js.status} ${js.body?.error?.code}`);
    const want = await send('POST', `/onboarding/cards/${encodeURIComponent(adId)}/want`);
    await assert(want.status >= 400, `the want door holds: ${want.status}`);
  }
  // Unanswered suggestions never print, even before the finish.
  const draftsOpen = allLines(r0).filter((l) => l.state === 'drafted');
  const m0 = await buildMaster();
  await qa.note(`master CV build before the finish: ${m0.status}, ${m0.md.length} chars`);
  if (m0.status === 200) {
    await assert(!m0.md.includes(DOB), 'the master CV does not print the date of birth while its removal is unanswered');
    await assert(draftsOpen.every((d) => !m0.md.includes(d.text)), `none of the ${draftsOpen.length} unanswered add suggestions print`);
  }

  // -------------------------------------------------------------------------------------------
  // 2. Your details — five editable fields in a plain card (#381).
  // -------------------------------------------------------------------------------------------
  await qa.goto('/profile/check', 'check mode, from the top');
  await qa.expectText(h1, 'Your details', 'the walk opens at her details');
  for (const f of ['name', 'title', 'email', 'phone', 'location']) await qa.expectVisible(`input[name=${f}]`, `the ${f} field`);
  const values = {};
  for (const f of ['name', 'title', 'email', 'phone', 'location']) values[f] = await page.locator(`input[name=${f}]`).inputValue();
  await qa.note(`fields as read: ${JSON.stringify(values)}`);
  await assert(values.name.includes('Jane Doe') && values.email === EMAIL, 'name and email as read');
  await assert(values.title.length < 80, `the title is a title, not a summary (${values.title.length} chars)`);
  await assert((await page.locator('main .sg, main .hd').count()) === 0, 'no gold frame, no "Please check" header — a plain card');
  await qa.expectText(lead, 'Check how I read your details', 'one plain sentence says what to do');
  if (!values.location) await qa.expectVisible('input[name=location][placeholder="Not found in your CV"]', 'an empty location says so');
  await qa.fill('input[name=title]', NEW_TITLE, 'she sets her title');
  await qa.scrollThrough('her details');
  await copyRule('Your details');
  if (PHONE) {
    await noSideScroll('Your details');
    const box = await primary.boundingBox();
    await assert(!!box && box.y + box.height > 844 - 120, `the footer button sits at thumb height (bottom ${box ? Math.round(box.y + box.height) : '?'} of 844)`);
  }
  await qa.click(primary, `the footer button saves and moves on (${await label()})`);
  await qa.expectText(h1, 'About you', 'About you comes next');
  await qa.click(back, 'Back');
  await assert((await page.locator('input[name=title]').inputValue()) === NEW_TITLE, 'Back shows her title');
  const lh = (await review()).letterhead;
  await assert(lh.title?.value === NEW_TITLE, `the server holds the title (${JSON.stringify(lh.title)})`);

  // -------------------------------------------------------------------------------------------
  // 3. About you — written from the whole CV, kept or edited (#371).
  // -------------------------------------------------------------------------------------------
  await qa.click(primary, 'Next: About you');
  await qa.expectVisible('main .card .about', 'About you, in a plain card');
  await assert((await page.locator('main .sg').count()) === 0, 'no suggestion frame around About you');
  const aboutBefore = (await page.locator('main .card .about').innerText()).trim();
  await assert(!/^(senior|junior)?\s*[\w ]*manager with \d/i.test(aboutBefore) && !/proven ability/i.test(aboutBefore), `no identity opener, no capability claim: "${aboutBefore.slice(0, 90)}…"`);
  const see = page.getByRole('button', { name: 'See what your CV said' });
  await qa.note(`"See what your CV said" on screen: ${await see.count()} (the recorded CV has no summary, so there is no original to show)`);
  await qa.click(page.getByRole('button', { name: 'Edit it' }), 'Edit it');
  await qa.fill('#about-ed', ABOUT_MINE, 'in her own words');
  await copyRule('About you');
  await qa.click(primary, 'the footer button saves her words');
  await assert((await review()).about?.text === ABOUT_MINE, 'the server holds her About you');
  await qa.click(back, 'Back to About you');
  await qa.expectText('main .card .about', ABOUT_MINE, 'her words, read back');
  await qa.click(primary, 'on to her first job');

  // -------------------------------------------------------------------------------------------
  // 4. The Nordic job — fix, removal suggestion, add suggestions, ⊖, ✎ (#377-#380, #384, #368).
  // -------------------------------------------------------------------------------------------
  await assert(await walkTo(/Nordic/), 'her Nordic job');
  await qa.scrollThrough('she reads the job screen');
  const n = draftsOpen.length;
  await assert(await primary.isDisabled(), `the footer button waits for the answers ("${await label()}")`);
  await assert(/Answer .*suggestion/.test(await label()), 'and says what is left');
  await qa.expectText(lead, 'suggestions below', 'the lead counts the suggestions');

  // The fix (#384): a quiet tag, original → corrected, Undo, Use the fix.
  const budget = item(BUDGET);
  await qa.expectVisible(budget.locator('.tag.fixed'), 'the corrected budget line wears a quiet "Fixed" tag');
  await qa.click(budget.locator('.tag.fixed'), 'taps Fixed');
  await qa.expectText(budget.locator('.fixrow'), 'accross', 'original → corrected');
  await qa.click(budget.locator('.fixrow button'), 'Undo');
  await assert((await lineBy((l) => l.text.includes('accross'))) !== null, 'the server holds her original');
  // The tag stays open after Undo; tap it only if it closed.
  if (!(await item('accross').locator('.fixrow').isVisible())) await qa.click(item('accross').locator('.tag.fixed'), 'taps the tag again');
  await qa.click(item('accross').locator('.fixrow button'), 'Use the fix');
  await assert((await lineBy((l) => l.text === BUDGET)) !== null, 'the fix is used again');

  // The removal suggestion (#380): coral, never the gold dashed frame.
  await qa.expectText(removeCard, 'Remove this?', 'her date of birth wears the coral "Remove this?" card');
  const rmStyle = await removeCard.evaluate((el) => {
    const s = getComputedStyle(el);
    return { top: s.borderTopStyle, left: s.borderLeftStyle, leftColor: s.borderLeftColor, leftW: s.borderLeftWidth };
  });
  const addStyle = await addCards.first().evaluate((el) => getComputedStyle(el).borderTopStyle);
  await assert(rmStyle.top !== 'dashed' && addStyle === 'dashed', `coral bar, no dashed box (${JSON.stringify(rmStyle)}); the add card is dashed (${addStyle})`);
  await qa.expectText(removeCard, 'Why:', 'one sentence says why');
  const dob = await lineBy((l) => l.text === DOB);
  await assert(dob?.state === 'removal-suggested', 'unanswered, the machine removed nothing');
  if (PHONE) {
    await qa.click(removeCard.getByRole('button', { name: 'Keep it' }), 'Keep it');
    await assert((await lineBy((l) => l.id === dob.id))?.state === 'ticked', 'the server holds it in');
    await qa.expectVisible(item(DOB), 'it is an ordinary item now');
  } else {
    await qa.click(removeCard.getByRole('button', { name: 'Remove it' }), 'Remove it');
    await assert((await lineBy((l) => l.id === dob.id))?.state === 'kept', 'the server holds it removed');
    await qa.expectText(tray.locator('button').first(), '1 removed', '"1 removed · Show" at the end of the section');
  }

  // The add suggestions (#378, #368).
  await assert(n >= 3 && (await addCards.count()) === n, `${n} add suggestions inline in the job`);
  const ifTrue = await addCards.filter({ hasText: 'Only if true' }).count();
  const flagged = draftsOpen.filter((d) => (d.draft?.flags ?? []).some((f) => /OPTIONAL|INDUSTRY GUESS/.test(f))).length;
  await assert(ifTrue === flagged, `"Only if true" only on OPTIONAL / INDUSTRY GUESS drafts (${ifTrue} cards, ${flagged} flagged)`);
  await qa.expectText(addCards.filter({ hasText: 'Only if true' }).first(), 'From your CV', 'a cited draft names where its quote came from');
  await qa.note(`source lines: ${JSON.stringify(await addCards.locator('.meta').allInnerTexts())}`);
  const [d1, d2, d3, ...rest] = draftsOpen;
  await qa.click(addCards.filter({ hasText: d1.text }).getByRole('button', { name: 'Add it' }), 'Add it');
  await qa.expectVisible(item(d1.text).locator('.tag'), 'it lands in the list tagged "new"');
  await qa.click(addCards.filter({ hasText: d2.text }).getByRole('button', { name: 'Edit first' }), 'Edit first');
  const editing = addCards.filter({ has: page.locator('textarea') });
  await qa.fill(editing.locator('textarea'), MINE, 'her own words');
  await qa.click(editing.locator('button.primary'), 'Add it');
  await qa.click(addCards.filter({ hasText: d3.text }).getByRole('button', { name: 'No thanks' }), 'No thanks');
  await qa.expectText('main li.gone', "No thanks. I won't suggest it again.", 'No thanks, with Undo');
  await qa.click(page.locator('main li.gone button'), 'Undo');
  await qa.expectVisible(addCards.filter({ hasText: d3.text }), 'Undo brings the card back');
  await assert((await lineBy((l) => l.id === d3.id))?.state === 'drafted', 'the server holds it unanswered again');
  for (const d of [d3, ...rest]) await qa.click(addCards.filter({ hasText: d.text }).getByRole('button', { name: 'No thanks' }), 'No thanks');
  await page.waitForTimeout(800);
  await assert(await primary.isEnabled(), `every suggestion answered: the footer button turns gold ("${await label()}")`);

  // ⊖ on an ordinary item, "N removed · Show", Put back.
  await qa.click(item(LED).locator('.ib.rmv'), '⊖ removes the replatform line');
  await assert((await lineBy((l) => l.text === LED))?.state === 'kept', 'the server holds it removed');
  await qa.click(tray.locator('button').first(), `"${(await tray.locator('button').first().innerText()).trim()}"`);
  await qa.click(tray.locator('li').filter({ hasText: LED }).locator('button'), 'Put back');
  await assert((await lineBy((l) => l.text === LED))?.state === 'ticked', 'the server holds it in again');
  await qa.click(item(LED).locator('.ib.rmv'), '⊖ removes it again, for the renders below');

  await reloadTo(/Nordic/, 'she reloads');
  await qa.expectVisible(item(d1.text), 'Add it survived the reload');
  await qa.expectVisible(item(MINE), 'Edit first survived the reload, in her words');
  await assert((await addCards.count()) === 0 && (await removeCard.count()) === 0, 'nothing comes back to answer');
  await copyRule('the Nordic job');
  if (PHONE) await noSideScroll('the Nordic job');

  // -------------------------------------------------------------------------------------------
  // 5. The Baltic job — ✎ in place (#379).
  // -------------------------------------------------------------------------------------------
  await assert(await walkTo(/Baltic/), 'the Baltic job');
  await assert((await addCards.count()) === 0, 'no suggestion for a job in no family');
  const raid = item(RAID);
  if (!PHONE) await raid.hover();
  await qa.click(raid.getByRole('button', { name: 'Edit' }), '✎ Edit');
  await qa.fill('main li.pt.edit textarea', '', 'empties the words');
  await assert(await page.locator('main li.pt.edit button.primary').isDisabled(), 'an empty Save is refused');
  await qa.press('main li.pt.edit textarea', 'Escape', 'Escape cancels');
  await qa.expectVisible(item(RAID), 'Cancel changed nothing');
  await qa.click(item(RAID).getByRole('button', { name: 'Edit' }), '✎ Edit again');
  await qa.fill('main li.pt.edit textarea', RAID_EDITED, 'her words');
  await qa.click('main li.pt.edit button.primary', 'Save');
  await qa.expectVisible(item(RAID_EDITED), 'the item reads her words, where it was');
  const raidLine = await lineBy((l) => l.text === RAID_EDITED);
  await assert(!!raidLine, 'the server holds her words');

  // -------------------------------------------------------------------------------------------
  // 6. Education, certifications, Skills (#382), Languages (#376), Additional information.
  // -------------------------------------------------------------------------------------------
  const titles = [];
  for (let i = 0; i < 12; i += 1) {
    const t = ((await h1.textContent()) ?? '').trim();
    titles.push(t);
    if (t === 'Skills') break;
    await qa.click(primary, `Next (${await label()})`);
  }
  await qa.note(`screens up to Skills: ${titles.join(' → ')}`);
  await qa.expectText(h1, 'Skills', 'Skills');
  await assert(await primary.isEnabled(), 'Skills needs no answer to continue');
  const groupNames = await page.locator('main .grp .gh').allInnerTexts();
  const skillItems = await page.locator('main .grp li.pt').allInnerTexts();
  await qa.note(`groups ${JSON.stringify(groupNames)}; skills ${JSON.stringify(skillItems.map((s) => s.split('\n')[0]))}`);
  await assert(skillItems.length >= 5, `one skill per item (${skillItems.length})`);
  const cols = await page.locator('main .groups').evaluate((el) => getComputedStyle(el).gridTemplateColumns || getComputedStyle(el).columnCount);
  await qa.note(`groups layout at ${WIDTH}px: ${cols}`);
  await qa.click(page.locator('main .grp .gh').first(), 'taps the group name to rename it');
  await qa.fill('main .grp input.gname', `Tools ${RUN}`, 'a new name');
  await qa.press('main .grp input.gname', 'Enter', 'Enter');
  await page.waitForTimeout(800);
  await reloadTo(/^Skills$/, 'she reloads');
  await qa.expectText(page.locator('main .grp .gh').first(), `Tools ${RUN}`, 'the new group name survived the reload');
  await qa.click(page.locator('main .grp li.pt').first().getByRole('button', { name: 'Move to another group' }), 'the move icon');
  const options = await page.locator('main select.mv option').allInnerTexts();
  await qa.note(`move-to options: ${JSON.stringify(options)} (one group on the recorded CV — nothing to move into; covered by skillsGroups.test.ts and check-mode.spec.ts)`);
  await page.keyboard.press('Escape');
  await copyRule('Skills');

  await assert(await walkTo(/^Languages$/), 'on, screen by screen, to Languages');
  await qa.expectText(h1, 'Languages', 'Languages, its own screen');
  await qa.note(`languages: ${JSON.stringify((await items.allInnerTexts()).map((s) => s.split('\n')[0]))}`);
  await assert((await items.count()) >= 3, 'the CV\'s languages, read as items');
  await assert(await walkTo(/^Additional information$/), 'on to Additional information');
  await qa.expectText(h1, 'Additional information', 'Additional information');
  await qa.expectText('main .card.wr .ctitle', 'Where you can work', '"Where you can work", a plain card');
  await assert((await page.locator('main .card.wr').evaluate((el) => !!el.closest('.sg'))) === false, 'not in a suggestion frame');
  await qa.expectText(primary, `Answer ${AREA} to continue`, `the finish is held, naming ${AREA}`);
  await assert(await primary.isDisabled(), 'disabled until answered');
  const held = await send('POST', '/review/complete');
  await assert(held.status === 409 && held.body?.error?.code === 'work_rights_unset', `the server refuses too: ${held.status} ${held.body?.error?.code}`);
  if (adId) {
    const js = await api(`/onboarding/jobs/${encodeURIComponent(adId)}`);
    await assert(js.status === 409, `with every suggestion answered but ${AREA} unset, the job's screen API still holds: ${js.status}`);
  }
  await qa.click(page.locator('.wrrow .pill').filter({ has: page.locator('input[value=eligible]') }).first(), 'Yes, I can work there');
  await qa.expectText(primary, 'Finish my profile', 'the finish unlocks');
  await copyRule('Additional information');
  if (PHONE) await noSideScroll('Additional information');

  // -------------------------------------------------------------------------------------------
  // 7. Finish → the done screen's counts → the jobs.
  // -------------------------------------------------------------------------------------------
  await qa.click(primary, 'Finish my profile');
  await qa.expectText(h1, 'Your profile is ready', 'the done screen');
  const tally = (await page.locator('.tally b').allInnerTexts()).map(Number);
  const rDone = await review();
  const ls = allLines(rDone);
  const want = [ls.filter((l) => l.state === 'ticked').length, ls.filter((l) => l.state === 'ticked' && l.draft !== null).length, ls.filter((l) => l.state === 'kept').length];
  await assert(JSON.stringify(tally) === JSON.stringify(want), `in / added / removed = ${JSON.stringify(tally)}; the server's ${JSON.stringify(want)}`);
  await assert(rDone.completed === true, 'check mode is finished on the server');
  await copyRule('the done screen');
  await qa.click('.donepanel .primary', 'Show me the job ads');
  await page.waitForURL(/\/deck/, { timeout: 20_000 });
  const opened = await qa.cardsWhenRetrieved();
  await assert((opened?.cards ?? []).length > 0 && opened?.reviewPending === undefined, `the deck opens: ${(opened?.cards ?? []).length} cards`);
  await page.waitForTimeout(1500);
  await qa.scrollThrough('the deck, as she sees it');

  // -------------------------------------------------------------------------------------------
  // 8. The master CV: removed and dismissed never print; added and edited words do.
  // -------------------------------------------------------------------------------------------
  const m1 = await buildMaster();
  await assert(m1.status === 200, `the master CV builds: ${m1.status}`);
  await assert(!m1.md.includes(LED), 'the removed replatform line is not on the master CV');
  await assert(PHONE ? m1.md.includes(DOB) : !m1.md.includes(DOB), PHONE ? 'the date of birth she kept prints' : 'the date of birth she removed is not on the master CV');
  await assert([d3, ...rest].every((d) => !m1.md.includes(d.text)), 'no dismissed suggestion prints');
  await assert(m1.md.includes(d1.text) && m1.md.includes(MINE), 'what she added prints, in her words');
  await assert(m1.md.includes(RAID_EDITED) && !m1.md.includes(RAID), 'the edited item prints her words, never the words as read');
  await qa.note(`master CV letterhead (owner decision pending, deviation 2): title "${NEW_TITLE}" printed: ${m1.md.includes(NEW_TITLE)}`);

  // -------------------------------------------------------------------------------------------
  // 9. The profile after check mode: removed tray, Fixed tag, no on-screen ticked/kept/reviewed.
  // -------------------------------------------------------------------------------------------
  await qa.goto('/profile', 'her profile, after check mode');
  await page.waitForTimeout(1500);
  // At phone width the facts sit in a pull-up sheet; a tap on its grabber opens it.
  if (PHONE && (await page.locator('.pfgrab').count())) await qa.click('.pfgrab', 'opens "Your facts"');
  await qa.scrollThrough('her profile');
  const profileText = await page.locator('body').innerText();
  await assert(/removed/i.test(profileText), 'the profile lists what was removed');
  await assert(/Fixed/.test(profileText), 'the Fixed tag shows on the profile too');
  await copyRule('the profile');

  // -------------------------------------------------------------------------------------------
  // 10. /review forwards to check mode.
  // -------------------------------------------------------------------------------------------
  await qa.goto('/review', 'the old review address');
  await assert(/\/profile\/check/.test(page.url()), `/review forwards to check mode (${new URL(page.url()).pathname})`);

  // -------------------------------------------------------------------------------------------
  // 11. After the finish: a market with no work-rights answer holds every door (ADR-0018 c7).
  // -------------------------------------------------------------------------------------------
  const p1 = await pasteAdvert();
  const adOpen = p1.result?.adId ?? adId;
  await assert(!!p1.result?.card, `after the finish the paste door hands back a card (adId ${adOpen})`);
  const wantOpen = await send('POST', `/onboarding/cards/${encodeURIComponent(adOpen)}/want`);
  await assert(wantOpen.status < 300, `the want door opens on the job she brought: ${wantOpen.status}`);
  const tailorOpen = await api('/onboarding/tailor');
  await assert(tailorOpen.status === 200, `the tailor opens: ${tailorOpen.status}`);
  const intent = await send('PUT', '/sessions/me/intent', { searchAreas: [AREA, 'Hong Kong'] });
  await assert(intent.status === 200, `she adds Hong Kong on her profile: ${intent.status}`);
  const c2 = (await api('/onboarding/cards')).body;
  await assert(c2?.reviewPending === true, `the deck holds again with Hong Kong unanswered: ${JSON.stringify({ reviewPending: c2?.reviewPending, cards: c2?.cards?.length })}`);
  const js2 = await api(`/onboarding/jobs/${encodeURIComponent(adOpen)}`);
  await assert(js2.status === 409, `the job's own screen API holds: ${js2.status}`);
  const want2 = await send('POST', `/onboarding/cards/${encodeURIComponent(adOpen)}/want`);
  await assert(want2.status >= 400, `the want door holds with Hong Kong unanswered: ${want2.status}`);
  const tailor2 = await api('/onboarding/tailor');
  await assert(tailor2.status >= 400, `the tailor holds with Hong Kong unanswered: ${tailor2.status}`);
  const draft2 = await send('POST', '/onboarding/tailor/draft');
  await assert(draft2.status >= 400, `a tailored draft is refused with Hong Kong unanswered: ${draft2.status}`);
  await qa.goto('/profile/check', 'check mode comes back for that market');
  await h1.waitFor();
  await qa.note(`check mode shows: "${(await h1.textContent())?.trim()}"`);
  await qa.expectText('main .card.wr', 'Hong Kong', 'only the work-rights card, Hong Kong open');
  await qa.click(page.locator('.wrrow').filter({ hasText: 'Hong Kong' }).locator('.pill').filter({ has: page.locator('input[value=eligible]') }), 'Yes, Hong Kong');
  await page.waitForTimeout(800);
  const c3 = (await api('/onboarding/cards')).body;
  await assert(c3?.reviewPending === undefined, `answered, the deck is open again (reviewPending ${c3?.reviewPending})`);

  // The same rule with an answer taken back ("Ask me later" on the profile's work-rights door):
  // the search does not change, so a job the deck fetched is in play too, not only one she brought.
  const deckNow = await qa.cardsWhenRetrieved();
  const fetched = (deckNow?.cards ?? []).find((c) => c.adId !== adOpen)?.adId ?? null;
  await qa.note(`a fetched job from her deck: ${fetched}`);
  if (fetched) {
    const w = await send('POST', `/onboarding/cards/${encodeURIComponent(fetched)}/want`);
    await assert(w.status < 300, `she wants a fetched job: ${w.status}`);
  }
  const back2 = await send('POST', '/onboarding/discovery/answer', { itemId: 'eligibility-work-rights-hong-kong', answer: 'Ask me later' });
  await assert(back2.status === 200, `she takes her Hong Kong answer back: ${back2.status}`);
  const c4 = (await api('/onboarding/cards')).body;
  await assert(c4?.reviewPending === true, `the deck holds again (reviewPending ${c4?.reviewPending})`);
  if (fetched) {
    const w2 = await send('POST', `/onboarding/cards/${encodeURIComponent(fetched)}/want`);
    await assert(w2.status >= 400, `the want door holds on a fetched job with Hong Kong taken back: ${w2.status}`);
    const t2 = await api('/onboarding/tailor');
    await assert(t2.status >= 400, `the tailor holds on a fetched job with Hong Kong taken back: ${t2.status}`);
  }
  await send('PUT', '/review/work-rights/eligibility-work-rights-hong-kong', { answer: 'eligible' });
  await assert((await api('/onboarding/cards')).body?.reviewPending === undefined, 'answered again, the deck opens');


  // -------------------------------------------------------------------------------------------
  // 12. Re-upload (#385): the same CV opens nothing; a changed one opens the new item only.
  // -------------------------------------------------------------------------------------------
  const st1 = await reupload(CV_FIRST);
  const rSame = await review();
  await qa.note(`re-upload of the same CV: POST ${st1}; completed ${rSame.completed}, newItems ${JSON.stringify(rSame.newItems)}`);
  await assert(rSame.completed === true, 'the same CV again: check mode stays finished');
  await assert((await api('/onboarding/cards')).body?.reviewPending === undefined, 'and the jobs stay open');
  const same = allLines(rSame);
  await assert(same.find((l) => l.text === LED)?.state === 'kept' && !!same.find((l) => l.text === RAID_EDITED), 'removed and edited items keep their state');

  // A changed CV on this stack: the fake miner reads the steering-committee line under the SAME
  // item id the date of birth had, so the import's insert-or-ignore keeps the old line and nothing
  // is new (the reworded-line case #388 holds). A new item under a NEW id — what #385's AC needs —
  // cannot be made on this stack; cvReviewRun.test.ts ("a new item in one job …") and
  // check-mode.spec.ts (#385) prove it. Recorded here, not asserted.
  const st2 = await reupload(CV_CHANGED);
  const rNew = await review();
  const all2 = allLines(rNew);
  await qa.note(`re-upload of a changed CV (same ids, new words): POST ${st2}; completed ${rNew.completed}, newItems ${JSON.stringify(rNew.newItems)}; steering line present: ${all2.some((l) => l.text === STEERING)}; date-of-birth line still present: ${all2.some((l) => l.text === DOB)}`);

} finally {
  const ok = await qa.finish();
  process.exitCode = ok ? 0 : 1;
}
