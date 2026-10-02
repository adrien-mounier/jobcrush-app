// #324 — "a non-answer is never stored as a fact about you", driven the way a person meets it.
//
// What this journey proves ON THE RENDERED SCREEN, against a real stack:
//   1. Each free-text checklist question offers "Not sure — skip" — she can decline without typing.
//   2. Pressing it closes the question: no CV line, no "Saved to your profile", the fact count does
//      not move, and nothing lands on her profile.
//   3. Typing "I don't know" behaves the same way (AC2).
//   4. Skipping still earns the reveal — the deck is reachable.
//   5. A REAL answer that merely starts with "Not sure…" is kept as her fact.
//   6. A fact already on her record (the owner's staging state) is removed by tapping its line and
//      pressing "Not sure — skip" — and it leaves her profile too (AC3's in-product route).
//
//   PORT=34324 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34324 npx next build && npx next start -p 34325
//   BASE_URL=http://127.0.0.1:34325 node apps/web/e2e/non-answer-skip-journey.mjs
//
// Ports are deliberately not 3000/3001 (SHARED_INFRA.md). Run serially: anonymous sessions and the
// magic-link sign-in are capped per IP.
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34325';
const ROLE = 'IT project manager';
const AREA = 'Singapore';
const STAKE = 'stakeholder-coordination';
const COMMS = 'delivery-communication';
const SKIP = 'Not sure — skip';
const SAVED = 'Saved to your profile — kept for when a job needs it.';
const NOTED = 'Noted — one less thing to ask.';
const REAL_NOT_SURE = 'Not sure which, but the CFO and IT';

const CV_TEXT = [
  'Marta Kowalska', 'marta.kowalska@example.com', 'Warsaw, Poland', '',
  'EXPERIENCE', '',
  'IT Project Manager, Nordic Retail Group, Warsaw — Mar 2018 - Present',
  '- Led the checkout replatforming and delivered it two months ahead of plan.',
  '- Managed a budget of EUR 1.2M across three vendor teams.', '',
  'Project Coordinator, Baltic Software House, Warsaw — Jun 2013 - Feb 2018',
  '- Coordinated a team of twelve engineers and two business analysts.', '',
  'EDUCATION', 'MSc Management Information Systems, University of Warsaw, 2013',
].join('\n');

const qa = await createSession('non-answer-skip-journey', { baseURL: BASE, viewport: { width: 1280, height: 900 } });
const { page } = qa;
page.setDefaultTimeout(20000);

let aborted = false;
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, async (e) => {
    console.error(`\n[${ev}]`, e?.stack ?? e);
    if (aborted) return;
    aborted = true;
    try { await qa.note(`RUN ABORTED (${ev}): ${e?.message ?? e}`); await qa.finish(); } catch {}
    process.exit(1);
  });
}

const assertTrue = (cond, note) => qa.expectText('body', cond ? '' : '-THIS-CANNOT-APPEAR-', note);
const json = async (path) => {
  const res = await page.request.fetch(`${BASE}/api${path}`);
  try { return await res.json(); } catch { return null; }
};
const state = () => json('/onboarding/discovery');
const profileText = async () => JSON.stringify(await json('/profile'));

async function walkIntoDiscovery(label) {
  await qa.frontDoorPaste(CV_TEXT, `${label}: she pastes her CV at the front door`);
  await qa.frontDoorContinueToIntent();
  await qa.fill('#target-role', ROLE, `the job she is going for: "${ROLE}"`);
  await qa.fill('#search-area', AREA, 'where she wants to work');
  await qa.click('button:has-text("Save and continue")', 'Save and continue');
  for (let i = 0; i < 60; i += 1) {
    const b = await json('/job-blocks');
    if (b?.blocks?.length) break;
    await page.waitForTimeout(500);
  }
  await qa.goto('/discovery', 'into discovery — the checklist');
  await page.waitForTimeout(2500);
  await qa.scrollThrough('read the discovery screen top to bottom');
}

/** Answer the checklist on screen. `freeText(itemId)` returns 'SKIP' to press the skip button, or
 *  the text to type. Option items get a positive option. Returns the ids asked, in order. */
async function answerChecklist(freeText) {
  const asked = [];
  for (let i = 0; i < 10; i += 1) {
    const s = await state();
    const next = (s?.questions ?? []).find((q) => !q.eligibility);
    if (!next) break;
    await page.locator('.opts button.opt, #floor-free').first().waitFor({ state: 'visible', timeout: 20000 });
    const opts = page.locator('.opts button.opt');
    if (await opts.count()) {
      let chosen = opts.first();
      for (let k = 0; k < (await opts.count()); k += 1) {
        if (!/^no[.!]?$/i.test((await opts.nth(k).innerText()).trim())) { chosen = opts.nth(k); break; }
      }
      await qa.click(chosen, `"${next.itemId}" — she presses "${(await chosen.innerText()).trim()}"`);
      await page.waitForTimeout(1500);
      asked.push(next.itemId);
      continue;
    }
    const before = s.factCount;
    const skipBtn = page.getByRole('button', { name: SKIP });
    await qa.expectVisible(skipBtn, `AC1 — "${next.itemId}" (free text) offers a visible "${SKIP}"`);
    const answer = freeText(next.itemId);
    if (answer === 'SKIP') {
      await qa.click(skipBtn, `she presses "${SKIP}" without typing anything`);
    } else {
      await qa.fill('#floor-free', answer, `she types "${answer}"`);
      await qa.click('.ask button.go', 'Continue');
    }
    await page.waitForTimeout(1800);
    const after = await state();
    const declined = answer === 'SKIP' || /know|^not sure$/i.test(answer);
    if (declined) {
      await assertTrue(!(await page.locator('body').innerText()).includes(SAVED),
        `"${next.itemId}": no "Saved to your profile" message after a non-answer`);
      await qa.expectVisible(page.locator('.notice', { hasText: NOTED }).first(), `"${next.itemId}": the screen says "${NOTED}"`);
      await assertTrue(!after.cvLines.some((l) => l.itemId === next.itemId),
        `"${next.itemId}": no CV line was written for the non-answer`);
      await assertTrue(after.factCount === before,
        `"${next.itemId}": the fact count did not go up (${before} -> ${after.factCount})`);
      await assertTrue(!(after.questions ?? []).some((q) => q.itemId === next.itemId),
        `"${next.itemId}": the question is closed — not asked again`);
    }
    asked.push(next.itemId);
  }
  return asked;
}

// ============================================================================================
// 1. Skip button on one free-text question, typed "I don't know" on the other.
// ============================================================================================
await walkIntoDiscovery('visitor A');
const askedA = await answerChecklist((id) => (id === STAKE ? 'SKIP' : id === COMMS ? "I don't know" : 'Weekly steering reports'));
await qa.note(`visitor A was asked: ${askedA.join(', ')}`);
await assertTrue(askedA.includes(STAKE) && askedA.includes(COMMS), 'both free-text checklist questions were asked');

await qa.goto('/discovery', 'back into discovery after answering');
await qa.scrollThrough('her written lines — no "I don\'t know" line, no "Not sure" line');
const bodyA = await page.locator('body').innerText();
await assertTrue(!/I don.t know|Not sure\./i.test(bodyA), 'the discovery page shows no "I don\'t know" / "Not sure" line');
const profA = await profileText();
await assertTrue(!/don.t know|not sure/i.test(profA), 'AC1/AC2 — her profile holds no "I don\'t know" / "Not sure" fact');
await qa.goto('/profile', 'her profile screen');
await qa.scrollThrough('read the profile');
await assertTrue(!/don.t know|not sure/i.test(await page.locator('body').innerText()), 'the profile screen shows neither non-answer');

const rec = (await json('/sessions/me'))?.discovery;
await assertTrue(rec?.checkpoint === 'essential_floor_covered',
  `skips still earn the reveal — checkpoint ${rec?.checkpoint}, covered ${JSON.stringify(rec?.coveredItemIds)}`);
await qa.goto('/deck', 'the reveal');
await qa.expectVisible('.jobdeck', 'she reaches the job deck after skipping');
await qa.scrollThrough('read the reveal');

// ============================================================================================
// 2. A fresh visitor: a real answer starting with "Not sure…" is kept; then a fact is removed by
//    correcting it to a skip (the owner's "I don't know." facts, shape-for-shape: a confirmed,
//    user-vouched discovery answer).
// ============================================================================================
await page.context().clearCookies();
await walkIntoDiscovery('visitor B');
await answerChecklist((id) => (id === STAKE ? REAL_NOT_SURE : 'Weekly steering decks for the board'));
const sB = await state();
const line = sB.cvLines.find((l) => l.itemId === STAKE);
await assertTrue(!!line && line.text.includes('CFO'), `a real answer starting "Not sure…" is kept as her fact: ${JSON.stringify(line?.text)}`);
const commsLine = sB.cvLines.find((l) => l.itemId === COMMS);
await assertTrue(!!commsLine, `her typed communication answer is a fact: ${JSON.stringify(commsLine?.text)}`);
const factsBefore = sB.factCount;

// Same page load, no reload: a line is correctable only if its question was asked this load
// (design-1b-spec §1) — a resumed line renders as plain text.
const lineBtn = page.locator(`button[data-item="${COMMS}"]`).first();
await qa.click(lineBtn, 'AC3 — she taps the written communication line to change it');
await qa.expectVisible(page.getByRole('button', { name: SKIP }), 'AC3 — the correction offers "Not sure — skip"');
await qa.click(page.getByRole('button', { name: SKIP }), 'she takes the fact back with "Not sure — skip"');
await page.waitForTimeout(2000);
const sB2 = await state();
await assertTrue(!sB2.cvLines.some((l) => l.itemId === COMMS), 'AC3 — the line is gone from her checklist');
await assertTrue(sB2.factCount <= factsBefore, `AC3 — the fact count did not grow (${factsBefore} -> ${sB2.factCount})`);
await assertTrue(!(sB2.questions ?? []).some((q) => q.itemId === COMMS), 'AC3 — and the question is not asked again');
await assertTrue(!/steering decks/i.test(await profileText()), 'AC3 — the fact is gone from her profile');
await assertTrue(!(await page.locator('body').innerText()).includes(SAVED), 'no "Saved to your profile" after the skip-correction');
await qa.scrollThrough('the checklist after the correction');

// Observation (not asserted): after a reload, her earlier lines are plain text, not tappable — an
// answer stored in an earlier visit cannot be corrected from this screen.
await qa.goto('/discovery', 'reload discovery — her earlier lines, from a previous visit');
await page.waitForTimeout(2000);
await qa.note(`after reload, tappable "${STAKE}" line buttons: ${await page.locator(`button[data-item="${STAKE}"]`).count()} (plain-text lines are not correctable)`);
await qa.scrollThrough('the resumed checklist');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
