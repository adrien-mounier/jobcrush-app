import { expect, test, type Page } from "@playwright/test";
import type { JobBlockView, JobFamilyChoice } from "../lib/api";

// #221 — the review screen's batched family question, route-mocked exactly as factbadge.spec.ts /
// tailor.spec.ts do. This spec exists because the payload is not the product: every server-side test
// for the placements can pass while the question never reaches the screen (the #162 lesson, learnt
// the expensive way). It asserts the RENDER — what a person is asked, what they are not asked, and
// what their answer sends.
//
// Every block is served already confirmed, so the deck lands straight on its end state: that is
// where the family questions live, batched, after the card-by-card check (#221 AC4).

const IT_DELIVERY: JobFamilyChoice = { familyId: "it-project-delivery", version: 1, label: "IT project delivery" };
const PRODUCT: JobFamilyChoice = { familyId: "product-management", version: 2, label: "Product management" };

function decision<T>(id: string, value: T) {
  return {
    id,
    value,
    origin: { kind: "read" as const, source_quote: "from the CV" },
    machine_touch: "verbatim" as const,
    classification: "Verified" as const,
  };
}

function block(id: string, title: string, employer: string, family: JobBlockView["family"]["value"]): JobBlockView {
  return {
    id,
    kind: "job",
    countsTowardExperience: true,
    employer: decision(`${id}:employer`, employer),
    title: decision(`${id}:title`, title),
    start: decision(`${id}:start`, { year: 2019, month: 1, precision: "month" as const }),
    end: decision(`${id}:end`, { state: "ended" as const, date: { year: 2022, month: 3, precision: "month" as const } }),
    kindDecision: decision(`${id}:kind`, "job" as const),
    family: {
      id: `${id}:family`,
      value: family,
      origin: { kind: "worked_out" },
      machine_touch: null,
      classification: null,
    },
    confirmed: true,
    matchState: "new",
    candidateBlockIds: [],
  };
}

const PLACED = block("nordic-pm", "IT Project Manager", "Nordic Retail", {
  schemaVersion: "1",
  outcome: "confirmed",
  family: { familyId: IT_DELIVERY.familyId, version: IT_DELIVERY.version },
});
const UNPLACED = block("cafe-baker", "Pastry Chef", "Café Nord", { schemaVersion: "1", outcome: "unmapped" });
const AMBIGUOUS = block("acme-lead", "Delivery Lead", "Acme", {
  schemaVersion: "1",
  outcome: "needs_clarification",
  choices: [IT_DELIVERY, PRODUCT],
});
// Never labeled at all (the labeler's call failed): reads exactly like unmapped to a person.
const UNLABELED = block("baltic-coord", "Project Coordinator", "Baltic", null);

async function stub(page: Page, blocks: JobBlockView[]) {
  await page.route("**/api/sessions/me", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/job-blocks", (route) =>
    route.fulfill({
      json: {
        blocks,
        summary: { totalBlocks: blocks.length, confirmedBlocks: blocks.length, read: { status: "ok", blocksFound: blocks.length } },
        families: [IT_DELIVERY, PRODUCT],
      },
    }),
  );
}

test("the jobs it could not place are asked about, batched — and the one it is sure of is not", async ({ page }) => {
  await stub(page, [PLACED, UNPLACED, AMBIGUOUS, UNLABELED]);
  await page.goto("/job-blocks/job-1");

  const ask = page.locator(".jb-familyask");
  await expect(ask).toBeVisible();
  await expect(ask.getByRole("heading", { name: /what kind of work were these/i })).toBeVisible();

  // The three unanswered ones are named, each with why it is being asked about.
  await expect(ask.getByText("Pastry Chef")).toBeVisible();
  await expect(ask.getByText("Project Coordinator")).toBeVisible();
  await expect(ask.getByText("Delivery Lead")).toBeVisible();
  await expect(ask.getByText(/could be either of these/i)).toBeVisible();
  await expect(ask.getByText(/couldn't place this one/i)).toHaveCount(2);

  // …and the confidently placed job prompts no question at all (#221 AC4).
  await expect(ask.getByText("IT Project Manager")).toHaveCount(0);

  // The machine offers, never decides: the ambiguous job shows ITS OWN two choices, the unplaced
  // ones the whole published list.
  const rows = ask.locator(".jb-fgrp");
  await expect(rows).toHaveCount(3);
  await expect(ask.getByRole("button", { name: IT_DELIVERY.label })).toHaveCount(3);
  await expect(ask.getByRole("button", { name: PRODUCT.label })).toHaveCount(3);
  await expect(ask.getByText(/never guess one for you/i)).toBeVisible();
});

test("picking a family sends it as a correction on that job, and the question goes away", async ({ page }) => {
  await stub(page, [PLACED, UNPLACED]);
  const sent: Array<{ url: string; body: unknown }> = [];
  await page.route("**/api/job-blocks/*/correct", async (route) => {
    sent.push({ url: route.request().url(), body: route.request().postDataJSON() });
    await route.fulfill({ json: { ok: true, held: [], downstream: "We'll count this job as IT project delivery." } });
  });

  await page.goto("/job-blocks/job-1");
  const ask = page.locator(".jb-familyask");
  await ask.getByRole("button", { name: IT_DELIVERY.label }).click();

  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].url).toContain("/api/job-blocks/cafe-baker/correct");
  expect(sent[0].body).toEqual({
    key: "family",
    value: { familyId: IT_DELIVERY.familyId, version: IT_DELIVERY.version },
  });
  // Answered — so it is no longer asked about, and with nothing left unanswered the whole block goes.
  await expect(ask).toHaveCount(0);
});

// The deck's own error line lives beside the cards, which are gone by the time these questions are
// asked — so a failed answer here had nothing to say it failed: the button re-enabled and the person
// was left believing it saved.
test("an answer that fails to save says so, and the job stays asked about", async ({ page }) => {
  await stub(page, [PLACED, UNPLACED]);
  await page.route("**/api/job-blocks/*/correct", (route) =>
    route.fulfill({ status: 500, json: { error: { code: "internal_error", message: "could not save that" } } }),
  );

  await page.goto("/job-blocks/job-1");
  const ask = page.locator(".jb-familyask");
  await ask.getByRole("button", { name: IT_DELIVERY.label }).click();

  await expect(ask.getByRole("alert")).toBeVisible();
  await expect(ask.getByText("Pastry Chef")).toBeVisible(); // never shown as answered
});

test("nothing is asked when every job was placed", async ({ page }) => {
  await stub(page, [PLACED]);
  await page.goto("/job-blocks/job-1");
  await expect(page.getByText(/That's your history straight/i)).toBeVisible();
  await expect(page.locator(".jb-familyask")).toHaveCount(0);
});
