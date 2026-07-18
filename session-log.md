# Session log — jobcrush-app

Newest first. One entry per working session. Ticket + commit refs so the plan stays honest.

## 2026-07-19 (session 8) — Audit + root-CV review (S2 complete) + Google OAuth on the wall

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

**S2 is done.** Next: S3 (the hunt) — E5 cluster engine first (riskiest), then E6 feed + hunt,
E7 swipe + prepared apply. Ops leftover: `RESEND_API_KEY` + `WEB_URL` on staging for real email.

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
