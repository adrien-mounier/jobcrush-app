// #64 — "claim the anonymous onboarding after the earned match reveal", driven as the person
// experiences it, over the real stack (fake model only). Left in the repo as a re-runnable asset.
//
// Sibling to onboarding-reveal-wall.mjs, which walks the same happy path. This one exists for the
// four claims that journey does NOT make, and each of them is a way #64 could regress silently:
//
//   AC1  the count on the wall is the SAME NUMBER she just earned — not merely a heading that still
//        matches /matched you/. A reveal that re-counted (or lost the number entirely) would keep
//        passing a regex assertion while showing her something else.
//   AC3  the resumed deck's own counter reads "1 of N matched today" with the SAME N — proof the
//        skipped reveal cost her nothing, and that she landed on the FIRST (highest-ranked) card.
//   AC3  the skip flag is one-shot: reload the resumed deck and the reveal comes back. A flag that
//        stuck would let a bookmark skip a reveal it never earned.
//   AC4  the transition is a SERVER rule, over the wire, on the real ad id she can see on screen —
//        both before the claim (401) and after it (200). The screen never gets a vote.
//
// Plus the adversarial one: a hand-typed /deck?claimed=1 on a session that never signed in must
// still meet its reveal and its wall.
//
// Costs one magic-link sign-in against auth's 5-per-15-min-per-IP limiter.
//
// Run:  BASE_URL=http://127.0.0.1:3000 node e2e/claimed-return-journey.mjs
import { createSession } from "./qa-driver.mjs";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";
const ROLE = "IT project manager in Paris";
const EMAIL = "claimed-return-e2e@example.com";

const qa = await createSession("claimed-return-journey", { baseURL: BASE_URL });
const { page } = qa;

const wire = (path, init) =>
  page.evaluate(
    async ([p, i]) => {
      const res = await fetch(p, { credentials: "same-origin", ...(i || {}) });
      let body = null;
      try {
        body = await res.json();
      } catch {
        /* empty body is a fine answer */
      }
      return { status: res.status, body };
    },
    [path, init],
  );

// ---- she answers discovery, anonymously ------------------------------------------------------
await qa.goto("/discovery", "the front door — discovery bootstraps her anonymous session");
await qa.scrollThrough("she reads the first screen");
await qa.fill("#q1-role", ROLE, `she types the job she is after — "${ROLE}"`);
await qa.click("button.go.wide", "\"That's me\" — she sends the role");

await qa.expectVisible("#ask-q", "the first question of her family's floor is asked");
// Keep answering whatever is on screen — the family floor first, then the eligibility questions
// that follow it — until the closing languages group appears. Which questions those are is the
// server's business and changes with the researched floor, so this reads the screen, never a list.
let asked = 0;
for (let i = 0; i < 14 && !(await page.locator("fieldset.elig-group").count()); i += 1) {
  if (!(await qa.answerVisibleQuestion())) break;
  await page.waitForTimeout(1200);
  asked += 1;
}
await qa.note(`she answered ${asked} question(s) by pressing the screen's own controls`);

await qa.expectVisible("fieldset.elig-group", "the closing languages question is on screen");
if (await page.locator(".discovery .lang-typeahead").count()) {
  await qa.fill("#lang-input", "English", "she types the language she reads");
  await qa.click(".discovery .lang-typeahead .field .go", "she adds it to her list");
} else {
  await qa.click(page.locator(".discovery .opt.check").first(), "she ticks the first supported language");
}
await qa.click(".discovery .elig-actions .go", "she confirms — this completes the question set");

// ---- the reveal she earned -------------------------------------------------------------------
await page.waitForURL((url) => url.pathname === "/deck", { timeout: 15000 });
await page.getByRole("heading", { name: /matched you/ }).waitFor({ state: "visible", timeout: 20000 });
await qa.scrollThrough("she reads the reveal");

const revealHeading = (await page.getByRole("heading", { name: /matched you/ }).textContent()).replace(/\s+/g, " ").trim();
const earned = Number(revealHeading.match(/^(\d+)/)?.[1] ?? 0);
if (!earned) throw new Error(`could not read a match count off the reveal: "${revealHeading}"`);
await qa.note(`she earned a real count with no sign-in behind her: "${revealHeading}" (N = ${earned})`);
await qa.expectVisible(page.getByRole("heading", { name: /matched you/ }), `the reveal names ${earned} matches`);

const settled = await qa.cardsWhenRetrieved();
const topAdId = settled.cards[0].adId;
await qa.note(`the highest-ranked advert the server put first is ${topAdId} (authed = ${settled.authed})`);

// ---- AC4, before the claim: the wall is a server rule, not a screen ---------------------------
const wantBefore = await wire(`/api/onboarding/cards/${topAdId}/want`, { method: "POST" });
const tailorBefore = await wire("/api/onboarding/tailor");
await qa.note(
  `AC4 — naming the advert id directly on an unclaimed session: POST want -> ${wantBefore.status} ` +
    `(${wantBefore.body?.error?.code}), GET tailor -> ${tailorBefore.status} (${tailorBefore.body?.error?.code})`,
);
if (wantBefore.status !== 401 || wantBefore.body?.error?.code !== "login_required")
  await qa.note("DEFECT: an unclaimed session reached job detail by naming the advert id");
await qa.expectText(".jobdeck", "matched you", "AC4: she is still at her reveal — the server refused, nothing on screen changed");

// ---- the adversarial one: the skip flag typed by hand, with no sign-in behind it --------------
await qa.goto("/deck?claimed=1", "she (or a link she was sent) hand-types the claimed flag, still signed out");
await page.getByRole("button", { name: "See them" }).waitFor({ state: "visible", timeout: 20000 });
await qa.expectVisible(
  page.getByRole("button", { name: "See them" }),
  "AC3 guard: the flag alone skips nothing — an unclaimed session still meets her reveal",
);

// ---- AC1: the wall opens, the count stays --------------------------------------------------
await qa.click(page.getByRole("button", { name: "See them" }), "she presses \"See them\"");
await qa.expectVisible(page.getByRole("link", { name: "Continue with Google" }), "the account wall opens in place");
await qa.expectText(
  ".jobdeck .curtain h1",
  `${earned} job`,
  `AC1: the count she earned (${earned}) is still on screen while the wall asks her to sign in`,
);
const cardAtWall = await page.getByRole("img", { name: /% match/ }).count();
await qa.note(`AC1: no job card is shown behind the wall (match rings on screen = ${cardAtWall}, expected 0)`);

// ---- she signs in ---------------------------------------------------------------------------
await qa.fill(page.getByLabel("Email address"), EMAIL, `she gives her email — ${EMAIL}`);
await qa.click(page.getByRole("button", { name: "Email me a sign-in link" }), "she asks for the sign-in link");
await qa.expectVisible(page.getByText("Check your email"), "the wall confirms the link was sent");
await qa.click(
  page.getByRole("link", { name: "Open your sign-in link (dev)" }),
  "she opens the link — this claims the anonymous session she has been building",
);

// ---- AC3: she comes back to the job, not to a second curtain ---------------------------------
await page.waitForURL((url) => url.pathname === "/deck", { timeout: 15000 });
await page.getByRole("img", { name: /% match/ }).waitFor({ state: "visible", timeout: 20000 });
await qa.scrollThrough("she reads the job that opened by itself");
await qa.expectVisible(page.getByRole("img", { name: /% match/ }), "AC3: the job is on screen the moment she is back");
await qa.expectText(
  ".jobdeck .deckcount",
  `1 of ${earned} matched today`,
  `AC3: the FIRST card of the same ${earned} she earned — nothing was re-counted and nothing re-bought`,
);
const secondCurtain = await page.getByRole("button", { name: "See them" }).count();
const wallAgain = await page.getByRole("link", { name: "Continue with Google" }).count();
await qa.note(
  `AC3: no second reveal and no second wall between signing in and the job ("See them" = ${secondCurtain}, Google = ${wallAgain}, both expected 0)`,
);
const onCard = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 60) || "");
const announced = (await page.locator('.jobdeck [aria-live="polite"]').textContent().catch(() => "")) || "";
await qa.note(`AC3 carry-over: focus is on "${onCard}", and the skipped reveal still announced "${announced.trim()}"`);
const urlAfter = new URL(page.url()).search;
await qa.note(`AC3: the skip flag was spent on the way in — the address bar reads "/deck${urlAfter}" (expected no query)`);

// ---- AC3, one-shot: a reload cannot keep skipping a reveal -----------------------------------
await qa.goto("/deck", "she reloads the deck the next morning");
await page.getByRole("button", { name: "See them" }).waitFor({ state: "visible", timeout: 20000 });
await qa.expectVisible(
  page.getByRole("button", { name: "See them" }),
  "AC3: the skip was one-shot — a returning visitor gets her reveal back, flag spent",
);

// ---- AC4, after the claim: the same door, now open -------------------------------------------
const wantAfter = await wire(`/api/onboarding/cards/${topAdId}/want`, { method: "POST" });
await qa.note(
  `AC4: the very route that answered 401 a moment ago now hands over the highest-ranked job — ` +
    `POST want -> ${wantAfter.status}, stage "${wantAfter.body?.stage}", ad ${wantAfter.body?.adId} (expected ${topAdId})`,
);
if (wantAfter.status !== 200 || wantAfter.body?.adId !== topAdId)
  await qa.note("DEFECT: the claimed session could not open the job it earned");

const ok = await qa.finish();
process.exit(ok ? 0 : 1);
