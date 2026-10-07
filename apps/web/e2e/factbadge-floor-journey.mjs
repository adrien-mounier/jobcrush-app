// #33 the profile badge's server-side floor — the "it only ever grows" regression drive, human-paced,
// over a REAL stack. Nothing is stubbed: discovery, the magic-link sign-in, the deck swipe and the
// tailor screen all run against the live Fastify API.
//
// The defect this pins: factCount = confirmed + negatives is RECOMPUTED on every read, and a claim
// rejected in the S2 review deck genuinely removes a confirmed claim — so the raw number really does
// fall. The client clamp in FactBadge is per-MOUNT, so a reload or a discovery<->tailor navigation
// re-seeds the badge from the server and shows the lower number. #33 adds a per-session fact_floor
// raised at all five factCount emission routes; this drive is the visitor-side proof.
//
// #339: discovery no longer asks the floor, so the pile is built where facts now come from: her CV
// (read, then confirmed by completing "Your CV, reviewed") and, for the growth half, the tailor
// step's own questions. The claims rejected are lines her CV gave her. (Not a tailor fact: its id
// carries the advert's 64-character hash, and the reject route answers 414 for an id that long —
// Fastify's default 100-character limit on a URL parameter. Nothing in the product rejects a
// tailor fact through that route today, so this drive does not either.)
//
// The reject is issued as an in-page fetch to /api/onboarding/claims/:id/reject — byte-identical to
// what apps/web/lib/api.ts rejectClaim() posts from the S2 deck. Driving the deck UI itself needs an
// LLM-mined job, which needs a model key; the HTTP seam is the same one either way, and the deck UI
// is covered by apps/web/e2e/deck.spec.ts.
//
//   OPS_KEY=qa-ops-key PORT=30181 node apps/api/dist/qa-main.js
//   cd apps/web && rm -rf .next && API_URL=http://127.0.0.1:30181 npx next build && npx next start -p 30180
//   BASE_URL=http://127.0.0.1:30180 node apps/web/e2e/factbadge-floor-journey.mjs
//
// Ports are deliberately not 3000/3001 — another project on this machine defaults to those and the
// /api proxy would silently reach the wrong backend. API_URL is baked at `next build` time and turbo
// does not hash it, so build apps/web directly after removing .next.

import { createSession } from './qa-driver.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:30180';
const ROLE = 'IT project manager in Paris';
const EMAIL = `factfloor-${Date.now()}@example.com`;

const qa = await createSession('factbadge-floor-journey', { baseURL: BASE, viewport: { width: 430, height: 932 } });
const { page } = qa;

// '' is always contained (pass); the sentinel never is (fail). Records a verdict without aborting,
// so one defect never costs us the evidence for every later step.
const assert = (cond, note) => qa.expectText('body', cond ? '' : ' -IMPOSSIBLE-', note);

// The badge exactly as a visitor reads it.
const badge = () =>
  page.evaluate(() => {
    const el = document.querySelector('a.prof');
    if (!el) return null;
    return {
      count: Number(el.querySelector('.n')?.textContent ?? '0'),
      unit: el.querySelector('.unit')?.textContent ?? '',
      label: el.getAttribute('aria-label'),
    };
  });

// The server's own numbers, read in-page so the httpOnly session cookie rides along.
// `raw` is the count the badge WOULD read if #33's floor were reverted: this visitor says no "No",
// so it is exactly the facts her profile lists (GET /profile excludes rejected and negative claims).
// `cvFacts` are the lines her CV gave her — the ones the S2 deck's "Remove this line" can reject.
const server = () =>
  page.evaluate(async () => {
    const d = await (await fetch('/api/onboarding/discovery')).json();
    const me = await (await fetch('/api/sessions/me')).json();
    const p = await (await fetch('/api/profile')).json();
    const facts = (p.domains ?? []).flatMap((x) => x.facts).filter((f) => !f.answerOnly);
    return {
      factCount: d.factCount,
      raw: facts.length,
      factFloor: me.factFloor,
      cvFacts: facts.filter((f) => f.source === 'read').map((f) => f.id),
    };
  });

const seen = []; // every count the badge has shown, in order — the monotonicity record
async function readBadge(note) {
  const b = await badge();
  const s = await server();
  if (b) seen.push(b.count);
  await qa.expectVisible('a.prof', `${note} — badge reads ${b?.count} ("${b?.label}") · server factCount=${s.factCount} · raw-without-the-floor=${s.raw} · fact_floor=${s.factFloor}`);
  return { b, s };
}

// Answer the tailor question on screen with "Yes". Returns false when no question is left. A
// profile-level question (a language ladder, when the QA stack's language adverts are armed) has no
// "Yes" and adds no counted fact, so it is put off with "Not now" first.
async function answerTailorYes(note) {
  const yes = page.getByRole('button', { name: 'Yes', exact: true });
  for (let i = 0; i < 3 && !(await yes.count()); i++) {
    const notNow = page.getByRole('button', { name: 'Not now', exact: true });
    if (!(await notNow.count())) break;
    await qa.click(notNow.first(), 'a profile-level question — "Not now", it adds no counted fact');
    await page.waitForTimeout(1200);
  }
  if (!(await yes.count())) return false;
  await qa.click(yes.first(), note);
  await page.waitForTimeout(1600);
  return true;
}

// ---------------------------------------------------------------------------------------------
// 1. A new visitor: question 1, and no facts yet.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'a brand-new visitor lands on discovery');
await assert((await page.locator('a.prof').count()) === 0, 'at 0 facts there is no badge at all (spec §6) — nothing to shrink yet');

await qa.fill(page.getByRole('textbox', { name: /What kind of job are you going for/ }), ROLE, 'type the role into Q1');
await qa.click(page.getByRole('button', { name: "That's me" }), "Q1: submit the role");
await page.waitForTimeout(1400);
await assert((await page.locator('a.prof').count()) === 0, '#339: question 1 and the eligibility questions add no fact — still no badge');

// ---------------------------------------------------------------------------------------------
// 2. Build a real pile: her CV is read and she confirms "Your CV, reviewed" — every line it read
//    becomes a fact she vouches for.
// ---------------------------------------------------------------------------------------------
const fromCv = await qa.factsFromCv();
await qa.note(`her CV was read and her review confirmed — the server now counts ${fromCv} facts`);
await qa.goto('/discovery', 'back to discovery — the badge picks up the pile');
await page.waitForTimeout(1200);
await qa.scrollThrough('read discovery with the badge in the topbar');

const built = await readBadge('the pile the visitor built');
const peak = built.b?.count ?? 0;
await assert(peak >= 2, `the visitor reached a peak of ${peak} facts through the real product`);

// ---------------------------------------------------------------------------------------------
// 3. Sign in (the #22 wall) — /tailor and the reject route are both post-wall.
//    The floor must survive the JC-19 merge: signing in must never make the badge fall.
// ---------------------------------------------------------------------------------------------
await qa.note('sign in over the real magic-link path — the JC-19 merge claims this same session row');
const signin = await page.evaluate(async (email) => {
  const post = (url, body) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const res = await post('/api/auth/request-link', { email });
  const link = await res.json();
  // /auth/request-link is rate-limited per IP; a 429 silently leaves the session anonymous and every
  // later step fails confusingly, so surface it as itself.
  if (!link.devLink) return `sign-in failed (${res.status}): ${JSON.stringify(link)}`;
  const token = new URL('http://x' + link.devLink).searchParams.get('token');
  const v = await post('/api/auth/verify', { token });
  return v.status === 200 ? 'ok' : `verify failed (${v.status})`;
}, EMAIL);
if (signin !== 'ok') throw new Error(`could not sign in: ${signin}`);

await qa.goto('/discovery', 'back to discovery, now signed in');
const afterSignin = await readBadge('AC1: after the sign-in merge');
await assert(afterSignin.b?.count >= peak, `AC1: the sign-in merge did not lower the badge (${peak} -> ${afterSignin.b?.count})`);

// ---------------------------------------------------------------------------------------------
// 4. THE DEFECT: reject a claim, exactly as the S2 review deck's "Remove this line" does.
// ---------------------------------------------------------------------------------------------
const target = built.s.cvFacts[0];
await qa.note(`reject the claim "${target}" — the same POST /api/onboarding/claims/${target}/reject the S2 deck issues`);
const rejected = await page.evaluate(
  (id) => fetch(`/api/onboarding/claims/${encodeURIComponent(id)}/reject`, { method: 'POST' }).then((r) => r.status),
  target,
);
const afterReject = await server();
await assert(rejected === 200, `the reject was accepted (status ${rejected})`);
await assert(
  afterReject.raw === built.s.raw - 1,
  `the reject GENUINELY shrank the underlying fact set (raw ${built.s.raw} -> ${afterReject.raw}) — ` +
    `without #33 the badge would now read ${afterReject.raw} instead of ${peak}. This drive is not passing for free.`,
);

// ---------------------------------------------------------------------------------------------
// 5. AC2 + AC3 — every way back in. Each is a FRESH MOUNT, which is exactly what the per-mount
//    client clamp could not protect.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'AC2: return to discovery after the reject');
await page.waitForTimeout(900);
const r1 = await readBadge('AC2: discovery after the reject');
await assert(r1.b?.count >= peak, `AC2: the badge did not decrease on returning to discovery (${peak} -> ${r1.b?.count})`);

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
const r2 = await readBadge('AC3: a hard reload of discovery');
await assert(r2.b?.count >= peak, `AC3: a hard reload did not drop the badge (${peak} -> ${r2.b?.count})`);

// Into the deck and right into /tailor, through the real swipe.
await qa.goto('/deck', 'the reveal');
const seeThem = page.getByRole('button', { name: 'See them' });
await seeThem.or(page.locator('.jobcard')).first().waitFor({ state: 'visible', timeout: 30000 });
if (await seeThem.count()) await qa.click(seeThem, 'See them');
await qa.click(page.getByRole('button', { name: 'I want this one, tailor this job' }), 'swipe right — tailor this job');
await page.waitForURL('**/tailor', { timeout: 15_000 });
await page.waitForTimeout(1200);
const t1 = await readBadge('AC2: the tailor screen after the reject');
await assert(t1.b?.count >= peak, `AC2: the badge did not decrease on reaching tailor (${peak} -> ${t1.b?.count})`);
await qa.scrollThrough('read the tailor screen with the badge in the topbar');

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1400);
const t2 = await readBadge('AC3: a hard reload of tailor');
await assert(t2.b?.count >= peak, `AC3: a reload of tailor did not drop the badge (${peak} -> ${t2.b?.count})`);

// AC3's explicit discovery <-> tailor round trip, twice, every leg a fresh mount.
for (let lap = 1; lap <= 2; lap++) {
  await qa.goto('/tailor', `AC3: lap ${lap} — navigate discovery -> tailor`);
  await page.waitForTimeout(1200);
  const t = await readBadge(`AC3: lap ${lap} on tailor`);
  await assert(t.b?.count >= peak, `AC3: lap ${lap} tailor held the badge (${peak} -> ${t.b?.count})`);

  await qa.goto('/discovery', `AC3: lap ${lap} — navigate tailor -> discovery`);
  await page.waitForTimeout(1000);
  const d = await readBadge(`AC3: lap ${lap} on discovery`);
  await assert(d.b?.count >= peak, `AC3: lap ${lap} discovery held the badge (${peak} -> ${d.b?.count})`);
}

// ---------------------------------------------------------------------------------------------
// 6. Keep going: the pile must still be able to GROW past the floor, and a second reject must
//    still not lower it. Note the honest cost of any floor (the same one #23's tailor % pays):
//    the first answer after a reject only refills the floor, so it shows no visible climb — the
//    badge holds rather than grows. It never SHRINKS, which is what #17/#33 forbid.
// ---------------------------------------------------------------------------------------------
await qa.goto('/tailor', 'back to tailoring to keep answering');
await page.waitForTimeout(1200);
let last = peak;
for (let i = 0; i < 2; i++) {
  if (!(await answerTailorYes(`answer tailor question ${i + 1} "Yes" — the pile must still be able to grow`))) break;
  const grown = await readBadge(`the badge after tailor answer ${i + 1}`);
  await assert(grown.b?.count >= last, `the badge never fell while answering (${last} -> ${grown.b?.count})`);
  last = grown.b?.count ?? last;
}
await assert(last > peak, `growth still works — the badge climbed past the floor it was holding (${peak} -> ${last})`);

{
  const second = (await server()).cvFacts[0];
  if (second) {
    await page.evaluate((id) => fetch(`/api/onboarding/claims/${encodeURIComponent(id)}/reject`, { method: 'POST' }), second);
    // Read on discovery: a reject moves the search her tailored job came from, so /tailor would
    // (rightly, #63) send her back to the deck, which carries no badge.
    await qa.goto('/discovery', 'a fresh mount of discovery after a SECOND reject');
    await page.waitForTimeout(1200);
    const after2 = await readBadge('after a second reject');
    await assert(after2.b?.count >= last, `a second reject still could not lower the badge (${last} -> ${after2.b?.count})`);
  }
}

// ---------------------------------------------------------------------------------------------
// 7. AC1 — the whole sequence, in one verdict.
// ---------------------------------------------------------------------------------------------
const monotone = seen.every((v, i) => i === 0 || v >= seen[i - 1]);
await qa.note(`AC1: every count the badge showed, in order — ${seen.join(' -> ')}`);
await assert(monotone, `AC1: across every mount, reload and navigation the badge never read lower than before (${seen.join(' -> ')})`);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
