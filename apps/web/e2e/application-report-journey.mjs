// #315 "The application report" — the live journey, human-paced, over the REAL fake-model QA stack
// (qa-main: stage-aware fake model incl. the report call, StandInDocumentMaker, DevMailer). He
// reaches the draft, presses "Approve and email me this CV" once, and the narration now carries a
// step between the print and the mail: "Writing your application report…". Then "Done".
//
// What it proves, in the order he meets it:
//   1  a found job: one press -> Done; exactly ONE report call was spent (GET /qa/llm-calls)
//   2  the screen renders "Writing your application report…" when the server narrates `reporting`
//      (the stand-in is instant, so step 2 holds the progress stream — the ONLY interception here)
//   3  a re-press on the same document spends NO second report call (the checkpoint)
//   4  a job he PASTED, with a link in its text and ten days old: press -> Done, one more report call
//   5  (only when MAIL_LOG names the file the API's mail-recording wrapper writes) the email bodies:
//      five numbered sections in order and nothing else; section 1 opens on the apply line — "No
//      apply link was saved for this job." on the found job, "Apply here: <link>" on the pasted one —
//      and the pasted one carries its ageing line. On a QA_PDF_PAGES=3 stack the shortening notice
//      rides at the end of section 4 under "Check before you send the CV:".
//
// The DevMailer prints only the subject; MAIL_LOG is optional so this journey also runs in CI
// against plain qa-main, where steps 1-4 still hold and step 5 is noted as skipped.
//
//   PORT=34315 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js     (optionally QA_PDF_PAGES=3)
//   cd apps/web && API_URL=http://127.0.0.1:34315 npx next build && npx next start -p 34314
//   BASE_URL=http://127.0.0.1:34314 node apps/web/e2e/application-report-journey.mjs

import { readFileSync, existsSync } from 'node:fs';
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const MAIL_LOG = process.env.MAIL_LOG ?? null;
const ROLE = 'IT project manager in Brussels';
const EMAIL = `app-report-${Date.now()}@example.com`;
const LINK = `https://careers.example.com/jobs/${Date.now()}/apply`;

const S1 = 'Approve and email me this CV';
const S3 = 'Making your PDF…';
const S5 = 'Emailing it to you…';
const S6 = 'Done — your CV is made and the email is on its way.';
const S10 = 'Writing your application report…';
const HEADINGS = [
  '1. The job, in short',
  '2. Where you are strong',
  '3. Where you are not, and what to say',
  '4. Be ready to explain',
  '5. Salary',
];

const ADVERT = `Senior IT Project Manager — Calderon Systems
Brussels, Belgium · Hybrid

Calderon Systems is looking for a Senior IT Project Manager to lead the delivery of our ERP rollout.

What you will do
- Own the end-to-end delivery of the programme, from the business case through to go-live.
- Coordinate business and technical stakeholders and report progress to the steering committee.
- Identify, track and mitigate risks, issues and dependencies.

What we are looking for
- At least six years managing IT projects.
- Excellent stakeholder communication at executive level.

Apply at ${LINK}`;

const qa = await createSession('application-report-journey', { baseURL: BASE, viewport: { width: 430, height: 932 } });
const { page } = qa;

const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
const api = (path, init) =>
  page.evaluate(
    async ([p, i]) => {
      const r = await fetch(p, i ?? undefined);
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [path, init ?? null],
  );
const postJson = (path, body) =>
  api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const reportCalls = async () => (await api('/api/qa/llm-calls')).body?.report;
const mails = () =>
  MAIL_LOG && existsSync(MAIL_LOG)
    ? readFileSync(MAIL_LOG, 'utf8')
        .split('=====MAIL to ')
        .slice(1)
        .map((m) => ({ to: m.split(' |')[0], text: m.split('\n').slice(1).join('\n').split('=====END')[0] }))
        .filter((m) => m.to === EMAIL)
    : null;

async function readThrough(note) {
  await qa.note(note);
  await page.evaluate(async () => {
    const el = document.querySelector('.live-wrap') ?? document.scrollingElement;
    for (let y = 0; y < el.scrollHeight; y += 260) {
      el.scrollTo({ top: y, behavior: 'smooth' });
      await new Promise((r) => setTimeout(r, 260));
    }
  });
  await page.waitForTimeout(900);
}

async function openDraft(note) {
  await qa.click(page.getByRole('button', { name: "I'm done — use this CV" }), note);
  await page.locator('.draft-frame').waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
  await qa.expectVisible('.draft-frame', 'the tailored CV draft is shown');
  await readThrough('read down through the draft to the send block');
}

/** One un-intercepted press, waited to Done. Returns the job record's tailorExport progress. */
async function pressAndWait(note) {
  const response = page.waitForResponse((r) => r.url().includes('/api/onboarding/tailor/approve'));
  await qa.click(page.getByRole('button', { name: S1 }), note);
  const res = await response;
  const jobId = (await res.json().catch(() => ({}))).jobId;
  await assert(res.status() === 202, `the press is accepted (${res.status()})`);
  await page.getByText(S6).waitFor({ timeout: 60_000 }).catch(() => {});
  await qa.expectText('.draft-send', S6, 'Done — the document is made and the email is on its way');
  const job = await api(`/api/jobs/${jobId}`);
  await qa.note(`job record: ${job.body?.status} ${JSON.stringify(job.body?.progress?.tailorExport)}`);
  return job.body?.progress?.tailorExport ?? {};
}

/** The email body's five sections, checked in order and alone. */
async function checkBody(text, label, { firstLine, ageing, pages }) {
  const at = HEADINGS.map((h) => text.indexOf(h));
  await assert(at.every((i) => i >= 0), `${label}: all five section headings are in the email`);
  await assert([...at].sort((a, b) => a - b).join() === at.join(), `${label}: the five sections are in order`);
  await assert(!/^\s*6\. /m.test(text) && !/Verification|Checklist|Keyword|Follow-up|Intentional omissions/i.test(text),
    `${label}: nothing else — no sixth section, no audit, checklist, keywords or follow-up questions`);
  const section1 = text.slice(at[0] + HEADINGS[0].length).trim().split('\n');
  await assert(section1[0] === firstLine, `${label}: section 1 opens on "${firstLine}" (got "${section1[0]}")`);
  if (ageing) {
    const s1 = text.slice(at[0], at[1]);
    await assert(/pasted|still open/i.test(s1), `${label}: section 1 carries the ageing line`);
  }
  const s5 = text.slice(at[4]);
  await assert(s5.includes('The advert does not state a salary.'), `${label}: section 5 says plainly the advert states no salary`);
  if (pages > 2) {
    const s4 = text.slice(at[3], at[4]);
    await assert(s4.includes('Check before you send the CV:') && /pages/.test(s4.split('Check before you send the CV:')[1] ?? ''),
      `${label}: the page notice rides at the end of section 4 under "Check before you send the CV:"`);
  }
}

// ---------------------------------------------------------------------------------------------
// 0. Seed: discovery + his CV's facts + real magic-link sign-in.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'land on discovery — establishes the anonymous session');
await postJson('/api/onboarding/discovery/start', { role: ROLE });
const facts = await qa.factsFromCv();
if (!(facts > 0)) throw new Error(`his CV gave the session no facts (${facts})`);
const link = await postJson('/api/auth/request-link', { email: EMAIL });
if (!link.body?.devLink) throw new Error(`sign-in failed (${link.status}): ${JSON.stringify(link.body)}`);
await postJson('/api/auth/verify', { token: new URL('http://x' + link.body.devLink).searchParams.get('token') });
await qa.note(`signed in as ${EMAIL}, ${facts} facts on his record`);

// ---------------------------------------------------------------------------------------------
// 1. A found job: deck -> want -> Tailor -> draft -> one press -> Done, one report call.
// ---------------------------------------------------------------------------------------------
await qa.goto('/deck', 'the reveal');
await qa.click(page.getByRole('button', { name: 'See them' }), 'See them');
await qa.click(page.getByRole('button', { name: 'I want this one, tailor this job' }), 'swipe right — I want this one');
await page.waitForURL('**/tailor', { timeout: 15_000 });
await openDraft("I'm done — use this CV");
const before = await reportCalls();
const found = await pressAndWait('press "Approve and email me this CV" — once');
const afterFirst = await reportCalls();
await assert(afterFirst - before === 1, `one press spent exactly one report call (${before} -> ${afterFirst})`);

// ---------------------------------------------------------------------------------------------
// 2. The new narration step renders when the server says `reporting`. Hold the stream and serve
//    the server's own mid-run snapshot shapes: printing -> reporting -> sending.
// ---------------------------------------------------------------------------------------------
await qa.goto('/tailor', 'reload — a fresh screen for the narration check');
await openDraft("I'm done — use this CV (the ending is screen state)");
await page.route('**/api/jobs/*/events', async (route) => {
  const snap = (step) =>
    `data: ${JSON.stringify({ id: 'held', status: 'running', progress: { tailorExport: { step } } })}\n\n`;
  await new Promise((r) => setTimeout(r, 6000));
  await route.fulfill({
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    body: snap('printing') + snap('reporting'),
  }).catch(() => {}); // a reconnect still held when the route is lifted
});
await qa.click(page.getByRole('button', { name: S1 }), 'press again (the stream is held to watch each step)');
await qa.expectText('.draft-send', S3, `narration: "${S3}"`);
await page.getByText(S10).waitFor({ timeout: 15_000 }).catch(() => {});
await qa.expectText('.draft-send', S10, `narration, the new step: "${S10}"`);
await page.unroute('**/api/jobs/*/events');
await page.waitForTimeout(1500);

// ---------------------------------------------------------------------------------------------
// 3. That re-press went to the server on an unchanged document: the checkpoint answers it.
// ---------------------------------------------------------------------------------------------
const afterSecond = await reportCalls();
await assert(afterSecond === afterFirst, `the re-press re-spent nothing on the report (${afterFirst} -> ${afterSecond})`);

// ---------------------------------------------------------------------------------------------
// 4. A job he pasted, with the apply link in its text, ten days old.
// ---------------------------------------------------------------------------------------------
const aged = await postJson('/api/qa/stack', { pasteDaysAgo: 10 });
await qa.note(`paste clock: ${JSON.stringify(aged.body)}`);
await qa.goto('/paste', 'the paste door');
await qa.fill(page.locator('#advert'), ADVERT, 'paste the advert, its apply link at the bottom');
await qa.click(page.getByRole('button', { name: 'Read it' }), "press 'Read it'");
await page.waitForURL(/\/job\//, { timeout: 180_000 }).catch(() => {});
await page.locator('.onejob .jobcard').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
await qa.expectVisible('.onejob .jobcard', "the pasted job's own screen");
await qa.scrollThrough('read the pasted job');
await qa.click(page.getByRole('button', { name: 'Write the tailored CV' }), 'Write the tailored CV');
await page.waitForURL('**/tailor', { timeout: 15_000 });
await openDraft("I'm done — use this CV (the pasted job)");
const pasted = await pressAndWait('press "Approve and email me this CV" on the pasted job');
const afterPasted = await reportCalls();
await assert(afterPasted - afterSecond === 1, `the pasted job's press spent one report call (${afterSecond} -> ${afterPasted})`);
await postJson('/api/qa/stack', { pasteDaysAgo: 0 });

// ---------------------------------------------------------------------------------------------
// 5. The email bodies, when the mail-recording wrapper is in front of the API.
// ---------------------------------------------------------------------------------------------
const sent = mails();
if (!sent) await qa.note('MAIL_LOG not set — the email bodies are not readable on this stack; step 5 skipped');
else {
  await assert(sent.length === 3, `three emails reached his address (got ${sent.length})`);
  await assert(sent[0].text === sent[1].text, 'the re-press sent the same report, word for word (checkpoint)');
  await qa.note(`found-job email:\n${sent[0].text}`);
  await checkBody(sent[0].text, 'found job', { firstLine: 'No apply link was saved for this job.', pages: found.pages });
  await qa.note(`pasted-job email:\n${sent[2].text}`);
  await checkBody(sent[2].text, 'pasted job', { firstLine: `Apply here: ${LINK}`, ageing: true, pages: pasted.pages });
}

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
