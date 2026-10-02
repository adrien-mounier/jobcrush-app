// #260 — the two published families are named after the ROLE a person holds, not the activity
// ("Business Analyst", not "Business analysis"; "IT Project Manager", not "IT project delivery" —
// the same reason we say Product Owner, not Product Ownership). Shipped as a NEW VERSION of each
// family rather than an in-place amendment, because a label reaches the labeler's own prompt and
// question 1's type-ahead, so it is data that can move a placement (#258 decision 3 draws that
// line).
//
// WHAT THIS JOURNEY ALONE CATCHES, that second-family-typeahead-journey.mjs does not:
//
//   1. Both families are read back at v2 from the SHIPPED HTTP seam (/family-floors/:id/active) in
//      the same drive that reads them off the screen — the version and the label proven together.
//      A rename that forgot its version bump would leave the old floor active with a new name.
//   2. The two OLD labels are swept for as leak words across every screen a visitor walks. That
//      sweep is the half a rename silently disarms: the repo's existing negative assertions name
//      the label strings literally, so after a rename each one hunts a string that can no longer
//      appear and passes for the wrong reason. Here BOTH spellings, old and new, are forbidden on
//      both families — so the sweep stays able to fail whichever way a future rename goes.
//   3. Every one of the four scope aliases (#258) is driven through the SCREEN for the renamed
//      family, and the offered words are checked to be the family's MARKET titles rather than the
//      alias just typed. The rename narrows the family's NAME ("IT Project Manager" reads narrower
//      than the delivery work it covers); this is the live evidence that it did not narrow what a
//      scrum master, agile coach, delivery lead or release manager is actually offered.
//   4. A visitor typing the OLD label is walked, and what she is served is recorded — the one
//      behaviour a rename changes for a real person and no unit test asks about.
//
// Fake-model stack only; spends no provider money (the drive asserts the counters itself).
//
//   OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js                       # API on :34101
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 3000
//   BASE_URL=http://127.0.0.1:3000 node apps/web/e2e/family-role-name-journey.mjs
//
// Run serially: every run mints anonymous sessions, and the API caps those per IP per hour.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

// The names the product now uses, and the names it used before #260. BOTH are forbidden on screen:
// the new ones because a family label is internal and never shown to a visitor (ADR-0014 amendment
// 1), the old ones because a leak of a superseded label is the same defect wearing last week's
// clothes. Keeping both is what stops this sweep going quietly blind at the next rename.
const FAMILIES = [
  { id: 'business-analysis', label: 'Business Analyst', wasLabel: 'Business analysis' },
  { id: 'it-project-delivery', label: 'IT Project Manager', wasLabel: 'IT project delivery' },
];

// #258's four scope-named aliases: titles IT Project Manager's SCOPE names as inside the family,
// which are not market search words. Each must find the family and be offered its MARKET titles.
const SCOPE_ALIASES = ['scrum master', 'agile coach', 'delivery lead', 'release manager'];

const qa = await createSession('family-role-name-journey', {
  baseURL: BASE,
  viewport: { width: 390, height: 844 },
});
const { page } = qa;
page.setDefaultTimeout(9000);

const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);

// Ask the API the way the visitor's own browser does, then paint the answer into the page so the
// screenshot carries the actual bytes the server sent this session.
async function callAsVisitor(method, path, body) {
  const result = await page.evaluate(
    async ([m, p, b]) => {
      const res = await fetch(`/api${p}`, {
        method: m,
        credentials: 'same-origin',
        ...(b ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {}),
      });
      return { status: res.status, body: await res.text() };
    },
    [method, path, body ?? null],
  );
  await page.evaluate(
    ([label, r]) => {
      let box = document.querySelector('#qa-wire');
      if (!box) {
        box = document.createElement('pre');
        box.id = 'qa-wire';
        box.style.cssText =
          'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#111;color:#0f0;' +
          'font:11px/1.4 monospace;padding:10px;border-radius:8px;white-space:pre-wrap;max-height:45vh;overflow:auto';
        document.body.appendChild(box);
      }
      box.textContent = `${label}\nHTTP ${r.status}\n${r.body}`;
    },
    [`${method} /api${path}`, result],
  );
  return result;
}

// #322: a role typed at the front door now answers question 1, so its suggestion list is only met
// by a visitor who arrives with no role anywhere — she opens discovery directly.
async function freshVisitorAtQuestionOne(note) {
  await qa.context.clearCookies();
  await qa.goto('/discovery', note);
}

/** Type into question 1 and read back what the screen actually offers her. */
async function typeAtQuestionOne(typed) {
  await qa.fill('#q1-role', typed, `type into question 1 the way a visitor does: "${typed}"`);
  await page.waitForTimeout(1200); // the screen debounces the lookup (~250ms) before it can paint
  return page.locator('.sugg.live button').allInnerTexts().catch(() => []);
}

const rx = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

/**
 * Sweep the rendered screen for every family label — and READ THIS BEFORE CHANGING IT, because the
 * shape of this function IS one of #260's findings.
 *
 * "The internal family label never reaches a screen" used to be checkable with a plain string
 * search. After #260 it is not, for these two families, and no cleverness recovers it:
 *
 *   · "Business Analyst" is word-for-word one of the family's own PUBLISHED MARKET TITLES, which
 *     question 1 offers on purpose, and it is also what the visitor typed and what the product
 *     reads back to her ("We'll look for Business analyst in Singapore.").
 *   · "IT Project Manager" is word-for-word an EXAMPLE in question 1's own hard-coded sub-line
 *     ("…say project manager and I'll also read IT project manager, programme manager, delivery
 *     manager"), written long before the rename.
 *
 * So the honest sweep subtracts the three places those words are legitimately the product's own
 * copy or her own — the suggestion list, question 1's static sub-line, and the search readback —
 * and asserts on everything else. That still fails on a real leak (a readback, a promise, a
 * question, a panel, an end-of-deck line), and it fails on EITHER OLD LABEL anywhere at all, since
 * a superseded label can only ever come from us. What it can no longer do is prove the property
 * for the whole screen — and pretending otherwise, by keeping a search that can never match, is
 * exactly how the repo's other guards went quiet at this rename.
 */
async function noFamilyLabelOnScreen(where) {
  // Read the remainder by REMOVING the legitimate elements from a copy of the page, not by
  // subtracting their text: a string subtraction eats "project manager" out of the middle of
  // "IT Project Manager" and quietly destroys the very leak it is looking for.
  const { swept, remainder } = await page.evaluate(() => {
    // innerText skips display:none, so hiding the legitimate elements and reading the body back is
    // both layout-accurate and exact. Restored immediately — the screenshots must show the real page.
    const hidden = [];
    for (const sel of [
      '.sugg',      // the market titles question 1 offers on purpose
      'p.sub',      // question 1's own hard-coded examples ("...I'll also read IT project manager...")
      '#qa-wire',   // THIS DRIVE's debug overlay, painted with the server's raw JSON - not the product
    ]) {
      for (const el of document.querySelectorAll(sel)) {
        hidden.push([el, el.style.display]);
        el.style.display = 'none';
      }
    }
    const text = document.body.innerText
      .split('\n')
      .filter((line) => !/^We['’]ll look for /i.test(line.trim())) // her own search, read back
      .join('\n');
    for (const [el, prev] of hidden) el.style.display = prev;
    return { swept: text.replace(/\s+/g, ' ').trim().length, remainder: text };
  });
  await qa.note(`${where}: swept ${swept} characters of the product's own words`);
  for (const family of FAMILIES) {
    for (const spelling of [family.label, family.wasLabel]) {
      await assert(
        !rx(spelling).test(remainder),
        `${where}: the internal family name "${spelling}" is nowhere in what the product says ` +
          `(the offered titles, question 1's own examples, and her search readback aside)`,
      );
    }
  }
}

// ================================================ 0. what the registry actually publishes today

await qa.goto('/', 'open the product so the drive has a page to speak from');
for (const family of FAMILIES) {
  const seam = await callAsVisitor('GET', `/family-floors/${family.id}/active`);
  await qa.expectVisible('#qa-wire', `what the shipped seam says is ACTIVE for ${family.id}`);
  const active = seam.status === 200 ? JSON.parse(seam.body) : null;
  await assert(
    active?.version === 2,
    `#260: ${family.id} is active at v2, not amended in place (${JSON.stringify(active?.version)})`,
  );
  await assert(
    active?.label === family.label,
    `#260: and it is named for the role a person holds (${JSON.stringify(active?.label)})`,
  );
  await assert(
    active?.productionRewardEligible === true && active?.source === 'production_research',
    `#260: the new version is still a real, reward-eligible production publication`,
  );
}

// ================================================ 1. AC1 — "business analyst" finds Business Analyst

await qa.note(
  'VISITOR 1 — a business analyst. She types the job she does; the product must recognise it and ' +
    'offer her the words the market actually advertises it under.',
);
await freshVisitorAtQuestionOne('a brand-new visitor opens discovery directly');

const baOffered = await typeAtQuestionOne('business analyst');
await qa.expectVisible('.sugg.live', 'the suggestion list opens under question 1');
await qa.expectText('.sugg.live', 'business analyst', 'she is offered a market job title she can search with');
await qa.scrollThrough('read question 1 with the suggestions open');
await qa.note(`the screen offered her: ${JSON.stringify(baOffered)}`);
await noFamilyLabelOnScreen('question 1, business-analyst query');

const baLookup = await callAsVisitor('GET', '/onboarding/discovery/family?q=business%20analyst');
await qa.expectVisible('#qa-wire', 'what the server named for a business-analyst query, verbatim');
const ba = baLookup.status === 200 ? JSON.parse(baLookup.body) : null;
await assert(
  ba?.family === 'Business Analyst',
  `#260 AC1: the family answering a business-analyst query is named for the role (${JSON.stringify(ba?.family)})`,
);
await assert(
  (ba?.suggestions ?? []).includes('business analyst') &&
    (ba?.suggestions ?? []).includes('senior business analyst'),
  `#260 AC1: and what comes back is that family's MEASURED MARKET titles (${JSON.stringify(ba?.suggestions)})`,
);

// The rename made the label and one market title the same words. What is OFFERED must still be the
// family's MEASURED MARKET TITLES and nothing else — every suggestion is a one-tap role submission,
// so a label offered here would put an internal word into a visitor's own search. Pinned as an
// EQUALITY against the published list (business-analysis v2's marketSearchTitles, HK/SG/VN/AU
// de-duplicated in publication order), not a `contains`: a label sneaking in as a third entry has
// to fail, and a `contains` would let it through.
await assert(
  JSON.stringify(ba?.suggestions) === JSON.stringify(['business analyst', 'senior business analyst']),
  `#260: what she is offered is exactly the family's published market titles, in publication ` +
    `order — no label, no duplicate, nothing else (${JSON.stringify(ba?.suggestions)})`,
);
await assert(
  !(ba?.suggestions ?? []).some((title) => title === ba?.family),
  `#260: and the label itself — identical to a market title in every letter but its capitals — is ` +
    `never what comes back (${JSON.stringify(ba?.family)} vs ${JSON.stringify(ba?.suggestions)})`,
);

// ================================================ 2. AC2 — "project manager" finds IT Project Manager

await qa.note(
  'VISITOR 2 — a project manager. The rename must not have moved her: the delivery family still ' +
    'answers her query, and the analyst family must not have stolen it.',
);
await freshVisitorAtQuestionOne('a second brand-new visitor opens discovery directly');

const pmOffered = await typeAtQuestionOne('project manager');
await qa.expectVisible('.sugg.live', 'the suggestion list opens for her too');
await qa.expectText('.sugg.live', 'project manager', "the delivery family's own market words are offered");
await qa.scrollThrough('read question 1 with the suggestions open');
await qa.note(`the screen offered her: ${JSON.stringify(pmOffered)}`);
await assert(
  pmOffered.some((text) => /delivery manager/i.test(text)),
  `#260 AC2: and "delivery manager" alongside it (${JSON.stringify(pmOffered)})`,
);
await noFamilyLabelOnScreen('question 1, project-manager query');

const pmLookup = await callAsVisitor('GET', '/onboarding/discovery/family?q=project%20manager');
await qa.expectVisible('#qa-wire', 'what the server named for a project-manager query, verbatim');
const pm = pmLookup.status === 200 ? JSON.parse(pmLookup.body) : null;
await assert(
  pm?.family === 'IT Project Manager',
  `#260 AC2: the delivery family is named for the role too (${JSON.stringify(pm?.family)})`,
);
await assert(
  JSON.stringify(pm?.suggestions) === JSON.stringify(['project manager', 'delivery manager']),
  `#260 AC2: offered in the published order, unchanged by the rename (${JSON.stringify(pm?.suggestions)})`,
);

// ================================================ 3. AC3 — the four scope aliases still find it

await qa.note(
  'VISITOR 3 — a scrum master, then an agile coach, a delivery lead, a release manager. The ' +
    'family is now NAMED "IT Project Manager", which reads narrower than the delivery work it ' +
    'covers. None of these four may lose their way to it, and none may be offered back the words ' +
    'she just typed — a suggestion is a one-tap search, and no employer advertises "agile coach".',
);
await freshVisitorAtQuestionOne('a third brand-new visitor opens discovery directly');

for (const typed of SCOPE_ALIASES) {
  const offered = await typeAtQuestionOne(typed);
  await qa.expectVisible('.sugg.live', `the suggestion list opens for "${typed}"`);
  await qa.note(`"${typed}" was offered: ${JSON.stringify(offered)}`);
  await assert(
    offered.some((text) => /project manager/i.test(text)),
    `#260 AC3: "${typed}" still reaches the delivery family after the rename (${JSON.stringify(offered)})`,
  );
  await assert(
    !offered.some((text) => text.trim().toLowerCase() === typed),
    `#260 AC3: and is never offered "${typed}" back — the words offered are market titles`,
  );
  const lookedUp = await callAsVisitor(
    'GET',
    `/onboarding/discovery/family?q=${encodeURIComponent(typed)}`,
  );
  const body = lookedUp.status === 200 ? JSON.parse(lookedUp.body) : null;
  await assert(
    body?.family === 'IT Project Manager',
    `#260 AC3: the server names the family the labeler will place "${typed}" in (${JSON.stringify(body?.family)})`,
  );
}
await qa.scrollThrough('read question 1 after the four scope-named titles');
await noFamilyLabelOnScreen('question 1, scope-alias queries');

// ================================================ 4. AC4 — a job no family covers is met with silence

await qa.note(
  'VISITOR 4 — a marine engineer. No published family covers her. The screen must offer her ' +
    'NOTHING rather than the nearest family\'s words: a suggestion is one tap from a placement, so ' +
    'a helpful guess here is a wrong placement (#255 QA-gate defect 1).',
);
await freshVisitorAtQuestionOne('a fourth brand-new visitor opens discovery directly');

const marineOffered = await typeAtQuestionOne('marine engineer');
await qa.note(`the screen offered her: ${JSON.stringify(marineOffered)}`);
await assert(marineOffered.length === 0, "#260 AC4: nothing at all is offered to a job no family covers");
await assert(
  (await page.locator('.sugg.live').count()) === 0,
  '#260 AC4: the suggestion list does not even open — the screen stays shut',
);
await qa.scrollThrough('read question 1 with nothing offered');
await noFamilyLabelOnScreen('question 1, a job no family covers');

const marineLookup = await callAsVisitor('GET', '/onboarding/discovery/family?q=marine%20engineer');
await qa.expectVisible('#qa-wire', 'what the server answered for a job it does not cover');
const marine = marineLookup.status === 200 ? JSON.parse(marineLookup.body) : null;
await assert(
  Array.isArray(marine?.suggestions) && marine.suggestions.length === 0,
  `#260 AC4: the server offers no words either (${JSON.stringify(marine?.suggestions)})`,
);

// ================================================ 5. the visitor who types a name we USED to use

await qa.note(
  'VISITOR 5 — types the family names as they read BEFORE #260. Nobody outside this repo has ever ' +
    'seen those words, so this is not a promise the product broke; it is recorded because a rename ' +
    'changes what a real person typing them is served, and nothing else in the suite asks.',
);
for (const family of FAMILIES) {
  const old = await callAsVisitor(
    'GET',
    `/onboarding/discovery/family?q=${encodeURIComponent(family.wasLabel.toLowerCase())}`,
  );
  const answer = old.status === 200 ? JSON.parse(old.body) : null;
  await qa.note(
    `typing the old name "${family.wasLabel}" now returns ${JSON.stringify(answer)}`,
  );
  await assert(
    Array.isArray(answer?.suggestions),
    `the old name "${family.wasLabel}" is answered with a well-formed no-match, never an error`,
  );
}

// ================================================ 6. a fresh placement lands at the NEW version

await qa.note(
  'VISITOR 6 — a fresh placement made TODAY must be recorded against the version published today. ' +
    'A new placement written at v1 would be a stored reference to a floor the product has moved on ' +
    'from, and it would resolve for ever to the old name.',
);
await freshVisitorAtQuestionOne('a sixth brand-new visitor opens discovery directly');
const placed = await callAsVisitor('POST', '/onboarding/discovery/start', { role: 'Business analyst' });
await qa.expectVisible('#qa-wire', 'the placement this stack made for a business-analyst role');
const placedBody = placed.status === 200 ? JSON.parse(placed.body) : null;
await assert(
  placedBody?.family === 'Business Analyst',
  `#260 AC5: a placement made today resolves to the version published today (${JSON.stringify(placedBody?.family)})`,
);
await qa.scrollThrough('walk the discovery screen she was given');
await noFamilyLabelOnScreen('the discovery screen after a real placement');

// ================================================ 7. AC7 — the gate spent no provider money

const spend = await callAsVisitor('GET', '/qa/llm-calls');
await qa.expectVisible('#qa-wire', "the fake stack's own call counters after the whole drive");
const calls = spend.status === 200 ? JSON.parse(spend.body) : null;
await qa.note(`fake-model call counters for this stack: ${JSON.stringify(calls)}`);
await assert(
  calls !== null,
  '#260 AC7: this drive ran against the FAKE model stack — /qa/llm-calls exists only there, and ' +
    'the real API 404s it, so a reply here is proof no provider was ever reachable',
);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
