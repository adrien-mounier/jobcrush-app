import { expect, test } from "@playwright/test";

// #15 front door (screen 0). Deterministic and fast (no LLM, no upload) — the CV-shortcut
// upload/mine flow reuses the same job-SSE pipeline exercised end-to-end, slowly and
// non-deterministically, by onboarding.spec.ts, so it isn't repeated here.
//
// Assertions stay at what a visitor observes — copy present, Ready? actually clickable, the URL
// change — never the typewriter's internal DOM. (Ready?/Upload it are `inert` and opacity:0 pre
// reveal; Playwright's `toBeVisible()` does not consider opacity, so the reliable, black-box
// signal is whether the button can actually be CLICKED — its own actionability wait respects
// `pointer-events: none`, which is the real mechanism gating interaction here.)

test("front door: the invitation appears, then Ready? advances to /discovery", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("body")).toContainText("Answer questions.");
  await expect(page.locator("body")).toContainText("Collect jobs.");

  // Ready? becomes clickable once the invitation finishes typing (~1.57s per spec §5) —
  // Playwright's own actionability wait (attached, stable, receives events, enabled) covers it.
  await page.getByRole("button", { name: "Ready?" }).click({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/discovery/);
});

test("tap-to-finish: a tap while typing makes Ready? clickable immediately, not after the full type-out", async ({
  page,
}) => {
  await page.goto("/");

  // Tap well before the ~1.57s natural typing would finish on its own, away from any control —
  // "anywhere" per spec §6.
  await page.waitForTimeout(150);
  await page.mouse.click(10, 10);

  // Budget sits above Ready?'s ~620ms reveal transform (so the tapped path lands) yet below the
  // ~2.2s natural type-out+reveal — a pass is still real evidence the skip worked, not a wait.
  await page.getByRole("button", { name: "Ready?" }).click({ timeout: 1500 });
  await expect(page).toHaveURL(/\/discovery/);
});

test("prefers-reduced-motion: the full invitation shows immediately and Ready? is clickable with no typing wait", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page.locator("body")).toContainText("Answer questions.");
  await expect(page.locator("body")).toContainText("Collect jobs.");
  await page.getByRole("button", { name: "Ready?" }).click({ timeout: 500 });
  await expect(page).toHaveURL(/\/discovery/);
});
