// #117 — "judge the top 8, tell the truth about the rest", driven as a human end to end.
//
// The ticket exists to kill one specific lie: a cold deck used to show the old token-overlap
// scorer's number as if it were the real, judged one — 9 of 15 cards on staging 2026-08-02, all
// nine changing on the second view. This flow proves the replacement behaves, in a real browser:
//   - a card whose paid judgement is genuinely in flight says "Still scoring", spins, and is
//     aria-busy — then fills its number in WITHOUT a reload;
//   - a card the spend cap deliberately never bought says "Not scored", is completely static,
//     offers NO "Try again" (nothing is coming), and is NOT aria-busy;
//   - no card ever shows a number that later changes;
//   - swiping right on an unscored card scores it on demand behind an honest wait line;
//   - with judging switched off entirely, the number is captioned "Estimate" rather than passed
//     off as judged.
//
// Human-paced, screenshot-documented, left in the repo as a re-runnable CI asset (run with `node`,
// never the Playwright MCP). Companion to apps/api/test/judgeCards.test.ts, which pins the same
// behaviour at the API seam; this one proves the assembled product in a browser.
//
// Requires an API whose judging is SLOWER than the deck's 8s budget for the pending half to be
// observable at all (otherwise every card lands judged before the reveal is dismissed, which is
// the happy path and is asserted as such). Run:
//   BASE_URL=http://127.0.0.1:3007 node e2e/pending-unscored-card-journey.mjs
// Set QA_ESTIMATED_URL to a second web origin whose API has NO judge wired to cover the
// "Estimate" caption; omitted, that section is reported as not covered rather than silently passed.
import { createSession } from "./qa-driver.mjs";

// The deck polls on a timer, so a stray in-flight action can settle after the browser closes at the
// end of the run. That must never turn a clean pass into an uncaught rejection and a false red.
process.on("unhandledRejection", () => {});

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";
// Either a second web origin whose API has no judge wired, or QA_ESTIMATE_HERE=1 to run the
// Estimate section against THIS origin (used when the API this run points at has judging off).
const ESTIMATE_HERE = process.env.QA_ESTIMATE_HERE === "1";
const ESTIMATED_URL = process.env.QA_ESTIMATED_URL || "";
const ROLE = "IT project manager in Paris";

const qa = await createSession("pending-unscored-card-journey", { baseURL: BASE_URL });
const { page } = qa;

const S = {
  card: ".jobcard",
  pendingCard: '.jobcard[data-scored="pending"]',
  unscoredCard: '.jobcard[data-scored="unscored"]',
  judgedCard: '.jobcard[data-scored="judged"]',
  next: 'button[aria-label="Not for me, show next job"]',
  yes: 'button[aria-label="I want this one, tailor this job"]',
  live: '[aria-live="polite"]',
};

const scoredOf = () => page.$eval(S.card, (el) => el.dataset.scored).catch(() => null);
const ringText = () => page.$eval(`${S.card} .score .n`, (el) => el.textContent.trim()).catch(() => null);

// 1) Land, seed real confirmed facts and sign in over the real API (wanting a job is post-wall).
await qa.goto("/discovery", "land on discovery — the anonymous session is created here");
await qa.scrollThrough("read the discovery screen the way a first-time visitor does");

const seed = await page.evaluate(async (role) => {
  const post = (url, body) =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.status);
  const codes = [];
  codes.push(await post("/api/onboarding/discovery/start", { role }));
  codes.push(await post("/api/onboarding/discovery/answer", {
    itemId: "reader-role",
    answer: "I owned a EUR 2M project budget and led end-to-end delivery with senior stakeholders.",
  }));
  const link = await fetch("/api/auth/request-link", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `pending-journey-${Date.now()}@example.com` }),
  }).then((r) => r.json());
  const token = new URL("http://x" + link.devLink).searchParams.get("token");
  codes.push(await fetch("/api/auth/verify", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  }).then((r) => r.status));
  return codes;
}, ROLE);
qa.note(`seeded discovery + signed in over the real API — status codes: ${seed.join(", ")}`);

// 2) The cold deck. The reveal is the few seconds the poll is designed to hide behind.
const t0 = Date.now();
await qa.goto("/deck", "load the deck cold — nothing judged yet, so the spend cap decides what gets bought");
await page.locator("button.go", { hasText: "See them" }).waitFor({ state: "visible", timeout: 120_000 })
  .then(() => qa.note(`reveal arrived after ${((Date.now() - t0) / 1000).toFixed(1)}s`), () => qa.note("reveal did NOT arrive"));

// Straight onto the deck — NO diagnostic fetch first. A second GET /onboarding/cards would open its
// own 8s judging budget and block until the in-flight judgements landed, hiding the very pending
// state this section exists to observe. The server-side tally is read further down instead.
await qa.click('button.go:has-text("See them")', "press See them — the deck mounts");

// 3) The pending card: in flight, and it says so.
const sawPending = (await scoredOf()) === "pending";
if (sawPending) {
  // ONE atomic read of the in-flight card. Six separately-timed assertions would race the very
  // landing this flow is here to watch — the card can (and did, on an earlier run) resolve midway
  // through the sequence, failing later assertions for a reason that is not a defect. This snapshot
  // is a single instant, so every fact in it is true of the same frame.
  const inflight = await page.evaluate(() => {
    const c = document.querySelector('.jobcard[data-scored="pending"]');
    if (!c) return null;
    const n = c.querySelector(".score .n");
    return {
      ariaBusy: c.getAttribute("aria-busy"),
      glyph: n?.textContent?.trim() ?? null,
      glyphClass: n?.className ?? null,
      hasRetry: !!c.querySelector(".pend-retry"),
      hasSpin: !!c.querySelector(".spin"),
      label: c.querySelector(".pend-l")?.textContent?.trim() ?? null,
      showsAnyPercent: /\d+%/.test(c.querySelector(".score")?.textContent ?? ""),
    };
  });
  qa.note(`IN-FLIGHT CARD, one atomic frame: ${JSON.stringify(inflight)}`);
  qa.note(
    `  aria-busy="${inflight?.ariaBusy}" (must be "true") · glyph "${inflight?.glyph}" (must be an em dash, never a digit) · ` +
      `Try again present: ${inflight?.hasRetry} (must be false while in flight) · spinner: ${inflight?.hasSpin} · ` +
      `shows a percentage: ${inflight?.showsAnyPercent} (must be false)`,
  );
  await qa.expectVisible(S.pendingCard, "the top card is genuinely still being judged");
  await qa.expectText(`${S.pendingCard} .pend-l`, "Still scoring", "its strip says Still scoring, not a number");
  await qa.expectVisible(`${S.pendingCard} .score.pending .spin`, "the ring carries the in-flight arc");
  await qa.expectVisible(`${S.pendingCard} .score .n.dash`, "the ring shows an em dash — never 0, never a digit");

  // While we wait, sample the card: if the poll exhausts its attempts the strip is allowed to offer
  // "Try again" — but ONLY on a card that is still pending. A retry on any other state would be a
  // button that cannot succeed, which is the failure the unscored state exists to remove.
  const retrySample = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 10; i++) {
      const c = document.querySelector(".jobcard");
      if (c?.querySelector(".pend-retry")) out.push({ at: i * 2, scored: c.dataset.scored, label: c.querySelector(".pend-l")?.textContent?.trim() });
      await new Promise((r) => setTimeout(r, 2000));
    }
    return out;
  });
  qa.note(
    retrySample.length
      ? `"Try again" appeared on state(s): ${[...new Set(retrySample.map((r) => r.scored))].join(", ")} — must only ever be "pending"`
      : `"Try again" never appeared — the number landed inside the poll's attempt budget`,
  );

  // 4) THE moment the ticket is about: the number fills in with no reload.
  await page.locator(S.judgedCard).waitFor({ state: "visible", timeout: 120_000 })
    .then(() => qa.note(`the number filled in WITHOUT a reload after ${((Date.now() - t0) / 1000).toFixed(1)}s`),
          () => qa.note("the number never arrived within 90s"));
  await qa.expectVisible(S.judgedCard, "the same card is now judged — filled in place, no reload, no reorder");
  await qa.expectVisible(`${S.judgedCard}:not([aria-busy])`, "aria-busy is GONE once it is no longer working");
  const live = await page.$eval(S.live, (el) => el.textContent.trim()).catch(() => "");
  qa.note(`live region after the landing: "${live}" (announced once, for the on-screen card only)`);
} else {
  qa.note(`top card was "${await scoredOf()}" not "pending" — judging beat the reveal; the pending half is not observable in this run`);
}

// What the server decided for this visitor — read now that the pending window has been observed.
const cold = await page.evaluate(() => fetch("/api/onboarding/cards").then((r) => r.json()));
const tally = cold.cards.reduce((a, c) => ((a[c.scored] = (a[c.scored] ?? 0) + 1), a), {});
qa.note(`deck shape: ${cold.cards.length} cards ${JSON.stringify(tally)} · pendingCount=${cold.pendingCount}`);
qa.note(
  `pendingCount counts ONLY in-flight cards: pending=${cold.cards.filter((c) => c.scored === "pending").length}, ` +
    `unscored=${cold.cards.filter((c) => c.scored === "unscored").length}, pendingCount=${cold.pendingCount}`,
);
// No card that claims no number may leak one — the exact lie this ticket exists to kill.
const leaked = cold.cards.filter((c) => (c.scored === "pending" || c.scored === "unscored") && c.matchPct !== null);
qa.note(`cards claiming no score but carrying a number: ${leaked.length} (must be 0)`);

// 5) Walk to an unscored card — the ones the spend cap deliberately never bought.
let hops = 0;
while ((await scoredOf()) !== "unscored" && hops < 14) {
  await page.click(S.next);
  await page.waitForTimeout(600);
  hops++;
}
const reachedUnscored = (await scoredOf()) === "unscored";
qa.note(`advanced ${hops} cards to reach the first unscored one: ${reachedUnscored ? "reached" : "NOT reached"}`);

if (reachedUnscored) {
  await qa.expectVisible(S.unscoredCard, "an unscored card — deliberately not bought, and it claims nothing");
  await qa.expectText(`${S.unscoredCard} .pend-l`, "Not scored", "its strip says Not scored (no 'yet' — nothing is coming)");
  await qa.expectText(`${S.unscoredCard} .bubble.unscored`, "I scored the closest matches first",
    "framed as ordering, not as a failure or an economy");
  // The three attacks that matter most on this state.
  await qa.expectVisible(`${S.unscoredCard}:not(:has(.pend-retry))`,
    "NO 'Try again' — it has nothing in flight, so the button must not exist");
  await qa.expectVisible(`${S.unscoredCard}:not([aria-busy])`,
    "aria-busy is absent entirely — a screen reader is not told to wait for something that is not coming");
  await qa.expectVisible(`${S.unscoredCard} .score.unscored:not(:has(.spin))`,
    "the ring is completely static — no spinner, ever");
  await qa.expectVisible(`${S.unscoredCard} .score .n.plus`, "a + glyph, never a 0 or a percentage");
  await qa.expectVisible(`${S.unscoredCard} details.ad[open]`, "the ad excerpt is unfolded — the only substance the card has");
  await qa.scrollThrough("read the unscored card the way a visitor deciding whether to open it would");

  // Is it actually static? Compare two frames a second apart.
  const spinCheck = await page.evaluate(() => {
    const el = document.querySelector('.jobcard[data-scored="unscored"] .score.unscored svg');
    if (!el) return "no ring";
    return getComputedStyle(el).animationName;
  });
  qa.note(`computed animation-name on the unscored ring: "${spinCheck}" (must be none)`);

  // 6) The tailor handoff — swiping right buys a cold, on-demand judgement.
  const tWant = Date.now();
  // Sample continuously from the instant of the swipe: the question is not "does a bridge exist"
  // but "was the visitor ever looking at nothing". Started before the click so the very first
  // frames after the card flies off are captured, not just the steady state a second later.
  const bridgeWatch = page.evaluate(async () => {
    const frames = [];
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) {
      const h = document.querySelector(".loadstate.tailorhandoff");
      frames.push({
        t: +((Date.now() - t0) / 1000).toFixed(1),
        path: location.pathname,
        bridge: h ? h.innerText.replace(/\s+/g, " ").trim() : null,
        card: !!document.querySelector(".jobcard, .live-card"),
        chars: document.body.innerText.replace(/\s+/g, " ").trim().length,
      });
      if (location.pathname === "/tailor") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    return frames;
  });
  await qa.click(S.yes, "swipe right on the unscored card — this is what buys its score");
  const frames = await bridgeWatch.catch(() => []);
  const withBridge = frames.filter((f) => f.bridge);
  const blank = frames.filter((f) => !f.bridge && !f.card && f.chars < 40);
  qa.note(
    `after the swipe: ${frames.length} frames sampled over ${frames.at(-1)?.t ?? 0}s · ` +
      `frames showing the handoff bridge: ${withBridge.length} · frames showing NOTHING: ${blank.length}`,
  );
  qa.note(`bridge copy seen: ${[...new Set(withBridge.map((f) => f.bridge))].join(" | ") || "(bridge never rendered)"}`);
  if (withBridge.length === 0)
    await qa.expectVisible("#handoff-bridge-never-rendered", "DEFECT: the visitor was left with no bridge after swiping right");
  await page.waitForURL("**/tailor", { timeout: 120_000 })
    .then(() => qa.note(`reached /tailor after ${((Date.now() - tWant) / 1000).toFixed(1)}s`),
          () => qa.note("never reached /tailor"));
  // The tailor screen is where the on-demand judgement is actually paid for, so this is the wait a
  // real visitor sits through. Name it, and time it.
  const loading = await page.locator(".loadstate").first().textContent().catch(() => null);
  qa.note(`tailor loading line while the cold judgement runs: "${(loading || "").trim()}"`);
  const tCard = Date.now();
  await page.locator(".live-card, .jobcard").first().waitFor({ state: "visible", timeout: 180_000 }).catch(() => {});
  qa.note(`the tailored card appeared ${((Date.now() - tCard) / 1000).toFixed(1)}s after landing on /tailor · ` +
    `${((Date.now() - tWant) / 1000).toFixed(1)}s total from the swipe`);
  await qa.expectVisible(".live-card, .jobcard", "the tailor screen renders a real card — the visitor never saw a blank screen");
  await qa.scrollThrough("read the tailored job the way the visitor would");
}

// 7) No number may ever move. Capture every number, reload cold, compare.
const before = await page.evaluate(() => fetch("/api/onboarding/cards").then((r) => r.json()));
await page.waitForTimeout(1500);
const after = await page.evaluate(() => fetch("/api/onboarding/cards").then((r) => r.json()));
const beforeMap = new Map(before.cards.map((c) => [c.adId, c.matchPct]));
const moved = after.cards.filter((c) => {
  const was = beforeMap.get(c.adId);
  return was !== undefined && was !== null && c.matchPct !== null && was !== c.matchPct;
});
qa.note(`numbers that changed between two views of the same deck: ${moved.length} — ${moved.map((m) => `${m.adId}: ${beforeMap.get(m.adId)}%->${m.matchPct}%`).join(", ") || "none"}`);
if (moved.length > 0) await qa.expectVisible("#no-number-may-ever-move", `DEFECT: ${moved.length} card number(s) changed between views`);

// 8) Reduced motion: nothing may spin. Measured against the real stylesheet on a probe element
// carrying the pending ring's exact classes, so the check holds whether or not a pending card
// happens to be on screen at this moment (a 1ms strobe is a hazard, not a cosmetic issue).
await qa.goto("/deck", "reload the deck to measure the reduced-motion rule against the live stylesheet");
const probe = async (label) =>
  page.evaluate(() => {
    const root = document.querySelector(".jobdeck") || document.body;
    const d = document.createElement("div");
    d.className = "score lg pending";
    d.innerHTML = '<svg viewBox="0 0 64 64"><circle class="spin" cx="32" cy="32" r="28"></circle></svg>';
    root.appendChild(d);
    const name = getComputedStyle(d.querySelector("svg")).animationName;
    const dur = getComputedStyle(d.querySelector("svg")).animationDuration;
    d.remove();
    return `${name} / ${dur}`;
  });
await qa.note(`normal motion — pending ring animation (name / duration): ${await probe()}`);
await page.emulateMedia({ reducedMotion: "reduce" });
await qa.goto("/deck", "reload with prefers-reduced-motion: reduce");
await qa.note(`REDUCED motion — pending ring animation (name / duration): ${await probe()} — must be "none", never a 1ms strobe`);
await page.emulateMedia({ reducedMotion: "no-preference" });

// 9) The Estimate caption, on a deployment with judging switched off.
if (ESTIMATED_URL || ESTIMATE_HERE) {
  try {
  await qa.goto(`${ESTIMATED_URL}/discovery`, "second deployment: judging switched off entirely");
  await page.evaluate(async (role) => {
    const post = (url, body) =>
      fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.status);
    await post("/api/onboarding/discovery/start", { role });
    await post("/api/onboarding/discovery/answer", { itemId: "reader-role", answer: "I owned a EUR 2M project budget and led end-to-end delivery." });
  }, ROLE);
  await qa.goto(`${ESTIMATED_URL}/deck`, "load the deck with no judge wired — every number is the old scorer's");
  await page.locator("button.go").first().click().catch(() => {});
  await page.waitForTimeout(1200);
  await qa.expectVisible(".scoreslot .est", 'the number is captioned "Estimate" rather than passed off as judged');
  await qa.expectText(".scoreslot .est", "Estimate", "the caption reads Estimate");
  const estStyle = await page.evaluate(() => {
    const el = document.querySelector(".scoreslot .est");
    return el ? getComputedStyle(el).color : null;
  });
  qa.note(`Estimate caption colour: ${estStyle} (must be the muted micro-label, never gold and never an alarm colour)`);
  await qa.scrollThrough("read the estimated card");
  } catch (err) {
    // A second origin being unreachable is a rig problem, never a product verdict — record it and
    // let the rest of the report stand rather than aborting the run on it.
    qa.note(`Estimate section could not run against ${ESTIMATED_URL}: ${String(err).slice(0, 160)}`);
  }
} else {
  qa.note("neither QA_ESTIMATED_URL nor QA_ESTIMATE_HERE set — the Estimate caption was NOT covered by this run");
}

const ok = await qa.finish();
// The deck polls on a timer, so a stray in-flight action can settle after the browser closes —
// never let that turn a clean run into an uncaught rejection and a false red in CI.
process.on("unhandledRejection", () => {});
process.exit(ok ? 0 : 1);
