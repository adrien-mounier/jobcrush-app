// #389 whole-spec QA pass (ADR-0019, #390) — Preview as CV walked over the REAL stack (fake model
// only): the profile's door held while check mode is open and when the profile has no job, then
// open; the wait narrated; the CV drawn as it prints, with the letterhead from the saved Your
// details and the job it was tailored for named; Download PDF handing the browser a file; a second
// open spending no model call; a change to Your details remaking it exactly once; and a download
// refused in the server's own words when the profile changed under an open page. cv-preview.spec.ts
// covers the same screen with every API answer mocked; this flow is the only one that runs the
// route, the tailor checkpoint and the document maker behind it.
//
//   PORT=34101 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34100
//   BASE_URL=http://127.0.0.1:34100 node apps/web/e2e/cv-preview-journey.mjs
import { readFileSync } from 'node:fs';
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34100';
const RUN = Date.now().toString(36);
const ROLE = 'IT project manager';
const AREA = 'Singapore';
const CV = [
  'Jane Doe',
  `+33 6 00 00 00 00 | jane.${RUN}@example.com`,
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
].join('\n');
const DETAILS = {
  name: 'Jane Q. Doe',
  title: 'Senior IT Project Manager',
  location: 'Warsaw, Poland',
  phone: '+48 600 100 200',
  email: `jane.${RUN}@example.com`,
};
const NEW_PHONE = '+48 600 999 999';

const qa = await createSession('cv-preview-journey', { baseURL: BASE, viewport: { width: 1280, height: 900 } });
const { page } = qa;
page.setDefaultTimeout(20_000);
// The fake tailor answers in milliseconds, inside the human-paced pause after a press: record every
// wait line the page shows, so the narration is proven even when it is on screen for 30ms.
await page.addInitScript(() => {
  window.__narration = [];
  new MutationObserver(() => {
    const t = document.querySelector('.preview-wait[role="status"]')?.textContent?.trim();
    if (t && window.__narration.at(-1) !== t) window.__narration.push(t);
  }).observe(document, { subtree: true, childList: true, characterData: true });
});
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
// qa-main only: the fake model's own call counter.
const tailorCalls = async () => (await api('/qa/llm-calls')).body?.tailor ?? NaN;
const door = page.locator('a.review-door, button.review-door').filter({ hasText: 'Preview as CV' });
const holdLine = page.locator('#cvpreview-hold');
const alertLine = page.locator('.preview p[role="alert"]');

async function startPerson(cv, note) {
  const jobId = await qa.frontDoorPaste(cv, note);
  await qa.waitForJobDone(jobId);
  await qa.frontDoorContinueToIntent();
  await qa.fill('#target-role', ROLE, `the job she is going for: "${ROLE}"`);
  await qa.fill('#search-area', AREA, `where she wants to work: ${AREA}`);
  await qa.click('button:has-text("Save and continue")', 'Save and continue');
  await page.waitForTimeout(1500);
}
async function openPreviewFromProfile(note) {
  await qa.goto('/profile', note);
  await qa.scrollThrough('reads her profile');
  await qa.click(door, 'presses Preview as CV');
  await page.waitForURL(/\/profile\/preview/);
}
const waitReady = () => page.locator('.preview-for').waitFor({ state: 'visible', timeout: 60_000 });
const cvPageText = async () => (await page.frameLocator('.preview-frame').locator('body').innerText()).replace(/\s+/g, ' ');

try {
  // 1. A person whose work history could not be read: no job on the profile.
  await startPerson(`FAILTHISREAD\n${CV}`, 'a person whose history the read cannot make sense of pastes her CV');
  await qa.goto('/profile', 'her profile, check mode not finished yet');
  await qa.expectVisible(door, 'the Preview as CV door is there');
  await qa.expectText(holdLine, 'Finish checking your CV first.', 'held while check mode is open, with its own line');
  await qa.completeReview();
  await qa.goto('/profile', 'her profile after check mode is finished');
  await qa.expectVisible(door, 'the Preview as CV door is there');
  await assert((await door.getAttribute('aria-disabled')) === 'true', 'the door is greyed: aria-disabled, not a link');
  await qa.expectText(holdLine, 'Your profile has no job yet.', 'and says why in one line');
  const urlBefore = page.url();
  // Playwright will not click an aria-disabled control on its own; a person's tap still lands.
  await door.click({ force: true });
  await page.waitForTimeout(800);
  await qa.expectVisible(door, 'she presses the greyed door anyway');
  await assert(page.url() === urlBefore, 'it goes nowhere');
  const refused = await send('POST', '/profile/cv-preview');
  await assert(
    refused.status === 409 && refused.body?.error?.code === 'no_job',
    `the server refuses too (${refused.status} ${refused.body?.error?.code})`,
  );

  // 2. A person with a current job.
  await qa.context.clearCookies();
  await startPerson(CV, 'a different person pastes a CV with a current job');
  await qa.completeReview();
  const saved = await send('PUT', '/contact', { fields: DETAILS });
  await assert(saved.status === 200, `her Your details are saved (${saved.status})`);
  const before = await tailorCalls();
  await qa.note(`model calls so far (tailor): ${before}`);
  await qa.goto('/profile', 'her profile, check mode finished');
  await qa.scrollThrough('reads her profile');
  // The open door is its own door, not a run of text glued to Check your CV's link.
  const checkBox = await page.locator('a.review-door[href="/profile/check"]').boundingBox();
  const doorBox = await door.boundingBox();
  await assert(
    !!checkBox && !!doorBox && (doorBox.y >= checkBox.y + checkBox.height - 1 || doorBox.x >= checkBox.x + checkBox.width + 8),
    `Preview as CV stands apart from Check your CV (check ${JSON.stringify(checkBox)}, door ${JSON.stringify(doorBox)})`,
  );
  await qa.click(door, 'presses Preview as CV');
  await waitReady();
  const waitLine = (await page.evaluate(() => window.__narration ?? [])).join(' | ');
  await assert(waitLine.includes('Writing your CV'), `the wait is narrated while the CV is written ("${waitLine.replace(/\s+/g, ' ')}")`);
  await waitReady();
  await qa.expectText('.preview-for', 'Tailored for IT Project Manager at Nordic Retail Group', 'the page names the job: her current one');
  const text = await cvPageText();
  await qa.note(`the CV page opens: "${text.slice(0, 300)}…"`);
  for (const v of Object.values(DETAILS)) await assert(text.includes(v), `the letterhead prints her saved "${v}"`);
  await assert(!/\bdraft\b/i.test(text), 'no draft watermark on the page');
  const look = await page.locator('button.preview-download').evaluate((b) => getComputedStyle(b).backgroundColor);
  await assert(!/rgba\(0, 0, 0, 0\)|transparent/.test(look), `Download PDF looks like a button: a filled background (${look})`);
  await qa.scrollThrough('reads the CV page');
  await assert((await tailorCalls()) === before + 1, 'one model call made it');

  const download = page.waitForEvent('download', { timeout: 30_000 });
  await qa.click('button.preview-download', 'presses Download PDF');
  const file = await download;
  const name = file.suggestedFilename();
  const bytes = readFileSync(await file.path());
  await assert(
    /^CV - .+\.pdf$/.test(name) && bytes.subarray(0, 5).toString() === '%PDF-',
    `the browser saves a PDF ("${name}", ${bytes.length} bytes)`,
  );

  // 3. A second open spends nothing.
  await openPreviewFromProfile('she comes back to it later');
  await waitReady();
  await qa.expectText('.preview-for', 'Nordic Retail Group', 'the CV is there at once');
  await assert((await tailorCalls()) === before + 1, 'opening it again made no model call');

  // 4. The profile changes under an open page: the download is refused in the server's words.
  await send('PUT', '/contact', { field: 'phone', value: NEW_PHONE });
  await qa.note('her phone number changes in another tab while this page is open');
  await qa.click('button.preview-download', 'presses Download PDF on the page she still has open');
  await qa.expectVisible(alertLine, 'the refusal is printed on the page, never a silent nothing');
  await qa.note(`the refusal line reads: "${(await alertLine.innerText()).trim()}"`);

  // 5. The change remakes it once.
  await openPreviewFromProfile('she opens it again after the change');
  await waitReady();
  await assert((await cvPageText()).includes(NEW_PHONE), 'the remade CV prints the new phone number');
  await assert((await tailorCalls()) === before + 2, 'the change remade it with exactly one model call');
  await page.reload();
  await waitReady();
  await assert((await tailorCalls()) === before + 2, 'and a reload after that spends nothing');
} catch (err) {
  await qa.note(`aborted: ${err?.message ?? err}`);
  await assert(false, 'the flow ran to the end');
}
const ok = await qa.finish();
process.exit(ok ? 0 : 1);
