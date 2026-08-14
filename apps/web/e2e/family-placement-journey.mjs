// #220 (labeler slice 1) — what a real visitor can actually reach of the job labeler.
//
// This journey deliberately records TWO things, because the honest answer is two things:
//
//   1. The half a visitor DOES touch in a browser: the front door's "Target role" box. That free
//      text is the only input the labeler ever reads (familyLabeler.ts's makeFamilyPlacer reads
//      session.intent.targetRole), so this drives it for real — Ready? -> Start questions instead
//      -> type a role -> Save and continue -> "Got it."
//
//   2. The half NO client reaches: POST /onboarding/discovery/production/evaluate. Measured
//      2026-08-15 — apps/web has exactly two fetch call sites (lib/api.ts and preview/[jobId]),
//      and not one of the ~40 paths they can build is this route; apps/mobile is a README;
//      packages/api-client is a 37-line stub nothing imports. The web app's /discovery screen
//      talks to the OTHER discovery engine (/onboarding/discovery/{start,answer}), which is not
//      reward-eligible and never asks for a family placement. So the journey ASSERTS that gap
//      (every /api request the browser makes is captured and checked), then exercises the route
//      over the wire from inside the very browser session the visitor just created — same cookie,
//      same server — and screenshots the answer it gives that visitor.
//
// When #216 wires the production engine into the UI, step 2's fetch should be replaced by a real
// click, and the "no client reaches it" assertion below should start FAILING. That failure is the
// signal the gap closed, not a broken test — delete it then.
//
//   OPS_KEY=qa-ops-key node apps/api/dist/qa-main.js                       # API on :34101
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 30180
//   BASE_URL=http://127.0.0.1:30180 node apps/web/e2e/family-placement-journey.mjs
//
// Run serially: every run mints anonymous sessions, and the API caps those per IP per hour.
// Ports are deliberately not 3000/3001 — another project on this machine defaults to those and the
// /api proxy would silently reach the wrong backend. API_URL is baked at `next build` time.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:30180';
const OPS_KEY = process.env.OPS_KEY ?? 'qa-ops-key';

const qa = await createSession('family-placement-journey', {
  baseURL: BASE,
  viewport: { width: 390, height: 844 },
});
const { page } = qa;
page.setDefaultTimeout(9000);

// Every /api path this browser asks for, in order — the evidence behind "no client reaches it".
const apiCalls = [];
page.on('request', (req) => {
  const url = new URL(req.url());
  if (url.pathname.startsWith('/api/')) apiCalls.push(`${req.method()} ${url.pathname}`);
});

const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);

// Ask the API the way the visitor's own browser would, then paint the answer into the page so the
// screenshot shows the actual bytes the server sent this session — not a console line nobody keeps.
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

async function frontDoorTypingRole(role, note) {
  await qa.context.clearCookies();
  await qa.goto('/', note);
  await qa.scrollThrough('read the front door top to bottom');
  await qa.click('button:has-text("Ready?")', 'open the front door');
  await qa.click('button:has-text("Start questions instead")', 'choose to start from questions');
  await qa.fill('#target-role', role, `type the target role a real visitor types: "${role}"`);
  await qa.fill('#search-area', 'Singapore', 'type the search area');
  await qa.press('#search-area', 'Enter', 'place the search area chip');
  await qa.click('button:has-text("Save and continue")', 'save what I want next');
  await qa.expectText('h1', 'Got it.', 'the role is accepted and saved on the server');
  await qa.expectText('.intent-confirmation', role, `the saved target role reads back: "${role}"`);
}

// ============================================================ 1. a visitor the vocabulary covers

await qa.note('VISITOR 1 — a target role the published vocabulary covers ("IT project manager")');
await frontDoorTypingRole('IT project manager', 'a brand-new visitor lands on the front door');

apiCalls.length = 0;
await qa.goto('/discovery', 'walk on to the discovery screen, the only discovery UI that exists');
await qa.scrollThrough('read the discovery screen the way a visitor would');

const reachedProduction = apiCalls.some((call) => call.includes('discovery/production'));
await assert(
  !reachedProduction,
  `#220 GAP, recorded not hidden: no browser surface calls the production discovery route. ` +
    `The discovery screen asked for: ${[...new Set(apiCalls)].join(', ') || '(nothing)'}`,
);

// AC1 + AC5 — the route the ticket opens, driven over the wire from this visitor's own session.
await qa.note(
  'AC1/AC5: asking the production discovery route from inside this visitor\'s own browser session — ' +
    'the route that answered 409 for every visitor who ever reached it',
);
const confirmed = await callAsVisitor('POST', '/onboarding/discovery/production/evaluate');
await qa.expectVisible('#qa-wire', 'the server\'s answer to this visitor, verbatim');
await assert(confirmed.status === 200, `AC5: the production evaluate route answers 200, not 409 (got ${confirmed.status})`);
const confirmedBody = JSON.parse(confirmed.body);
await assert(
  confirmedBody.floor?.familyId === 'it-project-delivery' && confirmedBody.floor?.version === 1,
  `AC1: the placement carries the family id AND its version (${JSON.stringify(confirmedBody.floor)})`,
);
await assert(
  confirmedBody.checkpoint === 'family_confirmed',
  `AC5: the checkpoint is written (${confirmedBody.checkpoint})`,
);
await assert(
  typeof confirmedBody.nextQuestion?.prompt === 'string',
  `AC5: discovery has a real next question to ask — the floor is live: "${confirmedBody.nextQuestion?.prompt}"`,
);

// AC1's "no extra question": the placement came off the role already typed on the front door — the
// visitor was asked nothing between typing it and the family being confirmed.
await assert(
  !apiCalls.some((call) => call.includes('placement') || call.includes('family/confirm')),
  'AC1: no extra question was put to the visitor — the placement was made from the role they already typed',
);

// The floor survives a resume, so it was genuinely written and not just returned.
const resumed = await callAsVisitor('GET', '/onboarding/discovery/production');
await qa.expectVisible('#qa-wire', 'AC5: resuming reads the same written floor and checkpoint back');
await assert(
  resumed.status === 200 && JSON.parse(resumed.body).checkpoint === 'family_confirmed',
  `AC5: the floor and checkpoint were WRITTEN — a fresh read gives them back (${resumed.status})`,
);

// ==================================================== 2. a visitor the vocabulary does not cover

await qa.note('VISITOR 2 — a target role no published family covers ("Paediatric nurse practitioner")');
await frontDoorTypingRole(
  'Paediatric nurse practitioner',
  'a second, brand-new visitor lands on the front door',
);

await qa.note('AC3: what the honest "we have no family for this" answer gives that visitor');
const unmapped = await callAsVisitor('POST', '/onboarding/discovery/production/evaluate');
await qa.expectVisible('#qa-wire', 'the server\'s answer to an unmapped visitor, verbatim');
const unmappedBody = JSON.parse(unmapped.body);
await assert(
  unmapped.status === 409 && unmappedBody.error?.code === 'placement_not_confirmed',
  `AC3: an unmapped role is answered honestly, never placed in the nearest family (${unmapped.status} ${unmappedBody.error?.code})`,
);
await assert(
  unmappedBody.familyResearch?.path === '/family-learning/candidates',
  `AC3: the family research candidate path is OFFERED (${JSON.stringify(unmappedBody.familyResearch)})`,
);
await assert(
  unmappedBody.rewardEligible === false,
  'AC4/AC3: nothing is authorized on an unconfirmed placement',
);

// AC4 — the visitor is not blocked: the rest of onboarding still answers for them.
const stillWorks = await callAsVisitor('GET', '/onboarding/discovery');
await qa.expectVisible('#qa-wire', 'AC4: the rest of discovery still answers this visitor');
await assert(stillWorks.status === 200, `AC4: an unplaced visitor is not blocked (${stillWorks.status})`);
await qa.goto('/discovery', 'the unplaced visitor walks on — the product still works for them');
await qa.scrollThrough('the discovery screen is fully usable with no family placement');
await assert(
  !(await page.locator('text=/error|something went wrong/i').first().isVisible().catch(() => false)),
  'AC4: no error surface is shown to a visitor the labeler could not place',
);

// ======================================================= 3. AC7 — the unmapped role is fed onward

await qa.note('AC7: the unmapped role is recorded as feed for the vocabulary-growth process (#218)');
const openFeed = await callAsVisitor('GET', '/ops/unmapped-labels');
await qa.expectVisible('#qa-wire', 'the feed refuses an unauthenticated reader — it carries typed text');
await assert(openFeed.status === 403, `AC7: the feed is key-gated, never open (${openFeed.status})`);

const feed = await callAsVisitor('GET', `/ops/unmapped-labels?key=${OPS_KEY}`);
await qa.expectVisible('#qa-wire', 'AC7: the roles the closed vocabulary had no family for');
const roles = feed.status === 200 ? JSON.parse(feed.body).entries.map((e) => e.role) : [];
await assert(
  feed.status === 200 && roles.includes('Paediatric nurse practitioner'),
  `AC7: the role this visitor typed is in the vocabulary-growth feed (${JSON.stringify(roles)})`,
);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
