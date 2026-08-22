import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Reachable input-error paths (no LLM — fast + deterministic). These fail before the deck, so they're
// separate from the onboarding loop spec. Run from apps/web, so the fixture path is cwd-relative.
//
// #271: these checks used to open the old /paste and /import screens directly. Those screens are
// being deleted (#272) and every protection they carried now lives on the front door (#270), so
// each check walks in through the front door — the same protections, asserted where a person
// actually meets them. What each used to assert, and where it went:
//   - "too short" no longer disables the submit button (old screen behaviour); the front door
//     refuses the click in plain words and keeps the typing (#270 AC4).
//   - the unparseable upload's paste fallback is now offered in place on "/", never via a wait
//     screen redirect. The real upload path (presign → PUT → complete) is still exercised.
//   - the old Path-B "coming soon" notice died with its screen: starting from questions is a real
//     door on the front door, so the check asserts the door works instead of the apology.
const SCANNED_PDF = path.resolve("../api/test/fixtures/scanned.pdf");

async function openSourceStep(page: Page) {
  await page.goto("/");
  await page.mouse.click(10, 10); // any tap finishes the invitation animation early
  await page.getByRole("button", { name: "Ready?" }).click();
  await expect(page.getByRole("heading", { name: "Can something you already have help?" })).toBeVisible();
}

test("paste too short: refused in plain words, and the typing is kept", async ({ page }) => {
  await openSourceStep(page);
  await page.getByRole("button", { name: /Paste my CV text/ }).click();
  await page.getByLabel("Your CV text").fill("too short to be a CV");
  await page.getByRole("button", { name: "Use this text" }).click();
  await expect(page.locator("#paste-error")).toContainText("too short to be a CV");
  await expect(page.getByLabel("Your CV text")).toHaveValue("too short to be a CV");
});

test("unparseable upload: routed to the paste fallback, never OCR-guessed", async ({ page }) => {
  await openSourceStep(page);
  await page.getByRole("button", { name: /Use my CV/ }).click();
  // Set the hidden file input directly (the visible door just clicks it).
  await page.locator('input[type="file"]').setInputFiles(SCANNED_PDF);

  // Extract detects the empty text layer and fails the job — the failure screen offers paste,
  // never a guess. (This also exercises the real upload path: presign → PUT → complete.) Generous:
  // against staging this is a real R2 upload, slower than the local disk driver.
  await expect(page.getByRole("heading", { name: "We couldn’t read your CV" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("If your CV is a scan, paste the text instead")).toBeVisible();
  await page.getByRole("button", { name: "Paste the text instead" }).click();
  await expect(page.getByRole("heading", { name: "Paste your CV text" })).toBeVisible();
  // In place on the front door — no wait-screen redirect, no old route.
  await expect(page).toHaveURL(/\/$/);
});

test("Path B ('no CV yet', JC-55) is a real door now: questions start without a document", async ({ page }) => {
  await openSourceStep(page);
  await page.getByRole("button", { name: "Start questions instead" }).click();
  await expect(page.getByRole("heading", { name: /What kind of job are you going for/ })).toBeVisible();
});

test("E2 wall: the deck is login-gated — logged out, it redirects to signup", async ({ page }) => {
  await page.goto("/deck/any-job-id"); // no session/login → server 401 login_required
  // Generous: against staging this is 3 sequential round-trips (ensure session → deck → redirect).
  await page.waitForURL(/\/signup/, { timeout: 45_000 });
  await expect(page.getByRole("heading", { name: /save your draft/i })).toBeVisible();
});
