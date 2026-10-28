// Spec #450 (#451 #453 #454) QA gate — the letterhead read by the model, Your details without a
// title, and the headline that is the job's own title, driven as a person against a running stack.
// Left by the spec's QA gate as a re-runnable flow.
//
// What it proves, in the order she meets it:
//   #451  after an upload, Your details shows the name the CV writes (EXPECT_NAME) and a city that
//         is not a job bullet (short, no bullet verbs; EXPECT_CITY_HINT when the letterhead has one)
//   #453  "Reading your CV" shows the name with no title line under it; Your details (check mode)
//         and the profile's contact panel show name, city, phone, email — no Title field
//   #454  a pasted ad titled "Chef de projet IT H/F" prints the headline "CHEF DE PROJET IT" under
//         the contact line on the tailor screen, and in the PDF printed from that document;
//         the profile's "Preview as CV" prints the person's own job's title (current, else most
//         recent), on screen and in its downloaded PDF
//
// Two stacks:
//   REAL (the letterhead ACs): no DATABASE_URL, no ANTHROPIC_API_KEY — the model calls go through
//   the local Claude Code CLI at no cost; slow (an upload and its check run take minutes).
//     PORT=34102 WEB_URL=http://127.0.0.1:34103 node apps/api/dist/main.js
//     cd apps/web && API_URL=http://127.0.0.1:34102 npx next build && npx next start -p 34103
//     CV_PDF="<a real CV>" EXPECT_NAME="<its name>" BASE_URL=http://127.0.0.1:34103 node apps/web/e2e/spec-450-letterhead-headline-journey.mjs
//   FAKE (qa-main.js, as ci.yml starts it): with no CV_PDF a text CV is pasted; the fake tailor
//   copies the posting line, so the headline there keeps the ad's "H/F" — the label-stripping is
//   the real model's (and preview.test.ts's), and this flow only asserts the title's words there.
//     BASE_URL=http://127.0.0.1:34100 node apps/web/e2e/spec-450-letterhead-headline-journey.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34103';
const CV_PDF = process.env.CV_PDF ?? '';
const RUN = Date.now().toString(36);
const EMAIL = `spec450.${RUN}@example.com`;
const LONG = Number(process.env.LONG_WAIT_MS ?? 60 * 60_000);
const fold = (s) => (s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

const CV_TEXT = [
  'Elena Marsh',
  `${EMAIL} | +41 79 555 01 23`,
  'Lausanne, Switzerland',
  '',
  'EXPERIENCE',
  '',
  'IT Project Manager, Nordic Retail Group, Geneva — Mar 2021 - Present',
  '- Led the checkout replatforming in Zurich and delivered it two months ahead of plan.',
  '',
  'Project Coordinator, Baltic Software House, Warsaw — Jun 2017 - Feb 2021',
  '- Coordinated releases for four agile squads.',
].join('\n');
const EXPECT_NAME = process.env.EXPECT_NAME ?? (CV_PDF ? '' : 'Elena Marsh');

// The title is French and the body English: the paste door reads English adverts only (a French
// body is refused, "English is the only language we can read at the moment"), and #454 wants a
// French title over an English CV kept in French.
const ADVERT = `Chef de projet IT H/F — Groupe Valmora
Lyon, France

Ref. VAL-${RUN} · Permanent contract · Hybrid
Groupe Valmora is hiring a Chef de projet IT to lead the rebuild of its billing system.

What you will do
- Own the plan, the budget and the risks of the project
- Coordinate business teams, technical teams and suppliers
- Run the steering committees and report progress

What we are looking for
- Proven experience managing IT projects
- Working knowledge of agile methods`;

const qa = await createSession('spec-450-letterhead-headline-journey', { baseURL: BASE, viewport: { width: 1280, height: 900 } });
const { page } = qa;
page.setDefaultTimeout(30_000);
const runDir = path.join(process.cwd(), 'qa-results', `spec-450-pdfs-${RUN}`);
mkdirSync(runDir, { recursive: true });

const defects = [];
const must = async (ok, note) => {
  if (ok) return qa.expectVisible('body', `PASS — ${note}`);
  defects.push(note);
  return qa.expectVisible('#defect-no-such-element', `FAIL — ${note}`);
};
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

/** The PDF's text, through poppler's pdftotext when the machine has it. */
const pdfText = (file) => {
  try {
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  } catch {
    return null;
  }
};

/** Prints a CV document the way documentMaker.ts does (A4, 12mm, backgrounds), to a file. */
async function printToPdf(html, name) {
  const ctx = await page.context().browser().newContext();
  const p = await ctx.newPage();
  await p.setContent(html, { waitUntil: 'load' });
  await p.evaluate('document.fonts.ready.then(() => undefined)');
  const pdf = await p.pdf({ format: 'A4', margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' }, printBackground: true });
  await ctx.close();
  const file = path.join(runDir, name);
  writeFileSync(file, pdf);
  return file;
}

/** The letterhead's three lines, read off a CV document inside an iframe. */
const letterheadOf = (frameSel) =>
  page.frameLocator(frameSel).locator('body').evaluate(() => {
    const t = (s) => document.querySelector(s)?.innerText?.trim() ?? null;
    const order = [...document.querySelectorAll('h1, .contact, .headline')].map((e) => e.tagName === 'H1' ? 'name' : e.className);
    return { name: t('h1'), contact: t('.contact'), headline: t('.headline'), order };
  });

/** Waits for a CV document; the screen's own three-minute ceiling can pass on the slow CLI route,
 *  and then she presses Try again (nothing already done is re-done). */
async function documentOrRetry(ready, where) {
  const retry = page.getByRole('button', { name: 'Try again' });
  for (let i = 0; i < 20; i += 1) {
    const which = await Promise.race([
      ready.waitFor({ state: 'attached', timeout: LONG }).then(() => 'doc', () => 'none'),
      retry.waitFor({ state: 'visible', timeout: LONG }).then(() => 'retry', () => 'none'),
    ]);
    if (which !== 'retry') return;
    await qa.click(retry, `${where}: the wait passed the screen's ceiling — she presses Try again`);
  }
}

await qa.goto('/', 'the front door');
const fake = await page.evaluate(async () => (await fetch('/api/qa/llm-calls')).ok).catch(() => false);
await qa.note(`stack: ${fake ? 'FAKE model (qa-main.js)' : 'REAL product (main.js; model calls via the local CLI)'}; CV: ${CV_PDF ? path.basename(CV_PDF) : 'pasted text'}`);

// START_AT=profile (with JC_SESSION): a session whose read and check mode are already done —
// the slow CLI route makes the document half worth re-running on its own.
if (process.env.START_AT === 'profile') {
  await page.context().addCookies([{ name: 'jc_session', value: process.env.JC_SESSION, url: BASE }]);
  await qa.note('START_AT=profile: the read and check mode of this session were done in an earlier run');
} else {
// 1. The CV goes in through the front door.
let jobId = process.env.JOB_ID;
/** Waits on the read itself, polled the way the page's own fetches see it. */
const readOver = async (id) => {
  const t0 = Date.now();
  for (;;) {
    const status = await page.evaluate(async (j) => (await (await fetch(`/api/jobs/${j}`)).json()).status, id).catch(() => null);
    if (status === 'completed' || status === 'failed') return `${status} after ${Math.round((Date.now() - t0) / 1000)} s`;
    if (Date.now() - t0 > LONG) return 'still running at the time limit';
    await page.waitForTimeout(5000);
  }
};
const intent = page.getByRole('heading', { name: /What kind of job are you going for/ });
if (process.env.JC_SESSION) {
  // The read was started over the wire with the same file (POST /uploads → PUT → complete) on this
  // session; the browser picks the session up, as a person coming back would.
  await page.context().addCookies([{ name: 'jc_session', value: process.env.JC_SESSION, url: BASE }]);
  await qa.note(`session resumed; its read (job ${jobId}): ${await readOver(jobId)}`);
} else if (CV_PDF) {
  page.on('response', async (r) => {
    if (jobId || r.request().method() !== 'POST' || !r.url().includes('/api/')) return;
    const body = await r.json().catch(() => null);
    if (body?.jobId) jobId = body.jobId;
  });
  await page.mouse.click(10, 10);
  await qa.click(page.getByRole('button', { name: 'Ready?' }), 'Ready? — through the invitation');
  await qa.click(page.getByRole('button', { name: /Use my CV/ }), 'chooses "Use my CV"');
  await page.locator('input[type="file"]').setInputFiles(CV_PDF);
  await qa.note('she picks her PDF');
  for (let i = 0; i < 120 && !jobId; i += 1) await page.waitForTimeout(500);
  await qa.note(`the upload's read (job ${jobId}): ${await readOver(jobId)}`);
} else {
  jobId = await qa.frontDoorPaste(CV_TEXT, 'she pastes her CV');
  await qa.note(`the read (job ${jobId}): ${await readOver(jobId)}`);
}
await qa.goto('/', 'the front door once the read is over');
const atIntent = await intent.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false);
if (atIntent) {
  await qa.fill('#target-role', 'Chef de projet', 'question 1 — the job she is going for');
  await qa.fill('#search-area', 'Lausanne', 'where she wants to work');
  await qa.click('button:has-text("Save and continue")', 'Save and continue');
  await page.waitForURL(/\/profile\/check/, { timeout: 60_000 }).catch(() => {});
} else await qa.note('the front door did not offer the job question for this session; on to check mode directly');
if (!/\/profile\/check/.test(page.url())) await qa.goto('/profile/check', 'check mode');

// 2. "Reading your CV" — the name at the top of the sheet, no title line under it.
const readingH = page.getByRole('heading', { name: 'Reading your CV' });
const sawReading = await readingH.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
if (sawReading) {
  const rows = await page.locator('.sheet p').allInnerTexts();
  const review = await page.evaluate(async () => (await fetch('/api/review')).json());
  const name = review.letterhead?.name?.value ?? null;
  const firstHeading = review.sections?.[0]?.heading ?? null;
  await qa.note(`the sheet's first rows: ${JSON.stringify(rows.slice(0, 3))}; letterhead name ${JSON.stringify(name)}, first section ${JSON.stringify(firstHeading)}`);
  await qa.expectVisible(page.locator('.sheet'), '"Reading your CV": her CV as the sheet');
  await must(!!name && rows[0] === name, `#453 the sheet opens on her name (${JSON.stringify(rows[0])})`);
  await must(rows[1] === firstHeading, `#453 the row under the name is the first section heading, not a title line (${JSON.stringify(rows[1])})`);
  await must(!('title' in (review.letterhead ?? {})), '#453 the review letterhead carries no title field');
} else {
  await qa.note('the check run finished before "Reading your CV" could be seen (fast stack); the mocked check-mode spec covers the sheet');
}
await page.getByRole('heading', { name: 'Your details' }).waitFor({ state: 'visible', timeout: LONG });

// 3. Your details — the name the CV writes, a city that is not a job bullet, no Title field.
await qa.expectText(page.locator('h1'), 'Your details', 'check mode opens on Your details');
const values = {};
for (const f of ['name', 'location', 'phone', 'email']) values[f] = await page.locator(`input[name=${f}]`).inputValue().catch(() => null);
await qa.note(`Your details as read: name ${JSON.stringify(values.name)}, city ${JSON.stringify(values.location)}, phone ${values.phone ? 'filled' : 'empty'}, email ${values.email ? 'filled' : 'empty'}`);
await qa.expectVisible('input[name=name]', `the name field reads "${values.name}"`);
if (EXPECT_NAME) await must(fold(values.name) === fold(EXPECT_NAME), `#409/#451 the name is the candidate's own ("${values.name}")`);
else await must(!!values.name, `#451 a name was read ("${values.name}")`);
await qa.expectVisible('input[name=location]', `the city field reads "${values.location}"`);
const city = values.location ?? '';
await must(
  city.length <= 60 && !/[••;]|\b(réaliser|realiser|led|managed|piloter|coordin)/i.test(city),
  `#444 the city is not a job bullet (${JSON.stringify(city)})`,
);
if (process.env.EXPECT_CITY_HINT) await must(fold(city).includes(fold(process.env.EXPECT_CITY_HINT)), `#451 the city is the letterhead's own place (${JSON.stringify(city)})`);
await must(!!values.phone && !!values.email, '#451 phone and email are read as before');
await must((await page.locator('input[name=title]').count()) === 0, '#453 Your details (check mode) has no Title field');
const labels = await page.locator('.card.form .fields label, .card.form .fields .label').allInnerTexts().catch(() => []);
await qa.note(`Your details' field labels: ${JSON.stringify(labels)}`);
await must(!labels.some((l) => /title/i.test(l)), '#453 no field is labelled Title');
await qa.scrollThrough('Your details');

// 4. Sign in and finish check mode over the wire (the check-mode journeys walk it on screen).
const signed = await page.evaluate(async ({ email }) => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const res = await post('/api/auth/request-link', { email });
  const link = await res.json();
  if (!link.devLink) return `sign-in failed (${res.status})`;
  const v = await post('/api/auth/verify', { token: new URL('http://x' + link.devLink).searchParams.get('token') });
  return v.ok ? 'ok' : `verify ${v.status}`;
}, { email: EMAIL });
await must(signed === 'ok', `she signs in (${signed})`);
await page.reload();
await qa.completeReview();

}

// 5. The profile's contact panel — the same four fields, no Title.
await qa.goto('/profile', 'her profile');
const panel = page.locator('.rcontact');
await panel.waitFor({ state: 'visible' });
const cxLabels = await panel.locator('.cxlabel').allInnerTexts();
await qa.expectVisible(panel, `the profile's contact panel: ${JSON.stringify(cxLabels)}`);
await must(cxLabels.length === 4 && !cxLabels.some((l) => /title/i.test(l)), `#453 the profile shows four contact fields and no Title (${JSON.stringify(cxLabels)})`);
await must(!(await panel.innerText()).includes('Title'), '#453 the word Title is nowhere in the contact panel');
await qa.scrollThrough('the profile');

// 6. "Preview as CV" — the person's own job's title as the headline, on screen and in the PDF.
const blocks = await page.evaluate(async () => (await (await fetch('/api/job-blocks')).json()).blocks ?? []);
const jobs = blocks.filter((b) => b.kind === 'job');
const current = jobs.filter((b) => b.end?.value?.state === 'ongoing');
const ownTitles = (current.length ? current : jobs).map((b) => b.title?.value).filter(Boolean);
await qa.note(`own job title(s) on record (${current.length ? 'current' : 'most recent candidates'}): ${JSON.stringify(ownTitles)}`);
await qa.click(page.locator('.preview-door'), 'presses Preview as CV');
await documentOrRetry(page.locator('.preview-frame'), 'Preview as CV');
const pv = await letterheadOf('.preview-frame');
await qa.expectVisible(page.locator('.preview-frame'), `the preview's letterhead: ${JSON.stringify(pv)}`);
await must(!!pv.headline && ownTitles.some((t) => fold(t) === fold(pv.headline)), `#454 the preview's headline is her own job's title ("${pv.headline}")`);
await must(pv.order.join('>') === 'name>contact>headline', `#439 name, then contact, then headline (${pv.order.join('>')})`);
const download = page.waitForEvent('download', { timeout: 120_000 });
await qa.click('button.preview-download', 'presses Download PDF');
const pvFile = path.join(runDir, 'preview.pdf');
await (await download).saveAs(pvFile);
const pvText = pdfText(pvFile);
if (pvText === null) await qa.note('the preview PDF could not be read as text (no pdftotext here, or the stand-in of the fake stack document maker); saved, not read');
else if (!pvText.trim()) await qa.note('the preview PDF holds no text (a stand-in document maker); its text is checked on the real stack');
else await must(fold(pvText).includes(fold(pv.headline)), `#454 the downloaded preview PDF prints the headline ("${pv.headline}") — ${pvFile}`);

// 7. A pasted French ad: the headline is its title without its labels, on screen and in the PDF.
await qa.goto('/paste', 'she brings in a job she found herself');
await qa.fill(page.locator('#advert'), ADVERT, 'pastes a French ad titled "Chef de projet IT H/F"');
await qa.click(page.getByRole('button', { name: 'Read it' }), "press 'Read it'");
let pasted = 'none';
for (let attempt = 0; attempt < 3 && pasted !== 'job'; attempt += 1) {
  if (attempt > 0) await qa.click(page.getByRole('button', { name: /Read it/ }).first(), 'the read came back short — she presses Read it again, as the screen says');
  pasted = await Promise.race([
    page.waitForURL(/\/job\//, { timeout: LONG }).then(() => 'job', () => 'none'),
    page.getByText(/is not in English|could not read|came out of the advert/i).first().waitFor({ state: 'visible', timeout: LONG }).then(async () => `refused: ${(await page.locator('main').innerText().catch(() => '')).slice(0, 200)}`, () => 'none'),
  ]);
  await qa.note(`the ad's read: ${pasted}`);
}
await must(pasted === 'job', `the pasted ad is read and opens on its own screen (${pasted})`);
await qa.click(page.getByRole('button', { name: 'Write the tailored CV' }), 'press "Write the tailored CV"');
await documentOrRetry(page.frameLocator('.draft-frame').locator('.headline'), 'the tailored CV');
const lh = await letterheadOf('.draft-frame');
await qa.expectVisible(page.locator('.draft-frame'), `the tailored CV's letterhead: ${JSON.stringify(lh)}`);
if (fake) await must(fold(lh.headline).startsWith('chef de projet it'), `#454 (fake tailor) the headline is the ad's title ("${lh.headline}")`);
else await must(lh.headline === 'CHEF DE PROJET IT', `#454 the headline is "CHEF DE PROJET IT" ("${lh.headline}")`);
await must(lh.order.join('>') === 'name>contact>headline', `#439 the headline sits under the contact line (${lh.order.join('>')})`);
await qa.scrollThrough('the tailored CV');
const html = await page.locator('.draft-frame').getAttribute('srcdoc');
const cvFile = await printToPdf(html, 'tailored.pdf');
const cvText = pdfText(cvFile);
if (cvText === null) await qa.note('pdftotext is not on this machine; the tailored PDF was saved but not read');
else {
  const lines = cvText.split('\n').map((l) => l.trim()).filter(Boolean);
  await qa.note(`the tailored PDF's first lines: name, contact, ${JSON.stringify(lines[2] ?? null)} — ${cvFile}`);
  // pdftotext can run the centred letterhead lines together; the letterhead is the text's opening.
  if (!fake) await must(/CHEF DE PROJET IT/.test(lines.slice(0, 4).join(' ')) && !/CHEF DE PROJET IT H\/F/.test(cvText), '#454 the printed PDF carries "CHEF DE PROJET IT" in its letterhead, without "H/F"');
}

const ok = await qa.finish();
console.log(defects.length ? `DEFECTS:\n- ${defects.join('\n- ')}` : 'no defects');
process.exit(ok ? 0 : 1);
