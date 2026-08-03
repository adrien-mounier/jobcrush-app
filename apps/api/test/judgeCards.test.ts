// #105 (E5 slice 4) — meaning-aware judging driven through the real HTTP boundary (spec #86's
// primary seam), same shape as cards.test.ts's #104 section: fakes injected at OnboardingDeps.judge
// (and, where a card needs one, .readAd), never a live call. Proves the plumbing end to end — a
// judgement drives the card's number, an explicit negative stays answered-and-closed, and a judging
// failure falls back to the deterministic tick rather than dropping the card or fabricating a number.
//
// #105 review round 3: the five-row test below is a PLUMBING test, full stop — it does NOT and
// CANNOT prove judgement correctness, because the verdict it asserts on is the exact same value it
// scripts the fake judge to return (`expectedFit` is derived straight from `row.expected`). It proves
// only that a scripted verdict turns into the right card shape (matchPct/breakdown/dontYet) — it
// cannot fail no matter how good or bad a real model's judgement is, and it never calls a model at
// all. It uses CANONICAL_REGRESSION_ROWS deliberately (fixed, not swapped for the hold-out set): those
// rows are ALSO worked examples inside card-judge.md, which is irrelevant here (no model runs) but
// would matter if this file ever tried to certify real judgement — it must not, judge.live.test.ts
// owns that, against HOLD_OUT_REGRESSION_ROWS.
import { describe, expect, it } from "vitest";
import type { AdRequirementsV1 } from "@jobcrush/contracts";
import { buildServer } from "../src/server.js";
import { loadPostings, type Posting } from "../src/preview.js";
import { loadAdRequirements } from "../src/e5stub.js";
import { READER_ROLE_ITEM_ID, discoveryClaimId, freeTextLine } from "../src/discovery.js";
import { makeJudge, makeJudgePeek, judgementFingerprint, judgeVersion, type JudgeFn } from "../src/judge.js";
import { InMemoryJudgementStore } from "../src/judgementStore.js";
import { readCounters } from "../src/counters.js";
import type { LlmClient } from "../src/llm.js";
import { CANONICAL_REGRESSION_ROWS } from "./fixtures/judge-regression-rows.js";
import { DECK_JUDGE_MAX_CARDS } from "../src/routes/onboarding.js";

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

interface JobCard {
  adId: string;
  scored: "judged" | "pending" | "unscored" | "estimated";
  matchPct: number | null;
  dontYet: Array<{ id: string; band: string; requirement: string }>;
  askedClosed: Array<{ id: string; text: string }>;
}

const ROLE = "IT project manager in Paris";

const uncachedEnglishPostings = () =>
  loadPostings()
    .filter((p) => p.language === "en")
    .filter((p) => {
      try {
        loadAdRequirements(p.id);
        return false;
      } catch {
        return true;
      }
    });

const stubRequirements = (adId: string): AdRequirementsV1 => ({
  schemaVersion: "1",
  adId,
  curated: false,
  language: "en",
  familyFit: { family: "IT Project Manager", confidence: 0.6 },
  requirements: [
    { id: "own-a-budget", band: "essential", kind: "ordinary", requirement: "Own a project budget", sourceSpan: "budget" },
  ],
});

// #117: driven through TAILOR, not the deck. Tailor judges one card on demand with a full budget,
// unbounded by DECK_JUDGE_MAX_CARDS — exactly what this PLUMBING test needs, since several of these
// rows are evidence phrased in the candidate's own words (the whole point of #86/#105) and would
// score LOW on the deck's cheap matchTick pre-filter, risking exclusion from the bound's judging
// slots for a reason that has nothing to do with what this test proves (a scripted verdict's SHAPE,
// not its rank in a pool of curated fixtures). buildJobCard's card-assembly logic is identical either
// way — tailor and the deck share it.
describe("#105 PLUMBING ONLY (not judgement correctness): a scripted verdict for each regression-row class surfaces as the right card shape", () => {
  for (const row of CANONICAL_REGRESSION_ROWS) {
    it(`${row.id}: ${row.label}`, async () => {
      const targetPosting = uncachedEnglishPostings()[0]!;
      const rowAd: AdRequirementsV1 = {
        schemaVersion: "1",
        adId: targetPosting.id,
        curated: false,
        language: "en",
        familyFit: { family: "IT Project Manager", confidence: 0.8 },
        requirements: [
          { id: "the-req", band: "essential", kind: "ordinary", requirement: row.requirement, sourceSpan: row.requirement },
        ],
      };
      const expectedFit = row.expected === "covered" ? 1 : row.expected === "not-covered" ? 0 : 0.5;
      const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
        posting.id === targetPosting.id ? rowAd : null;
      const judge: JudgeFn = async (adReq, confirmed) => {
        if (adReq.adId !== targetPosting.id) return null;
        return {
          verdicts: [{ requirementId: "the-req", fit: expectedFit, supportingFactId: confirmed[0]?.id ?? null, reason: row.note }],
          version: "test",
          cost: { model: "fake-judge", inputTokens: 10, outputTokens: 10, judgedAt: new Date().toISOString() },
        };
      };
      const { app } = buildServer({ readAd, judge });
      const cookie = await anonSession(app);
      await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: READER_ROLE_ITEM_ID, answer: row.evidence });
      await signIn(app, cookie, `${row.id}@example.com`); // want/tailor are post-wall

      expect((await post(app, cookie, `/onboarding/cards/${targetPosting.id}/want`)).statusCode).toBe(200);
      const res = await get(app, cookie, "/onboarding/tailor");
      expect(res.statusCode).toBe(200);
      const card = (res.json() as { card: JobCard }).card;
      expect(card.adId).toBe(targetPosting.id);
      expect(card.scored).toBe("judged");

      if (row.expected === "covered") {
        expect(card.matchPct).toBe(100);
        expect(card.dontYet.map((r) => r.id)).not.toContain("the-req");
      } else if (row.expected === "not-covered") {
        expect(card.matchPct).toBe(0);
        expect(card.dontYet.map((r) => r.id)).toContain("the-req");
      } else {
        // partial: real credit, but never treated as fully satisfied
        expect(card.matchPct).toBeGreaterThan(0);
        expect(card.matchPct).toBeLessThan(100);
        expect(card.dontYet.map((r) => r.id)).toContain("the-req");
      }
    });
  }
});

// #105 review round 3: "the number never moves" holds for a STORED judgement — once a card has been
// judged and persisted, re-requesting it is a pure cache read. It does NOT hold for a card's very
// first (never-yet-judged) view: that request still makes a live judging call, and if THAT call times
// out or fails, resolveJudgement falls back to the deterministic tick (#105 decision 6, deliberate —
// dropping the card or hanging the deck is worse) — a later retry that succeeds can then show a
// different number. Both tests below start from an ALREADY-STORED judgement, which is the case this
// property actually covers.
describe("#105 a STORED judgement spends no second judging call, and its number never moves", () => {
  it("a second deck request with the same session's facts makes no additional judging call", async () => {
    const store = new InMemoryJudgementStore();
    const calls: string[] = [];
    // A generic responder — the deck fan-out judges EVERY resolvable card (hand-fixtured ads
    // included, each with its own real, differently-shaped requirement set), not just the single
    // stub shape below, so the fake must answer whatever ids buildJudgeInput actually asked about
    // rather than a hardcoded one — otherwise an unrelated fixture ad's judgement would fail
    // validation, and failed judgements are deliberately never cached (same as adReader.ts), which
    // would make every request re-attempt them and defeat the very thing this test is proving.
    const llm: LlmClient = {
      model: "claude-sonnet-5",
      async complete(prompt: string) {
        calls.push(prompt);
        const [requirementsBlock] = prompt.split("===CANDIDATE FACTS===");
        const ids = [...requirementsBlock!.matchAll(/^- id: (\S+)/gm)].map((m) => m[1]!);
        return JSON.stringify({
          verdicts: ids.map((id) => ({ requirementId: id, fit: 0.5, supportingFactId: null, reason: "partial" })),
        });
      },
    };
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> => stubRequirements(posting.id);
    const { app } = buildServer({ readAd, judge: makeJudge(llm, store) });
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: READER_ROLE_ITEM_ID,
      answer: "Managed multiple software delivery programs end to end.",
    });

    const first = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    const firstCallCount = calls.length;
    expect(firstCallCount).toBeGreaterThan(0); // sanity: judging really happened

    const second = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    expect(calls.length).toBe(firstCallCount); // no additional judging call

    // Structurally impossible to have moved: same verdicts read back from the store, not re-derived.
    const byId1 = Object.fromEntries(first.cards.map((c) => [c.adId, c.matchPct]));
    const byId2 = Object.fromEntries(second.cards.map((c) => [c.adId, c.matchPct]));
    expect(byId2).toEqual(byId1);
  });

  it("cost is recorded per judged card, keyed by the exact fact set that produced it", async () => {
    const store = new InMemoryJudgementStore();
    const llm: LlmClient = {
      model: "claude-sonnet-5",
      async complete() {
        return JSON.stringify({ verdicts: [{ requirementId: "own-a-budget", fit: 0.5, supportingFactId: null, reason: "partial" }] });
      },
      async completeWithUsage(prompt: string) {
        const text = await llm.complete(prompt);
        return { text, usage: { inputTokens: 500, outputTokens: 75 } };
      },
    };
    const targetPosting = uncachedEnglishPostings()[0]!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === targetPosting.id ? stubRequirements(targetPosting.id) : null;
    const { app } = buildServer({ readAd, judge: makeJudge(llm, store) });
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    // #117: strongly matches stubRequirements' own "Own a project budget" requirement (near-perfect
    // token overlap) so targetPosting's cheap matchTick pre-filter score reliably beats the 8
    // hand-curated fixtures also in the pool, guaranteeing it lands inside DECK_JUDGE_MAX_CARDS's
    // bound and actually gets judged — this test is about cost recording, not about the bound.
    const evidence = "Owned a project budget of $2M with vendor oversight.";
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: READER_ROLE_ITEM_ID, answer: evidence });
    await get(app, cookie, "/onboarding/cards");

    const fp = judgementFingerprint(stubRequirements(targetPosting.id), [
      { id: discoveryClaimId(READER_ROLE_ITEM_ID), text: freeTextLine(evidence) },
    ]);
    const stored = await store.get(targetPosting.id, fp);
    expect(stored?.cost).toEqual({
      model: "claude-sonnet-5",
      inputTokens: 500,
      outputTokens: 75,
      judgedAt: expect.any(String),
    });
  });
});

// #105 review finding 2: negatives used to be part of the judgement cache key even though they were
// never sent to the model — tapping "No" changed the key, missed the cache, and bought a fresh paid
// call whose answer could differ from the stored one by pure run-to-run variance, surfacing as an
// unexplained score movement. Two hard constraints, proven together here: an identical model input
// (the confirmed set didn't change) must never buy a second call, and a "No" must never move the
// number.
describe("#105 review: a negative answer must never move the number or force a re-judge", () => {
  it("tapping 'No' on a tailor question makes no additional judging call and does not change the card's matchPct", async () => {
    const store = new InMemoryJudgementStore();
    const calls: string[] = [];
    const llm: LlmClient = {
      model: "claude-sonnet-5",
      async complete(prompt: string) {
        calls.push(prompt);
        const [requirementsBlock] = prompt.split("===CANDIDATE FACTS===");
        const ids = [...requirementsBlock!.matchAll(/^- id: (\S+)/gm)].map((m) => m[1]!);
        return JSON.stringify({
          verdicts: ids.map((id) => ({ requirementId: id, fit: 0.5, supportingFactId: null, reason: "partial" })),
        });
      },
    };
    const targetPosting = uncachedEnglishPostings()[0]!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> => stubRequirements(posting.id);
    const { app } = buildServer({ readAd, judge: makeJudge(llm, store) });
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    // #117: strongly matches "Own a project budget" so targetPosting reliably lands inside
    // DECK_JUDGE_MAX_CARDS's bound on the FIRST deck view below — this test is about a "No" answer
    // never buying a second call, which requires the FIRST view to have already judged the target
    // (otherwise the later tailor answer's own judging call would be the target's first-ever one, not
    // an "additional" one, and callsAfterFirstDeck would no longer be the right baseline).
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: READER_ROLE_ITEM_ID,
      answer: "Owned a project budget of $2M with vendor oversight.",
    });
    await signIn(app, cookie, "no-answer-no-rejudge@example.com"); // want/tailor are post-wall

    const before = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    const targetBefore = before.cards.find((c) => c.adId === targetPosting.id)!;
    const callsAfterFirstDeck = calls.length;
    expect(callsAfterFirstDeck).toBeGreaterThan(0); // sanity: judging really happened

    await post(app, cookie, `/onboarding/cards/${targetPosting.id}/want`);
    // stubRequirements' one requirement id — still open (the generic responder above scores every
    // requirement 0.5, below COVERAGE_THRESHOLD), so this is a real question with a real "No".
    const answered = await post(app, cookie, "/onboarding/tailor/answer", { requirementId: "own-a-budget", answer: "No" });
    expect(answered.statusCode).toBe(200);

    const after = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    const targetAfter = after.cards.find((c) => c.adId === targetPosting.id)!;

    expect(calls.length).toBe(callsAfterFirstDeck); // no additional call anywhere — confirmed facts didn't change
    expect(targetAfter.matchPct).toBe(targetBefore.matchPct); // a "No" must never move the number
  });
});

describe("#105 an explicit negative stays answered-and-closed when a judge is wired", () => {
  it("a tailor 'No' never resurfaces as an open gap, even though the judge never saw it as covered", async () => {
    const targetPosting = uncachedEnglishPostings()[0]!;
    const singleReqAd: AdRequirementsV1 = {
      schemaVersion: "1",
      adId: targetPosting.id,
      curated: false,
      language: "en",
      familyFit: { family: "IT Project Manager", confidence: 0.6 },
      requirements: [
        { id: "the-req", band: "essential", kind: "ordinary", requirement: "Fluent in Mandarin", sourceSpan: "Mandarin" },
      ],
    };
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === targetPosting.id ? singleReqAd : null;
    const judge: JudgeFn = async (adReq) =>
      adReq.adId === targetPosting.id
        ? {
            verdicts: [{ requirementId: "the-req", fit: 0, supportingFactId: null, reason: "no evidence" }],
            version: "test",
            cost: { model: "fake-judge", inputTokens: 5, outputTokens: 5, judgedAt: new Date().toISOString() },
          }
        : null;
    const { app } = buildServer({ readAd, judge });
    const cookie = await anonSession(app);
    await signIn(app, cookie, "neg-judge-105@example.com"); // want/tailor are post-wall

    expect((await post(app, cookie, `/onboarding/cards/${targetPosting.id}/want`)).statusCode).toBe(200);
    const answered = await post(app, cookie, "/onboarding/tailor/answer", { requirementId: "the-req", answer: "No" });
    expect(answered.statusCode).toBe(200);

    const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    const card = body.cards.find((c) => c.adId === targetPosting.id)!;
    expect(card.dontYet.map((r) => r.id)).not.toContain("the-req"); // never an open gap
    expect(card.askedClosed.some((f) => f.id.endsWith("-the-req"))).toBe(true); // answered-and-closed
  });
});

describe("#105/#117 a judging failure never fabricates a number — the card survives as pending, and the fallback is counted", () => {
  it("the card survives with NO number claimed (pending), never the deterministic tick's number mislabelled as judged, and the fallback is counted", async () => {
    const targetPosting = uncachedEnglishPostings()[0]!;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === targetPosting.id ? stubRequirements(targetPosting.id) : null;
    const judge: JudgeFn = async (adReq) => {
      if (adReq.adId === targetPosting.id) throw new Error("boom — judge is down");
      return null;
    };
    const before = readCounters()["judge.fallback_used"];
    const { app } = buildServer({ readAd, judge });
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    // #117: strongly matches stubRequirements' own requirement so targetPosting reliably lands
    // inside the bound — this test is about a judging FAILURE, not about the bound excluding it.
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: READER_ROLE_ITEM_ID,
      answer: "Owned a project budget of $2M with vendor oversight.",
    });

    const res = await get(app, cookie, "/onboarding/cards");
    expect(res.statusCode).toBe(200); // no 500 — the card survives
    const body = res.json() as { cards: JobCard[] };
    const card = body.cards.find((c) => c.adId === targetPosting.id);
    expect(card).toBeDefined(); // never dropped over a judging failure
    // #117 AC5: a judge IS wired, so a failed judgement must claim NO number at all — never the
    // deterministic tick's number presented as though it were judged.
    expect(card!.scored).toBe("pending");
    expect(card!.matchPct).toBeNull();
    expect(card!.dontYet).toEqual([]);

    expect(readCounters()["judge.fallback_used"]).toBeGreaterThan(before); // the fallback rate is observable
  });
});

// #105 review round 4, MUST-FIX 1 — QA measured three consecutive deck attempts fail at HTTP 500,
// exactly 30.0s, on a cold judgement cache: CARD_RESOLUTION_CONCURRENCY created waves, and each wave
// used to get its own fresh READ_TIMEOUT_MS (15s) judging allowance, so N waves stacked to N × 15s —
// 45s for the real fixture pool's 3 waves, comfortably over the web proxy's 30s deadline. Proven here
// with EVERY posting's judge call hanging forever: the deck must still respond well inside the shared
// DECK_JUDGE_BUDGET_MS budget, not wait out however many waves the pool happens to produce.
//
// REAL wall-clock time, deliberately, not fake timers: DECK_JUDGE_BUDGET_MS's whole point is a
// Date.now()-based shrinking deadline shared across waves — faithfully simulating that needs Date
// itself advanced in lockstep with the fake timer clock, and faking Date globally destabilizes
// unrelated request machinery (session/cookie timestamp logic) that has nothing to do with judging.
// 8s is short enough to actually wait for in one dedicated test (bumped per-test timeout below); the
// property this test exists to prove — total time bounded, NOT wave-count × 15s — is exactly what a
// real clock demonstrates most directly anyway.
describe("#105 review round 4: the deck has ONE shared judging budget, not per-wave timeouts", () => {
  it(
    "every card falls back to pending and the deck still responds within the shared budget, even with every judge call hanging forever",
    async () => {
      const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> => stubRequirements(posting.id);
      const hungForever: JudgeFn = () => new Promise(() => {}); // never resolves or rejects, for every ad
      const before = readCounters()["judge.fallback_used"];
      const { app } = buildServer({ readAd, judge: hungForever });
      const cookie = await anonSession(app);
      await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
      await post(app, cookie, "/onboarding/discovery/answer", {
        itemId: READER_ROLE_ITEM_ID,
        answer: "Owned a project budget of $2M.",
      });

      const startedAt = Date.now();
      const res = await get(app, cookie, "/onboarding/cards");
      const elapsedMs = Date.now() - startedAt;

      expect(res.statusCode).toBe(200); // no 500, and no hang — the deck still rendered
      // The real DECK_JUDGE_BUDGET_MS is 8s. With the pre-fix per-wave READ_TIMEOUT_MS (15s), this
      // fixture pool's concurrency-cap waves would cost 30s+ — the exact regression QA measured.
      // 12s leaves real headroom for test/event-loop overhead while still failing loudly if the
      // budget stops being shared (i.e. reverts to per-wave stacking).
      expect(elapsedMs).toBeLessThan(12_000);
      const body = res.json() as { cards: JobCard[]; pendingCount: number };
      expect(body.cards.length).toBeGreaterThan(0); // every card survived, none dropped
      // #117 AC5/must-fix 2: a judge is wired, so no card may show a deterministic number presented
      // as judged — every card is either `pending` (a paid attempt was made, inside the bound, and
      // it hung) or `unscored` (the bound never attempted it at all). Never `judged`/`estimated`.
      for (const card of body.cards) {
        expect(["pending", "unscored"]).toContain(card.scored);
        expect(card.matchPct).toBeNull();
      }
      // Exactly DECK_JUDGE_MAX_CARDS were attempted (and hung) — must-fix 1/2: the bound gates PAID
      // attempts, so only those count toward pendingCount; the rest are unscored, not pending.
      const pendingCards = body.cards.filter((c) => c.scored === "pending");
      expect(pendingCards.length).toBe(Math.min(DECK_JUDGE_MAX_CARDS, body.cards.length));
      expect(body.pendingCount).toBe(pendingCards.length);
      expect(readCounters()["judge.fallback_used"]).toBeGreaterThan(before); // the fallback is observable
    },
    20_000,
  );

  // #117 AC1 regression: the bound must hold no matter how large the pool — proven here by counting
  // ACTUAL judging attempts (not just the fallback counter, which would also fire for a card that was
  // never attempted at all if this test were wrong about that).
  //
  // #117 (coordinator review) — the REAL ~15-advert pool (data/sample-postings.json) is live product
  // data, not a fixture, and must never be inflated with synthetic entries just to make a test's pool
  // bigger than DECK_JUDGE_MAX_CARDS (8 as of this ticket). Instead, OnboardingDeps.judgeMaxCards
  // overrides the ceiling for this one test — deliberately set far below the real pool size so the
  // SAME production bound-selection code (routes/onboarding.ts) genuinely has to bind, exercising
  // "the pool exceeds the ceiling" branch for real rather than leaving it vacuously passing.
  it("never attempts more than the ceiling's judging calls, however large the pool", async () => {
    const testCeiling = 3;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> => stubRequirements(posting.id);
    const attempted = new Set<string>();
    const countingJudge: JudgeFn = async (adReq) => {
      attempted.add(adReq.adId);
      return null; // fall back — this test only cares about HOW MANY were even attempted
    };
    const { app } = buildServer({ readAd, judge: countingJudge, judgeMaxCards: testCeiling });
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: READER_ROLE_ITEM_ID,
      answer: "Owned a project budget of $2M with vendor oversight.",
    });

    const res = await get(app, cookie, "/onboarding/cards");
    const body = res.json() as { cards: JobCard[]; pendingCount: number };
    expect(body.cards.length).toBeGreaterThan(testCeiling); // the real pool really is bigger than this ceiling
    // Pin the exact count, not merely "at most" — peek is unwired (fresh store), so exactly
    // testCeiling, not fewer, should have been attempted.
    expect(attempted.size).toBe(testCeiling);
  });

  // #117 must-fix A (coordinator review, severe) — the paid set MUST be a pure function of (fact
  // set, requirement sets) alone, ranked over EVERY candidate, not just whatever the free peek phase
  // failed to resolve. Ranking over "still unresolved" was the bug: each poll's free peek would
  // resolve the previous poll's paid cards, which — if the paid set were re-derived from the
  // now-smaller unresolved remainder — freed up MORE slots for a fresh paid attempt, walking the
  // visitor's cold deck down the entire pool a few polls in (exactly the ~$0.29 spend this ticket
  // exists to eliminate). Proven here with a REAL judge+peek pair (makeJudge/makeJudgePeek, not hand
  // -rolled fakes) so the free-resolution mechanics are exercised for real, not simulated.
  it("MF-A: repeating the same cold deck request never pays for more than the bound, in total, across every poll", async () => {
    // #117 (coordinator review): the property is only OBSERVABLE when the candidate pool exceeds the
    // ceiling, and product data (data/sample-postings.json) must never be inflated to make that true
    // — OnboardingDeps.judgeMaxCards overrides the ceiling instead, well below the real ~15-advert
    // pool, so the bug this test guards against (poll 1 buys the top N, poll 2's free peek frees up N
    // MORE slots if the paid set is re-derived from the unresolved remainder, and so on) has real
    // room to manifest against the genuine pool.
    const testCeiling = 3;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> => stubRequirements(posting.id);
    const store = new InMemoryJudgementStore();
    let paidCalls = 0;
    const llm: LlmClient = {
      model: "claude-sonnet-5",
      async complete(prompt: string) {
        paidCalls++;
        const [requirementsBlock] = prompt.split("===CANDIDATE FACTS===");
        const ids = [...requirementsBlock!.matchAll(/^- id: (\S+)/gm)].map((m) => m[1]!);
        return JSON.stringify({
          verdicts: ids.map((id) => ({ requirementId: id, fit: 0.5, supportingFactId: null, reason: "partial" })),
        });
      },
    };
    const { app } = buildServer({
      readAd,
      judge: makeJudge(llm, store),
      judgePeek: makeJudgePeek(store),
      judgeMaxCards: testCeiling,
    });
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: READER_ROLE_ITEM_ID,
      answer: "Owned a project budget of $2M with vendor oversight.",
    });

    // Four identical polls, same unchanged fact set — exactly the web deck's poll-while-pending loop.
    for (let i = 0; i < 4; i++) {
      const res = await get(app, cookie, "/onboarding/cards");
      expect(res.statusCode).toBe(200);
      // Bug's own signature: under the broken "rank the unresolved remainder" version, paidCalls
      // after poll N is min(pool, (N+1) * testCeiling) — i.e. it keeps climbing. The fix must hold
      // this flat at (or under) the ceiling from the FIRST poll onward.
      expect(paidCalls).toBeLessThanOrEqual(testCeiling);
    }
    // The ceiling was reached at least once (sanity: this scenario really does have more candidates
    // than the ceiling) and never grew past it across all four polls.
    expect(paidCalls).toBe(testCeiling);
  });
});

// #105 review round 4, extended by #117 — QA measured the same visitor, seconds apart: BNP Paribas
// 38% -> 12%, OKX 0% -> 25%, Charterhouse 11% -> 2%: the old (fallback) scorer over-scored, so a card
// that FAILED judging floated to the deck's headline slot. #117 replaces that failure mode's fallback
// entirely — a card whose judging failed now claims NO number at all (pending), so it can no longer
// even HAVE a "higher raw score" to float on. What's left to prove at the HTTP boundary: a judged
// card, however low its honest number, still ranks ahead of a pending one that has no number to
// compare against at all.
describe("#105/#117 review: a real deck ranks a judged card above a pending one", () => {
  it("puts the judged card first even though the pending card was never given a chance to compete on score", async () => {
    const [judgedPosting, pendingPosting] = uncachedEnglishPostings();
    const judgedAd: AdRequirementsV1 = {
      schemaVersion: "1",
      adId: judgedPosting!.id,
      curated: false,
      language: "en",
      familyFit: { family: "IT Project Manager", confidence: 0.6 },
      requirements: [
        { id: "the-req", band: "essential", kind: "ordinary", requirement: "Own a project budget", sourceSpan: "budget" },
      ],
    };
    const pendingAd: AdRequirementsV1 = {
      schemaVersion: "1",
      adId: pendingPosting!.id,
      curated: false,
      language: "en",
      familyFit: { family: "IT Project Manager", confidence: 0.6 },
      requirements: [
        {
          id: "the-req",
          band: "essential",
          kind: "ordinary",
          requirement: "Own a project budget with vendor oversight",
          sourceSpan: "budget",
        },
      ],
    };
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> => {
      if (posting.id === judgedPosting!.id) return judgedAd;
      if (posting.id === pendingPosting!.id) return pendingAd;
      return null;
    };
    const judge: JudgeFn = async (adReq) => {
      if (adReq.adId === judgedPosting!.id) {
        return {
          verdicts: [{ requirementId: "the-req", fit: 0.3, supportingFactId: null, reason: "low, honest" }],
          version: "test",
          cost: { model: "fake-judge", inputTokens: 5, outputTokens: 5, judgedAt: new Date().toISOString() },
        };
      }
      // pendingPosting's ad (and any hand-fixtured ad in the pool): forces a judging failure.
      throw new Error("boom - forces this card to pending");
    };
    const { app } = buildServer({ readAd, judge });
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    // Near-verbatim token overlap with pendingAd's requirement -> matchTick's cheap pre-filter ranks
    // it highly too, guaranteeing it lands inside DECK_JUDGE_MAX_CARDS's bound and its judging call is
    // actually ATTEMPTED (and fails) rather than skipped for a different reason (out of the bound).
    // The SAME confirmed fact also reaches judgedPosting's scripted (low) verdict above unchanged,
    // since that fake ignores the evidence text entirely.
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: READER_ROLE_ITEM_ID,
      answer: "Owned a project budget with vendor oversight.",
    });

    const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    const judgedIndex = body.cards.findIndex((c) => c.adId === judgedPosting!.id);
    const pendingIndex = body.cards.findIndex((c) => c.adId === pendingPosting!.id);
    expect(judgedIndex).toBeGreaterThanOrEqual(0);
    expect(pendingIndex).toBeGreaterThanOrEqual(0);

    expect(body.cards[judgedIndex]!.scored).toBe("judged");
    expect(body.cards[pendingIndex]!.scored).toBe("pending");
    expect(body.cards[pendingIndex]!.matchPct).toBeNull(); // no competing raw score at all
    // The judged card ranks first regardless — different provenances are not comparable.
    expect(judgedIndex).toBeLessThan(pendingIndex);
  });
});

// #117 AC2, end to end through the real deck route (judge.test.ts already proves the mechanism
// directly at the LLM seam — this proves the wiring: a visitor answering a SECOND discovery question
// re-purchases only the requirement that was still open, not the whole card again.
describe("#117 AC2: a grown fact set re-purchases only the still-open requirement through the real deck", () => {
  it("keeps the already-met requirement's verdict and pays for only the still-open one on the second view", async () => {
    const targetPosting = uncachedEnglishPostings()[0]!;
    const twoReqAd: AdRequirementsV1 = {
      schemaVersion: "1",
      adId: targetPosting.id,
      curated: false,
      language: "en",
      familyFit: { family: "IT Project Manager", confidence: 0.6 },
      requirements: [
        { id: "own-budget", band: "essential", kind: "ordinary", requirement: "Own a project budget", sourceSpan: "budget" },
        { id: "certification", band: "nice-to-have", kind: "ordinary", requirement: "Hold a PMP certification", sourceSpan: "PMP" },
      ],
    };
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === targetPosting.id ? twoReqAd : null;
    const calls: string[] = [];
    const llm: LlmClient = {
      model: "claude-sonnet-5",
      async complete(prompt: string) {
        calls.push(prompt);
        const [requirementsBlock] = prompt.split("===CANDIDATE FACTS===");
        const ids = [...requirementsBlock!.matchAll(/^- id: (\S+)/gm)].map((m) => m[1]!);
        return JSON.stringify({
          verdicts: ids.map((id) => ({
            requirementId: id,
            fit: id === "own-budget" ? 0.9 : 0, // own-budget always clears COVERAGE_THRESHOLD; certification never does
            supportingFactId: null,
            reason: id === "own-budget" ? "covered" : "no cert evidence",
          })),
        });
      },
    };
    const store = new InMemoryJudgementStore();
    const { app } = buildServer({ readAd, judge: makeJudge(llm, store) });
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: READER_ROLE_ITEM_ID,
      answer: "Owned a project budget of $2M with vendor oversight.",
    });

    // The SAME judge/llm judges every OTHER card inside the bound too (8-ish hand-curated fixtures,
    // each with their own, differently-named requirement ids) — `calls` collects ALL of them, so
    // isolate target's OWN calls by its two requirement ids, which don't collide with any curated
    // fixture's (confirmed against this run's own ops log: none of the fixtures use "own-budget" or
    // "certification").
    const targetCalls = () => calls.filter((c) => c.includes("id: own-budget") || c.includes("id: certification"));

    const first = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    const firstCard = first.cards.find((c) => c.adId === targetPosting.id)!;
    expect(firstCard.scored).toBe("judged");
    expect(firstCard.dontYet.map((r) => r.id)).toContain("certification"); // still open, honestly
    const targetCallsAfterFirst = targetCalls().length;
    expect(targetCallsAfterFirst).toBe(1); // one full call, both requirements

    // A genuinely NEW fact (a different discovery item, not an edit of the reader-role answer) — the
    // fact set GROWS, it doesn't change.
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: "cross-functional-leadership",
      answer: "Yes, multiple teams",
    });

    const second = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    const secondCard = second.cards.find((c) => c.adId === targetPosting.id)!;

    expect(targetCalls().length).toBe(targetCallsAfterFirst + 1); // exactly ONE more TARGET call
    const secondTargetCallPrompt = targetCalls().at(-1)!;
    expect(secondTargetCallPrompt).toContain("id: certification"); // asked about the still-open one
    expect(secondTargetCallPrompt).not.toContain("id: own-budget"); // NOT re-asked — its verdict was kept
    expect(secondCard.dontYet.map((r) => r.id)).not.toContain("own-budget"); // kept, not reopened
    expect(secondCard.dontYet.map((r) => r.id)).toContain("certification"); // still honestly open
  });
});

// #117 must-fix 1 (coordinator review) — a stored judgement costs nothing to read, so the bound must
// gate FRESH paid calls only, never a free cache hit. Proven at the HTTP boundary with `judgePeek`
// wired: a card whose evidence is engineered to score badly on the cheap token pre-filter (the exact
// shape of match the bound's own documented weakness could exclude from a fresh attempt) is already
// judged, and resolves for free — no paid call is ever made for it.
describe("#117 must-fix 1: a card already judged (e.g. from an earlier visit or tailoring) resolves for free on the deck, never competing for the bound", () => {
  it("shows as judged with zero paid calls, even though its evidence would score near-zero on the cheap pre-filter that decides the bound", async () => {
    const targetPosting = uncachedEnglishPostings()[0]!;
    // #86's own flagship vocabulary-coincidence example: meaning-covers the requirement but shares
    // almost no tokens with it, so matchTick — the scorer the bound ranks candidates by — scores it
    // near 0%, exactly the shape of card the bound's documented weakness could starve of a fresh
    // paid attempt.
    const weakMatchAd: AdRequirementsV1 = {
      schemaVersion: "1",
      adId: targetPosting.id,
      curated: false,
      language: "en",
      familyFit: { family: "IT Project Manager", confidence: 0.6 },
      requirements: [
        {
          id: "the-req",
          band: "essential",
          kind: "ordinary",
          requirement: "Coordinate business and technical stakeholders across all project phases",
          sourceSpan: "x",
        },
      ],
    };
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> =>
      posting.id === targetPosting.id ? weakMatchAd : null;
    const calls: string[] = [];
    const llm: LlmClient = {
      model: "claude-sonnet-5",
      async complete(prompt: string) {
        calls.push(prompt);
        return JSON.stringify({ verdicts: [{ requirementId: "the-req", fit: 0.5, supportingFactId: null, reason: "x" }] });
      },
    };
    const store = new InMemoryJudgementStore();
    const { app } = buildServer({ readAd, judge: makeJudge(llm, store), judgePeek: makeJudgePeek(store) });
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    const evidence = "Ran weekly steering meetings with the CFO and the engineering leads.";
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: READER_ROLE_ITEM_ID, answer: evidence });

    // Simulate "already judged" (an earlier deck view, or tailoring this exact card) by writing the
    // record directly under THIS session's own fingerprint, at the current judge version — nothing
    // about the read path below depends on how it got there.
    const facts = [{ id: discoveryClaimId(READER_ROLE_ITEM_ID), text: freeTextLine(evidence) }];
    await store.put(targetPosting.id, judgementFingerprint(weakMatchAd, facts), {
      verdicts: [{ requirementId: "the-req", fit: 0.95, supportingFactId: facts[0]!.id, reason: "covered" }],
      version: judgeVersion(),
      cost: { model: "fake-judge", inputTokens: 5, outputTokens: 5, judgedAt: new Date().toISOString() },
      facts,
    });

    const res = await get(app, cookie, "/onboarding/cards");
    const body = res.json() as { cards: JobCard[] };
    const card = body.cards.find((c) => c.adId === targetPosting.id)!;

    expect(card.scored).toBe("judged"); // resolved for free — never "unscored" or "pending"
    expect(card.matchPct).toBe(95); // judgedMatchTick(0.95) on the single essential requirement
    expect(calls.filter((c) => c.includes("id: the-req"))).toHaveLength(0); // NO paid call for this card
  });
});
