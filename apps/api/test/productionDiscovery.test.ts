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
import { recordDiscoveryAnswer } from "../src/discovery.js";
import type { RetrievalRequest } from "../src/postingRetrieval.js";

// #216 — discovery over the PUBLISHED family floors, driven through the routes the web client
// actually calls. Until this ticket there were two engines: the shipped screen asked one question
// set, and a parallel /onboarding/discovery/production/* surface (which no client ever called) was
// the only thing that could write `session.discovery`. That surface is gone and the shipped routes
// reconcile, so every assertion below drives POST /onboarding/discovery/start and
// GET /onboarding/discovery — the visitor's own path — and reads the durable record off the session.
//
// #339: the floors are no longer ASKED — the screen serves eligibility questions only, and the
// answer route takes nothing else. The plan is still pinned and the coverage her claims earn is
// still recorded (it gates nothing now), so coverage below is earned by claims put in the store
// directly: mined evidence (`claims.seed`), or an earlier answer through the one write path that
// still records one (`recordDiscoveryAnswer` — a "no" or a skip).

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

const stored = async (
  sessions: Awaited<ReturnType<typeof setup>>["sessions"],
  sessionId: string,
) => (await sessions.getById(sessionId))!.discovery;

/** The floor items on screen — #339: always none; the eligibility questions are the whole list. */
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

  // Coverage counts any source-supported evidence (#235), so mined CV evidence covers an item.
  // #339: and the screen asks no floor item at all — covered or not.
  it("counts imported evidence as coverage, and the screen asks no floor question (#339)", async () => {
    const { app, sessions, cookie, sessionId } = await setup(["end-to-end-delivery"]);

    const started = await start(app, cookie);
    expect(floorAsks(started.json())).toEqual([]);
    expect((await stored(sessions, sessionId)).coveredItemIds).toEqual(["end-to-end-delivery"]);
  });

  // #339: coverage is still counted against the PINNED version — v2's replacement item earns
  // nothing, v1's own item does — though neither is asked any more.
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
    await built.claims.seed(sessionId, [imported("stakeholder-coordination"), imported("v2-only-question")]);

    const reentered = await resume(built.app, cookie);

    expect(reentered.statusCode).toBe(200);
    expect(floorAsks(reentered.json())).toEqual([]);
    // v2's replacement item is never covered: the pinned version 1 is the interview she is inside.
    expect((await built.sessions.getById(sessionId))!.discovery).toMatchObject({
      ...mappedPlan,
      coveredItemIds: ["end-to-end-delivery", "stakeholder-coordination"],
      checkpoint: "family_confirmed",
    });
  });

  it("writes essential_floor_covered only when every item has allowed coverage", async () => {
    const { app, sessions, claims, cookie, sessionId } = await setup([
      "end-to-end-delivery",
      "stakeholder-coordination",
      "risk-dependency-control",
    ]);

    await start(app, cookie);
    expect((await stored(sessions, sessionId)).checkpoint).toBe("family_confirmed");

    await claims.seed(sessionId, [imported("delivery-communication")]);
    await resume(app, cookie);
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
    expect(response.json()).toMatchObject({ family: null });
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
      const answered = await built.app.inject({
        method: "POST",
        url: "/onboarding/discovery/answer",
        headers: { cookie },
        payload: { itemId: "end-to-end-delivery", answer: answerText },
      });

      // No floor item is answerable (#339: none ever is) — and the pinned record is untouched.
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

  // An explicit "no" closes an item without evidence (#324's closedBy), so it is allowed coverage.
  it("treats an explicit negative as allowed coverage and writes completion", async () => {
    const { app, sessions, claims, cookie, sessionId } = await setup([
      "end-to-end-delivery",
      "stakeholder-coordination",
      "risk-dependency-control",
    ]);
    await start(app, cookie);

    await recordDiscoveryAnswer(claims, sessionId, imported("delivery-communication"), "No");
    const completed = await resume(app, cookie);
    expect(completed.statusCode).toBe(200);
    // The "no" is a real answer, not a gap: it closes the item and carries no CV line.
    expect(completed.json().cvLines.map((line: { itemId: string }) => line.itemId)).not.toContain(
      "delivery-communication",
    );
    const discovery = await stored(sessions, sessionId);
    expect(discovery.checkpoint).toBe("essential_floor_covered");
    expect(discovery.coveredItemIds).toContain("delivery-communication");
  });

  // #324: a skip ("I don't know") stores no fact but is still her answer — recorded rejected, it
  // closes the item for coverage too.
  it("treats a skipped question as allowed coverage and writes completion", async () => {
    const { app, sessions, claims, cookie, sessionId } = await setup([
      "end-to-end-delivery",
      "risk-dependency-control",
      "delivery-communication",
    ]);
    await start(app, cookie);

    await recordDiscoveryAnswer(claims, sessionId, imported("stakeholder-coordination"), "I don't know");
    const completed = await resume(app, cookie);
    expect(completed.statusCode).toBe(200);
    expect(completed.json().cvLines.map((line: { itemId: string }) => line.itemId)).not.toContain(
      "stakeholder-coordination",
    );
    const discovery = await stored(sessions, sessionId);
    expect(discovery.checkpoint).toBe("essential_floor_covered");
    expect(discovery.coveredItemIds).toContain("stakeholder-coordination");
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
  // own interview and the deck retrieves on the family she was interviewed on. #339: the coverage
  // arrives as mined evidence and is reconciled on her next discovery load.
  it("hands /onboarding/cards a non-null family and a covered checkpoint once discovery completes", async () => {
    const requests: RetrievalRequest[] = [];
    const built = buildServer({
      placeFamily: async () => placement,
      retrievePostings: async (input) => {
        requests.push(input);
        return {
          schemaVersion: "5",
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
    await built.claims.seed(
      created.json().id,
      ["end-to-end-delivery", "stakeholder-coordination", "risk-dependency-control", "delivery-communication"].map(
        (itemId) => imported(itemId),
      ),
    );
    await resume(built.app, cookie);

    const deck = await built.app.inject({
      method: "GET",
      url: "/onboarding/cards",
      headers: { cookie },
    });
    expect(deck.statusCode).toBe(200);
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));
    // #246: question 1 now searches too, so the deck's request is the LAST one, not the only one.
    // Its first search already carries the family she was placed into — that is the whole point of
    // pinning the plan before searching — and carries an UNCOVERED checkpoint, because at question
    // 1 she has answered nothing. The deck's own request is the one that must be covered.
    expect(requests[0]).toMatchObject({
      family: placedFamily,
      questionFloors: [placedFamily],
      checkpoint: "family_confirmed",
    });
    expect(requests.at(-1)).toMatchObject({
      family: placedFamily,
      questionFloors: [placedFamily],
      checkpoint: "essential_floor_covered",
    });
  });

  it.each([
    ["POST", "/onboarding/discovery/start", { role: ROLE }],
    ["GET", "/onboarding/discovery", undefined],
    ["POST", "/onboarding/discovery/answer", { itemId: "eligibility-languages", answers: ["English"] }],
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

// #235 — the word-search interview: an unmapped target role is pinned to the floors her own dated
// job records prove (at most two), de-duplicated by item id, with coverage spanning every floor.
// #339: those floors are no longer asked; the pin and the coverage remain.
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
    expect(await stored(built.sessions, sessionId)).toMatchObject({
      questionFloors: [
        { familyId: "alpha", version: REAL.floor.version },
        { familyId: "beta", version: REAL.floor.version },
      ],
      searchFamily: { familyId: "alpha", version: REAL.floor.version },
      checkpoint: "family_confirmed",
    });

    // Alpha's items alone leave beta's own item open — the checkpoint spans the union.
    await built.claims.seed(sessionId, ITEM_IDS.map((itemId) => imported(itemId)));
    await resume(built.app, cookie);
    expect((await stored(built.sessions, sessionId)).checkpoint).toBe("family_confirmed");

    await recordDiscoveryAnswer(built.claims, sessionId, imported("beta-only-item"), "No");
    await resume(built.app, cookie);
    expect((await stored(built.sessions, sessionId)).checkpoint).toBe("essential_floor_covered");
  });

  it("pins her CV's floors, de-duplicates items across them, and covers the checkpoint over all of them", async () => {
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
    expect(floorAsks(started.json())).toEqual([]); // #339: pinned, never asked
    expect(await stored(built.sessions, sessionId)).toMatchObject({
      questionFloors: [
        { familyId: "alpha", version: REAL.floor.version },
        { familyId: "beta", version: REAL.floor.version },
      ],
      searchFamily: null,
    });

    // The shared item, evidenced once, is covered for BOTH floors — and counted once.
    await built.claims.seed(sessionId, [imported(ITEM_IDS[0]!)]);
    await resume(built.app, cookie);
    expect((await stored(built.sessions, sessionId)).coveredItemIds).toEqual([ITEM_IDS[0]]);

    await built.claims.seed(sessionId, ITEM_IDS.slice(1).map((itemId) => imported(itemId)));
    // An explicit negative covers too — the checkpoint spans every floor's items.
    await recordDiscoveryAnswer(built.claims, sessionId, imported("beta-only-item"), "No");
    await resume(built.app, cookie);
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

    // Her role is published as a family. Re-entering discovery re-derives the better plan (the
    // checkpoint resets with the plan).
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
