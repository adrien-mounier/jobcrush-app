// #99: behaviour tests for dedupePostings (§2.4 of docs/research/live-posting-retrieval-contract.md)
// and the provider registry loader (§2.2), tested through their real seams only — no network, no
// store, no route. dedupePostings's one job is to never produce a false positive (merging two
// genuinely different jobs); a missed merge (an extra card) is the accepted, intended failure mode.
import { describe, expect, it } from "vitest";
import type { PostingProviderPolicyV1, ProviderPostingRecordV1 } from "@jobcrush/contracts";
import {
  computeProviderCostUsd,
  dedupePostings,
  loadActivePostingProviders,
  loadProviderPolicies,
  parseProviderPolicies,
} from "../src/postings.js";

function record(
  overrides: Partial<ProviderPostingRecordV1> &
    Pick<ProviderPostingRecordV1, "providerId" | "providerPostingId" | "title" | "company" | "location">,
): ProviderPostingRecordV1 {
  return {
    schemaVersion: "4",
    sourceUrl: `https://example.com/${overrides.providerId}/${overrides.providerPostingId}`,
    applicationUrl: null,
    excerpt: "Full advert text.",
    postedAt: "2026-07-28T00:00:00Z",
    capturedAt: "2026-07-29T09:00:00Z",
    verifiedLiveAt: "2026-08-01T09:00:00Z",
    expiresAt: "2026-09-01T00:00:00Z",
    attribution: null,
    skills: [],
    language: "en",
    ...overrides,
  };
}

// A small fixture registry (not the real on-disk one) so conflict-resolution tests are pinned to
// known authorityRanks regardless of what the production data file happens to contain.
const PASTED_ROW: PostingProviderPolicyV1 = {
  schemaVersion: "3",
  providerId: "pasted-by-you",
  regionsServed: ["*"],
  authorityRank: 2,
  permitsStorage: true,
  permitsMatching: true,
  attributionRequired: false,
  attributionTemplate: null,
  rateLimit: { perSecond: null, perMinute: null, perDay: null, perMonth: null },
  retry: { maxAttempts: 1, backoffMs: 0 },
  timeoutMs: 1,
  costModel: { kind: "operatorHours" },
  freshnessTtlHours: 0,
  livenessCheckable: false,
};

const REGISTRY: PostingProviderPolicyV1[] = [
  {
    schemaVersion: "3",
    providerId: "curated-pool",
    regionsServed: ["*"],
    authorityRank: 0,
    permitsStorage: true,
    permitsMatching: true,
    attributionRequired: false,
    attributionTemplate: null,
    rateLimit: { perSecond: null, perMinute: null, perDay: null, perMonth: null },
    retry: { maxAttempts: 1, backoffMs: 0 },
    timeoutMs: 5000,
    costModel: { kind: "operatorHours" },
    freshnessTtlHours: 24,
    livenessCheckable: true,
  },
  {
    schemaVersion: "3",
    providerId: "techmap",
    regionsServed: ["HK", "SG", "VN", "AU"],
    authorityRank: 1,
    permitsStorage: true,
    permitsMatching: true,
    attributionRequired: false,
    attributionTemplate: null,
    rateLimit: { perSecond: 0.4, perMinute: 24, perDay: null, perMonth: 1000 },
    retry: { maxAttempts: 2, backoffMs: 1000 },
    timeoutMs: 10000,
    costModel: { kind: "perThousandPostings", amountUsd: 1 },
    freshnessTtlHours: 24,
    livenessCheckable: true,
  },
];

describe("dedupePostings (#99, §2.4)", () => {
  it("merges two providers' records for the same job (identical after normalization) into one posting", () => {
    const a = record({
      providerId: "curated-pool",
      providerPostingId: "c-1",
      title: "Senior Project Manager",
      company: "BNP Paribas",
      location: "Hong Kong",
    });
    const b = record({
      providerId: "techmap",
      providerPostingId: "tm-1",
      title: "Senior Project Manager",
      company: "BNP Paribas",
      location: "Hong Kong",
    });
    const postings = dedupePostings([a, b], REGISTRY);
    expect(postings).toHaveLength(1);
    expect(postings[0]!.sources).toEqual([
      { providerId: "curated-pool", providerPostingId: "c-1" },
      { providerId: "techmap", providerPostingId: "tm-1" },
    ]);
  });

  // The three named misses (§2.4) — each is a deliberate false negative (an extra card), never a
  // false positive. Proving these stay TWO postings is what proves dedupePostings errs the safe way.
  it("title wording ('Senior PM' vs 'Senior Project Manager') stays two postings", () => {
    const a = record({
      providerId: "curated-pool", providerPostingId: "c-1",
      title: "Senior PM", company: "BNP Paribas", location: "Hong Kong",
    });
    const b = record({
      providerId: "techmap", providerPostingId: "tm-1",
      title: "Senior Project Manager", company: "BNP Paribas", location: "Hong Kong",
    });
    expect(dedupePostings([a, b], REGISTRY)).toHaveLength(2);
  });

  it("company variant ('BNP Paribas' vs 'BNP Paribas Hong Kong Branch') stays two postings", () => {
    const a = record({
      providerId: "curated-pool", providerPostingId: "c-1",
      title: "Senior Project Manager", company: "BNP Paribas", location: "Hong Kong",
    });
    const b = record({
      providerId: "techmap", providerPostingId: "tm-1",
      title: "Senior Project Manager", company: "BNP Paribas Hong Kong Branch", location: "Hong Kong",
    });
    expect(dedupePostings([a, b], REGISTRY)).toHaveLength(2);
  });

  it("location granularity ('Hong Kong' vs 'Wan Chai, Hong Kong') stays two postings", () => {
    const a = record({
      providerId: "curated-pool", providerPostingId: "c-1",
      title: "Senior Project Manager", company: "BNP Paribas", location: "Hong Kong",
    });
    const b = record({
      providerId: "techmap", providerPostingId: "tm-1",
      title: "Senior Project Manager", company: "BNP Paribas", location: "Wan Chai, Hong Kong",
    });
    expect(dedupePostings([a, b], REGISTRY)).toHaveLength(2);
  });

  it("pure formatting variants (case, whitespace, punctuation) merge", () => {
    const a = record({
      providerId: "curated-pool", providerPostingId: "c-1",
      title: "Senior Project Manager", company: "BNP  Paribas,", location: "Hong Kong",
    });
    const b = record({
      providerId: "techmap", providerPostingId: "tm-1",
      title: "senior project manager", company: "bnp paribas", location: "hong kong",
    });
    expect(dedupePostings([a, b], REGISTRY)).toHaveLength(1);
  });

  it("conflict resolution: the lower-authorityRank record wins title/company/location/sourceUrl/skills", () => {
    // Title/company/location must still normalize to the SAME canonical key for these to merge at
    // all (a genuinely different title never merges — that's the whole point of §2.4's no-false-
    // positive rule). So the "conflict" here is a pure formatting variant of the same job: extra
    // whitespace and a trailing period, which normalize away but leave the raw display text intact.
    const higherRank = record({
      providerId: "techmap", providerPostingId: "tm-1",
      title: "  Senior   Project Manager.",
      company: "BNP Paribas",
      location: "Hong Kong",
      sourceUrl: "https://techmap.example/1",
      skills: ["Jira"],
    });
    const lowerRank = record({
      providerId: "curated-pool", providerPostingId: "c-1",
      title: "Senior Project Manager",
      company: "BNP Paribas",
      location: "Hong Kong",
      sourceUrl: "https://curated.example/1",
      skills: ["Stakeholder management"],
    });
    const [posting] = dedupePostings([higherRank, lowerRank], REGISTRY);
    expect(posting!.title).toBe("Senior Project Manager");
    expect(posting!.sourceUrl).toBe("https://curated.example/1");
    expect(posting!.skills).toEqual(["Stakeholder management"]);
    expect(posting).not.toHaveProperty("applicantLocationRequirements"); // #133: removed, not carried
  });

  // #100: language follows the SAME authorityRank-winner rule as skills, NOT a union — a union
  // would let a posting one provider detected as non-English look eligible under the OTHER
  // provider's "en" label, which no single record actually supports.
  it("language resolves by the authorityRank-winner rule, never a union of contributing records", () => {
    const higherRankZh = record({
      providerId: "techmap", providerPostingId: "tm-1",
      title: "Senior Project Manager", company: "BNP Paribas", location: "Hong Kong",
      language: "zh",
    });
    const lowerRankEn = record({
      providerId: "curated-pool", providerPostingId: "c-1",
      title: "Senior Project Manager", company: "BNP Paribas", location: "Hong Kong",
      language: "en",
    });
    const [posting] = dedupePostings([higherRankZh, lowerRankEn], REGISTRY);
    expect(posting!.language).toBe("en"); // curated-pool (authorityRank 0) wins over techmap (rank 1)
  });

  it("sources and attribution are the union across contributing records, never just the winner's", () => {
    const a = record({
      providerId: "curated-pool", providerPostingId: "c-1",
      title: "Senior Project Manager", company: "BNP Paribas", location: "Hong Kong",
      attribution: { label: "via Curated Pool", url: "https://curated.example" },
    });
    const b = record({
      providerId: "techmap", providerPostingId: "tm-1",
      title: "Senior Project Manager", company: "BNP Paribas", location: "Hong Kong",
      attribution: { label: "via Techmap", url: "https://jobdatafeeds.com" },
    });
    const [posting] = dedupePostings([a, b], REGISTRY);
    expect(posting!.sources).toHaveLength(2);
    expect(posting!.attribution).toEqual([
      { label: "via Curated Pool", url: "https://curated.example" },
      { label: "via Techmap", url: "https://jobdatafeeds.com" },
    ]);
  });

  // #302 — the apply link is NOT plain winner-take-all. A pasted advert carries the link the
  // person typed and deliberately loses every field conflict to a real provider (authorityRank 2);
  // techmap's applicationUrl is always null, so winner-take-all would throw his link away the one
  // time it exists. The winner's link still wins when the winner HAS one.
  it("#302: the apply link falls to the next-highest contributor when the winner has none", () => {
    const registry = [...REGISTRY, PASTED_ROW];
    const fetched = record({
      providerId: "techmap", providerPostingId: "tm-1",
      title: "IT Project Manager", company: "Cathay Pacific", location: "Hong Kong",
      applicationUrl: null,
    });
    const pasted = record({
      providerId: "pasted-by-you", providerPostingId: "paste-1",
      title: "IT Project Manager", company: "Cathay Pacific", location: "Hong Kong",
      applicationUrl: "https://careers.example/apply/1",
      verifiedLiveAt: null,
    });
    const [merged] = dedupePostings([fetched, pasted], registry);
    // techmap still wins the ordinary fields — a provider's structured record beats fields parsed
    // out of pasted text — and one real confirmation still outranks the absence.
    expect(merged!.sources.map((s) => s.providerId)).toEqual(["techmap", "pasted-by-you"]);
    expect(merged!.verifiedLiveAt).toBe("2026-08-01T09:00:00Z");
    // ...but the only apply link anyone had survives.
    expect(merged!.applicationUrl).toBe("https://careers.example/apply/1");
  });

  it("#302: a winner that HAS an apply link keeps its own, never a lower contributor's", () => {
    const registry = [...REGISTRY, PASTED_ROW];
    const fetched = record({
      providerId: "techmap", providerPostingId: "tm-1",
      title: "IT Project Manager", company: "Cathay Pacific", location: "Hong Kong",
      applicationUrl: "https://techmap.example/apply",
    });
    const pasted = record({
      providerId: "pasted-by-you", providerPostingId: "paste-1",
      title: "IT Project Manager", company: "Cathay Pacific", location: "Hong Kong",
      applicationUrl: "https://careers.example/apply/1",
    });
    const [merged] = dedupePostings([fetched, pasted], registry);
    expect(merged!.applicationUrl).toBe("https://techmap.example/apply");
  });

  // #302: no contributing record was ever confirmed live — the merge says so rather than
  // inventing an instant.
  it("#302: verifiedLiveAt is null only when nothing contributing was ever confirmed", () => {
    const registry = [...REGISTRY, PASTED_ROW];
    const pasted = record({
      providerId: "pasted-by-you", providerPostingId: "paste-1",
      title: "IT Project Manager", company: "Cathay Pacific", location: "Hong Kong",
      verifiedLiveAt: null,
    });
    const [merged] = dedupePostings([pasted], registry);
    expect(merged!.verifiedLiveAt).toBeNull();
  });

  it("merges dates: earliest capturedAt, latest verifiedLiveAt, earliest non-null expiresAt", () => {
    const a = record({
      providerId: "curated-pool", providerPostingId: "c-1",
      title: "Senior Project Manager", company: "BNP Paribas", location: "Hong Kong",
      capturedAt: "2026-07-30T00:00:00Z", verifiedLiveAt: "2026-08-01T00:00:00Z",
      expiresAt: "2026-09-10T00:00:00Z",
    });
    const b = record({
      providerId: "techmap", providerPostingId: "tm-1",
      title: "Senior Project Manager", company: "BNP Paribas", location: "Hong Kong",
      capturedAt: "2026-07-29T00:00:00Z", verifiedLiveAt: "2026-08-02T00:00:00Z",
      expiresAt: "2026-09-05T00:00:00Z",
    });
    const [posting] = dedupePostings([a, b], REGISTRY);
    expect(posting!.capturedAt).toBe("2026-07-29T00:00:00Z");
    expect(posting!.verifiedLiveAt).toBe("2026-08-02T00:00:00Z");
    expect(posting!.expiresAt).toBe("2026-09-05T00:00:00Z");
  });

  it("expiresAt is null only when every contributing record's expiresAt is null", () => {
    const withOneNull = dedupePostings(
      [
        record({
          providerId: "curated-pool", providerPostingId: "c-1",
          title: "Senior Project Manager", company: "BNP Paribas", location: "Hong Kong",
          expiresAt: null,
        }),
        record({
          providerId: "techmap", providerPostingId: "tm-1",
          title: "Senior Project Manager", company: "BNP Paribas", location: "Hong Kong",
          expiresAt: "2026-09-05T00:00:00Z",
        }),
      ],
      REGISTRY,
    );
    expect(withOneNull[0]!.expiresAt).toBe("2026-09-05T00:00:00Z");

    const bothNull = dedupePostings(
      [
        record({
          providerId: "curated-pool", providerPostingId: "c-2",
          title: "Delivery Manager", company: "Acme", location: "Singapore", expiresAt: null,
        }),
        record({
          providerId: "techmap", providerPostingId: "tm-2",
          title: "Delivery Manager", company: "Acme", location: "Singapore", expiresAt: null,
        }),
      ],
      REGISTRY,
    );
    expect(bothNull[0]!.expiresAt).toBeNull();
  });

  it("a providerId absent from the registry gets rank +Infinity, loses every conflict, and never throws", () => {
    // Same canonical key (so they actually merge into one posting); sourceUrl is the field that
    // reveals which record won, since the winner's whole record (not just one field) is the source
    // of every non-merged display field.
    const unknownProvider = record({
      providerId: "mystery-vendor", providerPostingId: "m-1",
      title: "Senior Project Manager", company: "BNP Paribas", location: "Hong Kong",
      sourceUrl: "https://mystery-vendor.example/1",
    });
    const knownProvider = record({
      providerId: "curated-pool", providerPostingId: "c-1",
      title: "Senior Project Manager", company: "BNP Paribas", location: "Hong Kong",
      sourceUrl: "https://curated.example/1",
    });
    expect(() => dedupePostings([unknownProvider, knownProvider], REGISTRY)).not.toThrow();
    const [posting] = dedupePostings([unknownProvider, knownProvider], REGISTRY);
    expect(posting!.sourceUrl).toBe("https://curated.example/1");
  });

  // Regression: two providers BOTH absent from the registry both get an effective authorityRank of
  // +Infinity, and Infinity - Infinity is NaN — a comparator that subtracts ranks silently falls
  // through every tie-break and leaves the "winner" an accident of input order. Proven here by
  // running the same two records in both orders and asserting the same one wins either way.
  it("two providers both absent from the registry still resolve deterministically, regardless of input order", () => {
    const first = record({
      providerId: "unregistered-a", providerPostingId: "1",
      title: "Senior Project Manager", company: "BNP Paribas", location: "Hong Kong",
      sourceUrl: "https://unregistered-a.example/1",
    });
    const second = record({
      providerId: "unregistered-b", providerPostingId: "1",
      title: "Senior Project Manager", company: "BNP Paribas", location: "Hong Kong",
      sourceUrl: "https://unregistered-b.example/1",
    });
    const [winnerFirstOrder] = dedupePostings([first, second], REGISTRY);
    const [winnerSecondOrder] = dedupePostings([second, first], REGISTRY);
    expect(winnerFirstOrder!.sourceUrl).toBe(winnerSecondOrder!.sourceUrl);
    // both unregistered, so the providerId tie-break decides: "unregistered-a" < "unregistered-b"
    expect(winnerFirstOrder!.sourceUrl).toBe("https://unregistered-a.example/1");
  });

  // Regression: `|` is the canonical key's own field delimiter. If it survived inside a field's
  // content, two genuinely different jobs could forge an identical key by having a `|` land on an
  // exactly-aligned field boundary — a silent false-positive merge, exactly what AC3 forbids. This
  // is distinct from the KNOWN LIMITATION below (that one is inherent to a content-based key; this
  // one was an unescaped delimiter and is fully closed by stripping `|` in normalize).
  it("a `|` inside a field never forges a fake field boundary with a different job", () => {
    const crossedBoundary = record({
      providerId: "curated-pool", providerPostingId: "c-1",
      title: "PM", company: "HSBC|Hong Kong", location: "Singapore",
      sourceUrl: "https://curated.example/crossed-1",
    });
    const otherJob = record({
      providerId: "techmap", providerPostingId: "tm-1",
      title: "PM", company: "HSBC", location: "Hong Kong|Singapore",
      sourceUrl: "https://techmap.example/crossed-2",
    });
    expect(dedupePostings([crossedBoundary, otherJob], REGISTRY)).toHaveLength(2);
  });

  // Known, accepted limitation (documented, not fixed — see coordinator's report to the owner and
  // #92): two GENUINELY DIFFERENT job requisitions that happen to share company + location + title
  // (e.g. two separate HSBC "Project Manager" reqs open in Hong Kong at once, common at large
  // employers) collide onto the same canonical key and merge into one posting today. Deliberately
  // NOT fixed by adding sourceUrl or a provider discriminator to the key — that would break
  // cross-provider dedup entirely, which is the whole point of §2.4. This test pins the current,
  // accepted behaviour so a future change to the key is a conscious decision, not a surprise.
  it("KNOWN LIMITATION: two distinct postings with identical company+location+title collide into one", () => {
    const hsbcReqOne = record({
      providerId: "curated-pool", providerPostingId: "hsbc-req-1",
      title: "Project Manager", company: "HSBC", location: "Hong Kong",
      sourceUrl: "https://curated.example/hsbc-req-1",
    });
    const hsbcReqTwo = record({
      providerId: "techmap", providerPostingId: "hsbc-req-2",
      title: "Project Manager", company: "HSBC", location: "Hong Kong",
      sourceUrl: "https://techmap.example/hsbc-req-2",
    });
    const postings = dedupePostings([hsbcReqOne, hsbcReqTwo], REGISTRY);
    expect(postings).toHaveLength(1); // two real, distinct jobs — collapsed to one today
    expect(postings[0]!.sources).toEqual([
      { providerId: "curated-pool", providerPostingId: "hsbc-req-1" },
      { providerId: "techmap", providerPostingId: "hsbc-req-2" },
    ]);
  });

  it("output order is deterministic: first appearance of each canonical key in the input", () => {
    const jobA1 = record({
      providerId: "curated-pool", providerPostingId: "a-1",
      title: "Delivery Manager", company: "Acme", location: "Singapore",
    });
    const jobB = record({
      providerId: "curated-pool", providerPostingId: "b-1",
      title: "Business Analyst", company: "Acme", location: "Singapore",
    });
    const jobA2 = record({
      providerId: "techmap", providerPostingId: "a-2",
      title: "Delivery Manager", company: "Acme", location: "Singapore",
    });
    const postings = dedupePostings([jobA1, jobB, jobA2], REGISTRY);
    expect(postings.map((p) => p.title)).toEqual(["Delivery Manager", "Business Analyst"]);
  });

  it("a deterministic winner on an authorityRank tie: providerId asc, then providerPostingId asc", () => {
    // Same canonical key on both records in each case (they must actually merge); sourceUrl carries
    // the tell of which record won, since title/company/location are identical by construction here.
    const tieRegistry: PostingProviderPolicyV1[] = [
      { ...REGISTRY[0]!, providerId: "zeta-provider", authorityRank: 5 },
      { ...REGISTRY[1]!, providerId: "alpha-provider", authorityRank: 5 },
    ];
    const fromZeta = record({
      providerId: "zeta-provider", providerPostingId: "1",
      title: "Delivery Manager", company: "Acme", location: "Singapore",
      sourceUrl: "https://zeta.example/1",
    });
    const fromAlpha = record({
      providerId: "alpha-provider", providerPostingId: "1",
      title: "Delivery Manager", company: "Acme", location: "Singapore",
      sourceUrl: "https://alpha.example/1",
    });
    const byProviderId = dedupePostings([fromZeta, fromAlpha], tieRegistry);
    expect(byProviderId[0]!.sourceUrl).toBe("https://alpha.example/1"); // "alpha-provider" < "zeta-provider"

    const samePostingIdTie = record({
      providerId: "alpha-provider", providerPostingId: "2",
      title: "Business Analyst", company: "Acme", location: "Vietnam",
      sourceUrl: "https://alpha.example/posting-id-2",
    });
    const samePostingIdTie2 = record({
      providerId: "alpha-provider", providerPostingId: "1",
      title: "Business Analyst", company: "Acme", location: "Vietnam",
      sourceUrl: "https://alpha.example/posting-id-1",
    });
    const byPostingId = dedupePostings([samePostingIdTie, samePostingIdTie2], tieRegistry);
    expect(byPostingId[0]!.sourceUrl).toBe("https://alpha.example/posting-id-1"); // "1" < "2"
  });
});

describe("posting-providers registry loader (#99, §2.2)", () => {
  // Asserts the RULE, not the literal file contents — an operator adding a fourth provider row
  // later must not break this test just for existing alongside the ones we already know about.
  //
  // #174 must-fix 2: theirstack's absence must be checked against the RAW on-disk registry (every
  // row, active or not), not just the active list — it was ALREADY absent from the active list before
  // this diff (its permission booleans were false), so an active-only assertion here would stay green
  // even if a driverless theirstack candidate row quietly reappeared (which docs/research/
  // live-posting-retrieval-contract.md §1 explicitly invites re-adding).
  it("#174: theirstack has no row at all in the raw on-disk registry — no driver, an owner spend decision", () => {
    const raw = loadProviderPolicies();
    expect(raw.some((p) => p.providerId === "theirstack")).toBe(false);
  });

  it("#174: curated-pool is operationally disabled (no production refresh path); techmap is the only FETCHING provider today", () => {
    const active = loadActivePostingProviders();
    expect(active.some((p) => p.providerId === "curated-pool")).toBe(false);
    expect(active.some((p) => p.providerId === "techmap")).toBe(true);
    // #302: "pasted-by-you" is active too, but it fetches nothing — so techmap is still the only
    // provider this build ever queries. providersFor's own test pins that half.
    expect(active.filter((p) => p.livenessCheckable).map((p) => p.providerId)).toEqual(["techmap"]);
  });

  // #302 (#294 clause 6) — "Pasted by you" is a source of its own, in the registry, not a real
  // provider's id borrowed for a job nobody fetched. It has to be ACTIVE, because the snapshot
  // reuse gate separately requires every source.providerId to be in the active registry; it is
  // marked never-liveness-checkable, and that one field is what every origin-keyed rule reads.
  it("#302: pasted-by-you is a registered, active source that can never be liveness-checked", () => {
    const active = loadActivePostingProviders();
    const pasted = active.find((p) => p.providerId === "pasted-by-you");
    expect(pasted).toBeDefined();
    expect(pasted!.livenessCheckable).toBe(false);
    // Not a real provider's id wearing a costume: every other row in the registry says it CAN be
    // re-checked, so nothing that fetches has been quietly relabelled as a paste.
    for (const policy of loadProviderPolicies()) {
      if (policy.providerId !== "pasted-by-you") expect(policy.livenessCheckable).toBe(true);
    }
  });

  it("a row needs both permission booleans true AND attributionRequired false to be active", () => {
    const active = loadActivePostingProviders();
    for (const policy of active) {
      expect(policy.permitsStorage).toBe(true);
      expect(policy.permitsMatching).toBe(true);
      expect(policy.attributionRequired).toBe(false);
    }
  });

  it("an invalid row throws on load rather than being silently skipped", () => {
    const validRow = loadActivePostingProviders()[0]!;
    const brokenRow = { ...validRow, permitsStorage: "yes" }; // wrong type, not a valid boolean
    expect(() => parseProviderPolicies([validRow, brokenRow])).toThrow();
  });

  // #174 AC "a registry row without a driver must not be representable as serving a region" is now
  // proven at postingRetrieval.test.ts's assertEveryActiveProviderIsImplemented — checked against each
  // driver class's own declared identity, not this loader's own data (#174 must-fix 1).
});

describe("computeProviderCostUsd (#100, §2.9)", () => {
  it("perThousandPostings: real spend proportional to records actually returned", () => {
    expect(computeProviderCostUsd({ kind: "perThousandPostings", amountUsd: 1 }, 1000)).toBe(1);
    expect(computeProviderCostUsd({ kind: "perThousandPostings", amountUsd: 1 }, 500)).toBeCloseTo(0.5, 10);
    expect(computeProviderCostUsd({ kind: "perThousandPostings", amountUsd: 1 }, 0)).toBe(0);
  });

  it("flatMonthlyTier and operatorHours have no per-call dollar cost — never an estimated fraction", () => {
    expect(computeProviderCostUsd({ kind: "flatMonthlyTier", amountUsd: 59, includedUnits: 1500 }, 100)).toBe(0);
    expect(computeProviderCostUsd({ kind: "operatorHours" }, 100)).toBe(0);
  });
});
