// #186 "the list, style B" — the redesigned profile list, driven as a human on desktop and phone.
//
// CV-ordered sections with About you leading, per-job experience blocks that never pool, chips for
// word facts (skills / certifications / languages) opening the same detail as a row, the two kept
// captions verbatim, said-vs-read on every detail, the languages door (pre-ticked from the REAL
// eligibility answer, save-unchanged erasing nothing, unanswered opening honest), and the thin
// (6-fact) / big (201-fact) fixtures. Also re-checks the Constellation's own size sort and that
// #183's Job family rail section is unharmed.
//
// The API is route-mocked to the pinned ProfileState shape (same fixtures as profile.spec.ts), so
// this flow needs only a running web app — no Fastify, no model key:
//
//   cd apps/web && API_URL=http://127.0.0.1:3401 npx next dev -p 3400
//   BASE_URL=http://127.0.0.1:3400 node apps/web/e2e/profile-list-style-b-journey.mjs
//
// Ports are deliberately not 3000/3001 — another project on this machine defaults to those.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3400';

const qa = await createSession('profile-list-style-b', { baseURL: BASE, viewport: { width: 1280, height: 800 } });
const { page } = qa;
page.setDefaultTimeout(12000);

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

// --------------------------------------------------------------------------------------------
// Fixtures — the real payload shape, verified byte-for-byte against a live GET /profile.
// --------------------------------------------------------------------------------------------

const LANGS = {
  questionId: 'eligibility-languages',
  question: "Which of these can you work in professionally? Anything you leave unticked, I'll treat as a no.",
  consequence:
    'A no takes jobs that require that language out of your deck. Tick every one you could run a meeting in. Not sure? Tick it.',
  options: ['English', 'Mandarin', 'Cantonese', 'Vietnamese', 'Ask me later'],
  answer: null,
};

const JOB_A = 'IT Project Manager · Veolia';
const JOB_B = 'Senior Consultant · Capgemini';

// The full CV-order fixture: About you, Professional Experience (two jobs), Skills, Certifications,
// Languages, Education. Skills is deliberately listed after the bigger Experience so Sorted's order
// is the payload's, and the Constellation's size sort can be told apart from it.
const FULL = {
  factCount: 12,
  search: { role: 'IT project manager in Hong Kong', family: null, siblingTitles: [], openJobs: null },
  domains: [
    {
      tag: 'profile',
      heading: 'About you',
      facts: [{ id: 'p1', text: 'Based in Hong Kong, open to hybrid work.', colour: 'gold', source: 'told', job: null }],
    },
    {
      tag: 'experience',
      heading: 'Professional Experience',
      facts: [
        { id: 'a1', text: 'Ran the SAP S/4HANA cutover across three manufacturing sites.', colour: 'gold', source: 'told', job: JOB_A },
        { id: 'a2', text: 'Coordinated vendor contracts across three markets.', colour: 'grey', source: 'read', job: JOB_A },
        { id: 'b1', text: 'Delivered a treasury reporting platform for a regional bank.', colour: 'gold', source: 'told', job: JOB_B },
        { id: 'b2', text: 'Built the delivery governance pack used by four teams.', colour: 'grey', source: 'told', job: JOB_B },
      ],
    },
    {
      tag: 'skill',
      heading: 'Skills',
      facts: [
        { id: 's1', text: 'SQL.', colour: 'gold', source: 'told', job: null },
        { id: 's2', text: 'Jira.', colour: 'gold', source: 'read', job: null },
        { id: 's3', text: 'Excel.', colour: 'grey', source: 'read', job: null },
      ],
    },
    {
      tag: 'cert',
      heading: 'Certifications',
      facts: [{ id: 'c1', text: 'PMP.', colour: 'gold', source: 'told', job: null }],
    },
    {
      tag: 'lang',
      heading: 'Languages',
      // Deliberately disagrees with the eligibility answer below — the chip text names English,
      // the real answer does not. The door must follow the answer, never the chip.
      facts: [{ id: 'l1', text: 'Fluent in English and Mandarin.', colour: 'gold', source: 'read', job: null }],
    },
    {
      tag: 'edu',
      heading: 'Education',
      facts: [{ id: 'd1', text: 'MBA, INSEAD.', colour: 'gold', source: 'told', job: null }],
    },
  ],
  contact: { phone: { value: '+852 1234 5678', origin: 'read' }, email: null },
  location: { area: null, workRights: null },
  languagesQuestion: { ...LANGS, answer: ['Mandarin', 'Cantonese'] },
};

const THIN = {
  factCount: 6,
  search: FULL.search,
  domains: [
    { tag: 'profile', heading: 'About you', facts: [{ id: 'p1', text: 'Based in Hanoi.', colour: 'gold', source: 'told', job: null }] },
    {
      tag: 'experience',
      heading: 'Professional Experience',
      facts: [{ id: 'e1', text: 'Managed a small delivery team.', colour: 'gold', source: 'told', job: null }],
    },
    { tag: 'skill', heading: 'Skills', facts: [{ id: 's1', text: 'Jira.', colour: 'gold', source: 'told', job: null }] },
  ],
  contact: { phone: null, email: null },
  location: { area: null, workRights: null },
  languagesQuestion: { ...LANGS, answer: null },
};

function bigFacts() {
  const jobs = [JOB_A, JOB_B, 'Delivery Lead · Atos'];
  const out = [];
  jobs.forEach((job, ji) => {
    for (let i = 0; i < 67; i++) {
      out.push({
        id: `j${ji}-${i}`,
        text: `Delivered workstream ${ji}-${i} for ${job}.`,
        colour: i < 30 ? 'gold' : 'grey',
        source: i % 2 === 0 ? 'told' : 'read',
        job,
      });
    }
  });
  return out;
}

const BIG = {
  factCount: 201,
  search: FULL.search,
  domains: [{ tag: 'experience', heading: 'Professional Experience', facts: bigFacts() }],
  contact: { phone: null, email: null },
  location: { area: null, workRights: null },
  languagesQuestion: { ...LANGS, answer: ['English'] },
};

// One mutable mock, so a save can change what the next refetch returns.
let current = FULL;
let saved = null;
await page.route('**/api/sessions/me', (r) => r.fulfill({ json: { ok: true } }));
await page.route('**/api/profile', (r) => r.fulfill({ json: current }));
await page.route('**/api/onboarding/discovery/answer', async (r) => {
  const body = r.request().postDataJSON();
  saved = body.answers ?? null;
  current = { ...current, languagesQuestion: { ...current.languagesQuestion, answer: saved } };
  await r.fulfill({ json: { ok: true } });
});

const text = (sel) => page.locator(sel).allTextContents();

// --------------------------------------------------------------------------------------------
// Desktop — the whole list, read top to bottom the way a person would.
// --------------------------------------------------------------------------------------------

await qa.goto('/profile', 'open the profile screen on a desktop browser');
await qa.expectVisible('#profileview', 'the fact list is on screen');
await qa.scrollThrough('read the whole list from top to bottom, then back up');

// AC1 — CV order, About you first, exactly one such heading, no empty section.
const headings = await text('.dname');
await qa.note(`section order as drawn: ${headings.join(' → ')}`);
if (headings[0] !== 'About you') throw new Error(`About you must lead, got "${headings[0]}"`);
const aboutCount = await page.getByText('About you', { exact: true }).count();
if (aboutCount !== 1) throw new Error(`expected exactly ONE "About you" heading, found ${aboutCount}`);
const expected = ['About you', 'Professional Experience', 'Skills', 'Certifications', 'Languages', 'Education'];
if (headings.join('|') !== expected.join('|')) throw new Error(`CV order broken: ${headings.join('|')}`);
if ((await page.locator('.dom').count()) !== 6) throw new Error('an empty section was drawn');
await qa.expectVisible('.dom:first-child', 'About you leads the list, and it is the only such heading');

// AC2 — per-job blocks, on-CV facts above kept ones, never pooling.
await qa.expectVisible('.jblk', 'Professional Experience is split into per-job blocks');
const jobHeads = await text('.jhead');
await qa.note(`job blocks: ${jobHeads.join(' | ')}`);
if (jobHeads.length !== 2) throw new Error(`expected 2 job blocks, got ${jobHeads.length}`);
for (const [i, jobName] of [[0, JOB_A], [1, JOB_B]]) {
  const blk = page.locator('.jblk').nth(i);
  const rows = await blk.locator('.frow').allTextContents();
  const cls = await blk.locator('.frow').evaluateAll((els) => els.map((e) => e.className));
  await qa.note(`${jobName}: ${rows.length} rows, colours ${cls.map((c) => (c.includes('gold') ? 'on-CV' : 'kept')).join(',')}`);
  if (!cls[0].includes('gold')) throw new Error(`${jobName}: on-CV facts must sit above kept ones`);
  const foreign = i === 0 ? 'Delivered a treasury reporting platform' : 'Ran the SAP S/4HANA cutover';
  if (rows.some((r) => r.includes(foreign))) throw new Error(`${jobName}: another job's fact pooled into this block`);
}
await qa.expectText(page.locator('.jblk').nth(0).locator('.jhead'), 'Veolia', 'the first job block is headed by its own job line');
await qa.expectText('.jblk .krun', 'Left out for space', 'the experience kept-caption reads the experience wording');

// AC3 — chips for word facts, rows for sentences, and the two never cross.
const skills = page.locator('.dom').filter({ hasText: 'Skills' });
await qa.expectVisible(skills.locator('.fact').first(), 'skills render as chips, not sentence rows');
await qa.expectVisible(page.locator('.dom').filter({ hasText: 'Certifications' }).locator('.fact').first(), 'certifications render as chips');
await qa.expectVisible(page.locator('.dom').filter({ hasText: 'Languages' }).locator('.fact').first(), 'languages render as chips');
await qa.expectVisible(page.locator('.dom').filter({ hasText: 'Education' }).locator('.frow').first(), 'a sentence fact (Education) renders as a full row');
if ((await page.locator('.frow', { hasText: 'SQL' }).count()) !== 0) throw new Error('a chip fact leaked into a row');
if ((await page.locator('.fact', { hasText: 'MBA, INSEAD' }).count()) !== 0) throw new Error('a sentence fact leaked into a chip');

// AC4 — the kept captions, verbatim, in both the list runs and the detail.
await qa.expectText(skills.locator('.krun'), 'Kept for when a job needs it', 'the non-experience kept caption reads verbatim');
const skillsKrun = (await skills.locator('.krun').textContent()) ?? '';
if (skillsKrun.trim() !== 'Kept for when a job needs it') throw new Error(`kept caption not verbatim: "${skillsKrun}"`);

// AC3/AC5 — a chip's detail opens exactly like a row's, and shows said vs read.
await qa.click(skills.locator('.fact.grey').first(), 'tap the kept skill chip "Excel"');
await qa.expectVisible('dialog.detail', "a chip's detail opens the same panel a row's does");
await qa.expectText('dialog.detail', 'Kept for when a job needs it. Read from your CV.', 'the chip detail carries the kept caption and says it was READ from the CV');
await qa.click('dialog.detail button:has-text("Close")', 'close the chip detail');

await qa.click(page.locator('.jblk').nth(0).locator('.frow.grey').first(), 'tap the kept fact inside the Veolia job block');
await qa.expectText('dialog.detail', 'Left out for space — it swaps in when a job needs it. Read from your CV.', 'the experience kept caption + said/read line show together in the detail');
await qa.expectText('dialog.detail .dctx', 'Veolia', 'the detail names the job the fact belongs to');
await qa.click('dialog.detail button:has-text("Close")', 'close the detail');

await qa.click(page.locator('.jblk').nth(1).locator('.frow.gold').first(), 'tap an on-CV fact');
await qa.expectText('dialog.detail', 'You told me this.', 'an on-CV fact detail says it was SAID by the person');
const goldDetail = (await page.locator('dialog.detail').textContent()) ?? '';
if (/kept for when a job needs it|left out for space/i.test(goldDetail)) throw new Error('an on-CV fact wrongly carries a kept caption');
await qa.click('dialog.detail button:has-text("Close")', 'close the detail');

// Copy sweep across the whole rendered screen.
const body = (await page.locator('body').innerText()).toLowerCase();
for (const banned of ['waiting for a job that asks', 'advert', 'boost']) {
  if (body.includes(banned)) throw new Error(`banned copy on screen: "${banned}"`);
}
for (const colour of ['gold', 'grey', 'gray', 'amber']) {
  if (new RegExp(`\\b${colour}\\b`).test(body)) throw new Error(`a colour name leaked into user-facing copy: "${colour}"`);
}
await qa.note('copy sweep clean: no "waiting for a job that asks", no "advert", no "boost", no colour names');

// AC6 — languages are edited in exactly ONE place on the whole screen.
const doors = page.getByRole('button', { name: 'Change your languages' });
if ((await doors.count()) !== 1) throw new Error(`languages editing must exist exactly once, found ${await doors.count()}`);
await qa.expectVisible(doors, 'the ONE languages editing door, inside the Languages section');
await qa.click(doors, 'open the languages door');
await qa.expectText('.rq .rqq', 'Which of these can you work in professionally', 'the door asks the real eligibility question');

// It must pre-tick from the eligibility ANSWER (Mandarin+Cantonese), never the CV chip text
// ("Fluent in English and Mandarin.") — English stays unticked.
const ticked = await page.locator('.rcheck input:checked').evaluateAll((els) => els.map((e) => e.parentElement.textContent.trim()));
await qa.note(`door opened pre-ticked with: ${ticked.join(', ')} (the CV chip says "Fluent in English and Mandarin.")`);
if (ticked.includes('English')) throw new Error('the door pre-ticked from CV text, not the real answer');
if (!ticked.includes('Mandarin') || !ticked.includes('Cantonese')) throw new Error('the door did not pre-tick the real answer');
await qa.expectVisible(page.getByRole('checkbox', { name: 'Mandarin' }), 'Mandarin is ticked from the real eligibility answer');

// Save unchanged — nothing may be erased.
await qa.click('.rbtns button:has-text("Save")', 'save the door WITHOUT touching a single tick');
await qa.expectVisible(doors, 'the door closed and handed focus back');
await qa.note(`save-unchanged sent: ${JSON.stringify(saved)}`);
if (!saved || saved.length !== 2 || !saved.includes('Mandarin') || !saved.includes('Cantonese')) {
  throw new Error(`save-unchanged erased something: sent ${JSON.stringify(saved)}`);
}

// A real change still sticks.
await qa.click(doors, 'reopen the door');
await qa.click(page.getByRole('checkbox', { name: 'Vietnamese' }), 'tick Vietnamese');
await qa.click('.rbtns button:has-text("Save")', 'save the change');
await qa.note(`after a real change the door sent: ${JSON.stringify(saved)}`);
if (!saved.includes('Vietnamese')) throw new Error('a real language change was lost');

// The Constellation still renders and keeps its own size sort.
// The view toggle is icon-only — addressed by its accessible name, the way a screen reader would.
await qa.click(page.getByRole('button', { name: 'Constellation' }), 'switch to the Constellation view');
await qa.expectVisible('.sky', 'the Constellation still renders');
await qa.expectVisible('.skylist button', 'every star is still reachable as a real button');
const firstStar = await page.locator('.skylist button').first().getAttribute('aria-label');
await qa.note(`Constellation leads with: ${firstStar} (Experience, the biggest domain — its own size sort, not the list's CV order)`);
if (!/workstream|SAP|treasury|governance|vendor/i.test(firstStar ?? '')) {
  throw new Error(`Constellation lost its size sort: leads with "${firstStar}"`);
}
await qa.click(page.getByRole('button', { name: 'Sorted' }), 'switch back to the list');

// #183's rail, unharmed.
await qa.expectVisible('.rail', "the right rail is still there");
await qa.expectVisible(page.getByRole('button', { name: 'Not the job you meant?' }), "the rail's Job family door is unharmed");
await qa.click(page.getByRole('button', { name: 'Not the job you meant?' }), 'open the Job family door from the rail');
await qa.expectVisible('.rq', 'the Job family panel still opens and asks its own question');
await qa.press('body', 'Escape', 'close the Job family door');

// --------------------------------------------------------------------------------------------
// The thin (6-fact) profile — only its real sections.
// --------------------------------------------------------------------------------------------

current = THIN;
await qa.goto('/profile', 'reload as a person with only six facts');
await qa.scrollThrough('read the whole thin list');
const thinHeads = await text('.dname');
await qa.note(`thin profile sections: ${thinHeads.join(' → ')}`);
if (thinHeads.length !== 3) throw new Error(`thin profile invented sections: ${thinHeads.join('|')}`);
for (const absent of ['Education', 'Certifications', 'Languages']) {
  if ((await page.getByText(absent, { exact: true }).count()) !== 0) throw new Error(`thin profile drew an empty "${absent}" section`);
}
await qa.expectVisible('.dom', 'the thin profile shows only the three sections it really has');

// --------------------------------------------------------------------------------------------
// The big (201-fact) profile — navigable, job headers anchoring the scroll.
// --------------------------------------------------------------------------------------------

current = BIG;
await qa.goto('/profile', 'reload as a person with two hundred facts');
await qa.expectVisible(page.getByRole('heading', { name: '201 things you\'ve told me' }), 'the hero counts all 201 facts');
const bigBlocks = await page.locator('.jblk').count();
const bigRows = await page.locator('.frow').count();
await qa.note(`big profile: ${bigBlocks} job blocks, ${bigRows} rows rendered (nothing paginated away)`);
if (bigRows !== 201) throw new Error(`the big list swallowed rows: ${bigRows} of 201`);
await qa.scrollThrough('scroll a long way down the 201-fact list');

// The sticky job header really pins, measured against the scroll container's own top edge.
const pinned = await page.evaluate(() => {
  const c = document.querySelector('#profileview.body.sorted');
  const h = document.querySelector('#job-0 .jhead');
  if (!c || !h) return null;
  c.scrollTop = 400;
  return { delta: Math.abs(h.getBoundingClientRect().top - c.getBoundingClientRect().top), pos: getComputedStyle(h).position };
});
await qa.note(`job header after scrolling 400px inside its own block: position ${pinned?.pos}, ${pinned?.delta.toFixed(1)}px from the container top`);
if (!pinned || pinned.pos !== 'sticky' || pinned.delta > 6) throw new Error('job headers do not anchor the scroll');
await qa.expectVisible('#job-0 .jhead', 'the job header stays pinned while its block scrolls under it');

// --------------------------------------------------------------------------------------------
// Phone — 375×800, the pull-up sheet.
// --------------------------------------------------------------------------------------------

current = FULL;
await page.setViewportSize({ width: 375, height: 800 });
await qa.goto('/profile', 'open the same profile on a phone-sized screen');
await qa.expectVisible(page.getByRole('button', { name: /Your facts/ }), 'on a phone the rail leads and the facts wait in a pull-up sheet');
await qa.click(page.getByRole('button', { name: /Your facts/ }), 'pull the facts sheet up');
await qa.expectVisible('#profileview', 'the whole list is available inside the phone sheet');
await qa.scrollThrough('read the list on the phone');

const phoneHeads = await text('.dname');
await qa.note(`phone section order: ${phoneHeads.join(' → ')}`);
if (phoneHeads[0] !== 'About you') throw new Error('About you must lead on the phone too');
await qa.expectVisible('.jblk .jhead', 'the per-job blocks survive the phone layout');
await qa.expectText('.jblk .krun', 'Left out for space', 'the experience kept caption reads correctly on the phone');

await qa.click(page.locator('.dom').filter({ hasText: 'Skills' }).locator('.fact.grey').first(), 'tap a kept skill chip on the phone');
await qa.expectVisible('dialog.detail', "a chip's detail opens inside the phone sheet");
await qa.expectText('dialog.detail', 'Kept for when a job needs it. Read from your CV.', 'the kept caption and said/read line read correctly on the phone');
await qa.press('body', 'Escape', 'close the detail with Escape');
await qa.expectVisible('.pfsheet.open', 'closing the detail did NOT also collapse the sheet');

await qa.click(page.getByRole('button', { name: 'Change your languages' }), 'open the languages door on the phone');
await qa.expectVisible('.rq .rcheck', 'the languages door is usable on a phone screen');
const phoneTicked = await page.locator('.rcheck input:checked').evaluateAll((els) => els.map((e) => e.parentElement.textContent.trim()));
await qa.note(`phone door pre-ticked with: ${phoneTicked.join(', ')}`);
await qa.click('.rbtns button:has-text("Keep what I have")', 'back out of the door without saving');
await qa.expectVisible(page.getByRole('button', { name: 'Change your languages' }), 'the door closed and the section is intact');

// The unanswered case: the door opens unticked, with honest copy.
current = { ...FULL, languagesQuestion: { ...LANGS, answer: null } };
await qa.goto('/profile', 'reload as a person who has never answered the languages question');
await qa.click(page.getByRole('button', { name: /Your facts/ }), 'pull the facts sheet up');
await qa.click(page.getByRole('button', { name: 'Change your languages' }), 'open the languages door');
const noneTicked = await page.locator('.rcheck input:checked').count();
await qa.note(`unanswered door opened with ${noneTicked} boxes ticked (the CV chip still says "Fluent in English and Mandarin.")`);
if (noneTicked !== 0) throw new Error('an unanswered door pre-ticked something');
await qa.expectText('.rq', "You haven't answered this yet.", 'the unanswered door says so honestly rather than implying an answer');
await qa.expectVisible(page.getByRole('button', { name: 'Not now' }), 'the unanswered door offers "Not now", never "Keep what I have"');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
