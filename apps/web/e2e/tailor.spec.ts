import { expect, test, type Page } from "@playwright/test";
import type { JobCard, TailorState } from "../lib/api";

// #23 Tailor (screen 3): re-score, the live card, and the exits. Stubbed at the route layer exactly
// like deck.spec.ts's screen 2b tests — GET/POST /api/onboarding/tailor* aren't necessarily wired
// server-side yet (the ticket's own contract note), so every call is mocked and this rides straight
// to /tailor (deck.spec.ts already covers the /deck -> tailorHandoff -> /tailor bridge itself).

const CARD_FIRST: JobCard = {
  schemaVersion: "1",
  adId: "ad-1",
  title: "Senior IT Project Manager",
  company: "Atos",
  place: "Paris 15e",
  salary: null,
  pattern: null,
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
    { id: "sap", band: "must", requirement: "Their SAP version" },
    { id: "public", band: "should", requirement: "Public-sector delivery" },
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
    dontYet: [{ id: "public", band: "should", requirement: "Public-sector delivery" }],
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
  done: true,
  factCount: 26,
};

async function stubSession(page: Page) {
  await page.route("**/api/sessions/me", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
}

async function openTailor(page: Page, state: TailorState) {
  await stubSession(page);
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

test("the % never drops, even if the server ever sent a lower tick", async ({ page }) => {
  await openTailor(page, STATE_FIRST);
  const lowerTick: TailorState = { ...STATE_AFTER_SAP, card: { ...STATE_AFTER_SAP.card, matchPct: 50 } };
  await stubAnswer(page, { "sap:Yes, ran a project on it": lowerTick });

  await page.getByRole("button", { name: "Yes, ran a project on it" }).click();

  await expect(page.locator(".flat").getByText("Ran an S/4HANA project, through cutover")).toBeVisible();
  await expect(page.getByRole("img", { name: "61% match" })).toBeVisible();
  await expect(page.getByRole("img", { name: "50% match" })).toHaveCount(0);
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
  await expect(page.getByRole("button", { name: "Apply with this CV" })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Apply with this CV" })).toBeVisible();
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
