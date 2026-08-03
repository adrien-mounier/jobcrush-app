// Live-posting retrieval contract (#99, §2 of docs/research/live-posting-retrieval-contract.md).
// Four shapes: a provider's raw view of a job (ProviderPostingRecordV1), the deduplicated
// provider-independent posting #63 actually consumes (PostingV1), the provider registry as data
// (PostingProviderPolicyV1), and the retrieval outcome union (PostingRetrievalResultV1). Each has a
// matching .mjs oracle at packages/contracts/oracle/validate_posting_retrieval_v1.mjs — golden-tested
// against this port in packages/contracts/test/golden.test.ts. The oracle is the spec; if they ever
// disagree, this port is wrong.
import { createHash } from "node:crypto";
import { z } from "zod";

// normalize/canonicalKey (§2.4): lowercase, trim, collapse internal whitespace, strip a small fixed
// set of punctuation, then sha256 the pipe-joined triple. Exported so apps/api/src/postings.ts has
// exactly one implementation of the derivation — the oracle re-implements this independently on
// purpose (that's what makes it an oracle, not a copy of this file).
// `|` is stripped here too — it's the triple's own field delimiter, so if it survived inside a
// field's content it could forge a fake boundary (e.g. company "HSBC|Hong Kong" + location
// "Singapore" would otherwise key-collide with company "HSBC" + location "Hong Kong|Singapore"),
// silently merging two genuinely different jobs. Stripping it here means no normalized field can
// ever contain the delimiter, so no field content can forge one.
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[,.()|]/g, "")
    .replace(/\s+/g, " ");
}

export function canonicalKeyOf(company: string, location: string, title: string): string {
  const input = `${normalize(company)}|${normalize(location)}|${normalize(title)}`;
  return createHash("sha256").update(input).digest("hex");
}

// A single provider's or the canonical posting's attribution requirement — reused across all three
// call sites below (never redeclared as an equal-but-separate shape).
const Attribution = z
  .object({
    label: z.string().min(1),
    url: z.string().min(1),
  })
  .strict();

export const ProviderPostingRecordV1 = z
  .object({
    schemaVersion: z.literal("1"),
    providerId: z.string().min(1), // "techmap" | "curated-pool" | ... — keyed to the §2.2 registry
    providerPostingId: z.string().min(1), // opaque, exactly as given by that provider
    title: z.string().min(1),
    company: z.string().min(1),
    location: z.string().min(1),
    sourceUrl: z.string().min(1), // resolves to the original listing (parent spec story #52)
    excerpt: z.string(),
    postedAt: z.string().min(1).nullable(), // provider-claimed post date, ISO 8601
    capturedAt: z.string().min(1), // when JobCrush first retrieved this record, ISO 8601
    verifiedLiveAt: z.string().min(1), // last time liveness was positively re-confirmed, ISO 8601
    // provider-stated expiry, if any. §6: this is where jsonLD's `validThrough` lands — no separate
    // `validThrough` field is added, this IS it, renamed to the domain-neutral term.
    expiresAt: z.string().min(1).nullable(),
    attribution: Attribution.nullable(), // THIS provider's own attribution requirement, if any
    // §6: carried structured, never flattened into `excerpt` — a work-eligibility signal and a
    // structured skills list the provider already gives us for free.
    applicantLocationRequirements: z.array(z.string()),
    skills: z.array(z.string()),
  })
  .strict();

export type ProviderPostingRecordV1 = z.infer<typeof ProviderPostingRecordV1>;

export const PostingV1 = z
  .object({
    schemaVersion: z.literal("2"), // canonical, provider-independent, what #63 consumes
    id: z.string().min(1), // "posting:<canonicalKey>" — enforced below, not just typed as a string
    canonicalKey: z.string().min(1), // the dedup key itself (§2.4), kept for audit/debugging
    title: z.string().min(1), // from the highest-authorityRank contributing record (§2.4)
    company: z.string().min(1),
    location: z.string().min(1),
    sourceUrl: z.string().min(1), // the winning record's URL
    excerpt: z.string(),
    postedAt: z.string().min(1).nullable(),
    capturedAt: z.string().min(1), // earliest capturedAt across contributing records
    verifiedLiveAt: z.string().min(1), // most recent verifiedLiveAt across contributing records
    expiresAt: z.string().min(1).nullable(), // earliest non-null expiresAt (most conservative)
    attribution: z.array(Attribution), // UNION of every contributing provider's requirement
    // every provider record currently merged into this posting
    sources: z
      .array(
        z
          .object({
            providerId: z.string().min(1),
            providerPostingId: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    // Resolved by the SAME authorityRank-winner rule as title/company/location/sourceUrl — NOT a
    // union. A permissive union of eligibility locations must never silently become a gating input
    // (carry-forward of #106's comment): a wider "any provider's claimed applicant location" set
    // would let a posting look eligible in a region no single provider actually vouches for.
    applicantLocationRequirements: z.array(z.string()),
    skills: z.array(z.string()),
  })
  .strict()
  .superRefine((posting, ctx) => {
    if (posting.id !== `posting:${posting.canonicalKey}`) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: 'id must equal "posting:" + canonicalKey',
      });
    }
    // canonicalKey isn't just typed as a string either — it must actually BE the derived hash, not
    // any non-empty string with a matching id. Sound because every contributing record's
    // company/location/title normalizes to the same triple (that's what made them merge), so the
    // winner's own fields are the right input to recompute it from.
    const expectedKey = canonicalKeyOf(posting.company, posting.location, posting.title);
    if (posting.canonicalKey !== expectedKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["canonicalKey"],
        message:
          'canonicalKey must equal sha256(normalize(company) + "|" + normalize(location) + "|" + normalize(title))',
      });
    }
  });

export type PostingV1 = z.infer<typeof PostingV1>;

// The provider registry — policy as data, not code (§2.2). Every provider's terms, coverage, and
// cost are one row here, never an `if (providerId === ...)` branch in route code.
// .finite() everywhere below — the oracle's isNumber requires Number.isFinite, so a bare z.number()
// (which accepts Infinity/-Infinity) would let the port silently accept what the oracle rejects.
export const PostingProviderCostModel = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("perThousandPostings"), amountUsd: z.number().finite() }).strict(), // Techmap
  z
    .object({
      kind: z.literal("flatMonthlyTier"),
      amountUsd: z.number().finite(),
      includedUnits: z.number().finite(),
    })
    .strict(), // TheirStack
  z.object({ kind: z.literal("operatorHours") }).strict(), // the curated pool — no vendor cost
]);

export type PostingProviderCostModel = z.infer<typeof PostingProviderCostModel>;

const RateLimit = z
  .object({
    perMinute: z.number().finite().nullable(),
    perDay: z.number().finite().nullable(),
    perMonth: z.number().finite().nullable(),
  })
  .strict();

export const PostingProviderPolicyV1 = z
  .object({
    schemaVersion: z.literal("1"),
    providerId: z.string().min(1),
    // ISO 3166-1 alpha-2 codes this provider is authoritative for; "*" for the curated pool
    regionsServed: z.array(z.string().min(1)).min(1),
    // lower wins a field-value conflict when two records merge into one canonical posting (§2.4)
    authorityRank: z.number().finite(),
    // Defaults false — silence in a provider's ToS is never read as permission.
    permitsStorage: z.boolean().default(false),
    permitsMatching: z.boolean().default(false),
    attributionRequired: z.boolean(),
    attributionTemplate: Attribution.nullable(),
    rateLimit: RateLimit,
    costModel: PostingProviderCostModel,
    freshnessTtlHours: z.number().finite(), // this provider's own crawl/liveness guarantee
  })
  .strict();

export type PostingProviderPolicyV1 = z.infer<typeof PostingProviderPolicyV1>;

const Coverage = z
  .object({
    providersQueried: z.array(z.string()), // providers whose response was successfully used
    providersUnavailable: z.array(z.string()), // eligible providers that failed/timed out/rate-limited
    complete: z.boolean(),
  })
  .strict()
  .superRefine((coverage, ctx) => {
    if (coverage.complete !== (coverage.providersUnavailable.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["complete"],
        message: "coverage.complete must equal (providersUnavailable.length === 0)",
      });
    }
  });

export const InvalidRequestCode = z.enum([
  "missing_intent",
  "family_not_published",
  "floor_not_covered",
  "search_area_not_covered",
]);

// §2.7: coverage makes partial availability honest, never collapsed into a bare "no jobs" state.
export const PostingRetrievalResultV1 = z
  .discriminatedUnion("outcome", [
    z
      .object({
        schemaVersion: z.literal("2"),
        outcome: z.literal("relevant_postings"),
        postings: z.array(PostingV1).min(1),
        coverage: Coverage,
        retrievedAt: z.string().min(1),
      })
      .strict(),
    z
      .object({
        schemaVersion: z.literal("2"),
        outcome: z.literal("empty_pool"),
        coverage: Coverage, // MUST have complete === true (enforced below) — see §2.7 rule 4
        retrievedAt: z.string().min(1),
      })
      .strict(),
    z
      .object({
        schemaVersion: z.literal("2"),
        outcome: z.literal("provider_unavailable"),
        coverage: Coverage,
        reason: z.string().min(1),
        retryable: z.boolean(),
      })
      .strict(),
    z
      .object({
        schemaVersion: z.literal("2"),
        outcome: z.literal("stale_data"),
        lastKnownFreshAt: z.string().min(1),
        retrievedAt: z.string().min(1),
      })
      .strict(),
    z
      .object({
        schemaVersion: z.literal("2"),
        outcome: z.literal("invalid_request"),
        code: InvalidRequestCode,
      })
      .strict(),
  ])
  .superRefine((value, ctx) => {
    if (value.outcome !== "empty_pool") return;
    // empty_pool is only constructible with coverage.complete === true — an empty result while a
    // provider was unavailable is not an empty pool, it's provider_unavailable (§2.7 rule 4/5).
    if (!value.coverage.complete) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverage", "complete"],
        message: "empty_pool requires coverage.complete === true",
      });
    }
    // An empty pool means every eligible provider was asked and had nothing — so at least one must
    // have been asked. Zero providers queried (and none unavailable) is a well-formed search area
    // with no coverage at all, i.e. search_area_not_covered, never empty_pool. This constraint lives
    // ONLY on this arm: provider_unavailable legitimately has zero queried and many unavailable.
    if (value.coverage.providersQueried.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverage", "providersQueried"],
        message: "empty_pool requires at least one provider to have been queried",
      });
    }
  });

export type InvalidRequestCode = z.infer<typeof InvalidRequestCode>;
export type PostingRetrievalResultV1 = z.infer<typeof PostingRetrievalResultV1>;
