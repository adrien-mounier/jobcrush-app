# Roadmap — jobcrush-app

_Last updated: 2026-07-19_

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
      match % on a job — never a number on the person); **(B) how `cv-authoring-rules.md` is fed and
      maintained** — still open. _Demo: a prompt change is proved better, not felt better._
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
      **E5 also owes the reward design three things** (`docs/onboarding-reward-design.md` §6.2, §8-9):
      **re-scoring existing cards when the profile changes** (the month-two hook — an old 34% card
      reading 51% on return); its **ranked requirement list per ad** doing double duty as the
      instant, model-free match tick during onboarding; and **the family floor in the shape discovery
      can consume** — ranked into bands (the essential band *is* discovery's gate), each item carrying
      a question a lazy person answers in seconds, that question's answer options, the CV section it
      writes into, and whether a "no" is fatal or fine. An item that cannot be phrased as a question is
      not usable: discovery is the floor's first consumer.
- [ ] **S4 — Every day, everywhere** — per-user daily runs + notifications; the **mobile app** (swipe,
      deck, voice grill); the full Path B guided interview (JC-55, stubbed in S2); email-ingest +
      LinkedIn import doors; update flow; GDPR delete/export.
      Epics: E8 daily loop (JC-44/45), E9 mobile (JC-46…49), E10 import doors (JC-50/51), E11 update +
      compliance (JC-52…54, JC-56). _Demo: a returning user gets fresh cards daily on their phone._

## Backlog (S2.5, the immediate next work)

UX/UI cleanup of the existing flow (see milestone above). Critique done 2026-07-19 (dual-agent
`/impeccable critique`, 24/40; snapshot in `.impeccable/critique/`). Working through the fixes:

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

- ~~**Grill A: the grill's stopping rule + onboarding UX**~~ — **answered 2026-07-23**, see
  [`docs/onboarding-reward-design.md`](docs/onboarding-reward-design.md). The stopping rule is that
  there is none: the bar only ever counts down to the next card drop, so nothing is ever
  "incomplete" and the user leaves whenever they like, holding what they earned. What remains from
  this entry is tracked on the wayfinder map
  [Onboarding journey: landing to first card](https://github.com/adrien-mounier/jobcrush-app/issues/5):
  the **front door** is **done 2026-07-23** (*"Answer questions. Collect jobs."* on a centred door
  that writes itself, then **Ready?**, then the CV shortcut — §10.1), and **the discovery questions**
  are **done 2026-07-23** (§6.1-6.2: one free box for question 1, and discovery runs until the family
  floor's **essential band** has been *asked* — covered means asked, not satisfied). Still open:
  **the profile screen** and **the job card's contents**.

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
