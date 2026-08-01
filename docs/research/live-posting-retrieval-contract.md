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

Everything below is written to be implementable against **any** provider from §1, or against none
(the curated-pool / provider-unavailable path). #63 must not invent policy beyond this.

### 2.1 Posting identity + display fields

```
PostingV1 {
  schemaVersion: "1"
  id: string            // "<providerId>:<providerPostingId>", e.g. "adzuna:123456789"
  providerId: string     // "adzuna" | "curated-pool" | ... — never blank
  title: string
  company: string
  location: string
  sourceUrl: string       // resolves to the original listing — parent spec story #52 requires this
  excerpt: string         // maps 1:1 onto JobCardV1.adExcerpt (packages/contracts/src/jobCard.ts)
  postedAt: string | null // provider-claimed post date, ISO 8601
  capturedAt: string      // when JobCrush first retrieved this posting, ISO 8601
  verifiedLiveAt: string  // last time liveness was positively re-confirmed, ISO 8601
  expiresAt: string | null // provider-stated expiry, if any
  attribution: { label: string; url: string } | null // required when the provider's ToS demands it (Adzuna does)
}
```

Fields are chosen to map directly onto the existing `JobCardV1` contract
(`title→title`, `company→company`, `location→place`, `excerpt→adExcerpt`) so #63 does not need a
second posting shape — it consumes `PostingV1` and produces `JobCardV1` the same way it already
consumes fixture `Posting` + `AdRequirements` today. **`id` deliberately never reuses the fixture id
scheme** (`sample-postings.json`'s `<date>_<company-slug>_<title-slug>`) — a provider-prefixed id keeps
production and fixture postings visually distinguishable at every call site, defense against a future
route accidentally mixing the two pools.

### 2.2 Retrieval inputs — server-owned, explicitly enumerated

Read from the session record (`SessionRecord`, `apps/api/src/sessions.ts`), never from the request
body:

| Input | Source | Required |
|---|---|---|
| Target role | `session.intent.targetRole` | yes, non-null |
| Search area | `session.intent.searchArea` | yes, non-null |
| Confirmed published job family version | `session.discovery.floor` (must resolve via `ProductionFamilyFloorStore.get()` to a publication with `publicationStatus === "published"` — the same `eligibleProductionPublication` check `onboarding.ts` already applies) | yes |
| Essential floor covered | `session.discovery.checkpoint === "essential_floor_covered"` | yes |
| Source-supported evidence | Derived server-side from `claims.confirmed(sessionId)` — reduced to search keywords/requirement labels, never raw free text (privacy, §2.5) | used to build the provider query, not sent verbatim |
| Explicit negatives | `claims.negatives(sessionId)` | used as a server-side post-filter/suppressor, never a positive signal |

**Forbidden inputs, explicitly:**
- **System inference** — any claim with `decision !== "confirmed"` (pending/mined-but-unreviewed) must never reach the query or the relevance filter.
- **Client assertions** — a request body cannot set `targetRole`, `searchArea`, or the family reference; the route reads only session state. (Same idiom as every other onboarding route — `requireSession`/`requireUser`, no client-supplied identity fields.)
- **The family-research postings pool** (`sample-postings.json`) — must never be joined into a production retrieval result. It stays fixture-only, gated the same way `TestFixtureFamilyFloorStore` is isolated from `ProductionFamilyFloorStore` today (`apps/api/src/familyFloors.ts`) — mirror that split with a `TestFixturePostingProvider` that structurally cannot satisfy a production check.

If any required input is absent (no role/area, family not published, floor not covered), the outcome
is `invalid_request` (§2.4) — never a silent empty result.

### 2.3 Live/freshness semantics — fail closed

- A posting counts toward the reveal only if `verifiedLiveAt` is within a **24-hour TTL** (small pilot
  volume makes a short window affordable) **and** (`expiresAt` is null or in the future).
- If the provider cannot be freshness-checked (timeout, rate-limited, 5xx), the posting is **not**
  counted live. It is not silently dropped either — it becomes `stale_data` (§2.4), distinct from a
  genuine empty pool.
- Revalidation is a background refresh (mirrors `purge.ts`'s existing job shape), not a synchronous
  network round-trip inside `/onboarding/cards` on every request. The synchronous route reads the last
  refreshed snapshot; only the background job talks to the provider. This bounds latency and respects
  rate limits (§2.6) by construction — one shared refresh serves every session searching the same
  family/area, rather than one provider call per page load.
- Every freshness check is logged with a timestamp for audit (pilot observability requirement,
  parent-spec story #72).

### 2.4 Four outcomes — never collapsed

```
PostingRetrievalResultV1 = discriminated union on "outcome":

| { outcome: "relevant_postings", postings: PostingV1[] (non-empty), retrievedAt, providerId }
| { outcome: "empty_pool", retrievedAt, providerId }                // genuinely queried, zero live matches
| { outcome: "provider_unavailable", reason: string, retryable: boolean } // provider errored/timed out/rate-limited
| { outcome: "stale_data", lastKnownFreshAt: string, retrievedAt: string } // cached postings exist, TTL exceeded, live re-check failed
| { outcome: "invalid_request", code: string }                      // a required input (§2.2) is missing
```

`empty_pool` and `provider_unavailable` must never be presented identically to #63 — the parent spec
(story #46) requires "broaden your search" for a genuine empty pool and a different, honest message
for "we couldn't check right now." Collapsing these into one client-facing "no jobs" state is the exact
dishonesty this ticket exists to prevent.

### 2.5 Persistence + intent-change invalidation

Add a `retrieval: RetrievalSnapshot | null` field to `SessionRecord`, following the same idiom as the
existing `discovery: ProductionDiscoveryState` field — a parsed-or-safely-reset JSON column
(`discoveryState()`'s pattern in `sessions.ts`), with a `reconcileRetrievalState`-style store method on
both `InMemorySessionStore` and `PgSessionStore`.

- Session-scoped, not a shared cross-session cache. At pilot volume this is the smallest correct
  boundary; a shared posting cache is a real future optimization (avoid re-querying the provider per
  overlapping search) but is out of scope here — flagged in §4 rather than invented now.
- **Invalidation on intent change:** any call to `sessions.setIntent()` that actually changes
  `targetRole` or `searchArea` must clear `session.retrieval` (forcing a fresh retrieval on next read).
  It must **not** touch `claims` (confirmed/negative evidence), `session.discovery` (floor pin,
  coverage checkpoint), or anything else — exactly AC6's "invalidates retrieval-dependent state only."
- Family placement (`session.discovery.floor`) is pinned once via `reconcileDiscoveryState`'s existing
  guard and does not change on intent edits at this layer; if a role edit is large enough to warrant
  re-placement, that is a discovery-layer decision (#58/#61's territory), not this contract's.

### 2.6 Privacy, rate-limit, retry, cost — stated rules

- **Privacy:** never send raw CV text or full claim text to a third-party provider. Reduce confirmed
  evidence to the minimal structured query (role keywords, location) before it leaves the server — the
  same privacy-minimization discipline #62 already applies to family-research candidates.
- **Rate limit:** the server enforces an internal budget strictly below the provider's documented
  ceiling (e.g., Adzuna's 25/min · 250/day · 2,500/month), on the same fixed-window idiom as
  `IpRateLimiter` (`sessions.ts`). Exceeding the internal budget is `provider_unavailable`
  (`retryable: true`), never a silent skip of the freshness check.
- **Retry:** bounded (1–2 attempts, backoff), idempotent — consistent with the parent spec's
  "background jobs must be idempotent and resume from the last successful checkpoint" rule.
- **Cost:** every provider call increments an observable counter (pilot observability, story #72). The
  actual dollar ceiling per pilot is an **owner decision** (§5) — this contract only requires that cost
  be measured, not that a number be picked here.

### 2.7 Seams + testing

- **New injectable seam**, mirroring `placeFamily`'s exact pattern in `apps/api/src/server.ts`
  (`opts.placeFamily ?? (async () => ({ outcome: "unmapped" }))`):
  `retrievePostings?: (input: RetrievalRequest) => Promise<PostingRetrievalResultV1>` on
  `BuildOptions`/`OnboardingDeps`. **The default fallback must fail closed to `provider_unavailable`**
  — never fabricate postings and never fall back to `sample-postings.json`, which is out of scope as a
  production feed by this ticket's own terms.
- **Deterministic fake driver** for HTTP integration tests: a `TestFixturePostingProvider`, named and
  shaped like `TestFixtureFamilyFloorStore` — returns pinned canned results per test case and is
  structurally incapable of satisfying a production check (same non-production guard pattern).
- **Both session-store drivers:** extend the existing pg-mem dual-driver pattern
  (`apps/api/test/pgstores.test.ts`, `sessions.test.ts`) with cases for the new `retrieval` column —
  same `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS retrieval jsonb` idiom as `production_discovery`,
  same parse-or-reset-to-safe-default parser guarding against malformed/forged JSON.
- **Real-provider staging smoke test:** one small `.mjs` script gated behind an env var (mirrors
  `apps/web/e2e/r2-cors-preflight.mjs`'s one-shot pattern), hitting the actual chosen provider with one
  known-good query and asserting a 200 + at least one parseable posting. Run manually against staging
  after any provider-integration change; never inside the default `pnpm test` gate.
- **Gap, stated explicitly (per the brief's instruction not to invent a seam that doesn't exist):**
  there is currently **no posting-cache/store seam of any kind** in this codebase — `loadPostings()` is
  a pure fixture read with no store behind it. Everything in §2.5–2.7 describing a `retrieval` session
  field and a `retrievePostings` dependency is new construction, not a reuse of an existing seam.

### 2.8 Contract versioning

Add `PostingV1` and `PostingRetrievalResultV1` as new zod schemas under `packages/contracts/src/`
(e.g. `postingRetrieval.ts`), with a matching `.mjs` oracle validator under `packages/contracts/oracle/`
— same discipline as `JobCardV1`/`FamilyFloorV1`/`FamilyPlacement` (`schemaVersion` literal, `.strict()`
objects, golden-tested against the oracle). The oracle remains authoritative on any future disagreement
between the port and the validator, per this repo's standing rule.

---

## 3. What #63 needs changed

#63 is currently blocked with "no files changed" and the note that `/onboarding/cards` loads static
fixtures with no live-status concept. Draft clarification text for the orchestrator to post on #63
(not posted by this session — git/issue edits are the orchestrator's):

> **Repaired scope, consuming #85's contract:**
> `/onboarding/cards` must stop reading `loadPostings()`/`sample-postings.json` for the production
> path. It now calls the injected `retrievePostings` seam (§2.7 of
> `docs/research/live-posting-retrieval-contract.md`) with the server-owned inputs from §2.2, and
> branches on the four `PostingRetrievalResultV1` outcomes (§2.4):
> - `relevant_postings` → build `JobCardV1`s from the returned `PostingV1[]` (§2.1's field mapping) and
>   proceed to "N jobs just matched you" (AC1).
> - `empty_pool` → the honest broaden-or-notify path (parent spec story #46), never a bare zero-job
>   reveal.
> - `provider_unavailable` / `stale_data` → a distinct honest waiting/error state, not folded into
>   `empty_pool` (AC3).
> - `invalid_request` → the existing 409 pattern this route family already uses.
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

- No posting-cache/store seam exists today (§2.7). This ticket specifies its shape; nothing like it is
  being reused.
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
- **Set a real dollar cost ceiling** for provider calls at pilot volume and at 10x (§2.6) — §1 gives a
  real, cheap pay-as-you-go price for Techmap and a real tiered price for TheirStack; this contract
  requires cost to be *measured* in production, not what the ceiling should be.
- **Decide who owns AdRequirements-generation for a live posting** (§3's gap) — fold into #63, or spin
  a new ticket ahead of it.
- **Before committing to TheirStack:** confirm in writing that storage + matching/scoring of retrieved
  postings is permitted — §1 flags this as not publicly determinable from TheirStack's public
  documentation today (Techmap's FAQ already states this explicitly, so this step is Techmap-optional).
- **Run one real, signed-up query** against Techmap's and/or TheirStack's actual API for Hong Kong,
  Singapore, Vietnam, and Australia IT-project-delivery roles before committing engineering time — §1's
  regional volumes are vendor-published, not independently observed.
