import { expect, test, type Page } from "@playwright/test";
import type { CvPreviewView } from "../lib/api";

// #390 (ADR-0019) — Preview as CV: the master CV tailored to the person's own job, as it prints.
// Route-mocked to the pinned CvPreviewView shape, like tailor.spec.ts's draft tests: the wait is
// narrated over the job stream, the page is the server's render (letterhead included) in a
// sandboxed frame, it names the job it was tailored for, and Download PDF is a link to the
// server's gated PDF door — the browser's own download, no script in between.

async function stubSession(page: Page) {
  await page.route("**/api/sessions/me", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
}

// What renderPreviewHtml prints for a letterhead saved in Your details (#381): the name as the
// h1, the headline with the contact line folded on.
const PREVIEW: CvPreviewView = {
  html:
    "<!doctype html><html><head><meta charset='utf-8'><title>CV</title></head><body>" +
    "<h1>Maria Kowalski</h1>" +
    "<p class='headline'><span class='role-word'>IT PROJECT MANAGER</span> - Lyon, France · +33 6 00 00 00 00 · maria@example.com</p>" +
    "<h2>Professional Experience</h2><p>Nordic Retail Group</p></body></html>",
  draftedAt: "2026-10-15T10:00:00.000Z",
  job: { title: "IT Project Manager", employer: "Nordic Retail Group" },
};

test("#390 a fresh preview narrates its wait over the job stream, then the CV lands with its letterhead", async ({ page }) => {
  await stubSession(page);
  await page.route("**/api/profile/cv-preview", async (route) => {
    if (route.request().method() === "POST") {
      // Hold the 202 briefly so the writing line is assertable, not a flash.
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({ status: 202, json: { jobId: "preview-job-1" } });
    } else {
      await route.fulfill({ json: PREVIEW });
    }
  });
  await page.route("**/api/jobs/preview-job-1/events", async (route) => {
    const snapshot = { id: "preview-job-1", status: "completed", error: null, progress: { tailorDraft: { ready: true } } };
    await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(snapshot)}\n\n` });
  });

  await page.goto("/profile/preview");

  await expect(page.getByText("Writing your CV…")).toBeVisible();
  const frame = page.locator(".preview-frame");
  await expect(frame).toBeVisible();
  // The letterhead, rendered: the name and every saved contact part, inside the document itself.
  const doc = page.frameLocator(".preview-frame");
  await expect(doc.getByRole("heading", { level: 1 })).toHaveText("Maria Kowalski");
  await expect(doc.locator(".headline")).toContainText("Lyon, France · +33 6 00 00 00 00 · maria@example.com");
  await expect(frame).toHaveAttribute("srcdoc", /Maria Kowalski/);

  await expect(page.getByText("Tailored for IT Project Manager at Nordic Retail Group.")).toBeVisible();
  const download = page.getByRole("link", { name: "Download PDF" });
  await expect(download).toHaveAttribute("href", "/api/profile/cv-preview/pdf");
  await expect(download).toHaveAttribute("download", "");
});

test("#390 a preview that already matches the profile opens at once — no job stream to watch", async ({ page }) => {
  await stubSession(page);
  let streamed = false;
  await page.route("**/api/jobs/**", async (route) => {
    streamed = true;
    await route.fulfill({ status: 404, json: {} });
  });
  await page.route("**/api/profile/cv-preview", async (route) => {
    if (route.request().method() === "POST") await route.fulfill({ json: { ready: true } });
    else await route.fulfill({ json: PREVIEW });
  });

  await page.goto("/profile/preview");
  await expect(page.locator(".preview-frame")).toBeVisible();
  expect(streamed).toBe(false);
});

test("#390 a failed make says so in the server's words, and Try again really retries", async ({ page }) => {
  await stubSession(page);
  await page.route("**/api/profile/cv-preview", async (route) => {
    if (route.request().method() === "POST") await route.fulfill({ status: 202, json: { jobId: "preview-job-2" } });
    else await route.fulfill({ json: PREVIEW });
  });
  let attempts = 0;
  await page.route("**/api/jobs/preview-job-2/events", async (route) => {
    attempts += 1;
    const snapshot =
      attempts === 1
        ? {
            id: "preview-job-2",
            status: "failed",
            error: "draft_failed",
            progress: { tailorDraft: { failure: { cameBack: "We could not finish writing this CV.", fix: "Press Try again — everything you answered is saved, and nothing already done is re-done." } } },
          }
        : { id: "preview-job-2", status: "completed", error: null, progress: { tailorDraft: { ready: true } } };
    await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(snapshot)}\n\n` });
  });

  await page.goto("/profile/preview");
  // Structural, not getByRole("alert"): Next's route announcer is a second, empty alert region.
  await expect(page.locator(".preview-wait p[role='alert']")).toHaveText("We could not finish writing this CV.");
  await expect(page.getByText("nothing already done is re-done", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".preview-frame")).toBeVisible();
});
