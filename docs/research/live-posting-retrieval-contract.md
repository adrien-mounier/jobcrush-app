# Live-posting retrieval contract

_Research + specification for #85. Written 2026-08-01. Blocks nothing on its own; unblocks #63 once
the owner picks a provider strategy from §1 and an implementer builds against §2._

Today `/onboarding/cards` (`apps/api/src/routes/onboarding.ts`) joins `loadPostings()`
(`apps/api/src/preview.ts`, reading the static `apps/api/data/sample-postings.json`) against
`listAdRequirements()` (`apps/api/src/e5stub.ts`, reading `apps/api/data/sample-ad-requirements.json`).
Both are hand-authored fixtures with no network I/O, no live/expiry status, and no freshness concept —
they were built for #58–#62's family-floor research and are explicitly **not** a production vacancy
feed (the postings prove a floor is real; they don't prove a job is currently open). #63 correctly
refused to build against them. This document defines what has to replace them.

---

## 1. Provider shortlist — the owner's decision

_Revised 2026-08-01, second pass. The first two drafts assumed UK/EU as the target geography — that was
the coordinator's mistake, not mine, but it invalidated both prior rounds' recommendations. The actual
target is **South-East Asia and East Asia first, plus Australia**; UK/EU/US come later. This is
confirmed by the product owner directly and independently by the data already in this repo: the 17
postings backing #60's published `it-project-delivery` family floor
(`apps/api/data/sample-postings.json`) are Hong Kong, Vietnam, Australia, and one APAC-wide listing —
**zero UK, zero EU.** Coverage in-region is now the primary selection criterion, ahead of price, per
the coordinator's explicit instruction. JSearch and SerpApi (the prior round's pair) are dropped from
the primary three below — not because their pricing changed, but because neither vendor's own
documentation names a single South-East/East Asian job board as a source; both are Google-for-Jobs /
LinkedIn-Indeed-Glassdoor aggregators built around US/UK-centric structured-data coverage. They remain
usable as a UK/EU/US option later; they are not evaluated further here._

### Do the regional incumbents offer a read API at all? No — checked directly.

- **SEEK** (owns Australia; via JobStreet/JobsDB now also owns Hong Kong, Singapore, Malaysia,
  Indonesia, Philippines, Thailand — JobStreet and JobsDB were consolidated onto SEEK's own platform in
  Q4 2023/Jan 2024). SEEK's own developer portal states its API is for **advertisers and recruitment-
  software partners only** — job posting, application export, and ad-performance endpoints, gated
  behind an approval form. There is no job-search/read endpoint for a third party to query.
  ([developer.seek.com](https://developer.seek.com/), [migration guide](https://developer.seek.com/migration-guides/jobstreet-and-jobsdb-uplift))
- **Glints** (Singapore/Indonesia): no public developer API found; third-party tools access it only by
  reverse-engineering an undocumented internal API.
- **Kalibrr** (Philippines/Indonesia): same — undocumented internal API only, no public docs.
- **Wantedly** (Japan): no evidence of a public API found at all.

None of the four regional incumbents are reachable through an official read API. Any provider that
claims regional coverage is necessarily re-aggregating these markets from job boards, ATS/career-page
crawling, or (for the licensed-data vendors below) direct data-partner relationships — not from a
SEEK/JobStreet/Glints/Kalibrr/Wantedly API, because none exists.

### The three options, real numbers first

| | **Techmap / jobdatafeeds.com Jobs API** | **TheirStack** | **Curated manual pool** (no vendor) |
|---|---|---|---|
| **Monthly cost @ pilot volume** | **$0–~$50/mo** — free tier 1,000 jobs/mo, then pay-as-you-go **$1 per 1,000 job postings**, no card required for the free tier | **$59/mo** minimum paid tier (1,500 API credits); no usable free tier for production volume (free plan is 50 *company* credits, not job-posting credits) | **$0 cash.** Est. 3–5 operator-hours/week to source and re-verify ~15–20 live postings (same discipline #60 used) |
| **Monthly cost @ 10x** | Still pay-as-you-go, ~$1/1,000 postings — scales linearly, no tier jump | **$100–$169/mo** (5,000–10,000 credits) | Scales with operator hours, not cash |
| **Available today, no sales call?** | Yes — self-serve, Jobs API + RapidAPI listing | Yes — self-serve signup | Yes — no vendor at all |
| **Where the inventory comes from** | "127+ portals" — job boards, aggregators, employment offices, **and direct company ATS career-page crawling**, scraped ≥2×/day ([jobdatafeeds.com/faq](https://jobdatafeeds.com/faq)) | Explicitly named: "Indeed... **JobStreet**... Naukri... Kalibrr... JobKorea... Saramin" among 352k+ sources — job boards, ATS platforms (Greenhouse/Lever/Workday/etc.), and career pages ([theirstack.com/en/job-posting-api](https://theirstack.com/en/job-posting-api)) | Operator-sourced directly, same method as the existing research pool |
| **SEEK/JobStreet/JobsDB reachable through it?** | **Not confirmed** — Techmap does not name individual portals on its public pages; "127+ sources" is unitemized | **Yes for JobStreet specifically** — named on TheirStack's own page as a source. JobsDB/SEEK-branded specifically not separately named (JobStreet and JobsDB are now the same underlying platform, so this likely covers both, but that inference isn't confirmed by TheirStack's own text) | N/A — operator can include SEEK/JobStreet postings by hand, same as the existing 17-posting research pool already does |
| **Published/observed regional volume** | **Real, provider-published stats** (their own country dashboard, not an authenticated query I ran): Hong Kong **67,089** new postings/mo, Singapore **77,247**/mo, Vietnam **41,705**/mo, Australia **213,814**/mo, from 32/51/34/61 sources respectively (2026-06 snapshot) — [jobdatafeeds.com/data/countries](https://jobdatafeeds.com/data/countries) | **Not measured** — no per-country counts published on the pages I could reach without signing up; would need a funded account to query | **Not measured** — no pool exists yet |
| **Persistent storage + matching/scoring permitted?** | **Yes, explicitly.** FAQ: "You may store job postings in your own database for internal processing, AI enrichment, **candidate matching**, analytics, and public display" — only reselling the raw postings is barred. ([jobdatafeeds.com/faq](https://jobdatafeeds.com/faq)) | **Not publicly determinable** in the time available — no equivalent explicit clause found on TheirStack's public pages | Yes, unambiguously — no third-party terms apply |

Sources: [Techmap/jobdatafeeds FAQ](https://jobdatafeeds.com/faq), [Techmap country data explorer](https://jobdatafeeds.com/data/countries),
[Techmap pricing](https://jobdatafeeds.com/pricing), [TheirStack Job Postings API](https://theirstack.com/en/job-posting-api),
[TheirStack pricing](https://theirstack.com/en/pricing), [SEEK Developer portal](https://developer.seek.com/),
[SEEK/JobStreet/JobsDB migration guide](https://developer.seek.com/migration-guides/jobstreet-and-jobsdb-uplift).

**I could not query either vendor's live API myself** — both free tiers still require account signup
(and TheirStack's free tier doesn't cover job-posting credits at all), which I can't complete
unattended in this environment. The Techmap regional volumes above are the vendor's own published
dashboard numbers, not a query I ran — labelled as such, not presented as independently observed.

### Measured, not vendor-published — probe run 2026-08-01

Run against Techmap's live API on a free RapidAPI BASIC key (owner-provisioned). Throwaway script,
scratch dir, not in the repo. **Every number below was observed, not quoted from a vendor page.**
The API's `count` defaults to a **single day**'s new postings; the day sampled was 2026-07-30.

| Country | All new postings, that day | `"project manager"` | `"programme manager"` | `"delivery manager"` |
|---|---|---|---|---|
| Hong Kong | 2,390 | **34** | 1 | 3 |
| Singapore | 2,128 | **21** | 0 | 0 |
| Vietnam | 2,153 | **13** | 0 | 0 |
| Australia | 6,805 | **70** | 1 | 5 |

**Finding 1 — Techmap's published volume is honest.** Extrapolating the measured day to a month
gives Hong Kong ~72k, Singapore ~64k, Vietnam ~65k, Australia ~204k, against their published 67k /
77k / 42k / 214k. Same order of magnitude on every market, two of them near-exact. Their country
dashboard can be trusted, which is a meaningful trust signal for a vendor we're picking largely on
its own claims.

**Finding 2 — and this is the product-relevant one: title matching is nowhere near sufficient.**
The first ten Hong Kong `"project manager"` results:

```
Project Manager (Power Station, E&M Maintenance Services) | CLPe Solutions
Project Manager (Digital Transformation)                  | Fides Solutions
Contract Project Manager                                  | CLTS HK
Project Manager / Project Coordinator                     | Ngai To Construction
Project Manager / Business Analyst / Project Officer (PMO) | Seamatch Asia
Project Manager / Assistant Project Manager               | Lemon Design & Build
Project Manager                                           | Dermaglow
Project Manager                                           | CITIC Telecom CPC
Project Manager                                           | The Hong Kong Girl Guides Association
IT Project Manager - POS/Payment/RMS                      | Allworth Consultants
```

Roughly **three to four of ten** are IT/digital project delivery. The rest are construction,
building services, and one youth charity. So the honest relevant volume for the published
`it-project-delivery` floor is nearer **10–13 new postings/day in Hong Kong**, not 34 — still
workable, but a third of the headline.

This is direct evidence for #86: separating IT project delivery from construction project management
**is** the per-ad understanding engine's job, and no amount of provider-side title filtering
substitutes for it. A title filter alone would show a Hong Kong user a building-site role and call it
a match.

**Finding 3 — vocabulary is regional.** "Programme manager" and "delivery manager" are effectively
absent in Hong Kong, Singapore and Vietnam (0–3 postings/day combined), and only marginally present
in Australia. In these markets the term is "project manager". Discovery's target-role question and
the family floor's title synonyms must be built on APAC vocabulary, not the British/Australian
variants the previous UK/EU framing would have assumed.

### Which countries Techmap actually serves — measured 2026-08-01, feeds the §2.2 registry

Every country below was queried directly. Same single day (2026-07-30), same method. `PM/day` is
`title:"project manager"`; apply the ~3–4-in-10 IT-relevance ratio from the sample above to get
genuinely relevant volume.

| Tier | Country | All postings/day | PM/day | ~Relevant IT delivery/day |
|---|---|---|---|---|
| **1 — launch** | Australia | 6,805 | 70 | ~25 |
| | Hong Kong | 2,390 | 34 | ~12 |
| | Singapore | 2,128 | 21 | ~7 |
| | Malaysia | 3,040 | 21 | ~7 |
| | New Zealand | 1,774 | 18 | ~6 |
| | Vietnam | 2,153 | 13 | ~5 |
| **2 — thin but real** | Indonesia | 1,593 | 7 | ~2–3 |
| | Philippines | 569 | 3 | ~1 |
| | Thailand | 311 | 2 | <1 |
| **3 — covered, wrong language** | Japan | 17,796 | 11 | see note |
| | China | 8,009 | 12 | see note |
| **4 — not usable** | Taiwan | 187 | 1 | — |
| | Myanmar | 82 | — | — |
| | South Korea | 77 | — | — |
| | Cambodia | 56 | — | — |
| | Macau | 29 | — | — |
| | Laos | 19 | — | — |
| | Brunei | 1 | — | — |

**Tier 3 is the interesting row.** Japan is Techmap's *largest* market in this region — 17,796
postings a day, more than double Australia — yet only 11 match `"project manager"`. China is the same
shape. That is not thin coverage; it is **coverage we cannot read**. Those postings are in Japanese
and Chinese. Serving Japan or China means the target-role vocabulary, the family floor's title
synonyms, and per-ad understanding all have to work in-language. That is a real market with real
depth waiting behind a language barrier — a strategic option, and a substantial piece of work. Not a
gap in Techmap.

**South Korea is genuinely absent** (77 postings/day nationwide), consistent with §1's finding that
Saramin and JobKorea dominate there and neither is reachable. Korea needs its own provider or it
doesn't launch.

**Recommended launch set for the SE-Asia cluster: Hong Kong, Singapore, Malaysia, Vietnam** — plus
**Australia and New Zealand**, which come free on the same source and are the deepest markets
available. That is roughly **60 relevant IT-delivery postings a day across the set**, ample for an
invitation-only pilot and honest enough to promise. Indonesia, the Philippines and Thailand are
switched on as tier-2 with the empty-pool path expected to fire more often. Everything in tier 4 is
left out of the registry until a provider covers it — per §2.3, a search area with no provider must
be told so honestly, never shown a false empty pool.

### Recommendation

**Techmap (jobdatafeeds.com Jobs API), with TheirStack as the credible alternative if per-source
attribution to a named regional board (JobStreet) matters more than price.** Techmap wins on three
concrete points: it publishes real per-country volume for exactly the four cities in scope (HK/SG/VN/AU,
tens of thousands of postings a month each, dozens of sources per country); its FAQ is the only one of
any provider checked across all three research rounds that explicitly names "candidate matching" as a
permitted use, closing the single biggest legal gap flagged in both prior rounds; and its pay-as-you-go
$1/1,000 pricing with a free 1,000/mo tier is the cheapest credible path to real volume. Its one
disadvantage against TheirStack is that it doesn't name SEEK/JobStreet by name as a source, so regional-
incumbent coverage is inferred from volume, not confirmed by name. If that distinction matters enough to
the owner to justify TheirStack's higher price floor ($59/mo minimum vs. Techmap's ~$0 start), TheirStack
is the one to pick instead — but its storage/matching permission still needs direct confirmation before
committing, unlike Techmap's.

**Adzuna, revisited for this geography:** still excluded on trial terms (unchanged from the last round),
but worth one line on whether the geography would have mattered anyway — it wouldn't have solved the
core problem. Adzuna's core supported markets include Australia (and possibly Singapore via a broader,
less-clear "area served" list), but **no evidence of Hong Kong or Vietnam coverage** was found. Even
without the trial-terms exclusion, Adzuna would have covered at most one of the four in-scope cities.

**What I could not determine, stated plainly:**
- Whether TheirStack's terms permit persistent storage + matching/scoring — not addressed in the public
  pages checked; needs direct confirmation before it's a real option, not just a promising one.
- Real observed (queried, not vendor-published) posting counts for HK/SG/VN/AU on either Techmap or
  TheirStack — both require a funded/signed-up account I could not provision here. This should be the
  first thing an implementer does with a real key before committing further engineering time.
- Whether Techmap's "127+ sources" specifically include SEEK/JobStreet/JobsDB by name, or reach the same
  postings only indirectly (via employer career-page crawling, which would reach the same jobs without
  going through SEEK's platform at all).
- Coresignal, Bright Data, and LinkUp were checked and are **not** in the primary three: Coresignal
  ($49/mo self-serve start) and Bright Data ($0.75–$2.50/1k records, real published pricing) are both
  legitimate self-serve options but neither publishes APAC-specific coverage detail, so they don't clear
  this round's "demonstrable regional coverage" bar the way Techmap's country dashboard does. LinkUp
  publishes no pricing at all and requires a demo/contract — it fails the "no sales call" bar outright
  and was dropped without further checking.

**Treat this shortlist as a strong lead, not a closed decision** — per the coordinator's framing, the
original vendor list came from comparison sites with a ranking interest, and the two picked here were
promoted only after their own primary documentation (FAQ, pricing page, country dashboard) was read
directly. The regional-volume and matching-permission claims are sourced to Techmap's own pages; they
have not been cross-checked against an independent source.

---

## 2. The provider-neutral contract

_Revised 2026-08-01, third pass. §1's own research is the reason this section changes: no regional
incumbent board is reachable by API (checked directly — SEEK, JobStreet/JobsDB, Glints, Kalibrr,
Wantedly all have no public read API), so regional coverage will always be assembled from more than one
source. The previous draft's `PostingRetrievalResultV1` assumed exactly one provider answered per
request, with `providerId` stapled onto both the posting and the outcome as a single string. That
assumption breaks the moment a second provider exists — which is day one, since the curated pool sits
alongside Techmap from launch. Nothing about fail-closed liveness, server-owned inputs, the forbidden-
input list, intent-change invalidation, or the fixture pool's isolation from production changes below;
they're preserved verbatim in substance, only renumbered where a new subsection was inserted ahead of
them._

Everything below is written to be implementable against **any number** of providers from §1 (today:
Techmap plus the curated pool; TheirStack or a UK/EU aggregator later), each with its own regional
coverage, terms, and pricing. #63 must not invent policy beyond this.

### 2.1 Posting identity — provider records vs. the canonical posting

Two shapes, not one. A `ProviderPostingRecordV1` is one provider's raw view of a job; a `PostingV1` is
the deduplicated, provider-independent posting #63 actually consumes. §2.4 defines how the first
becomes the second.

```
ProviderPostingRecordV1 {         // schemaVersion "3" as of #133
  schemaVersion: "3"
  providerId: string             // "techmap" | "curated-pool" | ... — never blank, keyed to §2.2's registry
  providerPostingId: string      // opaque, exactly as given by that provider
  title: string
  company: string
  location: string
  sourceUrl: string               // resolves to the original listing — parent spec story #52 requires this
  excerpt: string
  postedAt: string | null         // provider-claimed post date, ISO 8601
  capturedAt: string              // when JobCrush first retrieved this record, ISO 8601
  verifiedLiveAt: string          // last time liveness was positively re-confirmed, ISO 8601
  expiresAt: string | null        // provider-stated expiry, if any
  attribution: { label: string; url: string } | null  // THIS provider's own attribution requirement, if any
  language: string                // BCP-47 primary subtag, DERIVED at ingest from the advert body — never provider-supplied
  skills: string[]                // this provider's own structured skills list (§6) — carried structured, never flattened into excerpt
}
// ⚠️ `applicantLocationRequirements` was REMOVED in #133 (schemaVersion "3"). It was specified here as
// a work-eligibility signal on the strength of the field's NAME; the live API returns "HKT Timezone".
// See §6 Finding 2. Do not reinstate it under this name — both validators now reject it as an unknown key.

PostingV1 {                       // schemaVersion "4" as of #133 — canonical, provider-independent, what #63 consumes
  schemaVersion: "4"
  id: string                       // "posting:<canonicalKey>" — stable regardless of which provider(s) currently see it
  canonicalKey: string              // the dedup key itself (§2.4), kept for audit/debugging
  title: string                     // from the highest-authorityRank contributing record (§2.4)
  company: string
  location: string
  sourceUrl: string                 // the winning record's URL
  excerpt: string
  postedAt: string | null
  capturedAt: string                 // earliest capturedAt across contributing records
  verifiedLiveAt: string             // most recent verifiedLiveAt across contributing records
  expiresAt: string | null           // earliest non-null expiresAt across contributing records (most conservative)
  attribution: Array<{ label: string; url: string }>  // UNION of every contributing provider's requirement — all honored, not just the winner's
  sources: Array<{ providerId: string; providerPostingId: string }>  // every provider record currently merged into this posting, min length 1
  language: string                        // resolved by the winner rule — it GATES visibility, so never a union
  skills: string[]                        // same rule
}
// ⚠️ `applicantLocationRequirements` REMOVED here too in #133 — see the note above and §6 Finding 2.
```

`skills` and `language` deliberately do NOT follow `attribution`/`sources`'s union rule. A permissive
union must never silently become a gating input (carry-forward of #106's comment) — that reasoning was
originally written about eligibility locations and **now applies to `language`**, which genuinely does
gate what a user is shown. `attribution`/`sources` are safe to union because widening them only adds
disclosure, never a claim about the user's own eligibility.

**The eligibility half of that argument is now moot for a different reason:** the field it was written
about is gone (#133), and Techmap supplies no work-eligibility data at all. Work-eligibility comes from
the advert free text via the ad reader's `work-rights` dimension. The principle stands and should be
applied to any future provider-supplied eligibility field — it is the reason such a field must never be
unioned across providers.

Display fields still map directly onto `JobCardV1` (`title→title`, `company→company`, `location→place`,
`excerpt→adExcerpt`) so #63 does not need a second card shape. **One real gap this revision surfaces:**
`JobCardV1` (`packages/contracts/src/jobCard.ts`) has no attribution field today. If any active
provider's policy sets `attributionRequired: true` (§2.2), `JobCardV1` needs a new field to render it —
flagged in §3, not solved here, since §2's scope is the retrieval contract, not the card contract.

`id` is intentionally never the old `<providerId>:<providerPostingId>` scheme — a canonical posting's
identity must survive a provider dropping out or a second provider picking up the same job, so it's
derived from the posting's own normalized content (§2.4), not from which provider happened to answer
this time. It also never reuses the fixture id scheme (`sample-postings.json`'s
`<date>_<company-slug>_<title-slug>`), keeping production and fixture postings visually distinguishable.

### 2.2 The provider registry — policy as data, not code

Every provider's terms, coverage, and cost are one row in a data table, not an `if (providerId === ...)`
branch anywhere in route code:

```
PostingProviderPolicyV1 {
  schemaVersion: "1"
  providerId: string
  regionsServed: string[]          // ISO 3166-1 alpha-2 codes this provider is authoritative for, e.g. ["HK","SG","VN","AU"]; "*" for the curated pool (serves whatever the operator has curated, anywhere)
  authorityRank: number            // lower wins a field-value conflict when two records merge into one canonical posting (§2.4)
  permitsStorage: boolean          // defaults false — silence in a provider's ToS is never read as permission
  permitsMatching: boolean         // defaults false — same rule
  attributionRequired: boolean
  attributionTemplate: { label: string; url: string } | null
  rateLimit: { perMinute: number | null; perDay: number | null; perMonth: number | null }
  costModel:
    | { kind: "perThousandPostings"; amountUsd: number }   // Techmap's shape
    | { kind: "flatMonthlyTier"; amountUsd: number; includedUnits: number }  // TheirStack's shape
    | { kind: "operatorHours" }                             // the curated pool — no vendor cost, tracked as hours not dollars
  freshnessTtlHours: number         // this provider's own crawl/liveness guarantee
}
```

**Enforcement, fail closed:** the registry the live system reads from contains only rows where
`permitsStorage && permitsMatching && !attributionRequired` all hold. A provider whose terms are
unconfirmed or restrictive (TheirStack today, per §1) may exist as a **documented candidate row** the
owner can review, but the loader that builds the active registry filters it out — the exact same shape
as `eligibleProductionPublication` filtering non-published family floors in `onboarding.ts`, or
`ProductionFamilyFloorStore.publish()` refusing anything not reviewed. A future provider with stricter
terms cannot be wired into production without someone explicitly flipping its booleans in this table,
which is the enforcement point this ticket's brief asked for.

**Why the third clause (`!attributionRequired`) exists, recorded here rather than left as an
implementation accident:** `JobCardV1` (`packages/contracts/src/jobCard.ts`) has no attribution field
today (§2.1's own gap note). A provider whose policy sets `attributionRequired: true` cannot have its
attribution rendered anywhere in the product — activating it anyway would mean silently breaking that
provider's terms on every card shown. So `attributionRequired` gates activation exactly like the two
permission booleans do, not just as a future nice-to-have. The direct consequence, stated plainly so
it isn't rediscovered by surprise: **flipping any active provider's `attributionRequired` to `true` in
this file removes it from the active registry immediately**, with no other code change, until either
`JobCardV1` grows an attribution field (closing the gap) or the flag is reverted. This is #99's own
"known gap — resolve or record" item, resolved here by recording it, not by building the card field.

Lives at `apps/api/data/posting-providers.json`, zod-validated on load — same pattern as
`sample-family-floors.json`/`sample-ad-requirements.json` (`e5stub.ts`). It is a new file under `data/`,
so it needs `git add -f` (the directory is gitignored by default; `lessons.md` already documents this
exact trap from #12's fixtures).

### 2.3 Routing — search area to provider(s)

```
resolveSearchAreaToRegions(searchArea: string): string[]   // "Hong Kong" / "HK" / "Ho Chi Minh City" → ["HK"] / ["VN"], a small hand-built lookup table sized to the pilot's known cities — NOT a geocoding API call
providersFor(regions: string[], registry: PostingProviderPolicyV1[]): PostingProviderPolicyV1[]
  // registry rows whose regionsServed intersects `regions` (or is "*"), sorted by authorityRank ascending
```

Both are pure functions, unit-testable without a network call. `resolveSearchAreaToRegions` is new,
unbuilt logic and a real gap (§2.11 notes it isn't geocoding infrastructure — a lookup table covering
Hong Kong/Singapore/Vietnam/Australia and their major cities is enough at pilot scale).

**If `providersFor(...)` returns empty** — a well-formed search area with no provider covering it —
the outcome is `invalid_request` with `code: "search_area_not_covered"` (§2.7), **never** `empty_pool`.
This is the distinction the brief asked for: a user in an uncovered city never received a real answer to
"are there jobs here," so the honest response is "we don't search there yet," not "we looked and found
nothing." The curated pool's `regionsServed: ["*"]` means it's always in the candidate list — if the
operator has genuinely curated nothing for that area, the pool still legitimately returns zero, and the
overall outcome degrades to a real `empty_pool`, not `search_area_not_covered`.

### 2.4 Deduplication — the most important item

**Canonical key:** `sha256(normalize(company) + "|" + normalize(location) + "|" + normalize(title))`,
where `normalize` = lowercase, trim, collapse internal whitespace, strip a small fixed set of
punctuation (commas, periods, parentheses, **and `|` itself**). `|` is stripped precisely because it's
the triple's own field delimiter — leaving it in a field's content would let it forge a fake field
boundary (e.g. company `"HSBC|Hong Kong"` + location `"Singapore"` producing the same joined string as
company `"HSBC"` + location `"Hong Kong|Singapore"`), silently merging two distinct jobs. Two provider
records that produce the same key merge into one `PostingV1`. On a conflict in a display field
(title/company/location/sourceUrl text differs between merged records), **the record from the provider
with the lower `authorityRank` wins** (§2.2); `sources` and `attribution` are always the union across
every contributing record, never just the winner's.

**How confident this is, stated plainly:** this catches exact-and-near-exact duplicates only — the same
employer spelling, the same city string, the same job-title string across providers. It will **miss**:
- the same job with different title wording ("Senior PM" vs. "Senior Project Manager"),
- the same job with a company-name variant ("BNP Paribas" vs. "BNP Paribas Hong Kong Branch"),
- the same job at different location granularity ("Hong Kong" vs. "Wan Chai, Hong Kong").

Every miss above is a **false negative** (two `PostingV1`s where there's really one job) — the count can
be a slight over-count. The rule is deliberately built to never produce a **false positive** (merging two
genuinely different jobs): it only merges on an exact normalized match, so a missed merge just leaves an
extra card, never silently drops a distinct one. An inflated "N jobs" count from an unmerged duplicate is
a real defect against the reward's promise, but it's a smaller, more honest failure mode than a wrongful
merge that quietly loses a job from the count — so this is the right direction to err in, not a
compromise to fix later by tightening in the wrong direction.

With exactly two sources active at launch (Techmap, automated; the curated pool, human-authored and
already human-normalized), the practical collision rate is expected to be low. Re-evaluating toward a
fuzzy/probabilistic matcher is explicitly deferred (§2.11) until production data shows the naive key is
actually missing a material number of duplicates — not built speculatively now.

Runs as a pure function, `dedupePostings(records: ProviderPostingRecordV1[]): PostingV1[]`, called once
by `retrievePostings`'s real implementation after every eligible provider for the region has answered
(or failed). Testable in isolation with fixture records — no network, no store.

### 2.5 Retrieval inputs — server-owned, explicitly enumerated

Unchanged in substance from the prior draft. Read from the session record (`SessionRecord`,
`apps/api/src/sessions.ts`), never from the request body:

| Input | Source | Required |
|---|---|---|
| Target role | `session.intent.targetRole` | yes, non-null |
| Search area | `session.intent.searchArea`, resolved to region codes via §2.3's `resolveSearchAreaToRegions` | yes, non-null |
| Confirmed published job family version | `session.discovery.searchFamily` (renamed from `discovery.floor` by #234, which split the question floors from the search family; must resolve via `ProductionFamilyFloorStore.get()` to a publication with `publicationStatus === "published"` — the same `eligiblePublication` check `onboarding.ts` already applies) | yes |
| Essential floor covered | `session.discovery.checkpoint === "essential_floor_covered"` | yes |
| Source-supported evidence | Derived server-side from `claims.confirmed(sessionId)` — reduced to search keywords/requirement labels, never raw free text (privacy, §2.9) | used to build each provider's query, not sent verbatim |
| Explicit negatives | `claims.negatives(sessionId)` | used as a server-side post-filter/suppressor, never a positive signal |

**Forbidden inputs, explicitly:**
- **System inference** — any claim with `decision !== "confirmed"` (pending/mined-but-unreviewed) must never reach the query or the relevance filter.
- **Client assertions** — a request body cannot set `targetRole`, `searchArea`, or the family reference; the route reads only session state.
- **The family-research postings pool** (`sample-postings.json`) — must never be joined into a production retrieval result. It stays fixture-only, gated the same way `TestFixtureFamilyFloorStore` is isolated from `ProductionFamilyFloorStore` today (`apps/api/src/familyFloors.ts`) — mirror that split with a `TestFixturePostingProvider` that structurally cannot satisfy a production check.

If any required input is absent, or `resolveSearchAreaToRegions`/`providersFor` yields no provider, the
outcome is `invalid_request` (§2.7) — never a silent empty result.

### 2.6 Live/freshness semantics — fail closed, now per provider

- A provider record counts toward the reveal only if `verifiedLiveAt` is within its **effective TTL**
  — `min(24 hours, that provider's policy.freshnessTtlHours)` — **and** (`expiresAt` is null or in the
  future). The 24-hour ceiling is a global maximum; a provider's own tighter guarantee can shorten it,
  never lengthen it past 24h.
- If a provider cannot be freshness-checked (timeout, rate-limited, 5xx), its records are **not** counted
  live for this round. They are not silently dropped from the system either — this is exactly what makes
  that provider's contribution to §2.7's `coverage.providersUnavailable`.
- Revalidation is a background refresh per provider (mirrors `purge.ts`'s existing job shape), not a
  synchronous network round-trip inside `/onboarding/cards`. Each provider's own rate limit and cost
  model (§2.2) bounds how often its revalidation job runs; one shared refresh serves every session
  searching an overlapping region, rather than one provider call per page load.
- Every freshness check is logged with a timestamp and providerId for audit (pilot observability
  requirement, parent-spec story #72).

### 2.7 Outcomes — coverage makes partial availability honest, never collapsed

```
Coverage {
  providersQueried: string[]        // providers whose response was successfully used this round
  providersUnavailable: string[]    // providers eligible for this region that failed/timed out/were rate-limited
  complete: boolean                 // providersUnavailable.length === 0
}

PostingRetrievalResultV1 = discriminated union on "outcome":

| { outcome: "relevant_postings", postings: PostingV1[] (non-empty, deduped per §2.4), coverage: Coverage, retrievedAt }
| { outcome: "empty_pool", coverage: Coverage (coverage.complete MUST be true), retrievedAt }
| { outcome: "provider_unavailable", coverage: Coverage, reason: string, retryable: boolean }
| { outcome: "stale_data", lastKnownFreshAt: string, retrievedAt: string }
| { outcome: "invalid_request", code: "missing_intent" | "family_not_published" | "floor_not_covered" | "search_area_not_covered" }
```

**The assembly rule, stated precisely** (this is where partial availability becomes a qualifier on the
existing outcomes rather than a sixth arm — adding a whole new top-level state would just multiply what
#63 has to branch on without adding information beyond "how sure are we," which already belongs next to
the count it qualifies):

1. If `providersFor(...)` is empty → `invalid_request` / `search_area_not_covered` (§2.3). No provider
   was ever queried.
2. Otherwise, query every eligible provider. Dedup whatever succeeded (§2.4) into `postings`.
3. `postings.length > 0` → **always `relevant_postings`**, regardless of whether other eligible
   providers failed. `coverage.complete` tells #63 whether this is the full regional sweep or a real,
   partial count. **#63 must render these differently** — a complete count supports the plain "N jobs
   just matched you"; an incomplete one must say something honest like "N jobs matched you so far — still
   checking other sources," never the unqualified line, because a provider that hasn't answered yet
   might add more.
4. `postings.length === 0` and `coverage.complete === true` (every eligible provider was successfully
   queried and none had anything) → `empty_pool`. This is the only path to `empty_pool` — **it is
   structurally impossible to reach with an incomplete sweep.**
5. `postings.length === 0` and `coverage.complete === false` (at least one eligible provider never
   answered, so a genuine zero cannot be certified) → `provider_unavailable`, carrying the same
   `coverage` so #63 can still say which providers *did* check clean, if any. This is deliberately the
   more conservative choice: we would rather tell the user "we couldn't fully check" than risk the
   zero-job reveal the parent spec (story #46) explicitly forbids.

`empty_pool`, `provider_unavailable`, and an incomplete `relevant_postings` must never be presented
identically to #63 — each needs its own honest copy, not a shared "no jobs" state.

### 2.8 Persistence + intent-change invalidation

Unchanged in substance. Add a `retrieval: RetrievalSnapshot | null` field to `SessionRecord`, following
the same idiom as the existing `discovery: ProductionDiscoveryState` field — a parsed-or-safely-reset
JSON column (`discoveryState()`'s pattern in `sessions.ts`), with a `reconcileRetrievalState`-style store
method on both `InMemorySessionStore` and `PgSessionStore`. `RetrievalSnapshot` is simply the last
`PostingRetrievalResultV1` plus its request fingerprint — multi-provider dedup and coverage don't change
this shape, only what's inside the snapshot's `postings`/`coverage` fields.

- Session-scoped, not a shared cross-session cache — still the smallest correct boundary at pilot
  volume; a shared posting cache across sessions searching the same region is a real future
  optimization, deferred (§2.11).
- **Invalidation on intent change:** any call to `sessions.setIntent()` that actually changes
  `targetRole` or `searchArea` must clear `session.retrieval` (forcing a fresh retrieval, including a
  fresh region resolution and provider routing, on next read). It must **not** touch `claims`
  (confirmed/negative evidence), `session.discovery` (floor pin, coverage checkpoint), or anything else.
- Family placement (`session.discovery.searchFamily`, `discovery.floor` before #234) is pinned once via `reconcileDiscoveryState`'s existing
  guard and does not change on intent edits at this layer.

### 2.9 Cost, rate-limit, retry, privacy — per provider, read from §2.2's registry

- **Privacy:** never send raw CV text or full claim text to any provider. Reduce confirmed evidence to
  the minimal structured query (role keywords, region) before it leaves the server, for every provider
  queried — the same privacy-minimization discipline #62 already applies to family-research candidates.
- **Rate limit:** the server enforces one internal budget **per providerId**, each strictly below that
  provider's `policy.rateLimit` (§2.2) — e.g. Techmap's pay-as-you-go ceiling is effectively unbounded
  but its cost model still needs a spend cap; a stricter future provider's per-minute/day/month numbers
  live in its own row. Same fixed-window idiom as `IpRateLimiter` (`sessions.ts`), one tracker instance
  per provider. Exceeding a provider's internal budget marks that provider unavailable for this round
  (contributing to `coverage.providersUnavailable`, §2.7) — it does not fail the whole request if other
  providers still answer.
- **Retry:** bounded (1–2 attempts, backoff), idempotent, per provider — one provider's retry never
  blocks or delays another's.
- **Cost:** every provider call increments an observable counter **keyed by providerId**, using that
  provider's own `costModel` (§2.2) to convert calls into an estimated spend (pilot observability, story
  #72). The actual dollar ceiling per pilot, per provider, is an **owner decision** (§5); this contract
  only requires that cost be measured per provider, not that a combined number be picked here — different
  providers have genuinely different cost shapes (per-record vs. flat-tier vs. operator-hours), and
  normalizing them into one unit is explicitly deferred (§2.11) rather than built speculatively.

### 2.10 Seams + testing

- **The public seam stays a single function**, mirroring `placeFamily`'s exact pattern in
  `apps/api/src/server.ts` (`opts.placeFamily ?? (async () => ({ outcome: "unmapped" }))`):
  `retrievePostings?: (input: RetrievalRequest) => Promise<PostingRetrievalResultV1>` on
  `BuildOptions`/`OnboardingDeps`. The multi-provider fan-out, dedup, and coverage assembly (§2.3–2.7)
  are the real implementation's internal composition — `/onboarding/cards` still calls one function and
  gets one result, exactly as before. **The default fallback must fail closed to `provider_unavailable`**
  — never fabricate postings and never fall back to `sample-postings.json`.
- **Deterministic fake driver:** `TestFixturePostingProvider`, named and shaped like
  `TestFixtureFamilyFloorStore` — returns pinned canned `ProviderPostingRecordV1[]` per test case,
  **including cases with records from two different fake providerIds** so dedup (§2.4) and partial
  coverage (§2.7) are directly testable, and is structurally incapable of satisfying a production check.
- **New pure-function unit tests**, no store or network involved: `dedupePostings` (merge, conflict
  precedence, attribution/sources union), `resolveSearchAreaToRegions` (known cities, unknown city →
  empty), `providersFor` (region match, authority-rank ordering, curated-pool wildcard).
- **Both session-store drivers:** extend the existing pg-mem dual-driver pattern
  (`apps/api/test/pgstores.test.ts`, `sessions.test.ts`) with cases for the new `retrieval` column —
  same `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS retrieval jsonb` idiom as `production_discovery`.
- **Real-provider staging smoke test:** one small `.mjs` script gated behind an env var (mirrors
  `apps/web/e2e/r2-cors-preflight.mjs`'s one-shot pattern), hitting the actual chosen provider(s) with one
  known-good query per provider and asserting a 200 + at least one parseable record. Never inside the
  default `pnpm test` gate.
- **Gap, stated explicitly:** there is currently **no posting-cache/store seam, provider registry, or
  dedup function of any kind** in this codebase — `loadPostings()` is a pure fixture read with no store
  behind it. Everything in §2.1–2.10 is new construction, not a reuse of an existing seam.

### 2.11 Deliberately deferred

Recorded here so each is a decision, not an omission. None of these change §2's contract shape if added
later — that's the test for what belongs on this list rather than being built now:

- **A shared cross-session posting cache.** Session-scoped persistence (§2.8) is the smallest correct
  boundary at pilot volume; avoiding redundant provider calls across overlapping searches is a real
  optimization for later, not a pilot-blocking need.
- **A fuzzy/probabilistic dedup matcher.** §2.4's naive normalized-key match is a deliberate floor, not a
  placeholder — build a smarter matcher only once production data shows the naive rule is actually
  missing a material number of duplicates.
- **Per-posting (rather than per-response) staleness/coverage granularity.** `coverage` today qualifies
  a whole retrieval result, not each individual posting's own provider mix. With two sources at launch
  this is adequate; if a third provider makes response-level coverage too coarse, `Coverage` is already
  a reusable sub-type — no contract-shape change is needed to attach it per-posting later.
- **A cost-normalization engine** that converts every provider's native pricing shape (per-record, flat
  tier, operator-hours) into one comparable unit. §2.9 requires cost to be measured per provider in its
  own native shape; building a combined-spend forecaster is separate work with no bearing on retrieval
  correctness.
- **Any capability-negotiation layer, plugin loader, or provider marketplace.** Wiring a new provider
  means adding one row to §2.2's data file and one driver function — not a dynamic registration system.
  Exactly one real provider (Techmap) plus the curated pool exist at launch; this list exists so that
  fact is a recorded choice, not a gap nobody decided on.
- **Automatic geocoding for `resolveSearchAreaToRegions`.** A hand-built lookup table covering the
  pilot's known cities (§2.3) is enough; a geocoding API integration is unwarranted at this scale.

### 2.12 Contract versioning

`PostingV1` and `PostingRetrievalResultV1` bump to **schemaVersion "2"** — this revision is a breaking
change to both (canonical vs. provider-record split, `sources`/`canonicalKey`/`attribution`-as-array on
`PostingV1`; `coverage` and a narrowed `invalid_request.code` on the result union), not an additive one,
so per this repo's rule it's versioned, not silently mutated. `ProviderPostingRecordV1` and
`PostingProviderPolicyV1` are new "1" schemas. All four live under `packages/contracts/src/` (e.g.
`postingRetrieval.ts`), each with a matching `.mjs` oracle validator under `packages/contracts/oracle/`
— same discipline as `JobCardV1`/`FamilyFloorV1`/`FamilyPlacement`. The oracle remains authoritative on
any future disagreement between the port and the validator.

---

## 3. What #63 needs changed

#63 is currently blocked with "no files changed" and the note that `/onboarding/cards` loads static
fixtures with no live-status concept. Draft clarification text for the orchestrator to post on #63
(not posted by this session — git/issue edits are the orchestrator's):

> **Repaired scope, consuming #85's contract (updated for multi-provider — the outcome union now carries
> `coverage`, not a single `providerId`):**
> `/onboarding/cards` must stop reading `loadPostings()`/`sample-postings.json` for the production
> path. It now calls the injected `retrievePostings` seam (§2.10 of
> `docs/research/live-posting-retrieval-contract.md`) with the server-owned inputs from §2.5, and
> branches on the `PostingRetrievalResultV1` outcomes (§2.7):
> - `relevant_postings` with `coverage.complete === true` → build `JobCardV1`s from the returned
>   `PostingV1[]` (§2.1's field mapping) and proceed to the plain "N jobs just matched you" (AC1).
> - `relevant_postings` with `coverage.complete === false` → same card-building, but the reveal copy
>   must say the count is provisional ("N jobs matched you so far — still checking other sources"), not
>   the unqualified line — a real but incomplete sweep is a materially weaker claim than a full one.
> - `empty_pool` → the honest broaden-or-notify path (parent spec story #46). This outcome is only ever
>   reachable when `coverage.complete === true` (§2.7's assembly rule), so #63 never has to second-guess
>   whether a shown "zero" might still be partial.
> - `provider_unavailable` → a distinct honest waiting/error state, not folded into `empty_pool` (AC3).
>   If `coverage.providersQueried` is non-empty, this is a partial outage (some sources checked clean,
>   at least one didn't) rather than a total one — #63 may use that distinction in copy, but must not
>   present either shape as a zero-job reveal.
> - `stale_data` → unchanged, a distinct honest state from both of the above.
> - `invalid_request` with `code: "search_area_not_covered"` → its own honest message ("we don't search
>   this area yet"), distinct from every other `invalid_request` code and from `empty_pool` — the user
>   never received a real answer, so "no jobs found" would be dishonest.
>
> **A gap #85 does not close, and #63 must not paper over:** a live posting alone doesn't produce a
> scored `JobCardV1` — `matchPct`/`breakdown`/`fit`/`dontYet` need a per-posting `AdRequirements` list
> (`matchtick.ts`), which today only exists as a hand-authored fixture
> (`apps/api/data/sample-ad-requirements.json`, `e5stub.ts`). Generating `AdRequirements` for a
> genuinely new live posting is the E5 cluster-engine's job (roadmap S3, "one cheap LLM call per job
> ad") and is out of both #85's and #63's stated scope. #63 cannot honestly compute a match score for a
> posting it just retrieved live without either (a) a minimal per-ad requirements-generation step
> folded into #63's own build, or (b) a new ticket between #85 and #63 that owns it. Recommend the
> owner decide which before #63 resumes — building #63 against retrieval alone, with no scoring path,
> would just move the "invented policy" problem from postings to scores.

---

## 4. Gaps found (not owner decisions — technical facts)

- No posting-cache/store seam, provider registry, or dedup function exists today (§2.10). This ticket
  specifies their shape; nothing like them is being reused.
- No `AdRequirements`-generation path exists for a posting outside the two hand-authored fixture files
  — the E5 gap above. This is the single largest practical blocker #63 will hit that this contract does
  not resolve.
- None of the four regional incumbent boards (SEEK, JobStreet/JobsDB, Glints, Kalibrr, Wantedly) expose
  a public read API — confirmed directly against each (§1). Any provider's regional coverage is
  necessarily indirect (crawling, ATS integration, or a data partnership), never a first-party feed
  from the board itself.
- TheirStack's public documentation does not address persistent storage or matching/scoring use (§1) —
  not publicly determinable from the pages checked, unlike Techmap's explicit FAQ clause.
- Neither Techmap's nor TheirStack's regional posting counts were independently queried — Techmap's
  HK/SG/VN/AU numbers are the vendor's own published dashboard stats (§1), not a live API call I made;
  TheirStack's regional depth is not measured at all.

## 5. Decisions that need the product owner

- **Pick the provider strategy** (§1) — Techmap, TheirStack, or the zero-risk curated-pool fallback.
- **Set a real dollar cost ceiling** for provider calls at pilot volume and at 10x, per provider (§2.9)
  — §1 gives a real, cheap pay-as-you-go price for Techmap and a real tiered price for TheirStack; this
  contract requires cost to be *measured* per provider in production, not what the ceiling should be.
- **Decide who owns AdRequirements-generation for a live posting** (§3's gap) — fold into #63, or spin
  a new ticket ahead of it.
- **Before committing to TheirStack:** confirm in writing that storage + matching/scoring of retrieved
  postings is permitted — §1 flags this as not publicly determinable from TheirStack's public
  documentation today (Techmap's FAQ already states this explicitly, so this step is Techmap-optional).
- **Run one real, signed-up query** against Techmap's and/or TheirStack's actual API for Hong Kong,
  Singapore, Vietnam, and Australia IT-project-delivery roles before committing engineering time — §1's
  regional volumes are vendor-published, not independently observed.

---

## 6. Advert text: measured 2026-08-02 — full text confirmed

**The question this answers** (raised by #86's design pass, gating #88): does the provider return the
**full advert** or a truncated snippet? Neither `sample-postings.json` nor §2.1's `PostingV1` says —
both carry a single `excerpt` field. If it were a snippet, requirement-extraction quality would be
capped and no model choice would recover it.

**Reproducible, unlike the §1 probe.** Endpoint recorded this time:

```
GET https://daily-international-job-postings.p.rapidapi.com/api/v2/jobs/search
    ?countryCode=hk&page=0&size=3&title=project%20manager
    headers: x-rapidapi-key, x-rapidapi-host
```

Self-describes as **Techmap.io Job Posting API v2.6**. Note the path is **lowercase**;
`/api/v2/Jobs/Search` returns `"Endpoint does not exist"`. The BASIC plan rate-limits **per second**,
so burst probing returns 429s that look like hits — space calls ~2.5s apart.

### Finding 1 — the advert text is complete, and it is not where you would look

No top-level field carries advert text; the longest top-level string is `title`. The full advert is
in **`jsonLD.description`** (schema.org/JobPosting).

| | Posting 1 | Posting 2 | Posting 3 |
|---|---|---|---|
| `jsonLD.description` | 2,714 chars | 2,493 | 1,712 |
| Truncation marker | none | none | none |
| Ends mid-sentence | no | no | no |
| HTML markup | none — plain text | none | none |
| Responsibilities / Requirements / Qualifications present | yes | yes | yes |

Text arrives with section headings already marked (`**Responsibilities:**`, `**Requirements:**`), so
no HTML stripping is needed. `resultSizeInBytes` was 41,733 for 10 postings (~4.2 KB each).

**Consequence: #88 is unblocked and #86's design stands.** ~2,700 chars ≈ ~700 tokens, inside the
per-advert cost estimate. The fixtures' 2,200-char `excerpt` is representative of real advert length.

### Finding 2 — three structured fields we were about to pay a model to infer

`jsonLD` also carries `identifier`, `validThrough`, `employmentType`, `salaryCurrency`, `industry`,
`url`, `skills`, `hiringOrganization`, `jobLocation`, `datePosted`, `applicantLocationRequirements`.

- ~~**`applicantLocationRequirements`** — a work-eligibility signal, free and structured. Relevant to
  #86 decision 3 (blocking requirements) and #96.~~ ⚠️ **WRONG — corrected 2026-08-04 against the live
  API (#133).** This claim was made from a field *name*, never from a value. The measured values are
  **`"HKT Timezone"` / `"CST Timezone"`** — a working-hours overlap statement, not eligibility. It is
  also a **bare string, not an array**, and present on only ~6 of 10 postings. **Techmap supplies no
  work-eligibility field at all.** The field was **removed** from `ProviderPostingRecordV1` and
  `PostingV1` in #133 rather than kept empty: nothing read it, and its only intended consumer (the
  `providerWorkRightsSignal`/AC5 seam) had already been deleted in review on 2026-08-03 for a reason
  that still stands — a job's accepted-applicant locations cannot resolve into "can *this* visitor work
  in *their* city" without a visitor-location fact nothing collects. Work-eligibility continues to come
  from the **advert free text**, where `work-rights` is one of the five `EligibilityDimension` values
  the ad reader already extracts with a `sourceSpan` provenance pin. Owner decision 2026-08-04: keep
  expecting eligibility from the advert, and design a provider-supplied field **when a provider that
  actually offers one appears**, against its real data.
- **`validThrough`** — provider-stated expiry, which §2.6's freshness semantics can use directly.
  ⚠️ **Arrives in TWO formats on the same page** (measured 2026-08-04): `"2026-09-02"` (ISO) and
  `"16-09-2026"` (DD-MM-YYYY). Stored verbatim it broke §2.6 and `dedupePostings`' lexicographic
  ordering — a September expiry read as the year 16 and the posting was silently dropped. Canonicalised
  at ingest in #133; the dash form is read day-first unconditionally (the measured provider convention,
  never a per-value magnitude heuristic).
- **`skills`** — a structured list rather than prose. Present on 7 of 10 measured postings; legitimately
  absent on the rest, so absence is not a fault signal.
- ⚠️ **`size` is ignored entirely** (measured 2026-08-04, three calls on one query): `size=1`, `size=20`
  and `size=50` all returned `pageSize=10`, 10 items, `totalCount=58`. Not a floor — a fixed vendor page
  size of 10. **Ten postings is the unit of retrieval and of cost**, so the 1000/month allowance is
  100 calls' worth of fresh adverts. §2.9's per-provider budget and #132's spend cap must be sized
  against that number, not against a caller-chosen page size.

§2.1's `ProviderPostingRecordV1` should carry these rather than discarding them into `excerpt`.

### Finding 3 — title search relevance, re-confirmed accidentally

The three adverts a Hong Kong `"project manager"` search returned were a **dentistry faculty research
assistant**, a **pharmaceutical key account manager**, and a **retail banking manager**. Zero IT
delivery roles in the sample. This independently reproduces §1's Finding 2 and is the case #86
decision 1 (posting family fit) exists to handle.

Also noted: `totalCount` was **509** for this query against §1's measured ~34/day, so the two count
different things — §1's is a single day's new postings, this is cumulative. Don't compare them.

**Caveat:** three postings, one country, one query. Decisive for the question asked — the field
exists, is populated, is full-length and clean — but not a systematic sample of advert length across
markets.
