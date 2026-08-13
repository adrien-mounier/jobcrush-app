import { createHash } from "node:crypto";
import type {
  PostingProviderPolicyV1,
  PostingRetrievalResultV1,
  ProviderPostingRecordV1,
} from "@jobcrush/contracts";
import type { ProductionFamilyFloorStore } from "./familyFloors.js";
import { TechmapPostingProvider } from "./postingProvider.js";
import type { PostingProvider, PostingProviderFetchInput, PostingProviderFetchResult } from "./postingProvider.js";
import type { PostingStore } from "./postingStore.js";
import { dedupePostings, loadActivePostingProviders } from "./postings.js";
import type { RetrievalSnapshot, SessionRecord } from "./sessions.js";
import type { ClaimRecord } from "./claims.js";
import { slug } from "./discovery.js";
import { isTailorClaimId } from "./tailor.js";

export interface RetrievalSignal {
  semanticKey: string;
  fieldLabel: string | null;
}

export interface RetrievalNegative extends RetrievalSignal {
  fieldValue: string | null;
}

export interface RetrievalRequest {
  targetRole: string | null;
  /** #214: the words-as-typed of each selected target location (up to 3) — the deck is one deck
   *  over the UNION of their region codes, never one deck per market. */
  searchAreas: string[];
  family: { familyId: string; version: number } | null;
  checkpoint: "family_confirmed" | "essential_floor_covered" | null;
  confirmedEvidence: RetrievalSignal[];
  explicitNegatives: RetrievalNegative[];
}

/** Builds the one server-owned retrieval request used to fingerprint deck, want, and tailor reads.
 * Tailor answers are scoped to the selected advert, so they must not retune its retrieval snapshot. */
export function retrievalRequestForSession(
  session: Pick<SessionRecord, "intent" | "discovery">,
  confirmed: ReadonlyArray<Pick<ClaimRecord, "id" | "semantic_key" | "field_label">>,
  negatives: ReadonlyArray<Pick<ClaimRecord, "id" | "semantic_key" | "field_label" | "field_value">>,
): RetrievalRequest {
  return {
    targetRole: session.intent.targetRole,
    searchAreas: session.intent.searchAreas.map((entry) => entry.text),
    family: session.discovery.floor,
    checkpoint: session.discovery.checkpoint,
    confirmedEvidence: confirmed
      .filter((claim) => !isTailorClaimId(claim.id))
      .map((claim) => ({
        semanticKey: claim.semantic_key,
        fieldLabel: claim.field_label,
      })),
    explicitNegatives: negatives
      .filter((claim) => !isTailorClaimId(claim.id))
      .map((claim) => ({
        semanticKey: claim.semantic_key,
        fieldLabel: claim.field_label,
        fieldValue: claim.field_value,
      })),
  };
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
  kowloon: ["HK"], // #184 QA: a major HK district, obvious enough to type as the whole answer
  hkg: ["HK"], // #184 QA: the airport code — exact-match only (3 chars), see regionsForLocationText
  singapore: ["SG"],
  sg: ["SG"],
  vietnam: ["VN"],
  vn: ["VN"],
  "ho chi minh city": ["VN"],
  "ho chi minh": ["VN"],
  hcmc: ["VN"],
  saigon: ["VN"], // #184 QA: the pre-1976 name, still the everyday one in casual English
  hanoi: ["VN"],
  australia: ["AU"],
  au: ["AU"],
  sydney: ["AU"],
  melbourne: ["AU"],
  brisbane: ["AU"],
  perth: ["AU"],
};

// #214 city-level targets (owner decision on #124's trail, 2026-08-13): alias → the canonical city
// name, for markets with more than one city. Keys are a SUBSET of AREA_REGIONS' keys (the same
// vocabulary, one more column — never a second list), so anything here already resolves to a covered
// region above. Hong Kong and Singapore are city-states — country-level always — so only Vietnam and
// Australia cities appear. "kowloon" stays country-level on purpose: it is a district of the one HK
// city, not a second city to filter by.
const AREA_CITIES: Readonly<Record<string, string>> = {
  "ho chi minh city": "Ho Chi Minh City",
  "ho chi minh": "Ho Chi Minh City",
  hcmc: "Ho Chi Minh City",
  saigon: "Ho Chi Minh City",
  hanoi: "Hanoi",
  sydney: "Sydney",
  melbourne: "Melbourne",
  brisbane: "Brisbane",
  perth: "Perth",
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

/** #182 QA round 3, must-fix: unlike resolveSearchAreaToRegions's EXACT match (built for a clean,
 *  single-token search area or provider-set location), a FIXTURE posting's own `location` is free
 *  text with extra detail ("Wan Chai District, Hong Kong SAR", "Sydney, New South Wales, Australia")
 *  — this SCANS the same AREA_REGIONS vocabulary (the honest, already-audited source, not a new list)
 *  for any of its keys appearing as a substring. Short abbreviation keys ("hk", "sg", "vn", "au") are
 *  skipped here — exact-match-safe, but a substring scan over free text would false-positive on
 *  ordinary words that happen to contain those two letters. Returns [] (never guesses) when nothing
 *  recognisable is found — withdrawal.ts's own honest "cannot place this posting, never withdraw"
 *  case (a region-only "APAC" listing, or a market outside today's four, e.g. "Shenzhen, China").
 *
 *  #184: whitespace runs collapse to one space before scanning — "Hong  Kong" (a stray double space,
 *  the ticket's own "punctuation must not defeat it" case) does not literally contain "hong kong" as
 *  a substring otherwise, so a genuinely covered typo would read as uncovered. */
export function regionsForLocationText(location: string): string[] {
  const lower = location.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  const regions = new Set<string>();
  for (const [key, codes] of Object.entries(AREA_REGIONS)) {
    if (key.length < 4) continue; // abbreviation keys — exact-match only, see doc above
    if (lower.includes(key)) for (const code of codes) regions.add(code);
  }
  return [...regions];
}

// #184 — region code -> the plain country/territory name the coverage message and a covered
// confirmation both print ("We'll search Hong Kong."). Not a second coverage list: WHICH codes are
// covered still comes from the registry (coveredRegionCodes below); this only names a code the
// registry already emitted. A code this map doesn't know falls back to the raw code itself
// (regionDisplayName) rather than throwing — visible and honest, never a 500 on a registry edit.
const REGION_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  HK: "Hong Kong",
  SG: "Singapore",
  VN: "Vietnam",
  AU: "Australia",
};

function regionDisplayName(code: string): string {
  return REGION_DISPLAY_NAMES[code] ?? code;
}

/** #184: the region codes this product actually covers, in the registry's own first-declared order
 *  — never a hand-typed list. `"*"` (curated-pool's own regionsServed entry) names no specific region
 *  and is skipped: it means "also eligible wherever a NAMED provider already covers", not a fifth
 *  covered place on its own. Defaults to the SAME registry retrieval already trusts
 *  (loadActivePostingProviders, postingRetrieval.ts's own makePostingRetriever) so "covered" here can
 *  never claim more than retrieval could actually serve. */
export function coveredRegionCodes(
  registry: PostingProviderPolicyV1[] = loadActivePostingProviders(),
): string[] {
  const codes = new Set<string>();
  for (const policy of registry) {
    for (const region of policy.regionsServed) {
      if (region !== "*") codes.add(region);
    }
  }
  return [...codes];
}

/** #214 — which canonical city a free-text location names, or null when it names none we know
 *  (country-only, "Remote — Australia", a district, an unknown town). Same normalisation and
 *  substring rule as regionsForLocationText — one scanning idiom, two vocabularies. */
export function cityForLocationText(location: string): string | null {
  const lower = location.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  const exact = AREA_CITIES[lower];
  if (exact) return exact;
  for (const [key, city] of Object.entries(AREA_CITIES)) {
    if (key.length < 4) continue; // same abbreviation guard as regionsForLocationText
    if (lower.includes(key)) return city;
  }
  return null;
}

export type SearchAreaResolution =
  | {
      covered: true;
      market: string;
      marketKey: string;
      regionCode: string;
      /** #214: the canonical city when the typed words name one ("Melbourne"); null for a
       *  country-level target. City-states (HK/SG) are always null. */
      city: string | null;
      /** What the chip displays: the city when one was named, else the market. */
      label: string;
    }
  | { covered: false; coverage: string[] };

/** #184 — the search-area intent route's own resolver (routes/sessions.ts): free text in, an honest
 *  covered/uncovered verdict out. Robustness against "trailing country names, common city aliases,
 *  and punctuation" (the ticket's own wording) comes from trying BOTH of this module's existing
 *  matchers — resolveSearchAreaToRegions (exact, handles a bare alias like "hk" or "Singapore" typed
 *  alone) and regionsForLocationText (substring, handles "Sydney, Australia" or "Hong Kong SAR.") —
 *  and keeping only the FIRST match that is actually in today's covered set (deterministic: both
 *  matchers iterate AREA_REGIONS in its own declared order). `market`/`marketKey` are the CANONICAL
 *  country-level name for whichever region matched — "Sydney" resolves, but confirms back as
 *  "Australia", the same name coveredRegionCodes()/the coverage message use, never the visitor's raw
 *  city text. `marketKey` is `slug(market)` — country-level, e.g. "hong-kong"/"singapore"/"vietnam"/
 *  "australia" — which is BY CONSTRUCTION the same slug a role naming that country outright already
 *  produced under #182 (see discovery.test.ts's compat test); only a city-specific old answer (e.g.
 *  a #182-era "sydney") diverges, an accepted pre-launch difference, not a live migration. */
export function resolveSearchArea(
  text: string,
  registry: PostingProviderPolicyV1[] = loadActivePostingProviders(),
): SearchAreaResolution {
  const covered = new Set(coveredRegionCodes(registry));
  const candidates = [...resolveSearchAreaToRegions(text), ...regionsForLocationText(text)];
  const matched = candidates.find((region) => covered.has(region));
  if (matched) {
    const market = regionDisplayName(matched);
    const city = cityForLocationText(text);
    return {
      covered: true,
      market,
      marketKey: slug(market),
      regionCode: matched,
      city,
      label: city ?? market,
    };
  }
  return { covered: false, coverage: [...covered].map(regionDisplayName) };
}

/** #214 — the covered market names in registry order, for the coverage line and the client's own
 *  refusal copy. The same coveredRegionCodes()/regionDisplayName pair resolveSearchArea's uncovered
 *  branch uses — named once so routes never re-derive it. */
export function coveredMarketNames(
  registry: PostingProviderPolicyV1[] = loadActivePostingProviders(),
): string[] {
  return coveredRegionCodes(registry).map(regionDisplayName);
}

/** #214 — the front-door/profile type-ahead's completion data: every covered alias in AREA_REGIONS
 *  paired with the canonical market name it resolves to ("sydney" → "Australia"). Served to the
 *  client so its suggestions and chip labels come from the ONE vocabulary resolveSearchArea itself
 *  matches, never a second hand-typed list. Registry-filtered the same way resolveSearchArea is, so
 *  an uncovered alias never completes. */
export function searchAreaVocabulary(
  registry: PostingProviderPolicyV1[] = loadActivePostingProviders(),
): Array<{ alias: string; market: string; label: string }> {
  const covered = new Set(coveredRegionCodes(registry));
  const out: Array<{ alias: string; market: string; label: string }> = [];
  for (const [alias, codes] of Object.entries(AREA_REGIONS)) {
    const code = codes.find((c) => covered.has(c));
    if (code) {
      const market = regionDisplayName(code);
      out.push({ alias, market, label: AREA_CITIES[alias] ?? market });
    }
  }
  return out;
}

/** #214 — the unique canonical market names the session's target locations resolve to, in chip
 *  order. Work-rights is asked once per MARKET (visas are national — Melbourne + Sydney chips still
 *  produce one Australia question), so eligibilityDiscovery's per-market questions take this list. */
export function resolvedMarketsFor(searchAreas: ReadonlyArray<{ text: string }>): string[] {
  const markets: string[] = [];
  for (const entry of searchAreas) {
    const resolution = resolveSearchArea(entry.text);
    if (resolution.covered && !markets.includes(resolution.market)) markets.push(resolution.market);
  }
  return markets;
}

/** #214 — the unique chip labels (city when a city was typed, else market), in chip order — what
 *  display copy joins: "We'll look for {role} in Melbourne and Vietnam." */
export function resolvedAreaLabelsFor(searchAreas: ReadonlyArray<{ text: string }>): string[] {
  const labels: string[] = [];
  for (const entry of searchAreas) {
    const resolution = resolveSearchArea(entry.text);
    if (resolution.covered && !labels.includes(resolution.label)) labels.push(resolution.label);
  }
  return labels;
}

/** #184: the ONE location signal — a confirmed search area resolved to its covered display name, or
 *  null when unset/uncovered. Replaces parseCity(role) at every site that used to guess a city from
 *  the job title text (routes/onboarding.ts's discoveryState/eligibility-question call sites, which
 *  pass `session.intent.searchArea` in — this function takes the raw string, not a session, so this
 *  module stays decoupled from the session type). Standards review: lives beside resolveSearchArea
 *  rather than as an onboarding.ts-local helper, so the route file's own ratchet is never paid for by
 *  shaving this module's documented rationale comments. */
export function resolvedCityFor(searchArea: string | null): string | null {
  if (!searchArea) return null;
  const resolution = resolveSearchArea(searchArea);
  return resolution.covered ? resolution.market : null;
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

// Extracted from routes/onboarding.ts (the ratchet's own remedy: extraction, not comment-shaving) —
// the ROUTE-level failure category for the /onboarding/cards retrieval-request/reconcile flow
// (claim/snapshot-read/retrieval/reconciliation/background), distinct from the PROVIDER-level
// PostingRetrievalFailureCategory above. `log` is passed in (Fastify's app.log) rather than imported,
// so this stays a pure logging helper with no framework dependency of its own.
export type RetrievalRouteFailureCategory =
  | "claim_failed"
  | "snapshot_read_failed"
  | "retrieval_failed"
  | "reconciliation_failed"
  | "background_failed";

export function logPostingRetrievalFailure(
  log: { error(bindings: { category: RetrievalRouteFailureCategory }, message: string): unknown },
  category: RetrievalRouteFailureCategory,
): void {
  log.error({ category }, "posting retrieval failed");
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
        searchAreas: input.searchAreas,
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
  // #174 must-fix 1 (round 2): the single declared source of "this driver implements curated-pool" —
  // read by IMPLEMENTED_PROVIDER_IDS below to build the boot-time "does an implementation exist"
  // check without constructing an instance.
  static readonly providerId = "curated-pool";
  readonly providerId = StoreBackedCuratedPostingProvider.providerId;

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

/**
 * Wires a StoreBackedCuratedPostingProvider whenever a curated-pool policy is present in the GIVEN
 * registry — deliberately retained, not dead code, even though today's active registry excludes
 * curated-pool (postings.ts's OPERATIONALLY_DISABLED_PROVIDER_IDS, #174: its own driver can't
 * certify freshness without a production operator-refresh caller that doesn't exist yet). The moment
 * that gap closes and curated-pool re-enters loadActivePostingProviders(), this wiring resumes with
 * no code change here.
 */
export function storeBackedPostingProvidersFor(
  registry: PostingProviderPolicyV1[],
  store: Pick<PostingStore, "durable" | "listByProvider" | "getRegionRefresh">,
): PostingProvider[] {
  const policy = registry.find((entry) => entry.providerId === StoreBackedCuratedPostingProvider.providerId);
  return policy ? [new StoreBackedCuratedPostingProvider(store, policy)] : [];
}

// #174 must-fix 1 (round 2): built from each driver CLASS's own declared static `providerId` — never
// a hand-typed list of strings maintained separately from the driver code. A provider id can only
// join this set by an actual driver class existing and declaring it; there is no way to "add" a
// phantom id here by editing this file alone.
const IMPLEMENTED_PROVIDER_IDS: ReadonlySet<string> = new Set([
  StoreBackedCuratedPostingProvider.providerId,
  TechmapPostingProvider.providerId,
]);

/**
 * #174 must-fix 1 (round 2): "does an IMPLEMENTATION exist for this active provider id" — deliberately
 * NOT "was a live instance constructed in this process". Those are different questions with different
 * correct failure modes, and round 1 of this fix conflated them (checked against main.ts's actual
 * `providers` array, which also made a MISSING API KEY a boot failure):
 *   - No implementation anywhere for an active row is a permanent, code-level defect that can only
 *     ever be a mistake (e.g. a registry row activated with no driver ever written for it) — fail
 *     fast at boot, naming the row. That is #174's own invariant, checked against IMPLEMENTED_
 *     PROVIDER_IDS above (real driver classes), never a mirror.
 *   - An implementation EXISTS but its factory declined for a config reason — e.g.
 *     postingProvider.ts's techmapProviderFromEnv returns null when TECHMAP_RAPIDAPI_KEY is unset —
 *     is a legitimate, ALREADY-HONEST runtime state, unchanged by this function: that row still boots
 *     fine, and driver_missing stays a LIVE, REACHABLE coverage.providersUnavailable category at every
 *     retrieval (makePostingRetriever's own logFailure call), reported honestly as provider_unavailable
 *     rather than crashing the process. Conflating the two turns one paid provider's missing key into
 *     a total outage (signup, upload, the deck, tailoring — all down), strictly worse than #174's own
 *     bug. Call this once, at boot, right after loadActivePostingProviders() — it takes the registry
 *     alone, never a constructed `providers` array, so a missing API key structurally cannot affect it.
 */
export function assertEveryActiveProviderIsImplemented(registry: PostingProviderPolicyV1[]): void {
  const unimplemented = registry.find((policy) => !IMPLEMENTED_PROVIDER_IDS.has(policy.providerId));
  if (unimplemented) {
    throw new Error(
      `posting-providers.json: "${unimplemented.providerId}" is active but no driver implementation ` +
        `exists for it anywhere (see postingProvider.ts / postingRetrieval.ts's own driver classes). ` +
        `Wire one, or keep the row out of the active registry.`,
    );
  }
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
    if (!input.targetRole?.trim() || input.searchAreas.every((area) => !area.trim())) {
      return invalid("missing_intent");
    }
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

    // #214: the deck is ONE deck over the UNION of the selected targets' region codes. Selections
    // that resolve to a city also carry that city for the per-region record filter below.
    const selections = input.searchAreas
      .map((area) => resolveSearchArea(area, registry))
      .filter((resolution): resolution is Extract<SearchAreaResolution, { covered: true }> => resolution.covered);
    const regions = [...new Set(selections.map((selection) => selection.regionCode))];
    const eligible = providersFor(regions, registry);
    if (regions.length === 0 || eligible.length === 0) return invalid("search_area_not_covered");

    // #214 option 2 (owner decision on #124's trail): with a city-level target active, a record in
    // that region stays iff it states that city OR states no recognisable city at all (country-only,
    // remote-in-country) — never punished for information it didn't state, the same fail-open
    // principle withdrawal.ts uses. A record clearly stating a DIFFERENT city is excluded. A
    // country-level selection for the region keeps everything.
    const keepsRecord = (regionCode: string, location: string): boolean => {
      const regionSelections = selections.filter((selection) => selection.regionCode === regionCode);
      const recordCity = cityForLocationText(location);
      return regionSelections.some(
        (selection) => selection.city === null || recordCity === null || recordCity === selection.city,
      );
    };

    const keywords = queryKeywords(input);
    const negatives = negativeTerms(input);
    const outcomes = await Promise.all(
      eligible.map(async (policy) => {
        const provider = providerById.get(policy.providerId);
        if (!provider) {
          logFailure(policy.providerId, "driver_missing");
          return { policy, ok: false as const, retryable: false };
        }
        // #214: one fetch per region this provider serves out of the union — a provider is queried
        // for every selected market it covers, not just the first.
        const policyRegions = policy.regionsServed.includes("*")
          ? regions
          : regions.filter((region) => policy.regionsServed.includes(region));
        let fetched: Array<{ regionCode: string; result: PostingProviderFetchResult }>;
        try {
          fetched = await Promise.all(
            policyRegions.map(async (regionCode) => ({
              regionCode,
              result: await provider.fetch({ regionCode, queryKeywords: keywords }),
            })),
          );
        } catch {
          logFailure(policy.providerId, "provider_failure");
          return { policy, ok: false as const, retryable: true };
        }
        const failed = fetched.filter(
          (entry): entry is { regionCode: string; result: Extract<PostingProviderFetchResult, { ok: false }> } =>
            !entry.result.ok,
        );
        if (failed.length > 0) {
          logFailure(policy.providerId, "provider_failure");
          return { policy, ok: false as const, retryable: failed.some((entry) => entry.result.retryable) };
        }
        try {
          const records = fetched.flatMap((entry) =>
            entry.result.ok
              ? entry.result.records.filter((record) => keepsRecord(entry.regionCode, record.location))
              : [],
          );
          const stored = await Promise.all(records.map((record) => opts.store.upsert(record)));
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
