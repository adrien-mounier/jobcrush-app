// #270 "a person can paste their CV text on the front door" — the whole journey, driven as a human
// against a REAL full stack (real Fastify, real extract, real pipeline, real session + claim store).
// Only the MODEL is faked, through the same seam apps/api/test uses, so the run is free and
// deterministic while every line of #270's own code is genuinely exercised.
//
// Three phases, one report:
//   1. The paste door on the source step — refuse a too-short paste without costing the typing,
//      then paste a real CV, see the SAME facts-found screen an upload produces, never leave "/",
//      and carry on to the target-role and search-area step.       (AC1, AC2, AC4, AC6, AC7)
//   2. The scanned-CV dead end — upload a picture-only PDF, and take the "paste the text instead"
//      route the failure screen now offers, through to the same facts screen.        (AC3)
//   3. Parity — a fresh session that UPLOADS a readable CV is stored the same way a pasted one is:
//      same session record, same importProof shape, same durable source choice.       (AC5)
//
// Run it (a stack must already be up):
//   API_URL=http://127.0.0.1:34101 pnpm --filter @jobcrush/web build && pnpm --filter @jobcrush/web start
//   node apps/web/e2e/frontdoor-paste-journey.mjs
// BASE_URL overrides the web origin.

import { fileURLToPath } from 'node:url';
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const SCANNED_PDF = fileURLToPath(new URL('../../api/test/fixtures/scanned.pdf', import.meta.url));
const PLAIN_TXT = fileURLToPath(new URL('../../api/test/fixtures/plain.txt', import.meta.url));

const CV_TEXT = [
  'Jane Doe',
  'jane.doe@example.com',
  'Paris, France',
  '',
  'EXPERIENCE',
  '',
  'IT Project Manager, Nordic Retail Group, Warsaw — Mar 2021 - Present',
  '- Led the checkout replatforming and delivered it two months ahead of plan.',
  '- Managed a budget of EUR 1.2M across three vendor teams.',
  '- Ran steering committee reporting for the CIO every month.',
  '',
  'Project Manager, Acme Systems, Paris — Jan 2018 - Feb 2021',
  '- Delivered a payments migration for a retail bank across four countries.',
  '- Coordinated a team of twelve engineers and two business analysts.',
  '',
  'EDUCATION',
  'MSc Management Information Systems, University of Warsaw, 2017',
  '',
  'SKILLS',
  'Jira, MS Project, stakeholder management, vendor management, budgeting',
].join('\n');

// Deliberately under the 100-character floor the paste route enforces.
const TOO_SHORT = 'Jane Doe, project manager.';

const qa = await createSession('frontdoor-paste-journey', {
  baseURL: BASE,
  viewport: { width: 1280, height: 900 },
});
const { page } = qa;
page.setDefaultTimeout(20000);

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

const failures = [];
page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
page.on('response', (r) => {
  const u = r.url();
  if (/\/api\/(cv|uploads|jobs|sessions)/.test(u) && r.status() >= 400 && r.status() !== 401)
    failures.push(`response ${r.status()} ${u}`);
});

const sessionState = () =>
  page.evaluate(() => fetch('/api/sessions/me').then((r) => r.json()));

/** Open the front door and reveal the "Can something you already have help?" source step. */
async function openSourceStep(label) {
  await qa.goto(`${BASE}/`, `${label}: the person opens the front door`);
  await page.mouse.click(10, 10);
  await qa.note(`${label}: taps to finish the invitation`);
  await qa.click(page.getByRole('button', { name: 'Ready?' }), `${label}: says they are ready`);
  await qa.expectVisible(
    page.getByRole('heading', { name: 'Can something you already have help?' }),
    `${label}: the source step is on screen`,
  );
  await qa.scrollThrough(`${label}: reads down the tiles the front door offers`);
}

/** Ride the facts-found screen, whatever shape the read produced, and continue from it. */
async function readFactsAndContinue(label) {
  const proofHeading = page.locator('.import-status h1');
  await proofHeading.waitFor({ state: 'visible', timeout: 60000 });
  // The reading panel wears the same shell, so wait for it to hand over before reading the heading.
  await page
    .locator('.proof-metrics, .import-actions')
    .first()
    .waitFor({ state: 'visible', timeout: 60000 });
  const headingText = (await proofHeading.textContent())?.trim() ?? '';
  await qa.note(`${label}: the read finishes and the screen says "${headingText}"`);
  if (/couldn’t|couldn't/i.test(headingText))
    throw new Error(`${label}: expected a facts screen, got a failure screen: "${headingText}"`);
  await qa.expectVisible(page.locator('.proof-metrics'), `${label}: the fact counts are on screen`);
  await qa.expectVisible(
    page.locator('.proof-facts li').first(),
    `${label}: a fact read out of the CV is shown, with where it came from`,
  );
  await qa.expectText(
    page.locator('.proof-facts li').first(),
    'From your CV',
    `${label}: the fact is labelled as coming from the CV`,
  );
  await qa.scrollThrough(`${label}: reads the facts the product found`);
  return headingText;
}

try {
  // ────────────────────────── phase 1 — the paste door ──────────────────────────
  await openSourceStep('paste door');

  await qa.expectVisible(
    page.getByRole('button', { name: /Paste my CV text/ }),
    'AC1: the source step offers pasting, beside "Use my CV"',
  );
  await qa.click(page.getByRole('button', { name: /Paste my CV text/ }), 'AC1: chooses to paste');
  await qa.expectVisible(
    page.getByRole('heading', { name: 'Paste your CV text' }),
    'AC1: the paste view opens',
  );
  await qa.note(`AC6: still on the front door — URL is ${page.url()}`);
  if (new URL(page.url()).pathname !== '/')
    throw new Error(`AC6: pasting left the front door — landed on ${page.url()}`);

  // AC4 — a paste too short to be a CV.
  await qa.fill(page.getByLabel('Your CV text'), TOO_SHORT, 'AC4: types only a line, not a CV');
  await qa.click(page.getByRole('button', { name: 'Use this text' }), 'AC4: tries to continue');
  await qa.expectText(
    page.locator('#paste-error'),
    'too short to be a CV',
    'AC4: told plainly what is wrong',
  );
  const kept = await page.getByLabel('Your CV text').inputValue();
  if (kept !== TOO_SHORT) throw new Error(`AC4: the typing was lost — box holds "${kept}"`);
  await qa.note('AC4: what they typed is still in the box, ready to be fixed');

  // AC1/AC2 — the real paste, in place.
  await qa.fill(page.getByLabel('Your CV text'), CV_TEXT, 'AC1: pastes the whole CV');
  await qa.click(page.getByRole('button', { name: 'Use this text' }), 'AC1: hands it over');
  const pastedHeading = await readFactsAndContinue('AC2 paste');

  if (new URL(page.url()).pathname !== '/')
    throw new Error(`AC6: the read navigated away — now on ${page.url()}`);
  await qa.note('AC6: the read happened in place; the person never left the front door');

  // AC5 — what the session now holds for someone who pasted.
  const afterPaste = await sessionState();
  await qa.note(
    `AC5: the session records sourceEntry=${JSON.stringify(afterPaste.sourceEntry)}, ` +
      `importProof.outcome=${afterPaste.importProof?.outcome}, ` +
      `usefulFactCount=${afterPaste.importProof?.usefulFactCount}`,
  );
  if (!afterPaste.importProof) throw new Error('AC5: a paste stored no import proof on the session');
  if (afterPaste.sourceEntry?.choice !== 'cv')
    throw new Error(
      `AC5: a paste saved a different kind of visitor — choice=${afterPaste.sourceEntry?.choice}`,
    );

  // The proof is durable, not just on screen: a reload brings it back without re-pasting.
  await qa.goto(`${BASE}/`, 'AC5: reloads the front door');
  await qa.expectVisible(
    page.locator('.import-status h1'),
    'AC5: the pasted facts come back from the session after a reload',
  );
  await qa.expectText(page.locator('.import-status h1'), pastedHeading.slice(0, 12), 'AC5: the same screen');

  // AC7 — on to the target role and search area.
  const conflict = page.locator('.conflict input');
  if (await conflict.isVisible().catch(() => false)) {
    await qa.fill(conflict, 'Jane Doe', 'AC7: answers the one thing the CV left ambiguous');
    await qa.click(page.getByRole('button', { name: 'Save and continue' }), 'AC7: continues');
  } else {
    await qa.click(
      page.getByRole('button', { name: 'Ask me what’s missing' }),
      'AC7: continues to the next step',
    );
  }
  await qa.expectVisible(
    page.getByRole('heading', { name: /What kind of job are you going for/ }),
    'AC7: reaches the target-role and search-area step',
  );
  const atIntent = await sessionState();
  await qa.note(
    `AC7: the facts are still intact at the intent step — importProof.usefulFactCount=` +
      `${atIntent.importProof?.usefulFactCount}`,
  );
  if (!(atIntent.importProof?.usefulFactCount > 0))
    throw new Error('AC7: reached the intent step with no facts left');
  await qa.scrollThrough('AC7: reads the target-role and search-area step');

  // ─────────────────── phase 2 — the scanned-CV dead end ────────────────────
  await page.context().clearCookies();
  await qa.note('a different person arrives, whose CV is a scan');
  await openSourceStep('scanned CV');

  await qa.click(page.getByRole('button', { name: /Use my CV/ }), 'AC3: chooses the file route');
  await page.locator('input[type="file"]').setInputFiles(SCANNED_PDF);
  await qa.note('AC3: picks a scanned PDF — a picture of a CV, with no selectable text');
  await page.locator('.import-actions').waitFor({ state: 'visible', timeout: 60000 });
  await qa.expectVisible(
    page.getByRole('heading', { name: 'We couldn’t read your CV' }),
    'AC3: the product says it could not read the file',
  );
  // #270 fix: the FIRST, live failure is where the scan guidance has to be. The job ends
  // `status: "failed"` CARRYING an import proof, and the front door now reads a finished job the
  // same way whether it completed or failed — so the proof-driven body renders here, with no reload.
  const firstFailureBody = (await page.locator('.import-status p').first().textContent())?.trim() ?? '';
  await qa.note(`AC3: the first-failure body reads "${firstFailureBody}"`);
  const headingText = (await page.locator('.import-status h1').first().textContent())?.trim() ?? '';
  if (firstFailureBody.replace(/[.\s]+$/, '') === headingText.replace(/[.\s]+$/, ''))
    throw new Error(`AC3: the first-failure body is just the heading repeated — "${firstFailureBody}"`);
  await qa.note('AC3: the body says something the heading did not — it is not a bare repeat');
  await qa.expectText(
    page.locator('.import-status p').first(),
    'If your CV is a scan, paste the text instead',
    'AC3: the FIRST live failure explains the likely reason and points at pasting',
  );
  await qa.expectVisible(
    page.getByRole('button', { name: 'Paste the text instead' }),
    'AC3: the failure screen offers pasting as a way forward',
  );
  await qa.scrollThrough('AC3: reads what the failure screen offers');
  // The same failure, restored from the session on a reload — same screen, same advice.
  await qa.goto(`${BASE}/`, 'AC3: comes back to the front door after the failure');
  await qa.expectText(
    page.locator('.import-status p').first(),
    'If your CV is a scan, paste the text instead',
    'AC3: a reload restores the same failure, with the same advice',
  );
  await qa.expectVisible(
    page.getByRole('button', { name: 'Paste the text instead' }),
    'AC3: and still offers the route after a reload',
  );
  await qa.click(
    page.getByRole('button', { name: 'Paste the text instead' }),
    'AC3: takes the route offered',
  );
  await qa.expectVisible(
    page.getByRole('heading', { name: 'Paste your CV text' }),
    'AC3: the paste view opens from the failure screen',
  );
  await qa.fill(page.getByLabel('Your CV text'), CV_TEXT, 'AC3: pastes the text of the scanned CV');
  await qa.click(page.getByRole('button', { name: 'Use this text' }), 'AC3: hands it over');
  await readFactsAndContinue('AC3 recovery');
  const afterRecovery = await sessionState();
  await qa.note(
    `AC3: the recovered read is stored too — importProof.outcome=${afterRecovery.importProof?.outcome}, ` +
      `usefulFactCount=${afterRecovery.importProof?.usefulFactCount}`,
  );
  if (afterRecovery.importProof?.outcome === 'failed')
    throw new Error('AC3: the paste route out of the failure left the session still failed');

  // ───────── phase 2b — a failure that carries NO proof still degrades gracefully ─────────
  // The pipeline attaches a proof to an unreadable scan, so the proof-less finish is the OTHER
  // failure shape (a crashed read). Forced here at the job stream so the fallback branch of the
  // fix — bare message, no invented guidance — is seen on a real screen rather than assumed.
  await page.context().clearCookies();
  await qa.note('a fourth person arrives, whose read fails with no proof attached at all');
  await page.route('**/api/jobs/*/events', async (route) => {
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ id: 'job-x', status: 'failed', error: 'crash', progress: {} })}\n\n`,
    });
  });
  await openSourceStep('proof-less failure');
  await qa.click(page.getByRole('button', { name: /Use my CV/ }), 'chooses the file route');
  await page.locator('input[type="file"]').setInputFiles(SCANNED_PDF);
  await page.locator('.import-actions').waitFor({ state: 'visible', timeout: 60000 });
  await qa.expectVisible(
    page.getByRole('heading', { name: 'We couldn’t read your CV' }),
    'a proof-less failure still says plainly that the CV could not be read',
  );
  await qa.expectText(
    page.locator('.import-status p').first(),
    'We couldn’t read your CV.',
    'and falls back to the bare message rather than inventing guidance it has no proof for',
  );
  await qa.expectVisible(
    page.getByRole('button', { name: 'Paste the text instead' }),
    'the way out is still offered',
  );
  await qa.expectVisible(
    page.getByRole('button', { name: 'Continue with questions' }),
    'and so is carrying on without a CV',
  );
  await qa.scrollThrough('reads the bare failure screen');
  await page.unroute('**/api/jobs/*/events');

  // ───────────── phase 3 — an upload, for comparison (AC5 parity) ─────────────
  await page.context().clearCookies();
  await qa.note('a third person arrives and UPLOADS a readable CV, for comparison');
  await openSourceStep('upload');
  await qa.click(page.getByRole('button', { name: /Use my CV/ }), 'AC5: chooses the file route');
  await page.locator('input[type="file"]').setInputFiles(PLAIN_TXT);
  await readFactsAndContinue('AC5 upload');
  const afterUpload = await sessionState();
  await qa.note(
    `AC5: an upload stores sourceEntry=${JSON.stringify(afterUpload.sourceEntry)}, ` +
      `importProof.outcome=${afterUpload.importProof?.outcome}`,
  );
  const shape = (s) => ({
    sourceChoice: s.sourceEntry?.choice ?? null,
    proofKeys: s.importProof ? Object.keys(s.importProof).sort().join(',') : null,
    hasFacts: (s.importProof?.usefulFactCount ?? 0) > 0,
  });
  const pasteShape = JSON.stringify(shape(afterPaste));
  const uploadShape = JSON.stringify(shape(afterUpload));
  await qa.note(`AC5: paste stores ${pasteShape}`);
  await qa.note(`AC5: upload stores ${uploadShape}`);
  if (pasteShape !== uploadShape)
    throw new Error(`AC5: a person who pastes is stored differently — ${pasteShape} vs ${uploadShape}`);
  await qa.note('AC5: the two are stored identically — pasting is not a different kind of visitor');

  if (failures.length) await qa.note(`network/page problems seen: ${failures.join(' | ')}`);
} catch (err) {
  await qa.note(`JOURNEY FAILED: ${err?.message ?? err}`);
  const ok = await qa.finish();
  process.exit(ok ? 1 : 1);
}

const green = await qa.finish();
if (failures.length) {
  console.error('page/network problems:', failures);
}
process.exit(green && failures.length === 0 ? 0 : 1);
