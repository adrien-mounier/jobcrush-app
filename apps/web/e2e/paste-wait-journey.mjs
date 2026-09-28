// #304 — the narrated wait and the failure screen, driven as a human in a real browser.
//
// This is the RENDER TEST the ticket asks for by name, and it exists because of a defect class this
// repo has now paid for more than once: an API-level assertion goes green while the screen stays
// blank. apps/api/test/pasteAdvert.test.ts already proves the server publishes three steps, the
// requirements before the score, one employer lookup and a two-line failure. None of that proves a
// person sees any of it. This does, or it goes red.
//
// What it proves, in the order a person meets it:
//   AC1  the three named steps are on the paste screen while the advert is being read, in order,
//        and they are the spec's own words — reading the advert · looking up the employer ·
//        checking it against your profile
//   AC2  the requirements appear ON SCREEN as they are read, before anything is scored: they are on
//        the paste screen, while the wait is still running, in the advert's own words
//   AC3  the employer step really looks something up, and what came back is on the screen
//   AC4  an advert that yields no requirements gets a FULL failure screen naming what came back
//        and what usually fixes it
//   AC5  that screen KEEPS the pasted text, character for character, and "Read it again" is one
//        press away from it
//
// Runs against the fake-model API entry (apps/api/src/qa-main.ts), which paces the pasted-advert
// reader and the employer lookup at QA_PASTE_STEP_MS so a narrated step is observable at all — the
// same deliberate slowness pending-unscored-card-journey.mjs already relies on. Against a real
// keyed API the steps are just as real and simply pass quicker.
//
// No sign-in: the paste screen needs a session, not an account, so this journey spends none of
// auth's 5-per-15-min limiter budget. Measured ~50s.
//
// Run:
//   pnpm --filter @jobcrush/api build
//   PORT=30181 node apps/api/dist/qa-main.js
//   cd apps/web && API_URL=http://127.0.0.1:30181 npx next build && npx next start -p 30180
//   BASE_URL=http://127.0.0.1:30180 node apps/web/e2e/paste-wait-journey.mjs
import { createSession } from "./qa-driver.mjs";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";

// The employer is "Nordic Retail Group" on purpose: it is the one company the QA entry's canned
// employer table (#282) can answer for, so the "looking up the employer" step has something real to
// come back with and AC3 is a statement about a lookup rather than about an empty gap.
//
// The "- " lines are what the QA entry reads as requirements. They are the words this journey then
// looks for ON THE SCREEN, so a panel that renders the right number of empty rows still fails.
const ADVERT = `IT Programme Manager — Nordic Retail Group
Stockholm, Sweden · Hybrid

Nordic Retail Group is replacing the systems behind its stores across Sweden and Denmark, and we
are looking for a programme manager to lead it.

What we are looking for
- Lead a multi-year systems replacement across two countries
- Report progress to a steering committee every month
- Manage a budget above EUR 5 million
- Work in English with Swedish-speaking store teams

Reference: ${Date.now()}`;

const REQUIREMENTS = [
  "Lead a multi-year systems replacement across two countries",
  "Report progress to a steering committee every month",
  "Manage a budget above EUR 5 million",
  "Work in English with Swedish-speaking store teams",
];

// Same shape, same employer, same everything — except that not one line starts with "- ", so the
// advert reads as a job and yields NO requirements. That is the exact state #301 amends #86 for:
// right for an advert we fetched, wrong for one he pasted deliberately.
const NO_REQUIREMENTS_ADVERT = `Warehouse Coordinator — Nordic Retail Group
Malmo, Sweden

Nordic Retail Group is looking for a warehouse coordinator for its southern distribution centre.
You will keep the goods moving, work with the store teams, and report to the site manager. We offer
a permanent contract, a pension, and a staff discount in all of our stores. We are an equal
opportunities employer and we welcome applications from everyone.`;

// The wait panel is on screen for as long as the read takes and no longer — a few seconds against
// the QA entry's paced fakes. Anything waiting for it has to be shorter than the read, or it waits
// out its whole budget on a screen that has already moved on.
const PANEL_MS = 10_000;
/** How long after the first step appears the SECOND one must still be waiting to start.
 *
 *  This number is the load-bearing one in this file, and #304's QA gate is why it exists. The
 *  defect this journey was written after is an intermediary BUFFERING the event stream to its end,
 *  so every step lands in one burst and the person watches nothing. An order-only assertion cannot
 *  see that: EventSource dispatches each buffered message as its own task, so React still renders
 *  them in sequence and the recorded ORDER is identical to a healthy run. The gate proved it — it
 *  re-introduced the buffering and this journey stayed green.
 *
 *  Time is what tells the two apart. The QA entry paces each faked step at QA_PASTE_STEP_MS
 *  (1500ms, qa-main.ts), so a healthy run has well over a second between step one appearing and
 *  step two starting; a buffered one has milliseconds. 800ms is comfortably between them. */
const MIN_STEP_GAP_MS = 800;
const STEP_MS = 30_000;
const LAND_MS = 60_000;

const qa = await createSession("paste-wait-journey", { baseURL: BASE_URL });
const { page } = qa;

const defects = [];
/** One verdict, screenshotted, WITHOUT stopping the run — a journey that dies on its first defect
 *  reports one defect. (Same helper as paste-door-journey.mjs, same reasoning.) */
const must = async (ok, note) => {
  if (ok) return qa.expectVisible("body", `PASS — ${note}`);
  defects.push(note);
  return qa.expectVisible("#defect-no-such-element", `FAIL — ${note}`);
};

/** qa-driver's expectVisible asks "is it visible NOW" and does not wait. Anything that arrives on
 *  its own clock has to be waited for first, or the assertion is a race the product usually loses. */
const settle = (loc, what, timeout = STEP_MS) =>
  loc.waitFor({ state: "visible", timeout }).then(
    () => qa.note(`${what} arrived`),
    () => qa.note(`${what} did NOT arrive within ${timeout / 1000}s`),
  );

/** Records every distinct state the wait panel passes through, into sessionStorage so it survives
 *  the screen navigating away at the end of the read.
 *
 *  A live assertion cannot do this job. The panel is a moving thing, a driver paced at a second per
 *  action lands wherever it lands, and "the steps were narrated IN ORDER" is a claim about the
 *  sequence, not about one instant. So the sequence is recorded from inside the page and asserted
 *  afterwards — which is also why this journey can go red on a step rendered in the wrong order or
 *  with the wrong words, not merely on one that never renders at all. */
const recordNarration = () =>
  page.evaluate(() => {
    sessionStorage.removeItem("__narration");
    const snap = () => {
      const steps = [...document.querySelectorAll('[data-testid^="paste-step-"]')].map((li) => ({
        id: li.dataset.testid.replace("paste-step-", ""),
        label: li.querySelector(".label")?.textContent.trim() ?? "(no label)",
        state: li.dataset.state,
      }));
      if (steps.length === 0) return; // not on the wait panel (or it is gone) — nothing to record
      const frame = {
        steps,
        reqs: [...document.querySelectorAll('[data-testid="paste-requirements"] li')].map((li) =>
          li.textContent.trim(),
        ),
        employer: document.querySelector('[data-testid="paste-employer"]')?.textContent.trim() ?? null,
        path: location.pathname,
      };
      const key = JSON.stringify(frame);
      const frames = JSON.parse(sessionStorage.getItem("__narration") ?? "[]");
      if (frames[frames.length - 1]?.key === key) return;
      // The CLOCK is recorded, not just the order, and that is the whole point — see MIN_STEP_GAP_MS.
      frames.push({ ...frame, key, t: Math.round(performance.now()) });
      sessionStorage.setItem("__narration", JSON.stringify(frames));
    };
    new MutationObserver(snap).observe(document.body, { subtree: true, childList: true, attributes: true });
    snap();
  });

const narration = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("__narration") ?? "[]"));

// ---------------------------------------------------------------------------------------------
// 1) Open the paste screen and put a real advert into it.
// ---------------------------------------------------------------------------------------------
await qa.goto("/paste", "open the paste screen — the anonymous session is created here");
await qa.scrollThrough("read the empty paste screen the way somebody arriving at it does");

// Before anything is pasted the panel must promise, not narrate: no step is in progress yet.
const stepsBefore = await page.locator('[data-testid^="paste-step-"]').count();
await qa.note(`before the read, steps on screen: ${stepsBefore} (nothing is happening, so there is nothing to narrate)`);
await must(stepsBefore === 0, "AC1 — nothing is narrated before he presses Read it");

// #274, guarded here rather than in a journey of its own. The rule — a field's text is 16px,
// because mobile Safari zooms the whole page into any focused field under that — has a
// product-wide walk (field-style-journey.mjs) which never opens THIS screen and is itself in no
// tier, which is exactly how the paste screen sat two sizes under the line unnoticed. Two
// assertions on a journey the gate already runs close that for free; the walk's own homelessness
// is a separate problem with its own ticket.
const fieldSizes = await page.evaluate(() => ({
  advert: getComputedStyle(document.querySelector("#advert")).fontSize,
  link: getComputedStyle(document.querySelector("#applylink")).fontSize,
}));
await qa.note(`field text, as the browser computes it: advert ${fieldSizes.advert}, link ${fieldSizes.link} (#274 floor is 16px)`);
await must(
  parseFloat(fieldSizes.advert) >= 16 && parseFloat(fieldSizes.link) >= 16,
  `#274 — both fields are at least 16px, so focusing one does not zoom the page on mobile Safari (got ${JSON.stringify(fieldSizes)})`,
);

await qa.fill(page.locator("#advert"), ADVERT, "paste a real advert into the box");

// ---------------------------------------------------------------------------------------------
// 2) AC1/AC2/AC3 — watch the work happen.
// ---------------------------------------------------------------------------------------------
await recordNarration();

// The verdict is armed BEFORE the press. qa-driver paces itself at about a second per action and
// takes a screenshot on each, so by the time it could look, a quick read is already over — and a
// race lost to the product being fast is not a defect. This resolves the instant the panel appears.
const panelSeen = page
  .locator(".pastescreen .steps")
  .waitFor({ state: "visible", timeout: PANEL_MS })
  .then(() => true, () => false);
await qa.click(page.getByRole("button", { name: "Read it" }), "press 'Read it' and watch the screen");
await must(await panelSeen, "AC1 — the three named steps appear on the paste screen the moment the read starts");

// …and a screenshot of them, if the read is still running when the driver gets here.
if (await page.locator(".pastescreen .steps").isVisible().catch(() => false)) {
  await qa.expectVisible(page.locator(".pastescreen .steps"), "AC1 — the three named steps, on screen, mid-read");
  await qa.scrollThrough("watch the panel while the advert is being read");
} else {
  await qa.note("the read finished before the driver could photograph the panel — the recorded narration below is the evidence");
}

const landed = await page.waitForURL(/\/job\//, { timeout: LAND_MS }).then(() => true, () => false);
await qa.note(`after the read he is on ${new URL(page.url()).pathname}`);
await must(landed, "the narrated wait ends on that job's own screen (#291 ruling 2)");

// Everything the panel showed him, in order.
const frames = await narration();
await qa.note(`the wait panel passed through ${frames.length} distinct states while his advert was read`);

const labels = frames[0]?.steps.map((step) => `${step.id}:${step.label}`) ?? [];
await qa.note(`the steps, as the screen named them: ${JSON.stringify(labels)}`);
await must(
  labels.join(" | ") ===
    "reading:Reading the advert | employer:Looking up the employer | profile:Checking it against your profile",
  `AC1 — three steps, in order, named in the spec's own words (got ${JSON.stringify(labels)})`,
);

// The sequence of "which one is happening now", deduped: it must walk forwards through all three.
const live = [];
for (const frame of frames) {
  const now = frame.steps.find((step) => step.state === "now")?.id;
  if (now && now !== live[live.length - 1]) live.push(now);
}
await qa.note(`the steps he actually watched go by, in the order the screen showed them: ${JSON.stringify(live)}`);
// Forward-only, and it must get past the first one. Deliberately not "all three, exactly": against
// this entry's fakes the LAST step (checking it against your profile) is a cached card build that
// finishes in a millisecond, so whether it is ever painted as in-progress is a property of the
// machine, not of the product. Against a real judge it takes seconds and is plainly visible. What
// must never happen — a step shown out of order, or the marker going backwards — this catches.
const order = ["reading", "employer", "profile"];
const forwardOnly = live.every((id, i) => order.indexOf(id) > (i === 0 ? -1 : order.indexOf(live[i - 1])));
await must(
  forwardOnly && live[0] === "reading" && live.length >= 2,
  `AC1 — the steps were shown as in progress in order, never backwards and never skipping ahead (got ${JSON.stringify(live)})`,
);
// The steps were watched OVER TIME, not delivered in one burst at the end. Without this, a stream
// buffered by a proxy — the defect that cost this feature a whole build once already — passes every
// other assertion in this file.
const firstFrame = frames[0];
const startedSecond = frames.find(
  (frame) => frame.steps.find((step) => step.state === "now")?.id === "employer",
);
const gap = firstFrame && startedSecond ? startedSecond.t - firstFrame.t : -1;
await qa.note(`step 1 appeared, and step 2 started ${gap}ms later (a buffered stream makes that gap ~0)`);
await must(
  gap >= MIN_STEP_GAP_MS,
  `AC1 — the steps arrived one at a time while he waited, not all at once at the end (gap ${gap}ms, floor ${MIN_STEP_GAP_MS}ms)`,
);

// …and by the time he leaves the screen, the steps he already watched are marked as finished.
const lastFrame = frames[frames.length - 1];
await qa.note(`the panel's last state before he left it: ${JSON.stringify(lastFrame?.steps)}`);
await must(
  Boolean(lastFrame?.steps.find((step) => step.id === "reading")?.state === "done"),
  "AC1 — a step that is over says so: 'Reading the advert' is marked done once it is",
);

// AC2 — the requirements, on screen, in the advert's own words, while he was still on /paste.
const withReqs = frames.filter((frame) => frame.reqs.length > 0);
const shown = withReqs[0]?.reqs ?? [];
await qa.note(`what lifted out of his advert, on screen, before anything was scored: ${JSON.stringify(shown)}`);
await must(
  REQUIREMENTS.every((requirement) => shown.includes(requirement)),
  `AC2 — every requirement in the advert reached the screen in the advert's own words (got ${shown.length} of ${REQUIREMENTS.length})`,
);
await must(
  withReqs.length > 0 && withReqs.every((frame) => frame.path === "/paste"),
  "AC2 — nothing is scored on screen before it is read: the requirements were on the PASTE screen, before the job's own screen existed",
);
// And they were there before the read had finished — the panel was still narrating when they landed.
await must(
  Boolean(withReqs[0]?.steps.some((step) => step.state !== "done")),
  "AC2 — the requirements appeared AS they were read, while the wait was still running",
);

// AC3 — the employer step really looked something up.
const employerLine = frames.map((frame) => frame.employer).filter(Boolean).pop() ?? "";
await qa.note(`what the 'looking up the employer' step came back with: "${employerLine}"`);
await must(employerLine.length > 0, "AC3 — the employer step is a real lookup, and what came back reached the screen");

if (landed) await qa.scrollThrough("read the job's own screen — the score arrives AFTER the advert was read back to him");

// ---------------------------------------------------------------------------------------------
// 3) AC4/AC5 — an advert that yields no requirements.
// ---------------------------------------------------------------------------------------------
await qa.goto("/paste", "come back to the paste screen with a second, harder advert");
await qa.fill(
  page.locator("#advert"),
  NO_REQUIREMENTS_ADVERT,
  "paste an advert that reads as a job but states nothing it asks for",
);
await qa.click(page.getByRole("button", { name: "Read it" }), "press 'Read it' on the advert that yields nothing");

await settle(page.locator('[data-testid="paste-failure"]'), "the failure screen", LAND_MS);
await qa.expectVisible(
  page.locator('[data-testid="paste-failure"]'),
  "AC4 — a full failure screen, not a red line under the form",
);
const failure = (await page.locator('[data-testid="paste-failure"]').innerText().catch(() => "")).replace(/\s+/g, " ").trim();
await qa.note(`what the person is told, word for word: "${failure}"`);
await must(/What came back:/i.test(failure), "AC4 — the failure screen names what came back");
await must(/What usually fixes it:/i.test(failure), "AC4 — the failure screen names what usually fixes it");
await must(
  /no requirements came out of the advert/i.test(failure),
  "AC4 — and what it names is the real cause: the advert read as a job and stated nothing it asks for",
);
await qa.scrollThrough("read the whole failure screen the way somebody who just lost a minute would");

// AC5 — his text. Not "a textarea exists": the same characters he pasted, still there.
const kept = await page.locator("#advert").inputValue();
await qa.note(`his pasted text after the failure: ${kept.length} characters (he pasted ${NO_REQUIREMENTS_ADVERT.length})`);
await must(kept === NO_REQUIREMENTS_ADVERT, "AC5 — the failure screen kept his pasted text, character for character");
await qa.expectVisible(page.locator("#advert"), "AC5 — the advert he pasted is still on the screen, still editable");

// …and the way out is one press, named for what it does.
const retry = page.getByRole("button", { name: "Read it again" });
await qa.expectVisible(retry, "AC5 — 'Read it again' is one press away, with his text already in the box");
await must(await retry.isEnabled(), "AC5 — and it is pressable, so the failure screen is not a dead end");

// The steps panel is gone while the failure stands: narrating work that has stopped would be the
// product telling him something is happening when nothing is.
const stepsDuringFailure = await page.locator('[data-testid^="paste-step-"]').count();
await must(
  stepsDuringFailure === 0,
  `AC4 — the failure screen replaces the narration rather than sitting beside it (found ${stepsDuringFailure} steps)`,
);

if (defects.length) {
  await qa.note(`DEFECTS FOUND (${defects.length}): ${defects.join(" | ")}`);
} else {
  await qa.note("no defect found on any acceptance criterion this journey can reach.");
}
const ok = await qa.finish();
process.exit(ok ? 0 : 1);
