// #104 (E5 slice 3) — the tracer bullet, driven as a human: an advert nobody hand-wrote a
// requirement list for becomes a card in the deck that can be read, chosen, and tailored.
//
// Human-paced, screenshot-documented, left in the repo as a re-runnable CI asset (run with `node`,
// never the Playwright MCP). Companion to apps/api/test/cards.test.ts's #104 HTTP tests: those pin
// the contract at the API seam, this one proves the assembled product in a real browser.
//
// ADAPTIVE BY DESIGN. The deck's size depends on whether an ad reader is wired into the API:
//   - reader wired (ANTHROPIC_API_KEY, or a JOBCRUSH_CLAUDE stand-in): 15 cards — 8 from
//     hand-authored fixtures + 7 read live from adverts nobody curated. Full journey drives.
//   - no reader: 8 cards, fixture-only — today's pre-#104 behaviour, which #104 must not regress.
// Both are asserted; the flow fails if the deck is neither shape, or if a newly-read card renders
// but cannot be chosen and tailored.
//
// The two adverts deliberately held back in BOTH modes (never 16): the Chinese posting
// `…huaxin-tech-shenzhen…` (held at ingest by #103's language gate) and `…hays…`, an English
// posting whose hand-authored requirement set is declared Chinese — reading it live anyway would
// regress that shipped safety rule to make a demo number match.
//
// Run:  BASE_URL=http://127.0.0.1:3458 node e2e/uncurated-advert-journey.mjs
import { createSession } from "./qa-driver.mjs";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";
const ROLE = "IT project manager in Paris";

// Postings with NO hand-authored requirement set — the population #104 makes readable. Ids, not
// titles: titles are not unique in this pool (see the adId note below).
const UNCURATED_AD_IDS = [
  "2026-07-05_okx_senior-strategy-project-manager-vip-institutions",
  "2026-07-09_bnp-paribas_project-manager-lead-business-analyst-regulatory-reporting",
  "2026-07-09_charterhouse-partnership-asia_senior-business-analyst-product-manager-1-year-contract",
  "2026-07-09_mri-software_project-manager-iii",
  "2026-07-09_pwc-australia_project-manager-client-onboarding-risk-assessment-uplift",
  "2026-07-09_sanderson-ikas-hong-kong_business-analyst-product-manager-digital-transformation-mobile",
  "2026-07-13_bnp-paribas_senior-project-manager",
];
const HELD_BACK_AD_IDS = [
  "2026-07-10_huaxin-tech-shenzhen_it-xiangmu-jingli", // Chinese posting — held at ingest
  "2026-07-01_hays_senior-front-office-project-manager-top-tier-investment", // English ad, Chinese fixture
];

const qa = await createSession("uncurated-advert-journey", { baseURL: BASE_URL });
const { page } = qa;

// 1) Bootstrap the anonymous session and seed the essential discovery band over the real API, so
//    the deck scores against genuine confirmed facts rather than an empty profile.
await qa.goto("/discovery", "bootstrap the anonymous session on the discovery screen");
const seed = await page.evaluate(async (role) => {
  const post = (url, body) =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.status);
  const codes = [];
  codes.push(await post("/api/onboarding/discovery/start", { role }));
  codes.push(await post("/api/onboarding/discovery/answer", { itemId: "budget-accountability", answer: "Yes, over $1M" }));
  codes.push(await post("/api/onboarding/discovery/answer", { itemId: "cross-functional-leadership", answer: "Yes, multiple teams" }));
  codes.push(await post("/api/onboarding/discovery/answer", { itemId: "stakeholder-reporting", answer: "No" }));
  return codes;
}, ROLE);
qa.note(`seeded the essential band over the real API — POST status codes: ${seed.join(", ")}`);

// 2) Sign in (magic-link dev token) so the reveal's account wall doesn't stand between us and the
//    deck — wanting a job requires an account (S2), and this journey ends in the tailor.
const signIn = await page.evaluate(async () => {
  const link = await fetch("/api/auth/request-link", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "uncurated-journey@example.com" }),
  }).then((r) => r.json());
  const token = new URL("http://x" + link.devLink).searchParams.get("token");
  return fetch("/api/auth/verify", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  }).then((r) => r.status);
});
qa.note(`signed in over the real API — POST /auth/verify status: ${signIn}`);

// 3) What did the API actually build? Read the deck once over the wire to decide which mode we're
//    in, and to record the evidence numbers the report is really about.
const deck = await page.evaluate(async () => {
  const body = await fetch("/api/onboarding/cards").then((r) => r.json());
  return { count: body.cards.length, ids: body.cards.map((c) => c.adId), titles: body.cards.map((c) => c.title), pcts: body.cards.map((c) => c.matchPct) };
});
// Match on adId, never on title: three postings in this pool share the title "Senior Project
// Manager" (Schneider, Luvo, BNP) and only one of them is uncurated, so a title match silently
// drives the curated card instead and the journey passes without ever proving anything.
const newlyRead = deck.ids.filter((id) => UNCURATED_AD_IDS.includes(id));
const readerWired = newlyRead.length > 0;
qa.note(`deck size: ${deck.count} card(s). Cards from previously-unreadable adverts: ${newlyRead.length}/${UNCURATED_AD_IDS.length} → reader ${readerWired ? "WIRED" : "NOT wired (fixture-only baseline)"}`);
qa.note(`match %: ${deck.pcts.join(", ")}`);

if (deck.count !== (readerWired ? 15 : 8)) {
  qa.note(`FAIL: expected ${readerWired ? 15 : 8} cards in this mode, got ${deck.count}`);
  await qa.expectVisible("#deck-size-assertion-failed", `deck must hold ${readerWired ? 15 : 8} cards`);
}

// The language gate outranks the demo number: neither held-back advert may ever appear.
for (const held of HELD_BACK_AD_IDS) {
  const leaked = deck.ids.includes(held);
  qa.note(`#103 language gate — "${held}" absent from the deck: ${leaked ? "LEAKED (defect)" : "yes, correctly held back"}`);
  if (leaked) await qa.expectVisible("#language-gate-leak", `"${held}" must never reach the deck`);
}

// 4) The reveal, then the deck itself — read it the way a person does.
await qa.goto("/deck", "open the reveal");
await qa.expectVisible(page.getByRole("heading", { name: /matched you/ }), "the reveal headline counts the matches");
await qa.click(page.getByRole("button", { name: "See them" }), "press 'See them' — the deck opens on the best match");
await qa.scrollThrough("read the top card top to bottom");
await qa.expectVisible(page.locator(".jobcard h2").first(), "the card leads with the job title");
await qa.expectVisible(page.locator(".bubble"), "the highlight bubble sits under the score");
await qa.expectVisible(page.getByRole("heading", { name: "Where you don't — yet" }), "the ad's open asks are listed");

if (!readerWired) {
  // await: qa.note() is an async driver action, and finish() closes the browser — an un-awaited
  // note immediately before it loses its race and crashes the run after the report is written.
  await qa.note("no ad reader reachable (no API key / no CLI) — stopping after the fixture-only baseline, which is exactly today's pre-#104 behaviour and must keep working.");
  const okBase = await qa.finish();
  process.exit(okBase ? 0 : 1);
}

// 5) Swipe past cards until a previously-unreadable advert is on top. This is the moment the slice
//    is about: a job that could not become a card at all before now sits in the deck.
// The deck renders in the order the API returned, so the index of the first uncurated advert is
// exactly how many times a person has to press "Not for me" to reach it.
const targetId = newlyRead[0];
const targetIndex = deck.ids.indexOf(targetId);
const targetTitle = deck.titles[targetIndex];
qa.note(`target: ${targetId} — position ${targetIndex + 1} of ${deck.count} in the deck, titled "${targetTitle}"`);

const notForMe = page.getByRole("button", { name: "Not for me, show next job" });
for (let i = 0; i < targetIndex; i++) {
  await qa.click(notForMe, `pass on "${deck.titles[i]}" (${i + 1}/${targetIndex}) — working toward the advert nobody curated`);
}
await qa.expectText(page.locator(".jobcard h2").first(), targetTitle, `card ${targetIndex + 1} is ${targetId} — an advert that could not become a card at all before this slice`);

// 6) It must be a usable card, not a decorative one: the requirement list the model produced is
//    what the tailor will ask about, so it has to be there and non-empty.
await qa.scrollThrough("read the newly-read card the way a candidate would");
await qa.expectVisible(page.getByRole("heading", { name: "Where you don't — yet" }), "the model-read requirements render as the card's open asks");
const openCount = await page.locator(".row").count();
qa.note(`requirement rows rendered on the newly-read card: ${openCount}`);
await qa.expectVisible(page.getByText("Read the ad in full"), "the original advert text is attached to the card, folded shut");

// 7) Choose it — the check the reviews flagged as the real risk: a card you can see but not use.
await qa.click(page.getByRole("button", { name: "I want this one, tailor this job" }), "choose the newly-read job — this used to 500 for anything outside the fixture set");

const tailorState = await page.evaluate(async () => {
  const r = await fetch("/api/onboarding/tailor");
  if (r.status !== 200) return { status: r.status };
  const j = await r.json();
  return { status: 200, adId: j.card?.adId, questions: (j.questions || []).map((q) => q.question) };
});
qa.note(`landed on ${new URL(page.url()).pathname}; GET /onboarding/tailor → ${tailorState.status}; tailoring ${tailorState.adId}`);
qa.note(`questions generated from the live-read requirements: ${JSON.stringify(tailorState.questions?.slice(0, 3))}`);
if (tailorState.status !== 200) await qa.expectVisible("#tailor-must-be-200", "the tailor must open for a newly-read advert");
// The whole point: the job being tailored must be the UNCURATED one, not a curated neighbour that
// happens to share its title.
if (tailorState.adId !== targetId) {
  qa.note(`FAIL: expected to be tailoring ${targetId}, but the tailor holds ${tailorState.adId}`);
  await qa.expectVisible("#wrong-tailor-target", `the tailor must hold the newly-read advert ${targetId}`);
}

// The tailor is asking about requirements that exist only because a model read the advert.
await qa.expectVisible(page.locator(".tailor .q"), "the tailor asks its first question — drawn from the live-read requirement list");
await qa.expectVisible(page.getByRole("button", { name: "I'm done — use this CV" }), "the newly-read job is fully tailorable — the exit is offered like any curated job");

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
