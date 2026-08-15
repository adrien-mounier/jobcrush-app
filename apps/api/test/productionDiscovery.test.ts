import { describe, expect, it } from "vitest";
import type { CandidateClaim } from "@jobcrush/contracts";
import { newDb } from "pg-mem";
import { PgClaimStore } from "../src/claims.js";
import { PgSessionStore } from "../src/sessions.js";
import {
  initialProductionFamilyFloors,
  type ProductionFamilyFloorStore,
} from "../src/familyFloors.js";
import { buildServer } from "../src/server.js";

const placement = {
  schemaVersion: "2" as const,
  outcome: "confirmed" as const,
  families: [{ familyId: "it-project-delivery", version: 1 }],
  confidence: "certain" as const,
};
const placedFamily = placement.families[0]!;
// #234: a mapped target role's plan — the same family as the one question floor and the search family.
const mappedPlan = { questionFloors: [placedFamily], searchFamily: placedFamily };

const imported = (
  itemId: string,
  over: Partial<CandidateClaim> = {},
): CandidateClaim => ({
  id: `source-${itemId}`,
  semantic_key: itemId,
  field_key: null,
  field_value: null,
  field_label: null,
  role: "profile",
  text: `Source-supported evidence for ${itemId}`,
  machine_touch: "verbatim",
  classification: "Verified",
  source_quote: `CV evidence for ${itemId}`,
  needs_grill: false,
  grill_hint: null,
  ...over,
});

async function setup(
  covered: Array<string | CandidateClaim> = [],
  driver: "memory" | "postgres" = "memory",
  authoritativePlacement = placement,
) {
  let stores = {};
  if (driver === "postgres") {
    const adapter = newDb().adapters.createPg();
    const pool = new adapter.Pool();
    const sessions = new PgSessionStore(pool);
    const claims = new PgClaimStore(pool);
    await sessions.init();
    await claims.init();
    stores = { sessions, claims };
  }
  const built = buildServer({
    ...stores,
    placeFamily: async () => authoritativePlacement,
  });
  const created = await built.app.inject({ method: "POST", url: "/sessions/anonymous" });
  const token = created.cookies.find((value) => value.name === "jc_session")!.value;
  const cookie = `jc_session=${token}`;
  await built.claims.seed(
    created.json().id,
    covered.map((value) => (typeof value === "string" ? imported(value) : value)),
  );
  return { ...built, cookie, sessionId: created.json().id as string };
}

const evaluate = (app: ReturnType<typeof buildServer>["app"], cookie: string) =>
  app.inject({
    method: "POST",
    url: "/onboarding/discovery/production/evaluate",
    headers: { cookie },
  });

describe("#61 production discovery HTTP seam", () => {
  it("pins the confirmed published version and restores it on resume", async () => {
    const { app, sessions, cookie, sessionId } = await setup(["end-to-end-delivery"]);

    const started = await evaluate(app, cookie);
    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({
      floor: placedFamily,
      checkpoint: "family_confirmed",
      progress: { complete: 1, remaining: 3 },
    });
    expect((await sessions.getById(sessionId))?.discovery).toEqual({
      ...mappedPlan,
      coveredItemIds: ["end-to-end-delivery"],
      checkpoint: "family_confirmed",
    });

    const resumed = await app.inject({
      method: "GET",
      url: "/onboarding/discovery/production",
      headers: { cookie },
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json()).toEqual(started.json());
  });

  it("writes essential_floor_covered only when every item has allowed coverage", async () => {
    const { app, sessions, cookie, sessionId } = await setup([
      "end-to-end-delivery",
      "stakeholder-coordination",
      "risk-dependency-control",
      "delivery-communication",
    ]);

    const response = await evaluate(app, cookie);
    expect(response.json()).toMatchObject({
      checkpoint: "essential_floor_covered",
      progress: { complete: 4, remaining: 0 },
      nextQuestion: null,
    });
    expect((await sessions.getById(sessionId))?.discovery.checkpoint).toBe(
      "essential_floor_covered",
    );
  });

  it.each([
    { schemaVersion: "2", outcome: "unmapped" },
    {
      schemaVersion: "2",
      outcome: "confirmed",
      families: [{ familyId: "it-project-delivery", version: 99 }],
      confidence: "certain",
    },
    {
      schemaVersion: "2",
      outcome: "confirmed",
      families: [{ familyId: "delivery-leadership-example", version: 1 }],
      confidence: "certain",
    },
    // #231 — a PLURAL placement never reaches floor selection: a floor is one family's questions,
    // and picking one of two on the visitor's behalf is the thing ADR-0014 forbids. #232 lifts this.
    {
      schemaVersion: "2",
      outcome: "confirmed",
      families: [
        { familyId: "it-project-delivery", version: 1 },
        { familyId: "product-management", version: 1 },
      ],
      confidence: "likely",
    },
  ])("rejects non-production placement %#", async (invalidPlacement) => {
    const { app, cookie } = await setup([], "memory", invalidPlacement as typeof placement);
    const response = await evaluate(app, cookie);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ rewardEligible: false });
  });

  it("rejects a provisional publication even when a catalog adapter exposes it", async () => {
    const published = initialProductionFamilyFloors().get("it-project-delivery", 1)!;
    const provisional = {
      ...published,
      publicationStatus: "provisional" as const,
    };
    const productionFamilyFloors = {
      get: () => provisional,
    } as unknown as ProductionFamilyFloorStore;
    const built = buildServer({
      productionFamilyFloors,
      placeFamily: async () => placement,
    });
    const created = await built.app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = `jc_session=${created.cookies.find((value) => value.name === "jc_session")!.value}`;
    const response = await evaluate(built.app, cookie);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: "production_floor_unavailable" },
      rewardEligible: false,
    });
  });

  it.each(["Yes, I led delivery", "No"])(
    "rejects an ineligible pinned floor before mutating claims or discovery: %s",
    async (answer) => {
      const published = initialProductionFamilyFloors().get("it-project-delivery", 1)!;
      const productionFamilyFloors = {
        get: () => ({ ...published, publicationStatus: "provisional" as const }),
      } as unknown as ProductionFamilyFloorStore;
      const built = buildServer({
        productionFamilyFloors,
        placeFamily: async () => placement,
      });
      const created = await built.app.inject({ method: "POST", url: "/sessions/anonymous" });
      const cookie = `jc_session=${created.cookies.find((value) => value.name === "jc_session")!.value}`;
      await built.sessions.reconcileDiscoveryState(created.json().id, mappedPlan, [], false);
      const before = (await built.sessions.getById(created.json().id))!.discovery;

      const response = await built.app.inject({
        method: "POST",
        url: "/onboarding/discovery/production/answer",
        headers: { cookie },
        payload: { itemId: "end-to-end-delivery", answer },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: "production_floor_unavailable" },
        rewardEligible: false,
      });
      expect(await built.claims.list(created.json().id)).toEqual([]);
      expect(await built.claims.negatives(created.json().id)).toEqual([]);
      expect((await built.sessions.getById(created.json().id))!.discovery).toEqual(before);
    },
  );

  it("rejects a client-manufactured confirmed placement", async () => {
    const built = buildServer();
    const created = await built.app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = `jc_session=${created.cookies.find((value) => value.name === "jc_session")!.value}`;
    const response = await built.app.inject({
      method: "POST",
      url: "/onboarding/discovery/production/evaluate",
      headers: { cookie },
      payload: { placement },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: "placement_not_confirmed" },
      rewardEligible: false,
    });
  });

  it.each(["IT Project Manager", "Product Manager", "Orbital Farm Planner"])(
    "keeps default composition honestly unavailable for %s",
    async (targetRole) => {
      const built = buildServer();
      const created = await built.app.inject({ method: "POST", url: "/sessions/anonymous" });
      const cookie = `jc_session=${created.cookies.find((value) => value.name === "jc_session")!.value}`;
      await built.sessions.setIntent(created.json().id, { targetRole });
      const response = await evaluate(built.app, cookie);
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: "placement_not_confirmed" },
        rewardEligible: false,
      });
    },
  );

  it("uses the persisted version for answers and durably advances coverage", async () => {
    const { app, sessions, cookie, sessionId } = await setup();
    await evaluate(app, cookie);

    const answered = await app.inject({
      method: "POST",
      url: "/onboarding/discovery/production/answer",
      headers: { cookie },
      payload: { itemId: "end-to-end-delivery", answer: "Yes, across two programmes" },
    });
    expect(answered.statusCode).toBe(200);
    expect(answered.json()).toMatchObject({
      floor: placedFamily,
      progress: { complete: 1, remaining: 3 },
      nextQuestion: { itemId: "stakeholder-coordination" },
    });
    expect((await sessions.getById(sessionId))?.discovery.coveredItemIds).toEqual([
      "end-to-end-delivery",
    ]);
  });

  it("treats an explicit negative as allowed coverage and writes completion", async () => {
    const { app, cookie } = await setup([
      "end-to-end-delivery",
      "stakeholder-coordination",
      "risk-dependency-control",
    ]);
    await evaluate(app, cookie);

    const completed = await app.inject({
      method: "POST",
      url: "/onboarding/discovery/production/answer",
      headers: { cookie },
      payload: { itemId: "delivery-communication", answer: "No" },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      checkpoint: "essential_floor_covered",
      progress: { complete: 4, remaining: 0 },
      positiveEvidence: expect.not.arrayContaining([
        expect.objectContaining({ itemId: "delivery-communication" }),
      ]),
      nextQuestion: null,
    });
  });

  it("covers a server-mined semantic equivalent once but excludes unsupported inference", async () => {
    const equivalent = imported("equivalent-a", {
      semantic_key: "end-to-end-delivery",
      machine_touch: "reworded",
      classification: "Derived",
    });
    const duplicate = imported("equivalent-b", {
      semantic_key: "end-to-end-delivery",
      machine_touch: "reworded",
      classification: "Derived",
    });
    const inference = imported("inference", {
      semantic_key: "stakeholder-coordination",
      machine_touch: "inferred",
      classification: "Partially-Supported",
      needs_grill: true,
      grill_hint: "Confirm stakeholder coordination",
    });
    const { app, cookie } = await setup([equivalent, duplicate, inference]);
    const response = await evaluate(app, cookie);
    expect(response.json().positiveEvidence).toEqual([
      { itemId: "end-to-end-delivery", claimId: equivalent.id },
    ]);
    expect(response.json()).toMatchObject({
      progress: { complete: 1, remaining: 3 },
      nextQuestion: { itemId: "stakeholder-coordination" },
    });
  });

  it.each(["memory", "postgres"] as const)(
    "restores the same pinned version and coverage through the %s HTTP composition",
    async (driver) => {
      const { app, cookie } = await setup(["end-to-end-delivery"], driver);
      const started = await evaluate(app, cookie);
      const resumed = await app.inject({
        method: "GET",
        url: "/onboarding/discovery/production",
        headers: { cookie },
      });
      expect(resumed.statusCode).toBe(200);
      expect(resumed.json()).toEqual(started.json());
    },
  );

  it("server-owned completion rejects uncovered and accepts covered production state", async () => {
    const incomplete = await setup();
    await evaluate(incomplete.app, incomplete.cookie);
    expect(
      (
        await incomplete.app.inject({
          method: "POST",
          url: "/onboarding/discovery/production/complete",
          headers: { cookie: incomplete.cookie },
        })
      ).statusCode,
    ).toBe(409);

    const covered = await setup([
      "end-to-end-delivery",
      "stakeholder-coordination",
      "risk-dependency-control",
      "delivery-communication",
    ]);
    await evaluate(covered.app, covered.cookie);
    const completed = await covered.app.inject({
      method: "POST",
      url: "/onboarding/discovery/production/complete",
      headers: { cookie: covered.cookie },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toEqual({
      checkpoint: "essential_floor_covered",
      floor: placedFamily,
    });

    for (const itemId of [
      "end-to-end-delivery",
      "stakeholder-coordination",
      "risk-dependency-control",
      "delivery-communication",
    ]) {
      await covered.claims.reject(covered.sessionId, `source-${itemId}`);
    }
    const stale = await covered.app.inject({
      method: "POST",
      url: "/onboarding/discovery/production/complete",
      headers: { cookie: covered.cookie },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: { code: "essential_floor_not_covered" },
      rewardEligible: false,
    });
    const resumed = await covered.app.inject({
      method: "GET",
      url: "/onboarding/discovery/production",
      headers: { cookie: covered.cookie },
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json()).toMatchObject({
      checkpoint: "family_confirmed",
      progress: { complete: 0, remaining: 4 },
    });
    expect((await covered.sessions.getById(covered.sessionId))?.discovery).toEqual({
      ...mappedPlan,
      coveredItemIds: [],
      checkpoint: "family_confirmed",
    });
    const reconciled = await evaluate(covered.app, covered.cookie);
    expect(reconciled.statusCode).toBe(200);
    expect(reconciled.json()).toMatchObject({
      checkpoint: "family_confirmed",
      progress: { complete: 0, remaining: 4 },
    });
    expect((await covered.sessions.getById(covered.sessionId))?.discovery).toEqual({
      ...mappedPlan,
      coveredItemIds: [],
      checkpoint: "family_confirmed",
    });
  });

  it.each([
    ["POST", "/onboarding/discovery/production/evaluate", undefined],
    ["GET", "/onboarding/discovery/production", undefined],
    [
      "POST",
      "/onboarding/discovery/production/answer",
      { itemId: "end-to-end-delivery", answer: "Yes" },
    ],
    ["POST", "/onboarding/discovery/production/complete", undefined],
  ])("requires a session for %s %s", async (method, url, payload) => {
    const { app } = buildServer({ placeFamily: async () => placement });
    const response = await app.inject({
      method: method as "GET" | "POST",
      url: url as string,
      ...(payload ? { payload } : {}),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "no_session" },
    });
  });

  it("fails closed when persisted discovery JSON is malformed or forged complete", async () => {
    const adapter = newDb().adapters.createPg();
    const pool = new adapter.Pool();
    const sessions = new PgSessionStore(pool);
    const claims = new PgClaimStore(pool);
    await sessions.init();
    await claims.init();
    const built = buildServer({ sessions, claims, placeFamily: async () => placement });
    const created = await built.app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = `jc_session=${created.cookies.find((value) => value.name === "jc_session")!.value}`;

    await pool.query("UPDATE sessions SET production_discovery = $2 WHERE id = $1", [
      created.json().id,
      JSON.stringify({
        questionFloors: [{ familyId: "", version: 0 }],
        searchFamily: null,
        coveredItemIds: [42],
        checkpoint: "essential_floor_covered",
      }),
    ]);
    const malformedResume = await built.app.inject({
      method: "GET",
      url: "/onboarding/discovery/production",
      headers: { cookie },
    });
    expect(malformedResume.statusCode).toBe(409);

    await pool.query("UPDATE sessions SET production_discovery = $2 WHERE id = $1", [
      created.json().id,
      JSON.stringify({
        ...mappedPlan,
        coveredItemIds: [],
        checkpoint: "essential_floor_covered",
      }),
    ]);
    const forgedCompletion = await built.app.inject({
      method: "POST",
      url: "/onboarding/discovery/production/complete",
      headers: { cookie },
    });
    expect(forgedCompletion.statusCode).toBe(409);
    expect(forgedCompletion.json()).toMatchObject({
      error: { code: "essential_floor_not_covered" },
      rewardEligible: false,
    });
  });
});
