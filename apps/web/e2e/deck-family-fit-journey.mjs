// #243 — the advert's job family reaches the deck: identity decides deletion, confidence decides
// order. Driven as a human, screenshot-documented, left in the repo as a re-runnable CI asset (run
// with `node`, never the Playwright MCP).
//
// TWO STACKS, on purpose — and the second one is what makes this journey worth keeping:
//
//   Phase A — the shipped Tier 2 stack (web on BASE_URL, qa-main.js behind /api). This is the one
//     that catches the regression the ticket is really about: the ad reader and the deck used to
//     speak DIFFERENT family vocabularies ("IT Project Manager" the fixture floor name vs
//     `it-project-delivery` the published id), so the moment the deck starts comparing them, a
//     half-done re-pointing empties every deck in the product. Phase A proves the opposite: with the
//     family filter demonstrably ARMED (the labeler placed this visitor — /qa/llm-calls
//     familyPlacement > 0), the whole pool still arrives and nothing is dropped.
//
//   Phase B — three throwaway servers this file boots itself from apps/api/dist/server.js: the REAL
//     Fastify app, the REAL deck route, real HTTP in the same browser, with only the two seams
//     buildServer already exposes faked (readAd, placeFamily) — exactly the shape qa-main.ts and
//     apps/api/test/cards.test.ts use. It exists because the shipped corpus contains no advert of
//     ANOTHER family: every posting in sample-postings.json is IT project work, so the deletion this
//     ticket adds is unobservable on Phase A's stack by construction. Rather than assert nothing and
//     call it covered, Phase B serves a construction-stamped population at the reader seam and reads
//     the deletion back off /ops/counters as a number.
//
// Requires `pnpm --filter @jobcrush/api build` (Phase B imports apps/api/dist/server.js — the same
// build Tier 2 already needs for qa-main.js).
//
// Run:  BASE_URL=http://127.0.0.1:3000 node e2e/deck-family-fit-journey.mjs
import { createSession } from "./qa-driver.mjs";
import { buildServer } from "../../api/dist/server.js";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";
const FAMILY = "it-project-delivery"; // the one published production family (familyFloors.ts)
const OTHER_FAMILY = "construction-site-delivery"; // a family nothing in this product publishes

const confirmedPlacement = (familyId) => ({
  schemaVersion: "1",
  outcome: "confirmed",
  families: [{ familyId, version: 1 }],
  confidence: "certain",
});

/** A reader stamping every advert with no hand-authored fixture — the population whose family the
 *  deck must judge. `confidenceFor` lets one server serve two confidence classes at one matchPct. */
const stampingReader = (family, confidenceFor = () => 0.9, requirements) => async (posting) => ({
  schemaVersion: "1",
  adId: posting.id,
  curated: false,
  language: "en",
  familyFit: { family, confidence: confidenceFor(posting.id) },
  requirements: requirements ?? [
    { id: "pour-foundations", band: "essential", kind: "ordinary", requirement: "Pour foundations on a live site", sourceSpan: "foundations" },
  ],
});

// The two essential-band items the harness decks answer, so cards score against real confirmed
// facts (an all-null deck has no ranking to sink a card in — see the confidence server below).
const SCORING_REQS = [
  { id: "budget-accountability", band: "essential", kind: "ordinary", requirement: "Own a project budget", sourceSpan: "budget" },
  { id: "cross-functional-leadership", band: "essential", kind: "ordinary", requirement: "Lead cross-functional teams", sourceSpan: "teams" },
];

const WEAK = /bnp|mri|pwc/; // which adverts the confidence server calls itself unsure about

const HARNESS = [
  // her deck: family confirmed, every uncurated advert read as construction work
  { port: 34107, opts: { placeFamily: async () => confirmedPlacement(FAMILY), readAd: stampingReader(OTHER_FAMILY) } },
  // the word-search deck: no family at all (buildServer's default placement is "unmapped")
  { port: 34108, opts: { readAd: stampingReader(OTHER_FAMILY) } },
  // her deck again, everything in HER family — but four adverts the reader is barely sure about
  {
    port: 34109,
    opts: {
      placeFamily: async () => confirmedPlacement(FAMILY),
      readAd: stampingReader(FAMILY, (id) => (WEAK.test(id) ? 0.05 : 0.95), SCORING_REQS),
    },
  },
];

const servers = [];
for (const { port, opts } of HARNESS) {
  const built = buildServer(opts);
  await built.app.listen({ port, host: "127.0.0.1" });
  servers.push(built.app);
}

const qa = await createSession("deck-family-fit-journey", { baseURL: BASE_URL });
const { page } = qa;

let failures = 0;
/** Records the claim on the report with a highlighted screenshot of whatever is on screen — a
 *  failure is a real failed assertion (red step, non-zero exit), never a note nobody reads. */
async function check(ok, claim) {
  if (ok) return qa.expectVisible("body", `PASS — ${claim}`);
  failures += 1;
  return qa.expectVisible("#assertion-failed-see-note", `FAIL — ${claim}`);
}

// ---------------------------------------------------------------- Phase A: the shipped stack ----

await qa.goto("/discovery", "open the discovery screen — this mints the anonymous session");

// Seed the visitor over the REAL API the page is already talking to: a target role (which is what
// the family labeler places, and therefore what arms the deck's family) and the essential band.
const seeded = await page.evaluate(async () => {
  const send = (url, method, body) =>
    fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.status);
  const codes = {};
  codes.intent = await send("/api/sessions/me/intent", "PUT", { targetRole: "IT project manager", searchArea: "Hong Kong" });
  codes.start = await send("/api/onboarding/discovery/start", "POST", { role: "IT project manager in Hong Kong" });
  codes.a1 = await send("/api/onboarding/discovery/answer", "POST", { itemId: "budget-accountability", answer: "Yes, over $1M" });
  codes.a2 = await send("/api/onboarding/discovery/answer", "POST", { itemId: "cross-functional-leadership", answer: "Yes, multiple teams" });
  codes.a3 = await send("/api/onboarding/discovery/answer", "POST", { itemId: "stakeholder-reporting", answer: "Yes, to the board" });
  // Arm the QA stack's three canned live-read adverts, so the deck holds adverts the READER
  // stamped, not only hand-authored fixtures.
  codes.stack = await send("/api/qa/stack", "POST", { languageAdverts: true });
  return codes;
});
qa.note(`seeded over the real API — intent ${seeded.intent}, discovery start ${seeded.start}, answers ${seeded.a1}/${seeded.a2}/${seeded.a3}, reader armed ${seeded.stack}`);

const shipped = await page.evaluate(async () => {
  const before = (await fetch("/api/ops/counters").then((r) => r.json()))["deck.family_dropped"];
  const deck = await fetch("/api/onboarding/cards").then((r) => r.json());
  const after = await fetch("/api/ops/counters").then((r) => r.json());
  const placement = await fetch("/api/qa/llm-calls").then((r) => r.json());
  return { before, after: after["deck.family_dropped"], ids: deck.cards.map((c) => c.adId), placements: placement.familyPlacement };
});
qa.note(`deck: ${shipped.ids.length} card(s) · family placements made for this visitor: ${shipped.placements} · deck.family_dropped ${shipped.before} → ${shipped.after}`);

await check(shipped.placements > 0, `the family filter is ARMED on the shipped path — the labeler placed this visitor into a published family (${shipped.placements} placement call(s)), so the deck HAS a family to compare adverts against`);
await check(shipped.ids.length >= 11, `the curated pool survives the new filter: ${shipped.ids.length} cards reached the deck (8 hand-authored + 3 read live), not the empty deck a half-done vocabulary re-pointing would leave`);
await check(shipped.after === shipped.before, `nothing was deleted from this deck (deck.family_dropped stayed at ${shipped.after}) — every advert in the shipped corpus IS IT project work, so a deletion here would be the filter mis-firing`);

// Sign in (dev magic link) before the reveal: wanting a job requires an account (S2), and the wall
// stands between "See them" and the cards — this journey is about what is IN the deck, not the wall.
const signIn = await page.evaluate(async () => {
  const link = await fetch("/api/auth/request-link", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "deck-family-fit@example.com" }),
  }).then((r) => r.json());
  const token = new URL("http://x" + link.devLink).searchParams.get("token");
  return fetch("/api/auth/verify", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }),
  }).then((r) => r.status);
});
qa.note(`signed in over the real API — POST /auth/verify status: ${signIn}`);

await qa.goto("/deck", "walk to the deck the way she does");
// The reveal's headline paints after the deck fetch settles — wait for it rather than asserting
// into the gap, which is a flake, not a finding.
await page.getByRole("heading", { name: /matched you/ }).waitFor({ state: "visible", timeout: 30000 });
await qa.expectVisible(page.getByRole("heading", { name: /matched you/ }), "the reveal headline counts the matches she is about to see");
await qa.click(page.getByRole("button", { name: "See them" }), "press 'See them' — the deck opens on the best match");
// The deck mounts only after "See them" is pressed (the curtain), so wait for the first card to
// paint before reading it — same reason as the reveal headline above.
await page.locator(".jobcard h2").first().waitFor({ state: "visible", timeout: 30000 });
await qa.scrollThrough("read the top card top to bottom, as a person does");
await qa.expectVisible(page.locator(".jobcard h2").first(), "a real job card is on screen — the deck did not come back empty");

// ------------------------------------------------------------------- Phase B: the harness ------

/** Mint a session on a harness origin and read its deck + the counter, in the browser. */
const driveHarness = (port) =>
  page.evaluate(async (base) => {
    await fetch(`${base}/sessions/anonymous`, { method: "POST", credentials: "include" });
    const before = (await fetch(`${base}/ops/counters`).then((r) => r.json()))["deck.family_dropped"];
    const deck = await fetch(`${base}/onboarding/cards`, { credentials: "include" }).then((r) => r.json());
    const after = (await fetch(`${base}/ops/counters`).then((r) => r.json()))["deck.family_dropped"];
    return { before, after, cards: deck.cards.map((c) => ({ adId: c.adId, matchPct: c.matchPct })) };
  }, `http://127.0.0.1:${port}`);

const CURATED = /schneider|transunion|computershare|endava|hire-feed|manulife|synpulse|luvo/;

await qa.goto(`http://127.0.0.1:34107/healthz`, "switch to the harness: the same Fastify app, serving a pool of construction adverts");
const herDeck = await driveHarness(34107);
qa.note(`her deck (family ${FAMILY} confirmed): ${herDeck.cards.length} card(s) · deck.family_dropped ${herDeck.before} → ${herDeck.after}`);
await qa.goto("http://127.0.0.1:34107/onboarding/cards", "read her deck straight off the API, in the browser");
await qa.expectText("pre", "manulife", "her deck holds the IT project adverts");
await check(
  herDeck.cards.every((c) => CURATED.test(c.adId)),
  `every card left in her deck is IT project work — the ${herDeck.after - herDeck.before} construction adverts are GONE, not demoted (ids left: ${herDeck.cards.length})`,
);
await check(herDeck.after > herDeck.before, `the deletion is a number: deck.family_dropped rose by ${herDeck.after - herDeck.before}`);
// Read the counter off the page itself: loading /onboarding/cards above rebuilt her deck, so the
// live number is higher than the delta measured a moment ago — asserting the stale one would be
// asserting the journey's own arithmetic, not the server's.
await qa.goto("http://127.0.0.1:34107/ops/counters", "read the deletion counter off the ops endpoint");
const liveDropped = await page.evaluate(() => JSON.parse(document.body.innerText)["deck.family_dropped"]);
await qa.expectText("pre", `"deck.family_dropped":${liveDropped}`, `deck.family_dropped reads ${liveDropped} on /ops/counters — the deletion is visible to ops, not only inside the deck`);

await qa.goto("http://127.0.0.1:34108/healthz", "switch to the word-search deck — same adverts, no family confirmed");
const wordDeck = await driveHarness(34108);
qa.note(`word-search deck: ${wordDeck.cards.length} card(s) · deck.family_dropped ${wordDeck.before} → ${wordDeck.after}`);
await qa.goto("http://127.0.0.1:34108/onboarding/cards", "read the word-search deck off the API");
await qa.expectText("pre", "Pour foundations", "the construction adverts are still here — a deck with no family deletes nothing");
await check(
  wordDeck.cards.length > herDeck.cards.length && wordDeck.after === wordDeck.before,
  `a word-search deck is not filtered: ${wordDeck.cards.length} cards (vs ${herDeck.cards.length} on the family deck) and deck.family_dropped never moved`,
);

await qa.goto("http://127.0.0.1:34109/healthz", "switch to the confidence deck — every advert in HER family, four of them barely certain");
const confidenceDeck = await page.evaluate(async (base) => {
  await fetch(`${base}/sessions/anonymous`, { method: "POST", credentials: "include" });
  const json = { "content-type": "application/json" };
  await fetch(`${base}/onboarding/discovery/start`, { method: "POST", headers: json, credentials: "include", body: JSON.stringify({ role: "IT project manager in Hong Kong" }) });
  for (const [itemId, answer] of [
    ["budget-accountability", "Yes, over $1M"],
    ["cross-functional-leadership", "Yes, multiple teams"],
    ["stakeholder-reporting", "Yes, to the board"],
  ]) {
    await fetch(`${base}/onboarding/discovery/answer`, { method: "POST", headers: json, credentials: "include", body: JSON.stringify({ itemId, answer }) });
  }
  const deck = await fetch(`${base}/onboarding/cards`, { credentials: "include" }).then((r) => r.json());
  return deck.cards.map((c, i) => ({ i, adId: c.adId, matchPct: c.matchPct }));
}, "http://127.0.0.1:34109");

const weakCards = confidenceDeck.filter((c) => WEAK.test(c.adId));
const strongTop = confidenceDeck.filter((c) => !WEAK.test(c.adId) && c.matchPct === 100);
const lowestStrong = Math.max(...confidenceDeck.filter((c) => !WEAK.test(c.adId)).map((c) => c.i));
qa.note(
  `confidence deck: ${weakCards.length} weak card(s) at ${weakCards.map((c) => `${c.matchPct}%`).join("/")} sit at positions ${weakCards.map((c) => c.i).join(",")}; ` +
    `${strongTop.length} equally-100% confident card(s) at positions ${strongTop.map((c) => c.i).join(",")}`,
);
await qa.goto("http://127.0.0.1:34109/onboarding/cards", "read the confidence deck off the API");
await check(
  weakCards.length > 0 && weakCards.every((c) => c.i > lowestStrong) && weakCards.every((c) => c.matchPct === 100),
  `a weak family-fit confidence sinks the card without touching its score: the four 100%-match adverts the reader is unsure about sit LAST (positions ${weakCards.map((c) => c.i).join(",")}), below cards scoring as little as ${Math.min(...confidenceDeck.filter((c) => !WEAK.test(c.adId)).map((c) => c.matchPct))}%, and still display 100%`,
);

const ok = await qa.finish();
await Promise.all(servers.map((app) => app.close()));
process.exit(ok && failures === 0 ? 0 : 1);
