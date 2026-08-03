// #114 — the two-part read policy over HTTP, at the pinned API boundary (spec #86's seam 1):
//   1. a curated fixture that fails validation must be told apart from "no fixture at all" — it
//      drops the card and costs NOTHING, rather than silently falling through to a paid model read
//      for an advert someone already hand-curated (see e5stub.ts's lookupAdRequirements).
//   2. an advert whose model read keeps failing must not be re-attempted at full cost on every
//      single deck request for it — makeAdReader's own bounded, escalating-backoff negative cache
//      (adReader.ts) covers every caller of readAd, proven here through the one caller with an
//      existing HTTP test harness (the deck).
// Kept in its own file, not appended to cards.test.ts/routes/onboarding.ts: another session is
// editing both concurrently this session. Helpers below are duplicated from cards.test.ts's own
// #104 describe rather than shared — the house idiom this repo's test files already follow.
import { describe, expect, it } from "vitest";
import type { AdRequirementsV1 } from "@jobcrush/contracts";
import { buildServer } from "../src/server.js";
import { loadPostings, type Posting } from "../src/preview.js";
import { loadAdRequirements, withFixtureOverrideForTest } from "../src/e5stub.js";
import { makeAdReader } from "../src/adReader.js";
import { InMemoryAdRequirementsStore } from "../src/adRequirementsStore.js";
import { readCounters } from "../src/counters.js";
import type { LlmClient } from "../src/llm.js";

interface JobCard {
  adId: string;
}

async function anonSession(app: ReturnType<typeof buildServer>["app"]): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}

const get = (app: ReturnType<typeof buildServer>["app"], cookie: string, url: string) =>
  app.inject({ method: "GET", url, headers: { cookie } });

// Same fixture-first-else-reader predicate resolveAdRequirements (routes/onboarding.ts) uses, and
// the same helper cards.test.ts's own #104 describe defines — module-scoped here too so every test
// below shares one implementation rather than re-deriving it.
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
    {
      id: "own-a-budget",
      band: "essential",
      kind: "ordinary",
      requirement: "Own a project budget",
      sourceSpan: "budget",
    },
  ],
});

describe("#114 GET /onboarding/cards — a corrupt hand-curated fixture", () => {
  it("costs no model call for that advert, drops only its card, counts postings.fixture_invalid once, and the rest of the deck survives at 200", async () => {
    const [target, ...restUncached] = uncachedEnglishPostings();
    if (!target) throw new Error("fixture setup assumption broken: need at least one uncached English posting");
    // Clone a REAL curated entry's shape (same technique e5stub.test.ts's own "drops an unparseable
    // entry" test uses) so only ONE thing about it is wrong: an empty requirements array, which
    // fails AdRequirementsV1's min(1). Reassigned to an adId nobody actually curated, simulating a
    // hand-authored entry for that job that someone got wrong.
    const goodSample = loadAdRequirements("2026-07-05_manulife_senior-it-project-manager-delivery-manager");
    const corrupted = { ...goodSample, adId: target.id, requirements: [] };

    const calls: string[] = [];
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> => {
      calls.push(posting.id);
      return stubRequirements(posting.id);
    };

    const before = readCounters()["postings.fixture_invalid"];
    await withFixtureOverrideForTest(
      (real) => [...real, corrupted],
      async () => {
        const { app } = buildServer({ readAd });
        const cookie = await anonSession(app);
        const res = await get(app, cookie, "/onboarding/cards");
        expect(res.statusCode).toBe(200);
        const body = res.json() as { cards: JobCard[] };

        expect(body.cards.map((c) => c.adId)).not.toContain(target.id); // no card for the corrupt fixture
        expect(calls).not.toContain(target.id); // and no model call was made for it — the AC's core claim

        // the rest of the deck survives — a DIFFERENT, still-uncached posting still gets a card via
        // the (fake) reader, proving the corrupt entry didn't take the whole request down with it.
        const otherUncached = restUncached[0];
        if (otherUncached) expect(body.cards.map((c) => c.adId)).toContain(otherUncached.id);
      },
    );
    expect(readCounters()["postings.fixture_invalid"]).toBe(before + 1); // counted, not silently swallowed
  });

  it("a missing fixture (no entry at all) still falls through to the reader, unchanged — the corrupt case is genuinely NEW behaviour, not a regression of the old one", async () => {
    const uncached = uncachedEnglishPostings()[0]!;
    let called = false;
    const readAd = async (posting: Posting): Promise<AdRequirementsV1 | null> => {
      if (posting.id === uncached.id) called = true;
      return stubRequirements(posting.id);
    };
    const { app } = buildServer({ readAd });
    const cookie = await anonSession(app);
    const res = await get(app, cookie, "/onboarding/cards");
    const body = res.json() as { cards: JobCard[] };
    expect(called).toBe(true); // the reader WAS invoked for a genuinely-missing fixture
    expect(body.cards.map((c) => c.adId)).toContain(uncached.id);
  });
});

describe("#114 GET /onboarding/cards — the negative cache bounds a repeatedly-failing advert's cost", () => {
  it("a second deck request (a different session) makes no further model call for an advert whose read keeps failing, and adReader.read_suppressed moves", async () => {
    const [failing, surviving] = uncachedEnglishPostings();
    if (!failing || !surviving) {
      throw new Error("fixture setup assumption broken: need at least two uncached English postings");
    }
    const store = new InMemoryAdRequirementsStore();
    const calls: string[] = [];
    const llm: LlmClient = {
      async complete(prompt: string) {
        calls.push(prompt);
        if (prompt.includes(failing.excerpt.slice(0, 60))) return "not valid json"; // fails every attempt
        return JSON.stringify({
          language: "en",
          familyFit: { family: "IT Project Manager", confidence: 0.6 },
          requirements: [
            {
              id: "own-a-budget",
              band: "essential",
              kind: "ordinary",
              requirement: "Own a project budget",
              sourceSpan: "budget",
            },
          ],
        });
      },
    };
    const { app } = buildServer({ readAd: makeAdReader(llm, store, ["IT Project Manager"]) });

    const beforeSuppressed = readCounters()["adReader.read_suppressed"];
    const cookie1 = await anonSession(app);
    await get(app, cookie1, "/onboarding/cards");
    // sanity: the failing advert really was attempted (the two-attempt retry loop) on this first request
    expect(calls.filter((p) => p.includes(failing.excerpt.slice(0, 60)))).toHaveLength(2);
    const callsAfterFirstDeck = calls.length;

    const cookie2 = await anonSession(app); // a genuinely different session, same shared advert cache
    const res2 = await get(app, cookie2, "/onboarding/cards");
    expect(res2.statusCode).toBe(200);
    expect(calls.length).toBe(callsAfterFirstDeck); // no further attempt at all for the failing advert
    expect(readCounters()["adReader.read_suppressed"]).toBeGreaterThan(beforeSuppressed);

    const body2 = res2.json() as { cards: JobCard[] };
    expect(body2.cards.map((c) => c.adId)).not.toContain(failing.id); // still no card for it
    expect(body2.cards.map((c) => c.adId)).toContain(surviving.id); // a readable one still renders
  });
});
