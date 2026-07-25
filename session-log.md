# Session log — jobcrush-app

Newest first. One entry per working session. Ticket + commit refs so the plan stays honest.

## 2026-07-25 (session 28) — `/orchestrate-team` on #11: shipped #23 (Tailor, screen 3) + #17 (the profile badge)

Seventh build session on the #11 frontier. Claimed **[#23](https://github.com/adrien-mounier/jobcrush-app/issues/23)** + **[#17](https://github.com/adrien-mounier/jobcrush-app/issues/17)** — the two tickets S25/S26 kept deferring for missing nav targets; #23's own landing removed #17's blocker mid-session. Shipped green: `8091b89` (#23), `3895f27` (#17), plus `03fede9` (CI deploy guard). Frontier now **{#20 profile screen}** plus the follow-ups filed below.

- **#23 — Tailor (screen 3).** `GET/POST /onboarding/tailor{,/answer,/drop}` + `apps/api/src/tailor.ts` + `/tailor` on the web. Questions come from the ad's ranked requirements (E5 stub); every answer re-scores the visible % instantly and **can only climb** — a `tailor_floor_pct` on the session (both drivers, `GREATEST`/`Math.max`) guarantees it, since a correction or a "no" can lower the raw tick. Answering moves a requirement out of *Where you don't — yet* into *Where you fit*, rewrites the bubble's gap clause, and lands a derived ledger line. A "no" closes the gap for good (dim dot, never a cross). Exits are open from question one and both routes reach a byte-identical ending; **Drop deletes no claim**, which is what makes *"everything you told me stays on your profile"* literally true. The deck's card renderer was extracted to `apps/web/app/jobcard.tsx` so both screens share one card.
- **#17 — the profile badge.** A chip flies from the tapped control into a top-bar badge on **both** discovery and tailor. Pile, never a gauge: independent tapering slabs on `log2(n+1)`, still gaining layers at 45/90/181/362, no container, no track, no maximum, no gold at rest — and the silhouette *changes shape* as it grows, the opposite gesture to filling up. Word collapses past 3 facts. **A "no" finally pays out** (it types no CV line, so the chip is its only reward); a **correction** deliberately flies nothing, because the count didn't change. Tap → `/profile`, a thin placeholder #20 replaces.
- **Two-axis review — 7 must-fixes on #23, 2 on #17.** Worst on #23: **tailor answers never reached the CV** (`cvLines` borrowed discovery's derivation, which filters to `discovery-` claims), so *"use this CV"* returned a CV containing nothing said on the screen. Worst on #17: **the first answer flew no chip** — found independently by *both* axes. Also reverted a `DOMRect` threaded through 5 signatures and 12 call sites in discovery down to two lines per screen.
- **QA (live, real stack, production build).** #23 came back **NO-GO** on a defect neither suite could see (see lessons): after a "no" the bubble kept naming the declined requirement. Fixed, re-driven, **GO** — journey 56/56, deck 7/7. #17 **GO** first pass — all 5 ACs, 33/33 e2e, journey 43/43, no regressions. Two real-stack drivers now committed: `tailor-journey.mjs`, `factbadge-journey.mjs`.
- **Follow-ups filed:** [#28](https://github.com/adrien-mounier/jobcrush-app/issues/28) (ledger restamps historical open counts), [#29](https://github.com/adrien-mounier/jobcrush-app/issues/29) (a Tailor-declined requirement still shows open on the deck card — the price of keeping `buildJobCard` byte-identical for #19), [#30](https://github.com/adrien-mounier/jobcrush-app/issues/30) (`/tailor` signed-out dead-ends on a 401 instead of the wall), [#31](https://github.com/adrien-mounier/jobcrush-app/issues/31) (match floor still lost on drop → re-swipe; not visitor-reachable until in-tailor correction ships), [#33](https://github.com/adrien-mounier/jobcrush-app/issues/33) (**badge can shrink** — `factCount` needs server-side monotonicity; reachable via an S2 deck reject).
- **Cross-project infra review (owner-requested, mid-session).** `jobcrush-app` and `vitacairn` share **one Fly account and one Cloudflare account**. Hosted resources don't collide (distinct app/DB/bucket names), but **local dev ports do** — both APIs default to 3000 and both web proxies target `127.0.0.1:3000`, so one project's frontend can silently reach the other's backend. Wrote `AI/Projects/SHARED_INFRA.md` (inventory, rules, port recipe) and summarised the three critical rules in the shared `AI/Projects/CLAUDE.md`. Shipped the one code fix: `concurrency: deploy-main` on the deploy job (`03fede9`) so two pushes can't race and land the older build last — jobcrush lacked it, vitacairn already had it. Owner backlog as [#32](https://github.com/adrien-mounier/jobcrush-app/issues/32): set a spending alert, and verify vitacairn's Fly token is app-scoped (jobcrush's already is).
- **Next session:** **#20 (profile screen — Sorted + Constellation)** is the last screen ticket on #11 and is now genuinely unblocked — #17 built the `/profile` route it replaces. Closing it empties the spec's frontier, which triggers the **full-journey QA pass** across all four screens. The five follow-ups (#28–#31, #33) are independent and small; **#33 is the one with real UX weight** (the badge is specified to only ever grow).

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
