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

_Revised 2026-08-01 after owner rejection of the first draft. Adzuna is now excluded — its self-serve
access is contractually a 14-day trial for any commercial org with an unpublished price beyond that,
which fails the owner's explicit "no trial" instruction. Reed, Jooble, EURES, Arbeitnow, and
Greenhouse/Lever are dropped from the primary comparison, not because they're bad, but because none of
them clears the bar of "a real number and a real answer on terms today" — each is noted with its
one-line disqualifying reason at the end of this section instead of padding a table with "unknown."_

Three options below are each usable **today, without a sales call**, each with a **published, budgetable
monthly price**, and each answered concretely on where its inventory comes from and whether LinkedIn-
and Indeed-posted jobs are in it.

### The three options, real numbers first

| | **JSearch** (RapidAPI / OpenWeb Ninja) | **SerpApi — Google Jobs API** | **Curated manual pool** (no vendor) |
|---|---|---|---|
| **Monthly cost @ pilot volume** (~200–1,000 lookups/mo, an invitation-only handful of users) | **$0–$25/mo** — free tier is 200 req/mo (hard cap, not time-limited); Pro tier is $25/mo for 10,000 req/mo | **$0–$25/mo** — free tier is 250 searches/mo (usage-based, not time-limited); Starter tier is $25/mo for 1,000 searches/mo | **$0 cash.** Est. 3–5 operator-hours/week to source and re-verify ~15–20 live postings (same discipline #60 used for the four research postings, run continuously) |
| **Monthly cost @ 10x** (~2,000–10,000 lookups/mo) | **$25–$75/mo** — Pro (10k) or Ultra ($75/mo, 50k req/mo) | **$75–$150/mo** — Developer ($75/mo, 5,000 searches) or Production ($150/mo, 15,000 searches) | Scales with operator hours, not cash — roughly linear, no vendor ceiling |
| **Available today, no sales call?** | Yes — card-on-file RapidAPI signup | Yes — card-on-file SerpApi signup | Yes — no vendor at all |
| **Where the inventory comes from** | "LinkedIn, Indeed, Glassdoor, ZipRecruiter, and All Public Job Sites via Google for Jobs," per the provider's own page ([openwebninja.com/api/jsearch](https://www.openwebninja.com/api/jsearch)) — an aggregator of aggregators; no direct ATS/employer feeds | Google's own "Jobs" search feature, which ingests employer/board-submitted `schema.org/JobPosting` markup; each result carries a `via` field naming its source site | Operator-sourced directly from employer/board postings, one at a time, same method as the existing research pool |
| **LinkedIn jobs present?** | **Yes** — named explicitly by the provider | **Yes** — SerpApi's own docs show `"via": "LinkedIn"` as an observed source value | **Yes/no by operator choice** — whatever the operator includes |
| **Indeed jobs present?** | **Yes** — named explicitly by the provider | **Yes** — SerpApi's own docs list Indeed among `apply_options` sources | **Yes/no by operator choice** |
| **Persistent storage + scoring permitted?** | **Not publicly determinable** — no ToS clause on storage/matching found on OpenWeb Ninja's site in the time available | **Not publicly determinable** — no ToS clause on storage/matching found; see [serpapi.com/legal](https://serpapi.com/legal) before commit | Yes, unambiguously — no third-party terms apply |
| **Observed live UK/EU IT-project-delivery count** | **Not measured** — requires a paid API key I don't have access to provision in this environment | **Not measured** — same reason | **Not measured** — no pool exists yet; would be as good as the last manual check |

Sources: [JSearch on OpenWeb Ninja](https://www.openwebninja.com/api/jsearch) (pricing table + named
sources), [SerpApi pricing](https://serpapi.com/pricing), [SerpApi Google Jobs API](https://serpapi.com/google-jobs-api)
(`via`/`apply_options` source fields), [SerpApi legal](https://serpapi.com/legal).

**One real, observed data point for calibration (not one of the three options above):** I queried
Arbeitnow's free, no-auth job board API live (`arbeitnow.com/api/job-board-api`) — a generalist
EU/remote board, not shortlisted here — and found **0 postings matching IT-project-delivery titles**
("project manager", "programme manager", "delivery manager", "IT project") in the ~275 most recent
live postings scanned across its first pages. That's real evidence that a small generalist free board
has too little depth for this specific role class; it's why the shortlist favours aggregators that
pull from Indeed/LinkedIn at real scale over another free-tier generalist board, even though I
couldn't get an authenticated count from JSearch or SerpApi to compare directly.

### Recommendation

**JSearch, with SerpApi as the closest substitutable alternative — same $0/$25/$75/$150 price ladder,
same explicit LinkedIn+Indeed coverage, purpose-built job-search filters (date posted, employment
type, remote) that a general SERP scraper doesn't offer as cleanly.** Both meet the owner's "no trial,
real published price, available today" bar; JSearch is the pick because it's a job-search product
first, not a general search-engine wrapper repurposed for jobs. Start on JSearch's free/Pro tier;
SerpApi is the fallback if JSearch's per-source attribution or coverage proves thinner in practice.
**The curated manual pool is not a placeholder to discard — it's the only option with zero legal
uncertainty**, and is the right choice if the storage/matching ToS gap below doesn't resolve cleanly
for either vendor.

**What I could not determine, stated plainly:**
- Whether JSearch's or SerpApi's terms permit persistent storage and matching/scoring of postings
  against user evidence — the specific ongoing use this product needs — is not addressed in either
  provider's public documentation found in the time available. This must be confirmed (an email or a
  careful read of [serpapi.com/legal](https://serpapi.com/legal) and OpenWeb Ninja's terms) before
  either is wired into production, even though neither requires a sales call to start.
- Real live-posting counts for UK/EU IT-project-delivery roles on JSearch or SerpApi specifically —
  both require a funded API key to query, which I could not provision in this environment. This should
  be the first thing done with a trial-free-tier key before committing further engineering time.

**Providers dropped from the primary comparison, one line each:** Adzuna — excluded per the owner's
no-trial instruction (self-serve access is contractually a 14-day trial; sustained use needs an
unpublished, quoted commercial price). Reed/Jooble — no published API pricing or commercial-use terms
found for the reader API specifically. EURES — no verifiable self-serve public API registration path
found. Greenhouse/Lever — free and public, but only cover employers already on that ATS, so they answer
a different question (per-employer truth) than "search a market for open roles." Arbeitnow — free,
real, queried live above, but too shallow for this specific role class and carries the same thin,
unaddressed ToS as Reed/Jooble on matching/storage use.

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
- EURES's self-serve public API registration flow could not be verified from public documentation in
  the time available — third-party scraper wrappers exist (implying either an undocumented registration
  process or that EURES's public API is intended for *inbound* feeds from national employment services,
  not outbound queries). Needs a direct inquiry to the European Commission's EURES team before it can
  be treated as pilot-ready.
- Reed's and Jooble's terms of business do not, in their public documentation, address matching/scoring
  use at all — silence, not permission. Both need a direct written confirmation before use.
- Neither JSearch's nor SerpApi's public documentation addresses persistent storage or matching/scoring
  use either (§1) — this is not publicly determinable from either provider's site and must be confirmed
  directly before either is wired into production.

## 5. Decisions that need the product owner

- **Pick the provider strategy** (§1) — JSearch, SerpApi, or the zero-risk curated-pool fallback.
- **Set a real dollar cost ceiling** for provider calls at pilot volume and at 10x (§2.6) — §1 gives
  real published price ladders for JSearch and SerpApi; this contract requires cost to be *measured*
  in production, not what the ceiling should be.
- **Decide who owns AdRequirements-generation for a live posting** (§3's gap) — fold into #63, or spin
  a new ticket ahead of it.
- **Before committing to JSearch or SerpApi:** confirm in writing (email or a direct ToS read) that
  storage + matching/scoring of retrieved postings is permitted — §1 flags this as not publicly
  determinable from either provider's public documentation today.
