// #183 desktop profile shape A — the field + right rail, the new hero, the Job family door.
//
// Driven as a human, human-paced, across a desktop viewport and two phone viewports. The API is
// route-mocked (the same pinned ProfileState shape profile.spec.ts uses), so this flow needs only a
// built web app — no Fastify, no model key:
//
//   cd apps/web && npx next build && npx next start -p 3100
//   BASE_URL=http://127.0.0.1:3100 node apps/web/e2e/profile-shape-a-journey.mjs
//
// Ports are deliberately not 3000/3001 — another project on this machine defaults to those.
//
// Beyond the ACs it drives the adversarial edges the spec's copy tables imply but the .spec.ts does
// not reach: the singular/zero branches of the hero, a role long enough to break the rail, a save
// that succeeds while the refetch behind it fails, keyboard-only operation of the door, and reduced
// motion. It also files the owner-deliverable phone screenshots showing WHERE the rail sits.

import fs from 'node:fs';
import path from 'node:path';
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3100';
const OWNER_SHOTS = process.env.QA_OWNER_SHOTS ?? 'qa-results/owner-shots';
fs.mkdirSync(OWNER_SHOTS, { recursive: true });

const qa = await createSession('profile-shape-a', { baseURL: BASE, viewport: { width: 1280, height: 800 } });
const { page } = qa;
page.setDefaultTimeout(12000);

let aborted = false;
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, async (e) => {
    if (aborted) return;
    aborted = true;
    try {
      await qa.note(`RUN ABORTED (${ev}): ${e?.message ?? e}`);
      await qa.finish();
    } catch { /* report already closed */ }
    process.exit(1);
  });
}

// --------------------------------------------------------------------------------------------
// Fixtures + a single mutable mock of the two routes the screen touches.
// --------------------------------------------------------------------------------------------

const facts = (n, colour, prefix) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, text: `${prefix} fact ${i}.`, colour, source: 'told' }));

const BASE_PROFILE = {
  factCount: 4,
  // #188/#194/#193 landed after this flow was written: the screen reads location, contact and the
  // languages question from every payload, so a fixture without them is contract-invalid.
  location: { area: null, workRights: null },
  contact: { phone: null, email: null },
  languagesQuestion: {
    questionId: 'eligibility-languages',
    question: "Which languages do you speak? Start typing — I'll suggest as you go.",
    consequence: null,
    options: ['English', 'Mandarin', 'Cantonese', 'Ask me later'],
    answer: null,
  },
  search: { role: 'IT project manager in Paris', family: null, siblingTitles: [], openJobs: null },
  domains: [
    {
      tag: 'experience',
      heading: 'Professional Experience',
      facts: [
        { id: 'e1', text: 'Managed a team of six engineers.', colour: 'gold', source: 'told' },
        {
          id: 'e2',
          text: 'Owned a seven-figure vendor budget while coordinating finance, procurement, and delivery.',
          colour: 'grey',
          source: 'read',
        },
        { id: 'e3', text: 'Led SAP cutover planning.', colour: 'grey', source: 'told' },
      ],
    },
    { tag: 'skill', heading: 'Skills', facts: [{ id: 's1', text: 'SQL.', colour: 'gold', source: 'told' }] },
  ],
};

let state = structuredClone(BASE_PROFILE);
let profileFails = false;        // make the NEXT GET /api/profile fail (refetch-failure path)
let targetsStatus = 200;
let targetsDelayMs = 0;

await page.route('**/api/sessions/me', (route) => route.fulfill({ json: { ok: true } }));
await page.route('**/api/profile', async (route) => {
  if (profileFails) { profileFails = false; await route.fulfill({ status: 500, json: { error: { message: 'nope' } } }); return; }
  await route.fulfill({ json: state });
});
await page.route('**/api/sessions/me/targets', async (route) => {
  if (targetsDelayMs) await new Promise((r) => setTimeout(r, targetsDelayMs));
  if (targetsStatus !== 200) { await route.fulfill({ status: targetsStatus, json: { error: { message: 'nope' } } }); return; }
  const body = route.request().postDataJSON();
  state = { ...state, search: { ...state.search, role: body.targetTitles[0] } };
  await route.fulfill({ json: { ok: true } });
});

const setState = (patch) => { state = { ...structuredClone(BASE_PROFILE), ...patch }; };
const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
const txt = async (sel) => ((await page.locator(sel).count()) ? (await page.locator(sel).first().innerText()).trim() : null);
// The screen is `position: fixed` and `.stage` is the scroller at <=899px — window scrolling is inert.
const scrollStage = (top) => page.evaluate((t) => { const s = document.querySelector('.stage'); if (s) s.scrollTop = t; }, top);
const stageMetrics = () => page.evaluate(() => {
  const s = document.querySelector('.stage');
  const r = document.querySelector('.rail');
  if (!s || !r) return null;
  return { scrollH: s.scrollHeight, clientH: s.clientHeight, railTop: r.offsetTop, railH: r.offsetHeight };
});
const ownerShot = async (name) => { await page.screenshot({ path: path.join(OWNER_SHOTS, name), fullPage: false }); await qa.note(`owner screenshot filed: ${name}`); };

// ==============================================================================================
// 1. Desktop (1280x800) — the two zones, the toggle, the hero.
// ==============================================================================================

await qa.goto('/profile', 'open the profile on a desktop browser');
await qa.expectVisible('.field', 'the field — the primary surface');
await qa.expectVisible('.rail', 'the right rail — the promise');

const side = await page.evaluate(() => {
  const f = document.querySelector('.field').getBoundingClientRect();
  const r = document.querySelector('.rail').getBoundingClientRect();
  return { sideBySide: r.left >= f.right - 2, sameTop: Math.abs(r.top - f.top) < 60, railW: Math.round(r.width) };
});
await assert(side.sideBySide && side.sameTop, `desktop: rail sits beside the field, not below it (rail ${side.railW}px wide)`);
await ownerShot('desktop-overview.png');

await qa.expectText('.pcount', '4 things', 'the hero counts what the person has told me');
await qa.expectText('.pwait', 'not on your CV yet', 'the hero carries the not-on-your-CV-yet framing (#335)');
await qa.scrollThrough('read the desktop screen top to bottom');

await qa.click('button[aria-label="Constellation"]', 'switch to the Constellation view');
await qa.expectVisible('.sky', 'the constellation renders');
await qa.expectVisible('.rail', 'the rail survives the view switch on desktop');
await qa.click('button[aria-label="Sorted"]', 'switch back to Sorted');
await qa.expectVisible('.sheetwrap', 'the sorted list is back');

// The pre-E5 empty shape: role as typed, the door, and nothing invented.
await qa.expectText('.rjob .rrole', 'IT project manager in Paris', 'the rail shows the role exactly as typed');
const invented = await page.evaluate(() => ({
  fam: document.querySelectorAll('.rjob .rfam').length,
  row: document.querySelectorAll('.rjob .rrow').length,
  tag: document.querySelectorAll('.rjob .rtag').length,
}));
await assert(invented.fam === 0 && invented.row === 0 && invented.tag === 0, 'family null: no family name, no siblings, no count invented anywhere');

// ==============================================================================================
// 2. The door — mouse, then keyboard-only, then Escape.
// ==============================================================================================

await qa.click('.rjob .rdoor', 'open the door: "Not the job you meant?"');
await qa.expectVisible('#role-again', 'the original role question re-opens');
const prefilled = await page.locator('#role-again').inputValue();
const focused = await page.evaluate(() => document.activeElement?.id === 'role-again');
const selected = await page.evaluate(() => { const i = document.activeElement; return i && i.selectionStart === 0 && i.selectionEnd === i.value.length; });
await assert(prefilled === 'IT project manager in Paris', 'the question is pre-filled with the previous answer');
await assert(focused && selected, 'focus lands in the input with the old answer selected, so typing replaces it');

await qa.fill('#role-again', 'D', 'type a single letter — below the two-character gate');
const gated = await page.locator('.rjob .rbtn').first().isDisabled();
await assert(gated, 'the primary button stays disabled under two characters');

await qa.press('#role-again', 'Escape', 'press Escape to back out');
await qa.expectVisible('.rjob .rdoor', 'the display state returns');
const backOnDoor = await page.evaluate(() => document.activeElement?.classList.contains('rdoor'));
await assert(backOnDoor, 'Escape returns focus to the door');
await qa.expectText('.rjob .rrole', 'IT project manager in Paris', 'backing out keeps the previous answer');

// Keyboard-only: Enter on the door, type, Enter to submit.
await page.locator('.rjob .rdoor').focus();
await qa.press('.rjob .rdoor', 'Enter', 'keyboard-only: open the door with Enter');
await qa.fill('#role-again', 'Delivery manager in Lyon', 'type the corrected role');
// Held open long enough that the driver's own human pacing cannot outrun the in-flight save.
targetsDelayMs = 6000;
await qa.press('#role-again', 'Enter', 'submit with Enter');
await qa.expectVisible('.rjob .rbusy', 'the saving line reads while the save is in flight');
await qa.expectText('.rjob .rbusy', 'Finding jobs like yours', 'the saving copy is the discovery flow’s own sentence');
targetsDelayMs = 0;
await qa.expectText('.rjob .rrole', 'Delivery manager in Lyon', 'the search updates to the new role');
const announced = await txt('.sr-only');
await assert(/Now searching Delivery manager in Lyon\./.test(announced ?? ''), 'the live region announces the new search');
const doorFocused = await page.evaluate(() => document.activeElement?.classList.contains('rdoor'));
await assert(doorFocused, 'focus returns to the door after a successful save');

// ==============================================================================================
// 3. Save-failure and save-succeeds-but-refetch-fails.
// ==============================================================================================

targetsStatus = 500;
await qa.click('.rjob .rdoor', 'open the door again');
await qa.fill('#role-again', 'Product manager in Berlin', 'type a role the server will refuse');
await qa.click('.rjob .rbtn >> nth=0', 'press "That’s me" against a failing server');
await qa.expectVisible('.rjob .rerr', 'the failure is reported');
await qa.expectText('.rjob .rerr', "Couldn't save that just now", 'the error asks for a retry, in plain words');
const errInk = await page.evaluate(() => getComputedStyle(document.querySelector('.rjob .rerr')).color);
const keptValue = await page.locator('#role-again').inputValue();
const errFocus = await page.evaluate(() => document.activeElement?.id === 'role-again');
await assert(keptValue === 'Product manager in Berlin', 'the typed value survives a failed save');
await assert(errFocus, 'focus stays in the input after a failure');
await qa.note(`error ink is ${errInk} (neutral HUD ink, not the gold used for on-CV emphasis)`);
targetsStatus = 200;
await qa.press('#role-again', 'Escape', 'back out of the failed question');

// The save lands but the refetch behind it falls over — the person must see the new role, never an error.
profileFails = true;
await qa.click('.rjob .rdoor', 'open the door once more');
await qa.fill('#role-again', 'Programme manager in Nantes', 'type a new role');
await qa.click('.rjob .rbtn >> nth=0', 'save while the profile refetch is about to fail');
await qa.expectText('.rjob .rrole', 'Programme manager in Nantes', 'a refetch failure still shows the role that really saved');
const falseError = await page.locator('.rjob .rerr').count();
await assert(falseError === 0, 'a refetch failure never reports a false save failure');

// ==============================================================================================
// 4. The E5 seam and the honest-null edges.
// ==============================================================================================

setState({ search: { role: 'IT project manager in Paris', family: 'IT Project Management', siblingTitles: ['Programme manager', 'Delivery manager'], openJobs: 42 } });
await qa.goto('/profile', 'reload with a payload carrying family, siblings and an open-jobs count');
await qa.expectText('.rjob .rfam', 'Part of IT Project Management.', 'the family displays when the payload carries one');
await qa.expectText('.rjob .rlabel', 'Also searching', 'the sibling titles are labelled');
await qa.expectText('.rjob .rsrc', '42 jobs open', 'the open-jobs count displays');
await qa.expectVisible('.rjob .rdoor', 'the door is still the last thing in the section');

setState({ search: { role: 'IT project manager in Paris', family: null, siblingTitles: [], openJobs: 1 } });
await qa.goto('/profile', 'reload with exactly one open job');
await qa.expectText('.rjob .rsrc', '1 job open', 'one job is singular, and reads "for this job right now"');

setState({ search: { role: null, family: null, siblingTitles: [], openJobs: null } });
await qa.goto('/profile', 'reload as someone who never answered the role question');
await qa.expectText('.rjob .rrole', "You haven't told me yet.", 'the never-answered state is honest, not blank');
await qa.expectText('.rjob .rdoor', 'What job are you looking for?', 'the door asks rather than offering a correction');
await qa.click('.rjob .rdoor', 'open the door with no previous answer');
const emptyPrefill = await page.locator('#role-again').inputValue();
await assert(emptyPrefill === '', 'nothing is pre-filled when there was no answer');
await qa.expectText('.rjob .rbtns', 'Not now', 'the cancel button reads "Not now" when there is nothing to keep');

// A role long enough to break a 320px rail.
const LONG = 'Senior interim transformation and delivery programme manager for regulated financial services in the Asia Pacific region';
setState({ search: { role: LONG, family: null, siblingTitles: [], openJobs: null } });
await qa.goto('/profile', 'reload with a very long role name');
const overflow = await page.evaluate(() => {
  const p = document.querySelector('.rjob');
  const r = document.querySelector('.rjob .rrole');
  return { panelOverflows: p.scrollWidth > p.clientWidth + 1, roleOverflows: r.scrollWidth > r.clientWidth + 1, lines: Math.round(r.getBoundingClientRect().height) };
});
await assert(!overflow.panelOverflows && !overflow.roleOverflows, `a long role wraps inside the rail instead of overflowing it (${overflow.lines}px tall)`);

// ==============================================================================================
// 5. The hero's copy branches — every one the spec's table names.
// ==============================================================================================

setState({ factCount: 24, domains: [{ tag: 'experience', heading: 'Professional Experience', facts: [...facts(18, 'gold', 'On-CV'), ...facts(6, 'grey', 'Saved')] }] });
await qa.goto('/profile', 'reload with 24 told / 18 on the CV — the ticket’s own numbers');
await qa.expectText('.pcount', "24 things you've told me", 'the headline number is everything the person told me');
await qa.expectText('.pwait', '18', 'the second number is what makes the CV right now');
await qa.expectText('.pwait', 'make your CV right now — your strongest selection', 'the split reads as selection, never rejection');
await qa.expectText('.pwait', 'The rest are not on your CV yet', 'the rest are not on the CV yet, not rejected');

setState({ factCount: 6, domains: [{ tag: 'skill', heading: 'Skills', facts: facts(6, 'grey', 'Saved') }] });
await qa.goto('/profile', 'reload with nothing on the CV yet (gold = 0)');
await qa.expectText('.pwait', 'None of them are on your CV yet', 'the zero branch does not print a bare 0, and keeps the framing');

setState({ factCount: 6, domains: [{ tag: 'skill', heading: 'Skills', facts: [...facts(1, 'gold', 'On-CV'), ...facts(5, 'grey', 'Saved')] }] });
await qa.goto('/profile', 'reload with exactly one fact on the CV');
await qa.expectText('.pwait', '1 makes your CV right now', 'one fact takes the singular verb');

setState({ factCount: 1, domains: [{ tag: 'skill', heading: 'Skills', facts: facts(1, 'gold', 'On-CV') }] });
await qa.goto('/profile', 'reload with a single stored fact, on the CV');
await qa.expectText('.pcount', "1 thing you've told me", 'the headline is singular for one fact');
await qa.expectText('.pwait', 'It makes your CV right now.', 'the one-and-only branch reads as a sentence');

setState({ factCount: 3, domains: [{ tag: 'skill', heading: 'Skills', facts: facts(3, 'gold', 'On-CV') }] });
await qa.goto('/profile', 'reload with everything on the CV');
await qa.expectText('.pwait', 'All 3 make your CV right now', 'nothing in reserve reads as "all"');

// The stored count and the displayed facts can disagree (factCount counts answers a "no" included).
setState({ factCount: 24, domains: [{ tag: 'skill', heading: 'Skills', facts: facts(18, 'gold', 'On-CV') }] });
await qa.goto('/profile', 'reload where the stored count (24) exceeds the facts on screen (18)');
const heroTop = await txt('.pcount');
const heroLine2 = await txt('.pwait');
await qa.note(`ADVERSARIAL: headline "${heroTop}" beside second line "${heroLine2}"`);
await assert(!/^All /.test(heroLine2 ?? ''), 'the hero never says "All 18" while the headline claims 24 told');

// ==============================================================================================
// 6. Plain international English, and no colour name anywhere the ticket controls.
// ==============================================================================================

setState({});
await qa.goto('/profile', 'reload the ordinary screen for a copy read');
const sortedCopy = await page.evaluate(() => document.querySelector('.jobdeck').innerText);
await qa.click('button[aria-label="Constellation"]', 'read the constellation view’s copy too');
const skyCopy = await page.evaluate(() => document.querySelector('.jobdeck').innerText);
await qa.click('button[aria-label="Sorted"]', 'back to Sorted');
await qa.click('.rjob .rdoor', 'open the door for its copy');
const doorCopy = await page.evaluate(() => document.querySelector('.jobdeck').innerText);
await qa.press('#role-again', 'Escape', 'close the door');
const allCopy = `${sortedCopy}\n${skyCopy}\n${doorCopy}`;
const banned = ['advert', 'hunt', 'leverage', 'reach out', 'circle back', 'low-hanging', 'moving the needle', 'nail it', 'game changer'];
const hits = banned.filter((w) => new RegExp(w, 'i').test(allCopy));
await assert(hits.length === 0, `no jargon or idioms on screen (checked: ${banned.join(', ')})`);
const headCopy = await page.evaluate(() => (document.querySelector('.phead')?.innerText ?? '') + '\n' + (document.querySelector('.dnote')?.innerText ?? '') + '\n' + (document.querySelector('.rail')?.innerText ?? ''));
await assert(!/\b(gold|grey|gray|amber|yellow)\b/i.test(headCopy), 'no colour name in the hero, the sorted note, or the rail');
await qa.note(`hero + note + rail copy read: ${JSON.stringify(headCopy)}`);

// The killed queue framing must survive nowhere.
await assert(!/when a job asks/i.test(allCopy), 'the dead "when a job asks" framing appears nowhere on the screen');
await qa.click('.frow.grey >> nth=0', 'open a saved fact to read its detail copy');
const detailCopy = await page.evaluate(() => document.querySelector('dialog.detail')?.innerText ?? '');
// #335 gave the not-yet-confirmed grey one caption everywhere ("Not on your CV yet."); "Kept for
// when a job needs it." now means only a line the person unticked.
await assert(
  /Not on your CV yet\./.test(detailCopy),
  'the detail sheet carries the not-on-your-CV-yet wording',
);
await assert(!/when a job asks/i.test(detailCopy), 'the detail sheet no longer says "when a job asks"');
await qa.press('dialog.detail', 'Escape', 'close the detail sheet');

// ==============================================================================================
// 7. Phone viewports — where the rail actually sits. Owner-deliverable screenshots.
// ==============================================================================================

for (const [w, h] of [[390, 844], [360, 800]]) {
  await page.setViewportSize({ width: w, height: h });
  await qa.goto('/profile', `open the profile on a ${w}x${h} phone`);

  const dir = await page.evaluate(() => getComputedStyle(document.querySelector('.stage')).flexDirection);
  await assert(dir === 'column', `${w}px: the field and rail stack in one column`);

  const m = await stageMetrics();
  await qa.note(`${w}x${h} Sorted: the rail begins ${m.railTop}px down a ${m.scrollH}px page in a ${m.clientH}px window — about ${Math.max(0, Math.round(((m.railTop - m.clientH) / m.clientH) * 100))}% of a screen below the fold`);
  await qa.scrollThrough('scroll the phone screen as a reader would');
  await scrollStage(999999);
  await page.waitForTimeout(600);
  await qa.expectVisible('.rjob .rdoor', `${w}px Sorted: the rail is reachable by scrolling — nothing is missing`);
  if (w === 390) await ownerShot('phone-sorted-rail.png');
  else await ownerShot('phone-360-sorted-rail.png');

  await scrollStage(0);
  await qa.click('button[aria-label="Constellation"]', `${w}px: switch to the Constellation view`);
  await page.waitForTimeout(800);
  const mc = await stageMetrics();
  await qa.note(`${w}x${h} Constellation: the rail begins ${mc.railTop}px down a ${mc.scrollH}px page in a ${mc.clientH}px window`);
  await scrollStage(999999);
  await page.waitForTimeout(600);
  await qa.expectVisible('.rjob .rdoor', `${w}px Constellation: the rail is still reachable below the sky`);
  await qa.expectVisible('.sky', `${w}px Constellation: the sky keeps its own height above the rail`);
  if (w === 390) await ownerShot('phone-constellation-rail.png');
  else await ownerShot('phone-360-constellation-rail.png');

  // The door under a thumb: #192 re-composed the phone screen (the rail leads, the facts open as a
  // pull-up sheet), so the phone door is driven end to end by profile-phone-sheet-journey.mjs —
  // this flow checks only that it is present and reachable at this width.
  await qa.expectVisible('.rjob .rdoor', `${w}px: the door is present and reachable in the stack`);
  const tap = await page.evaluate(() => { const b = document.querySelector('.rjob .rdoor'); const r = b.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width) }; });
  await qa.note(`${w}px: the door's own box measures ${tap.h}x${tap.w}px`);
}

// ==============================================================================================
// 8. Reduced motion — the screen must be complete without animation.
// ==============================================================================================

await page.setViewportSize({ width: 1280, height: 800 });
await page.emulateMedia({ reducedMotion: 'reduce' });
await qa.goto('/profile', 'open the profile with reduced motion switched on');
await qa.expectVisible('.rail', 'reduced motion: the rail is present');
await qa.expectVisible('.dom', 'reduced motion: the sorted list is present, not stuck at zero opacity');
const opacities = await page.evaluate(() => [...document.querySelectorAll('.dom')].map((e) => Number(getComputedStyle(e).opacity)));
await assert(opacities.every((o) => o > 0.99), 'reduced motion: every domain block is fully visible, none frozen mid-animation');
await qa.click('button[aria-label="Constellation"]', 'reduced motion: the constellation still draws');
await qa.expectVisible('.sky', 'reduced motion: the sky renders a static frame');
await page.emulateMedia({ reducedMotion: 'no-preference' });

const ok = await qa.finish();
console.log(`owner screenshots: ${path.resolve(OWNER_SHOTS)}`);
process.exit(ok ? 0 : 1);
