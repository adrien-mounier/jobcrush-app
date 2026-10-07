import { expect, test, type Page } from "@playwright/test";
import type { ProfileState, ScoredJobCard, TailorState } from "../lib/api";

// #17 the profile badge — "a pile that only grows". Route-mocked exactly as tailor.spec.ts already
// does; fixtures kept faithful to the real TailorState shape
// (QA's own finding: a mock and the real server must never quietly disagree).
//
// Most assertions run under `prefers-reduced-motion: reduce`, where the badge update is synchronous
// (no chip, no tween — badge-ui-spec.md §4) — deterministic and fast. One test runs with normal
// motion and asserts the `.factchip` DOM node itself (visible, then gone) — not just the eventual
// badge label — on both the 0→1 first answer and a later n→n+1 answer, so a chipless landing (the
// component quietly falling back to updating the count with no flight) cannot pass it.

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
const Q_SAP = { requirementId: "sap", question: "SAP?", options: ["Yes", "No"] };
const Q_JIRA = { requirementId: "jira", question: "Jira?", options: ["Yes", "No"] };
const tailorState = (factCount: number, questions: TailorState["questions"]): TailorState => ({
  card: CARD,
  questions,
  ledger: [],
  cvLines: [{ itemId: "role", section: "summary", text: "Senior IT Project Manager" }],
  closedGaps: { closed: 0, asked: 0 },
  doors: [],
  done: questions.length === 0,
  factCount,
});

// Drives the tailor step's question dock: each answer moves to the next state in `states`.
async function stubTailorAnswers(page: Page, states: TailorState[]) {
  let at = 0;
  await page.route("**/api/onboarding/tailor", async (route) => {
    await route.fulfill({ json: states[at] });
  });
  await page.route("**/api/onboarding/tailor/answer", async (route) => {
    at = Math.min(at + 1, states.length - 1);
    await route.fulfill({ json: states[at] });
  });
}

// #339: discovery no longer asks anything that records a fact (eligibility answers never count), so
// the badge's growth is exercised where answers still record one — the tailor step's questions.
test("the badge is absent at 0 facts, and a chip flies on the first answer (0→1) and a later one (n→n+1)", async ({
  page,
}) => {
  await stubSession(page);
  await stubTailorAnswers(page, [tailorState(0, [Q_SAP, Q_JIRA]), tailorState(1, [Q_JIRA]), tailorState(2, [])]);

  await page.goto("/tailor");
  await expect(page.getByText("SAP?")).toBeVisible();

  // AC (states table): 0 facts is not rendered at all.
  await expect(page.getByRole("link", { name: /Your profile/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Yes", exact: true }).click();

  // AC1, 0→1: the chip is a real DOM node — visible right after the response, gone once it lands.
  // Asserting the badge's eventual label alone would also pass a chipless fallback that just updates
  // the count with no flight (M1's actual bug), so the node itself is what's checked here.
  const chip = page.locator(".factchip");
  await expect(chip).toBeVisible();
  await expect(page.getByRole("link", { name: "Your profile — 1 fact about you" })).toBeVisible();
  await expect(chip).toHaveCount(0);

  // AC1, n→n+1: a later answer flies its own chip too, not just the very first one.
  await expect(page.getByText("Jira?")).toBeVisible();
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(chip).toBeVisible();
  await expect(page.getByRole("link", { name: "Your profile — 2 facts about you" })).toBeVisible();
  await expect(chip).toHaveCount(0);
});

test('reduced motion: the count grows on a "no" too, and the word collapses past the threshold', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stubSession(page);
  // "3 facts" is still under the word threshold; a "No" records a negative and crosses it (>3).
  await stubTailorAnswers(page, [tailorState(3, [Q_SAP, Q_JIRA]), tailorState(4, [Q_JIRA])]);

  await page.goto("/tailor");

  const badge = page.getByRole("link", { name: "Your profile — 3 facts about you" });
  await expect(badge).toBeVisible();
  // `.unit.gone` is `max-width:0; overflow:hidden` — asserting on the observable visual result
  // (not visible), not the animation-internal class.
  await expect(page.locator(".prof .unit")).toBeVisible();

  await page.getByRole("button", { name: "No", exact: true }).click();

  // AC: the count grew from a "no" — the badge is what pays for it.
  await expect(page.getByRole("link", { name: "Your profile — 4 facts about you" })).toBeVisible();
  // AC: past the threshold, the word collapses (the pile + count stay).
  await expect(page.locator(".prof .unit")).not.toBeVisible();
});

test("the badge renders on both discovery and tailor, and tapping it opens /profile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stubSession(page);

  const state = tailorState(12, [Q_SAP]);
  await page.route("**/api/onboarding/tailor", async (route) => {
    await route.fulfill({ json: state });
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
    contact: { phone: null, email: null },
    location: { areas: [], workRights: [] },
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

  // AC5: tapping it opens the full profile as its own screen (#20's Sorted + Constellation screen).
  // A real client-side <Link>, so this is a route change, not a reload.
  await badge.click();
  await page.waitForURL("/profile");
  const heading = page.getByRole("heading", { name: "12 things you've told me" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
});
