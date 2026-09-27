// #100 — the posting-provider seam (§2.1, §2.6, §2.9, §2.10 of
// docs/research/live-posting-retrieval-contract.md). One provider answers ONE already-resolved
// region + query with its own ProviderPostingRecordV1[] or a distinguishable failure. Same
// one-interface-several-drivers shape as storage.ts (InMemoryBlobStorage / R2Storage /
// LocalDiskStorage): the interface, the deterministic test fake, and the one real driver built so
// far (TechmapPostingProvider) all live here.
//
// Deciding WHAT to fetch — search-area routing, provider fan-out, coverage assembly across several
// providers — is #101's job, not this file's. dedupePostings (postings.ts, #99) merges records from
// several providers into canonical postings; this file never does that itself.
import { ProviderPostingRecordV1, type PostingProviderPolicyV1 as PostingProviderPolicyV1Value, type ProviderPostingRecordV1 as ProviderPostingRecordV1Value } from "@jobcrush/contracts";
import { computeProviderCostUsd } from "./postings.js";
import { detectLanguage } from "./language.js";
import { addToCounter, incrementCounter } from "./counters.js";
import type { PostingStore } from "./postingStore.js";

export interface PostingProviderFetchInput {
  /** ISO 3166-1 alpha-2 region code, already resolved by the caller — resolving a search area to a
   *  region is #101's `resolveSearchAreaToRegions`, not this file's job. */
  regionCode: string;
  /** #240: JOB TITLES, one per entry — "project manager", not "project" and "manager". A driver
   *  sends each as a QUOTED PHRASE; unquoted, Techmap matches ANY word in the list, which is a
   *  twenty-fold difference in what comes back (measured live 2026-08-14, Hong Kong — the figures
   *  are pinned in techmapProvider.test.ts, so they live in one place). Never raw CV/claim text,
   *  and since #240 never evidence field labels either (§2.9 privacy holds a fortiori: the query is
   *  the typed target role plus the family's published market titles, nothing else). */
  queryKeywords: string[];
  page?: number;
  // #133 item 4: `size` deliberately REMOVED, not left as a no-op parameter. Measured live on
  // staging 2026-08-04 (three calls, same query): size=1, size=20, and size=50 all returned
  // pageSize=10, 10 items, totalCount=58 — Techmap's per-page count is a fixed vendor constant
  // (TECHMAP_PAGE_SIZE below), never caller-configurable, so a `size` field would silently do
  // nothing. Paging still works via `page`; only the per-page count is fixed.
}

export type PostingProviderFetchResult =
  | { ok: true; records: ProviderPostingRecordV1Value[] }
  | { ok: false; reason: string; retryable: boolean };

/**
 * One provider's fetch-and-normalize seam. `ok: false` can never be confused with a genuine empty
 * result (`ok: true, records: []`) — the AC's "a rate-limit or transport failure is distinguishable
 * from an empty result" holds by construction of this type, not by convention. This is deliberately
 * narrower than PostingRetrievalResultV1 (§2.7): that shape needs multi-provider `coverage`, which is
 * #101's assembly job — this file reuses its `reason`/`retryable` vocabulary (so a caller can lift a
 * failure straight into `coverage.providersUnavailable` + the eventual `provider_unavailable` arm)
 * without building the orchestration around it, per the ticket's own scope boundary.
 */
export interface PostingProvider {
  readonly providerId: string;
  fetch(input: PostingProviderFetchInput): Promise<PostingProviderFetchResult>;
}

/**
 * Deterministic fake, named and shaped like TestFixtureFamilyFloorStore (familyFloors.ts) —
 * structurally incapable of a live network call, so nothing that imports it can accidentally reach
 * Techmap in `pnpm test`. One canned result per instance; construct two instances with different
 * `providerId`s and different fixture records to exercise dedupePostings/coverage assembly at
 * whatever call site composes several providers (#101).
 */
export class TestFixturePostingProvider implements PostingProvider {
  constructor(
    public readonly providerId: string,
    private readonly result: PostingProviderFetchResult,
  ) {}

  async fetch(): Promise<PostingProviderFetchResult> {
    return this.result;
  }

  /** Structural guard, same shape as TestFixtureFamilyFloorStore's
   *  canUnlockProductionDiscoveryReward (familyFloors.ts) — a marker a future production-only check
   *  can call to refuse this fixture by construction, not by convention. Always false: this class has
   *  no fetchImpl, no apiKey, and no HTTP call anywhere in its body — it is LITERALLY incapable of
   *  reaching a live provider, not merely configured not to (§2.10). */
  canReachLiveProvider(): false {
    return false;
  }
}

/**
 * Enforces "at most one call every `minIntervalMs`" by making the caller WAIT for its turn, rather
 * than firing immediately and relying on a 429 to signal back off (AC: "rate limiting is respected by
 * construction, not by retrying into a 429 wall"). `now`/`sleep` are injectable so a test can prove
 * exact spacing without a real delay — a fake `sleep` just advances a fake clock instead of actually
 * waiting, so this is unit-testable with no live timers and no slow test. `minIntervalMs <= 0` means
 * "no pacing" (e.g. a provider whose policy.rateLimit.perSecond is null) and every wait() resolves
 * immediately.
 */
export class MinIntervalGate {
  private nextAllowedAt = 0;
  constructor(
    private readonly minIntervalMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async wait(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const current = this.now();
    const waitMs = this.nextAllowedAt - current;
    // The next slot is reserved BEFORE waiting, off the pre-wait clock reading — the standard
    // scheduling order. Reserving after the wait would let two overlapping callers both read a
    // "the gate is free" state during the SAME wait and both proceed together.
    this.nextAllowedAt = Math.max(this.nextAllowedAt, current) + this.minIntervalMs;
    if (waitMs > 0) await this.sleep(waitMs);
  }
}

/**
 * A fixed-window call budget — same idiom as `IpRateLimiter` (sessions.ts), but scoped to ONE shared
 * counter rather than per-key, since a provider client enforces a single internal budget for itself
 * (§2.9: "the server enforces one internal budget per providerId"), not one per caller. Unlike
 * MinIntervalGate (which WAITS a short interval), a budget that resets on the order of a minute or a
 * day must never be waited out on a request path — exceeding it FAILS CLOSED instead (§2.9: "exceeding
 * a provider's internal budget marks that provider unavailable for this round"). `limit === null`
 * means "no cap known for this window" and every check passes.
 */
export class FixedWindowBudget {
  private windowStart = 0;
  private count = 0;
  constructor(
    private readonly limit: number | null,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Reserves one unit for the current window. `release` rolls back a call that never became an HTTP
   *  attempt; if the window rolled over while awaiting another dependency, the old reservation has
   *  already expired and release is deliberately a no-op. */
  reserve(): { release: () => void } | null {
    if (this.limit === null) return { release: () => undefined };
    const current = this.now();
    if (current - this.windowStart >= this.windowMs) {
      this.windowStart = current;
      this.count = 0;
    }
    if (this.count >= this.limit) return null;
    const reservedWindowStart = this.windowStart;
    this.count += 1;
    let active = true;
    return {
      release: () => {
        if (!active) return;
        active = false;
        if (this.windowStart === reservedWindowStart && this.count > 0) this.count -= 1;
      },
    };
  }

  /** True (and consumes one unit) if this call is within budget for the current window. */
  allow(): boolean {
    return this.reserve() !== null;
  }
}

// #100 review MF4: process-wide, keyed by providerId — NOT per TechmapPostingProvider instance.
// techmapProviderFromEnv (below) mints a fresh instance per call, matching storageFromEnv/
// llmFromEnv's own stateless-factory convention, so pacing/budget state must live OUTSIDE any one
// instance — otherwise two concurrent retrievals (#101) would each get their own gate and burst
// straight through the vendor's per-second/per-minute cap TOGETHER, exactly the "retrying into a 429
// wall" the AC exists to prevent. Lazily built on first use per key, from whichever caller constructs
// the shared object first; every constructor call after that reuses it. `resetTechmapPacingForTest`
// exists purely so test cases don't leak pacing state (and injected fake clocks) into each other.
const gatesByProviderId = new Map<string, MinIntervalGate>();
const budgetsByKey = new Map<string, FixedWindowBudget>();

function sharedGate(
  providerId: string,
  minIntervalMs: number,
  now?: () => number,
  sleep?: (ms: number) => Promise<void>,
): MinIntervalGate {
  let gate = gatesByProviderId.get(providerId);
  if (!gate) {
    gate = new MinIntervalGate(minIntervalMs, now, sleep);
    gatesByProviderId.set(providerId, gate);
  }
  return gate;
}

function sharedBudget(key: string, limit: number | null, windowMs: number, now?: () => number): FixedWindowBudget {
  let budget = budgetsByKey.get(key);
  if (!budget) {
    budget = new FixedWindowBudget(limit, windowMs, now);
    budgetsByKey.set(key, budget);
  }
  return budget;
}

/** Test-only: clears every provider's shared gate/budget so one test's injected fake clock can't
 *  leak into the next — mirrors counters.ts's own resetCountersForTest. Never called by production
 *  code. */
export function resetTechmapPacingForTest(): void {
  gatesByProviderId.clear();
  budgetsByKey.clear();
}

// Exported (#100 review S1) so the staging smoke script builds its own raw-provenance request from
// the SAME constants the real client uses, rather than a re-typed copy that could silently drift
// from these — the lowercase path in particular is a documented landmine (§6: /api/v2/Jobs/Search
// returns "Endpoint does not exist").
export const TECHMAP_HOST = "daily-international-job-postings.p.rapidapi.com";
export const TECHMAP_PATH = "/api/v2/jobs/search";
// #133 item 4: NOT a default a caller can override — Techmap's own page size, measured live on
// staging 2026-08-04. Three calls against the same query (HK "project manager"): size=1, size=20,
// and size=50 ALL returned pageSize=10, 10 items, totalCount=58. `size` is not a floor — the vendor
// ignores it entirely and always returns exactly 10. Owner's framing: 10 is our unit of retrieval
// and of cost; anything wanting more pages more calls. Exported for the same reason
// TECHMAP_HOST/TECHMAP_PATH are — so a test or the smoke script cites this constant rather than a
// re-typed "10" that could silently drift from it.
export const TECHMAP_PAGE_SIZE = 10;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}
// Exported (#100 review D2) so the staging smoke script can independently derive "what jsonLD alone
// would produce" for a provenance check, without duplicating this extraction logic — the smoke calls
// the SAME functions the normalizer itself uses, on the raw jsonLD sub-object only (bypassing the
// normalizer's own top-level fallback), and compares the result to what normalizeTechmapItem actually
// returned. A mismatch (or a null here despite a non-empty field on the record) means the record's
// value came from a fallback, not the jsonLD path the smoke exists to verify.
export function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      const name = asRecord(entry)?.name;
      return typeof name === "string" ? name : null;
    })
    .filter((v): v is string => v !== null && v.length > 0);
}
// jsonLD.identifier is schema.org PropertyValue-shaped ({ "@type": "PropertyValue", value: "..." })
// on some feeds, a bare string on others — accept either. Exported — see asNonEmptyString's comment.
export function extractIdentifier(value: unknown): string | null {
  const direct = asNonEmptyString(value);
  if (direct) return direct;
  const v = asRecord(value)?.value;
  return typeof v === "string" && v.length > 0 ? v : null;
}
// jsonLD.hiringOrganization is a schema.org Organization ({ name: "..." }) or a bare string.
// Exported — see asNonEmptyString's comment.
export function extractOrganizationName(value: unknown): string | null {
  const direct = asNonEmptyString(value);
  if (direct) return direct;
  const name = asRecord(value)?.name;
  return typeof name === "string" && name.length > 0 ? name : null;
}
// #133 item 3: jsonLD.validThrough/datePosted arrive in TWO different date shapes, mixed within
// the SAME page (measured live on staging 2026-08-04, 10 postings, HK `project manager` query):
// ISO ("2026-09-02", 5/10 postings) and Techmap's own dash form ("16-09-2026", 2/10 postings).
// Storing either verbatim is the bug: dedupePostings' earliest/latest (postings.ts) compare
// expiresAt LEXICOGRAPHICALLY on the assumption every value is ISO 8601 — "16-09-2026" sorts
// before any "2026-…" string, so a DD-MM-YYYY expiry reads as having expired in the year "16" and
// is silently dropped (#86's named worst failure). Both regexes are structurally disjoint (ISO
// requires a 4-digit year first; the dash form requires a 2-digit group first), so there is no
// shape a genuine value could match both.
const TECHMAP_ISO_DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z)?$/;
// Techmap's dash form is treated as DD-MM-YYYY UNCONDITIONALLY — that is what was measured
// ("16-09-2026" is unambiguously day-first: 16 isn't a valid month). This is a fixed,
// provider-specific convention, not a per-value guess: "05-09-2026" is genuinely ambiguous in
// isolation (5 Sep or 9 May), but there is nothing to disambiguate once the provider's own format
// is pinned — every dash-form value from Techmap reads day-first, always. Do NOT add a heuristic
// that swaps the reading based on which number is >12; that reintroduces per-value guessing, which
// is exactly the trap this rule exists to close.
const TECHMAP_DASH_DATE_RE = /^(\d{2})-(\d{2})-(\d{4})$/;

// UTC day-0-of-next-month, not a bare `new Date(y, m, d)` read back — immune to local-timezone/DST
// rounding, and rejects impossible dates (month 13, day 32, Feb 30) rather than letting them
// silently roll over into a different, plausible-looking date the way `new Date()` coercion does.
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toCanonicalIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
): string | null {
  if (!isValidCalendarDate(year, month, day)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}.${pad(ms, 3)}Z`;
}

/**
 * Canonicalises a Techmap `validThrough`/`datePosted` value into ONE ISO 8601 form (always
 * `YYYY-MM-DDTHH:mm:ss.sssZ`, so every emitted value is uniformly comparable — including against
 * itself across the two accepted input shapes), or `null` if the value matches neither accepted
 * shape. A `null` here is the SAFE direction, not a shortcoming to "fix" later: downstream, a null
 * `expiresAt` reads as "no stated expiry" and the posting is never treated as expired — showing a
 * job slightly too long beats silently deleting a live one (#86). Never widen this to attempt a
 * best-effort guess on an unrecognized shape; that reintroduces the exact hazard this function
 * exists to remove. Exported — see asNonEmptyString's comment (test/smoke reuse of the same logic
 * the normalizer itself uses).
 */
export function canonicalizeTechmapDate(value: unknown): string | null {
  const raw = asNonEmptyString(value);
  if (!raw) return null;

  const iso = raw.match(TECHMAP_ISO_DATE_RE);
  if (iso) {
    const [, year, month, day, hour, minute, second, frac] = iso;
    return toCanonicalIso(
      Number(year),
      Number(month),
      Number(day),
      hour ? Number(hour) : 0,
      minute ? Number(minute) : 0,
      second ? Number(second) : 0,
      frac ? Number(frac.padEnd(3, "0")) : 0,
    );
  }

  const dash = raw.match(TECHMAP_DASH_DATE_RE);
  if (dash) {
    const [, day, month, year] = dash;
    return toCanonicalIso(Number(year), Number(month), Number(day), 0, 0, 0, 0);
  }

  return null;
}

// jsonLD.jobLocation is a schema.org Place ({ address: { addressLocality, addressRegion,
// addressCountry } }), sometimes an array of Places, or a bare string. Exported — see
// asNonEmptyString's comment.
export function extractLocation(value: unknown): string | null {
  const direct = asNonEmptyString(value);
  if (direct) return direct;
  const place = Array.isArray(value) ? value[0] : value;
  const address = asRecord(asRecord(place)?.address);
  if (!address) return null;
  const parts = [address.addressLocality, address.addressRegion, address.addressCountry].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Both the item array AND the envelope's own `totalCount` — discarding totalCount was #100 review
 *  MF1's finding: it's the one signal that can tell "the vendor genuinely had nothing" apart from "we
 *  got items back but every one of them failed to normalize" (a silent shape drift). */
function extractEnvelope(body: unknown): { items: unknown[]; totalCount: number | null } | null {
  const record = asRecord(body);
  if (!record) return null;
  const result = record.result;
  if (!Array.isArray(result)) return null;
  const totalCount = typeof record.totalCount === "number" ? record.totalCount : null;
  return { items: result, totalCount };
}

/**
 * One Techmap result item -> ProviderPostingRecordV1, or null if a required field is genuinely
 * missing (skipped, not fabricated — §2.1's fields are all real vendor data). §6: the advert body is
 * jsonLD.description, NOT any top-level field; the structured `skills` list is carried through
 * rather than flattened into excerpt or re-derived by a model. validThrough->expiresAt and
 * datePosted->postedAt are run through canonicalizeTechmapDate (#133 item 3) rather than stored
 * verbatim — see that function's own comment for why. `language` is detected HERE, at this ingest
 * entry point, from the excerpt — never taken from the provider (the ticket's language-gate
 * requirement) — but is NOT counted here (#100 review MF6): this function runs on EVERY fetch,
 * including a re-fetch of an already-known posting, so counting per-normalize would inflate
 * postings.language_skipped/undetermined with every refresh instead of once per genuinely new
 * posting. The count moves to postingStore.ts's upsert(), which is the one place that actually
 * knows "is this posting new to us".
 *
 * #133 item 1: `jsonLD.applicantLocationRequirements` is deliberately NEVER read. The live feed
 * populates it with a bare timezone string ("HKT Timezone"), not work-eligibility data and not an
 * array — mapping it into any eligibility-bearing field would be exactly the "a permissive union
 * must never silently become a gating input" hazard postingRetrieval.ts already warns against for
 * this field. Its only intended consumer (the AC5 provider-signal seam) was already deleted in
 * review 2026-08-03 for an independent, still-valid reason (eligibilityDiscovery.ts's own comment
 * on that deletion). Owner decision: removed from the contract entirely, not kept as an empty
 * placeholder — a misnamed empty field reads as "we have eligibility data" to the next person.
 */
export function normalizeTechmapItem(
  item: unknown,
  fetchedAt: string,
  policy: PostingProviderPolicyV1Value,
): ProviderPostingRecordV1Value | null {
  const raw = asRecord(item);
  if (!raw) return null;
  const jsonLD = asRecord(raw.jsonLD) ?? {};

  const title = asNonEmptyString(raw.title) ?? asNonEmptyString(jsonLD.title);
  const providerPostingId = extractIdentifier(jsonLD.identifier) ?? asNonEmptyString(raw.id);
  const excerpt = asNonEmptyString(jsonLD.description);
  const sourceUrl = asNonEmptyString(jsonLD.url) ?? asNonEmptyString(raw.url);
  const company = extractOrganizationName(jsonLD.hiringOrganization) ?? asNonEmptyString(raw.company);
  const location = extractLocation(jsonLD.jobLocation) ?? asNonEmptyString(raw.location);
  if (!title || !providerPostingId || !excerpt || !sourceUrl || !company || !location) return null;

  const language = detectLanguage(excerpt);

  return ProviderPostingRecordV1.parse({
    schemaVersion: "4", // #302 bumped 3->4: nullable verifiedLiveAt + applicationUrl
    providerId: "techmap",
    providerPostingId,
    title,
    company,
    location,
    sourceUrl,
    // #302: null, deliberately. A JobPosting's jsonLD carries the LISTING's url (already captured
    // as sourceUrl above) and no separate apply link, so there is nothing honest to put here —
    // lending sourceUrl to a field that means "where to apply" would be a falsehood in the data.
    // A consumer that needs somewhere to send a person falls back to sourceUrl itself.
    applicationUrl: null,
    excerpt,
    postedAt: canonicalizeTechmapDate(jsonLD.datePosted),
    capturedAt: fetchedAt,
    verifiedLiveAt: fetchedAt,
    expiresAt: canonicalizeTechmapDate(jsonLD.validThrough),
    // Techmap's registry row has attributionRequired: false and attributionTemplate: null today —
    // pulled from the policy rather than hand-set here, so a future policy change (an
    // attributionTemplate added) is honored automatically with no code change at this call site.
    attribution: policy.attributionTemplate,
    skills: asStringArray(jsonLD.skills),
    language,
  });
}

export interface TechmapPostingProviderOptions {
  apiKey: string;
  policy: PostingProviderPolicyV1Value;
  /** Injectable for tests — no live network call may run in `pnpm test` (AC). */
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  monthlyBudgetStore?: Pick<PostingStore, "durable" | "reserveMonthlyCall">;
}

/**
 * The real Techmap (jobdatafeeds.com Jobs API v2.6, via RapidAPI) client. Rate limit, retry count/
 * backoff, and timeout all come from `policy` (§2.2's registry), never from constants here (AC).
 * The short-window limits are enforced in-process, all sourced from `policy.rateLimit`, and shared PROCESS-WIDE
 * per providerId (#100 review MF4 — not per instance, since `techmapProviderFromEnv` mints a fresh
 * instance per call):
 *   - perSecond: paced by MinIntervalGate — every attempt, including retries, WAITS its turn. A
 *     sub-second wait is cheap enough to hold a request open for.
 *   - perMinute / perDay: enforced by FixedWindowBudget — exceeding either FAILS CLOSED immediately
 *     (provider_unavailable-shaped, retryable) rather than waiting, because waiting out a minute or a
 *     day on a request path is never acceptable (#100 review MF2).
 *   - perMonth: reserved atomically in PostingStore under `(providerId, UTC yearMonth)`, so deploys
 *     and concurrent API processes cannot reset or race past the paid-provider ceiling.
 * The API key is read once at construction and never logged: HTTP errors below are turned into
 * `reason` strings built from the response status/body only, never from the request `init` (which is
 * the one place the key ever appears, in the `x-rapidapi-key` header).
 */
export class TechmapPostingProvider implements PostingProvider {
  // #174 must-fix 1 (round 2): the single declared source of "this driver implements techmap" — read
  // by postingRetrieval.ts's IMPLEMENTED_PROVIDER_IDS to build the boot-time "does an implementation
  // exist" check WITHOUT constructing an instance (constructing one needs a live API key, which must
  // stay a runtime/config concern, never a build-time one).
  static readonly providerId = "techmap";
  readonly providerId = TechmapPostingProvider.providerId;
  private readonly gate: MinIntervalGate;
  private readonly perMinuteBudget: FixedWindowBudget;
  private readonly perDayBudget: FixedWindowBudget;

  constructor(private readonly opts: TechmapPostingProviderOptions) {
    const { rateLimit } = opts.policy;
    const minIntervalMs = rateLimit.perSecond && rateLimit.perSecond > 0 ? 1000 / rateLimit.perSecond : 0;
    this.gate = sharedGate(this.providerId, minIntervalMs, opts.now, opts.sleep);
    this.perMinuteBudget = sharedBudget(`${this.providerId}:perMinute`, rateLimit.perMinute, 60_000, opts.now);
    this.perDayBudget = sharedBudget(`${this.providerId}:perDay`, rateLimit.perDay, 24 * 60 * 60_000, opts.now);
  }

  async fetch(input: PostingProviderFetchInput): Promise<PostingProviderFetchResult> {
    const { policy } = this.opts;
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let lastReason = "techmap: no attempt completed";
    let lastRetryable = true;
    for (let attempt = 1; attempt <= policy.retry.maxAttempts; attempt++) {
      if (attempt > 1 && policy.retry.backoffMs > 0) await sleep(policy.retry.backoffMs);
      await this.gate.wait(); // paced on EVERY attempt, including retries — a retry never bursts
      const minuteReservation = this.perMinuteBudget.reserve();
      const dayReservation = this.perDayBudget.reserve();
      if (!minuteReservation || !dayReservation) {
        minuteReservation?.release();
        dayReservation?.release();
        // §2.9: exceeding our own internal budget marks the provider unavailable for THIS round —
        // never waited out, and never counted as a "call made" (no HTTP request happened).
        incrementCounter("postings.techmap_budget_exceeded");
        return {
          ok: false,
          reason: "techmap: internal per-minute/per-day call budget exceeded for this window",
          retryable: true,
        };
      }
      const perMonth = policy.rateLimit.perMonth;
      if (perMonth !== null) {
        const current = new Date((this.opts.now ?? Date.now)());
        const yearMonth = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}`;
        const unavailable = () => {
          minuteReservation.release();
          dayReservation.release();
          incrementCounter("postings.techmap_budget_store_unavailable");
          console.error("[ops] techmap monthly call budget store unavailable; request blocked");
          return { ok: false, reason: "techmap: monthly call budget store unavailable", retryable: true } as const;
        };
        if (this.opts.monthlyBudgetStore?.durable !== true) return unavailable();
        try {
          const allowed = await this.opts.monthlyBudgetStore.reserveMonthlyCall(
            this.providerId,
            yearMonth,
            perMonth,
          );
          if (!allowed) {
            minuteReservation.release();
            dayReservation.release();
            incrementCounter("postings.techmap_budget_exceeded");
            return {
              ok: false,
              reason: `techmap: internal per-month call budget exceeded for ${yearMonth}`,
              retryable: true,
            };
          }
        } catch {
          return unavailable();
        }
      }
      incrementCounter("postings.techmap_calls_made");
      let outcome: PostingProviderFetchResult;
      try {
        outcome = await this.attemptFetch(input);
      } catch (err) {
        // A thrown fetch (network error, or AbortSignal.timeout firing) — transient by nature,
        // retryable, and built from the error's own message only, never the request init.
        outcome = {
          ok: false,
          reason: `techmap request failed: ${err instanceof Error ? err.message : String(err)}`,
          retryable: true,
        };
      }
      if (outcome.ok) return outcome;
      incrementCounter("postings.techmap_calls_failed");
      lastReason = outcome.reason;
      lastRetryable = outcome.retryable;
      if (!outcome.retryable) break; // a non-transient failure won't be fixed by retrying
    }
    return { ok: false, reason: lastReason, retryable: lastRetryable };
  }

  private async attemptFetch(input: PostingProviderFetchInput): Promise<PostingProviderFetchResult> {
    const { policy, apiKey } = this.opts;
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const url = new URL(`https://${TECHMAP_HOST}${TECHMAP_PATH}`);
    url.searchParams.set("countryCode", input.regionCode.toLowerCase());
    url.searchParams.set("page", String(input.page ?? 0));
    url.searchParams.set("size", String(TECHMAP_PAGE_SIZE)); // #133 item 4: fixed, never caller-chosen
    // #240: each title is sent QUOTED, so the vendor matches the PHRASE, and several quoted phrases
    // in one `title` value OR together — so a family's whole market word list still costs exactly
    // one call (both behaviours measured live; techmapProvider.test.ts carries the numbers). No
    // vendor escape syntax is documented for an embedded double quote, and it would end the phrase
    // early, so it is DELETED — "sen\"ior pm" asks for "senior pm", not the unmatchable "sen ior pm".
    if (input.queryKeywords.length > 0) {
      url.searchParams.set("title", input.queryKeywords.map((title) => `"${title.replace(/"/g, "")}"`).join(" "));
    }

    const res = await fetchImpl(url.toString(), {
      headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": TECHMAP_HOST },
      signal: AbortSignal.timeout(policy.timeoutMs),
    });

    if (res.status === 429) return { ok: false, reason: "techmap rate limit exceeded (429)", retryable: true };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: `techmap request rejected (${res.status})`, retryable: false };
    }
    if (res.status >= 500) return { ok: false, reason: `techmap server error (${res.status})`, retryable: true };
    if (!res.ok) return { ok: false, reason: `techmap request rejected (${res.status})`, retryable: false };

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, reason: "techmap response was not valid JSON", retryable: false };
    }
    const envelope = extractEnvelope(body);
    if (envelope === null) return { ok: false, reason: "techmap response envelope shape unrecognized", retryable: false };
    const { items, totalCount } = envelope;

    const fetchedAt = new Date().toISOString();
    const records: ProviderPostingRecordV1Value[] = [];
    let dropped = 0;
    for (const item of items) {
      try {
        const record = normalizeTechmapItem(item, fetchedAt, policy);
        if (record) records.push(record);
        else dropped++;
      } catch {
        // One malformed item (a shape the contract's own zod .parse() above rejects) is skipped, not
        // fatal to the whole page — a single odd advert from a LIVE third-party feed is expected
        // background noise, unlike a malformed row in our own hand-curated registry file (postings.ts's
        // parseProviderPolicies, which throws on purpose because that IS an operator error).
        dropped++;
      }
    }
    if (dropped > 0) addToCounter("postings.techmap_normalize_dropped", dropped);

    // #100 review MF1 (QA D1 fix): a 200 where every item on THIS PAGE failed to normalize is NOT a
    // genuine empty result. This gates on the page-local `items.length`, never on `totalCount` — an
    // earlier version gated on totalCount and was wrong in both directions: totalCount is the WHOLE
    // QUERY's total, not this page's, so it false-failed a genuinely empty PAGE of a non-empty query
    // (e.g. page 1 of a 15-result, size-20 search: totalCount=15, result=[]), and it left the real
    // hole open whenever totalCount was absent, 0, or a non-numeric string — exactly the shape-drift
    // case this guard exists to catch. items.length > 0 with zero records normalized means the vendor
    // reshaped a field this client depends on (jsonLD.description, jobLocation, ...); surfaced as
    // provider_unavailable (not retryable — a shape drift isn't fixed by trying again), never a false
    // empty_pool. totalCount is kept in the reason string for logging only, never in the condition.
    if (items.length > 0 && records.length === 0) {
      return {
        ok: false,
        reason: `techmap: normalized 0 of ${items.length} items on this page (totalCount=${totalCount ?? "unknown"}) — likely a response shape change`,
        retryable: false,
      };
    }

    // §2.9: every provider call increments an observable counter keyed by providerId, converting
    // calls into a real measured spend via the registry's own costModel — replacing #86's estimates.
    addToCounter("postings.techmap_records_fetched", records.length);
    addToCounter("postings.techmap_cost_usd_total", computeProviderCostUsd(policy.costModel, records.length));

    return { ok: true, records };
  }
}

/** Real driver when TECHMAP_RAPIDAPI_KEY is set, otherwise null — #101 decides what "no live
 *  provider wired" means for coverage (the same shape choice storageFromEnv/llmFromEnv leave to
 *  their own callers). The key is read once here and never logged.
 *
 *  #100 review MF5: fails closed on any row that isn't actually Techmap's own — handed the
 *  curated-pool row (or a future provider's row) by mistake, this driver would otherwise fire
 *  UNPACED (that row's rateLimit.perSecond is null) straight into Techmap's real 429 wall, with
 *  retry/cost accounting from the WRONG policy (e.g. curated-pool's operatorHours cost model, which
 *  would record $0 forever for real HTTP calls). */
export function techmapProviderFromEnv(
  policy: PostingProviderPolicyV1Value,
  monthlyBudgetStore: Pick<PostingStore, "durable" | "reserveMonthlyCall">,
): PostingProvider | null {
  if (policy.providerId !== TechmapPostingProvider.providerId) return null;
  const apiKey = process.env.TECHMAP_RAPIDAPI_KEY;
  if (apiKey && !monthlyBudgetStore.durable) {
    console.error("[ops] TECHMAP_RAPIDAPI_KEY is set without a durable monthly budget store; provider disabled");
    return null;
  }
  return apiKey ? new TechmapPostingProvider({ apiKey, policy, monthlyBudgetStore }) : null;
}
