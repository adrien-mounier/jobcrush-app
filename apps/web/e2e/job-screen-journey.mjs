// #306 — the job's own screen, finished. Driven as a human, screenshot-documented, left in the repo
// as a re-runnable CI asset (run with `node`, never the Playwright MCP).
//
// Why this exists rather than the API tests alone: #306's own acceptance criterion is "RENDER tests,
// not payload tests, prove each of the four changes on the right screen". Every one of the four is a
// statement about what a person is shown — where a thing sits on the page, how faint it is, which of
// two screens has it — and apps/api/test/applicationLink.test.ts can pass in full while the screen
// renders none of it. Three of the four cannot be seen from the server at all: the apply row is a slot
// the deck never fills, the un-muting is a CSS rule, and the moved advert is a change of ORDER.
//
// What it proves, in the order he meets it:
//   AC1  the apply row sits under the title on the job's own screen, and its empty state is a CONTROL
//        that closes the gap itself — pressed, filled in, saved, and still there after a reload
//   AC2  a link that is not a web address is refused by the control, not stored
//   AC3  "Read the ad in full" sits directly under the header on BOTH screens, above everything the
//        machine has to say about him
//   AC4  the "where you don't — yet" rows are un-muted on the job's own screen and still muted on the
//        deck — the same card, two contexts
//   AC5  one full-width "Write the tailored CV" here; the deck keeps its "Not for me" / "I want this
//        one" pair unchanged, and no apply link anywhere on the deck card
//   AC6  that button is the one next step and it leads to tailoring
//
// NOT drivable on this stack, and deliberately not faked: **"Not checked: …" beside the number**
// (#292 req 10). It needs an advert with a years-experience bar AND a person with no readable work
// history; the QA entry's canned advert reader (qa-main.ts's qaPastedRequirements) gives a pasted
// advert plain ordinary requirements and no eligibility dimension at all, so no pasted job on this
// stack can carry an untested bar. It is covered where it can be: #162's own tests, at the card's seam.
//
// Run:
//   pnpm --filter @jobcrush/api build
//   PORT=34101 node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34100
//   BASE_URL=http://127.0.0.1:34100 node apps/web/e2e/job-screen-journey.mjs
import { createSession } from "./qa-driver.mjs";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";
const ROLE = "IT project manager in Brussels";

/** An advert with NO web address anywhere in its text — the paste door pre-fills the link field from
 *  the text when the text carries one, and this journey's first claim is about a job that has none.
 *
 *  Stamped with the run, and that is not cosmetic: this journey WRITES a link onto the advert, and an
 *  advert record is shared by everyone who pastes it, first link wins (#294 ruling 1, #306). A second
 *  run against a warm API would paste the same text, land on the record the previous run gave a link
 *  to, and report the empty state as missing — a defect against the journey, not the product. A run
 *  brings in an advert of its own, which is what a new person pasting actually is. */
const ADVERT = `Senior IT Project Manager — Helvara Group (ref ${Date.now().toString(36)})
Brussels, Belgium · Hybrid, three days on site

Helvara Group is looking for a Senior IT Project Manager to lead the delivery of our core banking
migration programme across Belgium and the Netherlands.

What we are looking for
- Coordinate business and technical stakeholders at executive level
- Hold the plan and report progress to the steering committee every month
- Run a portfolio of regulated change across four workstreams
- Speak Dutch well enough to chair a workshop in it`;

const ADDED_LINK = "https://careers.helvara.example/apply/senior-it-project-manager";
const BAD_LINK = "careers.helvara.example/apply";

const SETTLE_MS = 180_000;
const JOB_SCREEN_MS = 30_000;

const qa = await createSession("job-screen-journey", { baseURL: BASE_URL });
const { page } = qa;

const defects = [];
const must = async (ok, note) => {
  if (ok) return qa.expectVisible("body", `PASS — ${note}`);
  defects.push(note);
  return qa.expectVisible("#defect-no-such-element", `FAIL — ${note}`);
};

const settle = (loc, what, timeout = SETTLE_MS) =>
  loc.waitFor({ state: "visible", timeout }).then(
    () => qa.note(`${what} arrived`),
    () => qa.note(`${what} did NOT arrive within ${timeout / 1000}s`),
  );

/** The card's anatomy as the DOM actually orders it — which is the whole of change 3. Read off the
 *  rendered card rather than the source, so a JSX move that never reached the browser is a failure. */
const cardOrder = () =>
  page.evaluate(() => {
    const card = document.querySelector(".jobcard .jcbody");
    if (!card) return null;
    const names = { hd: "header", ageing: "ageing", applyrow: "apply row", ad: "advert", bubble: "highlight", flat: "the lists", breakdown: "breakdown" };
    return [...card.children]
      .map((el) => names[[...el.classList].find((c) => names[c])] ?? null)
      .filter(Boolean);
  });

/** What colour the "where you don't — yet" rows are painted, and what colour the card's own body text
 *  is, as the browser resolves them. Muted vs un-muted is a rendered fact; a CSS rule nobody applied
 *  is invisible to every other kind of test. */
const gapColours = () =>
  page.evaluate(() => {
    const row = document.querySelector(".jobcard .row.open");
    const heading = document.querySelector(".jobcard h2");
    return row && heading
      ? { row: getComputedStyle(row).color, ink: getComputedStyle(heading).color }
      : null;
  });

/** The footer of the card on screen: every button a person can press on it. */
const footerButtons = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".jobcard .jcfoot button")].map((b) => b.textContent.trim()),
  );

async function openDeck(note) {
  await qa.goto("/deck", note);
  const reveal = page.locator("button.go", { hasText: "See them" });
  await reveal.waitFor({ state: "visible", timeout: SETTLE_MS }).then(
    () => qa.click('button.go:has-text("See them")', "press 'See them' — the deck mounts"),
    () => qa.note("the reveal never arrived; looking for the deck anyway"),
  );
  await settle(page.locator(".jobcard"), "the deck");
}

async function pasteAdvert(text, note) {
  await qa.goto("/paste", note);
  await qa.fill(page.locator("#advert"), text, "paste the advert into the box");
  await qa.click(page.getByRole("button", { name: "Read it" }), "press 'Read it'");
  await page
    .waitForURL(/\/job\//, { timeout: SETTLE_MS })
    .then(() => qa.note("landed on the job's own screen"), () => qa.note("never landed on a job screen"));
  await settle(page.locator(".onejob .jobcard"), "the job's own card", JOB_SCREEN_MS);
  return new URL(page.url()).pathname;
}

// ---------------------------------------------------------------------------------------------
// 0) A signed-in session. The deck half of this journey needs a real ranked deck to compare the
//    job's own screen against, and the deck is walled at the reveal for an anonymous visitor.
// ---------------------------------------------------------------------------------------------
await qa.goto("/discovery", "land on discovery — the anonymous session is created here");
const started = await page.evaluate(
  (role) =>
    fetch("/api/onboarding/discovery/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    }).then((r) => r.status),
  ROLE,
);
// #339: question 1 is all it takes — no floor to answer, and no CV here to be reviewed first.
await qa.note(`discovery started (HTTP ${started})`);

const signIn = await page.evaluate(async () => {
  const linkRes = await fetch("/api/auth/request-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `job-screen-${Date.now()}@example.com` }),
  });
  const link = await linkRes.json().catch(() => ({}));
  if (!link.devLink) return { status: 0, requestLink: linkRes.status };
  const token = new URL("http://x" + link.devLink).searchParams.get("token");
  const verify = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return { status: verify.status, requestLink: linkRes.status };
});
await qa.note(`signed in over the real API — request-link ${signIn.requestLink}, verify ${signIn.status}`);
if (signIn.status !== 200) {
  await must(false, `the run could not sign in (request-link ${signIn.requestLink}) — nothing below is a statement about the product`);
  await qa.note(
    "STOPPING. A 429 on /auth/request-link means this IP signed in too often too fast: wait for the " +
      "limiter's window, or restart the API, and run again.",
  );
  process.exit((await qa.finish()) ? 0 : 1);
}

// ---------------------------------------------------------------------------------------------
// 1) He brings in a job whose advert carries no link, and lands on its own screen.
// ---------------------------------------------------------------------------------------------
const jobPath = await pasteAdvert(ADVERT, "bring in a job whose advert gives no way to apply");
await qa.scrollThrough("read the job's own screen the way somebody deciding would");

/** The anatomy every card must be a subsequence of. Written as an ORDER rather than fixed positions
 *  on purpose: a brought job past its first week carries an ageing line and a job we found does not,
 *  so a rule like "the apply row is the second child" would go red on a healthy product the day this
 *  advert turns seven days old. What the ticket actually asks for is what sits above what. */
const ANATOMY = ["header", "ageing", "apply row", "advert", "highlight", "the lists", "breakdown"];
const inAnatomyOrder = (seen) =>
  seen !== null && seen.every((part, i) => i === 0 || ANATOMY.indexOf(seen[i - 1]) < ANATOMY.indexOf(part));

const order = await cardOrder();
await qa.note(`the card, top to bottom, on the job's own screen: ${JSON.stringify(order)}`);
await must(
  inAnatomyOrder(order) &&
    order.indexOf("apply row") > order.indexOf("header") &&
    order.indexOf("apply row") < order.indexOf("advert"),
  `AC1 — the apply row is under the header block, above everything else (${JSON.stringify(order)})`,
);
await must(
  order !== null &&
    order.indexOf("advert") > order.indexOf("header") &&
    order.indexOf("advert") < order.indexOf("highlight"),
  "AC3 — 'Read the ad in full' sits under the header, ABOVE everything the machine says about him",
);

const emptyControl = page.locator(".applyrow button.applyadd");
await settle(emptyControl, "the apply row's empty state", JOB_SCREEN_MS);
const emptyCopy = ((await emptyControl.textContent().catch(() => "")) || "").trim();
await qa.note(`the empty state reads: "${emptyCopy}"`);
await must(
  emptyCopy === "No application link yet — add the application link",
  `AC1 — the empty state is a CONTROL a person can press, not a caption ("${emptyCopy}")`,
);
await must(
  (await page.locator(".onejob .applylink").count()) === 0,
  "AC1 — and there is no apply link yet, because the advert carried none",
);

// ---------------------------------------------------------------------------------------------
// 2) He closes the gap himself — and a link that is not a web address does not get stored.
// ---------------------------------------------------------------------------------------------
await qa.click(emptyControl, "press 'add the application link'");
await settle(page.locator(".applyinput"), "the link field", JOB_SCREEN_MS);
await qa.fill(page.locator(".applyinput"), BAD_LINK, "type an address with no scheme on it");
await qa.click(page.locator("button.applysave"), "press 'Save the link'");
const refusal = ((await page.locator(".applyerr").textContent().catch(() => "")) || "").trim();
await qa.note(`what it says about that link: "${refusal}"`);
await must(
  refusal.length > 0 && (await page.locator(".onejob .applylink").count()) === 0,
  `AC2 — a link that is not a web address is refused and not stored ("${refusal}")`,
);

await qa.fill(page.locator(".applyinput"), ADDED_LINK, "type the real application link");
await qa.click(page.locator("button.applysave"), "press 'Save the link'");
await settle(page.locator(".onejob .applylink"), "the apply link", JOB_SCREEN_MS);
const savedHref = await page.locator(".onejob .applylink").getAttribute("href").catch(() => null);
await must(savedHref === ADDED_LINK, `AC1 — the link he added is now the row, as a link he can press ("${savedHref}")`);

await qa.goto(jobPath, "come back to the job's own screen from scratch");
await settle(page.locator(".onejob .jobcard"), "the job's own card", JOB_SCREEN_MS);
const afterReload = await page.locator(".onejob .applylink").getAttribute("href").catch(() => null);
await must(
  afterReload === ADDED_LINK,
  `AC1 — and it is still there on a fresh load, so the gap was closed on the job and not just on screen ("${afterReload}")`,
);

// ---------------------------------------------------------------------------------------------
// 2b) The same card once the job is old enough to say so. #305 puts an ageing line between the
//     header and everything under it, and a card whose apply row was pinned to a fixed position
//     would go red here on a product that is working perfectly. So the rule is proved in the case
//     that would break it, not only in the fresh one.
// ---------------------------------------------------------------------------------------------
const aged = await page.evaluate(() =>
  fetch("/api/qa/stack", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pasteDaysAgo: 9 }),
  })
    .then((r) => r.json())
    .catch(() => null),
);
await qa.note(`nine days pass (pasteDaysAgo ${aged?.pasteDaysAgo}) — the job now says how old it is`);
await qa.goto(jobPath, "open the job's own screen with an ageing line on it");
await settle(page.locator(".onejob .jobcard"), "the job's own card", JOB_SCREEN_MS);
const agedOrder = await cardOrder();
await qa.note(`the card with its age on it: ${JSON.stringify(agedOrder)}`);
await must(
  agedOrder !== null && agedOrder.includes("ageing"),
  `AC1 — the ageing line is on this card, so the check below is running in the case that matters (${JSON.stringify(agedOrder)})`,
);
await must(
  inAnatomyOrder(agedOrder) &&
    agedOrder.indexOf("apply row") > agedOrder.indexOf("ageing") &&
    agedOrder.indexOf("apply row") < agedOrder.indexOf("advert"),
  `AC1 — and the order still holds: he reads that we cannot check it is open BEFORE the link out (${JSON.stringify(agedOrder)})`,
);
await page.evaluate(() =>
  fetch("/api/qa/stack", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pasteDaysAgo: 0 }),
  }).catch(() => null),
); // put the knob back for whatever journey runs next

// ---------------------------------------------------------------------------------------------
// 3) The rows he is missing, and the one next step — both read off this screen, then off the deck's
//    card, because "on the job's own screen only" is a claim about the DIFFERENCE between the two.
// ---------------------------------------------------------------------------------------------
const screenGaps = await gapColours();
await qa.note(`the gap rows on the job's own screen: ${JSON.stringify(screenGaps)}`);
await must(
  screenGaps !== null && screenGaps.row === screenGaps.ink,
  `AC4 — the "where you don't — yet" rows read as plainly as the title here (${screenGaps?.row})`,
);

const screenFooter = await footerButtons();
await qa.note(`the buttons on the job's own screen: ${JSON.stringify(screenFooter)}`);
await must(
  screenFooter.length === 1 && screenFooter[0] === "Write the tailored CV",
  `AC5 — one action, and it says what the press produces (${JSON.stringify(screenFooter)})`,
);
// "Full-width" is a measurement, so it is measured: the button against the room its footer gives it.
const width = await page.evaluate(() => {
  const foot = document.querySelector(".onejob .jcfoot");
  const button = foot?.querySelector("button");
  if (!foot || !button) return null;
  const style = getComputedStyle(foot);
  const room = foot.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return { button: Math.round(button.getBoundingClientRect().width), room: Math.round(room) };
});
await qa.note(`the action measures ${width?.button}px in ${width?.room}px of footer`);
await must(
  width !== null && width.button >= width.room - 1,
  `AC5 — and it is FULL width, not a button sitting where a pair used to (${JSON.stringify(width)})`,
);

await openDeck("go to the deck to see the SAME card in the place it is skimmed");
await qa.scrollThrough("read the deck's first card");
const deckOrder = await cardOrder();
await qa.note(`the same card on the deck, top to bottom: ${JSON.stringify(deckOrder)}`);
await must(
  deckOrder !== null &&
    deckOrder.indexOf("advert") > deckOrder.indexOf("header") &&
    deckOrder.indexOf("advert") < deckOrder.indexOf("highlight"),
  "AC3 — the advert moved up on the DECK too, which is what 'on both screens' means",
);
await must(
  deckOrder !== null && !deckOrder.includes("apply row"),
  "AC5 — and the deck card has no apply row: a link inside a card being swiped fights the gesture",
);
await must(
  (await page.locator(".jobcard .applylink, .jobcard .applyadd").count()) === 0,
  "AC5 — no link and no link control anywhere on the deck card, not even a hidden one",
);

const deckGaps = await gapColours();
await qa.note(`the gap rows on the deck card: ${JSON.stringify(deckGaps)}`);
await must(
  deckGaps !== null && deckGaps.row !== deckGaps.ink,
  `AC4 — the deck card keeps its quiet skim styling (${deckGaps?.row} against ${deckGaps?.ink})`,
);
await must(
  deckGaps !== null && screenGaps !== null && deckGaps.row !== screenGaps.row,
  "AC4 — so the two screens really do paint the same rows differently, which is the whole change",
);

const deckFooter = await footerButtons();
await qa.note(`the buttons on the deck card: ${JSON.stringify(deckFooter)}`);
await must(
  deckFooter.includes("Not for me") && deckFooter.includes("I want this one"),
  `AC5 — the deck's own pair is untouched, so a card never contradicts the stamp it shows mid-swipe (${JSON.stringify(deckFooter)})`,
);

// ---------------------------------------------------------------------------------------------
// 4) The one next step, pressed. A single full-width action that dead-ended would be worse than the
//    pair it replaced.
// ---------------------------------------------------------------------------------------------
await qa.goto(jobPath, "go back to the job and press the one thing there is to press");
await settle(page.locator(".onejob .jobcard"), "the job's own card", JOB_SCREEN_MS);
await qa.click(page.locator(".jcfoot button.sw.yes"), "press 'Write the tailored CV'");
const landed = await page.waitForURL(/\/tailor/, { timeout: 45_000 }).then(() => true, () => false);
await qa.note(`after the press: ${page.url()}`);
await must(landed, `AC6 — the one action leads to tailoring rather than dead-ending (now at ${new URL(page.url()).pathname})`);

if (defects.length > 0) {
  await qa.note(`DEFECTS FOUND (${defects.length}): ${defects.join(" | ")}`);
}
process.exit((await qa.finish()) ? 0 : 1);
