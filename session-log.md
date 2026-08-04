# Session log — jobcrush-app

Newest first. One entry per working session. Ticket + commit refs so the plan stays honest.

## 2026-08-04 (session 71) — `/orchestrate-team #114`: the broken fixture we paid to re-read, and the advert we re-read forever

_Ran concurrently with sessions 69 (#99) and 70 (#123). Its commit landed **first** of the three —
`6c0a515`, a clean fast-forward onto `main` while both others were still building — which is why they
each reference #114 landing mid-gate. Logged last, hence the higher session number; the docs update was
deliberately deferred until the other two shipped, rather than racing three sessions into the same
newest-first file at 3am._

- **[#114](https://github.com/adrien-mounier/jobcrush-app/issues/114) shipped in `6c0a515`, closed.**
  Both defects #104's QA pass filed, neither of which was ever wrong on screen — they were wrong on the
  bill, and both stop being free the moment #99–#101 puts a real feed behind them.
- **A corrupt curated fixture no longer buys a paid re-read.** `resolveAdRequirements` caught "malformed"
  and "missing" from one `try`/`catch` and fell through to the model for both, so we paid to re-derive
  what someone had already written by hand. The fixture set now parses **once** into a shared index
  answering found/missing/invalid: invalid counts `postings.fixture_invalid`, logs its adId and reason
  (bounded to 500 chars, per #115 finding 3), drops that one card, and makes **no model call**. Missing
  falls through to the reader exactly as before. `postings.fixture_invalid` has a real production caller
  again — it had none, so the counter #104 added for this hazard could never move.
- **A permanently-unreadable advert no longer re-pays every request.** `makeAdReader` keeps a bounded
  negative cache with escalating backoff (2 min doubling, capped 60 min), covering **only** the
  `readAdvert` throw path — the one that actually costs up to two calls. A store outage, a `store.put`
  failure after a good read, and the free language-skip null are each excluded on their own terms, with
  the reason recorded at each site. Suppression never re-counts `postings.read_failed`, so the
  read-failure alarm can't be pinned by events that cost nothing. Measured: a permanently broken advert
  polled every 30s for a day costs **56 model calls instead of 5,762**.
- 🔑 **The ticket's own safety AC named a mechanism that does not exist, and review caught it.** AC4
  asked that a prompt/contract version bump retry a previously-failing advert. The suppression entry
  carries that version and the comparison is correct — and it can never fire: `adReaderVersion()` is a
  memoised file hash plus a hand-bumped constant, so it cannot change inside a running process, and the
  redeploy that changes it restarts the process and empties this in-memory cache anyway. The developer
  had reported AC4 "met at the unit level" and the unit test does pass — against a branch production
  cannot reach. **The operative guarantee is the 60-minute cap**, and QA verified that independently
  rather than accepting the claim: real `makeAdReader` driven over a 30-day simulated clock, backoff
  recomputed from scratch for n=1..2000, **worst invisibility-after-fix 15 minutes even after a 20-day
  continuous outage**, no constructible path over the hour. Field kept as defense-in-depth for a future
  hot-reloadable prompt, documented as unreachable today. Generalised in `lessons.md`.
- 🚨 **The index rewrite introduced a silent regression that review caught before it shipped.** Replacing
  a `find()` lookup with a `Map` flipped duplicate-adId precedence from **first-wins to last-wins**, so a
  copy-pasted *broken* duplicate would have shadowed a good earlier entry and deleted a resolvable card —
  #86's named worst failure. Latent only because the file holds ten unique ids. Now explicit: a valid
  entry beats an invalid one whatever the order; among same-validity duplicates the first wins.
- **`parseAdRequirementsList` deleted, not left test-only.** Both review axes independently flagged it:
  production-dead, yet still a *second* implementation incrementing the same counter — the exact "two
  independent counting paths" hazard this ticket was raised about. AC2 explicitly offered removal. Its
  one surviving proof (a broken entry must not take the list down, #102 carry-forward) moved onto the
  index seam so it tests the code production actually runs.
- **Proven at spec #86's pinned API boundary** (new `apps/api/test/adReadPolicy.test.ts`, LLM double
  injected — no new seam), plus a **live process on port 3114**: one real fixture corrupted gave HTTP 200,
  **14 cards not 15** (exactly one missing), zero model calls for that advert, `postings.fixture_invalid`
  0 → 1 on `/ops/counters`; and with an invalid model key, request 1 took 968ms for 7 genuine failures
  while request 2 took **2.8ms** with `adReader.read_suppressed` = 7 and `read_failed` correctly still 7.
  Old vs new fixture logic byte-identical across all 17 postings; clean deck still 15 cards. Gate 808 api
  green uncached, QA **GO**.
- ⚠️ **Known limits, recorded in code.** An invalid fixture is never retried within a process's life — a
  redeploy with a corrected file is the only fix, which is correct for repo-baked data (a retry would
  re-read identical bytes) but needs revisiting if fixtures ever wrap live postings at #99–#101. And a
  suppressed read settles instantly through `resolveAdRequirements`'s deadline, so it counts
  `postings.read_in_time` and mildly dilutes the read-timeout alarm's denominator with free no-ops —
  documented to the same standard as the read-failure damping, mechanism deliberately unchanged.
- **FYI, pre-existing and not this ticket's:** QA noted `/ops/counters` is **ungated** (`OPS_KEY` gates
  `/ops/read-failures` and `/ops/spend`, not this one). Harmless today — it serves integers only — but it
  contradicts the assumption in #115's roadmap note. Also unchanged from #104: a read that *hangs* is
  never suppressed, since the route's 15s timeout doesn't feed the negative cache; cost there stays
  bounded by the pre-existing in-flight dedupe.
- **Process note:** built in an isolated worktree with a one-fix-round review (nine findings across both
  axes, seven must-fix) and no rework after QA. Branch point `51debbb` was still `origin/main` at landing
  time, so this went in as a fast-forward with no rebase.

## 2026-08-04 (session 70) — `/orchestrate-team #123`: the question that arms withdrawal, and tells you what it cost

_Ran concurrently with session 69 (#99) below; rebased onto it. The two touched
`apps/api/src/routes/onboarding.ts` and auto-merged cleanly — no shared logic._

- **[#123](https://github.com/adrien-mounier/jobcrush-app/issues/123) shipped, closed.** Discovery now
  asks **once**, as a multi-select, which languages the visitor works in professionally. Ticking stores
  `professional`; **leaving one unticked stores an explicit `none`**, which is what #107's engine has
  always needed and never had. Every language on the list is rewritten on **every** answer (never
  deltas) — that full-set write is precisely what makes a correction restore the jobs it removed. The
  old single-value English question (`ELIGIBILITY_LANGUAGE`) is **superseded and gone**, not kept
  alongside. Gate 817 api green; QA GO on a live browser drive, 29 journey + 19 probe assertions.
- 🔑 **The corpus could not ground the list, and saying so was the whole first hour.**
  `docs/research/languages-from-the-corpus.md` re-derives language demand the way #106 derived
  dimensions: of **17 real adverts, exactly 2 name a language and both name English**. Zero name
  Mandarin, Cantonese, Vietnamese or anything else — verified three ways. So a strictly-measured list
  is `{English}`, and the ticket's own driving scenario (Mandarin-mandatory jobs disappearing) **cannot
  fire from it**. Owner decision 2026-08-04: extend to **English, Mandarin, Cantonese, Vietnamese**,
  grounded in the corpus's *measured market mix* (HK 9, AU 4, VN 2, CN 1) rather than advert-stated
  demand. The doc records that distinction explicitly and does **not** dress the three additions up as
  corpus-derived.
- 🔑 **Owner requirement mid-build: the list must survive new markets.** So it is not a constant but
  **market-keyed data** (`apps/api/data/languages-by-market.json`), asked as the deduped union in a
  stable order, zod-validated at load with the offending market named. Opening Laos is one JSON entry —
  no code, no schema, no migration. And **growing the list is safe for anyone who already answered**:
  they simply hold no fact for the new language, which reads unknown, and an unknown never withdraws.
  Shaped market-first so **[#124](https://github.com/adrien-mounier/jobcrush-app/issues/124)** narrows
  the question to a visitor's own markets as a *lookup*, not a redesign.
- 🚨 **QA's NO-GO: the engine was right and the visitor was never told.** The languages question is
  **always the last question**, so confirming it always triggers the deck handoff — which replaces the
  notice slot the designer's lock-in line and "Fix that?" undo lived in. Both were unreachable in
  **every** run (not just after reload, which is #120). A visitor ticked English, tapped confirm, and
  jumped straight to "14 jobs just matched you", never told a job had been removed. Fixed by reporting
  `withdrawn: { total, byLanguage }` on the cards response and rendering one quiet line **below** the
  reveal's CTA — *"4 more needed Mandarin and Cantonese — I left them out."* Verified against reality,
  not against itself: 15 → 11 on screen, server said 4, split 3/1.
- ⚠️ **The undo did NOT ship, deliberately.** "Fix my languages" needs the app to reopen an
  already-answered question with its prior ticks — capability that does not exist and is the substance
  of **[#120](https://github.com/adrien-mounier/jobcrush-app/issues/120)**. Frontend flagged it rather
  than wiring a dead link. QA ruled GO anyway, argued: *silence* was #86's named failure and silence is
  gone; this is a **recovery** gap, not a **deception** gap. **A mis-tick is still permanent for the
  session — #120 is the next thing.**
- 🐛 **A shipped runtime config file was invisible to git.** `apps/api/data/*` is covered by a
  repo-wide `data/` rule; every test passed locally and the deploy would have 500'd on ENOENT. Fixed as
  a real whitelist, not a `git add -f`. The first fix was itself wrong — caught by review — see
  `lessons.md`.
- ⚠️ **The `conversational` tier is retired and it is a real trade.** A binary tick-list cannot express
  "some, but not for work", so a visitor with conversational Mandarin who honestly doesn't tick it
  loses Mandarin-mandatory jobs. Recorded, not silent; mitigated by *"Not sure? Tick it."* — ticking can
  only ever keep a job. `withdrawal.ts` still honours a stored `conversational` so pre-#123 values
  never withdraw.
- **Follow-up filed: [#125](https://github.com/adrien-mounier/jobcrush-app/issues/125)** — owner decision
  2026-08-04: a language a visitor *volunteers* (French, for the French companies across APAC) must
  reach their **CV**, which means shaping a deliberate door in the #106 eligibility/claims wall. Shape
  before building; the wall exists because connecting them produced false claims about the visitor.
## 2026-08-04 (session 69) — `/orchestrate-team #99`: the retrieval contract finally exists in code

- **[#99](https://github.com/adrien-mounier/jobcrush-app/issues/99) shipped in `7086ec5`, closed.**
  The first of the three slices closing the gap #85 left open (contract decided, implementation never
  filed). Pure slice — four shapes in both the `.mjs` oracle and the zod port, a provider registry as
  data, and `dedupePostings`. No routes, no network, no store; that is #100/#101. Gates green on the
  combined tree (865 tests: 39 contracts, 826 api), CI green, deployed.
- 🔑 **A posting's identity is now derived from its content, and both validators check the derivation.**
  `PostingV1.id` is `posting:<canonicalKey>` where `canonicalKey` is verified to genuinely be the
  sha256 of the normalized `company|location|title` — not merely typed as a string, which is how the
  shipped fixture initially passed both validators with a key that was *not* its own hash. Identity
  therefore survives a provider dropping out or a second provider picking the same job up.
- 🚨 **The port and the oracle had already drifted, and the golden tests were not looking.** Only the
  result union was compared; `ProviderPostingRecordV1` and `PostingProviderPolicyV1` were exported and
  never run against their ports — so `authorityRank: Infinity` was accepted by zod and rejected by the
  oracle. Per the repo rule the port was wrong (`z.number()` admits `Infinity`, `_lib.mjs`'s `isNumber`
  does not). **The lesson is the coverage gap, not the missing `.finite()`**: a shape that is ported
  but not golden-tested is not actually governed by the oracle. All four are compared now.
- 🐛 **Two different jobs could merge through an unescaped delimiter.** `normalize` stripped `,.()` but
  not `|` — the character joining the three key fields — so `{company:"HSBC|Hong Kong",
  location:"Singapore"}` and `{company:"HSBC", location:"Hong Kong|Singapore"}` produced the same key
  and one posting. Found by QA's dedup attack, not by any test we wrote. `|` is now stripped in both
  implementations. Distinct from the *accepted* limitation below: this one was a forgeable boundary,
  which is a whole class deleted rather than a tradeoff.
- 🐛 **The "deterministic" tie-break silently never ran.** Unregistered providers get rank `+Infinity`,
  and `Infinity - Infinity` is `NaN`, so the comparator returned `NaN` and bailed before reaching the
  providerId tie-break — leaving the winner an accident of input order while a code comment asserted
  the opposite. Caught by reading the comparator, not by a failing test.
- ⚠️ **Accepted and pinned by test: two genuinely different jobs sharing an identical company +
  location + title still merge.** Inherent to a content-derived key — adding `sourceUrl` or a provider
  discriminator would stop cross-provider dedup working at all, which is the entire point of the
  function. The contract doc's claim that the rule "never silently drops a distinct one" was overstated
  and is now qualified. [#92](https://github.com/adrien-mounier/jobcrush-app/issues/92) exists to
  measure how often it actually bites.
- **The "known gap" resolved by recording, not building.** `JobCardV1` still has no attribution field,
  so activation requires `!attributionRequired` alongside the two permission booleans: a provider whose
  attribution we cannot render must not go live. Recorded in §2.2 with the consequence stated —
  flipping a live provider's flag removes it from the active registry immediately, with no other code
  change. Chosen over versioning the card contract on a need no launch provider has confirmed.
- **Carried to #100/#101** (on the ticket): fail-closed lives in the loader, so `dedupePostings` will
  happily process a provider permitting neither storage nor matching if the boundary bypasses
  `loadActivePostingProviders()`; `Coverage` truthfulness is unverifiable from the schema; and
  `packages/contracts` is no longer isomorphic (it computes sha256 via `node:crypto`), harmless today
  because nothing bundles it for the browser.
- **Process note:** ran in an isolated worktree alongside two concurrent sessions. #114 landed on
  `main` mid-gate; zero file overlap, clean rebase, re-gated against the new main before pushing.

## 2026-08-03 (session 68) — `/orchestrate-team #107`: a job you genuinely cannot take leaves your deck

- **[#107](https://github.com/adrien-mounier/jobcrush-app/issues/107) shipped in `e62a455`, closed.**
  An explicitly-**blocking** language requirement withdraws a posting from that visitor's deck
  entirely — silently, on the deck, `/want` and the tailor target, and **before the paid judging set
  is ranked**, so a withdrawn card never costs a model call. Both safety rules hold: only an explicit
  advert ("Mandarin an advantage" withdraws nothing) and only an explicit user "no" (an unknown
  always keeps the card). A **years shortfall** attenuates the judged fit by `min(1, years/bar)` —
  5 years against "8+" scores below 9 years, neither at zero. Withdrawals counted on
  `deck.cards_withdrawn`. Gate 788 api + 30 contracts green; QA GO on a live browser drive,
  21/21 assertions, plus 32 adversarial probes.
- 🔑 **Withdrawal needs a SUBJECT on both sides, which is most of the diff.** "language" alone is not
  a comparable fact — matching a Mandarin demand against the visitor's English answer is exactly the
  silent deletion #86 names as the worst failure here. So `AdRequirementV1` gains an **additive**
  `eligibilitySubject` (deliberately not a v2: every stored v1 payload still validates, no existing
  field changes meaning; oracle in lockstep, `PROMPT_CONTRACT_VERSION` bumped so the subjects reach
  stored reads), the reader's clamp down-classifies any subject-less blocking language/certification
  requirement, and **language facts are now scoped by the language** rather than globally. Absent on
  either side = unknown = never withdraws.
- 🚨 **Review caught the exact failure the slice exists to prevent, in the slice itself.** The first
  build also withdrew on **work-rights**. The pool spans Australia, Hong Kong, Vietnam and China, and
  discovery asks ONE city-scoped question then stores it globally — so an Australian job-hunting in
  Hong Kong who needs sponsorship *there* would have had every right-to-work-demanding **Australian**
  posting silently deleted. **work-rights now never withdraws**, the same conclusion #106's must-fix-7
  reached from the other direction; resolvable once a visitor-location fact exists.
- 🐛 **The years rule was wrong in two directions before review.** It **replaced** the judged fit
  instead of attenuating it, so anyone over the bar had an honest 0.2 inflated to 1.0 on an advert the
  model had correctly scored low; and it divided by a bar the contract permits to be `0` or negative,
  yielding a `NaN` that slipped past the coverage guard and serialised `matchPct` as `null`, or a
  negative percentage. Attenuation (`fit * min(1, years/bar)`, clamped, guarded) can only ever lower.
- ⚠️ **Shipped correct and dormant, deliberately.** Discovery asks about English only, so nobody has
  ever been asked about Mandarin — it reads unknown and the card stays. The engine is right; the
  question set is what's missing. **Asking which languages a visitor works in is the next move** and is
  what turns this feature on for a real user. Raised by the owner from their own scenario (Thailand,
  English/French, hunting Taiwan/HK/Vietnam) — country never filters anything, so those jobs are safe.
- **Follow-up filed:** [#122](https://github.com/adrien-mounier/jobcrush-app/issues/122) — an unasked
  eligibility requirement still renders like a gap you failed rather than a question you haven't
  answered. The ticket's own UX intent; needs a surface this slice doesn't have.
- **Coverage gap carried:** `apps/api/data/sample-ad-requirements.json` carries **zero** blocking
  requirements, so a withdrawal has never been seen in a browser — proven only at the API seam (the
  spec's own primary one). Fixtures were deliberately not edited to manufacture one.

## 2026-08-03 (session 67) — `/orchestrate-team #106`: the three questions JobCrush asks once, and never again

- **[#106](https://github.com/adrien-mounier/jobcrush-app/issues/106) shipped in `56110d1`, closed.**
  Discovery now asks three eligibility questions inside the existing conversation — years in the
  pinned family, work rights, English — reused on every advert, never re-asked per job. Three
  distinguishable states, which is the whole point: an explicit "no" is a stored value, a decline
  (`Ask me later`) records the ask and stores nothing so the fact reads back **unknown**, and
  retracting an answer to a decline **erases** the stored value. Question set derived from the
  17-advert APAC corpus and recorded in `docs/research/eligibility-dimensions-from-the-corpus.md`.
  Gate 753 api + 29 contracts green; QA GO on a live browser drive, 48/48 assertions, 164 screenshots.
- 🔍 **The ticket's own measurement was wrong, and the doc now says so.** #106's body cited "2 work
  authorisation" across the corpus. Re-derivation found **0/17**: both hits were the word *sponsor* in
  its **project-sponsor** sense ("the project sponsor", "stakeholders, sponsors, and management"). The
  language count had a twin trap — a naive `fluen` search matches inside **Confluence**. Owner signed
  off asking `work-rights` anyway (spec #86 story 7 promises it; #107 depends on it) as an explicit,
  recorded deviation from "a dimension nobody asks for is not asked".
- 🐛 **Three defects worth remembering, all caught before the commit.** (1) Review: every eligibility
  answer, *including affirmative ones*, was persisted through the claims store's `negative` path — and
  `buildClaimGraph` stamps those `classification: "Negative"`, which the oracle defines as a
  **confirmed gap Tailor must never assert**. "Yes, I work in English" would have entered the audited
  root-CV graph as a fact the visitor does **not** have. (2) QA: a declined question permanently
  inflated the fact badge on three surfaces — `/profile`, tailor, and `buildJobCard`'s `fit`/
  `askedClosed`, i.e. it showed on **every card in the deck** — latched forever by #33's monotonic
  fact floor. (3) The funnel silently grew from ~3 pre-deck questions to **11**: eligibility was
  appended after the *whole* standard band while the deck gate waited on it, so the standard band —
  previously reachable only via the deck-exhausted loopback — became mandatory. Now ordered between
  essential and standard; the deck opens after **six**.
- **AC5 not met, deliberately, and carried forward.** "Prefer a provider's structured work-eligibility
  signal to asking the user." The seam built for it was **deleted in review**: the provider's
  `applicantLocationRequirements` is a *location list* while the asked value is
  `eligible`/`needs-sponsorship` — disjoint spaces that need a visitor-location fact this codebase
  does not have. Recorded on [#99](https://github.com/adrien-mounier/jobcrush-app/issues/99).
- **Follow-up filed:** [#120](https://github.com/adrien-mounier/jobcrush-app/issues/120) — an
  eligibility answer is correctable only in the moment; the *last* one loses its fix window to the
  deck handoff in 800ms. `/profile` is read-only, so a durable editor is its own ticket.
- ⚠️ **`56110d1` is committed but NOT pushed.** `main` is red on a pre-existing time-bomb test
  (`judgementStore.test.ts`, "does NOT write on a read when last_used_at is already fresh") that
  hardcodes `2026-08-02T00:00:00Z` against a 24h freshness window — it went red mid-session as the
  wall clock passed 2026-08-03T00:00Z, with nothing to do with this work. The fix exists only in a
  concurrent session's uncommitted #117 work, so pushing `56110d1` alone would land a red CI and a
  broken auto-deploy. Push once that lands.

## 2026-08-03 (session 66b) — `#117` closed on measurement: three paid staging runs, and the cap that moved the wrong way

- **[#117](https://github.com/adrien-mounier/jobcrush-app/issues/117) CLOSED** (`9b348af` → `c152dd9`),
  with **AC6 formally unmet and recorded as unmeetable** rather than redefined to pass. Final state:
  `DECK_JUDGE_MAX_CARDS = 8`. Unearned numbers on a cold deck **9 of 15 → 0 of 15**; cost per cold
  visitor **$0.29 → $0.1394 (−52%)**; returning visitor **free**; no number moved in any run.
- 🐛 **The experiment worth not repeating, and the reason the ticket closed unmet.** The owner raised
  the cap 8 → 20 to stop 7 cards reading "Not scored". The paid run showed it made the first deck
  **emptier** — 3 judged instead of 6 — and cost **114% more** ($0.2985 vs $0.1394). At 20 nothing is
  bound-excluded, so all ~15 adverts get a paid call and **12 were still in flight** when the shared
  `DECK_JUDGE_BUDGET_MS` (8s) expired; `CARD_RESOLUTION_CONCURRENCY` (6) turns 15 calls into three waves
  sharing one wall, so later waves get almost no time. **The first-view score count is governed by the
  in-request budget against per-call latency, not by the bound.** Reverted; the three-run table now
  lives in the constant's own comment. AC6 cannot be satisfied by any cap — but the failure it guarded
  against (a cost cut pushing more of the deck onto the old scorer) is structurally impossible now.
- 🚨 **A test nearly put six invented job adverts in front of real visitors.** Raising the cap above the
  pool size left the "bound holds when pool > ceiling" test with nothing to prove, so six
  `synthetic-holdco` postings were appended to `data/sample-postings.json` — which is **not a fixture**
  but the live pool `preview.ts` loads at runtime. Caught before it reached a commit. Fixed by making
  the ceiling injectable (`OnboardingDeps/BuildOptions.judgeMaxCards`, unset in `main.ts`) so tests set
  a ceiling of 3 against the real untouched pool. **Never move product data to satisfy a test.**
- **Parallel-session note.** Another session shipped #106 concurrently. Their commits sat unpushed
  because a dead test's fix lived in this session's working tree; committing here made the combined tree
  green (753 api + 29 contracts, cache bypassed) and both went up together in one push.
- **→ [#121](https://github.com/adrien-mounier/jobcrush-app/issues/121) filed**, deliberately **not**
  `ready-for-agent` — wants a `/wayfinder` pass. Score just ahead of the visitor as they swipe instead
  of scoring the whole deck up front: pays only for attention actually spent, and retires the
  token-overlap pre-filter that currently decides *which* 8 adverts are worth judging. Open questions
  are pacing ones (a fast swiper outrunning the scoring is worse than today's calm "Not scored").
- **Infra:** `OPS_KEY` set on `jobcrush-api-staging` (owner-approved) so `/ops/spend` is readable;
  recorded in `AI/Projects/SHARED_INFRA.md` alongside `GUESTBOOK_KEY` as the account's two operator-only
  read-gates. Value is not written down anywhere — Fly cannot read secrets back.
- **Spend this session: ~$0.44** across three measurement runs ($0.1394 + $0.2985, plus the earlier
  fake-model run at $0).

## 2026-08-03 (session 66) — `/orchestrate-team #117`: the deck buys eight honest scores and stops inventing the other seven

- **[#117](https://github.com/adrien-mounier/jobcrush-app/issues/117) shipped in `9b348af`, ticket
  deliberately left OPEN.** A cold deck judged all ~15 adverts per visitor (~US$0.29, re-firing as the
  fact set grew) and, whenever a judgement failed or missed the shared budget, showed the token-overlap
  scorer's number as though it were the judged one — measured on staging, 9 of 15 first-view cards, all
  nine changing on the second. Now: `DECK_JUDGE_MAX_CARDS = 8` bounds **paid** calls per visitor per
  fact set; free cache reads are unbounded via a cache-only path that takes no `LlmClient` and so cannot
  spend; `CardScoreProvenance` replaces the judged/fallback boolean with `judged`/`pending`/`unscored`/
  `estimated`, with `matchPct`/`breakdown`/`bubble` **null** on the two unearned states — the response
  cannot express a fake number. Superset reuse re-judges only still-unmet requirements when evidence has
  only grown. Gate 712 api + 29 contracts green.
- 🐛 **The near-miss: the cost saving was real in a snapshot and evaporated in the flow.** The first
  implementation ranked the paid set over what the cache had **not** resolved. The web deck polls while
  judgements arrive, so each poll found the previous round cached, which *freed bound slots*, which
  bought the next batch — by the third or fourth poll the visitor had paid for all 15, the exact ~$0.29
  the ticket exists to kill, **while every "at most 8 per request" unit test stayed green.** Caught by
  the Standards review axis reading the diff against the client's retry behaviour; the Spec axis missed
  it. Fixed by ranking the paid set over *every* candidate so it is a pure function of the fact set —
  a poll re-derives the identical set, finds it cached, spends nothing. See `lessons.md`.
- **Two goals in one ticket, with the cheap fix for one defeating the other — the ticket said so and it
  was right.** Judging fewer cards cuts cost and, done naively, leaves *more* of the deck on the old
  scorer. The resolution was to stop letting an unjudged card carry a number at all, which required a
  fourth provenance state (`unscored`, nothing coming) distinct from `pending` (in flight, self-heals):
  collapsing them left 7 cards spinning forever behind a "Try again" that could never succeed. That
  collapse was an orchestrator error in the contract pinned to both engineers, found at integration.
- **Design decisions that carried their weight.** Polling starts on the reveal/wall screens, not the
  deck, so most visitors never see a card without a number. `unscored` copy frames the absence as
  *ordering* ("I scored the closest matches first. Want this one? I'll score it against your facts.")
  rather than economy — true, since the deck really is judged-first, and it never tells the visitor we
  spent less on them. `Estimate` under the ring marks the deterministic number wherever it still shows.
- **QA drove it live:** 8 paid calls across 10 consecutive deck loads (flat from the first), poll
  terminates, **zero numbers moved** across reloads, 0 of 15 cards claiming an unearned number, returning
  visitor gets a full 15-card deck for 0 new calls. E2E left at `apps/web/e2e/pending-unscored-card-journey.mjs`.
- ⚠️ **Why it is not closed:** AC8 requires cost per visitor **and** cold-deck fallback rate reported
  together from one real run. No local API key; the CLI fallback spends unmetered so cost reads $0. Needs
  `OPS_KEY` on `jobcrush-api-staging` — `/ops/spend` 403s without it. Owner ask is on the ticket.
- ⚠️ **Carried limit:** the cheap token scorer still picks *which* 8 adverts are worth paying to judge,
  so a strong match in the candidate's own words can rank low on vocabulary and never get judged. Belongs
  with family-fit ranking (#107). Also: a kept verdict is never re-checked against a later *added*
  contradicting fact (edit/remove does trigger a full re-judge) — documented at both merge sites.

## 2026-08-03 (session 65) — `/orchestrate-team #118`: what a visitor costs stops being a hand calculation

- **[#118](https://github.com/adrien-mounier/jobcrush-app/issues/118) closed, `fd45c8d`.** Every model
  call in the API records one durable row at the `llm.ts` seam — visitor pseudonym, stage, model,
  tokens, computed cost, timestamp — across all seven spending stages (advert reading, judging, claim
  mining, preview/tailor, grill, CV audit, family screen). Replaces the two in-memory token counters
  that reset on every deploy and covered only the cheap half of the bill. New: `usageLedgerStore.ts`,
  `llmMeter.ts`, `llmPricing.ts`, `llmVisitorContext.ts`. Gate 680 api + 29 contracts green.
- **Metering by wrapping, with the stage fixed at construction, is what made this a small diff.**
  `main.ts` hands each pipeline step an already-metered client, so no call site had to remember to
  record and no signature had to grow a context parameter. `complete()` reaches into
  `inner.completeWithUsage` directly rather than through the wrapper's own instrumented method, so
  whichever entry point a caller uses the call is recorded exactly once. `adReader`/`judge` keep their
  own per-row cost records for other tickets' ACs — the ledger is a separate table and doesn't
  double-count them.
- 🐛 **The headline feature shipped broken in round one and every test passed.**
  `AsyncLocalStorage.enterWith` was called after `await sessions.getByToken(token)` in the async
  `onRequest` hook — it does not survive Fastify's hook-to-handler transition, so every row would have
  recorded a null visitor, `costForVisitor` would return 0 forever, and `scrubVisitor` would have had
  nothing to scrub. The unit test passed because it set the visitor and ran the meter in one unbroken
  async context, never crossing the HTTP seam the whole design rests on. Fixed with a callback-form
  hook calling `runWithVisitor(id, done)` as its last synchronous action; proved by reverting the fix
  and watching the new HTTP-seam test fail. See `lessons.md`.
- 🐛 **A mistyped rate override wrote `NaN` into the money column, permanently.** `{"claude-sonnet-5":
  {"inputPerMillionUsd":3}}` — one key missing — parses as valid JSON, merges, and every cost after it
  is a non-number with no log and no counter. **pg-mem rejected that insert while real Postgres
  accepted it**, which is exactly why the suite never saw it; QA only found it by driving a real
  Postgres 16 in Docker. Now validated at config load *and* at computation, with a rejection counter.
  Follow-on hunt found `LLM_PRICING_JSON=null` crashing the API at boot and a negative rate running the
  total backwards — both closed in the same round.
- **Retention is the owner's call, recorded on the ticket, not a silent engineering default.** Ledger
  rows retained indefinitely; every content-bearing row keeps purging on today's schedule; a purged
  visitor survives as a pseudonym with nothing behind it. The privacy boundary is the row *shape* — no
  column can hold CV text, answers, advert text or model prose — proven by test on both drivers rather
  than by filtering.
- ⚠️ **Carried:** per-visitor cost is first-toucher-billed (cached advert reads and judgements mean a
  warm visitor records nothing for those stages) — the figure is "what this visitor caused us to spend
  fresh", **not** their share of what they consumed, and that distinction matters the moment it's used
  to price anything. Also: in-flight writes lost on shutdown; a throwing call records nothing;
  `main.ts`'s wiring is convention, not types. No display surface — that's the ops dashboard ticket,
  now unblocked along with #117.

## 2026-08-02 (session 64) — `/orchestrate-team #105`: the number stops rewarding vocabulary and starts meaning something

- **[#105](https://github.com/adrien-mounier/jobcrush-app/issues/105) closed, `8b0bc7c`.** The card's match %, covered/uncovered breakdown, "where you fit" and "not yet" list now derive from a per-requirement **graded verdict** (0..1 + supporting fact id + reason) produced in one model call per (advert, candidate), replacing token-overlap coverage on those surfaces. New: `apps/api/src/judge.ts`, `judgedScore.ts`, `judgementStore.ts`, `prompts/card-judge.md`. Gate 627 api + 29 contracts green.
- **The judge is an optional injected dep, exactly like `readAd` — and that one decision is why 550+ pre-existing tests needed no re-baselining.** Absent ⇒ today's deterministic tick byte-for-byte; wired only in `main.ts`. #111 owns re-baselining the committed tick assertions. Replacing the **coverage relation** rather than the score was the surgical seam: `matchPct`, `breakdown`, `dontYet`, the bubble's hit and tailor's question selection all already derived from that one relation, so they moved together and `matchtick.ts` was never touched.
- 🐛 **The coverage bar was set at 0.999 while the prompt reserves 1.0 for "exactly what the requirement asks" — the slice's headline promise, inverted.** The ticket's flagship case ("Ran weekly steering meetings with the CFO" ⇒ stakeholder coordination) grades ~0.9 on a real model and would have stayed in "Where you don't — yet", read 0/1 essential, and been re-asked in Tailor. The team's own live test already used ≥0.7 as its "covered" bound — **two bars for one concept, disagreeing by 0.3, in the same slice.** Now one exported `COVERAGE_THRESHOLD = 0.8`, used by the scorer, asserted by the live test, and stated as a literal number in the prompt, pinned by a wording test.
- 🐛 **The regression suite could not detect the regression it exists for, and the live test was an open-book exam.** The scripted-fake test derives `expectedFit` from the row's own `expected` — fine as a *plumbing* proof, useless as a judgement proof — and **all five evidence strings appear verbatim in `card-judge.md` as worked examples**, including the construction row's target band. So the only test that certifies judgement quality was grading a model handed the answers, and **slice 9's measurement gate would have inherited a green it never earned.** Fixed with `HOLD_OUT_REGRESSION_ROWS` — same five failure classes, warehouse/food-safety domain, wording absent from the prompt. **The canonical rows are kept but marked as certifying nothing on their own.** Generalises: a regression fixture that also lives in the prompt is a fixture the model has memorised.
- 🐛 **The persistence key ignored which requirement set was judged.** Bump the ad-reader version, the advert comes back with regenerated requirement ids, and a returning user with unchanged facts hits the stored judgement, misses every id, and sees **0% with every requirement open — permanently, with zero model calls to correct it.** Fingerprint now folds in the sorted requirement-id set, plus a `coversAllRequirements` check on every cache hit as defence in depth.
- 🐛 **Explicit negatives were in the cache key but never in the model call**, so tapping "No" bought a fresh paid judgement over byte-identical input and could return a different number — pure run-to-run variance surfacing as an unexplained drop. Fingerprint is confirmed facts only; negatives are applied downstream by the existing filter, where they always were.
- ⚠️ **The privacy fix re-introduced the exact failure the slice exists to remove, and it took a second look to catch.** Sweeping `card_judgements` by age (rows carry CV-derived `reason` prose, and purge's own header claimed sessions+claims were all an anonymous visitor left) silently re-judges a **stable, actively-viewed** card the moment a claimed user returns after the TTL having changed nothing. A `session_id` column doesn't work either — claim ids are deterministic across sessions, so two visitors answering alike legitimately **share** a row. Swept by **disuse** instead (`last_used_at`, bumped on read, throttled to once a day, and the bump can never turn a hit into a miss).
- 📊 **QA drove it live and judged numbers reached a real screen**: deck of 15, ten replayed from the store with no model call, five fallen back on the deadline; opened a card at a judged 12%, answered "no", watched the open list go 13 → 12 with the number held and nothing re-asked. Counters either side: `judged_succeeded` +0, `fallback_used` +5, `fallback_timeout` +5 — a store hit moves no counter, so provenance is read **by subtraction**, which QA's first script got wrong and corrected.
- 🐛 **Two defects the live drive found that no test would have.** (1) On a cold judgement cache the deck returned **HTTP 500 at exactly 30.0s** — the web proxy's deadline — three times running; the app's main screen never rendered. Structural, not CLI-driver slowness: 15 cards at concurrency 6 is three waves × a fresh 15s each ≈ 45s, and **the concurrency cap the tech lead asked for is what created the waves.** Now one shared 8s wall-clock budget for the whole request's judging phase, so later waves inherit near-zero remaining time and fall back instantly. (2) Because the old scorer over-scores, **fallback cards floated to the top — the deck led with the card we understood least**, a 3× over-score (38% vs a judged 12%). Judged cards now group above fallback cards ahead of the existing score sort; the curated-opener promotion (#111's) is untouched.
- **Carried, knowingly:** *"the number never moves"* holds **once a judgement is stored**, not on a first view that falls back — every comment and test name asserting the stronger claim was corrected rather than left flattering. The same tradeoff the owner already accepted for reads (#115/#116). Judgements key on the user's own fact set, so they **never warm across users**: cost scales with visitors × adverts, unlike the shared ad-read cache. Filed as [#117](https://github.com/adrien-mounier/jobcrush-app/issues/117).
- 🚨 **Verified live on staging after deploy, and the shared budget is the only reason the deck rendered at all.** One anonymous visitor, deck requested twice. Cold: **HTTP 200 in 8.64s** — the same request that returned **500 at exactly 30.0s** locally before the budget landed. Warm, unchanged facts: **0.50s, zero new model calls, zero cost delta** — every judge counter frozen. *"Unchanged facts are never re-judged"* is now proven in production, not just against fakes. The judged/fallback grouping also held: the six judged cards took positions 1–6 and a judged card led the deck on both views.
- 📊 **The first-view limit is the majority of a cold deck, not a corner case — worse live than locally.** **9 of 15** cards showed the old scorer's number on first view (locally 5 of 15) and **all nine changed** on the second: `34% → 26%`, `34% → 18%`, `26% → 13%`, `9% → 19%`, `26% → 39%` — both directions, some by half. Recorded on #105 as an accepted limit before deploy; the live magnitude is what makes #117 urgent rather than tidy.
- 📊 **First real unit economics for judging: 34,202 input + 12,419 output tokens for 15 judgements** — ~2,280 in / ~830 out per card, **≈ US$0.29 for one visitor's cold deck**. Unlike the shared ad-read cache this is paid **per visitor** and re-fires as the fact set grows during discovery, since each new fact is a new fingerprint. ~$290 per 1,000 visitors reaching the deck once, as a floor. Added to [#117](https://github.com/adrien-mounier/jobcrush-app/issues/117), which is now priced rather than speculative.
- **Not proven:** judgement quality against a real model (hold-out rows need `ANTHROPIC_API_KEY`; slice 9 owns certification), Postgres-backed purge on a real TTL, and the concurrency cap under concurrent visitors rather than one.
- **Next:** [#106](https://github.com/adrien-mounier/jobcrush-app/issues/106) — eligibility asked once in discovery. The judge is now the thing that reads the advert honestly; #106 gives it the one class of fact it still can't infer.

## 2026-08-02 (session 63) — `/orchestrate-team #115`: the adverts were never unreadable — they were being given up on

- **[#115](https://github.com/adrien-mounier/jobcrush-app/issues/115) closed, `3b83de0`.** Staging's 42.9% read-failure rate had nothing to do with the model, the prompt or the contract. Gate 553 api + 29 contracts green, cache-bypassed.
- 🔍 **The reproduction answered the question by failing to reproduce.** All 7 uncurated adverts driven through the real `readAdvert` path: **10 completed reads, 10 successes, 0 validation retries fired, 39–98s each.** All four causes the ticket suspected — strict-schema rejection, `sourceSpan`, truncation, advert-specific content — disconfirmed in one run. The deck gives each uncached read **15s** (`READ_TIMEOUT_MS`, added by #104 review finding 10 so one hung advert can't hang the deck for everyone); a real read takes ~15–27s. Roughly three in seven lose that race, every request. **The ticket's own ranked hypothesis list pointed at the wrong subsystem entirely** — which is exactly what its second AC exists to prevent.
- **Severity was overstated and that was corrected on the ticket, not quietly shipped against.** "Nearly half the live pool is invisible" is not what was happening: nothing cancels an abandoned read, so it finishes, validates and **persists itself**, and the next request serves it from cache. The real cost is narrower — *the first viewer of any never-before-read advert loses it*, a one-off warm-up at 17 fixed postings and a permanent tax on the newest jobs once #99–#101 makes fresh adverts routine.
- **Owner decision: keep the deadline.** Deck speed unchanged. Returning the deck immediately and filling it in as reads land is the upgrade, filed as [#116](https://github.com/adrien-mounier/jobcrush-app/issues/116) with both rejected alternatives recorded so the tradeoff isn't re-litigated.
- ⚠️ **The fix removed alarm coverage, and the replacement was broken twice before it shipped — both caught pre-commit.** Splitting timeouts out of `postings.read_failed` is right (the same trap #103 drew a line against for language skips), but it meant degrading throughput until *every* uncached read overruns would leave the deck returning nothing new while `/ops/counters` reported a clean 0‰ — story 26's silent market removal, arriving through the fix. The new `READ_TIMEOUT_ALARM` then rated itself against `adReader.read_succeeded`, which **an overrunning read increments itself when it self-heals** — so a sustained 100%-timeout incident asymptotes to a 50% reported rate under a threshold tuned to 50%, and the alarm was *structurally unable to fire in the scenario it was added for*. QA reproduced it live at exactly `500‰`. Fixed by correcting the **denominator, not the threshold**: `postings.read_in_time`, counted at the deadline site itself, so total degradation reads 100% and the measured 3-of-7 warm-up reads 43% and stays quiet.
- **The reason a read didn't land is retrievable at last.** Every failure path was a bare `catch {}` — which is why this cost a session instead of a glance. Now five classes (`timeout`, `model-output-invalid`, `model-call-error`, `reader-rejected`, `store-unavailable`), a bounded ring buffer, a log line, and `/ops/read-failures` **behind `OPS_KEY`, fail-closed** — review caught that raw driver text carries internal hostnames and pg auth messages, and the route was open. **`OPS_KEY` must be set on staging or AC2 is unmet in production.**
- **QA proved the load-bearing claim over real HTTP with real timers, independently of the team's own test:** request 1 back in **15,013ms** without the slow adverts, all 7 persisted by **t+22s**, request 2 serving **15 cards in 4ms** with zero new model calls. Fail-closed gate verified against the real `dist/main.js` (wrong key, empty key, case variant, prefix, header-instead-of-query all 403); a planted pg auth-failure message appeared only on the gated route, truncated 978 → 500 chars, and nowhere in the deck response.
- **Two honest gaps QA recorded itself:** no real model call anywhere in testing (no local API key), so *"reads take 15–27s"* still rests on the one CLI-driver measurement; and **nothing measured on staging** — AC3's literal wording ("measured the same way this ticket measured it") can only close after this deploys.
- **Known limits, recorded rather than fixed:** the timeout alarm **dilutes as the pool warms** (a cache hit counts as in-time, so a mostly-cached pool reports a low rate even if every fresh read fails — revisit at #99–#101); two concurrent requests racing one slow read double-count it; a restart mid-overrun drops the attempt from both counters; `OPS_KEY` reaches the request log via the query string, exactly as `GUESTBOOK_KEY` already does.
- **Next:** [#105](https://github.com/adrien-mounier/jobcrush-app/issues/105) — the number on the card is still the knowingly-broken token-overlap score. [#114](https://github.com/adrien-mounier/jobcrush-app/issues/114) is the natural neighbour (it touches the same read path and its "failures re-pay every request" complaint is partly answered by this slice's classification work).

## 2026-08-02 (session 62) — `/orchestrate-team #104`: the tracer bullet — an advert nobody curated becomes a card

- **[#104](https://github.com/adrien-mounier/jobcrush-app/issues/104) closed, `fb68dcd`.** One model call per advert produces its requirement list **and** its posting-family verdict in the same pass, zod-parsed before any caller sees it, persisted keyed by `adId` alone and shared by every session that sees that job. Deck goes **8 → 15** cards. New: `apps/api/src/adReader.ts`, `apps/api/src/adRequirementsStore.ts` (InMemory + Pg + store-contract test on both drivers), `apps/api/prompts/ad-reader.md`. Gate 543 api + 29 contracts green, cache-bypassed.
- **15, not the ticket's 16 — tech lead's call, and the reasoning matters more than the number.** Of the 16 English postings, `…hays…` carries a hand-authored **Chinese** requirement set (built by #103 to prove the dual language gate). Fixture-first resolution means it is never re-read, so it stays out. Reading it anyway would have regressed a shipped safety rule to make a demo figure match. The AC's main clause — *an advert with no hand-authored requirement list becomes a card* — is met exactly; only its parenthetical arithmetic was off by one, because that posting **has** a list. `cards.test.ts` now asserts `toBe(15)` with the reason inline, not `toBeGreaterThan(8)`.
- 🐛 **The code-level blocking clamp would have silenced blocking entirely — the safety net cancelling the thing it guarded.** The reader down-classifies `blocking` to `ordinary` unless the requirement carries a hard-gate `eligibilityDimension`; the prompt told the model that field was optional and "most requirements are NOT eligibility dimensions". Net effect: the ticket's own measured true positive (English fluency) would be clamped away, `adReader.requirements_blocking` would read **0 forever**, and an operator would read that as the prompt behaving. Fixed by making the dimension **mandatory on any blocking requirement** in the prompt, keeping the clamp as the backstop, and adding the test nobody had written — that a correctly-tagged hard gate **survives** as blocking. **Every clamp/guard needs a test that it can be passed, not only that it fires.**
- 🐛 **A contract bump would have silently emptied the deck — in exactly the case the version field exists for.** The Pg driver validated a stored row against the *current* schema before anything compared versions, and that read sat outside the reader's try. Bump `AdRequirementsV1` → every stored row throws → the route's catch swallows it → no cards, no counter, no re-read. **The in-memory driver didn't re-parse, so the suite would have stayed green while staging broke** — a driver divergence the store-contract test could not see, because both drivers run against the same schema at test time. Both now `safeParse` and treat a rejected row as a plain cache miss.
- 🐛 **Three more the review caught, each a real cost or honesty defect:** the model's own JSON was spread *after* the fields the reader pins, so an echoed `"curated": true` could promote an unreviewed advert into the curated-opener slot; a read that used its validation retry recorded roughly **half** the tokens it spent and still labelled them measured; and two concurrent cold deck requests both missed the store and both paid for the same advert ("nobody pays twice" held only sequentially).
- **Failures were countable but not *findable*.** Store errors sat outside the try, so a Postgres outage would have removed every uncurated advert from every deck while `/ops/counters` reported a 0% failure rate — #86's named worst case arriving with the alarm silent. Fixture-parse failures were incrementing the alarm's *numerator* against a denominator they never feed, so one malformed fixture would pin it at 100% with zero model calls made. Both fixed; language skips stay in their own counter, and QA measured the rate as exactly **7/7, not 7/8** — skips genuinely cannot drown it.
- **`AD_READER_VERSION` is now derived, not remembered.** The prompt half is a hash of the **post-strip prompt text actually sent**, so editing the human-facing header comment costs nothing and editing the blocking definition re-reads the pool. Verified by hash both ways. Hand-maintaining it meant one forgotten bump served every advert from a stale cache forever.
- **QA drove the whole journey with a stand-in at the `claude` CLI process boundary** — reader, store, routes, counters and prompt assembly all production code, only the model's judgement simulated. An uncurated advert appeared as the 4th card, was picked, and opened Tailor asking questions drawn from that advert. With the reading engine broken: those jobs were simply absent, no invented numbers, deck still worked, alarm fired once on transition. Flow left behind at `apps/web/e2e/uncurated-advert-journey.mjs`.
- **Two defects accepted, neither blocking, both filed as [#114](https://github.com/adrien-mounier/jobcrush-app/issues/114):** a malformed *curated* fixture now falls through to a **paid** model read of a hand-curated advert, counted as nothing (`postings.fixture_invalid` has no production caller left); and failures aren't cached, so every deck request re-attempts every failing advert at 2 calls each (`read_failed` observed going 7 → 14 over two deck loads). Free at 17 fixture postings, expensive once #99–#101 lands.
- 🚨 **Verified live after deploy, and the first real traffic found a defect: 3 of 7 uncurated adverts failed to read — a 42.9% failure rate, alarm firing.** Staging *does* hold an `ANTHROPIC_API_KEY` (unverifiable locally — no `fly` CLI, not in CI secrets or `SHARED_INFRA.md` — so it was checked by driving the live deck once). Filed as [#115](https://github.com/adrien-mounier/jobcrush-app/issues/115). **The observability this slice was funded for is what surfaced it within minutes of deploy** rather than as jobs quietly missing from decks — the failures produced no cards and no fabricated numbers, and the rest of the deck stood. Cause unknown; the counter records *that* a read failed, not *why*, which is itself a finding (#115's second AC).
- 📊 **First real unit economics, replacing #86's estimates: 8,818 input + 5,407 output tokens across 4 adverts** — ~2,200 in / ~1,350 out per advert, ≈2–3 US cents each at current Sonnet rates, comfortably inside the spec's estimate. Also from the same run: **38 requirements produced, 0 blocking, 0 clamped** — where the model succeeds it follows the pinned definition without the code-level clamp needing to correct it, which is the first evidence the prompt half of the contract holds on real text.
- **Next:** [#115](https://github.com/adrien-mounier/jobcrush-app/issues/115) before [#105](https://github.com/adrien-mounier/jobcrush-app/issues/105) — a better *number* on a card matters less than half the pool producing **no card at all**. These 15 cards carry the knowingly-broken token-overlap score until #105; scoring was deliberately untouched here and QA confirmed `matchtick.ts` unmodified.

## 2026-08-02 (session 61) — `/orchestrate-team #103`: the language gate, placed once at ingest

- **[#103](https://github.com/adrien-mounier/jobcrush-app/issues/103) closed, `f5a4c27`.** Every posting is language-labelled the moment it enters the pool (`loadPostings()`), locally and deterministically — no model call, no per-advert cost. Non-English is **kept, labelled and never surfaced**. One rule in `apps/api/src/language.ts` (detector + `SERVED_LANGUAGES` + `readingLanguages` + `languageEligible`); `eligiblePostings()` lives beside `loadPostings` in `preview.ts` so #104's reader can reuse it without importing a routes module. Reading languages are a **list** defaulted to `["en"]`, deliberately unpersisted — nothing writes them yet, and the accessor is the one place storage lands. Gate 488 api + 29 contracts green.
- **The gate is applied to the requirement set's language too, not just the posting's.** A posting whose *excerpt* reads English but whose requirements were produced in another language would otherwise render foreign bullets into an English-gated card — the contract's `language` field exists precisely because requirements are "never silently translated". Same predicate, two fields, four call sites (deck, `/want` by direct id, tailor target, pre-signup preview). Fixture proves it: the Hays posting has an English excerpt and a `zh` requirement set, and stays out.
- 🐛 **Review caught a second, ungated read of the pool** — `matchPosting()` in the pre-signup magic-mirror preview, which picks an advert *and burns a real LLM tailor call on it*. Unreachable today only because keyword ties resolve to the earlier posting; live the moment #99–#101 lands. It has no session, so it gates against `SERVED_LANGUAGES` — that constant exists for exactly this one caller. **The lesson generalises: "the gate is in one place" is a claim about every path that reads the pool, not about the route you were looking at.**
- 🐛 **The detector originally treated one CJK character as proof of non-English.** In an APAC-first product, that hides a genuinely English Hong Kong advert quoting a Chinese company name or address from *every* reader — the "silently deleting a winnable job" failure #86 names as the worst this engine has, arriving through the front door instead of the scorer. Now **proportional**: a script must hold ≥30% of letter-like characters. Kana is still checked before kanji (Japanese prose mixes them; Chinese has no kana).
- **`und` is counted separately from a language skip, and that separation earned its keep immediately.** QA measured the English function-word test at 0.181–0.329 on the real corpus but **0.032 on an ATS bullet-list advert and 0.000 on a bare skills blob** — genuinely English adverts that would be labelled `und` and hidden from everyone once a real feed lands. Invisible against the fixture corpus. Filed as [#113](https://github.com/adrien-mounier/jobcrush-app/issues/113), natively blocked on **#99–#101**, because tuning it against the fixtures a second time is what hid it. Also carried there: Vietnamese and Indonesian detect as `und`, not as themselves — the advert is retained but *unlabelled*, so opening Vietnamese later would find an empty pool, the exact outcome the ticket's operator story existed to prevent.
- **QA proved the deck-absence test isn't vacuous rather than asserting it:** re-running the candidate pipeline with reader languages `["en","zh"]` yields **10** candidates, `["en"]` yields **8**. The Chinese fixture posting was given a requirement set on purpose — without one it would be absent from the deck for the wrong reason and the test would prove nothing. **A gate test is only real if the thing it excludes would otherwise be included.**
- **Counters count once per posting at ingest, behind the pool cache — never per request.** QA drove 12 deck requests across 4 sessions; the skip counter stayed at 1. Counting at read time would have inflated it with every page load and made the number meaningless.
- **No browser pass, deliberately.** No UI changed; the deliverable is a response shape plus `GET /ops/counters`, and reaching the web deck costs an LLM-billed CV upload → mine → preview → signup that exercises nothing this slice touches. QA drove the API directly on port 4317 instead.
- **Declined, on the tech lead's call:** dropping `readingLanguages`' unused session parameter and the never-incremented `read_failed` counter, both flagged as speculative. The parameter is the seam persistence lands on (AC3 reads languages *for a user*), and the ticket explicitly asks for skip and failure counts to both be observable.
- **Next:** [#104](https://github.com/adrien-mounier/jobcrush-app/issues/104), the tracer bullet — the deck goes 8 → 16 cards and this chain first pays off visibly. It consumes this slice's gate (skip before read, don't pay to read what nobody can be shown) and its counters.

## 2026-08-02 (session 60) — `/orchestrate-team #102`: the v1 requirement contract, and the whole app on it

- **[#102](https://github.com/adrien-mounier/jobcrush-app/issues/102) closed, `d7712a5`.** One versioned shape for "what an advert asks for" carried by every surface, plus every consumer migrated in the same pass. **User-invisible by design and proven so**, not assumed: QA ran the *pre-#102 scorer against the v0 fixture* and diffed it against the live migrated API — all 8 cards byte-identical (54/49/42/35/33/29/26/26%, matching breakdowns and `dontYet` id lists), then drove the real journey in a browser (onboarding → discovery → deck → Tailor, 50 assertions, 81 screenshots). Gate 471 passed / 5 skipped / 31 files; contracts 29/29.
- **Band vocabulary unified on `essential`/`standard`/`nice-to-have`** per the owner decision. **The mechanism matters more than the naming:** `band` now *reuses* `familyFloor.ts`'s `RankBand` — the same zod object, not an equal-but-separate enum — so ad requirements, family floors and the card's `dontYet` cannot drift apart with nothing to catch it. Naming choice was the tech-lead's: `essential` is the only band word already wired to durable state (the `essential_floor_covered` checkpoint, the discovery gate) and is already the word the card displays, so it maps 1:1 with zero translation.
- ⚠️ **One translation survives by design and is recorded on the ticket** (AC4 requires it be stated there, not only in code): `matchtick.ts` rolls `standard`+`nice-to-have` into the card's `desirable` bucket. The card is a **two**-bucket display against a **three**-band contract — a genuine rollup, not an accidental renaming — and collapsing it otherwise would change what the user reads, which AC5 forbids.
- 🐛 **The guard the ticket was funded for did not exist until QA found it missing.** `cards.test.ts` asserted `matchPct: expect.any(Number)` and shape-only breakdowns, so a mistranslated band would have shifted **every percentage and still passed CI** — precisely the owner's stated risk ("no test and no reader can tell by looking"). Removing the translation removed the risk; nothing installed the detector. Added a characterization test pinning exact `matchPct` + both breakdown buckets per `adId`. **Slice 4 replaces the scorer and is expected to re-baseline those numbers deliberately** — the forced conscious update is the point, not a maintenance cost.
- **`_lib.mjs` never exported `readJsonArg`.** The new validator imported it, and so do `validate_family_floor_v1.mjs` and `validate_family_placement.mjs` — all three died under plain `node` with a link-time `SyntaxError`, working *only* under vitest, whose transform turns the missing binding into `undefined`. Repo rule says the `.mjs` oracles **are** the contract spec, so three of them were unrunnable specs. One export fixed all three; verified standalone.
- **13 fixture `sourceSpan`s were not verbatim** — one curly apostrophe normalised, twelve with a trailing period the bullet-list source never had. Found by writing a substring checker rather than eyeballing 60. Provenance that is not verbatim defeats the field's purpose the moment #108 renders "this came from the advert".
- **Review found the API and the web app disagreeing about a word:** `apps/web/lib/api.ts` still hand-declared `band: "must"|"should"|"nice"`. Unrendered today, so invisible — and exactly the unchecked hand-written mapping the owner's decision exists to kill. Fixed type-only; `jobcard.tsx` untouched. **Declined:** a `JobCardV2` bump for the in-place band change — cards are never persisted (only the `jobs` table exists) and api+web ship together from this monorepo, so there is no stored payload and no version-skew window. Reasoning recorded on #102 so it is not re-litigated.
- **Carried to [#104](https://github.com/adrien-mounier/jobcrush-app/issues/104), not fixed here:** `e5stub.ts`'s `listAdRequirements()` maps `parse` across every advert, so **one unparseable advert 500s the whole deck** instead of omitting that job — failing *open* in the worst way. Harmless while all 8 are hand-authored fixtures; real the moment #104 has a model produce them, and #104 already owns "an advert that cannot be read produces no card".
- **FYI, pre-existing and untouched:** `packages/contracts/fixtures/family-placement.valid.json` fails its own validator (the fixture is an array, the validator expects one object) — only visible now that the oracles actually run standalone.
- **CI hardened on owner request before #103 ([PR #112](https://github.com/adrien-mounier/jobcrush-app/pull/112), `0bed478`).** Two pipeline risks, neither caused by our code, both breaking on someone else's timetable. (1) `actions/checkout`, `actions/setup-node`, `pnpm/action-setup` were all on **v4 → the retired Node 20 runtime**; GitHub was force-running them on Node 24 and warning on every build. That shim is temporary, and since a green build is what deploys, its withdrawal would have frozen shipping. Moved to **v7 / v7 / v6** (verified `using: node24` in each action's own manifest, not assumed — **v5 was the minimum that clears it**, current majors chosen to avoid repeating this in six months). Annotation confirmed gone. (2) `setup-flyctl` was on **`@master`** — every deploy silently pulled whatever was last pushed upstream, to the tool that ships our releases, first symptom a failed deploy. **Pinned to tag `1.6`, which resolves to the identical commit `ed8efb3…` that `master`/`v1`/`1.6` all point at** — so it records today's proven behaviour rather than changing it.
- **Method note:** done on a branch + PR, per `CLAUDE.md`'s "risky enough that staging must stay up" exception — breaking CI on `main` blocks every deploy. ⚠️ **The PR could only prove half of it:** `test` runs on pull requests, but `deploy-staging` only runs on a push to `main`, so the flyctl pin was unprovable until merge (it deployed both apps green on `0bed478`). Worth knowing before the next CI change: **a PR cannot validate the deploy job.**
- **Next session:** [#103](https://github.com/adrien-mounier/jobcrush-app/issues/103) language gate — the last unblocked slice before **#104, the tracer bullet where the deck goes 8 → 16 cards** and the first user-visible payoff of this chain lands.

## 2026-08-02 (session 59) — `/to-tickets #86`: nine horizontal children replaced by ten vertical slices

- **Tracker only. No product code changed, nothing committed to git.** `/to-tickets #86` in a fresh session, exactly as 58's handoff planned — and the handoff worked: the spec, its design record and the trap list were all on the issue, so a cold start needed no conversation history.
- **Ten vertical slices filed, [#102–#111](https://github.com/adrien-mounier/jobcrush-app/issues/102)**, all `ready-for-agent`, blocking wired as **GitHub native dependencies** rather than prose. Chain: #102 contract v1 + #103 language gate → **#104 read an uncurated advert into the deck** → #105 meaning-aware judging → #106 eligibility asked once → #107 withdrawal + proportionate years → {#108 the bubble, #109 re-score + notify} → #110 measurement gate → #111 retire the guards. **#105 now blocks [#63](https://github.com/adrien-mounier/jobcrush-app/issues/63)** in #89's place.
- **All nine earlier children closed as superseded** (#87–#91, #95–#98), each with a comment naming its replacement — and **every measured finding copied inline into the replacing ticket first**. A pointer to a closed issue navigates; only a copy preserves working knowledge. Carried: the blocking-definition experiment, the provider probe facts, the five vocabulary-coincidence rows, the corrected family-scoped pass bar, the already-built eligibility storage, the ATS-keyword-vs-sentence distinction.
- **The vertical seam came from the code, not the spec.** The corpus holds **16 postings but only 8 hand-authored requirement sets**, so eight postings cannot become cards at all — which makes "read an advert nobody curated" a slice with a demoable landing (**deck goes 8 → 16 cards**) rather than an architectural milestone with nothing to show.
- **Owner decision: unify the three band vocabularies** (`must/should/nice` vs `essential/standard/nice-to-have` vs `essential/desirable`) in #102. The option left open since the design pass — "or record why they differ" — is **declined**. Evidence it is accidental rather than meaningful: the card build already squashes `must` → essential and everything else → desirable, so the divergence carries no information, only a hand-written mapping at each boundary that nothing checks. That defect class never crashes; it reports a plausible wrong percentage. Written into #102's body, its ACs, and a comment so the reasoning survives a body rewrite. **Explicitly not decided: what the user reads on screen** — the rename is internal only.
- ⚠️ **There is no saved-jobs feature, and #109 does not build one.** The deck is recomputed over the whole pool on every request; nothing is stored per user, so nothing can have "got better" until #105 starts persisting scores. The re-score set is therefore *the adverts the user already has a stored score for*, **capped at the top N by existing score (start 20)**. Uncapped, a profile edit means thousands of paid judgements once live retrieval lands — free today at 16 fixture postings, ruinous later.
- **#104 will ship cards carrying a knowingly-bad number**, scored by the old token-overlap tick until #105 lands. Accepted deliberately — staging is not a pilot, and splitting the path from the judgement keeps both inside one context window. Named in the ticket so nobody "fixes" it by surprise.
- **Corrected on the way:** #98's gate read "**#94** passing" — #94 is the South Korea provider ticket, nothing to do with it. The real gate is the measurement harness (#110), now a native dependency on #111 rather than a sentence someone has to notice.
- **Deliberately untouched:** #86's spec body (the re-slice is a comment; the skill forbids modifying the parent), and #99–#101 / #92–#94, which belong to #54 and the provider research, not this spec.
- **Next session:** `/orchestrate-team` on **#102 + #103** — the only two unblocked tickets. **Build them sequentially, not in parallel worktrees**: no blocking edge exists between them, but both end up touching how a card is built (#102 changes the shape the deck reads, #103 adds the filter deciding which postings reach it). Expect the first session to produce nothing a user can see; the visible payoff is #104.
- **Housekeeping the next session should not sweep up:** the working tree carries pre-existing untracked files (six council reports + transcripts, `screenshots/`, `.claude/`, `.impeccable/`, `.tokensave/`, a web prototype, an e2e driver) and a modified `.gitignore`. None of it is this session's; decide what is meant to be tracked before anything commits.

## 2026-08-02 (session 58) — E5 design pass: 13 owner decisions, #86 re-sliced into nine

- **Design only. No product code changed.** `/grill-with-docs` on [#86](https://github.com/adrien-mounier/jobcrush-app/issues/86); spec rewritten, children re-sliced, `CONTEXT.md` extended.
- **Demonstrated the defect rather than asserting it** (throwaway vitest against the live `matchtick.ts`, deleted after): a CV saying **"3 years as a Project Manager" scores 100%** against an ad demanding "8+ years" — digits are stripped before comparison. "Ran weekly steering meetings with the CFO and the engineering leads" scores **0%** against "coordinate business and technical stakeholders", while **"wrote a blog post about"** the same phrase scores **100%**, and a **residential tower construction** project scores **100%** against "enterprise software delivery". `docs/card-quality-taste-test.md` (#14) had already found this across 60 pairs in July — its three named failure modes are now the acceptance bar for #97.
- **13 owner decisions**, all on [#86](https://github.com/adrien-mounier/jobcrush-app/issues/86). Headlines: the ad-reading pass also emits **posting family fit** (produced here, acted on by the feed); requirements split **blocking** (unmet → card withdrawn entirely, only on an explicit ad *and* an explicit user "no" — vague ad or unasked question never withdraws) vs **ordinary**; **eligibility facts** asked once at discovery with the dimension list earned from the corpus; the **years gap scores partially**; judging splits by **who wrote the words** (taps → deterministic, free text + cards → model); the **bubble is written freely as a recorded carve-out** from the no-invention rule; re-scoring **notifies** and persists so variance never surfaces as a mystery drop; **model chosen by measurement**, not assertion; unreadable ad → **no card** + a drop-rate alarm; curated opener retired **only after** the harness passes; **English-only now, architected to open up** (per-posting language tag, non-English retained-but-unread, user languages as a *list*, no silent translation).
- **Three findings from reading the code, not from reasoning:** (1) discovery shows **no** match % at all — `apps/web/app/discovery/page.tsx` has no `matchPct`, the reveal is a count — so the feared signup-vs-card contradiction does not exist; (2) `tailor.ts` documents that a tapped "Yes" is written **in the ad's own vocabulary** *"so matchTick's token-overlap coverage check fires"* — the product bends what it writes into a user's CV to satisfy a detector, and free text "may or may not cover the requirement", so typing real experience can move nothing; (3) `CandidateClaim` defines `field_key`/`field_value`/`field_label` but `CLAIMS_TABLE` has no such columns and `toClaim` hardcodes them `null` — structured facts are silently dropped, which is why "8 years" cannot be compared today.
- **Glossary** (`CONTEXT.md`): added **Blocking requirement**, **Eligibility fact**, **Posting family fit** — each distinguished from the neighbour it would otherwise be confused with (Important gap, source-supported fact, family placement).
- **Re-sliced #86** from five children to nine: #87 contract + [#95](https://github.com/adrien-mounier/jobcrush-app/issues/95) language gate → #88 read the ad + [#96](https://github.com/adrien-mounier/jobcrush-app/issues/96) eligibility facts → #89 scoring → {#90 bubble, #91 re-scoring} → [#97](https://github.com/adrien-mounier/jobcrush-app/issues/97) measurement harness → [#98](https://github.com/adrien-mounier/jobcrush-app/issues/98) retire the scorer + curated opener. #95 cross-linked to the pre-existing [#93](https://github.com/adrien-mounier/jobcrush-app/issues/93) (in-language *decision*) so the two are not done twice.
- **Left open deliberately:** one idea, three band vocabularies (`must/should/nice` vs `essential/standard/nice-to-have` vs `essential/desirable`) — pushed to #87, which is already versioning the contract.
- ✅ **The one blocking unknown was closed the same session** (owner provided the key; `docs/research/live-posting-retrieval-contract.md` §6). **Techmap returns the full advert, not a snippet** — 1,712/2,493/2,714 chars across three HK postings, no truncation, ends cleanly, already plain text with section headings marked, no HTML to strip. ~700 tokens, inside the cost estimate. **It is not in any top-level field** — the longest top-level string is `title`; the advert is in **`jsonLD.description`**. #88 unblocked, #86's design stands.
- **Three structured fields we were about to pay a model to infer:** `applicantLocationRequirements` (work eligibility → decisions 3/4 and #96), `validThrough` (provider-stated expiry → #85 §2.6), `skills` as a list. #85's `ProviderPostingRecordV1` should carry them rather than flattening into `excerpt`.
- **Decision 1 re-confirmed by accident:** a Hong Kong `"project manager"` search returned a dentistry faculty research assistant, a pharmaceutical key account manager, and a retail banking manager. Zero IT delivery roles in the sample.
- **Two operational facts now recorded so nobody rediscovers them:** the path is **lowercase** (`/api/v2/jobs/search`; capitalised 404s — cost me two round trips), and BASIC rate-limits **per second**, so burst probing returns 429s that read as successes if you are not careful. Last session's probe recorded its findings but not its endpoint; this one records both, plus the scripts.
- **Two owner corrections after the first write-up, both material:**
  1. **The ATS keyword rule is not the distortion.** I had conflated them and the wrong version was briefly on #86 and #98. Carrying the advert's **hard terms** is *required*: if the advert says SAP and the user has SAP, "SAP" must appear literally in the CV, in skills and/or an experience line — `docs/cv-brain/research/2026-05-03_it-pm-cv-best-practices.md` says *"mirror JD terminology exactly; embed keywords in bullets, not keyword clouds"*. What dies is restating the advert's **whole sentence** as the bullet to make our own token counter fire. Keep the term, drop the sentence. Corrected on both issues, and telling a named technology from generic phrasing is now explicitly the model's judgement, not a stopword list.
  2. **Length of experience is family-scoped.** "Eight years" alone is not a fact — eight years of IT project delivery is a different thing from eight years of employment, and "8+ years as a Project Manager" asks about one family.
- **Data model built, not just specified** (owner asked for it directly): `apps/api/src/eligibility.ts` — eligibility facts as their own store, keyed `(session, dimension, familyId)`, both drivers, 16 contract tests via pg-mem, init'd in `main.ts`. `familyId` is `"*"` for dimensions that hold regardless of role, non-null on purpose because two NULLs are never equal in Postgres and a nullable key column would silently stop enforcing uniqueness on exactly the global rows. Numeric dimensions reject an uncomparable value **at the write** rather than degrading to unknown at read. Unknown reads as null, never as "does not have it".
- **Live bug found and fixed on the way** (`claims.ts`): `field_key`/`field_value`/`field_label` are consumed by `pipeline.ts` (local conflict detection) and `server.ts` (import identity), and the claim-miner prompt tells the model to emit them — but `CLAIMS_TABLE` had no such columns and `toClaim` hardcoded all three to `null`. **Structured facts worked in memory and vanished in Postgres.** Columns, `ALTER`s, all three insert paths, and a driver-parity regression test. The in-memory driver also returned `undefined` where Postgres returned `null`; normalised, since "the two drivers behave identically" is that contract test's whole premise. 449 → 469 tests.
- **Spike: the core premise tested before building on it** (throwaway harness, deleted). 8 **uncurated** postings — natural APAC advert text, including every named failure case — × the taste test's 3 CVs, each CV scored in **its own call** so the model never compares them. Old scorer and new scorer on identical extracted requirements. **Inversions 1 → 0** (BNP: strong 35 / average 36 became 47 / 8); **weak CV 0 on all 8**; strong-vs-average separation ~2× → ~4×. One model only (no `ANTHROPIC_API_KEY` — model comparison stays #97's).
- **My pass bar was wrong and produced a false failure.** "Strong CV under 40 = undersell" never checked whether the advert was in the candidate's family, so it scored *correct rejection* of a business-analysis or crypto-strategy role as a defect — i.e. it penalised decision 1 for working. Only 4 of the 8 adverts came back `it-project-delivery`; on those the strong CV scored 26/40/47/60. Criterion is now family-scoped on #97.
- **The one suspicious score was hand-checked and is right.** BNP "PM / Lead Business Analyst, Regulatory Reporting" = 26. The advert wants Basel III / LCR / P&L / Balance Sheet domain knowledge, regulatory requirement translation, business-case analysis and APAC multi-country regulatory experience; the CV has none (1 full, 3 partial, 5 none of 9, each verdict individually correct). **The old scorer's 39 on the same pair was the wrong answer** — an oversell built on "project"/"manage"/"stakeholders". Domain mismatch is now visible; it was invisible before.
- ⚠️ **Blocking classification is prompt-fragile, and the failure mode is the worst one we have.** Same 8 adverts, two prompt wordings: **with** the definition (*"only a hard gate like a language, right to work, or a legally required licence"*) → 1 blocking across 8 adverts; **without** it → 4 on a single advert, including *"Drive regular, clear communication with all stakeholders"*. Since a blocking miss withdraws the card entirely, an undefined `blocking` silently deletes winnable jobs. The definition is now pinned as contract on #88 with a regression test and an observable blocking rate.
- **Also recorded on #97:** the new scorer runs harsher (strong-CV mean 37 → 32), so anything calibrated on today's numbers needs re-baselining before #98 removes the curated opener; and the 3 CVs must be checked in as fixtures — they currently exist only as prose in `docs/card-quality-taste-test.md`, so the grid is not reproducible.
- ⚠️ **Tracker hole, same shape as the E5 one — found and closed same session.** #85 defined the retrieval contract and picked Techmap, then closed; **the provider integration was never filed**, so #86's engine had nothing to read and #63 was blocked on a ticket that did not exist. Filed as [#99](https://github.com/adrien-mounier/jobcrush-app/issues/99) contracts + provider registry + `dedupePostings` (pure, no I/O, fully fixture-testable) → [#100](https://github.com/adrien-mounier/jobcrush-app/issues/100) Techmap client + posting store (carries the §6 probe facts: lowercase path, per-second rate limit, advert body at `jsonLD.description`, structured fields taken not inferred) → [#101](https://github.com/adrien-mounier/jobcrush-app/issues/101) `retrievePostings`, the server-owned boundary #63 calls. **#101 now blocks #63**, recorded as a comment there; its old blocker #61 is closed. **This is twice in two days that a decision was written into a doc and never became buildable work** — the lesson from 57b ("reconcile the tracker against the roadmap before claiming a frontier") did not catch it, because #85's own body said "and its implementation tickets" as though they existed.
- **Caught mid-session: I had skipped two lifecycle steps and implied otherwise.** The owner asked whether `/to-spec` had been run — it had not. I hand-wrote the spec and the ticket bodies rather than invoking `/to-spec` and `/to-tickets`, then said "that needs `/to-tickets`" as though the earlier step were done. Both skills exist in `~/.claude/skills/`.
- **What skipping them actually cost:** (1) **the test seams were never pinned** — `/orchestrate-team` drives `/tdd` at exactly the seams a spec declares, and the skill requires confirming them with the owner; (2) **the slicing was horizontal**, one layer per ticket, none independently demoable — I had even presented "pure → I/O → orchestration" to the owner as a virtue, which is textbook layered decomposition and precisely what the tracer-bullet rule forbids; (3) no native blocking links, no `ready-for-agent` label, no user-story enumeration.
- **`/to-spec` run properly.** Seams pinned and owner-confirmed: **API boundary** (primary, LLM faked — everything a user perceives is observable there), **contract oracle** (repo rule), **store contract** (both drivers). Three existing seams, no new ones. Model output quality is explicitly a **release gate, not a seam** — non-deterministic, paid, network-bound; it gates the release and the curated-opener retirement, never the commit. #86 rewritten to the spec template (problem, solution, **30 user stories**, implementation decisions, testing decisions, out of scope, **six carried risks each naming its mitigating ticket**) and labelled `ready-for-agent`. The pre-spec body is preserved as a comment — the spec is a synthesis, that is the audit trail.
- **`/to-tickets` deferred to a fresh session, deliberately.** The skill is `disable-model-invocation`, so only the owner can launch it — but a fresh session is the better call regardless: this one spent an hour writing and defending the wrong slicing, and would slice under that anchor. The spec plus its design record now live on the tracker, and the skill takes an issue number and fetches it with `--comments`, so a cold start has everything.
- **Handoff written onto #86** so the next pass does not regenerate blind: which nine children exist, that they are horizontal and to be superseded rather than duplicated, and — the real risk — **which measured findings must survive** (#88's blocking-definition measurement, #97's corrected family-scoped bar and spike numbers, #96's already-built storage, #98's ATS-keyword-vs-sentence-copying distinction). All nine also carry a "do not build from this yet" comment; none is `ready-for-agent`, so none is agent-grabbable meanwhile. #99–#101 are noted as out of remit — they belong to #54, not this spec.
- **Still not agent-grabbable** — `/to-tickets #86` in a fresh session is the next step. #96's storage half is done; its remaining work is the asking.

## 2026-08-01 (session 57b) — Techmap chosen, coverage measured, E5 filed

- **Closed:** [#85](https://github.com/adrien-mounier/jobcrush-app/issues/85) (retrieval contract + provider pick), [#53](https://github.com/adrien-mounier/jobcrush-app/issues/53) (R2 presigned PUT, shipped 2026-07-27).
- **Filed:** spec [#86](https://github.com/adrien-mounier/jobcrush-app/issues/86) + tickets [#87–#91](https://github.com/adrien-mounier/jobcrush-app/issues/87) (E5 per-ad engine, **fresh design not a port** — owner decision); [#92](https://github.com/adrien-mounier/jobcrush-app/issues/92) cross-provider duplicate rate; [#93](https://github.com/adrien-mounier/jobcrush-app/issues/93) Japan/China in-language; [#94](https://github.com/adrien-mounier/jobcrush-app/issues/94) Korea needs its own provider. **#89 blocks #63.**
- **Provider decision (owner):** **Techmap** for the SE-Asia cluster — $1/1,000 postings, and the only provider across three research rounds whose terms *explicitly* permit storing postings for candidate matching. Launch set **HK, SG, MY, VN, AU, NZ** (~60 relevant IT-delivery postings/day, measured). Tier-2 thin: ID, PH, TH.
- **Contract is multi-provider (schemaVersion 2)** per the owner's per-country-provider principle: canonical posting over per-provider records, provider registry as data with storage/matching permission defaulting to `false` (an unconfirmed provider structurally cannot activate), search-area routing, and `coverage` as a qualifier so a zero is only ever an empty pool when every provider answered.
- **Measured, not vendor-published** (free RapidAPI BASIC key, 18 markets, day sampled 2026-07-30): Techmap's published volumes check out. **Only 3–4 of 10 HK `"project manager"` postings are IT/digital delivery** — the rest construction, building services, one youth charity. **"Programme manager"/"delivery manager" are near-absent in HK/SG/VN** — APAC vocabulary is "project manager". **Japan is Techmap's deepest market here (17,796/day, 2x Australia) but unreadable in English**; Korea is genuinely uncovered (77/day).
- **Two process failures, both self-inflicted, both now fixed durably:** (1) E5 was named in `roadmap.md` and `CLAUDE.md` as the next slice but never filed, so a tracker-only frontier query missed it and #63 was sequenced as buildable — now filed as #86–#91. (2) Two research rounds were briefed against a UK/EU market that `apps/api/data/sample-postings.json` (HK/VN/AU, zero UK/EU) already contradicted — market decision now written into `roadmap.md`. Lesson recorded: **reconcile the tracker against the roadmap's stated next slice before claiming a frontier; check the repo's own data before asserting market context.**
- **Commits:** `1029f06`, `55dee73`, `a1cd81e`, `930820e`, `deef5de`, `e976744`, `0db3517`, `77196f9`, `a525553`. Gates green on every push.
- **Next:** #86 needs a design pass (`/grill-with-docs` → `/to-spec`) before its children are agent-grabbable. Nothing is `ready-for-agent` until then.

## 2026-08-01 (session 57) — live-posting source: contract specified, vendor pick pending

- **Tickets:** [#85 live-posting retrieval contract](https://github.com/adrien-mounier/jobcrush-app/issues/85) (claimed, **left open** pending the owner's provider pick); [#53 R2 CORS + presigned PUT](https://github.com/adrien-mounier/jobcrush-app/issues/53) **closed** (shipped `46c6abd` on 2026-07-27; temp admin R2 token confirmed deleted 2026-08-01).
- **Frontier finding:** the whole remaining onboarding chain (#63 → #64 → #65 → #66, #63 → #67 → #68, all → #69) is a near-straight line gated on #85 alone. No other buildable ticket exists — #51 awaits an owner eyeball on staging, #32 is an owner infra task.
- **Delivered:** `docs/research/live-posting-retrieval-contract.md` (`55dee73`) — costed provider shortlist verified against live vendor docs (Adzuna, Reed, Jooble, JSearch, Greenhouse/Lever, EURES, Arbeitnow, curated-manual-pool), plus the provider-neutral request/posting/result/error contract: fail-closed liveness, four never-collapsed outcomes (empty pool / provider unavailable / stale data / invalid request), server-owned retrieval inputs with an explicit forbidden list, intent-change invalidation scoped to retrieval state only, and the seams/testing plan.
- **Recommendation (owner's call, not taken):** Adzuna, gated on a **hard legal step** — its ToS caps commercial API use at a 14-day trial absent a written agreement, and bars aggregation "to deliver any ongoing work" without written consent, which is arguably what a persistent matching product is. Runner-up JSearch (self-serve pricing, but inherits scraping-chain risk). Zero-ToS-risk fallback: curated manual pool. Indeed and LinkedIn are not options at all (Publisher API retired; no self-serve read API + contractual scraping ban).
- **The bigger finding, verified against the code:** even with a provider, #63 cannot compute a match score. `matchPct`/`breakdown`/`fit`/`dontYet` need per-posting `AdRequirements`, which exist only as a hand-authored fixture (`apps/api/data/sample-ad-requirements.json` via `apps/api/src/e5stub.ts`, whose own header states it stubs the real cluster engine). Generating them for a live posting is **E5's** job. `CLAUDE.md` already sequences S3 as "E5 cluster engine first" — #63 as written skips it. Posted as a clarification on #63; #63 is now additionally blocked on that ordering decision.
- **Open owner decisions:** provider strategy; a real $ ceiling at pilot volume and 10x; whether E5 lands as its own ticket ahead of #63 or folds into it; if Adzuna, authorize contacting them for written consent.
- **Commits:** `1029f06` (#53 record), `55dee73` (the contract). Gates green both pushes.

## 2026-07-29 (session 56) — validated production discovery

- Implemented [#61 Activate production discovery only for validated family versions](https://github.com/adrien-mounier/jobcrush-app/issues/61) across the production-floor catalog, adaptive engine, HTTP transition gates, and both session-store drivers.
- A server-authoritative confirmed placement pins one immutable published version. Current source-supported/reworded evidence and explicit negatives cover essential items once; inferred claims do not. Evaluate, answer, resume, and completion all reconcile current coverage truth.
- Added fail-closed gates for client-manufactured placement, fixtures, provisional/missing publications, clarification/unmapped outcomes, malformed/forged persistence, stale completion, unknown items, and missing authentication. Rejected production answers leave claims, negatives, and session state unchanged.
- PostgreSQL-compatible reconciliation uses a row lock and one transaction; both drivers preserve the pinned version while replacing coverage/checkpoint with one coherent current snapshot.
- Two-axis review ended Standards clean and Spec clean after removing an invalid validation-data classifier shortcut and closing concurrency, stale-state, trust-boundary, and side-effect defects. Independent QA found and fixed an uncached TypeScript boundary failure and stale persisted resume state.
- QA GO: 473 tests passed + 5 skipped with cache bypass, typecheck 7/7, build 5/5 with 12/12 pages, and live assembled HTTP coverage over in-memory and PostgreSQL-compatible compositions.
- **Next:** closing #61 removes the production-discovery blocker from [#63 server-owned credible match reveal](https://github.com/adrien-mounier/jobcrush-app/issues/63); re-query its remaining dependency edges before claiming.

## 2026-07-29 (session 55) — initial production family floor

- Implemented [#60 Validate and publish initial production family floors](https://github.com/adrien-mounier/jobcrush-app/issues/60) as a production-only publication catalog distinct from #58 fixtures.
- Researched four representative live postings across Datadog, Cloudflare, Scale AI, and Asana; the shared floor is grounded in end-to-end delivery, cross-functional coordination, risk/dependency control, and stakeholder communication rather than title matching.
- Added a reproducible grouped/held-out placement evaluation runner and hashed artifact covering comparable, ambiguous, and near-OOD roles. Publication regenerates and exact-matches evaluation output before applying the 95% comparable, 90% unfamiliar-recall, and 5% false-unknown gates.
- Added explicit published-only activation, fixture non-promotion, immutable and monotonically increasing versions, normalized employer diversity, unique evaluation IDs, and `GET /family-floors/:familyId/active`.
- Two-axis review ended Standards GO and Spec GO after closing provenance, version-regression, trust-boundary, and duplicate-ID defects. QA GO: 447 tests passed + 5 skipped, typecheck 7/7, build 5/5, focused floor tests 23/23, and compiled HTTP returned 200 for the published floor and 404 for an unavailable family.
- **Next:** #60 unblocks one edge of [#61 production discovery activation](https://github.com/adrien-mounier/jobcrush-app/issues/61); re-query its remaining blockers after deployment.

## 2026-07-28 (session 54) — unmapped-role family learning

- Implemented [#62 Unmapped-role family learning and return lifecycle](https://github.com/adrien-mounier/jobcrush-app/issues/62) on top of landed #59 without borrowing its confirmed-family discovery floor.
- Added privacy-minimized in-memory/PostgreSQL candidate and lifecycle stores, atomic exact deduplication, grounded semantic-equivalent/covered-family links, transactional audit events, and durable correction/resumption states.
- Added strict LLM screening through the existing model seam, operator-key-only lifecycle progression, normal-auth account resolution, and idempotent Resend notification delivery that never marks a user notified before provider success.
- Two-axis review ended Standards GO and Spec GO after concurrency, transaction, trust-boundary, production-wiring, grounding, and PII-error fixes. Independent QA GO: 404 tests passed + 5 skipped, focused #62 26/26, uncached typecheck 7/7, build 5/5.
- **Next:** #62 removes one dependency from [#68 anonymous retention/consent](https://github.com/adrien-mounier/jobcrush-app/issues/68) and [#69 pilot observability](https://github.com/adrien-mounier/jobcrush-app/issues/69); re-query their remaining blockers before claiming.

## 2026-07-28 (session 53) — fixture-driven adaptive discovery

- Implemented [#59 Fixture-driven adaptive discovery engine](https://github.com/adrien-mounier/jobcrush-app/issues/59) as a fixture-only Fastify seam driven by an exact confirmed immutable family-floor version; fixture data remains structurally unable to unlock production reward.
- Added variable-floor evaluation with imported and semantic-equivalent coverage, ranked next-question selection without a fixed cap, first-class explicit negatives, idempotent corrections, and coherent evidence/root-CV/progress responses.
- Fixed PostgreSQL claim parity by safely migrating and round-tripping `semantic_key`, including legacy-row fallback and shared in-memory/Postgres correction coverage.
- Two-axis review finished clean after the PostgreSQL must-fix. Independent QA GO: 402 tests passed + 5 skipped, typecheck 7/7, build 5/5, focused #59/store tests 69/69, live HTTP/session-isolation and old-schema migration checks green.
- **Next:** #59 unblocks [#61 production discovery activation](https://github.com/adrien-mounier/jobcrush-app/issues/61) once [#60 production family-floor validation](https://github.com/adrien-mounier/jobcrush-app/issues/60) lands; #62 remains owned by its separate session.

## 2026-07-28 (session 52) — three-way family-floor contracts

- Implemented [#58 Three-way family-floor contracts](https://github.com/adrien-mounier/jobcrush-app/issues/58) as the contract/store foundation for honest role placement.
- Added authoritative `.mjs` oracle and matching Zod v1 contracts for `confirmed`, `needs_clarification`, and strict `unmapped` outcomes; clarification alternatives must be distinct versioned families.
- Added ranked essential-floor structure with question metadata, root-CV evidence destinations, explicit-negative semantics, and fixture-only literals that cannot unlock production discovery reward.
- Added a deeply immutable fixture floor store while retaining legacy `FamilyFloor` v0 compatibility for the current discovery path.
- Two-axis review found and closed fail-safe validation, alias immutability, and duplicate-choice defects; both re-reviews returned GO.
- QA GO: 393 tests passed, 5 skipped, typecheck 7/7, build 5/5. No browser seam exists in this contract-only slice.
- **Next:** [#59 Fixture-driven engine](https://github.com/adrien-mounier/jobcrush-app/issues/59), now unblocked by #58.

## 2026-07-28 (session 51) — explicit target role and search area

- Implemented [#57 Collect explicit target role and search area](https://github.com/adrien-mounier/jobcrush-app/issues/57) as the next durable first-run checkpoint after question-first or continued CV proof.
- Added strict partial `GET`/`PUT /sessions/me/intent` HTTP contracts and atomic in-memory/Postgres persistence. One explicit field leaves only the other missing; CV history and residence remain non-intent.
- Added accessible both-field and one-field forms, truthful saved confirmation, mobile-safe layout, retry/validation states, and authoritative reload restoration for question-first and CV paths.
- Two-axis review ended GO after aligning store-driver merge semantics, proving the one-field case through public HTTP, and correcting CV-path restore/copy.
- Independent fresh-stack QA GO: 4/4 serial Chromium journeys, 384 tests passed + 5 skipped, typecheck 7/7, build 5/5. The optional highlighted HTML wrapper hung before finalization; durable Playwright coverage passed and no product defect was found.
- **Next:** continue the onboarding frontier with [#58 smallest useful family-backed question set](https://github.com/adrien-mounier/jobcrush-app/issues/58).

## 2026-07-28 (session 50) — provenance-aware CV import proof

- Implemented [#56 CV import proof with provenance, corrections, and
  recovery](https://github.com/adrien-mounier/jobcrush-app/issues/56) across the
  existing anonymous source-entry flow—no parallel CV onboarding path.
- Versioned CandidateClaims to v1 with oracle/Zod/JSON Schema parity, stable
  semantic and field identities, human-readable field labels, and exhaustive
  golden mutations. Equivalent source facts now merge once; inferred claims
  earn no proof or matching credit.
- Added durable import proof and atomic correction persistence across in-memory
  and Postgres stores. Initial conflicts remain field-local, resolutions survive
  changed-ID/text re-imports, readable facts survive parser warnings, and
  failed/no-useful-facts states preserve retry and question-first recovery.
- Extended the first-run UI with truthful facts/counts, exact `From your CV`
  provenance, accessible correction/error states, 360px-safe layouts, and
  terminal-state restoration without repeated focus or announcements.
- Two-axis review ended GO with no findings. Independent QA GO: API 358 passed
  + 5 skipped, contracts 19/19, typecheck green, forced uncached build green,
  front-door Playwright 16/16, and human-paced mobile evidence 7/7.
- **Next:** close #56 and continue the onboarding frontier with [#57 explicit
  target role and search area](https://github.com/adrien-mounier/jobcrush-app/issues/57).

## 2026-07-28 (session 49) — full JobCard match breakdown

- Implemented [#52 Deck card: full essential/desirable match
  breakdown](https://github.com/adrien-mounier/jobcrush-app/issues/52): the
  fit-weighted scoring seam now returns server-authoritative essential
  (`must`) and desirable (`should` + `nice`) met/total counts for both Deck and
  Tailor.
- Added the versioned `JobCardV1` Zod contract and a full-parity `.mjs` oracle
  without changing the legacy card-payload oracle. The shared card renders the
  approved four-cell overall/essential/desirable/quality grid with semantic
  description-list markup, exact accessible names, and atomic Tailor updates.
- Two-axis review found and resolved oracle/Zod shape drift, the missing client
  version discriminator, and accessible-name copy drift. Independent QA GO:
  347 passed + 5 skipped, typecheck 7/7, build 5/5, focused Playwright 8/8,
  and a human-paced mobile evidence drive 8/8.
- **Next:** closing #52 removes one blocker from #65; continue the #54
  onboarding frontier after the separately owned #55 session closes.

## 2026-07-28 (session 48) — persistent first-run source-entry spine

- Implemented [#55 First-run invitation and persistent source-entry
  spine](https://github.com/adrien-mounier/jobcrush-app/issues/55): the accepted
  centered invitation now opens source assistance anonymously on `/`, with CV,
  disabled/non-collecting LinkedIn, and question-first actions in one common flow.
- Added a strict `SourceEntry` HTTP contract and last-write-wins persistence across
  the in-memory and Postgres session stores. `invited`, `cv`, and `questions`
  checkpoints restore after reload; malformed and LinkedIn writes fail closed.
- Two-axis review passed after correcting exact recovery/privacy copy, short-viewport
  scrolling, retry target size, and load/save rollback coverage. QA caught and fixed
  a typed Fastify 401 response-schema omission before release.
- Gates: API 339 passed + 5 todo; contracts 18/18; focused source-entry store/HTTP
  tests 62/62; Chromium front-door journey 7/7; full typecheck 7/7; forced build 5/5.
- **Next:** close #55 and continue from the newly unblocked #56/#57 frontier.

## 2026-07-28 (session 47) — first-run onboarding implementation spec

- Published [Source-assisted first-run onboarding to a credible job
  reveal](https://github.com/adrien-mounier/jobcrush-app/issues/54) with the
  `ready-for-agent` label from the completed Wayfinder map and normative design.
- The PRD carries 73 user stories, existing Fastify HTTP and Playwright browser
  seams, durable checkpoint/evidence contracts, explicit scope boundaries, and
  ticket-shaped mitigations for the accepted pilot risks.
- **Next:** run `/to-tickets` on the spec before implementation.

## 2026-07-28 (session 46) — decision-complete first-run onboarding design

- Rewrote
  [`docs/onboarding-reward-design.md`](docs/onboarding-reward-design.md) around
  one normative invitation → source assistance → adaptive discovery → credible
  reveal → late signup → ranked deck → Tailor journey.
- Reconciled imported evidence, explicit negatives, family placement,
  privacy-minimized unmapped-role learning, no-vacancy handling, Important gaps,
  truthful resumption, and invitation-only pilot gates.
- Resolved [Rewrite the onboarding reward design around the resolved
  flow](https://github.com/adrien-mounier/jobcrush-app/issues/47), completing the
  [first-run onboarding revision
  map](https://github.com/adrien-mounier/jobcrush-app/issues/40).
- **Next:** run `/to-spec`, then `/to-tickets`, before implementation.

## 2026-07-28 (session 45) — Wayfinder: cross-flow resilience and pilot validation

- Resolved [Define cross-flow resilience, accessibility, validation](https://github.com/adrien-mounier/jobcrush-app/issues/46) with an invitation-only pilot boundary, honest animated waiting states, 10-second delayed messaging, 60-second safe exit, checkpoint-complete interruption recovery, and failure paths that preserve work.
- Set measurable gates for first-job relevance, family classification and novelty detection, necessary-question rate, CV-assisted question reduction, time to reveal, and Important-gap comprehension. Every early pilot CV and first match receives manual evidence review under the existing CV-brain classification contract.
- Settled retention: ordinary anonymous unfinished data expires after 7 days; consented pilot data may remain identifiable for up to one year for product and model improvement, with earlier deletion on explicit request.
- Formal keyboard-only, screen-reader, and reduced-motion compatibility is explicitly out of scope for this revision. Updated the [Wayfinder map](https://github.com/adrien-mounier/jobcrush-app/issues/40); [Rewrite the onboarding reward design around the resolved flow](https://github.com/adrien-mounier/jobcrush-app/issues/47) is now unblocked.

## 2026-07-28 (session 44) — Corrective fix: remove discovery's forced blank CV page

- Owner production screenshot at 2048×1118 disproved session 43's completion claim: the ask no
  longer stretched, but the empty CV still rendered as an 864px A4 sheet with its own scrollbar,
  and the shared header row still reserved dead space above it.
- Replaced the split header/main grids with two independent semantic column stacks. Desktop CV and
  ask content now size intrinsically; the CV only scrolls after real content exceeds the viewport.
  Mobile/tablet preserve the progress → CV → dock reading order through responsive `display: contents`.
- Regression geometry now rejects non-auto CV aspect ratios and oversized sparse previews, adds the
  reported 2048×1118 viewport, and still covers every ask shape. Focused discovery suite: 7/7 green.
- **Next:** continue the planned downstream discovery-to-Tailor journey audit from issue #45.

## 2026-07-28 (session 43) — Fix: discovery layout adapts across every question state

- **Root cause:** the desktop A4 CV forced the shared row height and the ask card stretched to match
  it. The wrapper introduced for that two-column layout also had no flexible-height rules in stacked
  mode, so answering could push the dock below the viewport.
- Replaced the equal-height coupling with viewport-owned layout: independent content-sized ask,
  scrollable CV remainder, intrinsic A4 document shape, and a two-column breakpoint that only
  activates when both columns have useful width. Stacked phone/tablet screens now give their main
  wrapper the remaining height and cap only genuinely tall asks with internal scrolling.
- Added geometry regression coverage for role entry, expanded suggestions, four-option, two-option,
  free-text, negative-answer notice, correction, and handoff states at 390×844, 768×1024, and
  1440×900. Focused discovery Playwright suite: 7/7 green; visual captures reviewed at all three
  sizes.

## 2026-07-28 (session 42) — Wayfinder: unmapped-role family learning workflow

- Resolved [Define the unmapped-role family learning workflow](https://github.com/adrien-mounier/jobcrush-app/issues/50):
  keep the common onboarding path, pause unknown-role reveals, and use the normal account wall with
  “Create your account and we’ll notify you when your first matches are ready.”
- Anonymous submissions become privacy-minimized research candidates. Abuse filtering, LLM relevance
  screening, normalization, and deduplication precede reusable family research; one credible target
  can trigger a versioned, validated family build.
- Signed-up users resume automatically after publication and are notified only when a credible
  vacancy exists. Failed or rejected attempts return users to role correction rather than waiting
  indefinitely.
- Monitoring covers the full attempt lifecycle from submission through notification, including
  stage conversion, latency, failures, stuck work, family publication, match delivery, and signup.
- Added `Family research candidate`, `Family learning`, and `Family learning attempt` to
  `CONTEXT.md`. The next map frontier is
  [Audit the downstream journey from discovery to Tailor](https://github.com/adrien-mounier/jobcrush-app/issues/45).

## 2026-07-28 (session 41) — Fix: Google sign-in broken on staging after jobcrush.org move

- **Symptom:** on https://jobcrush.org, "Continue with Google" hit a Google **`Error 400: redirect_uri_mismatch`** page before the account picker.
- **Root cause:** the domain move to `jobcrush.org` (session 38 updated the `WEB_URL` Fly secret) changed the `redirect_uri` the API sends to Google from `https://jobcrush-web-staging.fly.dev/api/auth/google/callback` to `https://jobcrush.org/api/auth/google/callback` — but the new URI was never added to the Google Cloud Console's authorized redirect URIs (only the old `fly.dev` + localhost entries were registered 2026-07-19). Google rejects unregistered redirect URIs at the consent screen, so the app's `?login=expired` bounce was never reached.
- **Fix (owner, no code):** added `https://jobcrush.org/api/auth/google/callback` to the OAuth client's authorized redirect URIs in the Google Cloud Console (kept the old `fly.dev` + localhost entries). Verified live — Google sign-in now completes on staging. No redeploy needed.
- **Second fix shipped (latent local-dev bug, separate from the staging issue):** `cookieSecure` in `routes/auth.ts:44` and `routes/sessions.ts:34` marked cookies `Secure` when `APP_ENV` was unset — the default `pnpm dev` state — so browsers dropped the session + OAuth-state cookies over `http://localhost` and both Google and magic-link sign-in failed silently locally. Changed to `(process.env.APP_ENV ?? "local") !== "local"` to match the healthz convention (`server.ts:127`). Staging/prod unchanged (`APP_ENV=staging` explicit). Lessons updated (redirect-URI-on-domain-move + unset-APP_ENV cookie default).
- **Commits:** (this push).

## 2026-07-27 (session 40) — Fix: R2 uploads go straight to R2 again (#53, option 1)

- **Ticket:** [#53 — R2: configure bucket CORS and revert to presigned-PUT uploads](https://github.com/adrien-mounier/jobcrush-app/issues/53).
- **Goal:** revert the `deeeecf` staging workaround (upload bytes routed through the API) so the
  browser PUTs straight to R2 again.
- **Root cause recap:** the `jobcrush-staging` R2 bucket had no CORS rule for `jobcrush.org`; the
  first boot-time `PutBucketCors` attempt (`fd5cef6`) failed silently because the scoped R2 token
  lacked bucket-config permission.
- **Discovery:** the Cloudflare dashboard can scope only Object Read & Write to a single bucket —
  Admin Read & Write is account-wide (would touch vitacairn too, breaking the shared-infra
  one-token-one-bucket rule). So the ticket's original "admin, scoped to jobcrush-staging" approach
  isn't available through the dashboard.
- **Fix (option 1, owner-chosen):** keep the existing object-scoped R2 token in Fly (unchanged).
  Set CORS once with a **temporary** admin R2 token via `pnpm --filter @jobcrush/api set-r2-cors`
  (`apps/api/scripts/set-r2-cors.mjs`) — `PutBucketCors` + `GetBucketCors` read-back verification;
  temp token deleted right after. Code reverts `presignPut` to a presigned `getSignedUrl` PUT (bytes
  straight to R2) and removes the boot-time `ensureCors` (the object token can't `PutBucketCors`, so
  calling it on boot would fail silently — the original bug). New `pnpm --filter @jobcrush/web
  e2e:r2-cors` preflight check guards the real R2 path from rotting (not in `pnpm test` — CI uses
  `InMemoryBlobStorage`). Not self-healing; re-run the one-shot if the bucket is ever recreated.
- **Status:** CORS set on bucket + verified by read-back; pushed `46c6abd` + deployed to staging;
  CORS preflight + real PDF/DOCX/TXT PUT to R2 all verified live on jobcrush.org (204 / 200 +
  `Access-Control-Allow-Origin: https://jobcrush.org`); temp admin R2 token deleted by the owner
  (confirmed 2026-08-01). **#53 closed 2026-08-01.**
- **Commits:** `46c6abd`. Lesson updated in `lessons.md`.

## 2026-07-26 (session 39) — Wayfinder: reconciled + closed onboarding map #40

- **Map:** [#40 — Revise first-run onboarding, invitation → Tailor](https://github.com/adrien-mounier/jobcrush-app/issues/40). **Closed — destination reached** (decision-complete first-run revision).
- **Reconciliation:** three first-run decisions had been made off-map (in prototypes + the Jul 22 council run, or as implementation tickets under spec #11) and never recorded on the map; the design doc's Open section still listed two as unresolved. All three now recorded in the map's Decisions-so-far:
  - [#18](https://github.com/adrien-mounier/jobcrush-app/issues/18) — in-flow fact correction (shipped). Post-discovery correction ruled **out of scope**; sibling to "revise profile as life changes," deferred to a future profile-editing effort.
  - [#22](https://github.com/adrien-mounier/jobcrush-app/issues/22) — wall at the reveal / entering the deck (shipped). §12's "open again" note resolved.
  - [#51](https://github.com/adrien-mounier/jobcrush-app/issues/51) — desktop onboarding redesign (Discovery B, Tailor B, Deck breakdown); building.
- **Design doc:** struck the stale Open items (fact correction, wall position) in `docs/onboarding-reward-design.md`; updated §12's inline note to decided.
- **Lesson:** the map drifted from the build — implementation tickets resolved map-level decisions without being recorded back on the map. Check a map's Open section against shipped code before treating an item as unresolved.
- **Commit:** (this push).

## 2026-07-26 (session 38) — Fix: CV uploads broken on staging (R2 CORS)

- **Symptom:** on https://jobcrush.org, every CV upload (PDF/DOCX/TXT) failed at the front door with
  *"Couldn't upload that — check your connection."* Looked PDF-specific only because most CVs are PDFs.
- **Root cause:** the browser PUTs the upload straight to a presigned R2 URL (cross-origin); the
  `jobcrush-staging` bucket had no CORS rule for jobcrush.org, so R2 replied `403 "CORS not configured
  for this bucket"` to the preflight and the PUT never fired. The presigned URL, storage, and pipeline
  were all healthy (verified by PUTting via curl, which ignores CORS — full flow completed).
- **Second bug found:** `WEB_URL` on `jobcrush-api-staging` was `https://jobcrush-web-staging.fly.dev`,
  not `https://jobcrush.org` — breaking magic-link emails + OAuth redirects. Owner set it to
  `https://jobcrush.org` (Fly secret), which also fixed login links.
- **Fix shipped (option 3):** `R2Storage.presignPut` returns the API-relative `/uploads/:id/content`
  path, so the browser PUTs same-origin through the Next proxy and the API writes to R2 server-side.
  No CORS, no extra R2 bucket permissions. First tried option 2 (API sets CORS on boot via
  `PutBucketCors`), but the scoped R2 token can't `PutBucketCors` — the call fails every boot
  (swallowed) and the bucket never updated to jobcrush.org even after a clean restart. Reverted
  `ensureCors`; kept `WEB_URL` fix. Tradeoff: upload bytes (≤10 MB) flow through the API. Lesson +
  revert notes in `lessons.md`. Green gate passed.
- **Commits:** `fd5cef6` (option 2 attempt + WEB_URL diagnosis), (this push) (option 3).

## 2026-07-26 (session 37) — Wayfinder: adaptive discovery and unmapped job families

## 2026-07-26 (session 37) — Wayfinder: adaptive discovery and unmapped job families

- **[Define adaptive discovery after source import](https://github.com/adrien-mounier/jobcrush-app/issues/44).**
  Resolved intent recovery, semantic question skipping, value-ordered questioning, and the reveal
  gate. Past roles and current residence suggest but do not establish search intent; the mandatory
  reader-only question is removed; relevant ranked jobs retain the simple reveal while Important
  gaps are explained on cards without blocking truthful tailoring or application.
- **Known, ambiguous, and unmapped families.** High-confidence semantic classification continues,
  ambiguity goes to the user, and below-threshold roles are never forced into the nearest family.
  Unmapped roles create an asynchronous Family research request with an anonymous resume link and
  optional consented notification email. Captured the domain language and roadmap in `17ff463`.
- **Classification research.**
  [Research robust job-family classification and novelty detection](https://github.com/adrien-mounier/jobcrush-app/issues/49)
  resolved on `research/job-family-classification-novelty-49` at `da7935d`: nearest-neighbor
  similarity retrieves candidates but cannot safely detect unknowns; calibrated support, local
  density, and top-two separation drive automatic placement, clarification, or rejection.
- **New frontier.**
  [Define the unmapped-role family learning workflow](https://github.com/adrien-mounier/jobcrush-app/issues/50)
  is now unblocked and blocks the downstream journey audit. The downstream and validation tickets
  explicitly own Important-gap card treatment and quantitative thresholds.

## 2026-07-26 (session 36) — `/orchestrate-team`: closed #39 factbadge Profile harness debt

- **#39 — current Profile journey.** Shipped `25ea282` (`Closes #39`). Replaced the retired
  `.loadstate` placeholder checks in the real-stack factbadge driver with the current Profile
  contract: badge count matches the focused Profile heading, Sorted and Constellation both render,
  Back returns to the sender, and keyboard Enter on the badge still opens Profile.
- **Rate-limit-safe browser proof.** Documented that the driver must run serially under the
  12-anonymous-sessions/IP/hour limiter. Red-before-green reproduced 39 passes / 4 stale failures;
  the developer and independent QA runs both finished 44/44 with only three serial sessions total.
- **Review + QA.** Standards and Spec reviews returned zero findings. Cache-bypassed QA passed
  344 tests / 5 skipped, typecheck 7/7, build 5/5 with 12/12 routes, and the orchestrator push gate
  stayed green. The implementation ticket frontier is empty; the separate design frontier remains
  [#44 adaptive discovery](https://github.com/adrien-mounier/jobcrush-app/issues/44).

## 2026-07-26 (session 35) — Wayfinder: imported-evidence trust and recovery

- **[Define imported-evidence trust, merging, and recovery](https://github.com/adrien-mounier/jobcrush-app/issues/43).**
  Resolved the first-run import trust model: explicit source facts and defensible semantic
  equivalents receive full first-match credit; equivalent facts across sources merge and score
  once; conflicts are field-local; system inferences only select follow-up questions.
- **Import UX and recovery.** A compact result proves useful facts and skipped questions without
  recreating confirmation. Partial imports retain readable value; total failures remain on the
  source screen with retry and start-from-scratch paths. User corrections take precedence, source
  attribution replaces "unverified" labels, and later certification uses one aggregate review.
- **Domain language.** Added `CONTEXT.md` in `e2096ae` with source-supported fact, system inference,
  corroborated fact, and user-resolved fact. The map's next frontier is
  [Define adaptive discovery after source import](https://github.com/adrien-mounier/jobcrush-app/issues/44).

## 2026-07-26 (session 34) — `/orchestrate-team`: #26 fit-weighted match scorer

- **#26 — coherent, fit-weighted evidence.** Implemented in `62e8a81` (`Closes #26`). Requirements
  are split into meaningful clauses; each clause is judged against one best coherent fact, while
  separate clauses may use separate facts. A small ad-level breadth term rewards distinct relevant
  evidence without letting duplicate or filler-modified facts inflate the score. Score and
  uncovered-gap text now share one `requirementFit` decision, and any open requirement caps the
  displayed score at 99.
- **Taste-test contract.** Restored the exact 20-ad × 3-CV matrix behind #26 as a checked-in fixture.
  All 60 comparisons order strong > average > weak with zero inversions; OKX separates 47 / 24 / 21.
  Facts added one at a time never reduce the score across 1,740 adversarial checks. The closest
  remaining margin is Hire Feed at 78 / 76 / 19, a known lexical-heuristic limitation for future
  E5 scoring work rather than a hidden claim of semantic understanding.
- **Review + QA:** both Standards and Spec re-reviews passed with no findings after fixing two
  honesty defects they exposed: 100% alongside an open gap, and filler variants inflating evidence
  breadth. QA GO: 344 tests passed / 5 skipped, typecheck 7/7, build 5/5, focused scorer/caller
  tests 87/87, and the existing live deck Playwright journey 7/7.
- **Spec closeout:** CI and both Fly staging deploys passed for `2427b29`. With #26 as the final
  child ticket, full-journey QA ran across all #11 slices and returned GO: real reveal/wall 11/11,
  Tailor 56/56, persisted badge floor 32/32, 39 badge/no/correction checks, and current Profile
  5/5. Closed #11. Filed non-blocking #39 for four stale `.loadstate` assertions in the old badge
  driver; they target the retired placeholder, not a missing product behavior.

## 2026-07-26 (session 33) — `/orchestrate-team`: closed #27 (curated first-card pool)

- **#27 — launch-safe first card.** Shipped `b553b3e` (`Closes #27`). Grew the hand-maintained
  ad-requirement pool from 3 to 8 real posting-backed sets and made `curated` explicit at the
  non-frozen E5 stub boundary. Legacy v0 payloads default to `curated:false`; every checked-in set
  declares the decision explicitly. The reveal promotes only the highest-scoring curated opener,
  then preserves score order across the rest of the deck; the internal marker never reaches the
  public `JobCard`.
- **Hand-check + regression evidence.** The five new sets score 81 / 84 / 72 / 76 / 94 against the
  documented strong senior IT-PM profile. The fixture test pins a believable-fit floor and a
  non-flat distribution without snapshotting exact scores that #26 is expected to change. HTTP
  coverage proves all 8 sets join to real postings and a second card remains after the opener.
- **Review + QA:** the two-axis review caught three must-fixes before commit: breaking v0 compatibility,
  unreproducible score evidence, and promoting the whole curated pool instead of one opener. Both
  re-review axes passed clean. QA GO: 334 tests passed / 5 skipped, typecheck 7/7, build 5/5, and
  live `apps/web/e2e/deck.spec.ts` 7/7. Frontier after #27: **#26** remains; #11 stays open as the
  parent spec/frontier marker, so no final full-journey QA was due.

## 2026-07-25 (session 32, cont.) — `/orchestrate-team`: closed #37 (tailor ledger decisionSeq)

Resumed a lost Codex `orchestrate-team` run on #37 mid-flight: the backend worker's implementation
was already in the working tree (uncommitted, green) but the two-axis review had never run. Picked
up at the review step rather than wiping and restarting — the work was a complete, tested slice, not
a half-broken attempt.

- **#37 — tailor ledger: `seq` is creation order, so a deck confirm landing after tailor answers
  still restamps history.** Shipped `769aa6f` (`Closes #37`). Added a separate `decisionSeq` ordinal
  stamped at decision-time (`confirm`/`edit`/`add`/`answerNegative`) and cleared on `reject`/`reopen`;
  `seq` keeps creation order for the deck tiering and root CV. The tailor ledger now replays confirmed
  + negatives merged on `decisionSeq` (falling back to `seq` for hand-built fixtures), recomputing
  coverage step by step so each line's "still open" count is frozen at the moment that answer landed.
  Both internal ordinals are redacted from the `/onboarding/deck` payload.
- **Review + QA:** two-axis review (Standards + Spec) clean — no must-fixes. The one substantive
  question — whether `edit()` on an already-confirmed claim should bump `decisionSeq` — QA judged
  correctly handled by `COALESCE`: an edit changes the claim's *text*, not *when it was decided*,
  and AC1's "confirm/edit" is a first decision on a pending claim (the ticket's own repro). Added an
  edit-branch test to complete AC1's "confirm/edit" coverage at the API seam; the lost session's
  test covered only the confirm branch. Gates green: 314 passed / 5 skipped, typecheck green
  (cache-bypassed). No payload leak.
- Frontier after #37: **#26**, **#27** remain `ready-for-agent`; #11 stays open as the parent
  spec/frontier marker.

## 2026-07-25 (session 32) — `/orchestrate-team` takeover: shipped #20 profile screen

Resumed from `handoff-orchestration-20260725-2.md` with #20 already built but uncommitted after
review. Honored the handoff's product decision: **pending mined claims stay visible as cool-grey
reserve**; rejected/negative claims never render on the profile screen.

- **#20 — profile screen (Sorted + Constellation).** Shipped `ee653e4` (`Closes #20`). Backend:
  `GET /profile` is reachable pre-wall via the session cookie, groups facts with the same kind tags
  and section order as the root CV, derives gold from the current rendered root-CV trace, marks
  pending facts grey, strips rejected/negative claims from the payload, reads `source` from
  `ClaimRecord.origin`, and returns the server-owned floored `factCount`.
- **Frontend:** replaced #17's placeholder `/profile` with the real screen: Sorted domains led by the
  strongest text-length proxy, a canvas Constellation, one shared detail body, neutral source text,
  focus restoration for the Sorted dialog, and visible keyboard star targets for the Constellation.
  The badge journey test now lands on the real profile.
- **Review + QA:** the two-axis review caught and the takeover fixed the material issues: source
  heuristic, locally derived count, gold-as-strength lead ranking, too-bright grey lead styling,
  dialog focus return, and invisible constellation keyboard controls. Gates: `pnpm test`,
  `pnpm typecheck`, `pnpm build`, focused Playwright `e2e/profile.spec.ts` (5/5), plus desktop/mobile
  screenshots with a nonblank canvas-pixel check on a high-port Next server (`30180`, stopped after
  QA).
- Frontier after #20: **#26**, **#27**, **#37** remain `ready-for-agent`; #11 stays open as the parent
  spec/frontier marker.

## 2026-07-25 (session 31) — `/orchestrate-team` on #11: closed #36, paused #20 mid-review

Tenth build session on the #11 frontier. Claimed **#36** and **#20** — disjoint file trees; #26/#37
(both in the tailor/match-scoring area) left alone.

- **#36 — the deck's own regression test couldn't fail.** Its re-run-is-idempotent assertion checked
  a discovery-id claim that `seed()` never touches, so it passed regardless of correctness. Rewrote
  it (`apps/api/test/onboarding.test.ts`) to reject a *mined* claim and assert that decision survives
  a re-seed; shipped `2f4ee00`, `Closes #36`. Already deployed to Fly staging.
- **#20 — profile screen (Sorted + Constellation).** The frontend track (`profile/page.tsx` +
  `profile.css` + its e2e spec) was already built and uncommitted from a prior session. This session
  added the missing backend track — `GET /profile` in `onboarding.ts`, exporting `kindTag()`
  (`graph.ts`) and `SECTIONS`/`OTHER` (`rootcv.ts`) for reuse, plus a 4-test `profile.test.ts`. Ran
  the two-axis review (Standards + Spec) over the whole slice — not yet fixed or committed.
  - **Open product question, explicitly deferred — do not decide in code without asking again:**
    both review axes recommended `GET /profile` serve only *confirmed* claims, dropping `pending`
    ones (a `pending` claim is never in the claim graph the "grey" state is defined against, and the
    confirmation-gate invariant argues the same way). The owner said no to that change for now.
  - Other must-fixes still open: `source` should read the real `ClaimRecord.origin` field, not an
    id-prefix heuristic; the fact badge should reuse the shared floored `factCount` rather than a
    locally derived count; an effect-deps bug replays the Constellation's intro animation on every
    tap; smaller items (dead `segRef`, an unused `OTHER` export, focus management on empty/error
    states).
- **Paused deliberately, mid-slice, at the owner's request** — a clean stopping point, not a
  blocker. Nothing committed for #20; working tree unchanged since the review finished. Frontier
  now {#20, #26, #27, #37}. Superseded by session 32: the owner handoff chose pending-as-grey and
  the slice shipped.
- **Historical next-session note, now handled by session 32:** resolve the pending-claims question
  with the owner first, then work the must-fix list, re-gate (repo-wide, not API-scoped), commit
  path-scoped with `Closes #20` only on green.

## 2026-07-25 (session 30) — `/orchestrate-team` on #11: the three monotonicity defects (#35, #28, #29)

Ninth build session on the #11 frontier. Took the three sibling defects that all violate the same
spec promise — *a surface that only ever improves, regressing*. Again left #20 unclaimed (its close
triggers the full-journey pass). Shipped as **draft PR #38**, not straight to `main`: `8438964`
(#35), `bc77914` (#28), `fbae52c` (#29). Gate at every commit green; 289 → 304 tests.

- **#35 — a deck reject reopened an answered discovery question.** `discoveryState` counted only
  confirmed + negatives as answered, so a rejected claim stopped counting: bar dropped,
  `essentialRemaining` rose, the question came back. A rejected claim now counts as *answered* (the
  visitor was asked and responded — only the machine's phrasing was rejected) but contributes no CV
  line. **Both review axes independently caught the same deeper bug:** `isTriggered` gates `askable`,
  which is *both the numerator and the denominator* of `railFill` — so rejecting a **trigger** evicted
  its already-answered follow-up from both and the bar still fell (0.4 → 0.25 on the real fixture).
  The diff's own test missed it *and* passed for the wrong reason: a bare `toBeGreaterThanOrEqual`
  is satisfied when the value **rises** because the denominator shrank. Spec axis found a second
  path — the reader-only question keeps its own `confirmed`-only check in the route. QA (GO) then
  measured pre-fix vs post-fix through the real routes and found #35 had also fixed an unstated
  fourth surface: the computed `stage` no longer falls back `deck` → `discovery`.
- **#28 — the tailor ledger restamped history.** Every "asked and closed" line was derived from the
  *current* open count, so by end of session they all read "0 still open". Kept the ledger derived —
  what was missing was answer *order*, and `PgClaimStore` already had a `seq` bigserial backing its
  own `ORDER BY`. Surfacing it on `ClaimRecord` lets the two separately-ordered lists replay as one
  true answer order. **Standards axis caught that `seq` then leaked onto the `/onboarding/deck`
  payload** — `{ ...c, tier }` with no response schema to strip it, and on Postgres `seq` is a
  *table-global* bigserial, so it disclosed other sessions' write volume between two of a visitor's
  own requests. Spec axis caught that the *positive* half of the replay was entirely unpinned: swap
  `confirmedSoFar` for `confirmed` and the whole suite still passed.
- **#29 — a requirement declined in Tailor still showed as open on the deck card.** #23 filtered
  negatives in the tailor assembly alone, deliberately, to keep #19's deck payload byte-identical.
  Both callers want it now, so it moved into the shared `buildJobCard` — deleting the duplication,
  including #23's D1 bubble recompute, since the open clause now falls out of the filtered list.
  The tailor tests pinning B1 and D1 pass untouched, which is what proves the move was behaviour-
  preserving. Built inline rather than dispatched: the #28 QA agent died on an **account spend
  limit**, so the rest of the session ran without sub-agents.
- **Two follow-ups filed.** **#36** — `POST /onboarding/deck` seeds mined claims only `if
  list(...).length === 0`, but discovery answers land in the same store first, so on the real journey
  the miner's claims are *never* seeded and the S2 review step has nothing from the CV to review.
  Found by QA probing sibling paths, pre-existing, unrelated to these three. **#37** — `seq` is
  *creation* order, not decision order, so a deck confirm landing after tailor answers still replays
  at its seed position; a proper fix needs a separate decision ordinal, so #28 shipped with a
  `ponytail:` ceiling instead.
- **No full-journey QA pass** — #11's frontier is not empty (#20, #26, #27 remain), and the
  browser-driven pass would have hit the same spend limit. All three are API-seam fixes, no UI change.

## 2026-07-25 (session 29) — `/orchestrate-team` on #11: cleared three S28 follow-ups (#31, #30, #33)

Eighth build session on the #11 frontier. Deliberately did **not** claim #20 (the last screen ticket,
whose close triggers the full-journey QA pass) — instead took the three small defects S28 filed
against already-shipped flows, on two disjoint trees so the API and web tracks ran in parallel.
Shipped green: `f2ddf88` (#31), `c89e9f8` (#30), `1f87af8` (#33).

- **#31 — the tailor match floor, keyed to the wrong thing.** `tailor_floor_pct` was gated on
  `tailorAdId`, which `clearTailorTarget` nulls on drop — so `null !== adId` zeroed the floor on
  drop → re-swipe of the *same* ad. Now keyed to a new `tailor_floor_ad_id` that survives a drop;
  `clearTailorTarget` is untouched, so the 409-after-drop behaviour its pinned test depends on is
  intact. **The review caught what the ticket didn't ask for:** the bare `ADD COLUMN` leaves the new
  column NULL, and `NULL = $2` is *unknown* in SQL — so the very deploy that fixes #31 would
  re-introduce it once for every live mid-tailor session. Shipped with an idempotent backfill
  `UPDATE` in `SESSIONS_ALTERS`, the file's first deviation from its pure-`ADD COLUMN` idiom.
- **#30 — signed-out `/tailor` dead-ended.** `login_required` now joins `no_tailor_target` on the
  existing redirect branch → `/deck`, which fronts its own wall (OAuth leading). Safe because
  `GET /onboarding/cards` uses `requireSession`, **not** `requireUser` — an anonymous visitor gets a
  200, so the dead end is closed rather than relocated. Switched to `router.replace`: with `push`,
  Back returns to `/tailor` only to be bounced forward again. Five-line diff.
- **#33 — the badge could shrink.** A per-session `fact_floor`, raised at each of the **five** routes
  emitting `factCount`, which now return `max(computed, floor)`; `discoveryState()` and `factCount()`
  stay pure. The brief pinned four seams and the dev found the fifth — `buildTailorState` serves two
  routes, and AC3 (a bare reload must not regress) needs the GET. Applying the floor on the GETs is
  load-bearing for a second reason: confirming claims in the S2 deck touches no factCount-emitting
  POST, so without it a visitor reaches `/discovery` with floor 0 and can still drop. No backfill
  needed here, unlike #31 — a defaulted `0` only ever rises.
- **Two-axis review — one must-fix across three slices, and the axes disagreed usefully.** On #31 the
  Standards axis called the missing backfill a must-fix while the Spec axis rated it
  take-it-or-leave-it (not visitor-reachable today, self-healing). Took it: staging has `DATABASE_URL`
  and a push is a deploy. On #33 both axes independently landed on the same top finding — the route
  test's reject returns `{ok:true}` even for an unknown claim id, so a changed id scheme would make
  the guard **silently vacuous and pass green with the fix fully reverted**. Hardened to assert the
  claim actually left the store.
- **QA — three GOs, each earning its keep.** #31: found AC1 was pinned only at the store column, never
  at the *visible* %, and added the route-level test that is now the only one failing on a revert;
  verified the backfill against **real Postgres 16** across repeated `init()` runs. #30: live drive,
  23/23, with a non-vacuity check proving `no_session`/`internal_error` still reach the retry screen —
  the fix routes the dead end without swallowing retryable errors. #33: live drive against a
  **Postgres-backed** API, badge monotone across 12 fresh mounts, sign-in merge verified not to lower
  the floor; flagged that only 2 of 5 seams had unit coverage, now all five in one test.
- **Follow-up filed:** [#35](https://github.com/adrien-mounier/jobcrush-app/issues/35) — the same
  deck-reject path still regresses discovery's *other* monotonic surfaces (`railFill`,
  `essentialRemaining`, and re-asking an answered question), violating stories #26/#35/#37/#79. #33
  fixed the badge because that was its AC; the rail has the same guarantee and didn't get it.
- **Next session:** frontier is {#20, #26, #27, #28, #29, #35}. **#20 remains the one whose close
  empties the spec's frontier and triggers the full-journey QA pass.** #35 is the natural sibling of
  what shipped here and the code is fresh in the log.

## 2026-07-25 (session 28) — `/orchestrate-team` on #11: shipped #23 (Tailor, screen 3) + #17 (the profile badge)

Seventh build session on the #11 frontier. Claimed **[#23](https://github.com/adrien-mounier/jobcrush-app/issues/23)** + **[#17](https://github.com/adrien-mounier/jobcrush-app/issues/17)** — the two tickets S25/S26 kept deferring for missing nav targets; #23's own landing removed #17's blocker mid-session. Shipped green: `8091b89` (#23), `3895f27` (#17), plus `03fede9` (CI deploy guard). Frontier now **{#20 profile screen}** plus the follow-ups filed below.

- **#23 — Tailor (screen 3).** `GET/POST /onboarding/tailor{,/answer,/drop}` + `apps/api/src/tailor.ts` + `/tailor` on the web. Questions come from the ad's ranked requirements (E5 stub); every answer re-scores the visible % instantly and **can only climb** — a `tailor_floor_pct` on the session (both drivers, `GREATEST`/`Math.max`) guarantees it, since a correction or a "no" can lower the raw tick. Answering moves a requirement out of *Where you don't — yet* into *Where you fit*, rewrites the bubble's gap clause, and lands a derived ledger line. A "no" closes the gap for good (dim dot, never a cross). Exits are open from question one and both routes reach a byte-identical ending; **Drop deletes no claim**, which is what makes *"everything you told me stays on your profile"* literally true. The deck's card renderer was extracted to `apps/web/app/jobcard.tsx` so both screens share one card.
- **#17 — the profile badge.** A chip flies from the tapped control into a top-bar badge on **both** discovery and tailor. Pile, never a gauge: independent tapering slabs on `log2(n+1)`, still gaining layers at 45/90/181/362, no container, no track, no maximum, no gold at rest — and the silhouette *changes shape* as it grows, the opposite gesture to filling up. Word collapses past 3 facts. **A "no" finally pays out** (it types no CV line, so the chip is its only reward); a **correction** deliberately flies nothing, because the count didn't change. Tap → `/profile`, a thin placeholder #20 replaces.
- **Two-axis review — 7 must-fixes on #23, 2 on #17.** Worst on #23: **tailor answers never reached the CV** (`cvLines` borrowed discovery's derivation, which filters to `discovery-` claims), so *"use this CV"* returned a CV containing nothing said on the screen. Worst on #17: **the first answer flew no chip** — found independently by *both* axes. Also reverted a `DOMRect` threaded through 5 signatures and 12 call sites in discovery down to two lines per screen.
- **QA (live, real stack, production build).** #23 came back **NO-GO** on a defect neither suite could see (see lessons): after a "no" the bubble kept naming the declined requirement. Fixed, re-driven, **GO** — journey 56/56, deck 7/7. #17 **GO** first pass — all 5 ACs, 33/33 e2e, journey 43/43, no regressions. Two real-stack drivers now committed: `tailor-journey.mjs`, `factbadge-journey.mjs`.
- **Follow-ups filed:** [#28](https://github.com/adrien-mounier/jobcrush-app/issues/28) (ledger restamps historical open counts), [#29](https://github.com/adrien-mounier/jobcrush-app/issues/29) (a Tailor-declined requirement still shows open on the deck card — the price of keeping `buildJobCard` byte-identical for #19), [#30](https://github.com/adrien-mounier/jobcrush-app/issues/30) (`/tailor` signed-out dead-ends on a 401 instead of the wall), [#31](https://github.com/adrien-mounier/jobcrush-app/issues/31) (match floor still lost on drop → re-swipe; not visitor-reachable until in-tailor correction ships), [#33](https://github.com/adrien-mounier/jobcrush-app/issues/33) (**badge can shrink** — `factCount` needs server-side monotonicity; reachable via an S2 deck reject).
- **Cross-project infra review (owner-requested, mid-session).** `jobcrush-app` and `vitacairn` share **one Fly account and one Cloudflare account**. Hosted resources don't collide (distinct app/DB/bucket names), but **local dev ports do** — both APIs default to 3000 and both web proxies target `127.0.0.1:3000`, so one project's frontend can silently reach the other's backend. Wrote `AI/Projects/SHARED_INFRA.md` (inventory, rules, port recipe) and summarised the three critical rules in the shared `AI/Projects/CLAUDE.md`. Shipped the one code fix: `concurrency: deploy-main` on the deploy job (`03fede9`) so two pushes can't race and land the older build last — jobcrush lacked it, vitacairn already had it. Owner backlog as [#32](https://github.com/adrien-mounier/jobcrush-app/issues/32): set a spending alert, and verify vitacairn's Fly token is app-scoped (jobcrush's already is).
- **Next session:** **#20 (profile screen — Sorted + Constellation)** is the last screen ticket on #11 and is now genuinely unblocked — #17 built the `/profile` route it replaces. Closing it empties the spec's frontier, which triggers the **full-journey QA pass** across all four screens. The five follow-ups (#28–#31, #33) are independent and small; **#33 is the one with real UX weight** (the badge is specified to only ever grow).
## 2026-07-25 (session 28) — parallel lane: the OAuth failure return path + filed the #14 follow-ups

Ran alongside a live `/orchestrate-team` session (worktree `session-26-tailor-badge`, claiming #23
Tailor + #17 badge). Picked work on **provably disjoint trees** rather than the only open ticket:
**#20 is the one thing that must NOT be built in parallel** — #17 has to create
`apps/web/app/profile/page.tsx` as its tap target (its AC5) and that file *is* #20, so both sessions
would write the same new file. No `/orchestrate-team` here: a one-file server fix does not need a
designer or a QA gate.

- **Closed session 25's deferred OAuth limitation.** Every Google failure redirected to
  `/signup?login=…`, while the `?login=` handler in `apps/web/app/deck/page.tsx` sat **inert**,
  commented as waiting for the server to thread a return-to. Now `/auth/google` takes `?from=`, keeps it
  in a second short-lived cookie (`jc_oauth_from`, same opts as the state cookie), and the callback's
  two failure redirects use it — so a failed/cancelled trip started at the deck wall lands on
  `/deck?login=expired|error` and keeps the reveal it already showed. Success path
  (`/auth/verify?oauth=ok`) untouched.
- **Why a second cookie, not the `state` param.** The return-to never goes to Google, so packing it into
  the state cookie would have meant a split-and-reparse plus editing 4 passing CSRF tests. A sibling
  cookie left the state/CSRF logic byte-identical.
- **Open-redirect guard.** `returnPath()` is an **allowlist** (`/deck`, `/signup`), not an "is it a
  path?" regex — `//evil.com` passes most such checks. Validated on the way out *and* re-validated from
  the cookie on the way back, so a forged `jc_oauth_from` falls back to `/signup`. This is the same bug
  class session 25's review caught on the `jc_return` stash.
- **Filed the two #14 follow-ups**, grounded in the report's measured numbers:
  **[#26](https://github.com/adrien-mounier/jobcrush-app/issues/26)** fit-weighted scorer (the
  token-*union* rank inversions: MRI strong 47 vs average 60; the flat OKX 27) — flagged
  **not to be built concurrently with #23**, which asserts on tick numbers; and
  **[#27](https://github.com/adrien-mounier/jobcrush-app/issues/27)** curated first-card pool (only
  **3** ad-requirement sets exist, which is why the deck exhausts almost immediately).
- **Verification:** `pnpm test` 228 passed / 5 skipped (auth.test.ts 21 → 24), `pnpm typecheck` 7/7,
  `pnpm build` 5/5. The 3 new tests cover the `/deck` return, the unconfigured-Google return, and the
  open-redirect refusal from both directions. Not driven in a live browser — the frontend branch it
  lights up was already QA'd in session 25 and this change does not alter it.
- **Next session:** #20 unblocks once #17 lands. #26 wants the taste-test matrix re-run as its ruler.

## 2026-07-25 (session 27) - `close-session`: context sync check + tracker handoff

Closed out the #21 orchestration session after push/deploy. Root context files checked: `CLAUDE.md`
and `AGENTS.md` both already had byte-identical `SHARED` blocks, so no context-file rewrite was
needed. #21 is closed on GitHub; #23 Tailor is open, labeled `ready-for-agent`, and has
`blocked_by: 0`.

- **Context changes:** none. `CLAUDE.md` and `AGENTS.md` shared core hash matched; private zones left
  untouched.
- **Roadmap changes:** refreshed the roadmap date and close-session handoff note to point at #23 as
  the next deck/tailor ticket. No milestone status changed beyond the already-recorded #21 ship.
- **Lessons:** no new lesson added; the durable #21 lesson ("durable handoff can unblock a future
  screen") was already recorded in `lessons.md`.
- **Next session:** run `/orchestrate-team` on the live `ready-for-agent` frontier; #23 Tailor is the
  primary next deck/tailor ticket, while #17/#20 remain the profile branch to inspect separately.

## 2026-07-24 (session 26) - `/orchestrate-team` on #11: shipped #21 (swipe the deck, screen 2b)

Sixth build session on the #11 frontier. Re-checked the live GitHub dependencies first: **[#23 Tailor](https://github.com/adrien-mounier/jobcrush-app/issues/23)** was already written, but still native-blocked by **[#21](https://github.com/adrien-mounier/jobcrush-app/issues/21)**. Claimed #21 because it directly unblocks #23; left #17 alone because its profile-screen target still belongs to the #17 -> #20 chain. Shipped green in `c435f2c`.

- **#21 - swipe/pass controls.** `/deck` now has left/right pointer swipes plus explicit footer buttons. Left advances to the next score-sorted card without mutating saved discovery answers; the exhausted deck routes back to `/discovery?loop=deck-exhausted` and shows the exact copy **"I scored the three closest — tell me more and I'll widen the net"** instead of a dead end. Right calls a new signed-in-only `POST /onboarding/cards/:adId/want`, validates the card against the E5 stub/posting set, persists `stage="tailor"` + `tailorAdId`, and shows a minimal Tailor handoff without implementing #23.
- **Review + QA.** Designer pass set the 2b interaction contract; backend/frontend agents built disjoint slices. Two-axis review found two must-fixes (signed-in enforcement on want; durable Tailor target + loopback state), both fixed. Final Standards, Spec, and QA audits reported **0 must-fix**. Focus was verified for next-card, Tailor-handoff, loopback, and error paths.
- **Verification.** `pnpm test`, `pnpm typecheck`, and `pnpm build` green. Focused live e2e: `apps/web/e2e/deck.spec.ts` **7/7 green** against a real local API/web pair. Adjacent `wall.spec.ts`/`discovery.spec.ts` reruns exposed only local-test noise already understood: Next dev overlay intercepting an unrelated correction click, then in-memory `/sessions/anonymous` rate limiting after repeated batches.
- **Next session:** close #21 on GitHub after push; #23 Tailor should become the next buildable deck/tailor ticket. #17 still needs care because its profile-screen route is the other branch of the DAG.

## 2026-07-24 (session 25) — `/orchestrate-team` on #11: shipped #25 (discovery→reveal nav) + #22 (the wall) + #14 (taste-test)

Fifth build session on the #11 frontier {#14, #17, #21, #22, #25}. Claimed **[#25](https://github.com/adrien-mounier/jobcrush-app/issues/25)** + **[#22](https://github.com/adrien-mounier/jobcrush-app/issues/22)** + **[#14](https://github.com/adrien-mounier/jobcrush-app/issues/14)** — all **buildable now on disjoint trees**. **Deferred #17 + #21**: both wire to a not-yet-built target (#17's badge tap-opens `/profile` from the still-blocked #20; #21's swipe-right needs Tailor from the still-blocked #23) — building them now would point at dead ends. Shipped green: `e1dd0aa` (#14), `ae56643` (#25), `0140d4a` (#22), + `08ec8ae` (chore: gitignore `qa-results/`). Frontier now **{#17, #21}**.

- **#14 — card-quality taste-test (no product code).** 20 ads × 3 CVs through the real `matchtick.ts` stub (`dist/matchtick.js`). **Verdict: GO with guardrails** (not worse-than-a-job-board): strong>average>weak holds, a weak/off-target CV correctly zeroes on 19/20 ads. **But** a real embarrassing tail on natural ad text — token-*union* overlap rewards vocabulary coincidence, not fit, so a few average>strong inversions + one flat-27 ad. Recommends: **wall at the reveal** (spec default — confirms #22), **curated first card**, **soft launch**. Report `docs/card-quality-taste-test.md`. **Follow-ups worth filing:** swap the token-union scorer for a fit-weighted one; stand up the curated first-card pool (only 3 real ad-requirement sets exist in fixtures).
- **#25 — discovery→`/deck` reveal nav.** The gate flip to stage `deck` dead-ended on the #18 handoff placeholder (reveal reachable by URL only). Now the handoff shows as a brief ~800ms bridge, then `router.push("/deck")` (latched against a double push); the discovery-side focus+announce is **dropped** so only `/deck`'s own entry effect announces (AC2, no double-announce). #24's correction-focus machinery untouched. New `discovery.spec.ts` nav test.
- **#22 — the wall at the reveal.** Anon "See them" now shows an **inline wall inside the curtain** (reward heading stays above): **Google OAuth leading, magic link secondary**; signed-in → straight to the card. Backend: `GET /onboarding/cards` gains `authed` (`claimedByUserId !== null`) — **anon scoring already rode the anon session, so AC1 was already satisfied by the existing design**; the wall is the **single, easily-moved `authed ? deck : wall` gate** (AC4). Resume on `/deck` via a one-shot `jc_return` stash consumed in `/auth/verify`; reuses the S2 anon→account merge unchanged. Designer spec (`design-22-wall.md`) drove the build; `.jobdeck .wall`-scoped CSS (the mandatory scoping rule — signup's global classes would render light-on-white in the dark curtain). New `wall.spec.ts` (4); `deck.spec.ts` reconciled to sign in before the 2a card.
- **Two-axis review (#22):** Spec axis — **faithful, all 4 ACs met**. Standards axis — one **must-fix**: an eagerly-written, only-consumed-on-use `jc_return` could survive an **abandoned** wall visit and hijack a **later** S2 sign-in (`router.replace("/deck")` beating `/deck/{jobId}`). Fixed in `resume()`: always consume `jc_return`, a **job-scoped intent wins first**, and an **internal-path guard** on the stash. Added the AC3 resume-round-trip e2e (the ticket's crux, previously untested). #25 self-reviewed clean (a ~20-line nav diff).
- **QA:** live real-stack drive via **the dist recipe** (compiled API + `next dev` on free ports — 3000/3001 were taken by another project). **GO** — 7/7 ACs PASS live end-to-end, gates green (`--force`: API 220 passed, typecheck 7/7, build 5/5), 11/11 live e2e, **zero defects**. Only red was the known `/sessions/anonymous` in-memory rate-limiter after repeated reruns (reset by API restart).
- **Product decision (flagged, reversible):** the wall gates the "See them" action itself, so anon sees the count but signs in to see the card — the spec's §12 "wall at entering the deck (the reveal)" default, explicitly *"reversible on drop-off data; do not block on the final moment."* It's the one `authed ?` gate, so showing the first card free later is a one-line flip. **Deferred limitations:** OAuth *failure* still returns to `/signup` (routing to `/deck?login=` needs threading a return through the OAuth `state` param — the `?login=` banner branch is in place, inert until then); *cross-browser* magic-link resumes to `/import` (`jc_return` is browser-local; the leading OAuth/same-browser paths land on `/deck`).
- **Next session:** frontier {#17, #21} stays **blocked-in-practice** until #20 (profile screen) and #23 (Tailor) land — those two need claiming first (both currently native-blocked). Consider filing the #14 follow-ups (fit-weighted scorer; curated first-card pool).

## 2026-07-24 (session 24) — `/orchestrate-team` on #11: shipped #19 (reveal + job card, screen 2a) + #24 (correction-focus a11y)

Fourth build session on the #11 frontier. Claimed **[#19](https://github.com/adrien-mounier/jobcrush-app/issues/19)**
+ **[#24](https://github.com/adrien-mounier/jobcrush-app/issues/24)** — **disjoint trees** (#19 = a new `/deck` reveal +
card + `apps/api` match tick; #24 = a focus-timing fix in `apps/web/app/discovery/page.tsx`), built in parallel with a
`designer` pass for #19. Left **#17** (badge — collides with #24 on `discovery/page.tsx`) and **#14** (taste-test — a
product-owner eyeball) on the frontier. Both shipped green: `c686c8a` (#19), `c8da788` (#24). Closing #19
**unblocked [#21](https://github.com/adrien-mounier/jobcrush-app/issues/21)** (swipe 2b) **and
[#22](https://github.com/adrien-mounier/jobcrush-app/issues/22)** (the wall); frontier now **{#14, #17, #21, #22, #25}**.

- **#19 — reveal + job card (screen 2a).** Six ACs, design-led.
  - **Match tick** (`apps/api/src/matchtick.ts`): pure `(confirmed facts, ad's ranked reqs) → %`, band-weighted
    **union**-token coverage → deterministic + **provably never-decreasing** (adding a fact only grows the token set,
    so a covered req can't uncover). Unit-tested (11) + HTTP-tested (`cards.test.ts`).
  - **`GET /onboarding/cards`**: assembles score-sorted `JobCard`s (anonymous session, pre-wall) from postings ⋈ the E5
    ad-requirement stub; the single Manulife stub reconciled to **3 scorable postings** (added Endava, luvo).
  - **The screen** (`/deck`): the reveal is **structural** ("nothing behind it" = the deck isn't mounted until "See
    them"); the card leads with the job, then the **one visible number** (% ring), a highlight bubble, and three lists
    with **three marks, never a cross** (gold ✓ / grey ? / dim ·). New `.jobdeck`-scoped `deck.css` — ink-and-glass,
    `packages/ui` tokens out (per spec).
  - **Contract pinning:** the `designer` independently proposed a `DeckJob`/`reqs[]` payload; I **superseded it with the
    pinned `JobCard`** the backend built (reconciled at brief time so both sides built one shape). The `backend-dev`
    also **corrected my brief** (the Manulife ad *does* match a posting — I'd only read the file head, not the whole
    fixture) and independently verified before adding stubs.
  - **Scope:** body-only card; swipe/footer/loopback/live re-score = **2b (#21)**. `fit`/`askedClosed` are
    **session-global + unranked** for now — the per-ad ranked model was **consciously deferred to #21** (story #54's
    ?→✓ flip forces that rework anyway); commented on #21.
- **#24 — correction-focus a11y.** Root-caused in the **shared focus path** (not per-caller): leaving a correction the
  `askKey` effect stole focus back to the next question (fixed with a `leavingCorrection` guard), and the
  resolution-site `.focus()` raced a still-typing (aria-hidden) or not-yet-mounted button (fixed by **deferring**
  through post-render effects `focusLineId` + `focusFixNotice`). All four outcomes + deck-handoff-unchanged.
- **Two-axis review (#19):** Standards **0 must-fix**; Spec faithful with one **deferred** finding (the per-ad `fit`
  model → #21). #24 self-reviewed clean (its later defect was a live-QA catch, not a review miss — see below).
- **QA:** live real-stack drives via **the dist recipe** (`node apps/api/dist/main.js` + in-memory store, web via
  `next start`; no ts-node/Postgres/LLM). #19 **GO** (6/6 ACs, `deck.spec.ts` green, card renders credibly). #24 first
  **NO-GO** — live caught a bare-"no" Esc focus defect (**D1**) that had survived **two code traces** (the dev's and
  mine); the symmetric `focusFixNotice` deferral fixed it, re-verified **`discovery.spec.ts` 5/5** live.
- **Filed [#25](https://github.com/adrien-mounier/jobcrush-app/issues/25):** the discovery→`/deck` navigation is
  **missing** — the reveal is reachable by direct URL only (the wire-up fell between the screen-sliced tickets).

### Next session starting point
- **Frontier = {#14, #17, #21, #22, #25}.** #19 opened **#21** (swipe the deck, 2b) + **#22** (the wall at the reveal).
  #23 (tailor) still needs #21; #20 (profile screen) still needs #17. **#25** (reveal reachability) is a small nav
  wire-up on `discovery/page.tsx` — watch it doesn't disturb #24's focus work. `/orchestrate-team` on the frontier.

## 2026-07-24 (session 23) — `/orchestrate-team` on #11: shipped #18 (discovery screen 1b — the gate + tricky answers)

Third build session on the #11 frontier. Claimed **[#18](https://github.com/adrien-mounier/jobcrush-app/issues/18)**
**alone** — the other two frontier tickets were deliberately deferred: **#17** (profile badge) collides with #18 on
`apps/web/app/discovery/page.tsx` (cleaner built on the settled screen), and **#14** (card taste-test) needs a stub
scorer that isn't built yet + is a product-owner eyeball call. Built as `backend-dev` (`apps/api` + `packages/contracts`)
∥ `frontend-dev` (`apps/web`) on **disjoint trees + a pinned contract**, with a parallel `designer` pass. Shipped green:
`f794fa5`. Closing #18 **unblocked [#19](https://github.com/adrien-mounier/jobcrush-app/issues/19)** (the reveal);
frontier now **{#14, #17, #19, #24}** (#24 = an a11y follow-up split from #18).

- **#18 — discovery screen 1b (the gate + tricky answers).** Six ACs, much already scaffolded by #16+#13:
  - **Gate (AC1):** `discoveryState` returns `stage = essentialRemaining===0 ? "deck" : "discovery"`; the answer route
    persists `setStage("deck")` on crossing. `DiscoveryState.stage` widened in the api **and** the web mirror type.
  - **"No" + never-re-ask (AC2/AC3):** already live from #16+#13 (the floor's "No" option → `answerNegative`,
    `answeredIds` excludes it) — **locked** with route + resume tests. Client swaps the saved-for-later C13 for **C15
    "Noted — one less thing to ask." + a "Fix that?" undo**; nothing reads as a cross/failure.
  - **Correction (AC4):** `POST /discovery/answer` made **idempotent** — re-answering IS the correction (no↔yes flips
    ride the store's existing `add`/`answerNegative` upsert). **No new route** — this superseded the designer's proposed
    `correctDiscovery` seam, reconciled at brief time so both sides built the same contract. Client: tap a written CV
    line → re-ask in the dock → the line **re-types in place**.
  - **Triggered dates (AC5):** new **optional** `FloorItem.triggeredBy` (unfrozen schema, no oracle) surfaces an
    employer/date item only after its achievement is answered **positively**; `rankBand: standard` so it never gates
    the deck; gates both `questions` and `railFill`.
  - **Reader-only (AC6):** `GET /discovery?job=` prepends one synthetic reader question from the CV's mined roles — a
    **bounded stub**; the broader "CV auto-answers the questions it covers" (stories #8–11) is explicitly OUT of #18.
  - **Carried #13 wiring:** threaded `claims.negatives()` into `buildClaimGraph` at `/build` (the note left on #18) so
    a discovery "no" becomes a `Negative`/`renderable:false` node — invisible in the root CV, read by #20.
- **Two-axis review:** Standards **0 must-fix** (timer cleanup, semantic `button`+aria, seam-level tests all clean);
  Spec **1 must-fix** = the `negatives`→`/build` wiring above (an explicit undone #18 instruction, one line, applied) +
  1 confirmed a11y leave-it (correction focus doesn't return to the edited line → filed as **#24**).
- **QA:** live real-stack drive (in-memory API, no LLM) — all 6 ACs PASS, 21/21 assertions. The pinned Seam-2 e2e
  (`discovery.spec.ts`) was initially red on **strict-mode locator collisions** with the required `sr-only` aria-live
  region + an `AFTER_NO` fixture modeling an **unreachable** empty-`questions` state — both **test-only** (product
  correct throughout), fixed and re-verified **5/5 green** (see lessons).

**Process note:** the QA sub-agent **again died on a monthly spend-limit** mid-verification (as in S22); the user said
"take over, keep using sub-agents." The e2e locator + fixture fixes were made **in-thread**; a fresh **frugal,
verify-only** `qa-tester` (~54K tokens) re-ran only `discovery.spec.ts` to confirm green. The `.gitignore` `data/` trap
bit the commit (the `git add … && commit` chain short-circuited on the ignore hint, though the tracked file still staged).

### Next session starting point
- **Frontier = {#14, #17, #19, #24}.** **[#19](https://github.com/adrien-mounier/jobcrush-app/issues/19)** (the reveal
  + job card, screen 2a) is **newly unblocked** by #18 and opens the deck/tailor chain (#19 → #21 → #22 → #23). **#17**
  (profile badge) is now cleanly grabbable on the settled discovery screen; **#24** (correction-focus a11y) is a small
  follow-up; **#14** (taste-test) still needs the stub scorer or a hand-scored pass. `/orchestrate-team` on the frontier.

## 2026-07-24 (session 22) — `/orchestrate-team` on #11: shipped #13 (backend "no" write path) + #16 (discovery screen 1a)

Second build session on the #11 frontier. Claimed **[#13](https://github.com/adrien-mounier/jobcrush-app/issues/13)**
+ **[#16](https://github.com/adrien-mounier/jobcrush-app/issues/16)** and **serialized** them (both live in `apps/api/src`,
so parallel builds would fight the whole-tree gate) — #13's backend truth first, then #16 on top of it. #16's
**design ran in parallel** with #13's build (disjoint: a scratch-file spec vs `apps/api` code). Both shipped green:
`8a48185` (#13), `ea435f0` (#16). Frontier now **{#14, #17, #18}** (#13+#16 unblock #17 and #18).

- **#13 — first-class "no" + never-re-ask + correction.** New store decision `negative` (distinct from `rejected`)
  with `answerNegative`/`negatives`/`reopen` on **both** drivers; `buildClaimGraph(claims, { negatives })` emits
  `Negative`/`renderable:false` nodes; `detectGaps` gains an `answered` set so an answered floor item (yes **or**
  no) is never re-asked — which also **fixed a latent pre-existing bug** where a yes-answered gap's trigger (the
  undated role / `needs_grill` claim) re-surfaced. Correction = existing `edit()` (wrong positive) + `reopen()`
  (flip a mistapped "no" back to open). Unit-tested on both drivers + at the grill route. Two-axis review: **0
  must-fix**. The discovery "no" HTTP wiring + graph-negatives-into-`/build` are **#18** (wiring note left on #18).
- **#16 — discovery screen 1a (the answer→CV-line→section-bar loop).** Backend: 4 routes on the **anonymous**
  session (`requireSession` — pre-wall, §12) + pure `composeCvLine`/family/city/count stubs behind provider
  functions (E5 swap point) + a `discoveryState` builder that rebuilds the whole screen from persisted claims
  (resume, not localStorage). Frontend: the ink-and-glass screen reusing the front door's typewriter/`keepInView`,
  built to a designer spec. **Reconciliation:** `composeCvLine` runs **server-side** (returned in the answer
  response), not client-local as the design assumed — `apps/web` has no unit runner + no new deps, and the
  displayed line then === the persisted line. Two-axis review: **1 must-fix** — `isNoAnswer` (`/^no\b/i`) mis-hit
  the option **"No, but a related certification"**, dropping a real fact as a negative (conservation violation);
  fixed to a **bare** "no" + a regression test. **Live QA GO** — drove the real flow in a browser against the
  in-memory API (Q1 → family suggestions → promise with city → floor question types a line + bars/countdown
  advance; 0 page errors; screenshots captured).

**Process note:** the two `#16` build sub-agents died mid-run on a **monthly spend-limit** hit; the user said
"take over", so the orchestrator built #16's backend **by hand** and (once the limit lifted) re-spawned only the
frontend agent — disjoint trees, same pinned contract. QA was run in-thread (a live browser drive) rather than a
fresh qa-tester agent, to stay economical after the limit. `next dev` collided with a pre-existing `:3000` API in
the environment; ran it on a free port instead (env issue, not code).

### Next session starting point
- **Frontier = {#14, #17, #18}.** **[#18](https://github.com/adrien-mounier/jobcrush-app/issues/18)** (discovery
  1b — the gate + tricky answers: no / correction / dates) is the keystone that unblocks #19 → the reveal/deck
  chain; it should **wire the "no" write path into the discovery API** (call `answerNegative` on a real "no") and
  **pass `claims.negatives()` into `buildClaimGraph` at `/build`** (see the note on #18). #17 (profile badge) and
  #14 (taste-test, non-code) are also grabbable. `/orchestrate-team` on the frontier.

## 2026-07-24 (session 21) — `/orchestrate-team` on #11: shipped #12 (E5 contract + stub) + #15 (front door); #16 now unblocked

First build session on the #11 frontier. Claimed **[#12](https://github.com/adrien-mounier/jobcrush-app/issues/12)**
+ **[#15](https://github.com/adrien-mounier/jobcrush-app/issues/15)** — a **disjoint-tree pair** (backend
contract vs web UI) so they built in parallel — and drove each through the full loop: designer spec →
parallel build (`backend-dev` + `frontend-dev`) → two-axis review (Standards + Spec) → live QA → path-scoped
commit → green push → close. Both on staging: `d3977ff` (#12), `d6c405f` (#15). Push gate green (contracts 14,
api 166/5-skip, typecheck 7/7).

- **#12 — E5-facing contract + hand stub.** Two **not-frozen** `zod` families in `packages/contracts`
  (`familyFloor.ts`: `FamilyFloor` = ranked `FloorItem`s carrying `rankBand`/`question`/`options`/`cvSection`/`noIsFatal`;
  `adRequirements.ts`: per-ad ranked `AdRequirements`) + hand JSON in `apps/api/data/` behind
  `loadFamilyFloor`/`loadAdRequirements` (`e5stub.ts`), mirroring `preview.ts`'s `loadPostings`/`matchPosting`
  and shape-tested like `roleCluster.ts` (no oracle). E5 (S3) later swaps the producer behind these, tests stay
  green. Review must-fix was the `.gitignore` `data/` trap (stubs `git add -f`'d — see lessons).
- **#15 — front door (screen 0).** Shape A of `front-door-options.prototype.html`: the *"Answer questions.
  Collect jobs."* invitation types itself → **Ready?** → bottom-edge CV-shortcut footnote; tap/key-to-finish;
  `prefers-reduced-motion` skips it; Ready? parts the headline → discovery. CV shortcut reuses the upload→mine
  pipeline (never the deck) with a *"CV read."* beat + full error states — all ink-and-glass **scoped in
  `frontdoor.css`** (the `--jc-*` system untouched, per spec). Widened `OnboardingStage`
  (`front-door`|`discovery`, non-breaking) + `PUT /sessions/me/stage` (anonymous, zod-enum **fails closed**).
  `/discovery` is a thin placeholder for #16. **Live QA GO — all 6 ACs** (AC5 driven live via the Claude-CLI
  LLM fallback: real CV → "CV read." → `/discovery?job=`). Applied one review fix (keyboard-gate Ready? during
  CV read, matching the CSS pointer gate) + fixed a brittle e2e timing budget.

**#13/#14 deliberately not taken** (don't drain the frontier): #13 (backend "no" write path) shares `apps/api`
with #12 and would fight the whole-tree gate; #14 (taste-test) reads best now that #12's stub exists to score.

### Next session starting point
- **Frontier now = {#13, #14, #16}.** **[#16](https://github.com/adrien-mounier/jobcrush-app/issues/16)**
  (discovery screen 1a — the core loop: answer types a CV line + fills a section) is **newly unblocked** by
  #12+#15 and is the next keystone (it unblocks #17/#18; #19 dropped to 1 blocker). #13 (backend, unblocked)
  and #14 (non-code, now has a stub) are also grabbable. `/orchestrate-team` on the frontier.

## 2026-07-24 (session 20) — `/to-tickets` on #11: the onboarding spec sliced into 12 tickets (#12–#23), native-blocked (no product code)

Ran `/to-tickets` on **[#11](https://github.com/adrien-mounier/jobcrush-app/issues/11)** → published **12
tracer-bullet tickets (#12–#23)**, all `ready-for-agent`, wired with GitHub **native `blocked_by`**
dependencies. No product code; the only repo change is this tracking-file sync. Parent spec #11 untouched.

**Sliced by screen + the backend-truth epics, in the spec's own build order** (§Further Notes). The three
heaviest screens were each split into **two vertical halves** (a demoable slice each — never backend/frontend)
at Adrien's call, taking the count 9 → 12:
- **#12** E5-facing contract + hand stub — `FamilyFloor` + per-ad ranked-requirements (`zod` in
  `packages/contracts` like `roleCluster.ts`; JSON stub behind a provider fn like `matchPosting`).
- **#13** the **"no" write path + fact correction** — the one hard, *unblocked* backend epic: a negative
  claim distinct from `rejected`, a `Negative`/`renderable:false` node, never-re-ask on both store drivers,
  correction via the store's `edit()`.
- **#14** the 20-ads × 3-CVs taste-test (non-code, informs the wall) · **#15** front door + CV shortcut.
- discovery **#16 / #18** — 1a core loop (Q1 + promise + `composeCvLine` typewriter + section bars +
  persistence) / 1b the gate (essential band *asked*) + "no"/correction/triggered-dates/reader-only-after-CV.
- deck **#19 / #21** — 2a reveal + job card + the instant match tick / 2b swipe + widen-the-net loopback.
- profile **#17 / #20** — the badge (pile that only grows) / the screen (Sorted + Constellation + colour law).
- **#22** the wall at the reveal (reuses S2 `auth.ts`/`oauth.ts`) · **#23** tailor (re-score + live card + exits).

**The DAG (native `blocked_by`, verified):** roots **#12 #13 #14 #15** (the open frontier) → #16 → {#17, #18}
→ {#19, #20} → {#21, #22} → #23. ~47 story points across the twelve.

**Grounded, not guessed.** Re-verified every reuse-vs-rebuild claim in code before writing the tickets:
`graph.ts` hardcodes `renderable:true` (no `Negative` path), `grill.ts`'s `detectGaps(confirmed)` re-derives
holes (so a "no" returns), `preview.ts`'s `loadPostings`/`matchPosting` is the provider+stub pattern,
`claims.ts` `ClaimDecision = pending|confirmed|rejected` with an existing `edit()` on both drivers. Tickets
say "extend," not "rebuild."

### Next session starting point
- **`/orchestrate-team` on the frontier (#12 #13 #14 #15).** #12 (contract) and #13 ("no" write path) unblock
  the most — the natural first pull; #14 (taste-test) is non-code and rides along. The tracker is the memory:
  work the frontier (any ticket whose blockers are all closed), clearing context between slices.

## 2026-07-24 (session 19) — The onboarding design → a spec: `/to-spec` #11, seams pinned (no product code)

Ran `/to-spec` on `docs/onboarding-reward-design.md` → published
**[#11 — Spec: the onboarding journey (front door → discovery → deck → tailor)](https://github.com/adrien-mounier/jobcrush-app/issues/11)**,
`ready-for-agent`. Synthesized from the design (grill 2026-07-22→24; wayfinder map
[#5](https://github.com/adrien-mounier/jobcrush-app/issues/5), closed tickets #6–#10, each with a
built-and-pressed prototype). No product code; the only repo change is this session's tracking-file
sync. Left a pointer on map #5 linking the spec.

**Synthesis, not a grill.** The design was already locked-decisions-only, so `/to-spec` synthesized
what was pinned rather than redirecting to `/grill-with-docs`. Read the whole S2 spine first
(`graph.ts`, `claims.ts`, `grill.ts`, `gate.ts`, `preview.ts`, `routes/onboarding.ts`, `sessions.ts`,
the contracts + oracles) to ground the seams in real prior art.

**Seams pinned — the contract `/tdd` will honour** (spec's Testing Decisions):
- **Primary: the onboarding/discovery HTTP API** — every server-decided behaviour (stage machine, the
  "no" write path, never-re-ask, the instant match tick, section-bar gate, fact correction,
  server-side persistence). Prior art `apps/api/test/onboarding.test.ts`, `api.test.ts`.
- **The four-screen Playwright journey** — front door → discovery → reveal → swipe → tailor → wall.
  Prior art `apps/web/e2e/onboarding.spec.ts`, `errors.spec.ts`.
- **The E5 boundary as a pinned fixture, not a third test seam** — a `FamilyFloor` + per-ad
  ranked-requirement zod contract (`packages/contracts`, like `roleCluster.ts`) + hand JSON stub
  (`apps/api/data/`, like `sample-postings.json`) behind a provider fn (the `matchPosting` pattern).
  The flow builds and tests against the stub now; E5 swaps the *producer* later with no UI change.

**Scope calls captured in the spec:** build the flow now, stub the engine (§3's decoupling, softened
2026-07-24). The one hard, **unblocked** backend requirement is the **"no" write path** — persist a
negative as `classification:"Negative"`, `renderable:false`, and never re-ask it (this session or a
later one); `graph.ts` hardcodes `renderable:true` with no `Negative` path, `claims.confirmed()` drops
rejected claims, `detectGaps()` re-derives from the confirmed set — so today a "no" is re-asked. The
contract already allows the fix; only the write path is missing. Recommended as the first ticket (no
stub). Out of scope: E5 itself, the canonical core-CV section list, the real family classifier,
revise-a-fact-later, the honest background re-score / month-two re-scoring. Carried risks each name a
mitigation (contract+stub; the 20-ads × 3-CVs taste-test run *in parallel*, not a gate; the wall's
position reversible post-launch on server-side drop-off).

**Context-file sync: no changes.** `CLAUDE.md` and `AGENTS.md` shared cores are byte-for-byte identical
(last synced 2026-07-19, untouched this session); private zones legitimately differ (Claude Code vs
non-Claude-Code notes). No new `lessons.md` entry — the design-work lessons (gate-softening, spine-check,
discriminator-vs-floor, prototype-first) are already recorded; this session was a clean synthesis with
no new surprise.

### Next session starting point
- **Run `/to-tickets` on [#11](https://github.com/adrien-mounier/jobcrush-app/issues/11)** — it is
  milestone-sized; slice it in the design's build order (§4 bar → CV typing → unlock; screens 0→3):
  **(C)** the `FamilyFloor` zod contract + stub · **(1b) the "no" write-path + fact-correction backend
  epic — start here, buildable now with no stub** · **(0)** front door · **(1)** discovery + typewriter
  + section bars + the promise + question 1 · **(2)** reveal + job card + swipe · **(3)** tailor loop +
  exits · **(P)** profile badge + Sorted + Constellation · **(X)** the wall re-position.
- The **20-ads × 3-CVs taste-test** and the **E5 `FamilyFloor` contract** can both start immediately, in
  parallel with the build (they gate nothing).

## 2026-07-24 (session 18) — The profile screen: two views, gold = on your CV, and two backend holes found (no product code)

Resolved and **closed** [The profile: the badge that grows and the screen it opens](https://github.com/adrien-mounier/jobcrush-app/issues/9)
— the **last ticket** on the wayfinder map [Onboarding journey: landing to first card](https://github.com/adrien-mounier/jobcrush-app/issues/5),
so the map's destination (a decided onboarding design, ready for `/to-spec`) is now **reached**.
Commits `2865e4d` → `2b0ac38` → `e804782` → `d601df9` → `ce8fb08`. Doc: `docs/onboarding-reward-design.md`
§8.3 resolution block (+ §6.2 amendment). Prototype: `apps/web/prototypes/profile-screen.prototype.html`.
Artifact (private): `https://claude.ai/code/artifact/afd3e90b-8fb3-4c4d-b4fc-2ca0ee4921c1`.

**Three shapes on the same real claim-graph facts**, pressed on a phone: the strata (profile-as-time),
the constellation (profile-as-graph), the character sheet (profile-as-what-you're-made-of). The strata
was dropped. Adrien's call: **keep two** — the character sheet (**Sorted**) for real use, and the
**Constellation** because it is the screenshot that may sell the app one day. They live behind an
in-screen icon toggle, centred in the top bar.

**The constellation is rebuilt to the Obsidian/Logseq graph-view register** — canvas with additive
bloom, per-point depth/drift so it levitates, and desktop hover that lights a node and its own web
while the rest recedes. Deliberately **marigold, not the violet every second-brain app uses**. Density
becomes light, so telling us more makes you brighter, and a glow has no full state to grade against (§7).

**Adrien re-pointed the colour axis, and it is the load-bearing decision.** Gold stops meaning "you
told me this" (the source) and starts meaning **"on your CV right now"**; cool grey means **"saved to
the profile, waiting for a job that asks"**. Source is demoted to neutral text. One law across both
views, taught in the header sentence itself (the on-CV count gold, the waiting count grey). This makes
§8.1's honest line visual and always-on, and gives the screen a story: early a short CV is mostly gold,
and the grey reserve grows as the profile outgrows two pages — a positive, never a lack.

**The ruled-out "no" was removed from the screen** on Adrien's push, and the reason generalises §7: a
number on a job is information, on a person a grade — and so is a "no". A list of what you lack is an
inventory of gaps. It still lives in the claim graph and works on the cards.

**That removal surfaced two real backend holes** (Adrien asked the right follow-up: "does hiding it
still stop us re-asking?"). Checked against the shipped S2 spine — **no**: `graph.ts` hardcodes
`renderable:true` with no `Negative` path, `claims.confirmed()` drops rejected claims, and
`detectGaps()` re-derives gaps from the confirmed set, so **a "no" would be re-asked**. §6.2 now carries
this as a hard E5/discovery requirement. And **nothing lets a user correct or revise a fact** — added
to the map (mistap-during-onboarding as fog; revise-as-life-changes as its own out-of-scope future
`/wayfinder` effort).

**Pressing caught what review would not**, and the **desktop pass was the story**: the iPhone context
reports `(hover: none)`, so the entire hover feature shipped untested until a 1280px pass was added —
which then caught a **badge/header count mismatch** (badge still counted the removed "no"s: 54 vs 47)
and a **latent throw** (the ignite ring referenced the old `TONE.you` key). 59 mobile + 4 desktop
checks green, both views, 6 / 24 / 47 / 200 facts.

**Follow-up decision — §3's reversal condition softened from a gate to a signal.** Adrien argued the
app can be built now and average CVs improved later without touching the design. Checked against the
code and it holds: tailoring lives in prompts + `preview.ts` behind the `llm.ts` seam and a versioned
card contract, `cv-quality-kickoff.md` §7 tunes quality by *changing a prompt and re-running the
workbench* (never a screen), and the posting-match is already a placeholder for the S3 cluster engine
"swapped later with no UI change". So §3 no longer gates the build — the 20-ads × 3-CVs taste-test
runs **in parallel**, deciding only (1) go/no-go on *bad* (not merely average) cards and (2) the wall's
opening position (§12), which is itself reversible post-launch on server-side drop-off data. §3 and the
doc's *Pending* section amended. The design survives average because the card never shows a bare number
(§7, §9.1) — it always shows the reasoning.

## 2026-07-23 (session 17) — The job card: a bubble that audits the number, and a reveal that hides the deck (no product code)

Resolved [The job card: what it shows and why it beats a job board](https://github.com/adrien-mounier/jobcrush-app/issues/10)
on the wayfinder map [Onboarding journey: landing to first card](https://github.com/adrien-mounier/jobcrush-app/issues/5).
Commits `589b3df` → `46849d3` and the follow-ups. Doc: `docs/onboarding-reward-design.md` **§9.1**
(new). Prototype: `apps/web/prototypes/job-card.prototype.html`. Artifact (private):
`https://claude.ai/code/artifact/2fd4ab9c-65ad-46e0-94a7-b0b0f20efc46`.

**Three shapes were built on the same job and the same facts**, so §3's reversal condition had a
control to be judged against: *the ad plus a number* (a job board with a score bolted on), *the
verdict* (every ask paired with the user's own fact, the ad demoted), and *the scorecard* (the ranked
requirement list in bands, no prose). Adrien took **the first shape's two lists, the second's
highlight bubble, and moved the ad to the bottom, folded shut** — a real ad is far longer than any
sample, and it is the one part of the card a job board already gives you, so leading with it spends
the user's first ten seconds on the part that is not ours.

**The bubble is why the % is never shown bare.** It sits directly under title/subtitle/score and
carries two clauses: the user's **strongest fact against something this ad leads with**, and the
**biggest thing still open**. A lone *61%* invites *"61% of what, and is that good?"* — a number
nobody can audit is a grade, which is §7's failure through a new door. The bubble is the audit, in one
sentence. Its gap clause is **derived** (the highest-ranked open requirement), so closing a gap
rewrites the sentence instead of leaving it stale.

**The reveal shows nothing behind it — a recommendation overruled, correctly.** A fanned three-card
haul was built: all three face-up, scored and sorted, so the number would read *comparatively* from
first sight (47 under 61 and 54 reads as *start here*; a lone 47 reads as a grade). Adrien restored
#8's curtain instead — one line, one button, no cards — because **seeing the deck early spends the
reveal and kills the mystery that carries the user into it.** The comparison still happens, one swipe
later: the deck is **sorted**, so it always opens on the best match.

**A "no" is a third mark, and it had to be made to pay.** Gold ✓ / grey `?` / a dim dot for
*asked and closed* — never a cross, because §6.2 rule 1 makes a "no" close a gap as well as a "yes"
and §7 forbids showing it as a failure. But a "no" moves the match % by **zero**, so §4's
*every answer produces visible feedback* would have broken on exactly the answers users give most.
What it pays instead: **the question goes away.** The item leaves *where you don't fit* and the bubble
stops naming it. Two things move on every answer and neither can embarrass anyone — the % only climbs,
the open list only shrinks.

**Also decided:** left swipe drops the job and nothing else (*"everything you told me stays on your
profile"*), and **the empty deck sends the user back to answering** rather than dead-ending — §5's
ladder with no top, and the moment the loop closes.

**Handed to E5, not decided here:** the bubble's *hit* clause is a judgement over an ad and a profile,
and it is build work with its own ticket. Recorded on `roadmap.md`'s E5 entry as its fourth debt.
The **wall** (§12) stays fog — the reveal now has a concrete *See them* button to hang it on, but
whether it sits before or after the reveal still waits on the S2.75 workbench.

Frontier after this session: **[#9, the profile screen](https://github.com/adrien-mounier/jobcrush-app/issues/9)**, alone.

## 2026-07-23 (session 16) — Discovery: one free box, a ranked floor, and a correction to the CV brain (no product code)

Resolved [The discovery questions: what we ask, how we choose, and when we stop](https://github.com/adrien-mounier/jobcrush-app/issues/6)
on the wayfinder map [Onboarding journey: landing to first card](https://github.com/adrien-mounier/jobcrush-app/issues/5).
Commits `dc8a300` → `d653c7d` and the follow-ups. Doc: `docs/onboarding-reward-design.md` **§6.1** and
**§6.2** (new). Prototype: `apps/web/prototypes/first-question.prototype.html`.

**Question 1 is one free text box, with no preset job options.** The ticket named *what "Something
else" opens* as its hardest part; building it dissolved the question rather than answering it. The
escape hatch **only ever opens the same free box** the boxless shapes lead with, two taps later, after
the screen has told the visitor they are unusual. So there is nothing behind it to design — **the box
is the question**, and a model places whatever is typed into a family. Adrien then dropped the preset
job chips outright: we do not know who is on the other side, so any list is wrong for most of them.

**The ask is wide, and the argument for it was not richness.** §6's promise reads *"142 project manager
jobs are open **in Paris** right now"*, and **nothing anywhere else in the whole flow asks where the
user is.** A title-only question 1 silently breaks §6. The placeholder — *"e.g. IT project manager in
Paris, mostly ERP, I use Jira and MS Project"* — is the teaching device, and every volunteered fact
pays out its own line in its own section (one answer produced three facts across two sections).
Suggestions widen to the **family**, under a label saying *same kind of job*: without the label,
offering other titles reads as *"your words were not found"*. Also decided: **no name on the CV** —
asking a stranger their name pays nothing back, and Google OAuth hands it over free at the wall (§12) —
and empty sections are **blank, not ruled** (dashes read as a form; space reads as an unwritten page).

**Discovery stops on a competitive rule, made to terminate by ranking.** Adrien chose *competitive*
(the CV covers what the family's ads ask for) over *structural* (the CV stands up as a document),
against the recommendation, and it holds up because of four rules: **covered means asked, not
satisfied** (a "no" closes a gap as well as a "yes", or every junior user is trapped forever); the
floor is **ranked** and the gate is its **essential band**, not a count; the items that fall through
are **the same queue as the card's weak fits**, which §9 already feeds to the tailor screen; and there
is **no escape button** out of discovery, because one would compete with answering and hand out the
weak deck as a choice (§3). Ranking is what keeps discovery short enough not to need an exit.

**Employers and dates are triggered by a reward, never scheduled.** `cv-authoring-rules.md` requires a
bold employer, a date line and a role title on every experience entry and forbids inventing them — but
that question moves no score, and it would land before any card exists. So the first time an
achievement needs a home, we ask *"nice — which job was that?"*, and the section unlocks. The most
form-like moment in the product becomes the container for something earned thirty seconds earlier.

**Two things the Playwright pass caught that looking did not**: the fixed note bar sat on top of the
last answer on a phone, and a freshly written CV line got shoved back under the fold when the next
question's options grew the ask band — which §8.2 explicitly forbids. Both are layout-shift bugs that
look fine in a static screenshot.

**The ticket turned out not to be blocked by the core-CV-structure fog**, which it expected to be: the
design references *"the section this item writes into"* abstractly, so it is specified against whatever
the canonical list becomes. That fog still blocks *building* the screen.

**Follow-up in the same session, prompted by Adrien: the §4 correction was swept through the repo.**
The first pass fixed `roadmap.md` and the design doc's *"What this changes"* and stopped there. The
belief had actually been copied into five places over three sessions, and three still carried it —
including **`tailoring-reasoning.md` itself**, the file everyone lands on, which had no note at all.
Now: §4 opens with a blockquote saying it is a discriminator and not a floor and pointing at §6.2;
`cv-quality-kickoff.md` §8 and `onboarding-reward-design.md` *"The shape"* carry dated corrections; and
session 14's entry keeps its wrong sentence with a correction under it, because a log records what a
session believed rather than what turned out to be true.

## 2026-07-23 (session 15) — The front door: its words, then its shape, decided twice (no product code)

Resolved [Front-door copy: the invitation and the skip-ahead](https://github.com/adrien-mounier/jobcrush-app/issues/7)
on the wayfinder map [Onboarding journey: landing to first card](https://github.com/adrien-mounier/jobcrush-app/issues/5).
Commits `e35da28` → `ca9e705` and the follow-up. Doc: `docs/onboarding-reward-design.md` **§10.1**,
rewritten mid-session. Prototypes: `onboarding-screen.prototype.html` (screen 0) and
`front-door-options.prototype.html` (the five shapes).

**The decided door**, everything centred:

> ## Answer questions. **Collect jobs.**
>
> ### ( Ready? )
>
> <sub>Already have a CV? **Upload it** and skip the questions it already answers.</sub>

Three beats, in order: **the invitation writes itself letter by letter → Ready? fades up → the CV
shortcut arrives last, at the bottom edge.** The order is the argument — the main path is fully
offered before the side door is mentioned. Pressing Ready **parts the invitation like a door** and
discovery arrives through the gap.

**The words were settled first, and never moved.** Four candidates were written into the prototype and
read on the real screen. *"Answer questions. Collect jobs."* won because **it is the only headline that
never mentions a CV** — questions in, jobs out — so the no-CV user §1 brought into scope is never told
they are missing something. Rejected: *"Which jobs would you actually get?"* (sharpest differentiator,
but *"actually get"* can be heard as *"probably none"* — §7 through the side door), *"Let me ask you
about your work"* (asks for effort, names no payoff), *"You don't need a CV to start"* (best for the
no-CV user, but leads with the CV, which §2 says nobody wants).

**The shape was decided twice, and the second answer reversed the first.** The initial resolution made
the door *be* question 1, with no Ready button, reasoning that a Start button is a tap returning
nothing — the inverse of §4's *tiny action → instant visible response*. Adrien asked to see the
Ready-screen version anyway. **Five shapes were built and pressed rather than argued about**, all
landing in the same place so only the threshold varied. The reasoning turned out too narrow: **a tap is
only dead if it gives nothing back.** A Ready screen buys a designed moment, gives the invitation a
screen it does not share, and asks for **consent** — agreeing to be interviewed is a small promise, and
people keep small promises; tapping a job title commits you to nothing. Rejected shapes are in
`front-door-options.prototype.html`: the fused door, a pulsing mid-screen target that grows into the
question panel, the door rewriting itself into the question, and a blank sheet sliding up before the
first answer.

**The typing is a requirement, not an effect.** The CV writes itself the same way on every screen that
follows (§8.2). The door is the first time anyone sees this product move, and it moves the way the
product moves — so it teaches the mechanic before explaining it.

Three things building it proved, none of them arguable on paper:

- **Centred text that types itself jitters** — every letter re-centres the line. Each line now carries
  a hidden copy of its finished text to hold the width open; the letters fill a fixed box. Measured
  drift after the fix: **0.00px**.
- **The animation must be skippable.** ~1.5s passes before the button exists. A tap anywhere finishes
  it; `prefers-reduced-motion` skips it outright.
- **The CV shortcut belongs at the bottom edge, never under the button** — directly beneath "Ready?"
  it reads as the second of two choices, the fork §10 exists to forbid.

**A real bug found on the way, affecting every prototype session so far:** neither prototype had a
`<meta name="viewport">`, so phones laid them out at ~980px and zoomed out. **Every "open it on your
phone" before this was showing the wrong size.** Fixed in both. See `lessons.md`.

**Three things the door may never say**, none of them taste calls — each is a consequence of a decision
made in an earlier session and never carried across to the words: no count or duration (§6 made
discovery variable-length), nothing about account, price or signup (§12 walls after the reveal), and
the skip-ahead must say it skips *the questions the CV answers*, not the process (§11 — a CV buys one
jump). Also in `lessons.md`.

**[The discovery questions](https://github.com/adrien-mounier/jobcrush-app/issues/6) is unblocked**, and
what it inherits changed with the shape: question 1 no longer carries the conversion — "Ready?" does —
so it now addresses someone who has already opted in. Still binding: its answer must yield a **job
title or family** (the CV's role line is written from it), and the prototype's closed list of three PM
titles cannot survive a real stranger, so the dashed **"Something else"** hatch is required and
designing what it opens is the hard part.

Map frontier now: **#6** (unblocked by this), **#9** (the profile screen), **#10** (the job card).

## 2026-07-23 (session 14) — The onboarding screen prototyped; the flow became three screens (no product code)

Resolved [The onboarding screen](https://github.com/adrien-mounier/jobcrush-app/issues/8) on the
wayfinder map [Onboarding journey: landing to first card](https://github.com/adrien-mounier/jobcrush-app/issues/5).
`/prototype` in the browser, worked live. Asset: `apps/web/prototypes/onboarding-screen.prototype.html`.
Doc updated in place — read **"The shape"** at the top of `docs/onboarding-reward-design.md` first.

**The ticket asked what one screen looks like. Building it proved there isn't one.** Discovery has no
cards on it — they don't exist yet — so the screen has two phases, and once split they turned out to be
three screens with three different jobs: **discovery** (CV + questions only, runs until the root CV
covers the family floor) → **the deck** (full-screen swipeable job cards, no questions) → **tailor**
(job + score on top, CV below, questions aimed at that one job). Layout **C, split bands** won for 1
and 3; the CV-as-full-screen-stage and the sealed-deck variants are dead.

What that killed: **the flat 5→3 pace**, the *"3 answers until your next jobs"* countdown, and
"three cards re-score live" (only one card is ever live now — cheaper and clearer). **"The bar never
completes"** survived but amended: discovery *does* complete, and that is fine because **completion is
a door into the deck, not a finish line**.

Decisions worth a future reader's time:

- **The card's weak fits became the tailor screen's questions.** Answer one and a grey `?` flips to a
  gold `✓` **on the card in front of you**. This emerged from needing something for screen 3 to ask
  about — it wasn't designed. It turns "where you don't fit" from a verdict into a to-do list, and it
  gives E5's ranked requirement list a third job: score the match, explain the gap, choose the question.
- **The CV opens with its skeleton visible and empty** — summary / experience / skills / education,
  ruled. You see the shape of what you're filling before you fill it. The progress bars carry those
  same section names, so a bar filling and a section filling are one event shown twice.
- **Profile badge: a pile that only gets taller, with the count beside it**, and the word *facts* next
  to it for the first few answers, then gone. "24" alone is meaningless — a number needs a unit. Two
  shapes banned: anything that **fills** (a full state makes a half-full one read *you are 40% of a
  person* — §7 through the side door) and anything **document-shaped** (it would compete with the CV).
- **Two exits, one landing.** A quiet *"I'm done — use this CV"* from the very first question, plus the
  automatic version when questions run out. Both → **Apply** vs **Save for later**. Plus a discreet
  **Drop this job** that says what survives: *everything you told me stays on your profile*.
- **The existing design system was rejected outright** as not good enough, so the visual direction
  started from scratch: **ink and glass** — charcoal chrome that recedes, the CV as warm lit paper (the
  only bright object, because it's the thing being made), marigold for anything earned since the
  metaphor is already loot, serif for the document because a serif typing itself reads as *written*
  rather than *saved*. `packages/ui/src/tokens.css` is no longer a constraint on this work.

Tracker: #8 closed with the full record. #6 widened to own the stopping rule (same checklist picks the
question and decides when to stop, so it's one ticket). #9 widened to hold the badge decision. Map
updated — new fog on where the wall sits now, and *where a saved application lives* ruled out of scope
(the tailor screen's exits sit past this map's destination).

## 2026-07-23 (session 13) — Onboarding reward structure: 13 decisions locked (no code)

Design session, no code. Answers **open question A** from session 12 (the grill's stopping rule +
onboarding UX). Full record: [`docs/onboarding-reward-design.md`](docs/onboarding-reward-design.md).
The question was "what actually pulls a user through the questions?", made urgent because the no-CV
user is now in scope and today's only reward — the CV preview — cannot exist for them.

**The two moves everything else follows from:**

- **Cards are the payoff, the CV is the by-product.** Nobody wants a CV; they want a job. This fixes
  the meaning of every question in the middle — "do you know C?" now reads as *unlocking jobs*, not
  *polishing a document*. The magic-mirror preview stops being the hook.
- **One visible number: the match % on a job card.** The profile level/strength meter was designed,
  then deliberately killed. A number on a *job* and a number on a *person* are different objects at
  identical maths: "this job: 34%" is useful, "your profile: 34%" tells a human being in their first
  minute that they are poor — and it lands hardest on the user who arrived with nothing. The bar
  survives with **no digit at all**: *"3 answers until your next jobs"* — a countdown, not a score.

Other decisions worth a future reader's time:

- **The stopping rule is that there is none.** The bar never completes; it only ever counts down to
  the next drop, so nothing is ever "incomplete" and the user leaves whenever they like holding what
  they earned. Both known failures avoided: LinkedIn's meter you can never finish, and the 100% bar
  that makes people stop forever.
- **The progression moved onto the collection**, since the level number is gone: **the CV typing
  itself letter by letter** on every answer, **the profile** filling up and never resetting, **cards
  as loot** ("you have 12 jobs" only goes up), and
  **percentages that climb**. That last one is the **month-two answer** nobody had: a returning user's
  old 34% card reads 51%.
- **Visible cards re-score live on every answer**, but the tick is a **lookup, not a model call** —
  E5's ranked requirement list per ad makes it instant and free; the honest re-score lands in the
  background at the next drop. Constraint: the cheap tick under-promises, because **a visible number
  must never go down**.
- **One flow, one door.** A CV is a shortcut that auto-answers questions, never a second path. The
  landing is a single "ready?" invitation to be interviewed, with a small *upload your CV to skip
  ahead* beside it — this decides the previously-open **input order** question: job intent first.
- **A CV buys one visible jump, then the game continues** — and the first question after upload must
  be one only a reader could ask ("your CV mentions a 2024 migration — what was your actual role?").
  That proves we read the file better than any progress bar. Good CV = fewer questions to a good
  match; where you start does not matter.
- **The wall moved to after the reveal, onto the actions** (save / apply / see the rest / alerts).
  Google OAuth leads, magic link is a deliberately quiet secondary — firing an email at peak
  curiosity is the known-fragile path. **Answers persist server-side from question 1**, because
  localStorage cannot tell us where people quit.
- **Reversal condition, written down:** if v1 cards are not obviously better than a LinkedIn search
  in ten seconds, the wall moves *before* the reveal. A promise beats disappointing proof. The
  evidence for it is a half-day experiment, still pending: score 20 real ads against 3 real CVs,
  print the 9 cards, look at them.

- **The profile and the CV are two different objects** — a late correction that would have broken the
  build if it had stayed buried. They spent most of the session collapsed into one thing called "the
  document". A toy box and a school bag: the profile **accumulates** (unbounded, never drops a fact —
  it is the S2 claim graph, finally getting a face) and the CV **selects** (2 pages, aimed at one job).
  The live typing belongs to the **CV**; the profile gets a chip that **flies into an icon** which
  ticks up, loot-into-inventory style, because four things (question, CV, profile, cards) do not fit on
  a phone and the store is the one that is satisfying to *open* rather than watch. Falls out of it: a
  fact can land in the profile and not on the CV, and we must say so or the typewriter looks broken.
- **The CV on screen follows the card you are looking at** — generic root CV during the first
  questions, then it **re-aims** when the cards land and swaps on swipe. Reason: the line you watch
  being typed and the % that jumps are then the same event on the same screen. A generic CV puts the
  line over here and the number over there, connected by nothing.

Method note: the session ran as `/grill-me` (13 forks, one at a time), with the numbers question
handed to a `/multi-llm-adversarial-validation` council mid-way — the council's push is what
converted "two numbers, level framed as a fuel gauge" into "one number, kill the level entirely".

## 2026-07-22 (session 12) — CV quality: grilling session, 11 decisions locked (no code)

Pure design session, triggered by reading a real tailored CV and finding the sentences too complex,
unclear, and AI-sounding. Decided to fix the *measurement* before the symptom, and it went wider than
sentence style: it redefined what "quality" means for this product. Full record:
[`docs/cv-quality-kickoff.md`](docs/cv-quality-kickoff.md).

The headline shift: **quality = fit to the job**, not intrinsic well-formedness — but every claim stays
grounded in experience the user confirms. The enricher derives a target checklist from the offer and
*asks* ("C matters here — any experience, even a school project?"); real experience becomes a claim,
none means swipe left. The checklist decides what we ask, the user's answers decide what ships.

Other locked decisions worth the future-reader's time:

- **Suggested specifics are switch-off chips.** A claim is written at full strength; the details the
  model *inferred* (memory management, performance tuning…) are chips the user taps off, with a notice
  that anything kept becomes theirs and may be interviewed on. Kept chips → confirmed claims; dropped
  chips never enter the graph. This replaced an earlier two-version intensity slider — the chips *are*
  the intensity control.
- **Two dials: claim big, write plain.** Claim size and writing density are separate. The session's own
  example proved it: the "stronger" line carried the rule-of-three *and* "solid" — which
  `ai-writing-tells.md` lists as the *replacement* for banned "robust". The model reached for the safe
  synonym anyway, which is exactly why a model cannot grade its own style.
- **Two scores that never mix:** *well made* (mechanical lint over `cv-brain` rules) and *aimed at this
  job* (model panel). Merging them hides which half broke. Noted: **no rule in `cv-authoring-rules.md`
  ever looks at the job offer** — a plumber's CV can score full marks and be sent to a C job.
- **Anything countable gets counted, never judged.** Lint owns mechanics; a *fresh* model (plus a 4-5
  model panel) judges only what counting cannot see. The scorer sees the CV **and** the confirmed
  claims, so "we forgot to ask" is distinguishable from "the user genuinely lacks it" — the same line
  the S2 gate draws: judge our pipeline, never the user's career.
- **Workbench before live meter.** ~5 *real* CVs (LLM-written ones would poison it: robot in, robot
  out) + LinkedIn ads, generated ads as fallback. A magnifying glass, not statistics — 100+ cases for
  statistical power will never exist.
- **E5 got its real shape:** offline monthly research per big job family (the floor) + one cheap LLM
  call per ad (the specifics), cost tracked per job. `tailoring-reasoning.md` §4 is already the
  hand-written PM-only prototype of that family floor, and its "shared baseline (ignore — too generic)"
  list is what makes keyword ranking work at all.
  <br>⚠️ **The §4 claim in the line above was wrong, corrected in session 16 (2026-07-23).** §4 is a
  discriminator, not a floor; the floor does not exist and E5 builds it from scratch. Left in place
  because this log records what the session believed. The second half stands — the shared-baseline
  list really is what makes keyword ranking work.

Two questions were deliberately **not** answered, each needing its own session: **(A)** the grill's
stopping rule + onboarding UX (merged with the existing Tinder/Bumble backlog item, promoted to next
session, `/wayfinder`), **(B)** how `cv-authoring-rules.md` gets fed and maintained (backlog, after A).

Roadmap gains **S2.75 — CV quality (the ruler)** between S2.5 and S3. No code changed.

## 2026-07-19 (session 11) — Staging ops leftovers: real email wiring + OAuth verified + sending domain

Closed the two S2 ops leftovers (config, not code) and set up the real sending domain.

- **Real magic-link email is live on staging.** Set `RESEND_API_KEY` + `WEB_URL`
  (`https://jobcrush-web-staging.fly.dev`) + `MAIL_FROM` on `jobcrush-api-staging` via `flyctl secrets
  set` (staged the two non-secrets with `--stage`, then one real set applied all three in one restart).
  Started on Resend's test sender `onboarding@resend.dev` (delivers only to the account owner's own
  address) — verified end to end: a magic-link email arrived and signed in.
- **Google OAuth verified** by a real cross-browser click-through on staging: "Continue with Google" →
  Google → back to `jobcrush-web-staging.fly.dev` signed in. No redirect-to-localhost regression (the
  `058a2ad` relative-redirect fix holds). **So external users can already sign in via Google today.**
- **Custom sending domain `jobcrush.org` verified in Resend.** The name "JobCrush" is contested but
  *unregistered* — an early-stage German JobCrush (same concept) + an active JobCrusher.com exist, no
  trademark filing in USPTO/EUIPO; user chose to keep the name for now and bought `jobcrush.org`
  (`.com`/`.in`/`.top` taken; picked `.org` over `.vip`/`.work` for email deliverability). DNS is on
  Cloudflare (Cloudflare Registrar) — added the 4 Resend records (DKIM TXT `resend._domainkey`, MX +
  SPF TXT on `send`, DMARC TXT `_dmarc`), verified.
- **`MAIL_FROM=JobCrush <login@jobcrush.org>` is STAGED, not live.** Resend's 1-free-domain-per-account
  limit meant `jobcrush.org` had to go in a *second* free Resend account (`+jobcrush` plus-address), so
  activating it needs the API key from **that** account swapped onto staging. User deferred that swap —
  until it lands, staging still sends via the test sender (owner's address only). So **email-signup for
  strangers is one `flyctl secrets set RESEND_API_KEY=…` away**; Google-signup already works.
- **Security debt:** two Resend keys got pasted into the session transcript (the `!` prompt echoes) —
  flagged for deletion/rotation; the eventual `jobcrush-staging` key must be set from the user's own
  terminal, never the chat.

No code changed — pure staging config. `roadmap.md` + `lessons.md` updated.

## 2026-07-19 (session 10) — S2.5: `/impeccable critique` of the web flow + first harden batch

Ran a dual-agent `/impeccable critique` over the whole web workflow (landing → import → progress →
preview → signup → deck → ready). Score 24/40, cognitive load HIGH; deterministic detector clean;
snapshot at `.impeccable/critique/2026-07-19T04-48-20Z__apps-web-app.md`. Headline: not AI-slop but
*under-designed* (no brand presence; the evidence-badge palette + `classification` data are fetched
and never rendered), one P0, and an anticlimactic ending (the verified CV never renders as a document,
no download).

Then applied the P0 + four supporting harden fixes (this branch):

- **P0 — magic link opened in another browser orphaned the session.** The job *and* claims are
  anchored to the anonymous session that uploaded (`job.sessionId === session.id`), and verify claimed
  *the opener's* session — so a mail-app in-app-webview open both lost the jobId (per-browser
  localStorage) and, even resumed, 404'd the deck. Fix: the login token now carries the requesting
  session id (`login_tokens.pending_session_id`, additive migration); verify claims **that** session
  and re-homes the opener's cookie onto it, so every continuation path (webview *or* back-in-Safari
  *or* different device) lands on the right claimed session. The jobId also rides the emailed link
  (`?job=`) so routing survives cross-browser. OAuth is same-browser by nature — left as-is. New
  store-contract test (pendingSessionId) + a cross-browser route test; the verify 400/401 ordering
  flipped (bad token is 400 regardless of session) and its test updated.
- **Signup typo recovery** — the "check your email" card now has "Wrong email? Change it" (keeps the
  typed address).
- **Deck batch persistence** — verbatim keep/drop persists per tap (optimistic + revert), rehydrates
  from the server on load (drops survive refresh), and Continue confirms the kept-by-default set in
  parallel + idempotent instead of a fragile sequential commit loop.
- **Preview polling** — polls while the server says `not_ready` instead of flashing a dead-end error
  when the render lags the job's completion.
- **Deck friendly not-found** — a bad/expired jobId shows a friendly screen with "Upload my CV",
  not the raw error string.

api 160 pass, typecheck 7/7, web build clean.

**Then batch 2 — the ending (the critique's biggest gap).** The ready screen ("You own your facts")
was flat trace bullets that never rendered as a document, never used the evidence-badge palette (the
product differentiator — `classification` is fetched and was thrown away), never resolved the
preview's watermark promise, and dead-ended. Rebuilt: a "✓ Verified · watermark removed" seal, a
per-line evidence badge in the shared token palette (new `.badge` component in globals.css, keyed
`verified/derived/partial/suggested/negative`) with a one-time legend, the CV styled as a real
document (`.cv-doc`/`.cv-line`), and a "What happens next" card ending the flow forward (S3 hunt,
honestly "rolling out"). Per-line "fix" (kickoff decision 7) kept; the e2e "•" assertion swapped for a
`cv-bullet` visibility check. Badge palette battle-tested via a throwaway static harness screenshotted
at 1280/375 (0px overflow both). Kept `You own your facts` + `rootcv`/`cv-bullet`/`fix-editor` testids
so the onboarding e2e still holds. `color-mix(in oklab, …)` for the badge tints passes the Next CSS
pipeline. api 160, typecheck 7/7, web build clean.

**Then batch 3 — brand + a11y + copy (closes S2.5).**
- **Brand presence:** app-wide `.brandbar` (JobCrush wordmark, accent) in `layout.tsx` — every screen
  now shows the product; there was no logo/wordmark anywhere before.
- **A11y:** one authored `:focus-visible` ring app-wide (there were *zero* focus styles); `aria-live`
  on the SSE feed (the trust engine was silent to SR) + `role="alert"` on every flow error +
  `role="status"` on transient notices; `aria-pressed` on landing + deck chips; `aria-label` on every
  placeholder-only input; chip touch target ~33→~40px; `input[type=email]` finally styled (batch-1 P2);
  preview iframe now fits to width on mobile — the deferred server-side change landed: a
  `width=device-width` viewport meta (was absent, so the iframe laid out at ~980px and overflowed) +
  a `max-width:600px` padding trim in `renderPreviewHtml`. The "pinch to read" hint became "scroll
  inside to read it all"; content now reflows to the iframe width and only scrolls vertically.
- **Copy:** signup h1 "Save your draft to your account" (was "unlock your draft" — confusing right after
  they saw it; the e2e heading assertion moved with it); preview→wall forewarning "takes an email, no
  password"; import door "Build it with me" → "Paste your CV text" (label now matches its paste
  destination); the untrue "stays on your device" import lede → "we use it only to build your draft".

Whole flow re-screenshotted via a booted dev server (landing/import/signup/paste, desktop + mobile) —
0px overflow, brand bar + chips + styled inputs all clean. api 160, typecheck 7/7, web build clean.

**Then batch 4 — backlog cleanup (closes the critique's full 5-command plan).** A self-audit against the
recommended actions surfaced four sub-items the first three batches skipped:
- **clarify / gate-error strings:** the loopback ("Almost there") dumped raw mechanical gate strings
  (`entry[2] "…": nodeId "x" is not user-confirmed`). Now it shows the already-human ones (empty-CV) and
  folds any technical trace/structural strings into one actionable line.
- **shape / deck progression:** an "N of M reviewed" counter beside the "Worth a closer look" heading
  (`.deck-progress`) — the grind becomes a countable task.
- **colorize / deck claims:** each individual claim card now carries its evidence badge (the reusable
  `.badge` + `evidenceBadge()` helper, hoisted above DeckScreen). `classification` was fetched and unused
  on the deck itself; now shown where it varies (machine-touched claims), not on verbatim chips.
- **polish / button-state + chip-overflow:** `.btn`/`.btn-secondary`/`.chip` get hover + active states
  (150ms, `color-mix` darken, 1px press) with a `prefers-reduced-motion` guard; `.chip` gets
  `max-width:100% + overflow-wrap` so a long batch claim wraps in-card instead of overflowing.

Deck confirm + loopback verified via a throwaway harness (desktop + mobile, 0px overflow; badges,
progress line, hover state, and long-chip wrapping all correct). api 160, typecheck 7/7, web build clean.
S2.5 fully closed against the 5-command plan; next is S3 (the hunt, E5 cluster engine).

## 2026-07-19 (session 9) — Staging bugfix: miner fails a job on an over-long source_quote

User hit "Something went wrong while processing your CV" on staging `/import`. The staging
guestbook (`/guestbook`, run #13) showed the real error in one click: the miner LLM emitted a
`source_quote` > 200 chars, the candidateClaims zod cap rejected it on both attempts, job failed.
The 200 cap is ours alone (not in any `.mjs` oracle), the prompt already says ≤ 200, and
`grill.ts` already `.slice(0, 200)`s the same field — so this is the `slugifyClaimIds` class:
a deterministic, semantic-preserving repair, not a retry. `slugifyClaimIds` became
`repairClaims` (miner.ts) and now also clamps `source_quote` to its 200-char prefix (still a
verbatim CV fragment; the eval grounding check only uses the first 60 chars). One new miner
test. api 157 pass, typecheck 7/7.

The last two S2 pieces (kickoff decisions #6 and #7), closing the slice; then Google sign-in
ported from vitacairn onto the signup wall.

**Google OAuth** (ported from vitacairn's `oauth.ts` + routes, by copying — same auth-code flow,
no SDK): `GET /auth/google` (state CSRF cookie → Google) and `GET /auth/google/callback`
(state check → code→email exchange → `upsertUser` + `setClaimedByUserId`, the same JC-19 seam as
magic-link verify — the anonymous preview follows the user into the account). The exchange is
injectable (`googleEmail` in BuildOptions) so tests fake it; unconfigured → the signup page shows
the email fallback message. Web: "Continue with Google" button on `/signup`, `/auth/verify?oauth=ok`
resumes to the stashed deck. 4 new route tests (unconfigured redirect, CSRF guard, happy-path
session claim, failed-exchange never claims). Needs on staging: `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `WEB_URL`, and the redirect URI `<web>/api/auth/google/callback`
registered in the Google console (dev: `http://localhost:3000/api/auth/google/callback`).

- **Audit** (`audit.ts`, `prompts/root-cv-audit.md`): inside `/onboarding/build`, after render and
  before the gate, the LLM polishes bullet wording against the cv-brain rules. Same shape as the
  grill: the model only rewords, mechanics decide — user-authored bullets (deck edits, grill
  answers) are never sent; a polished bullet is accepted only if its numbers match the original
  exactly and it carries no forbidden glyphs (else that bullet keeps its original text); any
  failure (LLM down, bad JSON, wrong count) ships the unaudited CV. Trace nodeIds are untouched,
  so the gate certifies the audited trace unchanged. `renderRootCv` refactored to expose
  `markdownFromEntries` so the audit rebuilds markdown from polished entries.
- **Review** (deck page `BuildOutcome`): the ready screen now renders from the trace (grouped by
  section), each line with a "fix" affordance — edit becomes a user-authored claim via the existing
  `PUT /claims/:id`, remove rejects it, then the CV rebuilds through audit + gate. Never a freeform
  CV editor; a remove that empties the CV lands in the existing loop-back, never a dead end.

Verified: api 156 pass (audit guards unit-tested; route test proves mined-only polish + a dead
auditor never blocks the build; 4 OAuth tests); typecheck 7/7; build clean; all 6 browser e2e green
against the local stack — twice (once for audit+review, once after the OAuth wall change) — the
happy path fixes a line from the review and asserts the exact fixed words in the re-rendered CV.
Playwright suite timeout 240→300s (build carries an audit LLM call).

**Staging OAuth activated live** during the session: Google Cloud client created (guided), the
localhost-fallback redirect footgun found the honest way (a real click bounced to localhost) and
fixed (`058a2ad`, relative redirects — see lessons.md), Fly secrets set via
`~/.fly/bin/flyctl secrets set -a jobcrush-api-staging`, staging `/auth/google` verified 302→Google.
Note: the client secret was pasted into the session transcript — rotate in the Google console if
that ever matters. Session close: context files synced (AGENTS.md picked up PR #2's push-when-green
git workflow + the session-hygiene section; both status blocks now say S2 done / S3 next).

**S2 is done.** Next session: **kick off S3 (the hunt)** — E5 cluster engine first (riskiest), then
E6 feed + hunt, E7 swipe + prepared apply; worth a short design pass on E5 before coding. Ops
leftover: `RESEND_API_KEY` on staging for real email; confirm the Google click-through in a browser.

## 2026-07-19 (session 7) — E2 auth: magic-link, session merge, server wall, purge

The last S2 epic, built from a PO design pass (16 candidates → v1). Commits `c7228f8` (backend) +
`1b398b9` (web). Passwordless: request a link → click → the anonymous session is claimed for the user.

- `mailer.ts` (seam like `llm.ts`): Resend if `RESEND_API_KEY`, else a dev mailer that RETURNS the link
  so local/CI/e2e traverse signup without real mail.
- `auth.ts`: users + login_tokens, both drivers (pg-mem contract-tested). Tokens single-use + 15-min +
  stored only as sha256; a new link invalidates the prior.
- `routes/auth.ts`: request-link (per-IP rate limit, uniform 200 — no enumeration; dev link only when
  no real mailer), verify (consume → upsert user → `setClaimedByUserId` = the whole JC-19 merge), logout.
- `requireUser` on deck/grill/build — the wall is server-side (§8-3). `purge.ts` (JC-20): one rule,
  swept on boot + every 6h (Postgres only).
- web: `/signup` + `/auth/verify` pages; the deck redirects to `/signup` on a 401 (server is the wall,
  client reacts); `jfetch` now surfaces the error `code`.

Verified: api 145 pass (auth contract both drivers + security ACs, purge via pg-mem); all 6 e2e green
in a browser — the onboarding happy-path + loop-back now sign in through the wall before the deck
(logs: request-link + verify). typecheck 7/7, build clean. **Real-Postgres auth path verified against
staging** (`1b398b9`): the happy-path + loop-back run the full magic-link flow (request-link → verify →
session claimed, writing users + login_tokens on real Postgres) then the deck; the wall-redirect test
passes isolated in <1s (it flaked once under parallel load — bumped its timeout, same as the R2 case).

**S2 status:** the core loop closes end to end WITH accounts. Remaining S2 polish (not demo blockers):
the audit (LLM root-CV wording polish, decision #6) and interactive root-CV review (fix-this loop-backs,
decision #7). Staging returns the dev sign-in link until `RESEND_API_KEY` + `WEB_URL` are set.

**Next:** the audit + review polish, or start S3 (the hunt) — the S2 demo (ready profile + validated
graph in Postgres, behind a signup wall) is achievable today.

## 2026-07-18 (session 6) — JC-6 Postgres persistence (sessions + claim graph)

Chose "persistence first" over jumping to E2 auth: an account that vanishes on every deploy isn't an
account, and S2's demo goal is literally "claim graph v1 in Postgres." Commit `8a18efa`.

- `db.ts`: one shared, memoized pg pool + an `iso()` timestamp helper.
- `PgSessionStore` / `PgClaimStore` behind the existing interfaces, mirroring the guestbook's pg
  pattern (`CREATE TABLE IF NOT EXISTS` in `init()`, parameterized queries). `claims.seq bigserial`
  preserves CV order (load-bearing for deck tiers + the grill cap). Factories pick the driver by
  `DATABASE_URL`; `init()` added to both interfaces (in-memory = no-op). Jobs/uploads stay in-memory
  (transient run-state) — deferred.
- `main.ts`: build the stores from `DATABASE_URL`, `init()` before serving, fail fast if the DB is down.

Testing the load-bearing SQL with no CI database: a **shared store-contract test runs the same
assertions against in-memory AND Postgres via pg-mem** (an in-process Postgres), so the real SQL is
exercised in CI. It immediately earned its keep — caught that in-memory `seed` clobbered decisions on
re-seed while Postgres (`ON CONFLICT DO NOTHING`) didn't; fixed in-memory to match.

Verified: api 130 pass (16 contract tests, both drivers); typecheck 7/7; all 5 e2e green in a browser
(in-memory path). **Real-Postgres path verified against staging** (`8a18efa`): the happy-path +
loop-back e2e — which create a session and seed/confirm/add/read claims on Postgres, then build — pass
against live staging. (The unparseable-upload e2e flaked once against staging under parallel load — a
real-R2 upload latency issue, reliable locally; bumped its timeouts.)

**Next:** E2 auth (JC-18 magic-link → JC-19 anon→account merge at the preview moment → JC-20 anon
auto-purge) — now unblocked by persistence. Worth a short design pass (email delivery in dev/staging,
token storage, the merge semantics).

## 2026-07-18 (session 5) — JC-55 Path B stub → E3 complete

The last E3 ticket (commit `89b4c67`): a "coming soon" door on `/import` — "I don't have a CV yet" —
for the from-scratch guided interview that ships for real in S4 (s2-kickoff decision 8). Pure UI stub:
renders coming-soon and logs interest (click-through = demand data), with a message tailored to the
no-CV case rather than the generic "just upload a file." A fast deterministic e2e asserts the door.

**E3 (deck + grill) is now complete** — JC-22 tiering, JC-23 deck UI, JC-24 grill, JC-55 Path B stub.
With E4 done too, **E2 auth is the only S2 epic left**.

**Next:** E2 auth (JC-18 magic-link, JC-19 anon→account merge at the preview moment, JC-20 anon
auto-purge) — the signup wall. Worth a short design pass first: auth carries a security surface, and it
runs into the standing question of turning the in-memory stores into Postgres (JC-6) for S2's
"validated claim graph v1 in Postgres" demo goal.

## 2026-07-18 (session 4) — JC-24 the grill (gap-filling) shipped

The last feature of E3's deck+grill epic (commit `ba97b44`), built from a PO-grade plan (13 candidate
gap types → 3 ranked v1 types → dev plan). Executed with one improvement found by reading the miner
contract first: detection leans on signals the miner already computes (`claim-miner.md` rule 4:
`needs_grill` + `grill_hint`; `MinedRole.dates_missing`) rather than re-deriving gaps with brittle regex.

- `grill.ts`: `detectGaps(confirmed, roles)` — pure/deterministic. Two gap types: **missing-dates**
  (per undated role that still has a confirmed claim, ranked first) and **needs-info** (per `needs_grill`
  claim using its hint; deduped against a role already getting a date question). Capped at 5.
  `templateQuestion` is the always-on fallback; `makeGrillPhraser(llm)` is the prod LLM path with a
  per-call template fallback (the model can never take the grill down). `answerToClaim` →
  verbatim/Verified/user-authored, `needs_grill=false`, stable kebab id.
- routes: `POST /onboarding/grill` (detect + phrase; empty when no gaps), `POST /onboarding/grill/answer`
  (re-detect → `claims.add`; unknown gap = 404). Skipping = not answering; never blocks.
- sessions: `OnboardingStage` gains `grill` (deck → grill → ready|loopback).
- web: deck page gains a grill phase — "Continue" commits the batch, opens the grill, shows questions
  or (no gaps) builds straight through.

Verified: api 114 pass incl. 12 grill tests; all 4 e2e green in a real browser against the live model —
the happy path answered an LLM-phrased question and traced it into the final CV (logs: 2×/grill,
1×/grill/answer). typecheck 7/7, build clean.

Also added a **CLAUDE.md session-hygiene convention** this session: keep roadmap/session-log/lessons
current as work lands, not only at session end (this entry is that rule in action).

**Next:** JC-55 Path B stub (a "coming soon" door) closes E3, then E2 auth (JC-18/19/20 — the signup
wall). The grill's "too thin" trigger (promote v2 gap types) wants two counters in the guestbook first.

## 2026-07-18 (session 3) — E3 deck UI + tiering, browser e2e, two latent bugs fixed

Continued E3 on the slice-A loop, then made the whole onboarding flow self-verifiable in a real browser.

**JC-22 deck tiering** (`3681824`): the deck response stamps each claim with a `tier` — verbatim →
batch, machine-touched → individual. Policy lives in the deck route (`claimTier`), not the store.
Deliberately the simple `machine_touch` split, not stakes-weighted ranking — the miner eval already
keeps the touched count under ~15, so there is nothing to rank yet (ponytail note left for the upgrade).

**JC-23 browser deck UI** (`c9efe8d`): `/deck/[jobId]` — individual yes/edit/remove cards (saved on the
spot; edit → user-authored auto-confirmed), batch-by-section tap-to-remove chips (committed at build),
then build → the verified root CV or a loop-back. The preview page's placeholder "Notify me" dead-end
now links into the deck. Typed deck helpers in `lib/api.ts`.

**Self-verification via Playwright** (`2c4f93d`), after the user asked why I don't test it myself: a
real-browser onboarding smoke over the true pipeline. This environment runs it end to end (headless
Chromium + outbound net + `ANTHROPIC_API_KEY`), against local servers or staging.

**Two latent bugs the e2e caught that typecheck + build never would:**
1. `jfetch` set `content-type: application/json` on every request; Fastify rejects an empty body with
   that header (`FST_ERR_CTP_EMPTY_JSON_BODY`), so every no-body POST 400'd — broke staging upload
   (`/complete`), would have broken deck confirm/build. One guard in the shared helper (`8680fea`).
2. `/import` uploaded without `ensureSession()`, so a direct visit / refresh 401'd on `POST /uploads`
   (it only worked when reached via the landing page). Self-ensures now, matching `/paste` (`10991aa`).

**Loop-back made reachable + guarded** (`3e65843`): `ClaimGraph.nodes` has no min-1, so "reject
everything" built a valid empty graph the gate passed as `ready`. The build route now loops back on an
empty confirmed set ("keep at least one fact") instead of certifying an empty CV.

**E2E suite now (all browser-verified):** happy path, loop-back, paste-too-short, unparseable upload.
`lessons.md` updated (self-verify UI; pages self-ensure session).

Gate at each push: `pnpm test` 102 pass / 5 skipped, `pnpm typecheck` 7/7, web build clean, 4/4 e2e green.

**Next:** the grill (JC-24 gap detection + LLM phrasing, JC-26 persistence via `claims.add`) — the last
feature in E3 — then JC-55 Path B stub, then E2 auth (JC-18/19/20). Looming infra: everything is still
in-memory; the S2 "graph v1 in Postgres" goal needs the JC-6 Postgres drivers.

## 2026-07-18 (session 2) — E4 spine finished + E3 deck/build loop closed

**E4 spine completed** (commit `8cd246a`): the three items the previous session queued all shipped —
claims store (JC-21), gate (JC-31), root-CV renderer (JC-27). Per-session confirmed-claims store (same
record + async-interface + `InMemory*` pattern as `sessions.ts`); `runGate` = the `ClaimGraph` zod port
(≡ `validate_graph.mjs`) + trace-to-confirmed (every rendered bullet → a renderable, user-confirmed
node; errors name the node for precise loop-backs); `renderRootCv` renders only over
`nodes.filter(renderable)`, bucketed by the kind tag. 11 tests. Not yet wired to routes.

**E3 slice A — the onboarding loop now closes end to end** (commit `7994b29`). Grilled the plan first,
then built a deliberately thin vertical slice to exercise the 405 lines of untouched spine through a
real HTTP request before building the deck's intelligence:

- `routes/onboarding.ts`: `POST /onboarding/deck` seeds the per-session claim store from the job's
  mined claims (idempotent, session-scoped like `/previews/:jobId`); confirm/reject/edit are plain
  synchronous store writes; `POST /onboarding/build` runs `buildClaimGraph → renderRootCv → runGate`
  inline and returns the root CV + gate result. **No job/SSE — the spine is pure arithmetic** (verified).
- `sessions.ts`: one `stage` field (`deck | ready | loopback`) + `setStage` — the entire "state machine"
  for this slice; the client reads it on load.
- `server.ts`: wires an `InMemoryClaimStore`, registers the routes.
- `onboarding.test.ts`: walks paste → mine → deck → confirm/edit/reject → build → `ready` over
  `app.inject`, asserting the root CV traces clean through the gate + a session-scoping 404.

Four grill decisions: (a) vertical slice over a fully-featured deck; (b) synchronous saves + a `stage`
field over a background job; (c) ride the anonymous session, defer **all** auth to E2; (d) prove with
the API + one integration test, browser UI as the next slice. Risk flagged in the grill — graph node
IDs vs claim IDs — turned out moot: `graph.ts` reuses claim IDs 1:1, so the gate reads confirmed claim
IDs directly.

Gate green before ship: `pnpm test` = 100 pass / 5 skipped, `pnpm typecheck` = 7/7. Pushed to `main`.

**Next:** E3 continues — deck tiering (JC-22/23), then the grill (JC-24/26), then the browser deck UI
on this API; then E2 auth (JC-18/19/20) drops the signup wall in front of the deck.

## 2026-07-18 — S2 kickoff + E4 keystone shipped

**S2 design locked (grill session).** Eight product decisions fixed before writing code, recorded in
[`docs/s2-kickoff.md`](docs/s2-kickoff.md) (commit `6aef176`):

1. S2's user-facing reward is the **downloadable root CV** → the renderer must be polished.
2. Signup wall sits **immediately after the preview**; the only anonymous assets are the upload +
   preview job, so anon→account merge is one ownership update and purge is one rule.
3. Deck tiering = **stakes × uncertainty**; top ≤15 get individual yes/edit/reject cards, rest batch
   by section; an edit becomes a user-authored, auto-confirmed claim.
4. **Grill = gap-filling only**, hard-capped ~5–8 Qs; gaps detected mechanically, LLM only phrases;
   answers are confirmed facts immediately.
5. The **gate judges our pipeline, never the user's career**; thin-but-honest profiles pass; failures
   are auto-retries or precise loop-backs, never dead ends.
6. **Audit polishes / gate certifies** (audit = LLM against the cv-brain rules; gate = mechanical).
7. Root-CV review is **read-only + "fix this" loop-backs**, never a freeform editor.
8. **Path B ("no CV") is a stub in S2**; the real guided interview moved to S4 (roadmap updated).

Also added an unscheduled roadmap item: the advisory **"improve your profile"** feature (never blocks
applying) — the home for profile-strength feedback the gate deliberately withholds.

**E4 spine started — JC-32 shipped** (commit `a77f974`):

- Ran the two pre-build checks and both came back favorable: the claim miner already emits everything
  deck tiering needs (`source_quote`, `machine_touch`, `classification`, `needs_grill`/`grill_hint`,
  `role`/id-prefixes); `validate_graph.mjs` checks **structure only, no richness gate** — so a sparse
  but well-formed graph passes, exactly as decision #5 needs.
- Discovered the E4 **contract layer already existed** (oracle, `ClaimGraph` zod port, schema JSON,
  goldens — all passing). So JC-32's real gap was the **server-side builder**, not the validator port.
- Wrote `apps/api/src/graph.ts` — `buildClaimGraph(confirmedClaims, opts)` maps the deck's confirmed
  claims 1:1 into a Contract-1 `ClaimGraph` the frozen oracle accepts. Conservative by construction
  (every confirmed claim → one renderable source node, nothing dropped/invented); fills the graph-only
  fields the deck doesn't carry (provenance label, per-class risk floor so Partially-Supported keeps
  invariant 8, `confirmed_date`, one kind tag). 4 tests via the zod port (goldens prove zod ≡ oracle).
- Gate green before ship: `pnpm test` = 91 pass / 5 skipped, `pnpm typecheck` = 7/7. Pushed to `main`.

**Next:** E4 continues — claims store (JC-21, same interface + `InMemory*` pattern as `SessionStore`),
then the gate (JC-31 = `validateGraph` + trace-to-confirmed), then the root-CV renderer (JC-27).
