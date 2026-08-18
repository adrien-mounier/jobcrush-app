// #236 — the family-candidate screen running by itself on the word-search deck. The visitor asks
// for nothing and is told nothing: these tests assert what is PERSISTED and what her plan becomes,
// plus that no research/family/vocabulary wording ever reaches the deck response.
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";
import {
  InMemoryFamilyLearningStore,
  type FamilyCandidateScreen,
  type FamilyScreeningDecision,
} from "../src/familyLearning.js";
import {
  FamilyScreeningUnavailable,
  intakeFamilyCandidate,
} from "../src/familyCandidateIntake.js";

const PUBLISHED = { familyId: "it-project-delivery", version: 1 };

async function wordSearchVisitor(screen: FamilyCandidateScreen) {
  const server = buildServer({ screenFamilyCandidate: screen });
  const res = await server.app.inject({ method: "POST", url: "/sessions/anonymous" });
  const cookie = `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
  const session = (await server.sessions.getByToken(cookie.slice("jc_session=".length)))!;
  await server.sessions.setIntent(session.id, { targetRole: "Orbital Farm Planner", searchArea: "Hanoi" });
  const deck = () => server.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
  return { server, cookie, sessionId: session.id, deck };
}

const screenReturning = (decision: FamilyScreeningDecision) => {
  const calls: string[] = [];
  const screen: FamilyCandidateScreen = async ({ targetRole }) => {
    calls.push(targetRole);
    return decision;
  };
  return { screen, calls };
};

describe("#236 the candidate screen on the word-search path", () => {
  it("accepted opens a family learning attempt with no operator action, invisibly", async () => {
    const { screen, calls } = screenReturning({
      outcome: "accepted",
      rationale: "credible novel employment target",
      indicators: ["job_title_shape"],
    });
    const { server, sessionId, deck } = await wordSearchVisitor(screen);

    const response = await deck();
    expect(response.statusCode).toBe(200);
    // No user-facing copy about research, job families or vocabulary anywhere in the deck.
    expect(JSON.stringify(response.json())).not.toMatch(/research|job famil|vocabular/i);

    await vi.waitFor(async () => {
      const attempt = await server.familyLearning.latestForSession(sessionId);
      expect(attempt).toMatchObject({
        targetRole: "Orbital Farm Planner",
        screeningOutcome: "accepted",
        status: "research_started",
      });
    });
    expect(calls).toEqual(["Orbital Farm Planner"]);
  });

  it("covered_role pins the recognised family as question floor and search family, once", async () => {
    const { screen, calls } = screenReturning({
      outcome: "covered_role",
      rationale: "the target is already covered by a published family",
      indicators: ["published_family_match"],
      coveredFamily: PUBLISHED,
    });
    const { server, sessionId, cookie, deck } = await wordSearchVisitor(screen);

    expect((await deck()).statusCode).toBe(200);
    await vi.waitFor(async () => {
      const session = (await server.sessions.getById(sessionId))!;
      expect(session.discovery.searchFamily).toEqual(PUBLISHED);
      expect(session.discovery.questionFloors).toEqual([PUBLISHED]);
      expect(session.discovery.coveredItemIds).toEqual([]);
    });

    // The pin is the marker: a family search never consults the screen again.
    expect((await deck()).statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toHaveLength(1);

    // …and she gets the NORMAL family interview on it, on the shipped screen (#216). The labeler
    // still says "unmapped" (that is why the screen was needed), so this is the case that used to
    // 409 on her own discovery: the pin wins and the interview opens on the recognised family.
    const discovery = await server.app.inject({
      method: "POST",
      url: "/onboarding/discovery/start",
      headers: { cookie },
      payload: { role: "Orbital Farm Planner" },
    });
    expect(discovery.statusCode).toBe(200);
    expect(discovery.json().questions.length).toBeGreaterThan(0);
    const pinned = (await server.sessions.getById(sessionId))!.discovery;
    expect(pinned).toMatchObject({
      questionFloors: [PUBLISHED],
      searchFamily: PUBLISHED,
      checkpoint: "family_confirmed",
    });
  });

  it("equivalent attaches to the existing attempt and creates no duplicate", async () => {
    // Straight through the shared intake — the same function both callers use.
    const store = new InMemoryFamilyLearningStore();
    await store.init();
    const intake = (screen: FamilyCandidateScreen, sessionId: string, targetRole: string) =>
      intakeFamilyCandidate(
        { store, screen, knownFamilies: () => [PUBLISHED] },
        { sessionId, targetRole, searchArea: null, persistDiscarded: false },
      );

    const first = await intake(
      async () => ({ outcome: "accepted", rationale: "credible", indicators: ["job_title_shape"] }),
      "s1",
      "Orbital Farm Planner",
    );
    const canonical = first.attempt!.id;

    const second = await intake(
      async ({ canonicalCandidates }) => ({
        outcome: "equivalent",
        rationale: "a semantic variant of an attempt already running",
        indicators: ["semantic_equivalent"],
        canonicalAttemptId: canonicalCandidates[0]!.id,
      }),
      "s2",
      "Planner of Orbital Farms",
    );

    expect(second.attempt).toMatchObject({
      screeningOutcome: "equivalent",
      canonicalAttemptId: canonical,
      status: "rejected",
    });
    expect(await store.acceptedCanonicalCandidates()).toHaveLength(1);
  });

  it("a screen naming a canonical attempt it was never shown is rejected, not recorded", async () => {
    const store = new InMemoryFamilyLearningStore();
    await store.init();
    await expect(
      intakeFamilyCandidate(
        {
          store,
          screen: async () => ({
            outcome: "equivalent",
            rationale: "invented a canonical attempt",
            indicators: ["semantic_equivalent"],
            canonicalAttemptId: "1f1ec6e6-0000-4000-8000-000000000000",
          }),
          knownFamilies: () => [PUBLISHED],
        },
        { sessionId: "s1", targetRole: "Orbital Farm Planner", searchArea: null, persistDiscarded: true },
      ),
    ).rejects.toBeInstanceOf(FamilyScreeningUnavailable);
    expect(await store.latestForSession("s1")).toBeNull();
  });

  for (const outcome of ["abuse", "non_job"] as const) {
    it(`${outcome} persists nothing and leaves the word-search deck standing`, async () => {
      const { screen, calls } = screenReturning({
        outcome,
        rationale: "not a credible employment target",
        indicators: ["screen_reject"],
      });
      const { server, sessionId, deck } = await wordSearchVisitor(screen);

      const response = await deck();
      expect(response.statusCode).toBe(200);
      expect(response.json().cards).toBeInstanceOf(Array);
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      await new Promise((resolve) => setImmediate(resolve));
      expect(await server.familyLearning.latestForSession(sessionId)).toBeNull();
      const session = (await server.sessions.getById(sessionId))!;
      expect(session.discovery.searchFamily).toBeNull();
    });
  }

  it("a screen that errors persists nothing, and the deck is untouched", async () => {
    const screen: FamilyCandidateScreen = async () => {
      throw new Error("screen unavailable");
    };
    const { server, sessionId, deck } = await wordSearchVisitor(screen);

    const response = await deck();
    expect(response.statusCode).toBe(200);
    expect(response.json().cards).toBeInstanceOf(Array);
    await new Promise((resolve) => setImmediate(resolve));
    expect(await server.familyLearning.latestForSession(sessionId)).toBeNull();
    expect((await server.sessions.getById(sessionId))!.discovery.searchFamily).toBeNull();
  });

  it("a screen answering with a family it was never shown is discarded", async () => {
    const { screen } = screenReturning({
      outcome: "covered_role",
      rationale: "invented a family",
      indicators: ["published_family_match"],
      coveredFamily: { familyId: "not-published", version: 7 },
    });
    const { server, sessionId, deck } = await wordSearchVisitor(screen);

    expect((await deck()).statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(await server.familyLearning.latestForSession(sessionId)).toBeNull();
    expect((await server.sessions.getById(sessionId))!.discovery.searchFamily).toBeNull();
  });

  it("a visitor already searching a family is never screened", async () => {
    const { screen, calls } = screenReturning({
      outcome: "accepted",
      rationale: "credible novel employment target",
      indicators: ["job_title_shape"],
    });
    const { server, sessionId, deck } = await wordSearchVisitor(screen);
    await server.sessions.reconcileDiscoveryState(
      sessionId,
      { questionFloors: [PUBLISHED], searchFamily: PUBLISHED },
      [],
      false,
    );

    expect((await deck()).statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toEqual([]);
    expect(await server.familyLearning.latestForSession(sessionId)).toBeNull();
  });
});
