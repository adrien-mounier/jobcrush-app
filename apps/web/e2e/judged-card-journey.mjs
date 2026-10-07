// #105 (E5 slice 4) — meaning-aware judging, driven as a human: land → discovery → the deck reveal
// → open a job → tailor → answer a question → watch the number and the "not yet" list respond.
//
// Human-paced, screenshot-documented, left in the repo as a re-runnable CI asset (run with `node`,
// never the Playwright MCP). Companion to apps/api/test/judgeCards.test.ts, which pins the same
// behaviour at the API seam with a scripted fake judge; this one proves the assembled product in a
// real browser against whatever judge the running API actually has wired.
//
// ADAPTIVE BY DESIGN, and it reports WHICH mode it ran in — that distinction is the whole point.
// /ops/counters is read before and after the deck loads, so the report states, as measured fact:
//   - judge.judged_succeeded rose  → cards carry MEANING-AWARE numbers (judging was live).
//   - judge.fallback_used rose     → those cards fell back to the deterministic token-overlap tick.
//     The card still renders and is still usable (that is a required property, #105 decision 6),
//     but its number is NOT a judged one, and the report must not claim otherwise.
//   - neither moved               → no judge is wired at all (no ANTHROPIC_API_KEY / no CLI):
//     today's pre-#105 behaviour, which #105 must not regress. Asserted, then the flow stops.
//
// Run:  BASE_URL=http://127.0.0.1:3460 node e2e/judged-card-journey.mjs
import { createSession } from "./qa-driver.mjs";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";
const ROLE = "IT project manager in Paris";

const qa = await createSession("judged-card-journey", { baseURL: BASE_URL });
const { page } = qa;

// A cold deck fans out one model call per card behind a 15s-per-card deadline, so a real load can sit
// on "Lining up your jobs…" for the better part of a minute — far past the driver's 8s assertion
// timeout. Wait for the screen to actually arrive before asserting anything about it, or every
// assertion fails on the spinner and the report blames the app for the driver's impatience.
const SETTLE_MS = 180_000;
const settle = (loc, what) =>
  loc.waitFor({ state: "visible", timeout: SETTLE_MS }).then(
    () => qa.note(`${what} arrived`),
    () => qa.note(`${what} did NOT arrive within ${SETTLE_MS / 1000}s`),
  );

const counters = () => page.evaluate(() => fetch("/api/ops/counters").then((r) => r.json()));
const judgeDelta = (before, after) =>
  Object.fromEntries(
    Object.keys(after)
      .filter((k) => k.startsWith("judge."))
      .map((k) => [k, (after[k] ?? 0) - (before[k] ?? 0)])
      .filter(([, v]) => v !== 0),
  );

// 1) Land, start discovery, and bring a CV over the real API — the deck must score against genuine
//    confirmed facts, not an empty profile (with no facts at all judge.ts short-circuits the model
//    call entirely and every requirement honestly grades 0, which proves nothing here). #339: the
//    floor answers that used to supply those facts are gone; a read, reviewed CV supplies them now.
await qa.goto("/discovery", "land on discovery — the anonymous session is created here");
await qa.scrollThrough("read the discovery screen the way a first-time visitor does");

const seed = await page.evaluate(async (role) => {
  const post = (url, body) =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.status);
  const codes = [];
  codes.push(await post("/api/onboarding/discovery/start", { role }));
  return codes;
}, ROLE);
const facts = await qa.factsFromCv();
qa.note(`seeded over the real API — discovery start ${seed.join(", ")}, her CV read and reviewed: ${facts} facts`);

// 2) Sign in (magic-link dev token): wanting a job is post-wall (S2), and this journey ends in the
//    tailor.
const signIn = await page.evaluate(async () => {
  const link = await fetch("/api/auth/request-link", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `judged-journey-${Date.now()}@example.com` }),
  }).then((r) => r.json());
  const token = new URL("http://x" + link.devLink).searchParams.get("token");
  return fetch("/api/auth/verify", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  }).then((r) => r.status);
});
qa.note(`signed in over the real API — POST /auth/verify status: ${signIn}`);

// 3) Load the deck, with the judging counters bracketed around it. This is the measurement that
//    decides what the rest of this report is allowed to claim.
// A cold deck can outrun the web app's own /api/* proxy deadline (~30s) and come back as a 500 —
// the visitor sees "Couldn't line up your jobs." and presses Try again. Retry the way they would.
// This is not papering over a failure: it is the failure, recorded, and the retry is the recovery a
// real person performs. Every attempt's status and timing is in the report.
const before = await counters();
const attempts = [];
let deck = null;
for (let attempt = 1; attempt <= 3 && !deck; attempt++) {
  const got = await page.evaluate(async () => {
    const t0 = Date.now();
    const res = await fetch("/api/onboarding/cards").catch((e) => ({ ok: false, status: 0, err: String(e) }));
    const ms = Date.now() - t0;
    if (!res.ok) return { ok: false, ms, status: res.status ?? 0 };
    const body = await res.json();
    return {
      ok: true, ms, count: body.cards.length,
      ids: body.cards.map((c) => c.adId),
      titles: body.cards.map((c) => c.title),
      pcts: body.cards.map((c) => c.matchPct),
      openCounts: body.cards.map((c) => c.dontYet.length),
    };
  });
  attempts.push(`attempt ${attempt}: HTTP ${got.ok ? 200 : got.status} in ${(got.ms / 1000).toFixed(1)}s`);
  if (got.ok) deck = got;
}
qa.note(`deck load attempts — ${attempts.join(" · ")}`);
if (!deck) {
  await qa.note("the deck never returned a 200 — the journey cannot continue past the reveal.");
  await qa.expectVisible("#deck-never-loaded", "the deck must return a 200 within three attempts");
  const okDead = await qa.finish();
  process.exit(okDead ? 0 : 1);
}
const after = await counters();
const delta = judgeDelta(before, after);

// A judge that IS wired but whose every card came from the persisted store moves NO counter at all —
// a cache hit is deliberately not counted as a success. So the DELTA alone cannot tell "no judge
// wired" from "everything already judged", and reading it that way reports the safest-sounding
// answer rather than the true one. The CUMULATIVE counters settle it: they only ever leave zero if
// a judge has actually been asked to do something since the API booted.
const wiredEver = (after["judge.judged_succeeded"] ?? 0) + (after["judge.fallback_used"] ?? 0) > 0;
const judged = (delta["judge.judged_succeeded"] ?? 0) > 0;
const fellBack = (delta["judge.fallback_used"] ?? 0) > 0;
const noJudge = !wiredEver;
const servedFromStore = wiredEver && !judged && !fellBack;

qa.note(`GET /onboarding/cards → ${deck.count} card(s) in ${deck.ms}ms. match %: ${deck.pcts.join(", ")}`);
qa.note(`judging counters moved: ${JSON.stringify(delta)}`);
// The arithmetic that actually names each card's provenance. A store hit moves NO counter, so it can
// only be found by subtraction — without this line a deck that is mostly judged reads as "wholesale
// fallback" purely because nothing was freshly judged, which understates the truth as badly as
// overstating it would.
const freshlyJudged = delta["judge.judged_succeeded"] ?? 0;
const fellBackN = delta["judge.fallback_used"] ?? 0;
const fromStore = deck.count - freshlyJudged - fellBackN;
qa.note(
  `card provenance for this deck of ${deck.count}: ${fromStore} replayed from the judgement store (judged, no model call), ` +
    `${freshlyJudged} judged fresh in time, ${fellBackN} fell back to the deterministic token-overlap tick. ` +
    `Only the last group's numbers are NOT meaning-aware.`,
);
qa.note(
  noJudge
    ? "MODE: no judge wired — these are the deterministic token-overlap numbers (pre-#105 behaviour, which must not regress)."
    : servedFromStore
      ? "MODE: served ENTIRELY from the judgement store — every number here is a previously-judged, meaning-aware number, replayed with no model call and no possibility of drift. This is the steady state #105 is built for."
      : !fellBack
        ? "MODE: every card meaning-aware — judged fresh or replayed from the store, nothing fell back."
        : `MODE: MIXED — ${delta["judge.fallback_used"]} of ${deck.count} card(s) fell back to the deterministic token-overlap tick (${delta["judge.fallback_timeout"] ?? 0} on the 15s deadline); the rest carry judged numbers. Read the provenance line below rather than this label — a store hit moves no counter, so "nothing was freshly judged" never means "nothing was judged".`,
);

// 4) The reveal, then the deck — read the top card the way a person does.
//
// NOTE this is the SECOND time the deck is built for this session; step 3 already asked for it over
// the wire. Nothing about the visitor changed in between, so every number here must match step 3's
// exactly. Where it doesn't, the difference is recorded below — a number that moved while the
// visitor did nothing is the single failure #105 exists to make impossible.
await qa.goto("/deck", "open the reveal");
// Same recovery on the UI's own load: if the deck screen errored, press Try again like a person.
if (await page.getByRole("button", { name: "Try again" }).isVisible().catch(() => false)) {
  await qa.click(page.getByRole("button", { name: "Try again" }), "the deck failed to load — press 'Try again', as a visitor would");
}
await settle(page.getByRole("heading", { name: /matched you/ }), "the reveal");
await qa.expectVisible(page.getByRole("heading", { name: /matched you/ }), "the reveal headline counts the matches");

const deck2 = await page.evaluate(async () => {
  const body = await fetch("/api/onboarding/cards").then((r) => r.json());
  return { ids: body.cards.map((c) => c.adId), pcts: body.cards.map((c) => c.matchPct) };
});
const moved = deck2.ids
  .map((id, i) => {
    const was = deck.ids.indexOf(id);
    return was === -1 ? `${id}: NEW (${deck2.pcts[i]}%)` : deck.pcts[was] !== deck2.pcts[i] ? `${id}: ${deck.pcts[was]}% → ${deck2.pcts[i]}%` : null;
  })
  .filter(Boolean);
qa.note(
  moved.length === 0
    ? `the number held on every card across two views with nothing changed (${deck2.pcts.join(", ")})`
    : `NUMBERS MOVED with the visitor unchanged — ${moved.length} card(s): ${moved.join(" · ")}`,
);
await qa.click(page.getByRole("button", { name: "See them" }), "press 'See them' — the deck opens on the best match");
await qa.scrollThrough("read the top card top to bottom");
await qa.expectVisible(page.locator(".jobcard h2").first(), "the card leads with the job title");
await qa.expectVisible(page.locator(".jobcard .score"), "the card carries a number");
await qa.expectVisible(page.locator(".bubble"), "one sentence explains the number — never a bare percentage");
await qa.expectVisible(page.getByRole("heading", { name: "Where you don't — yet" }), "the honest 'not yet' list is on the card");

// 5) Choose the top job and land in the tailor.
const topTitle = deck.titles[0];
await qa.click(
  page.getByRole("button", { name: "I want this one, tailor this job" }),
  `choose "${topTitle}" — the best-scoring job on the deck`,
);
await settle(page.locator(".tailor .q"), "the tailor's first question");
await qa.expectVisible(page.locator(".tailor .q"), "the tailor asks its first question, drawn from this advert's own requirements");
await qa.scrollThrough("read the tailor screen — the same card, the same number, the same open list");

const stateBefore = await page.evaluate(() => fetch("/api/onboarding/tailor").then((r) => r.json()));
qa.note(
  `tailoring ${stateBefore.card.adId} — number ${stateBefore.card.matchPct}%, ` +
    `${stateBefore.card.dontYet.length} still open, ${stateBefore.questions.length} question(s) queued`,
);
// #105 AC, on the TAILOR surface as well as the deck: an explicit negative is answered-and-closed,
// never an open gap. Recorded before the answer so the after-state below can be compared to it.
const openBefore = stateBefore.card.dontYet.map((r) => r.id);
const askedClosedBefore = stateBefore.card.askedClosed.length;

// 6) Answer a question — the moment the number and the "not yet" list are supposed to respond.
const firstQuestion = stateBefore.questions[0];
if (!firstQuestion) {
  await qa.note("no tailor question queued — nothing left open on this card, so there is no answer to drive.");
  const okEarly = await qa.finish();
  process.exit(okEarly ? 0 : 1);
}
qa.note(`about to answer: "${firstQuestion.question}" (requirement ${firstQuestion.requirementId})`);

// Tap the LAST option — by convention the "No" on these generated questions. A "No" is the sharper
// test of the two: it must close the gap (it leaves the open list) without ever moving the number,
// and it must never buy a second model call, because the confirmed fact set did not change.
const options = page.locator(".tailor .opts .opt");
const optionCount = await options.count();
await qa.click(options.nth(optionCount - 1), `tap the last option — the explicit "no" on this requirement`);
// The answer changes the confirmed fact set, so this ad is re-judged from cold behind the same 15s
// deadline — give it room rather than reading a half-settled screen.
await page.waitForTimeout(20_000);

const afterCounters = await counters();
const stateAfter = await page.evaluate(() => fetch("/api/onboarding/tailor").then((r) => r.json()));
const openAfter = stateAfter.card.dontYet.map((r) => r.id);

qa.note(
  `after the answer — number ${stateBefore.card.matchPct}% → ${stateAfter.card.matchPct}%, ` +
    `open list ${openBefore.length} → ${openAfter.length}, ` +
    `answered-and-closed ${askedClosedBefore} → ${stateAfter.card.askedClosed.length}`,
);
qa.note(`judging counters across the answer: ${JSON.stringify(judgeDelta(after, afterCounters))}`);

await qa.scrollThrough("read the card again — the answered requirement should have left the open list");

// The requirement just answered must NOT still be sitting in the open list — spec #37, "the list of
// open things only ever shrinks". This is the assertion that holds on BOTH surfaces.
if (openAfter.includes(firstQuestion.requirementId)) {
  qa.note(`FAIL: "${firstQuestion.requirementId}" was answered but is still listed as an open gap.`);
  await qa.expectVisible("#answered-requirement-still-open", "an answered requirement must never remain an open gap");
} else {
  qa.note(`"${firstQuestion.requirementId}" left the open list once answered — answered-and-closed, never an open gap.`);
}
await qa.expectVisible(page.locator(".tailor .score"), "the number is still on screen and still explained after the answer");

// 7) The number must never contradict the list it is shown beside.
if (stateAfter.card.matchPct === 100 && openAfter.length > 0) {
  qa.note(`FAIL: the card reads 100% while still listing ${openAfter.length} open requirement(s).`);
  await qa.expectVisible("#hundred-percent-with-open-gaps", "a card must never read 100% while listing a gap");
}

await qa.note(
  noJudge
    ? "Journey drove end to end, but with NO judge wired — the numbers seen here are the old deterministic tick, not judged numbers. #105's judging path was not exercised live by this run."
    : servedFromStore
      ? "Journey drove end to end on judged numbers replayed from the store — meaning-aware numbers reached the screen, and no model was asked anything."
      : fellBack && !judged
      ? "Journey drove end to end, but judging fell back WHOLESALE to the deterministic tick — the numbers seen here are NOT judged numbers. #105's judging path was not exercised live by this run."
      : "Journey drove end to end with judging live — the numbers seen here are meaning-aware.",
);

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
