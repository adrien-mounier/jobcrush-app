import { describe, expect, it } from "vitest";
import type { CandidateClaim, FamilyFloorV1 } from "@jobcrush/contracts";
import { buildServer } from "../src/server.js";
import { TestFixtureFamilyFloorStore } from "../src/familyFloors.js";

const placement = {
  schemaVersion: "2" as const,
  outcome: "confirmed" as const,
  families: [{ familyId: "delivery-leadership-example", version: 1 }],
  confidence: "certain" as const,
};
const [placedFamily] = placement.families;

const floor = (count: number): FamilyFloorV1 => ({
  schemaVersion: "1",
  familyId: placedFamily!.familyId,
  version: placedFamily!.version,
  source: "test_fixture",
  productionRewardEligible: false,
  essentialItems: Array.from({ length: count }, (_, index) => ({
    id: `requirement-${index + 1}`,
    priority: index + 1,
    question: {
      prompt: `Describe requirement ${index + 1}.`,
      form: "free_text" as const,
      options: [],
    },
    evidenceDestination: {
      document: "root_cv" as const,
      section: index === 0 ? ("summary" as const) : ("experience" as const),
    },
    negativeSemantics: "records_explicit_negative" as const,
  })),
});

const imported = (id: string, semanticKey = id): CandidateClaim => ({
  id: `imported-${id}`,
  semantic_key: semanticKey,
  field_key: null,
  field_value: null,
  field_label: null,
  role: "profile",
  text: `Source-supported evidence for ${id}`,
  machine_touch: "verbatim",
  classification: "Verified",
  source_quote: `CV evidence for ${id}`,
  needs_grill: false,
  grill_hint: null,
});

async function setup(count: number, covered: string[] = []) {
  const familyFloors = new TestFixtureFamilyFloorStore();
  familyFloors.add(floor(count));
  const built = buildServer({ familyFloors });
  const session = await built.app.inject({ method: "POST", url: "/sessions/anonymous" });
  const cookie = `jc_session=${session.cookies.find((value) => value.name === "jc_session")!.value}`;
  const sessionId = session.json().id as string;
  await built.claims.seed(
    sessionId,
    covered.map((id) => imported(id)),
  );
  return { ...built, cookie };
}

const evaluate = (app: ReturnType<typeof buildServer>["app"], cookie: string, body = { placement }) =>
  app.inject({
    method: "POST",
    url: "/onboarding/discovery/fixture/evaluate",
    headers: { cookie },
    payload: body,
  });

const answer = (
  app: ReturnType<typeof buildServer>["app"],
  cookie: string,
  itemId: string,
  value: string,
) =>
  app.inject({
    method: "POST",
    url: "/onboarding/discovery/fixture/answer",
    headers: { cookie },
    payload: { placement, itemId, answer: value },
  });

describe("#59 fixture-driven adaptive discovery HTTP seam", () => {
  it("asks zero questions when a three-item floor is fully covered by imported evidence", async () => {
    const { app, cookie } = await setup(3, ["requirement-1", "requirement-2", "requirement-3"]);
    const response = await evaluate(app, cookie);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      rewardEligible: false,
      progress: { complete: 3, remaining: 0 },
      nextQuestion: null,
    });
  });

  it("asks every uncovered item in priority order with no fixed question count", async () => {
    const { app, cookie } = await setup(5, ["requirement-1", "requirement-2"]);
    const asked: string[] = [];

    for (;;) {
      const state = (await evaluate(app, cookie)).json();
      if (!state.nextQuestion) break;
      asked.push(state.nextQuestion.itemId);
      await answer(app, cookie, state.nextQuestion.itemId, `Evidence for ${state.nextQuestion.itemId}`);
    }

    expect(asked).toEqual(["requirement-3", "requirement-4", "requirement-5"]);
  });

  it("asks all five items when no evidence exists", async () => {
    const { app, cookie } = await setup(5);
    const asked: string[] = [];

    for (;;) {
      const state = (await evaluate(app, cookie)).json();
      if (!state.nextQuestion) break;
      asked.push(state.nextQuestion.itemId);
      await answer(app, cookie, state.nextQuestion.itemId, "Yes");
    }

    expect(asked).toEqual([
      "requirement-1",
      "requirement-2",
      "requirement-3",
      "requirement-4",
      "requirement-5",
    ]);
  });

  it("records explicit No as complete without positive evidence or a root-CV line", async () => {
    const { app, claims, sessions, cookie } = await setup(3);
    const state = (await answer(app, cookie, "requirement-1", "No")).json();
    const session = await sessions.getByToken(cookie.slice("jc_session=".length));

    expect(state).toMatchObject({
      progress: { complete: 1, remaining: 2 },
      positiveEvidence: [],
      rootCvLines: [],
      nextQuestion: { itemId: "requirement-2" },
    });
    expect((await claims.negatives(session!.id)).map((claim) => claim.id)).toContain(
      "fixture-discovery-delivery-leadership-example-1-requirement-1",
    );
  });

  it("counts a semantic-key equivalent once even when duplicate claims support it", async () => {
    const { app, claims, sessions, cookie } = await setup(3);
    const session = await sessions.getByToken(cookie.slice("jc_session=".length));
    await claims.seed(session!.id, [
      imported("equivalent-a", "requirement-1"),
      imported("equivalent-b", "requirement-1"),
    ]);

    const state = (await evaluate(app, cookie)).json();
    expect(state.positiveEvidence.filter((entry: { itemId: string }) => entry.itemId === "requirement-1")).toHaveLength(1);
    expect(state.progress).toEqual({ complete: 1, remaining: 2 });
  });

  it("fails closed for non-confirmed placement and never authorizes reward", async () => {
    const { app, cookie } = await setup(3, ["requirement-1"]);
    const response = await evaluate(app, cookie, {
      placement: {
        schemaVersion: "2",
        outcome: "unmapped",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: "placement_not_confirmed" },
      rewardEligible: false,
    });
  });

  it("keeps evidence, root-CV feedback, progress, and next item coherent after corrections", async () => {
    const { app, cookie } = await setup(3);
    const positive = (await answer(app, cookie, "requirement-1", "Led three teams")).json();
    expect(positive).toMatchObject({
      progress: { complete: 1, remaining: 2 },
      nextQuestion: { itemId: "requirement-2" },
    });
    expect(positive.positiveEvidence).toHaveLength(1);
    expect(positive.rootCvLines[0]).toMatchObject({
      itemId: "requirement-1",
      section: "summary",
      text: "Led three teams",
    });

    const corrected = (await answer(app, cookie, "requirement-1", "No")).json();
    expect(corrected).toMatchObject({
      progress: { complete: 1, remaining: 2 },
      positiveEvidence: [],
      rootCvLines: [],
      nextQuestion: { itemId: "requirement-2" },
    });

    const correctedAgain = (await answer(app, cookie, "requirement-1", "Led five teams")).json();
    expect(correctedAgain.positiveEvidence).toHaveLength(1);
    expect(correctedAgain.rootCvLines[0].text).toBe("Led five teams");
    expect(correctedAgain.progress).toEqual({ complete: 1, remaining: 2 });
    expect(correctedAgain.nextQuestion.itemId).toBe("requirement-2");
  });
});
