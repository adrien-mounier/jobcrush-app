import { describe, expect, it } from "vitest";
import type { CandidateClaim, FamilyPlacement, MinedJobBlock } from "@jobcrush/contracts";
import { newDb } from "pg-mem";
import { PgClaimStore } from "../src/claims.js";
import { PgSessionStore } from "../src/sessions.js";
import {
  initialProductionFamilyFloors,
  type ProductionFamilyFloorStore,
  type ProductionFamilyPublicationValue,
} from "../src/familyFloors.js";
import { InMemoryJobBlockStore } from "../src/jobBlockStore.js";
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
      fallback: { declined: false, family: null },
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

  // #235: what used to refuse (unmapped, an unknown version, an unpublished family, a plural
  // placement) now takes the word-search path — one path, three causes. With no dated job records
  // there is nothing to interview on either: the response is the completed empty interview, nothing
  // is pinned, and rewardEligible stays false.
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
  ])("sends non-production placement %# to the word path with an empty interview", async (wordPlacement) => {
    const { app, sessions, cookie, sessionId } = await setup([], "memory", wordPlacement as typeof placement);
    const response = await evaluate(app, cookie);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      rewardEligible: false,
      floor: null,
      progress: { complete: 0, remaining: 0 },
      nextQuestion: null,
      checkpoint: "essential_floor_covered",
    });
    expect((await sessions.getById(sessionId))?.discovery).toEqual({
      questionFloors: [],
      searchFamily: null,
      coveredItemIds: [],
      fallback: { declined: false, family: null },
      checkpoint: null,
    });
  });

  it("a provisional publication exposed by a catalog adapter is never pinned — the word path serves instead", async () => {
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
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      rewardEligible: false,
      floor: null,
      nextQuestion: null,
      checkpoint: "essential_floor_covered",
    });
    expect((await built.sessions.getById(created.json().id))?.discovery.questionFloors).toEqual([]);
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

  it("ignores a client-manufactured confirmed placement — the server's own placement decides", async () => {
    const built = buildServer(); // default placeFamily: unmapped
    const created = await built.app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = `jc_session=${created.cookies.find((value) => value.name === "jc_session")!.value}`;
    const response = await built.app.inject({
      method: "POST",
      url: "/onboarding/discovery/production/evaluate",
      headers: { cookie },
      payload: { placement },
    });
    // #235: the server's unmapped placement takes the word path — the client's payload never pins
    // its manufactured family.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ rewardEligible: false, floor: null });
    expect((await built.sessions.getById(created.json().id))?.discovery.searchFamily).toBeNull();
  });

  it.each(["IT Project Manager", "Product Manager", "Orbital Farm Planner"])(
    "default composition serves the word path, never a reward, for %s",
    async (targetRole) => {
      const built = buildServer();
      const created = await built.app.inject({ method: "POST", url: "/sessions/anonymous" });
      const cookie = `jc_session=${created.cookies.find((value) => value.name === "jc_session")!.value}`;
      await built.sessions.setIntent(created.json().id, { targetRole });
      const response = await evaluate(built.app, cookie);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        rewardEligible: false,
        floor: null,
        checkpoint: "essential_floor_covered",
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
      fallback: { declined: false, family: null },
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
      fallback: { declined: false, family: null },
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
        fallback: { declined: false, family: null },
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

// #235 — the word-search interview: an unmapped target role is asked the floors her own dated job
// records prove (at most two), de-duplicated by item id, with coverage spanning every floor.
describe("#235 the word-search interview", () => {
  const REAL = initialProductionFamilyFloors().get("it-project-delivery", 1)!;
  const ITEM_IDS = REAL.floor.essentialItems.map((item) => item.id);

  const publicationFor = (
    familyId: string,
    essentialItems = REAL.floor.essentialItems,
  ): ProductionFamilyPublicationValue => ({
    ...REAL,
    floor: { ...REAL.floor, familyId, essentialItems },
  });

  const catalog = (...publications: ProductionFamilyPublicationValue[]) =>
    ({
      active: (familyId: string) =>
        publications.find((p) => p.floor.familyId === familyId) ?? null,
      get: (familyId: string, version: number) =>
        publications.find((p) => p.floor.familyId === familyId && p.floor.version === version) ??
        null,
    }) as unknown as ProductionFamilyFloorStore;

  const decision = (value: string) => ({
    value,
    source_quote: value,
    machine_touch: "verbatim" as const,
    classification: "Verified" as const,
  });

  const minedBlock = (id: string, startYear: number, endYear: number): MinedJobBlock => ({
    id,
    employer: decision(`Employer ${id}`),
    title: decision("Regional PM"),
    start: {
      value: { year: startYear, month: 1, precision: "month" },
      source_quote: `Jan ${startYear}`,
      machine_touch: "verbatim",
      classification: "Verified",
    },
    end: {
      value: { state: "ended", date: { year: endYear, month: 12, precision: "month" } },
      source_quote: `Dec ${endYear}`,
      machine_touch: "verbatim",
      classification: "Verified",
    },
    kind: decision("job") as MinedJobBlock["kind"],
  });

  const confirmedInto = (familyId: string): FamilyPlacement => ({
    schemaVersion: "2",
    outcome: "confirmed",
    families: [{ familyId, version: 1 }],
    confidence: "certain",
  });

  async function wordSetup(
    productionFamilyFloors: ProductionFamilyFloorStore,
    placeFamily: () => Promise<FamilyPlacement>,
    labeled: Array<{ block: MinedJobBlock; familyId: string }>,
  ) {
    const jobBlocks = new InMemoryJobBlockStore();
    await jobBlocks.init();
    const built = buildServer({ jobBlocks, productionFamilyFloors, placeFamily });
    const created = await built.app.inject({ method: "POST", url: "/sessions/anonymous" });
    const sessionId = created.json().id as string;
    const cookie = `jc_session=${created.cookies.find((value) => value.name === "jc_session")!.value}`;
    await jobBlocks.ingest(
      sessionId,
      { schemaVersion: "1", blocks: labeled.map((entry) => entry.block) },
      "{}",
    );
    for (const entry of labeled) {
      await jobBlocks.label(sessionId, entry.block.id, confirmedInto(entry.familyId));
    }
    return { built, cookie, sessionId };
  }

  const answer = (
    built: ReturnType<typeof buildServer>,
    cookie: string,
    itemId: string,
    answerText: string,
  ) =>
    built.app.inject({
      method: "POST",
      url: "/onboarding/discovery/production/answer",
      headers: { cookie },
      payload: { itemId, answer: answerText },
    });

  it("asks her CV's floors, de-duplicates items across them, and covers the checkpoint over all of them", async () => {
    const betaOnly = { ...REAL.floor.essentialItems[1]!, id: "beta-only-item" };
    const { built, cookie, sessionId } = await wordSetup(
      catalog(
        publicationFor("alpha"),
        publicationFor("beta", [REAL.floor.essentialItems[0]!, betaOnly]),
      ),
      async () => ({ schemaVersion: "2", outcome: "unmapped" }),
      [
        { block: minedBlock("b1", 2010, 2018), familyId: "alpha" }, // 9 years — strongest first
        { block: minedBlock("b2", 2020, 2021), familyId: "beta" },
      ],
    );

    const started = await evaluate(built.app, cookie);
    expect(started.statusCode).toBe(200);
    // 4 alpha items + beta's one own item; beta's shared first item is de-duplicated, never asked twice.
    expect(started.json()).toMatchObject({
      floor: { familyId: "alpha", version: REAL.floor.version },
      progress: { complete: 0, remaining: 5 },
      checkpoint: "family_confirmed",
    });
    expect((await built.sessions.getById(sessionId))?.discovery).toMatchObject({
      questionFloors: [
        { familyId: "alpha", version: REAL.floor.version },
        { familyId: "beta", version: REAL.floor.version },
      ],
      searchFamily: null,
    });

    // The shared item, answered once, is covered for BOTH floors.
    const shared = await answer(built, cookie, ITEM_IDS[0]!, "Yes, across two programmes");
    expect(shared.json()).toMatchObject({ progress: { complete: 1, remaining: 4 } });

    for (const itemId of ITEM_IDS.slice(1)) {
      await answer(built, cookie, itemId, "Yes");
    }
    // An explicit negative covers too — the checkpoint spans every floor's items.
    const last = await answer(built, cookie, "beta-only-item", "No");
    expect(last.json()).toMatchObject({
      progress: { complete: 5, remaining: 0 },
      checkpoint: "essential_floor_covered",
    });
    expect((await built.sessions.getById(sessionId))?.discovery.checkpoint).toBe(
      "essential_floor_covered",
    );
  });

  it("upgrades a pinned word plan when her family is later published, and only ever in that direction", async () => {
    let placementNow: FamilyPlacement = { schemaVersion: "2", outcome: "unmapped" };
    const { built, cookie, sessionId } = await wordSetup(
      catalog(publicationFor("alpha"), REAL),
      async () => placementNow,
      [{ block: minedBlock("b1", 2015, 2020), familyId: "alpha" }],
    );

    await evaluate(built.app, cookie);
    expect((await built.sessions.getById(sessionId))?.discovery).toMatchObject({
      questionFloors: [{ familyId: "alpha", version: REAL.floor.version }],
      searchFamily: null,
    });

    // Her role is published as a family. Re-entering discovery re-derives the better plan; she
    // answers ITS floor before the family search runs (the checkpoint resets with the plan).
    placementNow = confirmedInto("it-project-delivery");
    const upgraded = await evaluate(built.app, cookie);
    expect(upgraded.statusCode).toBe(200);
    expect((await built.sessions.getById(sessionId))?.discovery).toMatchObject({
      questionFloors: [{ familyId: "it-project-delivery", version: REAL.floor.version }],
      searchFamily: { familyId: "it-project-delivery", version: REAL.floor.version },
      checkpoint: "family_confirmed",
    });

    // The other direction stays pinned: a family plan never downgrades back to a word plan. #236
    // changed HOW that holds — the pin simply wins and she carries on, instead of a 409 on her own
    // interview. The candidate screen pins families the labeler still answers "unmapped" for, so
    // erroring here would break the recovered visitor's normal family search.
    placementNow = { schemaVersion: "2", outcome: "unmapped" };
    const downgraded = await evaluate(built.app, cookie);
    expect(downgraded.statusCode).toBe(200);
    expect((await built.sessions.getById(sessionId))?.discovery).toMatchObject({
      questionFloors: [{ familyId: "it-project-delivery", version: REAL.floor.version }],
      searchFamily: { familyId: "it-project-delivery", version: REAL.floor.version },
    });
  });
});
