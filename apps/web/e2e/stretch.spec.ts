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

/** #418: the state after "Use for this job" on S1 — the server's own composition, mirrored: the
 *  requirement met by a stretch, the number up, the fit row flagged. */
const USED_STATE: TailorState = {
  ...STATE,
  card: {
    ...CARD,
    matchPct: 71,
    breakdown: { essential: { met: 1, total: 1 }, desirable: { met: 0, total: 1 } },
    fit: [...CARD.fit, { id: "sap", text: "Their SAP version", stretched: true }],
    dontYet: CARD.dontYet.filter((r) => r.id !== "sap"),
  },
  requirements: STATE.requirements.map((r) => (r.id === "sap" ? { ...r, state: "stretched" } : r)),
};

/** #419: the state after "It's true" on S1 — the number up as for Use, but the requirement plainly
 *  met (the person's own fact now), the fit row unflagged. */
const TRUE_STATE: TailorState = {
  ...USED_STATE,
  card: { ...USED_STATE.card, fit: [...CARD.fit, { id: "sap", text: "Their SAP version" }] },
  requirements: STATE.requirements.map((r) => (r.id === "sap" ? { ...r, state: "met" } : r)),
};
/** #419: where the server says it kept the line — the job's own heading on the master CV. */
const KEPT_UNDER = "Atos — Senior IT Project Manager";

/** The server's render, mirrored for one `?open=` id: the open one struck + marked, the others
 *  numbered (stretchSuggestions.test.ts pins the real thing). #418: a used bullet prints its line in
 *  in place of the line out (applyUsedStretches). */
function html(stretch: StretchView, open: string | null): string {
  const used = stretch?.status === "ran" ? stretch.suggestions.find((s) => s.state === "approved" && s.slot.kind === "bullet") : undefined;
  const bulletText = used ? used.claimText : LINE_OUT;
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
    `<!doctype html><html><body><h1>Maria Kowalski</h1><ul><li>${mark("bullet", bulletText)}</li>` +
    `<li>Managed a budget of EUR 1.2M across 3 vendor teams</li></ul>` +
    `<p class="skill-group">${mark("skill", "<strong>Delivery</strong><br>Jira, MS Project")}</p></body></html>`
  );
}

function view(stretch: StretchView, open: string | null): TailorDraftView {
  return { html: html(stretch, open), disclosure: [], conservationNotices: [], draftedAt: "2026-09-30T08:00:00.000Z", stretch };
}

/** Stubs the whole screen. `stretch` is mutable so an answer stub can move the state; `tailor` is
 *  what GET /onboarding/tailor answers, moved by "use" and "undo" the way the server composes it. */
async function openTailor(page: Page, state: { stretch: StretchView; tailor?: TailorState }) {
  const posts = { draft: 0, answers: [] as { id: string; answer: string }[], wordings: [] as { id: string; text: string }[] };
  await page.route("**/api/sessions/me", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/onboarding/tailor", (route) => route.fulfill({ json: state.tailor ?? STATE }));
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
          s.id !== id
            ? s
            : answer === "undo"
              ? { ...s, state: "pending", decidedAt: null, scope: null }
              : {
                  ...s,
                  state: answer === "no" ? "declined" : "approved",
                  decidedAt: "2026-10-23T09:05:00.000Z",
                  scope: answer === "true" ? "every-job" : "this-job",
                },
        ),
      };
    if (id === S1.id && answer === "use") state.tailor = USED_STATE;
    if (id === S1.id && answer === "true") state.tailor = TRUE_STATE;
    if (id === S1.id && answer === "undo") state.tailor = STATE;
    await route.fulfill({ json: { stretch: state.stretch, ...(answer === "true" ? { keptUnder: KEPT_UNDER } : {}) } });
  });
  // #420: an edited wording — the server stores the line with an interview line rewritten for it
  // (derived here from the line, so a test reads back exactly what it typed).
  await page.route("**/api/onboarding/tailor/suggestions/*/wording", async (route) => {
    const id = route.request().url().split("/").slice(-2)[0]!;
    const { text } = route.request().postDataJSON() as { text: string };
    posts.wordings.push({ id, text });
    if (state.stretch?.status === "ran")
      state.stretch = {
        status: "ran",
        suggestions: state.stretch.suggestions.map((s) => (s.id === id ? { ...s, claimText: text, interviewNarrative: `Rewritten for: ${text}` } : s)),
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
  const list = page.getByRole("region", { name: "Ready to send" });
  await expect(list).toContainText("Public-sector delivery");
  await expect(list).toContainText("Their SAP version");
  // #418: the row carries its result and the way back in ("Answer") — the text is no longer the button.
  await list.getByRole("listitem").filter({ hasText: "Public-sector delivery" }).getByRole("button", { name: "Answer" }).click();
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
  await expect(page.getByRole("region", { name: "Ready to send" })).toContainText("2 left out");
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

// ---------------------------------------------------------------------------------------------
// #418 — "Use for this job": the gold primary; the score animates (no "+N%"); the requirement reads
// met by a stretch; the "Ready to send" summary lists each answer with its own Undo.
// ---------------------------------------------------------------------------------------------

test("#418 Use for this job is the gold primary (key U): the line lands on the page, the number rises and is announced, the sheet reads 'met by a stretch', the summary lists it with Undo", async ({ page }) => {
  const posts = await openTailor(page, { stretch: { status: "ran", suggestions: [S1, S2] } });
  const card = page.getByRole("region", { name: "Suggestion 1 of 2" });
  const use = card.getByRole("button", { name: /^Use for this job/ });
  await expect(use).toBeVisible();
  await expect(use).toHaveClass(/gold/);
  // The primary sits above No, on its own row.
  const useBox = (await use.boundingBox())!;
  const noBox = (await card.getByRole("button", { name: /^No/ }).boundingBox())!;
  expect(noBox.y).toBeGreaterThan(useBox.y + useBox.height - 1);
  const ring = page.locator(".dbar .score");
  await expect(ring).toHaveAttribute("aria-label", "61% match");

  await use.click();
  expect(posts.answers).toEqual([{ id: S1.id, answer: "use" }]);
  // The next pending one opens; the used line is now the page's own line (no <ins>, no <del> for it).
  await expect(page.getByRole("region", { name: "Suggestion 2 of 2" })).toBeVisible();
  const frame = page.locator(".draft-frame");
  await expect(frame).toHaveAttribute("srcdoc", new RegExp(`<li>${S1.claimText}</li>`));
  await expect(frame).not.toHaveAttribute("srcdoc", /<del>/);
  // The score rolls up to the server's number — never a "+N%" anywhere — and is announced.
  await expect(ring).toHaveAttribute("aria-label", "71% match", { timeout: 10_000 });
  await expect(page.locator(".tailor")).not.toContainText(/\+\d+%/);
  await expect(page.locator('.tailor [aria-live="polite"]')).toContainText("Match now 71%");
  await expect(page.locator(".dbar .mote")).toHaveCount(0); // the mote is gone once it has landed

  // "Where you fit": the requirement reads met by a stretch and counts as met.
  await page.getByRole("button", { name: /Where you fit · 2 of 3/ }).click();
  const sheet = page.getByRole("dialog", { name: /Where you fit/ });
  await expect(sheet.locator('.marks li[data-state="stretched"] .t')).toHaveText("Their SAP version");
  await expect(sheet.locator('.marks li[data-state="stretched"] .s')).toHaveText("met by a stretch");
  await page.keyboard.press("Escape");
  // The gap list no longer names it.
  await expect(page.locator(".tailor .gaps")).not.toContainText("Their SAP version");

  // Esc closes the open card: the "Ready to send" summary lists each answer with its own Undo.
  await page.keyboard.press("Escape");
  const summary = page.getByRole("region", { name: "Ready to send" });
  await expect(summary).toContainText("1 used for this job · 1 left out");
  const usedRow = summary.getByRole("listitem").filter({ hasText: "Their SAP version" });
  await expect(usedRow).toContainText("Used for this job");
  await expect(summary).toContainText("Be ready to explain");
  await expect(summary).toContainText(S1.interviewNarrative);

  // Undo: the answer is withdrawn, the line out is back, and the number counts down quietly.
  await usedRow.getByRole("button", { name: "Undo" }).click();
  expect(posts.answers).toEqual([
    { id: S1.id, answer: "use" },
    { id: S1.id, answer: "undo" },
  ]);
  await expect(page.getByRole("region", { name: "Suggestion 1 of 2" })).toBeVisible(); // reopened, pending again
  await expect(frame).toHaveAttribute("srcdoc", new RegExp(`<del>${LINE_OUT}</del>`));
  await expect(ring).toHaveAttribute("aria-label", "61% match", { timeout: 10_000 });
  await expect(page.locator(".tailor")).not.toContainText("met by a stretch");
});

test("#418 key U answers Use; with reduced motion the number changes at once and no mote flies", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const posts = await openTailor(page, { stretch: { status: "ran", suggestions: [S1, S2] } });
  const ring = page.locator(".dbar .score");
  await expect(ring).toHaveAttribute("aria-label", "61% match");
  await page.keyboard.press("u");
  expect(posts.answers).toEqual([{ id: S1.id, answer: "use" }]);
  // At once: the first paint after the answer lands is the final number (no roll-up frames), and
  // nothing flies.
  await expect(ring).toHaveAttribute("aria-label", "71% match", { timeout: 3_000 });
  await expect(page.locator(".mote")).toHaveCount(0);
  await expect(page.locator('.tailor [aria-live="polite"]')).toContainText("Match now 71%");
});

test("#418 phone (390px): Use is the first of the stacked answers", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTailor(page, { stretch: RAN });
  const card = page.getByRole("region", { name: "Suggestion 1 of 2" });
  const use = (await card.getByRole("button", { name: /^Use for this job/ }).boundingBox())!;
  const no = (await card.getByRole("button", { name: /^No/ }).boundingBox())!;
  expect(no.y).toBeGreaterThan(use.y + use.height - 1);
  expect(use.width).toBeGreaterThan(200); // full-width on a phone
});

test("#418 the job's own screen labels a requirement met by a stretch", async ({ page }) => {
  await page.route("**/api/sessions/me", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/onboarding/jobs/ad-1", (route) => route.fulfill({ json: { card: USED_STATE.card } }));
  await page.goto("/job/ad-1");
  const row = page.locator('.row.fit[data-req="sap"]');
  await expect(row).toContainText("Their SAP version");
  await expect(row.locator(".fit-why")).toHaveText("Met by a stretch");
  // A plainly met row carries no such label.
  await expect(page.locator('.row.fit[data-req="budget"]')).not.toContainText("Met by a stretch");
});

test("#418 (ADR-0020): while the stretch step runs the finished draft is already the page; the rail says it is looking", async ({ page }) => {
  await page.route("**/api/sessions/me", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/onboarding/tailor", (route) => route.fulfill({ json: STATE }));
  await page.route("**/api/onboarding/tailor/draft**", async (route) => {
    if (route.request().method() === "POST") return route.fulfill({ status: 202, json: { jobId: "draft-job-418" } });
    // The draft is checkpointed before the step runs: the read returns it, with no suggestions yet.
    await route.fulfill({ json: view(null, null) });
  });
  await page.route("**/api/jobs/draft-job-418/events", async (route) => {
    const snapshot = { id: "draft-job-418", status: "running", error: null, progress: { tailorDraft: { step: "suggesting" } } };
    await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(snapshot)}\n\n` });
  });
  await page.goto("/tailor");
  await expect(page.locator(".draft-frame")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve and email me this CV" })).toBeVisible();
  const rail = page.locator(".tailor .rail");
  await expect(rail.getByRole("status")).toContainText("Looking for ways to stretch it for this job");
  await expect(page.locator(".draft-wait-line")).toHaveCount(0); // the wait screen is gone
});

// ---------------------------------------------------------------------------------------------
// #419 — "It's true: keep it on my CV for every job": its own row, never beside Use (ADR-0005
// clause 5: a permanent change behind one tap must not feel incidental); key T; a toast with Undo.
// ---------------------------------------------------------------------------------------------

const TRUE_LABEL = /^It's true: keep it on my CV for every job/;

test("#419 computer: It's true sits on its own row, between Use and No (key T); the toast says where the line was kept, and its Undo takes it back", async ({ page }) => {
  const posts = await openTailor(page, { stretch: { status: "ran", suggestions: [S1, S2] } });
  const card = page.getByRole("region", { name: "Suggestion 1 of 2" });
  const use = (await card.getByRole("button", { name: /^Use for this job/ }).boundingBox())!;
  const trueButton = card.getByRole("button", { name: TRUE_LABEL });
  const yes = (await trueButton.boundingBox())!;
  const no = (await card.getByRole("button", { name: /^No/ }).boundingBox())!;
  expect(yes.y).toBeGreaterThan(use.y + use.height - 1); // never on Use's row
  expect(no.y).toBeGreaterThan(yes.y + yes.height - 1);
  await expect(trueButton).not.toHaveClass(/gold/);
  await expect(trueButton.locator("kbd")).toHaveText("T");
  const ring = page.locator(".dbar .score");
  await expect(ring).toHaveAttribute("aria-label", "61% match");

  await page.keyboard.press("t");
  expect(posts.answers).toEqual([{ id: S1.id, answer: "true" }]);
  const toast = page.locator(".tailor .toast");
  await expect(toast).toHaveAttribute("role", "status");
  await expect(toast).toContainText(`Kept on your CV for every job, under ${KEPT_UNDER}.`);
  // The line prints on this CV, the number rises, and the next suggestion opens.
  await expect(page.getByRole("region", { name: "Suggestion 2 of 2" })).toBeVisible();
  await expect(page.locator(".draft-frame")).toHaveAttribute("srcdoc", new RegExp(`<li>${S1.claimText}</li>`));
  await expect(ring).toHaveAttribute("aria-label", "71% match", { timeout: 10_000 });

  await toast.getByRole("button", { name: "Undo" }).click();
  expect(posts.answers).toEqual([
    { id: S1.id, answer: "true" },
    { id: S1.id, answer: "undo" },
  ]);
  await expect(toast).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Suggestion 1 of 2" })).toBeVisible(); // pending again
  await expect(page.locator(".draft-frame")).toHaveAttribute("srcdoc", new RegExp(`<del>${LINE_OUT}</del>`));
  await expect(ring).toHaveAttribute("aria-label", "61% match", { timeout: 10_000 });
});

test("#419 the requirement reads met, not met by a stretch; the summary says it was kept on your CV for every job, with Undo, and asks nothing to be ready to explain", async ({ page }) => {
  await openTailor(page, { stretch: { status: "ran", suggestions: [S1, S2] } });
  await page.getByRole("region", { name: "Suggestion 1 of 2" }).getByRole("button", { name: TRUE_LABEL }).click();
  await expect(page.locator(".dbar .score")).toHaveAttribute("aria-label", "71% match", { timeout: 10_000 });

  await page.getByRole("button", { name: /Where you fit · 2 of 3/ }).click();
  const sheet = page.getByRole("dialog", { name: /Where you fit/ });
  const row = sheet.locator(".marks li", { hasText: "Their SAP version" });
  await expect(row).toHaveAttribute("data-state", "met");
  await expect(row.locator(".s")).toHaveText("met");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Escape");
  const summary = page.getByRole("region", { name: "Ready to send" });
  await expect(summary).toContainText("1 kept on your CV for every job · 1 left out");
  const kept = summary.getByRole("listitem").filter({ hasText: "Their SAP version" });
  await expect(kept).toContainText("Kept on your CV for every job");
  await expect(kept.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(summary).not.toContainText("Be ready to explain");
  await expect(summary).not.toContainText(S1.interviewNarrative);
  await expect(page.locator(".tailor")).not.toContainText("met by a stretch");
});

test("#419 phone (390px): It's true is its own full-width row, between Use and No; its toast carries Undo", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTailor(page, { stretch: RAN });
  const card = page.getByRole("region", { name: "Suggestion 1 of 2" });
  const use = (await card.getByRole("button", { name: /^Use for this job/ }).boundingBox())!;
  const yes = (await card.getByRole("button", { name: TRUE_LABEL }).boundingBox())!;
  const no = (await card.getByRole("button", { name: /^No/ }).boundingBox())!;
  expect(yes.y).toBeGreaterThan(use.y + use.height - 1);
  expect(no.y).toBeGreaterThan(yes.y + yes.height - 1);
  expect(yes.width).toBeGreaterThan(200);
  await card.getByRole("button", { name: TRUE_LABEL }).click();
  const toast = page.locator(".tailor .toast");
  await expect(toast).toContainText(`Kept on your CV for every job, under ${KEPT_UNDER}.`);
  await expect(toast.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(toast).toBeInViewport();
});

// ---------------------------------------------------------------------------------------------
// #420 — "Edit wording": the edit happens in place (on the draft on a computer, on the card on a
// phone); E starts and ends it, Esc ends it. The server rewrites what to say for the edited line;
// the old interview line is never shown beside an edited sentence. An emptied edit keeps the
// suggestion's wording and says so.
// ---------------------------------------------------------------------------------------------

const EDITED = "Led the checkout replatforming on an SAP estate, two months early";
const RE = "We will rewrite this to match your wording.";

test("#420 computer: E starts the edit in place on the draft and Esc ends it; the edited line comes back with its own interview line", async ({ page }) => {
  const posts = await openTailor(page, { stretch: { status: "ran", suggestions: [S1, S2] } });
  const card = page.getByRole("region", { name: "Suggestion 1 of 2" });
  await expect(card.getByText(S1.interviewNarrative)).toBeVisible();
  const line = page.frameLocator(".draft-frame").locator("ins");

  await page.keyboard.press("e");
  await expect(line).toHaveAttribute("contenteditable", "true");
  await expect(line).toBeFocused();
  await expect(card.getByRole("button", { name: /^Done editing/ })).toBeVisible();
  // The old interview line is never shown beside a sentence being edited; the answers wait.
  await expect(card.getByText(RE)).toBeVisible();
  await expect(card.getByText(S1.interviewNarrative)).toHaveCount(0);
  await expect(card.getByRole("button", { name: /^Use for this job/ })).toBeDisabled();
  await expect(card.locator(".clip")).toBeHidden(); // in place on the draft, not on the card

  await line.fill(EDITED);
  await line.press("Escape");
  await expect.poll(() => posts.wordings).toEqual([{ id: S1.id, text: EDITED }]);
  await expect(card.getByText(`Rewritten for: ${EDITED}`)).toBeVisible();
  await expect(card.getByText(S1.interviewNarrative)).toHaveCount(0);
  await expect(card.getByText(RE)).toHaveCount(0);
  await expect(page.locator(".draft-frame")).toHaveAttribute("srcdoc", new RegExp(`<ins>${EDITED}</ins>`));
  await expect(line).not.toHaveAttribute("contenteditable", "true");
  const edit = card.getByRole("button", { name: /^Edit wording/ });
  await expect(edit).toBeFocused(); // focus returns to the control that started it
  await expect(card.getByRole("button", { name: /^Use for this job/ })).toBeEnabled();

  // E starts it again; with the focus off the line, E ends it — unchanged, so nothing is sent.
  await page.keyboard.press("e");
  await expect(line).toHaveAttribute("contenteditable", "true");
  await card.getByRole("heading").click();
  await page.keyboard.press("e");
  await expect(line).not.toHaveAttribute("contenteditable", "true");
  await expect(card.getByRole("button", { name: /^Edit wording/ })).toBeVisible();
  expect(posts.wordings).toHaveLength(1);
  expect(posts.answers).toEqual([]); // editing answers nothing
});

test("#420 phone (390px): the edit happens on the card's own line, not on the draft; Done editing ends it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const posts = await openTailor(page, { stretch: RAN });
  const card = page.getByRole("region", { name: "Suggestion 1 of 2" });
  await card.getByRole("button", { name: "Edit wording" }).click();
  const line = card.locator(".clip ins");
  await expect(line).toHaveAttribute("contenteditable", "true");
  await expect(line).toBeFocused();
  await expect(page.frameLocator(".draft-frame").locator("ins")).not.toHaveAttribute("contenteditable", "true");
  await expect(card.getByText(RE)).toBeVisible();

  await line.fill(EDITED);
  await card.getByRole("button", { name: "Done editing" }).click();
  await expect.poll(() => posts.wordings).toEqual([{ id: S1.id, text: EDITED }]);
  await expect(card.locator(".clip ins")).toHaveText(EDITED);
  await expect(card.locator(".clip ins")).not.toHaveAttribute("contenteditable", "true");
  await expect(card.getByText(`Rewritten for: ${EDITED}`)).toBeVisible();

  // Esc ends it on the card too.
  await card.getByRole("button", { name: "Edit wording" }).click();
  await expect(card.locator(".clip ins")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(card.locator(".clip ins")).not.toHaveAttribute("contenteditable", "true");
  await expect(card).toBeVisible(); // Esc ended the edit, it did not close the card
  expect(posts.wordings).toHaveLength(1);
});

test("#420 an emptied edit keeps the suggestion's wording and says so", async ({ page }) => {
  const posts = await openTailor(page, { stretch: { status: "ran", suggestions: [S1, S2] } });
  const card = page.getByRole("region", { name: "Suggestion 1 of 2" });
  const line = page.frameLocator(".draft-frame").locator("ins");
  await card.getByRole("button", { name: /^Edit wording/ }).click();
  await expect(line).toBeFocused();
  await line.fill("");
  await line.press("Escape");

  await expect(card.getByRole("status").filter({ hasText: "kept the suggested wording" })).toBeVisible();
  await expect(line).toHaveText(S1.claimText); // the page shows the suggestion's own line again
  await expect(card.getByText(S1.interviewNarrative)).toBeVisible(); // with its own interview line
  expect(posts.wordings).toEqual([]); // nothing sent, nothing spent
  // The note goes once the person moves on.
  await page.keyboard.press("j");
  await expect(page.getByRole("region", { name: "Suggestion 2 of 2" })).toBeVisible();
  await expect(page.getByText("kept the suggested wording")).toHaveCount(0);
});
