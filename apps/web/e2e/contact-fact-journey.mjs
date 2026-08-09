// #190 "contact info is a fact" — the whole journey, driven as a human against a REAL full stack.
//
// Paste a CV whose header carries a phone and an email -> open the profile -> see both under
// "About you" with where each came from -> open the phone door (pre-filled) -> correct it ->
// paste the CV again -> the tailored draft carries the CORRECTED number and never the CV's own.
//
// Nothing here is route-mocked: real Fastify, real contact store, real extract, real pipeline,
// real render. Only the MODEL is faked, using the same seam apps/api/test uses — the fake tailor
// copies the CV header verbatim out of the prompt, exactly as preview-tailor.md rule 3 instructs
// the real one to. That keeps the run free and deterministic while leaving every line of #190's
// own code (capture, store, payload, render preference) genuinely exercised.
//
// Run it:
//   node apps/api/dist/main.js                     # or any real API on :3001
//   cd apps/web && npx next build && npx next start -p 3000
//   node apps/web/e2e/contact-fact-journey.mjs
//
// A QA-only variant of the API that fakes the model (so no key is needed) lives beside this flow's
// evidence run; see the ticket's QA report. BASE_URL overrides the web origin.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

// The header the CV carries. The email deliberately holds an 8-digit local part
// (jane.12345678@...) — the exact shape that fooled an early build's phone swap into splicing the
// stored number into the middle of the address.
const CV_PHONE = '+33 6 00 00 00 00';
const CV_EMAIL = 'jane.12345678@example.com';
const CORRECTED_PHONE = '+33 6 99 99 99 99';

const CV_TEXT = [
  'Jane Doe',
  `${CV_PHONE} | ${CV_EMAIL}`,
  'Paris, France',
  '',
  'EXPERIENCE',
  '',
  'IT Project Manager, Nordic Retail Group, Warsaw — Mar 2021 - Present',
  '- Led the checkout replatforming and delivered it two months ahead of plan.',
  '- Managed a budget of EUR 1.2M across three vendor teams.',
  '- Ran steering committee reporting for the CIO every month.',
  '',
  'Project Manager, Acme Systems, Paris — Jan 2018 - Feb 2021',
  '- Delivered a payments migration for a retail bank across four countries.',
  '- Coordinated a team of twelve engineers and two business analysts.',
  '',
  'EDUCATION',
  'MSc Management Information Systems, University of Warsaw, 2017',
  '',
  'SKILLS',
  'Jira, MS Project, stakeholder management, vendor management, budgeting',
].join('\n');

const qa = await createSession('contact-fact-journey', { baseURL: BASE, viewport: { width: 1280, height: 900 } });
const { page } = qa;
page.setDefaultTimeout(15000);

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

const draftFrame = () => page.frameLocator('iframe[title="Tailored CV draft"]');

/** Paste the CV and ride the progress feed through to the rendered draft. */
async function pasteCvAndWaitForDraft(label) {
  await qa.goto(`${BASE}/paste`, `${label}: the person opens the paste screen`);
  await qa.fill('textarea[aria-label="Your CV text"]', CV_TEXT, `${label}: pastes the CV, header and all`);
  await qa.click('button:has-text("Use this text")', `${label}: hands it over`);
  await qa.note(`${label}: the progress feed runs — reading, mining, tailoring`);
  await page.waitForURL('**/preview/**', { timeout: 120000 });
  await page.waitForSelector('iframe[title="Tailored CV draft"]', { timeout: 60000 });
  await qa.scrollThrough(`${label}: reads down the tailored draft`);
}

// --------------------------------------------------------------------------------------------
// 1. The CV goes in, and the draft comes out carrying the CV's own contact line.
// --------------------------------------------------------------------------------------------
await pasteCvAndWaitForDraft('First draft');
await qa.expectText(draftFrame().locator('body'), CV_PHONE, 'the first draft prints the phone the CV itself carries');
await qa.expectText(draftFrame().locator('body'), CV_EMAIL, 'and the email, digits in the address and all, intact');

// --------------------------------------------------------------------------------------------
// 1b. The profile only opens once the person has told us something, so answer the opening
//     questions the way any visitor does on the way there.
// --------------------------------------------------------------------------------------------
await qa.goto(`${BASE}/discovery`, 'on to the questions');
await qa.fill(page.getByRole('textbox', { name: /What kind of job are you going for/ }), 'IT Project Manager', 'says what job she is going for');
await qa.click(page.getByRole('button', { name: "That's me" }), 'confirms it');
for (let i = 0; i < 3; i++) {
  const opt = page.locator('.discovery .opts button').first();
  if (await opt.count()) {
    await qa.click(opt, `answers question ${i + 1}`);
  } else if (await page.locator('#floor-free').count()) {
    await qa.fill('#floor-free', 'Owned a EUR 1.2M budget at Nordic Retail Group from 2021 to 2024', `answers question ${i + 1} in her own words`);
    await qa.click('.discovery .field .go', `question ${i + 1}: Continue`);
  } else break;
}

// --------------------------------------------------------------------------------------------
// 2. The profile shows both, under About you, each saying where it came from.
// --------------------------------------------------------------------------------------------
await qa.goto(`${BASE}/profile`, 'the person opens their profile');
await qa.scrollThrough('reads down the profile');

const about = page.locator('.dom').filter({ hasText: 'About you' });
await qa.expectVisible(about, 'the About you section is there');
await qa.expectText(about, 'Phone', 'a Phone row');
await qa.expectText(about, CV_PHONE, 'showing the number read from the CV');
await qa.expectText(about, 'Email on your CV', 'and the email row, labelled as the CV’s — never the login email');
await qa.expectText(about, CV_EMAIL, 'showing the address read from the CV');
await qa.expectText(about, 'Read from your CV.', 'each says it was read from the document, not invented');

// --------------------------------------------------------------------------------------------
// 3. The door: one plain question, pre-filled with what we hold.
// --------------------------------------------------------------------------------------------
await qa.click(about.getByRole('button', { name: 'Not your number?' }), 'taps the door beside the phone');
const input = page.getByLabel("What's the best phone number for your CV?");
await qa.expectVisible(input, 'the question opens in place, as a question and not a form');
await qa.expectText(page.locator('.rq'), 'Your answer stays until you replace it.', 'and says the answer sticks');
if ((await input.inputValue()) !== CV_PHONE) {
  await qa.note(`FAIL: door was not pre-filled — expected "${CV_PHONE}", got "${await input.inputValue()}"`);
  await qa.expectText(input, '__prefilled__', 'the door opens pre-filled with the current number');
} else {
  await qa.expectVisible(input, `the door is pre-filled with "${CV_PHONE}"`);
}

await qa.fill(input, CORRECTED_PHONE, 'types the right number');
await qa.click(about.getByRole('button', { name: 'Save' }), 'saves it');
await qa.expectText(about, CORRECTED_PHONE, 'the profile now shows the corrected number');
await qa.expectText(about, 'You told me this.', 'and credits the person for it, not the document');
await qa.expectText(about, CV_EMAIL, 'the email is untouched by a phone correction');

// --------------------------------------------------------------------------------------------
// 4. The fix reaches the CV. The CV document still says the OLD number — the correction has to
//    beat a fresh read of the document to prove it stuck (ADR-0008 §3).
// --------------------------------------------------------------------------------------------
await pasteCvAndWaitForDraft('Second draft');
await qa.expectText(draftFrame().locator('body'), CORRECTED_PHONE, 'the new draft prints the CORRECTED number');
await qa.expectText(draftFrame().locator('body'), CV_EMAIL, 'the email survives the phone swap, digits and all');

const printed = (await draftFrame().locator('body').textContent()) || '';
if (printed.includes(CV_PHONE)) {
  await qa.note(`FAIL: the CV’s old number "${CV_PHONE}" is still printed on the draft`);
  await qa.expectText(draftFrame().locator('body'), '__old_number_gone__', 'the old number is gone from the draft');
} else {
  await qa.note(`the CV’s own number "${CV_PHONE}" appears nowhere on the draft — exactly one phone prints`);
}

// --------------------------------------------------------------------------------------------
// 5. The correction survived a second full mining of the same document.
// --------------------------------------------------------------------------------------------
await qa.goto(`${BASE}/profile`, 'back to the profile after the re-read');
const about2 = page.locator('.dom').filter({ hasText: 'About you' });
await qa.expectText(about2, CORRECTED_PHONE, 'the correction outlived a second read of the same CV');
await qa.expectText(about2, 'You told me this.', 'and is still credited to the person');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
