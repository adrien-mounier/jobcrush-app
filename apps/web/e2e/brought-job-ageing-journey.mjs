// #305 — a job he brought, on his deck, and the line it starts saying about its own age. Driven as a
// human, screenshot-documented, left in the repo as a re-runnable CI asset (run with `node`, never the
// Playwright MCP).
//
// Why this exists rather than the API test alone: every claim here is "the person IS TOLD something".
// apps/api/test/broughtJobs.test.ts pins the payload — the `ageing` field, its wording, the day it
// starts — and a payload assertion passes perfectly well while the screen renders nothing at all. The
// notice's whole purpose is being read, so only a browser can report on it.
//
// What it proves, in the order he meets it:
//   AC1  a job he pasted is on his deck, PINNED above the ranked jobs we found
//   AC2  in its first days it says NOTHING about its age — on the card or on its own screen
//   AC3  from day seven the ageing line appears, naming how long ago HE pasted it and that we cannot
//        check whether it is still open
//   AC4  the deck card and the job's own screen say the SAME thing, word for word
//   AC5  a closing date the EMPLOYER stated supersedes that vague line with a true one
//   AC6  the job is still there, and still pinned, weeks after that closing date — it never expires
//
// The one thing faked, and it is the clock, never the rule: POST /qa/stack's `pasteDaysAgo` makes this
// run's paste records READ as N days old (qa-main.ts — a QA-entry-only knob, pruned from the Docker
// image). The ageing line's own input is "how long ago did this person paste it", so the product
// computes everything itself; nothing here scripts what the screen says. A journey that waited seven
// real days would be a journey nobody runs.
//
// Run:
//   pnpm --filter @jobcrush/api build
//   PORT=34101 node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:34101 npx next build && npx next start -p 34100
//   BASE_URL=http://127.0.0.1:34100 node apps/web/e2e/brought-job-ageing-journey.mjs
import { createSession } from "./qa-driver.mjs";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";
const ROLE = "IT project manager in Brussels";

/** An advert with no closing date in it — the vague-line case. */
const ADVERT = `Senior IT Project Manager — Helvara Group
Brussels, Belgium · Hybrid, three days on site

Helvara Group is looking for a Senior IT Project Manager to lead the delivery of our core banking
migration programme across Belgium and the Netherlands.

What you will do
- Own the end-to-end delivery of a multi-year transformation programme, from the business case
  through to benefits realisation.
- Coordinate business and technical stakeholders, hold the plan, and report progress to the
  steering committee every month.
- Identify, track and mitigate risks, issues and dependencies across four workstreams.

What we are looking for
- At least eight years managing IT projects, of which three on large transformation programmes.
- Excellent stakeholder communication at executive level.`;

/** The same job at another employer, WITH the one liveness signal a pasted advert can carry.
 *
 *  The date is written ISO because THIS stack's reader is canned (qa-main.ts looks for an ISO date
 *  after "applications close"; the production reader is a model that normalises "20 October 2026"
 *  itself). What this journey proves is what the product DOES with a stated closing date, not date
 *  parsing — apps/api/test/pasteAdvert.test.ts owns the reading. */
const ADVERT_WITH_CLOSING_DATE = ADVERT.replace(/Helvara Group/g, "Marne Industries").concat(
  "\n\nApplications close 2026-10-20.",
);

const SETTLE_MS = 180_000;
const JOB_SCREEN_MS = 30_000;

const qa = await createSession("brought-job-ageing-journey", { baseURL: BASE_URL });
const { page } = qa;

const defects = [];
/** One verdict, screenshotted, without stopping the run — a journey that dies on its first defect
 *  reports one defect. */
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

/** The QA clock knob. Returns what the server says it is now set to, so a run can never claim a day
 *  count the API did not accept. */
const setPasteAge = (days) =>
  page.evaluate(
    (n) =>
      fetch("/api/qa/stack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pasteDaysAgo: n }),
      })
        .then((r) => r.json())
        .catch(() => null),
    days,
  );

/** The ageing line as the screen renders it, or null when there is none. */
const ageingOnScreen = () =>
  page.evaluate(() => {
    const el = document.querySelector(".jobcard .ageing, .onejob .ageing");
    return el ? el.textContent.replace(/\s+/g, " ").trim() : null;
  });

/** The deck, past its reveal. "See them" is a press a person makes, and a journey that skips it reads
 *  an empty DOM and reports the deck as missing when it is simply still behind the reveal. */
async function openDeck(note) {
  await qa.goto("/deck", note);
  const reveal = page.locator("button.go", { hasText: "See them" });
  await reveal.waitFor({ state: "visible", timeout: SETTLE_MS }).then(
    () => qa.click('button.go:has-text("See them")', "press 'See them' — the deck mounts"),
    () => qa.note("the reveal never arrived; looking for the deck anyway"),
  );
  await settle(page.locator(".jobcard"), "the deck");
}

/** Paste one advert through the real screen and wait until he lands on the job it made. */
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
// 0) A signed-in session, because the deck is walled at the reveal for an anonymous one — and this
//    journey's first claim is about the DECK.
// ---------------------------------------------------------------------------------------------
// /discovery, not "/": the anonymous session is created here, and /auth/verify has nothing to attach
// an account to without one (a 401, which reads exactly like a limiter refusal and is not one).
// Question 1 is all it takes to give him a deck of jobs we found — the ranked deck his own job is
// pinned above (#339: no floor to answer, and a session with no CV is not held for a review).
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
await qa.note(`discovery started (HTTP ${started})`);

const signIn = await page.evaluate(async () => {
  const linkRes = await fetch("/api/auth/request-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `brought-ageing-${Date.now()}@example.com` }),
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

const armed = await setPasteAge(0);
await qa.note(`the paste clock starts where a real one does: pasteDaysAgo ${armed?.pasteDaysAgo ?? "unknown"}`);

// ---------------------------------------------------------------------------------------------
// 1) He brings a job in, and it is on his deck — above the jobs we found.
// ---------------------------------------------------------------------------------------------
const jobPath = await pasteAdvert(ADVERT, "open the paste screen and bring a job in");
await qa.scrollThrough("read the job's own screen the way somebody deciding would");

await must((await ageingOnScreen()) === null, "AC2 — on the day he pastes it, the job's own screen says nothing about its age");

await openDeck("go to the deck to find the job he just brought in");
await qa.scrollThrough("read the deck's first card");
const deckState = await page.evaluate(async () => {
  const res = await fetch("/api/onboarding/cards", { credentials: "same-origin" });
  const body = await res.json();
  return {
    ids: (body.cards ?? []).map((card) => card.adId),
    titles: (body.cards ?? []).map((card) => card.title),
    ageing: (body.cards ?? []).map((card) => card.ageing ?? null),
  };
});
await qa.note(`his deck, in the order it is served: ${JSON.stringify(deckState.titles)}`);
const broughtId = deckState.ids[0];
const firstCardTitle = (await page.locator(".jobcard h2").first().textContent().catch(() => "")) || "";
await must(
  firstCardTitle.includes("Senior IT Project Manager"),
  `AC1 — the job he brought is the first card on his deck, above the ${Math.max(deckState.ids.length - 1, 0)} we found ("${firstCardTitle.trim()}")`,
);
await must((await ageingOnScreen()) === null, "AC2 — and its deck card says nothing about its age either, in these first days");

// ---------------------------------------------------------------------------------------------
// 2) A week passes. The card starts telling him how old it is.
// ---------------------------------------------------------------------------------------------
const aged = await setPasteAge(9);
await qa.note(`nine days pass (pasteDaysAgo ${aged?.pasteDaysAgo}) — the stored record is untouched, it simply reads as older`);

await openDeck("come back to the deck nine days after he brought that job in");
const deckAgeing = await ageingOnScreen();
await qa.note(`what the deck card now says about its own age: "${deckAgeing}"`);
await must(
  deckAgeing !== null && /9 days ago/.test(deckAgeing),
  `AC3 — from day seven the deck card says how long ago HE pasted it ("${deckAgeing}")`,
);
await must(
  deckAgeing !== null && /cannot check/i.test(deckAgeing),
  "AC3 — and says plainly that we cannot check whether it is still open",
);

await qa.goto(jobPath, "open the job's own screen at the same age");
await settle(page.locator(".onejob .jobcard"), "the job's own card", JOB_SCREEN_MS);
await qa.scrollThrough("read the ageing line where he reads it before deciding");
const screenAgeing = await ageingOnScreen();
await must(
  screenAgeing === deckAgeing,
  `AC4 — the job's own screen says exactly what its deck card says ("${screenAgeing}")`,
);

// ---------------------------------------------------------------------------------------------
// 3) A second job, this one with a closing date the employer stated. The true line replaces the
//    vague one — and the job is still there long after that date.
// ---------------------------------------------------------------------------------------------
await setPasteAge(0);
const datedPath = await pasteAdvert(ADVERT_WITH_CLOSING_DATE, "bring in a second job, whose advert states a closing date");
const datedAged = await setPasteAge(40);
// The knob moves HIS paste clock, not the calendar — so the advert's own 20 October is still ahead,
// and the line he gets is the employer's "close on", not its "closed on". That the two wordings differ
// by tense is apps/api/test/broughtJobs.test.ts's business; what matters here is that the stated date
// takes the vague line's place at all, and that forty days do not remove the job.
await qa.note(`forty days pass (pasteDaysAgo ${datedAged?.pasteDaysAgo}) — six weeks after HE brought this one in`);

await qa.goto(datedPath, "open that job's own screen");
await settle(page.locator(".onejob .jobcard"), "the job's own card", JOB_SCREEN_MS);
const datedLine = await ageingOnScreen();
await qa.note(`what it says now: "${datedLine}"`);
await must(
  datedLine !== null && /employer said/i.test(datedLine) && /October/.test(datedLine),
  `AC5 — the employer's own closing date supersedes the vague line ("${datedLine}")`,
);
await must(
  datedLine !== null && !/cannot check/i.test(datedLine),
  "AC5 — and it replaces that line rather than being added beside it",
);

await openDeck("go back to the deck with both brought jobs weeks old");
const late = await page.evaluate(async () => {
  const body = await fetch("/api/onboarding/cards", { credentials: "same-origin" }).then((r) => r.json());
  return { ids: (body.cards ?? []).map((c) => c.adId), count: (body.cards ?? []).length };
});
await qa.note(`his deck weeks later: ${late.count} cards, the first two being the jobs he brought`);
await must(
  late.ids.length > 2 && late.ids.includes(broughtId),
  "AC6 — the jobs he brought are still on the deck weeks later, and took nothing else down with them",
);
await must(
  late.ids.indexOf(broughtId) < 2,
  "AC6 — and they are still pinned above the ranked jobs, newest of them first",
);

// ---------------------------------------------------------------------------------------------
// 4) The pinned order, read off the RENDERED deck rather than the payload. He meets the cards one at
//    a time, so "pinned above the ranked jobs, newest first" is only true if the SCREEN hands them
//    over in that order. Both brought adverts carry the same title on purpose — the employer is what
//    tells them apart, so this cannot pass on a title match. ("Not for me" is a client-side index
//    advance, nothing is recorded, so walking the band costs him nothing.)
// ---------------------------------------------------------------------------------------------
await openDeck("walk the deck card by card, the way he meets it");
const rendered = [];
for (let seat = 0; seat < 3; seat += 1) {
  await settle(page.locator(".jobcard"), `the card in seat ${seat + 1}`, JOB_SCREEN_MS);
  rendered.push({
    seat: seat + 1,
    title: ((await page.locator(".jobcard h2").first().textContent().catch(() => "")) || "").trim(),
    employer: ((await page.locator(".jobcard .co").first().textContent().catch(() => "")) || "")
      .replace(/\s+/g, " ")
      .trim(),
    ageing: await ageingOnScreen(),
  });
  if (seat < 2) {
    await qa.click('.jcfoot button[aria-label="Not for me, show next job"]', "press 'Not for me' to meet the next job");
  }
}
await qa.note(`the deck as he meets it, card by card: ${JSON.stringify(rendered)}`);
await must(
  /Marne Industries/.test(rendered[0].employer),
  `AC1 — the job he brought MOST RECENTLY is the first card on the rendered deck ("${rendered[0].employer}")`,
);
await must(
  /Helvara Group/.test(rendered[1].employer),
  `AC1 — the one he brought before it is second, so the band is newest first ("${rendered[1].employer}")`,
);
await must(
  rendered[2].employer !== "" && !/Marne Industries|Helvara Group/.test(rendered[2].employer),
  `AC1 — and the third card is a job WE found, so his band really does sit ABOVE the ranked deck ("${rendered[2].employer}")`,
);
await must(
  rendered[1].ageing !== null && /cannot check/i.test(rendered[1].ageing),
  `AC3 — the ageing line is on the card as a person sees it, not only in the payload ("${rendered[1].ageing}")`,
);
await must(
  rendered[2].ageing === null,
  "AC3 — and a job WE found says nothing about its age, so the notice stays the brought job's own",
);

// ---------------------------------------------------------------------------------------------
// 5) The pinned card's own action. A pinned card whose button dead-ends would be worse than no card
//    at all, and a job he brought is the one kind that can never drop out of a provider's answer —
//    so it is also the one whose handoff would 404 if the tailor door did not know about it.
// ---------------------------------------------------------------------------------------------
await openDeck("come back to the deck and press the pinned card's own button");
await qa.click(
  '.jcfoot button[aria-label="I want this one, tailor this job"]',
  "press 'I want this one' on the job he brought",
);
const landedOnTailor = await page.waitForURL(/\/tailor/, { timeout: 45_000 }).then(
  () => true,
  () => false,
);
const deckErrors = await page.locator(".deckerr").count();
await qa.note(`after the press: ${page.url()} (${deckErrors} error banner(s) on the deck)`);
await must(
  landedOnTailor && deckErrors === 0,
  `AC — the pinned card's own action hands him to tailoring instead of dead-ending (now at ${new URL(page.url()).pathname})`,
);

// ---------------------------------------------------------------------------------------------
// 6) A provider blackout. The jobs he brought depend on nobody, so they are still there — and the
//    deck is an ORDINARY deck, not an apology: no outage screen, none of its words. A fresh session,
//    because the outage has to be what its FIRST deck read meets.
// ---------------------------------------------------------------------------------------------
await qa.context.clearCookies();
const outage = await page.evaluate(() =>
  fetch("/api/qa/stack", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ retrievalOutcome: "provider_unavailable" }),
  })
    .then((r) => r.json())
    .catch(() => null),
);
await qa.note(`every job provider goes unreachable (retrievalOutcome ${outage?.retrievalOutcome})`);

await qa.goto("/discovery", "a fresh visitor lands on discovery during the blackout");
await page.evaluate(
  (role) =>
    fetch("/api/onboarding/discovery/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    }).then((r) => r.status),
  ROLE,
);
const signIn2 = await page.evaluate(async () => {
  const linkRes = await fetch("/api/auth/request-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `brought-blackout-${Date.now()}@example.com` }),
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
await qa.note(`the blackout visitor signs in — request-link ${signIn2.requestLink}, verify ${signIn2.status}`);

// The control first: with nothing of his own, a blackout IS an apology, and it should be.
await qa.goto("/deck", "go to the deck with nothing brought and every provider down");
const revealDown = page.locator("button.go", { hasText: "See them" });
await revealDown.waitFor({ state: "visible", timeout: 20000 }).then(
  () => qa.click('button.go:has-text("See them")', "press 'See them'"),
  () => qa.note("no reveal during the blackout — the outage screen comes straight up"),
);
await settle(page.locator(".loadstate"), "the outage screen", 30000);
const outageWords = async () => {
  const body = ((await page.locator("body").textContent().catch(() => "")) || "").replace(/\s+/g, " ");
  return {
    apology: /We couldn't look for jobs just now\./.test(body) || /Something on our side didn't answer\./.test(body),
    cards: await page.locator(".jobcard").count(),
  };
};
const down = await outageWords();
await qa.note(`the blackout deck with nothing brought: ${down.cards} card(s), apology shown: ${down.apology}`);
await must(down.apology && down.cards === 0, "control — with nothing of his own, a blackout honestly says our side did not answer");

// Now he brings one in.
const outagePath = await pasteAdvert(ADVERT, "he brings a job in while every provider is still down");
await qa.note(`the job he brought during the blackout lives at ${outagePath}`);
await openDeck("go to the deck during the blackout, with one job of his own on it");
const withHis = await outageWords();
await qa.scrollThrough("read the deck he is given during the blackout");
await must(
  withHis.cards >= 1,
  `AC — the job he brought is on his deck even with every provider unreachable (${withHis.cards} card(s) rendered)`,
);
await must(
  !withHis.apology,
  "AC — and it is an ORDINARY deck: not one word of our outage on the screen he is given",
);
const outageTitle = ((await page.locator(".jobcard h2").first().textContent().catch(() => "")) || "").trim();
await must(
  /Senior IT Project Manager/.test(outageTitle),
  `AC — the card he is shown is his own job, not a leftover of ours ("${outageTitle}")`,
);

await page.evaluate(() =>
  fetch("/api/qa/stack", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ retrievalOutcome: "relevant_postings" }),
  }).catch(() => null),
);

await setPasteAge(0); // put the knob back for whatever journey runs next

if (defects.length > 0) {
  await qa.note(`DEFECTS FOUND (${defects.length}): ${defects.join(" | ")}`);
}
process.exit((await qa.finish()) ? 0 : 1);
