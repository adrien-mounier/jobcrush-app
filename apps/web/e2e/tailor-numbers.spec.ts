import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import type { ScoredJobCard, StretchSuggestion, StretchView, TailorState } from "../lib/api";

// #433 §1: the suggestion numbers render properly everywhere — a geometry check, not a text one.
// The owner's staging run showed "2•": the CV's number sat on the bullet dot. qa-main's fake never
// put a pending number on a bullet, so nothing saw it. Here the CV is the SERVER's own render
// (renderPreviewHtml from the built API — the same build playwright.config.ts already needs for
// qa-main), with pending numbers on bullets, on the summary and on a skills line, one of them ≥ 10;
// "The job" carries two numbers on one line. Measured at 1280 and 390.

// A variable path keeps tsc from pulling the API's build into the web app's program.
const PREVIEW: string = pathToFileURL(resolve(__dirname, "../../api/dist/preview.js")).href;

const JOB_LINES = [
  "About the role",
  "* Lead the **SAP** finance rollout across four sites and own the vendor contracts end to end, from selection to go-live",
  "* Public-sector delivery",
  "Report to the CIO.",
];

// Twelve suggestions: #1 open (the summary), #2 and #12 pending on bullets, #3 on the skills line;
// #2 and #12 answer the same job line, so "The job" puts two numbers side by side there.
const SLOTS: StretchSuggestion["slot"][] = [
  { kind: "summary" },
  { kind: "bullet", role: 0, bullet: 0 },
  { kind: "skill", group: 0 },
  ...Array.from({ length: 8 }, (_, i) => ({ kind: "bullet" as const, role: 1, bullet: i % 2 })),
  { kind: "bullet", role: 0, bullet: 1 },
];
const SUGGESTIONS: StretchSuggestion[] = SLOTS.map((slot, i) => ({
  schemaVersion: "2",
  id: `stretch-ad-1-r${i + 1}`,
  adId: "ad-1",
  requirementId: `r${i + 1}`,
  why: "The job asks for this.",
  claimText: `Line in ${i + 1}`,
  intendedClass: "Partially-Supported",
  interviewNarrative: "What to say.",
  slot,
  lineOut: slot.kind === "skill" ? null : "Line out",
  derivedFrom: null,
  createdAt: "2026-10-25T09:00:00.000Z",
  state: "pending",
  decidedAt: null,
  scope: null,
}));
const RAN: StretchView = { status: "ran", suggestions: SUGGESTIONS };

const CARD: ScoredJobCard = {
  schemaVersion: "1",
  adId: "ad-1",
  title: "Senior IT Project Manager",
  company: "Atos",
  place: "Paris 15e",
  salary: null,
  pattern: null,
  scored: "judged",
  matchPct: 61,
  breakdown: { essential: { met: 0, total: 1 }, desirable: { met: 0, total: 1 } },
  bubble: { hit: "", open: "" },
  fit: [],
  dontYet: [],
  askedClosed: [],
  adExcerpt: JOB_LINES.join("\n"),
};
const STATE: TailorState = {
  card: CARD,
  questions: [],
  // A long requirement, so the card's heading wraps the way the owner's did.
  requirements: SUGGESTIONS.map((s, i) => ({
    id: s.requirementId,
    text: i === 0 ? "Own the vendor contracts end to end across four European sites, from selection to go-live" : `Requirement ${i + 1}`,
    state: "gap" as const,
    ...(i === 1 || i === 11 ? { line: 1 } : i === 2 ? { line: 2 } : {}),
  })),
  factCount: 24,
};

const DRAFT = {
  name: "Maria Kowalski",
  headline: "IT Project Manager",
  contact: "Warsaw · maria@example.com",
  summary: "Project manager with delivery accountability across vendors.",
  experience: [0, 1].map((r) => ({
    role: "IT Project Manager",
    employer: `Employer ${r + 1}`,
    location: "Warsaw",
    dates: "2021 - Present",
    bullets: [
      { text: "Led the checkout replatforming, delivered 2 months early", outcome: "", claimIds: ["a"] },
      { text: "Managed a budget of EUR 1.2M across 3 vendor teams", outcome: "", claimIds: ["b"] },
    ],
    unprinted: [],
  })),
  skills: [{ label: "Delivery", items: ["Jira", "MS Project"] }],
  certifications: [],
  education: [],
  additional: [],
};

async function openTailor(page: Page) {
  const { renderPreviewHtml } = (await import(PREVIEW)) as {
    renderPreviewHtml: (draft: unknown, posting: unknown, opts: unknown) => string;
  };
  const marks = {
    open: { slot: SLOTS[0], lineIn: "Line in 1", n: 1 },
    numerals: SLOTS.slice(1).map((slot, i) => ({ slot, n: i + 2 })).filter(({ n }) => n === 2 || n === 3 || n === 12),
  };
  const html = renderPreviewHtml(DRAFT, { title: CARD.title, company: CARD.company }, { banner: false, marks });
  await page.route("**/api/sessions/me", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/onboarding/tailor", (route) => route.fulfill({ json: STATE }));
  await page.route("**/api/onboarding/tailor/draft**", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ json: { ready: true } })
      : route.fulfill({ json: { html, disclosure: [], conservationNotices: [], draftedAt: "2026-10-25T08:00:00.000Z", stretch: RAN } }),
  );
  await page.goto("/tailor");
  await expect(page.locator(".draft-frame")).toBeVisible();
}

type Box = { left: number; right: number; top: number; bottom: number };

for (const [label, width, height] of [
  ["computer (1280)", 1280, 800],
  ["phone (390)", 390, 844],
] as const) {
  test(`#433 ${label}: every CV number sits in its own margin column — clear of the bullet dot, inside the page, sized to its digits`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openTailor(page);
    const frame = page.frameLocator(".draft-frame");
    await expect(frame.locator(".pin")).toHaveCount(4);
    const pins = await frame.locator("body").evaluate((body) =>
      [...body.querySelectorAll<HTMLElement>(".pin")].map((pin) => {
        const box = pin.getBoundingClientRect();
        const ul = pin.closest("ul");
        const range = document.createRange();
        range.selectNodeContents(pin.querySelector(".n") ?? pin);
        return {
          n: (pin.querySelector(".n") ?? pin).textContent,
          left: box.left,
          right: box.right,
          width: box.width,
          digits: range.getBoundingClientRect().width,
          // The bullet dot lives between the list's own left edge and its line's.
          ulLeft: ul ? ul.getBoundingClientRect().left : null,
          lineLeft: (pin.parentElement as HTMLElement).getBoundingClientRect().left,
        };
      }),
    );
    for (const p of pins) {
      expect(p.left, `number ${p.n} inside the page`).toBeGreaterThanOrEqual(0);
      if (p.ulLeft !== null) expect(p.right, `number ${p.n} clear of its bullet dot`).toBeLessThanOrEqual(p.ulLeft);
      else expect(p.right, `number ${p.n} clear of its line`).toBeLessThanOrEqual(p.lineLeft);
      expect(p.width - p.digits, `number ${p.n} has room round its digits`).toBeGreaterThanOrEqual(8);
    }
    // One look for "open" (solid) and "waiting" (an outline), never gold — the card's number too.
    const fill = (sel: string) => frame.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await fill(".pin.open")).toBe("rgb(29, 33, 38)");
    expect(await fill(".pin:not(.open)")).toBe("rgba(0, 0, 0, 0)");
    expect(await page.locator(".stretch-card .h .num").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(232, 234, 237)");
    // One column: every number's right edge lines up.
    const rights = new Set(pins.map((p) => Math.round(p.right)));
    expect(rights.size, "the numbers share one margin column").toBe(1);
  });

  test(`#433 ${label}: on The job, two numbers on one line sit side by side, clear of each other and of the text`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openTailor(page);
    await page.getByRole("tab", { name: "The job" }).click();
    const lines = page.locator(".jobtext .jl");
    await expect(lines.nth(1).getByRole("button", { name: /^Suggestion \d+$/ })).toHaveCount(2);
    const geo = await lines.evaluateAll((els) =>
      els.map((el) => {
        const nums = [...el.querySelectorAll<HTMLElement>(".pins .num")].map((b) => b.getBoundingClientRect());
        const range = document.createRange();
        const text = el.querySelector(".jt") ?? el.lastChild!;
        range.selectNodeContents(text);
        const t = range.getClientRects()[0];
        return { nums: nums.map((b) => ({ left: b.left, right: b.right, top: b.top, bottom: b.bottom })), text: t ? { left: t.left, top: t.top, bottom: t.bottom } : null };
      }),
    );
    const all: Box[] = geo.flatMap((g) => g.nums);
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]!;
        const b = all[j]!;
        const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        expect(overlap, `numbers ${i} and ${j} overlap`).toBe(false);
      }
    for (const g of geo) for (const n of g.nums) expect(n.right, "a number clear of its line's text").toBeLessThanOrEqual(g.text!.left);
    // Side by side: the two numbers on one line share a row.
    const [a, b] = geo[1]!.nums;
    expect(Math.abs(a!.top - b!.top)).toBeLessThan(2);
    // §5: the job's own formatting renders — no literal ** or "* " bullets.
    await expect(lines.nth(1)).not.toContainText("**");
    await expect(lines.nth(1)).not.toContainText("* ");
    await expect(lines.nth(1).locator("strong")).toHaveText("SAP");
  });

  test(`#433 ${label}: the card's number is centred on its heading's first line, and the heading is a title, not a headline`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openTailor(page);
    const h = page.locator(".stretch-card .h");
    await expect(h).toBeVisible();
    const g = await h.evaluate((el) => {
      const num = el.querySelector(".num")!.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el.lastChild!);
      const first = range.getClientRects()[0]!;
      return { numMid: (num.top + num.bottom) / 2, lineMid: (first.top + first.bottom) / 2, size: parseFloat(getComputedStyle(el).fontSize), numW: num.width, numH: num.height };
    });
    expect(Math.abs(g.numMid - g.lineMid)).toBeLessThanOrEqual(2);
    expect(g.size).toBeLessThanOrEqual(16);
    expect(g.numH).toBeGreaterThanOrEqual(20);
  });

  test(`#433 ${label}: the Tailor screen carries no DRAFT banner, and Approve is the gold primary, on screen without scrolling the CV`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openTailor(page);
    await expect(page.frameLocator(".draft-frame").locator(".banner")).toHaveCount(0);
    // A card is open: Use for this job is the one gold thing; Approve waits quietly.
    const approve = page.getByRole("button", { name: "Approve and email me this CV" });
    await expect(approve).not.toHaveClass(/\bgold\b/);
    await page.keyboard.press("Escape");
    await expect(page.locator(".stretch-card")).toHaveCount(0);
    await expect(approve).toHaveClass(/\bgold\b/);
    // On screen as the page opens: no scrolling inside the CV, nor of the page, to reach it.
    await expect(approve).toBeInViewport({ ratio: 1 });
  });

  test(`#433 ${label}: closed with unanswered suggestions, one honest line says so, and each row keeps its number`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openTailor(page);
    await page.keyboard.press("Escape");
    const summary = page.locator(".stretch");
    await expect(summary.getByRole("heading", { level: 2 })).toHaveText("12 suggestions not used — your CV keeps its own lines");
    await expect(summary).not.toContainText("Ready to send");
    await expect(summary).not.toContainText("left out");
    const rows = summary.locator(".slist li");
    await expect(rows).toHaveCount(12);
    await expect(rows.nth(11).locator(".num")).toHaveText("12");
  });
}
