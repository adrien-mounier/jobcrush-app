import { expect, test, type Page } from "@playwright/test";
import type { ScoredJobCard, TailorDraftView, TailorState } from "../lib/api";

// #23 Tailor (screen 3), as #415 (ADR-0020) reshaped it: the step asks only the profile questions
// (work rights, a language) and then writes the CV — the draft is the page, with a side rail that
// lists what the job asks that the CV does not meet, and a "Where you fit" sheet in the job's own
// order. Stubbed at the route layer exactly like deck.spec.ts's screen 2b tests: every call is
// mocked and this rides straight to /tailor (deck.spec.ts already covers the /deck ->
// tailorHandoff -> /tailor bridge itself).

// #117: ScoredJobCard, not the JobCard union — TailorState.card is never the deck's pending variant.
const CARD_FIRST: ScoredJobCard = {
  schemaVersion: "1",
  adId: "ad-1",
  title: "Senior IT Project Manager",
  company: "Atos",
  place: "Paris 15e",
  salary: null,
  pattern: null,
  scored: "judged",
  matchPct: 61,
  breakdown: {
    essential: { met: 0, total: 1 },
    desirable: { met: 0, total: 1 },
  },
  bubble: {
    hit: "Your budget and the ERP migration are the two things they lead with.",
    open: "The gap is their SAP version.",
  },
  // #407: a fit row is a requirement met, by its text — never a CV line.
  fit: [{ id: "budget", text: "Own a €2M budget" }],
  dontYet: [
    { id: "sap", band: "essential", requirement: "Their SAP version" },
    { id: "public", band: "standard", requirement: "Public-sector delivery" },
  ],
  askedClosed: [],
  adExcerpt: "Lead the replacement of a legacy finance platform across four European sites.",
};

// #415: nothing open about eligibility — the draft is the first thing the person sees. The
// requirements list is the job's own order (budget, sap, public), never re-sorted by band.
const STATE_DRAFT: TailorState = {
  card: CARD_FIRST,
  questions: [],
  requirements: [
    { id: "budget", text: "Own a €2M budget", state: "met" },
    { id: "sap", text: "Their SAP version", state: "gap" },
    { id: "public", text: "Public-sector delivery", state: "gap" },
  ],
  factCount: 24,
};

async function stubSession(page: Page) {
  await page.route("**/api/sessions/me", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
}

// #310 — the draft: the CV brain's rendered document plus the re-homed #154 disclosure.
const DRAFT_VIEW: TailorDraftView = {
  html:
    "<!doctype html><html><body><h1>Maria Kowalski</h1>" +
    "<li>Led the checkout replatforming, delivered 2 months early</li></body></html>",
  disclosure: [
    {
      employer: "Nordic Retail Group",
      role: "IT Project Manager",
      factCount: 9,
      heldBack: ["Ran the PCI certification audit end to end"],
      overfull: [
        {
          text: "Led the checkout replatforming and managed the vendor budget",
          count: 2,
          lostResult: true,
          sources: ["Led the checkout replatforming", "Managed a budget of EUR 1.2M"],
        },
      ],
    },
  ],
  conservationNotices: [
    "Your languages could not be placed on this draft. You can retry the draft or add them when you review.",
  ],
  draftedAt: "2026-09-30T08:00:00.000Z",
};

/** The draft endpoints, stubbed on the checkpoint-hit path by default: POST answers `ready`, GET
 *  hands the view. Counts the POSTs so a test can prove the draft really started by itself. */
async function stubDraft(page: Page, view: TailorDraftView = DRAFT_VIEW) {
  const posts = { count: 0 };
  await page.route("**/api/onboarding/tailor/draft", async (route) => {
    if (route.request().method() === "POST") {
      posts.count += 1;
      await route.fulfill({ json: { ready: true } });
    } else await route.fulfill({ json: view });
  });
  return posts;
}

async function openTailor(page: Page, state: TailorState) {
  await stubSession(page);
  const posts = await stubDraft(page);
  await page.route("**/api/onboarding/tailor", async (route) => {
    await route.fulfill({ json: state });
  });
  await page.goto("/tailor");
  return posts;
}

async function stubDrop(page: Page) {
  await page.route("**/api/onboarding/tailor/drop", async (route) => {
    await route.fulfill({ json: { stage: "deck" } });
  });
}

// What the person must never see again on this screen (#415 AC3/AC4), paired below with the
// positive assertions on what replaced them so a rename cannot pass the negatives silently.
const RETIRED = [/\+\d+%/, /I'm done/, /Changed\? Add it/, /Does that describe you\?/];

test("#30 a signed-out visitor opening /tailor directly is routed to the deck, then the wall — never stuck on a retry-only error", async ({
  page,
}) => {
  await stubSession(page);
  await page.route("**/api/onboarding/tailor", async (route) => {
    await route.fulfill({
      status: 401,
      json: { error: { code: "login_required", message: "sign in first" } },
    });
  });
  await page.route("**/api/onboarding/cards", async (route) => {
    await route.fulfill({ json: { cards: [CARD_FIRST], authed: false } });
  });

  await page.goto("/tailor");

  await page.waitForURL("/deck");
  await page.getByRole("button", { name: "See them" }).click();
  await expect(page.getByRole("link", { name: "Continue with Google" })).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// #415 — the draft is the page; a requirement is never a question.
// ---------------------------------------------------------------------------------------------

test("#415 with nothing open about eligibility, no question appears: the CV is being written, then the draft is the page", async ({
  page,
}) => {
  await stubSession(page);
  await page.route("**/api/onboarding/tailor", async (route) => {
    await route.fulfill({ json: STATE_DRAFT });
  });
  let draftPosts = 0;
  await page.route("**/api/onboarding/tailor/draft", async (route) => {
    if (route.request().method() === "POST") {
      draftPosts += 1;
      // Hold the 202 briefly so the writing line is assertable, not a flash.
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({ status: 202, json: { jobId: "draft-job-1" } });
    } else {
      await route.fulfill({ json: DRAFT_VIEW });
    }
  });
  await page.route("**/api/jobs/draft-job-1/events", async (route) => {
    const snapshot = { id: "draft-job-1", status: "completed", error: null, progress: { tailorDraft: { ready: true } } };
    await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(snapshot)}\n\n` });
  });

  await page.goto("/tailor");

  // The draft starts by itself, in the screen's own voice — no question screen first.
  await expect(page.getByText("Writing your CV for this job…")).toBeVisible();
  await expect(page.locator(".tailor .ask .q")).toHaveCount(0);
  expect(draftPosts).toBeGreaterThan(0);

  // Then the draft is the page, headed by the job, with the one approve press beneath it.
  await expect(page.locator(".draft-frame")).toBeVisible();
  await expect(page.locator(".draft-frame")).toHaveAttribute("srcdoc", /Maria Kowalski/);
  const heading = page.getByRole("heading", { name: "Senior IT Project Manager" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByRole("img", { name: "61% match" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve and email me this CV" })).toBeVisible();

  // Nothing of the retired queue remains on the screen.
  for (const words of RETIRED) await expect(page.locator(".tailor")).not.toContainText(words);
  await expect(page.locator(".tailor .ask")).toHaveCount(0);
});

test("#415 an open work-rights question comes first, told it will be remembered; answering it starts the draft", async ({
  page,
}) => {
  const posts = await openTailor(page, { ...STATE_DRAFT, questions: [PROFILE_Q] });
  await stubProfileAnswer(page, { changed: AFTER_YES, state: STATE_DRAFT });

  // Before the answer: the permanent question, the remember line, two answers and the skip.
  await expect(page.locator(".tailor .ask .q")).toHaveText(PROFILE_Q.question);
  await expect(page.locator(".tailor .ask .notice")).toHaveText(PROFILE_Q.remember);
  await expect(page.locator(".tailor .opts .opt")).toHaveCount(2);
  await expect(page.locator(".tailor .ask .skip")).toHaveText("Not sure yet");
  await expect(page.locator(".draft-frame")).toHaveCount(0);
  expect(posts.count).toBe(0); // the draft waits for the answer

  await page.getByRole("button", { name: "Yes — no sponsorship needed" }).click();

  // After: the one line saying what changed, and the draft — no requirement question follows.
  await expect(page.locator(".tailor .ledger")).toHaveText(AFTER_YES);
  await expect(page.locator(".draft-frame")).toBeVisible();
  await expect(page.locator(".tailor .ask .q")).toHaveCount(0);
  expect(posts.count).toBeGreaterThan(0);
  for (const words of RETIRED) await expect(page.locator(".tailor")).not.toContainText(words);
});

test("#415 'Not sure yet' stores nothing and still starts the draft", async ({ page }) => {
  const posts = await openTailor(page, { ...STATE_DRAFT, questions: [PROFILE_Q] });
  const answers: string[] = [];
  await page.route("**/api/onboarding/tailor/profile-answer", async (route) => {
    answers.push((route.request().postDataJSON() as { answer: string }).answer);
    await route.fulfill({ json: { changed: SKIPPED_LINE, state: STATE_DRAFT } });
  });

  await page.locator(".tailor .ask .skip").click();

  await expect(page.locator(".tailor .ledger")).toHaveText(SKIPPED_LINE);
  await expect(page.locator(".draft-frame")).toBeVisible();
  expect(answers).toEqual(["Not sure yet"]); // posted as the skip, which the server stores nothing for
  expect(posts.count).toBeGreaterThan(0);
});

test("#415 'Also asked, not on your CV' lists the unmet and denied requirements in the job's order, with no button", async ({
  page,
}) => {
  await openTailor(page, STATE_DRAFT);

  const gaps = page.getByRole("region", { name: "Also asked, not on your CV" });
  await expect(gaps).toBeVisible();
  await expect(gaps.getByRole("listitem")).toHaveText(["Their SAP version", "Public-sector delivery"]);
  await expect(gaps.getByRole("button")).toHaveCount(0);
  await expect(gaps.getByRole("link")).toHaveCount(0);
  // The met requirement is not on the list — it is on the sheet, as met.
  await expect(gaps).not.toContainText("Own a €2M budget");
});

test("#415 'Where you fit' opens as a side sheet on a computer, every requirement in the job's order", async ({ page }) => {
  await openTailor(page, STATE_DRAFT);

  const trigger = page.getByRole("button", { name: "Where you fit · 1 of 3" });
  await trigger.click();

  const sheet = page.getByRole("dialog", { name: /Where you fit/ });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".marks li .t")).toHaveText(["Own a €2M budget", "Their SAP version", "Public-sector delivery"]);
  await expect(sheet.locator(".marks li .s")).toHaveText(["met", "not on your CV", "not on your CV"]);
  // A side sheet: docked to the right edge, the full height of the screen (measured once its
  // rise has finished, not mid-flight).
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const box = (await sheet.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThan(viewport.width / 2);
  expect(Math.round(box.x + box.width)).toBe(viewport.width);
  expect(Math.round(box.height)).toBe(viewport.height);
  await expect(sheet.getByRole("button", { name: "Close" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("#415 on a phone the draft comes first and 'Where you fit' is a pull-up", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTailor(page, STATE_DRAFT);

  await expect(page.locator(".draft-frame")).toBeVisible();
  const paper = (await page.locator(".tailor .paper-col").boundingBox())!;
  const rail = (await page.locator(".tailor .rail").boundingBox())!;
  expect(paper.y).toBeLessThan(rail.y);
  expect(Math.round(paper.width)).toBeLessThanOrEqual(390);

  await page.getByRole("button", { name: /Where you fit/ }).click();
  const sheet = page.getByRole("dialog", { name: /Where you fit/ });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".marks li .t")).toHaveText(["Own a €2M budget", "Their SAP version", "Public-sector delivery"]);
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished))); // measure after the rise
  const box = (await sheet.boundingBox())!;
  expect(Math.round(box.width)).toBe(390);
  expect(Math.abs(box.y + box.height - 844)).toBeLessThanOrEqual(1); // docked to the bottom edge (a 1px border)
  expect(box.y).toBeGreaterThan(0);
});

test("#415 the draft screen keeps Save and Drop; Drop shows the reassurance inline, Esc keeps it, Drop it returns to the deck", async ({
  page,
}) => {
  await openTailor(page, STATE_DRAFT);
  await stubDrop(page);
  await expect(page.locator(".draft-frame")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save it and come back later" })).toBeVisible();

  const dropTrigger = page.getByRole("button", { name: "Drop this job" });
  await dropTrigger.click();

  await expect(page.getByText("Everything you told me stays on your profile.")).toBeVisible();
  const dropIt = page.getByRole("button", { name: "Drop it" });
  await expect(dropIt).toBeFocused();

  // Esc keeps the job — no request fires, the confirm collapses, focus returns to the trigger.
  await page.keyboard.press("Escape");
  await expect(page.getByText("Everything you told me stays on your profile.")).toHaveCount(0);
  await expect(dropTrigger).toBeFocused();

  await dropTrigger.click();
  await page.getByRole("button", { name: "Drop it" }).click();
  await page.waitForURL("/deck");
});

// QA on #407: the reason under a "Where you fit" row shared its class name with the tailor's own
// uppercase mono eyebrow (`.tailor .why`), so on this screen it read "YOU HAVE DONE THIS BEFORE."
// It is a sentence, in the body face, on the deck and here alike. The card renders on the
// question screen (#415), so that is where it is checked.
test("#407 the reason under a Where you fit row reads as a sentence on the tailor screen", async ({ page }) => {
  await openTailor(page, {
    ...STATE_DRAFT,
    questions: [PROFILE_Q],
    card: { ...CARD_FIRST, fit: [{ id: "budget", text: "Own a €2M budget", reason: "You have owned a budget this size." }] },
  });
  const why = page.locator(".tailor .row.fit .fit-why");
  await expect(why).toHaveText("You have owned a budget this size.");
  await expect(why).toHaveCSS("text-transform", "none");
  const eyebrowFont = await page.locator(".tailor p.why").evaluate((el) => getComputedStyle(el).fontFamily);
  expect(await why.evaluate((el) => getComputedStyle(el).fontFamily)).not.toBe(eyebrowFont);
});

// #397: the announcer never prints an empty slot — no "Tailoring . 61% match." for a job with no
// title, no "61% match. ." before any after-line lands.
test("#397 the announcer omits a missing title and a missing after-line instead of an empty slot", async ({ page }) => {
  await openTailor(page, { ...STATE_DRAFT, questions: [PROFILE_Q] });
  const live = page.locator('.tailor [aria-live="polite"]');
  await expect(live).toHaveText("Tailoring Senior IT Project Manager. 61% match.");
});

test("#397 a job with no title announces the number alone", async ({ page }) => {
  await openTailor(page, { ...STATE_DRAFT, card: { ...CARD_FIRST, title: "" } });
  await expect(page.locator('.tailor [aria-live="polite"]')).toHaveText("61% match.");
});

// ---------------------------------------------------------------------------------------------
// #307 / #308 — the queue's PROFILE-LEVEL questions: permanent, told before and after, own door.
// ---------------------------------------------------------------------------------------------

const PROFILE_Q = {
  requirementId: "eligibility-work-rights-hong-kong",
  kind: "profile" as const,
  question: "Can you already work in Hong Kong without visa sponsorship?",
  options: ["Yes — no sponsorship needed", "Not yet — I'd need sponsorship"],
  remember: "I'll remember this for every job in Hong Kong.",
  market: "Hong Kong",
  skip: "Not sure yet", // #308: the third option — stores nothing, returns on the next job
};

const AFTER_YES = "Remembered: you can work in Hong Kong. No job will ask you this again.";
const AFTER_NO = "Hidden 2 Hong Kong jobs from your deck — change this any time in your profile.";
const SKIPPED_LINE = "Nothing saved — I'll ask again on another job in Hong Kong.";

function stubProfileAnswer(page: Page, response: { changed: string; state: TailorState | null }) {
  return page.route("**/api/onboarding/tailor/profile-answer", async (route) => {
    await route.fulfill({ json: response });
  });
}

test("#307 a profile answer that withdrew the job lands the gone screen: the honest line and the way back", async ({
  page,
}) => {
  await openTailor(page, { ...STATE_DRAFT, questions: [PROFILE_Q] });
  await stubProfileAnswer(page, { changed: AFTER_NO, state: null });

  await page.getByRole("button", { name: "Not yet — I'd need sponsorship" }).click();

  const heading = page.getByRole("heading", { name: "Saved to your profile" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.locator(".loadstate p")).toHaveText(AFTER_NO);

  await page.getByRole("button", { name: "Back to the deck" }).click();
  await page.waitForURL("/deck");
});

// The ladder, as the queue serves it (tailorProfile.ts's LanguageProfileAsk): six situations,
// descending, the one answer with a cost last, and "Not now" as the way out.
const LANGUAGE_Q = {
  requirementId: "mandarin-advantage",
  kind: "profile" as const,
  question: "How comfortable are you working in Mandarin?",
  why: 'This job asks about Mandarin: "Mandarin is an advantage when working with the regional vendors".',
  consequence:
    "Only the last one takes jobs out of your deck — every other answer keeps them all, even if this job wants more than you picked.",
  remember: "I'll remember this for every job.",
  options: [
    "I speak it like my first language",
    "I can negotiate a contract in it",
    "I can run a meeting in it",
    "I get by day to day",
    "I know a few words",
    "I don't speak this one",
  ],
  skip: "Not now",
};

test("#308 the graded language question: why and cost before six rungs, the costly answer last, 'Not now' offered; then the draft", async ({
  page,
}) => {
  await openTailor(page, { ...STATE_DRAFT, questions: [PROFILE_Q, LANGUAGE_Q] });
  // The work-rights question leads; the ladder is the second and last thing asked.
  await page.route("**/api/onboarding/tailor/profile-answer", async (route) => {
    const { requirementId } = route.request().postDataJSON() as { requirementId: string };
    if (requirementId === PROFILE_Q.requirementId)
      await route.fulfill({ json: { changed: AFTER_YES, state: { ...STATE_DRAFT, questions: [LANGUAGE_Q] } } });
    else
      await route.fulfill({
        json: { changed: "Remembered for Mandarin: I get by day to day. No job will ask you this again.", state: STATE_DRAFT },
      });
  });
  await page.getByRole("button", { name: "Yes — no sponsorship needed" }).click();

  await expect(page.locator(".tailor .ask .q")).toHaveText(LANGUAGE_Q.question);
  // Why THIS advert asks, the remember line, and the cost — all said BEFORE the rungs.
  await expect(page.locator(".tailor .ask .notice").nth(0)).toHaveText(LANGUAGE_Q.why);
  await expect(page.locator(".tailor .ask .notice").nth(1)).toHaveText(LANGUAGE_Q.remember);
  await expect(page.locator(".tailor .ask .cost")).toHaveText(LANGUAGE_Q.consequence);
  const beforeRungs = await page.evaluate(() => {
    const ask = document.querySelector(".tailor .ask")!;
    const kids = [...ask.querySelectorAll(".cost, .opts")];
    return kids.length === 2 && kids[0]!.classList.contains("cost");
  });
  expect(beforeRungs).toBe(true);
  // Graded, never Yes/No: the six situations, with the one costly answer LAST.
  const rungs = page.locator(".tailor .opts .opt");
  await expect(rungs).toHaveCount(6);
  await expect(rungs.first()).toHaveText("I speak it like my first language");
  await expect(rungs.last()).toHaveText("I don't speak this one");
  await expect(page.locator(".tailor .ask .skip")).toHaveText("Not now");

  await page.getByRole("button", { name: "I get by day to day" }).click();

  await expect(page.locator(".tailor .ledger")).toHaveText(
    "Remembered for Mandarin: I get by day to day. No job will ask you this again.",
  );
  await expect(page.locator(".draft-frame")).toBeVisible();
});

// #398: the owner's English answer took ~8 s on staging and the screen sat still — he clicked again.
// While an answer posts, the screen says it is saving; once it lands, the line goes.
test("#398 a slow answer says it is saving until it lands", async ({ page }) => {
  await openTailor(page, { ...STATE_DRAFT, questions: [LANGUAGE_Q] });
  let land!: () => void;
  const landed = new Promise<void>((resolve) => (land = resolve));
  await page.route("**/api/onboarding/tailor/profile-answer", async (route) => {
    await landed;
    await route.fulfill({ json: { changed: "Remembered for Mandarin: I can negotiate a contract in it.", state: STATE_DRAFT } });
  });

  await page.getByRole("button", { name: "I can negotiate a contract in it" }).click();
  await expect(page.locator(".tailor .ask").getByRole("status")).toHaveText("Saving your answer…");

  land();
  await expect(page.locator(".draft-frame")).toBeVisible();
  await expect(page.locator(".tailor .ask")).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// #309 — the score stops flattering: a fall renders with its cause, a withdrawal names its
// reason on the gone screen, and a brought job that stays says why in one line.
// ---------------------------------------------------------------------------------------------

const LANGUAGE_KEPT_LOW =
  "Remembered. Jobs that need Mandarin will stay off your deck.";
const WITHDRAW_REASON =
  "This job needs the right to work in Hong Kong, and your answer says you don't have it — so it has come off your deck.";
const STAYED_LINE =
  "You brought this job, so it stays and I'll draft for it — but it needs the right to work in Hong Kong, and that gap is real.";

test("#309 a permanent answer that lowers the score shows the lower number on the draft screen and names the fall's size with its cause", async ({
  page,
}) => {
  await openTailor(page, { ...STATE_DRAFT, questions: [LANGUAGE_Q] });
  await stubProfileAnswer(page, {
    changed: LANGUAGE_KEPT_LOW,
    state: { ...STATE_DRAFT, card: { ...STATE_DRAFT.card, matchPct: 49 } },
  });

  await expect(page.getByRole("img", { name: "61% match" })).toBeVisible();
  await page.getByRole("button", { name: "I don't speak this one" }).click();

  // The fall is shown with its cause: the drop's size prefixed onto the answer's own line, kept
  // visible on the draft screen the answer led to…
  await expect(page.locator(".tailor .ledger")).toHaveText(`Down 12% — ${LANGUAGE_KEPT_LOW}`);
  await expect(page.locator(".draft-frame")).toBeVisible();
  // …and the number really falls — no client-side clamp holds it at 61.
  await expect(page.getByRole("img", { name: "49% match" })).toBeVisible();
  await expect(page.getByRole("img", { name: "61% match" })).toHaveCount(0);
});

test("#309 a withdrawal mid-tailor names its reason on the gone screen, above the honest count", async ({ page }) => {
  await openTailor(page, { ...STATE_DRAFT, questions: [PROFILE_Q] });
  await page.route("**/api/onboarding/tailor/profile-answer", async (route) => {
    await route.fulfill({ json: { changed: AFTER_NO, state: null, withdrawal: WITHDRAW_REASON } });
  });

  await page.getByRole("button", { name: "Not yet — I'd need sponsorship" }).click();

  await expect(page.getByRole("heading", { name: "Saved to your profile" })).toBeVisible();
  await expect(page.locator(".loadstate .gone-reason")).toHaveText(WITHDRAW_REASON);
  await expect(page.locator(".loadstate p:not(.gone-reason)")).toHaveText(AFTER_NO);
});

test("#309 a brought job that stays despite the gap says why, on the question screen and beside the draft", async ({ page }) => {
  await openTailor(page, { ...STATE_DRAFT, questions: [PROFILE_Q], stayed: STAYED_LINE });
  await expect(page.locator(".tailor .ask .stayed")).toHaveText(STAYED_LINE);

  await openTailor(page, { ...STATE_DRAFT, stayed: STAYED_LINE });
  await expect(page.locator(".draft-frame")).toBeVisible();
  await expect(page.locator(".tailor .rail .stayed")).toHaveText(STAYED_LINE);
});

// --- #310: the draft is the CV brain's, and it shows what it held back ---

test("#310 the draft screen renders the real document and the re-homed #154 panel — held-back facts, over-full line, notice", async ({
  page,
}) => {
  await openTailor(page, STATE_DRAFT);

  // The document reaches the screen: the sandboxed frame is visible and carries the server render.
  const frame = page.locator(".draft-frame");
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("srcdoc", /Maria Kowalski/);
  await expect(frame).toHaveAttribute("srcdoc", /Led the checkout replatforming/);

  // The #154 disclosure, beside the draft: the choice (held back), in the profile's own words,
  // behind its "show them" control…
  const panel = page.locator(".disclose");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Nordic Retail Group — IT Project Manager");
  await expect(panel).toContainText("9 facts");
  await expect(page.getByText("Ran the PCI certification audit end to end")).toBeHidden();
  await panel.locator("summary").click();
  await expect(page.getByText("Ran the PCI certification audit end to end")).toBeVisible();
  // …and the fault (an over-full line), worded as ours, never dressed up as a choice.
  await expect(panel).toContainText("One printed line carries 2 facts at once");
  await expect(panel).toContainText("“Led the checkout replatforming and managed the vendor budget”");

  // A lossy ship's plain-words notice reaches the same screen.
  await expect(
    page.getByText("Your languages could not be placed on this draft.", { exact: false }),
  ).toBeVisible();

  // And the one real press is there beneath it — the #313 approve-is-send press.
  await expect(page.getByRole("button", { name: "Approve and email me this CV" })).toBeVisible();
});

test("#310 a failed draft says so in plain words, and Try again really retries", async ({ page }) => {
  await stubSession(page);
  await page.route("**/api/onboarding/tailor", async (route) => {
    await route.fulfill({ json: STATE_DRAFT });
  });
  // Every build attempt fails first (an attempt COUNTER would break under React strict mode's
  // double mount — dev runs every effect twice, so the very first paint already makes two POSTs);
  // the route is REPLACED with the succeeding one once the failure screen is really on screen.
  const draftPost = (response: { status?: number; json: unknown }) => async (route: import("@playwright/test").Route) => {
    if (route.request().method() !== "POST") return void (await route.fulfill({ json: DRAFT_VIEW }));
    await route.fulfill(response);
  };
  await page.route("**/api/onboarding/tailor/draft", draftPost({ status: 202, json: { jobId: "draft-job-2" } }));
  await page.route("**/api/jobs/draft-job-2/events", async (route) => {
    // The server's own plain words ride in the job record (tailorDraft.ts's DRAFT_FAILURE) — the
    // screen renders THESE, not a hardcoded twin.
    const snapshot = {
      id: "draft-job-2",
      status: "failed",
      error: "draft_failed",
      progress: {
        tailorDraft: {
          failure: {
            cameBack: "We could not finish writing this CV.",
            fix: "Press Try again — everything you answered is saved, and nothing already done is re-done.",
          },
        },
      },
    };
    await route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify(snapshot)}\n\n`,
    });
  });

  await page.goto("/tailor");

  await expect(page.getByText("We could not finish writing this CV.")).toBeVisible();
  await expect(page.getByText("nothing already done is re-done", { exact: false })).toBeVisible();
  // The retry hits the checkpoint path and succeeds.
  await page.unroute("**/api/onboarding/tailor/draft");
  await page.route("**/api/onboarding/tailor/draft", draftPost({ json: { ready: true } }));
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".draft-frame")).toBeVisible();
});

test("#314 over two pages: the press narrates the shortening, then 'sent' says plainly what the email says", async ({
  page,
}) => {
  await openTailor(page, STATE_DRAFT);
  await page.route("**/api/onboarding/tailor/approve", async (route) => {
    await route.fulfill({ status: 202, json: { jobId: "export-job-314" } });
  });
  // The server's own words (tailorExport.ts's PAGE_NOTICES.tightened) ride in the job record — the
  // screen renders THESE. The first stream serves the mid-run "tightening" snapshot and closes;
  // the browser reconnects and the second serves the end, so the shortening line is assertable.
  const pageNotice =
    "Your approved draft ran to 3 pages, so we shortened it to fit two. " +
    "The CV attached is shorter than the draft you approved: read it before you send it.";
  let streams = 0;
  await page.route("**/api/jobs/export-job-314/events", async (route) => {
    const snapshot =
      streams++ === 0
        ? { id: "export-job-314", status: "running", error: null, progress: { tailorExport: { step: "tightening", pages: 3 } } }
        : {
            id: "export-job-314",
            status: "completed",
            error: null,
            progress: {
              tailorExport: {
                step: "sent",
                pages: 2,
                email: "maria@example.com",
                // The draft's own lint notice travels too, and is already on the screen below —
                // only the page rule's words are new here.
                notices: [...DRAFT_VIEW.conservationNotices, pageNotice],
              },
            },
          };
    await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(snapshot)}\n\n` });
  });

  await page.getByRole("button", { name: "Approve and email me this CV" }).click();
  await expect(page.getByText("Your CV ran over two pages — shortening it to fit…")).toBeVisible();
  await expect(page.getByText("Done — your CV is made and the email is on its way.")).toBeVisible({ timeout: 15_000 });
  const send = page.locator(".draft-send");
  await expect(send).toContainText(pageNotice);
  await expect(send.locator(".draft-notice")).toHaveCount(1);
  // The draft's lint notice stays said once, in its own place.
  await expect(page.getByText("Your languages could not be placed on this draft.", { exact: false })).toHaveCount(1);
});


// ---------------------------------------------------------------------------------------------
// #423 — the #408 prototype's layout: the CV page right under the top bar, with only the
// "Your CV | The job" tabs between. #411's breakdown and folded ad are off this screen (the deck
// card and the job's own screen keep theirs: deck.spec.ts, job-screen-journey.mjs).
// ---------------------------------------------------------------------------------------------

const AGEING = "You pasted this 9 days ago. We cannot check whether it is still open.";
const JOB_TEXT = [
  "Senior IT Project Manager",
  "",
  "What you will do:",
  "- Own a €2M budget across four European sites",
  "- Move the finance platform onto their SAP version",
].join("\n");

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`#423 at ${viewport.width}px nothing sits between the top bar and the CV page but the tabs`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openTailor(page, { ...STATE_DRAFT, card: { ...STATE_DRAFT.card, ageing: AGEING } });
    const frame = page.locator(".draft-frame");
    await expect(frame).toBeVisible();

    // The order, in the document: the bar, then the tabs, then the CV panel opening on the page.
    const tabs = page.getByRole("tablist", { name: "What to show" });
    await expect(page.locator(".tailor .dbar + .dgrid > .paper-col > :first-child")).toHaveAttribute("role", "tablist");
    await expect(page.locator(".tailor .paper-col > [role=tablist] + [role=tabpanel] > .draft > :first-child")).toHaveClass(/draft-frame/);
    await expect(tabs.getByRole("tab")).toHaveText(["Your CV", "The job"]);
    await expect(tabs.getByRole("tab", { name: "Your CV", selected: true })).toBeVisible();

    // And on the screen: the tabs right under the bar, the page right under the tabs.
    const bar = (await page.locator(".tailor .dbar").boundingBox())!;
    const tabsBox = (await tabs.boundingBox())!;
    const frameBox = (await frame.boundingBox())!;
    expect(tabsBox.y - (bar.y + bar.height)).toBeGreaterThanOrEqual(0);
    expect(tabsBox.y - (bar.y + bar.height)).toBeLessThanOrEqual(24); // the grid's own top padding
    expect(frameBox.y - (tabsBox.y + tabsBox.height)).toBeGreaterThanOrEqual(0);
    expect(frameBox.y - (tabsBox.y + tabsBox.height)).toBeLessThanOrEqual(12); // the tabs' own margin

    // What #411 put there is gone from this screen; the ageing line moved beside the page.
    await expect(page.getByRole("region", { name: "Match breakdown" })).toHaveCount(0);
    await expect(page.locator(".tailor details.ad")).toHaveCount(0);
    await expect(page.locator(".tailor")).not.toContainText("Read the ad in full");
    await expect(page.locator(".tailor .rail .ageing")).toHaveText(AGEING);
    await expect(page.locator(".tailor .paper-col .ageing")).toHaveCount(0);
  });
}

test("#423 The job shows the job's full text with its line breaks; Your CV brings the page back", async ({ page }) => {
  await openTailor(page, { ...STATE_DRAFT, card: { ...STATE_DRAFT.card, adExcerpt: JOB_TEXT } });
  const frame = page.locator(".draft-frame");
  await expect(frame).toBeVisible();
  const job = page.getByRole("tabpanel", { name: "The job" });
  await expect(job).toBeHidden();

  await page.getByRole("tab", { name: "The job" }).click();
  await expect(page.getByRole("tab", { name: "The job", selected: true })).toBeVisible();
  await expect(job).toBeVisible();
  await expect(frame).toBeHidden(); // in place of the CV, not beside it
  // One line on the screen per line of the text, the blank one included, each its own row.
  await expect(job.locator(".jl")).toHaveText(JOB_TEXT.split("\n"));
  const tops = await job.locator(".jl").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
  for (let i = 1; i < tops.length; i++) expect(tops[i]!).toBeGreaterThan(tops[i - 1]!);
  // The job's title and company head it, so a title cut short in the bar reads here in full.
  await expect(job.locator(".jt-title")).toHaveText(CARD_FIRST.title);
  await expect(job.locator(".jt-meta")).toHaveText("Atos · Paris 15e");

  await page.getByRole("tab", { name: "Your CV" }).click();
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("srcdoc", /Maria Kowalski/);
  await expect(job).toBeHidden();
});

test("#423 phone (390px): the top bar is one line — a long title cut short, no tagline; the computer keeps the tagline", async ({ page }) => {
  const title = "Senior IT Project Manager, Digital Transformation and Core Banking Programmes, Asia-Pacific";
  const state = { ...STATE_DRAFT, card: { ...STATE_DRAFT.card, title } };
  await page.setViewportSize({ width: 390, height: 844 });
  await openTailor(page, state);
  await expect(page.locator(".draft-frame")).toBeVisible();

  const h1 = page.locator(".tailor .dbar h1");
  await expect(h1).toHaveText(title);
  const fit = await h1.evaluate((el) => {
    const style = getComputedStyle(el);
    return { height: el.getBoundingClientRect().height, lineHeight: parseFloat(style.lineHeight), cut: el.scrollWidth > el.clientWidth, overflow: style.textOverflow };
  });
  expect(fit.height).toBeLessThanOrEqual(fit.lineHeight + 1); // one line
  expect(fit.cut).toBe(true); // …and the title really is longer than it
  expect(fit.overflow).toBe("ellipsis");
  await expect(page.locator(".tailor .dbar .tagline")).toBeHidden();
  await expect(page.locator(".tailor .dbar .co")).toHaveText(/^Atos · Paris 15e/);
  const bar = (await page.locator(".tailor .dbar").boundingBox())!;
  expect(bar.height).toBeLessThanOrEqual(64); // was ~230px with a long title (#422)
  // The full title reads on The job.
  await page.getByRole("tab", { name: "The job" }).click();
  await expect(page.locator(".jobtext .jt-title")).toHaveText(title);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator(".tailor .dbar .tagline")).toBeVisible();
  await expect(page.locator(".tailor .dbar .co")).toHaveText("Atos · Paris 15e · your CV is written only from what is true about you");
});
