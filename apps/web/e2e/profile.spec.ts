import { expect, test, type Page } from "@playwright/test";
import type { ProfileState } from "../lib/api";

// #20 the profile screen (Sorted + Constellation), under the colour law: gold = on the CV right now,
// grey = saved in reserve — never presented as a lack. Route-mocked to the pinned ProfileState shape
// (the backend for GET /profile may not be wired when this runs, matching discovery.spec.ts's own
// assumption). Not testing the Constellation canvas's visual craft — only that the screen loads, the
// toggle switches views, both colour states render with source as neutral text, and every fact is
// reachable by keyboard through the accessible list.

async function stubSession(page: Page) {
  await page.route("**/api/sessions/me", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
}

const PROFILE: ProfileState = {
  factCount: 4,
  search: { role: "IT project manager in Paris", family: null, siblingTitles: [], openJobs: null },
  domains: [
    {
      tag: "experience",
      heading: "Professional Experience",
      facts: [
        { id: "e1", text: "Managed a team of six engineers.", colour: "gold", source: "told" },
        {
          id: "e2",
          text: "Owned a seven-figure vendor budget while coordinating finance, procurement, and delivery.",
          colour: "grey",
          source: "read",
        },
        { id: "e3", text: "Led SAP cutover planning.", colour: "grey", source: "told" },
      ],
    },
    {
      tag: "skill",
      heading: "Skills",
      facts: [{ id: "s1", text: "SQL.", colour: "gold", source: "told" }],
    },
  ],
};

async function stubProfile(page: Page, state: ProfileState = PROFILE) {
  await page.route("**/api/profile", async (route) => {
    await route.fulfill({ json: state });
  });
}

test("the screen loads, opening on the fullest domain with its strongest fact leading", async ({ page }) => {
  await stubSession(page);
  await stubProfile(page);

  await page.goto("/profile");

  const heading = page.getByRole("heading", { name: "4 things you've told me" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();

  // The fullest domain (Professional Experience, 3 facts) is listed before Skills (1 fact).
  const domainNames = page.locator(".dname");
  await expect(domainNames.nth(0)).toHaveText("Professional Experience");
  await expect(domainNames.nth(1)).toHaveText("Skills");

  // Its lead is the longest fact, without preferring gold over grey.
  const firstLead = page.locator(".dlead").first();
  await expect(firstLead).toHaveText("Owned a seven-figure vendor budget while coordinating finance, procurement, and delivery.");
  await expect(firstLead).toHaveClass(/grey/);
  await expect(firstLead).toHaveCSS("color", "rgb(151, 170, 188)");
  await expect(page.locator(".dlead").nth(1)).toHaveClass(/gold/);
});

test("the toggle switches Sorted and Constellation under one colour law", async ({ page }) => {
  await stubSession(page);
  await stubProfile(page);
  await page.goto("/profile");

  const sortedBtn = page.getByRole("button", { name: "Sorted" });
  const constellationBtn = page.getByRole("button", { name: "Constellation" });
  await expect(sortedBtn).toHaveAttribute("aria-pressed", "true");

  await constellationBtn.click();
  await expect(constellationBtn).toHaveAttribute("aria-pressed", "true");
  await expect(sortedBtn).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".sky")).toBeVisible();
  await expect(page.getByText("Constellation view")).toBeAttached(); // the live-region announcement

  await sortedBtn.click();
  await expect(sortedBtn).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".sheetwrap")).toBeVisible();
});

test("both colours render, and source is neutral text — never a colour, never a lacks list", async ({ page }) => {
  await stubSession(page);
  await stubProfile(page);
  await page.goto("/profile");

  // A gold fact and a grey fact both render as fact chips in Sorted.
  await expect(page.locator(".fact.gold").first()).toBeVisible();
  await expect(page.locator(".fact.grey").first()).toBeVisible();

  // Opening a grey (reserve) fact shows the neutral "read from CV" source line, never styled as a gap.
  const greyFact = page.locator(".fact.grey").first();
  await greyFact.click();
  const dialog = page.locator("dialog.detail");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Saved to your profile")).toBeVisible();
  await expect(dialog.getByText(/told me this|Read from your CV/)).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(greyFact).toBeFocused();

  // No "what you lack" list anywhere on the page.
  await expect(page.getByText(/lack/i)).toHaveCount(0);
});

test("the Sorted detail dialog returns focus to the opener after Escape", async ({ page }) => {
  await stubSession(page);
  await stubProfile(page);
  await page.goto("/profile");

  const fact = page.getByRole("button", { name: /Led SAP cutover planning/ });
  await fact.focus();
  await page.keyboard.press("Enter");

  const dialog = page.locator("dialog.detail");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(fact).toBeFocused();
});

test("every fact is reachable by keyboard, including in Constellation", async ({ page }) => {
  await stubSession(page);
  await stubProfile(page);
  await page.goto("/profile");

  await page.getByRole("button", { name: "Constellation" }).click();

  const stars = page.locator(".skylist button");
  await expect(stars).toHaveCount(4);

  // Tabbing to each visible star button opens its detail sheet — the canvas's keyboard equivalent.
  for (let i = 0; i < (await stars.count()); i++) {
    await expect(stars.nth(i)).toBeVisible();
    await stars.nth(i).focus();
    await expect(stars.nth(i)).toBeFocused();
  }
  await expect(page.locator(".sheet.in")).toBeVisible();
});
