// #283 closing slice (spec #279) — the OWNER ARBITRATION landing, driven as a human against a REAL
// full stack (real Fastify, real extract, real miner parse, real job-block store, real published
// vocabulary; only the MODEL is faked via apps/api/dist/qa-main.js, so the run is free).
//
// Why this exists beside job-blocks-industry-journey.mjs: that journey corrects to `it-services`,
// an industry the v2 publication never touched, so it would stay green if the two republished
// entries never reached a pixel. Healthcare and Education moved to VERSION 2 when the owner split
// the public-and-social group, and the correction door validates industryId AND version against the
// active list — so a screen still offering them at version 1 would 400 on the only lever she has,
// while the card looked fine for a moment (#282's own QA finding, in a new disguise).
//
// The journey: paste a CV -> open the work-history check -> open the correction panel on the job the
// labeler could not place -> prove Healthcare and Education are each offered ONCE (two publications,
// one list) -> correct to Healthcare, prove VERSION 2 is what travels and the server accepts it ->
// reload and prove it stuck -> do it again for Education.
//
// Run it:
//   OPS_KEY=qa-ops-key PORT=34901 node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34901 npx next build && npx next start -p 3400
//   BASE_URL=http://127.0.0.1:3400 node apps/web/e2e/industry-vocabulary-v2-journey.mjs

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

const qa = await createSession('industry-vocabulary-v2-journey', {
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

/** Walk the deck until the card in front of her names this employer. Skips rather than confirms. */
async function walkTo(employer) {
  for (let i = 0; i < 6; i++) {
    if ((await cardText()).includes(employer)) return true;
    await swipe('left', `not ${employer} yet — she skips this one for now`);
  }
  return (await cardText()).includes(employer);
}

const deck = () =>
  page.evaluate(async () => {
    const r = await fetch('/api/job-blocks', { credentials: 'same-origin' });
    return r.json();
  });

/** Open the correction panel on the Baltic Systems card, from a freshly loaded deck. */
async function openCorrectionPanel(jobId) {
  await qa.goto(`${BASE}/job-blocks/${jobId}`, 'she opens the work-history check');
  await qa.expectVisible('.jb-card', 'the confirm deck opens');
  await verdict(await walkTo('Baltic Systems'), 'the deck reaches the job at Baltic Systems');
  await qa.click('.jb-card', 'she taps the card to put the industry right');
  await qa.expectVisible('.jb-back', 'the correction panel opens');
  await qa.scrollThrough('she reads the whole correction panel before touching anything');
  await qa.expectVisible('#jb-industry', 'the industry is offered back for correction');
}

/**
 * Pick one industry, save, and prove BOTH halves: the version her browser sent, and the status the
 * server answered with. A green screen is not evidence the server accepted it.
 */
async function correctTo(industryId, label, expectedVersion) {
  const correctRequest = page.waitForRequest(
    (r) => /\/api\/job-blocks\/.+\/correct$/.test(r.url()) && r.method() === 'POST',
    { timeout: 20000 },
  );
  const correctResponse = page.waitForResponse(
    (r) => /\/api\/job-blocks\/.+\/correct$/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 20000 },
  );
  await page.locator('#jb-industry').selectOption(industryId);
  await qa.expectVisible('#jb-industry', `she picks ${label} from the published list`);
  await page.waitForTimeout(800);
  await qa.click(page.getByRole('button', { name: /Save and continue/i }), 'and saves the correction');

  const sent = JSON.parse((await correctRequest).postData() ?? '{}');
  await qa.note(`what her browser actually sent: ${JSON.stringify(sent)}`);
  await verdict(
    sent.key === 'industry' && sent.value?.industryId === industryId && sent.value?.version === expectedVersion,
    `the screen sends ${label} at VERSION ${expectedVersion} — the republished entry, not the superseded one`,
  );

  const status = (await correctResponse).status();
  await qa.note(`the server answered the correction with HTTP ${status}`);
  await verdict(
    status === 200,
    `the server ACCEPTED ${label}@${expectedVersion} — no unknown_industry 400 on the only lever she has`,
  );
  await page.waitForTimeout(1200);
  await verdict(
    (await page.locator('p.error[role="alert"]').count()) === 0,
    'and she is shown no error',
  );
}

// -------------------------------------------------------------------------------------------
// 1. She brings her CV in through the front door.
// -------------------------------------------------------------------------------------------
const jobId = await qa.frontDoorPaste(CV_TEXT, 'she pastes a CV with two dated jobs and a degree on the front door');
await qa.waitForJobDone(jobId);

// -------------------------------------------------------------------------------------------
// 2. The republished words are each offered ONCE — two publications, one closed list.
// -------------------------------------------------------------------------------------------
await openCorrectionPanel(jobId);

const options = await page
  .locator('#jb-industry option')
  .evaluateAll((os) => os.map((o) => ({ value: o.value, text: (o.textContent || '').trim() })));
await qa.note(`the picker offers: ${options.map((o) => o.value || '(readout)').join(', ')}`);
await verdict(
  options.length === 16,
  'the picker offers exactly the 15 published industries plus the honest readout — the split added a GROUP, never a word',
);
await verdict(
  options.filter((o) => o.value === 'healthcare').length === 1,
  'Healthcare appears exactly once, not once per publication',
);
await verdict(
  options.filter((o) => o.value === 'education').length === 1,
  'Education appears exactly once, not once per publication',
);
await verdict(
  options.find((o) => o.value === 'healthcare')?.text === 'Healthcare' &&
    options.find((o) => o.value === 'education')?.text === 'Education',
  'and both still read by the same published names she saw before the split',
);

// -------------------------------------------------------------------------------------------
// 3. Healthcare — the first of the two entries the owner's ruling republished.
// -------------------------------------------------------------------------------------------
await correctTo('healthcare', 'Healthcare', 2);

await qa.goto(`${BASE}/job-blocks/${jobId}`, 'she reloads the work-history check');
let afterReload = await deck();
let baltic = afterReload.blocks.find((b) => b.employer.value === 'Baltic Systems');
await qa.note(`Baltic Systems reads back as: ${JSON.stringify(baltic.industry.value)}`);
await verdict(
  baltic.industry.value?.outcome === 'confirmed' &&
    baltic.industry.value.industries[0].industryId === 'healthcare' &&
    baltic.industry.value.industries[0].version === 2 &&
    baltic.industry.value.industries[0].confidence === 'certain',
  'her Healthcare answer survived the reload, stored at version 2 and certain',
);

// It reaches a PIXEL, not only the wire: bring the card back the way the product's own undo does.
await page.evaluate(
  (id) => fetch(`/api/job-blocks/${id}/unconfirm`, { method: 'POST', credentials: 'same-origin' }),
  baltic.id,
);
await qa.goto(`${BASE}/job-blocks/${jobId}`, 'and looks at the Baltic Systems card again');
await verdict(await walkTo('Baltic Systems'), 'the deck reaches the corrected card');
await qa.expectText('.jb-card .jb-industry', 'Industry: Healthcare', 'the card now states Healthcare, by its published name');
await qa.scrollThrough('she reads the corrected card top to bottom');

// -------------------------------------------------------------------------------------------
// 4. Education — the other half of the split, which moved for the same ruling.
// -------------------------------------------------------------------------------------------
await openCorrectionPanel(jobId);
await correctTo('education', 'Education', 2);

await qa.goto(`${BASE}/job-blocks/${jobId}`, 'she reloads once more');
afterReload = await deck();
baltic = afterReload.blocks.find((b) => b.employer.value === 'Baltic Systems');
await qa.note(`Baltic Systems now reads back as: ${JSON.stringify(baltic.industry.value)}`);
await verdict(
  baltic.industry.value?.outcome === 'confirmed' &&
    baltic.industry.value.industries[0].industryId === 'education' &&
    baltic.industry.value.industries[0].version === 2,
  'her Education answer survived too, stored at version 2',
);

// -------------------------------------------------------------------------------------------
// 5. The untouched 13 did not move with them.
// -------------------------------------------------------------------------------------------
const nordic = afterReload.blocks.find((b) => b.employer.value === 'Nordic Retail Group');
await qa.note(`the placed job reads back as: ${JSON.stringify(nordic.industry.value)}`);
await verdict(
  nordic.industry.value?.outcome === 'confirmed' &&
    nordic.industry.value.industries[0].industryId === 'retail-and-consumer' &&
    nordic.industry.value.industries[0].version === 1,
  'the job the labeler placed itself still carries retail-and-consumer at version 1 — the republish moved only the two entries the ruling named',
);

await qa.finish();
