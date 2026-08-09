import { expect, test, type Page } from "@playwright/test";
import type { CvSection, DiscoveryState, ProfileState, ScoredJobCard, TailorState } from "../lib/api";

// #17 the profile badge — "a pile that only grows". Route-mocked exactly as discovery.spec.ts /
// tailor.spec.ts already do; fixtures kept faithful to the real DiscoveryState/TailorState shape
// (QA's own finding: a mock and the real server must never quietly disagree).
//
// Most assertions run under `prefers-reduced-motion: reduce`, where the badge update is synchronous
// (no chip, no tween — badge-ui-spec.md §4) — deterministic and fast. One test runs with normal
// motion and asserts the `.factchip` DOM node itself (visible, then gone) — not just the eventual
// badge label — on both the 0→1 first answer and a later n→n+1 answer, so a chipless landing (the
// component quietly falling back to updating the count with no flight) cannot pass it.

const RAIL_ZERO: Record<CvSection, number> = { summary: 0, experience: 0, skills: 0, education: 0 };

async function stubSession(page: Page) {
  await page.route("**/api/sessions/me", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
}

async function stubFamily(page: Page) {
  await page.route("**/api/onboarding/discovery/family**", async (route) => {
    await route.fulfill({ json: { family: null, suggestions: [] } }); // silent no-match path
  });
}

test("the badge is absent at 0 facts, and a chip flies on the first answer (0→1) and a later one (n→n+1)", async ({
  page,
}) => {
  await stubSession(page);
  await stubFamily(page);

  const Q_YEARS = {
    itemId: "years",
    question: "How long?",
    options: ["Under 2 years", "2-5 years"],
    cvSection: "experience" as const,
  };
  const BEFORE_START: DiscoveryState = {
    stage: "discovery",
    role: null,
    family: null,
    city: null,
    promise: null,
    questions: [],
    railFill: RAIL_ZERO,
    essentialRemaining: 3,
    cvLines: [],
    factCount: 0,
  };
  const AFTER_START: DiscoveryState = {
    stage: "discovery",
    role: "IT Project Manager",
    family: "project manager",
    city: "Paris",
    promise: { family: "project manager", city: "Paris", count: 142 },
    questions: [Q_YEARS],
    railFill: RAIL_ZERO,
    essentialRemaining: 3,
    cvLines: [{ itemId: "role", section: "summary", text: "IT Project Manager" }],
    factCount: 1,
  };
  const AFTER_YEARS: DiscoveryState = {
    ...AFTER_START,
    questions: [],
    cvLines: [...AFTER_START.cvLines, { itemId: "years", section: "experience", text: "Under 2 years." }],
    factCount: 2,
  };

  await page.route("**/api/onboarding/discovery/start", async (route) => {
    await route.fulfill({ json: AFTER_START });
  });
  await page.route("**/api/onboarding/discovery/answer", async (route) => {
    await route.fulfill({ json: AFTER_YEARS });
  });
  await page.route("**/api/onboarding/discovery", async (route) => {
    await route.fulfill({ json: BEFORE_START });
  });

  await page.goto("/discovery");

  // AC (states table): 0 facts is not rendered at all.
  await expect(page.getByRole("link", { name: /Your profile/ })).toHaveCount(0);

  await page.getByRole("textbox", { name: "What kind of job are you going for?" }).fill("IT project manager");
  await page.getByRole("button", { name: "That's me" }).click();

  // AC1, 0→1: the chip is a real DOM node — visible right after the response, gone once it lands.
  // Asserting the badge's eventual label alone would also pass a chipless fallback that just updates
  // the count with no flight (M1's actual bug), so the node itself is what's checked here.
  const chip = page.locator(".factchip");
  await expect(chip).toBeVisible();
  await expect(page.getByRole("link", { name: "Your profile — 1 fact about you" })).toBeVisible();
  await expect(chip).toHaveCount(0);

  // AC1, n→n+1: a later answer flies its own chip too, not just the very first one.
  await page.getByRole("button", { name: "Under 2 years" }).click();
  await expect(chip).toBeVisible();
  await expect(page.getByRole("link", { name: "Your profile — 2 facts about you" })).toBeVisible();
  await expect(chip).toHaveCount(0);
});

test('reduced motion: the count grows on a "no" too, and the word collapses past the threshold', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stubSession(page);

  const Q_BUDGET = { itemId: "budget", question: "Have you managed a budget?", options: ["Yes", "No"], cvSection: "experience" as const };
  const Q_STAKEHOLDER = {
    itemId: "stakeholder",
    question: "Have you reported to senior stakeholders?",
    options: ["Yes", "No"],
    cvSection: "experience" as const,
  };

  const MID_FLOW: DiscoveryState = {
    stage: "discovery",
    role: "IT Project Manager",
    family: "project manager",
    city: "Paris",
    promise: { family: "project manager", city: "Paris", count: 142 },
    questions: [Q_BUDGET, Q_STAKEHOLDER],
    railFill: RAIL_ZERO,
    essentialRemaining: 2,
    cvLines: [{ itemId: "role", section: "summary", text: "IT Project Manager" }],
    factCount: 3, // "3 facts" — still under the word threshold
  };
  // A bare "no" — no new CV line, but factCount still grows and crosses the word threshold (>3).
  const AFTER_NO: DiscoveryState = {
    ...MID_FLOW,
    questions: [Q_STAKEHOLDER],
    essentialRemaining: 1,
    factCount: 4,
  };

  let current: DiscoveryState = MID_FLOW;
  await page.route("**/api/onboarding/discovery/answer", async (route) => {
    current = AFTER_NO;
    await route.fulfill({ json: current });
  });
  await page.route("**/api/onboarding/discovery", async (route) => {
    await route.fulfill({ json: current });
  });

  await page.goto("/discovery");

  const badge = page.getByRole("link", { name: "Your profile — 3 facts about you" });
  await expect(badge).toBeVisible();
  // `.unit.gone` is `max-width:0; overflow:hidden` — asserting on the observable visual result
  // (not visible), not the animation-internal class.
  await expect(page.locator(".prof .unit")).toBeVisible();

  await page.getByRole("button", { name: "No", exact: true }).click();

  // AC: the count grew from a "no" (no CV line typed for this answer) — the badge is what pays for it.
  await expect(page.getByRole("link", { name: "Your profile — 4 facts about you" })).toBeVisible();
  // AC: past the threshold, the word collapses (the pile + count stay).
  await expect(page.locator(".prof .unit")).not.toBeVisible();
});

test("the badge renders on both discovery and tailor, and tapping it opens /profile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stubSession(page);

  // #117: ScoredJobCard, not the JobCard union — this feeds TailorState.card, which is never the
  // deck's pending variant (see lib/api.ts's TailorState comment).
  const card: ScoredJobCard = {
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
  const tailorState: TailorState = {
    card,
    questions: [{ requirementId: "sap", question: "SAP?", options: ["Yes", "No"] }],
    ledger: [],
    cvLines: [{ itemId: "role", section: "summary", text: "Senior IT Project Manager" }],
    closedGaps: { closed: 0, asked: 0 },
    done: false,
    factCount: 12,
  };
  await page.route("**/api/onboarding/tailor", async (route) => {
    await route.fulfill({ json: tailorState });
  });
  const profileState: ProfileState = {
    factCount: 12,
    search: { role: "IT project manager", family: null, siblingTitles: [], openJobs: null },
    domains: [
      {
        tag: "experience",
        heading: "Professional Experience",
        facts: [{ id: "sap", text: "Ran SAP rollouts across three sites.", colour: "gold", source: "told" }],
      },
    ],
  };
  await page.route("**/api/profile", async (route) => {
    await route.fulfill({ json: profileState });
  });

  await page.goto("/tailor");
  const badge = page.getByRole("link", { name: "Your profile — 12 facts about you" });
  await expect(badge).toBeVisible();

  // AC5: tapping it opens the full profile as its own screen (#20's Sorted + Constellation screen).
  // A real client-side <Link>, so this is a route change, not a reload.
  await badge.click();
  await page.waitForURL("/profile");
  const heading = page.getByRole("heading", { name: "12 things you've told me" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
});
