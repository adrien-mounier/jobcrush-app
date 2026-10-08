// #343 QA gate — the word choices on a drafted line, walked over the REAL stack (fake model only):
//
//   1. once the review lands, each new line's vague phrase wears the dotted underline, the bracket
//      the model wrote is gone, and the phrase the line never says is not marked; the legend says
//      "choose a word";
//   2. a tap on the phrase opens its choices in the sheet: From your CV first (tagged YOUR CV, with
//      the CV words it came from), then Typical (tagged TYPICAL), and "Or type your own" + Use —
//      the fake lists the typical option FIRST, so the order on screen is the server's doing;
//   3. opening the choices sends nothing and asks the writer nothing (/qa/llm-calls unchanged);
//   4. she picks the CV choice — the line reads it, on the paper and on the server; she changes her
//      mind and picks Typical; on another line she types her own words;
//   5. a reload shows both lines in her wording; she ticks the picked line with the +;
//   6. "I'm done"; signed in, her master CV prints the ticked line in her wording and not the
//      typed-but-unticked one, nor the model's vague phrase; the writer was never asked again.
//
//   PORT=34101 OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 30338
//   BASE_URL=http://127.0.0.1:30338 node apps/web/e2e/word-choices-journey.mjs
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:30338';
const WIDTH = Number(process.env.QA_WIDTH ?? 390);
const ROLE = 'IT project manager';
const AREA = 'Singapore';
const EMAIL = `word-choices-${Date.now()}@example.com`;
// qaReviewAnswer.ts: every must-have draft reads "Owned … for [the business and technical groups]."
const PHRASE = 'the business and technical groups';
const CV_CHOICE = 'the vendor teams';
const TYPICAL_CHOICE = 'the steering committee';
const MINE = 'the finance and warehouse teams';

const CV_TEXT = [
  'Jane Doe',
  '+33 6 00 00 00 00 | jane.doe.343@example.com',
  'Warsaw, Poland',
  '',
  'EXPERIENCE',
  '',
  'IT Project Manager, Nordic Retail Group, Warsaw — Mar 2021 - Present',
  '- Led the checkout replatforming and delivered it two months ahead of plan.',
  '- Managed a budget of EUR 1.2M across three vendor teams.',
  '',
  'Project Coordinator, Baltic Software House, Warsaw — Jun 2017 - Feb 2021',
  '- Coordinated releases for four agile squads.',
  '',
  'EDUCATION',
  'MSc Management Information Systems, University of Warsaw, 2017',
  '',
  'REVIEWCHECK',
].join('\n');

const qa = await createSession(`word-choices-journey-${WIDTH}`, {
  baseURL: BASE,
  viewport: { width: WIDTH, height: WIDTH < 600 ? 844 : 900 },
});
const { page } = qa;
page.setDefaultTimeout(20_000);
const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
const json = (path, init) =>
  page.evaluate(
    async ([p, i]) => {
      const res = await fetch(`/api${p}`, { credentials: 'same-origin', ...(i ?? {}) });
      let body = null;
      try { body = await res.json(); } catch { /* no body */ }
      return { status: res.status, body };
    },
    [path, init ?? null],
  );
const send = (method, path, body) =>
  json(path, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const allLines = async () => (await json('/review')).body.sections.find((s) => s.tag === 'experience').jobs.flatMap((j) => j.lines);
const line = async (id) => (await allLines()).find((l) => l.id === id) ?? null;
const reviewCalls = async () => (await json('/qa/llm-calls')).body.review;
const sheet = page.getByRole('dialog');
// Every request the page sends from here on, so "opening the choices sent nothing" is witnessed.
const sent = [];
page.on('request', (r) => { if (r.url().includes('/api/') && r.method() !== 'GET') sent.push(`${r.method()} ${new URL(r.url()).pathname}`); });

try {
  // -------------------------------------------------------------------------------------------
  // 0. Her CV, her target, the questions the CV cannot answer — then the review.
  // -------------------------------------------------------------------------------------------
  await qa.goto('/', 'the front door');
  const jobId = await qa.frontDoorPaste(CV_TEXT, 'she pastes her CV');
  await qa.waitForJobDone(jobId);
  await qa.frontDoorContinueToIntent();
  await qa.fill('#target-role', ROLE, `the job she is going for: "${ROLE}"`);
  await qa.fill('#search-area', AREA, `where: ${AREA}`);
  await qa.click('button:has-text("Save and continue")', 'Save and continue');
  await page.waitForTimeout(1500);
  await qa.goto('/discovery', 'the questions the CV cannot answer');
  for (let i = 0; i < 8 && !/\/review/.test(page.url()); i += 1) {
    await page.waitForTimeout(1500);
    if (/\/review/.test(page.url())) break;
    const multiDone = page.locator('.discovery .elig-actions .go');
    if (await multiDone.count()) { await qa.click(multiDone.first(), 'finishes the multi-select question'); continue; }
    if (!(await qa.answerVisibleQuestion({ note: `answers the question on screen (${i + 1})` }))) {
      const later = page.getByRole('button', { name: 'Ask me later', exact: true });
      if (await later.count()) await qa.click(later.first(), 'ask me later');
      else break;
    }
  }
  await page.waitForURL(/\/review/, { timeout: 20_000 });
  await page.getByRole('status').waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {});
  await page.locator('.paper li.nl').first().waitFor({ state: 'visible', timeout: 60_000 });
  const calls = await reviewCalls();
  await qa.note(`the review writer was asked ${calls} time(s) for this run`);

  // -------------------------------------------------------------------------------------------
  // 1. The marks on the paper.
  // -------------------------------------------------------------------------------------------
  const drafts = (await allLines()).filter((l) => l.state === 'drafted' && l.draft?.mustHave);
  await assert(drafts.length >= 2, `${drafts.length} must-have drafts, each with a vague phrase`);
  const d = drafts[0];
  // The CV option quotes her job's first line as the fake miner read it (its wording, not hers).
  const cvQuote = (await allLines()).find((l) => l.draft === null && l.text.includes('replatform'))?.text;
  await assert(
    JSON.stringify(d.draft.vague) === JSON.stringify([{ phrase: PHRASE, options: [
      { text: CV_CHOICE, from: 'CV', quote: cvQuote },
      { text: TYPICAL_CHOICE, from: 'TYPICAL', quote: null },
    ] }]),
    `the server sends one phrase (bracket gone, the phrase the line never says dropped), CV choice first: ${JSON.stringify(d.draft.vague)}`,
  );
  await assert(!d.text.includes('['), `the line reads without the model's bracket ("${d.text}")`);
  await qa.scrollThrough('she reads the paper with its new lines');
  const box = page.locator('.paper li.nl').filter({ hasText: d.text }).first();
  await qa.expectText(box.locator('.ph'), PHRASE, 'the vague phrase wears the dotted underline');
  const deco = await box.locator('.ph').evaluate((el) => getComputedStyle(el).textDecorationStyle);
  await assert(deco === 'dotted', `and the underline is dotted (${deco})`);
  await assert((await page.locator('.paper .ph', { hasText: 'a phrase the line never says' }).count()) === 0, 'a phrase the line never says is marked nowhere');
  await qa.expectText('.legend .l4', 'choose a word', 'the legend names the mark');

  // -------------------------------------------------------------------------------------------
  // 2–3. A tap opens its choices; nothing is sent, the writer is not asked.
  // -------------------------------------------------------------------------------------------
  sent.length = 0;
  await qa.click(box.locator('.ph'), 'she taps the underlined words');
  const choices = sheet.getByRole('group', { name: `Make "${PHRASE}" specific:` });
  await qa.expectVisible(choices, `the sheet opens on "Make "${PHRASE}" specific:"`);
  await qa.expectText(choices.locator('.ch-g').nth(0), 'From your CV', 'From your CV comes first');
  await qa.expectText(choices.locator('.ch-g').nth(1), 'Typical', 'then Typical');
  await qa.expectText(choices.locator('.chip').nth(0), `YOUR CV${CV_CHOICE}`, 'the first choice is the CV one, tagged YOUR CV');
  await qa.expectText(choices.locator('.chip').nth(0), cvQuote, 'with the CV words it came from');
  await qa.expectText(choices.locator('.chip').nth(1), `TYPICAL${TYPICAL_CHOICE}`, 'the second is typical, tagged TYPICAL');
  await qa.expectVisible(choices.getByRole('textbox', { name: 'Or type your own' }), 'a box for her own words beside them');
  await assert(sent.length === 0, `opening the choices sent nothing (${JSON.stringify(sent)})`);
  await assert((await reviewCalls()) === calls, 'and the writer was not asked');
  const box1 = await choices.boundingBox();
  await assert(box1 && box1.x >= 0 && box1.x + box1.width <= WIDTH, `the choices fit the phone width (${Math.round(box1?.width ?? 0)}px of ${WIDTH})`);

  // -------------------------------------------------------------------------------------------
  // 4. She picks the CV choice, then changes her mind; on another line she types her own.
  // -------------------------------------------------------------------------------------------
  const picked = d.text.replace(PHRASE, CV_CHOICE);
  await qa.click(choices.locator('.chip').nth(0), `she picks "${CV_CHOICE}"`);
  await page.waitForTimeout(800);
  await assert((await line(d.id)).text === picked && (await line(d.id)).state === 'drafted', `the server holds "${picked}", still unticked`);
  await qa.expectText(sheet.locator('.quote'), picked, 'the sheet reads her choice');
  await qa.expectText(page.locator('.paper li.nl').filter({ hasText: picked }).locator('.ph.set'), CV_CHOICE, 'the paper reads it too, still underlined so she can change it');
  await qa.click(sheet.locator('.quote').getByRole('button', { name: CV_CHOICE }), 'she taps her choice again');
  await qa.click(choices.locator('.chip').nth(1), `and picks "${TYPICAL_CHOICE}" instead`);
  await page.waitForTimeout(800);
  const changed = d.text.replace(PHRASE, TYPICAL_CHOICE);
  await assert((await line(d.id)).text === changed, `the server holds "${changed}"`);
  await qa.click(sheet.getByRole('button', { name: 'Close', exact: true }), 'she closes the sheet');

  const d2 = drafts[1];
  const typed = d2.text.replace(PHRASE, MINE);
  const box2 = page.locator('.paper li.nl').filter({ hasText: d2.text }).first();
  await qa.click(box2.locator('.ph'), 'on the next new line she taps the underlined words');
  await qa.fill(choices.getByRole('textbox', { name: 'Or type your own' }), `  ${MINE} `, 'types her own words');
  await qa.click(choices.getByRole('button', { name: 'Use' }), 'Use');
  await page.waitForTimeout(800);
  await assert((await line(d2.id)).text === typed, `the server holds her words, trimmed ("${typed}")`);
  await qa.click(sheet.getByRole('button', { name: 'Close', exact: true }), 'she closes the sheet');

  // -------------------------------------------------------------------------------------------
  // 5. Reload: both in her wording. She ticks the first with the +.
  // -------------------------------------------------------------------------------------------
  await qa.goto('/review', 'she reloads');
  await qa.expectVisible(page.locator('.paper li.nl').filter({ hasText: changed }), 'the first new line reads her choice after the reload');
  await qa.expectVisible(page.locator('.paper li.nl').filter({ hasText: typed }), 'the second reads her own words');
  await qa.click(page.locator('.paper li.nl').filter({ hasText: changed }).getByRole('button', { name: 'Tick — put it on my CV' }), 'she ticks the first with the +');
  await assert((await line(d.id)).state === 'ticked', 'the server holds the tick');
  await qa.expectVisible(page.getByRole('button', { name: `${changed} new` }), 'an ordinary line now, tagged new');
  await assert((await page.locator('.paper li:not(.nl) .ph').count()) === 0, 'a ticked line wears no word mark');

  // -------------------------------------------------------------------------------------------
  // 6. "I'm done" — what prints.
  // -------------------------------------------------------------------------------------------
  await qa.click(page.getByRole('button', { name: "I'm done — show my jobs" }), "I'm done — show my jobs");
  await page.waitForURL((u) => !/\/review/.test(u.pathname), { timeout: 20_000 });
  const signed = await page.evaluate(async ({ email }) => {
    const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const res = await post('/api/auth/request-link', { email });
    const link = await res.json();
    if (!link.devLink) return `sign-in failed (${res.status})`;
    await post('/api/auth/verify', { token: new URL('http://x' + link.devLink).searchParams.get('token') });
    return 'ok';
  }, { email: EMAIL });
  await assert(signed === 'ok', `she signs in (${signed})`);
  const built = await send('POST', '/onboarding/build');
  const md = built.body?.rootCv?.markdown ?? '';
  await assert(built.status === 200 && md.includes(changed), 'her master CV prints the ticked line with her chosen words');
  await assert(!md.includes(typed), 'not the line she typed into but never ticked');
  await assert(!md.includes(PHRASE), "and never the model's vague phrase");
  await assert((await reviewCalls()) === calls, 'and the writer was never asked again');
} finally {
  const ok = await qa.finish();
  process.exitCode = ok ? 0 : 1;
}
