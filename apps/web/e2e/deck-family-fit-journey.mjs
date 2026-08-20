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
// #247/#63: the deck is fed by RETRIEVAL and nothing else now, so Phase B's servers must supply
// their adverts through the injected retrievePostings seam the way production gets them. These
// mirror apps/api/test/fixtureDeck.ts (which this .mjs cannot import — it is TS under test/),
// dist-edition; if that helper's shapes move, move these with it. One deliberate divergence: this
// retriever has no empty_pool branch — every pool here is non-empty by construction.
import { loadPostings } from "../../api/dist/preview.js";
import { lookupAdRequirements } from "../../api/dist/e5stub.js";
import { canonicalKeyOf } from "../../../packages/contracts/dist/index.js";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";
const FAMILY = "it-project-delivery"; // the one published production family (familyFloors.ts)
const OTHER_FAMILY = "construction-site-delivery"; // a family nothing in this product publishes

// ---- retrieval-shaped pools (#247) --------------------------------------------------------------
// A retrieved advert's id is `posting:<canonicalKey>` (a content hash), so nothing about an id is
// greppable any more — every population is tracked as an explicit id SET, never a name regex.
const HARNESS_PROVIDER_ID = "techmap"; // the one provider in the ACTIVE registry (fixtureDeck.ts)
const keyOf = (p) => canonicalKeyOf(p.company, p.location, p.title);
const postingV1 = (posting) => {
  const canonicalKey = keyOf(posting);
  const now = new Date().toISOString();
  return {
    schemaVersion: "4",
    id: `posting:${canonicalKey}`,
    canonicalKey,
    title: posting.title,
    company: posting.company,
    location: posting.location,
    sourceUrl: `https://example.test/${encodeURIComponent(posting.id)}`,
    excerpt: posting.excerpt,
    postedAt: null,
    capturedAt: now,
    verifiedLiveAt: now,
    expiresAt: null,
    attribution: [],
    sources: [{ providerId: HARNESS_PROVIDER_ID, providerPostingId: posting.id }],
    skills: posting.keywords,
    language: posting.language,
  };
};
const retriever = (rows) => async () => ({
  schemaVersion: "4",
  outcome: "relevant_postings",
  postings: rows,
  coverage: { providersQueried: [HARNESS_PROVIDER_ID], providersUnavailable: [], complete: true },
  retrievedAt: new Date().toISOString(),
});
/** A curated advert resolves to its hand-authored set (by canonical key — the fixture corpus is
 *  keyed by the old posting id, which retrieval never produces); null for everything else. */
const fixtureReadAd = (posting) => {
  const source = loadPostings().find((p) => `posting:${keyOf(p)}` === posting.id);
  if (!source) return null;
  const lookup = lookupAdRequirements(source.id);
  if (lookup.status !== "found") return null;
  return { ...lookup.requirements, adId: posting.id };
};
const synthetic = (n, company, title, excerpt) => ({
  id: `synthetic-${company.toLowerCase().replace(/\s+/g, "-")}-${n}`,
  company: `${company} ${n}`,
  title,
  location: "Hong Kong",
  excerpt,
  keywords: ["delivery"],
  language: "en",
});

const fixturePool = loadPostings().map(postingV1);
const curatedIds = new Set(fixturePool.map((r) => r.id));
const constructionRows = [1, 2, 3, 4, 5].map((n) =>
  postingV1(synthetic(n, "Groundworks Harbour", "Site Delivery Foreman", "Pour and supervise foundations on a live site.")),
);
// #247's fix, decided by the owner 2026-08-20 ("finish the harness"): the confidence pool is
// synthetic-only — no curated advert can reach :34109, so EVERY advert is reader-stamped with the
// same SCORING_REQS and the deck converges on one score. Confidence is then the only thing
// separating weak from strong, which is the exact claim #243's rule makes.
const weakRows = [1, 2, 3, 4].map((n) =>
  postingV1(synthetic(n, "Weak Signal Consulting", "IT Project Manager", "Deliver IT projects end to end.")),
);
const strongRows = [1, 2, 3, 4, 5, 6].map((n) =>
  postingV1(synthetic(n, "Strong Signal Partners", "IT Project Manager", "Deliver IT projects end to end.")),
);
const weakIds = new Set(weakRows.map((r) => r.id));

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
// facts (an all-null deck has no ranking to sink a card in - see the confidence server below).
//
// #216: these are ADVERT requirement ids this harness authors - not discovery floor ids - but they
// have to NAME what the visitor is actually asked, or nothing she confirms meets them and every
// card scores identically. They carried the retired stub's ids until the researched floor made the
// pairing dead: the confidence deck came back with four cards at 74% and no 100% cohort to rank
// them against. If the published floor's item ids change again, these follow.
const SCORING_REQS = [
  { id: "end-to-end-delivery", band: "essential", kind: "ordinary", requirement: "Own delivery end to end", sourceSpan: "delivery" },
  { id: "risk-dependency-control", band: "essential", kind: "ordinary", requirement: "Control risks and dependencies", sourceSpan: "risk" },
];

const HARNESS = [
  // her deck: the curated corpus PLUS five construction adverts only the reader knows
  {
    port: 34107,
    opts: {
      placeFamily: async () => confirmedPlacement(FAMILY),
      retrievePostings: retriever([...fixturePool, ...constructionRows]),
      readAd: async (p) => fixtureReadAd(p) ?? stampingReader(OTHER_FAMILY)(p),
    },
  },
  // the word-search deck: same pool, no family at all (buildServer's default placement is "unmapped")
  {
    port: 34108,
    opts: {
      retrievePostings: retriever([...fixturePool, ...constructionRows]),
      readAd: async (p) => fixtureReadAd(p) ?? stampingReader(OTHER_FAMILY)(p),
    },
  },
  // her deck again, synthetic-only pool, everything in HER family with one shared requirement set —
  // four adverts the reader is barely sure about
  {
    port: 34109,
    opts: {
      placeFamily: async () => confirmedPlacement(FAMILY),
      retrievePostings: retriever([...weakRows, ...strongRows]),
      readAd: stampingReader(FAMILY, (id) => (weakIds.has(id) ? 0.05 : 0.95), SCORING_REQS),
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

// #247 gate finding F-1: familyPlacement is a process-global counter (qa-main.ts) and in CI this
// journey runs late against one long-lived API, so the ARMED check asserts the DELTA this visitor
// causes. The placement call fires at discovery START (the seeding below), not at the deck build —
// so the baseline is read here, before any seeding.
const placementsBaseline = await page.evaluate(() =>
  fetch("/api/qa/llm-calls").then((r) => r.json()).then((c) => c.familyPlacement),
);

// Seed the visitor over the REAL API the page is already talking to: a target role (which is what
// the family labeler places, and therefore what arms the deck's family) and the essential band.
const seeded = await page.evaluate(async () => {
  const send = (url, method, body) =>
    fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.status);
  const codes = {};
  codes.intent = await send("/api/sessions/me/intent", "PUT", { targetRole: "IT project manager", searchArea: "Hong Kong" });
  codes.start = await send("/api/onboarding/discovery/start", "POST", { role: "IT project manager in Hong Kong" });
  // Arm the QA stack's three canned live-read adverts, so the deck holds adverts the READER
  // stamped, not only hand-authored fixtures.
  codes.stack = await send("/api/qa/stack", "POST", { languageAdverts: true });
  return codes;
});
// #216: the floor items are READ off the live state, never hard-coded - qa-driver's own note
// on seedFloorAnswers records what hard-coding them cost the last time.
// NOTE: SCORING_REQS above keeps its own ids on purpose - those are this harness's ADVERT
// requirement ids, which this journey authors itself. Only the DISCOVERY floor is read.
const seededItems = await qa.seedFloorAnswers({ yes: "Yes, over $1M across cross-functional teams" });
qa.note(`seeded over the real API — intent ${seeded.intent}, discovery start ${seeded.start}, floor answered: ${seededItems.join(", ") || "nothing"}, reader armed ${seeded.stack}`);

const shipped = await page.evaluate(async (placementsBefore) => {
  const before = (await fetch("/api/ops/counters").then((r) => r.json()))["deck.family_dropped"];
  // #63/#245: the cards route never blocks on provider latency — the first read reports
  // `searching: true` and the deck arrives on a later one, so wait it out.
  let deck = { cards: [] };
  for (let i = 0; i < 120; i += 1) {
    deck = await fetch("/api/onboarding/cards").then((r) => r.json());
    if (deck.searching !== true) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const after = await fetch("/api/ops/counters").then((r) => r.json());
  const placement = await fetch("/api/qa/llm-calls").then((r) => r.json());
  return { before, after: after["deck.family_dropped"], ids: (deck.cards ?? []).map((c) => c.adId), placements: placement.familyPlacement - placementsBefore };
}, placementsBaseline);
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

/** Mint a session on a harness origin, earn the deck the way a visitor does (#63: discovery
 *  started, the essential floor covered — an uncovered family session is refused cards outright),
 *  wait out `searching` (#245: the cards route never blocks on provider latency), then read the
 *  deck + the counter, all in the browser. */
const driveHarness = (port) =>
  page.evaluate(async (base) => {
    const json = { "content-type": "application/json" };
    await fetch(`${base}/sessions/anonymous`, { method: "POST", credentials: "include" });
    await fetch(`${base}/onboarding/discovery/start`, {
      method: "POST", headers: json, credentials: "include",
      body: JSON.stringify({ role: "IT project manager in Hong Kong" }),
    });
    // The floor items are READ off the live state, never hard-coded (#216).
    const state = await fetch(`${base}/onboarding/discovery`, { credentials: "include" }).then((r) => r.json());
    for (const q of (state.questions ?? []).filter((item) => !item.eligibility)) {
      await fetch(`${base}/onboarding/discovery/answer`, {
        method: "POST", headers: json, credentials: "include",
        body: JSON.stringify({ itemId: q.itemId, answer: "Yes, over $1M across cross-functional teams" }),
      });
    }
    const before = (await fetch(`${base}/ops/counters`).then((r) => r.json()))["deck.family_dropped"];
    let deck = { cards: [] };
    for (let i = 0; i < 120; i += 1) {
      deck = await fetch(`${base}/onboarding/cards`, { credentials: "include" }).then((r) => r.json());
      if (deck.searching !== true) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const after = (await fetch(`${base}/ops/counters`).then((r) => r.json()))["deck.family_dropped"];
    return { before, after, cards: (deck.cards ?? []).map((c) => ({ adId: c.adId, matchPct: c.matchPct })) };
  }, `http://127.0.0.1:${port}`);

await qa.goto(`http://127.0.0.1:34107/healthz`, "switch to the harness: the same Fastify app, serving a pool of construction adverts");
const herDeck = await driveHarness(34107);
qa.note(`her deck (family ${FAMILY} confirmed): ${herDeck.cards.length} card(s) · deck.family_dropped ${herDeck.before} → ${herDeck.after}`);
await qa.goto("http://127.0.0.1:34107/onboarding/cards", "read her deck straight off the API, in the browser");
await qa.expectText("pre", "Manulife", "her deck holds the IT project adverts");
await check(
  herDeck.cards.every((c) => curatedIds.has(c.adId)),
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
const confidenceDeck = (await driveHarness(34109)).cards.map((c, i) => ({ i, ...c }));

// #247 (owner decision 2026-08-20, "finish the harness"): every advert on this server is
// reader-stamped with ONE shared requirement set, so the deck must converge on ONE score — and the
// claim under test is an EQUALITY, not a magic number: a weak-confidence card sinks below every
// strong card while showing exactly the score the strong ones show. (The old `=== 100` literal was
// this same claim plus an accident of the retired stub's scoring; the equality is the product rule,
// #243 decision 2.)
const weakCards = confidenceDeck.filter((c) => weakIds.has(c.adId));
const strongCards = confidenceDeck.filter((c) => !weakIds.has(c.adId));
const scores = [...new Set(confidenceDeck.map((c) => c.matchPct))];
const lowestStrong = Math.max(...strongCards.map((c) => c.i));
qa.note(
  `confidence deck: ${confidenceDeck.length} card(s) all at ${scores.join("/")}% — ` +
    `${weakCards.length} weak sit at positions ${weakCards.map((c) => c.i).join(",")}, ` +
    `${strongCards.length} strong at ${strongCards.map((c) => c.i).join(",")}`,
);
await qa.goto("http://127.0.0.1:34109/onboarding/cards", "read the confidence deck off the API");
await check(
  scores.length === 1,
  `the harness proves what it claims now: with one shared requirement set, the deck converged on ONE score (${scores.join("/")}%) — confidence is the only thing left to separate the cards`,
);
await check(
  weakCards.length === weakRows.length && strongCards.length === strongRows.length && weakCards.every((c) => c.i > lowestStrong),
  `a weak family-fit confidence sinks the card: all ${weakCards.length} weak adverts sit LAST (positions ${weakCards.map((c) => c.i).join(",")}), below every strong card`,
);
await check(
  weakCards.every((c) => c.matchPct === strongCards[0]?.matchPct),
  `and sinks it WITHOUT touching its score: weak cards read ${weakCards.map((c) => `${c.matchPct}%`).join("/")}, identical to the strong cards' ${strongCards[0]?.matchPct}%`,
);

const ok = await qa.finish();
await Promise.all(servers.map((app) => app.close()));
process.exit(ok && failures === 0 ? 0 : 1);
