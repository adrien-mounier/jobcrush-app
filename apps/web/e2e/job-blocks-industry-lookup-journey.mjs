// #282 (spec #279, ADR-0014 amendment 3) — the SECOND evidence source, driven as a human against a
// REAL full stack (real Fastify, real extract, real miner parse, real job-block store, real industry
// labeler; only the MODEL and the employer lookup are canned via apps/api/dist/qa-main.js, so the
// run is free and deterministic).
//
// This flow is the twin of job-blocks-industry-journey.mjs, and deliberately not a copy of it. That
// one proves the FACT exists and can be corrected. This one proves the thing #282 actually added:
// that a job whose employer the web could describe comes out placed, a job whose employer it could
// not comes out honestly unplaced, and that the difference is visible to a person rather than being
// an internal detail. It also watches the correction door on the WIRE, because #282 changed the
// stored shape of a placement and a correction is the only lever a person has over this axis — a
// correction that is refused must never look saved.
//
// The QA build cans exactly one lookup: "Nordic Retail Group" has one, "Baltic Systems" deliberately
// has none. So one CV walks both halves.
//
// Run it:
//   OPS_KEY=qa-ops-key pnpm --filter @jobcrush/api start:qa          # fake-model API on 34101
//   API_URL=http://127.0.0.1:34101 pnpm --filter @jobcrush/web build
//   API_URL=http://127.0.0.1:34101 npx next start -p 34102           # from apps/web
//   BASE_URL=http://127.0.0.1:34102 node apps/web/e2e/job-blocks-industry-lookup-journey.mjs

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

const qa = await createSession('job-blocks-industry-lookup-journey', {
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

async function verdict(ok, note) {
  if (ok) return qa.expectVisible('body', note);
  await qa.note(`FAIL: ${note}`);
  return qa.expectText('body', '__this_check_failed__', note);
}

const card = () => page.locator('.jb-card');
const cardText = async () => ((await card().textContent()) || '').replace(/\s+/g, ' ').trim();

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

const industryOf = (blocks, employer) => blocks.find((b) => b.employer.value === employer)?.industry;

// -------------------------------------------------------------------------------------------
// 1. Her CV goes in through the front door.
// -------------------------------------------------------------------------------------------
const jobId = await qa.frontDoorPaste(CV_TEXT, 'she pastes a CV naming two employers — one the web knows, one it does not');
await qa.waitForJobDone(jobId);
await qa.goto(`${BASE}/job-blocks/${jobId}`, 'she opens the work-history check');
await qa.expectVisible('.jb-card', 'the deck opens on the first card');
await qa.scrollThrough('she reads the whole screen once before deciding anything');

// -------------------------------------------------------------------------------------------
// 2. The employer the web could describe — placed, and placed as what the business IS.
// -------------------------------------------------------------------------------------------
await verdict(await walkTo('Nordic Retail Group'), 'the deck reaches the job at Nordic Retail Group');
await qa.expectText('.jb-card', 'Nordic Retail Group', 'the card names the employer');
await qa.expectVisible('.jb-card .jb-industry', 'the industry is stated right beside the employer');
// The CV line under this job says "led the checkout replatforming" — an IT sentence. What places
// this job in RETAIL is the employer lookup, not the line: the second evidence source, on screen.
await qa.expectText(
  '.jb-card .jb-industry',
  'Industry: Retail and consumer',
  'placed as what the EMPLOYER is, not as what the CV line sounds like',
);
await verdict(
  (await page.locator('.jb-card .jb-industry').getAttribute('data-placed')) === 'true',
  'the line is marked as a real placement, not a guess',
);
await qa.scrollThrough('she reads the placed card top to bottom');

const placedWire = industryOf((await deck()).blocks, 'Nordic Retail Group');
await qa.note(`Nordic Retail Group reads back as: ${JSON.stringify(placedWire.value)}`);
await verdict(placedWire.value?.schemaVersion === '2', 'the stored placement is at contract v2');
await verdict(
  Array.isArray(placedWire.value?.industries) &&
    placedWire.value.industries.every((i) => typeof i.confidence === 'string') &&
    placedWire.value.confidence === undefined,
  'confidence rides on each industry, and nothing sits on the placement itself',
);

// -------------------------------------------------------------------------------------------
// 3. The employer the web had nothing on — honestly unplaced, never guessed.
// -------------------------------------------------------------------------------------------
await swipe('left', 'she leaves the retail job for now and moves on');
await verdict(await walkTo('Baltic Systems'), 'the deck reaches the job at Baltic Systems');
await qa.expectText('.jb-card', 'Baltic Systems', 'the card names the employer');
await qa.expectText(
  '.jb-card .jb-industry',
  "We couldn't work out what industry this was",
  'a lookup that found nothing says so plainly — the upload was never blocked by it',
);
await verdict(
  (await page.locator('.jb-card .jb-industry').getAttribute('data-placed')) === 'false',
  'the unplaced line is marked as such',
);
await verdict(
  !/Banking|Consulting|IT services|Retail and consumer|Software|Manufacturing/.test(await cardText()),
  'no nearest-industry guess is borrowed onto a job the lookup could not help with',
);
await qa.scrollThrough('she reads the honest gap in full');

// -------------------------------------------------------------------------------------------
// 4. She puts it right — and the wire is watched, not just the screen.
// -------------------------------------------------------------------------------------------
await qa.click('.jb-card', 'she taps the card to correct it herself');
await qa.expectVisible('.jb-back', 'the correction panel opens');
await qa.expectVisible('#jb-industry', 'the industry is offered back for correction');

const correctExchange = new Promise((resolve) => {
  page.on('response', async (r) => {
    if (/\/api\/job-blocks\/.+\/correct$/.test(r.url()) && r.request().method() === 'POST') {
      const req = JSON.parse(r.request().postData() ?? '{}');
      if (req.key === 'industry') resolve({ sent: req, status: r.status(), body: (await r.text()).slice(0, 300) });
    }
  });
});

await page.locator('#jb-industry').selectOption('it-services');
await qa.expectVisible('#jb-industry', 'she picks IT services from the published list');
await page.waitForTimeout(800);
await qa.click(page.getByRole('button', { name: /Save and continue/i }), 'and saves her correction');

const exchange = await Promise.race([
  correctExchange,
  new Promise((r) => setTimeout(() => r(null), 15000)),
]);
await qa.note(`the correction exchange: ${JSON.stringify(exchange)}`);
await verdict(exchange !== null, 'her correction actually reached the server');
await verdict(exchange?.status === 200, `the server accepted her correction (got ${exchange?.status})`);

await page.waitForTimeout(1500);
await qa.scrollThrough('she looks at the screen after saving');
const screenAfterSave = ((await page.locator('body').textContent()) || '').replace(/\s+/g, ' ').trim();
await qa.note(`what the screen says after saving: ${screenAfterSave.slice(0, 400)}`);

// -------------------------------------------------------------------------------------------
// 5. It survived the reload — on the wire, and on the card in front of her.
// -------------------------------------------------------------------------------------------
await qa.goto(`${BASE}/job-blocks/${jobId}`, 'she reloads the work-history check');
const reloaded = (await deck()).blocks;
const balticBlockId = reloaded.find((b) => b.employer.value === 'Baltic Systems').id;
const baltic = industryOf(reloaded, 'Baltic Systems');
await qa.note(`Baltic Systems reads back as: ${JSON.stringify(baltic)}`);
await verdict(
  baltic.value?.outcome === 'confirmed' &&
    baltic.value.industries[0].industryId === 'it-services' &&
    baltic.value.industries[0].confidence === 'certain' &&
    baltic.value.schemaVersion === '2',
  'her own answer is stored, at v2, and stamped certain by the server',
);
await verdict(
  baltic.origin?.kind === 'corrected' &&
    JSON.stringify(baltic.origin.supersededValue) === JSON.stringify({ schemaVersion: '2', outcome: 'unmapped' }),
  "her answer supersedes the machine's honest blank without erasing it",
);

// "Save and continue" CONFIRMS the block, and the deck is rebuilt from the unconfirmed ones
// (page.tsx: `setQueue(res.blocks.filter((b) => !b.confirmed)…)`) — so a card she has just settled
// is deliberately not swiped past again. Bring it back the way the product's own undo does, so the
// correction is read off the SCREEN and not only off the wire. (This step used to "pass" only
// because the correction 400'd, leaving the block unconfirmed and still in the deck.)
await page.evaluate(
  (id) => fetch(`/api/job-blocks/${id}/unconfirm`, { method: 'POST', credentials: 'same-origin' }),
  balticBlockId,
);
await qa.goto(`${BASE}/job-blocks/${jobId}`, 'and she comes back to the Baltic Systems card');
await verdict(await walkTo('Baltic Systems'), 'the corrected card is back in front of her');
await qa.expectText('.jb-card .jb-industry', 'Industry: IT services', 'and the card reads back HER answer');
await qa.scrollThrough('she reads the corrected card in full');

// -------------------------------------------------------------------------------------------
// 6. Nothing anywhere asked her which industry a job was in.
// -------------------------------------------------------------------------------------------
const wholeScreen = ((await page.locator('body').textContent()) || '').toLowerCase();
await verdict(
  !/which industry|what industry was this|tell us .*industry/.test(wholeScreen),
  'she was never asked which industry any job was in — only offered the correction she opened herself',
);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
