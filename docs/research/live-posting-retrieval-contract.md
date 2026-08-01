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

**Recommendation: start the pilot on Adzuna, with one unresolved legal step that must close before
launch — Adzuna's default API access is contractually a 14-day trial for any commercial organisation;
continued production use needs a written commercial agreement whose price Adzuna does not publish.**
Its free-tier limits (2,500 calls/month) are plenty for an invitation-only pilot's raw call volume, it
already provides the UK government's own job-search backend (`Find a job`, run by DWP since 2018 —
[Adzuna's announcement](https://www.adzuna.co.uk/blog/adzuna-renews-contract-to-run-uk-governments-find-a-job-service/)),
and its coverage of UK/EU IT-project-delivery roles is exactly the mix already visible in the
family-floor research pool. The blocker is not technical, it's a phone call: email Adzuna, confirm
what "written consent" for ongoing matching/aggregation costs, and get it in writing before the pilot
runs past day 14 of API use.

**Runner-up: JSearch (RapidAPI / OpenWeb Ninja).** Self-serve, published pricing, no sales process —
sign up with a card, pay by volume. It aggregates Google for Jobs (which itself re-indexes Indeed,
LinkedIn, Glassdoor), so it inherits scraping-chain legal risk one level removed rather than
eliminating it, and costs more per call than Adzuna's stated free ceiling. Pick this over Adzuna if
the 14-day-trial legal step can't close before the pilot needs to start.

**What would change the answer:** if the pilot needs continental-EU breadth (not just UK) from day
one, EURES is the natural target — 31-country coverage, free, government-run — but I could not verify
a self-serve public API registration path in the time available (see gap below); resolving that would
make EURES the front-runner for EU-wide coverage specifically. If legal can't get Adzuna's written
consent quickly, the honest zero-risk fallback is **no provider yet** — a manually curated, manually
re-verified posting pool, the same discipline #60 already used to source the four research postings,
just run continuously instead of once. It costs operator time, not API fees, and carries no vendor ToS
risk at all.

### Comparison

| Provider | Pilot-volume cost | 10x cost | Terms permit storage + matching? | Freshness/liveness signal | EU/UK IT-PM coverage | Rate limit | Exit cost |
|---|---|---|---|---|---|---|---|
| **Adzuna** | $0 up to 2,500 calls/mo, but only as a **14-day trial** for any commercial org — sustained use needs a written agreement, price unpublished | Unknown — must be quoted | Display + limited aggregation permitted with attribution; **"ongoing work or research" aggregation needs written consent** ([ToS](https://developer.adzuna.com/docs/terms_of_service)) | No explicit `live` flag; must infer from repeated presence in search results | Strong — UK/AU/DE/FR/etc, covers the PM/delivery family already researched | 25/min, 250/day, 1,000/wk, 2,500/mo by default | Must delete all stored Adzuna data + insertion codes on termination (contractual) |
| **Reed** | Unpublished; likely $0 but ToS bars "commercial exploitation... without permission" ([policies](https://www.reed.co.uk/policies)) | Unknown — must be quoted | Unclear for a matching product; needs direct written permission | Explicit `Expiration Date` field per listing — best freshness signal found | UK-only | Undocumented | Unclear — no published data-removal clause found |
| **Jooble** | Unpublished consumer-API pricing | Unknown | Unclear — only partner (job-poster) pricing is public, not reader-API terms | `updated` timestamp per posting, no freshness guarantee stated | Broad international, unverified EU/UK depth | Undocumented | Unclear |
| **JSearch (RapidAPI)** | Free tier ~200 req/mo, paid plans scale from low tens to low hundreds $/mo (RapidAPI marketplace pricing, ~30% over the underlying OpenWeb Ninja price) | Same tiering, higher bracket — a real, quotable number | Standard commercial marketplace terms, no sales process; **inherits Indeed/LinkedIn/Glassdoor scraping-chain risk one step removed** | Aggregates from Google for Jobs; no first-party liveness guarantee | Broad — reflects whatever Google for Jobs indexes | Marketplace-tier-defined | Cancel subscription; no contractual removal clause found |
| **Greenhouse/Lever Job Board APIs** | $0, public, unauthenticated | $0 | Explicitly intended for public consumption of a named employer's own postings | Best possible — it's the employer's own live board | Poor breadth without hand-picking employer boards; strongest per-posting truth once picked | Undocumented soft throttle | None — public endpoint |
| **EURES** | Unverified — no self-serve public API registration path found | Unverified | Unverified — government open-data portal, likely permissive, but unconfirmed | Verified vacancies (national employment services), strong in principle | Best possible on paper — 31 countries, ~2M postings | Unverified | Unverified |
| **Arbeitnow** | $0, no auth | $0 | No explicit ToS clause found covering a matching product — thin terms, same risk class as Reed/Jooble | Posting date only, no expiry field | Skews German/remote-tech; weak general EU/UK breadth | Generous, undocumented | None — public endpoint |
| **No provider — curated manual pool** | $0 cash; recurring operator time to source + re-verify | Scales linearly with operator time, not $ | No third-party ToS risk at all | As good as the last manual check — no automation | Whatever the operator curates | N/A | None |

**Provider whose terms would actually prohibit what JobCrush does, named plainly: none is an outright
ban, but Adzuna is the one where the written text is closest to one.** Its ToS says data "may not be
used in its original format or in aggregation... to deliver any ongoing work or research... without
written consent," and separately caps any commercial/government/academic use at a 14-day trial absent
a signed agreement. A product that persists postings and scores them against a user's evidence on an
ongoing basis is squarely inside "ongoing work." Treat this as a hard go/no-go gate before launch, not
paperwork to tidy up after.

Sources: [Adzuna Terms of Service](https://developer.adzuna.com/docs/terms_of_service),
[Adzuna overview](https://developer.adzuna.com/overview),
[Adzuna × DWP "Find a job"](https://www.adzuna.co.uk/blog/adzuna-renews-contract-to-run-uk-governments-find-a-job-service/),
[Reed for Developers](https://www.reed.co.uk/developers/Jobseeker),
[Reed policies](https://www.reed.co.uk/policies),
[Jooble REST API docs](https://help.jooble.org/en/support/solutions/articles/60001448238-rest-api-documentation),
[JSearch on OpenWeb Ninja](https://www.openwebninja.com/api/jsearch),
[JSearch cost breakdown](https://jobspipe.dev/blog/jsearch-api-direct),
[Greenhouse API overview](https://support.greenhouse.io/hc/en-us/articles/10568627186203-Greenhouse-API-overview),
[EURES portal](https://eures.europa.eu/index_en),
[Arbeitnow API](https://www.arbeitnow.com/blog/job-board-api),
[Indeed Publisher Program status (closed since 2022, XML feeds retiring through 2026)](https://www.jobboardly.com/blog/indeed-affiliate-program),
[LinkedIn API Terms of Use — no public read API, scraping contractually prohibited](https://www.linkedin.com/legal/l/api-terms-of-use).

**Indeed and LinkedIn are not in the table because they're not options for this pilot.** Indeed's
Publisher API and XML feed are both retired (closed to new publishers since 2022, feeds sunsetting
through 2026); any access now requires a multi-month partner sales process. LinkedIn has no self-serve
read API for job search at all, and its ToS contractually prohibits scraping regardless of the
technical feasibility (LinkedIn has won breach-of-contract suits over exactly this). Neither belongs on
a "realistically available for an invitation-only pilot" shortlist.

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
  use at all — silence, not permission. Both need a direct written confirmation before use, same as
  Adzuna's stronger explicit clause.

## 5. Decisions that need the product owner

- **Pick the provider strategy** (§1) — Adzuna (pending its written-consent step), JSearch, or the
  zero-risk curated-pool fallback while a provider relationship is arranged.
- **Set a real dollar cost ceiling** for provider calls at pilot volume and at 10x (§2.6) — this
  contract requires cost to be *measured*, not what the ceiling should be.
- **Decide who owns AdRequirements-generation for a live posting** (§3's gap) — fold into #63, or spin
  a new ticket ahead of it.
- **If Adzuna is chosen:** authorize contacting Adzuna for written commercial-use consent before the
  pilot runs past its 14-day trial window — this is a business step, not an engineering one, and it's
  on the pilot's critical path.
