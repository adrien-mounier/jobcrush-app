// #231 (labeler slice 2b, ADR-0014 amendment 1) — "nobody is asked what kind of work a job was".
//
// The headline user-visible change of #231 is a REMOVAL: #221's end-of-deck "What kind of work were
// these?" panel is gone. A removal is exactly the kind of change a payload test cannot prove — every
// server-side assertion can pass while the question is still on the screen (the #162 lesson). So
// this journey drives the real screen and asserts the ABSENCE, in the two states where the panel
// used to appear, and proves the deck still completes with all four of its controls.
//
// Two phases, deliberately:
//   A. REAL STACK — real Fastify, real extract/miner, real job-block store, real labeling step; only
//      the MODEL is faked (apps/api/dist/qa-main.js), so the run is free and deterministic. Exactly
//      one family is published in production today, so this phase covers the jobs the machine could
//      NOT place — the case that used to raise the panel for every visitor.
//   B. TWO-FAMILY DECK — a second family cannot be published in production yet (#232), so the one
//      state the real stack cannot reach is route-mocked at the deck endpoint: a job placed in TWO
//      families, beside an unplaced one and a never-labeled one. The screen is the real screen; only
//      the deck payload is injected.
//
// Run it (same stack as job-blocks-confirm-journey.mjs):
//   OPS_KEY=qa-ops-key PORT=34877 node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34877 npx next build && npx next start -p 34878
//   BASE_URL=http://127.0.0.1:34878 node apps/web/e2e/job-blocks-no-family-question-journey.mjs

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

const qa = await createSession('job-blocks-no-family-question-journey', {
  baseURL: BASE,
  viewport: { width: 1440, height: 950 },
});
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

/** The deck as the SERVER sees it — same cookie, same route the screen calls. */
const deck = () => page.evaluate(() => fetch('/api/job-blocks').then((r) => r.json()));
const familyOf = (d, title) => d.blocks.find((b) => b.title.value === title)?.family;

/** Every way #221's panel could still be on the screen. Asserted as a set so a partial removal
 *  (the heading gone, the buttons left) cannot pass. */
async function noFamilyQuestionAnywhere(where) {
  const body = (await page.locator('body').textContent()) || '';
  await verdict((await page.locator('.jb-familyask').count()) === 0,
    `${where}: the family-question panel is not on the screen at all`);
  await verdict(!/what kind of work/i.test(body),
    `${where}: nobody is asked "what kind of work" — the question itself is gone`);
  await verdict(!/couldn't place this one|could be either of these/i.test(body),
    `${where}: no job is told back to her as one the machine could not place`);
  await verdict(!/never guess one for you/i.test(body),
    `${where}: the panel's reassurance line is gone with it`);
  const buttons = await page.locator('button').allTextContents();
  await verdict(!buttons.some((b) => /it-project-delivery|product-management|IT project delivery|Product management/i.test(b)),
    `${where}: there is no family to choose — not one family button on the screen`);
}

// #260 rename caveat — READ BEFORE WIDENING THESE REGEXES.
// The delivery family is now labelled "IT Project Manager" and the analyst family "Business
// Analyst". Both are ordinary job titles, and this journey's own canned CV has a job titled
// "IT Project Manager" (the card legitimately reads "You were IT Project Manager at Nordic Retail
// Group"). So a leak check that hunts the NEW label cannot distinguish a family-label leak from the
// visitor's own job title — it either fires on her own CV (a false red) or proves nothing.
// What these checks hunt instead is what can ONLY be a family label on this screen: the family IDs,
// the word "family" itself, the OLD labels (still distinctive), and "Product management". That is a
// real hole, recorded rather than papered over: a leak of the exact string "IT Project Manager"
// onto a job card would not be caught here. family-role-name-journey.mjs and
// job-blocks-family.spec.ts carry the id-based checks that do bite.
const FAMILY_LABEL_LEAK = /family|it-project-delivery|product-management|IT project delivery|Product management|kind of work/i;

// =============================================================================================
// PHASE A — the real stack: jobs the machine could NOT place.
// =============================================================================================
await qa.goto(`${BASE}/paste`, 'the person opens the paste screen');
await qa.fill('textarea[aria-label="Your CV text"]', CV_TEXT, 'pastes a CV with two dated jobs and a degree');
await qa.click('button:has-text("Use this text")', 'hands it over');
await page.waitForURL('**/preview/**', { timeout: 120000 });
await qa.scrollThrough('reads down the watermarked draft while the pipeline finishes');
await qa.click('a:has-text("Confirm my facts")', 'takes the "Confirm my facts" door');
await page.waitForURL('**/job-blocks/**', { timeout: 30000 });
await qa.expectVisible('.jb-card', 'the work-history review screen opens on the first card');
await qa.scrollThrough('reads the whole screen once');

const before = await deck();
await qa.note(`the deck carries ${before.blocks.length} blocks`);
await verdict(before.families === undefined,
  'the deck no longer ships a list of families to choose from — nothing asks, so nothing needs it (#231 AC7)');

const pm = familyOf(before, 'IT Project Manager');
const coord = familyOf(before, 'Project Coordinator');
await qa.note(`"IT Project Manager" placement: ${JSON.stringify(pm?.value)}`);
await qa.note(`"Project Coordinator" placement: ${JSON.stringify(coord?.value)}`);
await verdict(pm?.value?.schemaVersion === '2' && Array.isArray(pm?.value?.families) && !!pm?.value?.confidence,
  'a placed job carries the new shape: a LIST of families and an ordinal confidence (#231 AC1/AC5)');
await verdict(coord?.value?.outcome === 'unmapped',
  'the job no published family covers is honestly unmapped — the case that used to raise the question');

// ---- the card itself: it states the KIND, and says nothing about a family (#231 AC7's second half)
const cardText = (await page.locator('.jb-card').textContent()) || '';
await qa.expectText('.jb-card', 'put this down as', 'the card states the kind of record this is, as it always has');
await verdict(/put this down as\s*a job/i.test(cardText.replace(/\s+/g, ' ')),
  'and for a dated job it says plainly "we\'ve put this down as a job"');
await verdict(!FAMILY_LABEL_LEAK.test(cardText),
  'the card says nothing about a job family — not the word, not a family name (#231 AC7)');

// ---- the deck still works: skip, undo, correct, confirm ------------------------------------
await noFamilyQuestionAnywhere('mid-deck, on the first card');

await qa.click('.jb-cbtn.neutral', 'she skips the first card for now');
await page.waitForTimeout(800);
await qa.expectVisible('.jb-undo', 'the deck offers her an undo, as it always did');
await qa.expectText('.jb-undo', 'Skipped', 'and it tells her plainly what it will undo');
await qa.click('.jb-undo button', 'she changes her mind and undoes the skip');
await page.waitForTimeout(800);
await qa.expectVisible('.jb-card', 'the card comes back — undo still works');

await qa.click('.jb-cbtn.fix', 'she opens the card to put something right');
await qa.expectVisible('.jb-back', 'the correction panel opens');
await qa.fill('#jb-employer', 'Nordic Retail Group AB', 'she corrects the employer name');
await qa.click('button:has-text("Save and continue")', 'and saves it');
await page.waitForTimeout(1500);
await verdict((await page.locator('.jb-back').count()) === 0,
  'the correction saved and the panel closed — correcting still works');

let cards = 0;
while ((await page.locator('.jb-card').count()) > 0 && cards < 8) {
  await noFamilyQuestionAnywhere(`mid-deck, card ${cards + 1}`);
  await qa.click('.jb-cbtn.yes', `she reads the next card and says "that's right"`);
  await page.waitForTimeout(700);
  cards += 1;
}
await qa.note(`she checked ${cards} more cards; the deck is done`);

// ---- END OF DECK: where #221's panel used to be -------------------------------------------
await qa.expectVisible('.jb-done', 'the deck completes and lands on its end state');
await qa.scrollThrough('she reads the whole end-of-deck screen');
await qa.expectText('.jb-done', "That's your history straight", 'it closes with the summary, and nothing else');
await noFamilyQuestionAnywhere('at the end of the deck, with an unplaced job in her history');
await qa.expectVisible('button:has-text("Continue")', 'the only thing left to do is continue — no question stands between her and the deck');

const stillUnplaced = familyOf(await deck(), 'Project Coordinator');
await qa.note(`the unplaced job after the whole deck: ${JSON.stringify(stillUnplaced?.value)}`);
await verdict(stillUnplaced?.value?.outcome === 'unmapped' && stillUnplaced?.origin?.kind === 'worked_out',
  'the job it could not place is simply left unplaced — never guessed at, and never asked about');

// =============================================================================================
// PHASE B — a job placed in TWO families. Only the deck payload is injected; the screen is real.
// =============================================================================================
const decision = (id, value) => ({
  id, value, origin: { kind: 'read', source_quote: 'from the CV' }, machine_touch: 'verbatim', classification: 'Verified',
});
const block = (id, title, employer, family, confirmed) => ({
  id,
  kind: 'job',
  countsTowardExperience: true,
  employer: decision(`${id}:employer`, employer),
  title: decision(`${id}:title`, title),
  start: decision(`${id}:start`, { year: 2019, month: 1, precision: 'month' }),
  end: decision(`${id}:end`, { state: 'ended', date: { year: 2022, month: 3, precision: 'month' } }),
  kindDecision: decision(`${id}:kind`, 'job'),
  family: { id: `${id}:family`, value: family, origin: { kind: 'worked_out' }, machine_touch: null, classification: null },
  confirmed,
  matchState: 'new',
  candidateBlockIds: [],
});

const DUAL = block('acme-lead', 'Product Owner / Delivery Lead', 'Acme', {
  schemaVersion: '2',
  outcome: 'confirmed',
  families: [
    { familyId: 'it-project-delivery', version: 2 },
    { familyId: 'product-management', version: 2 },
  ],
  confidence: 'likely',
}, true);
const UNPLACED = block('cafe-baker', 'Pastry Chef', 'Café Nord', { schemaVersion: '2', outcome: 'unmapped' }, true);
const UNLABELED = block('baltic-coord', 'Project Coordinator', 'Baltic', null, true);
const INJECTED = [DUAL, UNPLACED, UNLABELED];

const familyCorrections = [];
await page.route('**/api/job-blocks/*/correct', (route) => {
  familyCorrections.push(route.request().url());
  return route.fulfill({ json: { ok: true, held: [], downstream: '' } });
});
await page.route('**/api/job-blocks', (route) =>
  route.fulfill({
    json: {
      blocks: INJECTED,
      summary: { totalBlocks: 3, confirmedBlocks: 3, read: { status: 'ok', blocksFound: 3 } },
    },
  }),
);

await qa.note('a history the real stack cannot produce yet is injected at the deck endpoint: one job placed in TWO families, one the machine could not place, one it never labeled at all');
await qa.goto(page.url(), 'she reloads her work history');
await page.waitForTimeout(1500);
await qa.expectVisible('.jb-done', 'every block is already checked, so the deck lands straight on its end state');
await qa.scrollThrough('she reads the end-of-deck screen again — this time with a two-family job in her history');
await noFamilyQuestionAnywhere('at the end of the deck, with a TWO-FAMILY job and an unplaced job');
await verdict(familyCorrections.length === 0,
  'and the screen sent no family answer of its own accord — there is nothing on it that could');

const doneText = (await page.locator('.jb-done').textContent()) || '';
await qa.note(`the whole end-of-deck panel reads: "${doneText.replace(/\s+/g, ' ').trim()}"`);
await verdict(!FAMILY_LABEL_LEAK.test(doneText),
  'the two families the machine chose are never named to her — the placement is internal, as amendment 1 decided');

// ---- and the card for a two-family job still says nothing about families --------------------
await page.unroute('**/api/job-blocks');
await page.route('**/api/job-blocks', (route) =>
  route.fulfill({
    json: {
      blocks: [{ ...DUAL, confirmed: false }],
      summary: { totalBlocks: 1, confirmedBlocks: 0, read: { status: 'ok', blocksFound: 1 } },
    },
  }),
);
await qa.goto(page.url(), 'she comes back to a two-family job she has not checked yet');
await page.waitForTimeout(1500);
await qa.expectVisible('.jb-card', 'the card for the two-family job is shown');
await qa.scrollThrough('she reads the card');
const dualCard = (await page.locator('.jb-card').textContent()) || '';
await qa.note(`the two-family job's card reads: "${dualCard.replace(/\s+/g, ' ').trim().slice(0, 300)}"`);
await qa.expectText('.jb-card', 'put this down as', 'it states the kind, exactly as for any other job');
await verdict(!FAMILY_LABEL_LEAK.test(dualCard),
  'and it says nothing whatsoever about the two families it was placed in (#231 AC7)');
await noFamilyQuestionAnywhere('on the card of a job placed in two families');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
