// #33 the profile badge's server-side floor — the "it only ever grows" regression drive, human-paced,
// over a REAL stack. Nothing is stubbed: discovery answers, the magic-link sign-in, the deck swipe and
// the tailor screen all run against the live Fastify API.
//
// The defect this pins: factCount = confirmed + negatives is RECOMPUTED on every read, and a claim
// rejected in the S2 review deck genuinely removes a confirmed claim — so the raw number really does
// fall. The client clamp in FactBadge is per-MOUNT, so a reload or a discovery<->tailor navigation
// re-seeds the badge from the server and shows the lower number. #33 adds a per-session fact_floor
// raised at all five factCount emission routes; this drive is the visitor-side proof.
//
// The reject is issued as an in-page fetch to /api/onboarding/claims/:id/reject — byte-identical to
// what apps/web/lib/api.ts rejectClaim() posts from the S2 deck (deck/[jobId]/page.tsx:95,125,469).
// Driving the deck UI itself needs an LLM-mined job, which needs a model key; the HTTP seam is the
// same one either way, and the deck UI is covered by apps/web/e2e/deck.spec.ts.
//
//   PORT=30181 node apps/api/dist/main.js
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
// `raw` is the count the badge WOULD read if #33's floor were reverted: with no bare "no" answered,
// factCount's raw value is exactly the confirmed discovery claims = cvLines minus the one role line.
const server = () =>
  page.evaluate(async () => {
    const d = await (await fetch('/api/onboarding/discovery')).json();
    const me = await (await fetch('/api/sessions/me')).json();
    return { factCount: d.factCount, raw: d.cvLines.length - 1, stage: d.stage, factFloor: me.factFloor,
             answered: d.cvLines.map((l) => l.itemId) };
  });

const seen = []; // every count the badge has shown, in order — the monotonicity record
async function readBadge(note) {
  const b = await badge();
  const s = await server();
  if (b) seen.push(b.count);
  await qa.expectVisible('a.prof', `${note} — badge reads ${b?.count} ("${b?.label}") · server factCount=${s.factCount} · raw-without-the-floor=${s.raw} · fact_floor=${s.factFloor}`);
  return { b, s };
}

// ---------------------------------------------------------------------------------------------
// 1. Build a real pile through the UI. Stop short of closing the essential band (3 items) so
//    /discovery stays a live screen — AC3's "navigating discovery <-> tailor" needs both ends.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'a brand-new visitor lands on discovery');
await assert((await page.locator('a.prof').count()) === 0, 'at 0 facts there is no badge at all (spec §6) — nothing to shrink yet');

await qa.fill(page.getByRole('textbox', { name: /What kind of job are you going for/ }), ROLE, 'type the role into Q1');
await qa.click(page.getByRole('button', { name: "That's me" }), "Q1: submit the role");
await page.waitForTimeout(1400);

for (let i = 0; i < 2; i++) {
  const opt = page.locator('.discovery .opts .opt').first();
  if (!(await opt.count())) break;
  const text = (await opt.textContent()).trim();
  await qa.click(opt, `answer a floor question: "${text}"`);
  await page.waitForTimeout(1800);
}
await qa.scrollThrough('read the CV growing under the answers');

const built = await readBadge('the pile the visitor built');
const peak = built.b.count;
await assert(peak >= 2, `the visitor reached a peak of ${peak} facts through the real UI`);
await assert(built.s.stage === 'discovery', `the essential band is still open (stage="${built.s.stage}") so /discovery stays a live screen`);

// ---------------------------------------------------------------------------------------------
// 2. Sign in (the #22 wall) — /tailor and the reject route are both post-wall.
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
await assert(afterSignin.b.count >= peak, `AC1: the sign-in merge did not lower the badge (${peak} -> ${afterSignin.b.count})`);

// ---------------------------------------------------------------------------------------------
// 3. THE DEFECT: reject a claim, exactly as the S2 review deck's "Remove this line" does.
// ---------------------------------------------------------------------------------------------
const target = built.s.answered.find((id) => id && id !== 'role');
await qa.note(`reject the claim behind "${target}" — the same POST /api/onboarding/claims/discovery-${target}/reject the S2 deck issues`);
const rejected = await page.evaluate(
  (id) => fetch(`/api/onboarding/claims/discovery-${id}/reject`, { method: 'POST' }).then((r) => r.status),
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
// 4. AC2 + AC3 — every way back in. Each is a FRESH MOUNT, which is exactly what the per-mount
//    client clamp could not protect.
// ---------------------------------------------------------------------------------------------
await qa.goto('/discovery', 'AC2: return to discovery after the reject');
await page.waitForTimeout(900);
const r1 = await readBadge('AC2: discovery after the reject');
await assert(r1.b.count >= peak, `AC2: the badge did not decrease on returning to discovery (${peak} -> ${r1.b.count})`);
await qa.scrollThrough('scroll the whole discovery screen — the rejected line is gone from the CV, the badge is not');

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
const r2 = await readBadge('AC3: a hard reload of discovery');
await assert(r2.b.count >= peak, `AC3: a hard reload did not drop the badge (${peak} -> ${r2.b.count})`);

// Into the deck and right into /tailor, through the real swipe.
await qa.goto('/deck', 'the reveal');
const seeThem = page.getByRole('button', { name: 'See them' });
if (await seeThem.count()) await qa.click(seeThem, 'See them');
await qa.click(page.getByRole('button', { name: 'I want this one, tailor this job' }), 'swipe right — tailor this job');
await page.waitForURL('**/tailor', { timeout: 15_000 });
await page.waitForTimeout(1200);
const t1 = await readBadge('AC2: the tailor screen after the reject');
await assert(t1.b.count >= peak, `AC2: the badge did not decrease on reaching tailor (${peak} -> ${t1.b.count})`);
await qa.scrollThrough('read the tailor screen with the badge in the topbar');

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1400);
const t2 = await readBadge('AC3: a hard reload of tailor');
await assert(t2.b.count >= peak, `AC3: a reload of tailor did not drop the badge (${peak} -> ${t2.b.count})`);

// AC3's explicit discovery <-> tailor round trip, twice, every leg a fresh mount.
for (let lap = 1; lap <= 2; lap++) {
  await qa.goto('/discovery', `AC3: lap ${lap} — navigate tailor -> discovery`);
  await page.waitForTimeout(1000);
  const d = await readBadge(`AC3: lap ${lap} on discovery`);
  await assert(d.b.count >= peak, `AC3: lap ${lap} discovery held the badge (${peak} -> ${d.b.count})`);

  await qa.goto('/tailor', `AC3: lap ${lap} — navigate discovery -> tailor`);
  await page.waitForTimeout(1200);
  const t = await readBadge(`AC3: lap ${lap} on tailor`);
  await assert(t.b.count >= peak, `AC3: lap ${lap} tailor held the badge (${peak} -> ${t.b.count})`);
}

// ---------------------------------------------------------------------------------------------
// 5. Keep going: the pile must still be able to GROW past the floor, and a second reject must
//    still not lower it. Note the honest cost of any floor (the same one #23's tailor % pays):
//    the first answer after a reject only refills the floor, so it shows no visible climb — the
//    badge holds rather than grows. It never SHRINKS, which is what #17/#33 forbid.
// ---------------------------------------------------------------------------------------------
let last = peak;
for (let i = 0; i < 2; i++) {
  const yes = page.getByRole('button', { name: 'Yes', exact: true });
  if (!(await yes.count())) break;
  await qa.click(yes, `answer tailor question ${i + 1} "Yes" — the pile must still be able to grow`);
  await page.waitForTimeout(1600);
  const grown = await readBadge(`the badge after tailor answer ${i + 1}`);
  await assert(grown.b.count >= last, `the badge never fell while answering (${last} -> ${grown.b.count})`);
  last = grown.b.count;
}
await assert(last > peak, `growth still works — the badge climbed past the floor it was holding (${peak} -> ${last})`);

{
  const second = (await server()).answered.find((id) => id && id !== 'role');
  if (second) {
    await page.evaluate((id) => fetch(`/api/onboarding/claims/discovery-${id}/reject`, { method: 'POST' }), second);
    await qa.goto('/tailor', 'reload tailor after a SECOND reject');
    await page.waitForTimeout(1200);
    const after2 = await readBadge('after a second reject');
    await assert(after2.b.count >= last, `a second reject still could not lower the badge (${last} -> ${after2.b.count})`);
  }
}

// ---------------------------------------------------------------------------------------------
// 6. AC1 — the whole sequence, in one verdict.
// ---------------------------------------------------------------------------------------------
const monotone = seen.every((v, i) => i === 0 || v >= seen[i - 1]);
await qa.note(`AC1: every count the badge showed, in order — ${seen.join(' -> ')}`);
await assert(monotone, `AC1: across every mount, reload and navigation the badge never read lower than before (${seen.join(' -> ')})`);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
