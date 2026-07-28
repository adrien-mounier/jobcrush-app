import { expect, test, type Page } from "@playwright/test";

type SourceEntry =
  | null
  | { checkpoint: "invited"; choice: null }
  | { checkpoint: "source_selected"; choice: "cv" | "questions" };

async function stubSourceEntry(page: Page, initial: SourceEntry = null) {
  let sourceEntry = initial;
  const writes: unknown[] = [];

  await page.route("**/api/sessions/me", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { sourceEntry } });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/sessions/me/source-entry", async (route) => {
    const body = route.request().postDataJSON();
    writes.push(body);
    sourceEntry = body;
    await route.fulfill({ json: { sourceEntry } });
  });

  return writes;
}

test("Ready? opens source assistance at / without authentication", async ({ page }) => {
  const writes = await stubSourceEntry(page);
  await page.goto("/");
  await page.mouse.click(10, 10);

  await page.getByRole("button", { name: "Ready?" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Can something you already have help?" })).toBeFocused();
  await expect(page.getByTestId("source-actions")).toBeVisible();
  expect(writes).toEqual([{ checkpoint: "invited", choice: null }]);
});

test("reduced motion renders the complete stable invitation immediately", async ({ page }) => {
  await stubSourceEntry(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page.locator(".l1 .tx")).toHaveText("Answer questions.");
  await expect(page.locator(".l2 .tx")).toHaveText("Collect jobs.");
  await expect(page.locator(".caret")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ready?" })).toBeEnabled();
  await page.getByRole("button", { name: "Ready?" }).click();
  await expect(page.getByTestId("front-door")).toHaveAttribute("data-view", "source");
});

for (const choice of ["cv", "questions"] as const) {
  test(`${choice} choice persists and restores after reload`, async ({ page }) => {
    const writes = await stubSourceEntry(page, { checkpoint: "invited", choice: null });
    await page.goto("/");

    const name = choice === "cv" ? "Use my CV" : "Start questions instead";
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await expect(page.locator(`[data-source="${choice}"]`)).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page.locator(`[data-source="${choice}"]`)).toHaveAttribute("aria-pressed", "true");
    expect(writes).toEqual([{ checkpoint: "source_selected", choice }]);
  });
}

test("LinkedIn is disabled, says Coming soon, and cannot collect or persist data", async ({ page }) => {
  const writes = await stubSourceEntry(page, { checkpoint: "invited", choice: null });
  await page.goto("/");

  const linkedIn = page.getByRole("button", { name: "Use LinkedIn — Coming soon" });
  await expect(linkedIn).toBeDisabled();
  await expect(linkedIn).toContainText("Coming soon");
  await expect(page.locator('input[type="url"], input[name*="linkedin" i]')).toHaveCount(0);
  await linkedIn.click({ force: true });
  expect(writes).toEqual([]);
});

test("checkpoint load failure shows the exact alert and retries restoration", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/sessions/me", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 503, json: { error: { message: "unavailable" } } });
      return;
    }
    await route.fulfill({
      json: { sourceEntry: { checkpoint: "invited", choice: null } },
    });
  });

  await page.goto("/");
  const alert = page.locator(".async-error[role='alert']");
  await expect(alert).toContainText("We couldn’t restore your progress.");
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("source-actions")).toBeVisible();
  expect(attempts).toBe(2);
});

test("failed save restores the durable choice and retry persists the intended choice", async ({ page }) => {
  let sourceEntry: SourceEntry = { checkpoint: "source_selected", choice: "cv" };
  let saveAttempts = 0;
  await page.route("**/api/sessions/me", async (route) => {
    await route.fulfill({ json: { sourceEntry } });
  });
  await page.route("**/api/sessions/me/source-entry", async (route) => {
    saveAttempts += 1;
    if (saveAttempts === 1) {
      await route.fulfill({ status: 503, json: { error: { message: "unavailable" } } });
      return;
    }
    sourceEntry = route.request().postDataJSON();
    await route.fulfill({ json: { sourceEntry } });
  });

  await page.goto("/");
  await expect(page.locator('[data-source="cv"]')).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Start questions instead/ }).click();

  const alert = page.getByTestId("source-checkpoint-status").getByRole("alert");
  await expect(alert).toContainText("We couldn’t save that choice.");
  await expect(page.locator('[data-source="cv"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-source="questions"]')).toHaveAttribute("aria-pressed", "false");

  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator('[data-source="questions"]')).toHaveAttribute("aria-pressed", "true");
  expect(saveAttempts).toBe(2);
});
