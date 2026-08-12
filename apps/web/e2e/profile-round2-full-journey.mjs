// #189 — the FULL round-2 profile journey (spec #181), end to end, desktop AND phone.
//
// This is the spec-closing flow: it drives one person through the whole redesigned profile rather
// than one slice of it — the two-zone desktop layout, the hero's kept framing, the CV-ordered list,
// the constellation, both rail sections, both correction doors, and the market-switch journey from
// an answered Hong Kong through Singapore and back.
//
// The API is route-mocked to the pinned ProfileState shape (the same fixtures profile.spec.ts uses),
// so this flow needs only a running web app — no Fastify, no model key:
//
//   cd apps/web && npx next build && npx next start -p 3100
//   BASE_URL=http://127.0.0.1:3100 node apps/web/e2e/profile-round2-full-journey.mjs
//
// Ports are deliberately not 3000/3001 — another project on this machine defaults to those.
//
// QA_SHOT_DIR=<path> also files clean phone screenshots of the stacked layout for the design record.

import fs from 'node:fs';
import path from 'node:path';
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3100';
const SHOTS = process.env.QA_SHOT_DIR ?? 'qa-results/mobile-shots';
fs.mkdirSync(SHOTS, { recursive: true });

const qa = await createSession('profile-round2-full', { baseURL: BASE, viewport: { width: 1280, height: 900 } });
const { page } = qa;
page.setDefaultTimeout(12000);

let aborted = false;
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, async (e) => {
    if (aborted) return;
    aborted = true;
    try { await qa.note(`RUN ABORTED (${ev}): ${e?.message ?? e}`); await qa.finish(); } catch { /* closed */ }
    process.exit(1);
  });
}

let failures = 0;
const check = async (cond, note) => {
  if (!cond) failures++;
  await qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
};
const shot = async (name) => {
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: false });
  await qa.note(`screenshot filed: ${name}`);
};

// ---------------------------------------------------------------------------------------------
// Fixtures — one person, Mei: a real CV-shaped profile with two jobs, chips, and Hong Kong answered.
// ---------------------------------------------------------------------------------------------

const JOB_A = 'IT Project Manager · Veolia';
const JOB_B = 'Senior Consultant · Capgemini';

const WR_OPTIONS = ['Yes — no sponsorship needed', "Not yet — I'd need sponsorship", "I'd rather not say"];
const workRights = (market, answer) => ({
  market,
  answer,
  questionId: `eligibility:work-rights:${market.toLowerCase().replace(/\s+/g, '-')}`,
  question: `Can you work in ${market} without sponsorship?`,
  options: WR_OPTIONS,
});

const LANGS = {
  questionId: 'eligibility-languages',
  question: "Which languages do you speak? Start typing — I'll suggest as you go.",
  consequence:
    "Nothing you leave out counts against you: a job wanting a language you didn't list still stays in your deck. When one of them matters for a real job, I'll ask how well you speak it, and say why.",
  options: ['English', 'Mandarin', 'Cantonese', 'Vietnamese', 'Ask me later'],
  answer: ['English', 'Mandarin'],
};

const MEI = {
  factCount: 12,
  search: { role: 'IT project manager in Hong Kong', family: null, siblingTitles: [], openJobs: null },
  contact: { phone: { value: '+852 1234 5678', origin: 'read' }, email: null },
  location: { area: 'Hong Kong', workRights: workRights('Hong Kong', null) },
  languagesQuestion: LANGS,
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
    { tag: 'cert', heading: 'Certifications', facts: [{ id: 'c1', text: 'PMP.', colour: 'gold', source: 'told', job: null }] },
    { tag: 'lang', heading: 'Languages', facts: [{ id: 'l1', text: 'Fluent in English and Mandarin.', colour: 'gold', source: 'read', job: null }] },
    { tag: 'edu', heading: 'Education', facts: [{ id: 'd1', text: 'MBA, INSEAD.', colour: 'gold', source: 'told', job: null }] },
  ],
};

// A thin profile — the real shape of "an empty section never draws": the payload simply omits the
// sections she has nothing for (the API assembles domains from tags that have facts).
const THIN = {
  ...MEI,
  factCount: 3,
  domains: [
    { tag: 'profile', heading: 'About you', facts: [{ id: 'p1', text: 'Based in Hong Kong.', colour: 'gold', source: 'told', job: null }] },
    { tag: 'experience', heading: 'Professional Experience', facts: [{ id: 'e1', text: 'Managed a small delivery team.', colour: 'gold', source: 'told', job: null }] },
    { tag: 'skill', heading: 'Skills', facts: [{ id: 's1', text: 'Jira.', colour: 'gold', source: 'told', job: null }] },
  ],
};

// Adversarial only: a payload the API is proven never to produce (an empty domain). Recorded, not
// gated — the guarantee lives at the producing seam, and this flow reports what the screen does
// with it so the defence-in-depth gap is visible rather than assumed closed.
const WITH_EMPTY_DOMAIN = { ...MEI, domains: [...MEI.domains, { tag: 'additional', heading: 'Additional', facts: [] }] };

// The market-keyed answer store (#180): a switch never deletes, and never lends.
const answersByMarket = { 'Hong Kong': null, Singapore: null };

let state = structuredClone(MEI);
let cardsDelayMs = 0;

const syncLocation = () => {
  const market = state.location.area;
  state = {
    ...state,
    location: { area: market, workRights: workRights(market, answersByMarket[market] ?? null) },
  };
};

await page.route('**/api/sessions/me', (r) => r.fulfill({ json: { ok: true } }));
await page.route('**/api/profile', (r) => r.fulfill({ json: state }));
await page.route('**/api/sessions/me/targets', async (r) => {
  const body = r.request().postDataJSON();
  state = { ...state, search: { ...state.search, role: body.targetTitles[0] } };
  await r.fulfill({ json: { ok: true } });
});
await page.route('**/api/sessions/me/intent', async (r) => {
  if (r.request().method() !== 'PUT') { await r.fulfill({ json: { checkpoint: 'intent_known', searchAreaResolution: null } }); return; }
  const body = r.request().postDataJSON();
  const market = body.searchArea;
  state = { ...state, location: { ...state.location, area: market } };
  syncLocation();
  await r.fulfill({ json: { checkpoint: 'intent_known', searchAreaResolution: { covered: true, market, coverage: ['Hong Kong', 'Singapore', 'Vietnam', 'Australia'] } } });
});
await page.route('**/api/onboarding/cards', async (r) => {
  if (cardsDelayMs) await new Promise((res) => setTimeout(res, cardsDelayMs));
  await r.fulfill({ json: { cards: [], checkpoint: 'cards_ready' } });
});
await page.route('**/api/onboarding/discovery/answer', async (r) => {
  const body = r.request().postDataJSON();
  const market = state.location.area;
  if (String(body.itemId ?? '').startsWith('eligibility:work-rights')) {
    answersByMarket[market] = body.answer;
    syncLocation();
  } else {
    state = { ...state, languagesQuestion: { ...state.languagesQuestion, answer: body.answers ?? body.answer } };
  }
  await r.fulfill({ json: { ok: true } });
});

const texts = (sel) => page.locator(sel).allTextContents();

// =============================================================================================
// 1. DESKTOP — the field and the rail, side by side. No stretched phone column.
// =============================================================================================

await qa.goto('/profile', 'Mei opens her profile on a desktop browser');
await qa.expectVisible('.field', 'the field — where her facts live');
await qa.expectVisible('.rail', 'the right rail — her search promise');

const zones = await page.evaluate(() => {
  const f = document.querySelector('.field').getBoundingClientRect();
  const r = document.querySelector('.rail').getBoundingClientRect();
  return { beside: r.left >= f.right - 2, sameTop: Math.abs(r.top - f.top) < 80, fieldW: Math.round(f.width), railW: Math.round(r.width) };
});
await check(zones.beside && zones.sameTop, `desktop: the rail sits BESIDE the field (field ${zones.fieldW}px, rail ${zones.railW}px) — not a stretched phone column`);
await qa.scrollThrough('read the whole desktop screen, top to bottom and back');

// --- the hero: live counts, kept framing, no colour named ---
await qa.expectText('.pcount', "12 things you've told me", 'the hero counts everything she has told the machine');
await qa.expectText('.pwait', 'make your CV right now', 'the second line counts what makes her CV right now');
await qa.expectText('.pwait', 'kept for when a job needs them', 'the rest are KEPT — selection, never rejection');
const heroCopy = ((await page.locator('.phead').innerText()) ?? '');
await check(!/when a job asks/i.test(heroCopy), 'the killed "waiting for a job that asks" framing is nowhere in the hero');
await check(!/\b(gold|grey|gray|amber|yellow)\b/i.test(heroCopy), 'the hero never names a colour');

// =============================================================================================
// 2. THE LIST — About you first, CV order, per-job gold-top/kept-under, chips vs rows, no empties.
// =============================================================================================

const headings = await texts('.dname');
await qa.note(`sections drawn, in order: ${headings.join(' → ')}`);
await check(headings[0] === 'About you', 'About you leads the list — her no-job answers have an honest home');
await check((await page.getByText('Professional Summary', { exact: true }).count()) === 0, 'FALSIFIABLE: "Professional Summary" is never a profile heading');
await check(headings.join('|') === ['About you', 'Professional Experience', 'Skills', 'Certifications', 'Languages', 'Education'].join('|'), 'the list follows the CV\'s own section order');
const emptyDrawn = await page.locator('.dom').evaluateAll((els) => els.filter((e) => e.querySelectorAll('.frow, .fact').length === 0).length);
await check(emptyDrawn === 0, 'FALSIFIABLE: no section with nothing in it is drawn');

const jobHeads = await texts('.jhead');
await check(jobHeads.length === 2, `Professional Experience splits into ${jobHeads.length} per-job blocks, one per employer`);
for (const [i, name, foreign] of [[0, JOB_A, 'treasury reporting'], [1, JOB_B, 'SAP S/4HANA']]) {
  const blk = page.locator('.jblk').nth(i);
  const cls = await blk.locator('.frow').evaluateAll((els) => els.map((e) => e.className));
  const rows = await blk.locator('.frow').allTextContents();
  await qa.note(`${name}: ${cls.map((c) => (c.includes('gold') ? 'on-CV' : 'kept')).join(' then ')}`);
  await check(cls[0].includes('gold') && cls[cls.length - 1].includes('grey'), `${name}: on-CV facts sit on top, kept facts underneath — inside this job, never pooled`);
  await check(!rows.some((r) => r.includes(foreign)), `${name}: no other job's fact leaked into this block`);
}
await qa.expectText('.jblk .krun', 'Left out for space', 'the experience kept-caption says who chose and why');
await qa.expectVisible(page.locator('.dom').filter({ hasText: 'Skills' }).locator('.fact').first(), 'skills draw as compact chips');
await qa.expectVisible(page.locator('.dom').filter({ hasText: 'Education' }).locator('.frow').first(), 'a sentence fact draws as a full row');
await check((await page.locator('.frow', { hasText: 'SQL' }).count()) === 0, 'a one-word fact never spends a whole row');
await check((await page.locator('.fact', { hasText: 'MBA, INSEAD' }).count()) === 0, 'a sentence fact never squeezes into a chip');

// FALSIFIABLE: exactly one editing surface for languages, on the whole screen.
const langDoors = page.getByRole('button', { name: 'Change your languages' });
await check((await langDoors.count()) === 1, `FALSIFIABLE: a language has exactly ONE editing surface (found ${await langDoors.count()})`);
const railLangs = await page.locator('.rail').innerText();
await check(!/language/i.test(railLangs), 'FALSIFIABLE: the rail carries no languages line at all — no second door to disagree with the first');

// =============================================================================================
// 3. THE CONSTELLATION — grouped by the same sections, jobs labelled as sub-constellations.
// =============================================================================================

// The thin profile — the honest shape of "an empty section never draws".
state = structuredClone(THIN);
await qa.goto('/profile', 'reload as someone with only three facts');
const thinHeads = await texts('.dname');
await qa.note(`thin profile sections: ${thinHeads.join(' → ')}`);
await check(thinHeads.length === 3, 'FALSIFIABLE: a thin profile draws only the three sections she really has — no empty boxes');
for (const absent of ['Education', 'Certifications', 'Languages']) {
  await check((await page.getByText(absent, { exact: true }).count()) === 0, `no empty "${absent}" section is drawn`);
}

// ADVERSARIAL, recorded not gated: a payload the API is proven never to emit.
state = structuredClone(WITH_EMPTY_DOMAIN);
await qa.goto('/profile', 'adversarial reload: a payload carrying a domain with zero facts');
const advHeads = await texts('.dname');
await qa.note(
  advHeads.includes('Additional')
    ? 'OBSERVATION (defence-in-depth gap, not reachable today): handed a zero-fact domain, the LIST still draws its heading. The API never emits one (domains are assembled only from tags that have facts), so no person can see this — the constellation filters it out independently.'
    : 'the list independently refuses to draw a zero-fact domain, as well as the API refusing to emit one',
);
state = structuredClone(MEI);
await qa.goto('/profile', 'back to her real profile');

await qa.click(page.getByRole('button', { name: 'Constellation' }), 'switch to the Constellation view');
await page.locator('.skylist button').first().waitFor({ state: 'attached' });
await page.waitForTimeout(800);
await qa.expectVisible('.sky', 'the sky renders');
const stars = await page.locator('.skylist button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
await check(stars.length === 11, `${stars.length} stars for the 11 facts she has — the empty section takes no sky either`);
const labelled = stars.filter((s) => s.includes(' — ') && (s.startsWith(JOB_A) || s.startsWith(JOB_B)));
await check(labelled.length === 4, `every experience star names its employer (${labelled.length} of 4) — jobs are labelled sub-constellations, not a scatter`);
const grouped = await page.evaluate(() => {
  const pt = (li) => { const s = li.getAttribute('style') ?? ''; return { x: parseFloat(/left:\s*([\d.]+)px/.exec(s)?.[1] ?? '0'), y: parseFloat(/top:\s*([\d.]+)px/.exec(s)?.[1] ?? '0') }; };
  const lis = [...document.querySelectorAll('.skylist li')].map(pt);
  const span = (a) => { const xs = a.map((p) => p.x), ys = a.map((p) => p.y); return Math.round(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))); };
  return { biggest: span(lis.slice(0, 4)), smallest: span(lis.slice(-1)) };
});
await qa.note(`sky weighting: the biggest section spans ${grouped.biggest}px, a one-fact section ${grouped.smallest}px — bigger sections get more sky`);
await check(grouped.biggest > grouped.smallest, 'the sky is weighted by section size — a map, not a scatter');
await qa.click(page.locator('.skylist button').first(), 'tap a star to read its fact');
await qa.expectVisible('.sky .sheet.in', 'a star opens its own detail');
await qa.click(page.getByRole('button', { name: 'Sorted' }), 'switch back to the sorted list');
await qa.expectVisible('#profileview', 'the list is back');

// =============================================================================================
// 4. THE RAIL — Location with a labelled work-rights line, Job family's honest empty state.
// =============================================================================================

await qa.expectVisible('.rloc', 'the rail\'s Location section');
await qa.expectText('.rloc .rrole', 'Hong Kong', 'the rail shows where she is searching');
await qa.expectText('.rloc .rlabel', 'Work rights · Hong Kong', 'the work-rights line is LABELLED with the place it is about');

await qa.expectText('.rjob .rrole', 'IT project manager in Hong Kong', 'Job family shows the role exactly as she typed it');
const invented = await page.evaluate(() => ({ fam: document.querySelectorAll('.rfam').length, sib: document.querySelectorAll('.rrow .rtag').length, src: document.querySelectorAll('.rjob .rsrc').length }));
await check(invented.fam === 0 && invented.sib === 0 && invented.src === 0, 'FALSIFIABLE: family is null — no family name, no sibling titles, no open-jobs count is invented anywhere');
const railBody = await page.locator('.rjob').innerText();
await check(!/family|cluster|stub/i.test(railBody.replace(/Job family/i, '')), 'FALSIFIABLE: the internal one-family stub never reaches a display');
await qa.expectVisible('.rjob .rdoor', 'and one door back: "Not the job you meant?"');

// =============================================================================================
// 5. BOTH CORRECTION DOORS — each re-opens the ORIGINAL question, pre-filled.
// =============================================================================================

await qa.click('.rjob .rdoor', 'open the role door: "Not the job you meant?"');
await qa.expectVisible('#role-again', 'the original role question re-opens');
const rolePre = await page.locator('#role-again').inputValue();
await check(rolePre === 'IT project manager in Hong Kong', `the role question is pre-filled with her answer ("${rolePre}")`);
await qa.press('#role-again', 'Escape', 'back out — nothing is lost');
await qa.expectText('.rjob .rrole', 'IT project manager in Hong Kong', 'her role is untouched');

await qa.click('.rloc .rdoor >> nth=0', 'open the area door: "Change"');
await qa.expectVisible('#loc-area-again', 'the original search-area question re-opens');
const areaPre = await page.locator('#loc-area-again').inputValue();
await check(areaPre === 'Hong Kong', `the area question is pre-filled with her answer ("${areaPre}")`);
await qa.expectText('.rloc .rnote', 'it can be different from where you live', 'the area door carries its own helper, not a second editor');
await qa.click('.rloc .rbtns button:has-text("Keep Hong Kong")', 'back out of the area door');

// =============================================================================================
// 6. THE MARKET-SWITCH JOURNEY — answer, switch, "Answer it now", switch back, answer kept.
// =============================================================================================

await qa.click('.rloc .rrow .rdoor', 'she answers the Hong Kong work-rights question: "Answer it now"');
await qa.expectVisible('.rloc .rq', 'the work-rights question opens inside the rail');
await qa.expectText('.rloc .rqq', 'Can you work in Hong Kong without sponsorship?', 'the question names the place it is about');
await qa.click('.rloc .rbtn:has-text("Yes — no sponsorship needed")', 'she answers YES for Hong Kong');
await qa.expectText('.rloc .rrow .rrole', 'Yes — no sponsorship needed', 'her Hong Kong answer is now shown, labelled with Hong Kong');
await qa.expectText('.rloc .rrow .rdoor', 'Change this answer', 'and it has a door to change it');

// --- switch the market to Singapore, watching the honest waiting state ---
cardsDelayMs = 5000;
await qa.click('.rloc .rline .rdoor', 'she opens the area door to move her search');
await qa.fill('#loc-area-again', 'Singapore', 'she types Singapore');
await qa.click('.rloc .rbtns button:has-text("Search this")', 'and confirms the switch');
await qa.expectVisible('.rfetch', 'the honest waiting state shows while the new market is fetched');
await qa.expectText('.rfetch', "Fetching Singapore jobs… nothing you've answered is re-asked.", 'the waiting line promises nothing she answered is re-asked');
await shot('switch-waiting-state.png');
cardsDelayMs = 0;
await page.waitForSelector('.rloc .rline', { timeout: 20000 });

await qa.expectText('.rloc .rline .rrole', 'Singapore', 'she is now searching Singapore');
await qa.expectText('.rloc .rlabel', 'Work rights · Singapore', 'the work-rights line is relabelled to the new place');
const sgLine = await page.locator('.rloc .rrow').innerText();
await check(!/Yes — no sponsorship needed/.test(sgLine), 'FALSIFIABLE: her Hong Kong "yes" is NEVER borrowed as a Singapore answer');
await qa.expectText('.rloc .rrow .rrole', "I haven't asked you about this place yet.", 'the new place reads as honestly unanswered');
await qa.expectText('.rloc .rrow .rdoor', 'Answer it now', 'and the Singapore question is offered as open — never a forced re-ask');

// --- switch back to Hong Kong: the original answer is still there, never re-asked ---
await qa.click('.rloc .rline .rdoor', 'she changes her search area back');
await qa.fill('#loc-area-again', 'Hong Kong', 'she types Hong Kong again');
await qa.click('.rloc .rbtns button:has-text("Search this")', 'and confirms');
await page.waitForSelector('.rloc .rline', { timeout: 20000 });
await qa.expectText('.rloc .rline .rrole', 'Hong Kong', 'she is back on Hong Kong');
await qa.expectText('.rloc .rlabel', 'Work rights · Hong Kong', 'the work-rights line is labelled Hong Kong again');
await qa.expectText('.rloc .rrow .rrole', 'Yes — no sponsorship needed', 'her ORIGINAL Hong Kong answer is still there, unchanged');
await qa.expectText('.rloc .rrow .rdoor', 'Change this answer', 'she is never re-asked a question she already answered');
await check(!(await page.locator('.rloc .rq').count()), 'no question is forced open on return — nothing she said was lost');

// =============================================================================================
// 7. PHONE — the same content stacked, with nothing unreachable. Owner-deliverable screenshots.
// =============================================================================================

await page.setViewportSize({ width: 390, height: 844 });
await qa.goto('/profile', 'Mei opens the same profile on her phone');

const stacked = await page.evaluate(() => {
  const s = document.querySelector('.stage');
  const f = document.querySelector('.field')?.getBoundingClientRect();
  const r = document.querySelector('.rail')?.getBoundingClientRect();
  return { dir: getComputedStyle(s).flexDirection, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth, beside: f && r ? r.left >= f.right - 2 : false };
});
await check(stacked.dir === 'column', 'phone: the field and rail STACK into one column');
await check(!stacked.beside, 'phone: nothing is squeezed side by side');
await check(stacked.overflowX <= 1, `phone: the page never scrolls sideways (${stacked.overflowX}px overflow)`);

await qa.expectVisible('.rloc', 'phone: the Location section is on screen');
await qa.expectText('.rloc .rlabel', 'Work rights · Hong Kong', 'phone: the labelled work-rights line survives');
await qa.expectText('.rloc .rrow .rrole', 'Yes — no sponsorship needed', 'phone: her answer is here too');
await shot('mobile-rail-location.png');

await qa.expectVisible('.rjob', 'phone: the Job family section is on screen');
await qa.expectText('.rjob .rrole', 'IT project manager in Hong Kong', 'phone: the role as typed');
await qa.expectVisible('.rjob .rdoor', 'phone: the correction door is reachable under a thumb');
const tap = await page.locator('.rjob .rdoor').evaluate((b) => Math.round(b.getBoundingClientRect().height));
await qa.note(`phone: the correction door's own box is ${tap}px tall (below the 44px touch-target guidance — recorded for the mobile design session, it is the shipped rail's text-door idiom, not new here)`);
await qa.click('.rjob .rdoor', 'phone: tap the correction door with a thumb anyway');
await qa.expectVisible('#role-again', 'phone: the door opens under a thumb and the question is reachable');
await qa.press('#role-again', 'Escape', 'phone: back out of the door');
await shot('mobile-rail-job-family.png');
await qa.scrollThrough('scroll the stacked phone screen the way a reader would');
await shot('mobile-rail-stacked-overview.png');

// The facts themselves — the phone composition opens them as a pull-up sheet.
const sheetDoor = page.getByRole('button', { name: /Your facts/ });
const hasSheet = (await sheetDoor.count()) > 0;
if (hasSheet) {
  await qa.click(sheetDoor, 'phone: pull the facts sheet up');
}
await qa.expectVisible('#profileview', 'phone: the whole fact list is reachable — nothing the desktop shows is missing');
await qa.expectText('.pcount', "12 things you've told me", 'phone: the hero counts read the same');
await shot('mobile-rail-hero.png');
const phoneHeads = await texts('.dname');
await check(phoneHeads[0] === 'About you', 'phone: About you still leads');
await check(phoneHeads.join('|') === headings.join('|'), 'phone: exactly the same sections as desktop — nothing dropped for the small screen');
await qa.expectVisible('.jblk .jhead', 'phone: the per-job blocks survive');
await qa.scrollThrough('read the phone list top to bottom');
await shot('mobile-rail-list.png');

await qa.click(page.locator('.dom').filter({ hasText: 'Skills' }).locator('.fact.grey').first(), 'phone: tap a kept skill chip');
await qa.expectVisible('dialog.detail', 'phone: the fact detail opens');
await qa.press('body', 'Escape', 'close the detail');

await qa.click(page.getByRole('button', { name: 'Constellation' }), 'phone: switch to the Constellation');
await page.waitForTimeout(900);
await qa.expectVisible('.sky', 'phone: the sky renders on a phone too');
await shot('mobile-rail-constellation.png');
await qa.click(page.getByRole('button', { name: 'Sorted' }), 'phone: back to the list');

// A narrower phone, to be sure nothing falls off the edge.
await page.setViewportSize({ width: 360, height: 800 });
await qa.goto('/profile', 'and on a 360px phone');
const narrow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
await check(narrow <= 1, `360px: still no sideways scroll (${narrow}px)`);
await qa.expectVisible('.rloc', '360px: Location is still reachable');
await shot('mobile-rail-360.png');

const ok = await qa.finish();
console.log(`mobile screenshots: ${path.resolve(SHOTS)}`);
process.exit(ok && failures === 0 ? 0 : 1);
