// #281 (spec #279) — the SEVENTH fact, driven as a human against a REAL full stack (real Fastify,
// real extract, real miner parse, real job-block store, real industry labeler; only the MODEL is
// faked via apps/api/dist/qa-main.js, so the run is free and deterministic).
//
// The journey: paste a CV on the front door (#271) -> the work-history check -> read the industry
// beside the employer on a job the labeler PLACED -> skip on to a job it honestly could NOT place
// and read the plain "we couldn't work this out" -> tap that card, correct the industry from the
// published list, save -> reload and prove the correction survived, on the wire AND on the screen.
// Throughout: hunt for any place a person is ASKED which industry a job was in (AC11) — there must
// be none.
//
// Run it:
//   OPS_KEY=qa-ops-key pnpm --filter @jobcrush/api start:qa          # fake-model API on 34101
//   API_URL=http://127.0.0.1:34101 pnpm --filter @jobcrush/web build && pnpm --filter @jobcrush/web start
//   BASE_URL=http://127.0.0.1:3000 node apps/web/e2e/job-blocks-industry-journey.mjs

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

const CV_TEXT = [
  'Maria Kowalski',
  'maria.kowalski@example.com',
  'Warsaw, Poland',
  '',
  'EXPERIENCE',
  '',
  'IT Project Manager, Nordic Retail Group, Warsaw — Mar 2021 - Present',
  '- Led the checkout replatforming and delivered it two months ahead of plan.',
  '',
  'Project Coordinator, Baltic Systems, Warsaw — Jun 2017 - Feb 2021',
  '- Coordinated a team of twelve engineers and two business analysts.',
  '',
  'EDUCATION',
  'MSc Management Information Systems, University of Warsaw, 2017',
].join('\n');

const qa = await createSession('job-blocks-industry-journey', {
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

const card = () => page.locator('.jb-card');
const cardText = async () => ((await card().textContent()) || '').replace(/\s+/g, ' ').trim();

/** A human swipe: press on the card, drag past the 90px commit threshold, release. */
async function swipe(dir, note) {
  const box = await card().boundingBox();
  const y = box.y + Math.min(120, box.height / 2);
  const x0 = box.x + box.width / 2;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x0 + (dir === 'right' ? 1 : -1) * i * 20, y, { steps: 3 });
  await qa.note(note);
  await page.mouse.up();
  await page.waitForTimeout(1200);
}

/** Walk the deck until the card in front of her names this employer. Skips (left swipe) rather than
 *  confirms, so nothing is decided just to get somewhere. */
async function walkTo(employer) {
  for (let i = 0; i < 6; i++) {
    if ((await cardText()).includes(employer)) return true;
    await swipe('left', `not ${employer} yet — she skips this one for now`);
  }
  return (await cardText()).includes(employer);
}

/** The deck, read straight off the API in her own browser session. */
const deck = () =>
  page.evaluate(async () => {
    const r = await fetch('/api/job-blocks', { credentials: 'same-origin' });
    return r.json();
  });

// -------------------------------------------------------------------------------------------
// 1. She brings her CV in through the front door, and the read finishes.
// -------------------------------------------------------------------------------------------
const jobId = await qa.frontDoorPaste(CV_TEXT, 'she pastes a CV with two dated jobs and a degree on the front door');
await qa.waitForJobDone(jobId);
await qa.goto(`${BASE}/job-blocks/${jobId}`, 'opens the work-history check for that read');
await qa.expectVisible('.jb-card', 'the confirm deck opens on the first card');
await qa.scrollThrough('reads the whole screen once, card and progress panel');

// -------------------------------------------------------------------------------------------
// 2. AC4 (placed) — the industry is stated beside the employer, by its published NAME.
// -------------------------------------------------------------------------------------------
await verdict(await walkTo('Nordic Retail Group'), 'the deck reaches the job at Nordic Retail Group');
await qa.expectText('.jb-card', 'Nordic Retail Group', 'the card names the employer');
await qa.expectVisible('.jb-card .jb-industry', 'and states the industry right beside it');
await qa.expectText('.jb-card .jb-industry', 'Industry: Retail and consumer', 'by its published name, not its id');
const placedAttr = await page.locator('.jb-card .jb-industry').getAttribute('data-placed');
await verdict(placedAttr === 'true', 'the industry line is marked as a real placement');
await qa.scrollThrough('she reads the placed card top to bottom');

// AC11 — nothing on this card asks her anything about industries.
const cardCopy = (await cardText()).toLowerCase();
await verdict(
  !/which industry|what industry was|tell us .*industry|is this right\?.*industry/.test(cardCopy),
  'nothing on the placed card asks her which industry it was',
);
await verdict(
  (await page.locator('#jb-industry').count()) === 0,
  'no industry control is put in front of her until she opens a correction herself',
);

// -------------------------------------------------------------------------------------------
// 3. AC4 (unplaced) — the honest "we couldn't work this out", never the nearest industry.
// -------------------------------------------------------------------------------------------
await swipe('left', 'she skips the retail job for now and moves on');
await verdict(await walkTo('Baltic Systems'), 'the deck reaches the job at Baltic Systems');
await qa.expectText('.jb-card', 'Baltic Systems', 'the card names the employer');
await qa.expectText(
  '.jb-card .jb-industry',
  "We couldn't work out what industry this was",
  'and says plainly that we could not place it',
);
const unplacedAttr = await page.locator('.jb-card .jb-industry').getAttribute('data-placed');
await verdict(unplacedAttr === 'false', 'the unplaced line is marked as such');
const unplacedCopy = await cardText();
await verdict(
  !/Banking|Consulting|IT services|Retail and consumer|Software|Manufacturing/.test(unplacedCopy),
  'no nearest-industry guess is borrowed onto a job we could not place',
);
await qa.scrollThrough('she reads the honest gap in full');

// -------------------------------------------------------------------------------------------
// 4. AC5 — she corrects it, from the published list, and only from it.
// -------------------------------------------------------------------------------------------
await qa.click('.jb-card', 'she taps the card to put it right');
await qa.expectVisible('.jb-back', 'the correction panel opens');
await qa.scrollThrough('she reads the whole correction panel before touching anything');
await qa.expectVisible('#jb-industry', 'the industry is offered back for correction');
await qa.expectText('.jb-back', 'We work this out from your CV rather than asking you', 'stated, never asked');

const optionCount = await page.locator('#jb-industry option').count();
await qa.note(`the picker offers ${optionCount} entries (the 15 published industries + the "we couldn't work this one out" readout)`);
await verdict(optionCount === 16, 'the picker offers exactly the published vocabulary plus the honest readout');
const optionValues = await page.locator('#jb-industry option').evaluateAll((os) => os.map((o) => o.value));
await verdict(optionValues[0] === '', 'the first entry is the readout of "we could not place this", not a choice');

const correctRequest = page.waitForRequest(
  (r) => /\/api\/job-blocks\/.+\/correct$/.test(r.url()) && r.method() === 'POST',
  { timeout: 20000 },
);
await page.locator('#jb-industry').selectOption('it-services');
await qa.expectVisible('#jb-industry', 'she picks IT services from the published list');
await page.waitForTimeout(800);
await qa.click(page.getByRole('button', { name: /Save and continue/i }), 'and saves the correction');
const sent = JSON.parse((await correctRequest).postData() ?? '{}');
await qa.note(`what her browser actually sent: ${JSON.stringify(sent)}`);
await verdict(
  sent.key === 'industry' && sent.value?.industryId === 'it-services' && sent.value?.version === 1,
  'a published industry reference is what travels — never free text',
);
await page.waitForTimeout(1200);

// -------------------------------------------------------------------------------------------
// 5. AC5 — it stuck: on the wire, and then on the screen after a full reload.
// -------------------------------------------------------------------------------------------
await qa.goto(`${BASE}/job-blocks/${jobId}`, 'she reloads the work-history check');
const afterReload = await deck();
const baltic = afterReload.blocks.find((b) => b.employer.value === 'Baltic Systems');
await qa.note(`Baltic Systems reads back as: ${JSON.stringify(baltic.industry)}`);
await verdict(
  baltic.industry.value?.outcome === 'confirmed' &&
    baltic.industry.value.industries[0].industryId === 'it-services' &&
    baltic.industry.value.confidence === 'certain',
  'her correction survived the reload, stored as certain',
);
await verdict(
  baltic.industry.origin.kind === 'corrected' &&
    JSON.stringify(baltic.industry.origin.supersededValue) === JSON.stringify({ schemaVersion: '1', outcome: 'unmapped' }),
  "her answer supersedes the machine's without erasing it",
);

// AC3 — the degree was never labeled, and never paid for.
const degree = afterReload.blocks.find((b) => b.employer.value === 'University of Warsaw');
await qa.note(`the degree reads back as: kind=${degree.kind}, industry=${JSON.stringify(degree.industry.value)}`);
await verdict(degree.industry.value === null, 'the degree carries no industry at all');
const nordic = afterReload.blocks.find((b) => b.employer.value === 'Nordic Retail Group');
await verdict(
  nordic.industry.value?.outcome === 'confirmed' &&
    nordic.industry.value.industries[0].industryId === 'retail-and-consumer',
  'the placed job still carries the industry the labeler worked out',
);

// Bring the corrected card back the way the product's own undo does, so the CORRECTION is read
// off the screen and not only off the wire.
await page.evaluate(
  (id) => fetch(`/api/job-blocks/${id}/unconfirm`, { method: 'POST', credentials: 'same-origin' }),
  baltic.id,
);
await qa.goto(`${BASE}/job-blocks/${jobId}`, 'and looks at the Baltic Systems card again');
await verdict(await walkTo('Baltic Systems'), 'the corrected card is back in front of her');
await qa.expectText('.jb-card .jb-industry', 'Industry: IT services', 'and it now reads back HER answer on the screen');
await qa.scrollThrough('she reads the corrected card in full');

// -------------------------------------------------------------------------------------------
// 6. AC11 — the whole deck, walked end to end, asks no industry question anywhere.
// -------------------------------------------------------------------------------------------
let askedAnywhere = false;
for (let i = 0; i < 5; i++) {
  const body = ((await page.locator('body').textContent()) || '').toLowerCase();
  if (/which industry|what industry was (this|your)|what industry were you/.test(body)) askedAnywhere = true;
  await qa.click('.jb-card', 'she opens the correction panel on this card too');
  await page.waitForTimeout(600);
  if (await page.locator('.jb-back').count()) {
    const panel = ((await page.locator('.jb-back').textContent().catch(() => '')) || '').toLowerCase();
    if (/which industry|what industry was (this|your)/.test(panel)) askedAnywhere = true;
    const cancel = page.getByRole('button', { name: /^Cancel$/i });
    if (await cancel.count()) await qa.click(cancel.first(), 'and closes it again without deciding');
    await page.waitForTimeout(600);
  }
  if ((await card().count()) === 0) break;
  await swipe('right', 'she confirms this card and moves on');
  if ((await card().count()) === 0) break;
}
await verdict(!askedAnywhere, 'nowhere in the whole deck is she asked which industry a job was in');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
