// #339 — discovery stops asking people to describe their own work. What is left before "Your CV,
// reviewed" is eligibility only: work rights once per chosen market, and languages once. Every one
// of those offers a "Not sure" ("Ask me later"), and a "Not sure" stores nothing at all.
import { describe, expect, it } from "vitest";
import { PLACEMENT_SCHEMA_VERSION } from "@jobcrush/contracts";
import { buildDeckServer } from "./fixtureDeck.js";
import { buildItProjectDeliveryServer } from "./placedServer.js";
import { initialProductionFamilyFloors } from "../src/familyFloors.js";
import { DECLINE_OPTION } from "../src/eligibilityDiscovery.js";
import type { DiscoveryState } from "../src/discovery.js";

type App = ReturnType<typeof buildDeckServer>["app"];

async function anonSession(app: App): Promise<{ cookie: string; sid: string }> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  const cookie = `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
  const sid = (await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } })).json().id as string;
  return { cookie, sid };
}
const post = (app: App, cookie: string, url: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: { cookie }, payload });

const ROLE = "IT project manager";
const families = initialProductionFamilyFloors().activePublications().map((p) => p.floor);

describe("#339 the floor questions are no longer served", () => {
  it.each(families.map((f) => [f.familyId, f] as const))("%s: none of its floor items is asked or answerable", async (_id, floor) => {
    const { app } = buildDeckServer({
      placeFamily: async () => ({
        schemaVersion: PLACEMENT_SCHEMA_VERSION,
        outcome: "confirmed",
        families: [{ familyId: floor.familyId, version: floor.version }],
        confidence: "certain",
      }),
    });
    const { cookie } = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const floorIds = floor.essentialItems.map((i) => i.id);
    expect(floorIds.length).toBeGreaterThan(0);
    expect(start.questions.filter((q) => floorIds.includes(q.itemId))).toEqual([]);
    const answered = await post(app, cookie, "/onboarding/discovery/answer", { itemId: floorIds[0], answer: "Yes" });
    expect(answered.statusCode).toBe(404);
  });

  it("work rights once per chosen market and languages once — nothing else, even with a CV's job in hand", async () => {
    const { app, store } = buildItProjectDeliveryServer();
    const { cookie, sid } = await anonSession(app);
    await app.inject({
      method: "PUT",
      url: "/sessions/me/intent",
      headers: { cookie },
      payload: { searchAreas: ["Hong Kong", "Sydney"] },
    });
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    const job = await store.create("onboarding", sid);
    await store.update(job.id, {
      progress: {
        miner: { doc: { roles: [{ employer: "Acme", title: "Consultant", dates_as_written: "2020-2022", dates_missing: false }] } },
      },
    });
    const state: DiscoveryState = (
      await app.inject({ method: "GET", url: `/onboarding/discovery?job=${job.id}`, headers: { cookie } })
    ).json();
    expect(state.questions.map((q) => q.itemId)).toEqual([
      "eligibility-work-rights-hong-kong",
      "eligibility-work-rights-australia",
      "eligibility-languages",
    ]);
    expect(state.questions.every((q) => q.options.includes(DECLINE_OPTION))).toBe(true);
  });

  it("no countdown travels on the wire", async () => {
    const { app } = buildItProjectDeliveryServer();
    const { cookie } = await anonSession(app);
    const start = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    expect(start).not.toHaveProperty("essentialRemaining");
  });
});

describe(`#339 "${DECLINE_OPTION}" (the questions' "Not sure") stores nothing`, () => {
  it("leaves no claim of any kind and no eligibility fact, for work rights and languages alike", async () => {
    const { app, claims, eligibility } = buildItProjectDeliveryServer();
    const { cookie, sid } = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    expect(start.questions.length).toBeGreaterThan(0);
    for (const q of start.questions) {
      const res = await post(app, cookie, "/onboarding/discovery/answer", { itemId: q.itemId, answer: DECLINE_OPTION });
      expect(res.statusCode).toBe(200);
    }
    expect(await claims.list(sid)).toEqual([]);
    expect(await eligibility.list(sid)).toEqual([]);
  });

  it("a later 'Not sure' retracts an earlier real answer, and still records nothing in its place", async () => {
    const { app, claims, eligibility } = buildItProjectDeliveryServer();
    const { cookie, sid } = await anonSession(app);
    const start: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();
    const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: workRights.itemId, answer: workRights.options[0] });
    expect(await eligibility.list(sid)).toHaveLength(1);
    await post(app, cookie, "/onboarding/discovery/answer", { itemId: workRights.itemId, answer: DECLINE_OPTION });
    expect(await eligibility.list(sid)).toEqual([]);
    expect(await claims.list(sid)).toEqual([]);
  });
});

describe("#339 the jobs no longer wait for floor coverage", () => {
  it("a session that answered nothing past question 1 is not refused as floor_not_covered", async () => {
    const { app } = buildItProjectDeliveryServer();
    const { cookie } = await anonSession(app);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    const deck = (await app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } })).json();
    expect(deck.retrieval?.code).not.toBe("floor_not_covered");
  });
});
