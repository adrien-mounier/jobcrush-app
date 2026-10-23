// Spec #301 finish (#397 #400 #401) — the QA gate's live journey, human-paced, over the fake-model
// QA stack (qa-main: canned paste reader, fake judge, fake report writer, StandInDocumentMaker).
//
// What it proves, in the order a person meets it:
//   #400a  a text with no title line, from which a title CAN be worked out: the question shows the
//          worked-out title in the field, says it was worked out; confirm -> the job screen shows it
//   #400b  a text with no title line and nothing to work out: the question has an empty field and
//          no "worked out" line, the button waits for a title; he leaves it open past the browser's
//          old 180 s ceiling (QA_TITLE_HOLD_MS, default 0 so CI stays fast), types one -> job screen
//   #400   "Title not stated" nowhere: screen, GET /onboarding/jobs/:adId, email subject, file name
//   #397   one job, one number: paste result, job screen, deck (when the pasted job is on it) and
//          tailor screen carry the same percentage and the same band word; the tailor's screen-reader
//          announcement has no empty slot
//   #401   approve on a QA_PDF_PAGES=3 stack and read the email (MAIL_LOG, written by a mail-recording
//          wrapper in front of qa-main — the DevMailer prints only the subject): the notices sit
//          right after the attachment line under "Check before you send the CV:", section 4 holds
//          none; the Brussels job (unplaceable) says "Job location unknown"; a job in Vietnam keeps
//          the market line; the requirements he said "No" to are in section 3 with a say sentence or
//          the nothing-close line, never dropped
//
//   PORT=34315 OPS_KEY=qa-ops-key QA_PDF_PAGES=3 node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34315 npx next build && npx next start -p 34314
//   BASE_URL=http://127.0.0.1:34314 [MAIL_LOG=<file>] [QA_TITLE_HOLD_MS=215000] node apps/web/e2e/spec-301-finish-journey.mjs
import { readFileSync, existsSync } from 'node:fs';
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const MAIL_LOG = process.env.MAIL_LOG ?? null;
const HOLD_MS = Number(process.env.QA_TITLE_HOLD_MS ?? 0);
const RUN = Date.now(); // a pasted advert is keyed on its text: the stamp keeps the journey re-runnable
const EMAIL = `spec301-${RUN}@example.com`;
const PLACEHOLDER = 'Title not stated';
const CHECK_H = 'Check before you send the CV:';
const UNKNOWN = 'Job location unknown. We have not checked whether you can work there. Check it before you apply.';
const NOTHING_CLOSE = 'You have nothing close to this. Expect it to come up.';

const body = (head, place) => `${head}
${place}

Ref ${RUN}. You will run the delivery of our platform replacement across three sites, own the plan,
coordinate the integrator and our own IT team, and report to the programme board every fortnight.

What we are looking for
- Own the end-to-end delivery of the programme, from the business case through to go-live.
- Coordinate business and technical stakeholders and report progress to the steering committee.
- Identify, track and mitigate risks, issues and dependencies.
- Excellent stakeholder communication at executive level.`;

const WORKED_OUT = 'Delivery Project Manager';
const ADVERT_WORKED_OUT = body('About the role at Norvik Logistics', 'Antwerp, Belgium').replace(
  'Ref ',
  `Role: ${WORKED_OUT}\n\nRef `,
);
const TYPED = 'Programme Delivery Lead';
const ADVERT_NO_TITLE = body('About the role at Calvaro Systems', 'Brussels, Belgium');
const ADVERT_VIETNAM = body('Senior Project Manager — Mekong Digital', 'Ho Chi Minh City, Vietnam');

const qa = await createSession('spec-301-finish-journey', { baseURL: BASE, viewport: { width: 1280, height: 900 } });
const { page } = qa;

const defects = [];
const must = async (ok, note) => {
  if (ok) return qa.expectVisible('body', `PASS — ${note}`);
  defects.push(note);
  return qa.expectVisible('#defect-no-such-element', `FAIL — ${note}`);
};
const api = (p, init) =>
  page.evaluate(
    async ([path, i]) => {
      const r = await fetch(path, i ?? undefined);
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [p, init ?? null],
  );
const postJson = (p, b) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const mails = () =>
  MAIL_LOG && existsSync(MAIL_LOG)
    ? readFileSync(MAIL_LOG, 'utf8')
        .split('=====MAIL to ')
        .slice(1)
        .map((m) => {
          const [to, subject, filename] = m.split('\n')[0].split(' | ');
          return { to, subject, filename, text: m.split('\n').slice(1).join('\n').split('=====END')[0] };
        })
        .filter((m) => m.to === EMAIL)
    : null;

/** The score and band a screen shows on its job card: the ring's accessible name and the pill. */
async function scoreOn(scope, label) {
  const ring = page.locator(`${scope} .score.lg[role="img"]`).first();
  await ring.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500); // the tailor tweens its number in; read it settled
  const name = (await ring.getAttribute('aria-label').catch(() => null)) ?? '';
  const pill = page.locator(`${scope} .bd-pill`).first();
  const band = ((await pill.textContent().catch(() => null)) ?? '').trim();
  const pct = Number(name.match(/^(\d+)%/)?.[1] ?? NaN);
  await qa.expectVisible(ring, `${label}: the score reads "${name}"`);
  if (band) await qa.expectVisible(pill, `${label}: the band word reads "${band}"`);
  return { pct, band };
}

/** Paste, press Read it, and return the job id the POST answered (the paste result is read off it). */
async function pasteAndRead(text, note) {
  await qa.goto('/paste', 'the paste door');
  await page.getByRole('heading', { name: 'Paste a job you found' }).waitFor({ timeout: 20_000 }).catch(() => {});
  await qa.fill(page.locator('#advert'), text, note);
  const posted = page.waitForResponse((r) => r.url().endsWith('/api/onboarding/paste') && r.request().method() === 'POST');
  await qa.click(page.getByRole('button', { name: 'Read it' }), "press 'Read it'");
  return (await (await posted).json().catch(() => ({}))).jobId;
}

async function landOnJob(label) {
  await page.waitForURL(/\/job\//, { timeout: 180_000 }).catch(() => {});
  await page.locator('.jobscreen .jobcard h2').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  const adId = decodeURIComponent(new URL(page.url()).pathname.replace(/^\/job\//, ''));
  const title = ((await page.locator('.jobscreen .jobcard h2').textContent().catch(() => '')) ?? '').trim();
  await qa.expectVisible('.jobscreen .jobcard h2', `${label}: the job screen's title reads "${title}"`);
  return { adId, title };
}

/** #397: the same job's number on every screen that names it, ending on the tailor screen. */
async function oneNumber(pasteJobId, adId, label) {
  const job = await scoreOn('.jobscreen', `${label} — job screen`);
  const pasteResult = (await api(`/api/jobs/${pasteJobId}`)).body?.progress?.paste?.result?.card?.matchPct;
  const deck = (await api('/api/onboarding/cards')).body?.cards?.find((c) => c.adId === adId)?.matchPct;
  await qa.scrollThrough(`${label}: read the job screen`);
  await qa.click(page.getByRole('button', { name: 'Write the tailored CV' }), 'Write the tailored CV');
  await page.waitForURL('**/tailor', { timeout: 15_000 }).catch(() => {});
  const tailor = await scoreOn('.tailor', `${label} — tailor screen`);
  const tailorApi = (await api('/api/onboarding/tailor')).body?.card?.matchPct;
  await qa.note(
    `${label} #397 — paste result ${pasteResult}% · job screen ${job.pct}% ${job.band} · deck ${deck ?? '(not on the deck)'}% · tailor screen ${tailor.pct}% ${tailor.band} · GET /tailor ${tailorApi}%`,
  );
  await must(
    Number.isFinite(job.pct) && job.pct === tailor.pct && job.pct === pasteResult && job.pct === tailorApi && (deck === undefined || deck === job.pct),
    `${label} #397 — one job, one percentage on every screen that names it (${job.pct}%)`,
  );
  // #411: the tailor screen's Match breakdown sits under its header, so its pill is read there too.
  await must(job.band !== '' && job.band === tailor.band, `${label} #397 — one band word on both screens ("${job.band}" / "${tailor.band}")`);
  const live = ((await page.locator('.tailor [aria-live="polite"]').first().textContent().catch(() => '')) ?? '').trim();
  await qa.note(`${label} — the tailor's screen-reader announcement: "${live}"`);
  await must(live.length > 0 && !/\.\s*\.|“”|""|^\s*\./.test(live), `${label} #397 — the announcement has no empty slot ("${live}")`);
}

// #415 (ADR-0020): the Tailor step takes no "No" to a requirement any more (the queue is gone),
// so #401's denied-requirement sentence can no longer be driven live here — it is pinned at the
// API seam (tailorExport.test.ts, a stored denial). The gaps the report names are the card's open
// rows, read back below.
async function openGaps() {
  const state = (await api('/api/onboarding/tailor')).body;
  return (state?.requirements ?? []).filter((r) => r.state === 'gap').map((r) => r.text);
}

async function approve(label) {
  // #415: the draft is the page — no press reaches it; a profile question this job left open is
  // answered once first.
  if ((await page.locator('.tailor .ask .q').count()) > 0) {
    await qa.click(page.locator('.tailor .opts .opt').first(), `${label}: a profile question first — answer it once`);
    await page.waitForTimeout(1400);
  }
  await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
  await qa.expectVisible('.draft-frame', `${label}: the tailored CV draft is shown (the fake tailor still drafts)`);
  await qa.scrollThrough(`${label}: read down the draft to the send block`);
  await qa.click(page.getByRole('button', { name: 'Approve and email me this CV' }), `${label}: Approve and email me this CV`);
  await page.getByText('Done — your CV is made and the email is on its way.').waitFor({ timeout: 90_000 }).catch(() => {});
  await qa.expectText('.draft-send', 'Done — your CV is made and the email is on its way.', `${label}: Done`);
}

// ---------------------------------------------------------------------------------------------
// 0. A signed-in person with a CV's worth of facts.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'land on discovery — the anonymous session');
const llm = await api('/api/qa/llm-calls');
await must(llm.status === 200, `the fake-model QA stack answered /qa/llm-calls (HTTP ${llm.status}) — not some other server`);
await postJson('/api/onboarding/discovery/start', { role: 'IT project manager in Brussels' });
const facts = await qa.factsFromCv();
if (!(facts > 0)) throw new Error(`his CV gave the session no facts (${facts})`);
const link = await postJson('/api/auth/request-link', { email: EMAIL });
await postJson('/api/auth/verify', { token: new URL('http://x' + link.body.devLink).searchParams.get('token') });
await qa.note(`signed in as ${EMAIL}, ${facts} facts on his record`);

// ---------------------------------------------------------------------------------------------
// 1. #400a — a title the reader worked out is put to him, prefilled, and said to be worked out.
// ---------------------------------------------------------------------------------------------
const ask = page.locator('[data-testid="paste-title-ask"]');
const jobA = await pasteAndRead(ADVERT_WORKED_OUT, 'paste a job body with no title line — a "Role:" line the reader can work the title out from');
await must(await ask.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false), '#400a — the title question appears before anything is stored');
const askA = ((await ask.innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
const prefilled = await page.locator('#jobtitle').inputValue().catch(() => '');
await qa.expectVisible(ask, `#400a — the question reads: "${askA}" · field: "${prefilled}"`);
await must(prefilled === WORKED_OUT, `#400a — the field carries the worked-out title ("${prefilled}")`);
await must(askA.includes('We think this job is called') && askA.includes('worked this one out'), '#400a — he is told the title was worked out from the text');
await must(!askA.includes(PLACEHOLDER), '#400a — the question never shows the placeholder');
const parkedA = (await api(`/api/jobs/${jobA}`)).body;
await qa.note(`#400a — while asking, GET /jobs/${jobA}: status ${parkedA?.status}, step ${parkedA?.progress?.paste?.step}, suggested "${parkedA?.progress?.paste?.suggested}"`);
await qa.click(page.getByRole('button', { name: 'Use this title' }), 'confirm the worked-out title');
const a = await landOnJob('#400a');
await must(a.title === WORKED_OUT, `#400a — the job screen shows the confirmed title ("${a.title}")`);
await oneNumber(jobA, a.adId, '#400a job');

// ---------------------------------------------------------------------------------------------
// 2. #400b — nothing to work out: an empty field, held open past the old ceiling, then typed.
// ---------------------------------------------------------------------------------------------
const jobB = await pasteAndRead(ADVERT_NO_TITLE, 'paste a job body with no title line and nothing to work a title out from (Brussels)');
await must(await ask.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true, () => false), '#400b — the title question appears');
const askB = ((await ask.innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
await qa.expectVisible(ask, `#400b — the question reads: "${askB}"`);
await must(askB.includes('We could not find the job title. What is the job called?'), '#400b — asked plainly what the job is called');
await must(!askB.includes('worked this one out'), '#400b — no "worked out" line when nothing was worked out');
await must((await page.locator('#jobtitle').inputValue()) === '', '#400b — the field starts empty');
await must(await page.getByRole('button', { name: 'Use this title' }).isDisabled(), '#400b — the button waits for a title');
if (HOLD_MS > 0) {
  await qa.note(`#400b — leaving the question open for ${Math.round(HOLD_MS / 1000)} s, past the browser's old 180 s ceiling`);
  const started = Date.now();
  await page.waitForTimeout(HOLD_MS);
  await qa.expectVisible(ask, `#400b — after ${Math.round((Date.now() - started) / 1000)} s the question is still on screen`);
  await must((await page.locator('[data-testid="paste-failure"]').count()) === 0, '#400b — no "did not come back" failure replaced it');
}
await qa.fill(page.locator('#jobtitle'), TYPED, 'type the title himself');
await qa.click(page.getByRole('button', { name: 'Use this title' }), 'Use this title');
const b = await landOnJob('#400b');
await must(b.title === TYPED, `#400b — the job screen shows the title he typed ("${b.title}")`);
const storedB = await api(`/api/onboarding/jobs/${encodeURIComponent(b.adId)}`);
await qa.note(`#400b — GET /onboarding/jobs/${b.adId} → ${storedB.status}, title "${storedB.body?.card?.title}"`);
await must(storedB.body?.card?.title === TYPED && !JSON.stringify(storedB.body).includes(PLACEHOLDER), '#400b — the stored job carries his title; the placeholder is nowhere in it');
await must(!(await page.evaluate(() => document.body.innerText)).includes(PLACEHOLDER), '#400b — the placeholder is nowhere on the job screen');
await oneNumber(jobB, b.adId, '#400b job');

// 3. #401 on the Brussels job: the requirements the CV does not meet, then approve. (#415: no
//    requirement is asked, so none can be denied here — the open gaps carry the report's sentence.)
const deniedB = await openGaps();
await qa.note(`#401 — the Brussels job's gaps ("Also asked, not on your CV"): ${JSON.stringify(deniedB)}`);
await approve('#401 Brussels job');

// ---------------------------------------------------------------------------------------------
// 4. A stated title is never questioned; a placed market (Vietnam) keeps its own line.
// ---------------------------------------------------------------------------------------------
const jobC = await pasteAndRead(ADVERT_VIETNAM, 'paste a job WITH a title line, in Ho Chi Minh City');
const c = await landOnJob('stated title');
await must((await ask.count()) === 0 && c.title === 'Senior Project Manager', `a stated title is used unasked ("${c.title}")`);
await oneNumber(jobC, c.adId, 'Vietnam job');
await approve('Vietnam job');

// ---------------------------------------------------------------------------------------------
// 5. The emails.
// ---------------------------------------------------------------------------------------------
const sent = mails();
if (!sent) {
  await qa.note('MAIL_LOG not set — the email bodies are not readable on this stack; the email checks are skipped');
} else {
  await must(sent.length === 2, `two emails reached his address (${sent.length})`);
  for (const m of sent) await qa.note(`email "${m.subject}" · attachment "${m.filename}":\n${m.text}`);
  const [brussels, vietnam] = sent;
  for (const [m, label] of [[brussels, 'Brussels email'], [vietnam, 'Vietnam email']]) {
    if (!m) continue;
    const at1 = m.text.indexOf('1. The job, in short');
    const at4 = m.text.indexOf('4. Be ready to explain');
    const at5 = m.text.indexOf('5. Salary');
    const lines = m.text.split('\n');
    await must(!`${m.subject} ${m.filename} ${m.text}`.includes(PLACEHOLDER), `${label} — "Title not stated" is not in the subject, the file name or the report`);
    await must(/is attached \(\d+ pages?, PDF\)/.test(lines[0]) && lines[2] === CHECK_H && lines[3]?.startsWith('- '),
      `${label} — the email opens on the attachment line, then "${CHECK_H}" and its notice`);
    await must(m.text.indexOf(CHECK_H) < at1 && m.text.split(CHECK_H).length === 2, `${label} — the notices sit once, before section 1`);
    await must(!m.text.slice(at4, at5).includes(CHECK_H) && !/pages/.test(m.text.slice(at4, at5)), `${label} — section 4 holds no notice`);
  }
  if (brussels) {
    await must(brussels.subject === `Your CV for ${TYPED} at Calvaro Systems` && brussels.filename === `CV - ${TYPED}.pdf`,
      `#400 — the subject and file name carry his typed title ("${brussels.subject}", "${brussels.filename}")`);
    const s3 = brussels.text.slice(brussels.text.indexOf('3. Where you are not'), brussels.text.indexOf('4. Be ready to explain'));
    for (const req of deniedB) {
      const line = s3.split('\n').find((l) => l.startsWith(`- ${req}`));
      await must(!!line && (/ — say: ".+"$/.test(line) || line.endsWith(NOTHING_CLOSE)),
        `#401 — a requirement the CV does not meet is in section 3 with a say sentence or the nothing-close line: ${line ?? '(missing)'}`);
    }
    await must(brussels.text.slice(brussels.text.indexOf('4. Be ready'), brussels.text.indexOf('5. Salary')).includes(UNKNOWN),
      '#401 — the Brussels job (the lookup cannot place it) says "Job location unknown" in section 4');
  }
  if (vietnam) {
    const s4 = vietnam.text.slice(vietnam.text.indexOf('4. Be ready'), vietnam.text.indexOf('5. Salary'));
    await must(s4.includes('This job is in Vietnam.') && !s4.includes(UNKNOWN), '#401 — a placed market keeps its own line, never "unknown"');
  }
}

await qa.note(defects.length ? `DEFECTS (${defects.length}): ${defects.join(' | ')}` : 'no defect found on any check this journey reaches');
const ok = await qa.finish();
process.exit(ok ? 0 : 1);
