import { expect, test } from "@playwright/test";

// The S2 onboarding loop, end to end in a real browser against the real pipeline:
// paste a CV → mine + preview → confirm deck → build → verified root CV.
// Non-deterministic (real LLM), so assertions are structural. One dynamic check with teeth:
// a claim rejected in the deck must NOT appear in the built root CV (the anti-fabrication rule).
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

test("paste → preview → confirm deck → build → verified root CV", async ({ page }) => {
  // 1. Paste a CV and kick the pipeline.
  await page.goto("/paste");
  await page.getByRole("textbox").fill(SAMPLE_CV);
  await page.getByRole("button", { name: "Use this text" }).click();

  // 2. Pipeline runs (mine + preview on the real model) — the progress screen redirects when done.
  await page.waitForURL(/\/preview\//, { timeout: 200_000 });

  // 3. Into the deck.
  await page.getByRole("link", { name: "Confirm my facts" }).click();
  await expect(page.getByRole("heading", { name: "Confirm your facts" })).toBeVisible();

  // 4. Reject the first individual claim (capturing its text), then confirm the rest.
  const individualCount = await page.getByTestId("individual-claim").count();
  let rejectedText: string | null = null;
  if (individualCount > 0) {
    const first = page.getByTestId("individual-claim").first();
    rejectedText = (await first.getByTestId("claim-text").innerText()).trim();
    await first.getByRole("button", { name: "Remove" }).click();
  }
  // Confirm every remaining individual card (each click removes its own "Looks right").
  const looksRight = page.getByRole("button", { name: "Looks right" });
  for (let guard = 0; (await looksRight.count()) > 0 && guard < 30; guard++) {
    await looksRight.first().click();
  }

  // 5. Build the verified root CV.
  const build = page.getByRole("button", { name: "Build my verified CV" });
  await expect(build).toBeEnabled();
  await build.click();

  // 6. A clean gate flips to the reward screen with a rendered CV…
  await expect(page.getByRole("heading", { name: "You own your facts" })).toBeVisible({
    timeout: 30_000,
  });
  const rootcv = page.getByTestId("rootcv");
  await expect(rootcv).toContainText("•"); // at least one bullet rendered

  // …and the claim we rejected is nowhere in it (nothing renders that the user didn't confirm).
  if (rejectedText && rejectedText.length > 12) {
    await expect(rootcv).not.toContainText(rejectedText);
  }
});
