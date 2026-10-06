// #336 — "languages pre-ticked from the CV's own level", driven the way a person drives it.
//
//   front door -> discovery -> role -> the floor -> work-rights -> THE LANGUAGES QUESTION, where
//     * the CV's Native / Fluent / Professional languages arrive already ticked,
//     * a language at any other level arrives unticked, with the CV's own level word beside it,
//     * a language the CV gives no level for arrives unticked and bare (never dropped),
//   then EITHER (QA_SCENARIO=choose, the default) she unticks one, adds one the CV leaves out, and
//   confirms — and her profile, read back from the server, holds exactly what she chose —
//   OR (QA_SCENARIO=decline) she presses the decline and the server stores no language at all.
//
// ONE SEAM IS PATCHED, and only one: qa-main's fake miner replays a recording whose `lang-` claims
// (Polish, English, German — since 2026-10-06) cover only some level shapes. The flow therefore lets
// every discovery response come from the real server and replaces `cvLanguages` on the real
// languages question only, with a set that covers every shape —
// the payload below is what the real parser (apps/api/src/cvLanguages.ts) returned for the real
// claim miner's output (see CV_LANGUAGES). The answer POST and the
// profile read-back are unpatched: what is stored is the real server's own record.
//
//   PORT=30181 node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:30181 npx next dev -p 30180
//   BASE_URL=http://127.0.0.1:30180 node apps/web/e2e/cv-languages-preticked-journey.mjs
//   QA_SCENARIO=decline QA_WIDTH=1280 BASE_URL=... node apps/web/e2e/cv-languages-preticked-journey.mjs
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:30180';
const SCENARIO = process.env.QA_SCENARIO === 'decline' ? 'decline' : 'choose';
const WIDTH = Number(process.env.QA_WIDTH ?? 390);
const ROLE = 'IT project manager in Singapore';
const LANGUAGE_ITEM_ID = 'eligibility-languages';
// Real parser output for the real claim miner's lines on "Native Polish speaker, fluent in English,
// conversational German, some Italian" (sentence-style, QA re-gate 2026-10-04), plus a bare "French"
// line — what parseCvLanguage returns for a CV language with no level word.
const CV_LANGUAGES = [
  { language: 'Polish', level: 'Native', preTicked: true },
  { language: 'English', level: 'fluent', preTicked: true },
  { language: 'German', level: 'conversational', preTicked: false },
  { language: 'Italian', level: 'some', preTicked: false },
  { language: 'French', level: null, preTicked: false },
];

const qa = await createSession(`cv-languages-preticked-${SCENARIO}-${WIDTH}`, {
  baseURL: BASE,
  viewport: { width: WIDTH, height: WIDTH < 600 ? 844 : 900 },
});
const { page } = qa;
page.setDefaultTimeout(12000);
const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);

const posted = [];
await page.route(/\/api\/onboarding\/discovery(\/start|\/answer)?(\?.*)?$/, async (route) => {
  const req = route.request();
  if (req.method() === 'POST' && req.url().includes('/answer')) posted.push(req.postDataJSON());
  const res = await route.fetch();
  let body;
  try { body = await res.json(); } catch { return route.fulfill({ response: res }); }
  const q = body?.questions?.find((x) => x.itemId === LANGUAGE_ITEM_ID);
  if (q) q.cvLanguages = CV_LANGUAGES;
  return route.fulfill({ response: res, json: body });
});

const profileLanguages = () => page.evaluate(async () => {
  const r = await fetch('/api/profile', { credentials: 'same-origin' });
  if (!r.ok) return { status: r.status };
  const j = await r.json();
  return { status: r.status, answer: j.languagesQuestion?.answer ?? null };
});
const box = (name) => page.locator('.discovery .opt.check', { has: page.locator('.lbl', { hasText: new RegExp(`^${name}$`) }) });

// 1. Front door, then the role.
await qa.goto('/', 'the front door');
await qa.goto('/discovery', 'into discovery');
await qa.fill(page.getByRole('textbox', { name: /What kind of job are you going for/ }), ROLE, 'Q1: type the role');
await qa.click(page.getByRole('button', { name: "That's me" }), 'Q1: submit the role');
await page.waitForTimeout(2000);

// 2. The floor (seeded over the wire — not under test here), then reload onto the eligibility block.
const seeded = await qa.seedFloorAnswers();
await qa.note(`floor answers seeded over the wire: ${seeded.length}`);
await qa.goto('/discovery', 'back onto discovery — the eligibility block');
await page.waitForTimeout(1500);
for (let i = 0; i < 4; i++) {
  if (await page.locator('.discovery fieldset.elig-group').count()) break;
  if (!(await qa.answerVisibleQuestion({ note: `answer the eligibility question on screen (${i + 1})` }))) break;
  await page.waitForTimeout(2200);
}

// 3. THE LANGUAGES QUESTION.
await qa.expectVisible('.discovery fieldset.elig-group', 'the languages question is on screen');
await qa.scrollThrough('read the languages question top to bottom');
await qa.expectText('#lang-cv-label', 'From your CV', 'the CV languages are introduced as coming from her CV');
for (const l of CV_LANGUAGES) {
  const checked = await box(l.language).locator('input').isChecked();
  await assert(checked === l.preTicked,
    `${l.language} (${l.level ?? 'no level'}) arrives ${l.preTicked ? 'TICKED' : 'unticked'} — got ${checked ? 'ticked' : 'unticked'}`);
  if (l.level) await qa.expectText(box(l.language), l.level, `${l.language} shows the CV's own level word "${l.level}"`);
}
await qa.expectVisible(box('French'), 'French (no level on the CV) is still listed — never dropped');
await assert((await box('French').locator('.state').count()) === 0, 'French shows no level word, because the CV gives none');
await assert((await page.locator('.discovery .chips').count()) === 0, 'no CV language is shown twice as a chip');
const before = await profileLanguages();
await assert(before.status === 200 && !(before.answer?.length), `nothing is stored just by showing the ticks — profile languages: ${JSON.stringify(before)}`);

if (SCENARIO === 'choose') {
  await qa.click(box('English').locator('input'), 'she unticks English');
  await qa.fill('#lang-input', 'Swedish', 'she types a language the CV does not list');
  await qa.click(page.getByRole('button', { name: 'Add', exact: true }), 'Add Swedish');
  await qa.expectVisible(page.locator('.discovery .chips', { hasText: 'Swedish' }), 'Swedish sits in her list');
  await qa.click(page.getByRole('button', { name: "That's all of them" }), "That's all of them");
  await page.waitForTimeout(2500);
  await assert(JSON.stringify(posted.at(-1)) === JSON.stringify({ itemId: LANGUAGE_ITEM_ID, answers: ['Polish', 'Swedish'] }),
    `what she submitted is exactly her choice — ${JSON.stringify(posted.at(-1))}`);
  const after = await profileLanguages();
  await assert(JSON.stringify([...(after.answer ?? [])].sort()) === JSON.stringify(['Polish', 'Swedish']),
    `the server stored exactly Polish + Swedish (no English, no unticked CV language) — ${JSON.stringify(after)}`);
} else {
  await qa.click(page.locator('.discovery .elig-actions .opt.quiet'), 'she presses the decline instead');
  await page.waitForTimeout(2500);
  await assert(JSON.stringify(posted.at(-1)) === JSON.stringify({ itemId: LANGUAGE_ITEM_ID, answer: 'Ask me later' }),
    `the decline is posted, never the pre-ticked languages — ${JSON.stringify(posted.at(-1))}`);
  const after = await profileLanguages();
  await assert(!(after.answer?.length), `the server stored no language at all — ${JSON.stringify(after)}`);
}
await qa.note(`landed on ${new URL(page.url()).pathname}`);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
