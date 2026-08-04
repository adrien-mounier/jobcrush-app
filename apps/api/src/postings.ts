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
function loadProviderPolicies(): PostingProviderPolicyV1Value[] {
  if (!cachedProviderPolicies) {
    const raw = JSON.parse(
      readFileSync(join(here, "..", "data", "posting-providers.json"), "utf8"),
    ) as unknown[];
    cachedProviderPolicies = parseProviderPolicies(raw);
  }
  return cachedProviderPolicies;
}

/**
 * The active registry: rows the live system may actually query. Fail closed (§2.2) — a row is
 * active only when `permitsStorage && permitsMatching && !attributionRequired`. The
 * `attributionRequired` clause is #99's own known gap, made explicit here: `JobCardV1`
 * (packages/contracts/src/jobCard.ts) has no attribution field, so a provider requiring attribution
 * cannot be rendered lawfully today — it therefore must not activate, even if its storage/matching
 * terms are otherwise clean. A provider whose terms are unconfirmed or restrictive (e.g. TheirStack,
 * per docs/research/live-posting-retrieval-contract.md §1) can exist as a documented candidate row
 * the owner can review, but never enters the active list without someone explicitly flipping its
 * booleans in this file.
 */
export function loadActivePostingProviders(): PostingProviderPolicyV1Value[] {
  return loadProviderPolicies().filter(
    (policy) => policy.permitsStorage && policy.permitsMatching && !policy.attributionRequired,
  );
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
export function latest(a: string, b: string): string {
  return a >= b ? a : b;
}
function earliestNonNull(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return earliest(a, b);
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
    const winner = [...contributing].sort((a, b) => {
      const rankA = effectiveRank(a.providerId);
      const rankB = effectiveRank(b.providerId);
      if (rankA !== rankB) return rankA < rankB ? -1 : 1;
      if (a.providerId !== b.providerId) return a.providerId < b.providerId ? -1 : 1;
      if (a.providerPostingId !== b.providerPostingId) {
        return a.providerPostingId < b.providerPostingId ? -1 : 1;
      }
      return 0;
    })[0]!;

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
      schemaVersion: "3", // #100 bumped 2->3: added `language`
      id: `posting:${canonicalKey}`,
      canonicalKey,
      title: winner.title,
      company: winner.company,
      location: winner.location,
      sourceUrl: winner.sourceUrl,
      excerpt: winner.excerpt,
      postedAt: winner.postedAt,
      capturedAt: contributing.reduce((acc, r) => earliest(acc, r.capturedAt), winner.capturedAt),
      verifiedLiveAt: contributing.reduce((acc, r) => latest(acc, r.verifiedLiveAt), winner.verifiedLiveAt),
      expiresAt: contributing.reduce<string | null>(
        (acc, r) => earliestNonNull(acc, r.expiresAt),
        null,
      ),
      attribution: [...attributionByKey.values()],
      sources,
      // Resolved by the SAME authorityRank-winner rule as title/company/location — NOT a union.
      // See postingRetrieval.ts's own comment: a permissive union of eligibility locations must
      // never silently become a gating input.
      applicantLocationRequirements: winner.applicantLocationRequirements,
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
