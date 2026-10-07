// #106 — the eligibility questions inside discovery: the whole journey a real person walks.
//
// Front door -> the role question -> the eligibility block (answering, an explicit "no", declining,
// and correcting an answer through the fix affordance) -> the deck -> a reload that asks the
// put-off questions again. Plus AC8's responsive/a11y non-regression, including the design spec's
// 360px floor (§8) which the .spec.ts sweep does not cover (its smallest viewport is 390px).
//
// #339: discovery asks nothing but eligibility after question 1 — no floor question, no countdown.
// "Ask me later" stores nothing: the screen moves past the question for the rest of the visit, and
// a reload asks it again.
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
// The badge renders nothing at 0 facts (badge spec §6), so "no badge" on discovery reads as 0. Off
// discovery (the deck carries no badge) a null still means "no badge on this screen".
const badgeCount = () => page.evaluate(() => {
  if (!document.querySelector('.discovery .topbar')) return null;
  const el = document.querySelector('a.prof');
  return el ? Number(el.querySelector('.n')?.textContent ?? '0') : 0;
});

// Every question the visitor actually answers before jobs appear.
let asked = 0;
const askedLog = [];
const countAsk = (what) => { asked++; askedLog.push(`${asked}. ${what}`); };

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
await assert(
  (await page.locator('.discovery').innerText()).match(/eligibility/i) === null,
  'UX intent: nothing on screen labels these as a different kind of question — the word "eligibility" never appears',
);
// #339: the countdown and the section rail it fed are gone, and so is every floor question.
await assert(
  (await page.locator('.discovery .countdown, .discovery .rail, .discovery .session-strip').count()) === 0,
  '#339: no "N answers until your next jobs" countdown and no progress rail on the screen',
);
await qa.scrollThrough('read the screen right after question 1');

// ---------------------------------------------------------------------------------------------
// 3. The FIRST question after Q1 is eligibility. #339: there is no floor to walk through first.
//    #162: it is work-rights — the years question is GONE, worked out from the dated job records
//    instead of asked (ADR-0008 clause 2).
// ---------------------------------------------------------------------------------------------
const dim1 = await eligDim();
await assert(dim1 === 'work-rights', `#339: the very next question after Q1 is work-rights, no floor in between (got "${dim1}")`);
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
// #339: "Ask me later" stores nothing and takes back what the "no" stored — the server serves the
// work-rights question again, so it is this screen alone that moves past it for this visit.
const afterRetract = await page.evaluate(async () => (await fetch('/api/onboarding/discovery')).json());
await assert(
  afterRetract.questions.some((q) => q.eligibility?.dimension === 'work-rights'),
  `#339: the retraction stored nothing — the server still has the work-rights question open (${afterRetract.questions.map((q) => q.itemId).join(', ')})`,
);

// ---------------------------------------------------------------------------------------------
// 6b. A REFUSAL IS NOT A FACT — the count must not move, on any screen that shows it.
// ---------------------------------------------------------------------------------------------
// #339: this visitor brought no CV and an eligibility answer is never counted as a fact, so her
// count is 0 throughout — and the badge is not rendered at 0 (badge spec §6), which `badgeCount`
// reads as 0. The claim is that it does not MOVE; the profile round trip that checks the same number
// on another screen is §11b, after the deck, because leaving this page ends the visit — and a new
// visit asks the put-off question again, which §7 below must not see yet.
const badgeAfterRetract = await badgeCount();
const factsAfterRetract = afterRetract.factCount;
await qa.note(`fact count across the retraction (a decline): badge ${badgeAfterReal} -> ${badgeAfterRetract}, server ${factsAfterRetract}`);
await assert(
  badgeAfterRetract === badgeAfterReal && factsAfterRetract === badgeAfterRetract,
  `declining did not inflate the count on discovery (badge ${badgeAfterReal} -> ${badgeAfterRetract}, server says ${factsAfterRetract})`,
);

// ---------------------------------------------------------------------------------------------
// 7. AFTER THE RETRACTION — "ask me later" means later, not now.
//
// There is one work-rights question — the visitor searches one market. #339: retracting its answer
// to "Ask me later" stores nothing, so the question stays open on the server, but the screen passes
// it for the rest of this visit: the subtext promised "I'll ask again when a JOB needs it", so
// re-asking on the very next screen would break that promise. What a real visitor sees next is the
// languages question. §11 proves the other half — a later visit does ask again.
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
const badgeAfterDecline = await badgeCount();
// #339: with every question either answered or put off for this visit, the last decline hands off
// to /deck, which deliberately carries no badge (spec §11) — so a null here is the deck, not a lost
// count. The decline/count check that matters is §6b above.
await qa.note(`fact badge across the final DECLINE: ${badgeBeforeDecline} -> ${badgeAfterDecline ?? 'no badge (the deck carries none)'}`);

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
// 11. A LATER VISIT ASKS AGAIN — #339. Both questions were put off ("Ask me later" on each), and
//     putting a question off stores nothing, so reopening discovery asks the first of them again.
//     Within the visit above neither was re-asked (§7); a new visit is when "later" arrives.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'reopen discovery after the deck — a later visit');
await page.waitForTimeout(2000);
const reAsked = await eligDim();
await qa.note(`after a reload, discovery shows: ${page.url()} — eligibility question on screen: ${reAsked ?? 'none'}`);
await assert(reAsked === 'work-rights', `#339: a later visit asks the put-off work-rights question again (got "${reAsked}")`);
const reloaded = await page.evaluate(async () => (await fetch('/api/onboarding/discovery')).json());
await assert(
  reloaded.stage === 'discovery' &&
    reloaded.questions.map((q) => q.eligibility?.dimension).join(',') === 'work-rights,language',
  `#339: both put-off questions are still open on the server, and nothing else is (${reloaded.stage}: ${reloaded.questions.map((q) => q.itemId).join(', ')})`,
);
await qa.expectVisible('.discovery #ask-q', '#339: the reopened screen asks the put-off question again');

// ---------------------------------------------------------------------------------------------
// 11b. A REFUSAL IS NOT A FACT, on the profile too — the same visitor opens her profile, which must
//      tell her the same number discovery does (two declines in, still nothing counted).
// ---------------------------------------------------------------------------------------------
const badgeBeforeProfile = await badgeCount();
await qa.goto('/profile', 'she opens her profile (the badge that links there is not drawn at 0 facts)');
await page.waitForTimeout(2000);
// At 0 facts the profile shows its empty state ("Nothing here yet.") instead of a counted heading.
const profileHeading = (await txt('.profile .pcount'))
  ?? (/Nothing here yet\./.test(await page.locator('body').innerText()) ? '0 (the empty profile: "Nothing here yet.")' : '(no profile heading)');
await qa.expectVisible('body', `what the profile says after two declines: "${profileHeading}"`);
const profileN = Number((profileHeading.match(/^(\d+)/) ?? [])[1] ?? NaN);
await assert(
  profileN === badgeBeforeProfile && profileN === reloaded.factCount,
  `the profile and discovery tell the same visitor the same number (profile ${profileN}, badge ${badgeBeforeProfile}, server ${reloaded.factCount})`,
);
await qa.scrollThrough('read the whole profile after two declines');
await qa.goto('/discovery', 'back to discovery after visiting the profile');
await page.waitForTimeout(2000);
const badgeAfterProfile = await badgeCount();
await assert(
  badgeAfterProfile === badgeBeforeProfile,
  `opening the profile did not raise the visitor's fact count (${badgeBeforeProfile} -> ${badgeAfterProfile})`,
);

// ---------------------------------------------------------------------------------------------
// 12. AC8 — the 360px floor the design spec calls out (§8), on a fresh session.
// ---------------------------------------------------------------------------------------------
await page.context().clearCookies();
await page.setViewportSize({ width: 360, height: 780 });
await qa.goto('/discovery', 'AC8: a fresh visitor at the 360px floor the design spec sets');
await qa.fill(page.getByRole('textbox', { name: /What kind of job are you going for/ }), ROLE, 'Q1 at 360px');
await qa.click(page.getByRole('button', { name: "That's me" }), 'Q1 at 360px: submit');
await page.waitForTimeout(1600);

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
