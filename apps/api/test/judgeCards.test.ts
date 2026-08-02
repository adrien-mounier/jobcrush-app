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
import { makeJudge, judgementFingerprint, type JudgeFn } from "../src/judge.js";
import { InMemoryJudgementStore } from "../src/judgementStore.js";
import { readCounters } from "../src/counters.js";
import type { LlmClient } from "../src/llm.js";
import { CANONICAL_REGRESSION_ROWS } from "./fixtures/judge-regression-rows.js";

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
  matchPct: number;
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

      const res = await get(app, cookie, "/onboarding/cards");
      expect(res.statusCode).toBe(200);
      const body = res.json() as { cards: JobCard[] };
      const card = body.cards.find((c) => c.adId === targetPosting.id);
      expect(card).toBeDefined();

      if (row.expected === "covered") {
        expect(card!.matchPct).toBe(100);
        expect(card!.dontYet.map((r) => r.id)).not.toContain("the-req");
      } else if (row.expected === "not-covered") {
        expect(card!.matchPct).toBe(0);
        expect(card!.dontYet.map((r) => r.id)).toContain("the-req");
      } else {
        // partial: real credit, but never treated as fully satisfied
        expect(card!.matchPct).toBeGreaterThan(0);
        expect(card!.matchPct).toBeLessThan(100);
        expect(card!.dontYet.map((r) => r.id)).toContain("the-req");
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
    const evidence = "Managed multiple software delivery programs end to end.";
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
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: READER_ROLE_ITEM_ID,
      answer: "Managed multiple software delivery programs end to end.",
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

describe("#105 a judging failure falls back to the deterministic tick, and counts it", () => {
  it("the card survives with the deterministic tick's number, never a fabricated one, and the fallback is counted", async () => {
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
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: READER_ROLE_ITEM_ID,
      answer: "Owned a project budget of $2M.",
    });

    const res = await get(app, cookie, "/onboarding/cards");
    expect(res.statusCode).toBe(200); // no 500 — the card survives
    const body = res.json() as { cards: JobCard[] };
    const card = body.cards.find((c) => c.adId === targetPosting.id);
    expect(card).toBeDefined(); // never dropped over a judging failure

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
    "every card falls back and the deck still responds within the shared budget, even with every judge call hanging forever",
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
      const body = res.json() as { cards: JobCard[] };
      expect(body.cards.length).toBeGreaterThan(0); // every card fell back, none dropped
      for (const card of body.cards) {
        expect(card.matchPct).toBeGreaterThanOrEqual(0); // a real (fallback) number, not a hang
      }
      expect(readCounters()["judge.fallback_used"]).toBeGreaterThan(before); // the fallback is observable
    },
    20_000,
  );
});

// #105 review round 4, MUST-FIX 2 — QA measured the same visitor, seconds apart: BNP Paribas
// 38% -> 12%, OKX 0% -> 25%, Charterhouse 11% -> 2%. The old (fallback) scorer over-scores, so a card
// that FAILED judging floated to the deck's headline slot — a 3x over-score on the one job the deck
// had no real verdict for. Proven at the HTTP boundary: a judged card, deliberately scored LOWER than
// a fallback card whose evidence is engineered to token-overlap perfectly (matchTick ~= 100), must
// still rank first.
describe("#105 review round 4: a real deck ranks a judged card above a higher-scoring fallback card", () => {
  it("puts the judged card first even though the fallback card's raw score is higher", async () => {
    const [judgedPosting, fallbackPosting] = uncachedEnglishPostings();
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
    const fallbackAd: AdRequirementsV1 = {
      schemaVersion: "1",
      adId: fallbackPosting!.id,
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
      if (posting.id === fallbackPosting!.id) return fallbackAd;
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
      // fallbackPosting's ad (and any hand-fixtured ad in the pool): forces the fallback path.
      throw new Error("boom - forces the deterministic tick for this ad");
    };
    const { app } = buildServer({ readAd, judge });
    const cookie = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    // Near-verbatim token overlap with fallbackAd's requirement -> matchTick scores it near 100; the
    // SAME confirmed fact also reaches judgedPosting's scripted (low) verdict above unchanged, since
    // that fake ignores the evidence text entirely.
    await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: READER_ROLE_ITEM_ID,
      answer: "Owned a project budget with vendor oversight.",
    });

    const body = (await get(app, cookie, "/onboarding/cards")).json() as { cards: JobCard[] };
    const judgedIndex = body.cards.findIndex((c) => c.adId === judgedPosting!.id);
    const fallbackIndex = body.cards.findIndex((c) => c.adId === fallbackPosting!.id);
    expect(judgedIndex).toBeGreaterThanOrEqual(0);
    expect(fallbackIndex).toBeGreaterThanOrEqual(0);

    // Sanity: the fallback card's raw score really IS higher — this is the exact heterogeneous
    // situation the ordering fix has to handle, not a case where ranking would agree either way.
    expect(body.cards[fallbackIndex]!.matchPct).toBeGreaterThan(body.cards[judgedIndex]!.matchPct);
    // Yet the judged card ranks first — different scorers are not comparable.
    expect(judgedIndex).toBeLessThan(fallbackIndex);
  });
});
