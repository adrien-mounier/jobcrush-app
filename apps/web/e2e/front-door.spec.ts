import { expect, test, type Page } from "@playwright/test";

type SourceEntry =
  | null
  | { checkpoint: "invited"; choice: null }
  | { checkpoint: "source_selected"; choice: "cv" | "questions" };

async function stubSourceEntry(
  page: Page,
  initial: SourceEntry = null,
  importProof?: Record<string, unknown>,
) {
  let sourceEntry = initial;
  const writes: unknown[] = [];

  await page.route("**/api/sessions/me", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { sourceEntry, ...(importProof ? { importProof } : {}) } });
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

async function stubCvImport(
  page: Page,
  snapshots: Array<Record<string, unknown>>,
) {
  await page.route("**/api/uploads", async (route) => {
    await route.fulfill({ json: { id: "upload-1", putUrl: "/uploads/upload-1" } });
  });
  await page.route("**/api/uploads/upload-1", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/uploads/upload-1/complete", async (route) => {
    await route.fulfill({ json: { jobId: "job-1" } });
  });
  await page.route("**/api/jobs/job-1/events", async (route) => {
    const body = snapshots.map((snapshot) => `data: ${JSON.stringify(snapshot)}\n\n`).join("");
    await route.fulfill({
      contentType: "text/event-stream",
      body,
    });
  });
}

async function chooseCv(page: Page) {
  await page.getByRole("button", { name: /Use my CV/ }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "cv.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("cv"),
  });
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

test("CV reading becomes a compact server-authored proof with equivalent facts shown once", async ({ page }) => {
  await stubSourceEntry(page, { checkpoint: "invited", choice: null });
  await stubCvImport(page, [
    { id: "job-1", status: "running", error: null, progress: {} },
    {
      id: "job-1",
      status: "completed",
      error: null,
      progress: {
        importProof: {
          outcome: "success",
          usefulFactCount: 1,
          skippedQuestionCount: 0,
          representativeFacts: [
            { id: "fact-1", text: "Led a platform migration", provenance: "cv" },
          ],
          conflict: null,
        },
      },
    },
  ]);
  await page.goto("/");

  await chooseCv(page);

  const heading = page.getByRole("heading", { name: "Your CV gave us useful facts" });
  await expect(heading).toBeFocused();
  await expect(page.getByText("1", { exact: true })).toBeVisible();
  await expect(page.getByText("0", { exact: true })).toBeVisible();
  await expect(page.getByText("We’ll use them in the next step.")).toBeVisible();
  await expect(page.getByText("Led a platform migration")).toHaveCount(1);
  await expect(page.getByText("From your CV")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Ask me what’s missing" })).toBeVisible();
});

test("local conflict saves the correction before continuing", async ({ page }) => {
  await stubSourceEntry(page, { checkpoint: "invited", choice: null });
  const proof = {
    outcome: "success",
    usefulFactCount: 3,
    skippedQuestionCount: 1,
    representativeFacts: [{ id: "fact-1", text: "Based in Bangkok", provenance: "cv" }],
    conflict: { fieldId: "location", label: "Search area", userResolvedValue: null },
  };
  await stubCvImport(page, [
    { id: "job-1", status: "completed", error: null, progress: { importProof: proof } },
  ]);
  const resolutionWrites: unknown[] = [];
  const stageWrites: unknown[] = [];
  await page.route("**/api/sessions/me/import-resolution", async (route) => {
    resolutionWrites.push(route.request().postDataJSON());
    await route.fulfill({
      json: { importProof: { ...proof, conflict: null } },
    });
  });
  await page.route("**/api/sessions/me/stage", async (route) => {
    stageWrites.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await chooseCv(page);

  const input = page.getByLabel("Search area");
  await input.fill("Remote in Thailand");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect.poll(() => resolutionWrites.length).toBe(1);
  await expect.poll(() => stageWrites.length).toBe(1);
  expect(resolutionWrites).toEqual([{ fieldId: "location", value: "Remote in Thailand" }]);
  expect(stageWrites).toEqual([{ stage: "discovery" }]);
});

test("failed conflict correction is announced, focused, and retries without losing the answer", async ({ page }) => {
  await stubSourceEntry(page, { checkpoint: "invited", choice: null });
  const proof = {
    outcome: "success",
    usefulFactCount: 1,
    skippedQuestionCount: 1,
    representativeFacts: [{ id: "fact-1", text: "Based in Bangkok", provenance: "cv" }],
    conflict: { fieldId: "location", label: "Search area", userResolvedValue: null },
  };
  await stubCvImport(page, [
    { id: "job-1", status: "completed", error: null, progress: { importProof: proof } },
  ]);
  let saveAttempts = 0;
  await page.route("**/api/sessions/me/import-resolution", async (route) => {
    saveAttempts += 1;
    if (saveAttempts === 1) {
      await route.fulfill({ status: 503, json: { error: { message: "unavailable" } } });
      return;
    }
    await route.fulfill({ json: { importProof: { ...proof, conflict: null } } });
  });
  await page.route("**/api/sessions/me/stage", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await chooseCv(page);

  await page.getByLabel("Search area").fill("Remote in Thailand");
  await page.getByRole("button", { name: "Save and continue" }).click();

  const alert = page.getByRole("alert").filter({ hasText: "We couldn’t save your answer." });
  await expect(alert).toBeFocused();
  await expect(page.getByLabel("Search area")).toHaveValue("Remote in Thailand");
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => saveAttempts).toBe(2);
});

test("partial proof keeps readable facts and offers a session-safe retry", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await stubSourceEntry(page, { checkpoint: "invited", choice: null });
  await stubCvImport(page, [{
    id: "job-1",
    status: "completed",
    error: null,
    progress: {
      importProof: {
        outcome: "partial",
        usefulFactCount: 1,
        skippedQuestionCount: 1,
        representativeFacts: [{ id: "fact-1", text: "Managed vendor delivery", provenance: "cv" }],
        conflict: null,
      },
    },
  }]);
  await page.goto("/");
  await chooseCv(page);

  await expect(page.getByRole("heading", { name: "We read part of your CV" })).toBeFocused();
  await expect(page.getByText("Managed vendor delivery")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try the CV again" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
});

test("total processing failure offers retry and question-first recovery", async ({ page }) => {
  await stubSourceEntry(page, { checkpoint: "invited", choice: null });
  await stubCvImport(page, [{
    id: "job-1",
    status: "completed",
    error: null,
    progress: {
      importProof: {
        outcome: "failed",
        usefulFactCount: 0,
        skippedQuestionCount: 0,
        representativeFacts: [],
        conflict: null,
      },
    },
  }]);
  const stageWrites: unknown[] = [];
  await page.route("**/api/sessions/me/stage", async (route) => {
    stageWrites.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await chooseCv(page);

  await expect(page.getByRole("heading", { name: "We couldn’t read your CV" })).toBeFocused();
  await expect(page.locator(".proof-metrics")).toHaveCount(0);
  await page.getByRole("button", { name: "Continue with questions" }).click();
  expect(stageWrites).toEqual([{ stage: "discovery" }]);
});

test("failed question-first continuation is announced, focused, and retryable", async ({ page }) => {
  await stubSourceEntry(page, { checkpoint: "invited", choice: null });
  await stubCvImport(page, [{
    id: "job-1",
    status: "completed",
    error: null,
    progress: {
      importProof: {
        outcome: "failed",
        usefulFactCount: 0,
        skippedQuestionCount: 0,
        representativeFacts: [],
        conflict: null,
      },
    },
  }]);
  let stageAttempts = 0;
  await page.route("**/api/sessions/me/stage", async (route) => {
    stageAttempts += 1;
    if (stageAttempts === 1) {
      await route.fulfill({ status: 503, json: { error: { message: "unavailable" } } });
      return;
    }
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await chooseCv(page);

  await page.getByRole("button", { name: "Continue with questions" }).click();

  const alert = page.getByRole("alert").filter({ hasText: "We couldn’t continue right now." });
  await expect(alert).toBeFocused();
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => stageAttempts).toBe(2);
});

test("reload restores a completed import proof without re-uploading or moving focus", async ({ page }) => {
  const proof = {
    outcome: "success",
    usefulFactCount: 2,
    skippedQuestionCount: 1,
    representativeFacts: [
      { id: "fact-1", text: "Led regional delivery", provenance: "cv" },
    ],
    conflict: null,
  };
  await stubSourceEntry(
    page,
    { checkpoint: "source_selected", choice: "cv" },
    proof,
  );
  let uploadRequests = 0;
  await page.route("**/api/uploads", async (route) => {
    uploadRequests += 1;
    await route.abort();
  });

  await page.goto("/");
  const heading = page.getByRole("heading", { name: "Your CV saved you some questions" });
  await expect(heading).toBeVisible();
  await expect(heading).not.toBeFocused();
  await expect(page.getByText("Led regional delivery")).toBeVisible();
  await page.reload();
  await expect(heading).toBeVisible();
  await expect(heading).not.toBeFocused();
  expect(uploadRequests).toBe(0);
});

test("reload restores terminal import failure without re-upload or duplicate alert", async ({ page }) => {
  await stubSourceEntry(
    page,
    { checkpoint: "source_selected", choice: "cv" },
    {
      outcome: "failed",
      usefulFactCount: 0,
      skippedQuestionCount: 0,
      representativeFacts: [],
      conflict: null,
    },
  );

  await page.goto("/");
  const heading = page.getByRole("heading", { name: "We couldn’t read your CV" });
  await expect(heading).toBeVisible();
  await expect(heading).not.toBeFocused();
  await expect(page.getByText("Your session is still here. Try your CV again, or continue without it.")).not.toHaveAttribute("role", "alert");
  await expect(page.locator(".proof-metrics")).toHaveCount(0);
  await page.reload();
  await expect(heading).toBeVisible();
  await expect(heading).not.toBeFocused();
});

test("no useful facts is neutral, retryable, continuable, and durable across reload", async ({ page }) => {
  await stubSourceEntry(
    page,
    { checkpoint: "source_selected", choice: "cv" },
    {
      outcome: "no_useful_facts",
      usefulFactCount: 0,
      skippedQuestionCount: 0,
      representativeFacts: [],
      conflict: null,
    },
  );
  const stageWrites: unknown[] = [];
  await page.route("**/api/sessions/me/stage", async (route) => {
    stageWrites.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });

  await page.goto("/");
  const heading = page.getByRole("heading", { name: "We couldn’t find useful facts" });
  await expect(heading).toBeVisible();
  await expect(heading).not.toBeFocused();
  await expect(page.getByText("Try another CV, or continue with questions.")).not.toHaveAttribute("role", "alert");
  await expect(page.locator(".proof-metrics, .proof-facts")).toHaveCount(0);

  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Try another CV" }).click();
  const chooser = await chooserPromise;
  expect(chooser.isMultiple()).toBe(false);

  await page.reload();
  await expect(heading).toBeVisible();
  await expect(heading).not.toBeFocused();
  await page.getByRole("button", { name: "Continue with questions" }).click();
  await expect.poll(() => stageWrites).toEqual([{ stage: "discovery" }]);
});
