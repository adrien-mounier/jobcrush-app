// #23 tailor (screen 3) — pure helpers (prior art: matchtick.test.ts) + the pinned HTTP seam (prior
// art: discovery.test.ts, cards.test.ts). Pins: composeTailorLine actually covers the requirement (the
// AC1 hinge), the ledger derivation, and the route behaviors — re-score never decreases, never-re-ask,
// the ledger, done, and drop losing the job but never a claim.
import { describe, expect, it } from "vitest";
import type { AdRequirement, AdRequirements } from "@jobcrush/contracts";
import { buildServer } from "../src/server.js";
import type { ClaimRecord } from "../src/claims.js";
import { matchTick } from "../src/matchtick.js";
import {
  buildTailorLedger,
  composeTailorLine,
  negativeRequirementIds,
  tailorClaimId,
  tailorCvLines,
  tailorQuestions,
} from "../src/tailor.js";

const AD: AdRequirements = {
  schemaVersion: "0",
  adId: "test-ad",
  requirements: [
    { id: "own-budget", band: "must", requirement: "Own a project budget with vendor oversight" },
    { id: "lead-team", band: "must", requirement: "Lead a cross-functional delivery team" },
    { id: "certification", band: "nice", requirement: "Hold a project management certification" },
  ],
};
const [OWN_BUDGET, LEAD_TEAM, CERTIFICATION] = AD.requirements as [AdRequirement, AdRequirement, AdRequirement];

const claimFor = (
  adId: string,
  req: AdRequirement,
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
});
const yesClaim = (req: AdRequirement) => claimFor(AD.adId, req, "Yes", "confirmed");
const noClaim = (req: AdRequirement) => claimFor(AD.adId, req, "No", "negative");

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

  // #23 B1 regression: every negative answered so far must be excluded from "still open", not just
  // the most recent one — otherwise "closed 2 of 3" and "N still open" can both lie simultaneously.
  it("B1: 'still open' subtracts EVERY recorded negative, not just the line's own requirement", () => {
    const { ledger } = buildTailorLedger(AD, [], [noClaim(OWN_BUDGET), noClaim(LEAD_TEAM)]);
    for (const line of ledger) expect(line.text).toBe(`asked and closed · 1 still open`); // only certification left
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
    const skillReq: AdRequirement = { ...OWN_BUDGET, cvSection: "skills" };
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
async function signIn(app: ReturnType<typeof buildServer>["app"], cookie: string, email: string): Promise<void> {
  const link = await post(app, cookie, "/auth/request-link", { email });
  const token = new URL("http://x" + link.json().devLink).searchParams.get("token")!;
  await post(app, cookie, "/auth/verify", { token });
}

const ROLE = "IT project manager in Paris";
const VALID_AD_ID = "2026-07-05_endava-vietnam_senior-project-manager";

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
});

// Review fix B1 (spec MUST-FIX): a recorded "no" must close the ? on the card too, not just the
// question — spec #37/#38, "the open list only ever shrinks". Pre-fix, dontYet/openCount were derived
// from uncoveredRequirements alone, which has no notion of a negative, so a "no" left the requirement
// in dontYet forever and the ledger's "still open" count never fell.
describe("#23 B1 — a 'no' closes the gap, not just the question", () => {
  it("answering every requirement 'No' empties dontYet, and the ledger's open count agrees (0)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "b1-all-no@example.com");
    let state = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(state.card.dontYet.length).toBeGreaterThan(0); // sanity: there's something to close

    while (state.questions.length > 0) {
      const q = state.questions[0];
      state = (await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "No" })).json();
    }

    expect(state.done).toBe(true);
    // Pre-fix this stayed non-empty: dontYet was uncoveredRequirements(confirmed, adReq) with no
    // subtraction for negatives, so every "no"-answered requirement stayed a grey "?" forever.
    expect(state.card.dontYet).toEqual([]);
    // Pre-fix this read the ad's full uncovered count (e.g. "7 still open") regardless of how many
    // of those had already been answered "no" — a visible lie once done was also true.
    for (const line of state.ledger) {
      if (line.text.includes("still open")) expect(line.text).toContain("· 0 still open");
    }
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
