import { expect, test, type Page } from "@playwright/test";
import type { JobBlockView } from "../lib/api";

// #278 — the work-history check's ENTRY and EXIT, now that it has two of each.
//
// Its only door used to be the draft screen's "Confirm my facts" button, and #272 deleted that
// screen. The replacement door is on the profile (profile.spec.ts asserts it exists and where it
// points); this spec asserts the other half — that arriving through it actually WORKS and leads
// back. The jobId in the address was never used to fetch anything (the API is session-scoped), so
// the whole difference an absent one makes is the way out, and the way out is the whole ticket:
// a check with no exit but "swipe every card" is a trap, not a door.
//
// Route-mocked exactly as job-blocks-family.spec.ts does.

function decision<T>(id: string, value: T) {
  return {
    id,
    value,
    origin: { kind: "read" as const, source_quote: "from the CV" },
    machine_touch: "verbatim" as const,
    classification: "Verified" as const,
  };
}

function block(id: string, confirmed: boolean): JobBlockView {
  const nulled = { id: `${id}:x`, value: null, origin: { kind: "worked_out" as const }, machine_touch: null, classification: null };
  return {
    id,
    kind: "job",
    countsTowardExperience: true,
    employer: decision(`${id}:employer`, "Nordic Retail"),
    title: decision(`${id}:title`, "IT Project Manager"),
    start: decision(`${id}:start`, { year: 2019, month: 1, precision: "month" as const }),
    end: decision(`${id}:end`, { state: "ended" as const, date: { year: 2022, month: 3, precision: "month" as const } }),
    kindDecision: decision(`${id}:kind`, "job" as const),
    family: { ...nulled, id: `${id}:family` },
    industry: { ...nulled, id: `${id}:industry` },
    confirmed,
    matchState: "new",
    candidateBlockIds: [],
  };
}

async function stub(page: Page, blocks: JobBlockView[]) {
  await page.route("**/api/sessions/me", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/job-blocks", (route) =>
    route.fulfill({
      json: {
        blocks,
        summary: {
          totalBlocks: blocks.length,
          confirmedBlocks: blocks.filter((b) => b.confirmed).length,
          read: { status: "ok", blocksFound: blocks.length },
        },
      },
    }),
  );
}

test("entered from the profile: the way back is visible on the first card and returns to the profile", async ({ page }) => {
  await stub(page, [block("nordic", false)]);
  await page.goto("/job-blocks");

  await expect(page.locator(".jb-card")).toBeVisible(); // the deck runs with no jobId at all
  const leave = page.getByRole("button", { name: /Back to your profile/ });
  await expect(leave).toBeVisible();
  await leave.click();
  await expect(page).toHaveURL(/\/profile$/);
});

test("entered from the profile: finishing the deck hands back to the profile, not to a deck she has no job for", async ({
  page,
}) => {
  await stub(page, [block("nordic", true)]); // already confirmed: lands on the end state
  await page.goto("/job-blocks");

  await expect(page.getByText(/That's your history straight/i)).toBeVisible();
  await page.getByRole("button", { name: "Back to your profile" }).last().click();
  await expect(page).toHaveURL(/\/profile$/);
});

test("entered from a read: the front door's onward route is untouched, and no back link appears", async ({ page }) => {
  await stub(page, [block("nordic", true)]);
  await page.goto("/job-blocks/job-77");

  await expect(page.getByRole("button", { name: /Back to your profile/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/deck\/job-77$/);
});

test("no records read at all: the empty state still leads back to the profile", async ({ page }) => {
  await stub(page, []);
  await page.goto("/job-blocks");

  await page.getByRole("button", { name: "Back to your profile" }).last().click();
  await expect(page).toHaveURL(/\/profile$/);
});

// #278 QA gate finding D2: the one entry state with no way out. A person who came in from her
// profile and met a failed read was offered "Try again" and nothing else — on the screen whose
// whole ticket is that a door needs an exit. The heading lied to her as well: the screen is
// available; reading her records is what failed.
test("entered from the profile: a failed read still leads back, and says honestly what failed", async ({ page }) => {
  await page.route("**/api/sessions/me", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/job-blocks", (route) => route.abort());
  await page.goto("/job-blocks");

  await expect(page.getByRole("heading", { name: "We couldn't read your work history" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.getByRole("button", { name: /Back to your profile/ }).click();
  await expect(page).toHaveURL(/\/profile$/);
});
