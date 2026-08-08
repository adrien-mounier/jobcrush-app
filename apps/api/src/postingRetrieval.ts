import { createHash } from "node:crypto";
import type {
  PostingProviderPolicyV1,
  PostingRetrievalResultV1,
  ProviderPostingRecordV1,
} from "@jobcrush/contracts";
import type { ProductionFamilyFloorStore } from "./familyFloors.js";
import type { PostingProvider, PostingProviderFetchInput, PostingProviderFetchResult } from "./postingProvider.js";
import type { PostingStore } from "./postingStore.js";
import { dedupePostings, loadActivePostingProviders } from "./postings.js";
import type { RetrievalSnapshot } from "./sessions.js";

export interface RetrievalSignal {
  semanticKey: string;
  fieldLabel: string | null;
}

export interface RetrievalNegative extends RetrievalSignal {
  fieldValue: string | null;
}

export interface RetrievalRequest {
  targetRole: string | null;
  searchArea: string | null;
  family: { familyId: string; version: number } | null;
  checkpoint: "family_confirmed" | "essential_floor_covered" | null;
  confirmedEvidence: RetrievalSignal[];
  explicitNegatives: RetrievalNegative[];
}

export const unavailablePostingRetrieval = async (): Promise<PostingRetrievalResultV1> => ({
  schemaVersion: "4",
  outcome: "provider_unavailable",
  coverage: { providersQueried: [], providersUnavailable: ["unconfigured"], complete: false },
  reason: "posting retrieval is not configured",
  retryable: false,
});

const AREA_REGIONS: Readonly<Record<string, string[]>> = {
  "hong kong": ["HK"],
  hk: ["HK"],
  singapore: ["SG"],
  sg: ["SG"],
  vietnam: ["VN"],
  vn: ["VN"],
  "ho chi minh city": ["VN"],
  "ho chi minh": ["VN"],
  hcmc: ["VN"],
  hanoi: ["VN"],
  australia: ["AU"],
  au: ["AU"],
  sydney: ["AU"],
  melbourne: ["AU"],
  brisbane: ["AU"],
  perth: ["AU"],
};

const MAX_QUERY_TERMS = 12;
const MAX_QUERY_TERM_LENGTH = 40;
// This is a coordination cache, not a replacement for provider freshness checks. It is deliberately
// far shorter than every active policy's TTL; a newly activated shorter-TTL policy must lower it.
const SNAPSHOT_REUSE_MS = 5 * 60 * 1000;
const RETRY_SNAPSHOT_REUSE_MS = 30 * 1000;

export function resolveSearchAreaToRegions(searchArea: string): string[] {
  return [...(AREA_REGIONS[searchArea.trim().toLocaleLowerCase("en-US")] ?? [])];
}

export function providersFor(
  regions: string[],
  registry: PostingProviderPolicyV1[],
): PostingProviderPolicyV1[] {
  const wanted = new Set(regions);
  return registry
    .filter((policy) => policy.regionsServed.includes("*") || policy.regionsServed.some((r) => wanted.has(r)))
    .sort((a, b) => a.authorityRank - b.authorityRank || a.providerId.localeCompare(b.providerId));
}

export interface PostingRetrieverOptions {
  registry?: PostingProviderPolicyV1[];
  providers: PostingProvider[];
  store: PostingStore;
  productionFamilyFloors: ProductionFamilyFloorStore;
  now?: () => Date;
  dedupe?: typeof dedupePostings;
  logFailure?: (providerId: string, category: PostingRetrievalFailureCategory) => void;
  auditFreshness?: (event: PostingFreshnessAuditEvent) => void;
}

export type PostingRetrievalFailureCategory = "driver_missing" | "provider_failure" | "store_failure";
export interface PostingFreshnessAuditEvent {
  providerId: string;
  checkedAt: string;
  status: "fresh" | "stale";
}

function words(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function boundedKeywords(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    for (const word of words(value)) {
      const term = word.slice(0, MAX_QUERY_TERM_LENGTH);
      const key = term.toLocaleLowerCase("en-US");
      if (key.length < 2 || seen.has(key)) continue;
      seen.add(key);
      out.push(term);
      if (out.length === MAX_QUERY_TERMS) return out;
    }
  }
  return out;
}

function queryKeywords(input: RetrievalRequest): string[] {
  return boundedKeywords([
    input.targetRole ?? "",
    ...input.confirmedEvidence.map((item) => item.fieldLabel ?? item.semanticKey),
  ]);
}

function negativeTerms(input: RetrievalRequest): string[] {
  return input.explicitNegatives
    .flatMap((item) => [item.fieldValue, item.fieldLabel])
    .filter((value): value is string => !!value)
    .map((value) => value.trim().toLocaleLowerCase("en-US"))
    .filter(Boolean);
}

function suppressed(record: ProviderPostingRecordV1, negatives: string[]): boolean {
  const fields = [record.title, ...record.skills].map((value) => value.trim().toLocaleLowerCase("en-US"));
  return negatives.some((negative) => fields.some((field) => field === negative));
}

function isFresh(record: ProviderPostingRecordV1, policy: PostingProviderPolicyV1, nowMs: number): boolean {
  const verifiedMs = Date.parse(record.verifiedLiveAt);
  const ttlMs = Math.min(24, policy.freshnessTtlHours) * 60 * 60 * 1000;
  if (!Number.isFinite(verifiedMs) || verifiedMs > nowMs || nowMs - verifiedMs > ttlMs) return false;
  if (record.expiresAt === null) return true;
  const expiresMs = Date.parse(record.expiresAt);
  return Number.isFinite(expiresMs) && expiresMs > nowMs;
}

function invalid(code: "missing_intent" | "family_not_published" | "floor_not_covered" | "search_area_not_covered") {
  return { schemaVersion: "4" as const, outcome: "invalid_request" as const, code };
}

export function retrievalFingerprint(input: RetrievalRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        targetRole: input.targetRole,
        searchArea: input.searchArea,
        family: input.family,
        checkpoint: input.checkpoint,
        confirmedEvidence: input.confirmedEvidence,
        explicitNegatives: input.explicitNegatives,
      }),
    )
    .digest("hex");
}

export function isReusableRetrievalSnapshot(
  snapshot: RetrievalSnapshot | null,
  requestFingerprint: string,
  registry: PostingProviderPolicyV1[] = loadActivePostingProviders(),
  nowMs = Date.now(),
): boolean {
  if (!snapshot || snapshot.requestFingerprint !== requestFingerprint) return false;
  const recordedMs = Date.parse(snapshot.recordedAt);
  if (!Number.isFinite(recordedMs) || recordedMs > nowMs) return false;
  if (snapshot.result.outcome === "invalid_request") {
    return nowMs - recordedMs <= RETRY_SNAPSHOT_REUSE_MS;
  }
  if (snapshot.result.outcome !== "relevant_postings" && snapshot.result.outcome !== "empty_pool") {
    return nowMs - recordedMs <= RETRY_SNAPSHOT_REUSE_MS;
  }
  const retrievedMs = Date.parse(snapshot.result.retrievedAt);
  if (!Number.isFinite(retrievedMs) || retrievedMs > nowMs || nowMs - retrievedMs > SNAPSHOT_REUSE_MS) {
    return false;
  }
  if (snapshot.result.outcome === "empty_pool") {
    const queriedPolicies = snapshot.result.coverage.providersQueried.map((providerId) =>
      registry.find((policy) => policy.providerId === providerId),
    );
    if (queriedPolicies.length === 0 || queriedPolicies.some((policy) => !policy)) return false;
    const ttlMs = Math.min(
      SNAPSHOT_REUSE_MS,
      ...queriedPolicies.map((policy) => policy!.freshnessTtlHours * 60 * 60 * 1000),
    );
    return nowMs - retrievedMs <= ttlMs;
  }
  return snapshot.result.postings.every((posting) => {
    if (posting.expiresAt !== null) {
      const expiresMs = Date.parse(posting.expiresAt);
      if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) return false;
    }
    const sourcePolicies = posting.sources.map((source) =>
      registry.find((policy) => policy.providerId === source.providerId),
    );
    if (sourcePolicies.some((policy) => !policy)) return false;
    const verifiedMs = Date.parse(posting.verifiedLiveAt);
    const ttlHours = Math.min(24, ...sourcePolicies.map((policy) => policy!.freshnessTtlHours));
    return Number.isFinite(verifiedMs) && verifiedMs <= nowMs && nowMs - verifiedMs <= ttlHours * 60 * 60 * 1000;
  });
}

/** A curated regional slice is authoritative only after an operator has durably marked that region
 * checked. Stored rows alone cannot prove that an untouched region is genuinely empty. */
export class StoreBackedCuratedPostingProvider implements PostingProvider {
  readonly providerId = "curated-pool";

  constructor(
    private readonly store: Pick<PostingStore, "durable" | "listByProvider" | "getRegionRefresh">,
    private readonly policy: PostingProviderPolicyV1,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async fetch(input: PostingProviderFetchInput): Promise<PostingProviderFetchResult> {
    if (!this.store.durable) {
      return { ok: false, reason: "curated refresh authority unavailable", retryable: false };
    }
    const checkedAt = await this.store.getRegionRefresh(this.providerId, input.regionCode);
    const nowMs = this.now().getTime();
    const checkedAtMs = checkedAt === null ? Number.NaN : Date.parse(checkedAt);
    const ttlMs = Math.min(24, this.policy.freshnessTtlHours) * 60 * 60 * 1000;
    if (!Number.isFinite(checkedAtMs) || checkedAtMs > nowMs || nowMs - checkedAtMs > ttlMs) {
      return { ok: false, reason: "curated region has no fresh operator refresh", retryable: false };
    }
    const keywords = boundedKeywords(input.queryKeywords).map((keyword) => keyword.toLocaleLowerCase("en-US"));
    if (keywords.length === 0) return { ok: true, records: [] };
    const requiredMatches = keywords.length === 1 ? 1 : 2;
    const records = await this.store.listByProvider(this.providerId);
    return {
      ok: true,
      records: records.filter((record) => {
        if (!resolveSearchAreaToRegions(record.location).includes(input.regionCode)) return false;
        const searchable = new Set(
          words([record.title, record.excerpt, ...record.skills].join(" ")).map((word) =>
            word.toLocaleLowerCase("en-US"),
          ),
        );
        return keywords.filter((keyword) => searchable.has(keyword)).length >= requiredMatches;
      }),
    };
  }
}

export function storeBackedPostingProvidersFor(
  registry: PostingProviderPolicyV1[],
  store: Pick<PostingStore, "durable" | "listByProvider" | "getRegionRefresh">,
): PostingProvider[] {
  const policy = registry.find((entry) => entry.providerId === "curated-pool");
  return policy ? [new StoreBackedCuratedPostingProvider(store, policy)] : [];
}

export function makePostingRetriever(
  opts: PostingRetrieverOptions,
): (input: RetrievalRequest) => Promise<PostingRetrievalResultV1> {
  const registry = opts.registry ?? loadActivePostingProviders();
  const providerById = new Map(opts.providers.map((provider) => [provider.providerId, provider]));
  const now = opts.now ?? (() => new Date());
  const dedupe = opts.dedupe ?? dedupePostings;
  const logFailure =
    opts.logFailure ??
    ((providerId: string, category: PostingRetrievalFailureCategory) =>
      console.error("[ops] posting retrieval failed", { providerId, category }));
  const auditFreshness =
    opts.auditFreshness ??
    ((event: PostingFreshnessAuditEvent) => console.info("[ops] posting freshness checked", event));

  return async (input) => {
    if (!input.targetRole?.trim() || !input.searchArea?.trim()) return invalid("missing_intent");
    if (!input.family) return invalid("family_not_published");
    const publication = opts.productionFamilyFloors.get(input.family.familyId, input.family.version);
    if (
      !publication ||
      publication.publicationStatus !== "published" ||
      publication.floor.source !== "production_research" ||
      !publication.floor.productionRewardEligible
    ) {
      return invalid("family_not_published");
    }
    if (input.checkpoint !== "essential_floor_covered") return invalid("floor_not_covered");

    const regions = resolveSearchAreaToRegions(input.searchArea);
    const eligible = providersFor(regions, registry);
    if (regions.length === 0 || eligible.length === 0) return invalid("search_area_not_covered");

    const keywords = queryKeywords(input);
    const negatives = negativeTerms(input);
    const outcomes = await Promise.all(
      eligible.map(async (policy) => {
        const provider = providerById.get(policy.providerId);
        if (!provider) {
          logFailure(policy.providerId, "driver_missing");
          return { policy, ok: false as const, retryable: false };
        }
        let result: PostingProviderFetchResult;
        try {
          result = await provider.fetch({ regionCode: regions[0]!, queryKeywords: keywords });
        } catch {
          logFailure(policy.providerId, "provider_failure");
          return { policy, ok: false as const, retryable: true };
        }
        if (!result.ok) {
          logFailure(policy.providerId, "provider_failure");
          return { policy, ok: false as const, retryable: result.retryable };
        }
        try {
          const stored = await Promise.all(result.records.map((record) => opts.store.upsert(record)));
          return { policy, ok: true as const, records: stored };
        } catch {
          logFailure(policy.providerId, "store_failure");
          return {
            policy,
            ok: false as const,
            retryable: true,
          };
        }
      }),
    );

    // Provider records stamp verifiedLiveAt after their HTTP response. Taking this clock before the
    // fan-out would make a genuinely fresh record appear to come from the future and classify stale.
    const fetchedAt = now();
    const fetchedAtIso = fetchedAt.toISOString();

    const providersQueried = outcomes.filter((entry) => entry.ok).map((entry) => entry.policy.providerId);
    const failures = outcomes.filter((entry): entry is Extract<(typeof outcomes)[number], { ok: false }> => !entry.ok);
    const providersUnavailable = failures.map((entry) => entry.policy.providerId);
    const coverage = {
      providersQueried,
      providersUnavailable,
      complete: providersUnavailable.length === 0,
    };
    const stale: ProviderPostingRecordV1[] = [];
    const fresh: ProviderPostingRecordV1[] = [];
    for (const outcome of outcomes) {
      if (!outcome.ok) continue;
      for (const record of outcome.records) {
        if (suppressed(record, negatives)) continue;
        const status = isFresh(record, outcome.policy, fetchedAt.getTime()) ? "fresh" : "stale";
        auditFreshness({ providerId: outcome.policy.providerId, checkedAt: fetchedAtIso, status });
        if (status === "fresh") fresh.push(record);
        else stale.push(record);
      }
    }

    const postings = dedupe(fresh, registry);
    if (postings.length > 0) {
      return { schemaVersion: "4", outcome: "relevant_postings", postings, coverage, retrievedAt: fetchedAtIso };
    }
    if (!coverage.complete) {
      return {
        schemaVersion: "4",
        outcome: "provider_unavailable",
        coverage,
        reason: failures.map((entry) => `${entry.policy.providerId}: provider unavailable`).join("; "),
        retryable: failures.some((entry) => entry.retryable),
      };
    }
    if (stale.length > 0) {
      return {
        schemaVersion: "4",
        outcome: "stale_data",
        lastKnownFreshAt: stale.map((record) => record.verifiedLiveAt).sort().at(-1)!,
        retrievedAt: fetchedAtIso,
      };
    }
    return { schemaVersion: "4", outcome: "empty_pool", coverage, retrievedAt: fetchedAtIso };
  };
}
