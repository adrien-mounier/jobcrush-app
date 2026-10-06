// #274 — one text field style across the product. A human-paced browser walk over every screen
// that has a text field, measuring the SHIPPED computed style of each one rather than reading the
// stylesheet: 10px corners, 16px text, the Night Raised fill on the dark screens, a 2px focus
// outline (never a gold border), and — at a 390x844 phone viewport — no field under 16px and no
// viewport meta pinning the scale, which is the pair that makes mobile Safari zoom the page.
//
// The front door and discovery ride the REAL stack (fake-model API), so the same walk that measures
// the pixels also proves the fields still accept input and submit. The deck wall and the profile
// rail are route-mocked at the shapes wall.spec.ts / profile.spec.ts already pin.
//
//   pnpm --filter @jobcrush/contracts --filter @jobcrush/ui --filter @jobcrush/api build
//   OPS_KEY=qa-ops-key pnpm --filter @jobcrush/api start:qa            # fake model API on :34101
//   API_URL=http://127.0.0.1:34101 pnpm --filter @jobcrush/web build
//   pnpm --filter @jobcrush/web exec next start -p 3100
//   BASE_URL=http://127.0.0.1:3100 node apps/web/e2e/field-style-journey.mjs
//
// Ports are deliberately not 3000/3001 — another project on this machine defaults to those.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3100';

const RADIUS = '10px';
const SIZE = '16px';
const NIGHT_RAISED = 'rgb(31, 38, 47)'; // --hud-2 #1f262f
const GOLD = 'rgb(232, 163, 61)'; // --gold #e8a33d

const qa = await createSession('field-style-274', { baseURL: BASE, viewport: { width: 1280, height: 800 } });
const { page } = qa;
page.setDefaultTimeout(15000);

let failures = 0;

/** Record a pass (highlighted screenshot of the element) or a hard fail carrying the same note. */
async function check(ok, note, target = 'body') {
  if (ok) return qa.expectVisible(target, note);
  failures += 1;
  return qa.expectText(target, '-impossible', `FAIL — ${note}`);
}

/** The shipped computed style of a field, resting and while focused. */
async function measure(sel) {
  return page.$eval(sel, (el) => {
    const at = () => {
      const s = getComputedStyle(el);
      return {
        radius: s.borderTopLeftRadius,
        fontSize: s.fontSize,
        bg: s.backgroundColor,
        borderColor: s.borderTopColor,
        outlineWidth: s.outlineWidth,
        outlineStyle: s.outlineStyle,
      };
    };
    const rest = at();
    el.focus();
    const focused = at();
    el.blur();
    return { rest, focused };
  });
}

/** One field, fully audited against the ticket's single style. `fill` = expected background. */
async function auditField(sel, where, { fill = NIGHT_RAISED } = {}) {
  if ((await page.locator(sel).count()) === 0) {
    await qa.note(`${where} (${sel}) is not on this screen for this session — skipped`);
    return null;
  }
  const m = await measure(sel);
  await qa.note(`${where} (${sel}) — resting ${JSON.stringify(m.rest)} · focused ${JSON.stringify(m.focused)}`);
  await check(m.rest.radius === RADIUS, `${where}: corners are ${RADIUS} (measured ${m.rest.radius})`, sel);
  await check(m.rest.fontSize === SIZE, `${where}: text is ${SIZE} (measured ${m.rest.fontSize})`, sel);
  await check(m.rest.bg === fill, `${where}: fill is ${fill} (measured ${m.rest.bg})`, sel);
  await check(
    m.focused.outlineWidth === '2px' && m.focused.outlineStyle !== 'none',
    `${where}: focus is a 2px outline (measured ${m.focused.outlineWidth} ${m.focused.outlineStyle})`,
    sel,
  );
  await check(
    m.focused.borderColor !== GOLD && m.focused.borderColor === m.rest.borderColor,
    `${where}: focus does NOT recolour the border (resting ${m.rest.borderColor} → focused ${m.focused.borderColor})`,
    sel,
  );
  return m;
}

// ================================================================================================
// 1. The front door — the real stack. Paste box, then the target-role and search-area fields.
// ================================================================================================

const CV = `Mei Chen
IT Project Manager

EXPERIENCE
Acme Corp — IT Project Manager, 2019-2024, Paris
Ran the SAP S/4HANA cutover across three manufacturing sites.
Managed a seven-figure vendor budget across finance, procurement and delivery.
Led a team of six engineers and reported monthly to the steering committee.

Beta Ltd — Project Coordinator, 2016-2019, Paris
Coordinated agile delivery for a retail replatform.

EDUCATION
MSc Information Systems, Sorbonne, 2016

SKILLS
SAP, Jira, budgeting, stakeholder management, French, English`;

// The paste box first, measured on the screen where a person meets it.
await qa.goto('/', 'the front door, first arrival');
const readyBtn = page.getByRole('button', { name: 'Ready?' });
if (await readyBtn.isVisible().catch(() => false)) {
  await page.mouse.click(10, 10); // finish the invitation animation
  await qa.click(readyBtn, 'Ready? — through the invitation');
}
await qa.click(page.getByRole('button', { name: /Paste my CV text/ }), 'chooses "Paste my CV text"');
await page.locator('.frontdoor .paste-field textarea').waitFor({ state: 'visible' });
await auditField('.frontdoor .paste-field textarea', 'Front door · paste box');

await qa.frontDoorPaste(CV, 'the front door — a visitor brings her CV in as a person does');
await qa.completeReview(); // #338: a brought CV is reviewed before any job is shown (ADR-0016 clause 6)
await qa.note('the paste box accepted her text and the read completed — the field still submits');

await qa.frontDoorContinueToIntent();
await qa.scrollThrough('the target-role and search-area step');
await auditField('#target-role', 'Front door · target role');
await auditField('#search-area', 'Front door · search area');

// Behaviour, unchanged: type a role and an area, and the step accepts and advances.
await qa.fill('#target-role', 'IT project manager', 'she types the job she is going for');
await qa.fill('#search-area', 'Hong Kong', 'where she wants to work');
const typedRole = await page.locator('#target-role').inputValue();
await check(typedRole === 'IT project manager', `the role field holds what she typed ("${typedRole}")`, '#target-role');
await qa.click('button:has-text("Save and continue")', 'Save and continue — the fields submit');
await page.waitForTimeout(1500);
const savedIntent = await page.evaluate(async () => {
  const r = await fetch('/api/sessions/me/intent', { credentials: 'same-origin' });
  return r.ok ? r.json() : null;
});
await check(
  savedIntent?.intent?.targetRole === 'IT project manager',
  `what she typed reached the server (${JSON.stringify(savedIntent?.intent?.targetRole)}) — the field still submits`,
);

// ================================================================================================
// 2. Discovery — the main journey's fields, on the real stack.
// ================================================================================================

await qa.goto('/discovery', 'discovery — the questions that build her record');
await page.locator('#q1-role').waitFor({ state: 'visible', timeout: 60000 });
await auditField('#q1-role', 'Discovery · answer box (Q1)');
await qa.fill('#q1-role', 'IT project manager', 'she types the role she is going for');
await qa.click('button.go.wide', 'she answers the role question');
await page.waitForTimeout(3000);
await qa.scrollThrough('reads the discovery screen the way a real visitor would');

// Walk to the first free-text floor item so the audited box is the real long-answer one.
for (let i = 0; i < 6; i += 1) {
  if (await page.locator('#floor-free').count()) break;
  if (!(await qa.answerVisibleQuestion())) break;
  await page.waitForTimeout(1500);
}
if (await page.locator('#floor-free').count()) {
  await auditField('#floor-free', 'Discovery · long free-text answer box');
  await qa.fill('#floor-free', 'Yes, across three vendor teams', 'she types her own answer');
  await qa.click('.ask button.go', 'Continue — she sends her typed answer');
  await page.waitForTimeout(2000);
  await qa.note('the discovery answer box submitted — the field still does what it did');
} else {
  await qa.note('no free-text floor item surfaced in this session — Q1 above is the same .discovery .field input rule');
}

// ================================================================================================
// 3. The deck sign-in wall — route-mocked at wall.spec.ts's own shape.
// ================================================================================================

const CARD = {
  schemaVersion: '1',
  adId: 'ad-1',
  title: 'IT Project Manager',
  company: 'Acme',
  place: 'Paris',
  salary: null,
  pattern: null,
  scored: 'judged',
  matchPct: 82,
  breakdown: { essential: { met: 2, total: 3 }, desirable: { met: 1, total: 2 } },
  bubble: { hit: 'You match on delivery.', open: '' },
  fit: [],
  dontYet: [],
  askedClosed: [],
  adExcerpt: 'excerpt',
};
await page.route('**/api/onboarding/cards', (r) =>
  r.fulfill({ json: { stage: 'deck', cards: [CARD], authed: false, pendingCount: 0 } }),
);

await qa.goto('/deck', 'the deck as an anonymous visitor');
await qa.click(page.getByRole('button', { name: 'See them' }), 'she asks to see the jobs — the wall answers');
await page.locator('.jobdeck .wall input[type="email"]').waitFor({ state: 'visible' });
await auditField('.jobdeck .wall input[type="email"]', 'Deck · sign-in email');

await qa.fill('.jobdeck .wall input[type="email"]', 'mei@example.com', 'she types her email into the wall');
const wallValue = await page.locator('.jobdeck .wall input[type="email"]').inputValue();
await check(wallValue === 'mei@example.com', `the wall's email field holds what she typed ("${wallValue}")`, '.jobdeck .wall input[type="email"]');
const sendEnabled = await page.locator('.jobdeck .wall .sendlink').isEnabled();
await check(sendEnabled, 'a valid address enables the send-link button — validation is unchanged', '.jobdeck .wall .sendlink');
await qa.fill('.jobdeck .wall input[type="email"]', 'not-an-email', 'she replaces it with something that is not an address');
const sendDisabled = !(await page.locator('.jobdeck .wall .sendlink').isEnabled());
await check(sendDisabled, 'an invalid address keeps the send-link button refused', '.jobdeck .wall .sendlink');

// ================================================================================================
// 4. The profile rail — route-mocked at profile.spec.ts's pinned ProfileState shape.
// ================================================================================================

const PROFILE = {
  factCount: 4,
  search: { role: 'IT project manager in Paris', family: null, siblingTitles: [], openJobs: null },
  domains: [
    {
      tag: 'experience',
      heading: 'Professional Experience',
      facts: [
        { id: 'e1', text: 'Managed a team of six engineers.', colour: 'gold', source: 'told', job: null },
        { id: 'e2', text: 'Owned a seven-figure vendor budget.', colour: 'grey', source: 'read', job: null },
      ],
    },
    { tag: 'skill', heading: 'Skills', facts: [{ id: 's1', text: 'SQL.', colour: 'gold', source: 'told', job: null }] },
  ],
  contact: { phone: null, email: null },
  location: { areas: [], workRights: [] },
  languagesQuestion: {
    questionId: 'eligibility-languages',
    question: "Which languages do you speak? Start typing — I'll suggest as you go.",
    consequence: null,
    options: ['English', 'Mandarin', 'Ask me later'],
    answer: null,
  },
};
await page.route('**/api/profile', (r) => r.fulfill({ json: PROFILE }));

await qa.goto('/profile', 'her profile — the right rail');
await qa.scrollThrough('reads the rail before correcting anything');
await qa.click('.rjob .rdoor', 'she opens the role door: "Not the job you meant?"');
await page.locator('#role-again').waitFor({ state: 'visible' });
await auditField('#role-again', 'Profile rail · correction field');

await qa.fill('#role-again', 'Programme manager', 'she corrects the job she is going for');
const railValue = await page.locator('#role-again').inputValue();
await check(railValue === 'Programme manager', `the rail field holds what she typed ("${railValue}")`, '#role-again');

// ================================================================================================
// 5. The phone. The zoom defect is a PAIR — a sub-16px field AND a page that allows zoom.
//    Measured at 390x844, the iPhone viewport the ticket names.
// ================================================================================================

await page.setViewportSize({ width: 390, height: 844 });
await qa.note('switched to a 390x844 phone viewport — the size mobile Safari zooms at');

const meta = await page.$eval('meta[name="viewport"]', (el) => el.getAttribute('content')).catch(() => null);
await qa.note(`the page's viewport meta is: ${meta ?? '(none)'}`);
await check(
  !!meta && !/maximum-scale|user-scalable/i.test(meta),
  `the viewport is NOT pinned — pinch-zoom is left alone (meta: "${meta}")`,
);

/** Every text field this screen currently shows, with its computed size. */
const sweep = async (where) => {
  const fields = await page.$$eval('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea', (els) =>
    els
      .filter((el) => el.offsetParent !== null || el.getClientRects().length > 0)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || el.className || el.getAttribute('aria-label') || '(unnamed)',
        fontSize: getComputedStyle(el).fontSize,
        radius: getComputedStyle(el).borderTopLeftRadius,
      })),
  );
  await qa.note(`${where} — visible fields: ${JSON.stringify(fields)}`);
  const small = fields.filter((f) => parseFloat(f.fontSize) < 16);
  await check(
    fields.length > 0 && small.length === 0,
    `${where}: every visible field is at least 16px, so a tap does not zoom the page (${fields.length} field(s), ${small.length} under 16px)`,
  );
  return fields;
};

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await qa.scrollThrough('the profile rail on a phone');
await qa.click('.rjob .rdoor', 'opens the role door on the phone');
await page.locator('#role-again').waitFor({ state: 'visible' });
await sweep('Profile on a phone');

await qa.goto('/deck', 'the deck on a phone');
await qa.click(page.getByRole('button', { name: 'See them' }), 'asks to see the jobs — the wall answers');
await page.locator('.jobdeck .wall input[type="email"]').waitFor({ state: 'visible' });
await sweep('The sign-in wall on a phone');

await qa.goto('/discovery', 'discovery on a phone — the journey the ticket calls the main one');
await page.waitForTimeout(2000);
await qa.scrollThrough('reads the question on a phone');
await sweep('Discovery on a phone');

await qa.goto('/signup', 'the sign-up wall on a phone — the light-register field');
await page.locator('input[type="email"]').waitFor({ state: 'visible' });
await sweep('Sign-up on a phone');
const signupStyle = await measure('input[type="email"]');
await qa.note(`Sign-up (light register) — resting ${JSON.stringify(signupStyle.rest)}`);
await check(signupStyle.rest.radius === RADIUS, `Sign-up: corners are ${RADIUS} (measured ${signupStyle.rest.radius})`, 'input[type="email"]');
await check(signupStyle.rest.fontSize === SIZE, `Sign-up: text is ${SIZE} (measured ${signupStyle.rest.fontSize})`, 'input[type="email"]');

const ok = await qa.finish();
process.exit(ok && failures === 0 ? 0 : 1);
