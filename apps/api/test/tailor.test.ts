// #23 tailor (screen 3) — pure helpers (prior art: matchtick.test.ts) + the pinned HTTP seam (prior
// art: discovery.test.ts, cards.test.ts). Pins: composeTailorLine actually covers the requirement (the
// AC1 hinge), the ledger derivation, and the route behaviors — re-score never decreases, never-re-ask,
// the ledger, done, and drop losing the job but never a claim.
import { describe, expect, it } from "vitest";
import type { AdRequirementV1, AdRequirementsV1, CandidateClaim } from "@jobcrush/contracts";
import { buildServer } from "../src/server.js";
import type { ClaimRecord } from "../src/claims.js";
import { loadAdRequirements } from "../src/e5stub.js";
import { matchTick } from "../src/matchtick.js";
import { discoveryClaimId } from "../src/discovery.js";
import {
  buildTailorLedger,
  composeTailorLine,
  negativeRequirementIds,
  tailorClaimId,
  tailorCvLines,
  tailorQuestions,
} from "../src/tailor.js";
import { DECLINE_OPTION } from "../src/eligibilityDiscovery.js";

const AD: AdRequirementsV1 = {
  schemaVersion: "1",
  adId: "test-ad",
  curated: true,
  language: "en",
  familyFit: { family: "IT Project Manager", confidence: 0.9 },
  requirements: [
    {
      id: "own-budget",
      band: "essential",
      requirement: "Own a project budget with vendor oversight",
      sourceSpan: "Own a project budget with vendor oversight",
    },
    {
      id: "lead-team",
      band: "essential",
      requirement: "Lead a cross-functional delivery team",
      sourceSpan: "Lead a cross-functional delivery team",
    },
    {
      id: "certification",
      band: "nice-to-have",
      requirement: "Hold a project management certification",
      sourceSpan: "Hold a project management certification",
    },
  ],
};
const [OWN_BUDGET, LEAD_TEAM, CERTIFICATION] = AD.requirements as [AdRequirementV1, AdRequirementV1, AdRequirementV1];

// #28: buildTailorLedger reads answer order off ClaimRecord.seq — a module-level counter so calls
// made earlier in a test (JS evaluates arguments left-to-right) land with a lower seq, same as the
// real store assigning it at answer time.
let seqCounter = 0;
const claimFor = (
  adId: string,
  req: AdRequirementV1,
  answer: string,
  decision: "confirmed" | "negative",
): ClaimRecord => ({
  id: tailorClaimId(adId, req.id),
  role: "profile",
  text: decision === "negative" ? `Not applicable — ${req.requirement}` : composeTailorLine(req, answer),
  machine_touch: "verbatim",
  classification: "Verified",
  source_quote: answer.slice(0, 200),
  needs_grill: false,
  grill_hint: null,
  decision,
  origin: "user-authored",
  seq: ++seqCounter,
});
const yesClaim = (req: AdRequirementV1) => claimFor(AD.adId, req, "Yes", "confirmed");
const noClaim = (req: AdRequirementV1) => claimFor(AD.adId, req, "No", "negative");

describe("#23 composeTailorLine", () => {
  // D3: a bullet, not a sentence — no "I " prefix (was producing "I experience driving digital
  // transformation initiatives."). Reads like discovery's own lines.
  it("a bare 'Yes' restates the requirement as a CV bullet, not a first-person sentence", () => {
    expect(composeTailorLine(OWN_BUDGET, "Yes")).toBe("Own a project budget with vendor oversight.");
    expect(composeTailorLine(OWN_BUDGET, "yes.")).toBe("Own a project budget with vendor oversight.");
  });

  it("free text is the visitor's own words, verbatim (period-terminated)", () => {
    expect(composeTailorLine(OWN_BUDGET, "I've run vendor budgets north of $2M")).toBe(
      "I've run vendor budgets north of $2M.",
    );
  });

  it("is deterministic — same requirement+answer yields the same line", () => {
    expect(composeTailorLine(LEAD_TEAM, "Yes")).toBe(composeTailorLine(LEAD_TEAM, "Yes"));
  });

  // The AC1 hinge: the composed line must actually cover the requirement, or the tick never moves.
  it("the composed 'Yes' line covers its own requirement — matchTick moves (the AC1 hinge)", () => {
    for (const req of AD.requirements) {
      const before = matchTick([], AD);
      const line = composeTailorLine(req, "Yes");
      const after = matchTick([{ text: line }], AD);
      expect(after).toBeGreaterThan(before);
    }
  });
});

describe("#23 tailorClaimId", () => {
  it("is a valid kebab-case slug even when the adId carries underscores (the E5 stub's date-slug ids)", () => {
    const id = tailorClaimId("2026-07-05_manulife_senior-it-project-manager-delivery-manager", "manage-full-project-lifecycle");
    expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(id.includes("_")).toBe(false);
  });

  it("is deterministic and distinct per (adId, requirementId)", () => {
    expect(tailorClaimId("ad-1", "req-1")).toBe(tailorClaimId("ad-1", "req-1"));
    expect(tailorClaimId("ad-1", "req-1")).not.toBe(tailorClaimId("ad-1", "req-2"));
    expect(tailorClaimId("ad-1", "req-1")).not.toBe(tailorClaimId("ad-2", "req-1"));
  });
});

describe("#23 tailorQuestions — the never-re-ask rule", () => {
  it("lists every requirement, ad rank order, when nothing is answered", () => {
    expect(tailorQuestions(AD, [], []).map((q) => q.requirementId)).toEqual([
      "own-budget",
      "lead-team",
      "certification",
    ]);
  });

  it("excludes a requirement once covered by a confirmed fact", () => {
    expect(tailorQuestions(AD, [yesClaim(OWN_BUDGET)], []).map((q) => q.requirementId)).toEqual([
      "lead-team",
      "certification",
    ]);
  });

  it("excludes a requirement answered 'no' even though it stays uncovered — never re-asked", () => {
    const qs = tailorQuestions(AD, [], [noClaim(OWN_BUDGET)]);
    expect(qs.map((q) => q.requirementId)).not.toContain("own-budget");
  });

  it("every question offers tap-first Yes/No options", () => {
    for (const q of tailorQuestions(AD, [], [])) expect(q.options).toEqual(["Yes", "No"]);
  });
});

describe("#23 buildTailorLedger", () => {
  it("a covered positive answer produces a '+N%' line; N is the requirement's band-weight share", () => {
    const { ledger, closedGaps } = buildTailorLedger(AD, [yesClaim(OWN_BUDGET)], []);
    expect(ledger).toEqual([{ requirementId: "own-budget", text: "+43% · Own a project budget with vendor oversight" }]);
    expect(closedGaps).toEqual({ asked: 1, closed: 1 });
  });

  it("a 'nice' band answer gets a smaller share than a 'must'", () => {
    const { ledger } = buildTailorLedger(AD, [yesClaim(CERTIFICATION)], []);
    expect(ledger[0]!.text).toBe("+14% · Hold a project management certification");
  });

  // B1: the answered requirement itself is no longer "open" (spec #37/#38 — a "no" closes the gap,
  // not just the question), so "still open" must be 2 (lead-team, certification), NOT 3 — the
  // pre-fix code counted 3 here because openCount never subtracted the requirement it was reporting
  // as just-closed.
  it("a negative answer produces an 'asked and closed · k still open' line and does not count as closed", () => {
    const { ledger, closedGaps } = buildTailorLedger(AD, [], [noClaim(OWN_BUDGET)]);
    expect(ledger).toEqual([{ requirementId: "own-budget", text: "asked and closed · 2 still open" }]);
    expect(closedGaps).toEqual({ asked: 1, closed: 0 });
  });

  it("an unanswered requirement gets no ledger line", () => {
    const { ledger, closedGaps } = buildTailorLedger(AD, [], []);
    expect(ledger).toEqual([]);
    expect(closedGaps).toEqual({ asked: 0, closed: 0 });
  });

  it("ledger order follows the ad's own rank order, not answer order", () => {
    const { ledger } = buildTailorLedger(AD, [yesClaim(LEAD_TEAM), yesClaim(OWN_BUDGET)], []);
    expect(ledger.map((l) => l.requirementId)).toEqual(["own-budget", "lead-team"]);
  });

  it("only ever grows across answers — the last line never disappears once a requirement is answered", () => {
    const first = buildTailorLedger(AD, [yesClaim(OWN_BUDGET)], []);
    const second = buildTailorLedger(AD, [yesClaim(OWN_BUDGET), yesClaim(LEAD_TEAM)], []);
    expect(second.ledger.length).toBeGreaterThan(first.ledger.length);
    expect(second.ledger.map((l) => l.requirementId)).toEqual(
      expect.arrayContaining(first.ledger.map((l) => l.requirementId)),
    );
  });

  // #23 B1 regression: every negative answered so far (up to and including the one this line is
  // about) must be excluded from "still open" — otherwise "closed 2 of 3" and "N still open" can
  // both lie simultaneously. Post-#28, "so far" means AT THAT ANSWER'S OWN LANDING TIME, so the two
  // lines below now differ (own-budget landed first, when 2 were still open; lead-team second, when
  // only 1 was) — see the #28 describe block below for the regression this superseded.
  it("B1: 'still open' subtracts every negative recorded up to and including that answer's own landing", () => {
    const { ledger } = buildTailorLedger(AD, [], [noClaim(OWN_BUDGET), noClaim(LEAD_TEAM)]);
    expect(ledger.find((l) => l.requirementId === "own-budget")!.text).toBe("asked and closed · 2 still open");
    expect(ledger.find((l) => l.requirementId === "lead-team")!.text).toBe("asked and closed · 1 still open");
  });
});

// #28: buildTailorLedger stamped every "asked and closed" line from the CURRENT open count, computed
// once before the loop — so rebuilding the ledger after a later "no" landed silently rewrote every
// EARLIER line too (by session's end every one read "· 0 still open" regardless of when it actually
// closed). Fix: replay confirmed+negatives merged by ClaimRecord.seq, one answer at a time, and stamp
// each line with the count open right after ITS OWN answer landed.
describe("#28 buildTailorLedger — a historical line is stamped once, not rewritten by later answers", () => {
  it("an earlier line's count survives a later answer landing on the SAME rebuilt ledger", () => {
    const onlyFirst = buildTailorLedger(AD, [], [noClaim(OWN_BUDGET)]);
    expect(onlyFirst.ledger).toEqual([{ requirementId: "own-budget", text: "asked and closed · 2 still open" }]);

    // Rebuilding the ledger (same as a reload) after LEAD_TEAM also lands "no": pre-fix, own-budget's
    // line would now read "1 still open" (today's count) — a rewrite of already-shown history.
    const afterSecond = buildTailorLedger(AD, [], [noClaim(OWN_BUDGET), noClaim(LEAD_TEAM)]);
    expect(afterSecond.ledger.find((l) => l.requirementId === "own-budget")!.text).toBe(
      "asked and closed · 2 still open", // unchanged from `onlyFirst` — AC1
    );
    expect(afterSecond.ledger.find((l) => l.requirementId === "lead-team")!.text).toBe(
      "asked and closed · 1 still open", // its own landing-time count, not own-budget's
    );
  });

  // Every other count-asserting test in this file only ever passes `confirmed: []` (all-negative
  // scenarios) or answers everything "No" — so confirmedSoFar === confirmed at every replay step by
  // construction, and the replay's use of confirmedSoFar (not the final `confirmed`) at tailor.ts's
  // uncoveredRequirements(confirmedSoFar, ...) call goes untested. This interleaves a "no" landing
  // BEFORE a later "yes": if the replay used the final `confirmed` list at every step instead of the
  // accumulated confirmedSoFar, lead-team's line would wrongly treat own-budget as already covered
  // (it isn't yet, at the moment lead-team's "no" lands) and understate "still open" by one.
  it("a 'no' landed BEFORE a later 'yes' is stamped with pre-yes coverage, not the session's final coverage", () => {
    const negLeadTeamFirst = noClaim(LEAD_TEAM); // constructed (and seq'd) first — lands first
    const posOwnBudgetSecond = yesClaim(OWN_BUDGET); // constructed second — lands after
    const { ledger } = buildTailorLedger(AD, [posOwnBudgetSecond], [negLeadTeamFirst]);

    // own-budget's own "yes" covers itself immediately (the AC1 hinge) -> a "+N%" line, unaffected.
    expect(ledger.find((l) => l.requirementId === "own-budget")!.text).toContain("+");

    // lead-team's "no" landed while only itself was answered: own-budget and certification were BOTH
    // still uncovered at that instant, minus lead-team itself (excluded as the negative in question)
    // -> 2 still open. A buggy replay using the final `confirmed` ([own-budget]) at this step would
    // already count own-budget as covered and report 1.
    expect(ledger.find((l) => l.requirementId === "lead-team")!.text).toBe("asked and closed · 2 still open");
  });
});

describe("#23 negativeRequirementIds", () => {
  it("returns exactly the requirement ids with a recorded tailor negative for this ad", () => {
    expect(negativeRequirementIds(AD, [noClaim(OWN_BUDGET)])).toEqual(new Set(["own-budget"]));
    expect(negativeRequirementIds(AD, [noClaim(OWN_BUDGET), noClaim(LEAD_TEAM)])).toEqual(
      new Set(["own-budget", "lead-team"]),
    );
  });

  it("is empty when nothing has been answered 'no' for this ad", () => {
    expect(negativeRequirementIds(AD, [])).toEqual(new Set());
  });

  it("never matches a negative recorded against a DIFFERENT ad (claim ids are ad-scoped)", () => {
    const foreignAdNegative = { ...noClaim(OWN_BUDGET), id: tailorClaimId("other-ad", "own-budget") };
    expect(negativeRequirementIds(AD, [foreignAdNegative])).toEqual(new Set());
  });
});

describe("#23 tailorCvLines — B2: a confirmed tailor answer becomes a CV line", () => {
  it("emits one cvLine per confirmed tailor answer for this ad", () => {
    const lines = tailorCvLines(AD, [yesClaim(OWN_BUDGET)]);
    expect(lines).toEqual([
      { itemId: tailorClaimId(AD.adId, "own-budget"), section: "experience", text: "Own a project budget with vendor oversight." },
    ]);
  });

  it("uses the requirement's own cvSection when the ad carries one", () => {
    const skillReq: AdRequirementV1 = { ...OWN_BUDGET, cvSection: "skills" };
    const lines = tailorCvLines({ ...AD, requirements: [skillReq] }, [yesClaim(skillReq)]);
    expect(lines[0]!.section).toBe("skills");
  });

  it("falls back to 'experience' when the requirement has no cvSection (the AD fixture's own case)", () => {
    expect(tailorCvLines(AD, [yesClaim(LEAD_TEAM)])[0]!.section).toBe("experience");
  });

  it("a negative produces no CV line, and an unanswered requirement produces none either", () => {
    expect(tailorCvLines(AD, [])).toEqual([]);
  });
});

// --- routes ---
async function anonSession(app: ReturnType<typeof buildServer>["app"]): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}
const get = (app: ReturnType<typeof buildServer>["app"], cookie: string, url: string) =>
  app.inject({ method: "GET", url, headers: { cookie } });
const post = (
  app: ReturnType<typeof buildServer>["app"],
  cookie: string,
  url: string,
  payload?: unknown,
) => app.inject({ method: "POST", url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
const put = (
  app: ReturnType<typeof buildServer>["app"],
  cookie: string,
  url: string,
  payload?: unknown,
) => app.inject({ method: "PUT", url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
async function signIn(app: ReturnType<typeof buildServer>["app"], cookie: string, email: string): Promise<void> {
  const link = await post(app, cookie, "/auth/request-link", { email });
  const token = new URL("http://x" + link.json().devLink).searchParams.get("token")!;
  await post(app, cookie, "/auth/verify", { token });
}

const ROLE = "IT project manager in Paris";
const VALID_AD_ID = "2026-07-05_endava-vietnam_senior-project-manager";
const minedClaimFor = (req: AdRequirementV1): CandidateClaim => ({
  id: `mined-${req.id}`,
  role: "profile",
  text: `${req.requirement}.`,
  machine_touch: "verbatim",
  classification: "Verified",
  source_quote: req.requirement.slice(0, 200),
  needs_grill: false,
  grill_hint: null,
});

/** Discovery (3 essential answers, closing the band) -> deck -> sign in -> want -> tailor. Exact prior
 *  art: cards.test.ts's own flow, plus discovery.test.ts's known essential item ids. */
async function reachTailor(app: ReturnType<typeof buildServer>["app"], cookie: string, email: string) {
  await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
  await post(app, cookie, "/onboarding/discovery/answer", { itemId: "budget-accountability", answer: "Yes, over $1M" });
  await post(app, cookie, "/onboarding/discovery/answer", { itemId: "cross-functional-leadership", answer: "Yes, multiple teams" });
  await post(app, cookie, "/onboarding/discovery/answer", { itemId: "stakeholder-reporting", answer: "No" });
  await signIn(app, cookie, email);
  await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`);
}

async function reachTailorWithSeededDeck(server: ReturnType<typeof buildServer>, cookie: string, email: string) {
  const { app, store } = server;
  await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
  await post(app, cookie, "/onboarding/discovery/answer", { itemId: "budget-accountability", answer: "Yes, over $1M" });
  await post(app, cookie, "/onboarding/discovery/answer", { itemId: "cross-functional-leadership", answer: "Yes, multiple teams" });
  await post(app, cookie, "/onboarding/discovery/answer", { itemId: "stakeholder-reporting", answer: "No" });
  await signIn(app, cookie, email);

  const sessionId = (await get(app, cookie, "/sessions/me")).json().id as string;
  const adReq = loadAdRequirements(VALID_AD_ID);
  const job = await store.create("onboarding", sessionId);
  await store.update(job.id, {
    status: "completed",
    progress: { miner: { claims: adReq.requirements.map(minedClaimFor), doc: { roles: [] }, roles: 0, needsGrill: 0 } },
  });
  const deck = await post(app, cookie, "/onboarding/deck", { jobId: job.id });
  expect(deck.statusCode).toBe(200);
  await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`);
}

describe("#23 GET /onboarding/tailor", () => {
  it("409s with no_tailor_target when no job is being tailored", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await signIn(app, cookie, "no-target@example.com");
    const res = await get(app, cookie, "/onboarding/tailor");
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: "no_tailor_target", message: "no job being tailored" } });
  });

  it("returns the pinned TailorState shape once a job is targeted", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "first-get@example.com");

    const res = await get(app, cookie, "/onboarding/tailor");
    expect(res.statusCode).toBe(200);
    const state = res.json();
    expect(state.card.adId).toBe(VALID_AD_ID);
    expect(state.questions.length).toBeGreaterThan(0);
    expect(state.ledger).toEqual([]); // nothing answered in tailor yet
    expect(state.closedGaps).toEqual({ asked: 0, closed: 0 });
    expect(state.done).toBe(false); // AC4: the "I'm done" exit is available regardless, from the client
    expect(Array.isArray(state.cvLines)).toBe(true);
    expect(state.cvLines.some((l: { itemId: string }) => l.itemId === "role")).toBe(true);
    expect(typeof state.factCount).toBe("number");
    expect(state.factCount).toBeGreaterThanOrEqual(3); // the 3 discovery answers already recorded
  });
});

describe("#23 POST /onboarding/tailor/answer", () => {
  it("409s with no_tailor_target when no job is being tailored", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await signIn(app, cookie, "no-target-answer@example.com");
    const res = await post(app, cookie, "/onboarding/tailor/answer", { requirementId: "x", answer: "Yes" });
    expect(res.statusCode).toBe(409);
  });

  it("404s on a requirementId that isn't part of this ad", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "unknown-req@example.com");
    const res = await post(app, cookie, "/onboarding/tailor/answer", { requirementId: "not-real", answer: "Yes" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: "unknown_requirement", message: "no such requirement" } });
  });

  it("answering re-scores instantly, flips the requirement off the question list, and records a ledger line", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "answer-moves-pct@example.com");
    const before = (await get(app, cookie, "/onboarding/tailor")).json();
    const q = before.questions[0];

    const res = await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "Yes" });
    expect(res.statusCode).toBe(200);
    const after = res.json();
    expect(after.card.matchPct).toBeGreaterThan(before.card.matchPct); // AC1: re-scores
    expect(after.card.schemaVersion).toBe("1");
    expect(after.card.breakdown.essential.met + after.card.breakdown.desirable.met).toBeGreaterThan(
      before.card.breakdown.essential.met + before.card.breakdown.desirable.met,
    );
    expect(after.questions.map((x: { requirementId: string }) => x.requirementId)).not.toContain(q.requirementId);
    expect(after.ledger.some((l: { requirementId: string; text: string }) => l.requirementId === q.requirementId && l.text.startsWith("+"))).toBe(true);
    expect(after.closedGaps.asked).toBe(1);
    expect(after.closedGaps.closed).toBe(1);
  });

  it("the % never decreases even after correcting the same requirement to a 'no'", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "floor-holds@example.com");
    const s0 = (await get(app, cookie, "/onboarding/tailor")).json();
    const q = s0.questions[0];

    const afterYes = (await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "Yes" })).json();
    const afterNo = (await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "No" })).json();
    expect(afterNo.card.matchPct).toBeGreaterThanOrEqual(afterYes.card.matchPct);
  });

  it("never re-asks a requirement answered 'no' — a fresh GET still omits it", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "never-reask@example.com");
    const s0 = (await get(app, cookie, "/onboarding/tailor")).json();
    const q = s0.questions[0];

    await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "No" });
    const resumed = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(resumed.questions.map((x: { requirementId: string }) => x.requirementId)).not.toContain(q.requirementId);
  });

  it("is idempotent — re-answering the same requirement corrects it (positive<->negative flip)", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "idempotent@example.com");
    const s0 = (await get(app, cookie, "/onboarding/tailor")).json();
    const q = s0.questions[0];
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;

    await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "No" });
    expect((await claims.negatives(sid)).map((c) => c.id)).toContain(tailorClaimId(VALID_AD_ID, q.requirementId));

    await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "Yes" });
    expect((await claims.confirmed(sid)).map((c) => c.id)).toContain(tailorClaimId(VALID_AD_ID, q.requirementId));
    expect((await claims.negatives(sid)).map((c) => c.id)).not.toContain(tailorClaimId(VALID_AD_ID, q.requirementId));
  });

  it("done flips true once nothing is left worth asking, and matchPct reaches 100", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "done-flips@example.com");
    let state = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(state.done).toBe(false);

    while (state.questions.length > 0) {
      const q = state.questions[0];
      state = (await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "Yes" })).json();
    }
    expect(state.done).toBe(true);
    expect(state.questions).toEqual([]);
    expect(state.card.matchPct).toBe(100);
  });

  it("factCount is session-wide, grows by one per new answer, and never decreases across a correction", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "fact-count@example.com");
    const s0 = (await get(app, cookie, "/onboarding/tailor")).json();
    const q = s0.questions[0];

    const afterYes = (await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "Yes" })).json();
    expect(afterYes.factCount).toBe(s0.factCount + 1);

    const afterNo = (await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "No" })).json();
    expect(afterNo.factCount).toBe(afterYes.factCount); // a correction flips in place, doesn't grow or shrink
  });

  // #106 code-review D1 (2026-08-03, round 3): buildTailorState's own factCount is a SEPARATE
  // emission point from /profile's — a decline used to inflate this one too, unfiltered.
  it("a declined eligibility question does not inflate tailor's factCount (D1)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "elig-decline-factcount@example.com");
    const before = (await get(app, cookie, "/onboarding/tailor")).json();

    const discovery = (await get(app, cookie, "/onboarding/discovery")).json();
    const workRights = discovery.questions.find(
      (q: { eligibility?: { dimension: string } }) => q.eligibility?.dimension === "work-rights",
    )!;
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: workRights.itemId, answer: DECLINE_OPTION });

    const after = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(after.factCount).toBe(before.factCount);
  });

  // #33 — a claim rejected in the S2 review deck really does lower the raw confirmed+negatives count,
  // but the badge's server-side floor must not let ANY of the five factCount-emitting routes show a
  // drop (AC4: the guarantee lives at the API seam, not the per-mount client clamp — so every seam
  // that emits factCount needs its own proof, not just the two GETs).
  it("factCount holds at its peak across all five emission seams, even after a deck reject (#33)", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "fact-floor@example.com");
    const sid = (await get(app, cookie, "/sessions/me")).json().id as string;

    // One genuinely new tailor answer, so peak (4) sits strictly above what the post-reject raw count
    // (3) will be — otherwise a dropped floor on the tailor seam would coincidentally still read 3 and
    // this test wouldn't catch it (raw alone would already equal a peak of "just the 3 discovery answers").
    const s0 = (await get(app, cookie, "/onboarding/tailor")).json();
    const q = s0.questions[0];
    const afterTailorAnswer = (
      await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "Yes" })
    ).json();
    const peak = afterTailorAnswer.factCount; // 3 discovery answers + this new tailor one

    // Reject one of the discovery claims in the deck — the raw count really does shrink. Assert the
    // reject actually landed on the store (not just a 200 — InMemoryClaimStore.reject is a silent
    // no-op on an unknown id), or a broken claim-id scheme would make this test pass for the wrong
    // reason — exactly the "floor keyed to the wrong thing silently stops firing" failure #31 warned about.
    const claimId = discoveryClaimId("budget-accountability");
    expect((await claims.confirmed(sid)).map((c) => c.id)).toContain(claimId); // present before...
    const rejectRes = await post(app, cookie, `/onboarding/claims/${claimId}/reject`);
    expect(rejectRes.statusCode).toBe(200);
    expect((await claims.confirmed(sid)).map((c) => c.id)).not.toContain(claimId); // ...gone after — raw is now 3

    // All five emission seams. The two POST /answer calls are legitimate idempotent corrections (#18
    // AC4 / #23's own "re-answering the same item CORRECTS it" contract) on items already answered
    // before the reject — same item, same answer, no new record — so they exercise the route's own
    // factCount computation without accidentally growing the raw count back up to peak on their own.
    const seams: [string, () => Promise<{ factCount: number }>][] = [
      ["GET /onboarding/tailor", () => get(app, cookie, "/onboarding/tailor").then((r) => r.json())],
      ["GET /onboarding/discovery", () => get(app, cookie, "/onboarding/discovery").then((r) => r.json())],
      [
        "POST /onboarding/discovery/start",
        () => post(app, cookie, "/onboarding/discovery/start", { role: ROLE }).then((r) => r.json()),
      ],
      [
        "POST /onboarding/discovery/answer",
        () =>
          post(app, cookie, "/onboarding/discovery/answer", {
            itemId: "cross-functional-leadership",
            answer: "Yes, multiple teams",
          }).then((r) => r.json()),
      ],
      [
        "POST /onboarding/tailor/answer",
        () =>
          post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "Yes" }).then(
            (r) => r.json(),
          ),
      ],
    ];
    const results: Record<string, number> = {};
    for (const [name, read] of seams) results[name] = (await read()).factCount;
    expect(results).toEqual(Object.fromEntries(seams.map(([name]) => [name, peak])));
  });
});

// Review fix B1 (spec MUST-FIX): a recorded "no" must close the ? on the card too, not just the
// question — spec #37/#38, "the open list only ever shrinks". Pre-fix, dontYet/openCount were derived
// from uncoveredRequirements alone, which has no notion of a negative, so a "no" left the requirement
// in dontYet forever and the ledger's "still open" count never fell.
describe("#23 B1 — a 'no' closes the gap, not just the question", () => {
  it("answering every requirement 'No' empties dontYet, and the ledger's open count agrees (0) at the end", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "b1-all-no@example.com");
    let state = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(state.card.dontYet.length).toBeGreaterThan(0); // sanity: there's something to close
    const totalToAnswer = state.questions.length; // every "no" here, answered in rank order (below)

    while (state.questions.length > 0) {
      const q = state.questions[0];
      state = (await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "No" })).json();
    }

    expect(state.done).toBe(true);
    // Pre-fix this stayed non-empty: dontYet was uncoveredRequirements(confirmed, adReq) with no
    // subtraction for negatives, so every "no"-answered requirement stayed a grey "?" forever.
    expect(state.card.dontYet).toEqual([]);
    // #28: each line is stamped with the count open right after IT landed, not the final (0) count —
    // answered here in rank order (questions[0] each time), so the count steps down by exactly one
    // per line, only reaching 0 on the LAST one. Pre-fix every line read the ad's final uncovered
    // count regardless of when it actually closed — so ALL of them read "0 still open" here.
    const stillOpenLines = state.ledger.filter((l: { text: string }) => l.text.includes("still open"));
    expect(stillOpenLines.map((l: { text: string }) => l.text)).toEqual(
      Array.from({ length: totalToAnswer }, (_, i) => `asked and closed · ${totalToAnswer - i - 1} still open`),
    );
  });
});

// #28 AC2, at the HTTP seam (prior art: #31's "the layer the visitor actually reads" framing above):
// buildTailorState calls buildTailorLedger fresh on every request — nothing is stored. Reload-stable
// means a line, once landed, reads the same on every later GET, including after MORE "no"s answer and
// even after a plain re-read with no new answer in between (a straight rebuild-vs-rebuild check).
describe("#28 GET /onboarding/tailor — a landed ledger line survives later answers and a reload", () => {
  it("the first-answered line's text is unchanged after more 'no's land, and a reload repeats it byte-for-byte", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "historical-ledger@example.com");
    let state = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(state.questions.length).toBeGreaterThan(1); // sanity: more than one "no" is coming below

    const firstReq = state.questions[0].requirementId;
    state = (
      await post(app, cookie, "/onboarding/tailor/answer", { requirementId: firstReq, answer: "No" })
    ).json();
    const firstLineAtLanding = state.ledger.find((l: { requirementId: string }) => l.requirementId === firstReq)!.text;

    // More "no"s land after it — pre-fix, buildTailorLedger re-stamps EVERY historical line with
    // today's (now lower) open count on every rebuild, so firstReq's line would drift downward too.
    while (state.questions.length > 0) {
      const q = state.questions[0];
      state = (
        await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "No" })
      ).json();
    }

    const read1 = (await get(app, cookie, "/onboarding/tailor")).json();
    const read2 = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(read2.ledger).toEqual(read1.ledger); // AC2: a reload rebuilds the same ledger, unchanged

    const firstLineNow = read1.ledger.find((l: { requirementId: string }) => l.requirementId === firstReq)!.text;
    expect(firstLineNow).toBe(firstLineAtLanding); // AC1: not rewritten to the current, lower count
  });
});

describe("#37 GET /onboarding/tailor - later deck decisions do not rewrite earlier Tailor ledger lines", () => {
  it("keeps earlier Tailor open counts byte-stable after drop -> deck confirm -> re-swipe", async () => {
    const server = buildServer();
    const { app } = server;
    const cookie = await anonSession(app);
    await reachTailorWithSeededDeck(server, cookie, "deck-confirm-after-tailor@example.com");
    let state = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(state.questions.length).toBeGreaterThan(2); // two Tailor answers, then one later deck confirm

    const answeredReqIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const q = state.questions[0];
      answeredReqIds.push(q.requirementId);
      state = (await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "No" })).json();
    }
    const linesAtLanding = Object.fromEntries(
      answeredReqIds.map((id) => [
        id,
        state.ledger.find((l: { requirementId: string }) => l.requirementId === id)!.text,
      ]),
    );
    const laterDeckReqId = state.questions[0].requirementId as string;

    await post(app, cookie, "/onboarding/tailor/drop");
    const confirm = await post(app, cookie, `/onboarding/claims/mined-${laterDeckReqId}/confirm`);
    expect(confirm.statusCode).toBe(200);
    await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`);

    const rebuilt = (await get(app, cookie, "/onboarding/tailor")).json();
    const linesAfterDeckConfirm = Object.fromEntries(
      answeredReqIds.map((id) => [
        id,
        rebuilt.ledger.find((l: { requirementId: string }) => l.requirementId === id)!.text,
      ]),
    );
    expect(linesAfterDeckConfirm).toEqual(linesAtLanding);
    expect(rebuilt.questions.map((q: { requirementId: string }) => q.requirementId)).not.toContain(laterDeckReqId);
  });

  // AC1 names "confirm/edit" — the test above covers confirm; this covers the edit branch at the same
  // API seam. A deck edit (PUT /onboarding/claims/:id) on a pending mined claim auto-confirms it and
  // must stamp decisionSeq at edit-time, so a later edit landing after Tailor answers replays after
  // them and leaves earlier lines' open counts byte-stable.
  it("keeps earlier Tailor open counts byte-stable after drop -> deck edit -> re-swipe (AC1 'edit')", async () => {
    const server = buildServer();
    const { app } = server;
    const cookie = await anonSession(app);
    await reachTailorWithSeededDeck(server, cookie, "deck-edit-after-tailor@example.com");
    let state = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(state.questions.length).toBeGreaterThan(2); // two Tailor answers, then one later deck edit

    const answeredReqIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const q = state.questions[0];
      answeredReqIds.push(q.requirementId);
      state = (await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "No" })).json();
    }
    const linesAtLanding = Object.fromEntries(
      answeredReqIds.map((id) => [
        id,
        state.ledger.find((l: { requirementId: string }) => l.requirementId === id)!.text,
      ]),
    );
    const laterDeckReqId = state.questions[0].requirementId as string;
    const laterReq = loadAdRequirements(VALID_AD_ID).requirements.find((r) => r.id === laterDeckReqId)!;

    await post(app, cookie, "/onboarding/tailor/drop");
    // Edit the pending mined claim for the still-open requirement, with text that covers it (the
    // requirement's own words — same text the seeded mined claim carries, so token-overlap fires).
    const edit = await put(app, cookie, `/onboarding/claims/mined-${laterDeckReqId}`, {
      text: `${laterReq.requirement}.`,
    });
    expect(edit.statusCode).toBe(200);
    await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`);

    const rebuilt = (await get(app, cookie, "/onboarding/tailor")).json();
    const linesAfterDeckEdit = Object.fromEntries(
      answeredReqIds.map((id) => [
        id,
        rebuilt.ledger.find((l: { requirementId: string }) => l.requirementId === id)!.text,
      ]),
    );
    expect(linesAfterDeckEdit).toEqual(linesAtLanding);
    expect(rebuilt.questions.map((q: { requirementId: string }) => q.requirementId)).not.toContain(laterDeckReqId);
  });
});

// Review fix D1 (BLOCKS THE COMMIT — spec AC2, "answering a gap … rewrites the bubble's gap clause"):
// Pre-fix, buildTailorState patched matchPct and dontYet for negatives but passed card.bubble straight
// through from buildJobCard, whose pickOpenClause uses raw uncoveredRequirements — negative-blind by
// design (B1). So the bubble kept naming a requirement the visitor had just declined, permanently.
describe("#23 D1 — the bubble's gap clause rewrites after a 'No' (AC2)", () => {
  it("answering 'No' to the requirement the bubble names stops the bubble naming it", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "d1-bubble@example.com");
    const before = (await get(app, cookie, "/onboarding/tailor")).json();
    const namedRequirement = before.card.bubble.open;
    // The bubble names dontYet's own top entry — find its requirementId so we answer "No" to exactly
    // the requirement currently headlined, not just any open one.
    const target = before.card.dontYet.find((r: { requirement: string }) => r.requirement === namedRequirement);
    expect(target).toBeTruthy(); // sanity: the bubble is naming a real, currently-open requirement

    const after = (
      await post(app, cookie, "/onboarding/tailor/answer", { requirementId: target.id, answer: "No" })
    ).json();

    // Pre-fix: card.bubble.open passed straight through from buildJobCard/pickOpenClause — negative-
    // blind, so it named this exact (now-declined) requirement forever.
    expect(after.card.bubble.open).not.toBe(namedRequirement);
  });

  it("answering 'No' to everything rewrites the bubble to the nothing-open fallback", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "d1-bubble-all-no@example.com");
    let state = (await get(app, cookie, "/onboarding/tailor")).json();

    while (state.questions.length > 0) {
      const q = state.questions[0];
      state = (
        await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "No" })
      ).json();
    }

    expect(state.card.dontYet).toEqual([]);
    // Pre-fix: bubble.open kept naming whatever uncoveredRequirements' first (raw, negative-blind)
    // entry was — a requirement already answered "no" — instead of falling back once nothing is open.
    expect(state.card.bubble.open).toBe("You're covering everything we can see so far.");
  });
});

// Review fix B2 (spec MUST-FIX): a tailor answer must reach "the CV below" (ticket #23's own framing),
// not just the score. Pre-fix, cvLines came from discoveryState(...).cvLines, which only ever considers
// `discovery-`-prefixed claims — a `tailor-<adId>-<reqId>` claim was filtered out before that loop ran,
// so answering every Tailor question "Yes" moved the ring to 100% but "I'm done — use this CV" hit
// return exactly the CV discovery alone had already produced.
describe("#23 B2 — tailor answers reach the CV", () => {
  it("a tailor 'Yes' answer produces a cvLine keyed to that answer's claim id", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "b2-cv-line@example.com");
    const before = (await get(app, cookie, "/onboarding/tailor")).json();
    const q = before.questions[0];
    const beforeLineCount = before.cvLines.length;

    const after = (
      await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "Yes" })
    ).json();

    expect(after.cvLines.length).toBeGreaterThan(beforeLineCount); // pre-fix: unchanged
    const tailorClaim = tailorClaimId(VALID_AD_ID, q.requirementId);
    expect(after.cvLines.some((l: { itemId: string }) => l.itemId === tailorClaim)).toBe(true); // pre-fix: false
  });

  it("free text also lands in cvLines, in the visitor's own words", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "b2-free-text@example.com");
    const before = (await get(app, cookie, "/onboarding/tailor")).json();
    const q = before.questions[0];

    const after = (
      await post(app, cookie, "/onboarding/tailor/answer", {
        requirementId: q.requirementId,
        answer: "I ran exactly this on my last two contracts",
      })
    ).json();

    const line = after.cvLines.find((l: { itemId: string }) => l.itemId === tailorClaimId(VALID_AD_ID, q.requirementId));
    expect(line?.text).toBe("I ran exactly this on my last two contracts.");
  });
});

// Review fix B3 (standards MUST-FIX): session.tailorAdId is persisted state that can outlive the
// fixture pair that validated it at /want time. Simulate that drift directly via the session store
// (bypassing /want's own validation) rather than editing the fixture files — same observable effect.
describe("#23 B3 — a stale/invalid tailor target fails closed with a 404, not a crash", () => {
  it("GET and POST /tailor/answer both 404 (not 500) when tailorAdId no longer resolves", async () => {
    const { app, sessions } = buildServer();
    const cookie = await anonSession(app);
    await signIn(app, cookie, "b3-stale-target@example.com");
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    await sessions.setTailorTarget(sid, "not-a-real-ad-id"); // the fixture pair has since drifted

    const getRes = await get(app, cookie, "/onboarding/tailor");
    expect(getRes.statusCode).toBe(404);
    expect(getRes.json()).toEqual({ error: { code: "not_found", message: "unknown card" } });

    const postRes = await post(app, cookie, "/onboarding/tailor/answer", { requirementId: "x", answer: "Yes" });
    expect(postRes.statusCode).toBe(404);
    expect(postRes.json()).toEqual({ error: { code: "not_found", message: "unknown card" } });
  });
});

describe("#23 POST /onboarding/tailor/drop", () => {
  it("clears the tailor target and returns to deck WITHOUT losing recorded answers", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "drop-keeps-claims@example.com");
    const s0 = (await get(app, cookie, "/onboarding/tailor")).json();
    const q = s0.questions[0];
    await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "Yes" });

    const res = await post(app, cookie, "/onboarding/tailor/drop");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ stage: "deck" });

    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    expect(me.json().stage).toBe("deck");
    expect(me.json().tailorAdId).toBeNull();

    // The tailor target is gone — the 409 re-triggers.
    expect((await get(app, cookie, "/onboarding/tailor")).statusCode).toBe(409);

    // But the claim from the tailor answer is still there — "everything you told me stays on your profile."
    const sid = me.json().id as string;
    const confirmedIds = (await claims.confirmed(sid)).map((c) => c.id);
    expect(confirmedIds).toContain(tailorClaimId(VALID_AD_ID, q.requirementId));
  });

  it("works even with nothing currently targeted (idempotent no-op landing on deck)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await signIn(app, cookie, "drop-noop@example.com");
    const res = await post(app, cookie, "/onboarding/tailor/drop");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ stage: "deck" });
  });
});

// #31 AC1 at the layer the visitor actually reads — card.matchPct over HTTP, not the stored floor
// (pgstores.test.ts pins the column on both drivers; this pins that it reaches the screen).
// The correction is the discriminator: re-answering the SAME requirement "No" flips its claim
// negative, so the raw tick falls and only a surviving floor can hold the number. Pre-#31 this exact
// journey read 19% → 0%; the plain drop → re-swipe → GET alone would pass either way, because the
// tick is recomputed from claims the drop never touched.
describe("#31 the visible % survives drop + re-swipe of the same job", () => {
  it("holds the earned % through drop → re-swipe → a correction that lowers the raw tick", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "floor-survives-drop@example.com");
    const s0 = (await get(app, cookie, "/onboarding/tailor")).json();
    const q = s0.questions[0];

    const earned = (
      await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "Yes" })
    ).json().card.matchPct;
    expect(earned).toBeGreaterThan(s0.card.matchPct); // the % was really earned

    await post(app, cookie, "/onboarding/tailor/drop");
    await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`); // swipe right on the same card again
    const resumed = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(resumed.card.matchPct).toBeGreaterThanOrEqual(earned);

    const corrected = (
      await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "No" })
    ).json();
    expect(corrected.card.matchPct).toBeGreaterThanOrEqual(earned);
  });

  it("a DIFFERENT job after a drop is scored on its own merits — no floor carried over", async () => {
    const { app, sessions } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "other-job-no-floor@example.com");
    const q = (await get(app, cookie, "/onboarding/tailor")).json().questions[0];
    await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "Yes" });
    await post(app, cookie, "/onboarding/tailor/drop");

    const other = (await get(app, cookie, "/onboarding/cards")).json().cards.find(
      (c: { adId: string }) => c.adId !== VALID_AD_ID,
    );
    await post(app, cookie, `/onboarding/cards/${other.adId}/want`);
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    expect((await sessions.getById(me.json().id as string))?.tailorFloorPct).toBe(0);
    expect((await get(app, cookie, "/onboarding/tailor")).json().card.matchPct).toBe(other.matchPct);
  });
});
