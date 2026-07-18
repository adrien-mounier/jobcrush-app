import { expect, test, type Page } from "@playwright/test";

// The S2 onboarding loop, end to end in a real browser against the real pipeline:
// paste a CV → mine + preview → confirm deck → build → verified root CV (or a loop-back).
// Non-deterministic (real LLM), so assertions are structural.
const SAMPLE_CV = `Maria Kowalska
IT Project Manager — Warsaw, Poland
maria.kowalska@example.com

Professional Summary
IT project manager with 8 years delivering enterprise software across retail and finance.

Experience
IT Project Manager, Nordic Retail Group — Mar 2021 to Present
- Led the checkout replatforming programme, delivered two months ahead of schedule
- Managed a delivery budget of EUR 1.2M across three vendor teams
- Ran steering committee reporting for the CIO and executive board
- Owned the release calendar across four engineering squads

Project Manager, FinCore Solutions — 2017 to 2021
- Coordinated a core banking migration for 400,000 customer accounts
- Introduced a risk and dependency tracking process adopted org-wide

Skills
Jira, MS Project, Confluence, SQL, Stakeholder management

Certifications
PRINCE2 Practitioner (2019)
Professional Scrum Master I (2020)

Education
MSc Management Information Systems, University of Warsaw (2017)

Languages
Polish (Native), English (Fluent)`;

// Paste the CV, wait out the real mine + preview, and land on the deck.
async function pasteToDeck(page: Page) {
  await page.goto("/paste");
  await page.getByRole("textbox").fill(SAMPLE_CV);
  await page.getByRole("button", { name: "Use this text" }).click();
  await page.waitForURL(/\/preview\//, { timeout: 200_000 }); // mine + preview on the live model
  await page.getByRole("link", { name: "Confirm my facts" }).click();
  await expect(page.getByRole("heading", { name: "Confirm your facts" })).toBeVisible();
}

test("happy path: reject one, confirm the rest → build → verified root CV", async ({ page }) => {
  await pasteToDeck(page);

  // Reject the first individual claim (capturing its text), then confirm the rest.
  const individualCount = await page.getByTestId("individual-claim").count();
  let rejectedText: string | null = null;
  if (individualCount > 0) {
    const first = page.getByTestId("individual-claim").first();
    rejectedText = (await first.getByTestId("claim-text").innerText()).trim();
    await first.getByRole("button", { name: "Remove" }).click();
  }
  const looksRight = page.getByRole("button", { name: "Looks right" });
  for (let guard = 0; (await looksRight.count()) > 0 && guard < 30; guard++) {
    await looksRight.first().click();
  }

  const build = page.getByRole("button", { name: "Build my verified CV" });
  await expect(build).toBeEnabled();
  await build.click();

  // Clean gate → the reward screen with a rendered CV…
  await expect(page.getByRole("heading", { name: "You own your facts" })).toBeVisible({ timeout: 30_000 });
  const rootcv = page.getByTestId("rootcv");
  await expect(rootcv).toContainText("•"); // at least one bullet rendered

  // …and the claim we rejected is nowhere in it (nothing renders that the user didn't confirm).
  if (rejectedText && rejectedText.length > 12) {
    await expect(rootcv).not.toContainText(rejectedText);
  }
});

test("loop-back: rejecting every fact loops back, never certifies an empty CV", async ({ page }) => {
  await pasteToDeck(page);

  // Reject every individual claim…
  const removes = page.getByTestId("individual-claim").getByRole("button", { name: "Remove" });
  for (let guard = 0; (await removes.count()) > 0 && guard < 40; guard++) {
    await removes.first().click();
  }
  // …and drop every kept batch chip (data-on flips to false on tap).
  const keptChips = page.locator("button.chip[data-on='true']");
  for (let guard = 0; (await keptChips.count()) > 0 && guard < 60; guard++) {
    await keptChips.first().click();
  }

  await page.getByRole("button", { name: "Build my verified CV" }).click();

  // Failing gate → a precise loop-back, never a dead end and never a certified empty CV.
  await expect(page.getByRole("heading", { name: "Almost there" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/at least one fact/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to my facts" })).toBeVisible();
});
