// #99: the live-posting retrieval contract's provider-neutral pieces — the registry loader (§2.2)
// and dedupePostings (§2.4), the two pure functions the contract calls out as unit-testable without a
// network call or a store. Shapes live in packages/contracts/src/postingRetrieval.ts, golden-tested
// against packages/contracts/oracle/validate_posting_retrieval_v1.mjs. No routes, no network, no
// store here — wiring this into /onboarding/cards is #100/#101, not this ticket.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalKeyOf,
  PostingProviderPolicyV1,
  type PostingProviderCostModel,
  type PostingProviderPolicyV1 as PostingProviderPolicyV1Value,
  type PostingV1 as PostingV1Value,
  type ProviderPostingRecordV1 as ProviderPostingRecordV1Value,
} from "@jobcrush/contracts";

const here = dirname(fileURLToPath(import.meta.url));

// canonicalKeyOf (§2.4) is imported from the contracts package rather than reimplemented here — TS
// has exactly one implementation of the derivation; the .mjs oracle reimplements it independently on
// purpose (that's what makes it an oracle). Deliberately naive — see the contract doc's §2.4 "how
// confident this is" note: it only catches exact-and-near-exact duplicates, and that's the point
// (never a false positive).

// ---- the provider registry — policy as data, not code (§2.2) ----

/**
 * Parses a raw registry array defensively strictly — the opposite policy from e5stub.ts's
 * per-item ad-requirements skip. There, a broken hand-authored fixture is a data-quality blip that
 * drops one advert and keeps going. Here, a malformed provider policy is an operator error in a
 * file that gates real money and legal exposure (§2.2's fail-closed enforcement point), so one bad
 * row throws the whole load rather than being silently skipped. Exported standalone (mirroring
 * e5stub.ts's parseAdRequirementsList split) so this exact gate is testable without touching the
 * real on-disk registry the loader below reads.
 */
export function parseProviderPolicies(raw: unknown[]): PostingProviderPolicyV1Value[] {
  return raw.map((row) => PostingProviderPolicyV1.parse(row));
}

let cachedProviderPolicies: PostingProviderPolicyV1Value[] | null = null;
// #174 must-fix 2: exported so a test can assert against the RAW on-disk registry (every row, active
// or not) rather than only the active list — loadActivePostingProviders alone can't tell "never had a
// row" from "had a row that never activated", and the two need different tests: a re-added candidate
// row (which docs/research/live-posting-retrieval-contract.md §1 explicitly invites) must show up
// here even while correctly staying out of loadActivePostingProviders.
export function loadProviderPolicies(): PostingProviderPolicyV1Value[] {
  if (!cachedProviderPolicies) {
    const raw = JSON.parse(
      readFileSync(join(here, "..", "data", "posting-providers.json"), "utf8"),
    ) as unknown[];
    cachedProviderPolicies = parseProviderPolicies(raw);
  }
  return cachedProviderPolicies;
}

// #174: providerIds excluded from the active registry despite passing the §2.2 permission gate below
// — because the code path that would let them serve real traffic doesn't exist YET, not because the
// row's own contractual terms changed. curated-pool's own driver
// (postingRetrieval.ts's StoreBackedCuratedPostingProvider) genuinely exists and its permitsStorage/
// permitsMatching are honestly true (it's our own operator-curated data, no third-party ToS to
// violate) — so it is deliberately NOT deactivated by editing those fields, which would misstate a
// fact that hasn't changed. What's actually missing is a durable operator region refresh: `fetch()`
// requires one (postingStore.ts's markRegionRefreshed), and nothing in production ever calls it, so
// every live call fails "curated region has no fresh operator refresh" — which coverage then reports
// as an unavailable provider on every region, permanently blocking coverage.complete (the bug #174
// closes). Remove an id here only once its production refresh path actually exists.
const OPERATIONALLY_DISABLED_PROVIDER_IDS: ReadonlySet<string> = new Set(["curated-pool"]);

/**
 * Pure filter — parseProviderPolicies's own sibling — over an already-parsed policy array: every row
 * this build's active registry may query BY PERMISSION (§2.2's booleans, plus the operational-disable
 * list above). This does NOT verify a driver IMPLEMENTATION exists for what it returns — an earlier
 * version of this function threw on a provider id absent from a hand-typed KNOWN_DRIVER_PROVIDER_IDS
 * mirror declared in this file, which could drift from what driver code actually exists (a mirror
 * entry added with no matching driver class would pass silently, reproducing #174's own bug through
 * the mechanism meant to prevent it). That check now lives where it can see the truth:
 * postingRetrieval.ts's assertEveryActiveProviderIsImplemented, called once at boot in main.ts and
 * built from each driver class's own declared `providerId`, never a mirror. It deliberately checks
 * implementation-exists, not instance-constructed: a provider whose driver exists but declines for a
 * config reason (e.g. techmap with no API key) still boots fine and degrades honestly per request —
 * see that function's own doc. Exported standalone so the operational-disable behaviour here is
 * testable without touching the real on-disk registry, the same reason parseProviderPolicies is
 * exported rather than inlined.
 */
export function selectActivePostingProviders(
  policies: PostingProviderPolicyV1Value[],
): PostingProviderPolicyV1Value[] {
  return policies.filter(
    (policy) =>
      policy.permitsStorage &&
      policy.permitsMatching &&
      !policy.attributionRequired &&
      !OPERATIONALLY_DISABLED_PROVIDER_IDS.has(policy.providerId),
  );
}

/**
 * The active registry: rows the live system may query BY PERMISSION. Fail closed (§2.2) — a row is
 * active only when `permitsStorage && permitsMatching && !attributionRequired`, and it isn't listed in
 * OPERATIONALLY_DISABLED_PROVIDER_IDS above. This does NOT by itself guarantee an IMPLEMENTATION exists
 * for every row it returns — see selectActivePostingProviders's own doc for where that invariant
 * actually lives (postingRetrieval.ts's assertEveryActiveProviderIsImplemented, checked at boot in
 * main.ts against each driver class's own declared identity, not this file's data — and deliberately
 * NOT against whether a live instance got constructed, so a provider whose driver exists but declines
 * for a config reason, e.g. techmap with no API key, still boots fine). The `attributionRequired`
 * clause is #99's own
 * known gap, made explicit here: `JobCardV1` (packages/contracts/src/jobCard.ts) has no attribution
 * field, so a provider requiring attribution cannot be rendered lawfully today — it therefore must not
 * activate, even if its storage/matching terms are otherwise clean. A provider whose terms are
 * unconfirmed or restrictive (e.g. TheirStack — dropped from this registry entirely pending a driver
 * and an owner spend decision, per docs/research/live-posting-retrieval-contract.md §1) can exist as a
 * documented candidate row the owner can review, but never enters the active list without someone
 * explicitly flipping its booleans in this file.
 */
export function loadActivePostingProviders(): PostingProviderPolicyV1Value[] {
  return selectActivePostingProviders(loadProviderPolicies());
}

// ---- dedupePostings (§2.4) ----

// Exported (#100) so postingStore.ts's upsert can apply the SAME §2.6 date semantics
// (capturedAt = earliest seen, verifiedLiveAt = most recently confirmed) when a single provider's
// re-fetch of an already-stored posting is merged — one implementation of "earliest wins"/"latest
// wins", not a second copy that could drift from this one.
export function earliest(a: string, b: string): string {
  // ISO 8601 UTC timestamps sort lexicographically the same as chronologically.
  return a <= b ? a : b;
}
// #302: no longer exported — latestNonNull below is what postingStore.ts's §2.6 merge needs now
// that a record may carry no liveness confirmation at all, and it is built on this one comparison.
function latest(a: string, b: string): string {
  return a >= b ? a : b;
}
function earliestNonNull(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return earliest(a, b);
}
/** #302: the verifiedLiveAt merge, now that a record may never have been confirmed live at all.
 *  Exported for postingStore.ts's own §2.6 merge, the same reason `earliest` is — one implementation
 *  of "latest wins", never a second copy that could drift. One real confirmation outranks any
 *  number of absences: null out only when NOTHING contributing was ever confirmed. */
export function latestNonNull(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return latest(a, b);
}

function attributionKey(attribution: { label: string; url: string }): string {
  return `${attribution.label}|${attribution.url}`;
}

/**
 * Merges provider-record duplicates (§2.4) into canonical, provider-independent postings. Pure in
 * the sense the contract means it: no network call, no store/cache write, no side effects — the
 * function only reads and returns values. The one caveat is the defaulted `registry` parameter,
 * which reads the on-disk provider file (via `loadActivePostingProviders`) the first time it's
 * needed; pass `registry` explicitly (as every test here does) to keep a call fully in-memory.
 *
 * Never produces a false positive: two records merge ONLY on an exact normalized
 * company|location|title match. A providerId absent from `registry` gets an effective authorityRank
 * of +Infinity — it loses every conflict and never throws.
 */
export function dedupePostings(
  records: ProviderPostingRecordV1Value[],
  registry: PostingProviderPolicyV1Value[] = loadActivePostingProviders(),
): PostingV1Value[] {
  const rankOf = new Map(registry.map((policy) => [policy.providerId, policy.authorityRank]));
  const effectiveRank = (providerId: string) => rankOf.get(providerId) ?? Infinity;

  // Group by canonical key, remembering first-appearance order so output order is deterministic.
  const order: string[] = [];
  const groups = new Map<string, ProviderPostingRecordV1Value[]>();
  for (const record of records) {
    const key = canonicalKeyOf(record.company, record.location, record.title);
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
      order.push(key);
    }
    group.push(record);
  }

  return order.map((canonicalKey) => {
    const contributing = groups.get(canonicalKey)!;

    // Winner = lowest effective authorityRank. Ties break deterministically: providerId asc, then
    // providerPostingId asc — a nondeterministic winner on a tie is a bug, not an acceptable variance.
    // Ranks are compared directly (never subtracted) — two unregistered providers both carry
    // +Infinity, and Infinity - Infinity is NaN, which would silently fall through every comparator
    // branch below and leave the sort order (and the winner) an accident of input order.
    const byAuthority = [...contributing].sort((a, b) => {
      const rankA = effectiveRank(a.providerId);
      const rankB = effectiveRank(b.providerId);
      if (rankA !== rankB) return rankA < rankB ? -1 : 1;
      if (a.providerId !== b.providerId) return a.providerId < b.providerId ? -1 : 1;
      if (a.providerPostingId !== b.providerPostingId) {
        return a.providerPostingId < b.providerPostingId ? -1 : 1;
      }
      return 0;
    });
    const winner = byAuthority[0]!;

    const sources = contributing.map((record) => ({
      providerId: record.providerId,
      providerPostingId: record.providerPostingId,
    }));

    // attribution = union of the non-null ones, de-duplicated on label+url.
    const attributionByKey = new Map<string, { label: string; url: string }>();
    for (const record of contributing) {
      if (record.attribution) attributionByKey.set(attributionKey(record.attribution), record.attribution);
    }

    const posting: PostingV1Value = {
      schemaVersion: "5", // #133 bumped 3->4; #302 bumped 4->5 (nullable verifiedLiveAt + applicationUrl)
      id: `posting:${canonicalKey}`,
      canonicalKey,
      title: winner.title,
      company: winner.company,
      location: winner.location,
      sourceUrl: winner.sourceUrl,
      // #302: the winner's link when it has one, otherwise the highest-authority contributor that
      // does. NOT plain winner-take-all, and not a union either: two sources disagreeing about
      // where to apply is still not two places to apply, but a winner with NO link must not
      // discard the only answer anyone had. That case is real and load-bearing — a pasted advert
      // (authorityRank 2, carrying the link the person typed) dedupes onto a techmap record
      // (authorityRank 1, whose applicationUrl is always null), and plain winner-take-all would
      // throw his link away. `expiresAt` below already refuses to let a null win, for the same
      // reason.
      applicationUrl: byAuthority.find((r) => r.applicationUrl !== null)?.applicationUrl ?? null,
      excerpt: winner.excerpt,
      postedAt: winner.postedAt,
      capturedAt: contributing.reduce((acc, r) => earliest(acc, r.capturedAt), winner.capturedAt),
      verifiedLiveAt: contributing.reduce<string | null>(
        (acc, r) => latestNonNull(acc, r.verifiedLiveAt),
        winner.verifiedLiveAt,
      ),
      expiresAt: contributing.reduce<string | null>(
        (acc, r) => earliestNonNull(acc, r.expiresAt),
        null,
      ),
      attribution: [...attributionByKey.values()],
      sources,
      // #133: applicantLocationRequirements REMOVED (not carried, not unioned) — the live Techmap
      // feed populated it with a bare timezone string, not eligibility data, and its only intended
      // consumer was already deleted (eligibilityDiscovery.ts's #106 must-fix 7 comment). Resolved
      // by the SAME authorityRank-winner rule as title/company/location — see postingRetrieval.ts's
      // own comment on why skills doesn't union either.
      skills: winner.skills,
      // #100: same winner-take-all rule, same reason — language is itself a gating input
      // (language.ts's languageEligible), never a union of what each provider separately detected.
      language: winner.language,
    };
    return posting;
  });
}

// ---- provider call cost accounting (#100, §2.9) ----

/**
 * The real, measured spend for ONE provider call that returned `recordCount` records, using that
 * provider's own §2.2 costModel — replacing #86's estimates with a number computed from what a call
 * actually returned, not a guess. Pure and unit-testable in isolation: no network, no counters, no
 * store. `operatorHours` has no dollar cost by construction (the curated pool has no vendor) and
 * always returns 0 — its real cost is operator time, tracked in hours elsewhere, never dollars.
 * `flatMonthlyTier` returns 0 too: a flat-tier subscription's marginal per-call cost isn't a function
 * of THIS call alone (it's already paid for up to `includedUnits`), so attributing a fraction of the
 * flat fee to one call would be an estimate dressed up as a measurement — exactly what this function
 * exists to avoid. Only `perThousandPostings` has a real, well-defined per-call cost.
 */
export function computeProviderCostUsd(costModel: PostingProviderCostModel, recordCount: number): number {
  if (costModel.kind === "perThousandPostings") return (recordCount / 1000) * costModel.amountUsd;
  return 0;
}
