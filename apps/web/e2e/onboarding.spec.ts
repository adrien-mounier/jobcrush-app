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

// Paste the CV on the front door, wait out the real mine, confirm the work history, cross the
// signup wall, and land on the claim deck.
//
// #271: this walk used to open the old /paste screen (being deleted, #272) and then click the
// draft screen's "Confirm my facts" link and wait for /signup. That wait had quietly rotted: the
// link has gone to /job-blocks/<jobId> since #157, and this spec runs in no CI tier, so nothing
// noticed. Re-pointed at the front door and repaired in the same pass — the work-history check
// (#157) now sits between the read and the wall, exactly as a person meets it.
async function pasteToDeck(page: Page) {
  await page.goto("/");
  await page.mouse.click(10, 10); // any tap finishes the invitation animation early
  await page.getByRole("button", { name: "Ready?" }).click();
  await page.getByRole("button", { name: /Paste my CV text/ }).click();
  await page.getByLabel("Your CV text").fill(SAMPLE_CV);
  const pasted = page.waitForResponse(
    (r) => r.url().includes("/api/cv/paste") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Use this text" }).click();
  const { jobId } = await (await pasted).json();

  // The live model mines the CV — wait the whole pipeline out before the work-history check.
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const r = await fetch(`/api/jobs/${id}`, { credentials: "same-origin" });
          return r.ok ? (await r.json()).status : "pending";
        }, jobId),
      { timeout: 200_000 },
    )
    .toMatch(/completed|failed/);

  // The work-history check (#157): confirm every dated block, then continue toward the wall.
  await page.goto(`/job-blocks/${jobId}`);
  for (let guard = 0; guard < 10 && (await page.locator(".jb-cbtn.yes").count()) > 0; guard++) {
    await page.locator(".jb-cbtn.yes").click();
    await page.waitForTimeout(1200);
  }
  await expect(page.locator(".jb-done")).toBeVisible();
  await page.locator('.jb-done .btn:has-text("Continue")').click();

  // E2 wall: the deck is login-gated, so it redirects to /signup. Sign in via the dev magic-link.
  await page.waitForURL(/\/signup/);
  await page.getByRole("textbox").fill("e2e@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByRole("link", { name: /Open your sign-in link/ }).click();

  await page.waitForURL(/\/deck\//);
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

  // Continue → the grill (JC-24). It may or may not surface questions depending on what the model
  // mined, so wait for whichever comes: a grill question, or the reward screen (no gaps → straight build).
  const cont = page.getByRole("button", { name: "Continue" });
  await expect(cont).toBeEnabled();
  await cont.click();

  const grillQ = page.getByTestId("grill-question").first();
  const reward = page.getByRole("heading", { name: "You own your facts" });
  await expect(grillQ.or(reward)).toBeVisible({ timeout: 120_000 }); // build includes the LLM audit

  let grillAnswer: string | null = null;
  if (await grillQ.isVisible()) {
    grillAnswer = "handled a 2 million dollar budget"; // a distinctive answer to trace into the CV
    await grillQ.getByRole("textbox").fill(grillAnswer);
    await page.getByRole("button", { name: "Build my verified CV" }).click();
  }

  // Clean gate → the reward screen with a rendered CV…
  await expect(reward).toBeVisible({ timeout: 120_000 }); // build includes the LLM audit
  const rootcv = page.getByTestId("rootcv");
  await expect(page.getByTestId("cv-bullet").first()).toBeVisible(); // at least one bullet rendered

  // …a grill answer we gave becomes a fact in the CV (JC-24 persistence; user-authored words are
  // never reworded by the audit, so the exact text must survive)…
  if (grillAnswer) await expect(rootcv).toContainText(grillAnswer);

  // …and the claim we rejected is nowhere in it (nothing renders that the user didn't confirm).
  if (rejectedText && rejectedText.length > 12) {
    await expect(rootcv).not.toContainText(rejectedText);
  }

  // The root-CV review (decision #7): fix a line → the fact behind it is edited (user-authored),
  // the CV rebuilds through audit + gate, and the exact fixed words render.
  const fixedText = "Chaired the weekly delivery review for 6 squads";
  await page.getByTestId("cv-bullet").first().getByRole("button", { name: "fix" }).click();
  await page.getByTestId("fix-editor").getByRole("textbox").fill(fixedText);
  await page.getByRole("button", { name: "Save fix" }).click();
  await expect(rootcv).toContainText(fixedText, { timeout: 120_000 });
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

  // Nothing confirmed → no gaps to grill → Continue goes straight to build.
  await page.getByRole("button", { name: "Continue" }).click();

  // Failing gate → a precise loop-back, never a dead end and never a certified empty CV.
  await expect(page.getByRole("heading", { name: "Almost there" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/at least one fact/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to my facts" })).toBeVisible();
});
