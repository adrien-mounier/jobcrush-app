import path from "node:path";
import { expect, test } from "@playwright/test";

// Reachable input-error paths (no LLM — fast + deterministic). These fail before the deck, so they're
// separate from the onboarding loop spec. Run from apps/web, so the fixture path is cwd-relative.
const SCANNED_PDF = path.resolve("../api/test/fixtures/scanned.pdf");

test("paste too short: submit stays disabled with a nudge", async ({ page }) => {
  await page.goto("/paste");
  await page.getByRole("textbox").fill("too short to be a CV");
  await expect(page.getByRole("button", { name: "Use this text" })).toBeDisabled();
  await expect(page.getByText(/a bit more text/i)).toBeVisible();
});

test("unparseable upload: routed to the paste fallback, never OCR-guessed", async ({ page }) => {
  await page.goto("/import");
  // Set the hidden file input directly (the visible door just clicks it).
  await page.locator('input[type="file"]').setInputFiles(SCANNED_PDF);
  await page.waitForURL(/\/progress\//, { timeout: 30_000 });

  // Extract detects the empty text layer and fails the job — the progress screen offers paste,
  // never a guess. (This also exercises the real upload path: presign → PUT → complete.)
  await expect(page.getByRole("button", { name: "Paste my CV text" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Paste my CV text" }).click();
  await expect(page).toHaveURL(/\/paste$/);
});

test("Path B door ('no CV yet', JC-55) is a polite coming-soon, not a dead click", async ({ page }) => {
  await page.goto("/import");
  await page.getByRole("button", { name: /I don.t have a CV yet/i }).click();
  await expect(page.getByText(/from scratch together is coming soon/i)).toBeVisible();
});
