// #325 — a CV that reads well goes straight on to "What kind of job are you going for, and where?",
// with no facts screen and no press in between. Drives both doors (file and paste), the screens the
// person must still act on (a CV that cannot be read), and reloads at three points: after a good
// read, mid-read, and on a failed read.
//
//   BASE_URL=http://127.0.0.1:3107 node apps/web/e2e/import-straight-to-intent.mjs
//
// Needs the fake-model API (apps/api/dist/qa-main.js) behind the web build — no paid calls.
//
// The fake miner replays one recorded read that always comes back "partial" (one recorded claim
// fails validation -> the invalid-miner-claim flag), so a clean read is unreachable on this stack.
// Phases A-C therefore turn on GOOD_READ: the browser relabels the read's outcome "partial" ->
// "success" on its way in (job events + session GET). Everything else — the upload or paste, the
// read, the stage save, the reload — is the real server.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3015';
const fixture = (name) => fileURLToPath(new URL(`../../api/test/fixtures/${name}`, import.meta.url));

const qa = await createSession('import-straight-to-intent', { baseURL: BASE });
const { page } = qa;
const failures = [];
page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));

const intentHeading = page.getByRole('heading', { name: 'What kind of job are you going for, and where?' });
const sessionState = () => page.evaluate(() => fetch('/api/sessions/me').then((r) => r.json()));
const check = (cond, msg) => { if (!cond) failures.push(msg); };

const relabel = async (route) => {
  if (route.request().method() !== 'GET') return route.fallback();
  const response = await route.fetch();
  const body = (await response.text()).replaceAll('"outcome":"partial"', '"outcome":"success"');
  await route.fulfill({ response, body });
};
async function goodRead(on) {
  for (const url of ['**/api/jobs/*/events', '**/api/sessions/me']) {
    if (on) await page.route(url, relabel);
    else await page.unroute(url, relabel);
  }
  await qa.note(on ? 'GOOD_READ on: the read arrives labelled "success"' : 'GOOD_READ off: reads arrive as the server labels them');
}

/** A brand-new visitor: no cookie, the front door, "Ready?", the source step. */
async function freshSourceStep(label) {
  await page.context().clearCookies();
  await qa.goto(`${BASE}/`, `${label}: a new visitor opens the front door`);
  await page.mouse.click(10, 10);
  await qa.click(page.getByRole('button', { name: 'Ready?' }), `${label}: says they are ready`);
  await qa.expectVisible(
    page.getByRole('heading', { name: 'Can something you already have help?' }),
    `${label}: the source step opens`,
  );
  await qa.scrollThrough(`${label}: reads the options`);
}

async function uploadFile(name, label) {
  await qa.click(page.getByRole('button', { name: /Use my CV/ }), `${label}: chooses "Use my CV"`);
  await page.locator('input[type="file"]').setInputFiles(fixture(name));
  await qa.note(`${label}: picks ${name}`);
}

/** Every proof-screen marker #325 removed must be absent. */
async function noProofScreen(label) {
  for (const text of ['From your CV', 'Your CV gave us useful facts', 'Your CV saved you some questions', 'useful facts found', 'questions skipped']) {
    const n = await page.getByText(text).count();
    check(n === 0, `${label}: "${text}" is on screen (${n})`);
  }
  const askBtn = await page.getByRole('button', { name: /Ask me what/ }).count();
  check(askBtn === 0, `${label}: an "Ask me what's missing" press is on screen`);
  await qa.note(`${label}: no facts screen, no counts, no "Ask me what's missing" press`);
}

try {
  await goodRead(true);
  // ---- A: the file door, good read -------------------------------------------------------------
  await freshSourceStep('A file');
  await uploadFile('plain.txt', 'A file');
  await intentHeading.waitFor({ state: 'visible', timeout: 90000 });
  await qa.expectVisible(intentHeading, 'A file: the read finishes and the job-and-area question opens by itself');
  await noProofScreen('A file');
  await qa.scrollThrough('A file: reads the job-and-area question');
  let s = await sessionState();
  await qa.note(`A file: session stage=${s.stage} importProof.outcome=${s.importProof?.outcome}`);
  check(s.stage === 'discovery', `A file: stage is ${s.stage}, expected discovery`);
  await qa.goto(`${BASE}/`, 'A file: reloads the page');
  await qa.expectVisible(intentHeading, 'A file: after a reload it is still the job-and-area question');
  await noProofScreen('A file reload');

  // ---- B: the paste door, good read ------------------------------------------------------------
  await freshSourceStep('B paste');
  await qa.click(page.getByRole('button', { name: /Paste my CV text/ }), 'B paste: chooses "Paste my CV text"');
  await qa.fill(page.getByLabel('Your CV text'), readFileSync(fixture('plain.txt'), 'utf8'), 'B paste: pastes a CV');
  await qa.click(page.getByRole('button', { name: 'Use this text' }), 'B paste: hands it over');
  await intentHeading.waitFor({ state: 'visible', timeout: 90000 });
  await qa.expectVisible(intentHeading, 'B paste: the job-and-area question opens by itself');
  await noProofScreen('B paste');
  s = await sessionState();
  check(s.stage === 'discovery', `B paste: stage is ${s.stage}, expected discovery`);
  check(s.importProof?.outcome === 'success', `B paste: outcome ${s.importProof?.outcome}`);

  // ---- C: reload mid-read, then again once the read is done (between read and hand-off) --------
  await freshSourceStep('C mid-read');
  const uploaded = page.waitForResponse((r) => /\/api\/uploads\/.+\/complete/.test(r.url()), { timeout: 30000 });
  await uploadFile('plain.txt', 'C mid-read');
  await uploaded;
  await qa.goto(`${BASE}/`, 'C mid-read: reloads while the CV is still being read');
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    s = await sessionState();
    if (s.importProof) break;
    await page.waitForTimeout(1000);
  }
  await qa.note(`C mid-read: read finished in the background — outcome=${s.importProof?.outcome}, stage=${s.stage ?? '(none)'}`);
  await qa.goto(`${BASE}/`, 'C mid-read: reloads again after the read has finished');
  await qa.expectVisible(intentHeading, 'C mid-read: lands on the job-and-area question, never a facts screen');
  await noProofScreen('C mid-read');
  s = await sessionState();
  check(s.stage === 'discovery', `C mid-read: stage is ${s.stage}, expected discovery`);

  await goodRead(false);
  // ---- P: a partly-read CV (this PDF trips a parser flag) still stops, says so, offers its retry -
  await freshSourceStep('P partial');
  await uploadFile('clean.pdf', 'P partial');
  const partHeading = page.getByRole('heading', { name: 'We read part of your CV' });
  await partHeading.or(intentHeading).first().waitFor({ state: 'visible', timeout: 90000 });
  if (await partHeading.isVisible()) {
    await qa.expectVisible(partHeading, 'P partial: the person is told only part of the CV was read');
    await qa.expectVisible(page.getByRole('button', { name: 'Try the CV again' }), 'P partial: a retry is offered');
    for (const t of ['From your CV', 'useful facts found', 'questions skipped'])
      check((await page.getByText(t).count()) === 0, `P partial: "${t}" still on the partial screen`);
    await qa.goto(`${BASE}/`, 'P partial: reloads the page');
    await qa.expectVisible(partHeading, 'P partial: after a reload the partial screen is still there');
    await qa.click(page.getByRole('button', { name: /Ask me what/ }), 'P partial: asks to be asked what is missing');
    await qa.expectVisible(intentHeading, 'P partial: the job-and-area question opens');
    await qa.goto(`${BASE}/`, 'P partial: reloads after moving on');
    await qa.expectVisible(intentHeading, 'P partial: a reload keeps the job-and-area question');
  } else {
    await qa.note('P partial: this PDF read cleanly on this stack — no partial screen to check');
  }

  // ---- D: a CV that cannot be read still stops and says so ------------------------------------
  await freshSourceStep('D scan');
  await uploadFile('scanned.pdf', 'D scan');
  const failHeading = page.getByRole('heading', { name: 'We couldn’t read your CV' });
  await failHeading.waitFor({ state: 'visible', timeout: 90000 });
  await qa.expectVisible(failHeading, 'D scan: the person is told the CV could not be read');
  await qa.expectVisible(page.getByRole('button', { name: 'Try again' }), 'D scan: a retry is offered');
  await qa.expectVisible(page.getByRole('button', { name: /paste/i }).first(), 'D scan: pasting the text instead is offered');
  await qa.expectVisible(page.getByRole('button', { name: 'Continue with questions' }), 'D scan: continuing without it is offered');
  await qa.goto(`${BASE}/`, 'D scan: reloads the page');
  await qa.expectVisible(failHeading, 'D scan: after a reload the failure is still shown, not skipped past');
  await qa.click(page.getByRole('button', { name: 'Try again' }), 'D scan: tries again');
  // "Try again" reopens the file picker directly.
  await page.locator('input[type="file"]').setInputFiles(fixture('plain.txt'));
  await qa.note('D scan: picks a readable CV this time');
  // GOOD_READ is off here, so this stack labels the re-read "partial": the failure screen must give
  // way to the next read's own screen, never stick.
  await page.getByRole('heading', { name: 'We read part of your CV' }).or(intentHeading).first().waitFor({ state: 'visible', timeout: 90000 });
  await qa.expectVisible(
    page.getByRole('heading', { name: /We read part of your CV|What kind of job are you going for/ }),
    'D scan: the retry replaces the failure screen with the new read',
  );
} catch (err) {
  failures.push(`flow threw: ${err.message}`);
}

if (failures.length) await qa.note(`FAILURES:\n- ${failures.join('\n- ')}`);
await qa.expectText(
  'body',
  failures.length === 0 ? '' : ' -IMPOSSIBLE-',
  failures.length === 0 ? 'no page error and every check held' : `failures: ${failures.join(' | ')}`,
);
const ok = await qa.finish();
process.exit(ok ? 0 : 1);
