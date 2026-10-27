// Spec #403 (owner's staging run, 2026-10-22) — the screens he reads before the draft, driven as a
// human against the fake-model stack. Left by the spec's QA gate as a re-runnable flow.
//
// What it proves, in the order he meets it:
//   #404  a letterhead split by " - " gives a clean location on Your details ("Bangkok, Thailand",
//         no trailing dashes), and no title from that line
//   #402  a phone labelled in another language ("Natel:") is never read as the title
//   #406  a pasted advert with blank lines and bullet lines keeps those breaks under "Read the ad in
//         full", on the job's own screen and on the deck card
//   #407  every "Where you fit" row is a requirement of this job with the scorer's reason under it —
//         never a CV line; the bubble quotes no CV line
//
// Not provable here: the real model's About you (#405) and the real judge's wording (#407) — the
// fake answers canned text. Those are read on staging.
//
//   pnpm --filter @jobcrush/api build
//   PORT=34191 node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34191 npx next build && npx next start -p 34190
//   BASE_URL=http://127.0.0.1:34190 node apps/web/e2e/spec-403-staging-fixes-journey.mjs
import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:34190';
const RUN = Date.now().toString(36);
const EMAIL = `spec403.${RUN}@example.com`;

const CV_TEXT = [
  'Jane Doe',
  // #404 + #402 in one line: spaced-hyphen separators and a Swiss phone label.
  `Bangkok, Thailand - Natel: +41 79 123 45 67 - Email: ${EMAIL}`,
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
].join('\n');

// Line 1 "<title> — <company>", line 2 location (qa-main.ts's paste reader); "- " lines are the
// requirements. Blank lines and bullets are what #406 is about. Stamped so a warm API gets a new job.
const ADVERT = `Senior IT Project Manager — Helvara Group
Brussels, Belgium

About the role (ref ${RUN})
Helvara Group is looking for a Senior IT Project Manager to lead our core banking migration.

What we are looking for
- Coordinate business and technical stakeholders at executive level
- Hold the plan and report progress to the steering committee every month
- Run a portfolio of regulated change across four workstreams

How to apply
Send your CV through our careers page.`;
const ADVERT_LINES = ADVERT.split('\n').filter((l) => l.trim()).length;
const REQUIREMENTS = ADVERT.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2));

const qa = await createSession('spec-403-staging-fixes-journey', { baseURL: BASE, viewport: { width: 1280, height: 900 } });
const { page } = qa;
page.setDefaultTimeout(15000);

const defects = [];
const must = async (ok, note) => {
  if (ok) return qa.expectVisible('body', `PASS — ${note}`);
  defects.push(note);
  return qa.expectVisible('#defect-no-such-element', `FAIL — ${note}`);
};
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

/** Every line text the read gave her — the CV lines no card row or bubble may quote. */
const cvLines = () =>
  page.evaluate(async () => {
    const { sections } = await (await fetch('/api/review', { credentials: 'same-origin' })).json();
    return sections.flatMap((s) => ('jobs' in s ? s.jobs.flatMap((j) => j.lines) : s.lines ?? [])).map((l) => l.text).filter(Boolean);
  });

/** The card on screen, read off the rendered DOM. */
const readCard = (root) =>
  page.evaluate((sel) => {
    const card = document.querySelector(sel);
    if (!card) return null;
    const ad = card.querySelector('details.ad p');
    const lh = ad ? parseFloat(getComputedStyle(ad).lineHeight) : 0;
    return {
      whiteSpace: ad ? getComputedStyle(ad).whiteSpace : null,
      adLines: ad && lh ? Math.round(ad.getBoundingClientRect().height / lh) : 0,
      bubble: card.querySelector('.bubble')?.textContent.trim() ?? null,
      fit: [...card.querySelectorAll('.row.fit')].map((r) => ({
        text: r.textContent.replace(r.querySelector('.fit-why')?.textContent ?? '', '').replace('✓', '').trim(),
        why: r.querySelector('.fit-why')?.textContent.trim() ?? null,
      })),
    };
  }, root);

async function checkCard(root, where, lines) {
  const details = page.locator(`${root} details.ad`);
  await details.scrollIntoViewIfNeeded();
  await qa.click(page.locator(`${root} details.ad summary`), `${where}: open "Read the ad in full"`);
  await qa.expectVisible(page.locator(`${root} details.ad p`), `${where}: the advert in full`);
  const c = await readCard(root);
  await qa.note(`${where}: ${JSON.stringify(c)}`);
  await must(c?.whiteSpace === 'pre-line', `#406 ${where}: the advert paragraph keeps line breaks (white-space ${c?.whiteSpace})`);
  await must((c?.adLines ?? 0) >= ADVERT_LINES, `#406 ${where}: ${ADVERT_LINES} source lines render as ${c?.adLines} lines, not one run-on block`);
  const adText = await page.locator(`${root} details.ad p`).innerText();
  await must(adText.includes('\n- Coordinate business') && /\n\s*\n/.test(adText), `#406 ${where}: the bullet lines and the blank lines are there in the rendered text`);
  await qa.expectVisible(page.locator(`${root} .row.fit`).first(), `${where}: the "Where you fit" rows`);
  await must(c.fit.length > 0 && c.fit.every((r) => REQUIREMENTS.includes(r.text)), `#407 ${where}: every Where you fit row is one of this job's requirements (${JSON.stringify(c.fit.map((r) => r.text))})`);
  await must(c.fit.every((r) => r.why && r.why.length > 0), `#407 ${where}: every row carries the scorer's reason (${JSON.stringify(c.fit.map((r) => r.why))})`);
  await must(c.fit.every((r) => !lines.some((l) => r.text.includes(l) || (r.why ?? '').includes(l))), `#407 ${where}: no row quotes a CV line`);
  await qa.expectVisible(page.locator(`${root} .bubble`), `${where}: the bubble`);
  await must(!!c.bubble && !lines.some((l) => c.bubble.includes(l)), `#407 ${where}: the bubble quotes no CV line ("${c?.bubble}")`);
  await qa.scrollThrough(`${where}: read the card the way he would`);
  return c;
}

// 1. The CV goes in through the front door; on to the job question.
const jobId = await qa.frontDoorPaste(CV_TEXT, 'the front door — she pastes a CV whose letterhead uses " - " and "Natel:"');
await qa.waitForJobDone(jobId);
await qa.frontDoorContinueToIntent();
await qa.fill('#target-role', 'IT project manager', 'question 1 — the job she is going for');
await qa.fill('#search-area', 'Brussels', 'where she wants to work');
await qa.click('button:has-text("Save and continue")', 'Save and continue');
await page.waitForURL(/\/profile\/check/, { timeout: 60_000 }).catch(() => {});
if (!/\/profile\/check/.test(page.url())) await qa.goto('/profile/check', 'check mode');

// 2. Your details.
await qa.expectText(page.locator('h1'), 'Your details', 'check mode opens on Your details');
const values = {};
for (const f of ['name', 'email', 'phone', 'location']) values[f] = await page.locator(`input[name=${f}]`).inputValue();
await qa.note(`Your details as read: ${JSON.stringify(values)}`);
await qa.expectVisible('input[name=location]', `the location field reads "${values.location}"`);
await must(values.location === 'Bangkok, Thailand', `#404 the location is "Bangkok, Thailand", no dashes left on it (${JSON.stringify(values.location)})`);
await must((await page.locator('input[name=title]').count()) === 0, '#453 Your details has no Title field');
await must(values.name === 'Jane Doe' && values.email === EMAIL, `name and email as read (${values.name}, ${values.email})`);
await qa.expectVisible('input[name=phone]', `the phone field reads "${values.phone}"`);
await must(values.phone === '+41 79 123 45 67', `#404 the phone ends on its last digit, no trailing dash (${JSON.stringify(values.phone)})`);
await qa.scrollThrough('Your details');

// 3. Sign in and finish check mode over the wire (check-mode journeys walk it on screen).
const signed = await page.evaluate(async ({ email }) => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const res = await post('/api/auth/request-link', { email });
  const link = await res.json();
  if (!link.devLink) return `sign-in failed (${res.status})`;
  const v = await post('/api/auth/verify', { token: new URL('http://x' + link.devLink).searchParams.get('token') });
  return v.ok ? 'ok' : `verify ${v.status}`;
}, { email: EMAIL });
await must(signed === 'ok', `she signs in (${signed})`);
await page.reload();
await qa.completeReview();
const lines = await cvLines();
await qa.note(`${lines.length} CV lines read for her — none of them may appear on a card row or bubble`);

// 4. She pastes a job and lands on its own screen.
await qa.goto('/paste', 'she brings in a job she found herself');
await qa.fill(page.locator('#advert'), ADVERT, 'pastes the advert, blank lines and bullets included');
await qa.click(page.getByRole('button', { name: 'Read it' }), "press 'Read it'");
await page.waitForURL(/\/job\//, { timeout: 120_000 });
await page.locator('.onejob .jobcard .row.fit').first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
const jobPath = new URL(page.url()).pathname;
await qa.note(`landed on ${jobPath}`);
const own = await checkCard('.onejob .jobcard', "the job's own screen", lines);

// 4b. The same card lives on the tailor screen: the reason must read as a sentence there too, not
//     pick up the tailor's own uppercase ".why" eyebrow style (found by this gate).
await qa.click(page.getByRole('button', { name: 'Write the tailored CV' }), 'press "Write the tailored CV"');
const tailorWhy = page.locator('.tailor .row.fit .fit-why').first();
await tailorWhy.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
await qa.expectVisible(tailorWhy, 'the tailor screen: the reason under the Where you fit row');
const tailorStyle = await tailorWhy.evaluate((el) => ({ t: getComputedStyle(el).textTransform, f: getComputedStyle(el).fontFamily })).catch(() => null);
await must(tailorStyle?.t === 'none', `#407 the tailor screen: the reason reads as a sentence, not an uppercase label (${JSON.stringify(tailorStyle)})`);

// 5. The same job on the deck card.
await qa.goto('/deck', 'on to the deck');
const reveal = page.locator('button.go', { hasText: 'See them' });
await reveal.waitFor({ state: 'visible', timeout: 120_000 }).then(
  () => qa.click('button.go:has-text("See them")', "press 'See them'"),
  () => qa.note('no reveal button; looking for the deck anyway'),
);
await page.locator('.jobcard').first().waitFor({ state: 'visible', timeout: 120_000 });
// Her pasted job is pinned at the top of the deck (#305).
const deckTitle = (await page.locator('.jobcard h2').first().innerText().catch(() => '')).trim();
await qa.note(`the deck's first card is "${deckTitle}"`);
await must(/Senior IT Project Manager/.test(deckTitle), `the pasted job is the card on top of the deck ("${deckTitle}")`);
const deck = await checkCard('.jobcard', 'the deck card', lines);
await must(JSON.stringify(deck.fit) === JSON.stringify(own.fit) && deck.bubble === own.bubble, '#407 the deck card and the job screen say the same thing (one shared card)');

await qa.note(defects.length ? `DEFECTS: ${defects.join(' | ')}` : 'no defects');
const ok = await qa.finish();
process.exit(ok ? 0 : 1);
