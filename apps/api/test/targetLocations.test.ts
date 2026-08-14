// #214 — up to three covered-market target locations, one deck over the union, city-level filter
// (option 2, owner decision on #124's trail), per-market work-rights, and the #107 regression #124
// recorded: a sponsorship "no" for one market must never withdraw another market's postings.
import { describe, expect, it } from "vitest";
import type { PostingProviderPolicyV1, ProviderPostingRecordV1 } from "@jobcrush/contracts";
import { initialProductionFamilyFloors } from "../src/familyFloors.js";
import {
  cityForLocationText,
  makePostingRetriever,
  resolveSearchArea,
  resolvedMarketsFor,
  type RetrievalRequest,
} from "../src/postingRetrieval.js";
import { InMemoryPostingStore } from "../src/postingStore.js";
import { eligibilityCandidates } from "../src/eligibilityDiscovery.js";
import { ANY_FAMILY, type EligibilityFact } from "../src/eligibility.js";
import { findWithdrawingRequirement, partitionByWithdrawal } from "../src/withdrawal.js";

const policy = (
  providerId: string,
  regionsServed: string[],
): PostingProviderPolicyV1 => ({
  schemaVersion: "2",
  providerId,
  regionsServed,
  authorityRank: 0,
  permitsStorage: true,
  permitsMatching: true,
  attributionRequired: false,
  attributionTemplate: null,
  rateLimit: { perSecond: null, perMinute: null, perDay: null, perMonth: null },
  retry: { maxAttempts: 1, backoffMs: 0 },
  timeoutMs: 1000,
  costModel: { kind: "operatorHours" },
  freshnessTtlHours: 24,
});

const now = new Date("2026-08-13T12:00:00.000Z");
const record = (id: string, location: string): ProviderPostingRecordV1 => ({
  schemaVersion: "3",
  providerId: "multi",
  providerPostingId: id,
  title: "IT Project Manager",
  company: "Acme",
  location,
  sourceUrl: `https://example.com/${id}`,
  excerpt: "Lead delivery across regional teams",
  postedAt: "2026-08-01T00:00:00.000Z",
  capturedAt: now.toISOString(),
  verifiedLiveAt: now.toISOString(),
  expiresAt: null,
  attribution: null,
  skills: ["delivery"],
  language: "en",
});

const RECORDS_BY_REGION: Record<string, ProviderPostingRecordV1[]> = {
  HK: [record("hk-1", "Wan Chai District, Hong Kong SAR")],
  AU: [
    record("au-melbourne", "Melbourne VIC, Australia"),
    record("au-sydney", "Sydney, New South Wales, Australia"),
    record("au-anywhere", "Australia"),
  ],
};

function retriever(fetchedRegions: string[] = []) {
  return makePostingRetriever({
    registry: [policy("multi", ["HK", "AU"])],
    providers: [
      {
        providerId: "multi",
        fetch: async ({ regionCode }) => {
          fetchedRegions.push(regionCode);
          return { ok: true, records: RECORDS_BY_REGION[regionCode] ?? [] };
        },
      },
    ],
    store: new InMemoryPostingStore(),
    productionFamilyFloors: initialProductionFamilyFloors(),
    now: () => now,
  });
}

const request = (searchAreas: string[]): RetrievalRequest => ({
  targetRole: "IT Project Manager",
  searchAreas,
  family: { familyId: "it-project-delivery", version: 1 },
  checkpoint: "essential_floor_covered",
  confirmedEvidence: [{ semanticKey: "delivery", fieldLabel: "delivery" }],
  explicitNegatives: [],
});

describe("#214 resolveSearchArea — city-level targets", () => {
  it.each([
    ["Melbourne", "Australia", "Melbourne", "Melbourne", "AU"],
    ["Sydney, Australia", "Australia", "Sydney", "Sydney", "AU"],
    ["Australia", "Australia", null, "Australia", "AU"],
    ["Saigon", "Vietnam", "Ho Chi Minh City", "Ho Chi Minh City", "VN"],
    // city-states and districts stay country-level: HK is one city, Kowloon a district of it
    ["Kowloon", "Hong Kong", null, "Hong Kong", "HK"],
    ["Singapore", "Singapore", null, "Singapore", "SG"],
  ])("%s → market %s, city %s, label %s", (text, market, city, label, regionCode) => {
    expect(resolveSearchArea(text)).toEqual(
      expect.objectContaining({ covered: true, market, city, label, regionCode }),
    );
  });

  it("refuses an uncovered place with the coverage list", () => {
    expect(resolveSearchArea("Paris")).toEqual({
      covered: false,
      coverage: ["Hong Kong", "Singapore", "Vietnam", "Australia"],
    });
  });

  it("cityForLocationText places a stated city and never guesses an unstated one", () => {
    expect(cityForLocationText("Melbourne VIC, Australia")).toBe("Melbourne");
    expect(cityForLocationText("Remote — Australia")).toBeNull();
    expect(cityForLocationText("Wan Chai District, Hong Kong SAR")).toBeNull();
  });

  it("resolvedMarketsFor dedupes two cities of one country to one market", () => {
    const entries = [{ text: "Melbourne" }, { text: "Sydney" }, { text: "Vietnam" }];
    expect(resolvedMarketsFor(entries)).toEqual(["Australia", "Vietnam"]);
  });
});

describe("#214 the deck is one deck over the union", () => {
  it("queries the union of the selected markets' regions and keeps only postings resolvable to them", async () => {
    const fetched: string[] = [];
    const result = await retriever(fetched)(request(["Hong Kong", "Australia"]));
    expect(fetched.sort()).toEqual(["AU", "HK"]);
    if (result.outcome !== "relevant_postings") throw new Error(`unexpected outcome ${result.outcome}`);
    expect(result.postings.map((p) => p.sources[0]!.providerPostingId).sort()).toEqual([
      "au-anywhere",
      "au-melbourne",
      "au-sydney",
      "hk-1",
    ]);
  });

  it("option 2: a Melbourne target keeps Melbourne and city-less Australian postings, drops Sydney's, and never fetches other regions", async () => {
    const fetched: string[] = [];
    const result = await retriever(fetched)(request(["Melbourne"]));
    expect(fetched).toEqual(["AU"]);
    if (result.outcome !== "relevant_postings") throw new Error(`unexpected outcome ${result.outcome}`);
    expect(result.postings.map((p) => p.sources[0]!.providerPostingId).sort()).toEqual([
      "au-anywhere",
      "au-melbourne",
    ]);
  });

  it("a country-level chip alongside a city chip keeps the whole country's postings", async () => {
    const result = await retriever()(request(["Melbourne", "Australia"]));
    if (result.outcome !== "relevant_postings") throw new Error(`unexpected outcome ${result.outcome}`);
    expect(result.postings.map((p) => p.sources[0]!.providerPostingId).sort()).toEqual([
      "au-anywhere",
      "au-melbourne",
      "au-sydney",
    ]);
  });

  it("no covered selection is missing intent / not covered", async () => {
    expect(await retriever()(request([]))).toEqual(
      expect.objectContaining({ outcome: "invalid_request", code: "missing_intent" }),
    );
    expect(await retriever()(request(["Paris"]))).toEqual(
      expect.objectContaining({ outcome: "invalid_request", code: "search_area_not_covered" }),
    );
  });
});

describe("#214 work-rights is asked once per selected market", () => {
  it("N markets → N instances of the existing per-market question, each at its own scope", () => {
    const questions = eligibilityCandidates(ANY_FAMILY, ["Hong Kong", "Australia"]);
    const workRights = questions.filter((q) => q.itemId.startsWith("eligibility-work-rights-"));
    expect(workRights.map((q) => q.itemId)).toEqual([
      "eligibility-work-rights-hong-kong",
      "eligibility-work-rights-australia",
    ]);
    expect(workRights.map((q) => q.question)).toEqual([
      "Can you already work in Hong Kong without visa sponsorship?",
      "Can you already work in Australia without visa sponsorship?",
    ]);
    // two chips in one country → one market → still one question
    expect(
      eligibilityCandidates(ANY_FAMILY, ["Australia"]).filter((q) =>
        q.itemId.startsWith("eligibility-work-rights-"),
      ),
    ).toHaveLength(1);
  });
});

// The regression #124 recorded from #107: a sponsorship "no" answered for Hong Kong and nothing for
// Australia — Hong Kong postings withdraw, Australian postings stay. withdrawal.ts itself needed no
// change; this pins that its region-matching already does the right thing under multi-market intent.
describe("#214 regression — per-market withdrawal split (#107)", () => {
  const facts: EligibilityFact[] = [
    { dimension: "work-rights", familyId: "hong-kong", value: "needs-sponsorship", label: "Right to work" },
  ];
  const blockingWorkRights = {
    schemaVersion: "1" as const,
    requirements: [
      {
        kind: "blocking" as const,
        text: "Must have the right to work here without sponsorship",
        eligibilityDimension: "work-rights" as const,
      },
    ],
  };

  it("withdraws the answered market's posting and keeps the unanswered market's", () => {
    const hk = { posting: { location: "Wan Chai District, Hong Kong SAR" }, adReq: blockingWorkRights };
    const au = { posting: { location: "Sydney, New South Wales, Australia" }, adReq: blockingWorkRights };
    const { open, withdrawn } = partitionByWithdrawal([hk, au], facts);
    expect(open).toEqual([au]);
    expect(withdrawn.total).toBe(1);
  });

  it("a posting placeable in no market fails open", () => {
    expect(
      findWithdrawingRequirement(blockingWorkRights, facts, "APAC region"),
    ).toBeNull();
  });
});
