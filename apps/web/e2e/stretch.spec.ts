import { expect, test, type Page } from "@playwright/test";
import type { ScoredJobCard, StretchSuggestion, StretchView, TailorDraftView, TailorState } from "../lib/api";

// #417 (ADR-0020 clauses 3-4): stretch suggestions beside the finished draft. Route-mocked like
// tailor.spec.ts: every call is stubbed and this rides straight to /tailor. The server's own render
// of the preview (line out struck, line in marked, the others as margin numerals) is proven in
// stretchSuggestions.test.ts; here the GET stub mirrors that render per `?open=` so the SCREEN's
// behaviour — which card is open, what the frame shows for it, what the keys do — is what is tested.

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
  bubble: { hit: "Your budget and the ERP migration are the two things they lead with.", open: "The gap is their SAP version." },
  fit: [{ id: "budget", text: "Own a €2M budget" }],
  dontYet: [
    { id: "sap", band: "essential", requirement: "Their SAP version" },
    { id: "public", band: "standard", requirement: "Public-sector delivery" },
  ],
  askedClosed: [],
  adExcerpt: "Lead the replacement of a legacy finance platform across four European sites.",
};

const STATE: TailorState = {
  card: CARD,
  questions: [],
  requirements: [
    { id: "budget", text: "Own a €2M budget", state: "met" },
    { id: "sap", text: "Their SAP version", state: "gap" },
    { id: "public", text: "Public-sector delivery", state: "gap" },
  ],
  factCount: 24,
};

const LINE_OUT = "Led the checkout replatforming, delivered 2 months early";
const S1: StretchSuggestion = {
  schemaVersion: "2",
  id: "stretch-ad-1-sap",
  adId: "ad-1",
  requirementId: "sap",
  why: "The job names their SAP version. Your CV shows the checkout replatforming on an ERP, without naming it.",
  claimText: "Led the checkout replatforming on SAP S/4HANA, delivered 2 months early",
  intendedClass: "Partially-Supported",
  interviewNarrative: "The replatforming ran on the retailer's SAP estate; I can name the modules we touched.",
  slot: { kind: "bullet", role: 0, bullet: 0 },
  lineOut: LINE_OUT,
  derivedFrom: null,
  createdAt: "2026-10-23T09:00:00.000Z",
  state: "pending",
  decidedAt: null,
  scope: null,
};
const S2: StretchSuggestion = {
  ...S1,
  id: "stretch-ad-1-public",
  requirementId: "public",
  why: "The job asks for public-sector delivery. Your skills line does not name a sector.",
  claimText: "Public-sector delivery",
  intendedClass: "Unsupported-but-Plausible",
  interviewNarrative: "Two of my retail clients were state-owned; the procurement rules were the public ones.",
  slot: { kind: "skill", group: 0 },
  lineOut: null,
};

/** The server's render, mirrored for one `?open=` id: the open one struck + marked, the others
 *  numbered (stretchSuggestions.test.ts pins the real thing). */
function html(stretch: StretchView, open: string | null): string {
  const pending = stretch?.status === "ran" ? stretch.suggestions.map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => s.state === "pending") : [];
  const o = pending.find(({ s }) => s.id === open);
  const pin = (n: number, isOpen = false) => `<span class="pin${isOpen ? " open" : ""}" aria-hidden="true">${n}</span>`;
  const mark = (slotKind: "bullet" | "skill", text: string) => {
    const here = pending.find(({ s }) => s.slot.kind === slotKind);
    if (!open || !here) return text;
    if (o && o.s.slot.kind === slotKind)
      return slotKind === "bullet" ? `${pin(o.n, true)}<del>${text}</del><ins>${o.s.claimText}</ins>` : `${pin(o.n, true)}${text}, <ins>${o.s.claimText}</ins>`;
    return `${text}${pin(here.n)}`;
  };
  return (
    `<!doctype html><html><body><h1>Maria Kowalski</h1><ul><li>${mark("bullet", LINE_OUT)}</li>` +
    `<li>Managed a budget of EUR 1.2M across 3 vendor teams</li></ul>` +
    `<p class="skill-group">${mark("skill", "<strong>Delivery</strong><br>Jira, MS Project")}</p></body></html>`
  );
}

function view(stretch: StretchView, open: string | null): TailorDraftView {
  return { html: html(stretch, open), disclosure: [], conservationNotices: [], draftedAt: "2026-09-30T08:00:00.000Z", stretch };
}

/** Stubs the whole screen. `stretch` is mutable so an answer stub can move the state. */
async function openTailor(page: Page, state: { stretch: StretchView }) {
  const posts = { draft: 0, answers: [] as { id: string; answer: string }[] };
  await page.route("**/api/sessions/me", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/onboarding/tailor", (route) => route.fulfill({ json: STATE }));
  await page.route("**/api/onboarding/tailor/draft**", async (route) => {
    if (route.request().method() === "POST") {
      posts.draft += 1;
      return route.fulfill({ json: { ready: true } });
    }
    const open = new URL(route.request().url()).searchParams.get("open");
    await route.fulfill({ json: view(state.stretch, open) });
  });
  await page.route("**/api/onboarding/tailor/suggestions/*", async (route) => {
    const id = route.request().url().split("/").pop()!;
    const { answer } = route.request().postDataJSON() as { answer: string };
    posts.answers.push({ id, answer });
    if (state.stretch?.status === "ran")
      state.stretch = {
        status: "ran",
        suggestions: state.stretch.suggestions.map((s) =>
          s.id === id ? { ...s, state: "declined", decidedAt: "2026-10-23T09:05:00.000Z", scope: "this-job" } : s,
        ),
      };
    await route.fulfill({ json: { stretch: state.stretch } });
  });
  await page.goto("/tailor");
  await expect(page.locator(".draft-frame")).toBeVisible();
  return posts;
}

const RAN: StretchView = { status: "ran", suggestions: [S1, S2] };

test("#417 computer: the first suggestion is open in the rail and previews in place; the other is a margin numeral", async ({ page }) => {
  await openTailor(page, { stretch: RAN });

  const card = page.getByRole("region", { name: "Suggestion 1 of 2" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading")).toContainText("Their SAP version");
  await expect(card.getByText(S1.why)).toBeVisible();
  await expect(card.getByText(S1.interviewNarrative)).toBeVisible();
  await expect(card.getByRole("button", { name: /^No/ })).toBeVisible();
  // The frame: the line out struck, the line in marked, the other numbered — and on a computer
  // the card itself carries no second copy of the swap.
  const frame = page.locator(".draft-frame");
  await expect(frame).toHaveAttribute("srcdoc", new RegExp(`<del>${LINE_OUT}</del>`));
  await expect(frame).toHaveAttribute("srcdoc", new RegExp(`<ins>${S1.claimText}</ins>`));
  await expect(frame).toHaveAttribute("srcdoc", /<span class="pin" aria-hidden="true">2<\/span>/);
  await expect(card.locator(".clip")).toBeHidden();
  // The unanswered line never reaches the rail's plain copy either — the draft stays the page.
  await expect(page.locator(".tailor .gaps")).toContainText("Their SAP version");
});

test("#417 computer: J and K move between suggestions, N answers No for this job, Esc closes", async ({ page }) => {
  const posts = await openTailor(page, { stretch: { status: "ran", suggestions: [S1, S2] } });
  const frame = page.locator(".draft-frame");

  await page.keyboard.press("j");
  const second = page.getByRole("region", { name: "Suggestion 2 of 2" });
  await expect(second).toBeVisible();
  await expect(second.getByRole("heading")).toContainText("Public-sector delivery");
  await expect(frame).toHaveAttribute("srcdoc", new RegExp(`<ins>${S2.claimText}</ins>`));
  await expect(frame).not.toHaveAttribute("srcdoc", /<del>/); // a skill pushes nothing out
  await expect(frame).toHaveAttribute("srcdoc", /<span class="pin" aria-hidden="true">1<\/span>/);
  await expect(page.locator('.tailor [aria-live="polite"]')).toContainText("Suggestion 2 of 2: Public-sector delivery");

  await page.keyboard.press("k");
  await expect(page.getByRole("region", { name: "Suggestion 1 of 2" })).toBeVisible();

  await page.keyboard.press("n");
  expect(posts.answers).toEqual([{ id: S1.id, answer: "no" }]);
  // No closes it for this job: the next pending one opens, the declined one leaves the margin.
  await expect(page.getByRole("region", { name: "Suggestion 2 of 2" })).toBeVisible();
  await expect(frame).not.toHaveAttribute("srcdoc", /<span class="pin" aria-hidden="true">1<\/span>/);
  await expect(frame).toHaveAttribute("srcdoc", new RegExp(`<ins>${S2.claimText}</ins>`));

  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: /Suggestion \d of 2/ })).toHaveCount(0);
  await expect(frame).not.toHaveAttribute("srcdoc", /<ins>/); // the page is plain again
  // The closed list still names what is left, with the way back in.
  const list = page.getByRole("region", { name: "Suggestions" });
  await expect(list).toContainText("Public-sector delivery");
  await expect(list).toContainText("Their SAP version");
  await list.getByRole("button", { name: "Public-sector delivery" }).click();
  await expect(page.getByRole("region", { name: "Suggestion 2 of 2" })).toBeVisible();
});

test("#417 phone (390px): one suggestion at a time with the swap in the card, the answers stacked, and Skip the rest", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTailor(page, { stretch: RAN });

  const cards = page.getByRole("region", { name: /Suggestion \d of 2/ });
  await expect(cards).toHaveCount(1);
  const card = page.getByRole("region", { name: "Suggestion 1 of 2" });
  await expect(card.locator(".clip")).toBeVisible();
  await expect(card.locator(".clip del")).toHaveText(LINE_OUT);
  await expect(card.locator(".clip ins")).toHaveText(S1.claimText);
  const skip = card.getByRole("button", { name: "Skip the rest" });
  await expect(skip).toBeVisible();
  // Stacked: the answer sits above the skip, each on its own row.
  const no = (await card.getByRole("button", { name: /^No/ }).boundingBox())!;
  const skipBox = (await skip.boundingBox())!;
  expect(skipBox.y).toBeGreaterThan(no.y + no.height - 1);

  await skip.click();
  await expect(cards).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Suggestions" })).toContainText("2 left out");
});

test("#417 a step that failed is told plainly, never as nothing to suggest, with a quiet way to look again", async ({ page }) => {
  const posts = await openTailor(page, { stretch: { status: "failed" } });
  const note = page.getByRole("status").filter({ hasText: "could not look for" });
  await expect(note).toBeVisible();
  await expect(note).not.toContainText(/nothing to suggest/i);
  await expect(page.locator(".tailor")).not.toContainText(/model|step|stretch-suggestions|checkpoint/i);
  const before = posts.draft;
  await note.getByRole("button", { name: "Look again" }).click();
  await expect.poll(() => posts.draft).toBeGreaterThan(before);
});

test("#417 a step that never ran shows nothing about suggestions — not a failure, not an empty list", async ({ page }) => {
  await openTailor(page, { stretch: null });
  await expect(page.getByRole("region", { name: /Suggestion/ })).toHaveCount(0);
  await expect(page.locator(".tailor")).not.toContainText(/could not look for|Look again|left out/);
});
