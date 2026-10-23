import { expect, test, type Page } from "@playwright/test";
import type { ProfileState, ScoredJobCard, TailorDraftView, TailorState } from "../lib/api";

// #17 the profile badge — "a pile that only grows". Route-mocked exactly as tailor.spec.ts already
// does; fixtures kept faithful to the real TailorState shape
// (QA's own finding: a mock and the real server must never quietly disagree).
//
// #415 (ADR-0020): the Tailor step takes no answer that records a fact any more (the requirement
// yes/no queue is gone; a profile answer never moves the count), so the badge's growth and its
// flying chip have no surface left to be driven on — those tests went with the queue. What this
// screen still owes the badge: it renders the count and opens the profile.

async function stubSession(page: Page) {
  await page.route("**/api/sessions/me", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
}

// #117: ScoredJobCard, not the JobCard union — this feeds TailorState.card, which is never the
// deck's pending variant (see lib/api.ts's TailorState comment).
const CARD: ScoredJobCard = {
  schemaVersion: "1",
  adId: "ad-1",
  title: "Senior IT Project Manager",
  company: "Atos",
  place: "Paris",
  salary: null,
  pattern: null,
  scored: "judged",
  matchPct: 61,
  breakdown: {
    essential: { met: 0, total: 1 },
    desirable: { met: 0, total: 0 },
  },
  bubble: { hit: "hit", open: "open" },
  fit: [],
  dontYet: [{ id: "sap", band: "essential", requirement: "SAP" }],
  askedClosed: [],
  adExcerpt: "excerpt",
};
const tailorState = (factCount: number): TailorState => ({
  card: CARD,
  questions: [],
  requirements: [{ id: "sap", text: "SAP", state: "gap" }],
  factCount,
});
const DRAFT_VIEW: TailorDraftView = {
  html: "<!doctype html><html><body><h1>Maria Kowalski</h1></body></html>",
  disclosure: [],
  conservationNotices: [],
  draftedAt: "2026-09-30T08:00:00.000Z",
};

test("the badge renders on tailor with the session's count, and tapping it opens /profile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stubSession(page);

  await page.route("**/api/onboarding/tailor", async (route) => {
    await route.fulfill({ json: tailorState(12) });
  });
  await page.route("**/api/onboarding/tailor/draft", async (route) => {
    if (route.request().method() === "POST") await route.fulfill({ json: { ready: true } });
    else await route.fulfill({ json: DRAFT_VIEW });
  });
  const profileState: ProfileState = {
    factCount: 12,
    search: { role: "IT project manager", family: null, siblingTitles: [], openJobs: null },
    domains: [
      {
        tag: "experience",
        heading: "Professional Experience",
        facts: [{ id: "sap", text: "Ran SAP rollouts across three sites.", colour: "gold", source: "told", job: null }],
      },
    ],
    contact: { name: null, title: null, location: null, phone: null, email: null },
    location: { areas: [], workRights: [] },
    cvPreviewHold: null,
    languagesQuestion: {
      questionId: "eligibility-languages",
      question: "Which languages do you speak? Start typing — I'll suggest as you go.",
      consequence: null,
      options: ["English", "Ask me later"],
      answer: null,
    },
  };
  await page.route("**/api/profile", async (route) => {
    await route.fulfill({ json: profileState });
  });

  await page.goto("/tailor");
  const badge = page.getByRole("link", { name: "Your profile — 12 facts about you" });
  await expect(badge).toBeVisible();
  // The draft screen (#415) carries the badge in its topbar like every screen; nothing flies.
  await expect(page.locator(".draft-frame")).toBeVisible();
  await expect(page.locator(".factchip")).toHaveCount(0);

  // AC5: tapping it opens the full profile as its own screen (#20's Sorted + Constellation screen).
  // A real client-side <Link>, so this is a route change, not a reload.
  await badge.click();
  await page.waitForURL("/profile");
  const heading = page.getByRole("heading", { name: "12 things you've told me" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
});

test("at 0 facts the badge is not rendered at all on tailor — no element, no zero", async ({ page }) => {
  await stubSession(page);
  await page.route("**/api/onboarding/tailor", async (route) => {
    await route.fulfill({ json: tailorState(0) });
  });
  await page.route("**/api/onboarding/tailor/draft", async (route) => {
    if (route.request().method() === "POST") await route.fulfill({ json: { ready: true } });
    else await route.fulfill({ json: DRAFT_VIEW });
  });

  await page.goto("/tailor");
  await expect(page.locator(".draft-frame")).toBeVisible();
  await expect(page.getByRole("link", { name: /Your profile/ })).toHaveCount(0);
});
