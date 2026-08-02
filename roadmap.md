# Roadmap — jobcrush-app

_Last updated: 2026-08-02_

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

**2026-08-02 (session 63) `/orchestrate-team #115` — the 43% wasn't a reading problem, it was a deadline.** [#115](https://github.com/adrien-mounier/jobcrush-app/issues/115) closed (`3b83de0`). Driving all 7 uncurated adverts through the real read path produced **10 completed reads, 10 successes, 0 validation retries** — disconfirming all four causes the ticket suspected. The deck allows each uncached read **15s**; a real read takes ~15–27s, so roughly three in seven lose that race every request. **Severity was also overstated and corrected on the ticket:** nothing cancels an abandoned read, so it finishes and persists itself and the next request serves it from cache — the real cost is that *the first viewer of any never-before-read advert loses it*, harmless at 17 fixed postings and a permanent tax on the newest jobs once #99–#101 lands. **Owner kept the deadline** (deck speed unchanged); returning the deck immediately and filling in as reads land is filed as [#116](https://github.com/adrien-mounier/jobcrush-app/issues/116) with both rejected alternatives recorded. A timeout is no longer counted as a read failure — the same trap #103 drew a line against for language skips — and ⚠️ **that split removed alarm coverage, whose replacement was broken twice before shipping, both caught pre-commit**: the new timeout alarm first rated itself against `adReader.read_succeeded`, which an overrunning read *increments itself* when it self-heals, capping a sustained 100%-timeout incident at a 50% reported rate under a 50% threshold — structurally unable to fire in the scenario it existed for, reproduced live by QA at exactly `500‰`. Fixed by correcting the **denominator, not the threshold** (`postings.read_in_time`, counted at the deadline site). **The reason a read didn't land is finally retrievable** — five failure classes, a bounded ring buffer, a log line, and `/ops/read-failures` behind `OPS_KEY`, fail-closed after review caught raw pg/driver text on an open route. 🔑 **`OPS_KEY` must be set on staging or AC2 is unmet in production.** QA proved the load-bearing claim over real HTTP: request 1 back in 15,013ms without the slow adverts, all 7 persisted by t+22s, request 2 serving 15 cards in 4ms with no new model calls. **Two gaps carried:** no real model call in any test (no local key), so "reads take 15–27s" rests on one CLI-driver measurement; and nothing measured on staging yet — AC3's literal wording closes only after deploy. **Known limits recorded:** the timeout alarm dilutes as the pool warms (a cache hit counts as in-time — revisit at #99–#101), concurrent requests double-count one slow read, a restart mid-overrun drops the attempt from both counters. Frontier is **#105** (the card's number is still the knowingly-broken token-overlap score), with **#114** the natural neighbour on the same read path.

**2026-08-02 (session 62) `/orchestrate-team #104` — the tracer bullet landed: an advert nobody curated becomes a card.** [#104](https://github.com/adrien-mounier/jobcrush-app/issues/104) closed (`fb68dcd`). One model call per advert produces its requirement list **and** its posting-family verdict in the same pass, zod-parsed, then persisted keyed by `adId` alone and shared by every session that sees that job — nobody pays twice. Deck **8 → 15**, not the ticket's 16: the 16th is an English advert carrying a hand-authored *Chinese* requirement set (#103's dual-gate fixture), and reading it anyway would have regressed a shipped safety rule to make a demo figure match. **The blocking definition is now contract in three places** — pinned in the prompt, pinned by a test against that file, and enforced in code (a `blocking` requirement without a hard-gate eligibility dimension is clamped to ordinary and counted) — after review caught that the clamp and the prompt contradicted each other and would have made blocking **unreachable**, leaving the operator's blocking-rate counter at 0 forever and reading as healthy. Unreadable adverts produce no card and no fabricated number; failures are counted and alarmed (threshold + minimum sample, logged once on transition), language skips counted separately so they cannot drown the rate, and per-advert token cost stored and aggregated. `AD_READER_VERSION`'s prompt half is a **hash of the prompt text actually sent**, so a forgotten bump can't serve the pool from a stale cache. Also fixes #102's carry-forward (one unparseable advert 500ing the whole deck). **Carried forward as [#114](https://github.com/adrien-mounier/jobcrush-app/issues/114):** a *malformed* curated fixture is indistinguishable from a missing one and silently triggers a paid re-read, and failures aren't cached so every deck request re-attempts every failing advert at 2 calls each — free at 17 fixture postings, expensive behind a real feed. 🚨 **Verified live on staging immediately after deploy, and the first real traffic found a defect: 3 of 7 uncurated adverts failed to read — 42.9%, alarm firing.** Filed as [#115](https://github.com/adrien-mounier/jobcrush-app/issues/115); cause unknown, because the counter records that a read failed and not why. The safety behaviour was right (no cards, no fabricated numbers, rest of deck intact) and **the observability this slice was funded for is what surfaced it within minutes rather than as jobs quietly missing from decks.** Same run gave the **first real unit economics, replacing the spec's estimates: ~2,200 input / ~1,350 output tokens per advert, ≈2–3 US cents each**, and **38 requirements produced with 0 blocking and 0 clamped** — the first evidence the pinned prompt holds on real advert text without the code-level clamp having to correct it. Frontier is **#115 then #105**: a better number on a card matters less than half the pool producing no card at all. These 15 cards carry the knowingly-broken token-overlap score until #105 lands.

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
🟡 **#117 shipped 2026-08-03 (`9b348af`), ticket deliberately still OPEN** — the cold deck no longer
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
