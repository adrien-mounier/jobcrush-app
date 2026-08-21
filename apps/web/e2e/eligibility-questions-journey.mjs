// #106 — the eligibility questions inside discovery: the whole journey a real person walks.
//
// Front door -> the role question -> the discovery floor -> the eligibility block (answering, an
// explicit "no", declining, and correcting an answer through the fix affordance) -> the deck ->
// a reload that must not re-ask. Plus AC8's responsive/a11y non-regression, including the design
// spec's 360px floor (§8) which the .spec.ts sweep does not cover (its smallest viewport is 390px).
//
// Nothing is stubbed — this rides the live Fastify API and a real Next build.
//
//   PORT=30181 node apps/api/dist/main.js
//   cd apps/web && API_URL=http://127.0.0.1:30181 npx next build && npx next start -p 30180
//   BASE_URL=http://127.0.0.1:30180 node apps/web/e2e/eligibility-questions-journey.mjs
//
// Run serially: every run mints an anonymous session, and the API caps those at 12 per IP per hour.
// Ports are deliberately not 3000/3001 — another project on this machine defaults to those and the
// /api proxy would silently reach the wrong backend. API_URL is baked at `next build` time.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:30180';
const ROLE = 'IT project manager in Singapore';

const qa = await createSession('eligibility-questions-journey', {
  baseURL: BASE,
  viewport: { width: 390, height: 844 },
});
const { page } = qa;

page.setDefaultTimeout(9000);

const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);
// Read a class off a button that may not be on screen, without throwing.
const hasClass = async (name, cls) => {
  const el = page.getByRole('button', { name, exact: true }).first();
  if (!(await el.count())) return null;
  return el.evaluate((n, c) => n.classList.contains(c), cls);
};
const dockText = async () => (await page.locator('.discovery .ask').count())
  ? (await page.locator('.discovery .ask').first().innerText()).replace(/\n+/g, ' | ')
  : '(no ask dock)';
const txt = async (sel) => (await page.locator(sel).count()) ? (await page.locator(sel).first().textContent()).trim() : null;
const askQ = () => txt('.discovery #ask-q, .discovery legend.q');
const askSub = () => txt('.discovery .sub');
const optLabels = () => page.locator('.discovery .opts .opt').allTextContents();
const eligDim = async () => {
  const dim = (await page.locator('.discovery .opts[data-elig]').count())
    ? await page.locator('.discovery .opts[data-elig]').first().getAttribute('data-elig')
    : null;
  return dim ?? ((await page.locator('.discovery fieldset.elig-group').count()) ? 'language' : null);
};
const countdown = () => txt('.discovery .countdown');
const badgeCount = () => page.evaluate(() => {
  const el = document.querySelector('a.prof');
  return el ? Number(el.querySelector('.n')?.textContent ?? '0') : null;
});

// Every question the visitor actually answers before jobs appear.
let asked = 0;
const askedLog = [];
const countAsk = (what) => { asked++; askedLog.push(`${asked}. ${what}`); };

// Every countdown reading, in order — the number must only ever fall.
const meter = [];
async function readMeter(what) {
  const c = await countdown();
  const n = c ? Number((c.match(/^(\d+)/) ?? [])[1]) : null;
  if (n !== null) meter.push({ n, what });
  return n;
}

// ---------------------------------------------------------------------------------------------
// 1. The front door — the screen before any question.
// ---------------------------------------------------------------------------------------------
await qa.goto('/', 'the front door — where a real visitor actually starts');
await qa.scrollThrough('read the front door top to bottom');

// ---------------------------------------------------------------------------------------------
// 2. Q1 — the role question. Eligibility questions must be invisible here: no marker, no heading.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'into discovery');
const intent = await page.evaluate(async () => {
  const response = await fetch('/api/sessions/me/intent', {
    method: 'PUT', credentials: 'include',
    headers: { 'content-type': 'application/json' },
    // #214: searchAreas is a list of raw texts now (the old { searchArea } survives only as a
    // legacy one-entry alias) — this journey states one target location, Singapore.
    body: JSON.stringify({ targetRole: 'IT project manager', searchAreas: ['Singapore'] }),
  });
  return { ok: response.ok, status: response.status };
});
await assert(intent.ok, `the current intent checkpoint records Singapore before discovery (${JSON.stringify(intent)})`);
await qa.fill(page.getByRole('textbox', { name: /What kind of job are you going for/ }), ROLE, 'Q1: type the role');
await qa.click(page.getByRole('button', { name: "That's me" }), "Q1: submit the role (That's me)");
await page.waitForTimeout(1600);
await readMeter('after Q1');
await qa.expectVisible('.discovery .countdown', 'the countdown appears with the first question');
await qa.note(`countdown after Q1: ${await countdown()}`);
await assert(
  (await page.locator('.discovery').innerText()).match(/eligibility/i) === null,
  'UX intent: nothing on screen labels these as a different kind of question — the word "eligibility" never appears',
);

// ---------------------------------------------------------------------------------------------
// 3. The discovery floor — answer through it until the eligibility block starts.
// ---------------------------------------------------------------------------------------------
let floorAnswered = 0;
for (let i = 0; i < 14; i++) {
  if (await eligDim()) break; // the eligibility block has begun
  const opt = page.locator('.discovery .opts .opt').first();
  if (await opt.count()) {
    const label = (await opt.textContent()).trim();
    await qa.click(opt, `floor answer ${i + 1}: "${label}"`);
    countAsk(`floor: "${label}"`);
  } else if (await page.locator('#floor-free').count()) {
    // Some floor questions are free-text only — a real visitor types and continues.
    await qa.fill('#floor-free', 'Owned a $2M budget at Acme from 2021 to 2024', `floor answer ${i + 1}: typed`);
    await qa.click('.discovery .field .go', `floor answer ${i + 1}: Continue`);
    countAsk('floor: typed a free-text answer');
  } else break;
  await page.waitForTimeout(2100);
  floorAnswered++;
  await readMeter(`floor answer ${floorAnswered}`);
  if (!page.url().includes('/discovery')) break;
}
await qa.note(`answered ${floorAnswered} floor questions; countdown trail so far: ${meter.map((m) => m.n).join(' -> ')}`);
await qa.scrollThrough('read the CV the floor answers wrote, then back to the dock');

// ---------------------------------------------------------------------------------------------
// 4. The FIRST eligibility question. #162: it is work-rights now — the years question is GONE,
//    worked out from the dated job records instead of asked (ADR-0008 clause 2).
// ---------------------------------------------------------------------------------------------
const dim1 = await eligDim();
await assert(dim1 === 'work-rights', `the eligibility block opens on work-rights (got "${dim1}")`);
const firstQ = await askQ();
const firstSub = await askSub();
const firstOpts = await optLabels();
await qa.note(`work-rights question: ${JSON.stringify(firstQ)}\n  sub: ${JSON.stringify(firstSub)}\n  options: ${JSON.stringify(firstOpts)}`);
await qa.expectVisible('.discovery #ask-q', 'AC4 / UX intent: the question as a real visitor reads it');

await assert(
  /without visa sponsorship\?$/.test(firstQ ?? ''),
  `the question names the place and the condition in the question line itself — "${firstQ}"`,
);
await assert(
  !/how many years/i.test(firstQ ?? ''),
  `#162 / ADR-0008 clause 2: nothing asks for a years-of-experience total — "${firstQ}"`,
);
await assert(
  /changes which jobs I show you/i.test(firstSub ?? ''),
  `the clarifier says what the answer changes, not what it costs — "${firstSub}"`,
);
await assert(
  firstOpts[firstOpts.length - 1] === 'Ask me later',
  `UX intent: declining is last and always available — options end with "${firstOpts[firstOpts.length - 1]}"`,
);
await assert(
  (await page.locator('.discovery .opts .opt.quiet').count()) === 1,
  'design §4: exactly one option is styled as the quiet "not answering" one',
);
await assert(
  (await page.locator('.discovery .freetext').count()) === 0,
  'design §5.1: no free-text box on an eligibility question — it is tap-first by design',
);
// a11y: the group's accessible name is the question, so the scope travels with every option.
const groupLabelled = (await page.locator('.discovery .opts').count())
  ? await page.locator('.discovery .opts').first().getAttribute('aria-labelledby')
  : '(no options group on screen)';
await assert(groupLabelled === 'ask-q', `a11y: the options group is named by the question line (aria-labelledby="${groupLabelled}")`);

// ---------------------------------------------------------------------------------------------
// 5. ANSWERING — a real negative, weighted exactly like a yes, and the confirmation + fix
//    affordance it earns.
//
//    #205: this section used to answer "yes" and prove the "no" on a SECOND work-rights question
//    at §7. There is no second one — this visitor searches one market, so discovery asks
//    work-rights exactly once. The "no" is therefore proven on the question that exists.
//
//    Be honest about what that costs, because the old §7 did claim more than this one delivers:
//    §6 retracts this "no" twenty lines below, so the deck at §10 is reached with work-rights
//    DEFERRED, not answered no — no journey now carries a live "no" all the way to the deck, and
//    with the question asked once there is no way to do both in one session. What is proven here
//    is the answer moment itself: the confirmation, the styling, and the fix affordance a "no"
//    earns. §12 answers "yes" on a fresh 360px session and checks the 360px layout and focus ring;
//    it stops there and does not reach the deck either.
// ---------------------------------------------------------------------------------------------
const badgeBefore = await badgeCount();
const NO_LABEL = "Not yet — I'd need sponsorship";
await assert(/Singapore/.test(firstQ ?? ''), `the work-rights question names the visitor's own city — "${firstQ}"`);
// AC6/design §4: the "no" is a full-weight option, not the quiet one.
const noIsQuiet = await hasClass(NO_LABEL, 'quiet');
await assert(noIsQuiet === false, `AC6/design §4: saying no is styled with the same weight as saying yes — never dimmed (quiet=${noIsQuiet})`);
await qa.click(page.getByRole('button', { name: NO_LABEL, exact: true }).first(), 'AC6: answer NO — "Not yet — I\'d need sponsorship"');
countAsk('eligibility: work-rights = NO');
await page.waitForTimeout(2300);
await readMeter('answered work-rights (a real "no")');
const notice1 = await txt('.discovery .notice');
await qa.expectVisible('.discovery .notice', 'AC6: a "no" is confirmed like any other answer — no warning, no red, no apology');
await assert(
  /Locked in — I'll use that on every job, so I won't ask again\./.test(notice1 ?? ''),
  `AC2/AC3/AC6: an explicit "no" earns the same reused-and-never-re-asked confirmation as a yes — "${notice1}"`,
);
await assert(
  !/(unfortunately|sorry|disqualif|may not qualify|required|mandatory)/i.test(await page.locator('.discovery').innerText()),
  'UX intent: nothing on the screen treats a negative answer as a failure',
);
await assert(
  (await page.getByRole('button', { name: 'Fix that?' }).count()) > 0,
  'UX intent: an answered eligibility question carries a correction affordance',
);
const badgeAfterReal = await badgeCount();
await qa.note(`fact badge: ${badgeBefore} -> ${badgeAfterReal} after a real eligibility answer (a "no")`);

// ---------------------------------------------------------------------------------------------
// 6. THE RETRACTION — correct that real answer to "Ask me later". The stored fact must go.
// ---------------------------------------------------------------------------------------------
await qa.click(page.getByRole('button', { name: 'Fix that?' }).first(), 'open the correction on the work-rights answer');
await page.waitForTimeout(1500);
await qa.expectVisible('.discovery .opts', 'the correction re-ask, with the current answer pre-marked');
const premarked = await page.locator('.discovery .opts .opt.picked').allTextContents();
await qa.note(`the correction opens with the current answer pre-marked: ${JSON.stringify(premarked)}`);
await assert(
  premarked.some((t) => t.trim() === NO_LABEL),
  `the correction opens showing what they said before (pre-marked: ${JSON.stringify(premarked)})`,
);
await qa.click(page.getByRole('button', { name: 'Ask me later', exact: true }).first(), 'RETRACT: change the answer to "Ask me later"');
await page.waitForTimeout(2400);
const notice2 = await txt('.discovery .notice');
await qa.expectVisible('.discovery .notice', 'the confirmation after retracting an answer to "Ask me later"');
await assert(
  /No problem — I'll ask again when a job needs it\./.test(notice2 ?? ''),
  `the retraction reads as unknown-again, not as the old answer — "${notice2}"`,
);
await assert(
  (await page.getByRole('button', { name: 'Answer it now' }).count()) > 0,
  'a declined answer offers "Answer it now", not "Fix that?" — the state genuinely changed',
);
await readMeter('after retracting work-rights to a decline');

// ---------------------------------------------------------------------------------------------
// 6b. A REFUSAL IS NOT A FACT — the count must not move, on any screen that shows it.
// ---------------------------------------------------------------------------------------------
const badgeAfterRetract = await badgeCount();
await qa.note(`fact badge across the retraction (a decline): ${badgeAfterReal} -> ${badgeAfterRetract}`);
await qa.expectVisible('a.prof', `the fact badge right after declining — it reads ${badgeAfterRetract}`);
await assert(
  badgeAfterRetract === badgeAfterReal,
  `declining did not inflate the count on discovery (${badgeAfterReal} -> ${badgeAfterRetract})`,
);
// The same visitor, the same session, opening the profile the badge links to.
await qa.click('a.prof', 'tap the fact badge to open the profile');
await page.waitForTimeout(2000);
const profileHeading = (await txt('.profile .pcount')) ?? '(no profile heading)';
const profileListed = await page.locator('.profile .fact, .profile li').count();
await qa.expectVisible('.profile .pcount', `the profile heading a visitor reads after declining: "${profileHeading}"`);
await qa.note(`profile heading: "${profileHeading}" — discovery badge said ${badgeAfterRetract}; facts listed on the page: ${profileListed}`);
const profileN = Number((profileHeading.match(/^(\d+)/) ?? [])[1] ?? NaN);
await assert(
  profileN === badgeAfterRetract,
  `the profile and the discovery badge tell the same visitor the same number (profile ${profileN} vs badge ${badgeAfterRetract})`,
);
await qa.scrollThrough('read the whole profile after a decline');
// Back to discovery — whatever the profile computed must not have moved the badge.
await qa.goto('/discovery', 'back to discovery after visiting the profile');
await page.waitForTimeout(2000);
const badgeAfterProfile = await badgeCount();
await qa.note(`fact badge after the profile round trip: ${badgeAfterRetract} -> ${badgeAfterProfile}`);
await qa.expectVisible('a.prof', `the fact badge back on discovery — it now reads ${badgeAfterProfile}`);
await assert(
  badgeAfterProfile === badgeAfterRetract,
  `opening the profile did not permanently raise the visitor's fact count (${badgeAfterRetract} -> ${badgeAfterProfile})`,
);

// ---------------------------------------------------------------------------------------------
// 7. AFTER THE RETRACTION — "ask me later" means later, not now.
//
// #205: this section used to expect a SECOND work-rights question here, and had been failing (with
// the five behind it) ever since the question set changed. There is one work-rights question — the
// visitor searches one market — and retracting its answer to "Ask me later" closes it for
// discovery: the subtext promised "I'll ask again when a JOB needs it", so re-asking on the very
// next screen would break that promise. What a real visitor sees next is the languages question.
// That promise is the thing worth asserting, and it is what this now asserts.
// ---------------------------------------------------------------------------------------------
const dim2 = await eligDim();
await qa.note(`the ask dock right now: ${await dockText()}`);
await qa.note(`next eligibility question: ${dim2} — ${JSON.stringify(await askQ())}`);
await assert(
  dim2 === 'language',
  `after retracting work-rights the block moves ON to the next dimension, it does not re-ask (got "${dim2}")`,
);
const nextQ = await askQ();
await assert(
  !/sponsorship|Singapore/i.test(nextQ ?? ''),
  `"Ask me later" is honoured: the retracted work-rights question is not put straight back on screen — "${nextQ}"`,
);
await assert(
  (await page.getByRole('button', { name: NO_LABEL, exact: true }).count()) === 0,
  'the work-rights answers are gone from the dock — nothing re-asks a question the visitor deferred',
);

// ---------------------------------------------------------------------------------------------
// 8. DECLINING — the last question, refused outright.
// ---------------------------------------------------------------------------------------------
const dim3 = await eligDim();
await qa.note(`last eligibility question: ${dim3} — ${JSON.stringify(await askQ())}`);
await qa.note(`the ask dock right now: ${await dockText()}`);
const badgeBeforeDecline = await badgeCount();
const declineBtn = page.getByRole('button', { name: /^Ask me later/ }).first();
await assert(await declineBtn.evaluate((n) => n.classList.contains('quiet')), 'the decline is the quiet option — secondary, but always present');
await qa.click(declineBtn, 'decline the last eligibility question: "Ask me later"');
countAsk('eligibility: language = declined');
await page.waitForTimeout(2600);
await readMeter('declined the last question');
const badgeAfterDecline = await badgeCount();
// The last eligibility answer hands off to /deck, which deliberately carries no badge (spec §11) —
// so a null here is the deck, not a lost count. The decline/count check that matters is §6b above.
await qa.note(`fact badge across the final DECLINE: ${badgeBeforeDecline} -> ${badgeAfterDecline ?? 'no badge (the deck carries none)'}`);

// ---------------------------------------------------------------------------------------------
// 9. THE COUNTDOWN — across the entire walk it must never climb.
// ---------------------------------------------------------------------------------------------
await qa.note(`the full countdown trail a visitor saw: ${meter.map((m) => `${m.n} (${m.what})`).join('  ->  ')}`);
const climbs = meter.filter((m, i) => i > 0 && m.n > meter[i - 1].n);
await assert(
  climbs.length === 0,
  `"N answers until your next jobs" never went UP across the whole flow (${meter.map((m) => m.n).join(' -> ')})`,
);

// ---------------------------------------------------------------------------------------------
// 10. THE DECK — the questions are behind them.
// ---------------------------------------------------------------------------------------------
await page.waitForTimeout(1800);
await qa.note(`after the last eligibility answer the visitor is at: ${page.url()}`);
if (!page.url().includes('/deck')) await qa.goto('/deck', 'on to the deck');
await qa.scrollThrough('read the deck the eligibility answers now feed');
await qa.expectVisible('body', 'AC2/AC3: the deck — reached without any eligibility question being asked twice');

// The funnel: how many questions did this visitor actually answer before jobs appeared?
await qa.note(`QUESTIONS ANSWERED BEFORE THE DECK: ${asked}\n  ${askedLog.join('\n  ')}`);

// D1's widest surface: a declined question must not appear in any card's own content.
// Decline-specific markers only — an advert's OWN text may legitimately mention visas or
// sponsorship (e.g. the BNP Paribas posting does), and that is the employer talking, not a leak.
const LEAK = /Declined|Ask me later|work professionally in English|worked in IT Project Manager|worked in IT project delivery|without visa sponsorship/i;
const deckText = await page.locator('body').innerText();
const leakHits = deckText.match(new RegExp(LEAK.source, 'gi')) ?? [];
await qa.note(`scanned the whole deck screen for any trace of the declined/eligibility questions — hits: ${JSON.stringify(leakHits)}`);
await assert(
  leakHits.length === 0,
  `a declined eligibility question appears nowhere on the deck a visitor reads (${leakHits.length} traces found)`,
);
// And card by card, through the cards the API actually served this session.
const cardScan = await page.evaluate(async () => {
  const res = await fetch('/api/onboarding/cards');
  if (!res.ok) return { error: res.status };
  const data = await res.json();
  const re = /Declined|Ask me later|work professionally in English|worked in IT Project Manager|worked in IT project delivery|without visa sponsorship/i;
  // The advert's own text is the employer talking — scan what JobCrush says ABOUT the visitor.
  const mine = (c) => JSON.stringify({ fit: c.fit, askedClosed: c.askedClosed, dontYet: c.dontYet, bubble: c.bubble, breakdown: c.breakdown });
  return {
    count: data.cards?.length ?? 0,
    dirty: (data.cards ?? []).filter((c) => re.test(mine(c))).map((c) => c.adId),
    sampleFit: (data.cards?.[0]?.fit ?? []).map((f) => f.text),
    sampleAskedClosed: (data.cards?.[0]?.askedClosed ?? []).map((f) => f.text),
  };
});
await qa.note(`cards served: ${cardScan.count}; cards mentioning a declined eligibility question: ${JSON.stringify(cardScan.dirty)}`);
await qa.note(`sample card — what it says fits you: ${JSON.stringify(cardScan.sampleFit)}`);
await qa.note(`sample card — what it says is asked-and-closed: ${JSON.stringify(cardScan.sampleAskedClosed)}`);
await assert(
  (cardScan.dirty?.length ?? -1) === 0,
  `no card carries a declined eligibility question in its own content (${cardScan.count} cards checked, ${cardScan.dirty?.length} dirty)`,
);
await qa.expectVisible('body', `the deck — ${cardScan.count} cards, none carrying a question the visitor declined`);

// ---------------------------------------------------------------------------------------------
// 11. ASKED EXACTLY ONCE — reload discovery; nothing may be re-asked.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'reload discovery after finishing it — the ask-once test');
await page.waitForTimeout(2000);
const reAsked = await eligDim();
await qa.note(`after a reload, discovery shows: ${page.url()} — eligibility question on screen: ${reAsked ?? 'none'}`);
await assert(reAsked === null, `AC2: no eligibility question is asked a second time on reload (got "${reAsked}")`);
await qa.expectVisible('body', 'AC2: a reload after finishing asks nothing again');

// ---------------------------------------------------------------------------------------------
// 12. AC8 — the 360px floor the design spec calls out (§8), on a fresh session.
// ---------------------------------------------------------------------------------------------
await page.context().clearCookies();
await page.setViewportSize({ width: 360, height: 780 });
await qa.goto('/discovery', 'AC8: a fresh visitor at the 360px floor the design spec sets');
await qa.fill(page.getByRole('textbox', { name: /What kind of job are you going for/ }), ROLE, 'Q1 at 360px');
await qa.click(page.getByRole('button', { name: "That's me" }), 'Q1 at 360px: submit');
await page.waitForTimeout(1600);
for (let i = 0; i < 12; i++) {
  if (await eligDim()) break;
  const opt = page.locator('.discovery .opts .opt').first();
  if (await opt.count()) await opt.click();
  else if (await page.locator('#floor-free').count()) {
    await page.fill('#floor-free', 'Owned a $2M budget at Acme from 2021 to 2024');
    await page.click('.discovery .field .go');
  } else break;
  await page.waitForTimeout(1700);
  if (!page.url().includes('/discovery')) break;
}

// The two labels the design spec names by hand — the longest in the set.
async function checkLabel(name) {
  const el = page.getByRole('button', { name, exact: true }).first();
  if (!(await el.count())) return qa.note(`"${name}" not on screen at this step`);
  const box = await el.boundingBox();
  const overflow = await page.evaluate(() => {
    const d = document.documentElement;
    return { scrollW: d.scrollWidth, clientW: d.clientWidth };
  });
  await qa.expectVisible(el, `AC8 at 360px: "${name}" — ${Math.round(box.width)}x${Math.round(box.height)}px`);
  await assert(box.height >= 44, `AC8 at 360px: "${name}" is still a >=44px tap target (${Math.round(box.height)}px)`);
  await assert(
    overflow.scrollW <= overflow.clientW + 1,
    `AC8 at 360px: "${name}" wraps instead of forcing the page to scroll sideways (${overflow.scrollW} vs ${overflow.clientW})`,
  );
  const clipped = await el.evaluate((n) => n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1);
  await assert(clipped === false, `AC8 at 360px: "${name}" is not truncated inside its button`);
}

const dim360 = await eligDim();
await qa.note(`at 360px the eligibility block opens on: ${dim360} — ${JSON.stringify(await askQ())}`);
await qa.scrollThrough('AC8: scroll the 360px ask dock the way a phone user would');
await checkLabel("Not yet — I'd need sponsorship");
await qa.scrollThrough('AC8: read the whole 360px screen with the work-rights question up');
await qa.click(page.getByRole('button', { name: 'Yes — no sponsorship needed', exact: true }).first(), 'answer work-rights at 360px');
await page.waitForTimeout(2300);

// a11y non-regression: the focus ring survives on the quiet option too (design §7).
const quietRing = await page.evaluate(() => {
  const q = document.querySelector('.discovery .opt.quiet');
  if (!q) return null;
  q.focus();
  const s = getComputedStyle(q);
  return { outlineWidth: s.outlineWidth, outlineStyle: s.outlineStyle, focused: document.activeElement === q };
});
await qa.note(`a11y: the quiet decline option under focus -> ${JSON.stringify(quietRing)}`);
await assert(quietRing?.focused === true, 'a11y: the decline is a real focusable button, reachable by keyboard');

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
