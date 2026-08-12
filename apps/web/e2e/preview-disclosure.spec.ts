import { expect, test } from "@playwright/test";
import type { JobDisclosure } from "../lib/api";

// #154 — the disclosure block on the DRAFT screen, route-mocked (no LLM, deterministic, Tier 1).
//
// This spec exists because the payload half of this feature can pass on its own while the person
// sees nothing: #159's loss notices have been sent to this screen since it was built and were never
// rendered by it — they only ever appeared on the wait screen, where they scroll past before the
// person has seen their CV. An assertion on the server's payload would have called that shipped.
//
// It also pins the two wordings apart. Facts held back are a CHOICE, explained by relevance to this
// posting. An over-full line is a FAULT of ours, and explaining a fault as a choice is what
// ADR-0004 clause 1 forbids — so the block must never describe the dropped result as something that
// mattered least.

const DISCLOSURE: JobDisclosure[] = [
  {
    employer: "BRED",
    role: "Card Services Manager",
    factCount: 14,
    heldBack: [
      "Managed card services workstream 1 across the retail portfolio.",
      "Managed card services workstream 2 across the retail portfolio.",
    ],
    overfull: [
      {
        text: "Led PIN-code authentication and self-service card activation across retail card services.",
        count: 4,
        lostResult: true,
        sources: [
          "Led the PIN-code authentication rollout for retail cards, strengthening customer security.",
          "Delivered self-service card activation, improving customer autonomy and reducing support workload.",
        ],
      },
    ],
  },
];

async function stubDraft(
  page: import("@playwright/test").Page,
  preview: Record<string, unknown>,
) {
  await page.route("**/api/jobs/job-1", async (route) => {
    await route.fulfill({
      json: { id: "job-1", status: "completed", error: null, progress: { preview } },
    });
  });
  await page.route("**/api/previews/job-1", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: "<html><body><h1>Adrien Mounier</h1></body></html>",
    });
  });
}

const BASE_PREVIEW = { postingTitle: "Card Services Lead", postingCompany: "ABA" };

test("the draft screen shows why facts are missing, in the profile's own words", async ({ page }) => {
  await stubDraft(page, { ...BASE_PREVIEW, disclosure: DISCLOSURE });
  await page.goto("/preview/job-1");

  // The reason comes before the loss: the person is told the budget exists, not just that something
  // went missing.
  await expect(page.getByText(/Your profile holds/)).toBeVisible();
  await expect(page.getByText(/14 facts/)).toBeVisible();
  await expect(page.getByText(/cannot all print at full length/)).toBeVisible();

  // The choice: held back, behind a count that opens, so a dense CV is not buried under a wall of
  // text. The wording is the profile screen's own ("kept for when a job needs them").
  const heldBack = page.getByText(/2 facts are not printed/);
  await expect(heldBack).toBeVisible();
  await expect(page.getByText(/matter least for this job/)).toBeVisible();
  await expect(page.getByText(/kept for when a job needs them/i)).toBeVisible();
  await expect(
    page.getByText("Managed card services workstream 1 across the retail portfolio."),
  ).toBeHidden();
  await heldBack.click();
  await expect(
    page.getByText("Managed card services workstream 1 across the retail portfolio."),
  ).toBeVisible();

  // The fault: the printed line, then the profile's OWN sentences — the input, not the output. The
  // person cannot judge the trade from the merged line alone; it is the thing already on the CV
  // above.
  await expect(page.getByText(/One printed line carries 4 facts at once/)).toBeVisible();
  await expect(page.getByText(/states what none of them achieved/)).toBeVisible();
  await expect(
    page.getByText(
      "Led the PIN-code authentication rollout for retail cards, strengthening customer security.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(/We could not fit these 4 facts and keep what they achieved/),
  ).toBeVisible();
});

test("a clean draft says nothing — no block, no empty heading", async ({ page }) => {
  await stubDraft(page, { ...BASE_PREVIEW, disclosure: [] });
  await page.goto("/preview/job-1");
  await expect(page.getByRole("heading", { name: /Your draft, tailored/ })).toBeVisible();
  await expect(page.getByText(/Your profile holds/)).toBeHidden();
  await expect(page.getByText(/not printed/)).toBeHidden();
});

test("conservation notices reach the screen showing the CV, not only the wait screen", async ({
  page,
}) => {
  await stubDraft(page, {
    ...BASE_PREVIEW,
    disclosure: [],
    conservationNotices: ["Your PRINCE2 certification is not on this draft."],
  });
  await page.goto("/preview/job-1");
  await expect(
    page.getByText("Your PRINCE2 certification is not on this draft."),
  ).toBeVisible();
});
