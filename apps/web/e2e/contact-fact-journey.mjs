// #190 "contact info is a fact" — the whole journey, driven as a human against a REAL full stack.
//
// Paste a CV whose header carries a phone and an email -> open the profile -> see both in the
// Contact section with where each came from -> open the phone door (pre-filled) -> correct it ->
// paste the CV again -> the correction OUTLIVES the fresh read of the document (ADR-0008 §3).
//
// Nothing here is route-mocked: real Fastify, real contact store, real extract, real pipeline.
// Only the MODEL is faked, using the same seam apps/api/test uses.
//
// WHAT THIS NO LONGER PROVES, said plainly rather than quietly dropped (#272): it used to end by
// reading the pipeline's tailored draft and asserting the corrected number printed on it. That
// draft is deleted — the upload pipeline no longer builds one, and no pre-signup surface renders
// a tailored CV. The render preference itself (the stored phone beating the tailor's own header
// re-read) is pinned by apps/api/test/preview.test.ts directly against the kept engine, which is
// what the post-deck tailored CV will run through.
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

// A hard assertion the driver records with a screenshot either way.
const assertTrue = (cond, note) => qa.expectText('body', cond ? '' : '-THIS-CANNOT-APPEAR-', note);

/** #271: a repeat read on the same session has no screen — the product offers none — so it goes
 *  through the same POST /cv/paste route the front door's own tile calls. */
const pasteAgain = (text) =>
  page.evaluate(async (t) => {
    const res = await fetch('/api/cv/paste', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: t }),
    });
    if (res.status !== 201) throw new Error(`paste refused: ${res.status}`);
    return (await res.json()).jobId;
  }, text);

// --------------------------------------------------------------------------------------------
// 1. The CV goes in — through the front door, as a person brings it — and the read captures the
//    header's phone and email as facts against the session.
// --------------------------------------------------------------------------------------------
const firstJobId = await qa.frontDoorPaste(CV_TEXT, 'First read: the person pastes the CV, header and all, on the front door');
await qa.waitForJobDone(firstJobId);
await qa.note('the CV is read — the header contact is captured with the facts (no draft is built, #272)');

// --------------------------------------------------------------------------------------------
// 1b. The profile only opens once the person has told us something. #339: the opening questions
//     add no fact any more (discovery asks eligibility only), so she confirms her CV review — the
//     lines it read become hers — after saying what job she is going for.
// --------------------------------------------------------------------------------------------
await qa.goto(`${BASE}/discovery`, 'on to the questions');
await qa.fill(page.getByRole('textbox', { name: /What kind of job are you going for/ }), 'IT Project Manager', 'says what job she is going for');
await qa.click(page.getByRole('button', { name: "That's me" }), 'confirms it');
await page.waitForTimeout(1500);
await qa.completeReview(); // #338: "Your CV, reviewed" confirmed — the read's lines are her facts now

// --------------------------------------------------------------------------------------------
// 2. The profile shows both, in the rail's Contact section (#194 re-homed this off "About you"),
//    each saying where it came from.
// --------------------------------------------------------------------------------------------
await qa.goto(`${BASE}/profile`, 'the person opens their profile');
await qa.scrollThrough('reads down the profile');

const contact = page.locator('.rcontact');
await qa.expectVisible(contact, 'the rail\'s Contact section is there, beside Location and Job family');
await qa.expectText(contact, 'Phone', 'a Phone row');
await qa.expectText(contact, CV_PHONE, 'showing the number read from the CV');
await qa.expectText(contact, 'Email on your CV', 'and the email row, labelled as the CV’s — never the login email');
await qa.expectText(contact, CV_EMAIL, 'showing the address read from the CV');
await qa.expectText(contact, 'Read from your CV.', 'each says it was read from the document, not invented');

// --------------------------------------------------------------------------------------------
// 3. The door: one plain question, pre-filled with what we hold.
// --------------------------------------------------------------------------------------------
await qa.click(contact.getByRole('button', { name: 'Not your number?' }), 'taps the door beside the phone');
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
await qa.click(contact.getByRole('button', { name: 'Save' }), 'saves it');
await qa.expectText(contact, CORRECTED_PHONE, 'the profile now shows the corrected number');
await qa.expectText(contact, 'You told me this.', 'and credits the person for it, not the document');
await qa.expectText(contact, CV_EMAIL, 'the email is untouched by a phone correction');

// --------------------------------------------------------------------------------------------
// 4. The correction has to beat a fresh read of the document to prove it stuck (ADR-0008 §3):
//    the CV document still says the OLD number, so hand the same CV over again and check the
//    profile after the re-read.
// --------------------------------------------------------------------------------------------
await qa.note('Second read: she hands the same CV over again (#271: same route the front door tile calls)');
const secondJobId = await pasteAgain(CV_TEXT);
await qa.waitForJobDone(secondJobId);

await qa.goto(`${BASE}/profile`, 'back to the profile after the re-read');
const contact2 = page.locator('.rcontact');
await qa.expectText(contact2, CORRECTED_PHONE, 'the correction outlived a second full read of the same CV');
await qa.expectText(contact2, 'You told me this.', 'and is still credited to the person');
await qa.expectText(contact2, CV_EMAIL, 'the email is untouched by the re-read too');
const railText = (await page.locator('.rcontact').innerText().catch(() => '')) || '';
await assertTrue(!railText.includes(CV_PHONE), 'the CV’s own old number appears nowhere — exactly one phone is held');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
