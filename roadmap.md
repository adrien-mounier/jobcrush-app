# Roadmap — jobcrush-app

_Last updated: 2026-07-18_

> Forward-looking product roadmap. S0 + S1 are done; this plan carries S2 → S4. The **detailed
> original spec, per-ticket ACs, and per-slice kickoffs are archived in the JobCrush repo**
> (`docs/dev-plan-v01-hosted.md`, `docs/onboarding-init-design.md` §8 authoritative,
> `docs/s0..s4-kickoff.md`) — that history stays there; this repo owns the plan from here on.

## Goal

A hosted product that turns anyone's CV into a **grounded, verified profile** and delivers
**tailored, ready-to-submit** job applications — the productized version of the personal JobCrush
pipeline, for many users, on web and mobile. v0.1 scope is **prepared-apply** (the user submits;
no autonomous submit, no LinkedIn credentials, ever).

## Milestones

- [x] **S0 — Spikes + foundation** — _done_ (monorepo, CI, Fly deploy, contracts package, the four §8 risk spikes).
- [x] **S1 — Magic mirror (walking skeleton)** — _done 2026-07-18_. A stranger on the web app, no
      account, uploads a CV and gets a watermarked tailored preview in ~2 min. **Quality floor passed
      (JC-2 round 2).** The CV brain that powers it lives in `docs/cv-brain/`.
- [ ] **S2 — Own your facts** — _in progress_. Full onboarding: signup-after-preview → tiered confirm
      deck → grill → root-CV review → audit → quality gate → validated claim graph v1 in Postgres.
      Epics: E2 auth (JC-18/19/20), E3 deck + grill (JC-21…26, JC-55 Path B), E4 root CV / audit /
      gate / graph (JC-27…32). **Status: E2 auth done — the core loop closes end to end WITH accounts
      (preview → signup wall → deck → grill → build → `ready`; sessions + claim graph in Postgres).
      Remaining for S2 (polish, not demo blockers): the audit (LLM root-CV wording polish, decision
      #6) and interactive root-CV review (fix-this loop-backs, decision #7).**
      _Demo: a user completes onboarding and their profile flips to `ready` with a validator-clean graph._
- [ ] **S3 — The hunt** — gate-pass triggers cluster grounding + first hunt; real tailored cards
      within the hour; swipe; Apply → prepared-apply package (PDF + screening answers + deep link).
      Epics: E5 cluster engine (JC-33/34/35), E6 feed + hunt (JC-36…40), E7 swipe + prepared apply
      (JC-41/42/43). _Demo: the core loop closes on web._
- [ ] **S4 — Every day, everywhere** — per-user daily runs + notifications; the **mobile app** (swipe,
      deck, voice grill); the full Path B guided interview (JC-55, stubbed in S2); email-ingest +
      LinkedIn import doors; update flow; GDPR delete/export.
      Epics: E8 daily loop (JC-44/45), E9 mobile (JC-46…49), E10 import doors (JC-50/51), E11 update +
      compliance (JC-52…54, JC-56). _Demo: a returning user gets fresh cards daily on their phone._

## Backlog (S2, the immediate next work)

Riskiest first; per-ticket ACs are in the archived `dev-plan-v01-hosted.md`.

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
- **S2 remaining (polish, not demo blockers)** — the **audit** (LLM re-reads the root CV against
  `docs/cv-brain/` and polishes wording, kickoff decision #6) and interactive **root-CV review**
  (read-only + "fix this" loop-backs, decision #7). The core onboarding loop is done without them.
  Also: wire a real mail provider (`RESEND_API_KEY`) + `WEB_URL` on staging when we want real email
  (today staging returns the dev sign-in link).

Design decisions for this slice: [`docs/s2-kickoff.md`](docs/s2-kickoff.md).

## Later (unscheduled)

- **Advisory "improve your profile"** — a kind, never-blocking way to tell a user their profile is
  thin and how to strengthen it. The S2 gate deliberately judges only our pipeline's work, never the
  user's career; this feature is where profile-strength feedback will live. Decided 2026-07-18.

## Completed

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
