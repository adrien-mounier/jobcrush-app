// #343 QA gate, moved onto check mode by #386 — the word choices on an add suggestion, walked over
// the REAL stack (fake model only):
//
//   1. once the review lands, each suggestion's vague phrase wears the dotted underline, the bracket
//      the model wrote is gone, and the phrase the line never says is not marked;
//   2. a tap on the phrase opens its choices on the card: From your CV first (tagged YOUR CV, with
//      the CV words it came from), then Typical (tagged TYPICAL), and "Or type your own" + Use —
//      the fake lists the typical option FIRST, so the order on screen is the server's doing;
//   3. opening the choices sends nothing and asks the writer nothing (/qa/llm-calls unchanged);
//   4. she picks the CV choice — the line reads it, on the card and on the server; she changes her
//      mind and picks Typical; on another suggestion she types her own words;
//   5. a reload shows both in her wording; she adds the picked one with "Add it";
//   6. she declines the rest and finishes; signed in, her master CV prints the added line in her
//      wording and not the typed-but-declined one, nor the model's vague phrase; the writer was
//      never asked again.
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
// Every request the page sends from here on, so "opening the choices sent nothing" is witnessed.
const sent = [];
page.on('request', (r) => { if (r.url().includes('/api/') && r.method() !== 'GET') sent.push(`${r.method()} ${new URL(r.url()).pathname}`); });

// Check mode's structure (check-mode.spec.ts selects the same way).
const h1 = page.locator('main h1');
const primary = page.locator('.foot .primary');
const items = page.locator('main li.pt');
const cards = page.locator('main li.sg:not(.rmv)');
const card = (text) => cards.filter({ hasText: text }).first();
const choices = page.getByRole('group', { name: `Make "${PHRASE}" specific:` });
async function walkTo(re) {
  await h1.waitFor();
  for (let i = 0; i < 14; i += 1) {
    if (re.test((await h1.textContent()) ?? '')) return true;
    if ((await primary.isDisabled()) || !/^Next:/.test((await primary.textContent()) ?? '')) return false;
    await primary.click();
    await page.waitForTimeout(250);
  }
  return false;
}

try {
  // -------------------------------------------------------------------------------------------
  // 0. Her CV, her target — then check mode, once the review has landed.
  // -------------------------------------------------------------------------------------------
  await qa.goto('/', 'the front door');
  const jobId = await qa.frontDoorPaste(CV_TEXT, 'she pastes her CV');
  await qa.waitForJobDone(jobId);
  await qa.frontDoorContinueToIntent();
  await qa.fill('#target-role', ROLE, `the job she is going for: "${ROLE}"`);
  await qa.fill('#search-area', AREA, `where: ${AREA}`);
  await qa.click('button:has-text("Save and continue")', 'Save and continue');
  await page.waitForTimeout(1500);
  await qa.goto('/discovery', 'discovery — nothing is left to ask');
  // #392: no hand-off — discovery shows the count and moves on by itself.
  await page.waitForURL(/\/profile\/check/, { timeout: 30_000 });
  for (let i = 0; i < 60 && (await json('/review')).body?.progress; i += 1) await page.waitForTimeout(500);
  await qa.goto('/profile/check', 'check mode, the review landed');
  await assert(await walkTo(/Nordic/), 'Next, to her Nordic job');
  await cards.first().waitFor({ state: 'visible', timeout: 30_000 });
  const calls = await reviewCalls();
  await qa.note(`the review writer was asked ${calls} time(s) for this run`);

  // -------------------------------------------------------------------------------------------
  // 1. The marks on the card.
  // -------------------------------------------------------------------------------------------
  const drafts = (await allLines()).filter((l) => l.state === 'drafted' && l.draft?.mustHave);
  await assert(drafts.length >= 2, `${drafts.length} must-have suggestions, each with a vague phrase`);
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
  await qa.scrollThrough('she reads her job with its suggestions');
  const box = card(d.text);
  await qa.expectText(box.locator('.ph'), PHRASE, 'the vague phrase wears the dotted underline');
  const deco = await box.locator('.ph').evaluate((el) => getComputedStyle(el).textDecorationStyle);
  await assert(deco === 'dotted', `and the underline is dotted (${deco})`);
  await assert((await page.locator('main .ph', { hasText: 'a phrase the line never says' }).count()) === 0, 'a phrase the line never says is marked nowhere');

  // -------------------------------------------------------------------------------------------
  // 2–3. A tap opens its choices; nothing is sent, the writer is not asked.
  // -------------------------------------------------------------------------------------------
  sent.length = 0;
  await qa.click(box.locator('.ph'), 'she taps the underlined words');
  await qa.expectVisible(choices, `the card opens "Make "${PHRASE}" specific:"`);
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
  // 4. She picks the CV choice, then changes her mind; on another suggestion she types her own.
  // -------------------------------------------------------------------------------------------
  const picked = d.text.replace(PHRASE, CV_CHOICE);
  await qa.click(choices.locator('.chip').nth(0), `she picks "${CV_CHOICE}"`);
  await page.waitForTimeout(800);
  await assert((await line(d.id)).text === picked && (await line(d.id)).state === 'drafted', `the server holds "${picked}", not added yet`);
  await qa.expectText(card(picked).locator('.ph.set'), CV_CHOICE, 'the card reads it, still underlined so she can change it');
  await qa.click(card(picked).locator('.ph.set'), 'she taps her choice again');
  await qa.click(choices.locator('.chip').nth(1), `and picks "${TYPICAL_CHOICE}" instead`);
  await page.waitForTimeout(800);
  const changed = d.text.replace(PHRASE, TYPICAL_CHOICE);
  await assert((await line(d.id)).text === changed, `the server holds "${changed}"`);

  const d2 = drafts[1];
  const typed = d2.text.replace(PHRASE, MINE);
  await qa.click(card(d2.text).locator('.ph'), 'on the next suggestion she taps the underlined words');
  await qa.fill(choices.getByRole('textbox', { name: 'Or type your own' }), `  ${MINE} `, 'types her own words');
  await qa.click(choices.getByRole('button', { name: 'Use' }), 'Use');
  await page.waitForTimeout(800);
  await assert((await line(d2.id)).text === typed, `the server holds her words, trimmed ("${typed}")`);

  // -------------------------------------------------------------------------------------------
  // 5. Reload: both in her wording. She adds the first.
  // -------------------------------------------------------------------------------------------
  await qa.goto('/profile/check', 'she reloads');
  await assert(await walkTo(/Nordic/), 'back to her Nordic job');
  await qa.expectVisible(card(changed), 'the first suggestion reads her choice after the reload');
  await qa.expectVisible(card(typed), 'the second reads her own words');
  await qa.click(card(changed).locator('.row button').nth(0), 'she adds the first');
  await assert((await line(d.id)).state === 'ticked', 'the server holds the add');
  await qa.expectVisible(items.filter({ hasText: changed }).locator('.tag'), 'an ordinary item now, tagged new');
  await assert((await items.locator('.ph').count()) === 0, 'an item wears no word mark');

  // -------------------------------------------------------------------------------------------
  // 6. The rest declined, the finish — what prints.
  // -------------------------------------------------------------------------------------------
  for (const l of (await allLines()).filter((x) => x.state === 'drafted')) await qa.click(card(l.text).locator('.row button').nth(2), 'No thanks');
  const keep = page.locator('main li.sg.rmv .row button.ghost');
  if (await keep.count()) await qa.click(keep.first(), 'Keep it — the removal suggestion is not this journey\'s');
  await walkTo(/^$/);
  const pill = page.locator('.wrrow .pill').filter({ has: page.locator('input[value=eligible]') }).first();
  if (await pill.count()) await qa.click(pill, 'where she can work: yes');
  await qa.click(primary, 'Finish my profile');
  await qa.expectText(h1, 'Your profile is ready', 'the done screen');
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
  await assert(built.status === 200 && md.includes(changed), 'her master CV prints the added line with her chosen words');
  await assert(!md.includes(typed), 'not the line she typed into but declined');
  await assert(!md.includes(PHRASE), "and never the model's vague phrase");
  await assert((await reviewCalls()) === calls, 'and the writer was never asked again');
} finally {
  const ok = await qa.finish();
  process.exitCode = ok ? 0 : 1;
}
