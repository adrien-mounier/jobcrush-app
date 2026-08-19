// #162 — the worked-out years total, through the live seams: the question asked instead of the
// total, the answer that moves it, and the card that says the bar was not tested.
import { describe, expect, it } from "vitest";
import type { MinedJobBlock } from "@jobcrush/contracts";
import type { AdRequirementsV1 } from "@jobcrush/contracts";
// #63: the deck is fed by retrieval alone now, so the suite builds its server with the curated
// corpus wired at that seam — same adverts, same requirement sets, reached the way production
// reaches them. See fixtureDeck.ts.
import { buildDeckServer as buildServer, injectSettled, liveIdFor } from "./fixtureDeck.js";
import { buildJobCard, buildTailorState } from "../src/deck.js";
import type { Posting } from "../src/preview.js";
import { InMemoryJobBlockStore } from "../src/jobBlockStore.js";
import { InMemoryEligibilityStore, ANY_FAMILY } from "../src/eligibility.js";
import { refreshWorkedYears } from "../src/yearsWorked.js";
import type { DiscoveryState } from "../src/discovery.js";

const ROLE = "IT project manager in Paris";

async function anonSession(app: ReturnType<typeof buildServer>["app"]): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}

const post = (app: ReturnType<typeof buildServer>["app"], cookie: string, url: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: { cookie }, payload: payload as object });

const decision = (value: string) => ({
  value,
  source_quote: value,
  machine_touch: "verbatim" as const,
  classification: "Verified" as const,
});

/** One mined block, ended or open-ended. */
function block(id: string, employer: string, startYear: number, endYear: number | null): MinedJobBlock {
  return {
    id,
    employer: decision(employer),
    title: decision("Regional PM"),
    start: {
      value: { year: startYear, month: 1, precision: "month" },
      source_quote: `Jan ${startYear}`,
      machine_touch: "verbatim",
      classification: "Verified",
    },
    end:
      endYear === null
        ? { value: { state: "unknown" }, source_quote: null, machine_touch: "inferred", classification: "Derived" }
        : {
            value: { state: "ended", date: { year: endYear, month: 12, precision: "month" } },
            source_quote: `Dec ${endYear}`,
            machine_touch: "verbatim",
            classification: "Verified",
          },
    kind: decision("job") as MinedJobBlock["kind"],
  };
}

async function seeded(blocks: MinedJobBlock[]) {
  const jobBlocks = new InMemoryJobBlockStore();
  const eligibility = new InMemoryEligibilityStore();
  await jobBlocks.init();
  const server = buildServer({ jobBlocks, eligibility });
  const cookie = await anonSession(server.app);
  const me = await server.app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
  const sessionId = me.json().id as string;
  await jobBlocks.ingest(sessionId, { schemaVersion: "1", blocks }, "{}");
  // Stands in for the pipeline's own persistJobBlocks door (server.ts), which derives the total the
  // moment records land — this test seeds the store directly, so it derives it the same way.
  await refreshWorkedYears(jobBlocks, eligibility, sessionId);
  return { app: server.app, cookie, sessionId, jobBlocks, eligibility };
}

describe("#162 the question asked instead of the total", () => {
  it("asks for the missing end date, never for the years total (AC3, AC4)", async () => {
    const { app, cookie } = await seeded([block("b1", "Standard Chartered", 2004, null)]);
    const state: DiscoveryState = (await post(app, cookie, "/onboarding/discovery/start", { role: ROLE })).json();

    expect(state.questions.some((q) => q.eligibility?.dimension === "years-experience")).toBe(false);
    const hole = state.questions.find((q) => q.itemId === "job-date-b1")!;
    expect(hole.question).toBe("When did you leave Standard Chartered?");
    expect(hole.consequence).toMatch(/adds nothing to your years of experience/); // #143: the reason, aloud
    expect(hole.options).toEqual([]); // free text — a date, in the person's own words
  });

  it("the answer corrects the record, moves the total, and closes the question (AC5)", async () => {
    const { app, cookie, sessionId, eligibility, jobBlocks } = await seeded([
      block("b1", "Standard Chartered", 2004, null),
    ]);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    expect(await eligibility.numeric(sessionId, "years-experience", ANY_FAMILY)).toBe(0); // unknown end = zero

    const after: DiscoveryState = (
      await post(app, cookie, "/onboarding/discovery/answer", { itemId: "job-date-b1", answer: "December 2023" })
    ).json();

    expect(after.questions.map((q) => q.itemId)).not.toContain("job-date-b1");
    expect(await eligibility.numeric(sessionId, "years-experience", ANY_FAMILY)).toBe(20);
    const stored = (await jobBlocks.list(sessionId))[0]!;
    expect(stored.end.value).toEqual({ state: "ended", date: { year: 2023, month: 12, precision: "month" } });
    expect(stored.end.origin.kind).toBe("corrected"); // a person's answer, never a re-read
  });

  it("refuses an answer it cannot read rather than storing a guess", async () => {
    const { app, cookie, sessionId, eligibility } = await seeded([block("b1", "Standard Chartered", 2004, null)]);
    await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
    const res = await post(app, cookie, "/onboarding/discovery/answer", {
      itemId: "job-date-b1",
      answer: "ages ago",
    });
    expect(res.statusCode).toBe(400);
    expect(await eligibility.numeric(sessionId, "years-experience", ANY_FAMILY)).toBe(0);
  });
});

describe("#162 the total tracks the records underneath", () => {
  it("a correction through the job-block door re-derives the total (AC5)", async () => {
    const { app, cookie, sessionId, eligibility } = await seeded([block("b1", "SC", 2019, 2021)]);
    expect(await eligibility.numeric(sessionId, "years-experience", ANY_FAMILY)).toBe(3);

    await post(app, cookie, "/job-blocks/b1/correct", { key: "kind", value: "education" });
    expect(await eligibility.numeric(sessionId, "years-experience", ANY_FAMILY)).toBe(0); // no longer work (AC2)

    await post(app, cookie, "/job-blocks/b1/detach", undefined);
    expect(await eligibility.numeric(sessionId, "years-experience", ANY_FAMILY)).toBe(0);
  });

  it("a confident zero and an unreadable history read differently on the card (AC6)", async () => {
    const withNoJobs = await seeded([]);
    expect(await withNoJobs.eligibility.numeric(withNoJobs.sessionId, "years-experience", ANY_FAMILY)).toBe(0);

    // Never uploaded anything: nothing was read, so the bar cannot be tested — distinct from a zero.
    const server = buildServer();
    const cookie = await anonSession(server.app);
    const cards = (await server.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } })).json() as {
      cards: Array<{ notTested?: Array<{ id: string }>; matchPct: number | null }>;
    };
    const untested = cards.cards.filter((c) => (c.notTested?.length ?? 0) > 0);
    expect(untested.length).toBeGreaterThan(0); // at least one advert in the pool gates on years
  });
});

// #162 AC6, review must-fixes: an untested bar is named ONCE and named on BOTH card surfaces.
describe("#162 an untested bar is named once, on every surface", () => {
  const posting: Posting = {
    id: "ad-x",
    title: "Regional PM",
    company: "Acme",
    location: "Hong Kong",
    keywords: [],
    excerpt: "8+ years of delivery. Fluent English.",
    language: "en",
  };
  const adReq: AdRequirementsV1 = {
    schemaVersion: "1",
    adId: "ad-x",
    curated: false,
    language: "en",
    familyFit: null,
    requirements: [
      {
        id: "years",
        band: "essential",
        kind: "ordinary",
        requirement: "8+ years of delivery experience",
        eligibilityDimension: "years-experience",
        comparable: { op: ">=", value: 8, unit: "years" },
        sourceSpan: "8+ years of delivery",
      },
      {
        id: "english",
        band: "essential",
        kind: "ordinary",
        requirement: "Fluent English",
        sourceSpan: "Fluent English",
      },
    ],
  } as AdRequirementsV1;

  // #222: "no usable work history" is now the whole years-at-scopes struct with a null total.
  const UNTESTABLE = { total: null, family: null, familySource: "unscoped", familyConfidence: null } as const;

  it("the deck card lists it under notTested and NOT under dontYet", () => {
    const untested = buildJobCard(posting, adReq, [], [], null, "estimated", UNTESTABLE);
    expect(untested.notTested?.map((r) => r.id)).toEqual(["years"]);
    expect(untested.dontYet.map((r) => r.id)).not.toContain("years");
    expect(untested.dontYet.map((r) => r.id)).toContain("english"); // every other gap still shows
  });

  it("leaves the score exactly where a tested session would find it — nothing is lowered", () => {
    const tested = buildJobCard(posting, adReq, [], [], null, "estimated");
    const untested = buildJobCard(posting, adReq, [], [], null, "estimated", UNTESTABLE);
    expect(untested.matchPct).toBe(tested.matchPct);
    expect(untested.breakdown).toEqual(tested.breakdown);
    expect(tested.notTested).toBeUndefined(); // omitted entirely when there is nothing untested
  });

  it("the tailor surface reaches the same verdict as the deck", () => {
    const state = buildTailorState(posting, adReq, [], [], null, 0, null, UNTESTABLE);
    expect(state.card.notTested?.map((r) => r.id)).toEqual(["years"]);
    expect(state.card.dontYet.map((r) => r.id)).not.toContain("years");
  });
});
