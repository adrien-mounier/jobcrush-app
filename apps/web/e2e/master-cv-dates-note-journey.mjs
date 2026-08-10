// #159 — "my CV states only what I know", driven as a human, over a REAL stack.
//
// Import a CV that has one role with a START BUT NO END ("Old Corp, 2003") and one role with NO
// DATES AT ALL ("Small Ltd") -> the signup wall -> the claim deck -> the grill, where the date
// questions are LEFT BLANK on purpose -> the built master CV. What this journey exists to prove is
// the ONE piece of #159 with no unit test behind it (apps/web has no test runner — its `test`
// script is a no-op echo), plus the two render rules on the page a human actually sees:
//
//   1. the master CV carries the passive missing-dates note, and it neither blocks nor nags;
//   2. the question that asked for those dates never suggested an approximate answer was fine
//      (the SHIPPED question is LLM-phrased by makeGrillPhraser — templateQuestion is only its
//      fallback — so this is the phrasing a user really gets, not the template's);
//   3. nothing about the missing dates leaks onto the tailored CV, and no role prints an
//      uninvited "Present".
//
//   PORT=30181 node apps/api/dist/main.js
//   cd apps/web && API_URL=http://127.0.0.1:30181 npx next build && npx next start -p 30180
//   BASE_URL=http://127.0.0.1:30180 node apps/web/e2e/master-cv-dates-note-journey.mjs
//
// Ports are deliberately not 3000/3001 — another project on this machine defaults to those and the
// /api proxy would silently reach the wrong backend. API_URL is baked at `next build` time.
//
// This rides a real LLM mine + grill-phrase + tailor, so it is slow (~2-4 min) and costs a few
// calls. Run it serially: every run creates a session, and anonymous sessions are IP-limited.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:30180';

// One role dated in full, one with a start and no end, one with no dates at all — the exact shape
// #159's rules are about. Written to a temp file so the fixture can never drift from the intent.
const CV = `MEI CHAN
Senior Project Manager
Hong Kong | +852 5555 0000 | mei.chan@example.com

PROFESSIONAL EXPERIENCE

Senior Project Manager
Acme Bank, Hong Kong
March 2019 - June 2024
- Cut vendor onboarding from 12 weeks to 5 across 3 regional banks, saving HKD 4.2m a year.
- Led the core banking migration for 1.1 million customer accounts with zero unplanned downtime.
- Managed 7 vendors on a HKD 30m programme budget.

Project Coordinator
Old Corp, Hong Kong
2003
- Coordinated the branch rollout schedule across 14 sites.
- Kept the weekly steering pack for the programme director.

Office Administrator
Small Ltd, Hong Kong
- Answered the main switchboard and greeted visitors.
- Booked meeting rooms and managed the office diary.

EDUCATION
University of Hong Kong, 2002
BBA, Business Administration

CERTIFICATIONS
PMP, Project Management Institute, 2018

LANGUAGES
English (Fluent), Cantonese (Native)

NATIONALITY
Hong Kong
`;
const cvPath = join(mkdtempSync(join(tmpdir(), 'jc159-')), 'mei-chan-cv.txt');
writeFileSync(cvPath, CV);

const qa = await createSession('master-cv-dates-note-journey', {
  baseURL: BASE,
  viewport: { width: 430, height: 932 },
});
const { page } = qa;
page.setDefaultTimeout(20_000);

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

const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
const bodyText = () => page.evaluate(() => document.body.innerText || '');

// ---------------------------------------------------------------------------------------------
// 1. Bring the CV in.
// ---------------------------------------------------------------------------------------------
await qa.goto('/import', 'the import screen — where a CV enters the product');
await qa.scrollThrough('read the import doors top to bottom');
await page.locator('input[type="file"]').setInputFiles(cvPath);
await qa.note(`uploaded a CV with one full-dated role, one start-only role (Old Corp, 2003) and one undated role (Small Ltd)`);

// The mine is a real LLM call; the progress screen hands off to /preview/<jobId> on its own.
await page.waitForURL(/\/preview\//, { timeout: 180_000 });
await qa.note('the CV was read — the watermarked preview is ready');
await qa.scrollThrough('read the watermarked preview as a visitor would');

// ---------------------------------------------------------------------------------------------
// 2. Through the wall, to the deck.
// ---------------------------------------------------------------------------------------------
await qa.click('a.btn:has-text("Confirm my facts")', 'follow the invitation to confirm the facts');
await page.waitForURL(/\/signup/, { timeout: 30_000 });
await qa.expectVisible('input[aria-label="Email address"]', 'the signup wall stands between the draft and the verified CV');
await qa.fill('input[aria-label="Email address"]', `qa159+${Date.now()}@example.com`, 'give an email address');
await qa.click('button:has-text("Email me a sign-in link")', 'ask for the sign-in link');
await qa.click('a.btn:has-text("Open your sign-in link")', 'open the emailed sign-in link');
await page.waitForURL(/\/deck\//, { timeout: 60_000 });
await qa.expectText('h1', 'Confirm your facts', 'signed in, and landed on the claim deck');

// ---------------------------------------------------------------------------------------------
// 3. Confirm every fact the deck asks about.
// ---------------------------------------------------------------------------------------------
await qa.scrollThrough('read the whole deck before deciding anything');
for (let guard = 0; guard < 40; guard++) {
  const btn = page.locator('button:has-text("Looks right")').first();
  if (!(await btn.count())) break;
  await qa.click(btn, 'confirm a fact that came straight from the CV');
}
await qa.click('button:has-text("Continue")', 'continue — every fact reviewed');

// ---------------------------------------------------------------------------------------------
// 4. The grill. THE DATE QUESTION IS THE POINT — read it, then leave it blank.
// ---------------------------------------------------------------------------------------------
await page.locator('[data-testid="grill-question"]').first().waitFor({ timeout: 120_000 });
await qa.scrollThrough('read the questions that fill the gaps in the CV');
const questions = await page.locator('[data-testid="grill-question"] p').allTextContents();
await qa.note(`the questions actually shown: ${JSON.stringify(questions)}`);

const dateQs = questions.filter((q) => /date|when|from|month|year/i.test(q));
assert(dateQs.length > 0, `at least one question asks about the undated roles — got ${dateQs.length}`);
await qa.expectVisible('[data-testid="grill-question"]', 'the date question, as a real user is shown it (LLM-phrased, not the template)');

// AC: the question must not suggest an approximate answer is fine.
const APPROX = /roughly|approximate|ballpark|rough idea|thereabouts|give or take|near enough|doesn'?t have to be exact|no need to be (exact|precise)|best guess|estimate is fine|around when/i;
const sloppy = questions.filter((q) => APPROX.test(q));
assert(sloppy.length === 0, `no shown question invites an approximate answer — offenders: ${JSON.stringify(sloppy)}`);

// Leave every answer blank: this is the "genuinely does not know" person.
await qa.note('leaving every date question blank — this is someone who genuinely does not know');
await qa.click('button:has-text("Build my verified CV")', 'build the verified master CV with the dates still unknown');

// ---------------------------------------------------------------------------------------------
// 5. The master CV — the passive note, and nothing more.
// ---------------------------------------------------------------------------------------------
await page.locator('h1:has-text("You own your facts")').waitFor({ timeout: 180_000 });
await qa.expectText('h1', 'You own your facts', 'the verified master CV is built — the wall is behind us');
await qa.scrollThrough('read the master CV page top to bottom, exactly as its owner would');

const master = await bodyText();
const noteLine = master.split('\n').map((l) => l.trim()).find((l) => /missing (months|dates)/i.test(l));
await qa.note(`the note on the master CV: ${JSON.stringify(noteLine ?? null)}`);
assert(!!noteLine, 'the master CV carries a note about the roles whose dates are unknown');
await qa.expectText('main', noteLine ?? 'missing', 'the missing-dates note, in place on the master CV');

// It must be PASSIVE: no nag, no error styling, no gate on what the page offers next.
assert(
  !/must|need to|required|please (add|provide|fix)|incomplete|error|before you can/i.test(noteLine ?? ''),
  'the note neither demands nor blocks — it states, and stops',
);
const nagged = await page.evaluate(() => {
  const p = [...document.querySelectorAll('main p')].find((el) => /missing (months|dates)/i.test(el.textContent || ''));
  if (!p) return { found: false };
  const s = getComputedStyle(p);
  return {
    found: true,
    role: p.getAttribute('role'),
    isAlert: p.getAttribute('role') === 'alert' || p.className.includes('error'),
    hasButton: !!p.querySelector('button, a'),
    fontSize: s.fontSize,
  };
});
await qa.note(`note styling: ${JSON.stringify(nagged)}`);
assert(nagged.found && !nagged.isAlert && !nagged.hasButton, 'the note is a quiet line of text — not an alert, and it asks for no tap');
assert(await page.locator('.verified-seal').count() > 0, 'the CV is still certified — an unknown date never withheld the seal');

// ---------------------------------------------------------------------------------------------
// 6. The tailored CV must carry NONE of this — and no uninvited "Present".
// ---------------------------------------------------------------------------------------------
const cvHtml = await page.evaluate(async () => {
  const res = await fetch('/api/onboarding/tailor', { credentials: 'include' });
  if (!res.ok) return `__STATUS_${res.status}__`;
  const j = await res.json();
  return j?.html ?? j?.previewHtml ?? JSON.stringify(j);
});
if (cvHtml.startsWith('__STATUS_')) {
  await qa.note(`tailored CV not reachable in this session (${cvHtml}) — the leak check falls to the API-level tests`);
} else {
  await qa.note(`tailored CV fetched (${cvHtml.length} chars)`);
  assert(!/missing (months|dates)|dates not stated|date unknown|roughly/i.test(cvHtml),
    'the tailored CV carries no note, caveat or prompt about the missing dates');
  assert(!/\bPresent\b|\bSince \d{4}|\bFrom \d{4}/.test(cvHtml),
    'no role on the tailored CV claims "Present", "Since" or "From" it was never told');
}

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
