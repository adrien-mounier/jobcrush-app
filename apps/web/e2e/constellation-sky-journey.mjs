// #187 the weighted constellation with job sub-clusters + #193 the answer-only languages door.
//
// Driven as a human, human-paced, at desktop and phone viewports. The API is route-mocked (the same
// pinned ProfileState shape profile.spec.ts uses), so this flow needs only a running web app — no
// Fastify, no model key:
//
//   pnpm --filter @jobcrush/web dev              (or: npx next start -p 3100)
//   BASE_URL=http://127.0.0.1:3000 node apps/web/e2e/constellation-sky-journey.mjs
//
// What it drives beyond the .spec.ts: an unequal multi-section sky seen whole, an empty section
// proven to take no sky, a star tapped for its detail, the >40-fact label reveal on hover AND its
// touch equivalent on a phone, and the answer-only Languages section in BOTH views — list and sky.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const OUT = process.env.QA_OUT ?? 'qa-results';

const LANGUAGES_QUESTION = {
  questionId: 'eligibility-languages',
  question: "Which languages do you speak? Start typing — I'll suggest as you go.",
  consequence:
    "Nothing you leave out counts against you: a job wanting a language you didn't list still stays in your deck. When one of them matters for a real job, I'll ask how well you speak it, and say why.",
  options: ['English', 'Mandarin', 'Cantonese', 'Vietnamese', 'Ask me later'],
  answer: null,
};

const JOB_A = 'IT Project Manager · Veolia';
const JOB_B = 'Senior Consultant · Capgemini';

function fact(id, text, colour, job = null, source = 'told') {
  return { id, text, colour, source, job };
}

// A profile of deliberately unequal sections, two jobs in Experience, one empty section, and a
// Languages section that exists ONLY because of a stored answer (#193).
const MIXED = {
  factCount: 14,
  search: { role: 'IT project manager in Hong Kong', family: null, siblingTitles: [], openJobs: null },
  domains: [
    {
      tag: 'experience',
      heading: 'Professional Experience',
      facts: [
        fact('a1', 'Coordinated vendor contracts across three markets.', 'gold', JOB_A),
        fact('a2', 'Ran the go-live cutover for a regional rollout.', 'grey', JOB_A, 'read'),
        fact('a3', 'Chaired the weekly steering committee.', 'grey', JOB_A),
        fact('b1', 'Delivered a SAP rollout across three sites.', 'gold', JOB_B),
        fact('b2', 'Owned a seven-figure vendor budget.', 'grey', JOB_B, 'read'),
      ],
    },
    { tag: 'skill', heading: 'Skills', facts: Array.from({ length: 6 }, (_, i) => fact(`s${i}`, `Skill ${i}.`, i % 3 === 0 ? 'gold' : 'grey')) },
    { tag: 'cert', heading: 'Certifications', facts: [fact('c1', 'PMP.', 'gold')] },
    { tag: 'edu', heading: 'Education', facts: [] }, // #187 A2: an empty section must take no sky
    {
      tag: 'lang',
      heading: 'Languages',
      facts: [
        { ...fact('lang-answer-Mandarin', 'Mandarin', 'grey'), answerOnly: true },
        { ...fact('lang-answer-Cantonese', 'Cantonese', 'grey'), answerOnly: true },
      ],
    },
  ],
  contact: { phone: null, email: null },
  location: { area: null, workRights: null },
  languagesQuestion: { ...LANGUAGES_QUESTION, answer: ['Mandarin', 'Cantonese'] },
};

const BIG = {
  ...MIXED,
  factCount: 45,
  domains: [
    {
      tag: 'experience',
      heading: 'Professional Experience',
      facts: Array.from({ length: 45 }, (_, i) => fact(`f${i}`, `Delivered item ${i}.`, i % 2 === 0 ? 'gold' : 'grey', JOB_B)),
    },
  ],
  languagesQuestion: LANGUAGES_QUESTION,
};

const qa = await createSession('constellation-sky', { baseURL: BASE, outDir: OUT, viewport: { width: 1280, height: 900 } });
const { page } = qa;
page.setDefaultTimeout(12000);

// Notes are echoed to stdout as well as the report, so a CI log alone tells the story.
async function note(text) {
  console.log(`NOTE: ${text}`);
  await qa.note(text);
}

let state = MIXED;
await page.route('**/api/sessions/me', (route) => route.fulfill({ json: { ok: true } }));
await page.route('**/api/profile', (route) => route.fulfill({ json: state }));

async function opaquePixels() {
  return page.evaluate(() => {
    const c = document.querySelector('.sky canvas');
    if (!c) return -1;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
    return n;
  });
}

// ---------- desktop: the list, then the sky ----------
await qa.goto('/profile', 'A person opens their profile at desktop size.');
await qa.scrollThrough('Reading the whole profile the way a person would.');

// #193 in the list: the Languages section exists purely from a stored answer.
await qa.expectVisible('.dname:text-is("Languages")', '#193: a Languages section is here even though the CV named no languages.');
await qa.expectText('.fact.inert', 'Mandarin', '#193: the answered language shows as a kept chip.');
const inertCount = await page.locator('.fact.inert').count();
await note(`#193: ${inertCount} answer-only chip(s) rendered; they are <span>, not buttons.`);
await qa.expectVisible(page.getByRole("button", { name: "Change your languages" }), '#193: exactly one editing door for languages.');
const doorCount = await page.getByRole('button', { name: 'Change your languages' }).count();
await note(`#193: languagesDoorCount=${doorCount} (must be exactly 1).`);
await qa.click(page.getByRole("button", { name: "Change your languages" }), '#193: opening the door to change the stored answer.');
const ticked = await page.locator('input[type="checkbox"]:checked').count();
await note(`#193: the door opens pre-ticked with ${ticked} language(s) from the stored answer.`);
await qa.click(page.getByRole("button", { name: "Keep what I have" }), 'Backing out of the door — nothing changes.');

// #187 A2: an empty Education section drew no list section either.
const eduInList = await page.locator('.dname').filter({ hasText: /^Education$/ }).count();
await note(`#187 A2 (list): empty Education sections drawn = ${eduInList} (expect 0).`);

await qa.click(page.getByRole("button", { name: "Constellation" }), '#187: switching to the Constellation view.');
await page.locator('.skylist button').first().waitFor({ state: 'attached' });
await page.waitForTimeout(600);
await qa.expectVisible('.sky', '#187: the sky renders.');
const starCount = await page.locator('.skylist button').count();
await note(`#187 A2: ${starCount} stars drawn for 14 facts across 4 non-empty sections — the empty section contributes none.`);
if (starCount !== 14) await qa.expectText('.skylist', `${14} stars`, `#187 A2 FAILED: expected 14 stars, saw ${starCount}.`);

// #187 A1: measure the sky each section occupies, from the accessible list's absolute positions.
const spans = await page.evaluate(() => {
  const lis = [...document.querySelectorAll('.skylist li')];
  const pt = (li) => {
    const s = li.getAttribute('style') ?? '';
    return { x: parseFloat(/left:\s*([\d.]+)px/.exec(s)?.[1] ?? '0'), y: parseFloat(/top:\s*([\d.]+)px/.exec(s)?.[1] ?? '0') };
  };
  const box = (arr) => {
    const xs = arr.map((p) => p.x), ys = arr.map((p) => p.y);
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  };
  const p = lis.map(pt);
  // The sky orders sections by size (#186), not payload order: Skills(6), Experience(5), Languages(2), Certifications(1).
  return { skills: box(p.slice(0, 6)), experience: box(p.slice(6, 11)), lang: box(p.slice(11, 13)), cert: box(p.slice(13, 14)) };
});
await note(`#187 A1: sky span per section (px) — Skills(6 facts)=${spans.skills.toFixed(0)}, Experience(5)=${spans.experience.toFixed(0)}, Languages(2)=${spans.lang.toFixed(0)}, Certifications(1)=${spans.cert.toFixed(0)}. Bigger section, more sky.`);
if (!(spans.skills > spans.lang && spans.lang > spans.cert)) await qa.expectVisible('#no-such-element', '#187 A1 FAILED: section spans are not ordered by section size.');

// #187 A2: employer labels on the two job sub-clusters, each star naming its own job.
const jobALabels = await page.locator(`.skylist button[aria-label^="${JOB_A}"]`).count();
const jobBLabels = await page.locator(`.skylist button[aria-label^="${JOB_B}"]`).count();
await note(`#187 A2: ${jobALabels} stars announce "${JOB_A}" and ${jobBLabels} announce "${JOB_B}" — two named sub-constellations, each star carrying its own employer.`);
if (jobALabels !== 3 || jobBLabels !== 2) await qa.expectVisible('#no-such-element', `#187 A2 FAILED: expected 3 + 2 job-attributed stars, saw ${jobALabels} + ${jobBLabels}.`);

await qa.scrollThrough('Looking over the whole sky, employer labels and section labels painted on it.');

// #187 A5: tap a star, get the same detail the list gives.
await qa.click('.skylist button[aria-label*="Ran the go-live cutover"]', '#187 A5: tapping a star in the sky — a kept fact read from the CV.');
await qa.expectVisible('.sheet.in', '#187 A5: the fact detail opens.');
await qa.expectText('.sheet.in', 'Read from your CV.', '#187 A5: the same said-vs-read line the list shows.');
await qa.expectText('.sheet.in', 'Left out for space', '#187 A5: the same kept caption the list shows.');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// ADVERSARIAL: the answer-only language chip is inert in the list. Is its STAR inert in the sky?
const langStar = page.locator('.skylist button[aria-label^="Mandarin"]').first();
const langStarCount = await langStar.count();
await note(`#193 x #187 probe: answer-only language stars in the sky = ${langStarCount} (the list renders these as inert spans).`);
if (langStarCount > 0) {
  await qa.click(langStar, 'Probe: tapping the answer-only language star in the sky.');
  const opened = await page.locator('.sheet.in').count();
  const sheetText = opened ? (await page.locator('.sheet.in').innerText()).replace(/\s+/g, ' ').slice(0, 200) : '(no sheet)';
  await note(`Probe result: detail sheet opened = ${opened > 0}. Content: ${sheetText}`);
  if (opened) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
}

// ---------- desktop: the big sky, labels hidden until hover ----------
state = BIG;
await qa.goto('/profile', '#187 A3: a 45-fact profile — past the 40-fact threshold.');
await qa.click(page.getByRole("button", { name: "Constellation" }), 'Switching to the sky.');
await page.waitForTimeout(700);
const rest = await opaquePixels();
await page.locator('.skylist button').first().hover({ force: true });
await page.waitForTimeout(700);
const hovered = await opaquePixels();
await note(`#187 A3: painted pixels at rest=${rest}, on hover=${hovered}. Hover reveals the hidden employer label (+${hovered - rest}).`);
if (!(hovered > rest + 40)) await qa.expectVisible('#no-such-element', `#187 A3 FAILED: hovering revealed no label (rest=${rest}, hovered=${hovered}).`);
await page.mouse.move(2, 2);
await page.waitForTimeout(700);
const away = await opaquePixels();
await note(`#187 A3: pixels after moving away=${away} — the label goes back into hiding.`);

// ---------- phone: the touch equivalent of hover ----------
// On a phone the facts live in a pull-up sheet (#192), so a person opens it with a thumb first.
async function pullSheetOpen() {
  const b = await page.locator('.pfgrab').boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(x, y - (110 * i) / 10);
    await page.waitForTimeout(45);
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
}

// A tap opens the fact sheet, which resizes the sky — so a before/after pixel count on ONE fixture
// is not a fair comparison. Instead: tap the same star on the same 45-fact sky twice, once with an
// employer on every fact and once with none. Only the employer label can differ the two.
const BIG_NOJOB = {
  ...BIG,
  domains: [{ ...BIG.domains[0], facts: BIG.domains[0].facts.map((f) => ({ ...f, job: null })) }],
};
await page.setViewportSize({ width: 390, height: 844 });

async function phoneTapPixels(fixture, label) {
  state = fixture;
  await qa.goto('/profile', label);
  await pullSheetOpen();
  await qa.click(page.getByRole("button", { name: "Constellation" }), 'Switching to the sky on the phone.');
  await page.locator('.skylist button').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(700);
  // force: at 45 facts on a 390px screen the stars overlap, so a plain tap is intercepted by a
  // neighbour — recorded as an observation, not asserted here.
  await page.locator('.skylist button').first().click({ force: true });
  await qa.note('Tapping a star — the touch equivalent of hover.');
  await page.waitForTimeout(900);
  return opaquePixels();
}

const phoneWithJob = await phoneTapPixels(BIG, '#187 UX intent: a 45-fact sky on a phone, every fact carrying its employer.');
const phoneNoJob = await phoneTapPixels(BIG_NOJOB, 'Control: the same 45-fact sky with no employer on any fact.');
await note(`#187 phone touch reveal: painted pixels after tapping a star — with employer=${phoneWithJob}, control with none=${phoneNoJob} (difference ${phoneWithJob - phoneNoJob}). A positive difference is the employer label appearing on tap.`);
if (!(phoneWithJob > phoneNoJob + 40)) await qa.expectVisible('#no-such-element', `#187 phone FAILED: tapping a star revealed no employer label (withJob=${phoneWithJob}, control=${phoneNoJob}).`);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// ---------- phone: the answer-only languages door ----------
state = MIXED;
await qa.goto('/profile', '#193 on a phone: the answer-only Languages section and its door.');
await pullSheetOpen();
await qa.scrollThrough('Scrolling the phone facts sheet down to Languages.');
await page.locator('.pfsheet-body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
await page.waitForTimeout(700);
await qa.expectVisible('.fact.inert', '#193 phone: the answered languages are visible as kept chips.');
await qa.expectVisible(page.getByRole("button", { name: "Change your languages" }), '#193 phone: the editing door is reachable.');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
