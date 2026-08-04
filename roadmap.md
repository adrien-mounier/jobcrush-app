# Roadmap — jobcrush-app

_Last updated: 2026-08-04_

> Forward-looking product roadmap. S0 + S1 are done; this plan carries S2 → S4. The **detailed
> original spec, per-ticket ACs, and per-slice kickoffs are archived in the JobCrush repo**
> (`docs/dev-plan-v01-hosted.md`, `docs/onboarding-init-design.md` §8 authoritative,
> `docs/s0..s4-kickoff.md`) — that history stays there; this repo owns the plan from here on.

## Goal

A hosted product that turns anyone's CV into a **grounded, verified profile** and delivers
**tailored, ready-to-submit** job applications — the productized version of the personal JobCrush
pipeline, for many users, on web and mobile. v0.1 scope is **prepared-apply** (the user submits;
no autonomous submit, no LinkedIn credentials, ever).

## Current design frontier

**2026-08-04 (session 73) `/orchestrate-team #100` — the product can fetch real job adverts, and the guard against a false "no jobs" took three rounds to get right.** [#100](https://github.com/adrien-mounier/jobcrush-app/issues/100) closed (`9585308`). The Techmap client + posting store: fetch → normalise → persist → price → language-tag, for HK/SG/VN/AU. The advert body comes from **`jsonLD.description`** — a scan of top-level strings concludes, wrongly, that this provider returns no description at all — and `validThrough` / `applicantLocationRequirements` / `skills` are carried **structured**, not re-derived by a paid model call. The #101 boundary held: nothing here reaches a route, and no search-area routing or provider fan-out was built. 🔑 **The defect that matters, and neither review axis caught it — QA did.** A 200 whose items *all* fail to normalise is a vendor shape drift, not an empty result; conflating them tells a user with real matches that there are none, the worst outcome this product has. The first fix gated that on the envelope's `totalCount` and was **wrong in both directions**: `totalCount` is the *whole query's* total, not the page's, so it false-failed a genuinely empty **page** of a non-empty query (would have fired the first time #101 paginated) while leaving the real hole open whenever `totalCount` was absent, `0`, or a non-numeric string. Now page-local — `items.length > 0 && records.length === 0` → `provider_unavailable`, never `empty_pool`; generalised in `lessons.md` as *the denominator must be what you received, not a number the other side told you about*. **Eleven defects across two review axes plus QA**, all fixed and regression-tested: unenforced rate limits on a paid service, per-instance pacing a second caller would defeat, a provider factory accepting any registry row, ingest counters inflating per fetch instead of per posting, a store whose table was never created outside tests, and a fixture provider with no structural guard. **Contracts versioned in oracle + zod port + fixtures together:** `PostingProviderPolicyV1` 1→2 (`retry`, `timeoutMs`, `rateLimit.perSecond` — the BASIC plan limits per **second**, which the old shape could not express); `ProviderPostingRecordV1` 1→2 and `PostingV1` 2→3 (`language`, derived at ingest and never taken from the provider, resolved by the authority-rank winner rule rather than a union because it **gates visibility** — this is where [#95](https://github.com/adrien-mounier/jobcrush-app/issues/95)'s retained-but-unread hook lands); `PostingRetrievalResultV1` 2→3. ⚠️ **`rateLimit.perMonth` is deliberately NOT enforced** — filed as [#132](https://github.com/adrien-mounier/jobcrush-app/issues/132). perSecond/perMinute/perDay are, and fail closed (QA verified: `perMinute=3` over 6 fetches → exactly 3 HTTP calls). A month-long counter in process memory resets on every deploy — this repo redeploys on every green push — which is false confidence, not protection; the honest absence was chosen over a counter that looks like a cap. At the enforced pace a refresh loop burns the 1000/month quota in **~42 minutes**, then bills pay-as-you-go on the card shared with `vitacairn`. **Nothing loops today; #101 is what makes it reachable**, so #132 should land with or before it. ⚠️ **The AC "one real staging smoke against Techmap" is UNTESTED, not passed** — `TECHMAP_RAPIDAPI_KEY` is not on staging (owner action: `fly secrets set TECHMAP_RAPIDAPI_KEY=<key> -a jobcrush-api-staging`). Every field **path** except `jsonLD.description` therefore remains an assumption: faithful to the 2026-08-02 measured probe, never confirmed against a live response. The smoke now drives the real client end-to-end (the lowercase-path landmine is only catchable that way) **and** re-derives the fallback-prone fields from raw `jsonLD` so a silently-fired fallback fails loudly — an earlier draft asserted only non-emptiness and would have passed while reading every value from the fallback. **First paid third-party dependency in this product**, now in `docs/deploy.md`'s secret list and `SHARED_INFRA.md`'s inventory; neither mentioned a posting provider before. Gate 913 api + 39 contract tests green uncached, no live network in CI, QA **GO**. Frontier for build work is **[#101](https://github.com/adrien-mounier/jobcrush-app/issues/101)** (the retrieval boundary #63 calls) with **#132** alongside it, then **#108**. Also unblocked: **[#113](https://github.com/adrien-mounier/jobcrush-app/issues/113)**, which needed real provider text to tune language detection against and must not be tuned against the fixtures a second time.

**2026-08-04 (session 72) `/wayfinder` — the CV data-model effort has a map, and the ticket that was waiting on it is settled.** [#127](https://github.com/adrien-mounier/jobcrush-app/issues/127) **is now the map**, not a ticket; it was an orphan with no parent, no children and no dependencies (as were #126, #125, #124), so there was nothing to work through. Its original problem statement is preserved verbatim as the first comment, so every existing cross-reference to #127 still lands somewhere valid. **Destination: the model and its growth rule decided, stress-tested on paper against a second element, ending with build tickets** — the map hands off to `/to-tickets`, it does not build. **Four owner decisions taken while charting:** (1) the growth rule is not trusted until a deliberately different second element has been walked through it — deciding on paper alone leaves the rule an untested claim, which is the exact failure the effort exists to prevent; (2) **the map fixes three promises, not the screen** — every structured fact must be **listable**, **traceable back to the visitor's own words**, and **correctable in a way that survives recalculation** (a fix lands on the fact, never on something derived from it), while the correction interface is explicitly out of scope and remains a separate design pass #120 needs *after* this map; (3) **no cost ceiling — accuracy wins**, ⚠️ recorded in the map as a **real cash risk, not a settled matter**: structuring costs more per upload, there is no pilot revenue, and **nobody has measured the actual per-CV figure** (it sits in the map's fog as a number to produce before the first build ticket ships, not as a gate); (4) already-stored CVs are out of scope, staging data disposable. **Route:** [Who says so? (#128)](https://github.com/adrien-mounier/jobcrush-app/issues/128) — where a structured fact comes from, the root fork both provenance and correction hang off — → [#126](https://github.com/adrien-mounier/jobcrush-app/issues/126) the worked example → [the growth rule (#129)](https://github.com/adrien-mounier/jobcrush-app/issues/129) → {[#125](https://github.com/adrien-mounier/jobcrush-app/issues/125) re-scoped from `wayfinder:task` into **the stress test**, [which elements are in v1 (#130)](https://github.com/adrien-mounier/jobcrush-app/issues/130)}. If #125 turns into an argument rather than a mechanical application of the rule, **#129 reopens — and that is the map working, not failing.** 🔑 **An impact-sweep rule is written into the map at the owner's request**, because wayfinder only updates tickets *inside* a map and the exposed ones are mostly outside it: no ticket resolves until its decision has been reflected onto #120, #124, #122, #86 + E5 slices #108–#111, #54 and #66. **[#120](https://github.com/adrien-mounier/jobcrush-app/issues/120) is now formally settled on the ticket** — owner chose to **wait for #127 entirely**; the body no longer reads "awaiting owner confirmation" and the hard block is recorded, matching what decisions 3–4 below already said. ⚠️ **The live harm is carried knowingly and is unchanged:** since #123 (`ddc40ae`) a language mistap removes postings with no undo, permanently for that session, until this map resolves and #120 is built — which is why **#68 remains a precondition of any pilot** (see the risk note below). **Blocking is wired as native GitHub dependency edges** (and sub-issue links), so the frontier is exact and visible in GitHub's own UI: `issue_dependencies_summary.blocked_by == 0` leaves **#128 as the only takeable ticket** on this map. 🚨 **A false alarm was raised and corrected inside the session, and the correction is the more useful finding.** This entry first asserted the dependency API was *broken on this repo*, and four documents plus four ticket bodies were written around a text-only fallback. Both halves were wrong: `422 "Target issue has already been taken"` means the edge **already exists** (the first attempt duplicated one an earlier session had wired), and the read-back used to "confirm" otherwise was itself faulty — `gh api | ConvertFrom-Json | Select-Object` renders a **blank row** in this shell where `--jq` returns the record. **A read that fabricates a confident "nothing is there" is how a working feature gets declared dead**; the standing rule is now to use `--jq` for any `gh api` read whose emptiness will be acted on. It surfaced only because the owner challenged the claim — and because this very file already recorded #102–#111 wired *"as GitHub native dependencies, not prose"*, contradicting evidence that was sitting in the repo unchecked. Both generalised in `lessons.md`. Frontier for *build* work is unchanged by this planning session: **#100/#101**, then **#108**.

**2026-08-04 (session 71) `/orchestrate-team #114` — the read path stops paying twice, and a safety net named in the ticket turned out to be inert.** [#114](https://github.com/adrien-mounier/jobcrush-app/issues/114) closed (`6c0a515`; ran concurrently with sessions 69/70 below and landed first of the three, which is why both reference it landing mid-gate — logged last, hence the higher number). Both defects #104's QA pass filed, neither ever wrong on screen: they were wrong on the bill, and both stop being free the moment #99–#101 puts a real feed behind them. **A corrupt curated fixture no longer buys a paid re-read** — `resolveAdRequirements` caught "malformed" and "missing" from one `try`/`catch` and went to the model for both, paying to re-derive what a human had already written. The fixture set now parses **once** into a shared index answering found/missing/invalid; invalid counts, logs its adId and reason (bounded per #115 finding 3), drops that one card, and makes **no model call**, while missing falls through to the reader unchanged. `postings.fixture_invalid` has a **production caller again** — it had none, so the counter #104 added for exactly this hazard could never move. **A permanently-unreadable advert no longer re-pays every request**: a bounded negative cache with escalating backoff (2 min doubling, capped 60 min) covers **only** the `readAdvert` throw path, with store outages, post-read `store.put` failures and the free language-skip null each excluded on their own recorded terms; suppression never re-counts `postings.read_failed`, so the failure alarm can't be pinned by events that cost nothing. Measured: a permanently broken advert polled every 30s for a day costs **56 model calls instead of 5,762**. 🔑 **The ticket's own safety AC named a mechanism that does not exist.** AC4 asked that a prompt/contract version bump retry a previously-failing advert; the entry carries that version and the comparison is correct, and it can **never fire** — `adReaderVersion()` cannot change inside a running process, and the redeploy that changes it empties this in-memory cache anyway. It was reported "met at the unit level", and the unit test passes against a branch production cannot reach. **The operative guarantee is the 60-minute cap**, which QA verified independently rather than accepting: real `makeAdReader` over a 30-day simulated clock, backoff recomputed for n=1..2000, **worst invisibility-after-fix 15 minutes even after a 20-day continuous outage**, no path over the hour. Kept as defense-in-depth, documented unreachable; generalised in `lessons.md` as *a cache invalidated by a build-time version is guarded by nothing*. 🚨 **The index rewrite introduced a silent regression caught before it shipped** — replacing a `find()` with a `Map` flipped duplicate-adId precedence from first-wins to **last-wins**, so a copy-pasted *broken* duplicate would have shadowed a good entry and deleted a resolvable card (#86's named worst failure), latent only because the file holds ten unique ids. Precedence is now explicit. `parseAdRequirementsList` was **deleted**, not left test-only — both review axes independently flagged it as a second, production-dead incrementer of the same counter, the very hazard this ticket names. Proven at #86's pinned API boundary (no new seam) **and live on port 3114**: a corrupted fixture gave HTTP 200 with **14 cards not 15** and zero calls for that advert; with a bad model key, request 1 spent 968ms on 7 real failures and request 2 took **2.8ms** with `read_suppressed` = 7. Gate 808 api green uncached, QA **GO**. ⚠️ **Known limits recorded:** an invalid fixture is never retried within a process's life (correct for repo-baked data, revisit at #99–#101), and a suppressed read counts `postings.read_in_time`, mildly diluting the timeout alarm's denominator. ⚠️ **Also worth an operator's attention, pre-existing:** `/ops/counters` is **ungated** — `OPS_KEY` gates `/ops/read-failures` and `/ops/spend`, not this one, contradicting the assumption in session 63's note below. Frontier unchanged by this slice and as sessions 69/70 leave it: **#100/#101** (live retrieval — the pool this engine is waiting on) and **#120**, then **#108**.

**2026-08-04 (session 70) `/orchestrate-team #123` — withdrawal is armed, fires on a real answer, and now tells the visitor what it cost.** [#123](https://github.com/adrien-mounier/jobcrush-app/issues/123) closed. Discovery asks **once**, as a multi-select, which languages the visitor works in professionally; ticking stores `professional`, **leaving one unticked stores an explicit `none`** — the "no" #107's engine has always required and never had. Every listed language is rewritten on **every** answer (never deltas), which is exactly what makes a correction restore the jobs it removed. The old single-value English question is **superseded and gone**. 🔑 **The corpus could not ground the list.** Re-deriving language demand the way #106 derived dimensions (`docs/research/languages-from-the-corpus.md`): of **17 real adverts, exactly 2 name a language and both name English** — zero name Mandarin, Cantonese or Vietnamese, verified three ways. A strictly-measured list is `{English}`, from which the ticket's own driving scenario **cannot fire**. Owner decision 2026-08-04: **English, Mandarin, Cantonese, Vietnamese**, grounded in the corpus's *measured market mix* (HK 9, AU 4, VN 2, CN 1) rather than advert-stated demand — the doc records that distinction and does not dress the additions up as measured. 🔑 **Owner requirement mid-build — the list must survive new markets**, so it is **market-keyed data** (`apps/api/data/languages-by-market.json`), asked as the deduped union, zod-validated at load. Opening Laos is one JSON entry: no code, no schema, no migration. **Growing the list is safe for anyone who already answered** — no fact for the new language, which reads unknown, and unknown never withdraws. Shaped market-first so **[#124](https://github.com/adrien-mounier/jobcrush-app/issues/124)** narrows the question to a visitor's own markets as a *lookup*, not a redesign. 🚨 **QA NO-GO, then fixed: the engine was right and the visitor was never told.** The languages question is **always the last question**, so confirming it always triggered the deck handoff, which replaces the notice slot holding the designer's lock-in line and undo — both unreachable in **every** run, not just after a reload (#120). Now the cards response reports `withdrawn: { total, byLanguage }` and the reveal carries one quiet line **below** its CTA: *"4 more needed Mandarin and Cantonese — I left them out."* Verified against reality, not itself: 15 → 11 on screen, server said 4, split 3/1; a posting excluded for any other reason is provably never counted. ⚠️ **The undo did NOT ship.** "Fix my languages" needs the app to reopen an answered question with its prior ticks — capability that does not exist and is the substance of **[#120](https://github.com/adrien-mounier/jobcrush-app/issues/120)**; a dead link was deliberately not wired. QA ruled GO anyway (silence was #86's named failure and silence is gone; this is a *recovery* gap, not a *deception* gap) — but **a mis-tick is still permanent for the session, so #120 is the recommended next move.** ⚠️ **The `conversational` tier is retired** — a binary tick-list cannot express "some, but not for work", so an honest conversational speaker who doesn't tick loses those jobs; recorded as an accepted trade, mitigated by *"Not sure? Tick it."*, and `withdrawal.ts` still honours stored pre-#123 values. Follow-up **[#125](https://github.com/adrien-mounier/jobcrush-app/issues/125)** (owner decision): a language a visitor *volunteers* — French, for the French companies across APAC — must reach their **CV**, which needs a deliberate door shaped in the #106 eligibility/claims wall. Frontier, reconciled with session 69's concurrent #99 below: **[#100](https://github.com/adrien-mounier/jobcrush-app/issues/100)/[#101](https://github.com/adrien-mounier/jobcrush-app/issues/101)** (live retrieval — the pool this whole engine is waiting on), then **#108**.

🚧 **Four owner decisions taken after #123 shipped, which reshaped the plan more than the ticket did:**

1. **Years of experience should be computed, not asked** — [#126](https://github.com/adrien-mounier/jobcrush-app/issues/126). One asked number cannot answer *"8+ years of IT experience including 5+ as a Project Manager"*; a career has several true durations at several scopes. Blocked on the fact that **nothing in this codebase stores a date** — `ClaimRecord` has no start, end, period or employer. **Do not retire the years question before computed years is proven**: with no years fact there is nothing to attenuate by, so removing it early makes scores *more* flattering, the direction #86 forbids.
2. **Model the CV as structured, measurable data** — [#127](https://github.com/adrien-mounier/jobcrush-app/issues/127), **now the wayfinder map** for the effort (charted session 72, below). #126 is reparented as its **first slice** and must set the pattern rather than bolt on date columns. The danger that makes it delicate: *structuring is interpreting*, and interpretation is where this product can start asserting facts the visitor never gave — so the working assumption is **structure alongside the text with provenance back to the source span**, never instead of it.
3. **No per-case correction UIs** — the owner rejected "which of the three eligibility answers gets a fix screen" as the wrong question (it is #127's own failure mode moved up to the UI layer). [#120](https://github.com/adrien-mounier/jobcrush-app/issues/120) is rewritten, **blocked by #127**, and its in-the-moment undo is struck.
4. **Wait rather than patch** — no pilot is planned soon, so correction waits for #127's general mechanism.

⚠️ **The risk decision 4 knowingly accepts, and the gate it creates.** **There is no recovery from a discovery mistake today — none.** #106's affordance reaches one answer back and never renders for the *last* question; #120 is deferred; and **explicit restart is unbuilt ([#68](https://github.com/adrien-mounier/jobcrush-app/issues/68))**. Since #123, a mistapped language removes jobs for the life of that session and the visitor can do nothing about it. Acceptable **only** because staging is not a pilot. **Before the first real user is let in, some recovery path must exist — #68 is the cheapest and is general (it recovers any mistake, not just a language), and #127 cannot obsolete it.** Treat #68 as a precondition of a pilot, not as retention polish.
**2026-08-04 (session 69) `/orchestrate-team #99` — the posting-retrieval contract exists in code, and the oracle caught the port lying.** [#99](https://github.com/adrien-mounier/jobcrush-app/issues/99) closed (`7086ec5`). The first of three slices closing the gap #85 left (contract decided, implementation never filed): four shapes in **both** the `.mjs` oracle and the zod port, a provider registry as **data**, and the pure `dedupePostings`. No routes, no network, no store — that is #100/#101. A posting's identity is now content-derived and *checked*: `PostingV1.id` is `posting:<canonicalKey>` and both validators verify `canonicalKey` genuinely is the sha256 of the normalized `company|location|title`, so identity survives a provider dropping out or a second provider picking the same job up. 🚨 **The port and the oracle had already drifted, and the golden tests were not looking** — only the result union was compared, so `ProviderPostingRecordV1` and `PostingProviderPolicyV1` were exported and never run against their ports, and `authorityRank: Infinity` was accepted by zod while the oracle rejected it. Per the repo rule the port was wrong; **the lesson is the coverage gap, not the missing `.finite()`** — a shape that is ported but not golden-tested is not actually governed by the oracle. 🐛 **QA's dedup attack found two genuinely different jobs merging** through an unescaped `|`, the very character joining the three key fields, so `{company:"HSBC|Hong Kong", location:"Singapore"}` collided with `{company:"HSBC", location:"Hong Kong|Singapore"}`; `|` is now stripped in both implementations. A second bug: the "deterministic" tie-break never ran, because unregistered providers rank `+Infinity` and `Infinity - Infinity` is `NaN`, so the comparator bailed before the providerId tie-break while a comment asserted determinism. ⚠️ **Accepted and pinned by test: two different jobs sharing an identical company + location + title still merge** — inherent to a content-derived key, since adding `sourceUrl` or a provider discriminator would stop cross-provider dedup working at all; the contract doc's claim that the rule "never silently drops a distinct one" was overstated and is now qualified, with [#92](https://github.com/adrien-mounier/jobcrush-app/issues/92) there to measure it. The registry is fail-closed: `permitsStorage`/`permitsMatching` default false, `theirstack` ships as a documented candidate row that structurally cannot activate, and **#99's "known gap" is resolved by recording rather than building** — activation also requires `!attributionRequired`, because `JobCardV1` has no attribution field, so a provider whose attribution we cannot render must not go live (flipping a live provider's flag removes it from the active registry immediately, stated in §2.2). QA **GO** on a 43,510-input differential fuzz finding no oracle/port disagreement. **Carried to #100/#101:** fail-closed lives in the loader, so the boundary must not bypass `loadActivePostingProviders()`; `Coverage` truthfulness is unverifiable from the schema; `packages/contracts` is no longer isomorphic (computes sha256 via `node:crypto`), harmless only while nothing bundles it for the browser. Frontier is **[#100](https://github.com/adrien-mounier/jobcrush-app/issues/100)** (the Techmap client + posting store), then **[#101](https://github.com/adrien-mounier/jobcrush-app/issues/101)**, and through them [#63](https://github.com/adrien-mounier/jobcrush-app/issues/63).

**2026-08-03 (session 68) `/orchestrate-team #107` — a job you genuinely cannot take now leaves your deck, and the feature is correct and dormant.** [#107](https://github.com/adrien-mounier/jobcrush-app/issues/107) closed (`e62a455`). An explicitly-**blocking** language requirement withdraws a posting from that visitor's deck entirely — silently, on every surface that renders an advert (deck, `/want`, tailor target), and **before the paid judging set is ranked**, so a withdrawn card never costs a model call. Both safety rules hold and are pinned at the API boundary: only an explicit advert ("Mandarin an advantage" withdraws nothing) and only an explicit user "no" (an unknown **always** keeps the card, on every dimension). Making that real needed a **subject on both sides** — `AdRequirementV1` gains an additive `eligibilitySubject` (deliberately additive, not a v2: every stored v1 payload still validates and no existing field changes meaning; oracle updated in lockstep, `PROMPT_CONTRACT_VERSION` bumped to force the subjects into stored reads), the reader's clamp down-classifies any subject-less blocking language/certification requirement, and **language facts are now scoped by the language** rather than stored globally. No subject on either side reads as unknown and never withdraws. A **years shortfall** now counts proportionately: the judged fit is attenuated by `min(1, years/bar)`, so 5 years against "8+" scores below 9 years and neither scores zero. Withdrawals are counted (`deck.cards_withdrawn`) alongside slice 3's blocking rate. 🚨 **The review round caught the failure this whole slice exists to prevent.** The first build also withdrew on **work-rights**, and the posting pool spans Australia, Hong Kong, Vietnam and China: an Australian job-hunting in Hong Kong who answers "I'd need sponsorship" would have had every right-to-work-demanding **Australian** posting silently deleted — a job they can absolutely take. **work-rights now never withdraws**, by the same reasoning #106's must-fix-7 already reached from the other direction (a city-scoped answer and a country-level demand do not resolve without a visitor-location fact this codebase does not collect); it becomes resolvable the day that fact exists. The years rule also **replaced** the judged fit rather than attenuating it, inflating an honest 0.2 to 1.0 for anyone over the bar, and could divide by a zero or negative bar into a `NaN`/negative percentage. ⚠️ **Known and load-bearing: discovery asks about English only, so in production this fires on nothing.** The engine tells Mandarin-required from Mandarin-preferred and knows which language is meant; nobody has ever been asked about Mandarin, so it reads unknown and the card stays. **Asking which languages a visitor works in is what turns this feature on** and is the recommended next move. Follow-up [#122](https://github.com/adrien-mounier/jobcrush-app/issues/122): an unasked eligibility requirement still renders like a gap you failed rather than a question you haven't answered — the ticket's own UX intent, needing a surface this slice doesn't have. QA GO: whole-tree gates green, all six ACs proven through `GET /onboarding/cards`, **32 adversarial probes found no way to make a card wrongly vanish**, full journey drove clean in a browser. **Not demonstrable live:** `sample-ad-requirements.json` carries **zero** blocking requirements, so a withdrawal has never been seen in a browser — proven only at the API seam. Frontier is **#108** (the card's credibility sentence), with **#109/#110** behind it.

**2026-08-02 (session 63) `/orchestrate-team #115` — the 43% wasn't a reading problem, it was a deadline.** [#115](https://github.com/adrien-mounier/jobcrush-app/issues/115) closed (`3b83de0`). Driving all 7 uncurated adverts through the real read path produced **10 completed reads, 10 successes, 0 validation retries** — disconfirming all four causes the ticket suspected. The deck allows each uncached read **15s**; a real read takes ~15–27s, so roughly three in seven lose that race every request. **Severity was also overstated and corrected on the ticket:** nothing cancels an abandoned read, so it finishes and persists itself and the next request serves it from cache — the real cost is that *the first viewer of any never-before-read advert loses it*, harmless at 17 fixed postings and a permanent tax on the newest jobs once #99–#101 lands. **Owner kept the deadline** (deck speed unchanged); returning the deck immediately and filling in as reads land is filed as [#116](https://github.com/adrien-mounier/jobcrush-app/issues/116) with both rejected alternatives recorded. A timeout is no longer counted as a read failure — the same trap #103 drew a line against for language skips — and ⚠️ **that split removed alarm coverage, whose replacement was broken twice before shipping, both caught pre-commit**: the new timeout alarm first rated itself against `adReader.read_succeeded`, which an overrunning read *increments itself* when it self-heals, capping a sustained 100%-timeout incident at a 50% reported rate under a 50% threshold — structurally unable to fire in the scenario it existed for, reproduced live by QA at exactly `500‰`. Fixed by correcting the **denominator, not the threshold** (`postings.read_in_time`, counted at the deadline site). **The reason a read didn't land is finally retrievable** — five failure classes, a bounded ring buffer, a log line, and `/ops/read-failures` behind `OPS_KEY`, fail-closed after review caught raw pg/driver text on an open route. 🔑 **`OPS_KEY` must be set on staging or AC2 is unmet in production.** QA proved the load-bearing claim over real HTTP: request 1 back in 15,013ms without the slow adverts, all 7 persisted by t+22s, request 2 serving 15 cards in 4ms with no new model calls. **Two gaps carried:** no real model call in any test (no local key), so "reads take 15–27s" rests on one CLI-driver measurement; and nothing measured on staging yet — AC3's literal wording closes only after deploy. **Known limits recorded:** the timeout alarm dilutes as the pool warms (a cache hit counts as in-time — revisit at #99–#101), concurrent requests double-count one slow read, a restart mid-overrun drops the attempt from both counters. Frontier is **#105** (the card's number is still the knowingly-broken token-overlap score), with **#114** the natural neighbour on the same read path.

**2026-08-02 (session 62) `/orchestrate-team #104` — the tracer bullet landed: an advert nobody curated becomes a card.** [#104](https://github.com/adrien-mounier/jobcrush-app/issues/104) closed (`fb68dcd`). One model call per advert produces its requirement list **and** its posting-family verdict in the same pass, zod-parsed, then persisted keyed by `adId` alone and shared by every session that sees that job — nobody pays twice. Deck **8 → 15**, not the ticket's 16: the 16th is an English advert carrying a hand-authored *Chinese* requirement set (#103's dual-gate fixture), and reading it anyway would have regressed a shipped safety rule to make a demo figure match. **The blocking definition is now contract in three places** — pinned in the prompt, pinned by a test against that file, and enforced in code (a `blocking` requirement without a hard-gate eligibility dimension is clamped to ordinary and counted) — after review caught that the clamp and the prompt contradicted each other and would have made blocking **unreachable**, leaving the operator's blocking-rate counter at 0 forever and reading as healthy. Unreadable adverts produce no card and no fabricated number; failures are counted and alarmed (threshold + minimum sample, logged once on transition), language skips counted separately so they cannot drown the rate, and per-advert token cost stored and aggregated. `AD_READER_VERSION`'s prompt half is a **hash of the prompt text actually sent**, so a forgotten bump can't serve the pool from a stale cache. Also fixes #102's carry-forward (one unparseable advert 500ing the whole deck). **Carried forward as [#114](https://github.com/adrien-mounier/jobcrush-app/issues/114):** a *malformed* curated fixture is indistinguishable from a missing one and silently triggers a paid re-read, and failures aren't cached so every deck request re-attempts every failing advert at 2 calls each — free at 17 fixture postings, expensive behind a real feed. 🚨 **Verified live on staging immediately after deploy, and the first real traffic found a defect: 3 of 7 uncurated adverts failed to read — 42.9%, alarm firing.** Filed as [#115](https://github.com/adrien-mounier/jobcrush-app/issues/115); cause unknown, because the counter records that a read failed and not why. The safety behaviour was right (no cards, no fabricated numbers, rest of deck intact) and **the observability this slice was funded for is what surfaced it within minutes rather than as jobs quietly missing from decks.** Same run gave the **first real unit economics, replacing the spec's estimates: ~2,200 input / ~1,350 output tokens per advert, ≈2–3 US cents each**, and **38 requirements produced with 0 blocking and 0 clamped** — the first evidence the pinned prompt holds on real advert text without the code-level clamp having to correct it. Frontier is **#115 then #105**: a better number on a card matters less than half the pool producing no card at all. These 15 cards carry the knowingly-broken token-overlap score until #105 lands.

**2026-08-03 `/orchestrate-team #106` — [#106](https://github.com/adrien-mounier/jobcrush-app/issues/106) shipped (`56110d1`, committed; push blocked, see below).** Discovery asks **three** eligibility questions once — years in the pinned family, work rights, English — reused on every advert, never per job. The distinction the rest of E5 rests on is now real in the data: an explicit **"no" is a stored value**, a **decline stores nothing and reads back unknown**, and retracting to a decline **erases** the prior value. Years is family-scoped and says so in the question ("years in IT project delivery"), bands storing their lower bound so the value stays comparable. Set derived from the 17-advert corpus, recorded in `docs/research/eligibility-dimensions-from-the-corpus.md`; certification + degree excluded (the family floor already asks them). **The ticket's own cited demand figure was wrong** — "2 work authorisation" is **0/17**, a keyword false positive on *sponsor* in its project-sponsor sense; asking `work-rights` anyway is an explicit, owner-approved deviation (2026-08-03) because #86 story 7 promises it and #107 depends on it. **AC5 (prefer the provider's structured work-eligibility signal) is NOT met and is carried to [#99](https://github.com/adrien-mounier/jobcrush-app/issues/99)** — the seam was deleted in review as unconnectable (a location list vs `eligible`/`needs-sponsorship`, with no visitor-location fact to bridge them). Review + QA caught three things worth naming: affirmative answers were being written into the audited CV graph as **confirmed gaps**; a declined question inflated the fact badge on three surfaces including **every deck card**; and the pre-deck funnel had silently grown from ~3 questions to **11** (now six). Follow-up [#120](https://github.com/adrien-mounier/jobcrush-app/issues/120): eligibility answers are correctable only in the moment, and `/profile` is read-only. **[#107](https://github.com/adrien-mounier/jobcrush-app/issues/107) (slice 6) is unblocked and is the next slice.** ⚠️ **`56110d1` is not pushed:** `main` is red on a pre-existing time-bomb test in `judgementStore.test.ts` that pins a literal `2026-08-02` date against a 24h freshness window and went red as the clock passed midnight — unrelated to this work, fix currently only in a concurrent session's uncommitted #117 changes.

**2026-08-02 (later) `/to-tickets #86` — the nine horizontal children replaced by ten vertical slices, [#102–#111](https://github.com/adrien-mounier/jobcrush-app/issues/102).** The nine below were one layer each and none was demoable alone — the failure the tracer-bullet rule exists to prevent. All nine are **closed as superseded**, each with a comment naming its replacement, and every measured finding was carried forward **inline into the replacing ticket** before closing (the blocking-definition measurement, the provider probe facts, the five vocabulary-coincidence rows, the corrected family-scoped pass bar, the already-built eligibility storage, the ATS-keyword-vs-sentence distinction). The new chain: [#102](https://github.com/adrien-mounier/jobcrush-app/issues/102) contract v1 + [#103](https://github.com/adrien-mounier/jobcrush-app/issues/103) language gate → [#104](https://github.com/adrien-mounier/jobcrush-app/issues/104) **read an uncurated advert into the deck (the tracer bullet — 8 cards become 16)** → [#105](https://github.com/adrien-mounier/jobcrush-app/issues/105) meaning-aware judging → [#106](https://github.com/adrien-mounier/jobcrush-app/issues/106) eligibility asked once → [#107](https://github.com/adrien-mounier/jobcrush-app/issues/107) withdrawal + proportionate years → {[#108](https://github.com/adrien-mounier/jobcrush-app/issues/108) the bubble, [#109](https://github.com/adrien-mounier/jobcrush-app/issues/109) re-score + notify} → [#110](https://github.com/adrien-mounier/jobcrush-app/issues/110) measurement gate → [#111](https://github.com/adrien-mounier/jobcrush-app/issues/111) retire the guards. Blocking is wired as **GitHub native dependencies**, not prose; **[#105](https://github.com/adrien-mounier/jobcrush-app/issues/105) now blocks [#63](https://github.com/adrien-mounier/jobcrush-app/issues/63)** in #89's place. **Three decisions taken during the slicing:** (1) #104 ships cards carrying a knowingly-bad number until #105 lands — accepted deliberately, staging is not a pilot, and named in the ticket so nobody "fixes" it by surprise; (2) **there is no saved-jobs feature and #109 does not build one** — the deck is recomputed over the whole pool on every request, so the re-score set is *the adverts the user already has a stored score for*, **capped at the top N by existing score (start 20)**, because uncapped it means thousands of paid judgements per profile edit once live retrieval lands; (3) **owner decision: unify the three band vocabularies** in #102 rather than record why they differ — the divergence is accidental (the card build already squashes `must` → essential and everything else → desirable), and the hand-written mapping at each boundary is an unverified step whose failure reports a wrong percentage rather than crashing. User-facing card copy is explicitly *not* changed by that rename. Frontier is **#102 + #103**, both unblocked; build them sequentially, not in parallel — they touch adjacent card-build code.

**2026-08-02 the provider integration was never filed — now it is.** [#85](https://github.com/adrien-mounier/jobcrush-app/issues/85) defined the retrieval contract and picked Techmap, then closed; **nobody filed the work to build it**, so #86's engine had nothing to read and [#63](https://github.com/adrien-mounier/jobcrush-app/issues/63) was blocked on a ticket that did not exist. Same failure shape as the E5 gap found the day before: a decision written into a doc and never turned into buildable work. Filed as [#99](https://github.com/adrien-mounier/jobcrush-app/issues/99) contracts + registry + dedup (pure, no I/O) → [#100](https://github.com/adrien-mounier/jobcrush-app/issues/100) Techmap client + posting store → [#101](https://github.com/adrien-mounier/jobcrush-app/issues/101) `retrievePostings`, the server-owned boundary #63 calls. **#101 now blocks #63.**

**2026-08-02 E5 design pass done (`/grill-with-docs`, 13 owner decisions) — [#86](https://github.com/adrien-mounier/jobcrush-app/issues/86) rewritten and re-sliced into nine children.** The engine now also produces a **posting family fit** verdict (the #85 probe found only 3–4 of 10 HK "project manager" ads are IT delivery — acting on a weak verdict stays the feed's call). Requirements split into **blocking** (unmet → the card is withdrawn entirely, only on an explicit ad *and* an explicit user "no") and **ordinary**; **eligibility facts** (work rights, language, years, certification) are asked once at discovery and reused, with the dimension list earned from the corpus rather than guessed. Judging splits by who wrote the words: tapped answers keep the deterministic scorer, free text and job cards go to the model — and in Tailor a tap needs no detection at all, which retires the documented distortion where CV lines are phrased in the ad's vocabulary to trip `matchTick`. The highlight bubble is **written freely** — a deliberate, recorded carve-out from the "must not invent a fact" rule, scoped to that one sentence. Re-scoring notifies ("3 jobs just got better") and persists results so model variance can never surface as a mystery drop; scores fall only on a real change, superseding #19's unconditional monotonic floor. **Model choice is deferred to measurement** against the existing 60-pair grid in `docs/card-quality-taste-test.md` (bar: no rank inversions, no flat scores, no undersell) — that harness also gates removing the curated opener. **English-only now**, architected to open up later (per-posting language tag at ingest, non-English retained-but-unread, user languages as a *list*, requirements never silently translated) — the *decision* to work in-language stays [#93](https://github.com/adrien-mounier/jobcrush-app/issues/93)'s. New children: [#95](https://github.com/adrien-mounier/jobcrush-app/issues/95) language gate, [#96](https://github.com/adrien-mounier/jobcrush-app/issues/96) eligibility facts, [#97](https://github.com/adrien-mounier/jobcrush-app/issues/97) measurement harness, [#98](https://github.com/adrien-mounier/jobcrush-app/issues/98) retire the scorer + curated opener. ✅ **Input assumption verified same day (research doc §6): the provider returns the full advert, not a snippet** — 1,712–2,714 chars of clean plain text, no truncation, section headings intact. It lives in `jsonLD.description`, not in any top-level field. #88 unblocked. Three structured fields come free and were about to be inferred by a model: `applicantLocationRequirements` (work eligibility → decisions 3/4), `validThrough` (expiry → #85 §2.6), and `skills` as a list. The same probe returned a dentistry research assistant, a pharma account manager and a retail banking manager for a Hong Kong "project manager" search — decision 1 re-confirmed by accident.

**2026-08-01 target-market decision (owner):** JobCrush targets **South-East Asia and East Asia first, plus Australia**. EU/UK and US come later. This was already true of the data without being written down — the research corpus behind the published `it-project-delivery` floor (`apps/api/data/sample-postings.json`) is 16 postings from Hong Kong, Vietnam, Sydney and APAC-wide, with zero UK or EU. Consequences: posting-provider selection is judged on **in-region coverage first, price second** (the dominant boards there are regional — SEEK, JobStreet, JobsDB — not LinkedIn/Indeed); ad language and seniority conventions are designed against the APAC corpus; and [#85](https://github.com/adrien-mounier/jobcrush-app/issues/85)'s provider shortlist was re-scoped to this market after two rounds wrongly assumed UK/EU.

**2026-08-01 E5 filed as real tickets:** the per-ad half of the cluster engine — named in this roadmap as JC-33/34/35 since 2026-07-23 and in `CLAUDE.md` as "S3 … E5 cluster engine first" — **had never been filed on the tracker**, so a tracker-only frontier query could not see it and [#63](https://github.com/adrien-mounier/jobcrush-app/issues/63) was sequenced as if it were buildable without it. Now filed as spec [#86](https://github.com/adrien-mounier/jobcrush-app/issues/86) with children [#87](https://github.com/adrien-mounier/jobcrush-app/issues/87) contract → [#88](https://github.com/adrien-mounier/jobcrush-app/issues/88) extraction → [#89](https://github.com/adrien-mounier/jobcrush-app/issues/89) scoring → {[#90](https://github.com/adrien-mounier/jobcrush-app/issues/90) highlight bubble, [#91](https://github.com/adrien-mounier/jobcrush-app/issues/91) re-scoring}. **#89 now blocks #63.** Owner decision 2026-08-01: E5 is a **fresh design for the hosted product, not a port** of the `JobCrush` pipeline. #86 is deliberately **not** `ready-for-agent` — it needs a design pass first. The family-floor half of E5 remains done (#58–#62).

**2026-07-29 production-discovery update:** [#61 Activate production discovery only for validated family versions](https://github.com/adrien-mounier/jobcrush-app/issues/61) is implemented and release-gated. A server-authoritative confirmed placement now pins one exact published production-floor version; discovery asks from that version, counts source-supported or defensibly equivalent evidence and explicit negatives once, excludes unsupported inference, and writes a durable current-coverage checkpoint. Fixture, provisional, missing, clarification, unmapped, malformed, forged, unauthenticated, and stale-completion paths fail closed without side effects. In-memory and PostgreSQL-compatible sessions restore the same pinned version and current coverage. Runtime semantic family classification remains intentionally outside this ticket; absent an authoritative placement provider, production discovery returns the honest unavailable path. Closing #61 unblocks [#63 server-owned credible match reveal](https://github.com/adrien-mounier/jobcrush-app/issues/63), while #63 still depends on its other prerequisites.

**2026-07-29 production-floor update:** [#60 Validate and publish initial production family floors](https://github.com/adrien-mounier/jobcrush-app/issues/60) is implemented and release-gated. The first `it-project-delivery` production floor is backed by four current employer postings, a reproducible grouped/held-out placement dataset covering comparable, ambiguous, and near-OOD roles, deterministic dataset hashing, explicit review/publication, immutable monotonic versions, and fail-closed activation. Fixture floors remain ineligible. Closing #60 removes one blocker from [#61 production discovery activation](https://github.com/adrien-mounier/jobcrush-app/issues/61).

**2026-07-28 family-learning update:** [#62 Unmapped-role family learning and return lifecycle](https://github.com/adrien-mounier/jobcrush-app/issues/62) is implemented and release-gated. Unmapped targets now stop before discovery and persist only privacy-minimized role/search metadata; exact and semantic equivalents join a traceable canonical attempt, covered roles require a grounded immutable family reference, and accepted novel targets can begin reusable research from one credible submission. PostgreSQL deduplication and lifecycle/audit writes are atomic; lifecycle progression is operator-key-only, notifications require a claimed account plus live provider and are idempotent, and no-vacancy/rejected/failed-validation states return honestly. The production known-family catalog remains intentionally unwired because #58 shipped non-production fixtures only. Closing #62 removes one blocker from [#68 retention and consent](https://github.com/adrien-mounier/jobcrush-app/issues/68) and [#69 pilot observability](https://github.com/adrien-mounier/jobcrush-app/issues/69).

**2026-07-28 adaptive-discovery update:** [#59 Fixture-driven adaptive discovery engine](https://github.com/adrien-mounier/jobcrush-app/issues/59) is implemented and release-gated. The fixture-only engine now consumes an immutable confirmed family-floor version, covers imported and defensibly equivalent evidence once, asks every uncovered essential in ranked order with no fixed question cap, preserves explicit negatives without rendering them, and keeps corrections, root-CV feedback, progress, and the next question coherent. PostgreSQL now preserves `semantic_key` across claim seed and correction upserts. The next dependency-chain slice is [#61 Activate production discovery only for validated family versions](https://github.com/adrien-mounier/jobcrush-app/issues/61), after [#60 Validate and publish initial production family floors](https://github.com/adrien-mounier/jobcrush-app/issues/60); [#62 Unmapped-role family learning](https://github.com/adrien-mounier/jobcrush-app/issues/62) remains separately owned.

**2026-07-28 family-contract update:** [#58 Three-way family-floor contracts](https://github.com/adrien-mounier/jobcrush-app/issues/58) is implemented and release-gated. Shared oracle/Zod v1 contracts now distinguish `confirmed`, `needs_clarification`, and `unmapped` without nearest-family fallback; clarification choices are explicit and distinct, confirmed placements reference immutable family versions, and structurally ranked fixture floors are isolated from production reward eligibility. The next dependency-chain slice is [#59 Fixture-driven engine](https://github.com/adrien-mounier/jobcrush-app/issues/59).

**2026-07-28 explicit-intent update:** [#57 Collect explicit target role and search
area](https://github.com/adrien-mounier/jobcrush-app/issues/57) is implemented and
release-gated. The first-run flow now asks for target role and search area in one
free-text checkpoint, requests only the missing field when one explicit value is
already known, persists both values across reloads, and never promotes CV history
or residence into future intent. The next onboarding slice is
[#58 Ask the smallest useful family-backed question set](https://github.com/adrien-mounier/jobcrush-app/issues/58).

**2026-07-28 CV-import update:** [#56 CV import proof with provenance,
corrections, and recovery](https://github.com/adrien-mounier/jobcrush-app/issues/56)
is implemented and release-gated. CandidateClaims v1 now carries stable semantic
and field identity, so equivalent CV evidence scores once, field-local conflicts
stay isolated, and user resolutions survive re-imports. The first-run source
screen shows durable useful-fact proof, honest partial/failure/no-useful-facts
recovery, and restores terminal states after reload. Until #58/#59 provide a
real family-question coverage seam, the questions-skipped count remains
truthfully zero. Closing #56 leaves [#57 Collect explicit target role and search
area](https://github.com/adrien-mounier/jobcrush-app/issues/57) as the next
onboarding slice.

**2026-07-28 deck follow-up:** [#52 Full essential/desirable match
breakdown](https://github.com/adrien-mounier/jobcrush-app/issues/52) is implemented
and release-gated. The versioned `JobCardV1` contract now carries
server-authoritative essential and desirable coverage from the fit-weighted
scoring seam; the shared Deck/Tailor card renders the approved four-cell
breakdown with mobile and accessibility coverage. Closing #52 removes one
dependency from [#65 Evidence-led first JobCard with Important
gaps](https://github.com/adrien-mounier/jobcrush-app/issues/65); #65 remains
blocked on its onboarding-engine prerequisites.

**2026-07-28 implementation update:** [#55 First-run invitation and persistent
source-entry spine](https://github.com/adrien-mounier/jobcrush-app/issues/55) is
implemented and release-gated. The existing centered invitation now opens anonymous
source assistance on the same route; CV and question-first choices persist through
reload in both in-memory and Postgres session stores; LinkedIn remains disabled and
non-collecting. This establishes the durable onboarding state spine that the remaining
#54 slices extend. Closing #55 unblocks [#56 CV import proof, provenance, corrections,
and recovery](https://github.com/adrien-mounier/jobcrush-app/issues/56) and
[#57 Collect explicit target role and search
area](https://github.com/adrien-mounier/jobcrush-app/issues/57).

**Latest:** the decision-complete
[first-run onboarding revision map](https://github.com/adrien-mounier/jobcrush-app/issues/40)
is now captured in the implementation-ready
[source-assisted first-run onboarding spec](https://github.com/adrien-mounier/jobcrush-app/issues/54).
The implementation ticket graph is published as #55–#69; #55 is the first landed
vertical slice.

**2026-07-28 update:** [Define cross-flow resilience, accessibility, validation](https://github.com/adrien-mounier/jobcrush-app/issues/46) is resolved. The onboarding revision now has explicit pilot gates for honest background waits, interruption recovery, temporary-data retention, match relevance, family classification and novelty detection, question efficiency, time to value, Important-gap comprehension, and manual evidence review. Formal keyboard-only, screen-reader, and reduced-motion compatibility is deferred beyond this effort. The unblocked frontier is now [Rewrite the onboarding reward design around the resolved flow](https://github.com/adrien-mounier/jobcrush-app/issues/47).

The [first-run onboarding revision map](https://github.com/adrien-mounier/jobcrush-app/issues/40)
has resolved the source-entry, imported-evidence, adaptive-discovery, and unmapped-role learning
decisions. Unknown roles now pause before reveal, become screened and deduplicated learning
candidates, publish only after validation, and resume signed-up users when a credible match exists;
the full lifecycle is monitored. The next frontier is
[Audit the downstream journey from discovery to Tailor](https://github.com/adrien-mounier/jobcrush-app/issues/45).
Its prerequisite classification research is resolved in
[`job-family-classification-novelty.md`](https://github.com/adrien-mounier/jobcrush-app/blob/research/job-family-classification-novelty-49/docs/research/job-family-classification-novelty.md):
vector similarity retrieves candidate families, while calibrated support, density, and separation
decide automatic placement, clarification, or an unknown result.

## Milestones

- [x] **S0 — Spikes + foundation** — _done_ (monorepo, CI, Fly deploy, contracts package, the four §8 risk spikes).
- [x] **S1 — Magic mirror (walking skeleton)** — _done 2026-07-18_. A stranger on the web app, no
      account, uploads a CV and gets a watermarked tailored preview in ~2 min. **Quality floor passed
      (JC-2 round 2).** The CV brain that powers it lives in `docs/cv-brain/`.
- [x] **S2 — Own your facts** — _done 2026-07-19_. Full onboarding: signup-after-preview → tiered
      confirm deck → grill → root CV → review → audit → quality gate → validated claim graph v1 in
      Postgres. Epics: E2 auth (JC-18/19/20), E3 deck + grill (JC-21…26, JC-55 Path B), E4 root CV /
      audit / gate / graph (JC-27…32). The audit (decision #6) and the root-CV review with fix-this
      loop-backs (decision #7) closed the slice. Ops (session 11): `RESEND_API_KEY` + `WEB_URL` +
      `MAIL_FROM` now set — real magic-link email verified live, Google OAuth verified by a real
      click-through (external users can sign in via Google today). Custom domain `jobcrush.org` verified
      in Resend (Cloudflare DNS); the `login@jobcrush.org` sender is **staged, pending an API-key swap**
      onto the second Resend account that owns the domain — until then email delivers only to the
      account owner's address.
      _Demo: a user completes onboarding and their profile flips to `ready` with a validator-clean graph._
- [x] **S2.5 — UX/UI cleanup** — _done 2026-07-19._ `/impeccable critique` of the live flow (24/40),
      then three fix batches: (1) harden — magic-link cross-browser P0 + resilience; (2) the ending —
      verified-CV document + evidence-palette badges + next-step; (3) brand bar + a11y + copy. See the
      S2.5 backlog below for the itemised record. _Demo: same features, now feels like a product._
- [ ] **S2.75 — CV quality (the ruler)** — _in design 2026-07-22._ Before S3: define and measure CV
      quality, then fix the output against it. Decisions locked in
      [`docs/cv-quality-kickoff.md`](docs/cv-quality-kickoff.md) — quality = fit to the job, grounded
      in user-confirmed claims; suggested specifics as switch-off chips; two dials (claim big, write
      plain); **two scores that never mix** (well-made = mechanical lint over `cv-brain`; aimed-at-job
      = model panel, sees the CV *and* the confirmed claims); **workbench before live meter**, real
      CVs only. Two open questions each needed their own session: **(A) the grill's stopping rule +
      UX** — **answered 2026-07-23** in
      [`docs/onboarding-reward-design.md`](docs/onboarding-reward-design.md) (cards are the payoff,
      the CV is the by-product; endless countdown, no completion bar; **one visible number**, the
      match % on a job — never a number on the person), and **spec'd 2026-07-24 as [#11](https://github.com/adrien-mounier/jobcrush-app/issues/11), then **sliced 2026-07-24 into 12 `ready-for-agent` tickets #12–#23 (native-blocked)**; **`/orchestrate-team` building the frontier — S21: #12 (E5 contract + stub) + #15 (front door) (`d3977ff`, `d6c405f`); S22: #13 (backend "no" write path + never-re-ask + correction) + #16 (discovery screen 1a — answer types a CV line + fills a section) (`8a48185`, `ea435f0`), live-QA'd; **S23: #18 (discovery 1b — gate→`deck` + "no"/correction/triggered-date/reader-only answer types) (`f794fa5`)**, live-QA'd + Seam-2 e2e 5/5; **S24: #19 (reveal + job card, screen 2a — the never-decreasing match tick + `GET /onboarding/cards` score-sorted card) (`c686c8a`) + #24 (correction-focus a11y) (`c8da788`)**, live-QA'd; **S25: #25 (discovery→`/deck` reveal nav) (`ae56643`) + #22 (the wall at the reveal — OAuth-leading, anon-scored) (`0140d4a`) + #14 (card-quality taste-test — GO-with-guardrails) (`e1dd0aa`)**, two-axis-reviewed + live-QA'd GO; frontier now {#17 badge, #21 swipe 2b} — **both deferred this session** for missing nav targets (#17 tap-opens the not-yet-built `/profile` #20; #21 swipe-right needs the not-yet-built Tailor #23)**; **(B) how `cv-authoring-rules.md` is fed and
      maintained** — still open. _Demo: a prompt change is proved better, not felt better._
      **2026-07-24 S26 update:** [#21](https://github.com/adrien-mounier/jobcrush-app/issues/21)
      shipped in `c435f2c`: swipe/pass controls, signed-in want endpoint, persisted `tailorAdId`,
      and exhausted-deck loopback. Closing it unblocks
      [#23 Tailor](https://github.com/adrien-mounier/jobcrush-app/issues/23), which is already written
      in the GitHub issue tracker and is the next deck/tailor step; #17 remains the other open branch.
      **2026-07-25 close-session:** context files were already synced; live tracker handoff is
      #23 Tailor as `ready-for-agent` with `blocked_by: 0`, plus the separate #17/#20 profile branch.
      **2026-07-25 S28 update:** both long-deferred tickets shipped — **[#23 Tailor (screen 3)](https://github.com/adrien-mounier/jobcrush-app/issues/23)
      in `8091b89`** (instant never-decreasing re-score behind a session-persisted floor, `?`→`✓` +
      bubble rewrite, derived ledger, the three exits, `jobcard.tsx` shared with the deck) and
      **[#17 the profile badge](https://github.com/adrien-mounier/jobcrush-app/issues/17) in
      `3895f27`** (flying chip + logarithmic pile on discovery *and* tailor, tap → `/profile`).
      #23 landing removed #17's missing-nav-target blocker mid-session. Both two-axis-reviewed and
      live-QA'd GO on a production build; two real-stack journey drivers committed. **All four
      screens of the journey now exist.** Frontier is down to
      **[#20 (profile screen — Sorted + Constellation)](https://github.com/adrien-mounier/jobcrush-app/issues/20)**,
      whose close will **empty the spec's frontier and trigger the full-journey QA pass**. Five
      follow-ups filed: #28, #29, #30, #31, and **#33 (the badge can still shrink — it is specified
      to only ever grow)**.
      **2026-07-25 S29:** cleared three of those follow-ups — **#31** (`f2ddf88`, tailor match floor
      keyed to a new `tailor_floor_ad_id` that survives a drop), **#30** (`c89e9f8`, signed-out
      `/tailor` routes to the deck's wall instead of a retry-only dead end), and **#33** (`1f87af8`,
      per-session `fact_floor` applied at all five `factCount` seams — the badge can no longer
      shrink). All three two-axis-reviewed and live-QA'd GO, #33 driven against a Postgres-backed
      API. Filed **[#35](https://github.com/adrien-mounier/jobcrush-app/issues/35)**: the same
      deck-reject path still regresses discovery's *other* monotonic surfaces (`railFill`,
      `essentialRemaining`, and re-asking an answered question) — the badge got the guarantee, the
      rail did not. Frontier now {#20, #26, #27, #28, #29, #35}.
      **2026-07-25 S30:** cleared the three monotonicity defects — **#35** (`8438964`, a deck reject
      now *closes* a discovery question instead of reopening it; review caught two paths the obvious
      fix missed — rejecting a *trigger* still shrank `railFill` via the `askable` denominator, and
      the reader-only question kept its own `confirmed`-only check), **#28** (`bc77914`, the tailor
      ledger stamps each line with the open count at the moment that answer landed, by surfacing the
      store's existing `seq` ordinal; review also caught `seq` leaking onto the `/onboarding/deck`
      payload, where on Postgres it is a *table-global* bigserial), and **#29** (`fbae52c`, the
      negative-filter moves into the shared `buildJobCard`, so a requirement declined in Tailor is
      closed on the deck card too — and #23's duplicated filter + D1 bubble recompute go away).
      Shipped as draft **PR #38** rather than straight to `main`. Two new follow-ups: **#36** (the
      deck never seeds the miner's claims once discovery has recorded an answer — so the S2 review
      step has nothing from the CV to review on the real journey) and **#37** (`seq` is *creation*
      order, so a deck confirm landing after tailor answers still replays at its seed position).
      Frontier now {#20, #26, #27, #36, #37}.
      **2026-07-25 S31:** closed **#36** (`2f4ee00`, the deck's own regression test now actually
      exercises the seed-clobber it was written to catch). Built #20's missing backend track
      (`GET /profile`) and ran the two-axis review over the whole slice, then **paused deliberately
      mid-slice** at the owner's request — nothing committed, working tree unchanged. One
      open product call is on hold pending the owner: whether `GET /profile` may include
      `pending` claims to render "grey", or must be confirmed-only per the confirmation-gate
      invariant. **2026-07-25 S32 update:** owner handoff resolved that call in favor of
      pending-as-grey; **#20 shipped in `ee653e4`** with `GET /profile` deriving gold from the
      rendered root-CV trace, keeping pending mined claims as cool-grey reserve, stripping
      rejected/negative claims from the profile payload, and returning the server-owned floored
      `factCount`. The real `/profile` screen now replaces #17's placeholder with Sorted + canvas
      Constellation views, neutral source text, visible keyboard star controls, and restored dialog
      focus. Gates green: `pnpm test`, `pnpm typecheck`, `pnpm build`, focused Playwright profile
      spec 5/5, plus desktop/mobile visual screenshots with a nonblank canvas-pixel check. Frontier
      now {#26, #27, #37}; #11 remains open as the parent spec/frontier marker.
      **2026-07-25 S32 (cont.) update:** **#37 shipped** (`Closes #37`) — the tailor ledger replays
      on a separate `decisionSeq` ordinal (decision-time) while `seq` stays creation order, so a deck
      confirm/edit landing after tailor answers no longer restamps earlier lines' "still open" counts.
      Two-axis review clean; edit-branch test added to complete AC1 coverage; gates green. Frontier
      now {#26, #27}; #11 remains the parent spec/frontier marker.
      **2026-07-26 S33 update:** **#27 shipped in `b553b3e`** — the hand-maintained curated pool grew
      from 3 to 8 real posting-backed requirement sets; all five additions score as believable strong
      fits (72–94) against the documented senior IT-PM profile. `curated` is explicit but defaults
      false for legacy v0 payloads, the API promotes only the best curated opener and score-sorts the
      remainder, and the marker stays internal. Two-axis re-review clean; full gates + live deck e2e
      7/7 green. Frontier now {#26}; #11 remains the parent spec/frontier marker.
      Also `03fede9`: `concurrency: deploy-main` on the deploy job, so two
      pushes can't race and land the older build last (see `AI/Projects/SHARED_INFRA.md` — this repo
      shares a Fly + Cloudflare account with `vitacairn`; owner backlog is #32).
      **2026-07-26 S34 update:** **#26 implemented in `62e8a81`** — the match tick now scores
      clause-level coherent evidence, so unrelated facts cannot pool words to satisfy one
      requirement, while distinct relevant evidence can still improve the overall fit. Score and
      gap explanations share the same coverage decision; an open requirement caps the display at
      99. The exact 20-ad × 3-CV taste-test matrix has zero inversions, including OKX, and
      1,740 adversarial monotonicity checks pass. Two-axis review and live-stack QA are clean.
      The closest ordering is Hire Feed at 78 vs 76, so future E5 semantic-scoring work should
      strengthen that margin without changing this deterministic fallback's honesty guarantees.
      Closing #26 emptied the build-ticket frontier for #11. Final full-journey QA passed GO across
      discovery, reveal/wall, deck, Tailor, badge persistence, correction, and the current Profile;
      **#11 is closed.** Non-blocking [#39](https://github.com/adrien-mounier/jobcrush-app/issues/39)
      tracks four obsolete `.loadstate` assertions in the old real-stack badge driver.
      **2026-07-26 S36 update:** **#39 shipped in `25ea282`** — the factbadge real-stack journey now
      checks the current focused Profile heading, matching badge count, Sorted/Constellation toggle,
      Back navigation, and keyboard Enter activation. The driver documents serial execution under
      the anonymous-session rate limiter; independent QA passed 44/44 with full gates green. The
      implementation frontier is empty; the active design frontier remains #44.
      **2026-07-25 S28 (parallel lane):** closed session 25's deferred OAuth-failure return path —
      `/auth/google?from=` + an allowlisted `jc_oauth_from` cookie now land a failed Google trip back on
      `/deck?login=…` instead of `/signup`, lighting up the branch #22 left inert. Filed the two #14
      follow-ups: [#26](https://github.com/adrien-mounier/jobcrush-app/issues/26) fit-weighted scorer
      (**do not build concurrently with #23** — it asserts on tick numbers) and
      [#27](https://github.com/adrien-mounier/jobcrush-app/issues/27) curated first-card pool (only 3 ad
      sets exist today). **#20 must not be built while #17 is in flight** — #17 creates `/profile` as its
      tap target, which is #20's own file. **Cleared 2026-07-25: #17 shipped in `3895f27`, so #20 is now
      safe to claim** — it replaces the thin `/profile` placeholder #17 left behind (headline + one line +
      Back, deliberately nothing to tear out). #26's "not concurrently with #23" caveat is also cleared —
      #23 shipped in `8091b89`, so the fit-weighted scorer now only has to re-baseline that ticket's
      committed tick assertions rather than race a session writing them.
- [ ] **S3 — The hunt** — gate-pass triggers cluster grounding + first hunt; real tailored cards
      within the hour; swipe; Apply → prepared-apply package (PDF + screening answers + deep link).
      Epics: E5 cluster engine (JC-33/34/35), E6 feed + hunt (JC-36…40), E7 swipe + prepared apply
      (JC-41/42/43). _Demo: the core loop closes on web._
      **E5 got its shape from the CV-quality session:** offline monthly research per big job family
      (the floor) + one cheap LLM call per job ad (the specifics), with cost tracked per job.
      ⚠️ **`tailoring-reasoning.md` §4 is NOT that floor** — corrected 2026-07-23
      ([#6](https://github.com/adrien-mounier/jobcrush-app/issues/6)). §4 is a *discriminator* (which
      role language the CV adopts) and it explicitly ignores the "too generic" shared baseline —
      budget, stakeholder management, requirements gathering. A floor is made of exactly what a
      discriminator throws away. **E5 has to build the floor from scratch.**
      **E5 also owes the reward design four things** (`docs/onboarding-reward-design.md` §6.2, §8-9.1):
      **re-scoring existing cards when the profile changes** (the month-two hook — an old 34% card
      reading 51% on return); its **ranked requirement list per ad** doing double duty as the
      instant, model-free match tick during onboarding; and **the family floor in the shape discovery
      can consume** — ranked into bands (the essential band *is* discovery's gate), each item carrying
      a question a lazy person answers in seconds, that question's answer options, the CV section it
      writes into, and whether a "no" is fatal or fine. An item that cannot be phrased as a question is
      not usable: discovery is the floor's first consumer. And the **job card's highlight bubble**
      (§9.1, added 2026-07-23): given an ad and a profile, name **the user's strongest fact against
      something this ad leads with**. Its other clause is free — the highest-ranked open requirement —
      but this one is a judgement, and it is the sentence the card's credibility rests on, because it
      is what stops the match % ever being shown bare.
- [ ] **S4 — Every day, everywhere** — per-user daily runs + notifications; the **mobile app** (swipe,
      deck, voice grill); the full Path B guided interview (JC-55, stubbed in S2); email-ingest +
      LinkedIn import doors; update flow; GDPR delete/export.
      Epics: E8 daily loop (JC-44/45), E9 mobile (JC-46…49), E10 import doors (JC-50/51), E11 update +
      compliance (JC-52…54, JC-56). _Demo: a returning user gets fresh cards daily on their phone._

## Backlog (S2.5, the immediate next work)

UX/UI cleanup of the existing flow (see milestone above). Critique done 2026-07-19 (dual-agent
`/impeccable critique`, 24/40; snapshot in `.impeccable/critique/`). Working through the fixes:

- [x] **Discovery responsive-layout resilience** — removed A4-driven equal-height coupling and
  restored flexible stacked-wrapper sizing. Geometry now covers every ask shape across phone,
  tablet, and desktop—including the owner's reported 2048×1118 viewport—rather than one post-answer
  screenshot. Sparse CV previews are content-sized; A4 is no longer a screen-layout constraint.
- [x] **Harden batch 1** — magic-link cross-browser session carry (P0), signup email-typo recovery,
      deck batch-persistence + friendly not-found, preview polling. api 160 / typecheck 7.
- [x] **The ending** — the ready screen now renders as a document with a "✓ Verified · watermark
      removed" seal (resolves the preview's promise), a per-line evidence badge in the shared palette
      (`.badge` component; `--jc-verified/derived/partial/suggested` — the differentiator, finally
      shown) with a legend, and a "What happens next" step. Per-line "fix" kept.
- [x] **Brand presence** — app-wide `.brandbar` (JobCrush wordmark) in `layout.tsx`, on every screen.
- [x] **A11y** — one authored `:focus-visible` ring app-wide; `aria-live` on the SSE feed + `role="alert"`
      on every flow error + `role="status"` on transient notices; `aria-pressed` on landing + deck chips;
      `aria-label` on every placeholder-only input; chip touch target ~33→~40px; styled `input[type=email]`;
      preview iframe now fits to width on mobile (viewport meta + narrow-screen padding in the server
      preview render); the old "pinch to read" hint is now "scroll inside to read it all".
- [x] **Copy** — signup h1 "Save your draft to your account" (was "unlock your draft"); preview→wall
      forewarning ("takes an email, no password"); "Build it with me" → "Paste your CV text"; the untrue
      "stays on your device" import lede → "we use it only to build your draft".

- [x] **Backlog cleanup** — the sub-items missed in the first three batches, to fully close the
      critique's 5-command plan: gate-failure copy (loopback now folds the mechanical `nodeId…` strings
      into one actionable line, keeps the human ones); deck **progression** ("N of M reviewed" by the
      "Worth a closer look" heading); evidence badge on each **individual deck claim** (colorize — the
      classification was fetched and unused on the deck); `.btn`/`.chip` **hover + active** states with a
      reduced-motion guard; **chip overflow** contained (long batch claims wrap in-card, no overflow).

S2.5 done. Flow + deck re-screenshotted (desktop + mobile, 0px overflow throughout).
Next: **S3 — the hunt** (E5 cluster engine, JC-33/34/35 — **#86, design pass + vertical re-slice done
2026-08-02, now ten children #102–#111**; the nine earlier children #87–#91 / #95–#98 are closed as
superseded). Chain: **#102 contract v1 + #103 language gate → #104 read an uncurated advert into the
deck → #105 meaning-aware judging → #106 eligibility asked once → #107 withdrawal → {#108 bubble,
#109 re-score} → #110 measurement gate → #111 retire the guards**. The family-floor half shipped as
#58–#62; the per-ad half is #86's scope. Ad-text input verified 2026-08-02 — full advert available.
✅ **#102 done 2026-08-02 (`d7712a5`)** — the v1 requirement contract and every consumer on it, band
vocabulary unified on `essential`/`standard`/`nice-to-have` via a *shared* `RankBand` object rather
than three equal copies. User-invisible, proven by diffing the old scorer against the live migrated
API (8 cards byte-identical) plus a live browser drive.
✅ **#103 done 2026-08-02 (`f5a4c27`)** — every posting language-labelled at ingest, locally and
deterministically; non-English kept, labelled and never surfaced; one rule (`apps/api/src/language.ts`)
applied to the posting's language *and* its requirement set's, on the deck, `/want`, the tailor target
and the pre-signup preview; reading languages are a **list** defaulted to `["en"]`, unpersisted by
design. Three never-folded counters on `GET /ops/counters` (`language_skipped`,
`language_undetermined`, `read_failed` — #104 is the failure counter's first writer). ⚠️ **Filed
[#113](https://github.com/adrien-mounier/jobcrush-app/issues/113), blocked on #99–#101:** the English
test scores 0.03 on an ATS bullet-list advert and 0.00 on a skills blob, so those formats label `und`
and are hidden from everyone once a real feed lands. Invisible against the 16-advert fixture corpus —
which is exactly why it must be tuned against real provider text, not the fixtures again.
✅ **#104 done 2026-08-02 (`fb68dcd`)** — one model call per advert produces its requirement list *and*
its family verdict, persisted by `adId` and shared by every session. Deck 8 → 15 (not 16: the Hays
posting carries a hand-authored Chinese requirement set and is never re-read). ✅ **#115 done
2026-08-02 (`3b83de0`)** — staging's 42.9% read-failure rate was the deck's own 15s deadline, not the
model; failures now carry a class and are retrievable behind `OPS_KEY`.
✅ **#105 done 2026-08-02 (`8b0bc7c`)** — the card's number, breakdown, "where you fit" and "not yet"
list now come from a meaning-aware judgement instead of token overlap. Persisted per (advert,
confirmed-fact fingerprint, requirement-id set, judge version), so unchanged facts are never re-judged
and the number is pinned once stored; purge sweeps by **disuse**, not age, so an active viewer's card
is never re-rolled under them. Model is configuration (`JUDGE_MODEL`); per-card cost recorded, tokens
null rather than estimated. Judge is an optional dep like `readAd`, so every pre-#105 path runs the
old tick byte-for-byte — #111 owns re-baselining. ⚠️ **The five regression rows are worked examples
inside `card-judge.md` and therefore certify nothing on their own** — a hold-out set in an unrelated
domain is what `judge.live.test.ts` grades a real model against, and it still needs an API key to run.
⚠️ **Carried limits:** a judging failure falls back to the old scorer and is counted, so a card's
*first* view can show a number that changes later (fallback cards now rank below judged ones, so the
deck can't lead with the card we understand least); the deck's judging phase runs under one shared 8s
budget because concurrency waves could otherwise push the route past the web proxy's 30s deadline and
return no deck at all; and judgements key on the user's own fact set, so they **never warm across
users** — every new visitor pays a cold deck. Filed as
[#117](https://github.com/adrien-mounier/jobcrush-app/issues/117).
✅ **#118 done 2026-08-03 (`fd45c8d`)** — every model call in the API now records one durable ledger
row (visitor pseudonym, stage, model, tokens, computed cost, timestamp) at the `llm.ts` seam, across
all **seven** spending stages, replacing the two in-memory token counters that reset on every deploy.
Rates are configuration (`LLM_PRICING_JSON`), cost is computed at write time so a re-price never
rewrites history, and an unmeasurable driver records null tokens/cost with `measured:false` — unknown,
never estimated. Retention per the owner's decision on the ticket: ledger rows retained indefinitely,
every content-bearing row purging on today's schedule, so a purged visitor survives as a pseudonym
with nothing behind it; `scrubVisitor` keeps the money and drops the id for #68's deletion request
(no caller yet — `purge.ts`'s header says so). Restart survival verified against a real Postgres 16,
not just pg-mem. ⚠️ **Carried limits:** per-visitor cost is **first-toucher-billed** — advert reads and
judgements are cached and shared, so a warm visitor records nothing for those stages and their figure
is "what they caused us to spend fresh", not their share of what they consumed (this matters for any
pricing decision taken off it); in-flight writes are lost on shutdown (no SIGTERM handler); a call that
throws records nothing, so a client-side timeout on a request the provider served under-reports; and
`main.ts`'s wiring is guarded by convention, not by types, so a future stage wired with the raw client
would spend unmetered without failing a test. **Unblocks the ops dashboard and #117.**
✅ **#117 CLOSED 2026-08-03 (`9b348af` → `c152dd9`), AC6 formally unmet — see the end of this entry.**
**Final shipped state: `DECK_JUDGE_MAX_CARDS = 8`.** Measured live on staging three times: unearned
numbers on a cold deck went **9 of 15 → 0 of 15**, cost per cold visitor **$0.29 → $0.1394 (−52%)**, a
returning visitor's deck is **free** (0 model calls), and no number moved between views in any run.
⚠️ **The experiment not to repeat:** the owner raised the cap 8 → 20 to stop 7 cards saying "Not
scored"; the paid run showed it made the first deck **emptier** (3 judged vs 6) and cost **114% more**
($0.2985), because at 20 nothing is bound-excluded and 12 cards were still in flight when the shared 8s
budget expired. **The first-view score count is governed by `DECK_JUDGE_BUDGET_MS` against per-call
latency, not by the bound** — reverted in `c152dd9`, and the three-run table lives in the constant's own
comment so nobody re-runs it. **AC6 ("fallback rate lower than 9-of-15") is unmeetable by any cap** and
was closed unmet rather than redefined to pass; the failure it guarded against — a cheap cost cut
pushing more of the deck onto the old scorer — cannot occur any more, which is what 0-of-15 means.
**→ #121 (not `ready-for-agent`, wants a `/wayfinder` pass) carries the real fix:** score just ahead of
the visitor as they swipe rather than scoring the whole deck up front, which also retires the
token-overlap pre-filter that currently picks *which* 8 adverts are worth paying to judge.
🟡 **(superseded, kept for the record) #117 shipped 2026-08-03 (`9b348af`)** — the cold deck no longer
buys a judgement for every advert and no longer shows the old scorer's number as though it were
judged. `DECK_JUDGE_MAX_CARDS = 8` bounds **paid** calls per visitor per fact set; free cache reads are
never bounded (a returning visitor gets a fully judged deck for nothing, via a cache-only path that
takes no `LlmClient` and so cannot spend); `CardScoreProvenance` replaces the judged/fallback boolean
with `judged` / `pending` / `unscored` / `estimated`, where `pending` and `unscored` carry
`matchPct`/`breakdown`/`bubble` as **null** — the response cannot express a fake number. Superset reuse
keeps verdicts at or above the coverage bar when evidence has only grown, re-judging only the still-
unmet requirements. The web deck polls from the reveal screen, so most visitors never meet a card
without a number. QA live: 8 paid calls across 10 consecutive deck loads, zero numbers moved, 0 of 15
cards claiming an unearned number (was 9 of 15). 🐛 **The near-miss worth remembering:** the first
implementation ranked the paid set over what the cache had *not* resolved, so each client poll freed
bound slots and bought the next batch — the visitor paid for all 15 anyway while every "at most 8 per
request" test stayed green. **A per-request bound is not a per-visitor bound once a client may retry**
— #116 has the same shape. ⚠️ **Why it is still open:** AC6/AC8 require the cold-deck fallback rate and
cost per visitor reported **together from one real run**, which needs `OPS_KEY` set on
`jobcrush-api-staging` (`/ops/spend` 403s without it) — no local API key, and the CLI fallback spends
unmetered so the cost half reads $0. ⚠️ **Carried limit:** the cheap token scorer still picks *which*
8 adverts are worth paying to judge, so a strong match phrased in the candidate's own words can rank
low on vocabulary and never get judged — belongs with family-fit ranking (#107), not here.
**Next: #106, eligibility asked once in discovery — the last input the judge is missing.**

Then S3, the hunt: E5 cluster engine (JC-33/34/35) is the riskiest and the entry point, then E6
feed + hunt (JC-36…40), then E7 swipe + prepared apply (JC-41/42/43). Per-ticket ACs are in the
archived `dev-plan-v01-hosted.md`.

### S2 record (all done)

- **✅ E4 spine complete and wired** (JC-32 `a77f974`, JC-21/31/27 `8cd246a`, E3 slice A `7994b29`) —
  the onboarding loop now **closes end to end**: `POST /onboarding/deck` → confirm/edit/reject →
  `POST /onboarding/build` runs `buildClaimGraph → renderRootCv → runGate` synchronously and flips the
  session to `ready`. Rides the anonymous session; no tiering, no grill yet (API + integration test only).
- **✅ E3 deck done** (JC-22 tiering `3681824`, JC-23 browser deck UI `c9efe8d`) — `/deck/[jobId]` with
  individual yes/edit/remove cards + batch-by-section, build → verified root CV or loop-back. A
  Playwright browser e2e covers happy / loop-back / input-error paths (`2c4f93d`, `3e65843`, `10991aa`).
- **✅ E3 grill done** (JC-24 `ba97b44`) — `detectGaps` (missing-dates + needs-info, capped 5) → ~5
  skippable questions, LLM-phrased with a template fallback; answers become confirmed user-authored
  claims (JC-26 via `claims.add`). Browser e2e answers a grill question and traces it into the CV.
- **✅ E3 complete** — JC-55 Path B coming-soon door shipped (`89b4c67`); deck + grill done and
  browser-verified. (Deferred until data exists: the grill's "too thin" trigger — two guestbook
  counters — before promoting any v2 gap types.)
- **✅ JC-6 persistence done** (`8a18efa`) — sessions + confirmed claims persist to Postgres when
  `DATABASE_URL` is set (in-memory otherwise). A shared store-contract test runs both drivers (Postgres
  via pg-mem). Delivers S2's "claim graph v1 in Postgres" and unblocks real accounts. Jobs/uploads stay
  in-memory (transient run-state).
- **✅ E2 auth done** (`1b398b9`) — passwordless magic-link (JC-18), anon→account merge via one
  `setClaimedByUserId` (JC-19), auto-purge of unclaimed data (JC-20); server-side wall on the deck.
  Security: single-use / 15-min / sha256-only tokens, per-IP rate limit, no email enumeration. Both
  drivers pg-mem-tested; browser e2e traverses the wall.
- **✅ Audit + root-CV review done → S2 complete** — the audit (decision #6: LLM polishes mined
  wording against `docs/cv-brain/`, number-conservation + glyph guards, user-authored words never
  touched, any failure ships the unaudited CV) and the review (decision #7: the ready screen renders
  from the trace with a per-line "fix" that edits/rejects the claim behind it and rebuilds — never a
  freeform CV editor). Google OAuth also live on the wall (ported from vitacairn) — **configured on
  staging 2026-07-19** (Google console client + `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`WEB_URL`
  Fly secrets; `/auth/google` verified redirecting to Google — and **verified end to end by a real
  click-through 2026-07-19 (session 11)**: external users can sign in via Google today. Real magic-link
  email also wired that session (`RESEND_API_KEY`/`WEB_URL`/`MAIL_FROM` set, verified live). One ops
  item remains: swap staging's `RESEND_API_KEY` to the second Resend account that owns `jobcrush.org`
  so the staged `login@jobcrush.org` sender goes live and email reaches *any* user, not just the
  account owner. Plus a security follow-up: rotate the two Resend keys that leaked into a transcript.

Design decisions for this slice: [`docs/s2-kickoff.md`](docs/s2-kickoff.md).

## Later (unscheduled)

- **Advisory "improve your profile"** — a kind, never-blocking way to tell a user their profile is
  thin and how to strengthen it. The S2 gate deliberately judges only our pipeline's work, never the
  user's career; this feature is where profile-strength feedback will live. Decided 2026-07-18.

- **Grill B: feeding + maintaining `cv-authoring-rules.md`** — how rules get in, how they stay
  current, which rules we commit to, and where the concrete readability rule lands (sentence-length
  cap, one idea per bullet). Open question B from `docs/cv-quality-kickoff.md`. Added 2026-07-22.

- **Owning your own answers: correcting and revising a fact.** Added 2026-07-24, raised by Adrien
  while resolving [the profile screen](https://github.com/adrien-mounier/jobcrush-app/issues/9).
  Two halves, and as of 2026-07-24 the first is ticketed while the second **still wants its own `/wayfinder` effort** — it is a hole in the concept, not a ticket:
  - **Persisting a "no" so it is never re-asked.** `onboarding-reward-design.md` §6.2 rule 1 says the
    claim graph records a "no". **It does not.** `graph.ts` hardcodes `renderable: true` and has no
    `Negative` path; the miner cannot emit one; `claims.confirmed()` drops rejected claims rather
    than recording them; and `detectGaps()` re-derives gaps from the confirmed set, so an unanswered
    hole is re-detected and **the question comes back**. The contract already supports the fix
    (`claim_graph.schema.json` has `Negative`, `gate.ts` already blocks `renderable: false` from
    rendering) — only the write path is missing. **E5/discovery requirement**, recorded in §6.2.
    **Ticketed 2026-07-24 as [#13](https://github.com/adrien-mounier/jobcrush-app/issues/13)** (the "no"
    write path + in-onboarding fact correction); the never-re-ask gate rides in discovery
    [#18](https://github.com/adrien-mounier/jobcrush-app/issues/18).
  - **Letting a past answer change.** People get the certification, get the clearance, change sector.
    Nothing lets them revise, and once "never re-ask" is enforced an out-of-date "no" becomes
    load-bearing forever. Also covers correcting a mistap *during* onboarding, which is in scope for
    the onboarding map and now sits in its fog.

- ~~**Grill A: the grill's stopping rule + onboarding UX**~~ — **answered 2026-07-23**, see
  [`docs/onboarding-reward-design.md`](docs/onboarding-reward-design.md). The stopping rule is that
  there is none: the bar only ever counts down to the next card drop, so nothing is ever
  "incomplete" and the user leaves whenever they like, holding what they earned. What remains from
  this entry is tracked on the wayfinder map
  [Onboarding journey: landing to first card](https://github.com/adrien-mounier/jobcrush-app/issues/5):
  the **front door** is **done 2026-07-23** (*"Answer questions. Collect jobs."* on a centred door
  that writes itself, then **Ready?**, then the CV shortcut — §10.1), and **the discovery questions**
  are **done 2026-07-23** (§6.1-6.2: one free box for question 1, and discovery runs until the family
  floor's **essential band** has been *asked* — covered means asked, not satisfied), and **the job
  card** is **done 2026-07-23** (§9.1: the reveal hides the deck and the deck opens on the best match;
  the card is title/score → a **highlight bubble** → where you fit / where you don't / asked and
  closed → the ad folded shut last), and **the profile screen** is **done 2026-07-24** (§8.3
  resolution: two views behind a toggle — Sorted + Constellation — under one colour law, **gold = on
  your CV, grey = saved for later**; the "no" is off this screen). **The map's frontier is now empty
  and its destination — a decided onboarding design ready for `/to-spec` — is reached.** The design is
  now **spec'd 2026-07-24 as [#11](https://github.com/adrien-mounier/jobcrush-app/issues/11)**
  (`ready-for-agent`); next lifecycle step is `/to-tickets`. The only thing still deliberately open is
  **where the wall sits** (fog — it waits on the S2.75 workbench, not on this map).

## Completed

- [x] 2026-07-19 — **Audit + root-CV review → S2 done.** The audit (decision #6): `audit.ts` +
      `prompts/root-cv-audit.md` polish mined bullet wording inside `/onboarding/build`, gated by
      mechanical guards (numbers conserved exactly, no forbidden glyphs, per-bullet fallback,
      user-authored words never sent to the model); the gate certifies the audited trace. The review
      (decision #7): the ready screen renders from the trace, each line carries a "fix" that reopens
      the claim (edit → user-authored / remove → reject) and rebuilds. api 152 pass, typecheck 7/7,
      all 6 browser e2e green including a review fix traced into the re-rendered CV.
- [x] 2026-07-19 — **E2 auth (JC-18/19/20).** Passwordless magic-link login, anon→account merge
      (one `setClaimedByUserId`), auto-purge; server-side signup wall on the onboarding routes.
      Security ACs (single-use/expiry/rate-limit/no-enumeration) pg-mem + API tested; browser e2e
      signs in through the wall. Commit `1b398b9`.
- [x] 2026-07-18 — **JC-6 Postgres persistence.** Sessions + the confirmed-claim graph persist to
      Postgres (`DATABASE_URL`), in-memory otherwise; a shared contract test runs both drivers via
      pg-mem (which caught + fixed an in-memory seed idempotency bug). Meets S2's "graph v1 in Postgres".
      Commit `8a18efa`.
- [x] 2026-07-18 — **JC-55 Path B stub → E3 complete.** A "coming soon" door on `/import` ("I don't
      have a CV yet") for the from-scratch guided interview that ships in S4. Closes E3 (deck + grill).
      Commit `89b4c67`.
- [x] 2026-07-18 — **JC-24 the grill.** Gap-filling questions after the deck: `detectGaps`
      (missing-dates + needs-info, capped 5), kind LLM phrasing with a template fallback, answers →
      confirmed user-authored claims. api 114 pass (12 grill tests); browser e2e answers a grill
      question and traces it into the final CV. Commit `ba97b44`.
- [x] 2026-07-18 — **E3 deck UI + browser e2e.** The confirm deck ships (JC-22 tiering, JC-23
      `/deck/[jobId]` UI); the onboarding flow is browser-verified end to end by a Playwright smoke
      (happy, loop-back, paste-too-short, unparseable-upload). Two latent bugs fixed en route (empty-body
      content-type; `/import` missing session). Commits `3681824`, `c9efe8d`, `8680fea`, `2c4f93d`,
      `3e65843`, `10991aa`.
- [x] 2026-07-18 — **E4 spine + E3 deck/build loop closes.** The onboarding loop runs end to end
      (paste → mine → deck → confirm/edit/reject → build → `ready`): claim-graph builder (JC-32,
      `a77f974`), claims store + gate + root-CV renderer (JC-21/31/27, `8cd246a`), and the synchronous
      deck + build API over the spine (E3 slice A, `7994b29`). API + integration test only; deck UI,
      grill, and auth still ahead.
- [x] 2026-07-18 — **S1 done: magic-mirror preview + quality floor passed.** Anonymous upload →
      mine → tailor → watermarked preview on the hosted web app; JC-2 round 2 confirmed the improved
      draft beats the original. Engine parity + conservation lint landed (`2d8411f`, `db79ae6`); CV
      brain forked in from JobCrush (`8e02ee0`).
- [x] 2026-07-17 — **S0 done: foundation.** pnpm/Turbo monorepo, contracts package golden-tested vs
      the `.mjs` oracles, Fastify skeleton + job store/SSE, Fly api + web deploy with CI auto-deploy,
      R2 uploads, Postgres. Spikes JC-1…4 answered.
