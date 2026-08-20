// #252 (spec #251, part of #218) — the vocabulary-growth feed a deploy no longer erases.
//
// Two real visitors walk the shipped screens and each leaves a word the published vocabulary has no
// family for: one TYPES a target role nothing covers, one PASTES a CV whose second job title nothing
// covers. Then the ops surface is asked for the feed — first with no key (it must refuse, the rows
// carry visitor-typed text) and then with the key, where both words must come back carrying their
// source, the session they happened for, and the reason they went unmapped.
//
// Why a browser and not a payload test: the two halves of the feed are written by two DIFFERENT
// production wirings (the target-role placer and the job-block labeler), and the ops route reads a
// THIRD injected store. All three being the same store is exactly the wiring a server-side test can
// get right in its own fixture while production has them apart.
//
// The validation-failure reason (AC3) is deliberately NOT driven here: the QA fake always answers in
// a valid shape, so that branch is unreachable live and is covered at the unit layer instead.
//
//   OPS_KEY=qa-ops-key PORT=34901 node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34901 npx next build && npx next start -p 34902
//   BASE_URL=http://127.0.0.1:34902 node apps/web/e2e/unmapped-label-feed-journey.mjs
//
// #253 added a section that MARKS THE FEED HARVESTED. It is a real write and there is no unmark
// and no delete by design, so this journey is for the throwaway qa-main server above only — never
// point it at staging or production, where it would retire genuine gap evidence nobody researched.
//
// Run serially: every run mints anonymous sessions, and the API caps those per IP per hour.
// Ports are deliberately not 3000/3001 — another project on this machine defaults to those and the
// /api proxy would silently reach the wrong backend. API_URL is baked at `next build` time.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34902';
const OPS_KEY = process.env.OPS_KEY ?? 'qa-ops-key';

const UNMAPPED_ROLE = 'Paediatric nurse practitioner';
const UNMAPPED_JOB_TITLE = 'Project Coordinator';

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

const qa = await createSession('unmapped-label-feed-journey', {
  baseURL: BASE,
  viewport: { width: 1280, height: 900 },
});
const { page } = qa;
page.setDefaultTimeout(20000);

/** Record a boolean verdict as a real PASS/FAIL step with a screenshot. */
async function verdict(ok, note) {
  if (ok) return qa.expectVisible('body', note);
  await qa.note(`FAIL: ${note}`);
  return qa.expectText('body', '__this_check_failed__', note);
}

/** Ask the API the way the visitor's own browser would, then paint the answer into the page so the
 *  screenshot shows the actual bytes the server sent — not a console line nobody keeps. */
async function callAsVisitor(method, path, body) {
  const result = await page.evaluate(
    async ([m, p, b]) => {
      const res = await fetch(`/api${p}`, {
        method: m,
        credentials: 'same-origin',
        ...(b ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {}),
      });
      return { status: res.status, body: await res.text() };
    },
    [method, path, body ?? null],
  );
  await page.evaluate(
    ([label, r]) => {
      let box = document.querySelector('#qa-wire');
      if (!box) {
        box = document.createElement('pre');
        box.id = 'qa-wire';
        box.style.cssText =
          'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#111;color:#0f0;' +
          'font:11px/1.4 monospace;padding:10px;border-radius:8px;white-space:pre-wrap;max-height:45vh;overflow:auto';
        document.body.appendChild(box);
      }
      box.textContent = `${label}\nHTTP ${r.status}\n${r.body}`;
    },
    [`${method} /api${path}`, result],
  );
  return result;
}

const sessionId = async () => JSON.parse((await callAsVisitor('GET', '/sessions/me')).body).id;

// ================================================ 1. a visitor types a role the vocabulary misses

await qa.note(`VISITOR 1 — types a target role no published family covers ("${UNMAPPED_ROLE}")`);
await qa.context.clearCookies();
await qa.goto('/', 'a brand-new visitor lands on the front door');
await qa.scrollThrough('reads the front door top to bottom');
await qa.click('button:has-text("Ready?")', 'opens the front door');
await qa.click('button:has-text("Start questions instead")', 'chooses to start from questions');
await qa.fill('#target-role', UNMAPPED_ROLE, `types what she wants next: "${UNMAPPED_ROLE}"`);
await qa.fill('#search-area', 'Singapore', 'types where she is looking');
await qa.press('#search-area', 'Enter', 'places the search area chip');
await qa.click('button:has-text("Save and continue")', 'saves what she wants next');
// #257: acceptance now shows as the walk-on to discovery, where the confirmation line lives.
await page.waitForURL(/\/discovery/);
await qa.expectText('.intent-context', UNMAPPED_ROLE, 'the saved target role reads back to her');

const visitorOneSession = await sessionId();
const started = await callAsVisitor('POST', '/onboarding/discovery/start', { role: UNMAPPED_ROLE });
await qa.expectVisible('#qa-wire', "the server's answer for a role it cannot place, verbatim");
await verdict(
  started.status === 200 && JSON.parse(started.body).family === null,
  `she is served, not refused, and no family is claimed for her (${started.status})`,
);
await qa.goto('/discovery', 'she walks on — the product still works with no family placement');
await qa.scrollThrough('the discovery screen is fully usable for an unplaced visitor');

// ============================================ 2. a second visitor pastes a CV with an unmapped job

await qa.note(`VISITOR 2 — pastes a CV whose second job title nothing covers ("${UNMAPPED_JOB_TITLE}")`);
await qa.context.clearCookies();
await qa.goto('/paste', 'a second, brand-new visitor opens the paste screen');
await qa.fill('textarea[aria-label="Your CV text"]', CV_TEXT, 'pastes a CV with two dated jobs');
await qa.click('button:has-text("Use this text")', 'hands it over');
await page.waitForURL('**/preview/**', { timeout: 120000 });
await qa.scrollThrough('reads down the watermarked draft while the pipeline finishes');
await qa.click('a:has-text("Confirm my facts")', 'takes the "Confirm my facts" door');
await page.waitForURL('**/job-blocks/**', { timeout: 30000 });
await qa.expectVisible('.jb-card', 'the work-history review screen opens on the first card');
await qa.scrollThrough('reads the whole screen once');

const visitorTwoSession = await sessionId();
const blocks = await callAsVisitor('GET', '/job-blocks');
const placement = JSON.parse(blocks.body).blocks.find(
  (b) => b.title.value === UNMAPPED_JOB_TITLE,
)?.family?.value;
await verdict(
  placement?.outcome === 'unmapped',
  `her "${UNMAPPED_JOB_TITLE}" job is honestly unmapped — the vocabulary has no word for it`,
);

// ============================================================ 3. the feed, behind the ops key only

await qa.note('the operator asks for the vocabulary-growth feed');
const open = await callAsVisitor('GET', '/ops/unmapped-labels');
await qa.expectVisible('#qa-wire', 'with no key the feed refuses — the rows carry visitor-typed text');
await verdict(open.status === 403, `AC6: the feed is key-gated, never open (${open.status})`);

const wrongKey = await callAsVisitor('GET', '/ops/unmapped-labels?key=not-the-key');
await qa.expectVisible('#qa-wire', 'a wrong key is refused just the same');
await verdict(wrongKey.status === 403, `AC6: a wrong key is refused (${wrongKey.status})`);

const feed = await callAsVisitor('GET', `/ops/unmapped-labels?key=${OPS_KEY}`);
await qa.expectVisible('#qa-wire', 'AC1/AC2: the words the closed vocabulary had no family for');
const entries = feed.status === 200 ? JSON.parse(feed.body).entries : [];
await verdict(feed.status === 200, `the key opens the feed (${feed.status})`);

const typedRole = entries.find((e) => e.label === UNMAPPED_ROLE);
await verdict(
  !!typedRole &&
    typedRole.source === 'target_role' &&
    typedRole.sessionId === visitorOneSession &&
    typeof typedRole.reason === 'string' &&
    typedRole.reason.length > 0 &&
    !Number.isNaN(Date.parse(typedRole.recordedAt)),
  `AC1: the typed role is recorded with source, person link, words and reason: ${JSON.stringify(typedRole)}`,
);

const pastJob = entries.find((e) => e.label === UNMAPPED_JOB_TITLE);
await verdict(
  !!pastJob && pastJob.source === 'past_job' && pastJob.sessionId === visitorTwoSession,
  `AC2: the past job title is recorded with source "past job" and its own person link: ${JSON.stringify(pastJob)}`,
);

await verdict(
  typedRole?.sessionId !== pastJob?.sessionId,
  'the two entries point at the two different people who produced them',
);

// ====================================== 4. the waiting count, and a run closing out what it consumed

await qa.note('#253 — the owner asks whether a vocabulary-growth run is worth launching');
const waiting = feed.status === 200 ? JSON.parse(feed.body).waiting : null;
await verdict(
  waiting?.unharvested >= 2 && waiting?.distinctRoles >= 2,
  `#253 AC1: two people, two distinct roles waiting: ${JSON.stringify(waiting)}`,
);

const closed = await callAsVisitor('POST', '/ops/unmapped-labels/harvest');
await qa.expectVisible('#qa-wire', 'marking harvested is key-gated too — no open write to the feed');
await verdict(closed.status === 403, `#253: harvest refuses without the ops key (${closed.status})`);

await qa.note('the run consumed the labels and closes them out');
const harvest = await callAsVisitor('POST', `/ops/unmapped-labels/harvest?key=${OPS_KEY}`);
const harvested = harvest.status === 200 ? JSON.parse(harvest.body) : null;
await qa.expectVisible('#qa-wire', 'AC2: the waiting count drops to zero');
await verdict(
  harvested?.marked >= 2 && harvested?.waiting?.unharvested === 0,
  `#253 AC2: the run marked what it consumed and nothing is waiting: ${JSON.stringify(harvested)}`,
);

const afterHarvest = await callAsVisitor('GET', `/ops/unmapped-labels?key=${OPS_KEY}`);
const keptEntries = afterHarvest.status === 200 ? JSON.parse(afterHarvest.body).entries : [];
const kept = keptEntries.find((e) => e.label === UNMAPPED_ROLE);
await qa.expectVisible('#qa-wire', 'AC2: the words are still there — harvested, never deleted');
await verdict(
  !!kept && !!kept.harvestedAt && !Number.isNaN(Date.parse(kept.harvestedAt)),
  `#253 AC2: the harvested entry stays readable with its harvest time: ${JSON.stringify(kept)}`,
);

const repeat = await callAsVisitor('POST', `/ops/unmapped-labels/harvest?key=${OPS_KEY}`);
await qa.expectVisible('#qa-wire', 'AC4: repeating the harvest marks nothing and loses nothing');
const repeated = repeat.status === 200 ? JSON.parse(repeat.body) : { marked: -1 };
const reread = await callAsVisitor('GET', `/ops/unmapped-labels?key=${OPS_KEY}`);
const stillThere = (reread.status === 200 ? JSON.parse(reread.body).entries : []).find(
  (e) => e.label === UNMAPPED_ROLE,
);
await verdict(
  repeated.marked === 0 && stillThere?.harvestedAt === kept?.harvestedAt,
  `#253 AC4: a repeated harvest is a no-op and the first harvest time survives (marked ${repeated.marked})`,
);

// the run's own door: only what it still has to research, harvested words excluded
const waitingOnly = await callAsVisitor('GET', `/ops/unmapped-labels?key=${OPS_KEY}&waiting=1`);
const waitingEntries = waitingOnly.status === 200 ? JSON.parse(waitingOnly.body).entries : [null];
await qa.expectVisible('#qa-wire', 'AC3: a run reading the waiting list sees no answered gaps');
await verdict(
  waitingEntries.length === 0,
  `#253 AC3: nothing waits after the harvest, though the words remain readable (${waitingEntries.length} waiting)`,
);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
