import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import {
  progressFamilyLearning,
  type FamilyCandidateScreen,
} from "../src/familyLearning.js";

async function sessionCookie(app: ReturnType<typeof buildServer>["app"]) {
  const response = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${response.cookies.find((cookie) => cookie.name === "jc_session")!.value}`;
}

async function claimedCookie(app: ReturnType<typeof buildServer>["app"]) {
  const cookie = await sessionCookie(app);
  await claimCookie(app, cookie);
  return cookie;
}

async function claimCookie(
  app: ReturnType<typeof buildServer>["app"],
  cookie: string,
) {
  const link = await app.inject({
    method: "POST",
    url: "/auth/request-link",
    headers: { cookie },
    payload: { email: "learner@example.com" },
  });
  const token = new URL("http://local" + link.json().devLink).searchParams.get("token")!;
  await app.inject({
    method: "POST",
    url: "/auth/verify",
    headers: { cookie },
    payload: { token },
  });
}

async function setTarget(
  server: ReturnType<typeof buildServer>,
  cookie: string,
  targetRole: string,
  searchArea?: string,
) {
  const token = cookie.slice("jc_session=".length);
  const session = await server.sessions.getByToken(token);
  await server.sessions.setIntent(session!.id, { targetRole, searchArea });
}

const unmappedPlacement = { schemaVersion: "2", outcome: "unmapped" };
const acceptedScreen: FamilyCandidateScreen = async () => ({
  outcome: "accepted",
  rationale: "credible novel employment target",
  indicators: ["job_title_shape"],
});

describe("family-learning HTTP lifecycle", () => {
  it("fails closed when no real screening implementation is configured", async () => {
    const server = buildServer();
    const cookie = await sessionCookie(server.app);
    await setTarget(server, cookie, "Orbital Farm Planner");
    const response = await server.app.inject({
      method: "POST",
      url: "/family-learning/candidates",
      headers: { cookie },
      payload: { targetRole: "Orbital Farm Planner", placement: unmappedPlacement },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("family_screening_unavailable");
  });

  it("stops discovery and retains only a privacy-minimized candidate", async () => {
    const server = buildServer({ screenFamilyCandidate: acceptedScreen });
    const cookie = await sessionCookie(server.app);

    await setTarget(server, cookie, "Space Habitat Coordinator", "Remote");

    const response = await server.app.inject({
      method: "POST",
      url: "/family-learning/candidates",
      headers: { cookie },
      payload: {
        targetRole: "Space Habitat Coordinator",
        searchArea: "Remote",
        placement: unmappedPlacement,
        ignoredCv: "must be rejected by strict request validation",
      },
    });
    expect(response.statusCode).toBe(400);

    const accepted = await server.app.inject({
      method: "POST",
      url: "/family-learning/candidates",
      headers: { cookie },
      payload: {
        targetRole: "Space Habitat Coordinator",
        placement: unmappedPlacement,
      },
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toMatchObject({
      discoveryStopped: true,
      attempt: {
        targetRole: "Space Habitat Coordinator",
        screeningOutcome: "accepted",
        status: "research_started",
      },
    });
    expect(Object.keys(accepted.json().attempt).sort()).toEqual([
      "canonicalAttemptId",
      "coveredFamily",
      "createdAt",
      "id",
      "screeningIndicators",
      "screeningOutcome",
      "screeningRationale",
      "searchArea",
      "status",
      "targetRole",
      "updatedAt",
    ]);
  });

  it.each([
    ["abuse", "abuse"],
    ["non-job intent", "non_job"],
  ] as const)("records a traceable %s screening outcome", async (_label, outcome) => {
    const screen: FamilyCandidateScreen = async () => ({
      outcome,
      rationale: `fixture ${outcome}`,
      indicators: [`fixture_${outcome}`],
    });
    const server = buildServer({ screenFamilyCandidate: screen });
    const cookie = await sessionCookie(server.app);
    await setTarget(server, cookie, "Novel Role");

    const response = await server.app.inject({
      method: "POST",
      url: "/family-learning/candidates",
      headers: { cookie },
      payload: { targetRole: "Novel Role", placement: unmappedPlacement },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().attempt).toMatchObject({
      screeningOutcome: outcome,
      status: "rejected",
    });
  });

  it("deduplicates normalized targets while retaining a traceable duplicate attempt", async () => {
    const server = buildServer({ screenFamilyCandidate: acceptedScreen });
    const firstCookie = await sessionCookie(server.app);
    const secondCookie = await sessionCookie(server.app);
    for (const cookie of [firstCookie, secondCookie]) {
      await setTarget(
        server,
        cookie,
        cookie === firstCookie ? "Space  Planner" : " space planner ",
      );
    }

    const first = await server.app.inject({
      method: "POST",
      url: "/family-learning/candidates",
      headers: { cookie: firstCookie },
      payload: { targetRole: "Space  Planner", placement: unmappedPlacement },
    });
    const duplicate = await server.app.inject({
      method: "POST",
      url: "/family-learning/candidates",
      headers: { cookie: secondCookie },
      payload: { targetRole: " space planner ", placement: unmappedPlacement },
    });

    expect(first.json().attempt.screeningOutcome).toBe("accepted");
    expect(duplicate.json().attempt).toMatchObject({
      screeningOutcome: "duplicate",
      status: "rejected",
    });
    expect(duplicate.json().attempt.id).not.toBe(first.json().attempt.id);
  });

  it("starts reusable research from one credible target", async () => {
    const server = buildServer({ screenFamilyCandidate: acceptedScreen });
    const cookie = await sessionCookie(server.app);
    await setTarget(server, cookie, "Orbital Farm Planner");
    const response = await server.app.inject({
      method: "POST",
      url: "/family-learning/candidates",
      headers: { cookie },
      payload: { targetRole: "Orbital Farm Planner", placement: unmappedPlacement },
    });
    expect(response.json().attempt.status).toBe("research_started");
  });

  it("publishes and resumes without notifying when no relevant vacancy exists", async () => {
    const server = buildServer({
      screenFamilyCandidate: acceptedScreen,
      familyLearningOperatorKey: "operator-secret",
    });
    const cookie = await claimedCookie(server.app);
    await setTarget(server, cookie, "Orbital Farm Planner");
    const created = await server.app.inject({
      method: "POST",
      url: "/family-learning/candidates",
      headers: { cookie },
      payload: { targetRole: "Orbital Farm Planner", placement: unmappedPlacement },
    });
    const id = created.json().attempt.id as string;

    const untrusted = await server.app.inject({
      method: "POST",
      url: `/operator/family-learning/attempts/${id}/progress`,
      payload: { event: "validation_passed" },
    });
    expect(untrusted.statusCode).toBe(403);
    for (const payload of [
      { event: "validation_passed" },
      { event: "family_published" },
      { event: "fulfillment_evaluated", relevantVacancy: false },
    ]) {
      const progressed = await server.app.inject({
        method: "POST",
        url: `/operator/family-learning/attempts/${id}/progress`,
        headers: { authorization: "Bearer operator-secret" },
        payload,
      });
      expect(progressed.statusCode).toBe(200);
    }
    expect((await server.familyLearning.get(id))?.status).toBe("search_resumed");
    const forbidden = await server.app.inject({
      method: "POST",
      url: `/family-learning/attempts/${id}/events`,
      headers: { cookie },
      payload: { event: "family_published" },
    });
    expect(forbidden.statusCode).toBe(404);
  });

  it.each(["rejected", "validation_failed"] as const)(
    "preserves target and returns an honest correction path after %s",
    async (terminal) => {
      const screen: FamilyCandidateScreen = async () =>
        terminal === "rejected"
          ? { outcome: "non_job", rationale: "not a job", indicators: ["non_job"] }
          : {
              outcome: "accepted",
              rationale: "credible job target",
              indicators: ["job_title_shape"],
            };
      const server = buildServer({ screenFamilyCandidate: screen });
      const cookie = await sessionCookie(server.app);
      await setTarget(server, cookie, "Orbital Farm Planner");
      const created = await server.app.inject({
        method: "POST",
        url: "/family-learning/candidates",
        headers: { cookie },
        payload: { targetRole: "Orbital Farm Planner", placement: unmappedPlacement },
      });
      const id = created.json().attempt.id as string;
      if (terminal === "validation_failed") {
        await progressFamilyLearning(server.familyLearning, id, {
          event: "validation_failed",
        });
      }

      const returned = await server.app.inject({
        method: "GET",
        url: "/family-learning/return",
        headers: { cookie },
      });
      expect(returned.json()).toMatchObject({
        targetRole: "Orbital Farm Planner",
        correction: {
          canCorrectTarget: true,
          message: expect.stringMatching(/check or correct/i),
        },
      });
      expect(returned.json().notificationPromise).toMatch(/credible matches/i);
      expect(returned.json().notificationPromise).not.toMatch(/\b(day|week|hour|minute)s?\b/i);
    },
  );
});
