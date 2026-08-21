import { describe, expect, it, vi } from "vitest";
import type {
  PostingProviderPolicyV1,
  ProviderPostingRecordV1,
} from "@jobcrush/contracts";
import {
  initialProductionFamilyFloors,
  type ProductionFamilyFloorStore,
} from "../src/familyFloors.js";
import {
  assertEveryActiveProviderIsImplemented,
  coveredRegionCodes,
  deckReadIsAuthorized,
  makePostingRetriever,
  providersFor,
  retrievalFingerprint,
  isReusableRetrievalSnapshot,
  resolveSearchArea,
  resolveSearchAreaToRegions,
  storeBackedPostingProvidersFor,
  StoreBackedCuratedPostingProvider,
  type RetrievalRequest,
} from "../src/postingRetrieval.js";
import { TestFixturePostingProvider, type PostingProvider } from "../src/postingProvider.js";
import { InMemoryPostingStore } from "../src/postingStore.js";
import { loadPostings, sessionPostings } from "../src/preview.js";
import type { SessionRecord } from "../src/sessions.js";
import { dedupePostings, loadActivePostingProviders } from "../src/postings.js";

const policy = (
  providerId: string,
  regionsServed: string[],
  authorityRank: number,
  freshnessTtlHours = 24,
): PostingProviderPolicyV1 => ({
  schemaVersion: "2",
  providerId,
  regionsServed,
  authorityRank,
  permitsStorage: true,
  permitsMatching: true,
  attributionRequired: false,
  attributionTemplate: null,
  rateLimit: { perSecond: null, perMinute: null, perDay: null, perMonth: null },
  retry: { maxAttempts: 1, backoffMs: 0 },
  timeoutMs: 1000,
  costModel: { kind: "operatorHours" },
  freshnessTtlHours,
});

const record = (
  providerId: string,
  providerPostingId: string,
  over: Partial<ProviderPostingRecordV1> = {},
): ProviderPostingRecordV1 => ({
  schemaVersion: "3",
  providerId,
  providerPostingId,
  title: "IT Project Manager",
  company: "Acme",
  location: "Hong Kong",
  sourceUrl: `https://example.com/${providerPostingId}`,
  excerpt: "Lead delivery across regional teams",
  postedAt: "2026-08-01T00:00:00.000Z",
  capturedAt: "2026-08-09T00:00:00.000Z",
  verifiedLiveAt: "2026-08-09T00:00:00.000Z",
  expiresAt: null,
  attribution: null,
  skills: ["delivery"],
  language: "en",
  ...over,
});

const request = (over: Partial<RetrievalRequest> = {}): RetrievalRequest => ({
  targetRole: "IT Project Manager",
  searchAreas: ["Hong Kong"],
  family: { familyId: "it-project-delivery", version: 1 },
  fallback: false,
  questionFloors: [{ familyId: "it-project-delivery", version: 1 }],
  checkpoint: "essential_floor_covered",
  confirmedEvidence: [{ semanticKey: "risk-control", fieldLabel: "Risk control" }],
  explicitNegatives: [],
  ...over,
});

// #235: the word search — no search family; the interview floors came from her CV.
const wordRequest = (over: Partial<RetrievalRequest> = {}): RetrievalRequest =>
  request({ family: null, ...over });

describe("#101 provider routing", () => {
  it.each([
    ["Hong Kong", ["HK"]],
    ["HK", ["HK"]],
    ["Ho Chi Minh City", ["VN"]],
    ["Sydney", ["AU"]],
    ["somewhere else", []],
  ])("resolves %s without geocoding", (area, expected) => {
    expect(resolveSearchAreaToRegions(area)).toEqual(expected);
  });

  it("selects intersections and wildcard providers in authority order", () => {
    const registry = [policy("later", ["HK"], 3), policy("wildcard", ["*"], 0), policy("vn", ["VN"], 1)];
    expect(providersFor(["HK"], registry).map((entry) => entry.providerId)).toEqual([
      "wildcard",
      "later",
    ]);
  });

  it("includes the authorization checkpoint in the request fingerprint", () => {
    expect(retrievalFingerprint(request({ checkpoint: "family_confirmed" }))).not.toBe(
      retrievalFingerprint(request({ checkpoint: "essential_floor_covered" })),
    );
  });
});

// #184 — the search-area intent route's resolver: robustness (AC2), the registry-sourced coverage
// list (AC1/AC3), and the placeholder-city-slug compat note this suite pins the vocabulary for.
describe("#184 resolveSearchArea", () => {
  // #214: rows also pin regionCode and the city column — the canonical city when the typed words
  // name one (HK/SG city-states stay null), and label = city ?? market.
  it.each([
    ["Hong Kong", "Hong Kong", "hong-kong", "HK", null],
    ["Sydney, Australia", "Australia", "australia", "AU", "Sydney"], // AC2: trailing country
    ["hong kong,", "Hong Kong", "hong-kong", "HK", null], // AC2: stray punctuation + case
    ["  Singapore  ", "Singapore", "singapore", "SG", null], // AC2: stray whitespace
    ["HK", "Hong Kong", "hong-kong", "HK", null], // AC2: common alias
    ["Ho Chi Minh City, Vietnam.", "Vietnam", "vietnam", "VN", "Ho Chi Minh City"], // AC2: city + trailing country + period
    // AC5, pinned verbatim (not just a substring check, per spec review): the search-area field's own
    // placeholder text ("e.g. Hong Kong, or Remote in Vietnam", apps/web/app/page.tsx) — both examples
    // the product itself suggests must resolve. "Hong Kong" is already the first case above; listed
    // again here, explicitly, so this row's OWN reason for existing is legible without cross-reading.
    ["Hong Kong", "Hong Kong", "hong-kong", "HK", null],
    ["Remote in Vietnam", "Vietnam", "vietnam", "VN", null],
    // #184 QA residual: two named-uncovered inputs from #172's own list — obvious district/airport
    // aliases, not covered by the city/country names alone. "Kowloon" is a district of the one HK
    // city, deliberately country-level (#214), never a city filter.
    ["Kowloon", "Hong Kong", "hong-kong", "HK", null],
    ["HKG", "Hong Kong", "hong-kong", "HK", null],
    ["Saigon", "Vietnam", "vietnam", "VN", "Ho Chi Minh City"], // flagged alongside the above as an equally clear-cut gap
  ])("%s resolves and confirms back as its country-level market (AC2)", (typed, market, marketKey, regionCode, city) => {
    expect(resolveSearchArea(typed)).toEqual({
      covered: true,
      market,
      marketKey,
      regionCode,
      city,
      label: city ?? market,
    });
  });

  it("an uncovered area gets the registry-sourced coverage list (AC1)", () => {
    expect(resolveSearchArea("Bangkok")).toEqual({
      covered: false,
      coverage: ["Hong Kong", "Singapore", "Vietnam", "Australia"],
    });
  });

  it("the coverage list comes from the REGISTRY, not a hard-coded copy — a new region appears with no code change (AC3)", () => {
    const registry = [policy("future-provider", ["HK", "TH"], 1)]; // hypothetical: Thailand added
    expect(resolveSearchArea("nowhere-recognisable", registry)).toEqual({
      covered: false,
      coverage: ["Hong Kong", "TH"], // an unmapped code still shows (visibly), never a crash
    });
  });

  it("the wildcard '*' registry entry never counts as a covered region on its own", () => {
    expect(coveredRegionCodes([policy("curated-pool", ["*"], 0)])).toEqual([]);
  });

  it("genuinely unrecognisable text stays uncovered, never a guess", () => {
    expect(resolveSearchArea("asdkjfh")).toMatchObject({ covered: false });
  });
});

describe("#101 posting retrieval service", () => {
  const now = () => new Date("2026-08-09T12:00:00.000Z");

  function build(
    registry: PostingProviderPolicyV1[],
    providers: TestFixturePostingProvider[],
    dedupe = dedupePostings,
  ) {
    const store = new InMemoryPostingStore();
    return {
      store,
      retrieve: makePostingRetriever({
        registry,
        providers,
        store,
        productionFamilyFloors: initialProductionFamilyFloors(),
        now,
        dedupe,
      }),
    };
  }

  it.each([
    [request({ targetRole: null }), "missing_intent"],
    [request({ family: { familyId: "unknown", version: 1 } }), "family_not_published"],
    [request({ searchAreas: ["Atlantis"] }), "search_area_not_covered"],
    // #235: the word search keeps every non-family gate — intent and the search area still refuse
    // with today's codes.
    // #248: `floor_not_covered` is NOT among them any more. Whether she has earned her reveal is no
    // longer asked here — the fetch answers "may I fetch?", the deck answers "may she see it?".
    // The coverage arm moved to deckReadIsAuthorized and is tested below and in deckRetrieval.test.
    [wordRequest({ targetRole: null }), "missing_intent"],
    [wordRequest({ searchAreas: ["Atlantis"] }), "search_area_not_covered"],
  ] as const)("returns the specific invalid arm", async (input, code) => {
    const { retrieve } = build([policy("one", ["HK"], 1)], []);
    await expect(retrieve(input)).resolves.toEqual({
      schemaVersion: "4",
      outcome: "invalid_request",
      code,
    });
  });

  // #235 (spec #233 decision 4): no search family is the word search, not a refusal —
  // `family_not_published` is no longer produced on any visitor path.
  it("word mode returns adverts for a visitor with no family, through the same providers", async () => {
    const registry = [policy("one", ["HK"], 1)];
    const providers = [new TestFixturePostingProvider("one", { ok: true, records: [record("one", "a")] })];
    const { retrieve } = build(registry, providers);

    const word = await retrieve(wordRequest());
    expect(word).toMatchObject({
      outcome: "relevant_postings",
      coverage: { providersQueried: ["one"], providersUnavailable: [], complete: true },
    });

    // The same providers, the same shared budget path — no second cap, no second failure message:
    // family mode over the identical registry queries the identical provider set.
    const family = await build(registry, providers).retrieve(request());
    expect(family).toMatchObject({
      outcome: "relevant_postings",
      coverage: { providersQueried: ["one"], providersUnavailable: [], complete: true },
    });
  });

  it("a visitor with no question floors reaches word retrieval once her intent is stated", async () => {
    const { retrieve } = build(
      [policy("one", ["HK"], 1)],
      [new TestFixturePostingProvider("one", { ok: true, records: [record("one", "a")] })],
    );
    await expect(
      retrieve(wordRequest({ questionFloors: [], checkpoint: null })),
    ).resolves.toMatchObject({ outcome: "relevant_postings" });
  });

  // #235 (spec #233 decision 5): the fingerprint covers the mode and the question floors, so a
  // session that gains a search family — or a floor — can never be served its stale word snapshot.
  it("fingerprints a word search differently from a family search, and covers the floors", () => {
    expect(retrievalFingerprint(wordRequest())).not.toBe(retrievalFingerprint(request()));
    expect(retrievalFingerprint(wordRequest({ questionFloors: [] }))).not.toBe(
      retrievalFingerprint(wordRequest()),
    );
  });

  it("audits every fresh/stale decision with stable metadata and no record text", async () => {
    const auditFreshness = vi.fn();
    const retrieve = makePostingRetriever({
      registry: [policy("one", ["HK"], 1)],
      providers: [
        new TestFixturePostingProvider("one", {
          ok: true,
          records: [
            record("one", "fresh", { excerpt: "secret-token-789" }),
            record("one", "stale", {
              title: "secret-title-789",
              verifiedLiveAt: "2026-08-08T11:59:59.000Z",
            }),
          ],
        }),
      ],
      store: new InMemoryPostingStore(),
      productionFamilyFloors: initialProductionFamilyFloors(),
      now,
      auditFreshness,
    });

    await expect(retrieve(request())).resolves.toMatchObject({ outcome: "relevant_postings" });
    expect(auditFreshness.mock.calls).toEqual([
      [{ providerId: "one", checkedAt: "2026-08-09T12:00:00.000Z", status: "fresh" }],
      [{ providerId: "one", checkedAt: "2026-08-09T12:00:00.000Z", status: "stale" }],
    ]);
    expect(JSON.stringify(auditFreshness.mock.calls)).not.toContain("secret-token-789");
    expect(JSON.stringify(auditFreshness.mock.calls)).not.toContain("secret-title-789");
  });

  it.each(["provisional", "fixture"])("rejects a present but %s family publication", async (kind) => {
    const floors = initialProductionFamilyFloors();
    const active = floors.get("it-project-delivery", 1)!;
    const publication =
      kind === "provisional"
        ? { ...active, publicationStatus: "provisional" as const }
        : {
            ...active,
            floor: { ...active.floor, source: "test_fixture" as const, productionRewardEligible: false },
          };
    const retrieve = makePostingRetriever({
      registry: [policy("one", ["HK"], 1)],
      providers: [],
      store: new InMemoryPostingStore(),
      productionFamilyFloors: { get: () => publication } as unknown as ProductionFamilyFloorStore,
      now,
    });
    await expect(retrieve(request())).resolves.toEqual({
      schemaVersion: "4",
      outcome: "invalid_request",
      code: "family_not_published",
    });
  });

  it("fans out concurrently, stores successes, and dedupes exactly once after all providers settle", async () => {
    const registry = [policy("one", ["HK"], 1), policy("two", ["HK"], 2)];
    let firstDone = false;
    const first = {
      providerId: "one",
      fetch: vi.fn(async () => {
        await Promise.resolve();
        firstDone = true;
        return { ok: true as const, records: [record("one", "1")] };
      }),
    };
    const second = {
      providerId: "two",
      fetch: vi.fn(async () => {
        expect(first.fetch).toHaveBeenCalledOnce();
        return { ok: true as const, records: [record("two", "2")] };
      }),
    };
    const dedupe = vi.fn((records: ProviderPostingRecordV1[]) => {
      expect(firstDone).toBe(true);
      expect(second.fetch).toHaveBeenCalledOnce();
      return dedupePostings(records, registry);
    });
    const store = new InMemoryPostingStore();
    const retrieve = makePostingRetriever({
      registry,
      providers: [first, second],
      store,
      productionFamilyFloors: initialProductionFamilyFloors(),
      now,
      dedupe,
    });

    const result = await retrieve(request());
    expect(result).toMatchObject({
      outcome: "relevant_postings",
      coverage: { providersQueried: ["one", "two"], providersUnavailable: [], complete: true },
    });
    expect(dedupe).toHaveBeenCalledOnce();
    expect(await store.listByProvider("one")).toHaveLength(1);
    expect(await store.listByProvider("two")).toHaveLength(1);
  });

  // #214: one deck over the UNION of the selected targets' regions — an eligible provider is
  // fetched once per region it serves out of that union — and option 2's city filter: a city-level
  // selection keeps records stating that city or no recognisable city, and drops a DIFFERENT city;
  // a country-level selection keeps everything in its region.
  it("unions selected regions, fetches once per served region, and applies the city-level filter", async () => {
    const provider = {
      providerId: "one",
      fetch: vi.fn(async ({ regionCode }: { regionCode: string }) => ({
        ok: true as const,
        records:
          regionCode === "AU"
            ? [
                record("one", "mel", { location: "Melbourne, Australia" }),
                record("one", "syd", { location: "Sydney, Australia" }),
                record("one", "remote-au", { location: "Remote — Australia" }),
              ]
            : [record("one", "hk", { location: "Hong Kong" })],
      })),
    };
    const store = new InMemoryPostingStore();
    const retrieve = makePostingRetriever({
      registry: [policy("one", ["HK", "AU"], 1)],
      providers: [provider],
      store,
      productionFamilyFloors: initialProductionFamilyFloors(),
      now,
    });
    const result = await retrieve(request({ searchAreas: ["Melbourne", "Hong Kong"] }));
    expect(provider.fetch.mock.calls.map(([input]) => input.regionCode).sort()).toEqual(["AU", "HK"]);
    expect(result).toMatchObject({
      outcome: "relevant_postings",
      coverage: { providersQueried: ["one"], providersUnavailable: [], complete: true },
    });
    const kept = (result as { postings: Array<{ location: string }> }).postings.map((p) => p.location).sort();
    expect(kept).toEqual(["Hong Kong", "Melbourne, Australia", "Remote — Australia"]);
  });

  // #214: a provider failing ANY of its per-region fetches counts as that provider failing, and the
  // failure is retryable when any failed region's failure was retryable.
  it("counts a provider failing one region of the union as a failed provider", async () => {
    const provider = {
      providerId: "one",
      fetch: vi.fn(async ({ regionCode }: { regionCode: string }) =>
        regionCode === "AU"
          ? { ok: false as const, reason: "timeout", retryable: true }
          : { ok: true as const, records: [record("one", "hk", { location: "Hong Kong" })] },
      ),
    };
    const retrieve = makePostingRetriever({
      registry: [policy("one", ["HK", "AU"], 1)],
      providers: [provider],
      store: new InMemoryPostingStore(),
      productionFamilyFloors: initialProductionFamilyFloors(),
      now,
    });
    await expect(retrieve(request({ searchAreas: ["Sydney", "Hong Kong"] }))).resolves.toMatchObject({
      outcome: "provider_unavailable",
      coverage: { providersQueried: [], providersUnavailable: ["one"], complete: false },
      retryable: true,
    });
  });

  it("takes the freshness clock after delayed provider I/O", async () => {
    let clock = new Date("2026-08-09T12:00:00.000Z");
    const provider = {
      providerId: "one",
      fetch: vi.fn(async () => {
        clock = new Date("2026-08-09T12:01:00.000Z");
        return {
          ok: true as const,
          records: [record("one", "delayed", { verifiedLiveAt: clock.toISOString() })],
        };
      }),
    };
    const retrieve = makePostingRetriever({
      registry: [policy("one", ["HK"], 1)],
      providers: [provider],
      store: new InMemoryPostingStore(),
      productionFamilyFloors: initialProductionFamilyFloors(),
      now: () => clock,
    });
    await expect(retrieve(request())).resolves.toMatchObject({
      outcome: "relevant_postings",
      retrievedAt: "2026-08-09T12:01:00.000Z",
    });
  });

  it("keeps partial successes relevant and qualifies failed providers", async () => {
    const { retrieve } = build(
      [policy("one", ["HK"], 1), policy("two", ["HK"], 2)],
      [
        new TestFixturePostingProvider("one", { ok: true, records: [record("one", "1")] }),
        new TestFixturePostingProvider("two", { ok: false, reason: "timeout", retryable: true }),
      ],
    );
    await expect(retrieve(request())).resolves.toMatchObject({
      outcome: "relevant_postings",
      coverage: { providersQueried: ["one"], providersUnavailable: ["two"], complete: false },
    });
  });

  it("returns empty_pool only for a complete certified zero", async () => {
    const { retrieve } = build(
      [policy("one", ["HK"], 1)],
      [new TestFixturePostingProvider("one", { ok: true, records: [] })],
    );
    await expect(retrieve(request())).resolves.toMatchObject({
      outcome: "empty_pool",
      coverage: { complete: true },
    });
  });

  it("returns provider_unavailable for an incomplete zero", async () => {
    const { retrieve } = build(
      [policy("one", ["HK"], 1)],
      [new TestFixturePostingProvider("one", { ok: false, reason: "budget exhausted", retryable: true })],
    );
    await expect(retrieve(request())).resolves.toMatchObject({
      outcome: "provider_unavailable",
      coverage: { providersQueried: [], providersUnavailable: ["one"], complete: false },
      reason: "one: provider unavailable",
      retryable: true,
    });
  });

  it("returns provider_unavailable when one provider is stale and another is unavailable", async () => {
    const { retrieve } = build(
      [policy("one", ["HK"], 1), policy("two", ["HK"], 2)],
      [
        new TestFixturePostingProvider("one", {
          ok: true,
          records: [record("one", "stale", { verifiedLiveAt: "2026-08-08T11:59:59.000Z" })],
        }),
        new TestFixturePostingProvider("two", { ok: false, reason: "timeout", retryable: true }),
      ],
    );
    await expect(retrieve(request())).resolves.toMatchObject({
      outcome: "provider_unavailable",
      coverage: { providersQueried: ["one"], providersUnavailable: ["two"], complete: false },
      reason: "two: provider unavailable",
      retryable: true,
    });
  });

  it("marks a posting-store outage unavailable with a distinguishable reason", async () => {
    const store = new InMemoryPostingStore();
    store.upsert = async () => {
      throw new Error("database offline");
    };
    const logFailure = vi.fn();
    const retrieve = makePostingRetriever({
      registry: [policy("one", ["HK"], 1)],
      providers: [new TestFixturePostingProvider("one", { ok: true, records: [record("one", "1")] })],
      store,
      productionFamilyFloors: initialProductionFamilyFloors(),
      now,
      logFailure,
    });
    const result = await retrieve(request());
    expect(result).toMatchObject({
      outcome: "provider_unavailable",
      reason: "one: provider unavailable",
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain("database offline");
    expect(logFailure).toHaveBeenCalledWith("one", "store_failure");
  });

  it("does not expose a provider's secret-bearing failure reason", async () => {
    const logFailure = vi.fn();
    const retrieve = makePostingRetriever({
      registry: [policy("one", ["HK"], 1)],
      providers: [
        new TestFixturePostingProvider("one", {
          ok: false,
          reason: "upstream rejected secret-token-123",
          retryable: false,
        }),
      ],
      store: new InMemoryPostingStore(),
      productionFamilyFloors: initialProductionFamilyFloors(),
      now,
      logFailure,
    });
    const result = await retrieve(request());
    expect(JSON.stringify(result)).not.toContain("secret-token-123");
    expect(result).toMatchObject({ reason: "one: provider unavailable", retryable: false });
    expect(logFailure).toHaveBeenCalledWith("one", "provider_failure");
    expect(JSON.stringify(logFailure.mock.calls)).not.toContain("secret-token-123");
  });

  it.each([
    { verifiedLiveAt: "2026-08-08T11:59:59.000Z" },
    { expiresAt: "2026-08-09T11:59:59.000Z" },
  ])("returns stale_data when the only records fail freshness", async (over) => {
    const { retrieve } = build(
      [policy("one", ["HK"], 1)],
      [new TestFixturePostingProvider("one", { ok: true, records: [record("one", "1", over)] })],
    );
    await expect(retrieve(request())).resolves.toEqual({
      schemaVersion: "4",
      outcome: "stale_data",
      lastKnownFreshAt: expect.any(String),
      retrievedAt: "2026-08-09T12:00:00.000Z",
    });
  });

  it("sends job titles only — never evidence labels (#240 AC3) or raw claim text — and negatives only suppress", async () => {
    const provider = {
      providerId: "one",
      fetch: vi.fn(async (input) => ({
        ok: true as const,
        records: [
          record("one", "allowed", { skills: ["delivery"] }),
          record("one", "suppressed", { title: "Java Developer", skills: ["java"] }),
        ],
      })),
    };
    const store = new InMemoryPostingStore();
    const retrieve = makePostingRetriever({
      registry: [policy("one", ["HK"], 1)],
      providers: [provider],
      store,
      productionFamilyFloors: initialProductionFamilyFloors(),
      now,
    });
    const result = await retrieve(
      request({
        confirmedEvidence: [{ semanticKey: "banking-delivery", fieldLabel: "Banking delivery" }],
        explicitNegatives: [{ semanticKey: "java", fieldLabel: "Java", fieldValue: "java" }],
      }),
    );
    const sent = JSON.stringify(provider.fetch.mock.calls[0]);
    expect(sent).toContain("IT Project Manager");
    expect(sent).not.toContain("Banking"); // #240 decision 3: her facts decide the score, not the catch
    expect(sent).not.toContain("Java");
    expect(sent).not.toContain("raw secret claim text");
    expect(result).toMatchObject({ outcome: "relevant_postings", postings: [{ title: "IT Project Manager" }] });
  });

  // #240 AC4/AC5: the query carries her typed target role PLUS her family's titles for THAT market,
  // de-duplicated — one rule, no "only if her title is rare" branch, and one call per region.
  it.each([
    ["Delivery Lead", ["Delivery Lead", "project manager"]], // Mei: a title Hong Kong does not use
    ["Project Manager", ["Project Manager"]], // Sofia: hers already IS the market's word — no duplicate
  ])("carries the family's market job titles alongside the typed role %s", async (targetRole, expected) => {
    const provider = { providerId: "one", fetch: vi.fn(async () => ({ ok: true as const, records: [] })) };
    const retrieve = makePostingRetriever({
      registry: [policy("one", ["HK"], 1)],
      providers: [provider],
      store: new InMemoryPostingStore(),
      productionFamilyFloors: initialProductionFamilyFloors(),
      now,
    });
    await retrieve(request({ targetRole }));
    expect(provider.fetch.mock.calls).toHaveLength(1);
    expect(provider.fetch.mock.calls[0]![0].queryKeywords).toEqual(expected);
  });

  it("asks each market with its own words, in one call per region", async () => {
    const provider = { providerId: "one", fetch: vi.fn(async () => ({ ok: true as const, records: [] })) };
    const retrieve = makePostingRetriever({
      registry: [policy("one", ["HK", "AU"], 1)],
      providers: [provider],
      store: new InMemoryPostingStore(),
      productionFamilyFloors: initialProductionFamilyFloors(),
      now,
    });
    await retrieve(request({ targetRole: "Delivery Lead", searchAreas: ["Hong Kong", "Sydney"] }));
    expect(provider.fetch.mock.calls.map((call) => [call[0].regionCode, call[0].queryKeywords])).toEqual([
      ["HK", ["Delivery Lead", "project manager"]],
      // Australia's own measured list is longer — "delivery manager" exists there, Hong Kong's does not.
      ["AU", ["Delivery Lead", "project manager", "delivery manager"]],
    ]);
  });

  // #240 AC4, the whole point of the ticket: Mei types "delivery lead" — a phrase Hong Kong does
  // not use (0 adverts, measured) — and her DECK IS NOT EMPTY, because her family's market titles
  // ride in the same call. The stub matches phrases the way the vendor does, so the contrast is
  // real: the same typed role with no family behind it returns nothing at all.
  it("fills the deck for a typed role the market does not use, and cannot without the family", async () => {
    const phraseMatchingProvider = () => ({
      providerId: "one",
      fetch: vi.fn(async (input: { queryKeywords: string[] }) => ({
        ok: true as const,
        records: [record("one", "hk")].filter((item) =>
          input.queryKeywords.some((phrase) =>
            item.title.toLocaleLowerCase("en-US").includes(phrase.toLocaleLowerCase("en-US")),
          ),
        ),
      })),
    });
    const retrieveWith = (provider: PostingProvider) =>
      makePostingRetriever({
        registry: [policy("one", ["HK"], 1)],
        providers: [provider],
        store: new InMemoryPostingStore(),
        productionFamilyFloors: initialProductionFamilyFloors(),
        now,
      });

    await expect(
      retrieveWith(phraseMatchingProvider())(request({ targetRole: "Delivery Lead" })),
    ).resolves.toMatchObject({
      outcome: "relevant_postings",
      postings: [{ title: "IT Project Manager" }],
    });

    await expect(
      retrieveWith(phraseMatchingProvider())(
        wordRequest({ targetRole: "Delivery Lead", questionFloors: [] }),
      ),
    ).resolves.toMatchObject({ outcome: "empty_pool" });
  });

  // #235: no search family means no published market words — her typed words are the whole query.
  it("sends the typed role alone in the word search", async () => {
    const provider = { providerId: "one", fetch: vi.fn(async () => ({ ok: true as const, records: [] })) };
    const retrieve = makePostingRetriever({
      registry: [policy("one", ["HK"], 1)],
      providers: [provider],
      store: new InMemoryPostingStore(),
      productionFamilyFloors: initialProductionFamilyFloors(),
      now,
    });
    await retrieve(wordRequest({ targetRole: "Delivery Lead", questionFloors: [] }));
    expect(provider.fetch.mock.calls[0]![0].queryKeywords).toEqual(["Delivery Lead"]);
  });

  // #228 (spec #241 decision 5): the widening she accepted is an ordinary FAMILY search run with a
  // different family. Her typed role is deliberately absent — those are the words that just ran out,
  // and an advert they caught would be deleted on arrival (the deck compares every card against the
  // family THIS deck was searched for). The fallback family's own market titles are the whole query.
  it("sends the fallback family's market titles alone, never the typed role that ran out", async () => {
    const provider = { providerId: "one", fetch: vi.fn(async () => ({ ok: true as const, records: [] })) };
    const retrieve = makePostingRetriever({
      registry: [policy("one", ["HK"], 1)],
      providers: [provider],
      store: new InMemoryPostingStore(),
      productionFamilyFloors: initialProductionFamilyFloors(),
      now,
    });
    await retrieve(request({ targetRole: "Delivery Lead", fallback: true }));
    expect(provider.fetch.mock.calls[0]![0].queryKeywords).toEqual(["project manager"]);
  });

  // The fallback family is NOT the family she was interviewed on, so it cannot be gated on a
  // checkpoint for it — a visitor whose plan asks nothing (no question floors) still reaches it.
  // #248: this is now a test of the PREDICATE, not of the fetch. The rules it encodes are unchanged;
  // only who asks them moved. A fetch is no longer refused for an uncovered floor at all, which is
  // the entire point — #246 fetches at question 1, before she has answered anything, so that the
  // promise on her first screen can state a count that is true.
  it("does not gate a fallback family search on an interview checkpoint it has no floors for", async () => {
    const { retrieve } = build(
      [policy("one", ["HK"], 1)],
      [new TestFixturePostingProvider("one", { ok: true, records: [record("one", "a")] })],
    );
    await expect(
      retrieve(request({ fallback: true, questionFloors: [], checkpoint: null })),
    ).resolves.toMatchObject({ outcome: "relevant_postings" });
    // #228: a fallback with no floors of its own is authorized without a checkpoint...
    expect(deckReadIsAuthorized(request({ fallback: true, questionFloors: [], checkpoint: null }))).toBe(true);
    // ...but her own question floors still gate exactly as before.
    expect(deckReadIsAuthorized(request({ fallback: true, checkpoint: "family_confirmed" }))).toBe(false);
  });

  // #248 AC5 — the FETCH must no longer refuse an uncovered request. This is the half #246 depends
  // on: it searches at question 1, before she has answered anything, so the promise on her first
  // screen can state a count that is true. Without this test the whole move silently reverts — a
  // QA mutation proved that putting the refusal back inside makePostingRetriever left the entire
  // suite green, and #246 would then quietly show her nothing.
  it("fetches for an uncovered request — earning the reveal is no longer the fetch's question", async () => {
    const { retrieve } = build(
      [policy("one", ["HK"], 1)],
      [new TestFixturePostingProvider("one", { ok: true, records: [record("one", "a")] })],
    );
    await expect(retrieve(request({ checkpoint: "family_confirmed" }))).resolves.toMatchObject({
      outcome: "relevant_postings",
    });
    await expect(retrieve(request({ checkpoint: null }))).resolves.toMatchObject({
      outcome: "relevant_postings",
    });
    // ...and the deck still refuses to SHOW her either of them.
    expect(deckReadIsAuthorized(request({ checkpoint: "family_confirmed" }))).toBe(false);
  });

  // #248 — the coverage rules, now asked by the deck. Same truth table as the arm that used to live
  // inside the fetch; #235's empty-floor case and #228's fallback case are the two that are easy to
  // break by "simplifying" this predicate.
  it.each([
    ["a covered family plan is authorized", request({ checkpoint: "essential_floor_covered" }), true],
    ["an uncovered family plan is not", request({ checkpoint: "family_confirmed" }), false],
    ["a family plan with no checkpoint at all is not", request({ checkpoint: null }), false],
    ["#235: an empty plan is covered by definition", wordRequest({ questionFloors: [], checkpoint: null }), true],
    ["an uncovered word plan WITH floors is not", wordRequest({ checkpoint: "family_confirmed" }), false],
    ["a covered word plan is", wordRequest({ checkpoint: "essential_floor_covered" }), true],
  ] as const)("deckReadIsAuthorized: %s", (_name, input, expected) => {
    expect(deckReadIsAuthorized(input)).toBe(expected);
  });

  it("bounds an adversarial typed role to whole words, and never sends a field value", async () => {
    const provider = { providerId: "one", fetch: vi.fn(async () => ({ ok: true as const, records: [] })) };
    const retrieve = makePostingRetriever({
      registry: [policy("one", ["HK"], 1)],
      providers: [provider],
      store: new InMemoryPostingStore(),
      productionFamilyFloors: initialProductionFamilyFloors(),
      now,
    });
    await retrieve(
      request({
        targetRole: "Programme Programme Manager " + "x".repeat(200),
        confirmedEvidence: Array.from({ length: 30 }, (_, index) => ({
          semanticKey: `label-${index}`,
          fieldLabel: `Label${index} ${"y".repeat(100)}`,
        })),
      }),
    );
    const terms = provider.fetch.mock.calls[0]![0].queryKeywords;
    // The 200-character word is dropped WHOLE — a phrase ending in half a word matches nothing.
    expect(terms).toEqual(["Programme Programme Manager", "project manager"]);
    expect(JSON.stringify(terms)).not.toContain("SECRET-FIELD-VALUE");
  });

  // #258: an alias is hint-only. "Scrum Master" now finds IT project delivery at question 1, so the
  // family carries it — and the words sent to a provider are unchanged by that: her own typed role
  // (as always) plus the family's MEASURED market titles, and nothing from the alias list. What is
  // pinned here is that the alias LIST adds no query words, not that the phrase cannot appear —
  // a visitor who types it is still searched for what she typed.
  it("a family's alias list adds no words to a provider query (#258)", async () => {
    const provider = { providerId: "one", fetch: vi.fn(async () => ({ ok: true as const, records: [] })) };
    const retrieve = makePostingRetriever({
      registry: [policy("one", ["HK"], 1)],
      providers: [provider],
      store: new InMemoryPostingStore(),
      productionFamilyFloors: initialProductionFamilyFloors(),
      now,
    });
    await retrieve(request({ targetRole: "Scrum Master" }));
    const terms: string[] = provider.fetch.mock.calls[0]![0].queryKeywords;
    expect(terms).toEqual(["Scrum Master", "project manager"]);
  });

  // The 12-title cap needs a family with more market words than the fixture has. Only `get` is ever
  // called on the store here, so a literal publication stands in for one.
  it("caps a long market title list and keeps a cut title matchable", async () => {
    const publication = {
      publicationStatus: "published",
      floor: {
        familyId: "it-project-delivery",
        version: 1,
        source: "production_research",
        productionRewardEligible: true,
      },
      marketSearchTitles: {
        HK: [
          { title: "Senior Technical Program Manager, Enterprise Delivery", adverts: 1, measuredOn: "2026-08-14" },
          { title: "C&B Project Manager", adverts: 1, measuredOn: "2026-08-14" },
          ...Array.from({ length: 20 }, (_, index) => ({
            title: `market title ${index}`,
            adverts: 1,
            measuredOn: "2026-08-14",
          })),
        ],
      },
    };
    const provider = { providerId: "one", fetch: vi.fn(async () => ({ ok: true as const, records: [] })) };
    const retrieve = makePostingRetriever({
      registry: [policy("one", ["HK"], 1)],
      providers: [provider],
      store: new InMemoryPostingStore(),
      productionFamilyFloors: { get: () => publication } as unknown as ProductionFamilyFloorStore,
      now,
    });
    await retrieve(request({ targetRole: "Delivery Lead" }));

    const terms: string[] = provider.fetch.mock.calls[0]![0].queryKeywords;
    expect(terms).toHaveLength(12);
    expect(Math.max(...terms.map((term) => term.length))).toBeLessThanOrEqual(40);
    // Whole words only, and no comma left dangling where the bound cut the title.
    expect(terms).toContain("Senior Technical Program Manager");
    // Punctuation INSIDE a title survives — "C&B Project Manager" is a real Hong Kong result.
    expect(terms).toContain("C&B Project Manager");
  });

  it("the curated driver cannot certify a region without a fresh durable operator marker", async () => {
    const store = new InMemoryPostingStore();
    await store.upsert(record("curated-pool", "hk", { location: "Hong Kong" }));
    const provider = new StoreBackedCuratedPostingProvider(
      store,
      policy("curated-pool", ["*"], 0),
      now,
    );
    await expect(provider.fetch({ regionCode: "HK", queryKeywords: ["Project"] })).resolves.toMatchObject({
      ok: false,
      retryable: false,
    });
    const durableStore = {
      durable: true as const,
      listByProvider: store.listByProvider.bind(store),
      getRegionRefresh: store.getRegionRefresh.bind(store),
    };
    const durableProvider = new StoreBackedCuratedPostingProvider(
      durableStore,
      policy("curated-pool", ["*"], 0),
      now,
    );
    await expect(durableProvider.fetch({ regionCode: "HK", queryKeywords: ["Project"] })).resolves.toMatchObject({
      ok: false,
      retryable: false,
    });
    await store.markRegionRefreshed("curated-pool", "HK", "2026-08-08T11:59:59.000Z");
    await expect(durableProvider.fetch({ regionCode: "HK", queryKeywords: ["Project"] })).resolves.toMatchObject({
      ok: false,
      retryable: false,
    });
  });

  it("the curated driver returns only region-appropriate and query-relevant records after a fresh marker", async () => {
    const backing = new InMemoryPostingStore();
    await backing.upsert(record("curated-pool", "hk", { location: "Hong Kong" }));
    await backing.upsert(record("curated-pool", "unrelated", {
      location: "Hong Kong",
      title: "Retail Bank Manager",
      excerpt: "Lead branch sales and teller operations",
      skills: ["retail"],
    }));
    await backing.upsert(record("curated-pool", "au", { location: "Sydney" }));
    await backing.markRegionRefreshed("curated-pool", "HK", "2026-08-09T11:59:00.000Z");
    const durableStore = {
      durable: true as const,
      listByProvider: backing.listByProvider.bind(backing),
      getRegionRefresh: backing.getRegionRefresh.bind(backing),
    };
    const provider = new StoreBackedCuratedPostingProvider(
      durableStore,
      policy("curated-pool", ["*"], 0),
      now,
    );
    await expect(provider.fetch({ regionCode: "HK", queryKeywords: [] })).resolves.toMatchObject({
      ok: true,
      records: [],
    });
    // #240 AC6: PHRASES, matched against the advert's title, exactly as the live provider matches
    // them. "Project Manager" keeps the two adverts apart; the old shredded-word rule matched
    // "Retail Bank Manager" on the word "manager" alone.
    await expect(provider.fetch({ regionCode: "HK", queryKeywords: ["Project Manager"] })).resolves.toMatchObject({
      ok: true,
      records: [{ providerPostingId: "hk" }],
    });
    // Several phrases OR together, same as one quoted list sent live.
    await expect(
      provider.fetch({ regionCode: "HK", queryKeywords: ["Project Manager", "Retail Bank Manager"] }),
    ).resolves.toMatchObject({
      ok: true,
      records: [{ providerPostingId: "hk" }, { providerPostingId: "unrelated" }],
    });
    // A phrase the market does not use catches nothing — it does not fall back to its loose words.
    await expect(provider.fetch({ regionCode: "HK", queryKeywords: ["Delivery Lead"] })).resolves.toMatchObject({
      ok: true,
      records: [],
    });
    // Word boundaries hold: "manage" is not "manager".
    await expect(provider.fetch({ regionCode: "HK", queryKeywords: ["manage"] })).resolves.toMatchObject({
      ok: true,
      records: [],
    });
    await expect(provider.fetch({ regionCode: "HK", queryKeywords: ["retail bank manager"] })).resolves.toMatchObject({
      ok: true,
      records: [{ providerPostingId: "unrelated" }],
    });
  });

  it("storeBackedPostingProvidersFor wires a driver whenever a curated-pool policy is present in the given registry", () => {
    // Direct test of the wiring helper itself, with a synthetic active-shaped policy — NOT gated on
    // whether today's real file currently activates curated-pool (#174 says it doesn't; see the next
    // test). Kept pinned so this stays correct for when the production operator-refresh gap closes and
    // curated-pool re-enters loadActivePostingProviders().
    const registry = [policy("curated-pool", ["*"], 0)];
    expect(
      storeBackedPostingProvidersFor(registry, new InMemoryPostingStore()).map(
        (provider) => provider.providerId,
      ),
    ).toEqual(["curated-pool"]);
  });

  it("#174: curated-pool is excluded from TODAY's active registry, so production wiring never constructs its driver", () => {
    const registry = loadActivePostingProviders();
    expect(registry.some((entry) => entry.providerId === "curated-pool")).toBe(false);
    expect(storeBackedPostingProvidersFor(registry, new InMemoryPostingStore())).toEqual([]);
  });

  // #174's central falsifiable check: before this fix, curated-pool's always-failing driver (its
  // fetch() can never certify a fresh operator refresh in production, see postings.ts) sat in the
  // active registry for every region ("*"), so coverage.complete could never be true and empty_pool
  // was unreachable — a genuinely empty techmap result always read as provider_unavailable instead.
  // This drives retrieval through the REAL on-disk registry (loadActivePostingProviders's default,
  // not a hand-rolled fixture) and the REAL production wiring call (storeBackedPostingProvidersFor),
  // so it would have failed before curated-pool was excluded from the active set.
  it("#174: empty_pool is reachable through the real on-disk registry now that curated-pool no longer poisons every region's coverage", async () => {
    const registry = loadActivePostingProviders();
    const store = new InMemoryPostingStore();
    const providers = [
      ...storeBackedPostingProvidersFor(registry, store), // production's own wiring call — today: []
      new TestFixturePostingProvider("techmap", { ok: true, records: [] }),
    ];
    const retrieve = makePostingRetriever({
      registry,
      providers,
      store,
      productionFamilyFloors: initialProductionFamilyFloors(),
      now,
    });
    // #174 review: asserts the RULE (a complete, provider-unavailable-free certification), not that
    // techmap is the only row that will ever queue up here — a future SECOND active provider must not
    // break this test just for showing up alongside it (postings.test.ts's own stated convention).
    await expect(retrieve(request())).resolves.toMatchObject({
      outcome: "empty_pool",
      coverage: { providersUnavailable: [], complete: true },
    });
  });

  // #174 must-fix 1 round 2: "implementation exists" (checked against real driver CLASSES, never a
  // hand-typed mirror of provider ids), deliberately split from "instance was constructed" — round 1
  // conflated them and made a missing TECHMAP_RAPIDAPI_KEY a boot-time outage, caught by the
  // coordinator before it shipped. The function takes the registry alone (no `providers` array), so a
  // missing API key structurally cannot reach it.
  describe("#174 must-fix 1 (round 2): assertEveryActiveProviderIsImplemented", () => {
    it("passes for an active row with a real implementation, using the REAL on-disk registry", () => {
      expect(() => assertEveryActiveProviderIsImplemented(loadActivePostingProviders())).not.toThrow();
    });

    // The regression guard for exactly what round 1 got wrong: an implemented-but-unconfigured
    // provider (techmap with no live driver instance anywhere in this test) must still boot fine — the
    // assertion never sees a `providers` array, so it has no way to know whether a key is set, and
    // driver_missing stays a live, retrieval-time-only category (makePostingRetriever's own tests
    // above already pin that it degrades to provider_unavailable, never a throw).
    it("boots fine for an implemented-but-unconfigured provider — a missing API key must never reach this check", () => {
      const registry = [policy("techmap", ["HK", "SG", "VN", "AU"], 1)];
      expect(() => assertEveryActiveProviderIsImplemented(registry)).not.toThrow();
    });

    it("throws, naming the row, when an active policy has no implementation anywhere", () => {
      const registry = [policy("techmap", ["HK"], 1), policy("ghost-provider", ["HK"], 2)];
      expect(() => assertEveryActiveProviderIsImplemented(registry)).toThrow(/ghost-provider/);
    });
  });

  it("rechecks cached relevant postings against every source policy TTL", () => {
    const verifiedAt = "2026-08-08T12:01:00.000Z";
    const retrievedAt = "2026-08-09T12:00:00.000Z";
    const registry = [policy("one", ["HK"], 1, 24), policy("two", ["HK"], 2, 30)];
    const posting = dedupePostings(
      [record("one", "1", { verifiedLiveAt: verifiedAt }), record("two", "2", { verifiedLiveAt: verifiedAt })],
      registry,
    )[0]!;
    const snapshot = {
      requestFingerprint: "fingerprint",
      recordedAt: retrievedAt,
      result: {
        schemaVersion: "4" as const,
        outcome: "relevant_postings" as const,
        postings: [posting],
        coverage: { providersQueried: ["one", "two"], providersUnavailable: [], complete: true },
        retrievedAt,
      },
    };
    expect(
      isReusableRetrievalSnapshot(snapshot, "fingerprint", registry, Date.parse(retrievedAt)),
    ).toBe(true);
    expect(
      isReusableRetrievalSnapshot(
        snapshot,
        "fingerprint",
        registry,
        Date.parse("2026-08-09T12:05:00.000Z"),
      ),
    ).toBe(false);
  });

  it("expires cached invalid requests after the bounded retry window", () => {
    const snapshot = {
      requestFingerprint: "fingerprint",
      recordedAt: "2026-08-09T12:00:00.000Z",
      result: { schemaVersion: "4" as const, outcome: "invalid_request" as const, code: "family_not_published" as const },
    };
    expect(
      isReusableRetrievalSnapshot(snapshot, "fingerprint", [], Date.parse("2026-08-09T12:00:30.000Z")),
    ).toBe(true);
    expect(
      isReusableRetrievalSnapshot(snapshot, "fingerprint", [], Date.parse("2026-08-09T12:00:31.000Z")),
    ).toBe(false);
  });

  it("expires a certified empty pool at the shortest queried provider TTL", () => {
    const retrievedAt = "2026-08-09T12:00:00.000Z";
    const registry = [policy("one", ["HK"], 1, 1 / 60)];
    const snapshot = {
      requestFingerprint: "fingerprint",
      recordedAt: retrievedAt,
      result: {
        schemaVersion: "4" as const,
        outcome: "empty_pool" as const,
        coverage: { providersQueried: ["one"], providersUnavailable: [], complete: true },
        retrievedAt,
      },
    };
    expect(
      isReusableRetrievalSnapshot(snapshot, "fingerprint", registry, Date.parse("2026-08-09T12:00:59.000Z")),
    ).toBe(true);
    expect(
      isReusableRetrievalSnapshot(snapshot, "fingerprint", registry, Date.parse("2026-08-09T12:01:01.000Z")),
    ).toBe(false);
  });
});

// #248 — the hole BOTH review axes found in this ticket's first cut, and the only test that proves
// it shut. The guard was put on `ensureRetrieval`, which decides the payload's `retrieval` field —
// but the CARDS come from `sessionPostings`, which reads the snapshot itself. #246 fetches at
// question 1, so a real relevant-postings snapshot will exist AT THE UNCOVERED CHECKPOINT: same
// checkpoint, therefore same fingerprint, therefore reusable. Without a guard here those postings
// render as her deck while the status field politely says the floor is not covered.
describe("#248 a snapshot is data, not permission", () => {
  const FINGERPRINT = "fp-uncovered";
  const family = { familyId: "it-project-delivery", version: 1 };
  // Freshness is a SEPARATE gate (isReusableRetrievalSnapshot checks verifiedLiveAt against the
  // provider TTL). Stamp everything now, or the snapshot is unusable for that reason instead and
  // this whole test passes without exercising the authorization at all — which is exactly what the
  // first draft did, and what the covered half below is here to catch.
  const NOW = new Date().toISOString();
  const live = {
    schemaVersion: "4" as const,
    id: "posting:live-one",
    canonicalKey: "live-one",
    title: "Delivery Manager",
    company: "Example Ltd",
    location: "Hong Kong",
    sourceUrl: "https://example.com/live-one",
    excerpt: "Lead delivery.",
    postedAt: NOW,
    capturedAt: NOW,
    verifiedLiveAt: NOW,
    expiresAt: null,
    attribution: [],
    sources: [{ providerId: "techmap", providerPostingId: "live-one" }],
    skills: ["Delivery"],
    language: "en",
  };

  const sessionAt = (checkpoint: "family_confirmed" | "essential_floor_covered") =>
    ({
      retrieval: {
        requestFingerprint: FINGERPRINT,
        recordedAt: NOW,
        result: {
          schemaVersion: "4",
          outcome: "relevant_postings",
          postings: [live],
          coverage: { providersQueried: ["techmap"], providersUnavailable: [], complete: true },
          retrievedAt: NOW,
        },
      },
      discovery: {
        questionFloors: [family],
        searchFamily: family,
        coveredItemIds: [],
        checkpoint,
        fallback: { declined: false, family: null },
      },
    }) as unknown as SessionRecord;

  it("keeps a pre-coverage snapshot out of the pool, and lets the SAME snapshot in once covered", () => {
    const uncovered = sessionPostings(sessionAt("family_confirmed"), FINGERPRINT);
    expect(uncovered.some((posting) => posting.id === live.id)).toBe(false);
    // #63: an unearned pool is EMPTY, not the fixture pool. Falling back to the 17 hand-maintained
    // adverts was the whole defect this ticket closes - the refusal was real in the retrieval
    // status and cosmetic in the deck, which still revealed "17 jobs just matched you".
    expect(uncovered).toHaveLength(0);

    // The same snapshot, the same fingerprint, the same everything except that she has now earned
    // it. If this half failed, the half above would be passing for the boring reason that the
    // snapshot was never usable in the first place.
    const covered = sessionPostings(sessionAt("essential_floor_covered"), FINGERPRINT);
    expect(covered.some((posting) => posting.id === live.id)).toBe(true);
  });
});
