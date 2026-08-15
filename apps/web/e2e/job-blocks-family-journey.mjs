// #221 (labeler slice 2) — "every past job carries a correctable family label", driven as a human
// against a REAL full stack (real Fastify, real extract, real miner parse, real job-block store and
// the real labeling pipeline step; only the MODEL is faked via apps/api/dist/qa-main.js, so the run
// is free and deterministic).
//
// The journey: paste a CV with two dated jobs and a degree -> the tailored preview -> "Confirm my
// facts" -> check every card -> the batched "what kind of work was this?" question at the end, for
// the ONE job the machine could not place (and never for the one it was sure of, nor for the
// degree) -> pick a family -> prove the pick survives a reload AND a second upload that re-runs the
// labeler -> prove the closed vocabulary is enforced server-side, and that the unplaced job title
// reached the vocabulary-growth feed.
//
// Run it (same stack as job-blocks-confirm-journey.mjs; OPS_KEY only for the feed check at the end):
//   OPS_KEY=qa-ops-key PORT=34877 node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34877 npx next build && npx next start -p 34878
//   BASE_URL=http://127.0.0.1:34878 API_BASE=http://127.0.0.1:34877 OPS_KEY=qa-ops-key \
//     node apps/web/e2e/job-blocks-family-journey.mjs

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const API_BASE = process.env.API_BASE ?? '';
const OPS_KEY = process.env.OPS_KEY ?? '';

const CV_TEXT = [
  'Jane Doe',
  'jane.doe@example.com',
  'Warsaw, Poland',
  '',
  'EXPERIENCE',
  '',
  'IT Project Manager, Nordic Retail Group, Warsaw — Mar 2021 - Present',
  '- Led the checkout replatforming and delivered it two months ahead of plan.',
  '- Managed a budget of EUR 1.2M across three vendor teams.',
  '',
  'Project Coordinator, Baltic Software House, Warsaw — Jun 2017 - Feb 2021',
  '- Coordinated a team of twelve engineers and two business analysts.',
  '',
  'EDUCATION',
  'MSc Management Information Systems, University of Warsaw, 2017',
  '',
  'SKILLS',
  'Jira, MS Project, stakeholder management',
].join('\n');

const qa = await createSession('job-blocks-family-journey', { baseURL: BASE, viewport: { width: 1440, height: 950 } });
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

/** The deck as the SERVER sees it — same cookie, same route the screen calls. */
const deck = () => page.evaluate(() => fetch('/api/job-blocks').then((r) => r.json()));
const familyOf = (d, title) => d.blocks.find((b) => b.title.value === title)?.family;

// -------------------------------------------------------------------------------------------
// 1. Paste the CV and ride the real pipeline to the work-history review screen.
// -------------------------------------------------------------------------------------------
await qa.goto(`${BASE}/paste`, 'the person opens the paste screen');
await qa.fill('textarea[aria-label="Your CV text"]', CV_TEXT, 'pastes a CV with two dated jobs and a degree');
await qa.click('button:has-text("Use this text")', 'hands it over');
await page.waitForURL('**/preview/**', { timeout: 120000 });
await qa.scrollThrough('reads down the watermarked draft while the pipeline finishes');
await qa.click('a:has-text("Confirm my facts")', 'takes the "Confirm my facts" door');
await page.waitForURL('**/job-blocks/**', { timeout: 30000 });
await qa.expectVisible('.jb-card', 'the work-history review screen opens on the first card');
await qa.scrollThrough('reads the whole screen once');

// -------------------------------------------------------------------------------------------
// 2. What the machine worked out BEFORE she is asked anything (#221 AC1).
// -------------------------------------------------------------------------------------------
const before = await deck();
await qa.note(`the deck carries ${before.blocks.length} blocks and offers ${before.families.length} published family/families`);
await qa.note(`published choices: ${before.families.map((f) => `${f.label} (${f.familyId} v${f.version})`).join(', ')}`);

const pm = familyOf(before, 'IT Project Manager');
const coord = familyOf(before, 'Project Coordinator');
const degree = before.blocks.find((b) => b.kind === 'education');
await qa.note(`"IT Project Manager" placement: ${JSON.stringify(pm?.value)} origin=${JSON.stringify(pm?.origin)}`);
await qa.note(`"Project Coordinator" placement: ${JSON.stringify(coord?.value)} origin=${JSON.stringify(coord?.origin)}`);
await qa.note(`the degree block's placement: ${JSON.stringify(degree?.family?.value)} (never asked of the model)`);

await verdict(pm?.value?.outcome === 'confirmed' && !!pm?.value?.family?.familyId && Number.isInteger(pm?.value?.family?.version),
  'the job the machine was sure of carries a confirmed family, with a real id AND version (#221 AC1)');
await verdict(pm?.origin?.kind === 'worked_out',
  'that label is marked WORKED OUT, not read — it quotes no words from the CV (#221 AC1)');
await verdict(coord?.value?.outcome === 'unmapped',
  'the job no published family covers is honestly unmapped, not pushed into the nearest family (#221 AC1)');
await verdict(degree?.family?.value === null,
  'the degree carries no placement at all — no model call was spent on it');

// -------------------------------------------------------------------------------------------
// 3. Check every card. The family question must NEVER interrupt a card (#221 AC4).
// -------------------------------------------------------------------------------------------
let cards = 0;
while ((await page.locator('.jb-card').count()) > 0 && cards < 8) {
  await verdict((await page.locator('.jb-familyask').count()) === 0,
    `no family question interrupts card ${cards + 1} — the questions are batched for the end (#221 AC4)`);
  await qa.click('.jb-cbtn.yes', `she reads card ${cards + 1} and says "that's right"`);
  await page.waitForTimeout(600);
  cards += 1;
}
await qa.note(`she checked ${cards} cards`);

// -------------------------------------------------------------------------------------------
// 4. The batched question at the end — only for what could not be placed (#221 AC4).
// -------------------------------------------------------------------------------------------
await qa.expectVisible('.jb-familyask', 'with the deck done, the family question appears — batched, at the end (#221 AC4)');
await qa.scrollThrough('reads the question panel');
await qa.expectText('.jb-familyask h2', 'What kind of work', 'it asks in plain words what kind of work it was');
await qa.expectText('.jb-familyask', 'Project Coordinator', 'the job it could not place is named back to her');
await qa.expectText('.jb-familyask', "couldn't place this one", 'and it says plainly that it could not place it');

const askText = (await page.locator('.jb-familyask').textContent()) || '';
await verdict(!askText.includes('IT Project Manager'),
  'the job it WAS sure of prompts no question at all (#221 AC4)');
await verdict(!/MSc|Management Information Systems/.test(askText),
  'the degree is not asked about either — a degree belongs to no job family');
await verdict((await page.locator('.jb-familyask .jb-fgrp').count()) === 1,
  'exactly one job is asked about — the one that needed it');
await qa.expectText('.jb-familyask', 'never guess one for you', 'and she is told she may leave it — the machine never picks for her');

const choices = await page.locator('.jb-familyask .jb-choice button').allTextContents();
await qa.note(`the choices offered: ${choices.join(' | ')}`);
await verdict(choices.length === before.families.length && choices.some((c) => c.includes(before.families[0].label)),
  'the choices are the real published vocabulary served with the deck — not a hand-kept client list');

// -------------------------------------------------------------------------------------------
// 5. She answers. It is a correction like any other (#221 AC5).
// -------------------------------------------------------------------------------------------
await qa.click('.jb-familyask .jb-choice button >> nth=0', 'she picks the family this job belongs to');
await page.waitForTimeout(1200);
await verdict((await page.locator('.jb-familyask').count()) === 0,
  'the question is answered and goes away — she is never re-asked something she just answered');

const after = await deck();
const coordAfter = familyOf(after, 'Project Coordinator');
await qa.note(`"Project Coordinator" after her answer: ${JSON.stringify(coordAfter?.value)}`);
await qa.note(`its origin now: ${JSON.stringify(coordAfter?.origin)}`);
await verdict(coordAfter?.value?.outcome === 'confirmed',
  'her answer is stored as a confirmed placement — the same shape a machine placement has (#221 AC5)');
await verdict(coordAfter?.origin?.kind === 'corrected' && coordAfter?.origin?.supersededValue?.outcome === 'unmapped',
  'it SUPERSEDES the machine, and what it superseded is kept, not erased (#221 AC5)');

await qa.goto(`${page.url()}`, 'she reloads the screen');
await page.waitForTimeout(1500);
await verdict((await page.locator('.jb-familyask').count()) === 0,
  'after a reload she is still not asked — the answer reached the server, not just the screen (#221 AC5)');

// -------------------------------------------------------------------------------------------
// 6. She uploads the same CV again: the labeler runs again and must not overwrite her (#221 AC5).
// -------------------------------------------------------------------------------------------
await qa.goto(`${BASE}/paste`, 'she uploads the very same CV a second time');
await qa.fill('textarea[aria-label="Your CV text"]', CV_TEXT, 'pastes it again');
await qa.click('button:has-text("Use this text")', 'hands it over again');
await page.waitForURL('**/preview/**', { timeout: 120000 });
await qa.click('a:has-text("Confirm my facts")', 'and goes back to her work history');
await page.waitForURL('**/job-blocks/**', { timeout: 30000 });
await page.waitForTimeout(1500);

const reread = await deck();
const coordReread = familyOf(reread, 'Project Coordinator');
await qa.note(`after a re-read of the CV: ${JSON.stringify(coordReread?.value)} origin=${JSON.stringify(coordReread?.origin?.kind)}`);
await verdict(coordReread?.value?.outcome === 'confirmed' && coordReread?.origin?.kind === 'corrected',
  'her answer survived the re-read, and a second run of the labeler did not overwrite it (#221 AC5)');
await verdict((await page.locator('.jb-familyask').count()) === 0,
  'and she is not asked the same question a second time');

// -------------------------------------------------------------------------------------------
// 7. Over the wire: the closed vocabulary is enforced by the SERVER, not the screen.
// -------------------------------------------------------------------------------------------
const coordId = reread.blocks.find((b) => b.title.value === 'Project Coordinator').id;
const invented = await page.evaluate(
  ([id]) =>
    fetch(`/api/job-blocks/${id}/correct`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'family', value: { familyId: 'underwater-basket-weaving', version: 1 } }),
    }).then(async (r) => ({ status: r.status, body: await r.json() })),
  [coordId],
);
await qa.note(`a made-up family posted straight at the API: ${invented.status} ${JSON.stringify(invented.body)}`);
await verdict(invented.status === 400 && invented.body?.error?.code === 'unknown_family',
  'a family nobody published is refused server-side — the closed list is not a screen-only rule');

const badVersion = await page.evaluate(
  ([id, familyId]) =>
    fetch(`/api/job-blocks/${id}/correct`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'family', value: { familyId, version: 99 } }),
    }).then((r) => r.status),
  [coordId, before.families[0].familyId],
);
await qa.note(`a real family at a version nobody published: ${badVersion}`);
await verdict(badVersion === 400, 'an unpublished VERSION of a real family is refused too');

if (API_BASE) {
  const noCookie = await fetch(`${API_BASE}/job-blocks`, { headers: { accept: 'application/json' } });
  await qa.note(`GET /job-blocks with no session: ${noCookie.status}`);
  await verdict(noCookie.status === 401, 'the deck (and every label on it) is refused without a session');
}

// -------------------------------------------------------------------------------------------
// 8. The unplaced job title reached the vocabulary-growth feed (#221 AC7).
// -------------------------------------------------------------------------------------------
if (API_BASE && OPS_KEY) {
  const feed = await fetch(`${API_BASE}/ops/unmapped-labels?key=${encodeURIComponent(OPS_KEY)}`).then((r) => r.json());
  const roles = (feed.entries ?? []).map((e) => e.role);
  await qa.note(`the vocabulary-growth feed holds: ${JSON.stringify(roles)}`);
  await verdict(roles.includes('Project Coordinator'),
    'the job title the vocabulary had no word for is recorded as feed for #218 (#221 AC7)');

  const open = await fetch(`${API_BASE}/ops/unmapped-labels`).then((r) => r.status);
  await qa.note(`the same feed with no ops key: ${open}`);
  await verdict(open === 403, 'that feed carries visitor text and is not readable without the ops key');
}

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
