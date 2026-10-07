// #255 (pilot run, spec #251, part of #218) — what a real visitor gains from the SECOND published
// job family.
//
// Until this slice the production registry published exactly one family, so question 1's type-ahead
// could answer "the" family without ever being asked which. Two families made that wrong: the
// lookup now picks the family whose label or market search words the typed text overlaps. This
// journey drives that through the shipped screen, both directions:
//
//   type "business analyst"  -> the NEW family's words appear, and the server names "Business Analyst"
//   type "project manager"   -> the ORIGINAL family still answers "IT Project Manager" (regression)
//   type "scrum master"      -> the family's own words appear: #258 made the titles a family's
//                               SCOPE names (scrum master, agile coach, delivery lead) findable
//   type "marine engineer"   -> NOTHING is offered: a query matching no family is a silent
//                               no-match, because every suggestion is a one-tap role submission
//
// The fourth case is #255's QA-gate defect 1, caught by a live drive: the fallback used to serve the
// alphabetically-first family's words under the heading "same kind of job", putting a scrum master
// one tap from a Business Analyst placement. The unit test pins the API's answer; only this drive
// pins that the SCREEN stays shut.
//
// WHY THE THIRD CASE INVERTED (#258). It used to drive "scrum master" and assert the screen stayed
// shut, because the lookup only ever compared the typed words against a family's label and its
// market search titles. But IT Project Manager's scope names scrum masters as INSIDE the family —
// the labeler placed them there all along, and only the hint failed to recognise them. #258 gave
// each family the list of titles its own scope names, so those visitors are hinted too. The rule
// the old assertion protected is unchanged and still proven live; it simply moved to a phrase that
// genuinely matches no published family.
//
// The placement itself is asserted too. It became assertable when #255's QA gate found the QA
// stack's canned labeler (apps/api/src/qaFamilyAnswer.ts) still naming only it-project-delivery —
// so this stack reported the new family unreachable while the registry published it. Only the real
// model's own judgement is left as a staging spot-check.
//
//   OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js                       # API on :34101
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 30180
//   BASE_URL=http://127.0.0.1:30180 node apps/web/e2e/second-family-typeahead-journey.mjs
//
// Run serially: every run mints anonymous sessions, and the API caps those per IP per hour.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:30180';

const qa = await createSession('second-family-typeahead-journey', {
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

async function freshVisitorAtQuestionOne(role, note) {
  await qa.context.clearCookies();
  await qa.goto('/', note);
  await qa.scrollThrough('read the front door top to bottom');
  await qa.click('button:has-text("Ready?")', 'open the front door');
  await qa.click('button:has-text("Start questions instead")', 'choose to start from questions');
  await qa.fill('#target-role', role, `type the target role: "${role}"`);
  await qa.fill('#search-area', 'Singapore', 'type the search area');
  await qa.press('#search-area', 'Enter', 'place the search area chip');
  await qa.click('button:has-text("Save and continue")', 'save what I want next');
  await page.waitForURL(/\/discovery/);
  await qa.goto('/discovery', 'walk on to question 1');
}

// ================================================ 1. the NEW family is reachable from question 1

await qa.note('VISITOR 1 — types a business-analyst role, the family published by the #255 pilot run');
await freshVisitorAtQuestionOne('Business analyst', 'a brand-new visitor lands on the front door');

await qa.fill('#q1-role', 'business analyst', 'type into question 1 the way a visitor does');
// The screen debounces the lookup (~250ms) before the suggestion list can paint.
await page.waitForTimeout(1200);
await qa.expectVisible('.sugg.live', 'the suggestion list opens under question 1');
await qa.expectText('.sugg.live', 'business analyst', 'the NEW family\'s own search words are offered');
await qa.scrollThrough('read question 1 with the suggestions open');

const baLookup = await callAsVisitor('GET', '/onboarding/discovery/family?q=business%20analyst');
await qa.expectVisible('#qa-wire', 'what the server named for a business-analyst query, verbatim');
const ba = baLookup.status === 200 ? JSON.parse(baLookup.body) : null;
await assert(
  ba?.family === 'Business Analyst',
  `#255: a business-analyst query resolves to the newly published family (${JSON.stringify(ba?.family)})`,
);
await assert(
  (ba?.suggestions ?? []).includes('business analyst'),
  `#255: it offers the new family's measured market words (${JSON.stringify(ba?.suggestions)})`,
);

// A FRESH placement into the newly published family, end to end — the publication AC's locally
// provable half.
const placed = await callAsVisitor('POST', '/onboarding/discovery/start', { role: 'Business analyst' });
await qa.expectVisible('#qa-wire', 'the placement this stack made for a business-analyst role');
const placedBody = placed.status === 200 ? JSON.parse(placed.body) : null;
await assert(
  placedBody?.family === 'Business Analyst',
  `#255: a fresh business-analyst placement lands in the newly published family (${JSON.stringify(placedBody?.family ?? null)})`,
);
// #339: discovery no longer ASKS any family's floor — she is asked eligibility only, whatever family
// she is placed in. The publication still reaches her: it is the plan pinned below.
const askedIds = (placedBody?.questions ?? []).map((q) => q.itemId);
await assert(
  !askedIds.includes('requirements-elicitation') && (placedBody?.questions ?? []).every((q) => q.eligibility),
  `#339: she is asked no floor question, the new family's included — eligibility only (${JSON.stringify(askedIds)})`,
);
const baPlan = JSON.parse((await callAsVisitor('GET', '/sessions/me')).body).discovery;
await qa.expectVisible('#qa-wire', 'the durable record the placement wrote');
await assert(
  baPlan?.questionFloors?.[0]?.familyId === 'business-analysis' &&
    baPlan?.questionFloors?.[0]?.version === 2 &&
    baPlan?.searchFamily?.familyId === 'business-analysis',
  `#255: the plan is pinned to the new family, id AND version (${JSON.stringify(baPlan?.questionFloors)}, search ${JSON.stringify(baPlan?.searchFamily)})`,
);
// A placed role is NOT a vocabulary gap — it must never reach the growth feed.
const feed = await callAsVisitor('GET', `/ops/unmapped-labels?key=${process.env.OPS_KEY ?? 'qa-ops-key'}`);
await qa.expectVisible('#qa-wire', 'the vocabulary-growth feed after a successful placement');
const feedLabels = feed.status === 200 ? JSON.parse(feed.body).entries.map((e) => e.label) : ['(unreadable)'];
await assert(
  !feedLabels.some((l) => /business analyst/i.test(l)),
  `#255: a placed business-analyst role is not filed as an unmapped gap (${JSON.stringify(feedLabels)})`,
);

// ============================================ 2. the ORIGINAL family still answers — no regression

await qa.note('VISITOR 2 — types a project-manager role: the single-family world must be unchanged');
await freshVisitorAtQuestionOne('IT project manager', 'a second brand-new visitor lands on the front door');

await qa.fill('#q1-role', 'project manager', 'type into question 1 the way a visitor does');
await page.waitForTimeout(1200);
await qa.expectVisible('.sugg.live', 'the suggestion list opens under question 1');
await qa.expectText('.sugg.live', 'delivery manager', 'the ORIGINAL family\'s search words still appear');
await qa.scrollThrough('read question 1 with the suggestions open');

const pmLookup = await callAsVisitor('GET', '/onboarding/discovery/family?q=project%20manager');
await qa.expectVisible('#qa-wire', 'what the server named for a project-manager query, verbatim');
const pm = pmLookup.status === 200 ? JSON.parse(pmLookup.body) : null;
await assert(
  pm?.family === 'IT Project Manager',
  `#255 regression: the second family did not steal the first family's queries (${JSON.stringify(pm?.family)})`,
);
await assert(
  (pm?.suggestions ?? []).includes('project manager') &&
    !(pm?.suggestions ?? []).includes('business analyst'),
  `#255: one query gets ONE family's words, never both merged (${JSON.stringify(pm?.suggestions)})`,
);

// ============ 3. a title the family's SCOPE names is recognised at question 1 (#258)

await qa.note(
  "VISITOR 3 — a scrum master. IT Project Manager's scope names her job as inside the family, so " +
    "she is offered that family's market titles — never the words she just typed.",
);
await freshVisitorAtQuestionOne('Scrum master', 'a third brand-new visitor lands on the front door');

for (const typed of ['scrum master', 'agile coach', 'delivery lead', 'release manager']) {
  await qa.fill('#q1-role', typed, `type "${typed}" into question 1`);
  await page.waitForTimeout(1200);
  const offered = await page.locator('.sugg.live button').allInnerTexts();
  await assert(
    offered.some((text) => /project manager/i.test(text)),
    `#258: "${typed}" is offered IT Project Manager's own market words (${JSON.stringify(offered)})`,
  );
  await assert(
    !offered.some((text) => text.trim().toLowerCase() === typed),
    `#258: the alias she typed is never offered back as a suggestion (${JSON.stringify(offered)})`,
  );
  const lookedUp = await callAsVisitor(
    'GET',
    `/onboarding/discovery/family?q=${encodeURIComponent(typed)}`,
  );
  const body = lookedUp.status === 200 ? JSON.parse(lookedUp.body) : null;
  await assert(
    body?.family === 'IT Project Manager',
    `#258: the server names the family the labeler will place her in for "${typed}" (${JSON.stringify(body?.family)})`,
  );
}
await qa.scrollThrough('read question 1 as a scrum master sees it — her work is recognised');

// ====================== 4. a query matching NO family still offers nothing (QA gate defect 1)

await qa.note(
  'VISITOR 4 — a marine engineer. Every suggestion is a one-tap role submission under the heading ' +
    '"same kind of job", so a query that matches no family must still offer nothing at all.',
);
await freshVisitorAtQuestionOne('Marine engineer', 'a fourth brand-new visitor lands on the front door');

for (const typed of ['marine engineer', 'programme manager']) {
  await qa.fill('#q1-role', typed, `type "${typed}" into question 1`);
  await page.waitForTimeout(1200);
  const offered = await page.locator('.sugg.live button').allInnerTexts();
  await assert(
    offered.length === 0,
    `#255 defect 1: "${typed}" matches no family, so the box offers nothing (${JSON.stringify(offered)})`,
  );
  const lookedUp = await callAsVisitor(
    'GET',
    `/onboarding/discovery/family?q=${encodeURIComponent(typed)}`,
  );
  const body = lookedUp.status === 200 ? JSON.parse(lookedUp.body) : null;
  await assert(
    (body?.suggestions ?? ['x']).length === 0,
    `#255 defect 1: the server sends the documented silent no-match for "${typed}" (${JSON.stringify(body?.suggestions)})`,
  );
}
await qa.scrollThrough('read question 1 as a marine engineer sees it — no wrong-family shortcuts');

// An empty query still offers nothing at all — the type-ahead never opens unasked.
const empty = await callAsVisitor('GET', '/onboarding/discovery/family?q=');
await qa.expectVisible('#qa-wire', 'an empty query offers nothing');
const emptyBody = empty.status === 200 ? JSON.parse(empty.body) : null;
await assert(
  (emptyBody?.suggestions ?? ['x']).length === 0,
  `#255: an empty query suggests nothing (${JSON.stringify(emptyBody?.suggestions)})`,
);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
