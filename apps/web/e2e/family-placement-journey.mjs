// #220 (labeler slice 1) — what a real visitor can actually reach of the job labeler.
//
// #216 CLOSED the gap this journey was written to record. It used to say: the browser reaches the
// front door's "Target role" box, and NO client reaches the placement's own interview — the web
// app's /discovery screen talked to a second engine that was not reward-eligible and never asked
// for a family placement. That second engine is gone. The shipped screen now serves the placed
// family's published floor and writes the plan (#339: the floor is pinned, never asked — the
// screen asks eligibility only), so this journey drives ONE path:
//
//   Ready? -> Start questions instead -> type a role -> Save and continue -> "Got it."
//   -> /discovery -> answer question 1 -> the next questions appear
//   -> the plan and checkpoint are readable off the visitor's own session.
//
// The old "no client reaches it" assertion is inverted below: the discovery screen MUST now reach
// the routes that write the plan. If it stops doing so, the two engines have grown back.
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
  // #257: acceptance now shows as the walk-on to discovery, where the confirmation line lives.
  await page.waitForURL(/\/discovery/);
  await qa.expectText('.intent-context', role, `the saved target role reads back: "${role}"`);
}

// ============================================================ 1. a visitor the vocabulary covers

await qa.note('VISITOR 1 — a target role the published vocabulary covers ("IT project manager")');
await frontDoorTypingRole('IT project manager', 'a brand-new visitor lands on the front door');

apiCalls.length = 0;
await qa.goto('/discovery', 'walk on to the discovery screen, the only discovery UI that exists');
// #322: the front door already took the role, so discovery opens on the checklist — no question 1.
await page.waitForTimeout(2500);
await qa.scrollThrough('read the discovery screen the way a visitor would');

// #216, the inversion: the screen a visitor actually walks IS the interview now. Before this
// ticket the assertion here read the other way round, and that gap was the whole defect.
await assert(
  apiCalls.some((call) => call.includes('/onboarding/discovery')),
  `#216: the discovery screen drives the interview that writes the plan. ` +
    `It asked for: ${[...new Set(apiCalls)].join(', ') || '(nothing)'}`,
);
await assert(
  !apiCalls.some((call) => call.includes('discovery/production')),
  'AC6: there is no second discovery engine left for any client to call',
);

// AC1 + AC5 — read off the durable record her own answers produced.
const pinned = (await callAsVisitor('GET', '/sessions/me')).body;
await qa.expectVisible('#qa-wire', "the visitor's own stored discovery record, verbatim");
const plan = JSON.parse(pinned).discovery;
await assert(
  plan?.questionFloors?.[0]?.familyId === 'it-project-delivery' &&
    plan?.questionFloors?.[0]?.version === 2,
  `AC1: the interview is pinned to the placed family, id AND version (${JSON.stringify(plan?.questionFloors)})`,
);
await assert(
  plan?.searchFamily?.familyId === 'it-project-delivery',
  `AC5: the search family is written, so her deck retrieves on it (${JSON.stringify(plan?.searchFamily)})`,
);
await assert(
  plan?.checkpoint === 'family_confirmed',
  `AC5: the checkpoint is written by her own screen (${plan?.checkpoint})`,
);

// AC1's "no extra question": the placement came off the role already typed — the visitor was asked
// nothing between typing it and the next questions appearing.
await assert(
  !apiCalls.some((call) => call.includes('placement') || call.includes('family/confirm')),
  'AC1: no extra question was put to the visitor — the placement was made from the role they already typed',
);

// The plan survives a resume, so it was genuinely written and not just returned. #339: the floor
// is pinned for matching but never asked — a fresh read asks eligibility only, and the stored plan
// is unchanged by it.
const resumed = await callAsVisitor('GET', '/onboarding/discovery');
await qa.expectVisible('#qa-wire', 'AC5: resuming reads the live questions back — eligibility only');
const resumedBody = resumed.status === 200 ? JSON.parse(resumed.body) : null;
const replan = JSON.parse((await callAsVisitor('GET', '/sessions/me')).body).discovery;
await assert(
  resumed.status === 200 &&
    (resumedBody?.questions ?? []).every((q) => q.eligibility) &&
    JSON.stringify(replan?.questionFloors) === JSON.stringify(plan?.questionFloors),
  `AC5: the plan was WRITTEN — a fresh read keeps the same pinned floor and asks no floor question (${resumed.status})`,
);

// ==================================================== 2. a visitor the vocabulary does not cover

await qa.note('VISITOR 2 — a target role no published family covers ("Paediatric nurse practitioner")');
await frontDoorTypingRole(
  'Paediatric nurse practitioner',
  'a second, brand-new visitor lands on the front door',
);

await qa.note('AC3: what an unplaceable role gets — #235 serves her the word search, never a refusal');
const unmapped = await callAsVisitor('POST', '/onboarding/discovery/start', {
  role: 'Paediatric nurse practitioner',
});
await qa.expectVisible('#qa-wire', "the server's answer to an unmapped visitor, verbatim");
const unmappedBody = unmapped.status === 200 ? JSON.parse(unmapped.body) : null;
await assert(
  unmapped.status === 200,
  `AC3: an unmapped role is served, never refused and never placed in the nearest family (${unmapped.status})`,
);
await assert(
  unmappedBody?.family === null,
  `AC3: no family is claimed for her — the screen names none (${JSON.stringify(unmappedBody?.family)})`,
);
const unmappedPlan = JSON.parse((await callAsVisitor('GET', '/sessions/me')).body).discovery;
await assert(
  unmappedPlan?.searchFamily === null,
  `AC4: nothing is authorized on an unconfirmed placement — retrieval searches her own words (${JSON.stringify(unmappedPlan?.searchFamily)})`,
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
// #252 renamed the field: the feed now carries `label`, because it holds past job titles as well
// as target roles.
const labels = feed.status === 200 ? JSON.parse(feed.body).entries.map((e) => e.label) : [];
await assert(
  feed.status === 200 && labels.includes('Paediatric nurse practitioner'),
  `AC7: the role this visitor typed is in the vocabulary-growth feed (${JSON.stringify(labels)})`,
);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
