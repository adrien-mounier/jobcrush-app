# Roadmap — jobcrush-app

_Last updated: 2026-07-28_

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
Next: **S3 — the hunt** (E5 cluster engine, JC-33/34/35).

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
