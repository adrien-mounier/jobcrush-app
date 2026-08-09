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
  coveredRegionCodes,
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
import { TestFixturePostingProvider } from "../src/postingProvider.js";
import { InMemoryPostingStore } from "../src/postingStore.js";
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
  searchArea: "Hong Kong",
  family: { familyId: "it-project-delivery", version: 1 },
  checkpoint: "essential_floor_covered",
  confirmedEvidence: [{ semanticKey: "risk-control", fieldLabel: "Risk control" }],
  explicitNegatives: [],
  ...over,
});

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
  it.each([
    ["Hong Kong", "Hong Kong", "hong-kong"],
    ["Sydney, Australia", "Australia", "australia"], // AC2: trailing country
    ["hong kong,", "Hong Kong", "hong-kong"], // AC2: stray punctuation + case
    ["  Singapore  ", "Singapore", "singapore"], // AC2: stray whitespace
    ["HK", "Hong Kong", "hong-kong"], // AC2: common alias
    ["Ho Chi Minh City, Vietnam.", "Vietnam", "vietnam"], // AC2: city + trailing country + period
    // AC5, pinned verbatim (not just a substring check, per spec review): the search-area field's own
    // placeholder text ("e.g. Hong Kong, or Remote in Vietnam", apps/web/app/page.tsx) — both examples
    // the product itself suggests must resolve. "Hong Kong" is already the first case above; listed
    // again here, explicitly, so this row's OWN reason for existing is legible without cross-reading.
    ["Hong Kong", "Hong Kong", "hong-kong"],
    ["Remote in Vietnam", "Vietnam", "vietnam"],
    // #184 QA residual: two named-uncovered inputs from #172's own list — obvious district/airport
    // aliases, not covered by the city/country names alone.
    ["Kowloon", "Hong Kong", "hong-kong"],
    ["HKG", "Hong Kong", "hong-kong"],
    ["Saigon", "Vietnam", "vietnam"], // flagged alongside the above as an equally clear-cut gap
  ])("%s resolves and confirms back as its country-level market (AC2)", (typed, market, marketKey) => {
    expect(resolveSearchArea(typed)).toEqual({ covered: true, market, marketKey });
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
    [request({ family: null }), "family_not_published"],
    [request({ family: { familyId: "unknown", version: 1 } }), "family_not_published"],
    [request({ checkpoint: "family_confirmed" }), "floor_not_covered"],
    [request({ searchArea: "Atlantis" }), "search_area_not_covered"],
  ] as const)("returns the specific invalid arm", async (input, code) => {
    const { retrieve } = build([policy("one", ["HK"], 1)], []);
    await expect(retrieve(input)).resolves.toEqual({
      schemaVersion: "4",
      outcome: "invalid_request",
      code,
    });
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

  it("sends only structured role and evidence labels, never raw claim text, and negatives only suppress", async () => {
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
    expect(sent).toContain("Banking");
    expect(sent).not.toContain("Java");
    expect(sent).not.toContain("raw secret claim text");
    expect(result).toMatchObject({ outcome: "relevant_postings", postings: [{ title: "IT Project Manager" }] });
  });

  it("bounds and deduplicates adversarial structured query terms without using field values", async () => {
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
    expect(terms.length).toBeLessThanOrEqual(12);
    expect(Math.max(...terms.map((term: string) => term.length))).toBeLessThanOrEqual(40);
    expect(new Set(terms.map((term: string) => term.toLowerCase())).size).toBe(terms.length);
    expect(JSON.stringify(terms)).not.toContain("SECRET-FIELD-VALUE");
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
    await expect(provider.fetch({ regionCode: "HK", queryKeywords: ["Project", "Manager"] })).resolves.toMatchObject({
      ok: true,
      records: [{ providerPostingId: "hk" }],
    });
    await expect(provider.fetch({ regionCode: "HK", queryKeywords: ["IT", "Project", "Manager"] })).resolves.toMatchObject({
      ok: true,
      records: [{ providerPostingId: "hk" }],
    });
    await expect(provider.fetch({ regionCode: "HK", queryKeywords: ["retail"] })).resolves.toMatchObject({
      ok: true,
      records: [{ providerPostingId: "unrelated" }],
    });
  });

  it("production wiring supplies a store-backed driver for the active curated policy", () => {
    const registry = loadActivePostingProviders();
    expect(registry.some((entry) => entry.providerId === "curated-pool")).toBe(true);
    expect(
      storeBackedPostingProvidersFor(registry, new InMemoryPostingStore()).map(
        (provider) => provider.providerId,
      ),
    ).toEqual(["curated-pool"]);
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
