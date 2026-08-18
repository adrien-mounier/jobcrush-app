import { describe, expect, it, vi } from "vitest";
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
import type { RetrievalRequest } from "../src/postingRetrieval.js";

// #216 — discovery over the PUBLISHED family floors, driven through the routes the web client
// actually calls. Until this ticket there were two engines: the shipped screen asked one question
// set, and a parallel /onboarding/discovery/production/* surface (which no client ever called) was
// the only thing that could write `session.discovery`. That surface is gone and the shipped routes
// reconcile, so every assertion below drives POST /onboarding/discovery/start,
// GET /onboarding/discovery and POST /onboarding/discovery/answer — the visitor's own path — and
// reads the durable record off the session.

const placement = {
  schemaVersion: "2" as const,
  outcome: "confirmed" as const,
  families: [{ familyId: "it-project-delivery", version: 1 }],
  confidence: "certain" as const,
};
const placedFamily = placement.families[0]!;
// #234: a mapped target role's plan — the same family as the one question floor and the search family.
const mappedPlan = { questionFloors: [placedFamily], searchFamily: placedFamily };
const ROLE = "IT project manager";
const NO_OFFER = { declined: false, family: null };

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

type App = ReturnType<typeof buildServer>["app"];

/** Question 1 — the only way into discovery, and what pins the plan. */
const start = (app: App, cookie: string, role = ROLE) =>
  app.inject({
    method: "POST",
    url: "/onboarding/discovery/start",
    headers: { cookie },
    payload: { role },
  });

/** Re-entering the screen: re-derives the plan and re-reconciles coverage from the claims. */
const resume = (app: App, cookie: string) =>
  app.inject({ method: "GET", url: "/onboarding/discovery", headers: { cookie } });

const answer = (app: App, cookie: string, itemId: string, answerText: string) =>
  app.inject({
    method: "POST",
    url: "/onboarding/discovery/answer",
    headers: { cookie },
    payload: { itemId, answer: answerText },
  });

const stored = async (
  sessions: Awaited<ReturnType<typeof setup>>["sessions"],
  sessionId: string,
) => (await sessions.getById(sessionId))!.discovery;

/** The floor items still on screen, in order — eligibility, date-hole and reader questions ride the
 *  same list (eligibilityDiscovery.ts / yearsWorked.ts) and are not what this file is about. */
const floorAsks = (body: { questions: Array<{ itemId: string; eligibility?: unknown }> }) =>
  body.questions.filter((question) => !question.eligibility).map((question) => question.itemId);

describe("#61/#216 discovery over the published family floors", () => {
  it("pins the confirmed published version and restores it on resume", async () => {
    const { app, sessions, cookie, sessionId } = await setup(["end-to-end-delivery"]);

    const started = await start(app, cookie);
    expect(started.statusCode).toBe(200);
    expect(await stored(sessions, sessionId)).toEqual({
      ...mappedPlan,
      coveredItemIds: ["end-to-end-delivery"],
      checkpoint: "family_confirmed",
      fallback: NO_OFFER,
    });

    const resumed = await resume(app, cookie);
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json()).toEqual(started.json());
  });

  // The screen's "answered" test and the checkpoint's "covered" test are deliberately different
  // rules: the screen asks anything she has not answered HERE, coverage counts any source-supported
  // evidence (#235). Mined CV evidence therefore covers an item that is still on her screen — she is
  // asked a question she has already proven, never the other way round.
  it("counts imported evidence as coverage while the screen still asks the question", async () => {
    const { app, sessions, cookie, sessionId } = await setup(["end-to-end-delivery"]);

    const started = await start(app, cookie);
    expect(floorAsks(started.json())).toContain("end-to-end-delivery");
    expect((await stored(sessions, sessionId)).coveredItemIds).toEqual(["end-to-end-delivery"]);
  });

  it("continues an open interview on its pinned version after a newer version is published", async () => {
    const v1 = initialProductionFamilyFloors().get("it-project-delivery", 1)!;
    const v2 = {
      ...v1,
      floor: {
        ...v1.floor,
        version: 2,
        essentialItems: v1.floor.essentialItems.map((item, index) =>
          index === 1 ? { ...item, id: "v2-only-question" } : item,
        ),
      },
    };
    let active = v1;
    const productionFamilyFloors = {
      active: () => active,
      get: (_familyId: string, version: number) => (version === 1 ? v1 : v2),
    } as unknown as ProductionFamilyFloorStore;
    const built = buildServer({
      productionFamilyFloors,
      placeFamily: async () => ({
        ...placement,
        families: [{ familyId: "it-project-delivery", version: active.floor.version }],
      }),
    });
    const created = await built.app.inject({ method: "POST", url: "/sessions/anonymous" });
    const sessionId = created.json().id as string;
    const cookie = `jc_session=${created.cookies.find((value) => value.name === "jc_session")!.value}`;
    await built.claims.seed(sessionId, [imported("end-to-end-delivery")]);

    await start(built.app, cookie);
    active = v2;

    const reentered = await resume(built.app, cookie);
    const answered = await answer(built.app, cookie, "stakeholder-coordination", "Yes");

    expect([reentered.statusCode, answered.statusCode]).toEqual([200, 200]);
    // v2's replacement item is never asked: the pinned version 1 is the interview she is inside.
    expect(floorAsks(reentered.json())).not.toContain("v2-only-question");
    expect(floorAsks(reentered.json())).toContain("stakeholder-coordination");
    expect((await built.sessions.getById(sessionId))!.discovery).toMatchObject({
      ...mappedPlan,
      coveredItemIds: ["end-to-end-delivery", "stakeholder-coordination"],
      checkpoint: "family_confirmed",
    });
  });

  it("writes essential_floor_covered only when every item has allowed coverage", async () => {
    const { app, sessions, cookie, sessionId } = await setup([
      "end-to-end-delivery",
      "stakeholder-coordination",
      "risk-dependency-control",
    ]);

    await start(app, cookie);
    expect((await stored(sessions, sessionId)).checkpoint).toBe("family_confirmed");

    await answer(app, cookie, "delivery-communication", "Yes, weekly to the steering group");
    expect((await stored(sessions, sessionId)).checkpoint).toBe("essential_floor_covered");
  });

  // #235: what used to refuse (unmapped, an unknown version or an unpublished family) now takes the
  // word-search path. With no dated job records there is nothing to interview on either: the screen
  // answers with no floor questions, and nothing is pinned.
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
  ])("sends non-production placement %# to the word path with an empty interview", async (wordPlacement) => {
    const { app, sessions, cookie, sessionId } = await setup(
      [],
      "memory",
      wordPlacement as typeof placement,
    );
    const response = await start(app, cookie);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ family: null, essentialRemaining: 0 });
    expect(floorAsks(response.json())).toEqual([]);
    expect(await stored(sessions, sessionId)).toEqual({
      questionFloors: [],
      searchFamily: null,
      coveredItemIds: [],
      fallback: NO_OFFER,
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
    const response = await start(built.app, cookie);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ family: null });
    expect((await built.sessions.getById(created.json().id))?.discovery.questionFloors).toEqual([]);
  });

  it.each(["Yes, I led delivery", "No"])(
    "an ineligible pinned floor writes nothing and records no claim: %s",
    async (answerText) => {
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

      await start(built.app, cookie);
      const answered = await answer(built.app, cookie, "end-to-end-delivery", answerText);

      // No floor is servable, so there is no item to answer — and the pinned record is untouched.
      expect(answered.statusCode).toBe(404);
      expect(await built.claims.list(created.json().id)).toEqual([]);
      expect(await built.claims.negatives(created.json().id)).toEqual([]);
      expect((await built.sessions.getById(created.json().id))!.discovery).toEqual(before);
    },
  );

  it.each(["IT Project Manager", "Product Manager", "Orbital Farm Planner"])(
    "default composition serves the word path, never a family reveal, for %s",
    async (targetRole) => {
      const built = buildServer();
      const created = await built.app.inject({ method: "POST", url: "/sessions/anonymous" });
      const cookie = `jc_session=${created.cookies.find((value) => value.name === "jc_session")!.value}`;
      const response = await start(built.app, cookie, targetRole);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ family: null });
      expect((await built.sessions.getById(created.json().id))?.discovery).toMatchObject({
        questionFloors: [],
        searchFamily: null,
        checkpoint: null,
      });
    },
  );

  it("uses the persisted version for answers and durably advances coverage", async () => {
    const { app, sessions, cookie, sessionId } = await setup();
    const started = await start(app, cookie);
    expect(floorAsks(started.json())).toEqual([
      "end-to-end-delivery",
      "stakeholder-coordination",
      "risk-dependency-control",
      "delivery-communication",
    ]);

    const answered = await answer(app, cookie, "end-to-end-delivery", "Yes, across two programmes");
    expect(answered.statusCode).toBe(200);
    expect(answered.json()).toMatchObject({ essentialRemaining: 3 });
    expect(floorAsks(answered.json())[0]).toBe("stakeholder-coordination");
    expect((await stored(sessions, sessionId)).coveredItemIds).toEqual(["end-to-end-delivery"]);
  });

  it("treats an explicit negative as allowed coverage and writes completion", async () => {
    const { app, sessions, cookie, sessionId } = await setup([
      "end-to-end-delivery",
      "stakeholder-coordination",
      "risk-dependency-control",
    ]);
    await start(app, cookie);

    const completed = await answer(app, cookie, "delivery-communication", "No");
    expect(completed.statusCode).toBe(200);
    // The "no" is a real answer, not a gap: it closes the item and carries no CV line.
    expect(completed.json().cvLines.map((line: { itemId: string }) => line.itemId)).not.toContain(
      "delivery-communication",
    );
    const discovery = await stored(sessions, sessionId);
    expect(discovery.checkpoint).toBe("essential_floor_covered");
    expect(discovery.coveredItemIds).toContain("delivery-communication");
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
    const { app, sessions, cookie, sessionId } = await setup([equivalent, duplicate, inference]);
    await start(app, cookie);
    // Counted once for the two equivalents; the inferred claim supports nothing.
    expect((await stored(sessions, sessionId)).coveredItemIds).toEqual(["end-to-end-delivery"]);
  });

  it.each(["memory", "postgres"] as const)(
    "restores the same pinned version and coverage through the %s HTTP composition",
    async (driver) => {
      const { app, sessions, cookie, sessionId } = await setup(["end-to-end-delivery"], driver);
      const started = await start(app, cookie);
      const resumed = await resume(app, cookie);
      expect(resumed.statusCode).toBe(200);
      expect(resumed.json()).toEqual(started.json());
      expect(await stored(sessions, sessionId)).toMatchObject({
        ...mappedPlan,
        coveredItemIds: ["end-to-end-delivery"],
        checkpoint: "family_confirmed",
      });
    },
  );

  // #216 AC3 — the checkpoint is RECOMPUTED from the claims on every read, never latched. Coverage
  // that goes away takes the reveal with it on the very next request.
  it("drops the checkpoint back when covered claims stop supporting their items", async () => {
    const covered = await setup([
      "end-to-end-delivery",
      "stakeholder-coordination",
      "risk-dependency-control",
      "delivery-communication",
    ]);
    await start(covered.app, covered.cookie);
    expect((await stored(covered.sessions, covered.sessionId)).checkpoint).toBe(
      "essential_floor_covered",
    );

    for (const itemId of [
      "end-to-end-delivery",
      "stakeholder-coordination",
      "risk-dependency-control",
      "delivery-communication",
    ]) {
      await covered.claims.reject(covered.sessionId, `source-${itemId}`);
    }

    const resumed = await resume(covered.app, covered.cookie);
    expect(resumed.statusCode).toBe(200);
    expect(await stored(covered.sessions, covered.sessionId)).toEqual({
      ...mappedPlan,
      coveredItemIds: [],
      fallback: NO_OFFER,
      checkpoint: "family_confirmed",
    });
  });

  // #216 AC5 — the state #63 is built on. Before this ticket the shipped screen wrote nothing, so
  // every visitor reached the deck on a word search: family null, checkpoint null. She now walks her
  // own interview and the deck retrieves on the family she was interviewed on.
  it("hands /onboarding/cards a non-null family and a covered checkpoint once discovery completes", async () => {
    const requests: RetrievalRequest[] = [];
    const built = buildServer({
      placeFamily: async () => placement,
      retrievePostings: async (input) => {
        requests.push(input);
        return {
          schemaVersion: "4",
          outcome: "provider_unavailable",
          coverage: { providersQueried: [], providersUnavailable: ["test"], complete: false },
          reason: "captured by the test",
          retryable: false,
        };
      },
    });
    const created = await built.app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = `jc_session=${created.cookies.find((value) => value.name === "jc_session")!.value}`;
    await built.app.inject({
      method: "PUT",
      url: "/sessions/me/intent",
      headers: { cookie },
      payload: { targetRole: ROLE, searchArea: "Hong Kong" },
    });

    await start(built.app, cookie);
    for (const itemId of [
      "end-to-end-delivery",
      "stakeholder-coordination",
      "risk-dependency-control",
      "delivery-communication",
    ]) {
      await answer(built.app, cookie, itemId, "Yes, on several programmes");
    }

    const deck = await built.app.inject({
      method: "GET",
      url: "/onboarding/cards",
      headers: { cookie },
    });
    expect(deck.statusCode).toBe(200);
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));
    expect(requests[0]).toMatchObject({
      family: placedFamily,
      questionFloors: [placedFamily],
      checkpoint: "essential_floor_covered",
    });
  });

  it.each([
    ["POST", "/onboarding/discovery/start", { role: ROLE }],
    ["GET", "/onboarding/discovery", undefined],
    ["POST", "/onboarding/discovery/answer", { itemId: "end-to-end-delivery", answer: "Yes" }],
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
    const sessionId = created.json().id as string;
    const cookie = `jc_session=${created.cookies.find((value) => value.name === "jc_session")!.value}`;

    // A malformed row reads as the empty state, so the next touch simply re-derives the plan.
    await pool.query("UPDATE sessions SET production_discovery = $2 WHERE id = $1", [
      sessionId,
      JSON.stringify({
        questionFloors: [{ familyId: "", version: 0 }],
        searchFamily: null,
        coveredItemIds: [42],
        checkpoint: "essential_floor_covered",
      }),
    ]);
    expect((await built.sessions.getById(sessionId))!.discovery.checkpoint).toBeNull();
    const rederived = await start(built.app, cookie);
    expect(rederived.statusCode).toBe(200);
    expect((await built.sessions.getById(sessionId))!.discovery).toMatchObject({
      ...mappedPlan,
      coveredItemIds: [],
      checkpoint: "family_confirmed",
    });

    // A forged completion — a well-formed plan claiming coverage nothing supports — is overwritten
    // by the recomputation, never trusted.
    await pool.query("UPDATE sessions SET production_discovery = $2 WHERE id = $1", [
      sessionId,
      JSON.stringify({
        ...mappedPlan,
        coveredItemIds: [],
        fallback: NO_OFFER,
        checkpoint: "essential_floor_covered",
      }),
    ]);
    const resumed = await resume(built.app, cookie);
    expect(resumed.statusCode).toBe(200);
    expect((await built.sessions.getById(sessionId))!.discovery.checkpoint).toBe("family_confirmed");
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

  it("merges a plural target's essential floors and covers the checkpoint across their union", async () => {
    const betaOnly = { ...REAL.floor.essentialItems[1]!, id: "beta-only-item" };
    const { built, cookie, sessionId } = await wordSetup(
      catalog(
        publicationFor("alpha"),
        publicationFor("beta", [REAL.floor.essentialItems[0]!, betaOnly]),
      ),
      async () => ({
        schemaVersion: "2",
        outcome: "confirmed",
        families: [
          { familyId: "alpha", version: REAL.floor.version },
          { familyId: "beta", version: REAL.floor.version },
        ],
        confidence: "likely",
      }),
      [],
    );

    const started = await start(built.app, cookie);
    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({ essentialRemaining: 5 });
    expect(await stored(built.sessions, sessionId)).toMatchObject({
      questionFloors: [
        { familyId: "alpha", version: REAL.floor.version },
        { familyId: "beta", version: REAL.floor.version },
      ],
      searchFamily: { familyId: "alpha", version: REAL.floor.version },
      checkpoint: "family_confirmed",
    });

    for (const itemId of ITEM_IDS) await answer(built.app, cookie, itemId, "Yes");
    const completed = await answer(built.app, cookie, "beta-only-item", "No");

    expect(completed.json()).toMatchObject({ essentialRemaining: 0 });
    expect((await stored(built.sessions, sessionId)).checkpoint).toBe("essential_floor_covered");
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

    const started = await start(built.app, cookie);
    expect(started.statusCode).toBe(200);
    // 4 alpha items + beta's one own item; beta's shared first item is de-duplicated, never asked twice.
    expect(floorAsks(started.json())).toEqual([...ITEM_IDS, "beta-only-item"]);
    expect(await stored(built.sessions, sessionId)).toMatchObject({
      questionFloors: [
        { familyId: "alpha", version: REAL.floor.version },
        { familyId: "beta", version: REAL.floor.version },
      ],
      searchFamily: null,
    });

    // The shared item, answered once, is covered for BOTH floors.
    const shared = await answer(built.app, cookie, ITEM_IDS[0]!, "Yes, across two programmes");
    expect(shared.json()).toMatchObject({ essentialRemaining: 4 });

    for (const itemId of ITEM_IDS.slice(1)) await answer(built.app, cookie, itemId, "Yes");
    // An explicit negative covers too — the checkpoint spans every floor's items.
    const last = await answer(built.app, cookie, "beta-only-item", "No");
    expect(last.json()).toMatchObject({ essentialRemaining: 0 });
    expect((await stored(built.sessions, sessionId)).checkpoint).toBe("essential_floor_covered");
  });

  it("upgrades a pinned word plan when her family is later published, and only ever in that direction", async () => {
    let placementNow: FamilyPlacement = { schemaVersion: "2", outcome: "unmapped" };
    const { built, cookie, sessionId } = await wordSetup(
      catalog(publicationFor("alpha"), REAL),
      async () => placementNow,
      [{ block: minedBlock("b1", 2015, 2020), familyId: "alpha" }],
    );

    await start(built.app, cookie);
    expect(await stored(built.sessions, sessionId)).toMatchObject({
      questionFloors: [{ familyId: "alpha", version: REAL.floor.version }],
      searchFamily: null,
    });

    // Her role is published as a family. Re-entering discovery re-derives the better plan; she
    // answers ITS floor before the family search runs (the checkpoint resets with the plan).
    placementNow = confirmedInto("it-project-delivery");
    const upgraded = await start(built.app, cookie, "delivery lead");
    expect(upgraded.statusCode).toBe(200);
    expect(await stored(built.sessions, sessionId)).toMatchObject({
      questionFloors: [{ familyId: "it-project-delivery", version: REAL.floor.version }],
      searchFamily: { familyId: "it-project-delivery", version: REAL.floor.version },
      checkpoint: "family_confirmed",
    });

    // The other direction stays pinned: a family plan never downgrades back to a word plan. #216
    // keeps #236's rule — the pin simply wins and she carries on, never an error on her own screen.
    placementNow = { schemaVersion: "2", outcome: "unmapped" };
    const downgraded = await resume(built.app, cookie);
    expect(downgraded.statusCode).toBe(200);
    expect(await stored(built.sessions, sessionId)).toMatchObject({
      questionFloors: [{ familyId: "it-project-delivery", version: REAL.floor.version }],
      searchFamily: { familyId: "it-project-delivery", version: REAL.floor.version },
    });
  });
});
