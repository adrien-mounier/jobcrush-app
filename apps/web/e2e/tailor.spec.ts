import { expect, test, type Page } from "@playwright/test";
import type { ScoredJobCard, TailorDraftView, TailorState } from "../lib/api";

// #23 Tailor (screen 3): re-score, the live card, and the exits. Stubbed at the route layer exactly
// like deck.spec.ts's screen 2b tests — GET/POST /api/onboarding/tailor* aren't necessarily wired
// server-side yet (the ticket's own contract note), so every call is mocked and this rides straight
// to /tailor (deck.spec.ts already covers the /deck -> tailorHandoff -> /tailor bridge itself).

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
  fit: [{ id: "budget", text: "€2M, across 4 teams" }],
  dontYet: [
    { id: "sap", band: "essential", requirement: "Their SAP version" },
    { id: "public", band: "standard", requirement: "Public-sector delivery" },
  ],
  askedClosed: [],
  adExcerpt: "Lead the replacement of a legacy finance platform across four European sites.",
};

const STATE_FIRST: TailorState = {
  card: CARD_FIRST,
  questions: [
    {
      requirementId: "sap",
      question: "They want SAP S/4HANA. Have you worked on that version?",
      options: ["Yes, ran a project on it", "Only the older ECC", "Never touched it"],
    },
    {
      requirementId: "public",
      question: "Has any of your work been for a government or public body?",
      options: ["Yes, several", "One contract", "No"],
    },
  ],
  ledger: [],
  cvLines: [{ itemId: "role", section: "summary", text: "Senior IT Project Manager" }],
  closedGaps: { closed: 0, asked: 0 },
  doors: [],
  done: false,
  factCount: 24,
};

// Real claim ids (apps/api/src/tailor.ts's tailorClaimId): `tailor-<slug(adId)>-<reqId>`, never the
// bare requirementId — that's exactly what F1 got wrong (resolved the landed row by requirementId,
// which no `fit`/`askedClosed` row is ever keyed by once answered) and what these fixtures now pin.
const SAP_CLAIM_ID = "tailor-ad-1-sap";
const PUBLIC_CLAIM_ID = "tailor-ad-1-public";

// Answering "sap" — a gain (+9%), the row moves fit-ward under its claim id, the bubble's gap clause
// moves to the next open requirement, a gold ledger line lands, and the tailored fact joins the CV.
const STATE_AFTER_SAP: TailorState = {
  card: {
    ...CARD_FIRST,
    matchPct: 70,
    breakdown: {
      essential: { met: 1, total: 1 },
      desirable: { met: 0, total: 1 },
    },
    bubble: { hit: CARD_FIRST.bubble.hit, open: "The gap is public-sector delivery." },
    fit: [...CARD_FIRST.fit, { id: SAP_CLAIM_ID, text: "Ran an S/4HANA project, through cutover" }],
    dontYet: [{ id: "public", band: "standard", requirement: "Public-sector delivery" }],
  },
  questions: [
    {
      requirementId: "public",
      question: "Has any of your work been for a government or public body?",
      options: ["Yes, several", "One contract", "No"],
    },
  ],
  ledger: [{ requirementId: "sap", text: "+9% · SAP S/4HANA" }],
  cvLines: [
    ...STATE_FIRST.cvLines,
    { itemId: SAP_CLAIM_ID, section: "experience", text: "Ran an S/4HANA project, through cutover" },
  ],
  closedGaps: { closed: 1, asked: 1 },
  doors: [],
  done: false,
  factCount: 25,
};

// Answering "public" with a bare "No" — no gain, the requirement LEAVES dontYet and lands only in
// askedClosed under its claim id (never a cross, never left sitting in both lists — the backend fix
// this fixture now pins), nothing left to ask: the natural ending.
const STATE_ENDED: TailorState = {
  card: {
    ...STATE_AFTER_SAP.card,
    bubble: { hit: STATE_AFTER_SAP.card.bubble.hit, open: "Nothing they ask for is still open." },
    dontYet: [],
    askedClosed: [{ id: PUBLIC_CLAIM_ID, text: "Public-sector delivery" }],
  },
  questions: [],
  ledger: [...STATE_AFTER_SAP.ledger, { requirementId: "public", text: "asked and closed · 1 still open" }],
  cvLines: STATE_AFTER_SAP.cvLines,
  closedGaps: { closed: 1, asked: 2 },
  // #311: the ended card names the "public" denial, so it carries the row's door.
  doors: [
    {
      claimId: PUBLIC_CLAIM_ID,
      requirementId: "public",
      question:
        'This job wants: "Public-sector delivery." You told me you don\'t have this. Changed? Since when?',
      options: ["This year", "1-2 years ago", "3 or more years ago"],
    },
  ],
  done: true,
  factCount: 26,
};

async function stubSession(page: Page) {
  await page.route("**/api/sessions/me", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
}

// #310 — the ending's draft: the CV brain's rendered document plus the re-homed #154 disclosure.
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
 *  hands the view. Registered by openTailor so every test that lands the ending has a draft. */
async function stubDraft(page: Page, view: TailorDraftView = DRAFT_VIEW) {
  await page.route("**/api/onboarding/tailor/draft", async (route) => {
    if (route.request().method() === "POST") await route.fulfill({ json: { ready: true } });
    else await route.fulfill({ json: view });
  });
}

async function openTailor(page: Page, state: TailorState) {
  await stubSession(page);
  await stubDraft(page);
  await page.route("**/api/onboarding/tailor", async (route) => {
    await route.fulfill({ json: state });
  });
  await page.goto("/tailor");
}

async function stubAnswer(page: Page, responses: Record<string, TailorState>) {
  await page.route("**/api/onboarding/tailor/answer", async (route) => {
    const { requirementId, answer } = route.request().postDataJSON() as { requirementId: string; answer: string };
    const state = responses[`${requirementId}:${answer}`];
    await route.fulfill({ json: state });
  });
}

async function stubDrop(page: Page) {
  await page.route("**/api/onboarding/tailor/drop", async (route) => {
    await route.fulfill({ json: { stage: "deck" } });
  });
}

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

test("the first question already offers \"I'm done — use this CV\"", async ({ page }) => {
  await openTailor(page, STATE_FIRST);

  await expect(page.getByRole("heading", { name: "Senior IT Project Manager" })).toBeVisible();
  await expect(page.getByRole("img", { name: "61% match" })).toBeVisible();
  await expect(page.getByText("They want SAP S/4HANA. Have you worked on that version?")).toBeVisible();
  await expect(page.getByRole("button", { name: "I'm done — use this CV" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Drop this job" })).toBeVisible();
});

test("answering a gap re-scores up, flips the ? to a check, rewrites the bubble, and lands a ledger line", async ({
  page,
}) => {
  await openTailor(page, STATE_FIRST);
  await stubAnswer(page, { "sap:Yes, ran a project on it": STATE_AFTER_SAP });

  await expect(page.getByRole("heading", { name: "Where you don't — yet" })).toBeVisible();
  await expect(page.getByText("Their SAP version", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Yes, ran a project on it" }).click();

  // F1: the row that landed is found by diffing card.fit against the previous card, not by reusing
  // the bare requirementId ("sap") — which is never a row's `data-req` once answered (that id is the
  // claim id, "tailor-ad-1-sap"). Checked BEFORE the tween-completion assertion below on purpose: the
  // flash clears ~640ms after landing, shorter than the ~680ms score tween, so waiting for "70% match"
  // first would race past it every time (both by design — "in the same glance", spec §4).
  const flippedRow = page.locator(".row.fit").filter({ hasText: "Ran an S/4HANA project, through cutover" });
  await expect(flippedRow).toHaveClass(/landed/);
  const breakdown = page.getByRole("region", { name: "Match breakdown" });
  await expect(breakdown.locator("dd")).toHaveText(["1/2", "1/1", "0/1", "Partial"]);
  // AC1: the visible % re-scores up.
  await expect(page.getByRole("img", { name: "70% match" })).toBeVisible();
  await expect(breakdown.getByText("Strong", { exact: true })).toBeVisible();
  // AC2: the grey "?" is gone from "where you don't — yet" and its gold check is in "where you fit" —
  // the pinned contract's own words for the flip (the row moved between the server's three lists).
  await expect(page.getByText("Their SAP version", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Where you fit" })).toBeVisible();
  await expect(flippedRow).toBeVisible();
  // F2: the tailored fact also joins the CV paper (cvLines), not just the card's own lists.
  await expect(page.locator(".cv").getByText("Ran an S/4HANA project, through cutover")).toBeVisible();
  // The bubble's gap clause rewrote to name the next open requirement.
  await expect(page.locator(".tailor .bubble")).toContainText("The gap is public-sector delivery.");
  // AC3: a ledger line landed, verbatim, and gold (the % rose on this answer).
  const ledger = page.locator(".tailor .ledger");
  await expect(ledger).toHaveText("+9% · SAP S/4HANA");
  await expect(ledger).not.toHaveClass(/quiet/);
});

// #309: the inverse of the old "never drops" pin — the defensive client clamp is gone with the
// server's floor. A lower server number is the truth, and the screen shows it, with its cause.
test("#309 a lower server tick really shows — no client clamp holds the % up", async ({ page }) => {
  await openTailor(page, STATE_FIRST);
  const lowerTick: TailorState = { ...STATE_AFTER_SAP, card: { ...STATE_AFTER_SAP.card, matchPct: 50 } };
  await stubAnswer(page, { "sap:Yes, ran a project on it": lowerTick });

  await page.getByRole("button", { name: "Yes, ran a project on it" }).click();

  await expect(page.locator(".flat").getByText("Ran an S/4HANA project, through cutover")).toBeVisible();
  await expect(page.getByRole("img", { name: "50% match" })).toBeVisible();
  await expect(page.getByRole("img", { name: "61% match" })).toHaveCount(0);
  // The fall carries its cause: the drop's size, the requirement JUST answered (never another
  // line's), and never a "+N%" gain blamed for a drop (QA gate finding, run 1).
  await expect(page.locator(".tailor .ledger")).toHaveText("Down 11% — re-scored on “SAP S/4HANA”");
});

test('running out of questions lands the ending — the same one "I\'m done" reaches', async ({ page }) => {
  await openTailor(page, STATE_AFTER_SAP); // one requirement still open: "public"
  await stubAnswer(page, { "public:No": STATE_ENDED });

  await page.getByRole("button", { name: "No", exact: true }).click();

  // F1/backend "no" fix: the requirement leaves "where you don't — yet" and lands, once, only in
  // "asked and closed" under its claim id — never a cross, never still sitting in dontYet too.
  const settledRow = page.locator(".row.settled").filter({ hasText: "Public-sector delivery" });
  await expect(settledRow).toHaveClass(/landed/);
  await expect(page.getByText("Public-sector delivery", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Where you don't — yet" })).toHaveCount(0);

  const heading = page.getByRole("heading", { name: "This CV is as strong as I can make it for this job." });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  // scoped to `.note` — the same sentence is also in the (visually-hidden) live region.
  await expect(page.locator(".finish .note")).toHaveText("You closed 1 of the 2 gaps this job asked about.");
  // #313: approving IS sending — the old Apply button (a press with no decision behind it) is gone;
  // the one real press lives in the draft column (SendBlock) once the draft is ready.
  await expect(page.getByRole("button", { name: "Apply with this CV" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save it and come back later" })).toBeVisible();
  // Only Drop remains in the exits row — "I'm done" served its purpose getting here.
  await expect(page.getByRole("button", { name: "I'm done — use this CV" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Drop this job" })).toBeVisible();
  await expect(page.getByText(/stopped early/i)).toHaveCount(0);
});

test('pressing "I\'m done" early lands the identical ending, with questions still open', async ({ page }) => {
  await openTailor(page, STATE_FIRST); // two requirements still open, nothing answered yet

  await page.getByRole("button", { name: "I'm done — use this CV" }).click();

  const heading = page.getByRole("heading", { name: "This CV is as strong as I can make it for this job." });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  // scoped to `.note` — the same sentence is also in the (visually-hidden) live region.
  await expect(page.locator(".finish .note")).toHaveText("Everything you told me is in there.");
  // #313: approving IS sending — the old Apply button (a press with no decision behind it) is gone;
  // the one real press lives in the draft column (SendBlock) once the draft is ready.
  await expect(page.getByRole("button", { name: "Apply with this CV" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save it and come back later" })).toBeVisible();
  await expect(page.getByText(/stopped early/i)).toHaveCount(0);
});

test("Drop this job shows the reassurance copy inline; Esc keeps it, Drop it clears and returns to the deck", async ({
  page,
}) => {
  await openTailor(page, STATE_FIRST);
  await stubDrop(page);

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

// ---------------------------------------------------------------------------------------------
// #307 — the queue's PROFILE-LEVEL question: permanent, told before and after, its own door.
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

const STATE_PROFILE_FIRST: TailorState = {
  ...STATE_FIRST,
  questions: [PROFILE_Q, ...STATE_FIRST.questions],
};

const AFTER_YES = "Remembered: you can work in Hong Kong. No job will ask you this again.";
const AFTER_NO = "Hidden 2 Hong Kong jobs from your deck — change this any time in your profile.";

function stubProfileAnswer(page: Page, response: { changed: string; state: TailorState | null }) {
  return page.route("**/api/onboarding/tailor/profile-answer", async (route) => {
    await route.fulfill({ json: response });
  });
}

test("#307 the profile question leads the queue with the remember line, and its after-line lands in the ledger slot", async ({
  page,
}) => {
  await openTailor(page, STATE_PROFILE_FIRST);
  await stubProfileAnswer(page, { changed: AFTER_YES, state: STATE_FIRST });

  // Before the answer: the permanent question first, the remember line under it, no decline.
  await expect(page.locator(".tailor .ask .q")).toHaveText(PROFILE_Q.question);
  await expect(page.locator(".tailor .ask .notice")).toHaveText(PROFILE_Q.remember);
  await expect(page.locator(".tailor .opts .opt")).toHaveCount(2);

  await page.getByRole("button", { name: "Yes — no sponsorship needed" }).click();

  // After: the one line saying what changed, and the advert's own question (no remember line).
  await expect(page.locator(".tailor .ledger")).toHaveText(AFTER_YES);
  await expect(page.locator(".tailor .ask .q")).toHaveText(STATE_FIRST.questions[0]!.question);
  await expect(page.locator(".tailor .ask .notice")).toHaveCount(0);
});

test("#307 a profile answer that empties the queue still shows its after-line at the ending", async ({ page }) => {
  await openTailor(page, { ...STATE_PROFILE_FIRST, questions: [PROFILE_Q] });
  await stubProfileAnswer(page, {
    changed: AFTER_YES,
    state: { ...STATE_FIRST, questions: [], done: true },
  });

  await page.getByRole("button", { name: "Yes — no sponsorship needed" }).click();

  await expect(page.getByRole("heading", { name: /as strong as I can make it/ })).toBeVisible();
  await expect(page.locator(".finish .ledger")).toHaveText(AFTER_YES);
});

test("#307 a profile answer that withdrew the job lands the gone screen: the honest line and the way back", async ({
  page,
}) => {
  await openTailor(page, { ...STATE_PROFILE_FIRST, questions: [PROFILE_Q] });
  await stubProfileAnswer(page, { changed: AFTER_NO, state: null });

  await page.getByRole("button", { name: "Not yet — I'd need sponsorship" }).click();

  const heading = page.getByRole("heading", { name: "Saved to your profile" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.locator(".loadstate p")).toHaveText(AFTER_NO);

  await page.getByRole("button", { name: "Back to the deck" }).click();
  await page.waitForURL("/deck");
});

// ---------------------------------------------------------------------------------------------
// #308 — the skip ("not sure yet" / "Not now") and the graded language question, in the queue.
// ---------------------------------------------------------------------------------------------

const SKIPPED_LINE = "Nothing saved — I'll ask again on another job in Hong Kong.";

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

test("#308 'Not sure yet' is not one of the answers: it posts, the line lands, and the queue moves on", async ({
  page,
}) => {
  await openTailor(page, STATE_PROFILE_FIRST);
  await stubProfileAnswer(page, { changed: SKIPPED_LINE, state: STATE_FIRST });

  // The skip renders apart from the answers — two options, one visibly different way out.
  await expect(page.locator(".tailor .opts .opt")).toHaveCount(2);
  const skip = page.locator(".tailor .ask .skip");
  await expect(skip).toHaveText("Not sure yet");

  await skip.click();

  // The honest line lands in the ledger slot, and the advert's own question follows —
  // which offers no skip of its own.
  await expect(page.locator(".tailor .ledger")).toHaveText(SKIPPED_LINE);
  await expect(page.locator(".tailor .ask .q")).toHaveText(STATE_FIRST.questions[0]!.question);
  await expect(page.locator(".tailor .ask .skip")).toHaveCount(0);
});

test("#308 the graded language question: why and cost before six rungs, the costly answer last, 'Not now' offered", async ({
  page,
}) => {
  await openTailor(page, { ...STATE_FIRST, questions: [LANGUAGE_Q, ...STATE_FIRST.questions] });
  await stubProfileAnswer(page, {
    changed: "Remembered for Mandarin: I get by day to day. No job will ask you this again.",
    state: STATE_FIRST,
  });

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
  await expect(page.locator(".tailor .ask .q")).toHaveText(STATE_FIRST.questions[0]!.question);
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

test("#309 a permanent answer that lowers the score tweens the ring DOWN and names the fall's size with its cause", async ({
  page,
}) => {
  await openTailor(page, { ...STATE_FIRST, questions: [LANGUAGE_Q, ...STATE_FIRST.questions] });
  await stubProfileAnswer(page, {
    changed: LANGUAGE_KEPT_LOW,
    state: { ...STATE_FIRST, card: { ...STATE_FIRST.card, matchPct: 49 } },
  });

  await expect(page.getByRole("img", { name: "61% match" })).toBeVisible();
  await page.getByRole("button", { name: "I don't speak this one" }).click();

  // The fall is shown with its cause: the drop's size prefixed onto the answer's own line…
  await expect(page.locator(".tailor .ledger")).toHaveText(`Down 12% — ${LANGUAGE_KEPT_LOW}`);
  // …and the ring really falls — no client-side clamp holds it at 61.
  await expect(page.getByRole("img", { name: "49% match" })).toBeVisible();
});

test("#309 a fall on the answer that empties the queue keeps its cause visible at the ending", async ({ page }) => {
  await openTailor(page, { ...STATE_FIRST, questions: [LANGUAGE_Q] });
  await stubProfileAnswer(page, {
    changed: LANGUAGE_KEPT_LOW,
    state: { ...STATE_FIRST, card: { ...STATE_FIRST.card, matchPct: 49 }, questions: [], done: true },
  });

  await page.getByRole("button", { name: "I don't speak this one" }).click();

  await expect(page.getByRole("heading", { name: /as strong as I can make it/ })).toBeVisible();
  await expect(page.locator(".finish .ledger")).toHaveText(`Down 12% — ${LANGUAGE_KEPT_LOW}`);
});

test("#309 a withdrawal mid-tailor names its reason on the gone screen, above the honest count", async ({ page }) => {
  await openTailor(page, { ...STATE_PROFILE_FIRST, questions: [PROFILE_Q] });
  await page.route("**/api/onboarding/tailor/profile-answer", async (route) => {
    await route.fulfill({ json: { changed: AFTER_NO, state: null, withdrawal: WITHDRAW_REASON } });
  });

  await page.getByRole("button", { name: "Not yet — I'd need sponsorship" }).click();

  await expect(page.getByRole("heading", { name: "Saved to your profile" })).toBeVisible();
  await expect(page.locator(".loadstate .gone-reason")).toHaveText(WITHDRAW_REASON);
  await expect(page.locator(".loadstate p:not(.gone-reason)")).toHaveText(AFTER_NO);
});

test("#309 a brought job that stays despite the gap says why, on the flow and at the ending", async ({ page }) => {
  await openTailor(page, { ...STATE_FIRST, stayed: STAYED_LINE });
  await expect(page.locator(".tailor .ask .stayed")).toHaveText(STAYED_LINE);

  await openTailor(page, { ...STATE_FIRST, stayed: STAYED_LINE, questions: [], done: true });
  await expect(page.getByRole("heading", { name: /as strong as I can make it/ })).toBeVisible();
  await expect(page.locator(".tailor .ask .stayed")).toHaveText(STAYED_LINE);
});

// QA gate run 2's adversarial gap: with a one-line ledger, a regression back to `.at(-1)` still
// passes the test above. Here the answered requirement's line is deliberately NOT last.
test("#309 the fall's cause is the answer JUST GIVEN, even when its ledger line is not last", async ({ page }) => {
  // "public" was answered earlier, so its line sits LAST in the advert's rank-ordered ledger; the
  // sap answer that causes this fall sits first. Also covers a fall landing on the ending screen.
  const publicAnswered: TailorState = {
    ...STATE_FIRST,
    questions: [STATE_FIRST.questions[0]!], // only sap still open
    ledger: [{ requirementId: "public", text: "asked and closed · 2 still open" }],
  };
  const fallen: TailorState = {
    ...publicAnswered,
    card: { ...STATE_FIRST.card, matchPct: 50 },
    questions: [],
    done: true,
    ledger: [
      { requirementId: "sap", text: "+9% · SAP S/4HANA" },
      { requirementId: "public", text: "asked and closed · 2 still open" },
    ],
  };
  await openTailor(page, publicAnswered);
  await stubAnswer(page, { "sap:Yes, ran a project on it": fallen });

  await page.getByRole("button", { name: "Yes, ran a project on it" }).click();

  await expect(page.getByRole("heading", { name: /as strong as I can make it/ })).toBeVisible();
  await expect(page.locator(".finish .ledger")).toHaveText("Down 11% — re-scored on “SAP S/4HANA”");
});

// --- #310: the ending's draft is the CV brain's, and it shows what it held back ---

test("#310 the ending renders the real draft and the re-homed #154 panel — document, held-back facts, over-full line, notice", async ({
  page,
}) => {
  await openTailor(page, STATE_ENDED);

  // The document reaches the screen: the sandboxed frame is visible and carries the server render.
  const frame = page.locator(".draft-frame");
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("srcdoc", /Maria Kowalski/);
  await expect(frame).toHaveAttribute("srcdoc", /Led the checkout replatforming/);

  // The #154 disclosure, on the Tailor step's ending: the choice (held back), in the profile's own
  // words, behind its "show them" control…
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

  // And the ending's own controls are still there beneath it — the draft is ready here, so the
  // #313 approve-is-send press is the one that shows.
  await expect(page.getByRole("button", { name: "Approve and email me this CV" })).toBeVisible();
});

test("#310 a fresh draft narrates its wait over the job stream, then the document lands", async ({ page }) => {
  await stubSession(page);
  await page.route("**/api/onboarding/tailor", async (route) => {
    await route.fulfill({ json: STATE_ENDED });
  });
  await page.route("**/api/onboarding/tailor/draft", async (route) => {
    if (route.request().method() === "POST") {
      // Hold the 202 briefly so the writing line is assertable, not a flash.
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({ status: 202, json: { jobId: "draft-job-1" } });
    } else {
      await route.fulfill({ json: DRAFT_VIEW });
    }
  });
  await page.route("**/api/jobs/draft-job-1/events", async (route) => {
    const snapshot = { id: "draft-job-1", status: "completed", error: null, progress: { tailorDraft: { ready: true } } };
    await route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify(snapshot)}\n\n`,
    });
  });

  await page.goto("/tailor");

  await expect(page.getByText("Writing your CV for this job…")).toBeVisible();
  await expect(page.locator(".draft-frame")).toBeVisible();
  await expect(page.locator(".draft-frame")).toHaveAttribute("srcdoc", /Maria Kowalski/);
});

test("#310 a failed draft says so in plain words, and Try again really retries", async ({ page }) => {
  await stubSession(page);
  await page.route("**/api/onboarding/tailor", async (route) => {
    await route.fulfill({ json: STATE_ENDED });
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

// --- #311: a "No" never prints, and growing is one step --------------------------------------------

const GROWN_CLAIM_ID = "tailor-ad-1-public-grew";
// What the server answers a door's "1-2 years ago" with: the dated fact in fit (a NEW claim id — the
// old "No" is kept server-side, never overwritten), the named denial and its door gone, +N% earned.
const STATE_GROWN: TailorState = {
  ...STATE_ENDED,
  card: {
    ...STATE_ENDED.card,
    matchPct: 76,
    fit: [...STATE_ENDED.card.fit, { id: GROWN_CLAIM_ID, text: "Public-sector delivery (since 2025)." }],
    askedClosed: [],
  },
  ledger: [
    ...STATE_ENDED.ledger.slice(0, 1),
    { requirementId: "public", text: "+9% · Public-sector delivery" },
  ],
  closedGaps: { closed: 2, asked: 2 },
  doors: [],
};

test("#311 the door: a named denial grows in one step, through the existing answer path", async ({ page }) => {
  await openTailor(page, STATE_ENDED);
  await stubAnswer(page, { "public:1-2 years ago": STATE_GROWN });

  // The denial is named under its own heading, and its row carries the door.
  await expect(page.getByRole("heading", { name: "You told me you don't have this" })).toBeVisible();
  const door = page.getByRole("button", { name: "Changed? Add it" });
  await expect(door).toBeVisible();

  // Tapping it turns the row back into a question — server-composed, coarse dates, a way out.
  await door.click();
  // #tailor-ask-q, not getByText: the sr-only live region announces the same question (by design).
  await expect(page.locator("#tailor-ask-q")).toHaveText(/Changed\? Since when\?/);
  await expect(page.getByRole("button", { name: "This year" })).toBeVisible();
  await expect(page.getByRole("button", { name: "3 or more years ago" })).toBeVisible();
  await expect(page.getByRole("button", { name: "No change" })).toBeVisible();

  await page.getByRole("button", { name: "1-2 years ago" }).click();

  // The dated fact lands in fit; the named denial and its door are gone with it.
  await expect(page.locator(".row.fit").filter({ hasText: "Public-sector delivery (since 2025)." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "You told me you don't have this" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Changed? Add it" })).toHaveCount(0);
});

test("#311 'No change' closes the door with nothing posted — his 'No' stands", async ({ page }) => {
  await openTailor(page, STATE_ENDED);
  let answerPosts = 0;
  await page.route("**/api/onboarding/tailor/answer", async (route) => {
    answerPosts += 1;
    await route.fulfill({ json: STATE_ENDED });
  });

  await page.getByRole("button", { name: "Changed? Add it" }).click();
  await expect(page.locator("#tailor-ask-q")).toHaveText(/Changed\? Since when\?/);
  await page.getByRole("button", { name: "No change" }).click();

  await expect(page.locator("#tailor-ask-q")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "You told me you don't have this" })).toBeVisible();
  expect(answerPosts).toBe(0);
});
