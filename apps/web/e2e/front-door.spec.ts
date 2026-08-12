import { expect, test, type Page } from "@playwright/test";

type SourceEntry =
  | null
  | { checkpoint: "invited"; choice: null }
  | { checkpoint: "source_selected"; choice: "cv" | "questions" };

async function stubSourceEntry(
  page: Page,
  initial: SourceEntry = null,
  importProof?: Record<string, unknown>,
  stage?: string,
) {
  let sourceEntry = initial;
  const writes: unknown[] = [];

  await page.route("**/api/sessions/me", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: {
          sourceEntry,
          ...(importProof ? { importProof } : {}),
          ...(stage ? { stage } : {}),
        },
      });
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

// #184 (#172): the pinned area-resolution shape, additive on the existing area-submission response —
// mirrors lib/api.ts's SearchAreaResolution. Absent on a response whose submission never touched the
// area (e.g. a role-only save).
type SearchAreaResolution =
  | { covered: true; market: string; marketKey: string }
  | { covered: false; coverage: string[] };

type IntentState = {
  intent: { targetRole: string | null; searchArea: string | null };
  missing: Array<"targetRole" | "searchArea">;
  checkpoint: "intent_needed" | "intent_known";
  searchAreaResolution?: SearchAreaResolution;
};

async function stubIntent(page: Page, initial: IntentState, failFirstSave = false) {
  let state = initial;
  let saveAttempts = 0;
  const writes: unknown[] = [];
  await page.route("**/api/sessions/me/stage", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/sessions/me/intent", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: state });
      return;
    }
    saveAttempts += 1;
    const body = route.request().postDataJSON() as Partial<IntentState["intent"]>;
    writes.push(body);
    if (failFirstSave && saveAttempts === 1) {
      await route.fulfill({ status: 503, json: { error: { message: "unavailable" } } });
      return;
    }
    state = {
      intent: { ...state.intent, ...body },
      missing: [],
      checkpoint: "intent_known",
    };
    await route.fulfill({ json: state });
  });
  return { writes, getSaveAttempts: () => saveAttempts };
}

// #184 (#172): a variant of stubIntent that lets each test decide how the mocked server resolves
// the submitted area, per the pinned searchAreaResolution contract — kept separate from stubIntent
// (which always advances unconditionally) so none of the existing area-agnostic tests above change
// behaviour.
async function stubIntentWithResolution(
  page: Page,
  initial: IntentState,
  resolve: (body: Partial<IntentState["intent"]>) => IntentState,
) {
  let state = initial;
  const writes: unknown[] = [];
  await page.route("**/api/sessions/me/stage", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/sessions/me/intent", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: state });
      return;
    }
    const body = route.request().postDataJSON() as Partial<IntentState["intent"]>;
    writes.push(body);
    state = resolve(body);
    await route.fulfill({ json: state });
  });
  return { writes };
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
    if (choice === "questions") {
      await stubIntent(page, {
        intent: { targetRole: null, searchArea: null },
        missing: ["targetRole", "searchArea"],
        checkpoint: "intent_needed",
      });
    }
    await page.goto("/");

    const name = choice === "cv" ? "Use my CV" : "Start questions instead";
    await page.getByRole("button", { name: new RegExp(name) }).click();
    if (choice === "cv") {
      await expect(page.locator('[data-source="cv"]')).toHaveAttribute("aria-pressed", "true");
    } else {
      await expect(page.getByLabel("Target role")).toBeVisible();
    }
    await page.reload();
    if (choice === "cv") {
      await expect(page.locator('[data-source="cv"]')).toHaveAttribute("aria-pressed", "true");
    } else {
      await expect(page.getByLabel("Target role")).toBeVisible();
    }
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
  // #201: a successful "questions" retry advances into the intent flow, whose stage/intent calls
  // this test previously left unmocked — they escaped to the real qa API (no session there), and
  // the failure's timing relative to the aria-pressed poll was the CI flake. Mocked, the outcome
  // is deterministic: the retry lands on the intent form.
  await stubIntent(page, {
    intent: { targetRole: null, searchArea: null },
    missing: ["targetRole", "searchArea"],
    checkpoint: "intent_needed",
  });

  await page.goto("/");
  await expect(page.locator('[data-source="cv"]')).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Start questions instead/ }).click();

  const alert = page.getByTestId("source-checkpoint-status").getByRole("alert");
  await expect(alert).toContainText("We couldn’t save that choice.");
  await expect(page.locator('[data-source="cv"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-source="questions"]')).toHaveAttribute("aria-pressed", "false");

  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByLabel("Target role")).toBeVisible();
  expect(saveAttempts).toBe(2);
  expect(sourceEntry).toEqual({ checkpoint: "source_selected", choice: "questions" });
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

test("both missing intent fields save together without promoting history or residence", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await stubSourceEntry(page, { checkpoint: "invited", choice: null });
  const intent = await stubIntent(page, {
    intent: { targetRole: null, searchArea: null },
    missing: ["targetRole", "searchArea"],
    checkpoint: "intent_needed",
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Start questions instead/ }).click();

  await expect(page.getByRole("heading", {
    name: "What kind of job are you going for, and where?",
  })).toBeFocused();
  await expect(page.getByText(
    "Tell us what you want next. Your work history and where you live don’t decide this for you.",
  )).toBeVisible();
  await expect(page.getByLabel("Target role")).toHaveValue("");
  await expect(page.getByLabel("Search area")).toHaveValue("");

  await page.getByLabel("Target role").fill("Platform delivery lead");
  await page.getByLabel("Search area").fill("Remote in Thailand");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page.getByRole("heading", { name: "Got it." })).toBeVisible();
  await expect(page.getByText(
    "We’ll look for Platform delivery lead in Remote in Thailand.",
  )).toBeVisible();
  await expect(page.getByText(/jobs? (found|matched|available)|\d+ jobs/i)).toHaveCount(0);
  expect(intent.writes).toEqual([{
    targetRole: "Platform delivery lead",
    searchArea: "Remote in Thailand",
  }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
});

test("server-supported role asks only for search area and restores accepted intent", async ({ page }) => {
  await stubSourceEntry(page, { checkpoint: "source_selected", choice: "questions" });
  const intent = await stubIntent(page, {
    intent: { targetRole: "Technical programme manager", searchArea: null },
    missing: ["searchArea"],
    checkpoint: "intent_needed",
  });

  await page.goto("/");
  await expect(page.getByLabel("Target role")).toHaveCount(0);
  await expect(page.getByText("Looking for Technical programme manager")).toBeVisible();
  await page.getByLabel("Search area").fill("Bangkok");
  await page.getByRole("button", { name: "Save and continue" }).click();
  expect(intent.writes).toEqual([{ searchArea: "Bangkok" }]);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Got it." })).toBeVisible();
  await expect(page.getByText(
    "We’ll look for Technical programme manager in Bangkok.",
  )).toBeVisible();
  await expect(page.getByText("Saved.", { exact: true })).toHaveCount(0);
});

test("CV proof continuation reload restores durable intent instead of returning to proof", async ({ page }) => {
  await stubSourceEntry(
    page,
    { checkpoint: "source_selected", choice: "cv" },
    {
      outcome: "success",
      usefulFactCount: 2,
      skippedQuestionCount: 1,
      representativeFacts: [
        { id: "fact-1", text: "Led regional delivery", provenance: "cv" },
      ],
      conflict: null,
    },
    "discovery",
  );
  await stubIntent(page, {
    intent: {
      targetRole: "Technical programme manager",
      searchArea: "Remote in Thailand",
    },
    missing: [],
    checkpoint: "intent_known",
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Got it." })).toBeVisible();
  await expect(page.getByText(
    "We’ll look for Technical programme manager in Remote in Thailand.",
  )).toBeVisible();
  await expect(page.getByText("Your CV saved you some questions")).toHaveCount(0);
  await expect(page.getByText("Saved.", { exact: true })).toHaveCount(0);
});

test("server-supported area asks only for role; validation and retry retain exact values", async ({ page }) => {
  await stubSourceEntry(page, { checkpoint: "source_selected", choice: "questions" });
  const intent = await stubIntent(page, {
    intent: { targetRole: null, searchArea: "Chiang Mai or remote" },
    missing: ["targetRole"],
    checkpoint: "intent_needed",
  }, true);

  await page.goto("/");
  await expect(page.getByLabel("Search area")).toHaveCount(0);
  await expect(page.getByText("Searching in Chiang Mai or remote")).toBeVisible();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByLabel("Target role")).toBeFocused();
  await expect(page.getByText("Tell us the target role you want next.")).toBeVisible();
  await expect(page.getByLabel("Target role")).toHaveAttribute("aria-invalid", "true");

  await page.getByLabel("Target role").fill("  Portfolio coach  ");
  await page.getByRole("button", { name: "Save and continue" }).click();
  const alert = page.getByRole("alert").filter({
    hasText: "We couldn’t save that. Your answers are still here.",
  });
  await expect(alert).toBeFocused();
  await expect(page.getByLabel("Target role")).toHaveValue("  Portfolio coach  ");
  await alert.getByRole("button", { name: "Try again" }).click();

  await expect(page.getByRole("heading", { name: "Got it." })).toBeVisible();
  expect(intent.writes).toEqual([
    { targetRole: "Portfolio coach" },
    { targetRole: "Portfolio coach" },
  ]);
  expect(intent.getSaveAttempts()).toBe(2);
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

// ---------- #184 (#172): the search-area entry gets an on-the-spot coverage answer ----------

test("an uncovered search area shows the early-access line on the spot and never passes onward", async ({ page }) => {
  await stubSourceEntry(page, { checkpoint: "source_selected", choice: "questions" });
  const intent = await stubIntentWithResolution(
    page,
    { intent: { targetRole: "Delivery manager", searchArea: null }, missing: ["searchArea"], checkpoint: "intent_needed" },
    // The real pinned shape (server-side gate): an uncovered area still STORES the typed text and
    // the checkpoint stays "intent_needed" — the server itself never advances past it, the client
    // no longer has to re-decide that.
    (body) => ({
      intent: { targetRole: "Delivery manager", searchArea: body.searchArea ?? null },
      missing: ["searchArea"],
      checkpoint: "intent_needed",
      searchAreaResolution: { covered: false, coverage: ["Hong Kong", "Singapore", "Vietnam", "Australia"] },
    }),
  );

  await page.goto("/");
  await expect(page.getByText("Looking for Delivery manager")).toBeVisible();
  await page.getByLabel("Search area").fill("Bangkok");
  await page.getByRole("button", { name: "Save and continue" }).click();

  const message = page.getByText(
    "JobCrush is in early access — we currently cover Hong Kong, Singapore, Vietnam and Australia.",
  );
  await expect(message).toBeVisible();
  await expect(message).not.toHaveAttribute("role", "alert"); // a stated fact, never an error scolding
  await expect(page.getByLabel("Search area")).toBeFocused();
  await expect(page.getByLabel("Search area")).toHaveValue("Bangkok"); // kept so the person can retype
  await expect(page.getByRole("heading", { name: "Got it." })).toHaveCount(0); // never passes onward
  expect(intent.writes).toEqual([{ searchArea: "Bangkok" }]);

  // Editing the field clears the stale message rather than leaving it hanging.
  await page.getByLabel("Search area").fill("Hong Kong");
  await expect(message).toHaveCount(0);
});

test("an uncovered search area still blocks the form after a reload, with the coverage line restored", async ({ page }) => {
  await stubSourceEntry(page, { checkpoint: "source_selected", choice: "questions" });
  await stubIntentWithResolution(
    page,
    { intent: { targetRole: "Delivery manager", searchArea: null }, missing: ["searchArea"], checkpoint: "intent_needed" },
    (body) => ({
      intent: { targetRole: "Delivery manager", searchArea: body.searchArea ?? null },
      missing: ["searchArea"],
      checkpoint: "intent_needed",
      searchAreaResolution: { covered: false, coverage: ["Hong Kong", "Singapore", "Vietnam", "Australia"] },
    }),
  );

  await page.goto("/");
  await page.getByLabel("Search area").fill("Bangkok");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByText(
    "JobCrush is in early access — we currently cover Hong Kong, Singapore, Vietnam and Australia.",
  )).toBeVisible();

  // MUST-FIX: a cold reload reads the restored resolution too — the form stays blocked and the
  // coverage line reappears on its own, instead of sitting unexplained until the person retypes.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Got it." })).toHaveCount(0);
  await expect(page.getByLabel("Search area")).toHaveValue("Bangkok"); // the typed text still stored
  await expect(page.getByText(
    "JobCrush is in early access — we currently cover Hong Kong, Singapore, Vietnam and Australia.",
  )).toBeVisible();
});

test("a covered area with a trailing country resolves and is confirmed back plainly", async ({ page }) => {
  await stubSourceEntry(page, { checkpoint: "source_selected", choice: "questions" });
  await stubIntentWithResolution(
    page,
    { intent: { targetRole: "Delivery manager", searchArea: null }, missing: ["searchArea"], checkpoint: "intent_needed" },
    () => ({
      intent: { targetRole: "Delivery manager", searchArea: "Hong Kong, China" },
      missing: [],
      checkpoint: "intent_known",
      searchAreaResolution: { covered: true, market: "Hong Kong", marketKey: "hong-kong" },
    }),
  );

  await page.goto("/");
  await page.getByLabel("Search area").fill("Hong Kong, China"); // trailing country + punctuation
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page.getByRole("heading", { name: "Got it." })).toBeVisible();
  // Confirmed back with the resolved canonical name, not the raw typed alias.
  await expect(page.getByText("We’ll search Hong Kong.")).toBeVisible();
});

test("a covered area shows the canonical market after a reload too, never the raw typed alias", async ({ page }) => {
  await stubSourceEntry(page, { checkpoint: "source_selected", choice: "questions" });
  await stubIntentWithResolution(
    page,
    { intent: { targetRole: "Delivery manager", searchArea: null }, missing: ["searchArea"], checkpoint: "intent_needed" },
    () => ({
      intent: { targetRole: "Delivery manager", searchArea: "Hong Kong, China" },
      missing: [],
      checkpoint: "intent_known",
      searchAreaResolution: { covered: true, market: "Hong Kong", marketKey: "hong-kong" },
    }),
  );

  await page.goto("/");
  await page.getByLabel("Search area").fill("Hong Kong, China");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByText("We’ll search Hong Kong.")).toBeVisible();

  // MUST-FIX: before this fix, a reload re-rendered the raw stored alias ("Hong Kong, China")
  // instead of the canonical resolved market — inconsistent with what a fresh save just showed.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Got it." })).toBeVisible();
  await expect(page.getByText("Hong Kong, China")).toHaveCount(0);
  await expect(page.getByText("We’ll look for Delivery manager in Hong Kong.")).toBeVisible();
});

test("the uncovered coverage list is rendered from the response, never a hard-coded copy", async ({ page }) => {
  await stubSourceEntry(page, { checkpoint: "source_selected", choice: "questions" });
  await stubIntentWithResolution(
    page,
    { intent: { targetRole: "Delivery manager", searchArea: null }, missing: ["searchArea"], checkpoint: "intent_needed" },
    () => ({
      intent: { targetRole: "Delivery manager", searchArea: null },
      missing: ["searchArea"],
      checkpoint: "intent_needed",
      // A coverage list the product has never shipped — proves the UI has no second, hard-coded
      // copy of the provider registry's served regions.
      searchAreaResolution: { covered: false, coverage: ["Testland", "Sampleria"] },
    }),
  );

  await page.goto("/");
  await page.getByLabel("Search area").fill("Nowhere");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page.getByText("JobCrush is in early access — we currently cover Testland and Sampleria.")).toBeVisible();
});

test("both search-area placeholder examples are covered markets", async ({ page }) => {
  const COVERED_MARKETS = ["Hong Kong", "Singapore", "Vietnam", "Australia"];
  await stubSourceEntry(page, { checkpoint: "invited", choice: null });
  await stubIntent(page, {
    intent: { targetRole: null, searchArea: null },
    missing: ["targetRole", "searchArea"],
    checkpoint: "intent_needed",
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Start questions instead/ }).click();

  const placeholder = await page.getByLabel("Search area").getAttribute("placeholder");
  expect(placeholder).toBe("e.g. Hong Kong, or Remote in Vietnam");
  const examples = placeholder!.replace("e.g. ", "").split(", or ");
  expect(examples).toHaveLength(2);
  for (const example of examples) {
    expect(COVERED_MARKETS.some((market) => example.includes(market))).toBe(true);
  }
});
